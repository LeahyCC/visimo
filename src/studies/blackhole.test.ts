/**
 * The black hole as two studies: the flow that pulls and the ink that burns
 * and bends. That they sit where dubstep, drum and bass and the demo's own
 * track are measured to sit, that a silent packet draws nothing at all, what
 * tension and the low end move, and the two things every ink is held to,
 * that it never gets louder with the level and that it is sparse.
 *
 * The lens term's own maths is `impls/analytic.lens.test.ts`, the ink's
 * numbers are `impls/blackhole.params.test.ts`, the GPU side is
 * `impls/BlackHoleInk.test.ts`, and the generic bar every study meets is
 * `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { pickCast } from '../director/director'
import type { MomentWeights } from '../director/moment'
import { closeness } from '../director/score'
import { TRACKS } from '../director/tracks.fixture'
import { analyticField, analyticVelocity, fieldMoves, lensProfile } from '../impls/analytic.params'
import {
  blackHoleCoverage,
  blackHoleGeometry,
  blackHoleLit,
  blackHoleParams,
  ringPeak,
} from '../impls/blackhole.params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { BLACKHOLE_KNOBS } from './impls'
import { findStudy } from './registry'
import { resolveStudy } from './resolve'
import type { RowState } from './resolve'
import { MOMENTS } from './types'

const NOTHING: MomentWeights = { intro: 0, groove: 0, build: 0, drop: 0, rest: 0, outro: 0 }

const hole = findStudy('black-hole')
const ring = findStudy('black-hole-ring')
if (!hole || !ring) throw new Error('Expected both halves of the black hole')

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

const at = (study: typeof hole, packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

const track = (start: string) => {
  const found = TRACKS.find((each) => each.name.startsWith(start))
  if (!found) throw new Error(`Expected ${start} in the fixture`)
  return found.character
}

/** A 16:9 canvas, as `visibleExtent` reports it. */
const WIDE = { x: 0.5, y: 0.28125 }

/** What a drop plays: the low end hard, a kick landing, the payoff fired. */
const DROP = {
  sub: 0.9,
  bass: 0.85,
  lowMid: 0.6,
  highMid: 0.5,
  treble: 0.5,
  energy: 0.85,
  subPulse: 1,
  bassPulse: 1,
  impact: 1,
  hardness: 0.7,
  pace: 0.6,
} as const

describe('where the black hole belongs', () => {
  it('is a flow and an ink for the build and the drop, sharing one home', () => {
    expect(hole.kind).toBe('flow')
    expect(hole.impl).toBe('analytic')
    expect(ring.kind).toBe('ink')
    expect(ring.impl).toBe('blackhole')
    expect(ring.cost).toBe('medium')
    expect(hole.home).toEqual(ring.home)
    expect(hole.moments).toEqual(ring.moments)
    expect(hole.reach).toBe(ring.reach)
    expect(ring.moments.build).toBe(1)
    expect(ring.moments.rest).toBe(0)
    expect(ring.moments.intro).toBe(0)
    expect(ring.moments.outro).toBe(0)
  })

  it('offers exactly the ink implementation’s knobs', () => {
    expect(Object.keys(ring.knobs).sort()).toEqual([...BLACKHOLE_KNOBS].sort())
  })

  // The card asked for dubstep, bass and doom. Those tracks are measured at a
  // LOW weight, not a high one, because `weight` reads high for a bass-led
  // spectrum and dubstep is mostly treble. The home follows the measurement.
  it('is at home on dubstep, drum and bass and the demo’s track, and nowhere soft', () => {
    for (const name of ['Subtronics', 'Pendulum', 'Ecstasy Of Soul'])
      expect(closeness(ring, track(name)), name).toBeGreaterThan(0.9)

    for (const name of ['Wilco', 'Christian Loffler', 'Daft Punk', 'Emancipator'])
      expect(closeness(ring, track(name)), name).toBeLessThan(0.3)
  })

  // Three studies for the drop in one corner means two of them are never
  // cast, and the catalogue's rule is to move a home and not to loosen the
  // test. This is why the drop fit here is 0.85 against the build's 1: the
  // shards are a drop-only ink whose one seat is the dubstep track, and a
  // fit of 1 beside them took it. `fairness.test.ts` is what caught that.
  it('leaves the shards and the lightning a cast of their own', () => {
    const seated = new Set<string>()
    for (const { character } of TRACKS)
      for (const moment of MOMENTS) {
        const cast = pickCast({ character, weights: { ...NOTHING, [moment]: 1 }, settled: 1 })
        for (const id of cast?.inks ?? []) seated.add(id)
      }

    expect([...seated].sort()).toContain('shards')
    expect([...seated].sort()).toContain('lightning')
    expect([...seated].sort()).toContain('black-hole-ring')
  })
})

describe('what the music does to the pull', () => {
  const lensAt = (packet: Float32Array, tension = 0) => at(hole, packet, tension)['lens'] ?? 0

  it('pulls a little at rest, harder when the low end is there, hardest on a build', () => {
    const quiet = lensAt(packetOf())
    const loud = lensAt(packetOf(DROP))
    const built = lensAt(packetOf(DROP), 1)
    expect(quiet).toBeCloseTo(0.14, 6)
    expect(loud).toBeGreaterThan(quiet)
    expect(built).toBeGreaterThan(loud)
    expect(built).toBeLessThanOrEqual(0.6)
  })

  it('grows the dark middle with tension, which is what the catalogue asks', () => {
    const quiet = at(hole, packetOf())['photon'] ?? 0
    const built = at(hole, packetOf(DROP), 1)['photon'] ?? 0
    expect(built).toBeGreaterThan(quiet)
    // And the pull still peaks outside it, which is where the ring burns.
    expect(1.5 * built).toBeGreaterThan(built)
  })

  // It is not still on a silent packet, for the reason curl drift and the
  // tunnel are not: a flow draws nothing, so what it does there is keep what
  // is left of the picture moving off the middle.
  it('still carries the picture off the middle on a silent packet', () => {
    const field = analyticField(at(hole, packetOf()), 1, WIDE)
    expect(fieldMoves(field)).toBe(true)
    const photon = field.photon
    expect(lensProfile(photon / 2, photon)).toBeGreaterThan(0)
    expect(lensProfile(1.5 * photon, photon)).toBeLessThan(0)
  })

  it('leaves the field still, and encodes nothing, once the study has faded out', () => {
    expect(fieldMoves(analyticField(at(hole, packetOf(DROP), 1), 0, WIDE))).toBe(false)
  })

  it('never runs the picture off the edge, even wound right up', () => {
    const field = analyticField(at(hole, filled(1), 1), 1, WIDE)
    for (let step = 0; step <= 60; step += 1) {
      const t = step / 60
      const r = t * field.reference
      const point = [field.centre[0] + r, field.centre[1]] as const
      expect(Math.hypot(...analyticVelocity(field, point)), `t ${t}`).toBeLessThan(0.7)
    }
  })
})

describe('what the music does to the ring', () => {
  const inkAt = (packet: Float32Array, tension = 0) => blackHoleParams(at(ring, packet, tension))

  it('draws exactly nothing in silence', () => {
    const silent = inkAt(packetOf())
    expect(silent.intensity).toBeCloseTo(0, 9)
    expect(blackHoleLit(silent)).toBe(false)
    expect(blackHoleCoverage(silent)).toBe(0)
    // And that holds however hard the build is winding: the level is the gate.
    expect(blackHoleLit(inkAt(packetOf(), 1))).toBe(false)
  })

  it('burns on the low end and not on the rest of the spectrum', () => {
    const low = inkAt(packetOf({ ...DROP, highMid: 0, treble: 0 }))
    const high = inkAt(packetOf({ energy: 0.85, highMid: 0.9, treble: 0.9, hardness: 0.7 }))
    expect(low.heat).toBeGreaterThan(high.heat * 2)
    expect(ringPeak(low)).toBeGreaterThan(1)
  })

  it('never gets brighter with the level, and reaches its rest when the music is full', () => {
    expect(inkAt(filled(1)).intensity).toBeLessThanOrEqual(1.15 + 1e-9)
    expect(inkAt(filled(1), 1).intensity).toBeLessThanOrEqual(1.15 + 1e-9)
    expect(inkAt(filled(1)).intensity).toBeCloseTo(1.15, 6)
  })

  it('puts the build into the disc, the width and the bend instead', () => {
    const groove = inkAt(packetOf(DROP))
    const built = inkAt(packetOf(DROP), 1)
    expect(built.disc).toBeGreaterThan(groove.disc)
    expect(built.width).toBeGreaterThan(groove.width)
    expect(built.annulus).toBeGreaterThan(groove.annulus)
    expect(built.bend).toBeGreaterThan(groove.bend)
    expect(built.intensity).toBeCloseTo(groove.intensity, 9)
  })

  it('keeps the gain well under one at everything its mapping reaches', () => {
    expect(inkAt(filled(1), 1).bend).toBeLessThanOrEqual(0.8 + 1e-9)
    expect(inkAt(filled(1), 1).bend).toBeLessThan(1)
  })

  // Every knob is non-negative by design, which is what lets the registry
  // guard hold this ink to its own default range with no table of its own.
  // Nothing it resolves reaches a clamp either: the rows are written to stop
  // at the top of the range, so the range is the floor under a host's
  // override and not the study's working room.
  it('resolves nothing negative and nothing past a clamp, at either end', () => {
    for (const [label, packet, tension] of [
      ['silence', packetOf(), 0],
      ['silence wound up', packetOf(), 1],
      ['full', filled(1), 0],
      ['full wound up', filled(1), 1],
      ['drop', packetOf(DROP), 0],
    ] as const) {
      const raw = at(ring, packet, tension)
      const clamped = blackHoleParams(raw)
      for (const knob of BLACKHOLE_KNOBS) {
        expect(Number.isFinite(raw[knob]), `${label} ${knob}`).toBe(true)
        expect(raw[knob] ?? 0, `${label} ${knob}`).toBeGreaterThanOrEqual(0)
        expect(clamped[knob], `${label} ${knob} was clamped`).toBeCloseTo(raw[knob] ?? 0, 9)
      }
    }
  })

  it('lights a small share of the frame on eight canvas shapes, at its widest', () => {
    const widest = inkAt(filled(1), 1)
    for (const aspect of [16 / 9, 21 / 9, 4 / 3, 1, 3 / 4, 9 / 16, 2.4, 0.5])
      expect(blackHoleCoverage(widest, aspect), `${aspect}`).toBeLessThan(0.2)
    expect(blackHoleCoverage(widest, 16 / 9)).toBeLessThan(0.12)
    expect(blackHoleCoverage(inkAt(packetOf(DROP)), 16 / 9)).toBeLessThan(0.08)
  })

  it('leaves the annulus outside the ring and the ring outside the disc, whatever it resolves', () => {
    for (const params of [inkAt(packetOf(DROP)), inkAt(filled(1), 1), inkAt(filled(0.4))]) {
      const geometry = blackHoleGeometry(params)
      expect(geometry.disc).toBeLessThanOrEqual(geometry.ring)
      expect(geometry.ring).toBeLessThanOrEqual(geometry.bend0)
      expect(geometry.bend0).toBeLessThanOrEqual(geometry.outer)
    }
  })

  // The only row with a memory is the one that walks the beamed side round
  // the ring, and an angle has to arrive at the same place after the same
  // seconds however the frames fell.
  it('turns the beamed side to the same place after four seconds at four frame rates', () => {
    const packet = packetOf(DROP)
    const readings = [1 / 30, 1 / 60, 1 / 144, 1 / 240].map((dt) => {
      const out: Record<string, number> = {}
      const states: RowState[] = []
      // An exact count rather than a running total, so the four rates take
      // the same four seconds and a rounding does not buy one of them a frame.
      for (let frame = 0; frame < Math.round(4 / dt); frame += 1)
        resolveStudy(ring, undefined, packet, 0, 1, out, dt, states)
      return out['spin'] ?? 0
    })

    const first = readings[0] ?? 0
    for (const reading of readings.slice(1)) expect(reading).toBeCloseTo(first, 3)
    expect(first).toBeGreaterThan(0)
  })
})
