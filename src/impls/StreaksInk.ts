/**
 * Thin radial lines converging on the centre, which is the `streaks` ink and
 * the tension drawn: a build lengthens them and multiplies them and the end of
 * the build takes them away. What is drawn, and where, is decided in
 * `streaks.params.ts`; this owns the GPU side of it, which is two small
 * buffers made once and one instanced draw.
 *
 * A study at presence 0 is never called, and one with nothing lit (a count of
 * zero, which is where the study rests until tension lifts it) encodes no pass
 * and uploads nothing, so an ink that is cast but not wound up costs a few
 * multiplications a frame.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/streaks.wgsl?raw'
import {
  advanceTravel,
  fillStreaks,
  MAX_STREAKS,
  STREAK_FLOATS,
  STREAK_UNIFORM_FLOATS,
  streakParams,
  writeStreakUniform,
} from './streaks.params'

/** Vertices in the two triangles that make one streak's quad. */
const QUAD_VERTICES = 6

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  uniform: GPUBuffer
  streaks: GPUBuffer
}

export class StreaksInk implements InkImpl {
  /** Nothing of its own worth a line in the overlay. */
  readonly detail = ''
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private phase = 0
  private presence = 1
  /** How many streaks this frame's `update` wrote, so `render` knows what to draw. */
  private lit = 0
  private readonly points = new Float32Array(MAX_STREAKS * STREAK_FLOATS)
  private readonly uniform = new Float32Array(STREAK_UNIFORM_FLOATS)

  init({ device, format }: SceneContext) {
    const module = device.createShaderModule({ label: 'Streaks', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Streaks WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    const uniform = device.createBuffer({
      label: 'Streaks uniform',
      size: this.uniform.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const streaks = device.createBuffer({
      label: 'Streaks',
      size: this.points.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    // Named rather than derived, so the two bindings the shader reads are the
    // two this says whatever the compiler makes of the entry points.
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
      label: 'Streaks',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'quad' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
      primitive: { topology: 'triangle-list' },
    })

    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: streaks } },
      ],
    })

    this.gear = { device, pipeline, group, uniform, streaks }
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.lit = 0
    const params = streakParams(knobs)
    // The clock runs whether or not anything is lit, so a streak that appears
    // mid-build is wherever its trip has got to and not at its start.
    this.phase = advanceTravel(this.phase, params.speed, dt)
    const gear = this.gear
    if (!gear || presence <= 0) return
    const lit = fillStreaks(params, this.phase, features, this.width, this.height, this.points)
    if (lit === 0) return
    this.lit = lit
    gear.device.queue.writeBuffer(gear.streaks, 0, this.points, 0, lit * STREAK_FLOATS)
    gear.device.queue.writeBuffer(
      gear.uniform,
      0,
      writeStreakUniform(params, this.width, this.height, this.uniform),
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
    this.gear?.streaks.destroy()
    this.gear = null
  }
}
