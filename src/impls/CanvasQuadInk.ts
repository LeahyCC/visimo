/**
 * A quad textured with last frame's canvas. It is not registered with the
 * director and no study names it: it exists so the canvas sampler has
 * something to be tested against, and so the one worked example of reading the
 * picture lives beside the code that offers it rather than in a comment.
 *
 * Two things every ink that reads the canvas has to live with, both from
 * `SceneContext.canvas`:
 *
 * - **One frame of latency.** What comes back is the frame the composite last
 *   wrote, so this draws where the picture was and not where it is. Nothing
 *   here tries to hide that; an ink that needs to line up with what is on
 *   screen this frame cannot use the sampler at all.
 * - **It is a loop.** The picture already holds what this ink drew a frame
 *   ago, so a gain of one over a quad covering the frame is a feedback loop
 *   with no decay in it and runs away to white in a second or two. This keeps
 *   the gain under one and the quad small, which is the whole of the rule: an
 *   ink reading the canvas stays sparse, keeps its gain under one, or both.
 *
 * With no canvas to read, which is every frame before the first composite, it
 * encodes nothing rather than binding an uninitialised texture.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/canvas.quad.wgsl?raw'

/** Vertices in the two triangles that make the quad. */
const QUAD_VERTICES = 6

/** Floats in the uniform: three vec4s, the quad, the source and the gain. */
export const CANVAS_QUAD_UNIFORM_FLOATS = 12

/**
 * The most of what it read that it adds back. Under one, so each trip round
 * the loop is dimmer than the last and the sum converges instead of running
 * away. At 0.5 a pixel drawn once has decayed past a thousandth in ten frames.
 */
export const MAX_GAIN = 0.9

/** How the quad is placed and what it reads, all in canvas uv. */
export type CanvasQuad = {
  /** The middle of the quad and its half extent, on the canvas it draws into. */
  centre: readonly [number, number]
  half: readonly [number, number]
  /** The middle and half extent of the part of last frame it reads. */
  source: readonly [number, number]
  sourceHalf: readonly [number, number]
  gain: number
}

export const DEFAULT_QUAD: CanvasQuad = {
  centre: [0.5, 0.5],
  half: [0.2, 0.2],
  source: [0.5, 0.5],
  sourceHalf: [0.45, 0.45],
  gain: 0.6,
}

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  layout: GPUBindGroupLayout
  sampler: GPUSampler
  uniform: GPUBuffer
}

export class CanvasQuadInk implements InkImpl {
  readonly detail = ''
  private context: SceneContext | null = null
  private gear: Gear | null = null
  private presence = 1
  private quad: CanvasQuad = DEFAULT_QUAD
  private readonly uniformData = new Float32Array(CANVAS_QUAD_UNIFORM_FLOATS)
  /** The group, rebuilt only when the canvas texture it names has moved. */
  private group: GPUBindGroup | null = null
  private bound: GPUTextureView | null = null

  /** What it draws and what it reads, since no study resolves knobs for it. */
  setQuad(quad: CanvasQuad) {
    this.quad = quad
  }

  init(context: SceneContext) {
    this.context = context
    const { device, format } = context
    const module = device.createShaderModule({ label: 'Canvas quad', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Canvas quad WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    // Named rather than derived: the group is rebuilt whenever the half of the
    // history it reads alternates, which is every frame.
    const layout = device.createBindGroupLayout({
      label: 'Canvas quad',
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

    this.gear = {
      device,
      layout,
      sampler: device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge',
      }),
      uniform: device.createBuffer({
        label: 'Canvas quad',
        size: this.uniformData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      pipeline: device.createRenderPipeline({
        label: 'Canvas quad',
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'quad' },
        fragment: { module, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
        primitive: { topology: 'triangle-list' },
      }),
    }
  }

  resize() {}

  update(_features: Float32Array, _dt: number, _knobs: Tuning, presence: number) {
    this.presence = presence
  }

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    const gear = this.gear
    const picture = this.context?.canvas?.() ?? null
    if (!gear || !picture || this.presence <= 0 || !(this.quad.gain > 0)) return
    writeCanvasQuadUniform(this.quad, this.uniformData)
    gear.device.queue.writeBuffer(gear.uniform, 0, this.uniformData)
    if (!this.group || this.bound !== picture.view) {
      this.group = gear.device.createBindGroup({
        label: 'Canvas quad',
        layout: gear.layout,
        entries: [
          { binding: 0, resource: { buffer: gear.uniform } },
          { binding: 1, resource: picture.view },
          { binding: 2, resource: gear.sampler },
        ],
      })
      this.bound = picture.view
    }

    const pass = encoder.beginRenderPass({
      label: 'Canvas quad',
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
    this.gear = null
    this.context = null
    this.group = null
    this.bound = null
  }
}

/** The uniform the shader reads, with the gain held under one. */
export function writeCanvasQuadUniform(quad: CanvasQuad, out: Float32Array): Float32Array {
  out[0] = quad.centre[0]
  out[1] = quad.centre[1]
  out[2] = quad.half[0]
  out[3] = quad.half[1]
  out[4] = quad.source[0]
  out[5] = quad.source[1]
  out[6] = quad.sourceHalf[0]
  out[7] = quad.sourceHalf[1]
  out[8] = Math.min(Math.max(quad.gain, 0), MAX_GAIN)
  out[9] = 0
  out[10] = 0
  out[11] = 0
  return out
}
