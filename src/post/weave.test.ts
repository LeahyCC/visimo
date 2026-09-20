/**
 * The gate weave: the path, the way it reaches the uniform, and what keeps the
 * frame's edge clean. The maths is `gateWeave` and `weaveUv` in `params.ts`;
 * the shader only adds and scales what they write.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { CASTS } from '../studies/casts/index'
import { castFrame, resolveCast } from '../studies/resolve'
import {
  defaultPostParams,
  gateWeave,
  MAX_WEAVE,
  mergePostParams,
  POST_LANES,
  POST_STAGES,
  POST_UNIFORM_FLOATS,
  postSummary,
  weaveUv,
  writePostUniform,
} from './params'
import type { PostParams } from './params'

const packet = (values: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

const write = (params: PostParams, features = packet(), width = 1920, height = 1080) =>
  writePostUniform(params, features, width, height, new Float32Array(POST_UNIFORM_FLOATS))

const graded = (weave: number, enabled = true): PostParams =>
  mergePostParams(defaultPostParams(), { grade: { enabled, weave } })

/** The four weave floats of a uniform: offset x and y, then the crop x and y. */
const weaveFloats = (out: Float32Array) => Array.from(out.slice(48, 52))

/** Every frame of an hour at 30 frames a second, the clock alone. */
const HOUR = Array.from({ length: 3600 * 30 }, (_, frame) => frame / 30)

describe('the gate weave path', () => {
  it('stays inside -1 to 1 on both axes, and uses the room', () => {
    let widest = 0
    for (const seconds of HOUR) {
      const [x, y] = gateWeave(seconds)
      expect(Math.abs(x)).toBeLessThanOrEqual(1)
      expect(Math.abs(y)).toBeLessThanOrEqual(1)
      widest = Math.max(widest, Math.abs(x), Math.abs(y))
    }

    expect(widest).toBeGreaterThan(0.8)
  })

  it('wanders about the middle and does not drift off to one side', () => {
    let x = 0
    let y = 0
    for (const seconds of HOUR) {
      const at = gateWeave(seconds)
      x += at[0] / HOUR.length
      y += at[1] / HOUR.length
    }

    expect(Math.abs(x)).toBeLessThan(0.05)
    expect(Math.abs(y)).toBeLessThan(0.05)
  })

  it('is a function of the clock alone, so it reads the same at any frame rate', () => {
    // Two frame steps that land on the same instant land on the same place,
    // and nothing here carries a state from one call to the next.
    const at = (seconds: number, dt: number) =>
      weaveFloats(write(graded(1.2), packet({ time: seconds, dt })))
    for (const seconds of [0, 0.5, 7.25, 61, 3599.9])
      expect(at(seconds, 1 / 30)).toEqual(at(seconds, 1 / 144))
    const first = gateWeave(12.5)
    gateWeave(99)
    expect(gateWeave(12.5)).toEqual(first)
  })

  it('moves slowly enough to be felt and not seen', () => {
    // At the most weave a look uses, film's 1.2 pixels at 1080 high, nothing
    // crosses more than about two and a half pixels in a second, measured at
    // a 144th of a second a step.
    let fastest = 0
    let last = gateWeave(0)
    for (let frame = 1; frame < 144 * 600; frame += 1) {
      const at = gateWeave(frame / 144)
      fastest = Math.max(
        fastest,
        Math.abs(at[0] - last[0]) * 144 * 1.2,
        Math.abs(at[1] - last[1]) * 144 * 1.2,
      )
      last = at
    }

    expect(fastest).toBeLessThan(2.5)
  })

  it('does not repeat, and the two axes are not locked together', () => {
    // No period a person could find: after each of these spans the path is
    // somewhere else, at some moment in the two minutes.
    for (const span of [7, 11, 13, 29, 61]) {
      let gap = 0
      for (let seconds = 0; seconds < 120; seconds += 0.25)
        gap = Math.max(gap, Math.abs(gateWeave(seconds)[0] - gateWeave(seconds + span)[0]))
      expect(gap, `after ${span} s`).toBeGreaterThan(0.3)
    }

    // And it is not a line: x and y are close to uncorrelated over an hour.
    let sumXY = 0
    let sumXX = 0
    let sumYY = 0
    for (const seconds of HOUR) {
      const [x, y] = gateWeave(seconds)
      sumXY += x * y
      sumXX += x * x
      sumYY += y * y
    }

    expect(Math.abs(sumXY / Math.sqrt(sumXX * sumYY))).toBeLessThan(0.15)
  })

  it('is the same path for the same song every time, and never a NaN', () => {
    expect(gateWeave(31.7)).toEqual(gateWeave(31.7))
    expect(gateWeave(Number.NaN)).toEqual(gateWeave(0))
  })
})

describe('the gate weave in the uniform', () => {
  it('has a lane, and rests at none', () => {
    const params = defaultPostParams()
    expect(params.grade.weave).toBe(0)
    expect(POST_LANES['grade.weave'].read(params)).toBe(0)
    POST_LANES['grade.weave'].write(params, 1.5)
    expect(params.grade.weave).toBe(1.5)
  })

  // The composite reads uv - (uv - 0.5) x crop + offset. Its extremes are the
  // two edges of the frame, so if both stay inside 0 to 1 at every moment the
  // sampler is never asked for a pixel that is not there, and there is no
  // clamped edge to streak along the border.
  it('never reads past the frame: the span it samples stays inside the texture', () => {
    for (const [width, height] of [
      [1920, 1080],
      [3840, 2160],
      [600, 1400],
      [1, 1],
    ] as const) {
      // 50 is well past what the uniform will carry, and is held to the most.
      for (const weave of [0.3, 1.2, MAX_WEAVE, 50]) {
        for (let seconds = 0; seconds < 600; seconds += 0.37) {
          const { offset, shrink } = weaveUv(weave, seconds, width, height)
          for (const axis of [0, 1] as const) {
            const low = 0.5 * (shrink[axis] ?? 0) + (offset[axis] ?? 0)
            const high = 1 - 0.5 * (shrink[axis] ?? 0) + (offset[axis] ?? 0)
            expect(low, `${width}x${height} at ${weave}`).toBeGreaterThanOrEqual(-1e-9)
            expect(high, `${width}x${height} at ${weave}`).toBeLessThanOrEqual(1 + 1e-9)
          }
        }
      }
    }
  })

  it('scales with the canvas: the same fraction of a frame at 1080 and at 2160', () => {
    const small = weaveUv(1.2, 41.3, 1920, 1080)
    const big = weaveUv(1.2, 41.3, 3840, 2160)
    // The offset is in uv, so a canvas twice as tall moves the same fraction
    // of itself, which is twice the pixels.
    expect(big.offset[1]).toBeCloseTo(small.offset[1], 12)
    expect(big.offset[1] * 2160).toBeCloseTo(2 * small.offset[1] * 1080, 9)
    // And the crop on each side is the weave's own reach, in pixels.
    expect((small.shrink[1] * 1080) / 2).toBeCloseTo(1.2, 9)
    expect((big.shrink[1] * 2160) / 2).toBeCloseTo(2.4, 9)
  })

  it('writes plain zeros when it is off, on either switch, or at a weave of none', () => {
    const features = packet({ time: 41.3 })
    for (const params of [
      defaultPostParams(),
      graded(0),
      graded(1.2, false),
      mergePostParams(graded(1.2), { enabled: false }),
    ])
      expect(weaveFloats(write(params, features))).toEqual([0, 0, 0, 0])
  })

  it('writes an offset and a crop when it is on, and holds the number to its range', () => {
    const features = packet({ time: 41.3 })
    const on = write(graded(1.2), features)
    expect(Math.abs(on[48] ?? 0) + Math.abs(on[49] ?? 0)).toBeGreaterThan(0)
    expect(on[50]).toBeCloseTo(2.4 / 1920, 9)
    expect(on[51]).toBeCloseTo(2.4 / 1080, 9)
    // A lane may be carried past its end, so the writer holds it: a negative
    // weave is none, a runaway one is the most there is, a NaN is none.
    expect(weaveFloats(write(graded(-3), features))).toEqual([0, 0, 0, 0])
    expect(weaveFloats(write(graded(Number.NaN), features))).toEqual([0, 0, 0, 0])
    expect(weaveFloats(write(graded(99), features))).toEqual(
      weaveFloats(write(graded(MAX_WEAVE), features)),
    )
    for (const value of write(graded(99), features)) expect(Number.isFinite(value)).toBe(true)
  })

  it('leaves every float the stack had before it where it was', () => {
    const features = packet({ dt: 1 / 90, time: 3, beatPulse: 0.3, keyHue: 0.2 })
    const before = write(graded(0), features)
    const after = write(graded(1.2), features)
    expect(Array.from(after.slice(0, 48))).toEqual(Array.from(before.slice(0, 48)))
  })

  it('is not a stage of its own, so data-post prints what it did', () => {
    expect(postSummary(graded(1.2))).toBe(postSummary(graded(0)))
    expect(POST_STAGES).not.toContain('weave')
  })

  it('is none for every shipped cast, so their pixels are what they were', () => {
    const features = packet({ time: 88.4, energy: 0.6, swell: 0.5 })
    for (const cast of CASTS) {
      for (const tension of [0, 1]) {
        const { post } = resolveCast(cast, features, tension, castFrame())
        expect(post.grade.weave, `${cast.name} at tension ${tension}`).toBe(0)
        expect(weaveFloats(write(post, features)), `${cast.name} at tension ${tension}`).toEqual([
          0, 0, 0, 0,
        ])
      }
    }
  })
})
