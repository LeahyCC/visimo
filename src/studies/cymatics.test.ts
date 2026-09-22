/**
 * The cymatics study as a study: where it lives in the character space, that a
 * silent packet through its whole path draws nothing and so does a passage with
 * no note in it, that a chord rings exactly the modes of its notes and moves to
 * the next as a morph and not a cut, that a hit strikes the plate and rings,
 * what tension does to the line, that the loud goes into width, glow and how
 * many modes ring and never into the light, and that it draws on the notes and
 * the level and not on `tension`, `release` or `impact` alone. The maths and the
 * ink have their own tests beside them; the generic bar every study meets is
 * `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { CHROMA_ROW, F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness } from '../director/score'
import { TRACKS } from '../director/tracks.fixture'
import {
  CYMATICS_RANGES,
  cymaticsCoverage,
  cymaticsLit,
  cymaticsParams,
  glowWidth,
  lineWidth,
} from '../impls/cymatics.params'
import { CYMATICS_KNOBS } from './impls'
import { findStudy } from './registry'
import { resolveStudy } from './resolve'
import type { RowState } from './resolve'

const study = findStudy('cymatics')
if (!study) throw new Error('Expected the cymatics study')

/** A packet with the fields named set and everything else at nothing. */
const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

/** Notes sounding, as the extractor reads a clear chord: the strongest near 1. */
const chord = (notes: readonly number[], fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = packetOf(fields)
  for (const note of notes) out[CHROMA_ROW + note] = 1
  return out
}

const C_MAJOR = [0, 4, 7]
const A_MINOR = [9, 0, 4]

/**
 * The knobs a packet held for `seconds` settles on. The rows carry envelopes
 * and springs, so one call at a step of 0 would read a plate that has not had
 * time to ring, and a real one is read after it has.
 */
const settled = (packet: Float32Array, tension = 0, seconds = 6, dt = 1 / 60) => {
  const out: Record<string, number> = {}
  const states: RowState[] = []
  for (let time = 0; time < seconds; time += dt)
    resolveStudy(study, undefined, packet, tension, 1, out, dt, states)
  return { ...out }
}

describe('the cymatics study', () => {
  it('is the ink for tonal music that is soft to mid, and for the intro, the groove and the rest', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('cymatics')
    expect(study.cost).toBe('cheap')
    expect(study.moments).toEqual({
      intro: 0.8,
      groove: 1,
      build: 0,
      drop: 0,
      rest: 0.8,
      outro: 0,
    })
    expect(study.home.tonality).toBeGreaterThanOrEqual(0.7)
    expect(study.home.hardness).toBeLessThan(0.3)
    expect(study.reach).toBeCloseTo(0.4)
  })

  it('offers exactly the implementation’s knobs', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...CYMATICS_KNOBS].sort())
  })

  it('shares no cast with the chord petals, which draw the same twelve rows in the same place', () => {
    expect(study.excludes).toContain('chord-petals')
  })

  it('is at home with acoustic and organic music as much as electronic, and not with the hard, atonal kind', () => {
    const score = (kind: string) => {
      const track = TRACKS.find((each) => each.kind === kind)
      if (!track) throw new Error(`Expected a ${kind} track`)
      return closeness(study, track.character)
    }

    // The gap it fills: acoustic, folk, pop and jam at the front, with the
    // ambient and downtempo end and the tonal electronic tracks beside them.
    for (const kind of [
      'acoustic',
      'folk rock',
      'pop',
      'jam and funk',
      'ambient',
      'downtempo',
      'idm remix',
      'tech house',
    ])
      expect(score(kind), kind).toBeGreaterThan(0.6)
    for (const kind of ['metal', 'metalcore', 'drum and bass', 'dubstep'])
      expect(score(kind), kind).toBeLessThan(0.5)
  })

  it('draws nothing from a silent packet, through the whole path', () => {
    for (const tension of [0, 1]) {
      const knobs = settled(packetOf(), tension)
      expect(cymaticsLit(cymaticsParams(knobs)), `tension ${tension}`).toBe(false)
      for (let note = 0; note < 12; note += 1) expect(knobs[`mode${note}`]).toBe(0)
    }
  })

  it('draws nothing when no key is heard, however loud the drums', () => {
    const drums = packetOf({
      energy: 0.95,
      bass: 0.9,
      subPulse: 1,
      bassPulse: 1,
      beatPulse: 1,
      lowMidPulse: 1,
      keyClarity: 0,
    })
    expect(cymaticsLit(cymaticsParams(settled(drums)))).toBe(false)
  })

  it('does not draw on tension, release or impact alone: it is the notes and the level', () => {
    const moments = packetOf({ tension: 1, release: 1, impact: 1, rest: 0 })
    expect(cymaticsLit(cymaticsParams(settled(moments, 1)))).toBe(false)
    expect(cymaticsLit(cymaticsParams(settled(moments, 0)))).toBe(false)
    // The same packet with a chord in it draws, and the level shows in the line.
    const notes = chord(C_MAJOR, { tension: 1, release: 1, impact: 1 })
    expect(cymaticsLit(cymaticsParams(settled(notes, 1)))).toBe(true)
  })

  it('rings exactly the modes of the notes sounding', () => {
    const knobs = settled(chord(C_MAJOR))
    for (let note = 0; note < 12; note += 1) {
      if (C_MAJOR.includes(note)) expect(knobs[`mode${note}`], `note ${note}`).toBeGreaterThan(0.95)
      else expect(knobs[`mode${note}`], `note ${note}`).toBe(0)
    }

    expect(cymaticsLit(cymaticsParams(knobs))).toBe(true)
  })

  describe('a chord change', () => {
    /** The mode knobs a second, then a few hundred milliseconds, then some seconds after the change. */
    const after = (seconds: number) => {
      const out: Record<string, number> = {}
      const states: RowState[] = []
      const dt = 1 / 240
      const first = chord(C_MAJOR)
      const second = chord(A_MINOR)
      for (let time = 0; time < 5; time += dt)
        resolveStudy(study, undefined, first, 0, 1, out, dt, states)
      for (let time = 0; time < seconds - 1e-9; time += dt)
        resolveStudy(study, undefined, second, 0, 1, out, dt, states)
      return { ...out }
    }

    it('brings the new modes up in a moment, and lets the old ones go over a second and more', () => {
      // A tenth of a second in, a mode of the new chord (A) is most of the way
      // up, and one of the old chord that is not in the new (G) has hardly moved.
      const early = after(0.1)
      expect(early['mode9']).toBeGreaterThan(0.5)
      expect(early['mode7']).toBeGreaterThan(0.9)
      // A second in, the old one is well on its way, and not yet gone: the plate
      // is between two figures, which is the morph.
      const middle = after(1)
      expect(middle['mode7']).toBeGreaterThan(0.3)
      expect(middle['mode7']).toBeLessThan(0.7)
      // And it has gone a few seconds on.
      expect(after(5)['mode7']).toBeLessThan(0.05)
      // A note in both chords is never let go at all.
      expect(after(0.4)['mode0']).toBeGreaterThan(0.95)
    })

    it('never cuts: no mode moves faster than its envelope allows', () => {
      const out: Record<string, number> = {}
      const states: RowState[] = []
      const dt = 1 / 60
      const first = chord(C_MAJOR)
      const second = chord(A_MINOR)
      for (let time = 0; time < 5; time += dt)
        resolveStudy(study, undefined, first, 0, 1, out, dt, states)
      let previous = { ...out }
      let biggest = 0
      for (let time = 0; time < 3; time += dt) {
        resolveStudy(study, undefined, second, 0, 1, out, dt, states)
        for (let note = 0; note < 12; note += 1)
          biggest = Math.max(
            biggest,
            Math.abs((out[`mode${note}`] ?? 0) - (previous[`mode${note}`] ?? 0)),
          )
        previous = { ...out }
      }

      // The fastest a mode may move in one frame is a share of the whole way,
      // which is what a step would take all at once.
      expect(biggest).toBeLessThan(0.2)
    })
  })

  it('is the same plate at 30, 60, 144 and 240 steps a second', () => {
    const at = (rate: number) => {
      const out: Record<string, number> = {}
      const states: RowState[] = []
      const packet = chord(C_MAJOR, {
        energy: 0.6,
        beatPulse: 0.5,
        bassPulse: 0.5,
        lowMidPulse: 0.3,
      })
      const after = chord(A_MINOR, { energy: 0.6, harmonicChange: 0.4 })
      for (let time = 0; time < 2.5 - 1e-9; time += 1 / rate)
        resolveStudy(study, undefined, packet, 0, 1, out, 1 / rate, states)
      for (let time = 0; time < 1 - 1e-9; time += 1 / rate)
        resolveStudy(study, undefined, after, 0, 1, out, 1 / rate, states)
      return { ...out }
    }

    const slow = at(30)
    for (const rate of [60, 144, 240]) {
      const fast = at(rate)
      for (const [knob, value] of Object.entries(slow))
        expect(fast[knob] ?? 0, `${knob} at ${rate}`).toBeCloseTo(value, 1)
    }
  })

  describe('a hit', () => {
    /**
     * `strike` over a second and a half from a hit, at a step of a two hundred
     * and fortieth of a second. The hit is a pulse that falls away the way the
     * extractor's pulses do, in about a fifth of a second, and not one frame of
     * it: a spring is stepped by what the row is, and a row is not a single frame.
     */
    const PULSE_SECONDS = 0.18
    const ring = (fields: Partial<Record<keyof typeof F, number>>) => {
      const out: Record<string, number> = {}
      const states: RowState[] = []
      const dt = 1 / 240
      const quiet = chord(C_MAJOR, { energy: 0.4 })
      for (let time = 0; time < 3; time += dt)
        resolveStudy(study, undefined, quiet, 0, 1, out, dt, states)
      const rest = out['strike'] ?? 0
      const trace: number[] = []
      for (let time = 0; time < 1.5; time += dt) {
        const fall = Math.exp(-time / PULSE_SECONDS)
        const scaled = Object.fromEntries(
          Object.entries(fields).map(([name, value]) => [name, value * fall]),
        )
        resolveStudy(
          study,
          undefined,
          chord(C_MAJOR, { energy: 0.4, ...scaled }),
          0,
          1,
          out,
          dt,
          states,
        )
        trace.push(out['strike'] ?? 0)
      }

      return { rest, trace }
    }

    it('strikes the plate, which rings and settles back to where it rests', () => {
      const { rest, trace } = ring({ beatPulse: 1, lowMidPulse: 1 })
      const top = Math.max(...trace)
      expect(top).toBeGreaterThan(rest + 0.1)
      // It is a spring, so it does not only fall. After the peak it comes back
      // down to about where it rests and then swings up again before it settles,
      // which is the ring, where a follower would go down once and stay.
      const after = trace.slice(trace.indexOf(top))
      let trough = 1
      while (trough < after.length && (after[trough] ?? 0) <= (after[trough - 1] ?? 0)) trough += 1
      expect(trough).toBeLessThan(after.length)
      expect(after[trough - 1] ?? 0).toBeLessThan(rest + 0.1)
      expect(Math.max(...after.slice(trough))).toBeGreaterThan((after[trough - 1] ?? 0) + 0.01)
      // And it has settled to where it began.
      expect(trace.at(-1) ?? 0).toBeCloseTo(rest, 1)
    })

    it('never leaves the range the ink reads, however hard and however often', () => {
      for (const fields of [
        { beatPulse: 1, lowMidPulse: 1, harmonicChange: 1, impact: 1 },
        { beatPulse: 1 },
      ]) {
        const { trace } = ring(fields)
        for (const value of trace) expect(value).toBeGreaterThanOrEqual(0)
      }
    })

    it('makes the line fatter and its glow wider for the moment it rings', () => {
      const rest = cymaticsParams({ ...settled(chord(C_MAJOR, { energy: 0.4 })) })
      const { trace } = ring({ beatPulse: 1, lowMidPulse: 1 })
      const struck = cymaticsParams({
        ...settled(chord(C_MAJOR, { energy: 0.4 })),
        strike: Math.max(...trace),
      })
      expect(lineWidth(struck)).toBeGreaterThan(lineWidth(rest))
      expect(glowWidth(struck, 1920, 1080)).toBeGreaterThan(glowWidth(rest, 1920, 1080))
    })

    it('is re-struck by a chord change, and by a drop, and not by a drop alone', () => {
      const change = ring({ harmonicChange: 1 })
      expect(Math.max(...change.trace)).toBeGreaterThan(change.rest + 0.03)
      const drop = ring({ impact: 1 })
      expect(Math.max(...drop.trace)).toBeGreaterThan(drop.rest + 0.02)
    })
  })

  describe('what the moments do to the plate', () => {
    const notes = { energy: 0.5 } as const
    const plateAt = (fields: Partial<Record<keyof typeof F, number>>, tension = 0) =>
      cymaticsParams(settled(chord(C_MAJOR, { ...notes, ...fields }), tension))

    it('sharpens to thin lines as tension winds up, and sets the finer modes down', () => {
      const rest = plateAt({})
      const wound = plateAt({ tension: 1 }, 1)
      expect(wound.sharp).toBeGreaterThan(rest.sharp + 0.5)
      expect(wound.sharp).toBeLessThanOrEqual(1)
      expect(lineWidth(wound)).toBeLessThan(lineWidth(rest))
      expect(glowWidth(wound, 1920, 1080)).toBeLessThan(glowWidth(rest, 1920, 1080))
      expect(wound.layer).toBeLessThan(rest.layer)
      // The figure is the same one, and only how it is drawn changes.
      for (let note = 0; note < 12; note += 1)
        expect(wound[`mode${note}` as 'mode0']).toBeCloseTo(rest[`mode${note}` as 'mode0'], 6)
      expect(cymaticsCoverage(wound, 1920, 1080, 135)).toBeLessThan(
        cymaticsCoverage(rest, 1920, 1080, 135),
      )
    })

    it('puts the loud into width, glow and how many modes ring, and never into the light', () => {
      const soft = plateAt({ energy: 0.2 })
      const loud = plateAt({
        energy: 1,
        beatPulse: 1,
        bassPulse: 1,
        lowMidPulse: 1,
        sub: 1,
        bass: 1,
      })
      expect(loud.width).toBeGreaterThan(soft.width)
      expect(loud.glow).toBeGreaterThan(soft.glow)
      expect(loud.layer).toBeGreaterThan(soft.layer)
      expect(loud.strike).toBeGreaterThan(soft.strike)
      expect(loud.intensity).toBeLessThanOrEqual(soft.intensity)
      // Never above rest, whatever the level: the rest is what a held chord on
      // a real, busy track has to stay under without washing the canvas out.
      expect(soft.intensity).toBeGreaterThan(0)
      expect(soft.intensity).toBeLessThanOrEqual(CYMATICS_RANGES.intensity[1])
    })
  })

  describe('how much of the frame it lights', () => {
    // At the values the study itself resolves to at the loudest packet it can
    // be given, rather than numbers written down here, so a change to a row
    // moves the bound with it.
    const loudest = (notes: readonly number[], tension = 0) =>
      cymaticsParams(
        settled(
          chord(notes, {
            energy: 1,
            beatPulse: 1,
            bassPulse: 1,
            lowMidPulse: 1,
            harmonicChange: 1,
            impact: 1,
          }),
          tension,
        ),
      )

    const SHAPES = [
      [1920, 1080],
      [1080, 1920],
      [1000, 1000],
      [1440, 1080],
      [1080, 1440],
      [2560, 1080],
      [3440, 1440],
      [1280, 1024],
    ] as const

    it('is under a fifth for a triad and for a scale, at the loudest, on eight canvases', () => {
      for (const notes of [C_MAJOR, [0, 2, 4, 5, 7, 9, 11]])
        for (const tension of [0, 1])
          for (const [w, h] of SHAPES)
            expect(
              cymaticsCoverage(loudest(notes, tension), w, h, 135),
              `${notes.length} notes on ${w} by ${h} at tension ${tension}`,
            ).toBeLessThan(0.2)
    })

    it('is a few percent for a triad at rest', () => {
      const rest = cymaticsParams(settled(chord(C_MAJOR, { energy: 0.3 })))
      expect(cymaticsCoverage(rest, 1920, 1080, 135)).toBeLessThan(0.03)
    })
  })
})
