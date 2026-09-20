/**
 * The spectrum ring's numbers: where each bar stands, how long it is, how
 * bright and what colour, worked out on the CPU and handed to the shader as
 * finished pixels. Pure TypeScript with no GPU objects, the way
 * `streaks.params.ts` is, so the parts that decide what the picture looks like
 * can be tested without a browser.
 *
 * The packet carries five bands, and five bars is not a ring. The ink does not
 * go back to the analyser for more: it stays honest to the five numbers it is
 * given and decides only how they are laid out. The ring is the five bands
 * laid along one half of a circle, sub at one pole and treble at the other,
 * and mirrored across the axis between them for the other half, so the ring is
 * symmetric and closes on itself. A bar between two bands takes a smoothstep
 * of the two nearest, which has no slope at either band or at the poles, so
 * the mirror has no crease in it and the ring has no seam. A bar's colour is
 * the same coordinate, so the palette runs from the sub round to the treble
 * on both sides and meets itself. Nothing here is a measurement the extractor
 * did not make; a bar between two bands is a way of drawing the gap between
 * them, and it is the smoothest one.
 *
 * Each band's pulse kicks the bars that stand for it, by the same blend, so a
 * kick in the low end jumps the bars at the sub's pole and the ones round it
 * and leaves the treble's alone. A bar's length is the blended level times
 * that kick, so a band with no level has no bar however hard its pulse is: a
 * silent packet is every bar at nothing and draws nothing at all.
 *
 * Every bar is drawn in pixels from the middle of the canvas, so the ring is
 * round on a wide canvas and a tall one. The bar's width is a real number of
 * pixels against the short side. The ring turns at `spin` turns a second, from
 * one shared clock advanced by the real step, so it is the same at any frame
 * rate and a study that moves the spin with the music never makes it jump. The
 * bars' own lengths take nothing from the frame: they are the extractor's
 * envelopes as they arrive, which are already per second.
 *
 * Overlap. The bars' feet stand on a circle, so the pitch between neighbours
 * is the circumference over the count, and it is smallest at the feet: further
 * out they only spread. A bar at a small radius and a high count would stack
 * its light on its neighbour's, and the canvas would sum that to a bar of
 * white. So the radius is bounded from below by what the count and the width
 * need (`barRadiusPixels`): the feet always have their own width and a pixel of
 * edge either side, and no pixel of the frame is under two bars. The canvas
 * carries light frame to frame, which no ink can prevent, but within a frame
 * nothing stacks.
 *
 * How bright is the part to trust least, and it is the one that has been wrong
 * three times now. The canvas keeps `FEEDBACK_KEEP` of itself a frame and takes
 * `CANVAS_FLOOR` off every pixel, so on paper a bar that stands still sums to
 * `SETTLE` times what one frame adds over that floor. On the adapter that is
 * not what happens: a bar is thin, its length and its light follow the sound,
 * the ring turns and the flow under it carries the trail sideways, and the sum
 * that builds is a small part of the paper one (a ring at 0.05, which the sum
 * puts at a healthy 0.5 at the foot, read 2 of 255 at its brightest pixel at a
 * quiet level and 19 at a loud one). So the intensity is a single frame's light
 * on the ink's own scale, sized to be seen, and the range ends where a bar under
 * the slowest flow starts to read as a white spoke. The number the study rests
 * at was set from captures, beside the ribbon and at a quiet level and a loud
 * one, and is in the registry with what was seen.
 */
import { F } from '../audio/FeatureExtractor'
import { ribbonColour } from '../post/params'
import type { SpectrumKnob } from '../studies/impls'
import { advanceTravel } from './streaks.params'

export { CANVAS_FLOOR, FEEDBACK_KEEP } from './halo.params'

/** Bars the buffer holds. It is fixed once, and a count above it is clamped to it. */
export const MAX_BARS = 96

/** Floats a bar takes in the storage buffer: a direction, a span and a colour. */
export const BAR_FLOATS = 8

/** Floats in the uniform: the canvas size, the bar's width in pixels, and a pad. */
export const BAR_UNIFORM_FLOATS = 4

/** Where a bar's fields sit in its eight floats; the shader reads them by the same order. */
export const BAR_AT = { cos: 0, sin: 1, inner: 2, outer: 3, red: 4, green: 5, blue: 6 } as const

/** The bands the packet carries, in the order round the ring from the sub's pole to the treble's. */
export const BAND_LEVELS = [F.sub, F.bass, F.lowMid, F.highMid, F.treble] as const
export const BAND_PULSES = [
  F.subPulse,
  F.bassPulse,
  F.lowMidPulse,
  F.highMidPulse,
  F.treblePulse,
] as const

/**
 * What each knob may reach, inclusive. The registry guard holds every study to
 * these at silence and at a full packet, and `spectrumParams` clamps to them.
 */
export const SPECTRUM_RANGES: Record<SpectrumKnob, readonly [number, number]> = {
  // Whole bars, and the buffer's size is the top of it.
  bars: [0, MAX_BARS],
  // The feet's distance from the middle, a fraction of the short side. It is
  // raised to `barRadiusPixels` if the count and the width need more room.
  radius: [0.05, 0.4],
  // How far a bar stands out from its foot at full level, a fraction of the short side.
  length: [0, 0.3],
  // Pixels on a 1080 high canvas, scaled with the canvas.
  width: [0, 8],
  // Light added on one frame at the foot of a bar at full level. Above about
  // 0.5 a bar under a slow flow reads as a white spoke; at 0.3 the brightest
  // pixel of a ring under curl drift, the slowest flow, was 194 of 255.
  intensity: [0, 0.5],
  // Palette units from the sub's pole to the treble's, so 0.5 runs the palette half way round.
  hueSpread: [0, 0.5],
  // Turns a second.
  spin: [0, 0.5],
}

export type SpectrumParams = Record<SpectrumKnob, number>

const KNOBS = Object.keys(SPECTRUM_RANGES) as SpectrumKnob[]

const TAU = Math.PI * 2

/** The canvas height a `width` is written against, the same the ribbon's and the streaks' are. */
const REFERENCE_HEIGHT = 1080

/**
 * The room a bar's light fades into past its span and its sides, in pixels. The
 * shader draws a quad this much larger than the bar, and the radius bound keeps
 * this much clear between neighbours.
 */
export const EDGE_PIXELS = 1

/** A bar shorter than this is not worth a quad, which is what silence and a dead band come to. */
export const MIN_BAR_PIXELS = 1

/**
 * How far a band's pulse lengthens the bars that stand for it: at a pulse of 1
 * a bar is this much longer than its level says, up to full. It multiplies the
 * level rather than adding to it, so a pulse can never draw a bar from nothing.
 */
export const KICK = 0.6

/**
 * The share of a bar's light it keeps at a level of 0, so a short bar is dim
 * and a full one is at the intensity. The peak of a bar is therefore the
 * intensity, and the sum the canvas builds is bounded by it.
 */
export const LIGHT_FLOOR = 0.6

/** How much of its light a bar has left at its tip; the shader's taper, mirrored. */
export const TIP_LIGHT = 0.45

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

const fract = (value: number) => value - Math.floor(value)

/** The knobs a study resolved, clamped to their ranges; a missing or non-finite one takes the low end of its range. */
export function spectrumParams(knobs: Readonly<Partial<Record<string, number>>>): SpectrumParams {
  const out: SpectrumParams = {
    bars: 0,
    radius: 0.05,
    length: 0,
    width: 0,
    intensity: 0,
    hueSpread: 0,
    spin: 0,
  }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = SPECTRUM_RANGES[knob]
    out[knob] = value !== undefined && Number.isFinite(value) ? clamp(value, low, high) : low
  }

  out.bars = Math.round(out.bars)
  return out
}

/**
 * The ring's turn after a step, in turns and kept in 0 up to but not including
 * 1, so the angle stays accurate however long the song runs. Per second, and
 * nothing is added a frame at a time that depends on the step.
 */
export const advanceSpin = (turns: number, spin: number, dt: number) =>
  fract(advanceTravel(turns, spin, dt))

/**
 * Where a bar sits along the run from the sub's pole to the treble's, 0 to 1.
 * `place` is how far round the ring it is, 0 up to 1, and the run goes up
 * across the first half and back down across the second, so two bars the same
 * distance either side of the axis have the same place and the ring is
 * symmetric to the last bit.
 */
export const spectrumPosition = (place: number) => 1 - Math.abs(2 * place - 1)

/**
 * A value between the five bands' at `position`, 0 to 1 from the first to the
 * last: a smoothstep between the two bands either side of it. It is exactly a
 * band's own value at that band, and its slope is zero there and at both ends,
 * which is what makes the mirror in `spectrumPosition` close without a crease.
 */
export function blendBands(values: ArrayLike<number>, position: number): number {
  const last = values.length - 1
  const along = clamp(position, 0, 1) * last
  const below = Math.min(Math.floor(along), last - 1)
  const step = along - below
  const eased = step * step * (3 - 2 * step)
  return (values[below] ?? 0) * (1 - eased) + (values[below + 1] ?? 0) * eased
}

/** A bar's length as a share of the full length: its level, kicked by its pulse, and never past 1. */
export const barFraction = (level: number, pulse: number) => clamp(level * (1 + KICK * pulse), 0, 1)

/** A bar's width in pixels on this canvas, which is what makes it survive a 4K one. */
export const barWidthPixels = (width: number, canvasWidth: number, canvasHeight: number) =>
  width * (Math.min(canvasWidth, canvasHeight) / REFERENCE_HEIGHT)

/**
 * Where the bars' feet stand, in pixels from the middle. The study's radius,
 * raised to the least that gives every bar its own width and an edge either
 * side round the whole circle, so neighbours never overlap at the feet, which
 * is where they are nearest. Two feet a step apart on a circle of radius `r`
 * are a chord of `2 r sin(pi / bars)` from one another, and that has to be a
 * bar's width plus its edge on each side.
 */
export function barRadiusPixels(params: SpectrumParams, width: number, height: number): number {
  const wanted = params.radius * Math.min(width, height)
  if (params.bars < 2) return wanted
  const pitch = barWidthPixels(params.width, width, height) + 2 * EDGE_PIXELS
  return Math.max(wanted, pitch / (2 * Math.sin(Math.PI / params.bars)))
}

/** The five bands' values from the packet, held to 0 to 1, with a NaN as silence. */
function readBands(features: Float32Array, fields: readonly number[], out: Float64Array) {
  fields.forEach((field, band) => {
    const value = features[field]
    out[band] = value !== undefined && Number.isFinite(value) ? clamp(value, 0, 1) : 0
  })
}

// The two reads are scratch for `fillBars`, made once so a frame allocates
// nothing. Everything is synchronous, so nothing can see them half written.
const LEVELS = new Float64Array(BAND_LEVELS.length)
const PULSES = new Float64Array(BAND_PULSES.length)

/**
 * Every bar with something to draw this frame, written into `out` as eight
 * floats each (`BAR_AT`), and how many there are. Zero means nothing is drawn:
 * no count, no light, no length or no width, or a packet with no level in any
 * band, and the caller uploads nothing. Bars that are too short to see are
 * left out and the rest are packed to the front, so the draw is exactly as
 * long as what is lit. `turns` is the ring's turn, from `advanceSpin`.
 */
export function fillBars(
  params: SpectrumParams,
  features: Float32Array,
  turns: number,
  width: number,
  height: number,
  out: Float32Array,
): number {
  const bars = Math.min(MAX_BARS, params.bars)
  if (bars <= 0 || !(params.intensity > 0) || !(params.length > 0) || !(params.width > 0)) return 0
  readBands(features, BAND_LEVELS, LEVELS)
  readBands(features, BAND_PULSES, PULSES)
  const reach = params.length * Math.min(width, height)
  const foot = barRadiusPixels(params, width, height)
  let count = 0
  for (let index = 0; index < bars; index += 1) {
    const place = (index + 0.5) / bars
    const position = spectrumPosition(place)
    const fraction = barFraction(blendBands(LEVELS, position), blendBands(PULSES, position))
    const span = reach * fraction
    if (!(span >= MIN_BAR_PIXELS)) continue
    // The sub's pole is at the bottom of the frame, where y runs down.
    const angle = TAU * (place + turns) + Math.PI / 2
    const light = params.intensity * (LIGHT_FLOOR + (1 - LIGHT_FLOOR) * fraction)
    const [red, green, blue] = ribbonColour(features, params.hueSpread * (position - 0.5))
    const at = count * BAR_FLOATS
    out[at + BAR_AT.cos] = Math.cos(angle)
    out[at + BAR_AT.sin] = Math.sin(angle)
    out[at + BAR_AT.inner] = foot
    out[at + BAR_AT.outer] = foot + span
    out[at + BAR_AT.red] = red * light
    out[at + BAR_AT.green] = green * light
    out[at + BAR_AT.blue] = blue * light
    out[at + 7] = 0
    count += 1
  }

  return count
}

/** The uniform the shader reads: the canvas in pixels and the bar's width in pixels. */
export function writeBarUniform(
  params: SpectrumParams,
  width: number,
  height: number,
  out: Float32Array,
): Float32Array {
  out[0] = width
  out[1] = height
  out[2] = barWidthPixels(params.width, width, height)
  out[3] = 0
  return out
}

/**
 * The most of the frame the bars can cover, as a fraction of its area: every
 * bar at full length, each a rectangle of its span and its width plus the
 * pixel of edge the shader fades into at both ends and both sides. It is an
 * upper bound. A bar past the frame's edge is clipped by it and is counted
 * whole here, and none of the bars overlap, which the radius bound sees to. It
 * is the number the study's comment quotes.
 */
export function barCoverage(params: SpectrumParams, width: number, height: number): number {
  const bars = Math.min(MAX_BARS, params.bars)
  const span = params.length * Math.min(width, height) + 2 * EDGE_PIXELS
  const across = barWidthPixels(params.width, width, height) + 2 * EDGE_PIXELS
  return (bars * span * across) / (width * height)
}
