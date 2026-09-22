/**
 * The analytic flow's `lens` term, which is the pull half of the black hole.
 * `analytic.params.test.ts` holds the field as a whole; this holds the one
 * term the black hole card added, so a change to it fails here and names it.
 *
 * Four claims, and each of them is the reason the term has the shape it has:
 * the velocity is exactly zero at the exact centre, it draws inward at the
 * rim, it is continuous across the photon radius where the sign turns over,
 * and the field it writes is the same at any frame rate.
 */
import { describe, expect, it } from 'vitest'

import { ANALYTIC_UNIFORM_FLOATS } from './analytic.params'
import {
  advanceCurlClock,
  ANALYTIC_RANGES,
  analyticField,
  analyticVelocity,
  fieldMoves,
  LENS_ESCAPE,
  LENS_PEAK,
  lensProfile,
  writeAnalyticUniform,
} from './analytic.params'

/** A 16:9 canvas, as `visibleExtent` reports it. */
const WIDE = { x: 0.5, y: 0.28125 }

const PHOTON = 0.07

const field = (extra: Record<string, number> = {}) =>
  analyticField({ lens: 0.4, photon: PHOTON, ...extra }, 1, WIDE)

/** A point at `t` times the reference radius, along a ray of this angle. */
const onRay = (frame: ReturnType<typeof field>, t: number, angle = 0.7) => {
  const r = t * frame.reference
  return [frame.centre[0] + r * Math.cos(angle), frame.centre[1] + r * Math.sin(angle)] as const
}

const length = ([x, y]: readonly [number, number]) => Math.hypot(x, y)

/** How far along the outward ray the velocity points: negative is inward. */
const outward = (frame: ReturnType<typeof field>, t: number, angle = 0.7) => {
  const point = onRay(frame, t, angle)
  const [vx, vy] = analyticVelocity(frame, point)
  return vx * Math.cos(angle) + vy * Math.sin(angle)
}

describe('the lens profile', () => {
  it('is exactly nothing at the exact centre', () => {
    expect(lensProfile(0, PHOTON)).toBe(0)
    const frame = field()
    const [vx, vy] = analyticVelocity(frame, frame.centre)
    expect(vx).toBe(0)
    expect(vy).toBe(0)
  })

  // The whole point of the inside half. A pull that ran all the way in would
  // gather the picture into a bright dot at the middle, so inside the photon
  // radius the sign is the other way and the middle is swept clear.
  it('pushes gently outward inside the photon radius and never harder than it says', () => {
    for (let step = 1; step < 20; step += 1) {
      const t = (step / 20) * PHOTON
      expect(lensProfile(t, PHOTON), `t ${t}`).toBeGreaterThan(0)
      expect(lensProfile(t, PHOTON), `t ${t}`).toBeLessThanOrEqual(LENS_ESCAPE + 1e-12)
    }

    // Half way out is where the parabola tops out, at exactly the escape.
    expect(lensProfile(PHOTON / 2, PHOTON)).toBeCloseTo(LENS_ESCAPE, 12)
  })

  it('draws inward everywhere outside it, and at the rim', () => {
    const frame = field()
    for (const t of [0.08, 0.1, 0.2, 0.4, 0.7, 1])
      expect(outward(frame, t), `t ${t}`).toBeLessThan(0)
    // The corner of the canvas is `reference` away, so t of 1 is the rim.
    expect(outward(frame, 1)).toBeLessThan(0)
  })

  it('falls off with the square of the distance far from the hole', () => {
    // Far out the `1 - photon / t` factor goes to one, so doubling the
    // distance has to quarter the pull. It is still 0.99 at a hundred photon
    // radii and 0.9 at ten, which is why the reading is taken out there: the
    // term is a square law with a near-field correction and not a pure one.
    const near = Math.abs(lensProfile(100 * PHOTON, PHOTON))
    const far = Math.abs(lensProfile(200 * PHOTON, PHOTON))
    expect(near / far).toBeGreaterThan(3.95)
    expect(near / far).toBeLessThan(4.05)
  })

  it('is continuous across the photon radius, where the sign turns over', () => {
    for (const photon of [0.02, 0.07, 0.2, 0.45]) {
      expect(lensProfile(photon, photon), `at ${photon}`).toBeCloseTo(0, 12)
      // Both halves leave the photon radius with a slope of the order of
      // `1 / photon`, so the step across it has to shrink in proportion to
      // the gap. A discontinuity would hold the same size however small the
      // gap got, which is what this catches.
      let last = Number.POSITIVE_INFINITY
      for (const gap of [1e-3, 1e-4, 1e-5, 1e-6]) {
        const below = lensProfile(photon - gap, photon)
        const above = lensProfile(photon + gap, photon)
        const step = Math.abs(above - below)
        expect(step, `${photon} either side by ${gap}`).toBeLessThan((10 * gap) / photon)
        expect(step, `${photon} shrinks with the gap`).toBeLessThan(last)
        last = step
      }
    }
  })

  it('is divided by its own peak, so `lens` is the fastest the pull ever gets', () => {
    let worst = 0
    for (let step = 1; step <= 4000; step += 1) {
      const t = (step / 4000) * 3
      worst = Math.max(worst, Math.abs(lensProfile(t, PHOTON)))
    }

    expect(worst).toBeCloseTo(1, 4)
    // And the peak sits at one and a half photon radii, which is where the
    // ring the ink draws is meant to be.
    expect(Math.abs(lensProfile(1.5 * PHOTON, PHOTON))).toBeCloseTo(1, 6)
    expect(LENS_PEAK).toBeCloseTo(4 / 27, 12)
  })

  it('keeps the photon radius as a shape, so presence fades the pull alone', () => {
    const knobs = { lens: 0.4, photon: PHOTON }
    const whole = analyticField(knobs, 1, WIDE)
    const half = analyticField(knobs, 0.5, WIDE)
    expect(half.lens).toBeCloseTo(whole.lens / 2, 12)
    expect(half.photon).toBe(whole.photon)
    const point = onRay(whole, 0.3)
    expect(analyticVelocity(half, point)[0]).toBeCloseTo(analyticVelocity(whole, point)[0] / 2, 12)
  })

  it('is still at a pull of nothing, so no pass is encoded', () => {
    const still = analyticField({ lens: 0, photon: PHOTON }, 1, WIDE)
    expect(fieldMoves(still)).toBe(false)
    expect(fieldMoves(field())).toBe(true)
  })

  it('holds the photon radius inside the range, since an override skips the sliders', () => {
    const [low, high] = ANALYTIC_RANGES.photon
    expect(analyticField({ lens: 0.4, photon: -5 }, 1, WIDE).photon).toBe(low)
    expect(analyticField({ lens: 0.4, photon: 9 }, 1, WIDE).photon).toBe(high)
    expect(low).toBeGreaterThan(0)
  })

  // The lens has no clock of its own: it is a function of this frame's knobs
  // and nothing else, so the field it writes cannot depend on the step. The
  // curl's clock runs beside it, and this says it does not drag the lens with
  // it either.
  it('writes the same field after the same seconds at 30, 60, 144 and 240 a second', () => {
    const knobs = { lens: 0.4, photon: PHOTON, curl: 0.05, curlRate: 0.05 }
    const seconds = 3
    const readings = [30, 60, 144, 240].map((rate) => {
      let clock = 0
      for (let frame = 0; frame < seconds * rate; frame += 1)
        clock = advanceCurlClock(clock, knobs, 1 / rate)
      const frame = analyticField(knobs, 1, WIDE, clock)
      return [0.03, PHOTON, 0.2, 0.6, 1].map((t) => outward(frame, t))
    })

    const first = readings[0] ?? []
    for (const reading of readings.slice(1))
      reading.forEach((value, at) => expect(value).toBeCloseTo(first[at] ?? 0, 6))
  })

  it('adds to the radial term rather than replacing it, and lands in its own vec4', () => {
    const both = analyticField({ radial: 0.2, falloff: 0, lens: 0.4, photon: PHOTON }, 1, WIDE)
    const alone = analyticField({ radial: 0.2, falloff: 0 }, 1, WIDE)
    const lensOnly = field()
    const t = 0.5
    expect(outward(both, t)).toBeCloseTo(outward(alone, t) + outward(lensOnly, t), 12)

    const out = writeAnalyticUniform(both, new Float32Array(ANALYTIC_UNIFORM_FLOATS))
    expect(out[16]).toBeCloseTo(0.4, 6)
    expect(out[17]).toBeCloseTo(PHOTON, 6)
    expect(out[18]).toBe(0)
    expect(out[19]).toBe(0)
  })

  it('has the shader saying the same thing, line for line', async () => {
    const source = (await import('../shaders/analytic.field.wgsl?raw')).default
    expect(source).toContain('lens: vec4<f32>,')
    expect(source).toContain('fn lens_profile(t: f32, photon: f32) -> f32 {')
    expect(source).toContain('field.lens.x * lens_profile(t, field.lens.y)')
    expect(source).toContain('const LENS_PEAK = 0.14814814814814814;')
    expect(source).toContain('const LENS_ESCAPE = 0.25;')
  })

  it('goes nowhere near a zero divide at the smallest radius the range allows', () => {
    const tight = analyticField({ lens: 1.2, photon: ANALYTIC_RANGES.photon[0] }, 1, WIDE)
    for (const t of [0, 1e-9, 1e-6, 0.001, 0.02, 0.5, 1.4]) {
      const point = onRay(tight, t)
      const speed = length(analyticVelocity(tight, point))
      expect(Number.isFinite(speed), `t ${t}`).toBe(true)
      expect(speed, `t ${t}`).toBeLessThanOrEqual(1.2 + 1e-9)
    }
  })
})
