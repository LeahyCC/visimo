import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { defaultPostParams, POST_LANES, POST_STAGES } from '../post/params'
import type { PostParams } from '../post/params'
import { LOOK_KNOBS } from './impls'
import { findStudy } from './registry'
import { resolveLook, resolveStudy, studyFeature } from './resolve'
import { isLook } from './types'
import type { InkStudy, LookStudy } from './types'

const packet = (values: Partial<Record<keyof typeof F, number>>) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

const look = (id: string): LookStudy => {
  const study = findStudy(id)
  if (!study || !isLook(study)) throw new Error(`Expected the ${id} look`)
  return study
}

const ink: InkStudy = {
  id: 'test-ink',
  kind: 'ink',
  name: 'Test',
  impl: 'dye',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 0, groove: 1, build: 0, drop: 0, rest: 0, outro: 0 },
  knobs: { dye: 1, saturation: 0.5 },
  mapping: [
    { from: 'energy', to: 'dye', gain: 2, curve: 'linear' },
    { from: 'tension', to: 'saturation', gain: -0.4, curve: 'linear' },
  ],
  cost: 'cheap',
}

describe('studyFeature', () => {
  it('reads the packet by name, as a preset does', () => {
    expect(studyFeature(packet({ treble: 0.4 }), 'treble', 0, 1)).toBeCloseTo(0.4)
    expect(studyFeature(packet({ sub: 0.2, bass: 0.7 }), 'lowEnd', 0, 1)).toBeCloseTo(0.7)
  })

  // Neither of these is in the packet the renderer holds: tension arrives as
  // an argument until its row exists, and presence is the director's fade.
  it('takes tension and presence from its arguments', () => {
    expect(studyFeature(packet({}), 'tension', 0.75, 1)).toBe(0.75)
    expect(studyFeature(packet({}), 'presence', 0, 0.25)).toBe(0.25)
  })
})

describe('resolveStudy', () => {
  it('is the resting values where nothing drives a knob', () => {
    expect(resolveStudy(ink, undefined, packet({}), 0, 1, {})).toEqual({ dye: 1, saturation: 0.5 })
  })

  it('adds gain times the bent field, tension included', () => {
    const out = resolveStudy(ink, undefined, packet({ energy: 0.5 }), 0.5, 1, {})
    expect(out.dye).toBeCloseTo(2)
    expect(out.saturation).toBeCloseTo(0.3)
  })

  it('takes the cast’s knobs, then the study’s rows, then the cast’s rows', () => {
    const overrides = {
      knobs: { dye: 4 },
      mapping: [{ from: 'energy', to: 'dye', gain: 1, curve: 'linear' } as const],
    }
    expect(resolveStudy(ink, overrides, packet({ energy: 1 }), 0, 1, {}).dye).toBeCloseTo(7)
  })

  it('ignores a row aimed at a knob the study does not have', () => {
    const overrides = { mapping: [{ from: 'energy', to: 'vorticity', gain: 9, curve: 'linear' }] }
    const out = resolveStudy(ink, overrides as never, packet({ energy: 1 }), 0, 1, {})
    expect(out).toEqual({ dye: 3, saturation: 0.5 })
  })

  it('rewrites the object it is given rather than keeping the last study’s knobs', () => {
    const out: Record<string, number> = {}
    resolveStudy(ink, undefined, packet({}), 0, 1, out)
    const fluid = findStudy('lazy-fluid')
    if (!fluid) throw new Error('Expected the lazy fluid')
    resolveStudy(fluid, undefined, packet({}), 0, 1, out)
    expect(Object.keys(out).sort()).toEqual(Object.keys(fluid.knobs).sort())
  })
})

/**
 * The stack a look is written into: the defaults with every stage off, which
 * is what `resolveCast` hands over. A look only ever switches a stage on, so
 * two of them cross-fading show the union of their stages.
 */
const bare = (): PostParams => {
  const out = defaultPostParams()
  for (const stage of POST_STAGES) out[stage].enabled = false
  return out
}

/** Every lane of a look on its own, at full presence. */
const alone = (study: LookStudy, presence = 1): PostParams =>
  resolveLook(study, undefined, packet({ energy: 0.5, treble: 0.5 }), 0, presence, bare())

describe('resolveLook', () => {
  it('at full presence is the look’s own numbers', () => {
    const warm = look('warm-soft')
    const out = alone(warm)
    expect(out.bloom.threshold).toBeCloseTo(0.85 - 0.1 * 0.5)
    expect(out.grain.amount).toBeCloseTo(0.012 + 0.008)
  })

  it('switches on the stages it names and leaves the rest alone', () => {
    const out = alone(look('clean-glass'))
    expect(out.bloom.enabled).toBe(true)
    expect(out.tonemap.enabled).toBe(true)
    expect(out.grain.enabled).toBe(false)
    expect(out.chromatic.enabled).toBe(false)
  })

  it('at presence 0 contributes nothing at all', () => {
    expect(alone(look('warm-soft'), 0)).toEqual(bare())
  })

  // The whole reason a look acts on presence: two of them can be on at once
  // while the director slides one into the other, and neither knows it.
  it('two looks at a half each land halfway between them', () => {
    const warm = look('warm-soft')
    const hard = look('hard-clean')
    const both = bare()
    const features = packet({ energy: 0.5, treble: 0.5 })
    resolveLook(warm, undefined, features, 0, 0.5, both)
    resolveLook(hard, undefined, features, 0, 0.5, both)
    const first = alone(warm)
    const second = alone(hard)
    for (const knob of LOOK_KNOBS) {
      const lane = POST_LANES[knob]
      expect(lane.read(both), `${knob} halfway`).toBeCloseTo(
        (lane.read(first) + lane.read(second)) / 2,
        10,
      )
    }
  })
})
