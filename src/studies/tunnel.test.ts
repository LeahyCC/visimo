/**
 * The tunnel as a study: which way it travels and why, what a silent packet
 * leaves of it, what tension does to it, and where the director puts it. The
 * maths of the field is `impls/analytic.params.test.ts` and the generic bar
 * every study meets is `registry.test.ts`; this is what is particular to this
 * one.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { Director, pickCast } from '../director/director'
import type { MomentWeights } from '../director/moment'
import { HARDSTYLE, HOUSE, LOFI, playSong } from '../director/song.fixture'
import {
  ANALYTIC_RANGES,
  analyticField,
  analyticVelocity,
  fieldMoves,
} from '../impls/analytic.params'
import { visibleExtent } from '../scenes/fluid.params'
import { carriedCanvas } from './cast'
import { findStudy, STUDIES } from './registry'
import { resolveStudy } from './resolve'
import type { Character } from './types'

const study = findStudy('tunnel')
if (!study) throw new Error('Expected the tunnel study')
const curlDrift = findStudy('curl-drift')
if (!curlDrift) throw new Error('Expected the curl drift study')
const implode = findStudy('implode')
if (!implode) throw new Error('Expected the implode study')

const WIDE = visibleExtent(2560, 1440)
const silent = () => new Float32Array(PACKET_LENGTH)
const at = (tension: number, packet = silent(), presence = 1) =>
  resolveStudy(study, undefined, packet, tension, presence, {})

const heard = (values: Partial<Record<keyof typeof F, number>>) => {
  const packet = silent()
  for (const [name, value] of Object.entries(values)) packet[F[name as keyof typeof F]] = value
  return packet
}

const fieldOf = (tension: number, packet = silent(), presence = 1) =>
  analyticField(at(tension, packet, presence), presence, WIDE)

/** The centre of the canvas and its top right corner, in field uv. */
const CENTRE: readonly [number, number] = [0.5, 0.5]
const CORNER: readonly [number, number] = [0.5 + WIDE.x, 0.5 - WIDE.y]

const away = (point: readonly [number, number], field = fieldOf(0)) => {
  const [vx, vy] = analyticVelocity(field, point)
  const dx = point[0] - CENTRE[0]
  const dy = point[1] - CENTRE[1]
  const radius = Math.hypot(dx, dy)
  return {
    // Along the line from the centre, and across it, in field widths a second.
    out: (vx * dx + vy * dy) / radius,
    round: (vx * -dy + vy * dx) / radius,
  }
}

describe('the tunnel study', () => {
  it('is a cheap flow on the analytic implementation, for the groove and the build', () => {
    expect(study.kind).toBe('flow')
    expect(study.impl).toBe('analytic')
    expect(study.moments).toEqual({ intro: 0, groove: 1, build: 1, drop: 0, rest: 0, outro: 0 })
    expect(study.cost).toBe('cheap')
  })

  it('lives where a beat is steady and says nothing of the rest, with a moderate reach', () => {
    expect(study.home.steadiness).toBeGreaterThanOrEqual(0.7)
    for (const axis of ['drive', 'weight', 'tonality', 'hardness'] as const)
      expect(study.home[axis]).toBe(0.5)
    expect(study.reach).toBeGreaterThanOrEqual(0.4)
    expect(study.reach).toBeLessThanOrEqual(0.6)
  })

  it('is a plain zoom, radial and a little swirl and no twist', () => {
    for (const tension of [0, 1])
      for (const packet of [silent(), heard({ energy: 1, harmonicChange: 1 })]) {
        const knobs = at(tension, packet)
        expect(knobs.falloff).toBe(0)
        expect(knobs.twist).toBe(0)
        expect(knobs.radial).toBeGreaterThan(0)
      }
  })

  it('rests the curl term where curl drift does, so a crossfade does not slide it', () => {
    for (const tension of [0, 1])
      for (const packet of [silent(), heard({ energy: 1, harmonicChange: 1 })]) {
        const knobs = at(tension, packet)
        expect([knobs.curl, knobs.curlScale, knobs.curlRate]).toEqual([
          0,
          curlDrift.knobs.curlScale,
          curlDrift.knobs.curlRate,
        ])
      }
  })

  it('is in the registry once', () => {
    expect(STUDIES.filter((entry) => entry.id === 'tunnel')).toHaveLength(1)
  })
})

// Which way is forward. The header says outward, and this is what the
// argument rests on, so a change to either has to revisit the other.
describe('which way it travels', () => {
  it('streams away from the centre, at every point of the frame', () => {
    for (const point of [CORNER, [0.9, 0.5], [0.5, 0.4], [0.1, 0.6], [0.3, 0.3]] as const)
      expect(away(point).out, `${point}`).toBeGreaterThan(0)
  })

  it('is a plain zoom: the speed is proportional to the distance from the centre', () => {
    const rim = away(CORNER).out
    const half = away([0.5 + WIDE.x / 2, 0.5 - WIDE.y / 2]).out
    const quarter = away([0.5 + WIDE.x / 4, 0.5 - WIDE.y / 4]).out
    expect(half / rim).toBeCloseTo(0.5, 9)
    expect(quarter / rim).toBeCloseTo(0.25, 9)
  })

  // The canvas every director cast draws on already zooms outward, and that is
  // one of the reasons the tunnel does too: inward would first have to cancel it.
  it('travels the way the canvas already zooms, so the two add', () => {
    const canvas = carriedCanvas()
    const zoomPerSecond = canvas.knobs['feedback.zoom'] ** 60 - 1
    expect(zoomPerSecond).toBeGreaterThan(0.08)
    expect(zoomPerSecond).toBeLessThan(0.11)
    // The canvas's outward zoom at the rim, in field widths a second, is what
    // an inward tunnel would have to pull back before it moved the picture in.
    const reference = fieldOf(0).reference
    expect(Math.log(1 + zoomPerSecond) * reference).toBeCloseTo(0.0516, 3)
    expect(study.knobs.radial).toBeGreaterThan(0)
  })
})

// A flow draws nothing, so at a silent packet it is what it does to the
// picture that is left: at its resting speed and not still.
describe('at a silent packet', () => {
  it('carries what is left at its resting speed, slowly, and is not switched off', () => {
    const knobs = at(0)
    expect(knobs.radial).toBeCloseTo(0.04, 12)
    const field = fieldOf(0)
    expect(fieldMoves(field)).toBe(true)
    // At the rim, which is the fastest place, that is 100 px a second on a
    // canvas 2560 wide.
    expect(away(CORNER, field).out).toBeCloseTo(0.04, 9)
    expect(away(CORNER, field).out * 2560).toBeCloseTo(102.4, 6)
  })

  it('costs nothing at presence 0', () => {
    expect(fieldMoves(fieldOf(1, heard({ energy: 1 }), 0))).toBe(false)
  })

  it('fades with presence, the swirl with it', () => {
    const full = fieldOf(0, silent(), 1)
    const half = fieldOf(0, silent(), 0.5)
    expect(half.radial).toBeCloseTo(full.radial / 2, 12)
    expect(half.swirl).toBeCloseTo(full.swirl / 2, 12)
    expect(half.falloff).toBe(full.falloff)
  })
})

// The bar: a test shows tension moving a knob. It is the study: the speed
// climbs with it toward the drop, and the swirl winds a little.
describe('what tension does to it', () => {
  it('accelerates it by 0.15 field widths a second over a whole build', () => {
    const calm = at(0)
    const wound = at(1)
    expect((wound.radial ?? 0) - (calm.radial ?? 0)).toBeCloseTo(0.15, 12)
    expect(wound.swirl).toBeGreaterThan(calm.swirl ?? 0)
  })

  it('winds it up smoothly, with no step, over the whole of a build', () => {
    let last = at(0).radial ?? 0
    for (let tension = 0.05; tension <= 1.0001; tension += 0.05) {
      const now = at(tension).radial ?? 0
      expect(now).toBeGreaterThan(last)
      expect(now - last).toBeLessThan(0.01)
      last = now
    }
  })

  it('stays a travel and not a pull: well short of implode and of the range', () => {
    const full = at(1, heard({ energy: 1, harmonicChange: 1 }))
    expect(full.radial).toBeCloseTo(0.23, 12)
    expect(full.radial).toBeLessThan(ANALYTIC_RANGES.radial[1] / 4)
    expect(full.radial).toBeLessThan(
      Math.abs(resolveStudy(implode, undefined, heard({ energy: 1 }), 1, 1, {}).radial ?? 0) / 2,
    )
  })
})

// Nothing sits still: the speed follows the level, and the swirl the chords.
describe('what the song does to it', () => {
  it('goes faster on a louder passage', () => {
    expect(at(0, heard({ energy: 1 })).radial).toBeCloseTo(0.08, 12)
    expect(at(0, heard({ energy: 0.5 })).radial).toBeGreaterThan(at(0).radial ?? 0)
  })

  it('turns a little when nothing is changing, and further when a chord does', () => {
    const rest = at(0).swirl ?? 0
    expect(rest).toBeGreaterThan(0)
    expect(at(0, heard({ harmonicChange: 1 })).swirl).toBeGreaterThan(rest)
  })

  it('bends the streaks by ten degrees at the rim at rest, and by thirty in a groove with a chord change', () => {
    const angle = (packet: ReturnType<typeof silent>) => {
      const { out, round } = away(CORNER, fieldOf(0, packet))
      return (Math.atan2(round, out) * 180) / Math.PI
    }

    expect(angle(silent())).toBeGreaterThan(5)
    expect(angle(silent())).toBeLessThan(15)
    expect(angle(heard({ energy: 1 }))).toBeLessThan(angle(silent()))
    // A full chord change in a groove, which is the most the harmonic row does.
    expect(angle(heard({ energy: 1, harmonicChange: 1 }))).toBeGreaterThan(20)
    expect(angle(heard({ energy: 1, harmonicChange: 1 }))).toBeLessThan(40)
  })
})

// The velocity is per second and the resolver holds nothing between frames,
// so a second of travel is the same distance at any frame rate.
describe('at any frame rate', () => {
  it('moves the rim the same distance in a second at 30, 60 and 144 frames a second', () => {
    const field = fieldOf(0.5, heard({ energy: 0.7 }))
    const rim = away(CORNER, field).out
    for (const fps of [30, 60, 144]) {
      let travelled = 0
      for (let frame = 0; frame < fps; frame += 1) travelled += rim / fps
      expect(travelled, `${fps} fps`).toBeCloseTo(rim, 12)
    }
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
    'lo-fi': LOFI,
    'house': HOUSE,
    'hardstyle': HARDSTYLE,
  }

  it('is the flow of a house groove, where the beat is steady and nothing is hard', () => {
    expect(pickCast({ character: HOUSE, weights: weights({ groove: 1 }) })?.flow).toBe('tunnel')
  })

  it('is never the flow of a quiet moment or of a drop', () => {
    for (const moment of ['intro', 'rest', 'outro', 'drop'] as const)
      for (const [name, character] of Object.entries(characters))
        expect(
          pickCast({ character, weights: weights({ [moment]: 1 }) })?.flow,
          `${name} ${moment}`,
        ).not.toBe('tunnel')
  })

  it('is not the flow of a lo-fi groove', () => {
    for (const settled of [0, 1])
      expect(
        pickCast({ character: LOFI, weights: weights({ groove: 1 }), settled })?.flow,
      ).not.toBe('tunnel')
  })

  // The scripted song, so it is the director's own smoothing that decides.
  // The build carries a groove weight while tension is still climbing, and the
  // tunnel suits both, so it takes the early part of a build on every track.
  it('takes the early part of the scripted build and speeds up through it', () => {
    for (const [name, character] of Object.entries(characters)) {
      const director = new Director()
      const radials: number[] = []
      for (const { time, dt, features } of playSong(30, character)) {
        const frame = director.step(features, dt)
        if (director.cast?.flow !== 'tunnel' || time < 60 || time > 76) continue
        const live = frame.studies.find((entry) => entry.id === 'tunnel')
        if (live)
          radials.push(resolveStudy(study, undefined, features, frame.tension, 1, {}).radial ?? 0)
      }

      expect(radials.length, name).toBeGreaterThan(30)
      expect(radials.at(-1) ?? 0, name).toBeGreaterThan((radials[0] ?? 0) + 0.02)
    }
  })

  it('leaves an ink beside it, since the dye needs a fluid and there is none', () => {
    const cast = pickCast({ character: HOUSE, weights: weights({ groove: 1 }) })
    expect(cast?.inks.length).toBeGreaterThan(0)
    expect(cast?.inks).not.toContain('dye-plumes')
  })
})
