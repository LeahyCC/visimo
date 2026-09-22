/**
 * The ocean as a study: that it is the ink for the intro, the groove and the
 * rest of a quiet, tonal, low-drive track, that a silent packet draws
 * nothing, what the music and tension do to it, and the two things it is
 * held to, that it never gets louder with the level and that it is sparse.
 * The wave maths has its own test beside `ocean.params.ts`, the ground is
 * height-kit's, and the generic bar every study meets is `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { pickCast } from '../director/director'
import { closeness } from '../director/score'
import { TRACKS } from '../director/tracks.fixture'
import { oceanCoverage, oceanLit, oceanParams } from '../impls/ocean.params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { findStudy } from './registry'
import { resolveStudy } from './resolve'
import type { RowState } from './resolve'
import { MOMENTS } from './types'

const study = findStudy('ocean')
if (!study) throw new Error('Expected the ocean study')

const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

/** Every audio field at one level, so the two ends of what a packet can be. */
const filled = (level: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') out[F[field]] = level
  return out
}

const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

const track = (start: string) => {
  const found = TRACKS.find((each) => each.name.startsWith(start))
  if (!found) throw new Error(`Expected ${start} in the fixture`)
  return found.character
}

/** What a quiet, tonal groove plays over: mids and highs sounding, some energy, little drive. */
const QUIET_GROOVE = {
  sub: 0.3,
  bass: 0.35,
  lowMid: 0.4,
  highMid: 0.35,
  treble: 0.25,
  energy: 0.4,
  pace: 0.2,
} as const

describe('where the ocean belongs', () => {
  it('is a medium-cost ink for the intro, the groove, the rest and the outro of a quiet track', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('ocean')
    expect(study.cost).toBe('medium')
    expect(study.moments).toEqual({
      intro: 1,
      groove: 0.7,
      build: 0,
      drop: 0,
      rest: 1,
      outro: 1,
    })
    expect(Object.keys(study.moments).sort()).toEqual([...MOMENTS].sort())
  })

  it('welcomes ambient and downtempo tracks, and not a hard, driven one', () => {
    const ambient = closeness(study, track('Christian Loffler'))
    expect(ambient).toBeGreaterThan(0.5)
    expect(closeness(study, track('Jon Hopkins'))).toBeGreaterThan(0.4)
    expect(closeness(study, track('Emancipator'))).toBeGreaterThan(0.4)
    expect(closeness(study, track('August Burns Red'))).toBeLessThan(ambient / 2)
    expect(closeness(study, track('Pendulum'))).toBeLessThan(ambient / 2)
  })

  it('is cast for an ambient track at rest, and left out of its build', () => {
    const casts = (weights: Partial<Record<(typeof MOMENTS)[number], number>>) =>
      [0, 1, 2].some((rotation) =>
        pickCast({
          character: track('Christian Loffler'),
          weights: { intro: 0, groove: 0, build: 0, drop: 0, rest: 0, outro: 0, ...weights },
          rotation,
        })?.inks.includes('ocean'),
      )

    expect(casts({ rest: 1 })).toBe(true)
    expect(casts({ build: 1 })).toBe(false)
  })
})

describe('silence and the level', () => {
  it('draws nothing on a silent packet, at any tension', () => {
    for (const tension of [0, 0.5, 1])
      expect(oceanLit(oceanParams(at(packetOf(), tension))), `tension ${tension}`).toBe(false)
  })

  it('is never brighter for the music being louder: the intensity gates down and rests at its resting value', () => {
    const resting = study.knobs.intensity ?? 0
    expect(resting).toBeGreaterThan(1)
    let previous = 0
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      const intensity = at(filled(level)).intensity ?? 0
      expect(intensity).toBeLessThanOrEqual(resting + 1e-9)
      expect(intensity).toBeGreaterThanOrEqual(previous - 1e-9)
      previous = intensity
    }

    expect(at(filled(1)).intensity).toBeCloseTo(resting, 9)
  })

  it('puts the punch into the swell, the chop and the speed instead', () => {
    const quiet = at(packetOf({ energy: 0.1, pace: 0.1 }))
    const loud = at(packetOf({ energy: 1, pace: 0.8, highMid: 0.8, treble: 0.6 }))
    expect(loud.swell).toBeGreaterThan(quiet.swell ?? 0)
    expect(loud.chop).toBeGreaterThan(quiet.chop ?? 0)
    expect(loud.speed).toBeGreaterThan(quiet.speed ?? 0)
  })
})

describe('what the music does to it', () => {
  it('the swell lifts with the low end and the energy', () => {
    expect(at(packetOf({ ...QUIET_GROOVE, energy: 1 })).swell).toBeGreaterThan(
      at(packetOf({ ...QUIET_GROOVE, energy: 0 })).swell ?? 0,
    )
  })

  it('the chop answers the mids and the treble, and glints answer the treble and its pulse', () => {
    expect(at(packetOf({ ...QUIET_GROOVE, highMid: 1, treble: 1 })).chop).toBeGreaterThan(
      at(packetOf({ ...QUIET_GROOVE, highMid: 0, treble: 0 })).chop ?? 0,
    )

    expect(at(packetOf({ ...QUIET_GROOVE, treble: 1 })).glints).toBeGreaterThan(
      at(packetOf({ ...QUIET_GROOVE, treble: 0 })).glints ?? 0,
    )
    // The pulse rides an envelope, so it wants stepping to see it swell.
    const withPulse = (trigger: number) => {
      const states: RowState[] = []
      const out: Record<string, number> = {}
      const packet = packetOf({ ...QUIET_GROOVE, treblePulse: trigger })
      for (let step = 0; step < 6; step += 1)
        resolveStudy(study, undefined, packet, 0, 1, out, 1 / 60, states)
      return out.glints ?? 0
    }
    expect(withPulse(1)).toBeGreaterThan(withPulse(0))
  })

  it('the path widens with the energy and a bass hit', () => {
    expect(at(packetOf({ ...QUIET_GROOVE, energy: 1 })).path).toBeGreaterThan(
      at(packetOf({ ...QUIET_GROOVE, energy: 0 })).path ?? 0,
    )
  })

  it('turns the hue with a chord change and a passage lifting', () => {
    expect(at(packetOf({ ...QUIET_GROOVE, harmonicChange: 1 })).hue).toBeGreaterThan(
      at(packetOf({ ...QUIET_GROOVE, harmonicChange: 0 })).hue ?? 0,
    )

    expect(at(packetOf({ ...QUIET_GROOVE, swell: 1 })).hue).toBeGreaterThan(
      at(packetOf({ ...QUIET_GROOVE, swell: 0 })).hue ?? 0,
    )
  })
})

describe('the horizon', () => {
  it('widens with the level and a bass hit', () => {
    const quiet = at(packetOf({ energy: 0.1 }))
    const loud = at(packetOf({ energy: 1 }))
    expect(loud.horizon).toBeGreaterThan(quiet.horizon ?? 0)
    expect(at(packetOf({ ...QUIET_GROOVE, bassPulse: 1 })).horizon).toBeGreaterThan(
      at(packetOf({ ...QUIET_GROOVE, bassPulse: 0 })).horizon ?? 0,
    )
  })
})

describe('what tension does', () => {
  it('drains and stills the sea: slower, flatter and less choppy the more it winds up', () => {
    const calm = at(packetOf({ ...QUIET_GROOVE }), 0)
    const winding = at(packetOf({ ...QUIET_GROOVE }), 1)
    expect(winding.speed).toBeLessThan(calm.speed ?? 0)
    expect(winding.swell).toBeLessThan(calm.swell ?? 0)
    expect(winding.chop).toBeLessThan(calm.chop ?? 0)
  })

  it('never drives the sea backward: speed stays at or above zero even when energy and tension are both full but pace is not', () => {
    const winding = at(packetOf({ ...QUIET_GROOVE, energy: 1 }), 1)
    expect(winding.speed).toBeGreaterThanOrEqual(0)
  })

  it('a swell lets the water back in', () => {
    const held = at(packetOf({ ...QUIET_GROOVE, swell: 0 }), 1)
    const released = at(packetOf({ ...QUIET_GROOVE, swell: 1 }), 1)
    expect(released.swell).toBeGreaterThan(held.swell ?? 0)
  })
})

describe('sparse, and flash safe', () => {
  it('stays well under a third of the frame at the loudest the mapping reaches', () => {
    const params = oceanParams(at(filled(1), 0))
    const share = oceanCoverage(params, 1920, 1080, { stride: 6 })
    expect(share).toBeGreaterThan(0)
    expect(share).toBeLessThan(1 / 3)
  })

  it('stays in the same order as rest across the whole of what the mapping reaches', () => {
    // A rougher, taller sea does not sum to a bigger lit share the way the
    // grid's static marks do: more chop spreads facets' reflections further
    // from the horizon's own bright band, so a good many of them end up
    // looking at deep, dark sky instead of the glow, which reads as a
    // stormier and not a brighter sea. Measured: coverage falls a little as
    // swell and chop climb from rest toward their ceiling (roughly 7.8% down
    // to 4.2% over the full range in `oceanCoverage`), never climbs past
    // rest, and never comes close to collapsing. That is the punch going
    // into the sea's character rather than into a light nobody asked for,
    // and it is still comfortably inside the sparsity ceiling at every point
    // on the way, which the test above holds it to at the far end.
    const rest = oceanCoverage(oceanParams(study.knobs), 1920, 1080, { stride: 6 })
    const widest = oceanCoverage(oceanParams(at(filled(1), 0)), 1920, 1080, { stride: 6 })
    expect(widest).toBeGreaterThan(rest * 0.5)
    expect(widest).toBeLessThan(rest * 1.5)
  })
})
