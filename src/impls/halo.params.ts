/**
 * The halo's numbers: the falloff itself, mirrored here so the parts that
 * decide what the picture looks like can be tested without a browser, and the
 * uniform the shader reads it from, which is finished by the time it leaves
 * this file. Pure TypeScript with no GPU objects, the way `dust.params.ts` is.
 *
 * One glow about the middle of the canvas, drawn as a single quad sized to it.
 * The quad is square in pixels and the light is a function of the distance in
 * pixels from its middle, so the glow is round on a wide canvas and on a tall
 * one, and `radius` is a fraction of the short side, so it is the same size
 * relative to the picture on either. The light is exactly zero at the radius
 * and beyond it, which is what lets the quad be no bigger than the glow and
 * leaves no edge to see.
 *
 * The falloff is a smoothstep raised to a power. Take `u`, 1 at the peak and 0
 * at the edge (and, for a ring, at the middle too):
 *
 *   light = smoothstep(u) ^ exponent
 *
 * A smoothstep has no slope at either end, so the peak is round and the edge
 * arrives without a crease. `softness` is the exponent: at 1 it is 1 and the
 * shoulders are broad, and at 0 it is `MAX_EXPONENT`, which pulls the light in
 * to a tight core and leaves the same radius. The edge stays exactly zero at
 * every softness.
 *
 * `hollow` moves the peak out from the middle, to that fraction of the radius.
 * Inside it the light falls away toward the centre by `dip`, which grows with
 * the hollow until at `OPEN` and above the middle is dark and the glow is a
 * ring. Below that the middle is dimmed and not emptied, so a small hollow
 * reads as a soft disc with a shoulder rather than a disc with a pinhole in it,
 * and the whole thing is continuous in `hollow`. The peak of the profile is 1
 * wherever it sits.
 *
 * How much light, in numbers, is the point of this file, because the halo sits
 * where the canvas piles light up. It is at the middle of a canvas whose flows
 * mostly pull toward that point or push away from it, so a fixed glow there
 * adds to what the flow has carried in. The canvas keeps `FEEDBACK_KEEP` of
 * itself a frame, so a still image sums to `SETTLE`, about fourteen times what
 * one frame adds. The glow does not move, so the middle of it does settle to
 * that: `SETTLE x intensity`, and `settledPeak` says it. A flow only takes light
 * away from the middle (the velocity is zero there, so what it carries in
 * comes from further out and is dimmer), so the still sum is the most the
 * middle can reach. The feedback pass bends light only above half its ceiling,
 * and a cast the director builds holds a ceiling of `CEILING_AT_FULL_PACKET` at
 * a full packet, so a middle that settles under `KNEE` is never bent, and cannot
 * clip toward a flat white disc. `HALO_INTENSITY_MAX` is the intensity at which
 * a still image reaches exactly that, and is the top of the range, so nothing a
 * study writes can settle over the knee at a full packet.
 *
 * The halo has no clock and no state. Everything it draws is a function of its
 * knobs and the packet's key, so there is nothing per frame to keep at a frame
 * rate, and the canvas's own per-second feedback is what holds the brightness.
 */
import { ribbonColour } from '../post/params'
import type { HaloKnob } from '../studies/impls'
import { SETTLE } from './caustics.params'

export { FEEDBACK_KEEP, SETTLE } from './caustics.params'

/** Floats in the uniform; the shader's `Params` struct reads them in this order. */
export const HALO_UNIFORM_FLOATS = 12

/**
 * What a director-built canvas holds its ceiling at when the music is full: the
 * canvas rests at 1.8 and `energy`, `swell` and `hardness` each take a square
 * of their own off it, 0.25, 0.15 and 0.15. `halo.test.ts` reads it back from
 * that canvas, so a change there fails there and not silently here.
 */
export const CEILING_AT_FULL_PACKET = 1.25

/** Where the feedback pass starts bending light: half its ceiling. */
export const KNEE = CEILING_AT_FULL_PACKET / 2

/** The light added on one frame at which a still image settles at `KNEE`. */
export const HALO_INTENSITY_MAX = KNEE / SETTLE

/**
 * What each knob may reach, inclusive. The registry guard holds every study to
 * these at silence and at a full packet, and `haloParams` clamps to them.
 */
export const HALO_RANGES: Record<HaloKnob, readonly [number, number]> = {
  // A fraction of the short side, so it is the same share of the picture on a
  // wide canvas and a tall one. At 0 there is no glow to draw.
  radius: [0, 0.7],
  // Where the peak sits, as a fraction of the radius. It stops short of 1 so
  // the outer side keeps room to fall.
  hollow: [0, 0.9],
  // 0 is a tight core and 1 is broad shoulders.
  softness: [0, 1],
  // Light added on one frame at the peak. See the header for the top.
  intensity: [0, HALO_INTENSITY_MAX],
  // Palette units added to the key, as the other inks' spread is.
  hue: [-0.5, 0.5],
}

export type HaloParams = Record<HaloKnob, number>

const KNOBS = Object.keys(HALO_RANGES) as HaloKnob[]

/**
 * What a knob a study did not resolve falls to. The two that draw fall to
 * nothing; the shape numbers and the hue fall somewhere that does no harm.
 */
const FALLBACK: HaloParams = { radius: 0, hollow: 0, softness: 0.5, intensity: 0, hue: 0 }

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** The knobs a study resolved, clamped to their ranges; a missing or non-finite one takes its fallback. */
export function haloParams(knobs: Readonly<Partial<Record<string, number>>>): HaloParams {
  const out: HaloParams = { ...FALLBACK }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = HALO_RANGES[knob]
    out[knob] = clamp(
      value !== undefined && Number.isFinite(value) ? value : FALLBACK[knob],
      low,
      high,
    )
  }

  return out
}

/**
 * Whether anything is drawn this frame. No radius or no light means no pass
 * and no upload, which is what a silent packet resolves to: the radius is what
 * the energy brings in, so it is 0 at silence whatever tension says.
 */
export const haloLit = (params: HaloParams) => params.radius > 0 && params.intensity > 0

/** The exponent at a softness of 0, where the core is tightest. */
export const MAX_EXPONENT = 4

/** The hollow at and above which the middle is dark and the glow is a ring. */
export const OPEN = 0.5

/** The exponent `softness` sets: 1 at 1 and `MAX_EXPONENT` at 0. */
export const exponentOf = (softness: number) => 1 + (MAX_EXPONENT - 1) * (1 - softness)

/** How far the middle is dimmed for this hollow, 0 for none and 1 for dark. */
export const dipOf = (hollow: number) => Math.min(hollow / OPEN, 1)

/**
 * The light at a distance from the middle, 0 to 1, where `distance` is a
 * fraction of the radius. This is the shader's `fs` line for line, and what
 * the tests measure. Exactly 0 at 1 and beyond, for every hollow and softness.
 */
export function haloLight(distance: number, hollow: number, softness: number): number {
  if (!(distance < 1)) return 0
  const d = Math.max(distance, 0)
  const rise = 1 - dipOf(hollow) * (1 - d / hollow)
  const fall = (1 - d) / (1 - hollow)
  const u = clamp(d < hollow ? rise : fall, 0, 1)
  const smooth = u * u * (3 - 2 * u)
  return smooth > 0 ? Math.pow(smooth, exponentOf(softness)) : 0
}

/** The canvas's light from the halo at one pixel, on one frame's worth of it, before the intensity. */
export function haloAt(x: number, y: number, params: HaloParams, width: number, height: number) {
  const radius = params.radius * Math.min(width, height)
  if (!(radius > 0)) return 0
  return haloLight(
    Math.hypot(x - width / 2, y - height / 2) / radius,
    params.hollow,
    params.softness,
  )
}

/**
 * The quad the halo is drawn on: its middle and half its side, in pixels. It
 * is square, which is what makes the glow round, and it is exactly as big as
 * the glow, so nothing is drawn that the falloff has not already zeroed.
 */
export function haloQuad(params: HaloParams, width: number, height: number) {
  return { x: width / 2, y: height / 2, half: params.radius * Math.min(width, height) }
}

/**
 * What a still image of this halo settles to at its brightest point: the sum
 * of what one frame adds over every frame the canvas keeps. The peak of the
 * falloff is 1 wherever `hollow` puts it, so this is `SETTLE x intensity`.
 */
export const settledPeak = (params: HaloParams) => SETTLE * params.intensity

/** A pixel counts as lit, for coverage, when its light passes this share of the peak. */
export const LIT_THRESHOLD = 0.05

/**
 * The share of a frame the halo lights, on a canvas this shape: the pixels
 * brighter than `LIT_THRESHOLD` of the peak, counted on a grid. It is the
 * ink's own coverage and not the canvas's, which the trails then smear.
 */
export function haloCoverage(params: HaloParams, aspect = 16 / 9, rows = 90): number {
  const columns = Math.round(rows * aspect)
  let lit = 0
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1)
      if (haloAt(column + 0.5, row + 0.5, params, columns, rows) > LIT_THRESHOLD) lit += 1
  return lit / (columns * rows)
}

/**
 * The uniform the shader reads, in floats:
 *
 *   0 to 3   canvas width and height in pixels, the radius in pixels, a pad
 *   4 to 7   the peak's place, the dip at the middle, the exponent, a pad
 *   8 to 11  light in rgb, already times the intensity, a pad
 *
 * The colour is the ribbon's palette at the key, offset by `hue`, so the halo
 * sits with the ribbon and not beside it.
 */
export function writeHaloUniform(
  params: HaloParams,
  features: Float32Array,
  width: number,
  height: number,
  out: Float32Array,
): Float32Array {
  const quad = haloQuad(params, width, height)
  out[0] = width
  out[1] = height
  out[2] = quad.half
  out[3] = 0
  out[4] = params.hollow
  out[5] = dipOf(params.hollow)
  out[6] = exponentOf(params.softness)
  out[7] = 0
  const [red, green, blue] = ribbonColour(features, params.hue)
  out[8] = red * params.intensity
  out[9] = green * params.intensity
  out[10] = blue * params.intensity
  out[11] = 0
  return out
}
