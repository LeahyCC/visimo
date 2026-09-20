/**
 * The analytic flow's maths, which is all of the flow that is not moving
 * bytes into a buffer: the velocity at a point, the aspect handling under it,
 * and the uniform the shader reads. The pass itself needs a browser, so what
 * is proved here is what the shader is a transcription of.
 */
import { describe, expect, it } from 'vitest'

import { visibleExtent } from '../scenes/fluid.params'
import {
  ANALYTIC_DEFAULTS,
  ANALYTIC_RANGES,
  ANALYTIC_UNIFORM_FLOATS,
  analyticField,
  analyticVelocity,
  fieldCover,
  fieldMoves,
  radialPeak,
  radialProfile,
  referenceRadius,
  writeAnalyticUniform,
} from './analytic.params'
import type { AnalyticField } from './analytic.params'

const WIDE = visibleExtent(2560, 1440)
const TALL = visibleExtent(1440, 2560)
const SQUARE = visibleExtent(1000, 1000)

/** A field with nothing in it but the frame, for a test to set one term on. */
const still = (extent = WIDE): AnalyticField => analyticField({}, 1, extent)

const length = (v: readonly [number, number]) => Math.hypot(v[0], v[1])

/**
 * A canvas uv taken into field uv the way the feedback pass takes it:
 * `(uv - 0.5) * cover + 0.5`. Every test that talks about the canvas goes
 * through this, so nothing here can quietly assume the field is the canvas.
 */
const onField = (uv: readonly [number, number], extent = WIDE): [number, number] => {
  const cover = fieldCover(extent)
  return [(uv[0] - 0.5) * cover[0] + 0.5, (uv[1] - 0.5) * cover[1] + 0.5]
}

describe('the radial profile', () => {
  it('is zero at the centre, so the direction never jumps', () => {
    for (const falloff of [0, 1, 2, 4, 8]) expect(radialProfile(0, falloff)).toBe(0)
  })

  it('peaks at exactly 1 inside the canvas, whatever the shape', () => {
    for (const falloff of [0, 0.5, 1, 2, 4, 8]) {
      let peak = 0
      for (let step = 0; step <= 1000; step += 1)
        peak = Math.max(peak, radialProfile(step / 1000, falloff))
      expect(peak, `falloff ${falloff}`).toBeCloseTo(1, 4)
    }
  })

  // The two halves of `radialPeak` meet at 1, so a study driving the falloff
  // across it does not step.
  it('joins its two halves smoothly at a falloff of 1', () => {
    expect(radialPeak(1)).toBeCloseTo(1 / Math.E, 12)
    // A step would show as a jolt when a study drives the falloff through 1.
    // What is left is the slope, which over a gap this small is tiny.
    expect(Math.abs(radialProfile(0.7, 0.999) - radialProfile(0.7, 1.001))).toBeLessThan(1e-3)
  })

  it('grows with the radius at a falloff of 0, which is a plain zoom', () => {
    for (const t of [0.1, 0.4, 0.9]) expect(radialProfile(t, 0)).toBeCloseTo(t, 12)
  })

  // What makes a burst read as a burst: the fastest ring is `1 / falloff` of
  // the way out and the rim is left standing.
  it('puts its peak at one over the falloff and leaves the rim alone', () => {
    expect(radialProfile(0.25, 4)).toBeCloseTo(1, 6)
    expect(radialProfile(1, 4)).toBeLessThan(0.3)
    expect(radialProfile(0.5, 2)).toBeCloseTo(1, 6)
  })

  it('treats a negative falloff as none rather than blowing up', () => {
    expect(radialProfile(0.5, -3)).toBeCloseTo(0.5, 12)
  })
})

describe('the aspect', () => {
  // The field is square and covers the canvas with the overflow cropped, so
  // one field width is one canvas width on both axes. That is the whole of
  // the aspect handling and this is what it buys: a circle on the canvas is a
  // circle in the field, so "the centre" and "a ring" mean what they say.
  it('makes a circle on the canvas a circle in the field', () => {
    for (const extent of [WIDE, TALL, SQUARE]) {
      const cover = fieldCover(extent)
      // Equal distances in canvas PIXELS, one across and one down, on a
      // canvas whose aspect is the cover's.
      const aspect = cover[0] / cover[1]
      const across = onField([0.5 + 0.2, 0.5], extent)
      const down = onField([0.5, 0.5 + 0.2 * aspect], extent)
      const from = [0.5, 0.5] as const
      expect(Math.hypot(across[0] - from[0], across[1] - from[1])).toBeCloseTo(
        Math.hypot(down[0] - from[0], down[1] - from[1]),
        10,
      )
    }
  })

  it('reads the canvas corner as a radius of 1, at any shape', () => {
    for (const extent of [WIDE, TALL, SQUARE]) {
      const corner = onField([0, 0], extent)
      const r = Math.hypot(corner[0] - 0.5, corner[1] - 0.5)
      expect(r / referenceRadius(extent)).toBeCloseTo(1, 10)
    }
  })

  it('reads a wide canvas and its own rotation the same way', () => {
    expect(referenceRadius(WIDE)).toBeCloseTo(referenceRadius(TALL), 12)
  })

  // A canvas with no area cannot say anything about its shape, and a
  // reference radius of zero would divide the whole field by nothing.
  it('never hands the shader a zero reference radius', () => {
    expect(analyticField({}, 1, visibleExtent(0, 0)).reference).toBeGreaterThan(0)
  })
})

describe('the velocity at a point', () => {
  it('is nothing anywhere when every coefficient is zero', () => {
    const field = still()
    expect(fieldMoves(field)).toBe(false)
    for (const uv of [
      [0.5, 0.5],
      [0.1, 0.9],
      [1, 0],
    ] as const)
      expect(length(analyticVelocity(field, onField(uv)))).toBe(0)
  })

  it('points at the centre when the radial term is negative', () => {
    const field = { ...still(), radial: -0.4 }
    const point = onField([0.9, 0.5])
    const v = analyticVelocity(field, point)
    // Straight along -x, since the point is due right of the centre.
    expect(v[0]).toBeLessThan(0)
    expect(v[1]).toBeCloseTo(0, 12)
  })

  it('points away from the centre when it is positive, everywhere alike', () => {
    const field = { ...still(), radial: 0.4 }
    for (const uv of [
      [0.9, 0.5],
      [0.1, 0.5],
      [0.5, 0.1],
      [0.2, 0.8],
    ] as const) {
      const point = onField(uv)
      const v = analyticVelocity(field, point)
      const out = [point[0] - 0.5, point[1] - 0.5] as const
      // Positive dot product with the outward ray: it pushes out.
      expect(v[0] * out[0] + v[1] * out[1], `${uv[0]},${uv[1]}`).toBeGreaterThan(0)
    }
  })

  it('is still at the exact centre, with no direction to jump to', () => {
    const field = { ...still(), radial: -1, swirl: 0.5, twist: 0.5 }
    expect(length(analyticVelocity(field, [0.5, 0.5]))).toBeCloseTo(0, 12)
  })

  // The coefficient means the speed at the peak, which is what lets a study
  // drive the strength and the shape from two rows without either one
  // changing what the other means.
  it('reaches the radial coefficient as its top speed and no more', () => {
    for (const falloff of [0, 2, 4]) {
      const field = { ...still(), radial: 0.6, falloff }
      let peak = 0
      for (let step = 0; step <= 400; step += 1)
        peak = Math.max(peak, length(analyticVelocity(field, onField([0.5, step / 400]))))
      expect(peak, `falloff ${falloff}`).toBeLessThanOrEqual(0.6 + 1e-9)
    }

    // Down the middle of the frame the corner is not reached, so the plain
    // zoom's peak is measured along the diagonal instead.
    const zoom = { ...still(), radial: 0.6, falloff: 0 }
    expect(length(analyticVelocity(zoom, onField([0, 0])))).toBeCloseTo(0.6, 10)
  })

  it('turns the picture with no inward or outward drift at all', () => {
    const field = { ...still(), swirl: 0.25 }
    const point = onField([0.8, 0.3])
    const v = analyticVelocity(field, point)
    const out = [point[0] - 0.5, point[1] - 0.5] as const
    expect(v[0] * out[0] + v[1] * out[1]).toBeCloseTo(0, 12)
  })

  // Solid body: one turn a second at every radius, so the picture turns
  // without shearing and the speed grows with the radius.
  it('swirls at the same turns a second at every radius', () => {
    const field = { ...still(), swirl: 0.5 }
    for (const at of [0.15, 0.3, 0.45]) {
      const point = [0.5 + at, 0.5] as const
      expect(length(analyticVelocity(field, point)) / at).toBeCloseTo(Math.PI, 10)
    }
  })

  // Differential: fast in the middle, gone at the corner, which is the shear
  // that winds a picture into a spiral.
  it('twists the middle faster than the rim, and not at all at the corner', () => {
    const field = { ...still(), twist: 0.5 }
    const reference = field.reference
    const near = length(analyticVelocity(field, [0.5 + reference * 0.2, 0.5]))
    const far = length(analyticVelocity(field, [0.5 + reference * 0.9, 0.5]))
    expect(near / (reference * 0.2)).toBeGreaterThan(far / (reference * 0.9))
    expect(length(analyticVelocity(field, [0.5 + reference, 0.5]))).toBeCloseTo(0, 12)
  })

  it('sums its terms rather than choosing between them', () => {
    const point = onField([0.75, 0.35])
    const base = still()
    const pull = analyticVelocity({ ...base, radial: -0.3 }, point)
    const turn = analyticVelocity({ ...base, swirl: 0.2 }, point)
    const both = analyticVelocity({ ...base, radial: -0.3, swirl: 0.2 }, point)
    expect(both[0]).toBeCloseTo(pull[0] + turn[0], 12)
    expect(both[1]).toBeCloseTo(pull[1] + turn[1], 12)
  })
})

describe('presence', () => {
  it('scales every coefficient and leaves the shape alone', () => {
    const knobs = { radial: -0.4, falloff: 3, swirl: 0.2, twist: 0.1 }
    const half = analyticField(knobs, 0.5, WIDE)
    expect(half.radial).toBeCloseTo(-0.2, 12)
    expect(half.swirl).toBeCloseTo(0.1, 12)
    expect(half.twist).toBeCloseTo(0.05, 12)
    // A shape faded toward zero would turn a burst into a zoom on the way in.
    expect(half.falloff).toBe(3)
  })

  it('leaves the field still at 0, so nothing is encoded', () => {
    const field = analyticField({ radial: -0.4, swirl: 0.2, twist: 0.1 }, 0, WIDE)
    expect(fieldMoves(field)).toBe(false)
    expect(length(analyticVelocity(field, onField([0.1, 0.1])))).toBe(0)
  })

  it('halves the velocity everywhere at half presence', () => {
    const knobs = { radial: -0.4, falloff: 3, swirl: 0.2, twist: 0.1 }
    const point = onField([0.2, 0.7])
    const whole = analyticVelocity(analyticField(knobs, 1, WIDE), point)
    const half = analyticVelocity(analyticField(knobs, 0.5, WIDE), point)
    expect(half[0]).toBeCloseTo(whole[0] / 2, 12)
    expect(half[1]).toBeCloseTo(whole[1] / 2, 12)
  })
})

describe('the uniform', () => {
  it('lays every term out where the shader reads it', () => {
    const field: AnalyticField = {
      radial: -0.4,
      falloff: 3,
      swirl: 0.2,
      twist: -0.1,
      centre: [0.5, 0.5],
      reference: 0.5737,
    }
    const out = writeAnalyticUniform(field, new Float32Array(ANALYTIC_UNIFORM_FLOATS))
    // The buffer is float32, so the expected side is rounded the same way.
    expect([...out]).toEqual(
      [-0.4, 3, 0, 0, 0.2, -0.1, 0, 0, 0.5, 0.5, 0.5737, 0].map((value) => Math.fround(value)),
    )
  })

  // Every vec4 of the struct is 16-byte aligned by construction, which is
  // what lets a term added later append a vec4 and move nothing.
  it('is a whole number of vec4s', () => {
    expect(ANALYTIC_UNIFORM_FLOATS % 4).toBe(0)
  })

  it('falls back to the resting value for a knob no live study named', () => {
    const field = analyticField({ radial: -0.2 }, 1, WIDE)
    expect(field.falloff).toBe(ANALYTIC_DEFAULTS.falloff)
    expect(field.swirl).toBe(ANALYTIC_DEFAULTS.swirl)
  })

  it('never hands the shader a negative falloff', () => {
    expect(analyticField({ falloff: -2 }, 1, WIDE).falloff).toBe(0)
  })

  it('keeps its own ranges over every knob it has', () => {
    for (const [knob, [low, high]] of Object.entries(ANALYTIC_RANGES)) {
      expect(low, knob).toBeLessThan(high)
      expect(
        ANALYTIC_DEFAULTS[knob as keyof typeof ANALYTIC_DEFAULTS],
        knob,
      ).toBeGreaterThanOrEqual(low)
    }
  })
})
