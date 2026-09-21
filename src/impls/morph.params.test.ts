/**
 * The shape morph's numbers: the knobs, the run of forms, the melt, the
 * threshold and the coverage. All of it is pure, so all of it is held here
 * rather than by looking at the picture, and the parts that decide what is on
 * screen (which form a section gets, how long a melt takes, what a drop does)
 * are held to being the same at any frame rate and the same twice for one
 * song.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { hueGap, srgbToOklch } from '../colour/oklch'
import type { Rgb } from '../colour/oklch'
import { paletteAt } from '../palettes/active'
import { RIBBON_TINT } from '../post/params'
import {
  BODY,
  FOV,
  FORMS,
  HALF_VIEW,
  luminance,
  MARCH_STEPS,
  MELT_SECONDS,
  MORPH_LIGHT,
  MORPH_RANGES,
  MORPH_UNIFORM_FLOATS,
  morphCoverage,
  morphGate,
  morphGlintLevel,
  morphHash,
  morphLights,
  morphLit,
  morphParams,
  morphPeak,
  MorphShape,
  morphSteps,
  nextForm,
  RIM_BASE,
  RIM_TURN_DEGREES,
  RIM_WRAP,
  RIPPLE_CEILING,
  SILENT_FLOOR,
  SOFTWARE_STEPS,
  writeMorphUniform,
} from './morph.params'
import type { MorphKnob, MorphParams } from './morph.params'

/** What the study rests at, which is what a quiet groove resolves near. */
const REST = {
  size: 0.55,
  ripple: 0.012,
  rippleScale: 9,
  spin: 0,
  tumble: 0,
  rim: 0.35,
  specular: 1.4,
  hue: 0,
  intensity: 0.06,
  glint: 0.4,
  glintKnee: 0.45,
}

const packetAt = (energy: number, section = 1) => {
  const out = new Float32Array(PACKET_LENGTH)
  out[F.energy] = energy
  out[F.section] = section
  return out
}

const LOUD = packetAt(1)
const SILENT = packetAt(0)

describe('the knobs', () => {
  it('takes what a study resolved and holds every one to its range', () => {
    const params = morphParams(REST)
    for (const knob of Object.keys(MORPH_RANGES) as MorphKnob[])
      expect(params[knob], knob).toBe(REST[knob])
    const wild = morphParams({ size: 90, specular: -4, rippleScale: 0, intensity: 12 })
    expect(wild.size).toBe(MORPH_RANGES.size[1])
    expect(wild.specular).toBe(MORPH_RANGES.specular[0])
    expect(wild.rippleScale).toBe(MORPH_RANGES.rippleScale[0])
    expect(wild.intensity).toBe(MORPH_RANGES.intensity[1])
  })

  it('falls back to no light at all when nothing resolved a knob', () => {
    expect(morphParams({}).intensity).toBe(0)
    expect(morphParams({ intensity: Number.NaN }).intensity).toBe(0)
    expect(morphParams({ size: Number.NaN }).size).toBe(0.5)
  })

  it('holds the ripple against its frequency, so the march can still bound it', () => {
    for (const rippleScale of [2, 6, 9, 14]) {
      const params = morphParams({ ...REST, ripple: MORPH_RANGES.ripple[1], rippleScale })
      expect(params.ripple * params.rippleScale).toBeLessThanOrEqual(RIPPLE_CEILING + 1e-12)
    }

    // A ripple already under the ceiling is left exactly where it was.
    expect(morphParams({ ...REST, ripple: 0.01, rippleScale: 9 }).ripple).toBe(0.01)
  })
})

describe('the silence gate', () => {
  it('draws nothing at all on a silent packet', () => {
    expect(morphGate(SILENT)).toBe(0)
    expect(morphLit(morphParams(REST), SILENT)).toBe(false)
    expect(morphLit(morphParams(REST), packetAt(SILENT_FLOOR * 0.9))).toBe(false)
  })

  it('fades in over the floor rather than switching on', () => {
    const quiet = morphGate(packetAt(0.01))
    expect(quiet).toBeGreaterThan(0)
    expect(quiet).toBeLessThan(1)
    expect(morphGate(packetAt(0.02))).toBeGreaterThan(quiet)
    expect(morphGate(packetAt(0.2))).toBe(1)
    expect(morphGate(LOUD)).toBe(1)
  })

  it('draws nothing with no light, and always has a size to draw', () => {
    expect(morphLit(morphParams({ ...REST, intensity: 0 }), LOUD)).toBe(false)
    expect(morphLit(morphParams(REST), LOUD)).toBe(true)
    // A study cannot ask for a solid too small to see; it takes its light off.
    expect(morphParams({ ...REST, size: 0 }).size).toBe(MORPH_RANGES.size[0])
  })

  it('takes a packet that is not a number as silence', () => {
    const broken = packetAt(Number.NaN)
    expect(morphGate(broken)).toBe(0)
    expect(morphLit(morphParams(REST), broken)).toBe(false)
  })
})

describe('the run of forms', () => {
  it('is a hash and never a random number, so one song gives one run', () => {
    for (const seed of [0, 1, 17, 4096, -3]) {
      expect(morphHash(seed)).toBe(morphHash(seed))
      expect(morphHash(seed)).toBeGreaterThanOrEqual(0)
      expect(morphHash(seed)).toBeLessThan(1)
    }

    expect(morphHash(1)).not.toBe(morphHash(2))
  })

  it('never picks the form already showing, and can pick any of the others', () => {
    for (let avoid = 0; avoid < FORMS.length; avoid += 1) {
      const seen = new Set<number>()
      for (let seed = 0; seed < 400; seed += 1) {
        const pick = nextForm(seed, avoid)
        expect(pick).not.toBe(avoid)
        expect(pick).toBeGreaterThanOrEqual(0)
        expect(pick).toBeLessThan(FORMS.length)
        seen.add(pick)
      }

      expect(seen.size).toBe(FORMS.length - 1)
    }
  })

  it('may pick any form at all when there is nothing on screen to avoid', () => {
    const seen = new Set<number>()
    for (let seed = 0; seed < 400; seed += 1) seen.add(nextForm(seed, -1))
    expect(seen.size).toBe(FORMS.length)
  })
})

describe('the melt', () => {
  let shape: MorphShape

  const run = (seconds: number, dt: number, packet: Float32Array) => {
    for (let at = 0; at < Math.round(seconds / dt); at += 1) shape.step(packet, dt)
  }

  beforeEach(() => {
    shape = new MorphShape()
  })

  it('opens on one form, with nothing to melt from', () => {
    shape.step(packetAt(1, 3), 1 / 60)
    expect(shape.blend).toBe(1)
    expect(shape.leaving).toBe(shape.arriving)
    expect(shape.detail).toBe(FORMS[shape.arriving])
  })

  it('starts a melt at a section boundary, and lands on the new form', () => {
    shape.step(packetAt(1, 1), 1 / 60)
    const first = shape.arriving
    shape.step(packetAt(1, 2), 1 / 60)
    expect(shape.leaving).toBe(first)
    expect(shape.arriving).not.toBe(first)
    expect(shape.blend).toBeLessThan(0.05)
    run(MELT_SECONDS, 1 / 60, packetAt(1, 2))
    expect(shape.blend).toBe(1)
    expect(shape.detail).toBe(FORMS[shape.arriving])
  })

  it('takes the same seconds at any frame rate, and shows the same solid on the way', () => {
    const half: number[] = []
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      const one = new MorphShape()
      one.step(packetAt(1, 1), dt)
      one.step(packetAt(1, 2), dt)
      for (let at = 0; at < Math.round(MELT_SECONDS / 2 / dt); at += 1) one.step(packetAt(1, 2), dt)
      half.push(one.blend)
      expect(one.leaving).toBe(shapeAt(dt).leaving)
      expect(one.arriving).toBe(shapeAt(dt).arriving)
    }

    // Inside one step of the slowest frame rate, which is all a melt stepped
    // by the real `dt` can promise.
    for (const blend of half)
      expect(Math.abs(blend - (half[0] ?? 0))).toBeLessThan(1 / 30 / MELT_SECONDS)
    expect(half[0]).toBeCloseTo(0.5, 1)
  })

  it('cuts on a drop rather than melting, once per drop', () => {
    shape.step(packetAt(1, 1), 1 / 60)
    const before = shape.arriving
    const drop = packetAt(1, 1)
    drop[F.impact] = 1
    shape.step(drop, 1 / 60)
    expect(shape.blend).toBe(1)
    expect(shape.arriving).not.toBe(before)
    expect(shape.leaving).toBe(shape.arriving)

    // `impact` decays rather than ending, and one drop is one cut: it rearms
    // only once the row has fallen well back.
    const after = shape.arriving
    for (const level of [0.9, 0.7, 0.55, 0.5]) {
      const falling = packetAt(1, 1)
      falling[F.impact] = level
      shape.step(falling, 1 / 60)
    }

    expect(shape.arriving).toBe(after)
    shape.step(packetAt(1, 1), 1 / 60)
    const again = packetAt(1, 1)
    again[F.impact] = 1
    shape.step(again, 1 / 60)
    expect(shape.arriving).not.toBe(after)
  })

  it('keeps its own clock, which runs while the ink is drawn', () => {
    run(2, 1 / 60, packetAt(1, 1))
    expect(shape.clock).toBeCloseTo(2, 2)
    // A frame the tab was hidden for is one step and not a minute.
    shape.step(packetAt(1, 1), 60)
    expect(shape.clock).toBeCloseTo(2.1, 2)
  })

  it('prints the melt for the overlay while one is running', () => {
    shape.step(packetAt(1, 1), 1 / 60)
    shape.step(packetAt(1, 2), 1 / 60)
    run(MELT_SECONDS / 2, 1 / 60, packetAt(1, 2))
    expect(shape.detail).toMatch(/ to /)
    expect(shape.detail).toMatch(/\d+%/)
  })
})

/** The same shape stepped to the same place, for the frame-rate test above. */
function shapeAt(dt: number): MorphShape {
  const one = new MorphShape()
  one.step(packetAt(1, 1), dt)
  one.step(packetAt(1, 2), dt)
  return one
}

describe('the light and its threshold', () => {
  const { key, rim } = morphLights(LOUD, morphParams(REST))

  it('takes its hue from the palette at the key, and puts the rim a third of the circle on', () => {
    const hueOf = (colour: Rgb) => srgbToOklch(colour).h
    expect(hueOf(key)).toBeCloseTo(srgbToOklch(paletteAt(RIBBON_TINT)).h, 0)
    expect(Math.abs(hueGap(hueOf(key), hueOf(rim)))).toBeCloseTo(RIM_TURN_DEGREES, 0)
  })

  it('lights rather than tints: both are saturated, whatever the palette is like', () => {
    for (const colour of [key, rim]) {
      // The brightest channel is 1, as every other ink's colour is.
      expect(Math.max(...colour)).toBeCloseTo(1, 6)
      // And the dimmest is well under it, which a pastel's would not be.
      expect(Math.min(...colour)).toBeLessThan(0.5)
      expect(srgbToOklch(colour).c).toBeGreaterThan(0.1)
    }
  })

  it('turns both with the key, keeping the gap between them', () => {
    const packet = packetAt(1)
    packet[F.keyHue] = 0.3
    const params = morphParams(REST)
    const turned = morphLights(packet, params)
    const hueOf = (colour: Rgb) => srgbToOklch(colour).h
    expect(hueOf(turned.key)).not.toBeCloseTo(hueOf(key), 1)
    expect(Math.abs(hueGap(hueOf(turned.key), hueOf(turned.rim)))).toBeCloseTo(
      RIM_TURN_DEGREES,
      0,
    )
  })

  it('has a peak that counts every light and rises with each of them', () => {
    const rest = morphPeak(morphParams(REST), key, rim)
    expect(rest).toBeGreaterThan(0)
    expect(morphPeak(morphParams({ ...REST, rim: 0.9 }), key, rim)).toBeGreaterThan(rest)
    expect(morphPeak(morphParams({ ...REST, specular: 2 }), key, rim)).toBeGreaterThan(rest)
    expect(morphPeak(morphParams({ ...REST, intensity: 0.03 }), key, rim)).toBeLessThan(rest)
    expect(morphPeak(morphParams({ ...REST, intensity: 0 }), key, rim)).toBe(0)
  })

  it('lets the whole lit side through and takes only what is near black', () => {
    const params = morphParams(REST)
    const level = morphGlintLevel(params, key, rim)
    expect(level).toBeGreaterThan(0)
    // A face square to the key light is the modelling, and all of it passes:
    // a solid is already sparse by having a dark side, so the threshold is
    // here to keep the near-black fill out of the canvas's memory and not to
    // carve the form.
    const litFace = luminance(key) * BODY * params.intensity * MORPH_LIGHT
    expect(level).toBeLessThan(litFace * 0.5)
    // What it does take is the fringe: a twentieth of a lit face is cut.
    expect(litFace * 0.05).toBeLessThan(level)
  })

  it('holds the body well under the edge, so the canvas keeps an outline', () => {
    const params = morphParams(REST)
    const body = luminance(key) * BODY * params.intensity * MORPH_LIGHT
    const edge = (RIM_WRAP + RIM_BASE + params.rim) * luminance(rim) * params.intensity * MORPH_LIGHT
    expect(edge).toBeGreaterThan(body * 5)
  })

  it('cuts harder as the music fills the canvas', () => {
    const params = morphParams(REST)
    const loud = morphParams({ ...REST, glint: 0.85 })
    expect(morphGlintLevel(loud, key, rim)).toBeGreaterThan(morphGlintLevel(params, key, rim))
  })

  it('is off, exactly, when the knob is', () => {
    expect(morphGlintLevel(morphParams({ ...REST, glint: 0 }), key, rim)).toBe(0)
    expect(morphGlintLevel(morphParams({ ...REST, glint: 1e-9 }), key, rim)).toBe(0)
  })
})

describe('what it covers', () => {
  it('fills a good share of the short side, which is what makes it an object', () => {
    // The point of the camera: a solid at the resting size is about half the
    // short side across, not a detail in an empty frame.
    const across = (params: MorphParams) => (params.size + params.ripple) / HALF_VIEW
    expect(across(morphParams(REST))).toBeGreaterThan(0.4)
    expect(across(morphParams(REST))).toBeLessThan(0.6)
    // And the disc that subtends is a fifth of a 16:9 frame at the largest
    // the mapping reaches, which is a bound and not what is lit: the body is
    // held under the edge, so what fills it is a haze and the edge is the
    // bright part.
    const largest = morphParams({ ...REST, size: 0.76, ripple: 0.031, rippleScale: 9 })
    expect(morphCoverage(largest, 2560, 1440)).toBeLessThan(0.25)
    expect(morphCoverage(morphParams(REST), 2560, 1440)).toBeLessThan(0.15)
  })

  it('is the same share on a canvas of the same shape, and the same solid on any shape', () => {
    const params = morphParams(REST)
    const wide = morphCoverage(params, 2560, 1440)
    for (const [width, height] of [
      [3840, 2160],
      [1280, 720],
      [1920, 1080],
    ])
      expect(morphCoverage(params, width ?? 1, height ?? 1)).toBeCloseTo(wide, 4)

    // The field of view is across the short side, so a wide canvas and a tall
    // one hold the same solid and a square is the worst case of the three.
    expect(morphCoverage(params, 1080, 1920)).toBeCloseTo(wide, 4)
    expect(morphCoverage(params, 1440, 1440)).toBeGreaterThan(wide)
    expect(morphCoverage(params, 1440, 1440)).toBeLessThan(0.35)
  })

  it('grows with the solid, and is nothing on a canvas with no area', () => {
    const params = morphParams(REST)
    expect(morphCoverage(morphParams({ ...REST, size: 0.9 }), 2560, 1440)).toBeGreaterThan(
      morphCoverage(params, 2560, 1440),
    )

    expect(morphCoverage(params, 0, 0)).toBe(0)
    expect(morphCoverage(params, 2560, -1)).toBe(0)
  })

  it('measures against what the camera sees, which nothing moves', () => {
    expect(HALF_VIEW).toBeCloseTo(3.8 * Math.tan(FOV / 2), 10)
    // A short telephoto: the solid fills the frame and the perspective is flat.
    expect(FOV).toBeLessThan(0.7)
  })
})

describe('the uniform', () => {
  const out = new Float32Array(MORPH_UNIFORM_FLOATS)

  it('lays every number where the shader reads it', () => {
    const shape = new MorphShape()
    const packet = packetAt(1, 1)
    packet[F.keyHue] = 0.2
    shape.step(packet, 1 / 60)
    shape.step(packetAt(1, 2), 1 / 60)
    const params = morphParams({ ...REST, spin: 0.3, tumble: 0.1 })
    writeMorphUniform(params, shape, packet, 1280, 720, MARCH_STEPS, out)
    expect([out[0], out[1]]).toEqual([1280, 720])
    expect(out[2]).toBeCloseTo(1280 / 720, 6)
    expect(out[3]).toBeCloseTo(shape.clock, 6)
    expect([out[4], out[5]]).toEqual([0, 0])
    expect(out[6]).toBeCloseTo(-3.8, 6)
    expect(out[7]).toBeCloseTo(FOV, 6)
    expect(out[8]).toBe(shape.leaving)
    expect(out[9]).toBe(shape.arriving)
    // The melt is smoothed here, so what the surface is at is what a test reads.
    expect(out[10]).toBeCloseTo(shape.blend * shape.blend * (3 - 2 * shape.blend), 6)
    expect(out[11]).toBeCloseTo(params.size, 6)
    expect(out[12]).toBeCloseTo(0.3, 6)
    expect(out[13]).toBeCloseTo(0.1, 6)
    expect(out[14]).toBeCloseTo(params.ripple, 6)
    expect(out[15]).toBeCloseTo(params.rippleScale, 6)
    expect(out[16]).toBeCloseTo(params.rim, 6)
    expect(out[17]).toBeCloseTo(params.specular, 6)
    expect(out[18]).toBeCloseTo(params.intensity, 6)
    expect(out[23]).toBeCloseTo(params.glintKnee, 6)
    const { key, rim } = morphLights(packet, params)
    for (let at = 0; at < 3; at += 1) {
      expect(out[20 + at]).toBeCloseTo(key[at] ?? 0, 6)
      expect(out[24 + at]).toBeCloseTo(rim[at] ?? 0, 6)
    }
    expect(out[27]).toBe(MARCH_STEPS)
  })

  it('carries the gate in the light, so a packet fading in fades the solid in', () => {
    const shape = new MorphShape()
    const params = morphParams(REST)
    writeMorphUniform(params, shape, packetAt(0.012), 1280, 720, MARCH_STEPS, out)
    const gated = out[18] ?? 0
    expect(gated).toBeGreaterThan(0)
    expect(gated).toBeLessThan(params.intensity)
    // And the threshold follows the light down with it, so a solid fading in
    // is not cut to nothing on the way.
    writeMorphUniform(params, shape, LOUD, 1280, 720, MARCH_STEPS, out)
    expect(out[19]).toBeGreaterThan(0)
    writeMorphUniform(params, shape, packetAt(0.012), 1280, 720, MARCH_STEPS, out)
    expect(out[19]).toBeLessThan(
      morphGlintLevel(params, morphLights(LOUD, params).key, morphLights(LOUD, params).rim),
    )
  })

  it('never writes a size of nothing, whatever the canvas is doing', () => {
    writeMorphUniform(morphParams(REST), new MorphShape(), LOUD, 0, 0, MARCH_STEPS, out)
    expect(out[0]).toBe(1)
    expect(out[1]).toBe(1)
    expect(out[2]).toBe(1)
  })

  it('gives a software rasteriser a budget it can run', () => {
    expect(morphSteps(true)).toBe(SOFTWARE_STEPS)
    expect(morphSteps(false)).toBe(MARCH_STEPS)
    expect(SOFTWARE_STEPS).toBeLessThan(MARCH_STEPS)
  })
})
