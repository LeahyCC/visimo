/**
 * The raymarch kit's GPU half: everything two raymarched inks would otherwise
 * each write for themselves. An ink built on this says what it draws and
 * nothing about how it reaches the canvas.
 *
 *   march at a fraction of the ink target ─► scale it back up ─► add it, at presence
 *
 * A march costs a whole ray per pixel, one or two orders more than any
 * analytic ink here, so the march runs on a target of its own that is half the
 * ink target by default (`raymarch.params.ts` holds the sizing, and an ink may
 * choose its own scale from a knob). That is a different lever from the
 * fractal's `maxPixels`, which takes the whole frame down and the post stack
 * and every other ink with it; this takes down only the ink that is expensive.
 *
 * What a subclass supplies is a label, its own WGSL, how many floats its
 * uniform holds, and one method that fills that uniform for the frame and says
 * whether anything is lit. The shared WGSL (`shaders/raymarch.common.wgsl`) is
 * prepended to its code, the way the post stack prepends its own, so the
 * camera, the sphere trace, the primitives, the operators and the glint
 * threshold cannot drift between inks. The subclass owns `sceneDistance` and
 * its `fs` entry point; the vertex stage is the shared file's.
 *
 * Nothing is allocated per frame. The two pipelines, the sampler, the uniform
 * and the bind groups are made once at `init`; the marched target and the one
 * group that names it are remade only when the size it is marched at moves,
 * which a resize does and a knob can only do in eighths (`SCALE_STEP`). At
 * presence 0 the renderer never calls this at all, and a frame the ink says is
 * not lit uploads nothing and encodes no pass.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import common from '../shaders/raymarch.common.wgsl?raw'
import upscaleShader from '../shaders/raymarch.upscale.wgsl?raw'
import { HALF_SIZE, raymarchSize } from './raymarch.params'

/** Vertices in the one triangle each of the two passes draws. */
const TRIANGLE_VERTICES = 3

/**
 * The marched target's format. Half float, not the canvas's: a lit solid's
 * specular passes 1 on purpose so the bloom catches it, and an 8-bit target
 * between the march and the canvas would clip exactly that away before the
 * upscale ever saw it.
 */
export const MARCH_FORMAT: GPUTextureFormat = 'rgba16float'

type Gear = {
  device: GPUDevice
  march: GPURenderPipeline
  upscale: GPURenderPipeline
  marchGroup: GPUBindGroup
  upscaleLayout: GPUBindGroupLayout
  sampler: GPUSampler
  uniform: GPUBuffer
}

export abstract class RaymarchInk implements InkImpl {
  /** Names the GPU objects and any compilation message; usually the study's name. */
  protected abstract readonly label: string
  /** The ink's own WGSL. The shared half is prepended to it. */
  protected abstract readonly code: string
  /** Floats in its uniform, which its `fill` writes. */
  protected abstract readonly uniformFloats: number

  /** True on a software rasteriser, so an ink can cut its step budget. */
  protected software = false
  /** The size of the target actually marched, for the overlay and for `fill`. */
  protected marchWidth = 1
  protected marchHeight = 1

  private gear: Gear | null = null
  private uniformData = new Float32Array(0)
  private marched: GPUTexture | null = null
  private marchedView: GPUTextureView | null = null
  private upscaleGroup: GPUBindGroup | null = null
  private width = 1
  private height = 1
  private presence = 1
  /** Whether this frame's `update` wrote a uniform, so `render` knows to draw. */
  private lit = false

  get detail() {
    return `${this.marchWidth}x${this.marchHeight} marched`
  }

  /**
   * Fill the uniform for this frame and say whether anything is lit. False
   * means no pass is encoded and nothing is uploaded, which is what a silent
   * packet has to cost. `width` and `height` are the marched target's, not the
   * canvas's, since that is what the rays are built against.
   */
  protected abstract fill(
    features: Float32Array,
    dt: number,
    knobs: Tuning,
    presence: number,
    width: number,
    height: number,
    out: Float32Array,
  ): boolean

  /**
   * The share of the ink target this ink marches at. Half by default; an ink
   * with a knob for it overrides this, and `raymarchSize` snaps whatever comes
   * back so a knob sliding with a level cannot remake the target every frame.
   */
  protected scaleOf(_knobs: Tuning): number {
    return HALF_SIZE
  }

  init(context: SceneContext) {
    const { device, format, software } = context
    this.software = software
    this.uniformData = new Float32Array(this.uniformFloats)
    // The shared half in front of the ink's own, which is the one thing every
    // ink on this kit has in common. `test/wgsl.test.ts` compiles the pair.
    const code = this.code
    const module = device.createShaderModule({ label: this.label, code: common + code })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(
            `${this.label} WGSL ${message.lineNum}:${message.linePos} ${message.message}`,
          )
    })

    const upscale = device.createShaderModule({
      label: `${this.label} upscale`,
      code: upscaleShader,
    })

    void upscale.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(
            `Raymarch upscale WGSL ${message.lineNum}:${message.linePos} ${message.message}`,
          )
    })

    const uniform = device.createBuffer({
      label: `${this.label} uniform`,
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Both layouts are named rather than derived. A derived one holds only the
    // bindings a shader happens to read, so an ink that stops reading its
    // uniform in one stage would silently invalidate every group built for it.
    const marchLayout = device.createBindGroupLayout({
      label: `${this.label} march`,
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })

    const upscaleLayout = device.createBindGroupLayout({
      label: `${this.label} upscale`,
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    })

    this.gear = {
      device,
      uniform,
      upscaleLayout,
      sampler: device.createSampler({
        label: `${this.label} upscale`,
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      }),
      march: device.createRenderPipeline({
        label: `${this.label} march`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [marchLayout] }),
        vertex: { module, entryPoint: 'vs' },
        // No blend: the march owns its target and clears it every frame.
        fragment: { module, entryPoint: 'fs', targets: [{ format: MARCH_FORMAT }] },
        primitive: { topology: 'triangle-list' },
      }),
      upscale: device.createRenderPipeline({
        label: `${this.label} upscale`,
        layout: device.createPipelineLayout({ bindGroupLayouts: [upscaleLayout] }),
        vertex: { module: upscale, entryPoint: 'vs' },
        fragment: {
          module: upscale,
          entryPoint: 'fs',
          targets: [{ format, blend: INK_BLEND }],
        },
        primitive: { topology: 'triangle-list' },
      }),
      marchGroup: device.createBindGroup({
        label: `${this.label} march`,
        layout: marchLayout,
        entries: [{ binding: 0, resource: { buffer: uniform } }],
      }),
    }
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.lit = false
    const gear = this.gear
    const [width, height] = raymarchSize(this.width, this.height, this.scaleOf(knobs))
    this.marchWidth = width
    this.marchHeight = height
    if (!gear || presence <= 0) return
    if (!this.fill(features, dt, knobs, presence, width, height, this.uniformData)) return
    this.lit = true
    gear.device.queue.writeBuffer(gear.uniform, 0, this.uniformData)
  }

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    const gear = this.gear
    if (!gear || !this.lit) return
    const target = this.target(gear)
    if (!target || !this.upscaleGroup) return

    // The march writes its own target whole, so it clears rather than loading:
    // nothing of last frame's march is wanted, and the canvas's memory is the
    // post stack's business and not this one's.
    const march = encoder.beginRenderPass({
      label: `${this.label} march`,
      colorAttachments: [
        { view: target, loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' },
      ],
    })
    march.setPipeline(gear.march)
    march.setBindGroup(0, gear.marchGroup)
    march.draw(TRIANGLE_VERTICES)
    march.end()

    // The presence is the blend constant, as it is for every other ink, so the
    // director's fade costs the shader nothing and means the same thing here.
    const pass = encoder.beginRenderPass({
      label: `${this.label} upscale`,
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    })
    pass.setPipeline(gear.upscale)
    pass.setBlendConstant({ r: this.presence, g: this.presence, b: this.presence, a: 1 })
    pass.setBindGroup(0, this.upscaleGroup)
    pass.draw(TRIANGLE_VERTICES)
    pass.end()
  }

  dispose() {
    this.gear?.uniform.destroy()
    this.marched?.destroy()
    this.gear = null
    this.marched = null
    this.marchedView = null
    this.upscaleGroup = null
    this.lit = false
  }

  /**
   * The marched target at this frame's size, made the first time and remade
   * only when that size moves. The group that names it is remade with it, for
   * the same reason the canvas sampler remakes its own: a view outlives
   * nothing, and a group holding a destroyed texture is a validation error.
   */
  private target(gear: Gear): GPUTextureView | null {
    if (
      this.marched &&
      this.marchedView &&
      this.marched.width === this.marchWidth &&
      this.marched.height === this.marchHeight
    )
      return this.marchedView

    this.marched?.destroy()
    this.marched = gear.device.createTexture({
      label: `${this.label} marched`,
      size: { width: this.marchWidth, height: this.marchHeight },
      format: MARCH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })

    this.marchedView = this.marched.createView()
    this.upscaleGroup = gear.device.createBindGroup({
      label: `${this.label} upscale`,
      layout: gear.upscaleLayout,
      entries: [
        { binding: 0, resource: this.marchedView },
        { binding: 1, resource: gear.sampler },
      ],
    })

    return this.marchedView
  }
}
