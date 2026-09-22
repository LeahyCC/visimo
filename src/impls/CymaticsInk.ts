/**
 * Sand on a vibrating plate, which is the `cymatics` ink. Which modes the plate
 * rings in, how wide and how bright the line is and what colour is decided in
 * `cymatics.params.ts`; this owns the GPU side of it, which is one small
 * uniform made once and one fullscreen triangle that sums the modes at every
 * pixel and draws where the sum crosses zero.
 *
 * A study at presence 0 is never called, and a plate with no note ringing,
 * which is what a silent packet resolves to, encodes no pass and uploads
 * nothing. There is no clock of its own: the notes are knobs the study shapes,
 * so nothing here runs per frame at all.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/cymatics.wgsl?raw'
import {
  CYMATICS_UNIFORM_FLOATS,
  cymaticsLit,
  cymaticsParams,
  writeCymaticsUniform,
} from './cymatics.params'

/** Vertices in the one triangle that covers the frame. */
const TRIANGLE_VERTICES = 3

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  uniform: GPUBuffer
}

export class CymaticsInk implements InkImpl {
  /** Nothing of its own worth a line in the overlay. */
  readonly detail = ''
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private presence = 1
  /** Whether this frame's `update` wrote a uniform, so `render` knows whether to draw. */
  private lit = false
  private readonly uniform = new Float32Array(CYMATICS_UNIFORM_FLOATS)

  init({ device, format }: SceneContext) {
    const module = device.createShaderModule({ label: 'Cymatics', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Cymatics WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    const uniform = device.createBuffer({
      label: 'Cymatics uniform',
      size: this.uniform.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Named rather than derived, so the one binding the shader reads is the
    // one this says whatever the compiler makes of the entry points.
    const layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })

    const pipeline = device.createRenderPipeline({
      label: 'Cymatics',
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
    const params = cymaticsParams(knobs)
    const gear = this.gear
    if (!gear || presence <= 0 || !cymaticsLit(params)) return
    this.lit = true
    gear.device.queue.writeBuffer(
      gear.uniform,
      0,
      writeCymaticsUniform(params, features, this.width, this.height, this.uniform),
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
