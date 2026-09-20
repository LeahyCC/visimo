/**
 * The streaks' numbers: where each one is, how long, how bright and what
 * colour, worked out on the CPU and handed to the shader as finished pixels.
 * Pure TypeScript with no GPU objects, the way `fluid.params.ts` and
 * `post/params.ts` are, so the parts that decide what the picture looks like
 * can be tested without a browser.
 *
 * Every streak lives on a ray from the middle of the canvas and travels in
 * along it, from the canvas edge to a small eye at the centre, then is reborn
 * at the edge on a new ray. Nothing is integrated per streak and nothing is
 * random:
 *
 * - One shared clock, `phase`, is advanced by `speed` times the real step, so
 *   travel is per second and a build that speeds the streaks up does not make
 *   them jump. A streak's place is that clock scaled by its own rate plus its
 *   own head start, taken modulo 1.
 * - The whole number of laps a streak has done is its generation, and its ray,
 *   length, light and hue are hashes of its index and that generation. Same
 *   song, same picture, and a streak that is reborn is somewhere new.
 *
 * Everything is placed in pixels, with the angle taken in pixel space, so on a
 * wide canvas and a tall one alike the rays converge on the middle of the
 * canvas and a circle of them is a circle.
 */
import { ribbonColour } from '../post/params'
import type { StreaksKnob } from '../studies/impls'

/** Streaks the buffers hold. A cast lights up to this many, and it is fixed once. */
export const MAX_STREAKS = 96

/** Floats a streak takes in the storage buffer: a direction, a span and a colour. */
export const STREAK_FLOATS = 8

/** Floats in the uniform: the canvas size, the line's width in pixels, and a pad. */
export const STREAK_UNIFORM_FLOATS = 4

/** Where a streak's fields sit in its eight floats; the shader reads them by the same order. */
export const STREAK_AT = { cos: 0, sin: 1, head: 2, tail: 3, red: 4, green: 5, blue: 6 } as const

/**
 * What each knob may reach, inclusive. The registry guard holds every study
 * to these at silence and at a full packet, and `streakParams` clamps to them
 * so a cast that overshoots cannot draw something the buffer cannot hold.
 */
export const STREAK_RANGES: Record<StreaksKnob, readonly [number, number]> = {
  count: [0, MAX_STREAKS],
  // Fractions of the canvas's short side, so a circle of streaks is a circle.
  length: [0, 0.6],
  // Trips from the edge to the eye per second. Above 3 a streak is gone in a
  // few frames and reads as flicker.
  speed: [0, 3],
  // Pixels on a 1080 high canvas, scaled with the canvas.
  width: [0, 6],
  intensity: [0, 1],
  // Palette units, so 0.5 would scatter the hues half way round.
  hueSpread: [0, 0.5],
}

export type StreakParams = Record<StreaksKnob, number>

const KNOBS = Object.keys(STREAK_RANGES) as StreaksKnob[]

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** Linear blend from `low` to `high`; generic, so it says nothing about streaks. */
const mix = (low: number, high: number, amount: number) => low + (high - low) * amount

/** 0 at `from`, 1 at `to`, eased between. Generic. */
function smoothstep(from: number, to: number, value: number): number {
  const at = clamp((value - from) / (to - from), 0, 1)
  return at * at * (3 - 2 * at)
}

/** The knobs a study resolved, clamped to their ranges; a missing or non-finite one is 0. */
export function streakParams(knobs: Readonly<Partial<Record<string, number>>>): StreakParams {
  const out: StreakParams = {
    count: 0,
    length: 0,
    speed: 0,
    width: 0,
    intensity: 0,
    hueSpread: 0,
  }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = STREAK_RANGES[knob]
    out[knob] = value !== undefined && Number.isFinite(value) ? clamp(value, low, high) : 0
  }

  return out
}

/**
 * A number from 0 up to but not including 1, the same for the same three
 * integers. Two integer finalisers over the inputs mixed by odd constants,
 * which is enough for placement and has no state to carry between frames.
 */
export function hash01(a: number, b: number, salt: number): number {
  let h =
    Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35)
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// Which hash a quantity reads, so two of them never move together.
const SALT = { start: 1, rate: 2, angle: 3, length: 4, light: 5, hue: 6 } as const

/**
 * The hole left in the middle, as a fraction of the short side. Every ray
 * converges on one point, so without it the light of all of them piles up
 * there and the eye of the picture is a white dot.
 */
const EYE = 0.04

/**
 * How far along its trip a streak starts to fade, and where it is gone. The
 * fade is the other half of the eye: light thins as the rays crowd together.
 */
const FADE_FROM = 0.55
const FADE_TO = 0.95

/** A streak's own rate against the shared clock, so they do not all arrive together. */
const RATE = [0.6, 1.4] as const

/** A streak's length and light against the knob, which is the most either can be. */
const LENGTH_SHARE = [0.5, 1] as const
const LIGHT_SHARE = [0.5, 1] as const

/** The canvas height a `width` is written against, the same the ribbon's is. */
const REFERENCE_HEIGHT = 1080

/** The shared clock after a step: travel is `speed` trips per second whatever the frame rate. */
export function advanceTravel(phase: number, speed: number, dt: number): number {
  return Number.isFinite(dt) && dt > 0 ? phase + Math.max(speed, 0) * dt : phase
}

/** A line's width in pixels on this canvas, which is what makes it survive a 4K one. */
export const streakWidthPixels = (width: number, canvasWidth: number, canvasHeight: number) =>
  width * (Math.min(canvasWidth, canvasHeight) / REFERENCE_HEIGHT)

/**
 * How far a streak has got on the shared clock, in laps: the whole part is
 * its generation and the rest is how far along that lap it is. Its own head
 * start and its own rate are hashes of its index alone, so they never change
 * under it.
 */
export const travelled = (index: number, phase: number): number =>
  hash01(index, 0, SALT.start) + mix(RATE[0], RATE[1], hash01(index, 0, SALT.rate)) * phase

/**
 * Distance from the middle of the canvas to its edge along a unit direction.
 * Streaks are born on the edge rather than at a circle round it, so on a wide
 * canvas the ones that run sideways are not spent off screen.
 */
function edgeDistance(cos: number, sin: number, width: number, height: number): number {
  const across = Math.abs(cos) > 1e-9 ? width / 2 / Math.abs(cos) : Number.POSITIVE_INFINITY
  const down = Math.abs(sin) > 1e-9 ? height / 2 / Math.abs(sin) : Number.POSITIVE_INFINITY
  return Math.min(across, down)
}

/**
 * Every lit streak for this frame, written into `out` as eight floats each
 * (`STREAK_AT`), and how many there are. Zero means nothing is drawn: no
 * count, no light, no length or no width, and the caller uploads nothing.
 *
 * `count` is a level rather than a whole number. Streak `i` is lit by how much
 * of it there is above `i`, so as tension climbs the streaks come in one at a
 * time from nothing rather than popping, and the last one is half as bright
 * at a count of 3.5.
 */
export function fillStreaks(
  params: StreakParams,
  phase: number,
  features: Float32Array,
  width: number,
  height: number,
  out: Float32Array,
): number {
  const lit = Math.min(MAX_STREAKS, Math.ceil(params.count))
  if (lit <= 0 || !(params.intensity > 0) || !(params.length > 0) || !(params.width > 0)) return 0
  const short = Math.min(width, height)
  const eye = EYE * short
  const reach = params.length * short
  for (let index = 0; index < lit; index += 1) {
    const laps = travelled(index, phase)
    const generation = Math.floor(laps)
    // 0 on the edge and 1 at the eye.
    const trip = laps - generation
    const angle = Math.PI * 2 * hash01(index, generation, SALT.angle)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const head = eye + Math.max(edgeDistance(cos, sin, width, height) - eye, 0) * (1 - trip)
    const tail =
      head + reach * mix(LENGTH_SHARE[0], LENGTH_SHARE[1], hash01(index, generation, SALT.length))
    const light =
      clamp(params.count - index, 0, 1) *
      mix(LIGHT_SHARE[0], LIGHT_SHARE[1], hash01(index, generation, SALT.light)) *
      (1 - smoothstep(FADE_FROM, FADE_TO, trip)) *
      params.intensity
    const [red, green, blue] = ribbonColour(
      features,
      (hash01(index, generation, SALT.hue) - 0.5) * params.hueSpread,
    )
    const at = index * STREAK_FLOATS
    out[at + STREAK_AT.cos] = cos
    out[at + STREAK_AT.sin] = sin
    out[at + STREAK_AT.head] = head
    out[at + STREAK_AT.tail] = tail
    out[at + STREAK_AT.red] = red * light
    out[at + STREAK_AT.green] = green * light
    out[at + STREAK_AT.blue] = blue * light
    out[at + 7] = 0
  }

  return lit
}

/** The uniform the shader reads: the canvas in pixels and the line's width in pixels. */
export function writeStreakUniform(
  params: StreakParams,
  width: number,
  height: number,
  out: Float32Array,
): Float32Array {
  out[0] = width
  out[1] = height
  out[2] = streakWidthPixels(params.width, width, height)
  out[3] = 0
  return out
}

/**
 * The most of the frame the streaks can cover, as a fraction of its area: the
 * lit ones, each at its longest, times the width, over the canvas. It is an
 * upper bound, since the shader tapers each streak and a streak near an edge
 * is clipped by it, and the number the study's comment quotes. It does not
 * depend on the canvas size on a square one and falls on a wide one, because
 * length and width both scale with the short side.
 */
export function streakCoverage(params: StreakParams, width: number, height: number): number {
  const short = Math.min(width, height)
  const streaks = Math.min(MAX_STREAKS, Math.ceil(params.count))
  const area = params.length * short * streakWidthPixels(params.width, width, height)
  return (streaks * area) / (width * height)
}
