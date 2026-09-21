/**
 * The raymarch kit's pure half: how big a marched ink draws, and the two
 * pieces of shader arithmetic mirrored on the CPU. The sizing is here because
 * it decides when a texture is remade, which is the one allocation the kit
 * makes; the camera and the smooth minimum are here because they are copies of
 * WGSL nothing else can run, and a copy that drifts is worse than no copy.
 */
import { describe, expect, it } from 'vitest'

import {
  HALF_SIZE,
  MAX_SCALE,
  MIN_SCALE,
  raymarchRay,
  raymarchScale,
  raymarchSize,
  SCALE_STEP,
  smoothMin,
} from './raymarch.params'
import type { RaymarchCamera, Vector } from './raymarch.params'

const length = (v: Vector) => Math.hypot(v[0], v[1], v[2])
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/** The shape morph's own camera: back along z, looking at the origin. */
const camera: RaymarchCamera = { eye: [0, 0, -3.8], look: [0, 0, 0], fov: 1, aspect: 16 / 9 }

describe('the marched size', () => {
  it('holds a scale inside its range and snaps it to a step', () => {
    expect(raymarchScale(HALF_SIZE)).toBeCloseTo(HALF_SIZE, 10)
    expect(raymarchScale(0.01)).toBeCloseTo(MIN_SCALE, 10)
    expect(raymarchScale(4)).toBeCloseTo(MAX_SCALE, 10)
    // Two scales a hair apart land on one step, which is what keeps a knob
    // sliding with a level from remaking the target every frame.
    expect(raymarchScale(0.51)).toBe(raymarchScale(0.53))
    expect(raymarchScale(0.62)).toBeCloseTo(0.625, 10)
    for (const scale of [0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1])
      expect(raymarchScale(scale)).toBeCloseTo(scale, 10)
  })

  it('takes a scale that is not a number as the half it defaults to', () => {
    expect(raymarchScale(Number.NaN)).toBeCloseTo(HALF_SIZE, 10)
    expect(raymarchScale(Number.POSITIVE_INFINITY)).toBeCloseTo(HALF_SIZE, 10)
  })

  it('halves a canvas both ways at the default scale', () => {
    expect(raymarchSize(2560, 1440, HALF_SIZE)).toEqual([1280, 720])
    expect(raymarchSize(1920, 1080, HALF_SIZE)).toEqual([960, 540])
  })

  it('never goes under one texel or over the target it is scaled into', () => {
    expect(raymarchSize(1, 1, MIN_SCALE)).toEqual([1, 1])
    expect(raymarchSize(3, 1, MIN_SCALE)).toEqual([1, 1])
    expect(raymarchSize(2560, 1440, MAX_SCALE)).toEqual([2560, 1440])
    expect(raymarchSize(0, -4, HALF_SIZE)).toEqual([1, 1])
    expect(raymarchSize(Number.NaN, 1080, HALF_SIZE)).toEqual([1, 540])
  })

  it('keeps a canvas its own shape, so the ink is not stretched by the upscale', () => {
    for (const [width, height] of [
      [2560, 1440],
      [1080, 1920],
      [1000, 1000],
      [3840, 2160],
    ]) {
      const [marched, tall] = raymarchSize(width ?? 1, height ?? 1, HALF_SIZE)
      expect(marched / tall).toBeCloseTo((width ?? 1) / (height ?? 1), 2)
    }
  })

  it('changes size only in steps of the scale, so the target is rarely remade', () => {
    const sizes = new Set<string>()
    for (let scale = MIN_SCALE; scale <= MAX_SCALE; scale += 0.001)
      sizes.add(raymarchSize(1920, 1080, scale).join('x'))
    expect(sizes.size).toBeLessThanOrEqual((MAX_SCALE - MIN_SCALE) / SCALE_STEP + 1)
  })
})

describe('the camera', () => {
  it('hands back a direction, always', () => {
    for (const ndc of [
      [0, 0],
      [1, 1],
      [-1, -1],
      [0.3, -0.8],
    ] as const)
      expect(length(raymarchRay(camera, ndc))).toBeCloseTo(1, 10)
  })

  it('looks through the middle of the target straight at what it is looking at', () => {
    const ray = raymarchRay(camera, [0, 0])
    expect(ray[0]).toBeCloseTo(0, 10)
    expect(ray[1]).toBeCloseTo(0, 10)
    expect(ray[2]).toBeCloseTo(1, 10)
  })

  it('opens to the field of view it was given, up and down', () => {
    const up = raymarchRay(camera, [0, 1])
    // The vertical half angle is the field of view's half, whatever the aspect.
    expect(Math.atan2(up[1], up[2])).toBeCloseTo(camera.fov / 2, 6)
    const down = raymarchRay(camera, [0, -1])
    expect(down[1]).toBeCloseTo(-up[1], 10)
    expect(down[2]).toBeCloseTo(up[2], 10)
  })

  it('sees further to the side on a wider target, rather than the same scene stretched', () => {
    // The angle off the axis, whichever way round the camera's own right runs.
    const across = (ndc: readonly [number, number], aspect: number) => {
      const ray = raymarchRay({ ...camera, aspect }, ndc)
      return Math.abs(Math.atan2(ray[0], ray[2]))
    }

    expect(across([1, 0], 2)).toBeGreaterThan(across([1, 0], 1))
    // A square target's horizontal half angle is the vertical one exactly.
    expect(across([1, 0], 1)).toBeCloseTo(camera.fov / 2, 6)
    // The two sides are the same angle either way about the axis.
    expect(across([-1, 0], 16 / 9)).toBeCloseTo(across([1, 0], 16 / 9), 10)
  })

  it('borrows another axis when it is looking straight up, rather than handing back nothing', () => {
    const straight: RaymarchCamera = { eye: [0, -2, 0], look: [0, 0, 0], fov: 1, aspect: 1 }
    for (const ndc of [
      [0, 0],
      [1, -1],
    ] as const) {
      const ray = raymarchRay(straight, ndc)
      expect(Number.isFinite(ray[0]) && Number.isFinite(ray[1]) && Number.isFinite(ray[2])).toBe(
        true,
      )

      expect(length(ray)).toBeCloseTo(1, 10)
    }

    // Straight up is still straight up through the middle.
    expect(dot(raymarchRay(straight, [0, 0]), [0, 1, 0])).toBeCloseTo(1, 10)
  })
})

describe('the smooth minimum', () => {
  it('is the plain minimum with no width, and outside the band', () => {
    expect(smoothMin(3, 7, 0)).toBe(3)
    expect(smoothMin(3, 7, -1)).toBe(3)
    // The band is k either side, times the 4 the formula normalises by.
    expect(smoothMin(0, 10, 0.5)).toBeCloseTo(0, 10)
  })

  it('is never above the plain minimum, and never far below it', () => {
    for (let a = -2; a <= 2; a += 0.1)
      for (let b = -2; b <= 2; b += 0.1)
        for (const k of [0.05, 0.2, 0.5]) {
          const blended = smoothMin(a, b, k)
          expect(blended).toBeLessThanOrEqual(Math.min(a, b) + 1e-12)
          // The most it can dip is a quarter of the band, at the point the two
          // shapes are equally far, which is what bounds the weld's size.
          expect(blended).toBeGreaterThanOrEqual(Math.min(a, b) - k)
        }
  })

  it('dips furthest where the two are equal, which is where the weld sits', () => {
    const k = 0.25
    const middle = smoothMin(1, 1, k)
    expect(middle).toBeCloseTo(1 - k, 10)
    expect(smoothMin(1, 1.2, k)).toBeGreaterThan(middle)
    expect(smoothMin(1, 0.8, k)).toBeGreaterThan(middle - 1)
  })

  it('does not care which way round it is given the two', () => {
    for (const [a, b] of [
      [0.2, 0.9],
      [-1, 0.1],
      [0.5, 0.5],
    ] as const)
      expect(smoothMin(a, b, 0.3)).toBeCloseTo(smoothMin(b, a, 0.3), 12)
  })

  it('has no step in it: the value and its slope run on through the band', () => {
    const k = 0.4
    const at = (gap: number) => smoothMin(0, gap, k)
    const step = 1e-4
    let last = (at(-2 + step) - at(-2)) / step
    for (let gap = -2; gap <= 2; gap += 0.01) {
      const slope = (at(gap + step) - at(gap)) / step
      expect(Math.abs(slope - last)).toBeLessThan(0.02)
      last = slope
    }
  })
})
