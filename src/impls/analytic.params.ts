/**
 * The analytic flow's numbers: the velocity at a point, the aspect handling
 * behind it, and the uniform the shader reads. Pure TypeScript with no GPU
 * objects, like `scenes/fluid.params.ts`, so every choice here is unit tested
 * and `analytic.ts` is left moving data into a buffer.
 *
 * The field is a SUM OF TERMS, each scaled by one coefficient, because a
 * dozen of the flows in docs/studies-handoff.md are not simulations at all:
 * they are a velocity you can write down as a function of position and time.
 * Sharing one implementation between them means a study is nothing but
 * numbers, and a cast can blend two of them by blending their knobs.
 *
 * Two terms exist so far. `radial` runs along the line to the centre and
 * `swirl` and `twist` run around it. Adding another (shear bands, lattice,
 * ripple, drip, curl noise) is three things and no more:
 *
 *   1. its coefficient in `ANALYTIC_KNOBS` (`presets/knobs.ts`) and a range
 *      in `ANALYTIC_RANGES` below,
 *   2. a field of `AnalyticField`, read in `analyticField` and written into a
 *      vec4 of its own by `writeAnalyticUniform`, appended AFTER the vec4s
 *      that are already there so nothing existing moves,
 *   3. the same few lines in `analyticVelocity` and, transcribed, in
 *      `shaders/analytic.field.wgsl`.
 *
 * Every velocity is per second and nothing here accumulates, which is what
 * makes the flow read the same at any frame rate: the feedback pass is handed
 * a rate and multiplies by the real step.
 */
import type { AnalyticKnob, Tuning } from '../presets/knobs'
import type { Extent } from '../scenes/fluid.params'

/**
 * The grid the field is written on, in texels a side. It is small on purpose
 * and small is enough: every term is smooth, the sampler reads it back with
 * linear filtering, and the sharpest thing in it is the turn of direction
 * around the centre, which the profile below fades to nothing anyway. At 128
 * a 16 by 9 canvas sees 128 by 72 texels of it, so the coarsest detail is
 * about twenty screen pixels across at 2560 by 1440 and the interpolation
 * error between two texels of a term that changes over a tenth of the frame
 * is under a thousandth of its own value. It costs 16384 fragment
 * invocations and 128 KB, against the fluid's 14 MB and nine dispatches.
 */
export const ANALYTIC_SIZE = 128

/** Floats in the uniform; the `Field` struct in analytic.field.wgsl matches. */
export const ANALYTIC_UNIFORM_FLOATS = 12

const TWO_PI = Math.PI * 2

/**
 * What one frame of the field is, with presence already in it. Coefficients
 * are rates and the last two are the frame they are measured against.
 */
export type AnalyticField = {
  /** Field widths a second along the outward ray, at the peak of the profile. */
  radial: number
  /** Where that peak sits; see `radialProfile`. Never negative. */
  falloff: number
  /** Turns a second about the centre, at every radius alike. */
  swirl: number
  /** Turns a second added at the centre and gone by the reference radius. */
  twist: number
  /** The canvas centre in field uv. The field is centred on the canvas. */
  centre: readonly [number, number]
  /** Field uv from the centre to the canvas corner, whatever the canvas shape. */
  reference: number
}

/** Resting values for anything no live study named, as `fluidParams` has. */
export const ANALYTIC_DEFAULTS: Readonly<Record<AnalyticKnob, number>> = {
  radial: 0,
  falloff: 0,
  swirl: 0,
  twist: 0,
}

/**
 * What each knob may reach, for the demo's sliders and the registry guard.
 * The two rate knobs are signed because a pull and a push are one term at two
 * signs, and so are the two rotations.
 */
export const ANALYTIC_RANGES: Readonly<Record<AnalyticKnob, readonly [number, number]>> = {
  radial: [-1.5, 1.5],
  falloff: [0, 8],
  swirl: [-2, 2],
  twist: [-2, 2],
}

/**
 * How far the canvas corner is from its centre, in field uv. The field is
 * square and covers the canvas with the overflow cropped, exactly as the
 * fluid's does, so one field width is one canvas width on both axes and a
 * circle drawn in field uv is a circle on the canvas whatever its shape.
 * That is the whole of the aspect handling: every term below works in field
 * uv and needs no aspect of its own, and this one number turns a radius into
 * "how far toward the corner", which is the same fraction on a wide canvas
 * and a tall one.
 */
export const referenceRadius = (extent: Extent): number => Math.hypot(extent.x, extent.y)

/** Canvas uv to field uv, which is `Flow.cover` applied; see `scenes/Scene.ts`. */
export const fieldCover = (extent: Extent): readonly [number, number] => [
  extent.x * 2,
  extent.y * 2,
]

/**
 * The largest the raw radial shape `t x exp(-falloff x t)` reaches inside the
 * canvas, so the profile below can be divided by it. Dividing means `radial`
 * is the speed at the peak whatever the shape is, rather than a number whose
 * meaning slides as the shape moves, which matters because a study drives the
 * two from different rows.
 */
export const radialPeak = (falloff: number): number => {
  const f = Math.max(falloff, 0)
  // Below 1 the shape is still climbing at the corner, so the peak is there.
  return f > 1 ? 1 / (f * Math.E) : Math.exp(-f)
}

/**
 * The radial term's shape, 0 at the centre and at most 1 inside the canvas.
 * `t` is the distance from the centre as a fraction of `reference`, so 1 is
 * the corner.
 *
 * At `falloff` 0 it is `t` itself: speed proportional to radius, which is a
 * plain zoom about the middle, everything converging at one rate and nothing
 * distorting. That is what an implosion wants. Above 1 the peak moves in to
 * `1 / falloff` of the way out and the rim is left alone, which is what a
 * burst out of the middle wants. The factor of `t` at the front is also what
 * takes the velocity to zero at the exact centre, so there is no point where
 * the direction jumps.
 */
export const radialProfile = (t: number, falloff: number): number => {
  const f = Math.max(falloff, 0)
  const at = Math.max(t, 0)
  return (at * Math.exp(-f * at)) / radialPeak(f)
}

/**
 * One frame of the field. `presence` scales every coefficient and nothing
 * else: a flow arriving at a third is a third of the velocity, and at 0 the
 * field is still and `fieldMoves` says so. `falloff` is a shape rather than a
 * strength, so it is left alone; a shape faded toward zero would turn a burst
 * into a zoom on the way in.
 */
export function analyticField(tuning: Tuning, presence: number, extent: Extent): AnalyticField {
  const at = (knob: AnalyticKnob) => tuning[knob] ?? ANALYTIC_DEFAULTS[knob]
  const held = Math.max(presence, 0)
  return {
    radial: at('radial') * held,
    falloff: Math.max(at('falloff'), 0),
    swirl: at('swirl') * held,
    twist: at('twist') * held,
    centre: [0.5, 0.5],
    reference: Math.max(referenceRadius(extent), 1e-4),
  }
}

/**
 * Whether the field carries anything at all. Every coefficient at zero is a
 * still field, and a still field is worth nothing to the feedback pass, so
 * the flow encodes no pass and offers nothing rather than binding a texture
 * of zeros. Implode at a tension of zero is exactly this case.
 */
export const fieldMoves = (field: AnalyticField): boolean =>
  field.radial !== 0 || field.swirl !== 0 || field.twist !== 0

/**
 * The velocity at a point of the field, in field widths a second, which is
 * the same thing the fluid's velocity texture holds and the same thing
 * `post.feedback.wgsl` divides by `cover` to read the last frame back.
 *
 * `point` is in field uv, y down, because a texture is. Positive `swirl` and
 * `twist` therefore turn the picture clockwise on screen.
 *
 * `shaders/analytic.field.wgsl` is a line-for-line transcription of this.
 */
export function analyticVelocity(
  field: AnalyticField,
  point: readonly [number, number],
): [number, number] {
  const dx = point[0] - field.centre[0]
  const dy = point[1] - field.centre[1]
  const r = Math.hypot(dx, dy)
  const t = r / field.reference
  // Guarded rather than branched, to match the shader: at the centre the
  // radial profile is zero and the rotation is multiplied by a zero radius,
  // so whatever direction this gives is multiplied away.
  const unit = Math.max(r, 1e-5)
  const ux = dx / unit
  const uy = dy / unit

  const speed = field.radial * radialProfile(t, field.falloff)
  // Solid-body swirl plus the part that is only near the middle. An angular
  // speed times the radius is a speed along the tangent, which is the perp
  // of the outward unit vector.
  const omega = TWO_PI * (field.swirl + field.twist * Math.max(1 - t, 0))
  return [speed * ux - omega * r * uy, speed * uy + omega * r * ux]
}

/**
 * The uniform, one vec4 per term family so a term added later appends a vec4
 * and moves nothing. The `Field` struct in `shaders/analytic.field.wgsl` is
 * this layout; every vec4 is 16-byte aligned by construction, so the struct
 * needs no padding of its own.
 *
 *   0..3   radial: speed, falloff, spare, spare
 *   4..7   rotate: swirl, twist, spare, spare
 *   8..11  frame:  centre x, centre y, reference radius, spare
 */
export function writeAnalyticUniform(field: AnalyticField, out: Float32Array): Float32Array {
  out[0] = field.radial
  out[1] = field.falloff
  out[2] = 0
  out[3] = 0

  out[4] = field.swirl
  out[5] = field.twist
  out[6] = 0
  out[7] = 0

  out[8] = field.centre[0]
  out[9] = field.centre[1]
  out[10] = field.reference
  out[11] = 0
  return out
}
