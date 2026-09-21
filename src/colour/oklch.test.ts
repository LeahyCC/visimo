import { describe, expect, it } from 'vitest'

import {
  clipChroma,
  hueGap,
  inGamut,
  linearSrgbToOklch,
  linearToSrgb,
  mixHue,
  mixOklch,
  oklchToLinearSrgb,
  oklchToSrgb,
  srgbToLinear,
  srgbToOklch,
  wrapHue,
} from './oklch'
import type { Oklch, Rgb } from './oklch'

/**
 * The sRGB primaries and secondaries as CSS Color Module Level 4 publishes
 * them in OKLCH, which are Ottosson's OKLab of each colour. Four decimals for
 * lightness and chroma, two for the hue in degrees.
 */
const PUBLISHED: readonly { name: string; rgb: Rgb; oklch: Oklch }[] = [
  { name: 'white', rgb: [1, 1, 1], oklch: { l: 1, c: 0, h: 0 } },
  { name: 'red', rgb: [1, 0, 0], oklch: { l: 0.628, c: 0.2577, h: 29.23 } },
  { name: 'green', rgb: [0, 1, 0], oklch: { l: 0.8664, c: 0.2948, h: 142.5 } },
  { name: 'blue', rgb: [0, 0, 1], oklch: { l: 0.452, c: 0.3132, h: 264.05 } },
  { name: 'yellow', rgb: [1, 1, 0], oklch: { l: 0.968, c: 0.211, h: 109.77 } },
  { name: 'cyan', rgb: [0, 1, 1], oklch: { l: 0.9054, c: 0.1545, h: 194.77 } },
  { name: 'magenta', rgb: [1, 0, 1], oklch: { l: 0.7017, c: 0.3225, h: 328.36 } },
]

describe('OKLCH against published values', () => {
  for (const { name, rgb, oklch } of PUBLISHED) {
    it(`reads ${name} the way the reference does`, () => {
      const got = srgbToOklch(rgb)
      expect(got.l).toBeCloseTo(oklch.l, 3)
      expect(got.c).toBeCloseTo(oklch.c, 3)
      // A grey has no hue to compare.
      if (oklch.c > 0.01) expect(got.h).toBeCloseTo(oklch.h, 1)
    })

    // Unclipped, because the published figures are rounded and the primaries
    // sit on the corners of the gamut, where a rounding error is a hair outside
    // it and a clip would move the colour a long way to fix it.
    it(`turns the published ${name} back into its linear sRGB`, () => {
      const linear = oklchToLinearSrgb(oklch)
      linear.forEach((value, index) => expect(value).toBeCloseTo(rgb[index] ?? 0, 2))
    })
  }

  it('keeps black at zero lightness and no chroma', () => {
    const black = srgbToOklch([0, 0, 0])
    expect(black.l).toBeCloseTo(0, 9)
    expect(black.c).toBeCloseTo(0, 9)
  })

  it('reads a mid grey as a grey, at the lightness the cube root of its linear value says', () => {
    // 0.5 encoded is 0.2140 linear, and a grey's lightness is the cube root of that.
    const grey = srgbToOklch([0.5, 0.5, 0.5])
    expect(grey.l).toBeCloseTo(Math.cbrt(srgbToLinear(0.5)), 3)
    expect(grey.c).toBeLessThan(1e-3)
  })
})

describe('the conversion', () => {
  it('round trips linear sRGB through OKLCH', () => {
    for (const rgb of [
      [0.2, 0.5, 0.8],
      [0.9, 0.1, 0.3],
      [0.04, 0.09, 0.34],
      [1, 0.5, 0],
    ] as Rgb[]) {
      const back = oklchToLinearSrgb(linearSrgbToOklch(rgb))
      back.forEach((value, index) => expect(value).toBeCloseTo(rgb[index] ?? 0, 6))
    }
  })

  it('round trips the sRGB transfer function', () => {
    for (const value of [0, 0.001, 0.04, 0.2, 0.5, 0.9, 1])
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 9)
  })

  it('has a hue of 0 for a grey and one in 0 to 360 for everything else', () => {
    expect(linearSrgbToOklch([0.3, 0.3, 0.3]).h).toBe(0)
    for (const rgb of [
      [1, 0, 0],
      [0, 0, 1],
      [0.2, 0.4, 0.1],
    ] as Rgb[]) {
      const { h } = linearSrgbToOklch(rgb)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(360)
    }
  })

  it('folds any angle into 0 to 360', () => {
    expect(wrapHue(-30)).toBe(330)
    expect(wrapHue(390)).toBe(30)
    expect(wrapHue(720)).toBe(0)
    expect(wrapHue(0)).toBe(0)
  })
})

describe('the gamut', () => {
  it('says a colour is out when a channel is past either end', () => {
    expect(inGamut([0.2, 0.4, 0.6])).toBe(true)
    expect(inGamut([1.2, 0.4, 0.6])).toBe(false)
    expect(inGamut([0.2, -0.1, 0.6])).toBe(false)
  })

  it('leaves a colour that fits exactly as it was', () => {
    const colour = { l: 0.6, c: 0.1, h: 200 }
    expect(clipChroma(colour)).toEqual(colour)
  })

  it('reduces chroma and keeps lightness and hue when a colour does not fit', () => {
    const wild = { l: 0.5, c: 0.4, h: 150 }
    expect(inGamut(oklchToLinearSrgb(wild))).toBe(false)
    const clipped = clipChroma(wild)
    expect(clipped.l).toBe(wild.l)
    expect(clipped.h).toBe(wild.h)
    expect(clipped.c).toBeLessThan(wild.c)
    expect(clipped.c).toBeGreaterThan(0)
    expect(inGamut(oklchToLinearSrgb(clipped))).toBe(true)
  })

  it('stops at the edge and not short of it', () => {
    const clipped = clipChroma({ l: 0.5, c: 0.4, h: 150 })
    // A hair more chroma is out, so the search did not settle early.
    expect(inGamut(oklchToLinearSrgb({ ...clipped, c: clipped.c + 1e-4 }))).toBe(false)
  })

  it('makes white and black of any lightness at or past the ends, whatever the chroma', () => {
    oklchToSrgb({ l: 1.2, c: 0.3, h: 40 }).forEach((value) => expect(value).toBeCloseTo(1, 9))
    expect(oklchToSrgb({ l: -0.1, c: 0.3, h: 40 })).toEqual([0, 0, 0])
  })

  it('always hands back encoded channels inside 0 to 1, for colours far outside the gamut', () => {
    for (let l = 0.05; l < 1; l += 0.1)
      for (let h = 0; h < 360; h += 30) {
        const rgb = oklchToSrgb({ l, c: 0.6, h })
        for (const channel of rgb) {
          expect(channel).toBeGreaterThanOrEqual(0)
          expect(channel).toBeLessThanOrEqual(1)
        }
      }
  })
})

describe('mixing', () => {
  it('goes the short way round the hue circle', () => {
    expect(mixHue(350, 10, 0.5)).toBeCloseTo(0, 9)
    expect(mixHue(10, 350, 0.5)).toBeCloseTo(0, 9)
    expect(mixHue(350, 10, 0.25)).toBeCloseTo(355, 9)
    expect(mixHue(30, 90, 0.5)).toBeCloseTo(60, 9)
  })

  it('takes a quarter of the way as a quarter of the short arc, either side of the seam', () => {
    expect(mixHue(340, 40, 0.25)).toBeCloseTo(355, 9)
    expect(mixHue(40, 340, 0.25)).toBeCloseTo(25, 9)
  })

  it('gives the signed short gap between two hues, and goes up when they are opposite', () => {
    expect(hueGap(350, 10)).toBeCloseTo(20, 9)
    expect(hueGap(10, 350)).toBeCloseTo(-20, 9)
    expect(hueGap(30, 90)).toBeCloseTo(60, 9)
    expect(hueGap(90, 30)).toBeCloseTo(-60, 9)
    expect(hueGap(0, 180)).toBe(180)
    expect(hueGap(180, 0)).toBe(180)
    expect(hueGap(200, 200)).toBe(0)
  })

  it('takes the way round a caller gives it, which is how a row of pairs keeps to one route', () => {
    const from = { l: 0.5, c: 0.1, h: 30 }
    const to = { l: 0.5, c: 0.1, h: 210 }
    // 180 apart: the short way is up, through 120. A caller carrying a route
    // that came down from 250 says -180 and gets the other side, through 300.
    expect(mixOklch(from, to, 0.5).h).toBeCloseTo(120, 9)
    expect(mixOklch(from, to, 0.5, -180).h).toBeCloseTo(300, 9)
    // Or further than half a circle, which the short way never does.
    expect(mixOklch(from, to, 0.5, 340).h).toBeCloseTo(200, 9)
    // The ends are the ends whatever the route.
    expect(mixOklch(from, to, 0, -180)).toEqual(from)
    expect(mixOklch(from, to, 1, -180)).toEqual(to)
  })

  it('is the first colour at 0 and the second at 1, exactly', () => {
    const from = { l: 0.4, c: 0.12, h: 30 }
    const to = { l: 0.8, c: 0.2, h: 250 }
    expect(mixOklch(from, to, 0)).toEqual(from)
    expect(mixOklch(from, to, 1)).toEqual(to)
    expect(mixOklch(from, to, -3)).toEqual(from)
    expect(mixOklch(from, to, 4)).toEqual(to)
  })

  it('moves lightness and chroma in a straight line', () => {
    const middle = mixOklch({ l: 0.4, c: 0.1, h: 20 }, { l: 0.8, c: 0.2, h: 60 }, 0.5)
    expect(middle.l).toBeCloseTo(0.6, 9)
    expect(middle.c).toBeCloseTo(0.15, 9)
    expect(middle.h).toBeCloseTo(40, 9)
  })

  it('keeps the colour’s hue when the other end is grey', () => {
    const grey = { l: 0.5, c: 0, h: 0 }
    const colour = { l: 0.7, c: 0.15, h: 280 }
    expect(mixOklch(grey, colour, 0.3).h).toBe(280)
    expect(mixOklch(colour, grey, 0.3).h).toBe(280)
  })

  it('is brighter at the middle of two colours than sRGB’s own average of them is', () => {
    // The mud this replaces: the RGB midpoint of red and green is a dark olive,
    // while the OKLCH midpoint of the same two keeps the brightness between them.
    const red = srgbToOklch([1, 0, 0])
    const green = srgbToOklch([0, 1, 0])
    const middle = mixOklch(red, green, 0.5)
    expect(middle.l).toBeCloseTo((red.l + green.l) / 2, 9)
    const rgbMiddle = srgbToOklch([0.5, 0.5, 0])
    expect(middle.l).toBeGreaterThan(rgbMiddle.l)
  })
})
