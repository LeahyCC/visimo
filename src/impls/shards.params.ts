/**
 * The shards' numbers, with no GPU in them: what a shard is born with, where it
 * is at any age, when the pool throws some, and what it costs the frame. Pure
 * TypeScript like `post/params.ts`, so every choice here is unit tested and
 * `ShardsInk.ts` is left moving data into a buffer.
 *
 * The shards are the ink for the drop. A build is one long held breath, so
 * nothing here throws until the packet says the payoff has landed, and then it
 * throws at once. There are two ways in, and only two:
 *
 * - `impact`, the one frame the drop lands, throws a burst. It is spread over a
 *   short span rather than thrown on one frame, and each shard starts on a ring
 *   round the centre and not on the centre itself. Both are for the same
 *   reason: additive light from a hundred shards born on one pixel on one frame
 *   sums to white on that pixel, and the picture is then a white dot for a
 *   frame and not a burst.
 * - a strong hit in the low end or the mids, while `release` is still high,
 *   throws a few more. That is the drop's phrase keeping its shape, and it is
 *   rationed by a token bucket so it can never add up to a flash: see
 *   `MAX_HIT_RATE` and `worstHitCoverage`.
 *
 * Time is the only clock. A shard's place is a closed-form function of its age
 * (`shardPlace`), never a step added up frame by frame, so the same shard is in
 * the same place at 60 and at 144 steps a second, and a shard born part-way
 * through a step is that much older at the end of it rather than a step young.
 * Every choice at birth is a hash of the slot and a birth counter, never
 * `Math.random`, so the same song throws the same shards.
 */
import { F } from '../audio/FeatureExtractor'
import { peakPaletteAt, RIBBON_TINT } from '../post/params'
import { SHARD_KNOBS } from '../presets/knobs'
import type { ShardKnob, Tuning } from '../presets/knobs'

/**
 * Shards the pool holds. The pool is a ring, so a birth takes the slot the
 * oldest one was in, and 192 covers a full burst (160) with room for the hits
 * thrown while it is still flying.
 */
export const SHARD_POOL = 192

/** Floats one shard is uploaded as: x, y, angle, size, red, green, blue, light. */
export const SHARD_FLOATS = 8
export const SHARD_BYTES = SHARD_FLOATS * 4

/** The uniform is one vec4 whose x is the canvas aspect; the rest is padding. */
export const SHARD_UNIFORM_FLOATS = 4

/**
 * The triangle every shard is, in units of its own size, with +x the way it
 * points. The tip is at 1 and the base is behind it, and the three corners sum
 * to nothing on x and on y, so the middle of the triangle is its origin and it
 * tumbles about that. `shaders/shards.wgsl` holds the same three corners, and
 * a test reads the file to keep them together.
 */
export const SHARD_CORNERS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-0.5, 0.34],
  [-0.5, -0.34],
]

/** The triangle's area in units of size squared, for the coverage sums. */
export const SHARD_AREA = 0.51

/**
 * The most hits a second that may throw a few shards, whatever the knob says.
 * The bucket holds one hit and refills at the rate, so in any second there are
 * at most this many refills and the one banked: three, with this at two. Three
 * flashes a second is the line WCAG 2.3.1 draws, and a hit's shards are a
 * percent of the frame at most, so the count is a second guard and not the
 * only one.
 */
export const MAX_HIT_RATE = 2

/** The safe range of every knob, which is what a mapping is clamped to. */
export const SHARD_RANGES: Record<ShardKnob, readonly [number, number]> = {
  burst: [0, 160],
  hitRate: [0, MAX_HIT_RATE],
  speed: [0, 4],
  size: [0, 0.12],
  spin: [0, 12],
  life: [0.2, 3],
  intensity: [0, 2],
}

export const SHARD_DEFAULTS: Record<ShardKnob, number> = {
  burst: 48,
  hitRate: 1.2,
  speed: 1.2,
  size: 0.035,
  spin: 1.5,
  life: 1,
  intensity: 0.9,
}

export type ShardParams = Record<ShardKnob, number>

/** A tuning turned into numbers the pool can use: defaults where unnamed, clamped, `burst` whole. */
export function shardParams(tuning: Tuning): ShardParams {
  const params = { ...SHARD_DEFAULTS }
  for (const name of SHARD_KNOBS) {
    const value = tuning[name]
    const [low, high] = SHARD_RANGES[name]
    if (value !== undefined && Number.isFinite(value))
      params[name] = Math.min(high, Math.max(low, value))
  }

  params.burst = Math.round(params.burst)
  return params
}

/**
 * How long a shard takes to lose 1/e of its speed. A shard is thrown hard and
 * eased to a stop, which reads as a blast and not as a drift, and the easing
 * is closed form so it costs a shard no state.
 */
const DRAG_SECONDS = 0.6

/** The span an impact's births are spread over, in seconds. About nine frames at 60. */
export const BURST_SPREAD_SECONDS = 0.15

/**
 * The closest two bursts may be. The extractor rearms `impact` far more slowly
 * than this, so it never binds on a song; it is here so that this file keeps
 * the flash rule on its own when something other than the extractor fires
 * `impact`, a bench button or a host, and so the rule is a number in one place.
 */
export const BURST_GAP_SECONDS = 0.5

/** Where `impact` fires and rearms, the same two numbers the director reads it with. */
const IMPACT_ON = 0.5
const IMPACT_OFF = 0.3

/** How high `release` must still be for a hit to throw anything, and how hard the hit. */
const HIT_RELEASE_MIN = 0.25
const HIT_STRENGTH_MIN = 0.5

/** Shards one hit throws, and how big they are next to a burst's. */
export const HIT_SHARDS = 3
const HIT_SIZE_SCALE = 0.6

/** Where a shard starts, in frame heights from the middle: a ring, not a point. */
const RING_NEAR = 0.08
const RING_FAR = 0.14

/**
 * How much of the palette the shards are spread over. Under half, for the
 * reason the fluid's emitters are: spread over the whole palette the shards
 * cancel the key and every song shows every colour.
 */
const HUE_SPREAD = 0.4

/** One turn, and the golden ratio's fraction, which spreads any run of births evenly round it. */
const TURN = Math.PI * 2
const GOLDEN = 0.6180339887498949

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
 * A number in [0, 1) for one choice about one shard. The slot and the birth
 * counter are what say which shard, and the channel says which of its choices,
 * so the direction and the size of one shard are unrelated to each other.
 */
export function shardHash(slot: number, counter: number, channel: number): number {
  const seed =
    Math.imul(slot + 1, 0x9e3779b1) ^
    Math.imul(counter + 1, 0x85ebca77) ^
    Math.imul(channel + 1, 0xc2b2ae3d)
  return mix(seed) / 4294967296
}

const fract = (value: number) => value - Math.floor(value)

/** One slot of the pool. Every field is read as a number, so a dead slot is `life` 0. */
export type Shard = {
  /** When it was born, in the pool's own seconds. */
  born: number
  life: number
  /** The unit direction it flies in. */
  dx: number
  dy: number
  /** How far from the middle it starts, and how much farther it goes before it stops. */
  start: number
  reach: number
  /** Which way it points at birth, and how fast it turns from there, in radians a second. */
  heading: number
  spin: number
  size: number
  red: number
  green: number
  blue: number
}

const emptyShard = (): Shard => ({
  born: 0,
  life: 0,
  dx: 0,
  dy: 0,
  start: 0,
  reach: 0,
  heading: 0,
  spin: 0,
  size: 0,
  red: 0,
  green: 0,
  blue: 0,
})

/** A shard's distance from the middle at an age, in frame heights. */
export const shardTravel = (shard: Shard, age: number): number =>
  shard.start + shard.reach * (1 - Math.exp(-age / DRAG_SECONDS))

/** Where a shard is and which way it points at an age, in frame heights with y up. */
export function shardPlace(
  shard: Shard,
  age: number,
  out: { x: number; y: number; angle: number },
): void {
  const along = shardTravel(shard, age)
  out.x = shard.dx * along
  out.y = shard.dy * along
  out.angle = shard.heading + shard.spin * age
}

/**
 * How much of its light a shard has left at an age. Full for a while and then
 * gone quickly, so a shard reads as a solid thing thrown and then vanishing
 * and not as a glow dimming.
 */
export function shardFade(shard: Shard, age: number): number {
  const spent = Math.min(1, Math.max(0, age / shard.life))
  return 1 - spent * spent
}

/** The hits that may throw: the low end and the mids, which is where a drop's weight is. */
const HIT_ROWS = [F.subHit, F.bassHit, F.lowMidHit, F.highMidHit] as const

/**
 * The ring of shards, and the rules for when it throws. It is stepped once a
 * frame with the packet and the real `dt`, and read back with `fill`.
 */
export class ShardPool {
  private readonly shards: Shard[] = Array.from({ length: SHARD_POOL }, emptyShard)
  private time = 0
  private counter = 0
  private armed = true
  private lastBurst = Number.NEGATIVE_INFINITY
  private burstFrom = 0
  private burstCount = 0
  private burstThrown = 0
  private tokens = 1

  /** Shards alive after the last step, on screen or not. Zero means nothing to upload or draw. */
  alive = 0

  /** Every shard born since the pool was made. */
  get thrown() {
    return this.counter
  }

  step(features: Float32Array, dt: number, params: ShardParams) {
    this.time += dt
    const key = features[F.keyHue] ?? 0

    // A crossing with a hysteresis, like the director's: one drop is one burst
    // however long `impact` takes to fall.
    const impact = features[F.impact] ?? 0
    if (impact < IMPACT_OFF) this.armed = true
    else if (this.armed && impact >= IMPACT_ON) {
      this.armed = false
      if (this.time - this.lastBurst >= BURST_GAP_SECONDS && params.burst > 0) {
        this.lastBurst = this.time
        this.burstFrom = this.time
        this.burstCount = params.burst
        this.burstThrown = 0
      }
    }

    // The k-th of a burst is born k/N of the way through the spread, so what
    // this step throws is whatever is due by its end. Its birth time is the due
    // time and not the end of the step, which is what keeps a shard's age the
    // same at any step size.
    while (this.burstThrown < this.burstCount) {
      const due = this.burstFrom + (this.burstThrown * BURST_SPREAD_SECONDS) / this.burstCount
      if (due > this.time) break
      this.born(due, 1, params, key)
      this.burstThrown += 1
    }

    // The bucket fills whether or not anything is asking, so a drop's first hit
    // is not made to wait, and it holds one so a hit never throws twice.
    this.tokens = Math.min(1, this.tokens + Math.min(params.hitRate, MAX_HIT_RATE) * dt)
    if ((features[F.release] ?? 0) >= HIT_RELEASE_MIN && this.tokens >= 1) {
      let strength = 0
      for (const row of HIT_ROWS) strength = Math.max(strength, features[row] ?? 0)
      if (strength >= HIT_STRENGTH_MIN) {
        this.tokens -= 1
        for (let at = 0; at < HIT_SHARDS; at += 1) this.born(this.time, HIT_SIZE_SCALE, params, key)
      }
    }

    let alive = 0
    for (const shard of this.shards) {
      const age = this.time - shard.born
      if (shard.life > 0 && age >= 0 && age < shard.life) alive += 1
    }

    this.alive = alive
  }

  /**
   * One birth. The counter picks the slot, so the ring overwrites the oldest,
   * and the slot and the counter are all the hash reads, so the k-th shard of a
   * song is the same shard however the frames fell.
   */
  private born(at: number, scale: number, params: ShardParams, key: number) {
    const counter = this.counter
    this.counter += 1
    const slot = counter % SHARD_POOL
    const shard = this.shards[slot]
    if (!shard) return
    const pick = (channel: number) => shardHash(slot, counter, channel)

    // The golden ratio spreads a run of births evenly round the circle, which
    // is what stops a burst being a few clumps; the hash only shakes it.
    const turn = (fract(counter * GOLDEN) + (pick(0) - 0.5) * 0.3) * TURN
    shard.dx = Math.cos(turn)
    shard.dy = Math.sin(turn)
    shard.start = RING_NEAR + (RING_FAR - RING_NEAR) * pick(1)
    shard.reach = params.speed * (0.55 + 0.9 * pick(2)) * DRAG_SECONDS
    shard.heading = turn + (pick(3) - 0.5) * 0.6
    shard.spin = params.spin * (0.4 + 1.2 * pick(4)) * (pick(5) < 0.5 ? -1 : 1)
    shard.size = params.size * scale * (0.5 + pick(6))
    shard.life = params.life * (0.7 + 0.6 * pick(7))
    shard.born = at
    const [red, green, blue] = peakPaletteAt(key + RIBBON_TINT + (pick(8) - 0.5) * HUE_SPREAD)
    shard.red = red
    shard.green = green
    shard.blue = blue
  }

  /**
   * Write every shard that could be seen into `out` as `SHARD_FLOATS` each, and
   * say how many. One that has gone past a corner of the frame cannot come back,
   * since it only flies outward, so it is left out rather than drawn off screen.
   * `aspect` is the frame's width over its height.
   */
  fill(out: Float32Array, params: ShardParams, aspect: number): number {
    const reach = 0.5 * Math.hypot(aspect, 1)
    const place = { x: 0, y: 0, angle: 0 }
    let count = 0
    for (const shard of this.shards) {
      const age = this.time - shard.born
      if (shard.life <= 0 || age < 0 || age >= shard.life) continue
      if (shardTravel(shard, age) - shard.size > reach) continue
      shardPlace(shard, age, place)
      const light = params.intensity * shardFade(shard, age)
      const at = count * SHARD_FLOATS
      out[at] = place.x
      out[at + 1] = place.y
      out[at + 2] = place.angle
      out[at + 3] = shard.size
      out[at + 4] = shard.red
      out[at + 5] = shard.green
      out[at + 6] = shard.blue
      out[at + 7] = light
      count += 1
    }

    return count
  }
}

/**
 * The most of the frame one hit's shards can cover, as a fraction of it, with
 * every knob at the top of its range and every shard at its biggest and none
 * overlapping another. It is the number the flash rule leans on: a hit is a
 * couple of percent of the frame, far below the large area WCAG 2.3.1 counts
 * as a flash, so the rate cap is a second guard and not the only one.
 */
export function worstHitCoverage(aspect: number): number {
  const size = SHARD_RANGES.size[1] * HIT_SIZE_SCALE * 1.5
  return (HIT_SHARDS * SHARD_AREA * size * size) / aspect
}
