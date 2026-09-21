/**
 * The lightning's half that touches the GPU: one uniform, one storage buffer
 * and one pipeline, and a pass that draws a widened quad per living segment.
 * What a bolt is, when one fires and how its light fades are
 * `lightning.params.ts`, which this only feeds a packet and reads the rows
 * back from.
 *
 * It is sparse on purpose and the cost follows: between drops the pool is
 * empty, nothing is uploaded and no pass is encoded, so the ink costs the CPU
 * a scan of eight strikes and the GPU nothing at all. While a bolt is lit it
 * uploads at most eight strikes of 96 segments and draws them in one call.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/lightning.wgsl?raw'
import {
  LIGHTNING_POOL,
  LIGHTNING_UNIFORM_FLOATS,
  lightningParams,
  LightningPool,
  SEGMENT_FLOATS,
  STRIKE_SEGMENTS,
  writeLightningUniform,
} from './lightning.params'

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  uniform: GPUBuffer
  segments: GPUBuffer
}

export class LightningInk implements InkImpl {
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private presence = 1
  /** Segments this frame's `update` wrote, so `render` knows what to draw. Zero encodes nothing. */
  private drawn = 0
  private readonly pool = new LightningPool()
  private readonly rows = new Float32Array(LIGHTNING_POOL * STRIKE_SEGMENTS * SEGMENT_FLOATS)
  private readonly view = new Float32Array(LIGHTNING_UNIFORM_FLOATS)

  /** Only while a bolt is lit, so the line is empty between drops. */
  get detail() {
    return this.drawn > 0 ? `${this.pool.alive} bolts` : ''
  }

  init({ device, format }: SceneContext) {
    const module = device.createShaderModule({ label: 'Lightning', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Lightning WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    const uniform = device.createBuffer({
      label: 'Lightning uniform',
      size: this.view.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const segments = device.createBuffer({
      label: 'Lightning segments',
      size: this.rows.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    // Named rather than derived, so the two bindings the shader reads are the
    // two this says whatever the compiler makes of the entry points. The
    // vertex stage widens the segments with both the uniform and the buffer,
    // and the fragment stage shapes the line from the uniform.
    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    })

    const pipeline = device.createRenderPipeline({
      label: 'Lightning',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
      primitive: { topology: 'triangle-list' },
    })

    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: segments } },
      ],
    })

    this.gear = { device, pipeline, group, uniform, segments }
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.drawn = 0
    const params = lightningParams(knobs)
    this.pool.step(features, dt, params)
    const gear = this.gear
    if (!gear || presence <= 0) return
    if (this.pool.alive === 0) return
    const drawn = this.pool.fill(this.rows, params)
    if (drawn === 0) return
    this.drawn = drawn
    gear.device.queue.writeBuffer(gear.segments, 0, this.rows, 0, drawn * SEGMENT_FLOATS)
    gear.device.queue.writeBuffer(
      gear.uniform,
      0,
      writeLightningUniform(params, this.width, this.height, this.view),
    )
  }

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    const gear = this.gear
    if (!gear || this.drawn === 0) return
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    })
    pass.setPipeline(gear.pipeline)
    pass.setBlendConstant({ r: this.presence, g: this.presence, b: this.presence, a: 1 })
    pass.setBindGroup(0, gear.group)
    // Six corners a segment, one instance a segment.
    pass.draw(6, this.drawn)
    pass.end()
  }

  dispose() {
    this.gear?.uniform.destroy()
    this.gear?.segments.destroy()
    this.gear = null
    this.drawn = 0
  }
}
