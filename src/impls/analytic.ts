/**
 * The analytic flow: one fragment pass writing a velocity field that is a sum
 * of terms rather than a simulation. It is the implementation a dozen of the
 * flows in docs/studies-handoff.md share, because each of them is a velocity
 * you can write down, and `analytic.params.ts` beside this file is the maths
 * and the recipe for adding another.
 *
 * It holds one texture and one uniform and keeps one number between frames:
 * the field is a pure function of this frame's knobs and the curl term's
 * clock, so there is no field to carry, no warm-up and nothing to reset but
 * that clock. The clock is the sum of `curlRate` times the real step, which
 * is why the pattern reads the same at any frame rate. The fluid is the
 * opposite on every count, and the two sit under the same `FlowImpl` and blend
 * through `FlowBlend`.
 *
 * With every coefficient at zero, which is what implode at a tension of zero
 * is, no pass is encoded and no field is offered: the post stack then binds
 * its own zero texel and the picture is carried nowhere. So a study on this
 * implementation costs nothing until it has something to say.
 */
import type { Tuning } from '../presets/knobs'
import { visibleExtent } from '../scenes/fluid.params'
import type { Extent } from '../scenes/fluid.params'
import type { FlowImpl } from '../scenes/Impl'
import type { Flow, SceneContext } from '../scenes/Scene'
import source from '../shaders/analytic.field.wgsl?raw'
import {
  advanceCurlClock,
  ANALYTIC_SIZE,
  ANALYTIC_UNIFORM_FLOATS,
  analyticField,
  fieldCover,
  fieldMoves,
  writeAnalyticUniform,
} from './analytic.params'

const FIELD_FORMAT: GPUTextureFormat = 'rgba16float'

type Gear = {
  device: GPUDevice
  texture: GPUTexture
  view: GPUTextureView
  uniform: GPUBuffer
  pipeline: GPURenderPipeline
  group: GPUBindGroup
}

export class AnalyticFlow implements FlowImpl {
  private gear: Gear | null = null
  private readonly data = new Float32Array(ANALYTIC_UNIFORM_FLOATS)
  private visible: Extent = { x: 0.5, y: 0.5 }
  private knobs: Tuning = {}
  private presence = 1
  /** The curl pattern's place in its evolution, in turns; see `advanceCurlClock`. */
  private clock = 0
  /** Whether the last `simulate` wrote a field worth reading back along. */
  private wrote = false

  get detail() {
    return this.gear ? `${ANALYTIC_SIZE} analytic` : ''
  }

  get flow(): Flow | null {
    const gear = this.gear
    if (!gear || !this.wrote) return null
    return { view: gear.view, cover: fieldCover(this.visible), size: ANALYTIC_SIZE }
  }

  init(context: SceneContext) {
    const { device } = context
    const module = device.createShaderModule({ label: 'Analytic field', code: source })
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages)
        if (message.type === 'error')
          console.error(
            `Analytic field WGSL ${message.lineNum}:${message.linePos} ${message.message}`,
          )
    })

    const texture = device.createTexture({
      label: 'Analytic field',
      size: { width: ANALYTIC_SIZE, height: ANALYTIC_SIZE },
      format: FIELD_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    const uniform = device.createBuffer({
      size: ANALYTIC_UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const pipeline = device.createRenderPipeline({
      label: 'Analytic field',
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: FIELD_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    })

    this.gear = {
      device,
      texture,
      view: texture.createView(),
      uniform,
      pipeline,
      // One binding and one buffer that is never replaced, so the group is
      // built once rather than per frame.
      group: device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniform } }],
      }),
    }
  }

  /** The grid does not follow the canvas; only the crop it is read through does. */
  resize(width: number, height: number) {
    this.visible = visibleExtent(width, height)
  }

  /**
   * The packet is not read. Every magnitude arrives in `knobs` with its
   * mapping already applied, and the field is a rate rather than something
   * integrated. The step is read for the one thing that is, the curl clock,
   * which runs whether or not the curl is on, so that a study which brings it
   * in with a build finds the pattern where the seconds have left it.
   */
  update(_features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.knobs = knobs
    this.presence = presence
    this.clock = advanceCurlClock(this.clock, knobs, dt)
  }

  simulate(encoder: GPUCommandEncoder) {
    const gear = this.gear
    if (!gear) return
    const field = analyticField(this.knobs, this.presence, this.visible, this.clock)
    this.wrote = fieldMoves(field)
    if (!this.wrote) return
    gear.device.queue.writeBuffer(gear.uniform, 0, writeAnalyticUniform(field, this.data))
    const pass = encoder.beginRenderPass({
      label: 'Analytic field',
      colorAttachments: [
        {
          view: gear.view,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(gear.pipeline)
    pass.setBindGroup(0, gear.group)
    pass.draw(3)
    pass.end()
  }

  dispose() {
    this.gear?.texture.destroy()
    this.gear?.uniform.destroy()
    this.gear = null
    this.wrote = false
    this.clock = 0
  }
}
