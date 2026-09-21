/**
 * Club laser fans sweeping through haze, which is the `lasers` ink: beams
 * thrown from the edges, swung by the beat. What the fans are, how wide they
 * open and how much light one beam carries is decided in `lasers.params.ts`;
 * this owns the GPU side of it, which is one small uniform made once and one
 * fullscreen triangle that sums every beam analytically.
 *
 * A study at presence 0 is never called, and one with no light (an intensity
 * of 0, which is what a silent packet resolves to through the tempo
 * confidence gate) encodes no pass and uploads nothing. There is no clock of
 * its own: what it draws is the knobs, the key and the packet's beat phase,
 * so nothing here runs per frame at all.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/lasers.wgsl?raw'
import {
  LASER_UNIFORM_FLOATS,
  laserParams,
  lasersLit,
  writeLasersUniform,
} from './lasers.params'

/** Vertices in the one triangle that covers the frame. */
const TRIANGLE_VERTICES = 3

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  uniform: GPUBuffer
}

export class LasersInk implements InkImpl {
  /** Nothing of its own worth a line in the overlay. */
  readonly detail = ''
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private presence = 1
  /** Whether this frame's `update` wrote a uniform, so `render` knows whether to draw. */
  private lit = false
  private readonly uniform = new Float32Array(LASER_UNIFORM_FLOATS)

  init({ device, format }: SceneContext) {
    const module = device.createShaderModule({ label: 'Lasers', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Lasers WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    const uniform = device.createBuffer({
      label: 'Lasers uniform',
      size: this.uniform.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Named rather than derived, so the one binding the shader reads is the
    // one this says whatever the compiler makes of the entry points.
    const layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })

    const pipeline = device.createRenderPipeline({
      label: 'Lasers',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
      primitive: { topology: 'triangle-list' },
    })

    const group = device.createBindGroup({
      layout,
      entries: [{ binding: 0, resource: { buffer: uniform } }],
    })

    this.gear = { device, pipeline, group, uniform }
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  update(features: Float32Array, _dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.lit = false
    const params = laserParams(knobs)
    const gear = this.gear
    if (!gear || presence <= 0 || !lasersLit(params)) return
    this.lit = true
    gear.device.queue.writeBuffer(
      gear.uniform,
      0,
      writeLasersUniform(params, features, this.width, this.height, this.uniform),
    )
  }

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    const gear = this.gear
    if (!gear || !this.lit) return
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }],
    })
    pass.setPipeline(gear.pipeline)
    pass.setBlendConstant({ r: this.presence, g: this.presence, b: this.presence, a: 1 })
    pass.setBindGroup(0, gear.group)
    pass.draw(TRIANGLE_VERTICES)
    pass.end()
  }

  dispose() {
    this.gear?.uniform.destroy()
    this.gear = null
  }
}
