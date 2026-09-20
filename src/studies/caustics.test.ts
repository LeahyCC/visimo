/**
 * The caustics as a study: where it lives in the character space, that a
 * silent packet through its whole path draws nothing while a quiet tonal one
 * does, what the music and tension do to it, that it stays sparse and the
 * canvas cannot fill at the most its own mapping reaches, and that the same
 * song draws the same light at any frame rate. The pattern and the ink have
 * their own tests beside them; the generic bar every study meets is
 * `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness } from '../director/score'
import { HARDSTYLE, HOUSE, LOFI } from '../director/song.fixture'
import {
  advanceClock,
  causticLine,
  CAUSTICS_RANGES,
  CAUSTICS_UNIFORM_FLOATS,
  causticsLit,
  causticsParams,
  MEAN_BUDGET,
  sampleCaustics,
  settledMean,
  wavePhases,
  writeCausticsUniform,
} from '../impls/caustics.params'
import type { CausticsClock } from '../impls/caustics.params'
import { ribbonColour } from '../post/params'
import { CAUSTICS_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { resolveStudy } from './resolve'

const study = findStudy('caustics')
if (!study) throw new Error('Expected the caustics study')

/** A packet with the fields the caustics read set and everything else at nothing. */
const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

/** What a tonal, quiet passage is: a key heard clearly, and not much sound. */
const TONAL = { energy: 0.15, keyClarity: 0.8 } as const

describe('the caustics study', () => {
  it('is the ink for the quiet end and for nothing else', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('caustics')
    expect(study.moments).toEqual({ intro: 1, groove: 0, build: 0, drop: 0, rest: 1, outro: 1 })
    // Measured at 0.07 ms a pass at 2560 by 1440, so it is booked as cheap.
    expect(study.cost).toBe('cheap')
  })

  it('offers exactly the implementation’s knobs and rests at a light that only a key brings in', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...CAUSTICS_KNOBS].sort())
    expect(study.knobs.intensity).toBeGreaterThan(0)
    expect(study.knobs.sharpness).toBeGreaterThan(CAUSTICS_RANGES.sharpness[0])
  })

  it('reads as the caustics when it is the only ink, on the canvas’s own line', () => {
    expect(sceneOf(['caustics'])).toBe('caustics')
  })

  // The catalogue says soft and tonal. The three tracks are the ones the
  // director's own tests play.
  it('is in the soft, tonal, slow corner: a lo-fi track is at home, a house one is a stretch and a hardstyle one is out of reach', () => {
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

  // A silent packet has to draw nothing, and the intensity is what says so: it
  // is the one knob that draws, and at nothing there is no pass.
  it('resolves a silent packet to no light, and draws nothing, at any tension', () => {
    for (const tension of [0, 0.5, 1]) {
      const params = causticsParams(at(silent, tension))
      expect(params.intensity).toBe(0)
      expect(causticsLit(params)).toBe(false)
    }
  })

  it('draws for a quiet tonal passage, with a light worth having', () => {
    const params = causticsParams(at(packetOf(TONAL)))
    expect(causticsLit(params)).toBe(true)
    // Most of what it rests at: a quiet passage is where it is meant to show.
    expect(params.intensity).toBeGreaterThan((study.knobs.intensity ?? 0) * 0.6)
  })

  // It is a tonal study, and the light is the key's: the clarity is what is
  // heard and not the sound.
  it('is brought in by keyClarity, and a passage with no key in it draws nothing however loud', () => {
    const levels = [0, 0.25, 0.5, 0.75, 1].map(
      (keyClarity) => at(packetOf({ energy: 0.15, keyClarity })).intensity ?? -1,
    )
    expect(levels[0]).toBeCloseTo(0, 2)
    for (let step = 1; step < levels.length; step += 1)
      expect(levels[step]).toBeGreaterThan(levels[step - 1] ?? 0)
    // Drums alone: loud, and no key heard.
    expect(causticsLit(causticsParams(at(packetOf({ energy: 0.8, keyClarity: 0 }))))).toBe(false)
  })

  // The energy and hardness dims meet a gate that is already shut on drums with
  // no key in them, and resolve a little under zero. The ink holds it at 0.
  it('holds a light that resolves under zero at nothing, and draws nothing for it', () => {
    for (const fields of [
      {},
      { energy: 1 },
      { energy: 1, hardness: 1 },
      { hardness: 1, swell: 1 },
    ]) {
      const params = causticsParams(at(packetOf(fields)))
      expect(params.intensity).toBe(0)
      expect(causticsLit(params)).toBe(false)
    }

    expect(at(packetOf({ energy: 1 })).intensity ?? 0).toBeLessThan(0)
  })
})

describe('what the music does to the caustics', () => {
  it('gets sparser and dimmer as the music fills the frame, and never brighter', () => {
    const rest = study.knobs.intensity ?? 0
    const quiet = at(packetOf({ ...TONAL, energy: 0.1 }))
    const full = at(packetOf({ energy: 1, keyClarity: 1, swell: 1, hardness: 1 }))
    expect(quiet.intensity ?? 0).toBeLessThanOrEqual(rest)
    expect(full.intensity ?? 0).toBeLessThan(rest * 0.7)
    expect(full.intensity ?? 0).toBeGreaterThan(0)
    // The lines thin, which is the answer to more sound: fewer of them, not brighter ones.
    expect(full.sharpness ?? 0).toBeGreaterThan((quiet.sharpness ?? 0) + 3)
    expect(full.sharpness ?? 0).toBeLessThanOrEqual(CAUSTICS_RANGES.sharpness[1])
  })

  it('raises the sharpness with the energy, at every step', () => {
    const levels = [0, 0.25, 0.5, 0.75, 1].map(
      (energy) => at(packetOf({ energy, keyClarity: 0.8 })).sharpness ?? 0,
    )
    for (let step = 1; step < levels.length; step += 1)
      expect(levels[step]).toBeGreaterThan(levels[step - 1] ?? 0)
  })

  it('lifts the speed with the swell, so a lifting passage drifts faster than a falling one', () => {
    const falling = at(packetOf({ ...TONAL, swell: 0 })).speed ?? 0
    const steady = at(packetOf({ ...TONAL, swell: 0.5 })).speed ?? 0
    const lifting = at(packetOf({ ...TONAL, swell: 1 })).speed ?? 0
    expect(steady).toBeGreaterThan(falling)
    expect(lifting).toBeGreaterThan(steady)
    // Soft all the way: even at the top, no faster than the range.
    expect(lifting).toBeLessThanOrEqual(CAUSTICS_RANGES.speed[1])
    expect(falling).toBeGreaterThan(0)
  })

  it('takes its colour from the ribbon’s palette at the key, scattered by the spread', () => {
    const packet = packetOf({ ...TONAL, keyHue: 0.3 })
    const params = causticsParams(at(packet))
    const out = writeCausticsUniform(
      params,
      { phase: 0, seconds: 0 },
      packet,
      1920,
      1080,
      new Float32Array(CAUSTICS_UNIFORM_FLOATS),
    )
    const [red, green, blue] = ribbonColour(packet, 0)
    expect(out[36]).toBeCloseTo(red * params.intensity, 6)
    expect(out[37]).toBeCloseTo(green * params.intensity, 6)
    expect(out[38]).toBeCloseTo(blue * params.intensity, 6)
  })
})

describe('what tension does to the caustics', () => {
  const packet = packetOf(TONAL)

  it('dims it: the lines thin as tension climbs, at every step', () => {
    const levels = [0, 0.25, 0.5, 0.75, 1].map((tension) => at(packet, tension).sharpness ?? 0)
    for (let step = 1; step < levels.length; step += 1)
      expect(levels[step]).toBeGreaterThan(levels[step - 1] ?? 0)
    expect((levels[4] ?? 0) - (levels[0] ?? 0)).toBeCloseTo(6, 9)
  })

  it('is less light for it, on the canvas: the settled mean and the lit share both fall', () => {
    const calm = causticsParams(at(packet, 0))
    const wound = causticsParams(at(packet, 1))
    expect(wound.intensity).toBe(calm.intensity)
    expect(settledMean(wound)).toBeLessThan(settledMean(calm))
    expect(sampleCaustics(wound.scale, wound.sharpness).coverage).toBeLessThan(
      sampleCaustics(calm.scale, calm.sharpness).coverage,
    )
  })

  it('changes only the sharpness, since anything on the intensity would go below zero on a silent build', () => {
    const calm = at(packet, 0)
    const wound = at(packet, 1)
    for (const knob of CAUSTICS_KNOBS) {
      if (knob === 'sharpness') continue
      expect(wound[knob], knob).toBe(calm[knob])
    }

    // And a silent build still resolves to no light.
    expect(at(packetOf(), 1).intensity).toBe(0)
  })
})

// The heart of it. A caustic is a pattern over the whole frame, and the canvas
// keeps 93 percent of itself, so what is asked here is how much of the frame is
// lit and what the frame's mean can settle at, at rest and at a full packet and
// at the worst the study's own mapping reaches.
describe('how much of the frame it lights and how bright the canvas can get', () => {
  const rest = () => causticsParams(study.knobs)
  const full = () =>
    causticsParams(at(packetOf({ energy: 1, keyClarity: 1, swell: 1, hardness: 1 }), 1))

  it('lights under a fifth of the frame at rest, and about a tenth', () => {
    const { coverage } = sampleCaustics(rest().scale, rest().sharpness)
    expect(coverage).toBeLessThan(1 / 5)
    expect(coverage).toBeLessThan(0.11)
    expect(coverage).toBeGreaterThan(0.05)
  })

  it('lights under a fifth of the frame at a full packet, and less than at rest', () => {
    const { coverage } = sampleCaustics(full().scale, full().sharpness)
    expect(coverage).toBeLessThan(1 / 5)
    expect(coverage).toBeLessThan(sampleCaustics(rest().scale, rest().sharpness).coverage)
  })

  it('keeps the canvas’s settled mean under budget at rest and lower at a full packet', () => {
    const calm = settledMean(rest())
    expect(calm).toBeGreaterThan(0.05)
    expect(calm).toBeLessThan(MEAN_BUDGET)
    expect(settledMean(full())).toBeLessThan(calm / 2)
  })

  // Whatever the mapping does, the most light and the widest lines it can
  // reach together are the resting intensity at the lowest sharpness any packet
  // takes it to; the mean only falls with sharpness and the coverage too.
  it('holds under the budget at the worst corner of everything the mapping reaches', () => {
    let brightest = 0
    let mildest = Infinity
    const steps = [0, 0.25, 0.5, 0.75, 1]
    for (const energy of steps)
      for (const keyClarity of steps)
        for (const swell of [0, 0.5, 1])
          for (const hardness of [0, 0.5, 1])
            for (const tension of [0, 1]) {
              const params = causticsParams(
                at(packetOf({ energy, keyClarity, swell, hardness }), tension),
              )
              brightest = Math.max(brightest, params.intensity)
              mildest = Math.min(mildest, params.sharpness)
            }

    // The brightest is the rest value: no packet takes the light above it.
    expect(brightest).toBeLessThanOrEqual((study.knobs.intensity ?? 0) + 1e-9)
    expect(mildest).toBeGreaterThanOrEqual(study.knobs.sharpness ?? 0)
    const worst = causticsParams({ ...study.knobs, intensity: brightest, sharpness: mildest })
    expect(settledMean(worst)).toBeLessThan(MEAN_BUDGET)
    expect(sampleCaustics(worst.scale, worst.sharpness).coverage).toBeLessThan(1 / 5)
  })
})

describe('the same at any frame rate', () => {
  // The whole path a frame takes: resolve the study, step the clocks, place
  // the waves. A frame rate is only a number of steps, so after the same
  // seconds the same picture is drawn.
  it('draws the same light after the same seconds at 30, 60, 144 and 240 frames a second', () => {
    const packet = packetOf({ ...TONAL, swell: 0.7, keyHue: 0.2 })
    const drawn = (fps: number) => {
      const clock: CausticsClock = { phase: 0, seconds: 0 }
      const params = causticsParams(at(packet, 0.4))
      for (let frame = 0; frame < fps * 4; frame += 1) advanceClock(clock, params.speed, 1 / fps)
      const offsets = [0, 0, 0, 0]
      wavePhases(clock.phase, offsets)
      const line = Array.from({ length: 120 }, (_, index) =>
        causticLine(
          Math.sin(index * 1.3) * 0.8,
          Math.cos(index * 0.7) * 0.5,
          params.scale,
          params.sharpness,
          offsets,
          1 / 1080,
        ),
      )
      return { clock, line }
    }

    const reference = drawn(60)
    expect(reference.line.some((value) => value > 0.2)).toBe(true)
    for (const fps of [30, 144, 240]) {
      const other = drawn(fps)
      expect(other.clock.phase).toBeCloseTo(reference.clock.phase, 9)
      other.line.forEach((value, index) =>
        expect(value).toBeCloseTo(reference.line[index] ?? Number.NaN, 5),
      )
    }
  })
})
