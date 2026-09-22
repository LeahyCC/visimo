/**
 * The murmuration as a study: where it lives in the character space, that a
 * silent packet through its whole path draws nothing, that the music moves it
 * by level and by hit and not by `tension`, `release` or `impact` alone, what a
 * build does to it, and that it stays sparse at the most its own mapping
 * reaches. The field's own numbers have their tests in
 * `impls/particles.params.test.ts` and its GPU side, including that the two
 * grid dispatches are encoded when the steering is live and skipped when it is
 * not, in `impls/ParticleField.test.ts`; the generic bar every study meets is
 * `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness } from '../director/score'
import { TRACKS } from '../director/tracks.fixture'
import {
  boidsRun,
  fieldRuns,
  MURMURATION_PROFILE,
  MURMURATION_RANGES,
  particleCoverage,
  particleParams,
  planSpawns,
  spawnState,
} from '../impls/particles.params'
import type { SpawnGroup } from '../impls/particles.params'
import { MURMURATION_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { resolveStudy } from './resolve'
import type { RowState } from './resolve'

const study = findStudy('murmuration')
if (!study) throw new Error('Expected the murmuration study')

const silent = () => new Float32Array(PACKET_LENGTH)

/** A packet with the named rows set and everything else silent. */
const with_ = (rows: Record<number, number>) => {
  const out = silent()
  for (const [row, value] of Object.entries(rows)) out[Number(row)] = value
  return out
}

/**
 * A groove as a real track gives one: the bands are sounding, the track is
 * busy, and no row that a real track rarely raises is in it. `tension`,
 * `release` and `impact` are all left at nothing on purpose.
 */
const GROOVE = {
  [F.energy]: 0.6,
  [F.sub]: 0.7,
  [F.bass]: 0.7,
  [F.lowMid]: 0.5,
  [F.highMid]: 0.5,
  [F.treble]: 0.5,
  [F.pace]: 0.5,
  [F.hardness]: 0.4,
  [F.weight]: 0.4,
  [F.swell]: 0.5,
}

const FULL = () => new Float32Array(PACKET_LENGTH).fill(1)

/**
 * The knobs held at a packet until every follower has reached it, since the
 * separation reads a hit through an envelope and a stateless reading of it is
 * a reading of a study that has just arrived. Two seconds at 60 frames is a
 * dozen time constants of the 300 ms release.
 */
const settled = (packet: Float32Array, tension = 0) => {
  const out: Record<string, number> = {}
  const states: RowState[] = []
  for (let frame = 0; frame < 120; frame += 1)
    resolveStudy(study, undefined, packet, tension, 1, out, 1 / 60, states)
  return out
}

const paramsOf = (packet: Float32Array, tension = 0) =>
  particleParams(settled(packet, tension), MURMURATION_PROFILE)

describe('the murmuration study', () => {
  it('is the ink for the groove, the build and the drop, and for nothing else', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('murmuration')
    expect(study.moments).toEqual({ intro: 0, groove: 1, build: 0.9, drop: 0.8, rest: 0, outro: 0 })
    expect(study.cost).toBe('medium')
  })

  it('rests on every knob its implementation has, and no others', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...MURMURATION_KNOBS].sort())
  })

  it('reads as the murmuration when it is the only ink, on the canvas’s own line', () => {
    expect(sceneOf(['murmuration'])).toBe('murmuration')
  })

  // The catalogue's home: DnB, IDM and orchestral, so mid to high drive, mid
  // steadiness and mid hardness, and not the hardest corner, which is full.
  it('lives at mid to high drive and mid hardness, and not in the hardest corner', () => {
    expect(study.home.drive).toBeGreaterThanOrEqual(0.5)
    expect(study.home.hardness).toBeGreaterThan(0.25)
    expect(study.home.hardness).toBeLessThan(0.55)
    expect(study.home.steadiness).toBeGreaterThan(0.4)
    expect(study.home.steadiness).toBeLessThan(0.7)
    expect(study.reach).toBeCloseTo(0.35, 9)
  })

  it('is at home for the DnB and IDM tracks measured, and less so for the ambient end', () => {
    const named = (fragment: string) => {
      const track = TRACKS.find((entry) => entry.name.includes(fragment))
      if (!track) throw new Error(`Expected a track with ${fragment} in its name`)
      return closeness(study, track.character)
    }

    // A drum and bass track, a drum and bass track with an orchestra, and an IDM remix.
    for (const fragment of ['Pendulum', 'Noisia', 'Skttrbrain'])
      expect(named(fragment), fragment).toBeGreaterThan(0.6)
    // The softest of the twenty, an ambient house track, is not what it is for.
    expect(named('Loffler')).toBeLessThan(0.4)
  })
})

describe('what the music does to the murmuration', () => {
  it('comes in with the level alone: a groove with no tension, release or impact in it draws a flock', () => {
    const packet = with_(GROOVE)
    expect(packet[F.tension]).toBe(0)
    expect(packet[F.release]).toBe(0)
    expect(packet[F.impact]).toBe(0)
    const params = paramsOf(packet)
    expect(fieldRuns(params, 1)).toBe(true)
    expect(params.count).toBeGreaterThan(3000)
    expect(params.rate).toBeGreaterThan(400)
    expect(boidsRun(params)).toBe(true)
  })

  it('grows the flock with the level and is dark in silence', () => {
    const counts = [0, 0.1, 0.3, 0.6, 1].map(
      (energy) => paramsOf(with_({ ...GROOVE, [F.energy]: energy })).count,
    )
    for (let step = 1; step < counts.length; step += 1)
      expect(counts[step] ?? 0).toBeGreaterThan(counts[step - 1] ?? 0)
    expect(counts[0]).toBe(0)
  })

  it('opens the body on each kick, without the drop, and closes it again', () => {
    const closed = paramsOf(with_({ ...GROOVE, [F.bassPulse]: 0 }))
    const struck = paramsOf(with_({ ...GROOVE, [F.bassPulse]: 1 }))
    expect(struck.separation).toBeGreaterThan(closed.separation + 0.3)
    // The gather and the cohesion do not move, so what pulls the body back in
    // is exactly what was holding it before the hit.
    expect(struck.gather).toBe(closed.gather)
    expect(struck.cohesion).toBe(closed.cohesion)
  })

  it('lets a kick go: the envelope falls to a third of itself in about 300 ms', () => {
    const packet = with_({ ...GROOVE, [F.bassPulse]: 1 })
    const out: Record<string, number> = {}
    const states: RowState[] = []
    const read: number[] = []
    for (let frame = 0; frame < 60; frame += 1) {
      packet[F.bassPulse] = frame < 6 ? 1 : 0
      resolveStudy(study, undefined, packet, 0, 1, out, 1 / 60, states)
      read.push(out.separation ?? 0)
    }

    const rest = study.knobs.separation ?? 0
    // Four tenths of a second after the pulse let go it is under a third of the way up.
    expect((read[6 + 24] ?? 0) - rest).toBeLessThan(0.4 / 3)
    expect((read[5] ?? 0) - rest).toBeGreaterThan(0.3)
  })

  it('opens wider on the drop, and it is the impact that does it', () => {
    const quiet = paramsOf(with_(GROOVE))
    const drop = paramsOf(with_({ ...GROOVE, [F.impact]: 1 }))
    expect(drop.separation).toBeGreaterThan(quiet.separation + 0.4)
  })

  it('streaks longer with the level and with a hat', () => {
    const soft = paramsOf(with_({ ...GROOVE, [F.energy]: 0.2 }))
    const loud = paramsOf(with_({ ...GROOVE, [F.energy]: 1 }))
    const hat = paramsOf(with_({ ...GROOVE, [F.treblePulse]: 1 }))
    expect(loud.streak).toBeGreaterThan(soft.streak)
    expect(hat.streak).toBeGreaterThan(paramsOf(with_(GROOVE)).streak)
  })

  it('flies faster and keeps its birds better in step on a busier track', () => {
    const slow = paramsOf(with_({ ...GROOVE, [F.pace]: 0.1 }))
    const busy = paramsOf(with_({ ...GROOVE, [F.pace]: 0.9 }))
    expect(busy.gravity).toBeGreaterThan(slow.gravity)
    expect(busy.alignment).toBeGreaterThan(slow.alignment)
  })

  it('turns its heading with the music and never in silence', () => {
    // Held at a loud packet the heading has to keep moving, and it is a
    // turn: it wraps into the range the field accepts.
    const packet = with_(GROOVE)
    const out: Record<string, number> = {}
    const states: RowState[] = []
    const seen: number[] = []
    for (let frame = 0; frame < 60 * 40; frame += 1) {
      resolveStudy(study, undefined, packet, 0, 1, out, 1 / 60, states)
      seen.push(out.gravityAngle ?? 0)
    }

    expect(Math.max(...seen)).toBeLessThanOrEqual(Math.PI * 2)
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0)
    // A full turn in about 16 seconds of loud music: several folds in 40.
    let wraps = 0
    for (let at = 1; at < seen.length; at += 1)
      if ((seen[at] ?? 0) < (seen[at - 1] ?? 0)) wraps += 1
    expect(wraps).toBeGreaterThanOrEqual(1)

    const still: Record<string, number> = {}
    const quiet: RowState[] = []
    for (let frame = 0; frame < 600; frame += 1)
      resolveStudy(study, undefined, silent(), 0, 1, still, 1 / 60, quiet)
    expect(still.gravityAngle).toBe(0)
  })

  it('is no brighter on a full packet than at rest, and dimmer as the music fills', () => {
    const rest = settled(silent()).intensity ?? 0
    const loud = settled(FULL()).intensity ?? 0
    expect(loud).toBeLessThan(rest)
    expect(loud).toBeGreaterThan(rest * 0.5)
    // The light never climbs with the level: the punch is birds and stroke.
    let last = Number.POSITIVE_INFINITY
    for (const energy of [0, 0.25, 0.5, 0.75, 1]) {
      const now = settled(with_({ ...GROOVE, [F.energy]: energy })).intensity ?? 0
      expect(now).toBeLessThanOrEqual(last + 1e-12)
      last = now
    }
  })

  it('keeps every knob inside what the field allows at a full packet', () => {
    for (const tension of [0, 1]) {
      const knobs = settled(FULL(), tension)
      for (const knob of MURMURATION_KNOBS) {
        const [low, high] = MURMURATION_RANGES[knob]
        expect(knobs[knob] ?? 0, `${knob} at tension ${tension}`).toBeGreaterThanOrEqual(low)
        expect(knobs[knob] ?? 0, `${knob} at tension ${tension}`).toBeLessThanOrEqual(high)
      }
    }
  })
})

describe('what tension does to the murmuration', () => {
  it('balls the flock up: it draws in harder, holds tighter and pushes less', () => {
    const groove = with_(GROOVE)
    const calm = paramsOf(groove, 0)
    const wound = paramsOf(groove, 1)
    expect(wound.cohesion).toBeCloseTo(calm.cohesion + 2, 6)
    expect(wound.gather).toBeCloseTo(calm.gather + 0.6, 6)
    expect(wound.separation).toBeCloseTo(calm.separation - 0.15, 6)
  })

  it('leaves the light, the count and the stroke alone', () => {
    const groove = with_(GROOVE)
    const calm = paramsOf(groove, 0)
    const wound = paramsOf(groove, 1)
    for (const knob of ['intensity', 'count', 'rate', 'size', 'streak'] as const)
      expect(wound[knob], knob).toBe(calm[knob])
  })

  it('bursts open again when the drop lands on a wound flock', () => {
    const wound = paramsOf(with_(GROOVE), 1)
    const burst = paramsOf(with_({ ...GROOVE, [F.impact]: 1 }), 0)
    expect(burst.separation).toBeGreaterThan(wound.separation + 0.5)
  })
})

describe('silence through the whole path', () => {
  it('resolves a silent packet to a flock of nothing and a light of nothing', () => {
    const params = paramsOf(silent())
    expect(params.count).toBe(0)
    expect(params.rate).toBe(0)
    expect(params.size).toBe(0)
    expect(fieldRuns(params, 1)).toBe(false)
  })

  it('plans no birth for a silent packet, however long it runs', () => {
    const params = paramsOf(silent())
    const groups: SpawnGroup[] = []
    const state = spawnState()
    for (let step = 0; step < 60 * 30; step += 1)
      expect(planSpawns(params, MURMURATION_PROFILE, silent(), 1 / 60, state, groups)).toBe(0)
  })

  it('draws nothing at presence 0', () => {
    expect(fieldRuns(paramsOf(with_(GROOVE)), 0)).toBe(false)
  })
})

describe('how the flock is born', () => {
  it('is born on the birds already in the air, at a rate that is the same at any frame rate', () => {
    const params = paramsOf(with_(GROOVE))
    const born = (fps: number) => {
      const groups: SpawnGroup[] = []
      const state = spawnState()
      let total = 0
      for (let step = 0; step < fps * 10; step += 1) {
        const live = planSpawns(params, MURMURATION_PROFILE, with_(GROOVE), 1 / fps, state, groups)
        for (let group = 0; group < live; group += 1) {
          expect(groups[group]?.shape).toBe('flock')
          total += groups[group]?.count ?? 0
        }
      }

      return total
    }

    for (const fps of [30, 60, 144])
      expect(Math.abs(born(fps) - params.rate * 10), `${fps} fps`).toBeLessThanOrEqual(1)
  })

  it('throws no burst for a hit: the hits move the body and do not make birds', () => {
    const params = paramsOf(with_({ ...GROOVE, [F.bassHit]: 1 }))
    expect(params.burst).toBe(0)
    const groups: SpawnGroup[] = []
    const live = planSpawns(
      params,
      MURMURATION_PROFILE,
      with_({ ...GROOVE, [F.bassHit]: 1 }),
      1 / 60,
      spawnState(),
      groups,
    )
    for (let group = 0; group < live; group += 1) expect(groups[group]?.shape).toBe('flock')
  })

  it('overwrites a slot only after every bird in it is old enough to have been replaced', () => {
    // The ring comes round every count / rate seconds. A bird lives at least
    // 0.6 of `life`, so if the ring is quicker than that a slot is always
    // overwritten while its bird is at full light, and the fade never has to
    // dim a bird out and thin the body from inside.
    for (const energy of [0.05, 0.3, 0.6, 1]) {
      const params = paramsOf(with_({ ...GROOVE, [F.energy]: energy }))
      expect(params.count / params.rate).toBeLessThan(0.6 * params.life)
    }
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

  it('is under a twentieth of the frame at the most the study’s own mapping reaches, on every shape', () => {
    for (const tension of [0, 1])
      for (const [width, height] of SHAPES)
        expect(
          particleCoverage(paramsOf(FULL(), tension), width, height),
          `${width} by ${height} at tension ${tension}`,
        ).toBeLessThan(1 / 20)
  })

  it('is under two percent of a 16:9 frame and about three of a square one', () => {
    const params = paramsOf(FULL())
    expect(particleCoverage(params, 1920, 1080)).toBeGreaterThan(0.012)
    expect(particleCoverage(params, 1920, 1080)).toBeLessThan(0.022)
    expect(particleCoverage(params, 1080, 1080)).toBeGreaterThan(0.025)
    expect(particleCoverage(params, 1080, 1080)).toBeLessThan(0.04)
  })

  it('holds the pool to a size the ring can serve', () => {
    for (const energy of [0.2, 0.6, 1]) {
      const params = paramsOf(with_({ ...GROOVE, [F.energy]: energy }))
      expect(params.count).toBeLessThanOrEqual(MURMURATION_PROFILE.capacity)
    }
  })
})
