import { describe, expect, it } from 'vitest'

import { DEFAULT_BANDS, F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { peakPaletteAt, RIBBON_TINT } from '../post/params'
import {
  DRAG,
  GRAVITY,
  HEAD_AT,
  MIN_WIDTH_PX,
  RING_RADIUS,
  ringPosition,
  SPARK_AT,
  SPARK_FLOATS,
  SPARK_POOL,
  SPARK_RANGES,
  sparkCoverage,
  sparkFade,
  sparkHit,
  sparkParams,
  sparkPlace,
  SparkPool,
  sparksAlive,
  sparkWidthPixels,
  STREAK_SECONDS,
  worstSparkCoverage,
} from './sparks.params'
import type { Spark, SparkParams } from './sparks.params'

/** A packet with these rows set, keyed by row number, and everything else silent. */
const packet = (rows: Record<number, number> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [row, value] of Object.entries(rows)) out[Number(row)] = value
  return out
}

/** A treble hit of a strength, from a band that is sounding, landing where it says. */
const hat = (strength = 0.8, centre = 0.9, width = 0.05) => ({
  [F.trebleHit]: strength,
  [F.treble]: 0.6,
  [F.trebleHitCentre]: centre,
  [F.trebleHitWidth]: width,
})

const PARAMS = sparkParams({
  rate: 24,
  count: 4,
  speed: 0.5,
  life: 0.55,
  size: 4,
  intensity: 2.4,
  hueSpread: 0.12,
})

const WIDTH = 1920
const HEIGHT = 1080

/**
 * A pool stepped for `seconds` at `rate` steps a second. `events` are packets
 * that land on one step only, keyed by the time they land at; `steady` is in
 * every step. An event time that is a whole number of steps at both 60 and 144
 * lands at the same instant at both, which is what the frame rate test needs.
 */
function play(
  rate: number,
  seconds: number,
  events: readonly (readonly [number, Record<number, number>])[] = [],
  steady: Record<number, number> = {},
  params: SparkParams = PARAMS,
) {
  const pool = new SparkPool()
  const at = new Map(events.map(([time, rows]) => [Math.round(time * rate), rows]))
  for (let step = 1; step <= Math.round(seconds * rate); step += 1)
    pool.step(packet({ ...steady, ...at.get(step) }), 1 / rate, params)
  return pool
}

const rowsOf = (pool: SparkPool, params: SparkParams = PARAMS, width = WIDTH, height = HEIGHT) => {
  const out = new Float32Array(SPARK_POOL * SPARK_FLOATS)
  const count = pool.fill(out, params, width, height)
  return { out, count }
}

describe('the numbers a tuning becomes', () => {
  it('throws nothing when nothing is named', () => {
    const empty = sparkParams({})
    expect(empty.count).toBe(0)
    expect(empty.rate).toBe(0)
    expect(empty.intensity).toBe(0)
    // A life of nothing would divide by zero, so it sits at the floor of its range.
    expect(empty.life).toBe(SPARK_RANGES.life[0])
  })

  it('clamps every knob to its range, whole for a count', () => {
    const wild = sparkParams({
      rate: 1000,
      count: 99,
      speed: -3,
      life: 0,
      size: 50,
      intensity: 90,
      hueSpread: 4,
    })
    expect(wild.rate).toBe(SPARK_RANGES.rate[1])
    expect(wild.count).toBe(SPARK_RANGES.count[1])
    expect(wild.speed).toBe(0)
    expect(wild.life).toBe(SPARK_RANGES.life[0])
    expect(wild.size).toBe(SPARK_RANGES.size[1])
    expect(wild.intensity).toBe(SPARK_RANGES.intensity[1])
    expect(wild.hueSpread).toBe(SPARK_RANGES.hueSpread[1])
    expect(sparkParams({ count: 3.6 }).count).toBe(4)
  })

  it('ignores a number that is not one', () => {
    const odd = sparkParams({ speed: Number.NaN, size: Number.POSITIVE_INFINITY })
    expect(odd.speed).toBe(0)
    expect(odd.size).toBe(0)
  })
})

describe('which hits throw', () => {
  it('answers to the treble and the upper mids and to nothing else', () => {
    const high = { [F.highMidHit]: 0.7, [F.highMid]: 0.6 }
    expect(sparkHit(packet(hat()))?.strength).toBeCloseTo(0.8)
    expect(sparkHit(packet(high))?.strength).toBeCloseTo(0.7)
    for (const row of [F.subHit, F.bassHit, F.lowMidHit, F.onset])
      expect(sparkHit(packet({ [row]: 1, [F.sub]: 1, [F.bass]: 1, [F.lowMid]: 1 }))).toBeNull()
  })

  it('takes the stronger of two hits on one frame, and the treble on a tie', () => {
    const both = packet({
      ...hat(0.5),
      [F.highMidHit]: 0.9,
      [F.highMid]: 0.6,
      [F.highMidHitCentre]: 0.7,
    })
    expect(sparkHit(both)?.strength).toBeCloseTo(0.9)
    expect(sparkHit(both)?.centre).toBeCloseTo(0.7)
    const tie = packet({
      ...hat(0.5, 0.95),
      [F.highMidHit]: 0.5,
      [F.highMid]: 0.6,
      [F.highMidHitCentre]: 0.7,
    })
    expect(sparkHit(tie)?.centre).toBeCloseTo(0.95)
  })

  it('does not hear a hit from a band that is not sounding', () => {
    expect(sparkHit(packet({ ...hat(), [F.treble]: 0 }))).toBeNull()
    const pool = play(60, 2, [], { ...hat(), [F.treble]: 0 })
    expect(pool.thrown).toBe(0)
  })

  it('throws nothing on a silent packet however long it runs', () => {
    const pool = play(60, 30)
    expect(pool.thrown).toBe(0)
    expect(pool.alive).toBe(0)
    expect(rowsOf(pool).count).toBe(0)
  })

  it('throws exactly `count` for a hit, and nothing until the next', () => {
    const pool = play(60, 0.6, [[0.5, hat()]])
    expect(pool.thrown).toBe(PARAMS.count)
    expect(pool.alive).toBe(PARAMS.count)
    expect(rowsOf(pool).count).toBe(PARAMS.count)
  })

  it('throws nothing with a count or a rate of nothing', () => {
    expect(play(60, 2, [], hat(), sparkParams({ ...PARAMS, count: 0 })).thrown).toBe(0)
    // With no rate the bucket never refills, so only the first hit has anything to spend.
    expect(play(60, 2, [], hat(), sparkParams({ ...PARAMS, rate: 0 })).thrown).toBe(PARAMS.count)
  })
})

describe('where a spark is born', () => {
  it('lays a hit’s centre round the ring from the bottom pole to the top', () => {
    const lowEdge = DEFAULT_BANDS[3]?.low ?? 1000
    const highEdge = DEFAULT_BANDS[4]?.high ?? 16000
    const place = (hz: number) => Math.log2(hz / 20) / Math.log2(16000 / 20)
    expect(ringPosition(place(lowEdge), 0, 0.5)).toBeCloseTo(0, 6)
    expect(ringPosition(place(highEdge), 0, 0.5)).toBeCloseTo(1, 6)
    expect(ringPosition(place(Math.sqrt(lowEdge * highEdge)), 0, 0.5)).toBeGreaterThan(0.3)
    expect(ringPosition(place(Math.sqrt(lowEdge * highEdge)), 0, 0.5)).toBeLessThan(0.7)
    // A hit outside the two bands is held to the ends and never wraps.
    expect(ringPosition(0, 0, 0.5)).toBe(0)
    expect(ringPosition(2, 0, 0.5)).toBe(1)
  })

  it('scatters a wide hit across more of the ring than a narrow one, and the same way every time', () => {
    const spread = (width: number) => {
      const values = Array.from({ length: 200 }, (_, at) => ringPosition(0.85, width, at / 200))
      return Math.max(...values) - Math.min(...values)
    }

    expect(spread(0)).toBe(0)
    expect(spread(0.2)).toBeGreaterThan(spread(0.02) * 5)
    expect(ringPosition(0.85, 0.1, 0.3)).toBe(ringPosition(0.85, 0.1, 0.3))
  })

  it('ignores a centre or a width that is not a number', () => {
    expect(Number.isFinite(ringPosition(Number.NaN, Number.NaN, 0.5))).toBe(true)
  })

  // A hat lands high on the ring and a snare's crack lower. y runs down on the
  // screen, so higher means a smaller y than the middle of the canvas.
  it('puts a high hit above the middle and a low one below it', () => {
    const height = (centre: number) => {
      const pool = play(60, 0.05, [[1 / 60, hat(0.8, centre, 0)]])
      const { out, count } = rowsOf(pool)
      let sum = 0
      for (let at = 0; at < count; at += 1) sum += out[at * SPARK_FLOATS + SPARK_AT.y] ?? 0
      return sum / count - HEIGHT / 2
    }

    expect(height(0.99)).toBeLessThan(-0.1 * HEIGHT)
    expect(height(0.59)).toBeGreaterThan(0.1 * HEIGHT)
  })

  it('starts every spark on the ring, whatever the canvas', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1000, 1000],
    ] as const) {
      const pool = new SparkPool()
      pool.step(packet(hat(0.8, 0.8, 0.1)), 1 / 60, PARAMS)
      const { out, count } = rowsOf(pool, PARAMS, width, height)
      expect(count).toBe(PARAMS.count)
      for (let at = 0; at < count; at += 1) {
        // The bright head is where the spark is; the quad's middle sits behind it.
        const dx = out[at * SPARK_FLOATS + SPARK_AT.dx] ?? 0
        const dy = out[at * SPARK_FLOATS + SPARK_AT.dy] ?? 0
        const half = out[at * SPARK_FLOATS + SPARK_AT.halfLength] ?? 0
        const headX = (out[at * SPARK_FLOATS + SPARK_AT.x] ?? 0) + dx * HEAD_AT * half
        const headY = (out[at * SPARK_FLOATS + SPARK_AT.y] ?? 0) + dy * HEAD_AT * half
        const from = Math.hypot(headX - width / 2, headY - height / 2)
        expect(from / Math.min(width, height)).toBeCloseTo(RING_RADIUS, 5)
      }
    }
  })
})

describe('the same song throws the same sparks', () => {
  it('draws the same rows from two pools given the same packets', () => {
    const events: [number, Record<number, number>][] = [
      [0.5, hat(0.8, 0.9, 0.1)],
      [1, hat(0.6, 0.8, 0.05)],
      [1.25, hat(0.9, 0.95, 0.2)],
    ]
    const first = rowsOf(play(60, 1.5, events))
    const second = rowsOf(play(60, 1.5, events))
    expect(first.count).toBeGreaterThan(0)
    expect(second.out).toEqual(first.out)
  })

  it('spreads the choices evenly, so no two sparks of a hit are alike', () => {
    const pool = play(
      60,
      0.05,
      [[1 / 60, hat(0.8, 0.9, 0.1)]],
      {},
      sparkParams({ ...PARAMS, count: 8 }),
    )
    const { out, count } = rowsOf(pool)
    const lengths = new Set<number>()
    for (let at = 0; at < count; at += 1)
      lengths.add(out[at * SPARK_FLOATS + SPARK_AT.halfLength] ?? 0)
    expect(count).toBe(8)
    expect(lengths.size).toBe(8)
  })
})

describe('the rate limit', () => {
  // A hit on every step is the worst a packet can do: each frame says a hat.
  const hammer = (rate: number, seconds: number, params: SparkParams) =>
    play(rate, seconds, [], hat(), params).thrown

  it('never throws more than the bank and the rate allow, at any frame rate', () => {
    for (const rate of [30, 60, 144, 240]) {
      const thrown = hammer(rate, 10, PARAMS)
      expect(thrown).toBeLessThanOrEqual(PARAMS.count + PARAMS.rate * 10)
      // And it does use what it is allowed: within a hit of the ceiling.
      expect(thrown).toBeGreaterThanOrEqual(PARAMS.rate * 10 - PARAMS.count)
    }
  })

  it('holds a run of sixteenth-note hats at 200 beats a minute to the knob', () => {
    // A sixteenth at 200 is 75 ms: 13 hits a second, 53 sparks a second at 4 each.
    const params = sparkParams({ ...PARAMS, rate: 20, count: 4 })
    const pool = new SparkPool()
    const dt = 1 / 144
    let next = 0
    for (let step = 1; step <= 144 * 10; step += 1) {
      const now = step * dt
      const due = now >= next
      if (due) next += 0.075
      pool.step(packet(due ? hat() : {}), dt, params)
    }

    expect(pool.thrown).toBeLessThanOrEqual(20 * 10 + 4)
    expect(pool.thrown).toBeGreaterThan(20 * 10 * 0.8)
  })

  it('counts any window of a second the same way', () => {
    const pool = new SparkPool()
    const params = PARAMS
    const dt = 1 / 60
    const history: number[] = []
    for (let step = 0; step < 60 * 10; step += 1) {
      pool.step(packet(hat()), dt, params)
      history.push(pool.thrown)
    }

    for (let from = 0; from + 60 < history.length; from += 7) {
      const born = (history[from + 60] ?? 0) - (history[from] ?? 0)
      expect(born).toBeLessThanOrEqual(params.rate + params.count)
    }
  })

  it('cannot keep more alive than the pool holds, at the top of every range', () => {
    const top = {} as SparkParams
    for (const knob of Object.keys(SPARK_RANGES) as (keyof SparkParams)[])
      top[knob] = SPARK_RANGES[knob][1]
    expect(sparksAlive(top)).toBeLessThanOrEqual(SPARK_POOL)
    const pool = new SparkPool()
    let most = 0
    for (let step = 0; step < 60 * 20; step += 1) {
      pool.step(packet(hat()), 1 / 60, top)
      most = Math.max(most, pool.alive)
    }

    expect(most).toBeGreaterThan(40)
    expect(most).toBeLessThanOrEqual(sparksAlive(top))
  })
})

describe('where a spark is, at any age', () => {
  const spark: Spark = {
    born: 0,
    life: 1,
    x: 0.1,
    y: -0.2,
    vx: 0.4,
    vy: 0.3,
    size: 4,
    gain: 1,
    red: 1,
    green: 0.5,
    blue: 0.2,
  }
  const at = (age: number) => {
    const out = { x: 0, y: 0, vx: 0, vy: 0 }
    sparkPlace(spark, age, out)
    return out
  }

  it('starts where it was born, going as fast as it was thrown', () => {
    expect(at(0)).toEqual({ x: 0.1, y: -0.2, vx: 0.4, vy: 0.3 })
  })

  it('has a velocity that is the derivative of its place', () => {
    for (const age of [0.05, 0.3, 0.7]) {
      const h = 1e-5
      const before = at(age - h)
      const after = at(age + h)
      expect(at(age).vx).toBeCloseTo((after.x - before.x) / (2 * h), 4)
      expect(at(age).vy).toBeCloseTo((after.y - before.y) / (2 * h), 4)
    }
  })

  it('loses its speed to drag and no more than a little to gravity', () => {
    const later = at(1)
    expect(later.vx).toBeCloseTo(0.4 * Math.exp(-DRAG), 6)
    // The vertical speed settles toward the terminal fall, which is small.
    expect(later.vy).toBeCloseTo(-GRAVITY / DRAG + (0.3 + GRAVITY / DRAG) * Math.exp(-DRAG), 6)
    expect(GRAVITY / DRAG).toBeLessThan(0.15)
  })

  it('sinks under gravity against the same spark without it', () => {
    const noFall = { ...spark, vy: 0.3 }
    const out = { x: 0, y: 0, vx: 0, vy: 0 }
    sparkPlace(noFall, 0.5, out)
    // The drag-only place, worked out by hand: start + speed * (1 - e^-kt) / k.
    const flat = -0.2 + (0.3 * (1 - Math.exp(-DRAG * 0.5))) / DRAG
    expect(out.y).toBeLessThan(flat)
    expect(flat - out.y).toBeLessThan(0.05)
  })

  it('is bright and then gone, so it reads as a spark and not a glow', () => {
    expect(sparkFade(spark, 0)).toBe(1)
    expect(sparkFade(spark, 1)).toBe(0)
    expect(sparkFade(spark, 2)).toBe(0)
    expect(sparkFade(spark, 0.5)).toBeGreaterThan(0.3)
    expect(sparkFade(spark, 0.5)).toBeLessThan(0.4)
  })
})

describe('the same picture at any frame rate', () => {
  it('has every spark in the same place half a second after the hit at 60 and at 144 steps a second', () => {
    // A hit at one second is a whole step at both, and so is a look at 1.5.
    const events: [number, Record<number, number>][] = [[1, hat(0.8, 0.9, 0.1)]]
    // The longest life the knob allows, so some are still flying at the look.
    const long = sparkParams({ ...PARAMS, life: SPARK_RANGES.life[1] })
    const slow = rowsOf(play(60, 1.5, events, {}, long), long)
    const fast = rowsOf(play(144, 1.5, events, {}, long), long)
    expect(slow.count).toBeGreaterThan(0)
    expect(fast.count).toBe(slow.count)
    for (let at = 0; at < slow.count * SPARK_FLOATS; at += 1)
      expect(fast.out[at]).toBeCloseTo(slow.out[at] ?? 0, 2)
  })

  it('has the same light left in each a quarter second on, at 60, 120, 144 and 240 steps a second', () => {
    // A hit at one second and a look at 1.25 are whole steps at all four.
    const events: [number, Record<number, number>][] = [[1, hat(0.8, 0.9, 0.1)]]
    const reference = rowsOf(play(60, 1.25, events))
    expect(reference.count).toBeGreaterThan(0)
    for (const rate of [120, 144, 240]) {
      const other = rowsOf(play(rate, 1.25, events))
      expect(other.count).toBe(reference.count)
      for (let at = 0; at < reference.count; at += 1) {
        const base = at * SPARK_FLOATS
        expect(other.out[base + SPARK_AT.red]).toBeCloseTo(
          reference.out[base + SPARK_AT.red] ?? 0,
          3,
        )

        expect(other.out[base + SPARK_AT.halfLength]).toBeCloseTo(
          reference.out[base + SPARK_AT.halfLength] ?? 0,
          2,
        )
      }
    }
  })

  it('does not step on a bad dt', () => {
    const pool = new SparkPool()
    expect(() => {
      pool.step(packet(hat()), Number.NaN, PARAMS)
      pool.step(packet(hat()), -1, PARAMS)
      pool.step(packet(), 0, PARAMS)
    }).not.toThrow()
    expect(Number.isFinite(rowsOf(pool).out[0])).toBe(true)
  })
})

describe('what is drawn', () => {
  it('leaves out a spark that has flown off the canvas, and one that has died', () => {
    const fast = sparkParams({
      ...PARAMS,
      speed: SPARK_RANGES.speed[1],
      life: SPARK_RANGES.life[1],
    })
    const early = rowsOf(play(60, 0.05, [[1 / 60, hat(0.9, 0.9, 0.1)]], {}, fast), fast, 200, 200)
    const late = rowsOf(play(60, 1.2, [[1 / 60, hat(0.9, 0.9, 0.1)]], {}, fast), fast, 200, 200)
    expect(early.count).toBe(fast.count)
    expect(late.count).toBe(0)
    // Every row it does write is on the canvas, edge included.
    const all = rowsOf(play(60, 0.4, [[1 / 60, hat(0.9, 0.9, 0.1)]], {}, fast), fast, 200, 200)
    for (let at = 0; at < all.count; at += 1) {
      const base = at * SPARK_FLOATS
      const half = all.out[base + SPARK_AT.halfLength] ?? 0
      expect((all.out[base + SPARK_AT.x] ?? 0) + half).toBeGreaterThan(0)
      expect((all.out[base + SPARK_AT.x] ?? 0) - half).toBeLessThan(200)
    }
  })

  it('is white at birth and the ribbon’s own colour once it has cooled', () => {
    const key = 0.3
    const [red, green, blue] = peakPaletteAt(key + RIBBON_TINT)
    const spread = sparkParams({ ...PARAMS, hueSpread: 0 })
    const fresh = play(60, 0.05, [[1 / 60, { ...hat(1, 0.9, 0), [F.keyHue]: key }]], {}, spread)
    const cooled = new SparkPool()
    cooled.step(packet({ ...hat(1, 0.9, 0), [F.keyHue]: key }), 1 / 60, spread)
    for (let step = 0; step < 24; step += 1)
      cooled.step(packet({ [F.keyHue]: key }), 1 / 60, spread)
    const young = rowsOf(fresh, spread)
    const old = rowsOf(cooled, spread)
    expect(young.count).toBeGreaterThan(0)
    expect(old.count).toBeGreaterThan(0)
    const chroma = (rows: { out: Float32Array }) => {
      const base = SPARK_AT.red
      const r = rows.out[base] ?? 0
      const g = rows.out[base + 1] ?? 0
      const b = rows.out[base + 2] ?? 0
      return (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b, 1e-9)
    }

    const target =
      (Math.max(red, green, blue) - Math.min(red, green, blue)) / Math.max(red, green, blue)
    expect(chroma(young)).toBeLessThan(target * 0.6)
    expect(chroma(old)).toBeGreaterThan(target * 0.6)
  })

  it('scales its light with the intensity, and none at all with an intensity of nothing', () => {
    const at = (intensity: number) => {
      const params = sparkParams({ ...PARAMS, intensity })
      return rowsOf(play(60, 0.1, [[1 / 60, hat()]], {}, params), params).out[SPARK_AT.red] ?? 0
    }

    expect(at(2)).toBeCloseTo(at(1) * 2, 5)
    expect(at(0)).toBe(0)
  })

  it('makes a stronger hit throw faster and brighter than a weak one', () => {
    const at = (strength: number) => {
      const pool = play(60, 0.3, [[1 / 60, hat(strength, 0.9, 0)]])
      const { out } = rowsOf(pool)
      return { light: out[SPARK_AT.red] ?? 0, length: out[SPARK_AT.halfLength] ?? 0 }
    }

    expect(at(1).light).toBeGreaterThan(at(0.1).light)
    expect(at(1).length).toBeGreaterThan(at(0.1).length)
  })

  it('draws a streak along its own velocity that lengthens with speed and shrinks to a point as it stops', () => {
    const fast = sparkParams({ ...PARAMS, speed: 1, size: 4 })
    const young = rowsOf(play(60, 0.05, [[1 / 60, hat(1, 0.9, 0)]], {}, fast), fast)
    const base = SPARK_AT.dx
    for (let at = 0; at < young.count; at += 1)
      expect(
        Math.hypot(
          young.out[at * SPARK_FLOATS + base] ?? 0,
          young.out[at * SPARK_FLOATS + base + 1] ?? 0,
        ),
      ).toBeCloseTo(1, 5)
    const lengthAt = (rows: { out: Float32Array }) => rows.out[SPARK_AT.halfLength] ?? 0
    const width = (rows: { out: Float32Array }) => rows.out[SPARK_AT.halfWidth] ?? 0
    const old = rowsOf(
      play(60, 0.8, [[1 / 60, hat(1, 0.9, 0)]], {}, sparkParams({ ...fast, life: 0.8 })),
      fast,
    )
    // Fast, it is longer than it is wide by the streak; near the end of its life
    // it has all but stopped and is a round point.
    expect(lengthAt(young)).toBeGreaterThan(width(young) * 3)
    expect(old.count).toBeGreaterThan(0)
    expect(lengthAt(old)).toBeLessThan(lengthAt(young))
    // Its streak is a fixed span of its own travel, so it is what the constant says.
    const speed = fast.speed * 1.25
    expect(lengthAt(young)).toBeLessThanOrEqual(
      width(young) + 0.5 * speed * 1080 * STREAK_SECONDS + 1e-3,
    )
  })

  it('points a spark that has all but stopped the way it is falling', () => {
    const still = sparkParams({ ...PARAMS, speed: 0 })
    const pool = play(60, 0.3, [[1 / 60, hat(1, 0.9, 0)]], {}, still)
    const { out, count } = rowsOf(pool, still)
    expect(count).toBeGreaterThan(0)
    // Down on the screen, where y runs down, and a unit vector.
    expect(out[SPARK_AT.dy]).toBeGreaterThan(0.99)
  })
})

describe('the width', () => {
  it('is a number of pixels against 1080 high and scales with the short side', () => {
    expect(sparkWidthPixels(4, 1080)).toBeCloseTo(4)
    expect(sparkWidthPixels(4, 2160)).toBeCloseTo(8)
    expect(sparkWidthPixels(4, 540)).toBeCloseTo(2)
  })

  it('is never thinner than the floor, on a small canvas or with no size', () => {
    expect(sparkWidthPixels(4, 200)).toBe(MIN_WIDTH_PX)
    expect(sparkWidthPixels(0, 1080)).toBe(MIN_WIDTH_PX)
  })
})

// The number the study's comment quotes. It is an upper bound: every spark the
// pool holds as the whole quad it is drawn in, at its widest and with the
// longest streak, none overlapping another. The shader tapers the quad to a
// comet, so what is lit is well under this.
describe('coverage', () => {
  const SHAPES = [
    [320, 320],
    [640, 360],
    [1000, 1000],
    [1920, 1080],
    [1080, 1920],
    [2560, 1440],
    [3840, 1080],
    [3840, 2160],
  ] as const

  it('is under a twentieth of the frame with the pool full and every knob at the top, on every shape', () => {
    for (const [width, height] of SHAPES)
      expect(worstSparkCoverage(width, height), `${width} by ${height}`).toBeLessThan(0.05)
  })

  it('is largest on a square canvas and falls as the canvas gets longer', () => {
    const square = worstSparkCoverage(1080, 1080)
    expect(worstSparkCoverage(1920, 1080)).toBeLessThan(square)
    expect(worstSparkCoverage(3840, 1080)).toBeLessThan(worstSparkCoverage(1920, 1080))
    expect(worstSparkCoverage(1080, 1920)).toBeCloseTo(square * (1080 / 1920), 6)
  })

  it('does not change with the size of the canvas at one shape', () => {
    expect(worstSparkCoverage(3840, 2160)).toBeCloseTo(worstSparkCoverage(1920, 1080), 3)
  })

  it('is a bound on what the pool can actually cover', () => {
    const top = {} as SparkParams
    for (const knob of Object.keys(SPARK_RANGES) as (keyof SparkParams)[])
      top[knob] = SPARK_RANGES[knob][1]
    const pool = new SparkPool()
    for (let step = 0; step < 60 * 5; step += 1) pool.step(packet(hat(1, 0.9, 0.2)), 1 / 60, top)
    const { out, count } = rowsOf(pool, top, 1000, 1000)
    let area = 0
    for (let at = 0; at < count; at += 1)
      area +=
        4 *
        (out[at * SPARK_FLOATS + SPARK_AT.halfLength] ?? 0) *
        (out[at * SPARK_FLOATS + SPARK_AT.halfWidth] ?? 0)
    expect(count).toBeGreaterThan(0)
    expect(area / (1000 * 1000)).toBeLessThanOrEqual(sparkCoverage(top, 1000, 1000, count))
  })
})
