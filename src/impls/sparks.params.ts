/**
 * The sparks' numbers, with no GPU in them: what a spark is born with, where it
 * is at any age, when the pool throws some and what it costs the frame. Pure
 * TypeScript like `shards.params.ts`, so every choice here is unit tested and
 * `SparksInk.ts` is left moving data into a buffer.
 *
 * The shards are the drop's one big gesture and the sparks are the groove's
 * constant small ones: every hat and every crack of a snare throws a few points
 * of light, and the canvas's own trail, which follows the flow, does the rest.
 * A spark does not read the flow. The canvas keeps most of itself every frame
 * and carries it along the flow, so a spark drawn where it is now is already
 * smeared along the current, and a second velocity field in here would only
 * fight the first.
 *
 * Time is the only clock. A spark's place is a closed-form function of its age
 * (`sparkPlace`), the solution of a point under drag and a little gravity, and
 * never a step added up a frame at a time, so the same spark is in the same
 * place at 60 and at 144 steps a second. Every choice at birth is a hash of the
 * slot and a birth counter, never `Math.random`, so the same song throws the
 * same sparks.
 *
 * Where a spark is born is where the hit landed. The packet says where in the
 * spectrum a band's hit sat (`trebleHitCentre`) and how wide it was
 * (`trebleHitWidth`), and the sparks lay that out round a circle the way the
 * spectrum ring does: the pole at the bottom is the low end of the two bands and
 * the one at the top is the treble, the two halves of the circle are mirrors, and
 * the hit's centre is how far round from the bottom the birth is. A hat lands high
 * on the ring and a snare's crack lower, and a wide hit scatters its sparks
 * across more of the ring than a narrow one.
 *
 * Everything is in short sides of the canvas, so a spark flies the same
 * distance on a wide canvas and a tall one, and its size is a number of pixels
 * against 1080 high like the dust's, scaled by the short side so it survives 4K.
 * It has a floor of `MIN_WIDTH_PX` all the same: a quad thinner than that is
 * missed by the rasteriser on some frames and hit on others, which reads as
 * flicker.
 */
import { DEFAULT_BANDS, F } from '../audio/FeatureExtractor'
import { peakPaletteAt, RIBBON_TINT } from '../post/params'
import type { SparksKnob } from '../studies/impls'
import { hash01 } from './streaks.params'

/**
 * Sparks the pool holds. The pool is a ring, so a birth takes the slot the
 * oldest one was in. The most the knobs can keep alive at once is
 * `sparksAlive` at the top of every range, 66, so a live spark is never
 * overwritten, and 96 leaves room for it.
 */
export const SPARK_POOL = 96

/**
 * Floats a spark is uploaded as: the centre of its quad in pixels from the top
 * left, the unit direction it points in, its half length and half width in
 * pixels, and its light as a colour (already scaled by intensity and fade).
 */
export const SPARK_FLOATS = 9
export const SPARK_BYTES = SPARK_FLOATS * 4

/** Where a spark's fields sit in its nine floats; the shader reads them by the same order. */
export const SPARK_AT = {
  x: 0,
  y: 1,
  dx: 2,
  dy: 3,
  halfLength: 4,
  halfWidth: 5,
  red: 6,
  green: 7,
  blue: 8,
} as const

/** The uniform is one vec4 whose xy is the canvas in pixels; the rest is padding. */
export const SPARK_UNIFORM_FLOATS = 4

/** What each knob may reach, inclusive. `sparkParams` clamps to it and the registry guard holds every study to it. */
export const SPARK_RANGES: Record<SparksKnob, readonly [number, number]> = {
  // Sparks a second at most, whatever the hits do. The bucket that keeps it is
  // in `SparkPool.step`.
  rate: [0, 60],
  // Sparks one hit throws, whole. A few, so the top of it is eight.
  count: [0, 8],
  // How fast a spark leaves the ring, in short sides a second.
  speed: [0, 1.2],
  // Seconds a spark lives, before its own spread; under a second after it.
  life: [0.1, 0.8],
  // A spark's widest across, in pixels on a 1080 high canvas.
  size: [0, 6],
  // Light added on one frame at the head of a spark. See the study for how it was set.
  intensity: [0, 4],
  // Palette units either side of the ribbon's colour at the key, as the other inks' is.
  hueSpread: [0, 0.3],
}

export type SparkParams = Record<SparksKnob, number>

const KNOBS = Object.keys(SPARK_RANGES) as SparksKnob[]

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** Linear blend from `low` to `high`; generic, so it says nothing about sparks. */
const mix = (low: number, high: number, amount: number) => low + (high - low) * amount

/**
 * The knobs a study resolved, clamped to their ranges, `count` whole. A missing
 * or non-finite one is 0, or the floor of its range where 0 is out of it, so an
 * ink handed nothing throws nothing.
 */
export function sparkParams(knobs: Readonly<Partial<Record<string, number>>>): SparkParams {
  const out = {} as SparkParams
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = SPARK_RANGES[knob]
    out[knob] = value !== undefined && Number.isFinite(value) ? clamp(value, low, high) : low
  }

  out.count = Math.round(out.count)
  return out
}

// Which hash a quantity reads, so two of them never move together.
const SALT = {
  side: 1,
  scatter: 2,
  cone: 3,
  speed: 4,
  life: 5,
  size: 6,
  hue: 7,
} as const

/** The canvas height a `size` is written against, the same the dust's is. */
const REFERENCE_HEIGHT = 1080

/** How fast a spark loses its speed to the air, in 1/e a second: 2 is a spark at rest in half a second. */
export const DRAG = 2

/** A little gravity, in short sides a second squared: over its longest life a spark sinks about 7 percent of the short side. */
export const GRAVITY = 0.25

/**
 * How long the streak behind a spark is, in seconds of its own travel: its
 * length is its width plus this much of its speed. A spark at the top of the
 * speed range leaves a streak of about 6 percent of the short side, and one that
 * has slowed to nothing is a round point.
 */
export const STREAK_SECONDS = 0.03

/** Where along its quad the bright head sits, as a share of the way from the middle to the front. */
export const HEAD_AT = 0.55

/** Where a spark is born, in short sides from the middle. */
export const RING_RADIUS = 0.2

/** How far either side of straight out a spark may be thrown, in radians. */
const CONE = 0.4

/** A spark's own speed, life and width against the knob, so they are never all alike. */
export const SPEED_SHARE = [0.6, 1.25] as const
export const LIFE_SHARE = [0.6, 1.2] as const
export const SIZE_SHARE = [0.6, 1.4] as const

/** A hit's own strength scales its speed and light between these. */
const STRENGTH_SHARE = [0.6, 1] as const

/** The thinnest a spark is, in device pixels, whatever the canvas. */
export const MIN_WIDTH_PX = 2

/** How far a spark is taken toward white at birth, before it cools to the palette. */
const HOT = 0.7

/**
 * The most of a band's level under which a hit is not heard. The extractor
 * never fires one there, but the bench's synthetic packet writes hits whatever
 * its level, and a silent packet has to draw nothing.
 */
const SILENT_BAND = 0.01

const TAU = Math.PI * 2

/** How far under a whole spark the bucket may be and still count as holding it. */
const TOKEN_EPSILON = 1e-9

/**
 * The two bands the sparks answer to, each with the rows that say how loud it
 * is and where its last hit landed. The treble is first so it wins a tie: a hat
 * and a crack of a snare on one frame is one struck sound, and the hat is the
 * spark's.
 */
const HIT_BANDS = [
  {
    hit: F.trebleHit,
    level: F.treble,
    centre: F.trebleHitCentre,
    width: F.trebleHitWidth,
  },
  {
    hit: F.highMidHit,
    level: F.highMid,
    centre: F.highMidHitCentre,
    width: F.highMidHitWidth,
  },
] as const

/**
 * Places in the packet's own units, fractions of the octaves from the lowest
 * band edge to the highest. The two bands cover from where highMid starts to
 * where treble ends, and that stretch is what is laid round the ring.
 */
const SPAN_OCTAVES = Math.log2(
  (DEFAULT_BANDS[DEFAULT_BANDS.length - 1]?.high ?? 16000) / (DEFAULT_BANDS[0]?.low ?? 20),
)
const placeOf = (hz: number) => Math.log2(hz / (DEFAULT_BANDS[0]?.low ?? 20)) / SPAN_OCTAVES
const PLACE_LOW = placeOf(DEFAULT_BANDS[3]?.low ?? 1000)
const PLACE_HIGH = placeOf(DEFAULT_BANDS[4]?.high ?? 16000)

/** A hit the pool answers to: how hard, and where it landed in the packet's own units. */
export type SparkHit = { strength: number; centre: number; width: number }

/**
 * The hit this frame throws sparks for, or null. The stronger of the two bands'
 * hits, and only from a band that is sounding.
 */
export function sparkHit(features: Float32Array): SparkHit | null {
  let best: SparkHit | null = null
  for (const band of HIT_BANDS) {
    const strength = features[band.hit] ?? 0
    if (!(strength > 0) || !((features[band.level] ?? 0) > SILENT_BAND)) continue
    if (best && strength <= best.strength) continue
    best = {
      strength: clamp(strength, 0, 1),
      centre: features[band.centre] ?? 0,
      width: features[band.width] ?? 0,
    }
  }

  return best
}

/**
 * How far round the ring a hit lands, 0 at the bottom pole and 1 at the top, as
 * the hit's centre laid between the two bands' edges and then scattered by its
 * width. `pick` is a hash in [0, 1), so the same hit throws the same fan.
 */
export function ringPosition(centre: number, width: number, pick: number): number {
  const span = PLACE_HIGH - PLACE_LOW
  const at = (Number.isFinite(centre) ? centre : PLACE_LOW) - PLACE_LOW
  const scatter = Number.isFinite(width) ? Math.max(0, width) : 0
  return clamp(at / span + (pick - 0.5) * 2 * (scatter / span), 0, 1)
}

/** One slot of the pool. A dead slot is `life` 0. */
export type Spark = {
  /** When it was born, in the pool's own seconds. */
  born: number
  life: number
  /** Where it starts and how fast it leaves, in short sides from the middle with y up. */
  x: number
  y: number
  vx: number
  vy: number
  /** Its width in pixels on a 1080 high canvas. */
  size: number
  /** How much of the intensity it carries: a soft hit throws dimmer sparks. */
  gain: number
  red: number
  green: number
  blue: number
}

const emptySpark = (): Spark => ({
  born: 0,
  life: 0,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  size: 0,
  gain: 0,
  red: 0,
  green: 0,
  blue: 0,
})

/**
 * One axis of a point under drag `DRAG` and a constant acceleration: the
 * velocity drifts to the terminal `pull / DRAG` at a rate of `DRAG`, and the
 * place is the integral of that. Closed form, so it costs no state and does not
 * depend on the step.
 */
const settled = (start: number, speed: number, pull: number, age: number) => {
  const terminal = pull / DRAG
  const gone = Math.exp(-DRAG * age)
  return {
    place: start + terminal * age + ((speed - terminal) * (1 - gone)) / DRAG,
    speed: terminal + (speed - terminal) * gone,
  }
}

/** Where a spark is and how fast it is going at an age, in short sides with y up. */
export function sparkPlace(
  spark: Spark,
  age: number,
  out: { x: number; y: number; vx: number; vy: number },
): void {
  const across = settled(spark.x, spark.vx, 0, age)
  const down = settled(spark.y, spark.vy, -GRAVITY, age)
  out.x = across.place
  out.y = down.place
  out.vx = across.speed
  out.vy = down.speed
}

/** How much light a spark has left at an age: bright and then gone, so it reads as a spark and not a glow. */
export function sparkFade(spark: Spark, age: number): number {
  const spent = clamp(age / spark.life, 0, 1)
  return Math.pow(1 - spent, 1.5)
}

/** How white a spark is at an age: `HOT` of the way at birth and the palette's own colour once it has cooled. */
export const sparkHeat = (spark: Spark, age: number): number => {
  const left = 1 - clamp(age / spark.life, 0, 1)
  return HOT * left * left
}

/**
 * The most sparks the knobs can keep alive at once: one hit's worth banked in
 * the bucket, and the rate for as long as the longest spark lives. It is what
 * the pool has to hold, and what a coverage bound may count for a study that
 * does not reach the top of every range.
 */
export const sparksAlive = (params: SparkParams): number =>
  Math.min(SPARK_POOL, Math.ceil(params.count + params.rate * params.life * LIFE_SHARE[1]))

/**
 * The ring of sparks, and the rules for when it throws. It is stepped once a
 * frame with the packet and the real `dt`, and read back with `fill`.
 *
 * The rate is a bucket. It refills at `rate` sparks a second and holds one
 * hit's worth, and a hit throws as many sparks as it finds in it, up to
 * `count`. In any span of `T` seconds the sparks born are at most
 * `count + rate * T`, whatever the packet does: a run of sixteenth-note hats at
 * 200 beats a minute cannot throw more than the knob allows. Whole hits are not
 * what the bucket counts, because a hit is all or nothing and the hits and the
 * refill do not fall on the same frames: a hat that finds three sparks in it
 * throws three, where waiting for a full hit's worth skipped one hat in every
 * two or three and lost a third of the rate.
 */
export class SparkPool {
  private readonly sparks: Spark[] = Array.from({ length: SPARK_POOL }, emptySpark)
  private time = 0
  private counter = 0
  // Full to begin with, so a song's first hit is not made to wait for it.
  private tokens = Number.POSITIVE_INFINITY

  /** Sparks alive after the last step, on screen or not. Zero means nothing to upload or draw. */
  alive = 0

  /** Every spark born since the pool was made. */
  get thrown() {
    return this.counter
  }

  step(features: Float32Array, dt: number, params: SparkParams) {
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0
    this.time += step
    this.tokens = Math.min(params.count, this.tokens + params.rate * step)

    // A hit spends what is in the bucket, up to a hit's worth, so every hat
    // throws something while the bucket lasts and a run of them throws what the
    // rate refills between them. The epsilon is for a refill that lands a
    // rounding error under a whole spark.
    const hit = sparkHit(features)
    const spend = Math.min(params.count, Math.floor(this.tokens + TOKEN_EPSILON))
    if (hit && spend > 0) {
      this.tokens -= spend
      const key = features[F.keyHue] ?? 0
      for (let at = 0; at < spend; at += 1) this.born(hit, params, key)
    }

    let alive = 0
    for (const spark of this.sparks) {
      const age = this.time - spark.born
      if (spark.life > 0 && age >= 0 && age < spark.life) alive += 1
    }

    this.alive = alive
  }

  /**
   * One birth. The counter picks the slot, so the ring overwrites the oldest,
   * and the slot and the counter are all the hash reads, so the k-th spark of
   * a song is the same spark however the frames fell.
   */
  private born(hit: SparkHit, params: SparkParams, key: number) {
    const counter = this.counter
    this.counter += 1
    const slot = counter % SPARK_POOL
    const spark = this.sparks[slot]
    if (!spark) return
    const pick = (channel: number) => hash01(slot, counter, channel)

    // The two halves of the ring are mirrors, so which one a spark is on is a
    // coin the hash tosses; the place round from the bottom is the hit's.
    const round = ringPosition(hit.centre, hit.width, pick(SALT.scatter)) * (TAU / 2)
    const side = pick(SALT.side) < 0.5 ? -1 : 1
    const outX = side * Math.sin(round)
    const outY = -Math.cos(round)
    const heading = Math.atan2(outY, outX) + (pick(SALT.cone) - 0.5) * 2 * CONE
    const strength = mix(STRENGTH_SHARE[0], STRENGTH_SHARE[1], hit.strength)
    const speed = params.speed * mix(SPEED_SHARE[0], SPEED_SHARE[1], pick(SALT.speed)) * strength

    spark.x = outX * RING_RADIUS
    spark.y = outY * RING_RADIUS
    spark.vx = Math.cos(heading) * speed
    spark.vy = Math.sin(heading) * speed
    spark.life = params.life * mix(LIFE_SHARE[0], LIFE_SHARE[1], pick(SALT.life))
    spark.size = params.size * mix(SIZE_SHARE[0], SIZE_SHARE[1], pick(SALT.size))
    spark.gain = strength
    spark.born = this.time
    const [red, green, blue] = peakPaletteAt(
      key + RIBBON_TINT + (pick(SALT.hue) - 0.5) * params.hueSpread,
    )
    spark.red = red
    spark.green = green
    spark.blue = blue
  }

  /**
   * Write every spark that is on the canvas into `out` as `SPARK_FLOATS` each
   * (`SPARK_AT`), and say how many. Nothing is written for one that has flown
   * off the canvas, since drag and a little gravity never bring it back.
   */
  fill(out: Float32Array, params: SparkParams, width: number, height: number): number {
    const short = Math.min(width, height)
    const place = { x: 0, y: 0, vx: 0, vy: 0 }
    let count = 0
    for (const spark of this.sparks) {
      const age = this.time - spark.born
      if (spark.life <= 0 || age < 0 || age >= spark.life) continue
      sparkPlace(spark, age, place)
      const speed = Math.hypot(place.vx, place.vy)
      const halfWidth = 0.5 * sparkWidthPixels(spark.size, short)
      const halfLength = halfWidth + 0.5 * speed * short * STREAK_SECONDS
      const headX = width / 2 + place.x * short
      const headY = height / 2 - place.y * short
      if (
        headX + halfLength < 0 ||
        headX - halfLength > width ||
        headY + halfLength < 0 ||
        headY - halfLength > height
      )
        continue
      // The direction it is going, on the screen where y runs down. A spark
      // that has all but stopped points the way it is falling.
      const dx = speed > 1e-6 ? place.vx / speed : 0
      const dy = speed > 1e-6 ? -place.vy / speed : 1
      const heat = sparkHeat(spark, age)
      const light = params.intensity * spark.gain * sparkFade(spark, age)
      const at = count * SPARK_FLOATS
      out[at + SPARK_AT.x] = headX - dx * HEAD_AT * halfLength
      out[at + SPARK_AT.y] = headY - dy * HEAD_AT * halfLength
      out[at + SPARK_AT.dx] = dx
      out[at + SPARK_AT.dy] = dy
      out[at + SPARK_AT.halfLength] = halfLength
      out[at + SPARK_AT.halfWidth] = halfWidth
      out[at + SPARK_AT.red] = mix(spark.red, 1, heat) * light
      out[at + SPARK_AT.green] = mix(spark.green, 1, heat) * light
      out[at + SPARK_AT.blue] = mix(spark.blue, 1, heat) * light
      count += 1
    }

    return count
  }
}

/** A spark's width in pixels on this canvas: the size against 1080 high, scaled by the short side, and never thinner than `MIN_WIDTH_PX`. */
export const sparkWidthPixels = (size: number, short: number): number =>
  Math.max(MIN_WIDTH_PX, size * (short / REFERENCE_HEIGHT))

/** The uniform the shader reads: the canvas in pixels. */
export function writeSparkUniform(width: number, height: number, out: Float32Array): Float32Array {
  out[0] = width
  out[1] = height
  out[2] = 0
  out[3] = 0
  return out
}

/**
 * The most of the frame `sparks` sparks can cover, as a fraction of its area,
 * at these knobs: each as the whole quad it is drawn in, at its widest and with
 * the longest streak the speed allows, none overlapping another. It is an upper
 * bound, since the shader tapers the quad to a comet and its edges are dim, and
 * it is the number the study's comment quotes. Sizes scale with the short side,
 * so it is largest on a square canvas and falls as the canvas gets longer.
 */
export function sparkCoverage(
  params: SparkParams,
  width: number,
  height: number,
  sparks: number = sparksAlive(params),
): number {
  const short = Math.min(width, height)
  const wide = sparkWidthPixels(params.size * SIZE_SHARE[1], short)
  const long = wide + params.speed * SPEED_SHARE[1] * short * STREAK_SECONDS
  return (Math.min(sparks, SPARK_POOL) * wide * long) / (width * height)
}

/** The worst case there is: every knob at the top of its range and the pool full. */
export function worstSparkCoverage(width: number, height: number): number {
  const top = {} as SparkParams
  for (const knob of KNOBS) top[knob] = SPARK_RANGES[knob][1]
  return sparkCoverage(top, width, height, SPARK_POOL)
}
