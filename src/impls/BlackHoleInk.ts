/**
 * The black hole ink: one burning accretion ring on the rim of an empty
 * middle, and an annulus around it that reads last frame's canvas through a
 * radial displacement so the picture outside appears to bend round the hole.
 * `blackhole.params.ts` beside this file is every number and the reasoning;
 * this owns the GPU side, which is one uniform, one sampler and one quad.
 *
 * It is the second thing in the repository to use the canvas sampler, after
 * `CanvasQuadInk`, and it lives with both of the sampler's traps:
 *
 * - **One frame of latency.** What comes back is the frame the composite last
 *   wrote, so the annulus bends where the picture was. Nothing here hides
 *   that, and nothing here needs to: a lens bending a frame-old picture looks
 *   exactly like a lens.
 * - **It is a loop.** The gain is worked out in the params file as a share of
 *   what the canvas lets go of over the same real step, and the annulus only
 *   ever reads a radius further out than the one it draws at, so the settled
 *   annulus is bounded by the picture it reads. `blackhole.params.test.ts`
 *   runs that loop forward and holds it.
 *
 * With no canvas to read, which is every frame before the first composite and
 * the frame after the trails are reset, it binds one black texel and writes a
 * gain of 0, so the ring still draws and the annulus adds nothing. Failing to
 * draw at all there would lose the ring for a frame every time the canvas is
 * emptied.
 */
import { F } from '../audio/FeatureExtractor'
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/blackhole.wgsl?raw'
import {
  BLACKHOLE_UNIFORM_FLOATS,
  blackHoleLit,
  blackHoleParams,
  writeBlackHoleUniform,
} from './blackhole.params'

/** Vertices in the two triangles that make the one quad. */
const QUAD_VERTICES = 6

/** The stand-in bound when there is no canvas yet, so the ring still draws. */
const STILL_FORMAT: GPUTextureFormat = 'rgba16float'

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  layout: GPUBindGroupLayout
  sampler: GPUSampler
  uniform: GPUBuffer
  still: GPUTexture
  stillView: GPUTextureView
}

export class BlackHoleInk implements InkImpl {
  /** Nothing of its own worth a line in the overlay. */
  readonly detail = ''
  private context: SceneContext | null = null
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private presence = 1
  private step = 1 / 60
  /** Whether this frame's `update` found anything to draw. */
  private lit = false
  private knobs: Tuning = {}
  private keyHue = 0
  private readonly uniform = new Float32Array(BLACKHOLE_UNIFORM_FLOATS)
  /** The group, rebuilt only when the canvas texture it names has moved. */
  private group: GPUBindGroup | null = null
  private bound: GPUTextureView | null = null

  init(context: SceneContext) {
    this.context = context
    const { device, format } = context
    const module = device.createShaderModule({ label: 'Black hole', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Black hole WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    // Named rather than derived. The group is rebuilt whenever the half of the
    // history it reads alternates, which is every frame, and a derived layout
    // would hold only the bindings the shader happens to read today: take the
    // canvas out of the fragment stage and every group built against it would
    // become invalid at once.
    const layout = device.createBindGroupLayout({
      label: 'Black hole',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    })

    // One texel, never written, so it reads as black: what the annulus is
    // handed before the first frame has been composited.
    const still = device.createTexture({
      label: 'Black hole stand-in',
      size: { width: 1, height: 1 },
      format: STILL_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })

    this.gear = {
      device,
      layout,
      still,
      stillView: still.createView(),
      sampler: device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      }),
      uniform: device.createBuffer({
        label: 'Black hole',
        size: this.uniform.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      pipeline: device.createRenderPipeline({
        label: 'Black hole',
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'quad' },
        fragment: { module, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
        primitive: { topology: 'triangle-list' },
      }),
    }
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  /**
   * Nothing is uploaded here, because the gain depends on which half of the
   * history is offered back and that is only known inside `render`. What this
   * keeps is the step, which the gain is worked out over, and whether there
   * is anything to draw at all.
   */
  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.knobs = knobs
    this.step = dt
    this.keyHue = features[F.keyHue] ?? 0
    this.lit = presence > 0 && blackHoleLit(blackHoleParams(knobs))
  }

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    const gear = this.gear
    if (!gear || !this.lit) return
    const picture = this.context?.canvas?.() ?? null
    const source = picture?.view ?? gear.stillView
    // With no canvas the annulus has nothing to bend, so the bend goes to 0
    // and the pass draws the ring alone.
    const resolved = blackHoleParams(this.knobs)
    const params = picture ? resolved : { ...resolved, bend: 0 }
    writeBlackHoleUniform(params, this.keyHue, this.step, this.width, this.height, this.uniform)
    gear.device.queue.writeBuffer(gear.uniform, 0, this.uniform)
    if (!this.group || this.bound !== source) {
      this.group = gear.device.createBindGroup({
        label: 'Black hole',
        layout: gear.layout,
        entries: [
          { binding: 0, resource: { buffer: gear.uniform } },
          { binding: 1, resource: source },
          { binding: 2, resource: gear.sampler },
        ],
      })
      this.bound = source
    }

    const pass = encoder.beginRenderPass({
      label: 'Black hole',
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    })
    pass.setPipeline(gear.pipeline)
    pass.setBlendConstant({ r: this.presence, g: this.presence, b: this.presence, a: 1 })
    pass.setBindGroup(0, this.group)
    pass.draw(QUAD_VERTICES)
    pass.end()
  }

  dispose() {
    this.gear?.uniform.destroy()
    this.gear?.still.destroy()
    this.gear = null
    this.context = null
    this.group = null
    this.bound = null
    this.lit = false
  }
}
