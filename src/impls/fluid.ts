/**
 * The fluid as two studies: `fluid`, the flow that stirs the field, and
 * `dye`, the ink that draws what is in it. They are one GPU object because
 * one splat carries both an impulse and a puff of dye out of the same
 * uniform, so `Fluid` owns the field and these two say which half of its
 * numbers each study brings.
 *
 * That is why the dye study carries `requires: ['fluid']`: without a fluid
 * flow in the cast there is no field for it to draw, and the renderer builds
 * it against the flow that is already live rather than a field of its own.
 *
 * The solve is deferred from `update` to `simulate` on purpose. The renderer
 * updates every flow, then every ink, then encodes, and the dye ink's numbers
 * have to be in the uniform before the injection step reads it.
 */
import type { Tuning } from '../presets/knobs'
import { Fluid } from '../scenes/Fluid'
import { fluidTuning } from '../scenes/fluid.params'
import type { FlowImpl, InkImpl } from '../scenes/Impl'
import type { Flow, SceneContext } from '../scenes/Scene'

export class FluidFlow implements FlowImpl {
  readonly field: Fluid
  private readonly merged: Record<string, number> = {}
  private solver: Tuning = {}
  private ink: Tuning | null = null
  private presence = 1
  private features: Float32Array | null = null
  private dt = 0

  constructor(size: number) {
    this.field = new Fluid(size)
  }

  /**
   * The field's own line, and only when nothing is drawing it. With a dye ink
   * live the ink names the same grid, and `data-detail` would otherwise print
   * it twice.
   */
  get detail() {
    return this.ink ? '' : `${this.field.simSize} flow`
  }

  get flow(): Flow | null {
    return this.field.flow
  }

  init(context: SceneContext) {
    this.field.init(context)
  }

  resize(width: number, height: number) {
    this.field.resize(width, height)
  }

  /** The grid is a choice of the host's, so one control moves every fluid. */
  setSize(size: number) {
    this.field.setSize(size)
  }

  update(features: Float32Array, dt: number, knobs: Tuning, presence: number) {
    this.features = features
    this.dt = dt
    this.solver = knobs
    this.presence = presence
    // Cleared here rather than when an ink leaves: the flows update before
    // the inks every frame, so an ink that is gone simply never sets it.
    this.ink = null
  }

  /** Set by a dye ink between this flow's update and the encoder. */
  setInk(knobs: Tuning) {
    this.ink = knobs
  }

  simulate(encoder: GPUCommandEncoder) {
    const features = this.features
    if (!features) return
    this.field.update(
      features,
      this.dt,
      fluidTuning(this.solver, this.presence, this.ink, this.merged),
    )
    this.field.simulate(encoder)
  }

  dispose() {
    this.field.dispose()
    this.features = null
  }
}

/**
 * The dye drawn out of the field its flow is stirring. It owns no GPU object
 * of its own, so `init`, `resize` and `dispose` have nothing to do: the flow
 * built the field and the flow releases it.
 */
export class DyeInk implements InkImpl {
  private presence = 1

  constructor(readonly source: FluidFlow) {}

  get detail() {
    return this.source.field.detail
  }

  init() {}

  resize() {}

  update(_features: Float32Array, _dt: number, knobs: Tuning, presence: number) {
    this.presence = presence
    this.source.setInk(knobs)
  }

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    this.source.field.drawDye(encoder, view, this.presence)
  }

  dispose() {}
}
