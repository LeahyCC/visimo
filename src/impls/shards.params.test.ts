import { describe, expect, it, vi } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { peakPaletteAt, RIBBON_TINT } from '../post/params'
import { AUDIO_FIELDS } from '../presets/knobs'
import shader from '../shaders/shards.wgsl?raw'
import { findStudy } from '../studies/registry'
import { resolveStudy } from '../studies/resolve'
import {
  BURST_GAP_SECONDS,
  BURST_SPREAD_SECONDS,
  HIT_SHARDS,
  MAX_HIT_RATE,
  SHARD_AREA,
  SHARD_CORNERS,
  SHARD_DEFAULTS,
  SHARD_FLOATS,
  SHARD_POOL,
  SHARD_RANGES,
  shardHash,
  shardParams,
  ShardPool,
  worstHitCoverage,
} from './shards.params'
import type { ShardParams } from './shards.params'

/** A packet with these rows set, keyed by row number, and everything else silent. */
const packet = (rows: Record<number, number> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [row, value] of Object.entries(rows)) out[Number(row)] = value
  return out
}

const PARAMS = shardParams({})
const ASPECT = 16 / 9

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
  params: ShardParams = PARAMS,
) {
  const pool = new ShardPool()
  const at = new Map(events.map(([time, rows]) => [Math.round(time * rate), rows]))
  for (let step = 1; step <= Math.round(seconds * rate); step += 1)
    pool.step(packet({ ...steady, ...at.get(step) }), 1 / rate, params)
  return pool
}

const rowsOf = (pool: ShardPool, params: ShardParams = PARAMS) => {
  const out = new Float32Array(SHARD_POOL * SHARD_FLOATS)
  const count = pool.fill(out, params, ASPECT)
  return { out, count }
}

describe('the numbers a tuning becomes', () => {
  it('leaves what nothing names at its default', () => {
    expect(shardParams({})).toEqual(SHARD_DEFAULTS)
  })

  it('clamps every knob to its range, whole for a count', () => {
    const wild = shardParams({
      burst: 1000,
      hitRate: 50,
      speed: -3,
      size: 5,
      spin: 99,
      life: 0,
      intensity: 9,
    })
    expect(wild.burst).toBe(SHARD_RANGES.burst[1])
    expect(wild.hitRate).toBe(MAX_HIT_RATE)
    expect(wild.speed).toBe(0)
    expect(wild.size).toBe(SHARD_RANGES.size[1])
    expect(wild.spin).toBe(SHARD_RANGES.spin[1])
    expect(wild.life).toBe(SHARD_RANGES.life[0])
    expect(wild.intensity).toBe(SHARD_RANGES.intensity[1])
    expect(shardParams({ burst: 40.6 }).burst).toBe(41)
  })

  it('ignores a number that is not one', () => {
    expect(shardParams({ speed: Number.NaN, size: Number.POSITIVE_INFINITY })).toEqual(
      SHARD_DEFAULTS,
    )
  })
})

describe('what a shard is born with', () => {
  it('is a hash of the slot and the counter, the same every time', () => {
    expect(shardHash(3, 41, 2)).toBe(shardHash(3, 41, 2))
    for (const [slot, counter, channel] of [
      [3, 41, 2],
      [0, 0, 0],
      [191, 123456, 8],
    ] as const) {
      const value = shardHash(slot, counter, channel)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('differs with the slot, the counter and the channel, and spreads evenly', () => {
    const base = shardHash(3, 41, 2)
    expect(shardHash(4, 41, 2)).not.toBe(base)
    expect(shardHash(3, 42, 2)).not.toBe(base)
    expect(shardHash(3, 41, 3)).not.toBe(base)
    let sum = 0
    const buckets = new Array<number>(10).fill(0)
    for (let counter = 0; counter < 4096; counter += 1) {
      const value = shardHash(counter % SHARD_POOL, counter, 0)
      sum += value
      buckets[Math.floor(value * 10)] = (buckets[Math.floor(value * 10)] ?? 0) + 1
    }

    expect(sum / 4096).toBeCloseTo(0.5, 1)
    for (const count of buckets) expect(count).toBeGreaterThan(300)
  })

  it('throws the same shards for the same song, and never asks for a random number', () => {
    const random = vi.spyOn(Math, 'random')
    const song = [
      [0.5, { [F.impact]: 1 }],
      [0.75, { [F.bassHit]: 0.9 }],
    ] as const
    const one = rowsOf(play(60, 1.6, song, { [F.release]: 0.8, [F.keyHue]: 0.3 }))
    const two = rowsOf(play(60, 1.6, song, { [F.release]: 0.8, [F.keyHue]: 0.3 }))
    expect(one.count).toBeGreaterThan(20)
    expect(two.count).toBe(one.count)
    expect(Array.from(two.out)).toEqual(Array.from(one.out))
    expect(random).not.toHaveBeenCalled()
    random.mockRestore()
  })

  it('takes its colour from the ribbon’s palette at the key, spread but not the whole palette', () => {
    const key = 0.3
    const { out, count } = rowsOf(play(60, 0.4, [[0.2, { [F.impact]: 1 }]], { [F.keyHue]: key }))
    expect(count).toBe(PARAMS.burst)
    const seen = new Set<string>()
    for (let shard = 0; shard < count; shard += 1) {
      const colour = [0, 1, 2].map((part) => out[shard * SHARD_FLOATS + 4 + part] ?? 0)
      // The same peak brightness as the ribbon, whatever the key.
      expect(Math.max(...colour)).toBeCloseTo(1, 5)
      seen.add(colour.map((value) => value.toFixed(2)).join(','))
      // Within a fifth of a palette of where the ribbon sits at this key.
      let nearest = Number.POSITIVE_INFINITY
      for (let step = -200; step <= 200; step += 1) {
        const wanted = peakPaletteAt(key + RIBBON_TINT + step / 1000)
        nearest = Math.min(
          nearest,
          Math.hypot(...colour.map((value, part) => value - (wanted[part] ?? 0))),
        )
      }

      expect(nearest).toBeLessThan(0.02)
    }

    expect(seen.size).toBeGreaterThan(8)
  })

  it('moves the colour with the key', () => {
    const at = (key: number) =>
      rowsOf(play(60, 0.1, [[0.05, { [F.impact]: 1 }]], { [F.keyHue]: key }))
    const one = at(0.1).out.slice(4, 7)
    const two = at(0.6).out.slice(4, 7)
    expect(Array.from(two)).not.toEqual(Array.from(one))
  })
})

describe('silence, and what is held back', () => {
  it('draws nothing in silence, and keeps drawing nothing', () => {
    const pool = play(60, 10)
    expect(pool.alive).toBe(0)
    expect(pool.thrown).toBe(0)
    expect(rowsOf(pool).count).toBe(0)
  })

  it('throws nothing for a loud passage with no payoff in it', () => {
    const loud: Record<number, number> = {}
    for (let row = 0; row < PACKET_LENGTH; row += 1) loud[row] = 1
    // Every row full except the three that mean a payoff or a hit.
    loud[F.impact] = 0
    loud[F.release] = 0
    for (const row of [F.subHit, F.bassHit, F.lowMidHit, F.highMidHit, F.trebleHit]) loud[row] = 0
    expect(play(60, 8, [], loud).thrown).toBe(0)
  })

  it('throws nothing on a hit once the payoff has faded', () => {
    expect(play(60, 6, [], { [F.release]: 0.1, [F.bassHit]: 1 }).thrown).toBe(0)
  })

  it('throws nothing on a hit that is weak, or in the treble', () => {
    expect(play(60, 4, [], { [F.release]: 0.9, [F.bassHit]: 0.3 }).thrown).toBe(0)
    expect(play(60, 4, [], { [F.release]: 0.9, [F.trebleHit]: 1 }).thrown).toBe(0)
  })

  it('throws on a strong hit in each of the four bands that carry a drop', () => {
    for (const row of [F.subHit, F.bassHit, F.lowMidHit, F.highMidHit])
      expect(play(60, 0.5, [[0.2, { [row]: 0.9 }]], { [F.release]: 0.8 }).thrown).toBe(HIT_SHARDS)
  })
})

describe('the burst', () => {
  const impact = [[0.5, { [F.impact]: 1 }]] as const

  it('throws exactly `burst`, over a span and not on one frame', () => {
    // The step the impact lands on has only the first of them due.
    expect(play(60, 0.5, impact).alive).toBe(1)
    expect(play(144, 0.5, impact).alive).toBe(1)
    const spread = 0.5 + BURST_SPREAD_SECONDS
    expect(play(60, spread + 0.05, impact).alive).toBe(PARAMS.burst)
    expect(play(60, spread + 0.05, impact).thrown).toBe(PARAMS.burst)
  })

  it('is a burst of the size the knob says', () => {
    const big = shardParams({ burst: 120 })
    expect(play(60, 0.8, impact, {}, big).thrown).toBe(120)
    expect(play(60, 0.8, impact, {}, shardParams({ burst: 0 })).thrown).toBe(0)
  })

  it('is one burst for one drop, however slowly impact falls', () => {
    const pool = new ShardPool()
    let level = 1
    for (let step = 0; step < 90; step += 1) {
      pool.step(packet({ [F.impact]: level }), 1 / 60, PARAMS)
      level *= Math.exp(-1 / 60 / 0.18)
    }

    expect(pool.thrown).toBe(PARAMS.burst)
  })

  it('needs impact to fall away before it will fire again', () => {
    const pool = new ShardPool()
    for (let step = 0; step < 240; step += 1) pool.step(packet({ [F.impact]: 0.6 }), 1 / 60, PARAMS)
    expect(pool.thrown).toBe(PARAMS.burst)
    pool.step(packet({ [F.impact]: 0.1 }), 1 / 60, PARAMS)
    for (let step = 0; step < 12; step += 1) pool.step(packet({ [F.impact]: 1 }), 1 / 60, PARAMS)
    expect(pool.thrown).toBe(PARAMS.burst * 2)
  })

  // The flash rule, held by this file whatever fires `impact`: a bench button
  // pressed as fast as a hand can, or a host that writes the row itself.
  it('cannot fire more than twice a second whatever impact does', () => {
    expect(BURST_GAP_SECONDS * 3).toBeGreaterThan(1)
    for (const rate of [60, 144]) {
      const pool = new ShardPool()
      const thrown: number[] = [0]
      for (let step = 1; step <= rate * 6; step += 1) {
        // Impact goes up and down every other step: as fast as it can be fired.
        pool.step(packet({ [F.impact]: step % 2 }), 1 / rate, PARAMS)
        thrown.push(pool.thrown)
      }

      // Six seconds of it does throw, and never more than two bursts and the
      // first shard of a third in any second.
      expect(pool.thrown).toBeGreaterThan(PARAMS.burst * 6)
      for (let step = rate; step < thrown.length; step += 1)
        expect((thrown[step] ?? 0) - (thrown[step - rate] ?? 0)).toBeLessThanOrEqual(
          PARAMS.burst * 2 + 1,
        )
    }
  })

  it('leaves the ring to overwrite the oldest when it is asked for more than it holds', () => {
    const big = shardParams({ burst: 160, life: 3 })
    const pool = play(60, 0.9, impact, { [F.release]: 0.9, [F.bassHit]: 1 }, big)
    expect(pool.thrown).toBeGreaterThan(160)
    expect(pool.alive).toBeLessThanOrEqual(SHARD_POOL)
  })
})

describe('the hits', () => {
  // The flash rule for the per-hit births: in any second, at most three of
  // them, however fast the hits arrive and whatever the knob is set to.
  it('never throw on more than three hits in any second, even with the knob far past its top', () => {
    const wild: ShardParams = { ...PARAMS, hitRate: 99 }
    for (const rate of [60, 144]) {
      const pool = new ShardPool()
      const times: number[] = []
      let last = 0
      for (let step = 1; step <= rate * 8; step += 1) {
        pool.step(packet({ [F.release]: 0.9, [F.bassHit]: 1 }), 1 / rate, wild)
        if (pool.thrown > last) times.push(step / rate)
        last = pool.thrown
      }

      expect(times.length).toBeGreaterThan(8)
      expect(pool.thrown).toBe(times.length * HIT_SHARDS)
      for (let at = 0; at + 3 < times.length; at += 1)
        expect((times[at + 3] ?? 0) - (times[at] ?? 0)).toBeGreaterThan(1)
    }
  })

  it('cover a percent or two of the frame at the very most', () => {
    expect(worstHitCoverage(ASPECT)).toBeLessThan(0.02)
    expect(worstHitCoverage(1)).toBeLessThan(0.03)
    // Three a second at that is still far from the fraction of a screen the
    // flash rule counts as a large area.
    expect(worstHitCoverage(ASPECT) * MAX_HIT_RATE).toBeLessThan(0.05)
  })

  it('are smaller than a burst’s shards', () => {
    const burst = rowsOf(play(60, 0.4, [[0.2, { [F.impact]: 1 }]]))
    const hit = rowsOf(play(60, 0.3, [[0.2, { [F.bassHit]: 1 }]], { [F.release]: 0.9 }))
    const mean = (rows: { out: Float32Array; count: number }) => {
      let sum = 0
      for (let shard = 0; shard < rows.count; shard += 1)
        sum += rows.out[shard * SHARD_FLOATS + 3] ?? 0
      return sum / rows.count
    }

    expect(hit.count).toBe(HIT_SHARDS)
    expect(mean(hit)).toBeLessThan(mean(burst))
  })
})

describe('the same at any frame rate', () => {
  // The impact and the two hits land at instants that are a whole number of
  // steps at both rates, so the two pools see the same music. Where a shard is
  // a second after the drop is then the only thing that can differ.
  const song = [
    [0.5, { [F.impact]: 1 }],
    [0.75, { [F.bassHit]: 0.9 }],
    [1.75, { [F.lowMidHit]: 0.9 }],
  ] as const

  it('has every shard in the same place after a second, at 60 and at 144 steps a second', () => {
    const steady = { [F.release]: 0.8, [F.keyHue]: 0.2 }
    const slow = rowsOf(play(60, 1.5, song, steady))
    const fast = rowsOf(play(144, 1.5, song, steady))
    expect(slow.count).toBeGreaterThan(30)
    expect(fast.count).toBe(slow.count)
    for (let at = 0; at < slow.count * SHARD_FLOATS; at += 1)
      expect(fast.out[at] ?? 0).toBeCloseTo(slow.out[at] ?? 0, 4)
  })

  it('has them in the same place a second on, and both throw the same number', () => {
    const steady = { [F.release]: 0.8 }
    const slow = play(60, 2, song, steady)
    const fast = play(144, 2, song, steady)
    expect(fast.thrown).toBe(slow.thrown)
    const a = rowsOf(slow)
    const b = rowsOf(fast)
    expect(b.count).toBe(a.count)
    for (let at = 0; at < a.count * SHARD_FLOATS; at += 1)
      expect(b.out[at] ?? 0).toBeCloseTo(a.out[at] ?? 0, 4)
  })

  it('moves a shard the same distance in a second whatever the step', () => {
    // The closed form means it is age and not step count that decides.
    const at = (rate: number) => {
      const { out } = rowsOf(play(rate, 1.2, [[0.2, { [F.impact]: 1 }]]))
      return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0]
    }

    for (const rate of [30, 60, 120, 144]) {
      const [x, y, angle] = at(rate)
      const [rx, ry, rangle] = at(60)
      expect(x).toBeCloseTo(rx ?? 0, 4)
      expect(y).toBeCloseTo(ry ?? 0, 4)
      expect(angle).toBeCloseTo(rangle ?? 0, 4)
    }
  })
})

describe('what it puts in the frame', () => {
  /**
   * The frame as a grid, with each cell's light summed over the shards on it.
   * The shards are the triangles the shader draws, so this is a stand-in for
   * the pass that a test can read.
   */
  function light(out: Float32Array, count: number, cols: number, rows: number) {
    const sum = new Float32Array(cols * rows)
    for (let shard = 0; shard < count; shard += 1) {
      const base = shard * SHARD_FLOATS
      const [cx = 0, cy = 0, angle = 0, size = 0] = out.slice(base, base + 4)
      const strength = out[base + 7] ?? 0
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const corners = SHARD_CORNERS.map(([x, y]) => [
        cx + (x * cos - y * sin) * size,
        cy + (x * sin + y * cos) * size,
      ])
      const [a = [0, 0], b = [0, 0], c = [0, 0]] = corners
      const edge = (from: number[], to: number[], x: number, y: number) =>
        ((to[0] ?? 0) - (from[0] ?? 0)) * (y - (from[1] ?? 0)) -
        ((to[1] ?? 0) - (from[1] ?? 0)) * (x - (from[0] ?? 0))
      for (let row = 0; row < rows; row += 1)
        for (let col = 0; col < cols; col += 1) {
          const x = ((col + 0.5) / cols - 0.5) * ASPECT
          const y = 0.5 - (row + 0.5) / rows
          const sides = [edge(a, b, x, y), edge(b, c, x, y), edge(c, a, x, y)]
          if (sides.some((side) => side < 0) && sides.some((side) => side > 0)) continue
          sum[row * cols + col] = (sum[row * cols + col] ?? 0) + strength
        }
    }

    return sum
  }

  /**
   * The worst the frame gets in the first half second after an impact: the
   * most cells any shard covers, and the most light on any one cell, sampled
   * every sixtieth of a second. The impact lands at the start of the half
   * second, so the burst's own births are all inside it.
   */
  function worst(params: ShardParams) {
    const pool = new ShardPool()
    const out = new Float32Array(SHARD_POOL * SHARD_FLOATS)
    let coverage = 0
    let peak = 0
    let crowd = 0
    for (let step = 0; step <= 30; step += 1) {
      pool.step(packet({ [F.impact]: step === 0 ? 1 : 0 }), step === 0 ? 0 : 1 / 60, params)
      const count = pool.fill(out, params, ASPECT)
      const cells = light(out, count, 160, 90)
      let covered = 0
      let total = 0
      for (const value of cells) {
        if (value <= 0) continue
        covered += 1
        total += value
        peak = Math.max(peak, value)
      }

      coverage = Math.max(coverage, covered / cells.length)
      if (covered > 0) crowd = Math.max(crowd, total / covered / params.intensity)
    }

    return { coverage, peak, crowd }
  }

  // Sparse by design. These are the numbers the README and the study's own
  // comment quote, so a change to the geometry that makes it wash the frame
  // fails here first.
  it('covers under a fortieth of the frame at rest and under a fourteenth at the very most', () => {
    const rest = worst(PARAMS)
    const full = worst(shardParams({ burst: SHARD_RANGES.burst[1] }))
    console.info(
      `shards, first half second after an impact at 16:9: rest burst ${PARAMS.burst}: ` +
        `${(rest.coverage * 100).toFixed(1)}% of the frame, ${rest.peak.toFixed(2)} at the most on one pixel; ` +
        `full burst ${SHARD_RANGES.burst[1]}: ${(full.coverage * 100).toFixed(1)}%, ${full.peak.toFixed(2)}`,
    )
    expect(rest.coverage).toBeLessThan(0.025)
    expect(full.coverage).toBeLessThan(0.07)
  })

  it('never stacks more than a handful of shards on one pixel, so the sum cannot clip to white', () => {
    const rest = worst(PARAMS)
    const full = worst(shardParams({ burst: SHARD_RANGES.burst[1] }))
    // At a light of 0.9 a shard, four stacked is 3.6 before the tonemap.
    expect(rest.peak / PARAMS.intensity).toBeLessThanOrEqual(2.5)
    expect(full.peak / PARAMS.intensity).toBeLessThanOrEqual(4.5)
    // And where any is lit, on average barely more than one.
    expect(full.crowd).toBeLessThan(1.6)
  })

  // The study reaches further than its resting numbers: a loud, hard, bass-led
  // and busy track is the worst it meets, and the mapping is what gets it there.
  it('covers what it says at the top of what its own mapping reaches', () => {
    const study = findStudy('shards')
    if (!study) throw new Error('Expected the shards study')
    const full = new Float32Array(PACKET_LENGTH)
    for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') full[F[field]] = 1
    // At its loudest and most bass-led, before tension has any say.
    const top = shardParams(resolveStudy(study, undefined, full, 0, 1, {}))
    const reached = worst(top)
    console.info(
      `shards at the top of the mapping (burst ${top.burst}, size ${top.size.toFixed(2)}, ` +
        `speed ${top.speed.toFixed(1)}): ${(reached.coverage * 100).toFixed(1)}% of the frame, ` +
        `${reached.peak.toFixed(2)} at the most on one pixel`,
    )
    expect(reached.coverage).toBeLessThan(0.09)
    expect(reached.peak / top.intensity).toBeLessThanOrEqual(4.5)
  })

  it('has nothing at all on the frame in the first frame after the impact but the first shard', () => {
    const pool = new ShardPool()
    pool.step(packet({ [F.impact]: 1 }), 1 / 60, PARAMS)
    const { out, count } = rowsOf(pool)
    expect(count).toBe(1)
    const cells = light(out, count, 160, 90)
    expect(cells.filter((value) => value > 0).length / cells.length).toBeLessThan(0.005)
  })

  it('draws no more than the pool, and leaves out what has flown out of the frame', () => {
    const fast = shardParams({ speed: 4, life: 3 })
    const pool = play(60, 1.6, [[0.2, { [F.impact]: 1 }]], {}, fast)
    const { out, count } = rowsOf(pool, fast)
    expect(pool.alive).toBeGreaterThan(count)
    expect(count).toBeLessThanOrEqual(SHARD_POOL)
    const reach = 0.5 * Math.hypot(ASPECT, 1)
    for (let shard = 0; shard < count; shard += 1)
      expect(
        Math.hypot(out[shard * SHARD_FLOATS] ?? 0, out[shard * SHARD_FLOATS + 1] ?? 0),
      ).toBeLessThan(reach + 0.2)
  })

  it('fades a shard to nothing as its life runs out', () => {
    const pool = new ShardPool()
    const out = new Float32Array(SHARD_POOL * SHARD_FLOATS)
    pool.step(packet({ [F.impact]: 1 }), 1 / 60, { ...PARAMS, burst: 1 })
    const lights: number[] = []
    for (let step = 0; step < 100; step += 1) {
      pool.step(packet(), 1 / 60, PARAMS)
      const count = pool.fill(out, PARAMS, ASPECT)
      if (count === 0) break
      lights.push(out[7] ?? 0)
    }

    expect(lights.length).toBeGreaterThan(30)
    expect(lights[0]).toBeGreaterThan(PARAMS.intensity * 0.99)
    for (let at = 1; at < lights.length; at += 1)
      expect(lights[at] ?? 0).toBeLessThanOrEqual((lights[at - 1] ?? 0) + 1e-9)
    expect(lights.at(-1) ?? 1).toBeLessThan(0.05)
  })

  it('scales its light by the intensity knob, and by nothing else', () => {
    const at = (intensity: number) => {
      const params = { ...PARAMS, intensity }
      return rowsOf(play(60, 0.4, [[0.2, { [F.impact]: 1 }]], {}, params), params).out[7] ?? 0
    }

    expect(at(0.45)).toBeCloseTo(at(0.9) / 2, 5)
  })
})

describe('the shader and the numbers agree', () => {
  it('draws the triangle the coverage sums are made of', () => {
    const corners = [...shader.matchAll(/vec2<f32>\((-?[\d.]+), (-?[\d.]+)\)/g)]
      .slice(0, 3)
      .map((match) => [Number(match[1]), Number(match[2])])
    expect(corners).toEqual(SHARD_CORNERS.map((corner) => [...corner]))
  })

  it('has a triangle whose middle is its origin and whose area is the one the sums use', () => {
    const [a, b, c] = SHARD_CORNERS
    if (!a || !b || !c) throw new Error('Expected three corners')
    expect(a[0] + b[0] + c[0]).toBeCloseTo(0, 9)
    expect(a[1] + b[1] + c[1]).toBeCloseTo(0, 9)
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
    expect(area).toBeCloseTo(SHARD_AREA, 2)
  })

  it('reads the row the pool writes: a centre, then a turn and a size, then colour and light', () => {
    expect(shader).toMatch(/@location\(0\) centre: vec2<f32>/)
    expect(shader).toMatch(/@location\(1\) turn: vec2<f32>/)
    expect(shader).toMatch(/@location\(2\) light: vec4<f32>/)
    expect(SHARD_FLOATS).toBe(8)
  })
})
