/**
 * The sparks as a study: where it lives in the character space, what the music
 * and a build do to its knobs, and that a silent packet through its whole path
 * draws nothing. The pool and the ink have their own tests beside them; the
 * generic bar every study meets is `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness } from '../director/score'
import { HARDSTYLE, LOFI } from '../director/song.fixture'
import {
  SPARK_FLOATS,
  SPARK_POOL,
  sparkCoverage,
  sparkParams,
  SparkPool,
} from '../impls/sparks.params'
import { SPARKS_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { resolveStudy } from './resolve'

const study = findStudy('sparks')
if (!study) throw new Error('Expected the sparks study')

const silent = () => new Float32Array(PACKET_LENGTH)

/** A packet with the named rows set and everything else silent. */
const with_ = (rows: Record<number, number>) => {
  const out = silent()
  for (const [row, value] of Object.entries(rows)) out[Number(row)] = value
  return out
}

const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

/** A groove: the music is on, the hits are the hats, and nothing is winding up. */
const GROOVE = {
  [F.energy]: 0.5,
  [F.treble]: 0.5,
  [F.highMid]: 0.5,
  [F.pace]: 0.4,
  [F.hardness]: 0.5,
  [F.weight]: 0.4,
  [F.swell]: 0.5,
}

/** The rows a hat writes: the hit itself and where in the treble it landed. */
const hatRows = (strength: number, width: number): Record<number, number> => ({
  [F.trebleHit]: strength,
  [F.trebleHitCentre]: 0.9,
  [F.trebleHitWidth]: width,
})

const NO_HIT: Record<number, number> = {}

describe('the sparks study', () => {
  it('is the ink for the groove and the drop and for nothing else', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('sparks')
    expect(study.moments).toEqual({ intro: 0, groove: 1, build: 0, drop: 1, rest: 0, outro: 0 })
    expect(study.cost).toBe('cheap')
  })

  it('rests on every knob its implementation has, and no others', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...SPARKS_KNOBS].sort())
  })

  it('reads as the sparks when it is the only ink, on the canvas’s own line', () => {
    expect(sceneOf(['sparks'])).toBe('sparks')
  })

  // The catalogue says bright and fast, on a groove or a drop, with a moderate
  // reach: a lo-fi track never gets it and a hardstyle one does.
  it('is in the bright, fast corner: a lo-fi character never reaches it and a hardstyle one does', () => {
    expect(closeness(study, LOFI)).toBeLessThan(0.5)
    expect(closeness(study, HARDSTYLE)).toBeGreaterThan(0.6)
    expect(closeness(study, HARDSTYLE)).toBeGreaterThan(closeness(study, LOFI) + 0.25)
    // Moderate: wider than the shards' 0.35 and narrower than the ribbon's 1.
    expect(study.reach).toBeGreaterThan(0.3)
    expect(study.reach).toBeLessThan(0.6)
    // Bright means light on the weight axis, and fast means high on the drive one.
    expect(study.home.weight).toBeLessThan(0.4)
    expect(study.home.drive).toBeGreaterThan(0.6)
  })
})

describe('what the music does to the sparks', () => {
  it('lets a busier track throw more, on `pace`', () => {
    const slow = at(with_({ ...GROOVE, [F.pace]: 0.1 }))
    const busy = at(with_({ ...GROOVE, [F.pace]: 0.9 }))
    expect(busy.rate ?? 0).toBeGreaterThan((slow.rate ?? 0) + 10)
  })

  it('throws a harder track faster, on `hardness`', () => {
    const soft = at(with_({ ...GROOVE, [F.hardness]: 0 }))
    const hard = at(with_({ ...GROOVE, [F.hardness]: 1 }))
    expect(hard.speed ?? 0).toBeGreaterThan((soft.speed ?? 0) + 0.2)
  })

  it('throws more sparks for a hit when the treble is up, and does not brighten them', () => {
    const dull = at(with_({ ...GROOVE, [F.treble]: 0 }))
    const bright = at(with_({ ...GROOVE, [F.treble]: 1 }))
    expect(bright.count ?? 0).toBeGreaterThan(dull.count ?? 0)
    // The treble is the tempting row for the light, and it would break the
    // rule that a full packet is no brighter than rest, so it must not be there.
    expect(study.mapping.filter((row) => row.from === 'treble' && row.to === 'intensity')).toEqual(
      [],
    )
    expect(bright.intensity).toBe(dull.intensity)
  })

  it('is no brighter on a full packet than at rest, and dimmer as the music fills', () => {
    const rest = at(silent()).intensity ?? 0
    const full = new Float32Array(PACKET_LENGTH).fill(1)
    const loud = at(full).intensity ?? 0
    expect(loud).toBeLessThan(rest)
    expect(loud).toBeGreaterThan(rest * 0.4)
  })

  it('keeps the count a few and the rate under what the ink allows at a full packet', () => {
    const full = new Float32Array(PACKET_LENGTH).fill(1)
    for (const tension of [0, 1]) {
      const knobs = at(full, tension)
      expect(knobs.count ?? 0).toBeLessThanOrEqual(8)
      expect(knobs.rate ?? 0).toBeLessThanOrEqual(60)
      expect(knobs.speed ?? 0).toBeLessThanOrEqual(1.2)
    }
  })
})

describe('what tension does to the sparks', () => {
  it('makes them come faster and moves nothing else', () => {
    const calm = at(with_(GROOVE), 0)
    const wound = at(with_(GROOVE), 1)
    expect(wound.rate ?? 0).toBeGreaterThan((calm.rate ?? 0) + 15)
    for (const knob of SPARKS_KNOBS) {
      if (knob === 'rate') continue
      expect(wound[knob], knob).toBe(calm[knob])
    }
  })

  it('throws more sparks over a run of hats, through the rate limit, with tension up', () => {
    const born = (tension: number) => {
      const params = sparkParams(at(with_(GROOVE), tension))
      const pool = new SparkPool()
      // Sixteenths at 174, a hat every 86 ms, for ten seconds at 60 steps a second.
      let next = 0
      for (let step = 1; step <= 600; step += 1) {
        const now = step / 60
        const due = now >= next
        if (due) next += 0.086
        pool.step(with_({ ...GROOVE, ...(due ? hatRows(0.8, 0.05) : NO_HIT) }), 1 / 60, params)
      }

      return pool.thrown
    }

    expect(born(1)).toBeGreaterThan(born(0) * 1.5)
  })
})

describe('silence through the whole path', () => {
  it('resolves a silent packet and throws nothing, however long it runs', () => {
    const params = sparkParams(at(silent()))
    const pool = new SparkPool()
    for (let step = 0; step < 60 * 30; step += 1) pool.step(silent(), 1 / 60, params)
    expect(pool.thrown).toBe(0)
    expect(pool.alive).toBe(0)
  })

  it('throws nothing for a hit that a silent band cannot have made, as the bench’s synthetic packet writes', () => {
    const params = sparkParams(at(silent()))
    const pool = new SparkPool()
    for (let step = 0; step < 120; step += 1)
      pool.step(with_({ [F.trebleHit]: 0.6, [F.highMidHit]: 0.8 }), 1 / 60, params)
    expect(pool.thrown).toBe(0)
  })
})

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

  /** The most sparks a hat run can keep alive at the knobs the study resolves to. */
  const reached = (tension: number) => {
    const full = new Float32Array(PACKET_LENGTH).fill(1)
    return sparkParams(at(full, tension))
  }

  it('is under a twentieth of the frame at the most the study’s own mapping reaches, on every shape', () => {
    for (const tension of [0, 1])
      for (const [width, height] of SHAPES)
        expect(
          sparkCoverage(reached(tension), width, height),
          `${width} by ${height}`,
        ).toBeLessThan(0.03)
  })

  it('has a pool that is not what limits it: the rate is, so the pool is never overrun', () => {
    for (const tension of [0, 1]) {
      const params = reached(tension)
      const pool = new SparkPool()
      let most = 0
      for (let step = 0; step < 60 * 20; step += 1) {
        pool.step(with_({ [F.trebleHit]: 1, [F.treble]: 1 }), 1 / 60, params)
        most = Math.max(most, pool.alive)
      }

      expect(most).toBeLessThan(SPARK_POOL)
    }
  })
})

describe('the same picture at any frame rate', () => {
  it('has the same light in the same places after the same seconds at 60, 120, 144 and 240 steps a second', () => {
    const params = sparkParams(at(with_(GROOVE), 0.5))
    const rows = (rate: number) => {
      const pool = new SparkPool()
      // A hit at one second and a look at 1.25 are whole steps at every rate below.
      for (let step = 1; step <= Math.round(1.25 * rate); step += 1)
        pool.step(
          with_({ ...GROOVE, ...(step === Math.round(rate) ? hatRows(0.9, 0.1) : NO_HIT) }),
          1 / rate,
          params,
        )
      const out = new Float32Array(SPARK_POOL * SPARK_FLOATS)
      return { out, count: pool.fill(out, params, 1920, 1080) }
    }

    const reference = rows(60)
    expect(reference.count).toBeGreaterThan(0)
    for (const rate of [120, 144, 240]) {
      const other = rows(rate)
      expect(other.count).toBe(reference.count)
      for (let at = 0; at < reference.count * SPARK_FLOATS; at += 1)
        expect(other.out[at]).toBeCloseTo(reference.out[at] ?? 0, 2)
    }
  })
})
