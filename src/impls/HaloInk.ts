/**
 * One soft glow about the middle of the canvas, which is the `halo` ink: the
 * ink the director can always fall back on, and so a modest one everywhere.
 * What the falloff is, and how much light it may add, is decided in
 * `halo.params.ts`; this owns the GPU side of it, which is one small uniform
 * made once and one quad sized to the glow.
 *
 * A study at presence 0 is never called, and one with nothing to draw (no
 * radius, which is what a silent packet resolves to, or no light) encodes no
 * pass and uploads nothing, so an ink that is cast but has nothing to say costs
 * a few multiplications a frame. It has no clock: what it draws is the knobs
 * and the key and nothing else.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import shader from '../shaders/halo.wgsl?raw'
import { HALO_UNIFORM_FLOATS, haloLit, haloParams, writeHaloUniform } from './halo.params'

/** Vertices in the two triangles that make the one quad. */
const QUAD_VERTICES = 6

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  uniform: GPUBuffer
}

export class HaloInk implements InkImpl {
  /** Nothing of its own worth a line in the overlay. */
  readonly detail = ''
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private presence = 1
  /** Whether this frame's `update` wrote a uniform, so `render` knows whether to draw. */
  private lit = false
  private readonly uniform = new Float32Array(HALO_UNIFORM_FLOATS)

  init({ device, format }: SceneContext) {
    const module = device.createShaderModule({ label: 'Halo', code: shader })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Halo WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    const uniform = device.createBuffer({
      label: 'Halo uniform',
      size: this.uniform.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Named rather than derived, so the one binding the shader reads is the
    // one this says whatever the compiler makes of the entry points. Both
    // stages read it: the vertex stage sizes the quad and the fragment stage
    // shapes the light.
    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    })

    const pipeline = device.createRenderPipeline({
      label: 'Halo',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'quad' },
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
    const params = haloParams(knobs)
    const gear = this.gear
    if (!gear || presence <= 0 || !haloLit(params)) return
    this.lit = true
    gear.device.queue.writeBuffer(
      gear.uniform,
      0,
      writeHaloUniform(params, features, this.width, this.height, this.uniform),
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
    pass.draw(QUAD_VERTICES)
    pass.end()
  }

  dispose() {
    this.gear?.uniform.destroy()
    this.gear = null
  }
}
