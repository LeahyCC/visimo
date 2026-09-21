/**
 * The wide bloom, without a GPU. The passes are a few lines of WGSL each, so
 * the test carries a reference of them on plain arrays (`Grid` below, one
 * channel, since every tap treats the three the same) and runs whole frames
 * through it. What it can say is that the design is sound: light is shared out
 * and never made, the radius moves it, and nothing is lit that was dark. That
 * the shaders are that design is held by reading their constants back out of
 * the source at the bottom; what they look like needs a browser.
 */
import { describe, expect, it } from 'vitest'

import bright from '../shaders/post.bright.wgsl?raw'
import composite from '../shaders/post.composite.wgsl?raw'
import down from '../shaders/post.down.wgsl?raw'
import up from '../shaders/post.up.wgsl?raw'
import {
  BLOOM_MAX_LEVELS,
  BLOOM_MIN_LEVELS,
  BLOOM_WIDE_SHARE,
  bloomActiveLevels,
  bloomLevelCount,
  bloomWeights,
} from './bloom'
import { DITHER_STEP } from './dither'
import { BLOOM_LEVELS, bloomLevelSize, DEFAULT_POST_PARAMS } from './params'
import type { BloomParams } from './params'

const bloomAt = (radius: number, weights: BloomParams['weights'] = [0.5, 0.32, 0.18]) => ({
  ...DEFAULT_POST_PARAMS.bloom,
  radius,
  weights,
})

const weightsFor = (radius: number, count = 6) =>
  bloomWeights(bloomAt(radius), new Float32Array(count))

const sum = (values: ArrayLike<number>) => Array.from(values).reduce((a, b) => a + b, 0)

describe('how many levels the chain runs', () => {
  it('ends the chain at 16 to 32 pixels tall for every canvas the count is free on', () => {
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
      [3840, 2160],
      [7680, 4320],
      [2048, 2048],
      [1080, 1920],
    ] as const) {
      const count = bloomLevelCount(width, height)
      const size = bloomLevelSize(width, height, count - 1)
      const short = Math.min(size.width, size.height)
      expect(short, `${width} by ${height}`).toBeGreaterThanOrEqual(16)
      expect(short, `${width} by ${height}`).toBeLessThanOrEqual(33)
    }
  })

  it('is 6 at 1440p, 7 at 4K and never leaves 6 to 8', () => {
    expect(bloomLevelCount(2560, 1440)).toBe(6)
    expect(bloomLevelCount(3840, 2160)).toBe(7)
    expect(bloomLevelCount(7680, 4320)).toBe(8)
    for (const [width, height] of [
      [1, 1],
      [64, 64],
      [640, 360],
      [16000, 9000],
      [0, 0],
      [Number.NaN, 1080],
    ] as const) {
      const count = bloomLevelCount(width, height)
      expect(count, `${width} by ${height}`).toBeGreaterThanOrEqual(BLOOM_MIN_LEVELS)
      expect(count, `${width} by ${height}`).toBeLessThanOrEqual(BLOOM_MAX_LEVELS)
    }
  })

  it('follows the shorter side, so a tall canvas gets the glow a wide one does', () => {
    expect(bloomLevelCount(1080, 3840)).toBe(bloomLevelCount(3840, 1080))
  })
})

describe('what each level is worth', () => {
  it('sums to 1 at every radius and level count, and is never negative', () => {
    for (const count of [BLOOM_MIN_LEVELS, 7, BLOOM_MAX_LEVELS])
      for (let step = 0; step <= 20; step++) {
        const weights = weightsFor(step / 20, count)
        expect(sum(weights), `radius ${step / 20} over ${count}`).toBeCloseTo(1, 6)
        for (const weight of weights) expect(weight).toBeGreaterThanOrEqual(0)
      }
  })

  it('keeps exactly the tight glow at a radius of 0', () => {
    const weights = weightsFor(0, 7)
    expect(Array.from(weights.slice(0, BLOOM_LEVELS))).toEqual(
      DEFAULT_POST_PARAMS.bloom.weights.map((weight) => Math.fround(weight)),
    )
    for (const weight of weights.slice(BLOOM_LEVELS)) expect(weight).toBe(0)
    expect(bloomActiveLevels(weights)).toBe(BLOOM_LEVELS)
  })

  it('gives the wide levels more as the radius grows, and no more than their share', () => {
    let last = 0
    for (let step = 0; step <= 10; step++) {
      const wide = sum(weightsFor(step / 10, 7).slice(BLOOM_LEVELS))
      expect(wide).toBeGreaterThanOrEqual(last)
      last = wide
    }

    expect(last).toBeCloseTo(BLOOM_WIDE_SHARE, 6)
  })

  it('runs every level once the radius asks for them, and none it does not', () => {
    expect(bloomActiveLevels(weightsFor(0.001))).toBe(BLOOM_LEVELS)
    expect(bloomActiveLevels(weightsFor(0.3))).toBe(6)
    expect(bloomActiveLevels(weightsFor(1, 8))).toBe(8)
    expect(bloomActiveLevels(new Float32Array(6))).toBe(0)
  })

  it('reads a radius that is not a number as none, and holds one that is out of range', () => {
    expect(Array.from(weightsFor(Number.NaN))).toEqual(Array.from(weightsFor(0)))
    expect(Array.from(weightsFor(-3))).toEqual(Array.from(weightsFor(0)))
    expect(Array.from(weightsFor(9))).toEqual(Array.from(weightsFor(1)))
  })

  it('shares the tight glow by the weights it was given', () => {
    const weights = bloomWeights(bloomAt(0, [3, 1, 0]), new Float32Array(6))
    expect(weights[0]).toBeCloseTo(0.75, 6)
    expect(weights[1]).toBeCloseTo(0.25, 6)
    expect(weights[2]).toBe(0)
    // Nothing named and no radius is no glow at all, and no NaN.
    const none = bloomWeights(bloomAt(0, [0, Number.NaN, -1]), new Float32Array(6))
    expect(sum(none)).toBe(0)
    expect(bloomActiveLevels(none)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// A reference of the passes on plain arrays.

type Grid = { width: number; height: number; data: Float64Array }

const grid = (width: number, height: number): Grid => ({
  width,
  height,
  data: new Float64Array(width * height),
})

/** Bilinear at a uv, texel centres at half-integers and the edge clamped, as the sampler is. */
function sample(from: Grid, u: number, v: number): number {
  const x = u * from.width - 0.5
  const y = v * from.height - 0.5
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const at = (px: number, py: number) =>
    from.data[
      Math.min(Math.max(py, 0), from.height - 1) * from.width +
        Math.min(Math.max(px, 0), from.width - 1)
    ] ?? 0

  return (
    at(x0, y0) * (1 - fx) * (1 - fy) +
    at(x0 + 1, y0) * fx * (1 - fy) +
    at(x0, y0 + 1) * (1 - fx) * fy +
    at(x0 + 1, y0 + 1) * fx * fy
  )
}

/** post.bright.wgsl's threshold, for a grey pixel, whose luminance is its value. */
const keepAbove = (value: number, threshold: number, knee: number) => {
  const soft = Math.min(Math.max(value - threshold + knee, 0), 2 * knee)
  const curve = (soft * soft) / (4 * knee)
  const keep = Math.max(curve, value - threshold) / Math.max(value, 0.0001)
  return value * Math.min(Math.max(keep, 0), 1)
}

// The 13 taps in source texels, and the weight of each: the middle box counts
// for half and the four corner boxes an eighth each, as post.down.wgsl has it.
const TAPS: readonly (readonly [number, number, number])[] = (() => {
  const centre = 0.125
  const corner = 0.03125
  const inner: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]
  const boxes = [
    [
      [-2, -2],
      [0, -2],
      [-2, 0],
      [0, 0],
    ],
    [
      [0, -2],
      [2, -2],
      [0, 0],
      [2, 0],
    ],
    [
      [-2, 0],
      [0, 0],
      [-2, 2],
      [0, 2],
    ],
    [
      [0, 0],
      [2, 0],
      [0, 2],
      [2, 2],
    ],
  ]
  const out: [number, number, number][] = inner.map(([x, y]) => [x, y, centre])
  for (const box of boxes) for (const [x, y] of box) out.push([x ?? 0, y ?? 0, corner])
  return out
})()

/** A downsample into `into`, optionally thresholding each tap first (the bright pass). */
function downsample(
  from: Grid,
  into: Grid,
  keep: (value: number) => number = (value) => value,
): Grid {
  for (let y = 0; y < into.height; y++)
    for (let x = 0; x < into.width; x++) {
      const u = (x + 0.5) / into.width
      const v = (y + 0.5) / into.height
      let total = 0
      for (const [dx, dy, weight] of TAPS)
        total += keep(sample(from, u + dx / from.width, v + dy / from.height)) * weight
      into.data[y * into.width + x] = total
    }

  return into
}

/** The tent upsample of `from` added into `into`, which is first scaled by `keepOfInto`. */
function upsample(from: Grid, into: Grid, keepOfInto: number): Grid {
  for (let y = 0; y < into.height; y++)
    for (let x = 0; x < into.width; x++) {
      const u = (x + 0.5) / into.width
      const v = (y + 0.5) / into.height
      let total = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const weight = ((2 - Math.abs(dx)) * (2 - Math.abs(dy))) / 16
          total += sample(from, u + dx / from.width, v + dy / from.height) * weight
        }

      const at = y * into.width + x
      into.data[at] = total + (into.data[at] ?? 0) * keepOfInto
    }

  return into
}

/**
 * The whole chain as PostStack encodes it: the levels, each worth its weight,
 * added into level 0. Returns every level as it stands afterwards.
 */
function runChain(canvas: Grid, radius: number, threshold = 0, knee = 0.0001): Grid[] {
  const count = bloomLevelCount(canvas.width, canvas.height)
  const weights = weightsFor(radius, count)
  const active = bloomActiveLevels(weights)
  const levels: Grid[] = []
  for (let index = 0; index < count; index++) {
    const size = bloomLevelSize(canvas.width, canvas.height, index)
    levels.push(grid(size.width, size.height))
  }

  const first = levels[0]
  if (!first || active === 0) return levels
  downsample(canvas, first, (value) => keepAbove(value, threshold, knee))
  for (let index = 1; index < active; index++) {
    const above = levels[index - 1]
    const here = levels[index]
    if (above && here) downsample(above, here)
  }

  const last = levels[active - 1]
  if (last)
    for (let at = 0; at < last.data.length; at++)
      last.data[at] = (last.data[at] ?? 0) * (weights[active - 1] ?? 0)
  for (let index = active - 2; index >= 0; index--) {
    const below = levels[index + 1]
    const here = levels[index]
    if (below && here) upsample(below, here, weights[index] ?? 0)
  }

  return levels
}

/** Light in a level, in canvas pixels: each texel stands for more than one. */
const energy = (level: Grid, canvas: Grid) =>
  sum(level.data) * (canvas.width / level.width) * (canvas.height / level.height)

const SIZE = 1024
const pixel = (value: number, x = SIZE / 2, y = SIZE / 2) => {
  const canvas = grid(SIZE, SIZE)
  canvas.data[y * SIZE + x] = value
  return canvas
}

describe('the chain', () => {
  it(
    'holds the light of a single bright pixel, within a few percent, at every radius',
    { timeout: 60000 },
    () => {
      const canvas = pixel(100)
      for (const radius of [0, 0.3, 0.6, 1]) {
        const levels = runChain(canvas, radius)
        const first = levels[0]
        if (!first) throw new Error('no levels')
        expect(energy(first, canvas), `radius ${radius}`).toBeGreaterThan(100 * 0.97)
        expect(energy(first, canvas), `radius ${radius}`).toBeLessThan(100 * 1.03)
      }
    },
  )

  it('adds no light out of nowhere at any level', { timeout: 60000 }, () => {
    // Three marks, one of them on a hot pixel: whatever a level holds after
    // the chain is what the levels under it were worth, and never more than
    // was put in. The edges are far enough away that the clamp adds nothing.
    const canvas = pixel(60, 480, 500)
    canvas.data[540 * SIZE + 560] = 25
    canvas.data[520 * SIZE + 500] = 400
    const put = sum(canvas.data)
    for (const radius of [0, 1]) {
      const count = bloomLevelCount(SIZE, SIZE)
      const weights = weightsFor(radius, count)
      const levels = runChain(canvas, radius)
      for (const [index, level] of levels.entries()) {
        for (const value of level.data) {
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
        }

        // Level `index` holds its own weight and everything wider than it.
        const worth = sum(weights.slice(index))
        if (index < bloomActiveLevels(weights))
          expect(energy(level, canvas), `radius ${radius} level ${index}`).toBeLessThan(
            put * worth * 1.03,
          )
      }
    }
  })

  it('reproduces a tight glow at a radius of 0, and a wide one at 1', () => {
    const canvas = pixel(200)
    const share = (radius: number) => {
      const first = runChain(canvas, radius)[0]
      if (!first) throw new Error('no levels')
      let far = 0
      let all = 0
      for (let y = 0; y < first.height; y++)
        for (let x = 0; x < first.width; x++) {
          const value = first.data[y * first.width + x] ?? 0
          all += value
          // Half resolution, so a texel is two pixels: 24 texels is 48 pixels.
          if (Math.hypot(x - first.width / 2, y - first.height / 2) > 24) far += value
        }

      return far / all
    }

    // Three levels reach about 30 pixels from the mark and no further; a radius
    // of 1 puts a fifth of the light out past 48 of them on a 1024 pixel canvas.
    expect(share(0)).toBeLessThan(0.01)
    expect(share(1)).toBeGreaterThan(0.2)
    expect(share(0.3)).toBeGreaterThan(share(0))
    expect(share(1)).toBeGreaterThan(share(0.3))
  })

  it('glows a frame that is bright all over the same at every radius', () => {
    // The radius moves light between levels, so where a frame is flat there is
    // nowhere for it to go: this is what keeps a full frame from going milky.
    const canvas = grid(SIZE, SIZE)
    canvas.data.fill(2)
    const middle = (radius: number) => {
      const first = runChain(canvas, radius, 0.85, 0.2)[0]
      if (!first) throw new Error('no levels')
      return first.data[(first.height / 2) * first.width + first.width / 2] ?? 0
    }

    const tight = middle(0)
    expect(tight).toBeGreaterThan(0)
    expect(middle(0.3)).toBeCloseTo(tight, 3)
    expect(middle(1)).toBeCloseTo(tight, 3)
    // And it is what the bright pass let through, times the weights' whole.
    expect(tight).toBeCloseTo(keepAbove(2, 0.85, 0.2), 3)
  })

  it('stays black on silence, at every radius', () => {
    const canvas = grid(SIZE, SIZE)
    for (const radius of [0, 0.5, 1])
      // One assertion a level. One a texel was a million calls, and timed out on CI.
      for (const level of runChain(canvas, radius, 0.1, 0.5))
        expect(level.data.every((value) => Object.is(value, 0))).toBe(true)
  })

  it('lets nothing through under the threshold', () => {
    const canvas = grid(SIZE, SIZE)
    canvas.data.fill(0.5)
    const first = runChain(canvas, 1, 0.85, 0.2)[0]
    if (!first) throw new Error('no levels')
    // A frame under the threshold and its knee lights nothing.
    expect(first.data.reduce((a, b) => Math.max(a, b), 0)).toBe(0)
  })

  it('only ever scales a colour down in the bright pass', () => {
    for (const threshold of [0, 0.4, 0.85, 2])
      for (const knee of [0.0001, 0.2, 1])
        for (let value = 0; value <= 12; value += 0.25) {
          const kept = keepAbove(value, threshold, knee)
          expect(kept).toBeGreaterThanOrEqual(0)
          expect(kept).toBeLessThanOrEqual(value + 1e-12)
        }
  })
})

/** Every `const NAME: f32 = value;` in a shader, by name. */
const constants = (source: string) =>
  Object.fromEntries(
    Array.from(source.matchAll(/const (\w+): f32 = ([\d.]+);/g), (match) => [
      match[1] ?? '',
      Number(match[2]),
    ]),
  )

describe('the shaders are the design', () => {
  it('weights the 13 taps so they sum to 1, in the bright pass and the downsample', () => {
    for (const source of [bright, down]) {
      const { CENTRE = 0, CORNER = 0 } = constants(source)
      // Four taps at the centre's weight and sixteen at the corner's.
      expect(4 * CENTRE + 16 * CORNER).toBeCloseTo(1, 10)
    }

    // The reference above uses those same numbers.
    expect(TAPS).toHaveLength(20)
    expect(sum(TAPS.map((tap) => tap[2]))).toBeCloseTo(1, 10)
    expect(constants(down).CENTRE).toBe(0.125)
    expect(constants(down).CORNER).toBe(0.03125)
  })

  it('weights the tent so it sums to 1', () => {
    const { MIDDLE = 0, SIDE = 0, EDGE = 0 } = constants(up)
    expect(MIDDLE + 4 * SIDE + 4 * EDGE).toBeCloseTo(1, 10)
    expect([MIDDLE, SIDE, EDGE]).toEqual([4 / 16, 2 / 16, 1 / 16])
  })

  it('takes thirteen taps in the bright pass and the downsample, and nine in the tent', () => {
    const taps = (source: string, name: string) =>
      source.split('\n').filter((line) => line.includes(name)).length
    expect(taps(down, 'textureSample(source')).toBe(13)
    expect(taps(bright, 'tap(in.uv')).toBe(13)
    expect(taps(up, 'textureSample(source')).toBe(9)
  })

  it('reads its own texel from the texture, so no uniform carries a step', () => {
    for (const source of [bright, down, up]) expect(source).toContain('textureDimensions(source)')
  })

  it('makes one bind group layout enough: the down and up passes touch only bindings 1 and 2', () => {
    for (const source of [down, up]) {
      expect(source).toContain('@group(0) @binding(1)')
      expect(source).toContain('@group(0) @binding(2)')
      expect(source).not.toContain('@binding(0)')
    }

    expect(bright).toContain('@group(0) @binding(0) var<uniform> post')
  })

  it('reads the chain in the composite as one texture, and tints without adding light', () => {
    expect(composite).toContain('@binding(3) var bloom: texture_2d<f32>')
    expect(composite).not.toContain('bloom1')
    // The tint keeps the glow's brightest channel, so it changes colour only.
    expect(composite).toContain('post.glow.yzw * lit')
  })

  it('dithers by less than half a code value, whatever the grain says', () => {
    expect(composite).toContain('(noise - 0.5) / 255.0')
    expect(DITHER_STEP).toBe(1 / 255)
  })
})
