/**
 * The 3D grid as a study: that it is the ink for the groove and the build of a
 * steady, mid drive track, that a silent packet draws nothing, what the music
 * and tension do to it, and the two things it is held to, that it never gets
 * louder with the level and that it is sparse. The grid's numbers and the ink
 * have their own tests beside them, the ground is height-kit's, and the
 * generic bar every study meets is `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { pickCast } from '../director/director'
import { closeness } from '../director/score'
import { LOFI } from '../director/song.fixture'
import { TRACKS } from '../director/tracks.fixture'
import { gridCoverage, gridLit, gridParams, PULSE_FIRE } from '../impls/grid.params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { GRID_KNOBS } from './impls'
import { findStudy } from './registry'
import { resolveStudy } from './resolve'
import type { RowState } from './resolve'
import { MOMENTS } from './types'

const study = findStudy('grid-3d')
if (!study) throw new Error('Expected the grid study')

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

/** What a groove plays over: every band sounding, a beat and some energy. */
const GROOVE = {
  sub: 0.7,
  bass: 0.6,
  lowMid: 0.5,
  highMid: 0.4,
  treble: 0.3,
  energy: 0.6,
  pace: 0.5,
} as const

describe('where the grid belongs', () => {
  it('is a cheap ink for the groove and the build, and half the drop and less of the intro', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('grid')
    expect(study.cost).toBe('cheap')
    expect(study.moments).toEqual({
      intro: 0.4,
      groove: 1,
      build: 0.9,
      drop: 0.5,
      rest: 0,
      outro: 0,
    })
    expect(Object.keys(study.moments).sort()).toEqual([...MOMENTS].sort())
    expect(study.reach).toBeCloseTo(0.35, 9)
  })

  it('welcomes the house and the tech house the catalogue names, and not lo-fi or an orchestra', () => {
    const house = closeness(study, track('FISHER'))
    expect(house).toBeGreaterThan(0.6)
    expect(closeness(study, track('John Summit'))).toBeGreaterThan(0.6)
    expect(closeness(study, track('Pendulum'))).toBeGreaterThan(0.5)
    expect(closeness(study, LOFI)).toBeLessThan(0.4)
    expect(closeness(study, track('Daft Punk, Adagio'))).toBeLessThan(house / 3)
    expect(closeness(study, track('Wilco'))).toBeLessThan(house / 3)
  })

  it('is cast for a steady house track in its groove and its build, and left out of its rest', () => {
    const casts = (weights: Partial<Record<(typeof MOMENTS)[number], number>>) =>
      [0, 1, 2].some((rotation) =>
        pickCast({
          character: track('FISHER'),
          weights: { intro: 0, groove: 0, build: 0, drop: 0, rest: 0, outro: 0, ...weights },
          rotation,
        })?.inks.includes('grid-3d'),
      )

    expect(casts({ groove: 1 })).toBe(true)
    expect(casts({ rest: 1 })).toBe(false)
  })
})

describe('silence and the level', () => {
  it('draws nothing on a silent packet, at any tension', () => {
    for (const tension of [0, 0.5, 1])
      expect(gridLit(gridParams(at(packetOf(), tension))), `tension ${tension}`).toBe(false)
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

    // A full packet is exactly rest, and the punch is elsewhere.
    expect(at(filled(1)).intensity).toBeCloseTo(resting, 9)
  })

  it('puts the punch into the height, the width and the speed instead', () => {
    const quiet = at(packetOf({ energy: 0.1, pace: 0.1 }))
    const loud = at(packetOf({ energy: 1, pace: 0.8 }))
    expect(loud.height).toBeGreaterThan(quiet.height ?? 0)
    expect(loud.width).toBeGreaterThan(quiet.width ?? 0)
    expect(loud.speed).toBeGreaterThan(quiet.speed ?? 0)
  })
})

describe('what the music does to it', () => {
  it('flies faster on a busier track', () => {
    expect(at(packetOf({ ...GROOVE, pace: 0.9 })).speed).toBeGreaterThan(
      at(packetOf({ ...GROOVE, pace: 0.2 })).speed ?? 0,
    )
  })

  it('gives the beat a small surge that overshoots and settles where pace left it', () => {
    const states: RowState[] = []
    const out: Record<string, number> = {}
    const packet = packetOf({ ...GROOVE })
    let peak = 0
    let settled = 0
    // A hit that holds: the spring rings over the level and comes back to it.
    packet[F.beatPulse] = 1
    for (let step = 0; step < 4 * 60; step += 1) {
      resolveStudy(study, undefined, packet, 0, 1, out, 1 / 60, states)
      peak = Math.max(peak, out.speed ?? 0)
      settled = out.speed ?? 0
    }

    const without = at(packetOf({ ...GROOVE })).speed ?? 0
    // Rests exactly on its signal, so the level it settles to is the row's gain.
    expect(settled - without).toBeCloseTo(1, 3)
    // Overshoots by a sixth of the step, which is a small surge on the resting speed.
    expect(peak - settled).toBeGreaterThan(0.1)
    expect(peak - settled).toBeLessThan(0.3)
  })

  it('draws the same surge at any frame rate', () => {
    const speedAfter = (fps: number) => {
      const states: RowState[] = []
      const out: Record<string, number> = {}
      const packet = packetOf({ ...GROOVE })
      packet[F.beatPulse] = 1
      for (let step = 0; step < Math.round(0.5 * fps); step += 1)
        resolveStudy(study, undefined, packet, 0, 1, out, 1 / fps, states)
      return out.speed ?? 0
    }

    const speeds = [30, 60, 144, 240].map(speedAfter)
    expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(1e-6)
  })

  it('lifts the crest with the low end and the glow with the kick', () => {
    expect(at(packetOf({ ...GROOVE, bassPulse: 1 })).height).toBeGreaterThan(
      at(packetOf({ ...GROOVE, bassPulse: 0 })).height ?? 0,
    )

    expect(at(packetOf({ ...GROOVE, bassPulse: 1 })).glow).toBeGreaterThan(
      at(packetOf({ ...GROOVE, bassPulse: 0 })).glow ?? 0,
    )
  })

  it('tightens the glow on a hard track and turns the hue with a chord change', () => {
    expect(at(packetOf({ ...GROOVE, hardness: 1 })).glow).toBeLessThan(
      at(packetOf({ ...GROOVE, hardness: 0 })).glow ?? 0,
    )

    expect(at(packetOf({ ...GROOVE, harmonicChange: 1 })).hue).toBeGreaterThan(
      at(packetOf({ ...GROOVE, harmonicChange: 0 })).hue ?? 0,
    )
  })

  it('starts the pulse on an impact and on nothing else', () => {
    expect(at(packetOf({ ...GROOVE, impact: 1 })).pulse).toBeGreaterThanOrEqual(PULSE_FIRE)
    expect(at(packetOf({ ...GROOVE, release: 1, tension: 1 })).pulse).toBe(0)
    expect(at(filled(1)).pulse).toBeGreaterThanOrEqual(PULSE_FIRE)
    const noImpact = filled(1)
    noImpact[F.impact] = 0
    expect(at(noImpact).pulse).toBe(0)
  })
})

describe('what tension does', () => {
  it('rushes the grid toward you and narrows the valley', () => {
    const calm = at(packetOf({ ...GROOVE }), 0)
    const winding = at(packetOf({ ...GROOVE }), 1)
    expect(winding.speed).toBeGreaterThan((calm.speed ?? 0) * 2)
    expect(winding.valley).toBeLessThan(calm.valley ?? 0)
  })

  it('leaves the light alone, so a build is closer and not brighter', () => {
    expect(at(packetOf({ ...GROOVE }), 1).intensity).toBe(at(packetOf({ ...GROOVE }), 0).intensity)
  })

  it('never takes the valley out of range at the top of a build', () => {
    for (const level of [0, 1]) {
      const valley = at(filled(level), 1).valley ?? 0
      expect(valley).toBeGreaterThan(0.08)
    }
  })
})

describe('how much it lights', () => {
  it('resolves every knob the ink has, and no other', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...GRID_KNOBS].sort())
  })

  it('lights under a fifth of a 16:9 frame at the widest its own mapping reaches', () => {
    // A full packet with the hardness at nothing and a kick landing: the
    // widest line and the widest glow the rows can add up to.
    const widest = packetOf({
      energy: 1,
      pace: 1,
      beatPulse: 1,
      bassPulse: 1,
      hardness: 0,
      tempoConfidence: 1,
    })
    const params = gridParams(at(widest, 0))
    expect(params.width).toBeGreaterThan(1.5)
    for (const [width, height] of [
      [480, 270],
      [270, 270],
      [200, 360],
    ] as const)
      expect(gridCoverage(params, width, height), `${width} by ${height}`).toBeLessThan(0.2)
  })
})
