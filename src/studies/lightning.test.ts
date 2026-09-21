/**
 * The lightning as a study: that it is the drop's ink and nothing else's,
 * what tension does to it, that a silent packet and a quiet passage fire
 * nothing through the whole path, and that the bolts it promises fit the
 * frame. The pool and the ink have their own tests beside them; the generic
 * bar every study meets is `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness } from '../director/score'
import { HARDSTYLE, LOFI } from '../director/song.fixture'
import {
  buildBolt,
  LIGHTNING_DEFAULTS,
  LIGHTNING_POOL,
  LIGHTNING_RANGES,
  lightningCoverage,
  lightningParams,
  LightningPool,
  newStrike,
  SEGMENT_FLOATS,
  STRIKE_SEGMENTS,
} from '../impls/lightning.params'
import { carriedCanvas } from './cast'
import { LIGHTNING_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { castFrame, resolveLive, resolveStudy } from './resolve'

const study = findStudy('lightning')
if (!study) throw new Error('Expected the lightning study')

const silent = () => new Float32Array(PACKET_LENGTH)

const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

describe('the lightning study', () => {
  it('is the ink for the drop, with a nod for a hard groove and nothing else', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('lightning')
    expect(study.moments).toEqual({ intro: 0, groove: 0.3, build: 0, drop: 1, rest: 0, outro: 0 })
    expect(study.cost).toBe('cheap')
    expect(study.reach).toBe(0.35)
  })

  it('rests at the numbers the implementation falls back on', () => {
    expect(study.knobs).toEqual(LIGHTNING_DEFAULTS)
    expect(Object.keys(study.knobs).sort()).toEqual([...LIGHTNING_KNOBS].sort())
  })

  it('reads as the lightning when it is the only ink, on the canvas own line', () => {
    expect(sceneOf(['lightning'])).toBe('lightning')
  })

  // The home is the hard, heavy, high drive corner, the metal, dubstep and
  // drum and bass readings of tracks.fixture. Against the synthetic
  // characters: hardstyle is close, lo-fi is not.
  it('is at home with a hard, fast track and far from a lo-fi one', () => {
    expect(closeness(study, HARDSTYLE)).toBeGreaterThan(0.6)
    expect(closeness(study, LOFI)).toBeLessThan(0.3)
  })
})

describe('what tension does to the lightning', () => {
  // The study is held back through a build, so every tension row takes
  // something away: the rate, the length, the life and the light. Nothing
  // else moves, which is what makes the drop the release.
  it('holds the rate, the length, the life and the intensity down, and nothing else', () => {
    const calm = at(silent(), 0)
    const wound = at(silent(), 1)
    expect(wound.rate).toBeCloseTo((calm.rate ?? 0) - 0.35, 9)
    expect(wound.length).toBeCloseTo((calm.length ?? 0) - 0.1, 9)
    expect(wound.life).toBeCloseTo((calm.life ?? 0) - 0.03, 9)
    expect(wound.intensity).toBeCloseTo((calm.intensity ?? 0) - 0.15, 9)
    for (const knob of LIGHTNING_KNOBS) {
      if (knob === 'rate' || knob === 'length' || knob === 'life' || knob === 'intensity') continue
      expect(wound[knob], knob).toBe(calm[knob])
    }
  })

  it('a full packet leaves the intensity at rest, and only tension takes it down', () => {
    const filled = () => {
      const out = new Float32Array(PACKET_LENGTH)
      for (const field of ['energy', 'swell', 'hardness', 'pace', 'impact'] as const)
        out[F[field]] = 1
      return out
    }

    // Loud never dims a bolt and never brightens one: the holdback is the
    // only row on the intensity.
    expect(at(filled()).intensity).toBe(study.knobs.intensity ?? 0)
    expect(at(filled(), 1).intensity).toBeCloseTo((study.knobs.intensity ?? 0) - 0.15, 9)
  })

  it('dims the bolt on screen by the same amount, and leaves the bolt alone', () => {
    const drawn = (tension: number) => {
      const params = lightningParams(at(silent(), tension))
      const pool = new LightningPool()
      // Read the light while both bolts are still lit. Tension takes the life
      // to 0.05 s, so the wound bolt is dead by the third frame; the second
      // frame puts both at the same age, a thirtieth of a second in.
      for (let step = 0; step < 2; step += 1) {
        const packet = silent()
        if (step === 0) packet[F.impact] = 1
        pool.step(packet, 1 / 60, params)
      }

      const out = new Float32Array(LIGHTNING_POOL * STRIKE_SEGMENTS * SEGMENT_FLOATS)
      const count = pool.fill(out, params)
      return { count, first: Array.from(out.slice(0, 4)), light: out[7] ?? 0 }
    }

    const calm = drawn(0)
    const wound = drawn(1)
    expect(wound.count).toBe(calm.count)
    // Tension shortens the bolt, so the endpoints differ; the direction of
    // the first segment is the seeded shape, which tension leaves alone.
    const dir = (ends: number[]) => {
      const dx = (ends[2] ?? 0) - (ends[0] ?? 0)
      const dy = (ends[3] ?? 0) - (ends[1] ?? 0)
      const len = Math.hypot(dx, dy)
      return [dx / len, dy / len]
    }

    const calmDir = dir(calm.first)
    const woundDir = dir(wound.first)
    expect(woundDir[0]).toBeCloseTo(calmDir[0] ?? 0, 6)
    expect(woundDir[1]).toBeCloseTo(calmDir[1] ?? 0, 6)
    expect(wound.light).toBeLessThan(calm.light)
  })
})

describe('silence and a quiet passage through the whole path', () => {
  it('fires nothing on a silent packet, however long it runs', () => {
    const params = lightningParams(at(silent()))
    const pool = new LightningPool()
    for (let step = 0; step < 60 * 30; step += 1) pool.step(silent(), 1 / 60, params)
    expect(pool.fired).toBe(0)
    expect(pool.alive).toBe(0)
  })

  it('fires nothing on a loud passage with no drop in it: no impact, no release', () => {
    const busy = silent()
    busy[F.energy] = 1
    busy[F.subHit] = 1
    busy[F.bassHit] = 1
    const params = lightningParams(at(busy))
    const pool = new LightningPool()
    for (let step = 0; step < 60 * 10; step += 1) pool.step(busy, 1 / 60, params)
    expect(pool.fired).toBe(0)
  })
})

describe('the bolts it promises', () => {
  it('builds inside its segment budget at the deepest forks and the longest reach', () => {
    const worst = lightningParams({ ...LIGHTNING_DEFAULTS, forks: 4, length: 1 })
    for (const seed of [3, 17, 55, 1234]) {
      const strike = newStrike()
      buildBolt(strike, seed, 1, worst, 0.5)
      expect(strike.count).toBeGreaterThan(0)
      expect(strike.count).toBeLessThanOrEqual(STRIKE_SEGMENTS)
    }
  })

  it('stays inside its safe ranges at silence and at a full packet', () => {
    const filled = silent()
    for (const field of ['energy', 'swell', 'hardness', 'pace', 'impact', 'release'] as const)
      filled[F[field]] = 1
    for (const packet of [silent(), filled])
      for (const tension of [0, 1])
        for (const [knob, value] of Object.entries(at(packet, tension))) {
          const range = LIGHTNING_RANGES[knob as keyof typeof LIGHTNING_RANGES]
          expect(value, `${knob} at tension ${tension}`).toBeGreaterThanOrEqual(range[0])
          expect(value, `${knob} at tension ${tension}`).toBeLessThanOrEqual(range[1])
        }
  })

  it('lights under five percent of the frame at the most its mapping reaches, on every shape', () => {
    const worst = lightningParams({ ...LIGHTNING_DEFAULTS, length: 0.7, width: 3.2, life: 0.5 })
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
      [3840, 2160],
    ] as const)
      expect(lightningCoverage(worst, 3, width, height), `${width} by ${height}`).toBeLessThan(0.05)
  })
})

describe('with other studies', () => {
  it('resolves beside a flow, the shards and a look, each on its own numbers', () => {
    const packet = silent()
    packet[F.impact] = 1
    packet[F.energy] = 0.8
    const frame = resolveLive(
      [
        { id: 'lazy-fluid', presence: 1 },
        { id: 'shards', presence: 1 },
        { id: 'lightning', presence: 1 },
        { id: 'clean-glass', presence: 1 },
      ],
      carriedCanvas(),
      packet,
      0,
      castFrame(),
    )
    const knobs = frame.knobs.get('lightning')
    expect(Object.keys(knobs ?? {}).sort()).toEqual([...LIGHTNING_KNOBS].sort())
    expect(knobs?.rate).toBeGreaterThan(0.5)
  })

  it('is not resolved at presence 0', () => {
    const frame = resolveLive(
      [{ id: 'lightning', presence: 0 }],
      carriedCanvas(),
      silent(),
      0,
      castFrame(),
    )
    expect(frame.knobs.has('lightning')).toBe(false)
  })
})
