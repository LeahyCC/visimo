/**
 * The bands as bars round a circle, which is the `spectrum` ink and the most
 * literal study in the library: it shows the listener the sound itself beside
 * the ribbon, and the trails turn its bars into petals. What is drawn, and
 * where, is decided in `spectrum.params.ts`; this owns the GPU side of it, which
 * is two small buffers made once and one instanced draw.
 *
 * A study at presence 0 is never called, and one with nothing lit (no count, no
 * light, or a packet with no level in any band, which is where a silent track
 * sits) encodes no pass and uploads nothing. The ring's clock still runs, so
 * the ring is wherever its turn has got to when the sound comes back, but that
 * is one addition and no GPU work.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/spectrum.wgsl?raw'
import {
  advanceSpin,
  BAR_FLOATS,
  BAR_UNIFORM_FLOATS,
  fillBars,
  MAX_BARS,
  spectrumParams,
  writeBarUniform,
} from './spectrum.params'

/** Vertices in the two triangles that make one bar's quad. */
const QUAD_VERTICES = 6

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  uniform: GPUBuffer
  bars: GPUBuffer
}

export class SpectrumInk implements InkImpl {
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private turns = 0
  private presence = 1
  /** How many bars this frame's `update` wrote, so `render` knows what to draw. */
  private lit = 0
  private readonly rows = new Float32Array(MAX_BARS * BAR_FLOATS)
  private readonly uniform = new Float32Array(BAR_UNIFORM_FLOATS)

  /** Only while something is standing, so the line is empty in the silence it has nothing for. */
  get detail() {
    return this.lit > 0 ? `${this.lit} bars` : ''
  }

  init({ device, format }: SceneContext) {
    const module = device.createShaderModule({ label: 'Spectrum', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Spectrum WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    const uniform = device.createBuffer({
      label: 'Spectrum uniform',
      size: this.uniform.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const bars = device.createBuffer({
      label: 'Spectrum bars',
      size: this.rows.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })

    // Named rather than derived, so the two bindings the shader reads are the
    // two this says whatever the compiler makes of the entry points. The
    // fragment stage shapes the sides from the uniform, and the vertex stage
    // reads both the uniform and the bars.
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
      label: 'Spectrum',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'quad' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
      primitive: { topology: 'triangle-list' },
    })

    const group = device.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: uniform } },
        { binding: 1, resource: { buffer: bars } },
      ],
    })

    this.gear = { device, pipeline, group, uniform, bars }
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.lit = 0
    const params = spectrumParams(knobs)
    this.turns = advanceSpin(this.turns, params.spin, dt)
    const gear = this.gear
    if (!gear || presence <= 0) return
    const lit = fillBars(params, features, this.turns, this.width, this.height, this.rows)
    if (lit === 0) return
    this.lit = lit
    gear.device.queue.writeBuffer(gear.bars, 0, this.rows, 0, lit * BAR_FLOATS)
    gear.device.queue.writeBuffer(
      gear.uniform,
      0,
      writeBarUniform(params, this.width, this.height, this.uniform),
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
    this.gear?.bars.destroy()
    this.gear = null
    this.lit = 0
  }
}
