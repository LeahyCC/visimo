/**
 * The dust's numbers: where each speck is, how big, how bright and what
 * colour, worked out on the CPU and handed to the shader as finished pixels.
 * Pure TypeScript with no GPU objects, the way `streaks.params.ts` is, so the
 * parts that decide what the picture looks like can be tested without a
 * browser.
 *
 * A speck does not read the flow. The canvas carries what is drawn on it along
 * the flow and smears it into a trail, so a speck that barely moves is already
 * adrift, and a second velocity field in here would only fight the first. What
 * a speck does do is drift on its own slow curve, and everything about that is
 * a closed-form function of two shared clocks and a hash of its index, with
 * nothing added up per speck:
 *
 * - `travel` runs at `drift` (short sides a second) times the real step. A
 *   speck's place is its head start plus its own share of that distance along
 *   its own heading, and a slow sway across the heading is a sine of the same
 *   distance, so the path is a gentle curve and stops the moment drift does.
 * - `seconds` is the real time. A speck's twinkle is a sine of it at the
 *   speck's own rate and phase, so it does not speed up when the drift does.
 *
 * Space wraps, and the fade at the wrap is the point of it: a speck that
 * leaves one edge comes in at the other, and its light is gone before it gets
 * there and comes back after, so nothing pops in or out.
 *
 * Everything is placed in pixels and sized against the short side, so a speck
 * is round on a wide canvas and a tall one alike.
 */
import { ribbonColour } from '../post/params'
import type { DustKnob } from '../studies/impls'
import { advanceTravel, hash01 } from './streaks.params'

/** Specks the buffers hold. A cast lights up to this many, and it is fixed once. */
export const MAX_SPECKS = 160

/** Floats a speck takes in the storage buffer: a place and a size, then a colour. */
export const SPECK_FLOATS = 8

/** Floats in the uniform: the canvas size in pixels, and a pad. */
export const DUST_UNIFORM_FLOATS = 4

/** Where a speck's fields sit in its eight floats; the shader reads them by the same order. */
export const SPECK_AT = { x: 0, y: 1, radius: 2, red: 4, green: 5, blue: 6 } as const

/**
 * What each knob may reach, inclusive. The registry guard holds every study to
 * these at silence and at a full packet, and `dustParams` clamps to them so a
 * cast that overshoots cannot draw something the buffer cannot hold.
 *
 * The size and the count are capped so that the ink cannot cover a twentieth
 * of the frame with every knob at the top of its range, which
 * `dust.params.test.ts` holds on several canvas shapes.
 */
export const DUST_RANGES: Record<DustKnob, readonly [number, number]> = {
  count: [0, MAX_SPECKS],
  // A speck's widest diameter in pixels on a 1080 high canvas, soft edge
  // included, scaled with the canvas.
  size: [0, 16],
  // Short sides of the canvas travelled a second. At 0.2 a speck crosses the
  // frame in five seconds, which is no longer dust.
  drift: [0, 0.2],
  // How far a speck dims at the bottom of its twinkle: 0 not at all, 1 to nothing.
  twinkle: [0, 1],
  // Light on one frame. A speck barely moves, so the canvas sums it for
  // seconds, and the flow spreads what it sums along a trail, so what reaches
  // the screen is a good deal less than this and the range is set by eye.
  intensity: [0, 0.6],
  // Palette units, so 0.3 would scatter the hues nearly a third of the way round.
  hueSpread: [0, 0.3],
  // 0 leaves every speck where it drifted and 1 puts every one on the centre.
  gather: [0, 1],
}

export type DustParams = Record<DustKnob, number>

const KNOBS = Object.keys(DUST_RANGES) as DustKnob[]

const TAU = Math.PI * 2

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** Linear blend from `low` to `high`; generic, so it says nothing about dust. */
const mix = (low: number, high: number, amount: number) => low + (high - low) * amount

/** 0 at `from`, 1 at `to`, eased between. Generic. */
function smoothstep(from: number, to: number, value: number): number {
  const at = clamp((value - from) / (to - from), 0, 1)
  return at * at * (3 - 2 * at)
}

/** `value` brought into 0 up to but not including `size`, whichever way it had run off. */
const wrap = (value: number, size: number) => value - Math.floor(value / size) * size

/** The knobs a study resolved, clamped to their ranges; a missing or non-finite one is 0. */
export function dustParams(knobs: Readonly<Partial<Record<string, number>>>): DustParams {
  const out: DustParams = {
    count: 0,
    size: 0,
    drift: 0,
    twinkle: 0,
    intensity: 0,
    hueSpread: 0,
    gather: 0,
  }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = DUST_RANGES[knob]
    out[knob] = value !== undefined && Number.isFinite(value) ? clamp(value, low, high) : 0
  }

  return out
}

// Which hash a quantity reads, so two of them never move together.
const SALT = {
  x: 1,
  y: 2,
  heading: 3,
  pace: 4,
  swayLength: 5,
  swayPhase: 6,
  rate: 7,
  phase: 8,
  size: 9,
  hue: 10,
} as const

/** A speck's own pace against the shared distance, so they do not all travel together. */
const PACE = [0.5, 1.5] as const

/**
 * How far a speck strays either side of its heading, in short sides, and how
 * far it travels along that heading for one whole sway. Together they set how
 * gentle the curve is: an amplitude of 0.03 over a length of 0.5 to 1 bends a
 * path with a radius of curvature of a fifth of the short side at the tightest.
 */
const SWAY = 0.03
const SWAY_LENGTH = [0.5, 1] as const

/** A speck's twinkle rate in cycles a second: a period of two and a half to ten seconds. */
const TWINKLE_RATE = [0.1, 0.4] as const

/** A speck's diameter against the knob, which is the most it can be. */
const SIZE_SHARE = [0.5, 1] as const

/** How far the colour is taken toward white, which is what makes the dust pale. */
export const PALE = 0.45

/**
 * How far in from a wrap seam the light has come back to full, as a share of
 * the short side. Long enough that the fade reads as drifting out of sight and
 * short enough that most of the frame is untouched by it.
 */
const EDGE = 0.06

/** The canvas height a `size` is written against, the same the streaks' width is. */
const REFERENCE_HEIGHT = 1080

/** The two clocks a speck reads. */
export type DustClock = {
  /** Short sides of drift so far: `drift` times the real time. */
  travel: number
  /** Real seconds so far. */
  seconds: number
}

/** The clocks after a step: travel is `drift` a second and twinkle a second is a second, at any frame rate. */
export function advanceClock(clock: DustClock, drift: number, dt: number): void {
  clock.travel = advanceTravel(clock.travel, drift, dt)
  clock.seconds = advanceTravel(clock.seconds, 1, dt)
}

/** A speck's widest diameter in pixels on this canvas, which is what makes it survive a 4K one. */
export const speckDiameter = (size: number, canvasWidth: number, canvasHeight: number) =>
  size * (Math.min(canvasWidth, canvasHeight) / REFERENCE_HEIGHT)

/**
 * Every lit speck for this frame, written into `out` as eight floats each
 * (`SPECK_AT`), and how many there are. Zero means nothing is drawn: no count,
 * no light or no size, and the caller uploads nothing.
 *
 * `count` is a level rather than a whole number. Speck `i` is lit by how much
 * of it there is above `i`, so as the count moves the specks come in one at a
 * time from nothing rather than popping, and the last one is half as bright at
 * a count of 3.5.
 */
export function fillSpecks(
  params: DustParams,
  clock: DustClock,
  features: Float32Array,
  width: number,
  height: number,
  out: Float32Array,
): number {
  const lit = Math.min(MAX_SPECKS, Math.ceil(params.count))
  if (lit <= 0 || !(params.intensity > 0) || !(params.size > 0)) return 0
  const short = Math.min(width, height)
  const diameter = speckDiameter(params.size, width, height)
  const margin = EDGE * short
  const keep = 1 - params.gather
  for (let index = 0; index < lit; index += 1) {
    // The heading, and how far along it this speck has come, in short sides.
    const heading = TAU * hash01(index, 0, SALT.heading)
    const cos = Math.cos(heading)
    const sin = Math.sin(heading)
    const along = mix(PACE[0], PACE[1], hash01(index, 0, SALT.pace)) * clock.travel
    const swayLength = mix(SWAY_LENGTH[0], SWAY_LENGTH[1], hash01(index, 0, SALT.swayLength))
    // Across the heading, so the path bends about a straight line rather than
    // speeding up and slowing down along it.
    const across = SWAY * Math.sin(TAU * (along / swayLength + hash01(index, 0, SALT.swayPhase)))
    const x = wrap(hash01(index, 0, SALT.x) * width + (cos * along - sin * across) * short, width)
    const y = wrap(hash01(index, 0, SALT.y) * height + (sin * along + cos * across) * short, height)

    // The seam is where the position wraps, so the fade is measured before the
    // gather moves the speck off it: a speck crossing the seam fades out and
    // back in wherever the gather has put it, and never pops.
    const edge =
      smoothstep(0, margin, Math.min(x, width - x)) * smoothstep(0, margin, Math.min(y, height - y))
    const rate = mix(TWINKLE_RATE[0], TWINKLE_RATE[1], hash01(index, 0, SALT.rate))
    const wave = 0.5 + 0.5 * Math.sin(TAU * (rate * clock.seconds + hash01(index, 0, SALT.phase)))
    const light =
      clamp(params.count - index, 0, 1) *
      edge *
      (1 - params.twinkle * (1 - wave)) *
      params.intensity
    const [red, green, blue] = ribbonColour(
      features,
      (hash01(index, 0, SALT.hue) - 0.5) * params.hueSpread,
    )
    const at = index * SPECK_FLOATS
    out[at + SPECK_AT.x] = width / 2 + (x - width / 2) * keep
    out[at + SPECK_AT.y] = height / 2 + (y - height / 2) * keep
    out[at + SPECK_AT.radius] =
      0.5 * diameter * mix(SIZE_SHARE[0], SIZE_SHARE[1], hash01(index, 0, SALT.size))
    out[at + 3] = 0
    out[at + SPECK_AT.red] = mix(red, 1, PALE) * light
    out[at + SPECK_AT.green] = mix(green, 1, PALE) * light
    out[at + SPECK_AT.blue] = mix(blue, 1, PALE) * light
    out[at + 7] = 0
  }

  return lit
}

/** The uniform the shader reads: the canvas in pixels. */
export function writeDustUniform(width: number, height: number, out: Float32Array): Float32Array {
  out[0] = width
  out[1] = height
  out[2] = 0
  out[3] = 0
  return out
}

/**
 * The most of the frame the dust can cover, as a fraction of its area: the
 * lit specks, each as a square of its widest diameter, over the canvas. It is
 * an upper bound, since the shader draws a disc inside that square and its
 * soft edge is too dim to matter, and it is the number the study's comment
 * quotes. Gathering only lays specks over one another, so it does not raise
 * it. Size scales with the short side, so it is largest on a square canvas and
 * falls as the canvas gets longer, and it does not change with the canvas's
 * size at one shape.
 */
export function dustCoverage(params: DustParams, width: number, height: number): number {
  const specks = Math.min(MAX_SPECKS, Math.ceil(params.count))
  const side = speckDiameter(params.size, width, height)
  return (specks * side * side) / (width * height)
}
