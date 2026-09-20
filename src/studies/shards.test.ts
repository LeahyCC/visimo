/**
 * The shards as a study: where it lives in the character space, what tension
 * does to it, and that a silent packet through its whole path draws nothing.
 * The pool and the ink have their own tests beside them; the generic bar every
 * study meets is `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness } from '../director/score'
import {
  SHARD_DEFAULTS,
  SHARD_FLOATS,
  SHARD_POOL,
  shardParams,
  ShardPool,
} from '../impls/shards.params'
import { SHARD_KNOBS } from '../presets/knobs'
import { findStudy, sceneOf } from './registry'
import { resolveStudy } from './resolve'

const study = findStudy('shards')
if (!study) throw new Error('Expected the shards study')

const silent = () => new Float32Array(PACKET_LENGTH)

describe('the shards study', () => {
  it('is the ink for the drop and for nothing else', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('shards')
    expect(study.moments).toEqual({ intro: 0, groove: 0, build: 0, drop: 1, rest: 0, outro: 0 })
    expect(study.cost).toBe('cheap')
  })

  it('rests at the numbers the implementation falls back on', () => {
    expect(study.knobs).toEqual(SHARD_DEFAULTS)
    expect(Object.keys(study.knobs).sort()).toEqual([...SHARD_KNOBS].sort())
  })

  it('reads as the shards when it is the only ink, on the canvas’s own line', () => {
    expect(sceneOf(['shards'])).toBe('shards')
  })

  // The handoff says lo-fi never gets shards and hardstyle does. The two
  // characters are the homes of the looks that were written for them.
  it('is in the hard, fast corner: a lo-fi character never reaches it and a hardstyle one does', () => {
    const lofi = findStudy('warm-soft')?.home
    const hardstyle = findStudy('hard-clean')?.home
    if (!lofi || !hardstyle) throw new Error('Expected the two looks')
    expect(closeness(study, lofi)).toBeLessThan(0.15)
    expect(closeness(study, hardstyle)).toBeGreaterThan(0.6)
  })
})

describe('what tension does to the shards', () => {
  const at = (tension: number) => resolveStudy(study, undefined, silent(), tension, 1, {})

  // The study is idle while tension is high, so there is little for it to do
  // but this: hold the light of what is thrown, so the release is a contrast.
  it('holds the intensity down while tension is high, and nothing else', () => {
    const calm = at(0)
    const wound = at(1)
    expect(wound.intensity).toBeLessThan((calm.intensity ?? 0) - 0.1)
    expect(wound.intensity).toBeGreaterThan(0.5)
    for (const knob of SHARD_KNOBS) {
      if (knob === 'intensity') continue
      expect(wound[knob], knob).toBe(calm[knob])
    }
  })

  it('dims the light on screen by the same amount, and leaves the burst’s shape alone', () => {
    const drawn = (tension: number) => {
      const params = shardParams(at(tension))
      const pool = new ShardPool()
      const out = new Float32Array(SHARD_POOL * SHARD_FLOATS)
      for (let step = 0; step < 30; step += 1) {
        const packet = silent()
        packet[F.impact] = step === 0 ? 1 : 0
        pool.step(packet, 1 / 60, params)
      }

      return { count: pool.fill(out, params, 16 / 9), out }
    }

    const calm = drawn(0)
    const wound = drawn(1)
    expect(wound.count).toBe(calm.count)
    expect(wound.out[0]).toBe(calm.out[0])
    expect(wound.out[3]).toBe(calm.out[3])
    expect(wound.out[7] ?? 0).toBeLessThan(calm.out[7] ?? 0)
  })
})

describe('silence through the whole path', () => {
  it('resolves a silent packet and throws nothing, however long it runs', () => {
    const params = shardParams(resolveStudy(study, undefined, silent(), 0, 1, {}))
    const pool = new ShardPool()
    for (let step = 0; step < 60 * 30; step += 1) pool.step(silent(), 1 / 60, params)
    expect(pool.thrown).toBe(0)
    expect(pool.alive).toBe(0)
  })
})
