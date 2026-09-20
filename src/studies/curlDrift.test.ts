/**
 * Curl drift as a study: where it lives, what tension does to it, what it does
 * at a silent packet, and that it can be turned off. The maths is
 * `impls/analytic.params.test.ts` and the generic bar every study meets is
 * `registry.test.ts`; this is what is particular to this one.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { pickCast } from '../director/director'
import type { MomentWeights } from '../director/moment'
import {
  ANALYTIC_RANGES,
  analyticField,
  analyticVelocity,
  fieldMoves,
} from '../impls/analytic.params'
import { visibleExtent } from '../scenes/fluid.params'
import { findStudy, STUDIES } from './registry'
import { resolveStudy } from './resolve'
import type { Character } from './types'

const study = findStudy('curl-drift')
if (!study) throw new Error('Expected the curl drift study')

const WIDE = visibleExtent(2560, 1440)
const silent = () => new Float32Array(PACKET_LENGTH)
const at = (tension: number, packet = silent(), presence = 1) =>
  resolveStudy(study, undefined, packet, tension, presence, {})

const heard = (values: Partial<Record<keyof typeof F, number>>) => {
  const packet = silent()
  for (const [name, value] of Object.entries(values)) packet[F[name as keyof typeof F]] = value
  return packet
}

describe('the curl drift study', () => {
  it('is the flow for the quiet moments, on the analytic implementation, and cheap', () => {
    expect(study.kind).toBe('flow')
    expect(study.impl).toBe('analytic')
    expect(study.moments).toEqual({ intro: 1, groove: 0, build: 0, drop: 0, rest: 1, outro: 1 })
    expect(study.cost).toBe('cheap')
  })

  it('takes any character and reaches over all of them', () => {
    expect(study.reach).toBe(1)
    for (const axis of Object.values(study.home)) expect(axis).toBe(0.5)
  })

  it('uses the curl term alone', () => {
    for (const packet of [silent(), heard({ energy: 1, swell: 1, pace: 1, weight: 1 })])
      for (const tension of [0, 1]) {
        const knobs = at(tension, packet)
        expect([knobs.radial, knobs.swirl, knobs.twist, knobs.falloff]).toEqual([0, 0, 0, 0])
      }
  })
})

// A flow draws nothing, so what a silent packet asks of it is to keep the
// picture moving at its resting speed and no more.
describe('at a silent packet', () => {
  it('drifts at its resting speed, slowly, and is not switched off', () => {
    const knobs = at(0)
    expect(knobs.curl).toBeCloseTo(0.02, 12)
    const field = analyticField(knobs, 1, WIDE, 0.4)
    expect(fieldMoves(field)).toBe(true)
    let fastest = 0
    for (let column = 0; column < 30; column += 1)
      for (let row = 0; row < 30; row += 1)
        fastest = Math.max(fastest, Math.hypot(...analyticVelocity(field, [column / 29, row / 29])))
    // About 50 pixels a second across 2560, at the very fastest point.
    expect(fastest).toBeLessThanOrEqual(0.02 + 1e-12)
    expect(fastest).toBeGreaterThan(0.01)
  })

  it('costs nothing at presence 0', () => {
    const field = analyticField(at(1, heard({ energy: 1 }), 0), 0, WIDE, 0.4)
    expect(fieldMoves(field)).toBe(false)
  })
})

// The bar: a test shows tension moving a knob. It speeds the drift and hurries
// the pattern's own evolution, and leaves the size of the cells to the song.
describe('what tension does to it', () => {
  it('speeds the drift and the evolution, and leaves the cells alone', () => {
    const calm = at(0)
    const wound = at(1)
    expect(wound.curl).toBeGreaterThan((calm.curl ?? 0) + 0.05)
    expect(wound.curlRate).toBeGreaterThan((calm.curlRate ?? 0) + 0.04)
    expect(wound.curlScale).toBe(calm.curlScale)
  })

  it('winds the drift up smoothly, with no step, over the whole of a build', () => {
    let last = at(0).curl ?? 0
    for (let tension = 0.05; tension <= 1.0001; tension += 0.05) {
      const now = at(tension).curl ?? 0
      expect(now).toBeGreaterThan(last)
      expect(now - last).toBeLessThan(0.01)
      last = now
    }
  })

  it('stays slow at the top of it', () => {
    const full = at(1, heard({ energy: 1, swell: 1, pace: 1, weight: 1 }))
    expect(full.curl).toBeCloseTo(0.15, 12)
    expect(full.curl).toBeLessThan(ANALYTIC_RANGES.curl[1] / 2)
  })
})

// Nothing sits still: the speed follows the level and the swell, and the size
// of the cells follows how busy and how heavy the track is.
describe('what the song does to it', () => {
  it('speeds up with loudness and with a lifting passage', () => {
    expect(at(0, heard({ energy: 1 })).curl).toBeGreaterThan(at(0).curl ?? 0)
    expect(at(0, heard({ swell: 1 })).curl).toBeGreaterThan(at(0).curl ?? 0)
  })

  it('makes finer cells for a busy track and larger ones for a bass-led one', () => {
    const rest = at(0).curlScale ?? 0
    expect(at(0, heard({ pace: 1 })).curlScale).toBeGreaterThan(rest)
    expect(at(0, heard({ weight: 1 })).curlScale).toBeLessThan(rest)
  })

  it('evolves faster for a busy track', () => {
    expect(at(0, heard({ pace: 1 })).curlRate).toBeGreaterThan(at(0).curlRate ?? 0)
  })
})

describe('in the director', () => {
  const weights = (values: Partial<MomentWeights>): MomentWeights => ({
    intro: 0,
    groove: 0,
    build: 0,
    drop: 0,
    rest: 0,
    outro: 0,
    ...values,
  })

  const characters: Record<string, Character> = {
    'neutral': { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
    'lo-fi': { drive: 0.2, weight: 0.6, tonality: 0.6, steadiness: 0.4, hardness: 0.15 },
    'hardstyle': { drive: 0.85, weight: 0.5, tonality: 0.5, steadiness: 0.6, hardness: 0.9 },
  }

  // Its reach is the widest there is, so in a quiet moment it outscores the
  // lazy fluid for most characters, and the only ink that suits a quiet moment
  // today is the dye, which needs a fluid under it. The director has to fall
  // through to a flow the ink can sit on and not leave the canvas with nothing.
  it('never leaves an intro or a rest without a cast', () => {
    for (const [name, character] of Object.entries(characters))
      for (const moment of ['intro', 'rest'] as const)
        for (const settled of [0, 1]) {
          const cast = pickCast({ character, weights: weights({ [moment]: 1 }), settled })
          expect(cast, `${name} ${moment} settled ${settled}`).toBeDefined()
          expect(cast?.inks.length, `${name} ${moment} settled ${settled}`).toBeGreaterThan(0)
        }
  })

  it('is the flow of an outro, where nothing needs a fluid', () => {
    const cast = pickCast({
      character: characters.neutral as Character,
      weights: weights({ outro: 1 }),
    })
    expect(cast?.flow).toBe('curl-drift')
  })

  it('is never the flow of a groove, a build or a drop', () => {
    for (const moment of ['groove', 'build', 'drop'] as const)
      for (const [name, character] of Object.entries(characters))
        expect(
          pickCast({ character, weights: weights({ [moment]: 1 }) })?.flow,
          `${name} ${moment}`,
        ).not.toBe('curl-drift')
  })

  it('is in the registry once', () => {
    expect(STUDIES.filter((entry) => entry.id === 'curl-drift')).toHaveLength(1)
  })
})
