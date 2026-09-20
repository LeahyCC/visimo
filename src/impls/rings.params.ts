/**
 * The rings' numbers: when one is born, where it is, how bright and what
 * colour, worked out on the CPU and handed to the shader as finished pixels.
 * Pure TypeScript with no GPU objects, the way `shards.params.ts` is, so the
 * parts that decide what the picture looks like can be tested without a
 * browser.
 *
 * A ring is a thin circle about the middle of the canvas, born on a beat at a
 * small radius and spreading at a steady rate until it fades or leaves the
 * frame. Round on a wide canvas and a tall one, since it is drawn in pixels
 * from the middle; its thickness is a real number of pixels against the short
 * side, with a soft edge.
 *
 * A beat here is `beatPhase` wrapping, which is the tracker's prediction and
 * not an onset, so a ring lands where the beat is expected and not where a hat
 * happens to fall. When `tempoConfidence` is low nothing is born: a phase on a
 * wrong tempo is a steady rhythm in the wrong place.
 *
 * Why a small pool and not a closed form of the beat clock. A ring's radius as
 * a function of the phase alone would be frame-rate proof by construction, but
 * the phase is a prediction and the tempo tracker changes its mind: a closed
 * form would move every ring on screen at once the frame the period changed,
 * and would need the tempo to turn a phase into seconds at all. A ring that is
 * born and then simply travels is unaffected by any of that, and it is frame
 * rate proof all the same, because nothing is added up a frame at a time that
 * depends on the step:
 *
 * - `travel` is a shared clock, advanced by `speed` (frame heights a second)
 *   times the real step, so a study that moves the speed with the music never
 *   makes a ring jump. A ring's radius is its birth radius plus the travel
 *   since it was born.
 * - The instant of a birth is found inside the step, by where the phase's wrap
 *   falls between the last sample and this one, so a ring born part-way through
 *   a step is that much older at the end of it. At 60 and at 144 steps a
 *   second the same beat makes the same ring in the same place.
 * - Every choice at birth (its life and its place in the palette) is a
 *   function of the birth counter, never `Math.random`. The same song draws the
 *   same rings.
 *
 * `rate` is rings a beat. A tick is a multiple of 1/n of the beat, and n is
 * snapped to 1, 2 or 4, so a build's roll is the tempo's own subdivisions
 * and not an arbitrary rate; the ticks are counted against the n of the
 * frame they fall in, so a change of n between frames cannot make one.
 *
 * How bright is the part to trust least. The canvas keeps `FEEDBACK_KEEP` of
 * itself a frame and takes `CANVAS_FLOOR` off every pixel, so light that
 * moves does not sum the way a still image does: a ring sweeps a pixel in a
 * frame or two and the pixel then falls away, at a rate the floor makes faster
 * than 0.93 alone would. What a ring reaches on screen is what `ringPassPeak`
 * simulates, and the intensity was set from a capture beside the ribbon and
 * not from a sum on paper, which is how the last two inks were first wrong.
 */
import { F } from '../audio/FeatureExtractor'
import { ribbonColour } from '../post/params'
import type { RingsKnob } from '../studies/impls'
import { CANVAS_FLOOR, FEEDBACK_KEEP } from './halo.params'

export { CANVAS_FLOOR, FEEDBACK_KEEP } from './halo.params'

/** Rings the buffer holds. It is fixed once; a birth into a full pool takes the oldest, which is the dimmest. */
export const RING_POOL = 24

/** Floats a ring takes in the storage buffer: the light in rgb, then the radius in pixels. */
export const RING_FLOATS = 4

/** Floats in the uniform: the canvas in pixels, the ring's thickness and its soft edge in pixels. */
export const RING_UNIFORM_FLOATS = 4

/** Corners round a ring; a strip of this many pieces is within a fifth of a pixel of a circle at 4K. */
export const RING_SEGMENTS = 256

/** The tempo tracker's ceiling in beats a minute, which is the fastest a ring can be asked for. */
export const MAX_BPM = 200

/** Where a ring is born, in frame heights from the middle. Small, and off the point every flow converges on. */
export const BIRTH_RADIUS = 0.04

/** The canvas height a `thickness` is written against, the same the ribbon's and the streaks' are. */
const REFERENCE_HEIGHT = 1080

/** A ring's soft edge on each side, in pixels at that height, and the least it is at any size. */
const EDGE_PIXELS = 1
const MIN_EDGE_PIXELS = 0.75

/**
 * The confidence at which the beat is believed, with a gap between on and off
 * so a track that sits on the edge does not switch the rings every beat. Four
 * to the floor reads about 0.85, a two-step 0.45, a breakdown under 0.2.
 */
export const CONFIDENCE_ON = 0.35
export const CONFIDENCE_OFF = 0.25

/** Rings in a colour cycle: the hue steps up and comes back down over this many, so neighbours differ by a step and never by a jump. */
const HUE_PERIOD = 8

/**
 * What each knob may reach, inclusive. The registry guard holds every study to
 * these at silence and at a full packet, and `ringParams` clamps to them.
 */
export const RING_RANGES: Record<RingsKnob, readonly [number, number]> = {
  // Rings a beat, snapped to 1, 2 or 4.
  rate: [1, 4],
  // Frame heights a second. Under 0.05 a ring stands so long on a pixel that the canvas sums it to a bar of light.
  speed: [0.05, 0.8],
  // Pixels on a 1080 high canvas, scaled with the canvas: the width at half brightness.
  thickness: [0, 8],
  // Light on one frame at the ring's brightest.
  intensity: [0, 1],
  // Seconds, at most; a ring is gone sooner if it leaves the frame first.
  life: [0.3, 4],
  // Palette units, so 0.5 would scatter the hues half way round.
  hueSpread: [0, 0.5],
}

export type RingParams = Record<RingsKnob, number>

const KNOBS = Object.keys(RING_RANGES) as RingsKnob[]

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** The knobs a study resolved, clamped to their ranges; a missing or non-finite one takes the low end of its range. */
export function ringParams(knobs: Readonly<Partial<Record<string, number>>>): RingParams {
  const out: RingParams = {
    rate: 1,
    speed: 0.05,
    thickness: 0,
    intensity: 0,
    life: 0.3,
    hueSpread: 0,
  }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = RING_RANGES[knob]
    out[knob] = value !== undefined && Number.isFinite(value) ? clamp(value, low, high) : low
  }

  return out
}

/** Rings a beat: the knob snapped to the nearest subdivision a roll uses. */
export const ringsPerBeat = (rate: number): 1 | 2 | 4 => (rate < 1.5 ? 1 : rate < 3 ? 2 : 4)

/** A ring's thickness in pixels on this canvas, which is what makes it survive a 4K one. */
export const ringThicknessPixels = (thickness: number, width: number, height: number) =>
  thickness * (Math.min(width, height) / REFERENCE_HEIGHT)

/** The soft edge on each side of a ring, in pixels on this canvas. */
export const ringEdgePixels = (width: number, height: number) =>
  Math.max(MIN_EDGE_PIXELS, (EDGE_PIXELS * Math.min(width, height)) / REFERENCE_HEIGHT)

/**
 * A ring's light across it, 0 to 1, at `distance` pixels from its middle line.
 * This is the shader's `fs` line for line. The width at half brightness is the
 * thickness; the light is 1 inside it, falls by a smoothstep across the soft
 * edge and is exactly 0 beyond `thickness / 2 + edge`. A ring thinner than its
 * own edge keeps a peak of 1 and is as wide as its edge.
 */
export function ringLight(distance: number, thickness: number, edge: number): number {
  const half = thickness / 2
  const from = Math.max(half - edge, 0)
  const to = half + edge
  const at = clamp((Math.abs(distance) - from) / (to - from), 0, 1)
  return 1 - at * at * (3 - 2 * at)
}

/** How far a ring's light reaches from its middle line, in pixels: past it nothing is drawn. */
export const ringReach = (thickness: number, edge: number) => thickness / 2 + edge

/**
 * How far from the middle a ring goes before it has left the frame, in frame
 * heights: the far corner. `aspect` is the frame's width over its height.
 */
export const exitRadius = (aspect: number) => 0.5 * Math.hypot(aspect, 1)

/** The offset from the ribbon's colour for the ring born `index`th: a triangle wave about the key, so each ring steps a little from the last. */
export function ringHue(index: number, spread: number): number {
  const turn = (index % HUE_PERIOD) / HUE_PERIOD
  return spread * (1 - Math.abs(2 * turn - 1) - 0.5)
}

type Ring = {
  /** The pool's clock at its birth, so its age is the difference. */
  born: number
  /** The shared travel at its birth, so the distance it has come is the difference. */
  travel: number
  life: number
  index: number
}

const emptyRing = (): Ring => ({ born: 0, travel: 0, life: 0, index: 0 })

/**
 * The ring of rings, and the rules for when one is born. It is stepped once a
 * frame with the packet, the real `dt` and the resolved numbers, and read back
 * with `fill`.
 */
export class RingPool {
  private readonly rings: Ring[] = Array.from({ length: RING_POOL }, emptyRing)
  private time = 0
  private travel = 0
  private counter = 0
  /** The last phase seen, NaN before the first, so a ring is not born on a guess made mid-beat. */
  private phase = Number.NaN
  private steady = false

  /** Rings still on their way, on screen or not. Zero means nothing to upload or draw. */
  alive = 0

  /** Every ring born since the pool was made. */
  get born() {
    return this.counter
  }

  step(features: Float32Array, dt: number, params: RingParams) {
    if (!Number.isFinite(dt) || dt <= 0) return
    this.time += dt
    this.travel += params.speed * dt

    const confidence = features[F.tempoConfidence] ?? 0
    if (confidence >= CONFIDENCE_ON) this.steady = true
    else if (confidence < CONFIDENCE_OFF) this.steady = false

    const now = features[F.beatPhase] ?? 0
    const last = this.phase
    if (Number.isFinite(now)) this.phase = now
    this.count(last, this.phase, dt, params)
  }

  /**
   * Births for a step whose phase went from `last` to `now`. The phase wraps
   * from just under 1 to just over 0, and a wrap is a beat; anything that goes
   * backwards, or forwards by more than half a beat in one step, is the tracker
   * moving the phase and not time passing, so it births nothing. Ticks are the
   * multiples of `1 / n` inside the step, and the k-th sits `(to - k / n) /
   * advance` of the step before its end, which is how old it is now.
   */
  private count(last: number, now: number, dt: number, params: RingParams) {
    if (!Number.isFinite(last) || !Number.isFinite(now)) return
    let advance = now - last
    if (advance < -0.5) advance += 1
    if (!(advance > 0 && advance <= 0.5)) return
    if (!this.steady || !(params.intensity > 0)) return
    const n = ringsPerBeat(params.rate)
    const to = last + advance
    for (let tick = Math.floor(last * n) + 1; tick <= Math.floor(to * n); tick += 1)
      this.birth(((to - tick / n) / advance) * dt, params)
  }

  /** One birth, `ago` seconds before the end of this step. The counter picks the slot, so the pool overwrites the oldest. */
  private birth(ago: number, params: RingParams) {
    const index = this.counter
    this.counter += 1
    const ring = this.rings[index % RING_POOL]
    if (!ring) return
    ring.born = this.time - ago
    ring.travel = this.travel - params.speed * ago
    ring.life = params.life
    ring.index = index
  }

  /**
   * Write every ring that can be seen into `out` as `RING_FLOATS` each and say
   * how many. A ring is over when its age reaches its life or when it has
   * reached the corner of the frame, whichever comes first, and it fades to
   * nothing on the way to whichever that is, so it is gone by the time it
   * leaves and never cut off at the edge.
   */
  fill(
    out: Float32Array,
    params: RingParams,
    features: Float32Array,
    width: number,
    height: number,
  ): number {
    let alive = 0
    let count = 0
    const span = exitRadius(width / height) - BIRTH_RADIUS
    for (const ring of this.rings) {
      if (ring.life <= 0) continue
      const distance = this.travel - ring.travel
      const progress = Math.max((this.time - ring.born) / ring.life, distance / span)
      if (!(progress < 1)) continue
      alive += 1
      if (!(params.intensity > 0)) continue
      const light = params.intensity * (1 - progress) * (1 - progress)
      const [red, green, blue] = ribbonColour(features, ringHue(ring.index, params.hueSpread))
      const at = count * RING_FLOATS
      out[at] = red * light
      out[at + 1] = green * light
      out[at + 2] = blue * light
      out[at + 3] = (BIRTH_RADIUS + distance) * height
      count += 1
    }

    this.alive = alive
    return count
  }
}

/** The uniform the shader reads: the canvas, the ring's thickness in pixels and its soft edge in pixels. */
export function writeRingUniform(
  params: RingParams,
  width: number,
  height: number,
  out: Float32Array,
): Float32Array {
  out[0] = width
  out[1] = height
  out[2] = ringThicknessPixels(params.thickness, width, height)
  out[3] = ringEdgePixels(width, height)
  return out
}

/**
 * The most of the frame the rings can cover, as a fraction of its area, with
 * `params` held at what the caller says is the worst it gets: rings born every
 * `1 / (n x bpm / 60)` seconds until the pool is full or the first one is gone,
 * each at full brightness and as wide as its light reaches, and none overlapping
 * another, which only overcounts. A ring's arc is the part of its circle that
 * is inside the frame, so a wide canvas and a tall one are each their own.
 */
export function ringsCoverage(
  params: RingParams,
  bpm: number,
  width: number,
  height: number,
): number {
  const gap = 60 / (ringsPerBeat(params.rate) * bpm)
  const edge = ringEdgePixels(width, height)
  const band = 2 * ringReach(ringThicknessPixels(params.thickness, width, height), edge)
  const exit = exitRadius(width / height)
  let area = 0
  for (let ring = 0; ring < RING_POOL; ring += 1) {
    const age = ring * gap
    const radius = BIRTH_RADIUS + params.speed * age
    if (age >= params.life || radius >= exit) break
    area += arcInside(radius * height, width, height) * band
  }

  return area / (width * height)
}

/**
 * The length of a circle of `radius` pixels about the middle of a frame that is
 * inside it. Each quadrant holds the angles from where the circle crosses the
 * frame's side to where it crosses its top, if it does.
 */
export function arcInside(radius: number, width: number, height: number): number {
  if (!(radius > 0)) return 0
  const cross =
    Math.asin(Math.min(1, height / 2 / radius)) - Math.acos(Math.min(1, width / 2 / radius))
  return 4 * radius * Math.max(0, cross)
}

/** Places between two frames' rings that `ringPassPeak` tries a pixel at. */
const ALIGNMENTS = 16

/**
 * The brightest a pixel gets as a ring sweeps across it, on the canvas the
 * director builds, at 60 frames a second: each frame the canvas keeps
 * `FEEDBACK_KEEP` of what it had less `CANVAS_FLOOR`, and adds one frame of
 * the ring where it now is. The ring starts far enough away that its light is
 * nothing and ends far enough past that the pixel has fallen away again.
 * `speed` is in pixels a second and `thickness` in pixels.
 *
 * A ring that moves several pixels a frame samples a pixel only where the
 * frames happen to fall, so one pixel's peak depends on where it sits between
 * them. The number returned is the best any pixel does, which is what the
 * brightest point of the picture reads, and `ALIGNMENTS` of them are tried.
 */
export function ringPassPeak(intensity: number, speed: number, thickness: number, edge: number) {
  const reach = ringReach(thickness, edge)
  const step = speed / 60
  const frames = Math.ceil((2 * reach + 8) / step) + 240
  let peak = 0
  for (let alignment = 0; alignment < ALIGNMENTS; alignment += 1) {
    let canvas = 0
    for (let frame = 0; frame < frames; frame += 1) {
      const distance = (frame + alignment / ALIGNMENTS) * step - reach - 4
      canvas =
        Math.max(0, canvas * FEEDBACK_KEEP - CANVAS_FLOOR) +
        intensity * ringLight(distance, thickness, edge)
      peak = Math.max(peak, canvas)
    }
  }

  return peak
}
