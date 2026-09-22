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
 * Four terms exist so far. `radial` runs along the line to the centre,
 * `swirl` and `twist` run around it, `curl` is a drifting noise that folds
 * the picture over on itself without gathering or thinning it, and `lens` is
 * the pull of a black hole, which is `radial` with a sign that turns over at
 * a radius of its own. Adding another (shear bands, lattice, ripple, drip) is
 * three things and no more:
 *
 *   1. its coefficient in `ANALYTIC_KNOBS` (`presets/knobs.ts`) and a range
 *      in `ANALYTIC_RANGES` below,
 *   2. a field of `AnalyticField`, read in `analyticField` and written into a
 *      vec4 of its own by `writeAnalyticUniform`, appended AFTER the vec4s
 *      that are already there so nothing existing moves. A term that moves
 *      by itself takes its clock in through `analyticField`'s last argument
 *      and never from `Date.now`, as `curl` does,
 *   3. the same few lines in `analyticVelocity` and, transcribed, in
 *      `shaders/analytic.field.wgsl`.
 *
 * Every velocity is per second and nothing here accumulates, which is what
 * makes the flow read the same at any frame rate: the feedback pass is handed
 * a rate and multiplies by the real step. The one thing that does accumulate
 * is the curl term's clock, and that is the implementation's, advanced by the
 * real step, so the same seconds of music make the same pattern at any rate.
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
export const ANALYTIC_UNIFORM_FLOATS = 20

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
  /** Field widths a second at the fastest a point of the noise can go. */
  curl: number
  /** Cells across the field's width, which is the canvas's longer side. */
  curlScale: number
  /** Where the pattern is in its evolution, in turns, wrapped at `CURL_PERIOD`. */
  curlClock: number
  /** Field widths a second at the fastest the black hole's pull ever gets. */
  lens: number
  /** Where the pull turns over, as a fraction of `reference`. Never zero. */
  photon: number
}

/** Resting values for anything no live study named, as `fluidParams` has. */
export const ANALYTIC_DEFAULTS: Readonly<Record<AnalyticKnob, number>> = {
  radial: 0,
  falloff: 0,
  swirl: 0,
  twist: 0,
  curl: 0,
  curlScale: 3.5,
  curlRate: 0.05,
  lens: 0,
  photon: 0.18,
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
  // A speed and never a direction: the sign of a noise is nothing.
  curl: [0, 0.4],
  // The top is what the grid can hold: see `CURL_OCTAVES`.
  curlScale: [0.5, 8],
  // Turns a second of the slowest wave; the fastest turns at 3.25 times it.
  curlRate: [0, 0.25],
  // A pull and never a push: the sign of this term is the profile's, which
  // turns over at the photon radius on its own. The top is `radial`'s, since
  // a field width a second carries the whole picture off the edge in about one.
  lens: [0, 1.2],
  // A shape, and never zero: at nothing there is no inside for the escape
  // half of the profile to live in. The top keeps the dark middle well
  // inside the frame on any canvas.
  photon: [0.02, 0.45],
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
 * The most the raw lens shape `s^2 (1 - s)` reaches, at `s = 2/3`. The
 * profile is divided by it for `radialPeak`'s reason: `lens` then means the
 * fastest the pull ever gets, whatever `photon` is doing, so a study driving
 * the two from different rows does not find each row changing what the other
 * means.
 */
export const LENS_PEAK = 4 / 27

/**
 * How hard the field pushes out inside the photon radius, as a share of
 * `lens`. It is small because the escape is not the effect: the effect is
 * that nothing draws toward the middle, so what lands there is carried away
 * and the disc stays dark. A push this size clears a pixel out of the middle
 * over a second or so, where a pull of any size would gather the picture
 * there into a bright dot, which is the one thing a black hole must not look
 * like.
 */
export const LENS_ESCAPE = 0.25

/**
 * The lens term's shape: the speed along the outward ray, signed, as a
 * multiple of `lens`. `t` is the distance from the centre as a fraction of
 * `reference`, so 1 is the corner, and `photon` is where the sign turns over
 * in the same units.
 *
 * Outside the photon radius it is negative, which is inward. Its magnitude is
 * `s^2 (1 - s)` with `s = photon / t`, so far from the hole it falls off with
 * the square of the distance, as a pull does, and it goes to exactly zero at
 * the photon radius rather than stepping to its peak there. The peak sits at
 * `t = 1.5 x photon`, which is the ring of piled-up light the ink draws over.
 *
 * Inside it is positive, which is outward, and it is zero at both ends: at
 * the exact centre, so there is no point where the direction jumps, and again
 * at the photon radius, so the whole profile is continuous across it. That is
 * what makes the middle dark. Nothing draws toward it, and the little that
 * lands there is swept back out to the ring.
 */
export function lensProfile(t: number, photon: number): number {
  const p = Math.max(photon, 1e-4)
  const at = Math.max(t, 0)
  if (at < p) {
    // A parabola that is 0 at the centre, `LENS_ESCAPE` half way out and 0
    // again at the photon radius, which is what keeps the two halves joined.
    const u = at / p
    return LENS_ESCAPE * 4 * u * (1 - u)
  }

  const s = p / at
  return -(s * s * (1 - s)) / LENS_PEAK
}

/**
 * The curl term's noise is the curl of a scalar potential, which is why it
 * cannot pile the picture up or thin it out: the divergence of a curl is zero
 * for any potential at all, so nothing chosen below can break it, and a test
 * takes the divergence by finite differences to hold it to that.
 *
 * The potential is a few octaves of sines and the curl is taken by hand, so
 * the shader evaluates it exactly at every texel with no noise texture to
 * fetch, no lattice to hash and no finite difference to pay for. Value noise
 * would look the same for a table, a hash and a few fetches an octave. The
 * price of sines is that each octave is a regular lattice of eddies, and the
 * rotations below are what stops the three from lining up.
 *
 * One octave's potential is `w/k sin(u) sin(v)`, with `u` and `v` the two
 * coordinates of the field turned by the octave's own angle and scaled by `k`.
 * That is a checkerboard of eddies whose cells are `pi / k` on a side, so the
 * base octave's `k` is `pi x curlScale` and `curlScale` is cells across the
 * field. The field is square and `fieldCover` crops it to the canvas with one
 * field width equal to the canvas's longer side, so a cell is as wide as it
 * is tall on a wide canvas and on a tall one, and no aspect is needed here.
 *
 * The curl of that works out to two plane waves, one along each diagonal of
 * the octave's frame, each pushing perpendicular to itself, and that is two
 * sines an octave rather than four. With the octave's axis
 * `(e, f) = (cos - sin, cos + sin)` of its angle and `A`, `B` the sines of its
 * two waves:
 *
 *     velocity = w / 2 x ( A (f, -e) + B (e, f) )
 *
 * The weights sum to 1 and a point of one octave never goes faster than that
 * octave's weight, so `curl` is a ceiling on the speed of every point and not
 * a typical one: the RMS speed is about 0.46 of it, at every scale.
 *
 * The angles are 0, 60 and 120 degrees, which puts the six waves 30 degrees
 * apart, and the two waves of an octave are at right angles, so every octave
 * varies as fast along the canvas's x as along its y. No octave is finer than
 * four times the base and the base stops at 8, because 128 texels across the
 * field at that top is under six texels to the finest wavelength, which linear
 * filtering carries with some amplitude shaved off an octave that holds 15
 * percent of the weight.
 *
 * `turns` say how many turns of phase each wave makes per turn of the clock,
 * `curlRate` being the turns of the clock a second. All six are different in
 * size and they differ in sign, so no two waves keep step: the pattern boils
 * and morphs rather than sliding whole, and octaves do not lock together. They
 * are sixteenths, which puts the pattern's repeat at 16 turns of the clock,
 * 320 seconds at the resting rate, and lets the clock wrap there without a
 * jump. Whole numbers would have repeated it every turn, which is every
 * 1 / `curlRate` seconds, and 20 of them is a loop somebody could count. The
 * offsets mean nothing; they only keep the centre of the canvas from being
 * where every wave starts at zero.
 */
export const CURL_OCTAVES = [
  { scale: 1, weight: 0.55, axis: [1, 1], offset: [1.3, 4.1], turns: [1, -1.3125] },
  {
    scale: 2,
    weight: 0.3,
    axis: [-0.3660254037844386, 1.3660254037844386],
    offset: [2.7, 0.4],
    turns: [-1.8125, 2.3125],
  },
  {
    scale: 4,
    weight: 0.15,
    axis: [-1.3660254037844386, 0.3660254037844386],
    offset: [5.2, 3.3],
    turns: [2.8125, -3.25],
  },
] as const

/**
 * Turns of the clock before it wraps, which is where the pattern repeats: every
 * `turns` above is a whole number of sixteenths, so each phase is back where
 * it started after 16. Wrapping there also keeps the clock small enough for a
 * 32 bit float to resolve a step. The shader multiplies it by up to 3.25, and
 * a product near 52 is 4e-6 of a turn from its neighbour, against about 3e-4
 * for one frame at 144 a second and the resting rate. Left to grow through a
 * day of playing the clock would be coarser than the step itself.
 */
export const CURL_PERIOD = 16

/**
 * The clock a frame later. It is the implementation's to hold, and its one
 * rule is that turns are `curlRate` times the real step: the same seconds
 * make the same pattern at any frame rate, and because it adds up the rate
 * rather than multiplying the total time by it, a study moving `curlRate`
 * with the music never makes the pattern jump.
 */
export function advanceCurlClock(clock: number, tuning: Tuning, dt: number): number {
  const rate = Math.max(tuning.curlRate ?? ANALYTIC_DEFAULTS.curlRate, 0)
  const next = clock + rate * Math.max(dt, 0)
  if (!Number.isFinite(next)) return clock
  return next - Math.floor(next / CURL_PERIOD) * CURL_PERIOD
}

const fract = (x: number) => x - Math.floor(x)

/** The arguments of one octave's two sines. */
function curlWaves(
  octave: (typeof CURL_OCTAVES)[number],
  field: AnalyticField,
  point: readonly [number, number],
): [number, number] {
  const k = Math.PI * field.curlScale * octave.scale
  const [e, f] = octave.axis
  const a =
    k * (e * point[0] + f * point[1]) +
    octave.offset[0] +
    TWO_PI * fract(octave.turns[0] * field.curlClock)
  const b =
    k * (f * point[0] - e * point[1]) +
    octave.offset[1] +
    TWO_PI * fract(octave.turns[1] * field.curlClock)
  return [a, b]
}

/**
 * The scalar the curl term is the curl of, with `curl` left out. The shader
 * never computes it, since only its derivatives matter there. It is here so a
 * test can differentiate it numerically and hold the velocity to that, which
 * is the proof that the by-hand derivative above is the right one.
 */
export function curlPotential(field: AnalyticField, point: readonly [number, number]): number {
  let sum = 0
  for (const octave of CURL_OCTAVES) {
    const [a, b] = curlWaves(octave, field, point)
    const k = Math.PI * field.curlScale * octave.scale
    sum += (octave.weight / (2 * k)) * (Math.cos(b) - Math.cos(a))
  }
  return sum
}

/** The curl term's velocity, `curl` in it. No sines are taken when `curl` is 0. */
function curlVelocity(field: AnalyticField, point: readonly [number, number]): [number, number] {
  if (field.curl === 0) return [0, 0]
  let vx = 0
  let vy = 0
  for (const octave of CURL_OCTAVES) {
    const [a, b] = curlWaves(octave, field, point)
    const [e, f] = octave.axis
    const half = octave.weight * 0.5
    const sinA = Math.sin(a)
    const sinB = Math.sin(b)
    vx += half * (sinA * f + sinB * e)
    vy += half * (-sinA * e + sinB * f)
  }
  return [vx * field.curl, vy * field.curl]
}

/**
 * One frame of the field. `presence` scales every coefficient and nothing
 * else: a flow arriving at a third is a third of the velocity, and at 0 the
 * field is still and `fieldMoves` says so. `falloff` is a shape rather than a
 * strength, so it is left alone; a shape faded toward zero would turn a burst
 * into a zoom on the way in. `curlScale` is a shape as well, and is held
 * inside the range the grid can carry because a host's override does not
 * pass through a slider. `clock` is the curl term's own, which the
 * implementation advances with `advanceCurlClock`.
 */
export function analyticField(
  tuning: Tuning,
  presence: number,
  extent: Extent,
  clock = 0,
): AnalyticField {
  const at = (knob: AnalyticKnob) => tuning[knob] ?? ANALYTIC_DEFAULTS[knob]
  const held = Math.max(presence, 0)
  const [lowest, highest] = ANALYTIC_RANGES.curlScale
  const [photonLowest, photonHighest] = ANALYTIC_RANGES.photon
  return {
    radial: at('radial') * held,
    falloff: Math.max(at('falloff'), 0),
    swirl: at('swirl') * held,
    twist: at('twist') * held,
    centre: [0.5, 0.5],
    reference: Math.max(referenceRadius(extent), 1e-4),
    curl: at('curl') * held,
    curlScale: Math.min(Math.max(at('curlScale'), lowest), highest),
    curlClock: clock,
    lens: at('lens') * held,
    // A shape, like `falloff` and `curlScale`, so presence leaves it where it
    // is: a photon radius faded toward zero would shrink the dark middle away
    // as the study arrived rather than fading the pull.
    photon: Math.min(Math.max(at('photon'), photonLowest), photonHighest),
  }
}

/**
 * Whether the field carries anything at all. Every coefficient at zero is a
 * still field, and a still field is worth nothing to the feedback pass, so
 * the flow encodes no pass and offers nothing rather than binding a texture
 * of zeros. Implode at a tension of zero is exactly this case.
 */
export const fieldMoves = (field: AnalyticField): boolean =>
  field.radial !== 0 ||
  field.swirl !== 0 ||
  field.twist !== 0 ||
  field.curl !== 0 ||
  field.lens !== 0

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

  // Both radial terms are a speed along the same ray, so they add. The lens
  // carries its own sign: the profile turns over at the photon radius.
  const speed =
    field.radial * radialProfile(t, field.falloff) + field.lens * lensProfile(t, field.photon)
  // Solid-body swirl plus the part that is only near the middle. An angular
  // speed times the radius is a speed along the tangent, which is the perp
  // of the outward unit vector.
  const omega = TWO_PI * (field.swirl + field.twist * Math.max(1 - t, 0))
  const noise = curlVelocity(field, point)
  return [speed * ux - omega * r * uy + noise[0], speed * uy + omega * r * ux + noise[1]]
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
 *   12..15 curl:   speed, cells across, clock in turns, spare
 *   16..19 lens:   pull at its fastest, the photon radius, spare, spare
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

  out[12] = field.curl
  out[13] = field.curlScale
  out[14] = field.curlClock
  out[15] = 0

  out[16] = field.lens
  out[17] = field.photon
  out[18] = 0
  out[19] = 0
  return out
}
