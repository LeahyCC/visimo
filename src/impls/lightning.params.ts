/**
 * The lightning's numbers, with no GPU in them: when a bolt fires, how it is
 * built, where its light is at any age, and what it costs the frame. Pure
 * TypeScript like `shards.params.ts`, so every choice here is unit tested and
 * `LightningInk.ts` is left moving rows into a buffer.
 *
 * A bolt is the ink for the drop, the way the shards are, so nothing here
 * fires until the packet says the payoff has landed. There are two ways in,
 * and only two:
 *
 * - `impact`, the one frame the drop lands, fires one bolt at full strength.
 *   It is a crossing with a hysteresis, the two levels the director reads the
 *   row with, so one drop is one bolt however long `impact` takes to fall;
 *   and two impact bolts are at least `STRIKE_GAP_SECONDS` apart whatever
 *   fired `impact`, a bench button or a host, so this file keeps the flash
 *   rule on its own.
 * - a strong hit in the low end or the mids, while `release` is still high,
 *   fires one bolt at the hit's strength. A token bucket holds one strike and
 *   refills at the `rate` knob, capped at `MAX_REFILL`, so in any second there
 *   are at most that many refills and the one banked: three, which is the
 *   WCAG 2.3.1 line. The bucket fills whether or not anything is asking, so a
 *   drop's first hit is not made to wait.
 *
 * A bolt is built on the CPU by midpoint displacement and never touched
 * again: its segments are fixed at birth, so the same bolt is drawn at any
 * frame rate because there is nothing to integrate. The light over its life
 * is a closed form of its age, `boltFade`, and a flicker keyed on the age
 * alone, never on the frame count, so 60 and 144 steps a second read the same
 * bolt the same way. Every choice at birth is a hash of the section id and
 * the strike count, never `Math.random`, so the same song throws the same
 * bolts for as long as the ink lives.
 *
 * The bolt stands still, unlike a ring, so its core does sum on the canvas
 * while it lives: see the study doc for the sum and the ceiling. That is why
 * the intensity only ever falls with loudness, never rises.
 */
import { F } from '../audio/FeatureExtractor'
import { peakPaletteAt, RIBBON_TINT } from '../post/params'
import { LIGHTNING_KNOBS } from '../studies/impls'
import type { LightningKnob } from '../studies/impls'

/**
 * Strikes the pool holds. Three a second at the most the bucket allows, each
 * living at most half a second, means at most two are alive at once with
 * room to spare; eight covers an impact bolt and the hits behind it.
 */
export const LIGHTNING_POOL = 8

/** Segments one strike is built of at most, main channel and forks together. */
export const STRIKE_SEGMENTS = 96

/** Floats one segment is uploaded as: the two ends, then the colour, then the light. */
export const SEGMENT_FLOATS = 8

/**
 * Floats in the uniform: the aspect, the height, the width and edge in
 * pixels, and the core's lift, then three of padding, since a uniform
 * binding is a whole number of vec4s.
 */
export const LIGHTNING_UNIFORM_FLOATS = 8

/**
 * The most strikes a second the bucket may refill at. It holds one, and an
 * impact empties it, so in any second there are at most the one banked, the
 * refills, and one impact beside them: three, which is the WCAG 2.3.1 line.
 * The count is one guard and the small area of one bolt is the other.
 */
export const MAX_REFILL = 1.5

/** The closest two impact bolts may be, whoever fired `impact`. */
export const STRIKE_GAP_SECONDS = 0.5

/** Where `impact` fires and rearms, the same two numbers the director reads it with. */
const IMPACT_ON = 0.5
const IMPACT_OFF = 0.3

/** How high `release` must still be for a hit to fire anything, and how hard the hit. */
const HIT_RELEASE_MIN = 0.25
const HIT_STRENGTH_MIN = 0.5

/** The hits that may fire: the low end and the mids, which is where a drop's weight is. */
const HIT_ROWS = [F.subHit, F.bassHit, F.lowMidHit, F.highMidHit] as const

/** Midpoint displacement levels of the main channel: two to the five is 32 segments. */
const MAIN_LEVELS = 5

/** Levels of a fork's channel: two to the three is 8 segments a fork. */
const FORK_LEVELS = 3

/**
 * The sideways kick of a midpoint, as a share of the segment it splits. A
 * bigger number is a more drunken bolt; past about half the displacement is
 * as wide as the piece it displaces and the channel folds back on itself.
 */
const ROUGHNESS = 0.45

/** The share of strikes that start on an edge; the rest start at the centre. */
const EDGE_SHARE = 0.55

/** How far an edge start sits in from the wall, in frame heights. */
const EDGE_INSET = 0.02

/** How much of the key hue the white carries. */
const TINT = 0.35

/** The flicker of the light over the life, in buckets a second, keyed on the age. */
const FLICKER_HZ = 80

/** The hot core's lift over the body of the line. */
export const CORE_LIFT = 1.5

/** The hot core's half width as a share of the line's. */
const CORE_SHARE = 0.45

/** The canvas height the `width` is written against, the same the rings' thickness is. */
const REFERENCE_HEIGHT = 1080

/** The soft edge on each side of the line, in pixels at that height, and the least it is. */
const EDGE_PIXELS = 1
const MIN_EDGE_PIXELS = 0.75

/** The safe range of every knob, inclusive, which is what a mapping is clamped to. */
export const LIGHTNING_RANGES: Record<LightningKnob, readonly [number, number]> = {
  // Strikes a second the bucket refills at; the bucket holds one on top.
  rate: [0, MAX_REFILL],
  // Fork levels of a bolt at a full hit; a weaker hit forks shallower.
  forks: [2, 4],
  // The main channel's length, in short sides of the frame.
  length: [0.1, 1],
  // Pixels on a 1080 high canvas, scaled with the canvas: the width at half brightness.
  width: [0, 8],
  // Seconds a bolt lives.
  life: [0.05, 0.5],
  // Light of one frame at the bolt's brightest.
  intensity: [0, 2],
}

export const LIGHTNING_DEFAULTS: Record<LightningKnob, number> = {
  rate: 0.8,
  forks: 2,
  length: 0.45,
  width: 2.2,
  life: 0.12,
  intensity: 0.9,
}

export type LightningParams = Record<LightningKnob, number>

/** The resolved knobs a tuning turned into: defaults where unnamed, clamped. */
export function lightningParams(
  knobs: Readonly<Partial<Record<string, number>>>,
): LightningParams {
  const params = { ...LIGHTNING_DEFAULTS }
  for (const name of LIGHTNING_KNOBS) {
    const value = knobs[name]
    const [low, high] = LIGHTNING_RANGES[name]
    if (value !== undefined && Number.isFinite(value))
      params[name] = Math.min(high, Math.max(low, value))
  }

  return params
}

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

/**
 * A number in [0, 1) for one choice about one strike. The seed is the
 * section id and the strike count hashed together at the strike, and the
 * channel says which of the strike's choices this is, so the edge a bolt
 * starts on and the offset of its third midpoint are unrelated to each other.
 */
export function boltHash(seed: number, channel: number): number {
  return mix(seed ^ Math.imul(channel + 1, 0x9e3779b1)) / 4294967296
}

/** One segment of a built bolt, in frame heights from the middle with y up. */
export type BoltSegment = {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** A strike: the segments built at birth, when, and how long it lives. */
export type Strike = {
  /** The segments, fixed at birth. */
  segments: Float32Array
  /** How many of the first slots of `segments` are live. */
  count: number
  /** When it was born, in the pool's own seconds. */
  born: number
  life: number
  /** The seed the bolt was built from, so the flicker can be replayed. */
  seed: number
  red: number
  green: number
  blue: number
}

const emptyStrike = (): Strike => ({
  segments: new Float32Array(STRIKE_SEGMENTS * 4),
  count: 0,
  born: 0,
  life: 0,
  seed: 0,
  red: 0,
  green: 0,
  blue: 0,
})

/** One strike slot, for the pool and for tests that build a bolt on its own. */
export const newStrike = (): Strike => emptyStrike()

/**
 * Midpoint displacement between two points: the returned array holds
 * `2^levels + 1` points from `from` to `to`. Each pass splits every segment
 * at its middle and kicks the middle sideways, perpendicular, by up to
 * `ROUGHNESS` of the segment's own length in either direction. The kick of the
 * k-th midpoint at one pass is `pick`, so the same seed rebuilds the same
 * channel and two channels with different seeds share no shape. The ends stay
 * where they were put: a bolt goes where it was aimed.
 */
export function displace(
  from: { x: number; y: number },
  to: { x: number; y: number },
  levels: number,
  pick: (channel: number) => number,
  channelFrom: number,
): { x: number; y: number }[] {
  let points = [from, to]
  for (let level = 0; level < levels; level += 1) {
    const next = [points[0] ?? from] as { x: number; y: number }[]
    for (let at = 0; at + 1 < points.length; at += 1) {
      const a = points[at] ?? from
      const b = points[at + 1] ?? to
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      const dx = b.x - a.x
      const dy = b.y - a.y
      const length = Math.hypot(dx, dy)
      // The perpendicular of a zero-length piece is undefined; it cannot
      // happen from the generator's spacing, and a zero kick is a safe answer.
      const scale = length > 0 ? ROUGHNESS * length : 0
      const kick = (pick(channelFrom + at) - 0.5) * 2 * scale
      next.push(
        { x: midX - (dy / (length || 1)) * kick, y: midY + (dx / (length || 1)) * kick },
        b,
      )
    }

    points = next
    channelFrom += points.length
  }

  return points
}

/**
 * Builds a strike's segments and colour into `strike`. `strength` is how hard
 * the thing that fired it hit: 1 for an impact, the hit row's own value for a
 * hit. The fork levels are `params.forks` at a full hit and shallower below,
 * so the biggest hits carry the deepest forks, and the length has a strike's
 * own variance on top of the knob, so two bolts in a row are never the same
 * size. Every number here is a hash of `seed` and a channel, so a strike is
 * itself wherever the frames fell around it.
 */
export function buildBolt(
  strike: Strike,
  seed: number,
  strength: number,
  params: LightningParams,
  key: number,
): void {
  const pick = (channel: number) => boltHash(seed, channel)
  const originAtEdge = pick(0) < EDGE_SHARE
  const aim = { x: 0, y: 0 }

  if (originAtEdge) {
    // From a seeded edge, aimed roughly at the middle with a seeded spread.
    const edge = Math.floor(pick(1) * 4)
    const along = pick(2)
    const side = edge % 2 === 0 ? 1 : -1
    const start =
      edge < 2
        ? { x: (along * 2 - 1) * 0.5, y: side * 0.5 }
        : { x: side * 0.5, y: (along * 2 - 1) * 0.5 }

    // Aim at the middle with a seeded swing of the arm, then start the bolt a
    // little way in from the wall so the line begins inside the frame.
    const turn = (pick(3) - 0.5) * 1.2
    const cos = Math.cos(turn)
    const sin = Math.sin(turn)
    const inwardX = -start.x * (1 - EDGE_INSET * 2)
    const inwardY = -start.y * (1 - EDGE_INSET * 2)
    aim.x = start.x + inwardX * cos - inwardY * sin
    aim.y = start.y + inwardX * sin + inwardY * cos
    strike.segments[0] = start.x * (1 - EDGE_INSET * 2)
    strike.segments[1] = start.y * (1 - EDGE_INSET * 2)
  } else {
    // From the centre, or a seeded point near it, in any seeded direction.
    const angle = pick(4) * Math.PI * 2
    const jitter = pick(5) * 0.06
    strike.segments[0] = Math.cos(angle + Math.PI / 2) * jitter
    strike.segments[1] = Math.sin(angle + Math.PI / 2) * jitter
    aim.x = Math.cos(angle)
    aim.y = Math.sin(angle)
  }

  const length = params.length * (0.8 + 0.4 * pick(6))
  const end = {
    x: (strike.segments[0] ?? 0) + aim.x * length,
    y: (strike.segments[1] ?? 0) + aim.y * length,
  }

  let written = 0
  const pushSegment = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    if (written >= STRIKE_SEGMENTS) return
    const at = written * 4
    strike.segments[at] = a.x
    strike.segments[at + 1] = a.y
    strike.segments[at + 2] = b.x
    strike.segments[at + 3] = b.y
    written += 1
  }

  // The main channel, then forks off seeded points of it, then forks of the
  // forks down to the fork levels the hit earns. A branch is a half-length
  // channel at a seeded angle off its parent's direction.
  const main = displace(
    { x: strike.segments[0] ?? 0, y: strike.segments[1] ?? 0 },
    end,
    MAIN_LEVELS,
    pick,
    100,
  )
  for (let at = 0; at + 1 < main.length; at += 1) {
    const a = main[at]
    const b = main[at + 1]
    if (a && b) pushSegment(a, b)
  }

  const forks = 2 + Math.round(strength * (params.forks - 2))
  const forkFrom = (
    parent: readonly { x: number; y: number }[],
    depth: number,
    channelFrom: number,
    parentLength: number,
  ) => {
    if (depth > forks || written >= STRIKE_SEGMENTS) return
    const at = Math.max(1, Math.floor(pick(channelFrom) * (parent.length - 2)))
    const base = parent[at]
    const before = parent[at - 1]
    const after = parent[at + 1]
    if (!base || !before || !after) return
    const heading = Math.atan2(after.y - before.y, after.x - before.x)
    // One branch a fork level, sometimes two, which is where the deepest
    // strikes carry a spray and the shallow ones a single offshoot.
    const branches = pick(channelFrom + 1) < 0.4 ? 2 : 1
    for (let branch = 0; branch < branches; branch += 1) {
      if (depth + branch > forks || written >= STRIKE_SEGMENTS) break
      const side = pick(channelFrom + 2 + branch) < 0.5 ? 1 : -1
      const spread = 0.5 + pick(channelFrom + 3 + branch) * 0.8
      const angle = heading + side * spread
      const reach = parentLength * (0.4 + 0.25 * pick(channelFrom + 4 + branch))
      const to = { x: base.x + Math.cos(angle) * reach, y: base.y + Math.sin(angle) * reach }
      const path = displace(base, to, FORK_LEVELS, pick, channelFrom + 10 + branch * 40)
      for (let piece = 0; piece + 1 < path.length; piece += 1) {
        const a = path[piece]
        const b = path[piece + 1]
        if (a && b) pushSegment(a, b)
      }

      forkFrom(path, depth + 1, channelFrom + 20 + branch * 40, reach)
    }
  }

  forkFrom(main, 1, 200, length)

  strike.count = written
  const [red, green, blue] = peakPaletteAt(key + RIBBON_TINT + (pick(90) - 0.5) * 0.06)
  // Near white: the key's colour let in only as far as TINT, so the bolt reads
  // as the key's light and not as a coloured wire.
  strike.red = 1 - TINT + red * TINT
  strike.green = 1 - TINT + green * TINT
  strike.blue = 1 - TINT + blue * TINT
}

/** How much of its light a strike has left at an age. Full, then gone: a strike, not a glow. */
export function boltFade(age: number, life: number): number {
  const spent = Math.min(1, Math.max(0, age / life))
  return 1 - spent * spent
}

/**
 * The flicker across a strike's life, 0.75 to 1, keyed on the age alone: the
 * bucket of the age at `FLICKER_HZ` picks a hash, so the flicker is the same
 * sequence of values at any frame rate and for any step size, and a bolt
 * strobes the way a real one does rather than holding flat.
 */
export function boltFlicker(seed: number, age: number): number {
  return 0.75 + 0.25 * boltHash(seed, 300 + Math.floor(age * FLICKER_HZ))
}

/** The line's width in pixels on this canvas, which is what makes it survive a 4K one. */
export const boltWidthPixels = (width: number, canvasWidth: number, canvasHeight: number) =>
  width * (Math.min(canvasWidth, canvasHeight) / REFERENCE_HEIGHT)

/** The soft edge on each side of the line, in pixels on this canvas. */
export const boltEdgePixels = (canvasWidth: number, canvasHeight: number) =>
  Math.max(MIN_EDGE_PIXELS, (EDGE_PIXELS * Math.min(canvasWidth, canvasHeight)) / REFERENCE_HEIGHT)

/**
 * The light across the line at `distance` pixels from its middle, body and
 * hot core together: 1 at the middle, a smoothstep falloff across the soft
 * edge to nothing at half the width plus the edge, and the core a second,
 * narrower profile on top, lifted by `CORE_LIFT`. This is the shader's `fs`
 * for line; keep the two in step, the tests measure the TypeScript.
 */
export function boltLight(distance: number, width: number, edge: number): number {
  const half = width / 2
  const from = Math.max(half - edge, 0)
  const to = half + edge
  const at = Math.min(Math.max((Math.abs(distance) - from) / (to - from || 1), 0), 1)
  const body = 1 - at * at * (3 - 2 * at)
  const coreHalf = half * CORE_SHARE
  const coreFrom = Math.max(coreHalf - edge, 0)
  const coreTo = coreHalf + edge
  const coreAt = Math.min(Math.max((Math.abs(distance) - coreFrom) / (coreTo - coreFrom || 1), 0), 1)
  const core = 1 - coreAt * coreAt * (3 - 2 * coreAt)
  return body + CORE_LIFT * core
}

/** How far the line's light reaches from its middle, in pixels: past it nothing is drawn. */
export const boltReach = (width: number, edge: number) => width / 2 + edge

/**
 * The ring of strikes, and the rules for when one fires. It is stepped once a
 * frame with the packet, the real `dt` and the resolved numbers, and read
 * back with `fill`. Nothing allocates per frame: a strike owns its segment
 * buffer for as long as the pool lives.
 */
export class LightningPool {
  private readonly strikes: Strike[] = Array.from({ length: LIGHTNING_POOL }, emptyStrike)
  private time = 0
  private counter = 0
  private armed = true
  private lastImpact = Number.NEGATIVE_INFINITY
  private tokens = 1

  /** Strikes alive after the last step. Zero means nothing to upload or draw. */
  alive = 0

  /** Every strike fired since the pool was made. */
  get fired() {
    return this.counter
  }

  /** The pool's own clock, so a test can place an age on it. */
  get clock() {
    return this.time
  }

  step(features: Float32Array, dt: number, params: LightningParams) {
    if (!Number.isFinite(dt) || dt <= 0) return
    this.time += dt
    const key = features[F.keyHue] ?? 0

    // A crossing with a hysteresis, like the director's: one drop is one bolt
    // however long `impact` takes to fall. The impact takes the bucket with
    // it, so a run of hits can never add its flashes to the drop's own:
    // whatever the music does, the two together stay under three a second.
    const impact = features[F.impact] ?? 0
    if (impact < IMPACT_OFF) this.armed = true
    else if (this.armed && impact >= IMPACT_ON) {
      this.armed = false
      if (this.time - this.lastImpact >= STRIKE_GAP_SECONDS) {
        this.lastImpact = this.time
        this.tokens = 0
        this.fire(1, params, key, features)
      }
    }

    // The bucket fills whether or not anything is asking, so a drop's first
    // hit is not made to wait, and it holds one so a hit never fires twice.
    this.tokens = Math.min(1, this.tokens + Math.min(params.rate, MAX_REFILL) * dt)
    if ((features[F.release] ?? 0) >= HIT_RELEASE_MIN && this.tokens >= 1) {
      let strength = 0
      for (const row of HIT_ROWS) strength = Math.max(strength, features[row] ?? 0)
      if (strength >= HIT_STRENGTH_MIN) {
        this.tokens -= 1
        this.fire(strength, params, key, features)
      }
    }

    let alive = 0
    for (const strike of this.strikes) {
      const age = this.time - strike.born
      if (strike.life > 0 && age >= 0 && age < strike.life) alive += 1
    }

    this.alive = alive
  }

  /**
   * One strike. The seed is the section id and the strike count, so the k-th
   * strike of a section is the same bolt wherever the frames fell, and a
   * section that comes back throws the bolts it threw before, from the top.
   */
  private fire(strength: number, params: LightningParams, key: number, features: Float32Array) {
    const counter = this.counter
    this.counter += 1
    const strike = this.strikes[counter % LIGHTNING_POOL]
    if (!strike) return
    const section = Math.round(features[F.section] ?? 0)
    const seed = (Math.imul(section + 1, 0x85ebca77) ^ Math.imul(counter + 1, 0xc2b2ae3d)) >>> 0
    buildBolt(strike, seed, strength, params, key)
    strike.born = this.time
    strike.life = params.life
    strike.seed = seed
  }

  /**
   * Write every segment of every live strike into `out` as `SEGMENT_FLOATS`
   * each and say how many. The light is the intensity times the fade and the
   * flicker of the strike's own age, so a bolt is drawn the same at any frame
   * rate: everything here is a function of seconds, nothing of frames.
   */
  fill(out: Float32Array, params: LightningParams): number {
    let count = 0
    for (const strike of this.strikes) {
      const age = this.time - strike.born
      if (strike.life <= 0 || age < 0 || age >= strike.life) continue
      const light =
        params.intensity * boltFade(age, strike.life) * boltFlicker(strike.seed, age)
      for (let at = 0; at < strike.count; at += 1) {
        const from = at * 4
        const to = count * SEGMENT_FLOATS
        out[to] = strike.segments[from] ?? 0
        out[to + 1] = strike.segments[from + 1] ?? 0
        out[to + 2] = strike.segments[from + 2] ?? 0
        out[to + 3] = strike.segments[from + 3] ?? 0
        out[to + 4] = strike.red
        out[to + 5] = strike.green
        out[to + 6] = strike.blue
        out[to + 7] = light
        count += 1
      }
    }

    return count
  }
}

/** The uniform the shader reads: the aspect, the height, the width and edge in pixels, and the core's lift. */
export function writeLightningUniform(
  params: LightningParams,
  width: number,
  height: number,
  out: Float32Array,
): Float32Array {
  out[0] = width / Math.max(1, height)
  out[1] = height
  out[2] = boltWidthPixels(params.width, width, height)
  out[3] = boltEdgePixels(width, height)
  out[4] = CORE_LIFT
  return out
}

/**
 * The most of the frame the study can light, as a fraction of it, with the
 * mapping held at the worst it reaches: a loud drop at full release. `strikes`
 * is how many bolts may be alive at once, three a second each living the most
 * the life knob allows. Every segment of a worst bolt is counted at full light
 * and none overlapping another, which only overcounts, and the band of a
 * segment is as wide as its light reaches.
 */
export function lightningCoverage(
  params: LightningParams,
  strikes: number,
  width: number,
  height: number,
): number {
  const probe = emptyStrike()
  buildBolt(probe, 1, 1, params, 0)
  let length = 0
  for (let at = 0; at < probe.count; at += 1) {
    const from = at * 4
    length += Math.hypot(
      (probe.segments[from + 2] ?? 0) - (probe.segments[from] ?? 0),
      (probe.segments[from + 3] ?? 0) - (probe.segments[from + 1] ?? 0),
    )
  }

  const shortSide = Math.min(width, height)
  const band = 2 * boltReach(boltWidthPixels(params.width, width, height), boltEdgePixels(width, height))
  return (strikes * length * shortSide * band) / (width * height)
}
