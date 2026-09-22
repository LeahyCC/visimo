/**
 * A sea to the horizon, which is the `ocean` ink: water drawn as the sky it
 * mirrors, over a surface of travelling wave trains. What it looks like is
 * `shaders/ocean.wgsl` and the numbers behind it are `ocean.params.ts`; the
 * ring of what the low and the mid bands were is height-kit, `HeightField`,
 * and this owns only the GPU side of putting the two together, which is one
 * small buffer made once and one fullscreen triangle.
 *
 * It is the second study on the kit and needs nothing changed in it. The kit's
 * terrain is a valley and hills, and a sea is not that, so the shader carries
 * its own march and reads the kit only for the ring, the fog and the horizon;
 * the profile the kit's uniform is asked for is then unused, and is passed as
 * a flat one.
 *
 * A study at presence 0 is never called, and one with no light (an intensity
 * of 0, which is what a silent packet resolves to) encodes no pass and uploads
 * nothing. The flight and the water's clock still run while it is dark, so the
 * sea is wherever it has got to when the sound comes back and the rows the
 * music wrote in the meantime go up together on the first lit frame, but that
 * is arithmetic on the CPU and no GPU work at all.
 */
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import type { InkImpl } from '../scenes/Impl'
import type { SceneContext } from '../scenes/Scene'
import common from '../shaders/height.common.wgsl?raw'
import shader from '../shaders/ocean.wgsl?raw'
import { HEIGHT_MAX_STEP } from './height.params'
import { HEIGHT_BINDINGS, HeightField, heightLayoutEntries } from './HeightField'
import {
  OCEAN_UNIFORM_FLOATS,
  oceanLit,
  oceanParams,
  SeaClock,
  writeOceanUniform,
} from './ocean.params'

/** Vertices in the one triangle that covers the frame. */
const TRIANGLE_VERTICES = 3

/** The sea's own uniform sits after the kit's two bindings. */
const LOOK_BINDING = Math.max(...Object.values(HEIGHT_BINDINGS)) + 1

/** The kit asks for a profile to write into its view. The sea's shader never reads one. */
const NO_PROFILE = { valley: 0.5, relief: 0 }

type Gear = {
  device: GPUDevice
  pipeline: GPURenderPipeline
  group: GPUBindGroup
  look: GPUBuffer
}

export class OceanInk implements InkImpl {
  /** Nothing of its own worth a line in the overlay. */
  readonly detail = ''
  private readonly field = new HeightField()
  private readonly clock = new SeaClock()
  private gear: Gear | null = null
  private width = 1
  private height = 1
  private presence = 1
  /** Whether this frame's `update` wrote its uniforms, so `render` knows whether to draw. */
  private lit = false
  private readonly look = new Float32Array(OCEAN_UNIFORM_FLOATS)

  init({ device, format }: SceneContext) {
    // The kit's declarations first, then the sea's, as one module.
    const code = shader
    const module = device.createShaderModule({ label: 'Ocean', code: common + code })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(`Ocean WGSL ${message.lineNum}:${message.linePos} ${message.message}`)
    })

    this.field.init(device)
    const look = device.createBuffer({
      label: 'Ocean look',
      size: this.look.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Named rather than derived, so the three bindings the shader reads are the
    // three this says whatever the compiler makes of the entry points.
    const layout = device.createBindGroupLayout({
      entries: [
        ...heightLayoutEntries(GPUShaderStage.FRAGMENT),
        { binding: LOOK_BINDING, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    })

    const pipeline = device.createRenderPipeline({
      label: 'Ocean',
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: INK_BLEND }] },
      primitive: { topology: 'triangle-list' },
    })

    const group = device.createBindGroup({
      layout,
      entries: [
        ...this.field.bindGroupEntries(),
        { binding: LOOK_BINDING, resource: { buffer: look } },
      ],
    })

    this.gear = { device, pipeline, group, look }
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.lit = false
    const gear = this.gear
    if (!gear) return
    const params = oceanParams(knobs)
    // Both clocks run whether or not there is light to see, and are the real
    // step and never a frame: distance is speed times seconds.
    const step = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), HEIGHT_MAX_STEP) : 0
    this.field.advance(params.speed * step, step, features)
    this.clock.step(step, params.speed)
    if (presence <= 0 || !oceanLit(params)) return
    this.lit = true
    this.field.upload(NO_PROFILE, this.width, this.height)
    gear.device.queue.writeBuffer(
      gear.look,
      0,
      writeOceanUniform(params, features, this.field.ring.distance, this.clock.time, this.look),
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
    this.gear?.look.destroy()
    this.field.dispose()
    this.gear = null
  }
}
