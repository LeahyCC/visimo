/**
 * The aurora's half that touches the GPU: one uniform, one pipeline and one
 * fullscreen triangle. What a curtain is, where its light falls and how much
 * of the frame it may light are decided in `aurora.params.ts`; this feeds it
 * the packet and the real time step and moves the answer into the uniform.
 *
 * A study at presence 0 is never called, and one with no light (an intensity
 * or a curtain count of zero, which is what a silent packet resolves to)
 * encodes no pass and uploads nothing. The clocks and the ripples run either
 * way, on the CPU and for nothing, so a curtain that comes in with the music
 * is wherever its path has got to and not at the start of it.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/aurora.wgsl?raw'
import {
  advanceAurora,
  AURORA_UNIFORM_FLOATS,
  auroraLit,
  auroraParams,
  AuroraRipples,
  newClock,
  writeAuroraUniform,
} from './aurora.params'
import type { Ripple } from './aurora.params'

/** Vertices in the one triangle that covers the frame. */
const TRIANGLE_VERTICES = 3

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  uniform: GPUBuffer
}

export class AuroraInk implements InkImpl {
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private presence = 1
  /** Whether this frame's `update` wrote a uniform, so `render` knows whether to draw. */
  private lit = false
  private readonly clock = newClock()
  private readonly ripples = new AuroraRipples()
  private readonly alive: Ripple[] = []
  private readonly uniform = new Float32Array(AURORA_UNIFORM_FLOATS)

  /** The line in the overlay: the curtains lit, and a ripple while one is travelling. */
  get detail() {
    if (!this.lit) return ''
    const travelling = this.ripples.alive
    return travelling > 0 ? `${travelling} ripples` : ''
  }

  init({ device, format }: SceneContext) {
    const module = device.createShaderModule({ label: 'Aurora', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Aurora WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    const uniform = device.createBuffer({
      label: 'Aurora uniform',
      size: this.uniform.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Named rather than derived, so the one binding the shader reads is the
    // one this says whatever the compiler makes of the entry points.
    const layout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })

    const pipeline = device.createRenderPipeline({
      label: 'Aurora',
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

  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.lit = false
    const params = auroraParams(knobs)
    advanceAurora(this.clock, params.drift, dt)
    this.ripples.step(features, dt, params)
    const gear = this.gear
    if (!gear || presence <= 0 || !auroraLit(params)) return
    this.lit = true
    gear.device.queue.writeBuffer(
      gear.uniform,
      0,
      writeAuroraUniform(
        params,
        this.clock,
        features,
        this.ripples.read(this.alive),
        this.width,
        this.height,
        this.uniform,
      ),
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
    this.lit = false
  }
}
