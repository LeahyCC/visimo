/**
 * The chord petals as a study: where it lives in the character space, that a
 * silent packet through its whole path draws nothing while a chord lights
 * exactly the petals of its notes, what release, impact and tension do to the
 * flower, that the light never rises with the level, and that the same song
 * draws the same flower at any frame rate. The geometry and the ink have their
 * own tests beside them; the generic bar every study meets is
 * `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness } from '../director/score'
import { TRACKS } from '../director/tracks.fixture'
import { petalLength, petalParams, petalsCoverage, petalsLit } from '../impls/petals.params'
import { PETAL_KNOBS } from './impls'
import { findStudy } from './registry'
import { resolveStudy } from './resolve'
import type { RowState } from './resolve'

const study = findStudy('chord-petals')
if (!study) throw new Error('Expected the chord petals study')

/** A packet with the fields named set and everything else at nothing. */
const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

/** A triad's rows: C major, at the strength a clear chord reads. */
const C_MAJOR = { chroma0: 0.95, chroma4: 1, chroma7: 0.98 } as const
const LIT = [0, 4, 7]

/**
 * The knobs a packet held for `seconds` settles on. The rows carry envelopes,
 * so one call at a step of 0 would read a flower that has not had time to
 * bloom, and a real one is read after it has.
 */
const settled = (packet: Float32Array, tension = 0, seconds = 6, dt = 1 / 60) => {
  const out: Record<string, number> = {}
  const states: RowState[] = []
  for (let time = 0; time < seconds; time += dt)
    resolveStudy(study, undefined, packet, tension, 1, out, dt, states)
  return { ...out }
}

describe('the chord petals study', () => {
  it('is the ink for tonal music that is soft to mid, and for the intro, groove and rest', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('petals')
    expect(study.cost).toBe('cheap')
    expect(study.moments).toEqual({
      intro: 0.8,
      groove: 1,
      build: 0.4,
      drop: 0,
      rest: 0.8,
      outro: 0,
    })
    expect(study.home.tonality).toBeGreaterThan(0.75)
    expect(study.home.hardness).toBeLessThan(0.2)
    expect(study.reach).toBeCloseTo(0.4)
  })

  it('offers exactly the implementation’s knobs', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...PETAL_KNOBS].sort())
  })

  it('is at home with the tonal, soft tracks and not with the hard, atonal ones', () => {
    const score = (kind: string) => {
      const track = TRACKS.find((each) => each.kind === kind)
      if (!track) throw new Error(`Expected a ${kind} track`)
      return closeness(study, track.character)
    }

    for (const kind of ['ambient', 'downtempo', 'acoustic', 'pop', 'folk rock', 'jam and funk'])
      expect(score(kind), kind).toBeGreaterThan(0.65)
    for (const kind of ['metal', 'metalcore', 'drum and bass'])
      expect(score(kind), kind).toBeLessThan(0.35)
  })

  it('draws nothing from a silent packet, through the whole path', () => {
    for (const tension of [0, 1]) {
      const knobs = settled(packetOf(), tension)
      expect(petalsLit(petalParams(knobs)), `tension ${tension}`).toBe(false)
      for (let note = 0; note < 12; note += 1) expect(knobs[`note${note}`]).toBe(0)
    }
  })

  it('does not draw drums alone: the notes are what it is about', () => {
    const drums = packetOf({ energy: 0.9, bass: 0.9, subPulse: 1, bassPulse: 1, beatPulse: 1 })
    expect(petalsLit(petalParams(settled(drums)))).toBe(false)
  })

  it('lights exactly the petals of the notes sounding', () => {
    const knobs = settled(packetOf(C_MAJOR))
    for (let note = 0; note < 12; note += 1) {
      if (LIT.includes(note)) expect(knobs[`note${note}`], `note ${note}`).toBeGreaterThan(0.9)
      else expect(knobs[`note${note}`], `note ${note}`).toBe(0)
    }

    expect(petalsLit(petalParams(knobs))).toBe(true)
  })

  it('blooms in a blink and eases back over a second or two', () => {
    const out: Record<string, number> = {}
    const states: RowState[] = []
    const step = (packet: Float32Array, seconds: number) => {
      for (let time = 0; time < seconds - 1e-9; time += 1 / 240)
        resolveStudy(study, undefined, packet, 0, 1, out, 1 / 240, states)
      return out['note4'] ?? 0
    }

    // A tenth of a second in, it is all but up: a 40 ms attack.
    expect(step(packetOf(C_MAJOR), 0.1)).toBeGreaterThan(0.85)
    // A second after the chord stops it is a third of what it was, and three
    // seconds on it has all but gone: a 900 ms release.
    const later = step(packetOf(), 1)
    expect(later).toBeGreaterThan(0.2)
    expect(later).toBeLessThan(0.4)
    expect(step(packetOf(), 2)).toBeLessThan(0.05)
  })

  it('is the same flower at 30, 60 and 144 frames a second', () => {
    const at = (rate: number) => {
      const out: Record<string, number> = {}
      const states: RowState[] = []
      const chord = packetOf({ ...C_MAJOR, energy: 0.6, bassPulse: 0.5, beatPulse: 0.5 })
      for (let time = 0; time < 2.5 - 1e-9; time += 1 / rate)
        resolveStudy(study, undefined, chord, 0, 1, out, 1 / rate, states)
      for (let time = 0; time < 0.5 - 1e-9; time += 1 / rate)
        resolveStudy(study, undefined, packetOf(), 0, 1, out, 1 / rate, states)
      return { ...out }
    }

    const slow = at(30)
    for (const rate of [60, 144]) {
      const fast = at(rate)
      for (const [knob, value] of Object.entries(slow))
        expect(fast[knob] ?? 0, `${knob} at ${rate}`).toBeCloseTo(value, 1)
    }
  })

  describe('what the moments do to the flower', () => {
    const chord = { ...C_MAJOR, energy: 0.5 } as const
    const flower = (fields: Partial<Record<keyof typeof F, number>>, tension = 0) =>
      petalParams(settled(packetOf({ ...chord, ...fields }), tension))

    it('opens on the release', () => {
      expect(flower({ release: 1 }).open).toBeGreaterThan(flower({ release: 0 }).open + 0.25)
    })

    it('throws the flower open on the drop and lets it settle', () => {
      const impact = packetOf({ ...chord, impact: 1 })
      const out: Record<string, number> = {}
      const states: RowState[] = []
      for (let time = 0; time < 0.3; time += 1 / 60)
        resolveStudy(study, undefined, impact, 0, 1, out, 1 / 60, states)
      const thrown = out['open'] ?? 0
      expect(thrown).toBeGreaterThan(0.5 + 0.15)
      const quiet = packetOf(chord)
      for (let time = 0; time < 4; time += 1 / 60)
        resolveStudy(study, undefined, quiet, 0, 1, out, 1 / 60, states)
      expect(out['open']).toBeCloseTo(0.5, 1)
    })

    it('closes to a bud at full tension: shorter petals, no second whorl, less light', () => {
      const rest = flower({})
      const bud = flower({ tension: 1 }, 1)
      expect(bud.open).toBe(0)
      expect(bud.layer).toBeLessThan(rest.layer + 1e-9)
      expect(bud.intensity).toBeLessThan(rest.intensity)
      const radius = 400
      const reach = (params: typeof rest) => petalLength(params, 1, radius, 0.14 * radius)
      expect(reach(bud)).toBeLessThan(reach(rest) * 0.75)
      expect(petalsCoverage(bud, 1920, 1080)).toBeLessThan(petalsCoverage(rest, 1920, 1080))
    })

    it('turns the flower with the music and holds still in silence', () => {
      const loud = settled(packetOf({ ...chord, energy: 0.9, bassPulse: 0.6 }), 0, 6)
      const quiet = settled(packetOf({ ...chord, energy: 0.2 }), 0, 6)
      expect(loud['turn'] ?? 0).toBeGreaterThan(quiet['turn'] ?? 0)
      expect(settled(packetOf(), 0, 6)['turn']).toBe(0)
    })

    it('puts the loud into size, glow and the second whorl, and never into the light', () => {
      const soft = flower({ energy: 0.2 })
      const loud = flower({ energy: 1, beatPulse: 1, bassPulse: 1, sub: 1, bass: 1 })
      expect(loud.size).toBeGreaterThan(soft.size)
      expect(loud.glow).toBeGreaterThan(soft.glow)
      expect(loud.layer).toBeGreaterThan(soft.layer)
      expect(loud.width).toBeGreaterThan(soft.width)
      expect(loud.intensity).toBeLessThanOrEqual(soft.intensity)
      // Above 1, so the rim blooms, and not more so for being loud.
      expect(soft.intensity).toBeGreaterThan(1)
    })
  })
})
