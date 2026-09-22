/**
 * The analytic flow's maths, which is all of the flow that is not moving
 * bytes into a buffer: the velocity at a point, the aspect handling under it,
 * and the uniform the shader reads. The pass itself needs a browser, so what
 * is proved here is what the shader is a transcription of.
 */
import { describe, expect, it } from 'vitest'

import { visibleExtent } from '../scenes/fluid.params'
import {
  advanceCurlClock,
  ANALYTIC_DEFAULTS,
  ANALYTIC_RANGES,
  ANALYTIC_SIZE,
  ANALYTIC_UNIFORM_FLOATS,
  analyticField,
  analyticVelocity,
  CURL_OCTAVES,
  CURL_PERIOD,
  curlPotential,
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

/** A field with only the curl term in it, at a clock. */
const curly = (curl = 0.2, curlScale = 3.5, clock = 0, extent = WIDE): AnalyticField =>
  analyticField({ curl, curlScale }, 1, extent, clock)

/**
 * 128 evenly spaced clocks over the pattern's whole repeat. The six waves turn
 * at sixteenths of a turn that are all different, so over these no squared
 * sine and no product of two different waves has anything left in it but its
 * mean, and the statistics below are exact rather than sampled: 2n and n1 + n2
 * for the waves' n are all under 128 and none is 0, which is the condition.
 */
const CLOCKS = Array.from({ length: 128 }, (_, at) => (at * CURL_PERIOD) / 128)

const divergence = (field: AnalyticField, at: readonly [number, number], h = 1e-6) => {
  const right = analyticVelocity(field, [at[0] + h, at[1]])
  const left = analyticVelocity(field, [at[0] - h, at[1]])
  const down = analyticVelocity(field, [at[0], at[1] + h])
  const up = analyticVelocity(field, [at[0], at[1] - h])
  return (right[0] - left[0]) / (2 * h) + (down[1] - up[1]) / (2 * h)
}

/** The steepest single derivative of the velocity at a point, to hold a tolerance against. */
const steepness = (field: AnalyticField, at: readonly [number, number], h = 1e-6) => {
  const right = analyticVelocity(field, [at[0] + h, at[1]])
  const left = analyticVelocity(field, [at[0] - h, at[1]])
  const down = analyticVelocity(field, [at[0], at[1] + h])
  const up = analyticVelocity(field, [at[0], at[1] - h])
  return (
    Math.max(
      Math.abs(right[0] - left[0]),
      Math.abs(right[1] - left[1]),
      Math.abs(down[0] - up[0]),
      Math.abs(down[1] - up[1]),
    ) /
    (2 * h)
  )
}

const GRID = Array.from({ length: 15 }, (_, row) =>
  Array.from({ length: 15 }, (_, column) => [0.03 + column * 0.067, 0.04 + row * 0.066] as const),
).flat()

describe('the curl term', () => {
  it('adds nothing at all when curl is 0, whatever the pattern is doing', () => {
    const others = { radial: -0.3, falloff: 1, swirl: 0.2, twist: 0.1 }
    const without = analyticField(others, 1, WIDE)
    for (const clock of [0, 7.3, 200]) {
      const off = analyticField({ ...others, curl: 0, curlScale: 6 }, 1, WIDE, clock)
      expect(fieldMoves(off)).toBe(true)
      for (const point of GRID)
        expect(analyticVelocity(off, point)).toEqual(analyticVelocity(without, point))
    }
    expect(fieldMoves(curly(0))).toBe(false)
  })

  it('is a flow of its own when it is the only term', () => {
    expect(fieldMoves(curly(0.05))).toBe(true)
    const slow = analyticVelocity(curly(0.1), [0.3, 0.6])
    const fast = analyticVelocity(curly(0.2), [0.3, 0.6])
    expect(fast[0]).toBeCloseTo(slow[0] * 2, 12)
    expect(fast[1]).toBeCloseTo(slow[1] * 2, 12)
  })

  // The claim the term is built on: it moves the picture without gathering
  // any of it or thinning any of it. Taken by finite differences over the
  // canvas, at the scales and clocks a study can reach.
  it('is divergence free, to the tolerance a finite difference allows', () => {
    for (const scale of [0.5, 3.5, 8])
      for (const clock of [0, 0.37, 7.7])
        for (const point of GRID) {
          const field = curly(0.2, scale, clock)
          const steep = steepness(field, point)
          expect(steep, `steepness at ${point}`).toBeGreaterThan(0)
          expect(Math.abs(divergence(field, point)), `scale ${scale} at ${point}`).toBeLessThan(
            1e-6 * Math.max(steep, 1e-3),
          )
        }
  })

  // The test above would pass on a field that did nothing, and this is what
  // it is measuring against: a pull to the middle piles the picture up, and
  // the same finite difference says so.
  it('is measured against something that is not divergence free', () => {
    const pull = { ...still(), radial: -0.4 }
    expect(Math.abs(divergence(pull, [0.7, 0.4]))).toBeGreaterThan(0.1)
  })

  it('is the curl of its potential, which is what the shader takes by hand', () => {
    const h = 1e-6
    for (const scale of [1, 3.5, 8])
      for (const point of GRID.filter((_, at) => at % 9 === 0)) {
        const field = curly(1, scale, 0.61)
        const [vx, vy] = analyticVelocity(field, point)
        const dx =
          (curlPotential(field, [point[0] + h, point[1]]) -
            curlPotential(field, [point[0] - h, point[1]])) /
          (2 * h)
        const dy =
          (curlPotential(field, [point[0], point[1] + h]) -
            curlPotential(field, [point[0], point[1] - h])) /
          (2 * h)
        expect(vx, `scale ${scale} at ${point}`).toBeCloseTo(dy, 6)
        expect(vy, `scale ${scale} at ${point}`).toBeCloseTo(-dx, 6)
      }
  })

  // `curl` is a ceiling on how fast any point goes, and the typical point
  // goes at 0.46 of it, at whatever scale, which is what lets a study set the
  // speed and the size from two rows without either changing the other.
  it('never goes faster than curl and moves at the same pace at every scale', () => {
    const rms = (scale: number) => {
      let sum = 0
      let fastest = 0
      for (const clock of CLOCKS) {
        const speed = Math.hypot(...analyticVelocity(curly(0.2, scale, clock), [0.41, 0.27]))
        sum += speed * speed
        fastest = Math.max(fastest, speed)
      }
      expect(fastest).toBeLessThanOrEqual(0.2 * (1 + 1e-9))
      return Math.sqrt(sum / CLOCKS.length)
    }

    const expected = Math.sqrt(0.5 * CURL_OCTAVES.reduce((sum, o) => sum + o.weight ** 2, 0)) * 0.2
    for (const scale of [0.5, 2, 3.5, 8])
      expect(rms(scale), `scale ${scale}`).toBeCloseTo(expected, 9)
    expect(expected / 0.2).toBeCloseTo(0.46, 2)
  })

  it('reaches close to its ceiling somewhere on the canvas', () => {
    let fastest = 0
    for (const clock of [0, 0.2, 0.5, 0.8])
      for (const point of GRID)
        fastest = Math.max(fastest, Math.hypot(...analyticVelocity(curly(1, 3.5, clock), point)))
    expect(fastest).toBeGreaterThan(0.85)
    expect(fastest).toBeLessThanOrEqual(1 + 1e-9)
  })

  // The bar's "a cell as wide as it is tall". The pattern lives in field uv,
  // where one pixel is the same distance across and down whatever the canvas
  // is, so the same step in canvas pixels changes the velocity by the same
  // amount along either axis. Measured over a full turn of the clock, where
  // each octave's two waves are at right angles and the average is exact.
  describe('on any shape of canvas', () => {
    const shapes = [
      [2560, 1440],
      [1440, 2560],
      [1000, 1000],
    ] as const

    /** Mean squared change of velocity over one canvas pixel, across and down. */
    const change = (width: number, height: number, scaleByCanvas = false) => {
      const extent = visibleExtent(width, height)
      const cover = fieldCover(extent)
      let across = 0
      let down = 0
      for (const clock of CLOCKS)
        for (const [u, v] of [
          [0.2, 0.3],
          [0.55, 0.45],
          [0.8, 0.7],
          [0.35, 0.85],
        ] as const) {
          const field = curly(0.2, 6, clock, extent)
          // Deliberately wrong when asked to be: the canvas's own uv read as
          // field uv, which is what a cell laid out in canvas uv would do.
          const at = (du: number, dv: number): [number, number] =>
            scaleByCanvas
              ? [u + du, v + dv]
              : [(u + du - 0.5) * cover[0] + 0.5, (v + dv - 0.5) * cover[1] + 0.5]
          const here = analyticVelocity(field, at(0, 0))
          const right = analyticVelocity(field, at(1 / width, 0))
          const below = analyticVelocity(field, at(0, 1 / height))
          across += Math.hypot(right[0] - here[0], right[1] - here[1]) ** 2
          down += Math.hypot(below[0] - here[0], below[1] - here[1]) ** 2
        }
      return { across, down }
    }

    it('changes as fast across as down, in pixels', () => {
      for (const [width, height] of shapes) {
        const { across, down } = change(width, height)
        expect(across / down, `${width} by ${height}`).toBeGreaterThan(0.98)
        expect(across / down, `${width} by ${height}`).toBeLessThan(1.02)
      }
    })

    it('would not, if the cells were laid out in canvas uv', () => {
      const { across, down } = change(2560, 1440, true)
      expect(across / down).toBeLessThan(0.5)
    })

    it('reads a wide canvas and the same canvas turned on its side alike', () => {
      const wide = change(2560, 1440)
      const tall = change(1440, 2560)
      expect(tall.across / wide.across).toBeGreaterThan(0.98)
      expect(tall.across / wide.across).toBeLessThan(1.02)
    })

    // `curlScale` is cells across, so twice as many cells is twice the rate
    // of change per pixel, the same on both axes.
    it('has twice the change per pixel at twice the cells', () => {
      const rate = (scale: number) => {
        let sum = 0
        for (const clock of CLOCKS) {
          const field = curly(0.2, scale, clock)
          const here = analyticVelocity(field, [0.4, 0.5])
          const next = analyticVelocity(field, [0.4 + 1 / 2560, 0.5])
          sum += Math.hypot(next[0] - here[0], next[1] - here[1]) ** 2
        }
        return Math.sqrt(sum)
      }

      expect(rate(6) / rate(3)).toBeCloseTo(2, 1)
    })
  })

  describe('over time', () => {
    const run = (steps: readonly number[], tuning = { curlRate: 0.05 }) =>
      steps.reduce((clock, dt) => advanceCurlClock(clock, tuning, dt), 0)

    it('is the same field at 60 and at 144 frames a second, for the same seconds', () => {
      const slow = run(Array.from({ length: 180 }, () => 1 / 60))
      const fast = run(Array.from({ length: 432 }, () => 1 / 144))
      expect(slow).toBeCloseTo(0.15, 9)
      expect(fast).toBeCloseTo(slow, 9)
      const jittered = run(
        Array.from({ length: 60 }, (_, at) => [0.01, 0.03, 0.02, 0.04][at % 4] ?? 0),
      )
      expect(jittered).toBeCloseTo(0.05 * 1.5, 9)
      for (const point of GRID.filter((_, at) => at % 12 === 0)) {
        const a = analyticVelocity(curly(0.2, 3.5, slow), point)
        const b = analyticVelocity(curly(0.2, 3.5, fast), point)
        expect(b[0]).toBeCloseTo(a[0], 7)
        expect(b[1]).toBeCloseTo(a[1], 7)
      }
    })

    it('moves with the seconds and stands still when the rate is 0', () => {
      const early = analyticVelocity(curly(0.2, 3.5, 0), [0.3, 0.3])
      const later = analyticVelocity(curly(0.2, 3.5, 0.3), [0.3, 0.3])
      expect(Math.hypot(later[0] - early[0], later[1] - early[1])).toBeGreaterThan(0.01)
      expect(run([1, 1, 1], { curlRate: 0 })).toBe(0)
    })

    // A rate that moves with the music must change how fast the pattern goes
    // from here on and not where it is: the clock adds the rate up.
    it('does not jump when the rate changes', () => {
      let clock = advanceCurlClock(0, { curlRate: 0.05 }, 1)
      const before = clock
      clock = advanceCurlClock(clock, { curlRate: 0.1 }, 0)
      expect(clock).toBe(before)
      clock = advanceCurlClock(clock, { curlRate: 0.1 }, 1)
      expect(clock).toBeCloseTo(0.15, 12)
    })

    it('goes round the wrap without a seam', () => {
      const round = analyticVelocity(curly(0.2, 5, CURL_PERIOD - 1e-3), [0.31, 0.62])
      const start = analyticVelocity(curly(0.2, 5, -1e-3), [0.31, 0.62])
      expect(round[0]).toBeCloseTo(start[0], 9)
      expect(round[1]).toBeCloseTo(start[1], 9)
      const wrapped = advanceCurlClock(CURL_PERIOD - 0.01, { curlRate: 0.25 }, 1)
      expect(wrapped).toBeCloseTo(0.24, 9)
      expect(wrapped).toBeGreaterThanOrEqual(0)
      expect(wrapped).toBeLessThan(CURL_PERIOD)
    })

    it('holds the clock through a step that is not a number, or runs backwards', () => {
      expect(advanceCurlClock(3, { curlRate: 0.05 }, Number.NaN)).toBe(3)
      expect(advanceCurlClock(3, { curlRate: 0.05 }, -1)).toBe(3)
      expect(advanceCurlClock(3, { curlRate: -1 }, 1)).toBe(3)
    })
  })

  describe('as a shape', () => {
    it('is scaled by presence in its speed and not in its cells', () => {
      const half = analyticField({ curl: 0.2, curlScale: 5 }, 0.5, WIDE, 0.3)
      expect(half.curl).toBeCloseTo(0.1, 12)
      expect(half.curlScale).toBe(5)
      expect(half.curlClock).toBe(0.3)
      expect(fieldMoves(analyticField({ curl: 0.2 }, 0, WIDE))).toBe(false)
    })

    it('holds the cell count inside what the grid can carry', () => {
      const [lowest, highest] = ANALYTIC_RANGES.curlScale
      expect(analyticField({ curlScale: 100 }, 1, WIDE).curlScale).toBe(highest)
      expect(analyticField({ curlScale: 0 }, 1, WIDE).curlScale).toBe(lowest)
      expect(analyticField({ curlScale: -3 }, 1, WIDE).curlScale).toBe(lowest)
    })

    it('rests at the defaults for a knob nobody named', () => {
      const field = analyticField({ curl: 0.1 }, 1, WIDE)
      expect(field.curlScale).toBe(ANALYTIC_DEFAULTS.curlScale)
      expect(analyticField({}, 1, WIDE).curl).toBe(0)
    })
  })

  describe('its octaves', () => {
    it('are weighted to a ceiling of exactly 1', () => {
      expect(CURL_OCTAVES.reduce((sum, octave) => sum + octave.weight, 0)).toBeCloseTo(1, 12)
    })

    // Different, so no two waves keep step and the pattern does not repeat
    // every turn of the clock; and a whole number of turns over the period,
    // so the clock wraps with no jump in any of them.
    it('turn at six different rates, each a whole number of turns over the period', () => {
      const rates = CURL_OCTAVES.flatMap((octave) => [...octave.turns])
      expect(rates).toHaveLength(6)
      expect(new Set(rates.map(Math.abs)).size).toBe(6)
      for (const rate of rates) {
        expect(Number.isInteger(rate * CURL_PERIOD), `${rate}`).toBe(true)
        expect(Math.abs(rate)).toBeGreaterThanOrEqual(1)
        expect(Math.abs(rate)).toBeLessThan(3.5)
      }
    })

    it('do not repeat until the clock has been round its whole period', () => {
      const at = (clock: number) => analyticVelocity(curly(0.2, 3.5, clock), [0.31, 0.62])
      const start = at(0.3)
      for (const early of [1, 2, 4, 8]) {
        const back = at(0.3 + early)
        expect(Math.hypot(back[0] - start[0], back[1] - start[1]), `${early}`).toBeGreaterThan(
          0.005,
        )
      }

      const whole = at(0.3 + CURL_PERIOD)
      expect(whole[0]).toBeCloseTo(start[0], 9)
      expect(whole[1]).toBeCloseTo(start[1], 9)
    })

    // Both of an octave's waves come from one axis of length root two, which
    // is what makes its cells square, and the six of them spread evenly round
    // the half circle is what makes the whole as fine along one direction as
    // any other.
    it('put six waves 30 degrees apart, each octave a right angle in itself', () => {
      const angles: number[] = []
      for (const { axis } of CURL_OCTAVES) {
        expect(Math.hypot(axis[0], axis[1])).toBeCloseTo(Math.SQRT2, 12)
        const first = Math.atan2(axis[1], axis[0])
        for (const angle of [first, first - Math.PI / 2]) {
          const half = ((angle % Math.PI) + Math.PI) % Math.PI
          angles.push(half)
        }
      }
      angles.sort((a, b) => a - b)
      for (let at = 0; at < angles.length; at += 1) {
        const next = angles[at + 1] ?? (angles[0] ?? 0) + Math.PI
        expect(next - (angles[at] ?? 0)).toBeCloseTo(Math.PI / 6, 9)
      }
    })

    it('keep the finest wave at least five texels long at the top of the range', () => {
      const finest = CURL_OCTAVES[CURL_OCTAVES.length - 1]
      if (!finest) throw new Error('Expected an octave')
      const k = Math.PI * ANALYTIC_RANGES.curlScale[1] * finest.scale
      const wavelength = (2 * Math.PI) / (k * Math.hypot(finest.axis[0], finest.axis[1]))
      expect(wavelength * ANALYTIC_SIZE).toBeGreaterThan(5)
    })
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
      curl: 0.05,
      curlScale: 3.5,
      curlClock: 12.25,
      lens: 0.14,
      photon: 0.07,
    }
    const out = writeAnalyticUniform(field, new Float32Array(ANALYTIC_UNIFORM_FLOATS))
    // The buffer is float32, so the expected side is rounded the same way.
    expect([...out]).toEqual(
      // prettier-ignore
      [
        -0.4, 3, 0, 0, 0.2, -0.1, 0, 0, 0.5, 0.5, 0.5737, 0, 0.05, 3.5, 12.25, 0, 0.14, 0.07, 0, 0,
      ].map((value) => Math.fround(value)),
    )
  })

  // Every vec4 of the struct is 16-byte aligned by construction, which is
  // what lets a term added later append a vec4 and move nothing.
  it('is a whole number of vec4s', () => {
    expect(ANALYTIC_UNIFORM_FLOATS % 4).toBe(0)
    expect(ANALYTIC_UNIFORM_FLOATS).toBe(20)
  })

  // The curl vec4 went on the end, so the three that were already there are
  // where they were.
  it('leaves the vec4s that were there before the curl term where they were', () => {
    const before = [-0.4, 3, 0, 0, 0.2, -0.1, 0, 0, 0.5, 0.5, 0.5737, 0]
    const field: AnalyticField = {
      ...still(),
      radial: -0.4,
      falloff: 3,
      swirl: 0.2,
      twist: -0.1,
      reference: 0.5737,
      curl: 0.3,
      curlScale: 5,
      curlClock: 99,
    }
    const out = writeAnalyticUniform(field, new Float32Array(ANALYTIC_UNIFORM_FLOATS))
    expect([...out.slice(0, 12)]).toEqual(before.map((value) => Math.fround(value)))
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
