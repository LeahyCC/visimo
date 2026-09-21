/**
 * The lasers' numbers: where the fans stand, how wide they open, how much
 * light one beam carries, worked out on the CPU and handed to the shader as a
 * finished uniform. Pure TypeScript with no GPU objects, the way
 * `halo.params.ts` is, so the parts that decide what the picture looks like
 * can be tested without a browser.
 *
 * A fan is a point just off the top or the bottom edge and a spread of thin
 * beams about a base direction that points straight into the frame. Origins
 * alternate between the two edges and stand evenly along the x axis, so
 * neighbouring fans lean across each other. The fan swings with the beat:
 * the swing angle is `sweep x (|beatPhase - 0.5| - 0.5)`, read from the
 * packet, so every fan is centred on the predicted beat, sweeps to one side
 * and back inside the beat, and even and odd fans sweep opposite ways.
 *
 * The beams of a fan fan out evenly across `spread` radians. At a spread of 0
 * every beam coincides and the fan is a single beam, which is the whole of
 * what tension does: it closes the fans one by one until each is one beam,
 * and `impact` throws them wide open again.
 *
 * A beam's light against the distance from its line is the rings' line shape:
 * full light across the core, a smoothstep down across the glow, exactly zero
 * past it. Beams sum, so crossings are brighter, which is what a haze full of
 * lasers looks like.
 *
 * There is no clock and no state. What is drawn is the knobs, the key and the
 * packet's beat phase and treble pulse, so the same song at any frame rate
 * draws the same frame: nothing here is added up per frame. `flick` rides the
 * packet's own treble pulse, which decays per second.
 *
 * How much light is bounded by the gate and the wash-out rows, the way the
 * halo's is: the tempo confidence carries the silence gate (`tempoConfidence`
 * through `invert`, so a track with no steady beat dims out rather than
 * sweeping at a wrong tempo), and `energy`, `swell` and `hardness` pull the
 * intensity back as the frame fills. A crossing adds at most a few beams at
 * one pixel and the beams move, so nothing settles the way a still glow does.
 */
import { F } from '../audio/FeatureExtractor'
import { ribbonColour } from '../post/params'
import type { LaserKnob } from '../studies/impls'
import { ringLight, ringReach } from './rings.params'

export { FEEDBACK_KEEP, SETTLE } from './caustics.params'

/** Floats in the uniform; the shader's `Params` struct reads them in this order. */
export const LASER_UNIFORM_FLOATS = 16

/** Fans the shader loops over at most; the range below holds `fans` to it. */
export const MAX_FANS = 6

/** Beams a fan loops over at most; the range below holds `beams` to it. */
export const MAX_BEAMS = 8

/** The canvas height a `width` and `glow` are written against, the same the rings' are. */
const REFERENCE_HEIGHT = 1080

/**
 * How far past the edge a fan's origin sits, as a fraction of the short side.
 * Small: the fan reads as thrown from the rig above (or below) the frame, and
 * the beams are full length by the time they enter it.
 */
export const ORIGIN_MARGIN = 0.02

/** How much extra light the flicked beam carries at `flick` 1. */
export const FLICK_GAIN = 2

/**
 * What each knob may reach, inclusive. The params clamp to them, and the
 * coverage test in `lasers.test.ts` holds the worst of them under the sparse
 * bar.
 */
export const LASER_RANGES: Record<LaserKnob, readonly [number, number]> = {
  // Fans along the edges, at least one: a count, and half a fan is nothing.
  fans: [1, MAX_FANS],
  // Beams in a fan, at least one, which is what tension closes the fan to.
  beams: [1, MAX_BEAMS],
  // The fan's opening in radians. 0 is a single beam.
  spread: [0, 1.2],
  // The swing amplitude in radians; the beat clock drives the position.
  sweep: [0, 0.8],
  // The beam core's half width in pixels at the reference height.
  width: [0.4, 2],
  // The soft edge on each side of the core, in pixels at the reference height.
  glow: [0.3, 2],
  // Light one beam adds at its core, before crossings sum.
  intensity: [0, 1],
  // How much one beam answers the treble, 0 to 1.
  flick: [0, 1],
  // Palette units added to the key, as the other inks' spread is.
  hue: [-0.5, 0.5],
}

export type LaserParams = Record<LaserKnob, number>

const KNOBS = Object.keys(LASER_RANGES) as LaserKnob[]

/**
 * What a knob a study did not resolve falls to. The light falls to nothing;
 * the shape numbers fall somewhere that draws nothing harmful.
 */
const FALLBACK: LaserParams = {
  fans: 1,
  beams: 1,
  spread: 0,
  sweep: 0,
  width: 0.5,
  glow: 1,
  intensity: 0,
  flick: 0,
  hue: 0,
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** The knobs a study resolved, clamped to their ranges; a missing or non-finite one takes its fallback. */
export function laserParams(knobs: Readonly<Partial<Record<string, number>>>): LaserParams {
  const out: LaserParams = { ...FALLBACK }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = LASER_RANGES[knob]
    out[knob] = clamp(
      value !== undefined && Number.isFinite(value) ? value : FALLBACK[knob],
      low,
      high,
    )
  }

  return out
}

/**
 * Whether anything is drawn this frame. The intensity carries the gate: it is
 * the tempo confidence's row that takes it to 0 on a silent packet, so no
 * light means no pass and no upload.
 */
export const lasersLit = (params: LaserParams) => params.intensity > 0

/** The beam core's half width in pixels on this canvas, which is what makes it survive a 4K one. */
export const laserWidthPixels = (width: number, canvasWidth: number, canvasHeight: number) =>
  width * (Math.min(canvasWidth, canvasHeight) / REFERENCE_HEIGHT)

/** The soft edge on each side of the core, in pixels on this canvas. */
export const laserGlowPixels = (glow: number, canvasWidth: number, canvasHeight: number) =>
  glow * (Math.min(canvasWidth, canvasHeight) / REFERENCE_HEIGHT)

/**
 * A beam's light at `distance` pixels from its line, 0 to 1: the rings' line
 * shape at twice the core width, so the light is full across the core and
 * falls across the glow to exactly zero. Kept as the one function so the
 * coverage arithmetic and the shader agree with the rings by construction.
 */
export const laserBeamLight = (distance: number, width: number, glow: number) =>
  ringLight(distance, 2 * width, glow)

/** How far a beam's light reaches from its line, in pixels: past it nothing is drawn. */
export const laserBeamReach = (width: number, glow: number) => ringReach(2 * width, glow)

/**
 * The fan a beam belongs to: its origin and direction. `top` fans hang just
 * off the top edge and point down, bottom fans the mirror of them. `angle` is
 * the swing plus the beam's place in the spread, 0 straight into the frame.
 */
export type LaserBeam = {
  originX: number
  originY: number
  dirX: number
  dirY: number
  /** Whether this is the beam the treble answers this beat. */
  flicked: boolean
}

/**
 * The beam `which` of fan `fan`, with its origin and direction. The swing is
 * `sweep x (|beatPhase - 0.5| - 0.5)` and even fans run it backwards, so
 * every fan is centred on the beat and sweeps out and back inside it, and
 * neighbours cross on their way. The spread lays the fan's beams evenly
 * across `spread` radians, so at 0 they coincide.
 */
export function laserBeam(
  params: LaserParams,
  beatPhase: number,
  fan: number,
  which: number,
  canvasWidth: number,
  canvasHeight: number,
): LaserBeam {
  const top = fan % 2 === 0
  const margin = ORIGIN_MARGIN * Math.min(canvasWidth, canvasHeight)
  const originX = ((fan + 0.5) / params.fans) * canvasWidth
  const originY = top ? -margin : canvasHeight + margin
  const swing = params.sweep * (Math.abs(beatPhase - 0.5) - 0.5) * (top ? 1 : -1)
  const taper = params.beams === 1 ? 0.5 : which / (params.beams - 1)
  const angle = swing + (taper - 0.5) * params.spread
  const sin = Math.sin(angle)
  const cos = Math.cos(angle)
  const flicked = which === (fan + Math.floor(beatPhase * params.beams)) % params.beams
  return { originX, originY, dirX: sin, dirY: top ? cos : -cos, flicked }
}

/** Every beam of every fan this frame, in draw order. */
export function laserBeams(
  params: LaserParams,
  beatPhase: number,
  canvasWidth: number,
  canvasHeight: number,
): LaserBeam[] {
  const out: LaserBeam[] = []
  const fans = Math.min(Math.round(params.fans), MAX_FANS)
  const beams = Math.min(Math.round(params.beams), MAX_BEAMS)
  for (let fan = 0; fan < fans; fan += 1)
    for (let which = 0; which < beams; which += 1)
      out.push(laserBeam(params, beatPhase, fan, which, canvasWidth, canvasHeight))

  return out
}

/**
 * The light every beam adds at one pixel, before the intensity: the sum of
 * the falloffs, so crossings are brighter. A pixel behind a fan's origin gets
 * nothing from it. This is the shader's `fs` loop, and what the tests measure.
 */
export function lasersAt(
  x: number,
  y: number,
  params: LaserParams,
  beatPhase: number,
  canvasWidth: number,
  canvasHeight: number,
): number {
  if (!lasersLit(params)) return 0
  const width = laserWidthPixels(params.width, canvasWidth, canvasHeight)
  const glow = laserGlowPixels(params.glow, canvasWidth, canvasHeight)
  let light = 0
  for (const beam of laserBeams(params, beatPhase, canvasWidth, canvasHeight)) {
    const vx = x - beam.originX
    const vy = y - beam.originY
    if (vx * beam.dirX + vy * beam.dirY < 0) continue
    const across = Math.abs(vx * beam.dirY - vy * beam.dirX)
    let add = laserBeamLight(across, width, glow)
    if (beam.flicked) add *= 1 + params.flick * FLICK_GAIN
    light += add
  }

  return light
}

/** A pixel counts as lit, for coverage, when its light passes this share of one beam's core. */
export const LIT_THRESHOLD = 0.05

/**
 * The share of a frame the lasers light, on a canvas this shape at this point
 * of the beat: the pixels brighter than `LIT_THRESHOLD` counted on a grid.
 * Every lit pixel counts once however many beams cross it, so it is the
 * union and not the sum. The sweep moves the fans but hardly the share, and
 * the middle of the beat is where the fans are most overlapped, so it is
 * measured there.
 */
export function lasersCoverage(
  params: LaserParams,
  canvasWidth: number,
  canvasHeight: number,
  rows = 135,
): number {
  const columns = Math.round((rows * canvasWidth) / canvasHeight)
  let lit = 0
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1)
      if (
        lasersAt(column + 0.5, row + 0.5, params, 0.5, columns, rows) > LIT_THRESHOLD
      )
        lit += 1

  return lit / (columns * rows)
}

/**
 * The uniform the shader reads, in floats:
 *
 *   0 to 3   canvas width and height in pixels, the beat phase, a pad
 *   4 to 7   the fans, the beams, the spread in radians, the swing in radians
 *   8 to 11  the core half width in pixels, the glow in pixels, the flick, a pad
 *   12 to 15 light in rgb, already times the intensity, a pad
 *
 * The beat phase is read from the packet, not the knobs, because it is a
 * clock the tracker keeps, the way the rings read it. The colour is the
 * ribbon's palette at the key, offset by `hue`.
 */
export function writeLasersUniform(
  params: LaserParams,
  features: Float32Array,
  width: number,
  height: number,
  out: Float32Array,
): Float32Array {
  out[0] = width
  out[1] = height
  out[2] = features[F.beatPhase] ?? 0
  out[3] = 0
  out[4] = params.fans
  out[5] = params.beams
  out[6] = params.spread
  out[7] = params.sweep
  out[8] = laserWidthPixels(params.width, width, height)
  out[9] = laserGlowPixels(params.glow, width, height)
  out[10] = params.flick
  out[11] = 0
  const [red, green, blue] = ribbonColour(features, params.hue)
  out[12] = red * params.intensity
  out[13] = green * params.intensity
  out[14] = blue * params.intensity
  out[15] = 0
  return out
}
