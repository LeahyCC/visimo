/**
 * The dust as a study: where it lives in the character space, that a silent
 * packet through its whole path draws nothing while a quiet passage does, what
 * tension does to it, that it stays sparse at the most its own mapping
 * reaches, and that the same song draws the same dust at any frame rate. The
 * field's own numbers have their tests in `impls/particles.params.test.ts` and
 * its GPU side in `impls/ParticleField.test.ts`; the generic bar every study
 * meets is `registry.test.ts`.
 *
 * It used to run on a CPU pool of at most 160 specks placed in closed form.
 * The pool is gone and the specks live in a storage buffer now, so the tests
 * that read a filled buffer read the field's plan and its CPU mirror instead:
 * what the study resolves to, how many particles that puts in the air, and
 * where one of them is after the same seconds at four frame rates.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness } from '../director/score'
import { HARDSTYLE, HOUSE, LOFI } from '../director/song.fixture'
import {
  DUST_PROFILE,
  DUST_RANGES,
  fieldRuns,
  particleCoverage,
  particleParams,
  particlesAlive,
  planSpawns,
  spawnState,
  stepParticle,
} from '../impls/particles.params'
import type { ParticleState, SpawnGroup } from '../impls/particles.params'
import { DUST_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { resolveStudy } from './resolve'

const study = findStudy('dust')
if (!study) throw new Error('Expected the dust study')

/** A packet with the fields the dust reads set and everything else at nothing. */
const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

const paramsAt = (packet: Float32Array, tension = 0) =>
  particleParams(at(packet, tension), DUST_PROFILE)

const SIZES = [
  [1920, 1080],
  [1080, 1920],
  [2560, 1440],
  [3840, 2160],
  [3840, 1080],
  [1080, 1080],
  [640, 360],
  [320, 320],
] as const

describe('the dust study', () => {
  it('is the ink for the quiet end and for nothing else', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('dust')
    expect(study.moments).toEqual({ intro: 1, groove: 0, build: 0, drop: 0, rest: 1, outro: 1 })
    expect(study.cost).toBe('cheap')
  })

  it('offers exactly the implementation’s knobs and rests at nothing to draw', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...DUST_KNOBS].sort())
    expect(study.knobs.count).toBe(0)
    expect(study.knobs.gather).toBe(0)
  })

  it('reads as the dust when it is the only ink, on the canvas’s own line', () => {
    expect(sceneOf(['dust'])).toBe('dust')
  })

  // The handoff says the dust is for soft, slow tracks and hardstyle never
  // gets it. The three tracks are the ones the director's own tests play.
  it('is in the soft, slow corner: a lo-fi track is at home, a house one is a stretch and a hardstyle one is out of reach', () => {
    const lofi = closeness(study, LOFI)
    const house = closeness(study, HOUSE)
    const hardstyle = closeness(study, HARDSTYLE)
    expect(lofi).toBeGreaterThan(0.6)
    expect(house).toBeLessThan(lofi * 0.6)
    expect(hardstyle).toBeLessThan(0.2)
    expect(hardstyle).toBeLessThan(house)
  })
})

describe('silence and quiet', () => {
  const silent = packetOf()

  // A silent packet has to draw nothing, and the count is what says so: it is
  // the level that brings the specks in, and at nothing there is no pass and
  // no dispatch.
  it('resolves a silent packet to a count of nothing, and neither spawns nor draws, at any tension', () => {
    for (const tension of [0, 0.5, 1]) {
      const knobs = at(silent, tension)
      expect(knobs.count).toBe(0)
      const params = particleParams(knobs, DUST_PROFILE)
      expect(fieldRuns(params, 1)).toBe(false)
      const groups: SpawnGroup[] = []
      expect(planSpawns(params, DUST_PROFILE, silent, 1 / 60, spawnState(), groups)).toBe(0)
    }
  })

  // A quiet passage is not silence, and it is where the dust is meant to show.
  // The energy is scaled by the track's own recent peak, so the quietest a
  // passage gets is a few hundredths and it is well up from that most of the
  // time; the first sound at all already brings a good part of the dust in.
  it('draws in a quiet passage, and starts with the first sound at all', () => {
    for (const energy of [0.01, 0.05, 0.1, 0.3]) {
      const params = paramsAt(packetOf({ energy }))
      expect(fieldRuns(params, 1), `energy ${energy}`).toBe(true)
      expect(params.count, `energy ${energy}`).toBeGreaterThan(2000)
    }
  })

  it('has more dust in the quiet than under a full packet', () => {
    const loud = at(packetOf({ energy: 1 })).count ?? 0
    for (const energy of [0.1, 0.2, 0.3, 0.5]) {
      const quiet = at(packetOf({ energy })).count ?? 0
      expect(quiet, `energy ${energy}`).toBeGreaterThan(loud * 1.5)
    }

    // It does not fall to nothing under a full packet either: a soft track
    // spends its loudest moments at the top of the scale.
    expect(loud).toBeGreaterThan(1000)
  })

  it('rises from silence to a peak in the quiet and falls from there, never past its range', () => {
    const counts = Array.from(
      { length: 101 },
      (_, step) => at(packetOf({ energy: step / 100 })).count ?? 0,
    )
    const peak = Math.max(...counts)
    const peakAt = counts.indexOf(peak)
    expect(counts[0]).toBe(0)
    // The top of the hump is in the middle of the scale and not at its ends.
    expect(peakAt).toBeGreaterThan(20)
    expect(peakAt).toBeLessThan(70)
    for (let step = 1; step <= peakAt; step += 1)
      expect(counts[step]).toBeGreaterThanOrEqual(counts[step - 1] ?? 0)
    for (let step = peakAt + 1; step < counts.length; step += 1)
      expect(counts[step]).toBeLessThanOrEqual(counts[step - 1] ?? 0)
    expect(peak).toBeLessThanOrEqual(DUST_RANGES.count[1])
    // Tens of thousands, which is what the field bought over the pool of 160.
    expect(peak).toBeGreaterThan(20000)
    for (const count of counts) expect(count).toBeGreaterThanOrEqual(0)
  })
})

describe('what the music does to the dust', () => {
  it('lifts the drift with the swell, so a lifting passage drifts faster than a falling one', () => {
    const falling = at(packetOf({ swell: 0 })).curl ?? 0
    const steady = at(packetOf({ swell: 0.5 })).curl ?? 0
    const lifting = at(packetOf({ swell: 1 })).curl ?? 0
    expect(steady).toBeGreaterThan(falling)
    expect(lifting).toBeGreaterThan(steady)
    // Slow all the way: at the top the curl carries a speck a fifteenth of a
    // short side a second, which is most of a minute to cross the frame.
    expect(lifting).toBeLessThanOrEqual(0.07)
  })

  it('deepens the twinkle with the treble', () => {
    const dull = at(packetOf({ treble: 0 })).twinkle ?? 0
    const bright = at(packetOf({ treble: 1 })).twinkle ?? 0
    expect(bright).toBeGreaterThan(dull + 0.3)
    expect(bright).toBeLessThanOrEqual(DUST_RANGES.twinkle[1])
  })

  it('never gets brighter than at rest as the music gets louder or harder', () => {
    const rest = study.knobs.intensity ?? 0
    for (const packet of [
      packetOf({ energy: 1 }),
      packetOf({ swell: 1 }),
      packetOf({ hardness: 1 }),
    ])
      expect(at(packet).intensity).toBeLessThanOrEqual(rest)
    expect(at(packetOf({ energy: 1, swell: 1, hardness: 1 })).intensity).toBeLessThan(rest * 0.7)
  })
})

describe('what tension does to the dust', () => {
  const packet = packetOf({ energy: 0.3 })

  it('gathers it: the pull toward the centre climbs with tension, to half a short side a second at a full build', () => {
    const levels = [0, 0.25, 0.5, 0.75, 1].map((tension) => at(packet, tension).gather ?? -1)
    expect(levels[0]).toBe(0)
    for (let step = 1; step < levels.length; step += 1)
      expect(levels[step]).toBeGreaterThan(levels[step - 1] ?? 0)
    expect(levels[4]).toBeCloseTo(0.5, 9)
  })

  // The gather is a rate on the distance to the middle, so it draws a speck in
  // over a second or two rather than jumping it, and the drag keeps it off the
  // one point it would otherwise pile onto.
  it('moves a speck in toward the middle of the frame over seconds, and never past it', () => {
    const params = paramsAt(packet, 1)
    const speck: ParticleState = {
      x: 0.4,
      y: 0.3,
      vx: 0,
      vy: 0,
      age: 0,
      life: 20,
      seed: 0.5,
      hue: 0,
    }
    const reach: number[] = []
    for (let frame = 0; frame < 60 * 4; frame += 1) {
      stepParticle(speck, { ...params, curl: 0, flow: 0 }, 1 / 60, frame / 60)
      if (frame % 60 === 59) reach.push(Math.hypot(speck.x, speck.y))
    }

    const start = Math.hypot(0.4, 0.3)
    expect(reach[0]).toBeLessThan(start)
    for (let step = 1; step < reach.length; step += 1)
      expect(reach[step]).toBeLessThan(reach[step - 1] ?? 0)
    // In, not through: nothing overshoots the middle and comes out the far side.
    expect(Math.min(...reach)).toBeGreaterThan(0)
  })

  it('does not change the count, the size or the light', () => {
    const calm = at(packet, 0)
    const wound = at(packet, 1)
    for (const knob of DUST_KNOBS) {
      if (knob === 'gather') continue
      expect(wound[knob], knob).toBe(calm[knob])
    }
  })
})

describe('how much of the frame it covers', () => {
  // The most the study's own mapping can reach: the top of the count's hump,
  // at the study's size, whatever the packet does.
  const worst = () => {
    let count = 0
    for (let step = 0; step <= 200; step += 1)
      for (const swell of [0, 0.5, 1])
        count = Math.max(count, at(packetOf({ energy: step / 200, swell })).count ?? 0)
    return particleParams({ size: study.knobs.size ?? 0, count }, DUST_PROFILE)
  }

  it('is a few percent at the most its own mapping reaches, on every canvas shape', () => {
    const reach = worst()
    expect(reach.count).toBeGreaterThan(21000)
    expect(reach.count).toBeLessThan(24000)
    // The dust spawns at a rate and never in a burst, so everything in the
    // pool is in the air: the count is the number alive.
    expect(particlesAlive(reach)).toBe(reach.count)
    // 22,374 specks 1.5 pixels across on a canvas 1080 high.
    expect(particleCoverage(reach, 1080, 1080)).toBeCloseTo(0.043, 3)
    expect(particleCoverage(reach, 1920, 1080)).toBeCloseTo(0.024, 3)
    for (const [width, height] of SIZES)
      expect(particleCoverage(reach, width, height), `${width} by ${height}`).toBeLessThan(1 / 20)
  })

  // The pool is a budget and the ranges are what keep the study inside it,
  // which is the one claim a field cannot make the way a pool of 160 could: at
  // the top of every range it would cover most of a small frame, and nothing
  // in the study's own mapping goes there.
  it('states what every knob at the top of its range would cover, which the mapping never reaches', () => {
    const top = particleParams(
      { count: DUST_RANGES.count[1], size: DUST_RANGES.size[1] },
      DUST_PROFILE,
    )
    expect(particleCoverage(top, 1080, 1080)).toBeCloseTo(0.548, 2)
    expect(particleCoverage(top, 1920, 1080)).toBeCloseTo(0.308, 2)
    expect(top.count).toBeGreaterThan((worst().count ?? 0) * 1.5)
  })
})

describe('the same at any frame rate', () => {
  // A frame rate is only a number of steps, so after the same seconds a speck
  // is in the same place. The drag is closed form and exact; everything else
  // is symplectic Euler, so the two rates agree closely rather than exactly.
  it('carries a speck to the same place after four seconds at 30, 60, 144 and 240 steps a second', () => {
    const packet = packetOf({ energy: 0.3, swell: 0.7, treble: 0.4, keyHue: 0.2 })
    const params = paramsAt(packet, 0.4)
    const drifted = (fps: number) => {
      const speck: ParticleState = {
        x: 0.21,
        y: -0.17,
        vx: 0.05,
        vy: 0.02,
        age: 0,
        life: 30,
        seed: 0.25,
        hue: 0.1,
      }
      for (let frame = 0; frame < fps * 4; frame += 1)
        stepParticle(speck, params, 1 / fps, frame / fps)
      return speck
    }

    const reference = drifted(60)
    // It actually moved, so the comparison is worth making.
    expect(Math.hypot(reference.x - 0.21, reference.y + 0.17)).toBeGreaterThan(0.01)
    for (const fps of [30, 144, 240]) {
      const other = drifted(fps)
      expect(other.x, `${fps} fps`).toBeCloseTo(reference.x, 2)
      expect(other.y, `${fps} fps`).toBeCloseTo(reference.y, 2)
      expect(other.age, `${fps} fps`).toBeCloseTo(reference.age, 6)
    }
  })

  it('spawns the same number of specks a second at 30, 60, 144 and 240 steps a second', () => {
    const packet = packetOf({ energy: 0.3 })
    const params = paramsAt(packet)
    const born = (fps: number) => {
      const state = spawnState()
      const groups: SpawnGroup[] = []
      let total = 0
      for (let frame = 0; frame < fps * 3; frame += 1) {
        const live = planSpawns(params, DUST_PROFILE, packet, 1 / fps, state, groups)
        for (let group = 0; group < live; group += 1) total += groups[group]?.count ?? 0
      }

      return total
    }

    const reference = born(60)
    expect(reference).toBeGreaterThan(0)
    for (const fps of [30, 144, 240]) expect(born(fps) / reference, `${fps} fps`).toBeCloseTo(1, 3)
  })
})
