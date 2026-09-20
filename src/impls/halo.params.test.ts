/**
 * The halo's numbers: that the falloff reaches exactly zero at its edge for
 * every hollow and softness, that it is round on a wide canvas and on a tall
 * one, that the hollow moves the peak out and opens the glow into a ring, how
 * much of the frame it lights, what a still image of it settles to, and that
 * the uniform carries what the shader reads. The ink and the study have tests
 * beside them; this is the arithmetic.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { ribbonColour } from '../post/params'
import { HALO_KNOBS } from '../studies/impls'
import {
  CANVAS_FLOOR,
  CEILING_AT_FULL_PACKET,
  dipOf,
  exponentOf,
  FEEDBACK_KEEP,
  HALO_INTENSITY_MAX,
  HALO_RANGES,
  HALO_UNIFORM_FLOATS,
  haloAt,
  haloCoverage,
  haloLight,
  haloLit,
  haloParams,
  haloQuad,
  KNEE,
  MAX_EXPONENT,
  OPEN,
  SETTLE,
  settledPeak,
  writeHaloUniform,
} from './halo.params'
import type { HaloParams } from './halo.params'

const REST: HaloParams = { radius: 0.2, hollow: 0, softness: 0.6, intensity: 0.028, hue: 0 }

const STEPS = [0, 0.15, 0.3, 0.5, 0.7, 0.9]
const SOFTNESSES = [0, 0.25, 0.6, 1]

describe('the halo’s knobs', () => {
  it('has a range for every knob it offers, and no others', () => {
    expect(Object.keys(HALO_RANGES).sort()).toEqual([...HALO_KNOBS].sort())
  })

  it('clamps what a study resolved to the range, and takes a fallback for what is missing or not a number', () => {
    const wild = haloParams({ radius: 9, hollow: -1, softness: 4, intensity: 5, hue: -3 })
    expect(wild).toEqual({
      radius: HALO_RANGES.radius[1],
      hollow: 0,
      softness: 1,
      intensity: HALO_INTENSITY_MAX,
      hue: -0.5,
    })

    const bare = haloParams({ radius: Number.NaN, intensity: Number.POSITIVE_INFINITY })
    expect(bare.radius).toBe(0)
    expect(bare.intensity).toBe(0)
    expect(haloLit(haloParams({}))).toBe(false)
    expect(haloParams({ radius: -0.2, intensity: 0.02 }).radius).toBe(0)
  })

  it('draws nothing without a radius or without light, and something with both', () => {
    expect(haloLit({ ...REST, radius: 0 })).toBe(false)
    expect(haloLit({ ...REST, intensity: 0 })).toBe(false)
    expect(haloLit(REST)).toBe(true)
  })
})

describe('the falloff', () => {
  // The whole reason the quad can be no bigger than the glow: past the radius
  // there is nothing, and at it there is exactly nothing.
  it('is exactly zero at the edge and beyond it, for every hollow and every softness', () => {
    for (const hollow of STEPS)
      for (const softness of SOFTNESSES) {
        expect(haloLight(1, hollow, softness), `hollow ${hollow} softness ${softness}`).toBe(0)
        expect(haloLight(1.0000001, hollow, softness)).toBe(0)
        expect(haloLight(1.4142, hollow, softness)).toBe(0)
        expect(haloLight(50, hollow, softness)).toBe(0)
      }
  })

  it('reaches its edge without a crease: the slope dies away toward it', () => {
    // A smoothstep has no slope at 0, so what the light climbs a step in from
    // the edge, per step, shrinks as the step does. A linear edge would not.
    for (const hollow of [0, 0.5, 0.9])
      for (const softness of SOFTNESSES) {
        const slope = (step: number) => haloLight(1 - step, hollow, softness) / step
        expect(slope(0.001), `hollow ${hollow} softness ${softness}`).toBeLessThan(slope(0.01))
        expect(slope(0.0001)).toBeLessThan(slope(0.001))
      }
  })

  it('is between 0 and 1 everywhere, and strictly positive inside the edge', () => {
    for (const hollow of STEPS)
      for (const softness of SOFTNESSES)
        for (let step = 1; step < 100; step += 1) {
          const value = haloLight(step / 100, hollow, softness)
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
          // Softness 0 at the far side of a wide hollow is a very thin tail, and
          // still not zero.
          if (step / 100 > 0.005 && step < 99) expect(value).toBeGreaterThan(0)
        }
  })

  it('peaks at the middle with no hollow, and falls all the way out, at every softness', () => {
    for (const softness of SOFTNESSES) {
      expect(haloLight(0, 0, softness)).toBe(1)
      let last = 1
      for (let step = 1; step <= 100; step += 1) {
        const value = haloLight(step / 100, 0, softness)
        expect(value, `softness ${softness} at ${step / 100}`).toBeLessThanOrEqual(last + 1e-12)
        last = value
      }
    }
  })

  // Hollow moves the peak of the falloff out from the centre. The peak is 1
  // wherever it sits, so nothing about how bright the glow gets depends on it.
  it('moves the peak out to the hollow, and the peak is 1 wherever it is', () => {
    for (const hollow of [0.1, 0.3, 0.5, 0.7, 0.9])
      for (const softness of SOFTNESSES) {
        let best = 0
        let where = 0
        for (let step = 0; step <= 1000; step += 1) {
          const value = haloLight(step / 1000, hollow, softness)
          if (value > best) {
            best = value
            where = step / 1000
          }
        }

        expect(best, `hollow ${hollow} softness ${softness}`).toBeGreaterThan(0.999999)
        expect(where).toBeCloseTo(hollow, 2)
        expect(haloLight(hollow, hollow, softness)).toBeCloseTo(1, 12)
      }
  })

  it('opens into a ring: the middle is dimmed as the hollow grows and dark from `OPEN` up', () => {
    let last = 1
    for (const hollow of [0, 0.1, 0.2, 0.3, 0.4]) {
      const centre = haloLight(0, hollow, 0.6)
      expect(centre, `hollow ${hollow}`).toBeLessThanOrEqual(last)
      last = centre
    }

    expect(haloLight(0, 0.05, 0.6)).toBeGreaterThan(0.5)
    for (const hollow of [OPEN, 0.7, 0.9]) {
      expect(haloLight(0, hollow, 0.6)).toBe(0)
      expect(haloLight(hollow, hollow, 0.6)).toBeGreaterThan(0.99)
    }
  })

  it('has no jump as the hollow leaves 0: a small one is a small change', () => {
    for (const softness of SOFTNESSES)
      for (let step = 0; step <= 200; step += 1) {
        const distance = step / 200
        expect(
          Math.abs(haloLight(distance, 0.02, softness) - haloLight(distance, 0, softness)),
        ).toBeLessThan(0.06)
      }
  })

  it('takes a softer glow as broader, at every distance', () => {
    for (const hollow of [0, 0.3, 0.8])
      for (let step = 1; step < 100; step += 1) {
        const distance = step / 100
        let last = -1
        for (const softness of SOFTNESSES) {
          const value = haloLight(distance, hollow, softness)
          expect(value, `hollow ${hollow} at ${distance}`).toBeGreaterThanOrEqual(last - 1e-12)
          last = value
        }
      }
  })

  it('gives the exponent and the dip the ends the header says', () => {
    expect(exponentOf(1)).toBe(1)
    expect(exponentOf(0)).toBe(MAX_EXPONENT)
    expect(dipOf(0)).toBe(0)
    expect(dipOf(OPEN)).toBe(1)
    expect(dipOf(0.9)).toBe(1)
  })
})

describe('round on any canvas', () => {
  const SHAPES = [
    [1920, 1080],
    [1080, 1920],
    [1000, 1000],
    [3840, 1080],
  ] as const

  it('sizes the quad by the short side and centres it, so it is square', () => {
    const wide = haloQuad(REST, 1920, 1080)
    const tall = haloQuad(REST, 1080, 1920)
    expect(wide).toEqual({ x: 960, y: 540, half: 0.2 * 1080 })
    expect(tall).toEqual({ x: 540, y: 960, half: 0.2 * 1080 })
    // The same size on the same short side, whatever the long one.
    expect(haloQuad(REST, 3840, 1080).half).toBe(wide.half)
  })

  it('is the same at an equal distance across and up and down, on wide, tall and square canvases', () => {
    for (const [width, height] of SHAPES)
      for (const hollow of [0, 0.6]) {
        const params = { ...REST, hollow }
        const radius = params.radius * Math.min(width, height)
        for (const fraction of [0.1, 0.4, 0.75, 0.99]) {
          const reach = fraction * radius
          const right = haloAt(width / 2 + reach, height / 2, params, width, height)
          const left = haloAt(width / 2 - reach, height / 2, params, width, height)
          const down = haloAt(width / 2, height / 2 + reach, params, width, height)
          const up = haloAt(width / 2, height / 2 - reach, params, width, height)
          expect(left).toBeCloseTo(right, 12)
          expect(down).toBeCloseTo(right, 12)
          expect(up).toBeCloseTo(right, 12)
          expect(right, `${width}x${height} at ${fraction}`).toBeCloseTo(
            haloLight(fraction, hollow, params.softness),
            12,
          )
        }
      }
  })

  it('is zero at the radius across, and at the radius up and down, and everywhere outside the round', () => {
    for (const [width, height] of SHAPES) {
      const radius = REST.radius * Math.min(width, height)
      expect(haloAt(width / 2 + radius, height / 2, REST, width, height)).toBe(0)
      expect(haloAt(width / 2, height / 2 - radius, REST, width, height)).toBe(0)
      // The quad's corner is a radius times the square root of two out.
      expect(haloAt(width / 2 + radius, height / 2 + radius, REST, width, height)).toBe(0)
    }
  })

  it('does not light more of a wide frame than the round of it: a disc, not a stripe', () => {
    // The lit share on a wide canvas is the disc's area over the frame's, and
    // on a tall one the same disc over the same frame turned: equal.
    const wide = haloCoverage(REST, 16 / 9, 180)
    const tall = haloCoverage(REST, 9 / 16, 320)
    expect(tall).toBeCloseTo(wide, 2)
    const disc = Math.PI * 0.2 ** 2
    expect(wide).toBeLessThan(disc / (16 / 9))
  })
})

describe('how much of the frame it lights and how bright the middle can get', () => {
  it('lights under a tenth of a 16:9 frame at a radius of 0.26, the most the study reaches', () => {
    expect(haloCoverage({ ...REST, radius: 0.26, softness: 0.6 })).toBeLessThan(0.1)
    // And it is far from covering it at any radius the range allows on a tall frame's short side.
    expect(haloCoverage({ ...REST, radius: HALO_RANGES.radius[1] })).toBeLessThan(0.6)
  })

  it('sums a still image to `SETTLE` times what one frame adds over the canvas’s floor', () => {
    expect(FEEDBACK_KEEP).toBe(0.93)
    expect(SETTLE).toBeCloseTo(1 / 0.07, 9)
    // Frame by frame: keep 0.93 of the canvas, take the floor off what was
    // kept, and add one frame's light. Left out, the floor is the whole
    // difference between a glow and nothing: see `CANVAS_FLOOR`.
    let canvas = 0
    for (let frame = 0; frame < 600; frame += 1)
      canvas = Math.max(0, canvas * FEEDBACK_KEEP - CANVAS_FLOOR) + REST.intensity
    expect(canvas).toBeCloseTo(settledPeak(REST), 4)
  })

  it('settles at nothing when one frame adds no more than the floor takes off', () => {
    expect(settledPeak({ ...REST, intensity: CANVAS_FLOOR })).toBe(0)
    expect(settledPeak({ ...REST, intensity: CANVAS_FLOOR / 2 })).toBe(0)
  })

  it('settles at the knee at the top of the intensity range, which is what the range is', () => {
    const top = { ...REST, intensity: HALO_INTENSITY_MAX }
    expect(settledPeak(top)).toBeCloseTo(KNEE, 12)
    expect(KNEE).toBe(CEILING_AT_FULL_PACKET / 2)
    expect(HALO_RANGES.intensity[1]).toBe(HALO_INTENSITY_MAX)
  })
})

describe('the uniform', () => {
  const packet = new Float32Array(PACKET_LENGTH)
  packet[F.keyHue] = 0.3

  const write = (params: HaloParams, width = 1920, height = 1080) =>
    writeHaloUniform(params, packet, width, height, new Float32Array(HALO_UNIFORM_FLOATS))

  it('is twelve floats, three vec4s', () => {
    expect(HALO_UNIFORM_FLOATS).toBe(12)
    expect(write(REST)).toHaveLength(12)
  })

  it('carries the canvas, the radius in pixels, the peak, the dip and the exponent', () => {
    const out = write({ ...REST, hollow: 0.3, softness: 0.25 }, 1080, 1920)
    expect([out[0], out[1]]).toEqual([1080, 1920])
    expect(out[2]).toBeCloseTo(0.2 * 1080, 4)
    expect(out[4]).toBeCloseTo(0.3, 6)
    expect(out[5]).toBeCloseTo(dipOf(0.3), 6)
    expect(out[6]).toBeCloseTo(exponentOf(0.25), 6)
    expect([out[3], out[7], out[11]]).toEqual([0, 0, 0])
  })

  it('carries the ribbon’s colour at the key, times the intensity, and the hue moves it along the palette', () => {
    const plain = write(REST)
    const [red, green, blue] = ribbonColour(packet, 0)
    expect(plain[8]).toBeCloseTo(red * REST.intensity, 6)
    expect(plain[9]).toBeCloseTo(green * REST.intensity, 6)
    expect(plain[10]).toBeCloseTo(blue * REST.intensity, 6)

    const shifted = write({ ...REST, hue: 0.25 })
    const [sr, sg, sb] = ribbonColour(packet, 0.25)
    expect(shifted[8]).toBeCloseTo(sr * REST.intensity, 6)
    expect(shifted[9]).toBeCloseTo(sg * REST.intensity, 6)
    expect(shifted[10]).toBeCloseTo(sb * REST.intensity, 6)
    expect([shifted[8], shifted[9], shifted[10]]).not.toEqual([plain[8], plain[9], plain[10]])
  })

  it('never carries a channel above the intensity, since the palette is scaled so its brightest is 1', () => {
    for (let key = 0; key < 20; key += 1) {
      packet[F.keyHue] = key / 20
      const out = write(REST)
      expect(Math.max(out[8] ?? 0, out[9] ?? 0, out[10] ?? 0)).toBeLessThanOrEqual(
        REST.intensity + 1e-6,
      )
    }
  })
})
