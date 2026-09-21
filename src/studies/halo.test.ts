/**
 * The halo as a study: that it sits at the soft, tonal, slower end and suits
 * the quiet moments best, that a silent packet through its whole path draws nothing
 * while a quiet one does, what the music and tension do to it, and the point
 * of it, that it cannot wash the canvas out. It sits where the canvas piles
 * light up, so the sum is done here, frame by frame, at a full packet and at
 * the most its own mapping reaches. The falloff and the ink have their own
 * tests beside them; the generic bar every study meets is `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness, momentFit } from '../director/score'
import { HARDSTYLE } from '../director/song.fixture'
import { TRACKS } from '../director/tracks.fixture'
import {
  CANVAS_FLOOR,
  CEILING_AT_FULL_PACKET,
  FEEDBACK_KEEP,
  HALO_INTENSITY_MAX,
  HALO_RANGES,
  haloAt,
  haloCoverage,
  haloLight,
  haloLit,
  haloParams,
  KNEE,
  SETTLE,
  settledPeak,
} from '../impls/halo.params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { carriedCanvas } from './cast'
import { HALO_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { castFrame, resolveLive, resolveStudy } from './resolve'
import type { Moment } from './types'

const study = findStudy('halo')
if (!study) throw new Error('Expected the halo study')

/** A packet with the fields the halo reads set and everything else at nothing. */
const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

/** A quiet passage: a little sound, and nothing winding up. */
const QUIET = { energy: 0.15 } as const

/** Every audio field at one level, so the two ends of what a packet can be. */
const filled = (level: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') out[F[field]] = level
  return out
}

describe('the halo study', () => {
  // It was once the ink for anywhere, at the middle of the space with the
  // widest reach and 0.5 for every moment, and was in about half of all casts.
  // `director/fairness.test.ts` holds how often it is cast now; this holds
  // where it sits.
  it('is the ink for the soft, tonal, slower end, with a reach like the other inks', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('halo')
    expect(study.reach).toBeGreaterThanOrEqual(0.3)
    expect(study.reach).toBeLessThanOrEqual(0.5)
    expect(study.home.hardness).toBeLessThan(0.2)
    expect(study.home.tonality).toBeGreaterThan(0.6)
    expect(study.home.drive).toBeLessThan(0.4)
    // One quad and a uniform, at a cost well inside the frame.
    expect(study.cost).toBe('cheap')
  })

  it('offers exactly the implementation’s knobs', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...HALO_KNOBS].sort())
  })

  it('reads as the halo when it is the only ink, on the canvas’s own line', () => {
    expect(sceneOf(['halo'])).toBe('halo')
  })

  // Measured tracks, so the home is held to the music it was written for and
  // not to a made-up character.
  it('is at home with the ambient, folk and orchestral tracks and far from the hard ones', () => {
    const closeTo = (start: string) =>
      closeness(study, TRACKS.find((track) => track.name.startsWith(start))!.character)
    for (const soft of ['Christian Loffler', 'Wilco', 'Daft Punk'])
      expect(closeTo(soft), soft).toBeGreaterThan(0.6)
    for (const hard of ['August Burns Red', 'Subtronics', 'Ecstasy Of Soul'])
      expect(closeTo(hard), hard).toBeLessThan(0.15)
    expect(closeness(study, HARDSTYLE)).toBeLessThan(0.15)
  })

  it('suits a quiet moment best, a groove less, and a drop least', () => {
    const fit = (moment: Moment) =>
      momentFit(study.moments, {
        intro: 0,
        groove: 0,
        build: 0,
        drop: 0,
        rest: 0,
        outro: 0,
        [moment]: 1,
      })
    for (const quiet of ['intro', 'rest', 'outro'] as const)
      expect(fit(quiet), quiet).toBeGreaterThanOrEqual(0.9)
    expect(fit('groove')).toBeLessThanOrEqual(0.5)
    expect(fit('drop')).toBeLessThanOrEqual(0.2)
    expect(fit('drop')).toBeLessThan(fit('groove'))
  })
})

describe('silence and quiet', () => {
  const silent = packetOf()

  // A silent packet has to draw nothing, and the radius is what says so: a
  // glow of no size draws nothing however much light there is, and tension
  // taking the radius under nothing does not change that.
  it('resolves a silent packet to no radius, and draws nothing, at any tension', () => {
    for (const tension of [0, 0.25, 0.5, 1]) {
      const knobs = at(silent, tension)
      expect(knobs.radius ?? 1, `tension ${tension}`).toBeLessThanOrEqual(0)
      expect(haloLit(haloParams(knobs)), `tension ${tension}`).toBe(false)
    }
  })

  it('lets the radius run under nothing on a near-silent build, and the ink hold it at nothing', () => {
    // The exception the registry guard names: tension takes 0.07 off a radius
    // that the energy has hardly lifted.
    const knobs = at(packetOf({ energy: 0.001 }), 1)
    expect(knobs.radius ?? 0).toBeLessThan(0)
    expect(haloParams(knobs).radius).toBe(0)
    expect(haloLit(haloParams(knobs))).toBe(false)
  })

  it('draws for a quiet passage, with a size worth having', () => {
    const params = haloParams(at(packetOf(QUIET)))
    expect(haloLit(params)).toBe(true)
    expect(params.radius).toBeGreaterThan(0.08)
    expect(params.radius).toBeLessThan(0.15)
    expect(params.intensity).toBeGreaterThan((study.knobs.intensity ?? 0) * 0.9)
  })

  it('lets the first sound in at all: a hair of energy is already a glow', () => {
    expect(haloLit(haloParams(at(packetOf({ energy: 0.01 }))))).toBe(true)
  })
})

describe('what the music does to the halo', () => {
  it('breathes: the radius grows with the energy at every step, and never past the range', () => {
    const levels = [0, 0.05, 0.15, 0.3, 0.5, 0.75, 1].map(
      (energy) => at(packetOf({ energy })).radius ?? 0,
    )
    for (let step = 1; step < levels.length; step += 1)
      expect(levels[step]).toBeGreaterThan(levels[step - 1] ?? 0)
    expect(levels[levels.length - 1]).toBeCloseTo(0.26, 9)
    expect(levels[levels.length - 1]).toBeLessThanOrEqual(HALO_RANGES.radius[1])
  })

  it('takes a little more light on the beat, and only a little', () => {
    const still = at(packetOf(QUIET)).intensity ?? 0
    const beat = at(packetOf({ ...QUIET, beatPulse: 1 })).intensity ?? 0
    expect(beat).toBeGreaterThan(still)
    expect(beat - still).toBeCloseTo(0.004, 9)
    expect(beat / still).toBeLessThan(1.25)
  })

  it('opens into a ring on a kick: the low end pushes the peak out and the middle goes dark', () => {
    const calm = haloParams(at(packetOf({ ...QUIET, sub: 0, bass: 0 })))
    const kick = haloParams(at(packetOf({ ...QUIET, sub: 1 })))
    const bass = haloParams(at(packetOf({ ...QUIET, bass: 1 })))
    expect(kick.hollow).toBeGreaterThan(calm.hollow + 0.4)
    expect(bass.hollow).toBe(kick.hollow)
    // The middle of a calm glow is bright; the middle of a kicked one is dark.
    expect(haloLight(0, calm.hollow, calm.softness)).toBeGreaterThan(0.5)
    expect(haloLight(0, kick.hollow, kick.softness)).toBe(0)
    // And the peak has moved out to the hollow, on the way to the edge.
    expect(haloLight(kick.hollow, kick.hollow, kick.softness)).toBeGreaterThan(0.999)
    expect(kick.hollow).toBeLessThanOrEqual(HALO_RANGES.hollow[1])
  })

  it('tightens the core of a hard track and softens a soft one', () => {
    const soft = at(packetOf({ ...QUIET, hardness: 0 })).softness ?? 0
    const hard = at(packetOf({ ...QUIET, hardness: 1 })).softness ?? 0
    expect(soft).toBeGreaterThan(hard)
    expect(hard).toBeGreaterThanOrEqual(HALO_RANGES.softness[0])
  })

  it('takes its colour from the ribbon’s palette at the key and leaves the offset alone', () => {
    expect(at(packetOf({ ...QUIET, keyHue: 0.7 })).hue).toBe(study.knobs.hue)
  })
})

describe('what tension does to the halo', () => {
  const packet = packetOf(QUIET)

  it('tightens the radius, at every step, and takes the hollow down with it', () => {
    const radius = [0, 0.25, 0.5, 0.75, 1].map((tension) => at(packet, tension).radius ?? 0)
    const hollow = [0, 0.25, 0.5, 0.75, 1].map((tension) => at(packet, tension).hollow ?? 0)
    for (let step = 1; step < radius.length; step += 1) {
      expect(radius[step]).toBeLessThan(radius[step - 1] ?? 0)
      expect(hollow[step]).toBeLessThan(hollow[step - 1] ?? 0)
    }

    expect((radius[0] ?? 0) - (radius[4] ?? 0)).toBeCloseTo(0.07, 9)
    expect((hollow[0] ?? 0) - (hollow[4] ?? 0)).toBeCloseTo(0.15, 9)
  })

  it('and lifts the intensity a little, at every step', () => {
    const light = [0, 0.25, 0.5, 0.75, 1].map((tension) => at(packet, tension).intensity ?? 0)
    for (let step = 1; step < light.length; step += 1)
      expect(light[step]).toBeGreaterThan(light[step - 1] ?? 0)
    expect((light[4] ?? 0) - (light[0] ?? 0)).toBeCloseTo(0.002, 9)
    expect((light[4] ?? 0) / (light[0] ?? 1)).toBeLessThan(1.25)
  })

  it('tightens a quiet build to a point, which is still lit, and takes the hollow to nothing', () => {
    const calm = haloParams(at(packet, 0))
    const wound = haloParams(at(packet, 1))
    expect(haloLit(wound)).toBe(true)
    expect(wound.radius).toBeLessThan(calm.radius * 0.4)
    expect(wound.radius).toBeLessThan(0.04)
    expect(wound.hollow).toBe(0)
    expect(wound.intensity).toBeGreaterThan(calm.intensity)
  })

  it('leaves the shape and the colour alone', () => {
    const calm = at(packet, 0)
    const wound = at(packet, 1)
    expect(wound.softness).toBe(calm.softness)
    expect(wound.hue).toBe(calm.hue)
  })

  it('never lights a silent build, whatever it does to the light', () => {
    expect(at(packetOf(), 1).intensity ?? 0).toBeGreaterThan(0)
    expect(haloLit(haloParams(at(packetOf(), 1)))).toBe(false)
  })
})

// The heart of it. The halo sits at the middle of a canvas that keeps 93
// percent of itself a frame, where a flow that pulls in or pushes out leaves
// the middle where it was, so a glow that does not move settles to about
// fourteen times what one frame adds. Nothing else in the frame piles up like
// that, so the sum is done here and held.
describe('how bright the middle of the canvas can get', () => {
  /** The ceiling the director's own canvas holds at a full packet, as the resolver reads it. */
  const ceilingAt = (packet: Float32Array, tension: number) => {
    const frame = resolveLive(
      [{ id: 'halo', presence: 1 }],
      carriedCanvas(),
      packet,
      tension,
      castFrame(),
    )
    return frame.post.feedback.ceiling
  }

  // The canvas moved under these inks when the hold landed: it keeps 0.975 a
  // frame now and fades dim light away rather than subtracting a fixed amount,
  // so a still core sums several times higher than the budget below allows
  // for. Re-budgeting the four inks that carry it is a pass of its own (see
  // docs/open-leads.md), so what the budget was written against is pinned
  // here and the drift is held in plain sight rather than left to be found.
  it('is budgeted against the canvas as it stood before the hold', () => {
    expect(CANVAS_FLOOR).toBe(0.018)
    expect(carriedCanvas().knobs['feedback.floor']).toBe(0)
    expect(carriedCanvas().knobs['feedback.fade']).toBeGreaterThan(0)
    expect(carriedCanvas().knobs['feedback.decay']).toBeGreaterThan(0.93)
  })

  it('reads the canvas’s ceiling at a full packet as the header of the params file says', () => {
    expect(ceilingAt(filled(1), 0)).toBeCloseTo(CEILING_AT_FULL_PACKET, 9)
    expect(ceilingAt(filled(1), 1)).toBeCloseTo(CEILING_AT_FULL_PACKET, 9)
  })

  /**
   * The centre of the canvas, frame by frame: keep what is there and add one
   * frame of the halo. `light` is what the ink adds at the middle of the
   * frame on one frame at 60 a second, which is the falloff at 0 times the
   * intensity, and the peak anywhere else is no more than the falloff's peak
   * of 1 times the same.
   */
  const settle = (params: ReturnType<typeof haloParams>, frames = 900) => {
    const width = 1920
    const height = 1080
    const centre = params.intensity * haloAt(width / 2, height / 2, params, width, height)
    // The most any pixel gets a frame: the peak of the falloff is 1 wherever
    // the hollow puts it.
    const peak = params.intensity
    let canvasCentre = 0
    let canvasPeak = 0
    let highest = 0
    // The canvas takes its floor off what it kept before the new light goes
    // in, which is what `settledPeak` allows for.
    for (let frame = 0; frame < frames; frame += 1) {
      canvasCentre = Math.max(0, canvasCentre * FEEDBACK_KEEP - CANVAS_FLOOR) + centre
      canvasPeak = Math.max(0, canvasPeak * FEEDBACK_KEEP - CANVAS_FLOOR) + peak
      highest = Math.max(highest, canvasCentre, canvasPeak)
    }

    return { centre: canvasCentre, peak: canvasPeak, highest }
  }

  it('sums a still glow at a full packet to under the canvas’s ceiling, and under its knee', () => {
    for (const tension of [0, 1]) {
      const packet = filled(1)
      const params = haloParams(at(packet, tension))
      const { centre, peak, highest } = settle(params)
      const ceiling = ceilingAt(packet, tension)
      expect(highest, `tension ${tension}`).toBeLessThan(ceiling)
      expect(peak, `tension ${tension}`).toBeLessThan(ceiling / 2)
      expect(centre).toBeLessThanOrEqual(peak + 1e-12)
      // The closed form says the same: `SETTLE` times what one frame adds over the floor.
      expect(peak).toBeCloseTo(settledPeak(params), 3)
    }
  })

  // Pale, and under the knee. It used to be reckoned at 0.4 with the floor
  // left out, which on the real canvas was 0.14 and could not be seen.
  it('rests at a settled peak of about a half, which is pale, and is under the knee', () => {
    const rest = haloParams({ ...study.knobs, radius: 0.1 })
    expect(settledPeak(rest)).toBeGreaterThan(0.45)
    expect(settledPeak(rest)).toBeLessThan(0.6)
    expect(settledPeak(rest)).toBeLessThan(KNEE)
  })

  // Whatever the mapping does, the most light it can reach is the sum of every
  // row that adds and none that takes away: a beat with no sound in a full
  // build. That is the worst the middle can be asked to hold.
  it('holds under the knee at the most light the mapping reaches, on any packet', () => {
    let brightest = 0
    const steps = [0, 0.5, 1]
    for (const energy of steps)
      for (const swell of steps)
        for (const hardness of steps)
          for (const beatPulse of steps)
            for (const tension of steps) {
              const knobs = at(packetOf({ energy, swell, hardness, beatPulse }), tension)
              brightest = Math.max(brightest, knobs.intensity ?? 0)
            }

    expect(brightest).toBeCloseTo(0.061, 9)
    expect(brightest).toBeLessThanOrEqual(HALO_INTENSITY_MAX)
    expect(SETTLE * (brightest - CANVAS_FLOOR)).toBeLessThan(KNEE)
    // And it is the range's top, not the mapping's, that the knee holds by construction.
    expect(SETTLE * (HALO_INTENSITY_MAX - CANVAS_FLOOR)).toBeCloseTo(KNEE, 12)
    expect(HALO_RANGES.intensity[1]).toBe(HALO_INTENSITY_MAX)
  })

  it('dims the light as the music fills the frame, and never lifts it past rest', () => {
    const rest = study.knobs.intensity ?? 0
    const full = at(filled(1), 0).intensity ?? 0
    expect(full).toBeGreaterThan(0)
    expect(full).toBeLessThan(rest * 0.6)
  })
})

describe('how much of the frame it lights', () => {
  it('lights under a tenth of a 16:9 frame at the widest the study reaches, and under two percent on a quiet passage', () => {
    const loud = haloParams(at(packetOf({ energy: 1 }), 0))
    expect(loud.radius).toBeCloseTo(0.26, 9)
    expect(haloCoverage(loud)).toBeLessThan(0.1)
    const quiet = haloParams(at(packetOf(QUIET), 0))
    expect(haloCoverage(quiet)).toBeLessThan(0.02)
    expect(haloCoverage(quiet)).toBeGreaterThan(0.005)
  })

  it('lights the same share of a tall frame as of a wide one, to a pixel of the grid', () => {
    const params = haloParams(at(packetOf({ energy: 0.5 }), 0))
    expect(haloCoverage(params, 9 / 16, 320)).toBeCloseTo(haloCoverage(params, 16 / 9, 180), 2)
  })
})

describe('the same at any frame rate', () => {
  // The halo has no clock: what it draws is its knobs and the key, and the
  // canvas's own per-second feedback is what holds the brightness. So there is
  // nothing per frame to check but that the resolved knobs do not depend on a
  // step, which is that the resolver is handed no `dt` at all.
  it('resolves the same knobs however often it is asked, since nothing in it runs on time', () => {
    const packet = packetOf({ ...QUIET, beatPulse: 0.4, keyHue: 0.2 })
    const first = { ...at(packet, 0.3) }
    for (let frame = 0; frame < 240; frame += 1) at(packet, 0.3)
    expect(at(packet, 0.3)).toEqual(first)
  })
})
