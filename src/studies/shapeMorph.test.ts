/**
 * The shape morph as a study: that it is the ink for the groove, the build and
 * the drop of a steady, fairly hard track, that a silent packet draws nothing,
 * what the music and tension each move, and the two things every ink is held
 * to, that it is sparse and that it does not brighten as the music gets loud.
 * Its numbers and its GPU side have their own tests beside them, and the
 * generic bar every study meets is `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness, momentFit } from '../director/score'
import { HARDSTYLE, HOUSE, LOFI } from '../director/song.fixture'
import { TRACKS } from '../director/tracks.fixture'
import {
  BODY,
  HALF_VIEW,
  luminance,
  MORPH_LIGHT,
  morphCoverage,
  morphGlintLevel,
  morphLights,
  morphLit,
  morphParams,
} from '../impls/morph.params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { MORPH_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { resolveStudy } from './resolve'
import type { RowState } from './resolve'
import { MOMENTS } from './types'
import type { Moment } from './types'

const study = findStudy('shape-morph')
if (!study) throw new Error('Expected the shape morph study')

const SHAPES = [
  [2560, 1440],
  [1920, 1080],
  [1080, 1920],
  [1440, 1440],
  [3840, 2160],
  [640, 640],
  [3840, 1080],
  [1080, 2520],
] as const

const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

/** Every audio field at one level, which is the two ends of what a packet can be. */
const filled = (level: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') out[F[field]] = level
  return out
}

/**
 * The study resolved over four seconds of one packet, so its shaped rows have
 * settled: a spring has stopped ringing, a follower has arrived, and the two
 * totals have been climbing for the whole of it.
 */
const settled = (packet: Float32Array, tension = 0, seconds = 4, dt = 1 / 60) => {
  const out: Record<string, number> = {}
  const states: RowState[] = []
  for (let frame = 0; frame < Math.round(seconds / dt); frame += 1)
    resolveStudy(study, undefined, packet, tension, 1, out, dt, states)
  return out
}

/** One stateless reading, for the rows that carry no shape. */
const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

describe('the shape morph study', () => {
  it('is the heavy ink for a groove, a build and a drop', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('morph')
    expect(study.cost).toBe('heavy')
    expect(study.moments.groove).toBe(1)
    expect(study.moments.build).toBe(0.8)
    expect(study.moments.drop).toBe(0.8)
    for (const moment of ['intro', 'rest', 'outro'] as const)
      expect(study.moments[moment], moment).toBe(0)
  })

  it('offers exactly the implementation’s knobs', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...MORPH_KNOBS].sort())
  })

  it('reads as the morph when it is the only ink, on the canvas’s own line', () => {
    expect(sceneOf(['shape-morph'])).toBe('morph')
  })

  it('keeps out of a cast with the other raymarched ink', () => {
    expect(study.excludes).toEqual(['fractal-glints'])
  })

  it('is at home with a house and a hardstyle track and less so with a lo-fi one', () => {
    expect(closeness(study, HOUSE)).toBeGreaterThan(0.6)
    expect(closeness(study, HARDSTYLE)).toBeGreaterThan(0.5)
    expect(closeness(study, LOFI)).toBeLessThan(closeness(study, HOUSE) - 0.2)
  })

  it('reaches the measured dance tracks and not the quiet ones', () => {
    const found = (name: string) => {
      const track = TRACKS.find((one) => one.name.includes(name))
      if (!track) throw new Error(`Expected ${name} in the fixture`)
      return closeness(study, track.character)
    }

    for (const name of ['John Summit', 'Pendulum', 'Subtronics'])
      expect(found(name), name).toBeGreaterThan(0.6)
    for (const name of ['Wilco', 'Daft Punk', 'Christian Loffler'])
      expect(found(name), name).toBeLessThan(0.25)
  })

  it('suits the three moments the catalogue gives it and nothing else', () => {
    for (const moment of MOMENTS) {
      const weights: Record<Moment, number> = {
        intro: 0,
        groove: 0,
        build: 0,
        drop: 0,
        rest: 0,
        outro: 0,
        [moment]: 1,
      }
      expect(momentFit(study.moments, weights), moment).toBe(study.moments[moment])
    }
  })
})

describe('silence', () => {
  it('draws nothing on a silent packet, at any tension', () => {
    for (const tension of [0, 0.5, 1])
      expect(morphLit(morphParams(settled(packetOf(), tension)), packetOf()), `${tension}`).toBe(
        false,
      )
  })

  it('brings its light up to rest as the music arrives, and never past it', () => {
    const rest = study.knobs.intensity ?? 0
    const quiet = at(packetOf({ energy: 0.2 })).intensity ?? 0
    const loud = at(packetOf({ energy: 1 })).intensity ?? 0
    expect(quiet).toBeGreaterThan(0)
    expect(quiet).toBeLessThan(loud)
    expect(loud).toBeCloseTo(rest, 6)
    expect(at(filled(1)).intensity ?? 0).toBeLessThanOrEqual(rest)
  })
})

describe('what the music does to it', () => {
  it('breathes the solid with the bass, overshooting on a kick', () => {
    const rest = study.knobs.size ?? 0
    expect(settled(packetOf({ bass: 1 })).size ?? 0).toBeGreaterThan(rest)
    expect(settled(packetOf({ bass: 0 })).size ?? 0).toBeCloseTo(rest, 6)

    // The spring passes its target on the way, which a follower would not.
    const out: Record<string, number> = {}
    const states: RowState[] = []
    const kick = packetOf({ bass: 1 })
    let peak = 0
    for (let frame = 0; frame < 120; frame += 1) {
      resolveStudy(study, undefined, kick, 0, 1, out, 1 / 240, states)
      peak = Math.max(peak, out.size ?? 0)
    }

    expect(peak).toBeGreaterThan(settled(kick).size ?? 0)
  })

  it('ripples the surface with the mids, and lets the ripple go over a phrase', () => {
    const rest = study.knobs.ripple ?? 0
    const struck = settled(packetOf({ highMid: 1 }), 0, 1)
    expect(struck.ripple ?? 0).toBeGreaterThan(rest)

    // The envelope lets go rather than dropping: half a second after the
    // stab there is still something left of it.
    const out: Record<string, number> = {}
    const states: RowState[] = []
    for (let frame = 0; frame < 60; frame += 1)
      resolveStudy(study, undefined, packetOf({ highMid: 1 }), 0, 1, out, 1 / 60, states)
    const hot = out.ripple ?? 0
    for (let frame = 0; frame < 30; frame += 1)
      resolveStudy(study, undefined, packetOf(), 0, 1, out, 1 / 60, states)
    expect(out.ripple ?? 0).toBeLessThan(hot)
    expect(out.ripple ?? 0).toBeGreaterThan(rest)
  })

  it('turns it with the energy, and holds it still in silence', () => {
    expect(settled(packetOf({ energy: 1 })).spin ?? 0).toBeGreaterThan(0.2)
    expect(settled(packetOf({ energy: 0.2 })).spin ?? 0).toBeLessThan(
      settled(packetOf({ energy: 1 })).spin ?? 0,
    )

    expect(settled(packetOf()).spin ?? 0).toBe(0)
    // The axis drifts on the swell, so no two bars show the same face.
    expect(settled(packetOf({ swell: 1 })).tumble ?? 0).toBeGreaterThan(0)
    expect(settled(packetOf()).tumble ?? 0).toBe(0)
  })

  it('turns at the same rate at any frame rate', () => {
    const packet = packetOf({ energy: 1 })
    const spun = [1 / 30, 1 / 60, 1 / 144].map((dt) => settled(packet, 0, 4, dt).spin ?? 0)
    for (const turned of spun) expect(turned).toBeCloseTo(spun[0] ?? 0, 3)
  })

  it('widens the rim with the level and throws it wide on the drop', () => {
    const rest = study.knobs.rim ?? 0
    expect(at(packetOf({ energy: 1 })).rim ?? 0).toBeGreaterThan(rest)
    expect(at(packetOf({ energy: 1, impact: 1 })).rim ?? 0).toBeGreaterThan(
      at(packetOf({ energy: 1 })).rim ?? 0,
    )
  })

  it('takes both its light colours from the palette at the key', () => {
    const packet = packetOf({ keyHue: 0.4 })
    expect(at(packet).hue ?? 0).toBeCloseTo(packet[F.keyHue] ?? 0, 6)
    const params = morphParams(at(packet))
    const { key, rim } = morphLights(packet, params)
    expect(key).not.toEqual(rim)
  })
})

describe('what tension does to it', () => {
  it('shrinks it and spins it up, and leaves its light alone', () => {
    const groove = settled(filled(0.5), 0)
    const build = settled(filled(0.5), 1)
    expect(build.size ?? 0).toBeLessThan(groove.size ?? 0)
    expect((build.size ?? 0) / (groove.size ?? 1)).toBeLessThan(0.75)
    expect(build.spin ?? 0).toBeGreaterThan(groove.spin ?? 0)
    expect(build.intensity ?? 0).toBeCloseTo(groove.intensity ?? 0, 10)
  })

  it('never shrinks it out of existence, at any level', () => {
    for (const level of [0, 0.25, 0.5, 0.75, 1])
      expect(settled(filled(level), 1).size ?? 0, `level ${level}`).toBeGreaterThan(0.2)
  })
})

describe('it does not wash the canvas out', () => {
  it('is dimmer at a full packet than at rest, and no more saturated anywhere', () => {
    const rest = study.knobs.intensity ?? 0
    expect(settled(filled(1), 0).intensity ?? 0).toBeLessThan(rest)
    expect(settled(filled(1), 1).intensity ?? 0).toBeLessThan(rest)
  })

  it('raises its threshold where the canvas is fullest', () => {
    const rest = study.knobs.glint ?? 0
    expect(at(filled(1)).glint ?? 0).toBeGreaterThan(rest)
    expect(at(packetOf({ energy: 1 })).glint ?? 0).toBeGreaterThan(rest)
    expect(at(packetOf({ release: 1 })).glint ?? 0).toBeGreaterThan(rest)
    // Short of 1, which would be an ink that draws nothing at all.
    expect(at(filled(1)).glint ?? 0).toBeLessThan(0.9)
  })

  it('fills the frame as an object rather than sitting in it as a detail', () => {
    // What the lead asked for after the first look: about half the short side
    // at rest, breathing up from there.
    const across = (knobs: Record<string, number>) => {
      const params = morphParams(knobs)
      return (params.size + params.ripple) / HALF_VIEW
    }

    expect(across(settled(packetOf({ energy: 0.3 })))).toBeGreaterThan(0.4)
    expect(across(settled(filled(1), 0))).toBeGreaterThan(
      across(settled(packetOf({ energy: 0.3 }))),
    )
    expect(across(settled(filled(1), 0))).toBeLessThan(0.8)
  })

  it('bounds what it can cover on any shape of canvas', () => {
    // The disc the solid subtends, which is a ceiling twice over: a form is
    // not a disc, and the body inside the outline is held to a fifth of what
    // the edge carries, so what fills it is a haze and not a mass.
    const worst = morphParams(settled(filled(1), 0))
    for (const [width, height] of SHAPES)
      expect(morphCoverage(worst, width, height), `${width}x${height}`).toBeLessThan(0.45)

    expect(morphCoverage(worst, 2560, 1440)).toBeLessThan(0.25)
  })

  it('cuts only what is near black, and leaves the modelling', () => {
    const cut = (packet: Float32Array, tension: number) => {
      const params = morphParams(settled(packet, tension))
      const { key, rim } = morphLights(packet, params)
      return {
        level: morphGlintLevel(params, key, rim),
        // What a face square to the key light is worth, which is the
        // modelling: the thing the threshold must not carve.
        lit: luminance(key) * BODY * params.intensity * MORPH_LIGHT,
      }
    }

    for (const [packet, tension] of [
      [packetOf({ energy: 0.45, bass: 0.6 }), 0],
      [filled(1), 0],
      [filled(1), 1],
    ] as const) {
      const one = cut(packet, tension)
      expect(one.level).toBeGreaterThan(0)
      // The whole lit side passes; a solid is already sparse by having a dark
      // side, so the threshold is here for the fringe and nothing else.
      expect(one.level).toBeLessThan(one.lit * 0.6)
      expect(one.level).toBeGreaterThan(one.lit * 0.05)
    }
  })
})
