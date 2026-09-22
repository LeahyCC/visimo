/**
 * The aurora's numbers: what a curtain is, where its light is, what colour
 * it is, when a hit sends a ripple along it, and how much of the frame it may
 * light. Pure TypeScript with no GPU objects, like `caustics.params.ts`, so
 * every choice is unit tested and `AuroraInk.ts` is left moving numbers into
 * a uniform. `aurora.wgsl` is a transcription of `curtainLight` below; keep
 * the two in step, the tests measure the TypeScript.
 *
 * A curtain is a folded sheet seen edge on, and what makes one striking is
 * four things the maths below keeps and nothing else:
 *
 * - The lower edge is hard. The sheet's path across the frame is a smooth
 *   curve that drifts (a few sines that turn at their own rates, which is
 *   what a smooth noise is and costs a third as much), and below it the light
 *   is exactly zero: black sky, then a bright line.
 * - The body is fine vertical rays, thin and sharp at the foot and gone into
 *   nothing above it. A ray is a peak of a value noise raised to a power, so
 *   between rays the light is zero and not dim, and each ray has a height of
 *   its own that the noise sets: the tall ones are the bright ones.
 * - It is a sheet and not a glow: the foot is a thin bright border, the top
 *   sways with height while the foot stays put (the foot is where the sheet
 *   is pinned), and past a curtain's own top nothing is lit.
 * - Its colour is green at the foot and violet to magenta at the top, and
 *   never anything else. See `AURORA_ARC`.
 *
 * The canvas is what makes the numbers here different from an ink that draws
 * one frame and leaves. It keeps 0.975 of itself a frame, so a curtain that
 * stands still sums to about forty times what one frame adds, so `intensity`
 * is written against that sum and one frame adds `FRESH` of it, not the whole.
 * The sway and the drift are slow on purpose:
 * a ray that crosses more than a few pixels a frame leaves copies of itself,
 * and the lower edge that rises leaves a glow under it that the canvas then
 * carries. `MAX_RAY_SPEED` and `MAX_EDGE_SPEED` are what the ranges are
 * held to.
 *
 * Everything moves per second. The path and the sway are stepped by one clock
 * that `advanceAurora` runs at the `drift` knob's rate in cycles a second,
 * and each curtain's phases are worked out from it in doubles and wrapped to
 * a cycle, so the shader is handed numbers in 0 to 1 and the same song at 30,
 * 60 and 144 frames a second draws the same curtain.
 */
import { F } from '../audio/FeatureExtractor'
import type { AuroraKnob } from '../studies/impls'

/** Curtains at the most, and ripples that may be alive on any of them at once. */
export const CURTAIN_COUNT = 4
export const RIPPLE_SLOTS = 8

/** What the canvas keeps of itself a frame at the reference rate: the director's. */
export const CANVAS_KEEP = 0.975

/**
 * The light one frame adds at the foot per unit of `intensity`. A curtain that
 * stood perfectly still would sum to `1 / (1 - CANVAS_KEEP)`, forty times what
 * a frame adds, and would reach the canvas's ceiling at any brightness worth
 * drawing. Nothing on the canvas stands still: the flow, the zoom and the
 * sway carry the light along, so what one pixel holds is a smear of many
 * frames and not their sum. Set by eye on the adapter against a quiet passage,
 * at a tenth of the frame, the sum a still curtain would reach is `SETTLE`.
 */
export const FRESH = 0.1

/** What a still curtain would sum to, per unit of `intensity`: the count a coverage is made against. */
export const SETTLE = FRESH / (1 - CANVAS_KEEP)

/**
 * The colour of an aurora is a fact and not a taste, so the hue is held to it:
 * the green of oxygen at the foot, going through cyan and blue to the violet
 * and magenta of nitrogen at the top. In turns of the wheel, green at a third
 * and magenta at a bit over five sixths. The key and the chord move a curtain
 * inside these bands and never out of them: following the key all the way
 * round would draw a red curtain in a red key, which is not an aurora, the
 * fault the lightning had and was moved off.
 */
export const AURORA_ARC = { low: 0.33, high: 0.87 } as const
export const BASE_BAND = { low: 0.33, high: 0.48 } as const
export const TIP_BAND = { low: 0.72, high: 0.87 } as const

/** Saturation of the light. A real curtain reads as a hard colour, never a pastel. */
export const AURORA_SATURATION = 0.94

/** How far the tip hue turns against the base as the key moves, so the two are never in step. */
const TIP_PHASE = 0.29

/** A turn of a knob's range, from 0 to 1 across a band. */
const across = (band: { low: number; high: number }, place: number) =>
  band.low + (band.high - band.low) * Math.min(Math.max(place, 0), 1)

/**
 * The two hues of a curtain: the foot's and the top's, each inside its own
 * band. `key` is the key's place on the circle of fifths in turns, and `chord`
 * is the `hue` knob, the turns a moving chord has added to it, which the study
 * integrates from `harmonicChange`. Both are the phase of a sine, not a
 * position, so the last key and the first, which are neighbours on the circle
 * of fifths, are neighbours in colour, and a chord that keeps moving swings
 * the colour back and forth inside the band and never round the wheel.
 */
export function auroraHues(key: number, chord: number): { base: number; tip: number } {
  const turn = 2 * Math.PI * (key + chord)
  return {
    base: across(BASE_BAND, 0.5 + 0.5 * Math.sin(turn)),
    tip: across(TIP_BAND, 0.5 + 0.5 * Math.sin(turn + 2 * Math.PI * TIP_PHASE)),
  }
}

/** A hue as rgb at the aurora's saturation and full value, hue wrapped to a turn. */
export function auroraColour(hue: number): [number, number, number] {
  const sector = (((hue % 1) + 1) % 1) * 6
  const which = Math.floor(sector)
  const rising = sector - which
  const low = 1 - AURORA_SATURATION
  const falling = 1 - AURORA_SATURATION * rising
  const climbing = 1 - AURORA_SATURATION * (1 - rising)
  switch (which % 6) {
    case 0:
      return [1, climbing, low]
    case 1:
      return [falling, 1, low]
    case 2:
      return [low, 1, climbing]
    case 3:
      return [low, falling, 1]
    case 4:
      return [climbing, low, 1]
    default:
      return [1, low, falling]
  }
}

/**
 * The hue along a curtain, `height` being 0 at the foot and 1 at the top: the
 * base holds for the lower third and the turn to the tip is done by the top,
 * because the body of a real curtain is green and only the last of it goes
 * violet. The turn is of the hue, not of the rgb, so the middle is blue and
 * still fully saturated, and the whole walk is the arc.
 */
export function hueAlong(base: number, tip: number, height: number): number {
  const at = Math.min(Math.max((height - 0.05) / 0.6, 0), 1)
  return base + (tip - base) * (at * at * (3 - 2 * at))
}

/** The safe range of every knob, inclusive, which is what a mapping is clamped to. */
export const AURORA_RANGES: Record<AuroraKnob, readonly [number, number]> = {
  // The light the foot settles at on a still canvas, in canvas units. A
  // ceiling of 1.8 bends what the canvas holds, so this may rest over 1 and
  // the bloom finds the foot.
  intensity: [0, 2.2],
  // How many curtains are lit. A fraction fades the last one in.
  curtains: [0, CURTAIN_COUNT],
  // A share of each curtain's own height.
  height: [0.2, 1],
  // How far the top of a ray leans, in frame heights. Slow on purpose: see MAX_RAY_SPEED.
  sway: [0, 0.06],
  // Cycles a second of the reference wave. At the top the edge crosses about a
  // frame height in a minute.
  drift: [0, 0.06],
  // How thin and how sharp the rays are, from a soft veil to hard strands.
  rays: [0, 1],
  // How strong the ripple a hit sends is.
  ripple: [0, 1],
  // Turns the chord has added to the key, wrapped.
  hue: [0, 1],
}

export const AURORA_DEFAULTS: Record<AuroraKnob, number> = {
  intensity: 1.6,
  curtains: 1.4,
  height: 0.55,
  sway: 0.012,
  drift: 0.018,
  rays: 0.5,
  ripple: 0.3,
  hue: 0,
}

export type AuroraParams = Record<AuroraKnob, number>

const KNOBS = Object.keys(AURORA_RANGES) as AuroraKnob[]

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** `value` brought into 0 up to but not including 1, whichever way it had run off. */
const fract = (value: number) => value - Math.floor(value)

/**
 * The knobs a study resolved, clamped to their ranges. A missing or
 * non-finite one falls to its resting value, except the light and the count,
 * which fall to nothing: an aurora that has been told nothing is dark.
 */
export function auroraParams(knobs: Readonly<Partial<Record<string, number>>>): AuroraParams {
  const out: AuroraParams = { ...AURORA_DEFAULTS, intensity: 0, curtains: 0 }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = AURORA_RANGES[knob]
    if (value !== undefined && Number.isFinite(value)) out[knob] = clamp(value, low, high)
  }

  return out
}

/**
 * Whether anything is drawn this frame. No light or no curtain means no pass
 * and no upload. The gate is two rows that cancel the resting light exactly
 * at silence, and summing two floating subtractions leaves a trace under a
 * billionth behind; the threshold is what keeps that trace from being read as
 * a curtain to draw.
 */
const NOTHING = 1e-6
export const auroraLit = (params: AuroraParams) => params.intensity > NOTHING && params.curtains > 0

/**
 * One curtain's own numbers. They are what makes four of them a scene and not
 * one curtain four times: the far ones are dimmer, slower, thinner and
 * smaller, and stand a little higher and nearer the middle of the frame,
 * where the canvas's zoom moves the light least. `foot` is where the edge
 * rests in frame heights up from the bottom, `swing` how far the path may wander
 * from it, `tall` the curtain's height as a share of the frame at a `height`
 * knob of 1, `rays` how many rays there are across a frame height, `slow` the
 * share of the drift the curtain moves at, `light` its brightness against the
 * nearest, and `shift` where along the frame its path starts.
 */
export const CURTAINS = [
  { foot: 0.44, swing: 0.05, tall: 0.62, rays: 56, slow: 1, light: 1, shift: 0.0 },
  { foot: 0.5, swing: 0.04, tall: 0.5, rays: 84, slow: 0.72, light: 0.62, shift: 1.7 },
  { foot: 0.55, swing: 0.032, tall: 0.4, rays: 118, slow: 0.52, light: 0.42, shift: 3.1 },
  { foot: 0.6, swing: 0.026, tall: 0.32, rays: 160, slow: 0.38, light: 0.3, shift: 4.6 },
] as const

/**
 * The sines a curtain's path is made of. Their frequencies are not multiples
 * of one another, so the path does not repeat across the frame, and their
 * rates differ in size and sign, so it churns rather than slides. The
 * amplitudes sum to 1, so the path never leaves `swing` either side of the
 * foot.
 */
export const PATH_WAVES = [
  { freq: 0.83, amp: 0.5, rate: 1, offset: 0.11 },
  { freq: 1.97, amp: 0.3, rate: -1.4, offset: 0.57 },
  { freq: 3.61, amp: 0.2, rate: 0.8, offset: 0.83 },
] as const

/**
 * The share of the frame along a curtain that carries light at all, as a
 * smoothstep of two slow sines, so a curtain is a length of sheet with
 * tapering ends and not a line across the whole frame, and the length moves.
 */
const PRESENCE_WAVES = [
  { freq: 0.37, weight: 0.62, rate: 0.5, offset: 0.21 },
  { freq: 0.83, weight: 0.38, rate: -0.7, offset: 0.66 },
] as const
const PRESENCE_EDGE = [0.3, 0.62] as const

/** How the top of a ray leans: the sway's own spatial frequency, and its rate against the drift. */
export const SWAY_FREQ = 0.9
export const SWAY_RATE = 0.6

/** The ray noise runs on a lattice this many cells long in time, so the clock can wrap at it. */
export const RAY_TIME_PERIOD = 1024

/** How fast the rays' own brightness changes, in lattice cells a second: a ray lives a few seconds. */
const RAY_FLICKER = 0.32

/** The height of the foot's bright border, in frame heights, and how much light it carries over the body. */
export const FOOT_HEIGHT = 0.009
export const FOOT_GAIN = 6

/** How the light falls off above the foot, as a power, and how much of a ray's height is its own. */
export const BODY_POWER = 1.6
export const REACH_LOW = 0.4
export const REACH_HIGH = 0.96

/** The sharpness of a ray at the foot, from the knob, and how much of it is left at the top. */
const RAY_SHARPNESS = [1.5, 7] as const
export const RAY_SOFTEN = 0.55

/** Murmur3's finaliser: neighbouring inputs come out unrelated. */
function mix(value: number): number {
  let bits = value >>> 0
  bits ^= bits >>> 16
  bits = Math.imul(bits, 0x85ebca6b)
  bits ^= bits >>> 13
  bits = Math.imul(bits, 0xc2b2ae35)
  bits ^= bits >>> 16
  return bits >>> 0
}

/** A number in [0, 1) for one lattice point, the same in the shader. */
export function latticeHash(cell: number, time: number): number {
  return (
    mix(
      Math.imul(cell | 0, 0x9e3779b1) ^ Math.imul((time | 0) & (RAY_TIME_PERIOD - 1), 0x85ebca77),
    ) / 4294967296
  )
}

const smooth = (value: number) => value * value * (3 - 2 * value)

/**
 * A value noise in two dimensions: `x` across, in cells, without a period, and
 * `time` in cells of a lattice that repeats at `RAY_TIME_PERIOD`, so a clock
 * wrapped there is continuous. 0 to 1.
 */
export function rayNoise(x: number, time: number): number {
  const cell = Math.floor(x)
  const step = Math.floor(time)
  const fx = smooth(x - cell)
  const ft = smooth(time - step)
  const a = latticeHash(cell, step) + (latticeHash(cell + 1, step) - latticeHash(cell, step)) * fx
  const b =
    latticeHash(cell, step + 1) +
    (latticeHash(cell + 1, step + 1) - latticeHash(cell, step + 1)) * fx
  return a + (b - a) * ft
}

/** The clocks. Everything the shader is handed is worked out from these, in doubles. */
export type AuroraClock = {
  /** Cycles of the reference wave so far: the `drift` knob integrated over real time. */
  drift: number
  /** Lattice cells of ray time so far, wrapped at `RAY_TIME_PERIOD`. */
  rays: number
}

export const newClock = (): AuroraClock => ({ drift: 0, rays: 0 })

/** The clocks after a step: per second, whatever the frame rate. */
export function advanceAurora(clock: AuroraClock, drift: number, dt: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return
  clock.drift += Math.max(drift, 0) * dt
  clock.rays = (clock.rays + RAY_FLICKER * dt) % RAY_TIME_PERIOD
}

/** One curtain's phases, in cycles wrapped to a turn: three for the path, two for its length, one for the sway. */
export type CurtainPhases = {
  path: [number, number, number]
  presence: [number, number]
  sway: number
}

export function curtainPhases(index: number, clock: AuroraClock): CurtainPhases {
  const curtain = CURTAINS[index] ?? CURTAINS[0]
  const own = clock.drift * curtain.slow
  const path = PATH_WAVES.map((wave, at) =>
    fract(wave.offset + at * curtain.shift * 0.37 + wave.rate * own),
  ) as [number, number, number]
  const presence = PRESENCE_WAVES.map((wave, at) =>
    fract(wave.offset + at * curtain.shift * 0.21 + wave.rate * own),
  ) as [number, number]
  return { path, presence, sway: fract(SWAY_RATE * own + curtain.shift * 0.13) }
}

/** The edge of a curtain at `u`, in frame heights from the middle: where the light starts, up from the bottom. */
export function curtainEdge(index: number, u: number, phases: CurtainPhases): number {
  const curtain = CURTAINS[index] ?? CURTAINS[0]
  let path = 0
  for (let at = 0; at < PATH_WAVES.length; at += 1) {
    const wave = PATH_WAVES[at]
    if (!wave) continue
    path +=
      wave.amp * Math.sin(2 * Math.PI * (wave.freq * (u + curtain.shift) + (phases.path[at] ?? 0)))
  }

  return curtain.foot + curtain.swing * path
}

/** How much of the frame at `u` this curtain covers, 0 to 1, exactly 0 off its ends. */
export function curtainPresence(index: number, u: number, phases: CurtainPhases): number {
  const curtain = CURTAINS[index] ?? CURTAINS[0]
  let level = 0
  for (let at = 0; at < PRESENCE_WAVES.length; at += 1) {
    const wave = PRESENCE_WAVES[at]
    if (!wave) continue
    level +=
      wave.weight *
      Math.sin(2 * Math.PI * (wave.freq * (u + curtain.shift) + (phases.presence[at] ?? 0)))
  }

  const held = 0.5 + 0.5 * level
  const at = clamp((held - PRESENCE_EDGE[0]) / (PRESENCE_EDGE[1] - PRESENCE_EDGE[0]), 0, 1)
  return smooth(at)
}

/** A ripple on a curtain: where along it, how wide, how strong. `curtain` is -1 for a free slot. */
export type Ripple = { curtain: number; at: number; width: number; strength: number }

/**
 * The light of one curtain at a point. `u` is frame heights from the middle,
 * `v` frame heights up from the bottom, `pixel` one pixel in frame heights.
 * It is the shader's per-curtain body line for line, in a fixed order of
 * operations, and the coverage and the zero at the top the tests hold are
 * measured on it. 0 below the edge, 0 at and above the top, and the light
 * before the intensity, so 1 is the body of the brightest ray at the foot.
 */
export function curtainLight(
  index: number,
  u: number,
  v: number,
  pixel: number,
  params: AuroraParams,
  clock: AuroraClock,
  ripples: readonly Ripple[] = [],
): number {
  const curtain = CURTAINS[index] ?? CURTAINS[0]
  const weight = clamp(params.curtains - index, 0, 1)
  if (weight <= 0) return 0
  const phases = curtainPhases(index, clock)
  const edge = curtainEdge(index, u, phases)
  const rise = v - edge
  if (rise <= 0) return 0
  const presence = curtainPresence(index, u, phases)
  if (presence <= 0) return 0

  // A ripple lifts the light where it is and stretches the curtain there, so a
  // hit is a swell travelling along the sheet and not a flash of the whole.
  let bump = 0
  for (const ripple of ripples) {
    if (ripple.curtain !== index || ripple.strength <= 0) continue
    const away = (u - ripple.at) / ripple.width
    bump += ripple.strength * Math.exp(-away * away)
  }

  const tall = Math.max(curtain.tall * params.height * (1 + 0.3 * bump), 1e-6)
  const height = rise / tall
  if (height >= 1) return 0

  // The top of a ray leans and the foot does not, so a curtain sways like
  // cloth pinned along its lower edge.
  const lean =
    params.sway * height * Math.sin(2 * Math.PI * (SWAY_FREQ * (u + curtain.shift) + phases.sway))
  const cells = (u + lean) * curtain.rays
  const flicker = clock.rays * (1 + 0.4 * curtain.slow) + curtain.shift * 31
  const raw = 0.65 * rayNoise(cells, flicker) + 0.35 * rayNoise(cells * 2.7 + 13, flicker * 1.9 + 7)
  const sharp =
    (RAY_SHARPNESS[0] + (RAY_SHARPNESS[1] - RAY_SHARPNESS[0]) * params.rays) *
    (1 - RAY_SOFTEN * height)
  const ray = Math.pow(raw, sharp)

  // Each ray's own top: the strong ones stand tallest, and every one is 0 by
  // the curtain's top, so the sky above a curtain is black and not dim.
  const reach = REACH_LOW + (REACH_HIGH - REACH_LOW) * raw
  const fall = 1 - clamp(height / reach, 0, 1)
  const body = Math.pow(fall, BODY_POWER)
  const foot = FOOT_GAIN * Math.exp(-rise / FOOT_HEIGHT)
  // One pixel of soft edge, so the hard lower edge is hard without aliasing.
  const cut = clamp(rise / Math.max(pixel, 1e-6), 0, 1)
  return weight * presence * curtain.light * cut * ray * (body + foot * fall) * (1 + 1.4 * bump)
}

/** The light of all the curtains at a point, before the intensity. */
export function auroraLight(
  u: number,
  v: number,
  pixel: number,
  params: AuroraParams,
  clock: AuroraClock,
  ripples: readonly Ripple[] = [],
): number {
  let sum = 0
  for (let index = 0; index < CURTAIN_COUNT; index += 1)
    sum += curtainLight(index, u, v, pixel, params, clock, ripples)
  return sum
}

/**
 * The fastest a ray's top moves sideways, in frame heights a second, and the
 * fastest the lower edge moves up or down. Both are the derivative of what
 * the curtain is made of, and both are held under a bound: past a few pixels
 * a frame the canvas leaves copies, and the trail stops reading as the
 * curtain's own drift.
 */
export function maxRaySpeed(params: AuroraParams): number {
  let fastest = 0
  for (const curtain of CURTAINS)
    fastest = Math.max(fastest, params.sway * 2 * Math.PI * SWAY_RATE * params.drift * curtain.slow)
  return fastest
}

export function maxEdgeSpeed(params: AuroraParams): number {
  let fastest = 0
  for (const curtain of CURTAINS) {
    let speed = 0
    for (const wave of PATH_WAVES)
      speed += wave.amp * 2 * Math.PI * Math.abs(wave.rate) * params.drift * curtain.slow
    fastest = Math.max(fastest, curtain.swing * speed)
  }

  return fastest
}

/** 12 pixels at 1080 high, a second: what a ray may cross before its trail is a smear and not a drift. */
export const MAX_RAY_SPEED = 0.03
export const MAX_EDGE_SPEED = 0.03

/** A pixel counts as lit, for coverage, when its settled light passes this. */
export const LIT_LEVEL = 0.3
export const BRIGHT_LEVEL = 0.8

/** The canvas height a sample is taken against. */
const REFERENCE_HEIGHT = 1080

/** What a sampled aurora measures: shares of the frame, over the settled light. */
export type AuroraSample = {
  /** The share of samples whose settled light passes `LIT_LEVEL`. */
  lit: number
  /** The share that passes `BRIGHT_LEVEL`. */
  bright: number
  /** The mean settled light. */
  mean: number
}

/**
 * The aurora sampled over a grid on a frame this shape, over a spread of
 * times. What is counted is the settled light, the intensity times the light,
 * which is what a still canvas holds, and that is the worst case for a
 * curtain that drifts this slowly. The times are steps of a good way through
 * a cycle apiece, so the sample sees many arrangements of the curtains.
 */
export function sampleAurora(
  params: AuroraParams,
  width: number,
  height: number,
  rows = 90,
  times = 8,
  ripples: readonly Ripple[] = [],
): AuroraSample {
  const aspect = width / height
  const columns = Math.max(1, Math.round(rows * aspect))
  const clock = newClock()
  let lit = 0
  let bright = 0
  let sum = 0
  let total = 0
  for (let step = 0; step < times; step += 1) {
    clock.drift = step * 6.13
    clock.rays = (step * 91.7) % RAY_TIME_PERIOD
    for (let row = 0; row < rows; row += 1)
      for (let column = 0; column < columns; column += 1) {
        const u = (column + 0.5 - columns / 2) / rows
        const v = 1 - (row + 0.5) / rows
        const settled =
          params.intensity *
          SETTLE *
          auroraLight(u, v, 1 / REFERENCE_HEIGHT, params, clock, ripples)
        total += 1
        sum += settled
        if (settled > LIT_LEVEL) lit += 1
        if (settled > BRIGHT_LEVEL) bright += 1
      }
  }

  return { lit: lit / total, bright: bright / total, mean: sum / total }
}

/** The hits that send a ripple: the mids and the bass, where a played note's body is. */
const HIT_ROWS = [F.bassHit, F.lowMidHit, F.highMidHit] as const

/** How hard a hit has to be, and the fewest seconds between two ripples. */
const HIT_MIN = 0.3
export const RIPPLE_GAP_SECONDS = 0.45

/** A ripple's life in seconds, its travel in frame heights a second, and its width in frame heights. */
export const RIPPLE_LIFE = 3.2
export const RIPPLE_SPEED = 0.32
const RIPPLE_WIDTH = [0.07, 0.15] as const

/** How far along the frame a ripple may be born, in frame heights either side of the middle. */
const RIPPLE_SPAN = 0.85

/** How a ripple's strength runs over its life: up in a fifth of a second, then out. */
export function rippleFade(age: number): number {
  if (age <= 0 || age >= RIPPLE_LIFE) return 0
  const rise = clamp(age / 0.2, 0, 1)
  const fall = 1 - age / RIPPLE_LIFE
  return smooth(rise) * fall * fall
}

type Slot = {
  curtain: number
  origin: number
  direction: number
  born: number
  width: number
  strength: number
}

/**
 * The ripples, and the rule for when one is born. A hit in the bass or the
 * mids, strong enough, while the `ripple` knob has any strength to give,
 * sends one along a curtain: chosen from the lit ones by a hash of the
 * section and the count, so the same song sends the same ripples. Ripples are
 * at least `RIPPLE_GAP_SECONDS` apart, so there are at most a little over
 * two a second, and each is a local swell a tenth of a frame wide, far under
 * the large area WCAG 2.3.1 counts a flash by.
 */
export class AuroraRipples {
  private readonly slots: Slot[] = Array.from({ length: RIPPLE_SLOTS }, () => ({
    curtain: -1,
    origin: 0,
    direction: 1,
    born: 0,
    width: RIPPLE_WIDTH[0],
    strength: 0,
  }))
  private time = 0
  private counter = 0
  private last = Number.NEGATIVE_INFINITY

  /** Ripples sent since the pool was made. */
  get sent() {
    return this.counter
  }

  step(features: Float32Array, dt: number, params: AuroraParams) {
    if (!Number.isFinite(dt) || dt <= 0) return
    this.time += dt
    if (params.ripple <= 0.02 || params.curtains <= 0) return
    if (this.time - this.last < RIPPLE_GAP_SECONDS) return
    let strength = 0
    for (const row of HIT_ROWS) strength = Math.max(strength, features[row] ?? 0)
    if (strength < HIT_MIN) return
    this.last = this.time
    this.send(strength, params, features)
  }

  private send(strength: number, params: AuroraParams, features: Float32Array) {
    const count = this.counter
    this.counter += 1
    const section = Math.round(features[F.section] ?? 0)
    const seed = (Math.imul(section + 1, 0x85ebca77) ^ Math.imul(count + 1, 0xc2b2ae3d)) >>> 0
    const pick = (channel: number) => mix(seed ^ Math.imul(channel + 1, 0x9e3779b1)) / 4294967296
    // Only a curtain that is lit can carry one, and the near ones first.
    const lit = Math.max(1, Math.min(CURTAIN_COUNT, Math.ceil(params.curtains)))
    const curtain = Math.floor(pick(0) * lit)
    // A slot that has run out is taken first, and with none the oldest gives way.
    const spent = (entry: Slot) => entry.curtain < 0 || this.time - entry.born >= RIPPLE_LIFE
    const slot =
      this.slots.find(spent) ??
      this.slots.reduce((oldest, entry) => (entry.born < oldest.born ? entry : oldest))
    slot.curtain = curtain
    slot.origin = (pick(1) * 2 - 1) * RIPPLE_SPAN
    slot.direction = pick(2) < 0.5 ? -1 : 1
    slot.born = this.time
    slot.width = RIPPLE_WIDTH[0] + (RIPPLE_WIDTH[1] - RIPPLE_WIDTH[0]) * pick(3)
    slot.strength = clamp(strength * params.ripple, 0, 1)
  }

  /** The ripples alive now, at the position and strength their age gives, into `out`. */
  read(out: Ripple[]): Ripple[] {
    out.length = 0
    for (const slot of this.slots) {
      const age = this.time - slot.born
      const strength = slot.curtain < 0 ? 0 : slot.strength * rippleFade(age)
      out.push({
        curtain: strength > 0 ? slot.curtain : -1,
        at: slot.origin + slot.direction * RIPPLE_SPEED * age,
        width: slot.width,
        strength,
      })
    }

    return out
  }

  /** How many are alive now. Zero means nothing to add to the uniform. */
  get alive() {
    let alive = 0
    for (const slot of this.slots)
      if (slot.curtain >= 0 && this.time - slot.born < RIPPLE_LIFE) alive += 1
    return alive
  }
}

/**
 * Floats in the uniform, in vec4s:
 *
 *    0        canvas width and height in pixels, the fresh light a frame adds, the count of curtains
 *    1        height, sway, ray sharpness, ray time
 *    2        the foot's hue and the top's hue in turns, saturation, a pad
 *    3 to 6   the four curtains: foot, swing, tall, rays a frame height
 *    7 to 10  the four curtains: light, shift, slow, a pad
 *    11 to 14 the four curtains' path phases (three) and sway phase
 *    15 to 18 the four curtains' length phases (two), a pad, a pad
 *    19 to 26 the eight ripples: curtain, place, width, strength
 */
export const AURORA_UNIFORM_FLOATS = 27 * 4

export function writeAuroraUniform(
  params: AuroraParams,
  clock: AuroraClock,
  features: Float32Array,
  ripples: readonly Ripple[],
  width: number,
  height: number,
  out: Float32Array,
): Float32Array {
  out.fill(0)
  out[0] = width
  out[1] = height
  out[2] = params.intensity * FRESH
  out[3] = params.curtains
  out[4] = params.height
  out[5] = params.sway
  out[6] = params.rays
  out[7] = clock.rays
  const hues = auroraHues(features[F.keyHue] ?? 0, params.hue)
  out[8] = hues.base
  out[9] = hues.tip
  out[10] = AURORA_SATURATION
  for (let index = 0; index < CURTAIN_COUNT; index += 1) {
    const curtain = CURTAINS[index]
    if (!curtain) continue
    const phases = curtainPhases(index, clock)
    const a = 12 + index * 4
    out[a] = curtain.foot
    out[a + 1] = curtain.swing
    out[a + 2] = curtain.tall
    out[a + 3] = curtain.rays
    const b = 28 + index * 4
    out[b] = curtain.light
    out[b + 1] = curtain.shift
    out[b + 2] = curtain.slow
    const c = 44 + index * 4
    out[c] = phases.path[0]
    out[c + 1] = phases.path[1]
    out[c + 2] = phases.path[2]
    out[c + 3] = phases.sway
    const d = 60 + index * 4
    out[d] = phases.presence[0]
    out[d + 1] = phases.presence[1]
  }

  for (let slot = 0; slot < RIPPLE_SLOTS; slot += 1) {
    const ripple = ripples[slot]
    const at = 76 + slot * 4
    out[at] = ripple && ripple.strength > 0 ? ripple.curtain : -1
    out[at + 1] = ripple?.at ?? 0
    out[at + 2] = ripple?.width ?? 0.1
    out[at + 3] = ripple?.strength ?? 0
  }

  return out
}
