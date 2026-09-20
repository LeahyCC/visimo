/**
 * Slow specks adrift, which is the `dust` ink: the quiet end of a song drawn as
 * a few dozen soft points that barely move. What is drawn, and where, is
 * decided in `dust.params.ts`; this owns the GPU side of it, which is two
 * small buffers made once and one instanced draw.
 *
 * A study at presence 0 is never called, and one with nothing lit (a count of
 * zero, which is what a silent packet resolves to) encodes no pass and uploads
 * nothing, so an ink that is cast but has nothing to say costs a few
 * multiplications a frame.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/dust.wgsl?raw'
import {
  advanceClock,
  DUST_UNIFORM_FLOATS,
  dustParams,
  fillSpecks,
  MAX_SPECKS,
  SPECK_FLOATS,
  writeDustUniform,
} from './dust.params'
import type { DustClock } from './dust.params'

/** Vertices in the two triangles that make one speck's quad. */
const QUAD_VERTICES = 6

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  uniform: GPUBuffer
  specks: GPUBuffer
}

export class DustInk implements InkImpl {
  /** Nothing of its own worth a line in the overlay. */
  readonly detail = ''
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private readonly clock: DustClock = { travel: 0, seconds: 0 }
  private presence = 1
  /** How many specks this frame's `update` wrote, so `render` knows what to draw. */
  private lit = 0
  private readonly points = new Float32Array(MAX_SPECKS * SPECK_FLOATS)
  private readonly uniform = new Float32Array(DUST_UNIFORM_FLOATS)

  init({ device, format }: SceneContext) {
    const module = device.createShaderModule({ label: 'Dust', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Dust WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    const uniform = device.createBuffer({
      label: 'Dust uniform',
      size: this.uniform.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const specks = device.createBuffer({
      label: 'Dust',
      size: this.points.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    // Named rather than derived, so the two bindings the shader reads are the
    // two this says whatever the compiler makes of the entry points.
    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    })

    const pipeline = device.createRenderPipeline({
      label: 'Dust',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'quad' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
      primitive: { topology: 'triangle-list' },
    })

    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: specks } },
      ],
    })

    this.gear = { device, pipeline, group, uniform, specks }
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.lit = 0
    const params = dustParams(knobs)
    // The clocks run whether or not anything is lit, so a speck that comes in
    // with the sound is wherever its drift has got to and not at its start.
    advanceClock(this.clock, params.drift, dt)
    const gear = this.gear
    if (!gear || presence <= 0) return
    const lit = fillSpecks(params, this.clock, features, this.width, this.height, this.points)
    if (lit === 0) return
    this.lit = lit
    gear.device.queue.writeBuffer(gear.specks, 0, this.points, 0, lit * SPECK_FLOATS)
    gear.device.queue.writeBuffer(
      gear.uniform,
      0,
      writeDustUniform(this.width, this.height, this.uniform),
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
    pass.draw(QUAD_VERTICES, this.lit)
    pass.end()
  }

  dispose() {
    this.gear?.uniform.destroy()
    this.gear?.specks.destroy()
    this.gear = null
  }
}
