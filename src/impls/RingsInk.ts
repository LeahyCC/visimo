/**
 * Thin circles spreading from the middle on the predicted beat, which is the
 * `rings` ink. When one is born, where it is and how bright is decided in
 * `rings.params.ts`; this owns the GPU side of it, which is two small buffers
 * made once and one instanced strip a ring.
 *
 * A study at presence 0 is never called, and one with nothing to draw (no ring
 * alive, which is where it sits on a track with no steady beat, or no light)
 * encodes no pass and uploads nothing. The pool still steps every frame, since
 * its clock is what places a ring the frame it is born, but that is a few
 * comparisons and no GPU work.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/rings.wgsl?raw'
import {
  RING_FLOATS,
  RING_POOL,
  RING_SEGMENTS,
  RING_UNIFORM_FLOATS,
  ringParams,
  RingPool,
  writeRingUniform,
} from './rings.params'

/** Corners in one ring's strip: an inner and an outer for each piece, and one more piece to close it. */
const STRIP_VERTICES = 2 * (RING_SEGMENTS + 1)

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  uniform: GPUBuffer
  rings: GPUBuffer
}

export class RingsInk implements InkImpl {
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private presence = 1
  /** How many rings this frame's `update` wrote, so `render` knows what to draw. */
  private lit = 0
  private readonly pool = new RingPool()
  private readonly rows = new Float32Array(RING_POOL * RING_FLOATS)
  private readonly uniform = new Float32Array(RING_UNIFORM_FLOATS)

  /** Only while something is spreading, so the line is empty between beats it has none for. */
  get detail() {
    return this.lit > 0 ? `${this.lit} rings` : ''
  }

  init({ device, format }: SceneContext) {
    const module = device.createShaderModule({ label: 'Rings', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Rings WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    const uniform = device.createBuffer({
      label: 'Rings uniform',
      size: this.uniform.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const rings = device.createBuffer({
      label: 'Rings',
      size: this.rows.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    // Named rather than derived, so the two bindings the shader reads are the
    // two this says whatever the compiler makes of the entry points. The
    // fragment stage shapes the edge from the uniform, and the vertex stage
    // reads both the uniform and the rings.
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
      label: 'Rings',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'strip' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
      primitive: { topology: 'triangle-strip' },
    })

    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: rings } },
      ],
    })

    this.gear = { device, pipeline, group, uniform, rings }
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.lit = 0
    const params = ringParams(knobs)
    // The clock runs whether or not anything is lit, so a ring is born where
    // the beat puts it the frame the light comes back.
    this.pool.step(features, dt, params)
    const gear = this.gear
    if (!gear || presence <= 0) return
    const lit = this.pool.fill(this.rows, params, features, this.width, this.height)
    if (lit === 0) return
    this.lit = lit
    gear.device.queue.writeBuffer(gear.rings, 0, this.rows, 0, lit * RING_FLOATS)
    gear.device.queue.writeBuffer(
      gear.uniform,
      0,
      writeRingUniform(params, this.width, this.height, this.uniform),
    )
  }

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    const gear = this.gear
    if (!gear || this.lit === 0) return
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    })
    pass.setPipeline(gear.pipeline)
    pass.setBlendConstant({ r: this.presence, g: this.presence, b: this.presence, a: 1 })
    pass.setBindGroup(0, gear.group)
    pass.draw(STRIP_VERTICES, this.lit)
    pass.end()
  }

  dispose() {
    this.gear?.uniform.destroy()
    this.gear?.rings.destroy()
    this.gear = null
    this.lit = 0
  }
}
