/**
 * The caustics' numbers: the pattern itself, mirrored here so the parts that
 * decide what the picture looks like can be tested without a browser, and the
 * uniform the shader reads it from, which is finished by the time it leaves
 * this file. Pure TypeScript with no GPU objects, the way `dust.params.ts` is.
 *
 * The pattern is the one a rippled surface makes on the floor of a pool.
 * Light that has crossed the surface lands where the surface bends it, and it
 * piles up wherever neighbouring rays land on top of each other. Take the
 * surface as a few moving sine waves, and the map from where a ray left to
 * where it lands is `p + gradient of the height`. How much that map squeezes
 * the plane is the determinant of its Jacobian, and the light on the floor
 * goes as one over it, so the bright network is the set of points where the
 * determinant reaches zero: the folds of the map. For a sum of sines that
 * determinant has a closed form,
 *
 *   det = 1 - sum(f_i s_i) + sum over pairs of f_i f_j s_i s_j (d_i x d_j)^2
 *
 * where `s_i` is wave i's sine, `d_i` its unit direction and `f_i` its focus,
 * which is its amplitude times its wave number squared, so it is a pure
 * number and does not change when `scale` stretches the pattern. That is four
 * sines and six products a pixel, against the dozens of a marched or iterated
 * caustic, and it draws the network from the maths of the thing rather than
 * from a look that resembles it.
 *
 * The brightness is `(1 - (det / BAND)^2)` clamped at 0 and raised to
 * `sharpness`. Physically the light diverges as the determinant reaches zero,
 * and away from the fold it tails off like `1 / det`, which is a haze over the
 * whole frame, and a haze is exactly what a canvas that keeps 93 percent of
 * itself sums into a flat sheet. So the tail is cut off: the bump is exactly
 * zero wherever `|det|` is over `BAND`, which is most of the frame, and the
 * power thins what is left to a line. Nothing between the lines is dim. It is
 * black. The power leaves each line a faint shoulder as well, and the canvas
 * would sum that to a halo, so `CUT` is taken off and the rest stretched back.
 *
 * Two smaller decisions keep the lines honest on any canvas. Where the
 * determinant changes fast a fold is thinner than a pixel and a sample either
 * hits it or misses it, so the band is widened to `MIN_PIXELS` there and the
 * line dimmed by the same ratio, and the light in it is the same. And the
 * pattern is in short sides from the middle, so it is the same shape on a
 * wide canvas and a tall one and scaling it zooms about the middle.
 *
 * How sparse, in numbers, is the bar. The canvas keeps `FEEDBACK_KEEP` of
 * itself a frame, so a still image sums to `1 / (1 - FEEDBACK_KEEP)`, about
 * fourteen times what one frame adds. What one frame adds on average is
 * `intensity` times the mean of the brightness, so the frame's mean settles at
 * `SETTLE x intensity x mean`, and `settledMean` says it. The cast's ceiling
 * bends the light only above half of it, and the lowest ceiling a cast may
 * have is 0.5, so a mean under `MEAN_BUDGET` of 0.2 never gets near it however
 * long the pattern sits: the lines can brighten as they dwell, and the frame
 * cannot fill. `caustics.params.test.ts` holds the mean, and the share of the
 * frame that is lit at all, at rest and at a full packet.
 *
 * Everything moves per second. The waves' offsets come from one clock that
 * `advanceClock` steps by the real time, and are worked out here in doubles
 * and wrapped to a cycle, so the shader is handed numbers near 0 to 1 and the
 * sines stay accurate however long the song runs.
 */
import { ribbonColour } from '../post/params'
import type { CausticsKnob } from '../studies/impls'
import { advanceTravel } from './streaks.params'

/** Floats in the uniform; the shader's `Params` struct reads them in this order. */
export const CAUSTICS_UNIFORM_FLOATS = 44

/**
 * What each knob may reach, inclusive. The registry guard holds every study to
 * these at silence and at a full packet, and `causticsParams` clamps to them.
 */
export const CAUSTICS_RANGES: Record<CausticsKnob, readonly [number, number]> = {
  // Light added on one frame at the top of a line. A line sits over a pixel
  // for a few frames as it moves and the canvas sums them, so what reaches the
  // screen is a good deal more than this on the line and nothing off it.
  intensity: [0, 0.6],
  // How many wavelengths of the coarsest wave fit across the short side, so
  // the cells of the network are about a `scale`th of the frame across.
  scale: [1, 8],
  // Cycles a second of the reference wave; the others turn at their own rates
  // from it. At 0.4 the lines cross a cell in a couple of seconds, which is
  // no longer light on water.
  speed: [0, 0.4],
  // The power the bump is raised to. At 1 the lines are as wide as the band
  // lets them be, and each step up thins them. At 24 they are threads, which
  // is as far as a line stays a line on a canvas of a thousand pixels.
  sharpness: [1, 24],
  // Palette units, as the streaks' and the dust's are.
  hueSpread: [0, 0.3],
}

export type CausticsParams = Record<CausticsKnob, number>

const KNOBS = Object.keys(CAUSTICS_RANGES) as CausticsKnob[]

const TAU = Math.PI * 2

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** `value` brought into 0 up to but not including 1, whichever way it had run off. */
const fract = (value: number) => value - Math.floor(value)

/**
 * The knobs a study resolved, clamped to their ranges. A missing or
 * non-finite one falls to the bottom of its range, which for the light and
 * the speed is nothing and for the two shape numbers is their mildest.
 */
export function causticsParams(knobs: Readonly<Partial<Record<string, number>>>): CausticsParams {
  const out: CausticsParams = { intensity: 0, scale: 1, speed: 0, sharpness: 1, hueSpread: 0 }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = CAUSTICS_RANGES[knob]
    out[knob] = value !== undefined && Number.isFinite(value) ? clamp(value, low, high) : low
  }

  return out
}

/**
 * The four waves. Their directions are spread round the circle and their
 * frequencies are not multiples of one another, so the network has no grid in
 * it and does not repeat; their rates differ in size and in sign, so the
 * pattern churns and does not just slide; and their focus falls with their
 * frequency, the way a real surface's does, so the big swell makes the cells
 * and the small ripples make the detail on the lines. The total is well past
 * 1, which is what makes the map fold at all: under it the determinant never
 * reaches zero and there is nothing to draw.
 */
export const WAVES = [
  { angle: 0.4, frequency: 1, rate: 1, offset: 0.13, focus: 2 },
  { angle: 1.75, frequency: 1.32, rate: -1.31, offset: 0.61, focus: 1.7 },
  { angle: 2.9, frequency: 1.71, rate: 0.79, offset: 0.37, focus: 1.4 },
  { angle: 4.2, frequency: 2.23, rate: -1.87, offset: 0.82, focus: 1.1 },
] as const

/** Unit direction of each wave, worked out once. */
const DIRECTIONS = WAVES.map((wave) => [Math.cos(wave.angle), Math.sin(wave.angle)] as const)

/** The squared cross product of each pair of directions, the pair term's weight. */
const CROSS: { first: number; second: number; weight: number }[] = []
for (let first = 0; first < DIRECTIONS.length; first += 1)
  for (let second = first + 1; second < DIRECTIONS.length; second += 1) {
    const a = DIRECTIONS[first]
    const b = DIRECTIONS[second]
    const cross = (a?.[0] ?? 0) * (b?.[1] ?? 0) - (a?.[1] ?? 0) * (b?.[0] ?? 0)
    CROSS.push({ first, second, weight: cross * cross })
  }

/**
 * How far from a fold the determinant may be and still carry light. It is in
 * units of the determinant, which ranges over a few either side of 0 across a
 * frame, so 0.3 is a thin band round each fold, and the sharpness then thins
 * it further.
 */
export const BAND = 0.3

/**
 * What is taken off the brightness before it leaves, the rest stretched back
 * to fill 0 to 1. The power alone leaves each line a long faint shoulder,
 * a few percent of the peak and a few percent of the frame, and the canvas
 * sums a shoulder to fourteen times itself: a halo round every line. Cutting
 * it takes the shoulder to exactly zero and costs the line nothing that shows.
 */
export const CUT = 0.04

/** A pixel counts as lit, for coverage, when its brightness passes this. */
export const LIT_THRESHOLD = 0.05

/** Where the colour's blend across the frame runs: cycles across the short side, and its heading. */
const TINT_CYCLES = 0.2
const TINT_HEADING = 0.6

/** How fast the colour drifts across the frame, in cycles a second: a lap in fifty seconds. */
const TINT_RATE = 0.02

/** The two clocks: the pattern's and the real one the colour drifts on. */
export type CausticsClock = {
  /** Cycles of the reference wave so far: `speed` times the real time. */
  phase: number
  /** Real seconds so far. */
  seconds: number
}

/** The clocks after a step: the pattern runs at `speed` a second and the colour at its own, at any frame rate. */
export function advanceClock(clock: CausticsClock, speed: number, dt: number): void {
  clock.phase = advanceTravel(clock.phase, speed, dt)
  clock.seconds = advanceTravel(clock.seconds, 1, dt)
}

/** Each wave's offset in cycles, wrapped to 0 up to 1, into `out`. */
export function wavePhases(phase: number, out: number[] | Float32Array): void {
  for (let index = 0; index < WAVES.length; index += 1) {
    const wave = WAVES[index]
    if (wave) out[index] = fract(wave.offset + wave.rate * phase)
  }
}

/**
 * How many pixels wide the band is at the least. Where the determinant
 * changes fast a fold is thinner than a pixel and a sample either hits it or
 * misses it, so it dashes and crawls as it moves. Measuring the band against
 * the determinant's own slope, in pixels, widens exactly those places to this
 * and dims them by the same ratio, so the light in a line is the same and the
 * line is not lost.
 */
export const MIN_PIXELS = 1.5

/** The determinant of the map at a point and how fast it changes across x and across y, per short side. */
export type CausticsFold = { determinant: number; slopeX: number; slopeY: number }

/**
 * The determinant of the map from where a ray left the surface to where it
 * lands, in the closed form the header gives, and its slope. `x` and `y` are
 * in short sides from the middle of the canvas with y down, which is what the
 * shader works out from the pixel, and `offsets` is `wavePhases`. Zero is a
 * fold, and light piles up there.
 */
export function causticFold(
  x: number,
  y: number,
  scale: number,
  offsets: ArrayLike<number>,
): CausticsFold {
  // Each wave's weighted sine and its slope across x and y.
  const weighted: number[] = []
  const slopeX: number[] = []
  const slopeY: number[] = []
  let determinant = 1
  let ddx = 0
  let ddy = 0
  for (let index = 0; index < WAVES.length; index += 1) {
    const wave = WAVES[index]
    const direction = DIRECTIONS[index]
    if (!wave || !direction) continue
    const cycles = scale * wave.frequency
    const angle = TAU * (cycles * (direction[0] * x + direction[1] * y) + (offsets[index] ?? 0))
    const g = wave.focus * Math.sin(angle)
    const slope = wave.focus * Math.cos(angle) * TAU * cycles
    weighted.push(g)
    slopeX.push(slope * direction[0])
    slopeY.push(slope * direction[1])
    determinant -= g
    ddx -= slope * direction[0]
    ddy -= slope * direction[1]
  }

  for (const pair of CROSS) {
    const a = weighted[pair.first] ?? 0
    const b = weighted[pair.second] ?? 0
    determinant += a * b * pair.weight
    ddx += ((slopeX[pair.first] ?? 0) * b + a * (slopeX[pair.second] ?? 0)) * pair.weight
    ddy += ((slopeY[pair.first] ?? 0) * b + a * (slopeY[pair.second] ?? 0)) * pair.weight
  }

  return { determinant, slopeX: ddx, slopeY: ddy }
}

/**
 * The pattern's brightness at one point, 0 to 1, where `pixel` is one pixel
 * in short sides. This is the shader's `fs` line for line, and the coverage
 * and the mean light the tests hold are measured on it.
 */
export function causticLine(
  x: number,
  y: number,
  scale: number,
  sharpness: number,
  offsets: ArrayLike<number>,
  pixel: number,
): number {
  const fold = causticFold(x, y, scale, offsets)
  const band = Math.max(BAND, MIN_PIXELS * pixel * Math.hypot(fold.slopeX, fold.slopeY))
  const ratio = fold.determinant / band
  const bump = Math.max(1 - ratio * ratio, 0)
  const line = Math.pow(bump, sharpness) * (BAND / band)
  return Math.max(line - CUT, 0) / (1 - CUT)
}

/**
 * The canvas height a sample is taken against. The grid it samples on is far
 * coarser than this, which is what makes the sample a fair count of the area
 * the lines cover and not of what a grid happens to land on.
 */
const REFERENCE_HEIGHT = 1080

/** What the canvas keeps of itself a frame: Drift's feedback, the longest trail a cast carries. */
export const FEEDBACK_KEEP = 0.93

/** What a still image sums to: the sum of `FEEDBACK_KEEP` to the n, over all n. */
export const SETTLE = 1 / (1 - FEEDBACK_KEEP)

/**
 * The most the frame's mean may settle at. The lowest ceiling a cast may set
 * is 0.5 and the ceiling bends only above half of it, so under 0.2 the mean
 * never meets it.
 */
export const MEAN_BUDGET = 0.2

/** What a sampled pattern measures. */
export type CausticsSample = {
  /** The share of samples brighter than `LIT_THRESHOLD`. */
  coverage: number
  /** The mean brightness, 0 to 1, before the intensity. */
  mean: number
}

/**
 * The pattern sampled over a grid on a frame of this shape and over a spread
 * of times, which is what coverage and mean light are measured on. The times
 * are a step of a good way through a cycle apiece, so they do not line up with
 * any wave's own period and the sample sees the pattern in many arrangements.
 */
export function sampleCaustics(
  scale: number,
  sharpness: number,
  aspect = 16 / 9,
  rows = 72,
  times = 12,
  pixel = 1 / REFERENCE_HEIGHT,
): CausticsSample {
  const columns = Math.round(rows * aspect)
  const offsets = [0, 0, 0, 0]
  let lit = 0
  let total = 0
  let sum = 0
  for (let step = 0; step < times; step += 1) {
    wavePhases(step * 0.37, offsets)
    for (let row = 0; row < rows; row += 1)
      for (let column = 0; column < columns; column += 1) {
        // Pixel centres in short sides from the middle, as the shader has them.
        const x = (column + 0.5 - columns / 2) / rows
        const y = (row + 0.5 - rows / 2) / rows
        const line = causticLine(x, y, scale, sharpness, offsets, pixel)
        total += 1
        sum += line
        if (line > LIT_THRESHOLD) lit += 1
      }
  }

  return { coverage: lit / total, mean: sum / total }
}

/** What the frame's mean settles at under this pattern, if it sat still: `SETTLE` times what a frame adds. */
export function settledMean(params: CausticsParams, aspect = 16 / 9): number {
  if (!(params.intensity > 0)) return 0
  const { mean } = sampleCaustics(params.scale, params.sharpness, aspect)
  return SETTLE * params.intensity * mean
}

/**
 * Whether anything is drawn this frame. No light means no pass and no upload,
 * which is what a silent packet resolves to.
 */
export const causticsLit = (params: CausticsParams) => params.intensity > 0

/**
 * The uniform the shader reads, in floats:
 *
 *    0 to 3   canvas width and height in pixels, sharpness, a pad
 *    4 to 7   each wave's offset in cycles
 *    8 to 11  the colour gradient: cycles across x and across y, its phase, a pad
 *   12 to 15  `BAND`, `MIN_PIXELS`, `CUT`, a pad
 *   16 to 31  four waves of a vec4: unit direction, cycles across the short
 *             side (already times `scale`), focus
 *   32 to 43  three colours of a vec4, each already times the intensity
 *
 * The colours are the ribbon's palette at the key, at the two ends of the
 * spread and in the middle, and the shader blends across them along the
 * gradient, so the colour shifts across the frame and drifts on the real
 * clock. The palette stays where it was written and this does not keep one.
 */
export function writeCausticsUniform(
  params: CausticsParams,
  clock: CausticsClock,
  features: Float32Array,
  width: number,
  height: number,
  out: Float32Array,
): Float32Array {
  out[0] = width
  out[1] = height
  out[2] = params.sharpness
  out[3] = 0
  const offsets = [0, 0, 0, 0]
  wavePhases(clock.phase, offsets)
  for (let index = 0; index < offsets.length; index += 1) out[4 + index] = offsets[index] ?? 0
  out[8] = TINT_CYCLES * Math.cos(TINT_HEADING)
  out[9] = TINT_CYCLES * Math.sin(TINT_HEADING)
  out[10] = fract(TINT_RATE * clock.seconds)
  out[11] = 0
  out[12] = BAND
  out[13] = MIN_PIXELS
  out[14] = CUT
  out[15] = 0
  for (let index = 0; index < WAVES.length; index += 1) {
    const wave = WAVES[index]
    const direction = DIRECTIONS[index]
    const at = 16 + index * 4
    out[at] = direction?.[0] ?? 0
    out[at + 1] = direction?.[1] ?? 0
    out[at + 2] = params.scale * (wave?.frequency ?? 0)
    out[at + 3] = wave?.focus ?? 0
  }

  const half = params.hueSpread / 2
  const ends = [-half, 0, half]
  for (let index = 0; index < ends.length; index += 1) {
    const [red, green, blue] = ribbonColour(features, ends[index] ?? 0)
    const at = 32 + index * 4
    out[at] = red * params.intensity
    out[at + 1] = green * params.intensity
    out[at + 2] = blue * params.intensity
    out[at + 3] = 0
  }

  return out
}
