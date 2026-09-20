/**
 * The spectrum ring's numbers, with no GPU: the layout of five bands into a
 * ring that closes, how a bar's length follows its level and its band's pulse,
 * a ring that is round on any canvas, bars that never overlap at the feet, a
 * spin that is the same at any frame rate, and the coverage bound. What it looks
 * like needs a browser; that its numbers are what the shader is told does not.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  advanceSpin,
  BAND_LEVELS,
  BAND_PULSES,
  BAR_AT,
  BAR_FLOATS,
  BAR_UNIFORM_FLOATS,
  barCoverage,
  barFraction,
  barRadiusPixels,
  barWidthPixels,
  blendBands,
  EDGE_PIXELS,
  fillBars,
  KICK,
  LIGHT_FLOOR,
  MAX_BARS,
  MIN_BAR_PIXELS,
  SPECTRUM_RANGES,
  spectrumParams,
  spectrumPosition,
  writeBarUniform,
} from './spectrum.params'
import type { SpectrumParams } from './spectrum.params'

const SHAPES = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
  [2520, 1080],
  [1440, 1080],
  [3840, 2160],
  [640, 640],
  [3840, 1080],
] as const

const BASE: SpectrumParams = {
  bars: 64,
  radius: 0.22,
  length: 0.2,
  width: 3,
  intensity: 0.3,
  hueSpread: 0.3,
  spin: 0.05,
}

/** A packet with the bands and pulses given, five each, and everything else at nothing. */
function packet(levels: readonly number[], pulses: readonly number[] = [0, 0, 0, 0, 0]) {
  const out = new Float32Array(PACKET_LENGTH)
  levels.forEach((value, band) => (out[BAND_LEVELS[band] ?? 0] = value))
  pulses.forEach((value, band) => (out[BAND_PULSES[band] ?? 0] = value))
  return out
}

const rows = () => new Float32Array(MAX_BARS * BAR_FLOATS)

/** The bars for a packet, as objects, in the order the pass draws them. */
function barsOf(
  params: SpectrumParams,
  features: Float32Array,
  turns = 0,
  width = 1920,
  height = 1080,
) {
  const out = rows()
  const count = fillBars(params, features, turns, width, height, out)
  return Array.from({ length: count }, (_, bar) => {
    const at = bar * BAR_FLOATS
    return {
      cos: out[at + BAR_AT.cos] ?? Number.NaN,
      sin: out[at + BAR_AT.sin] ?? Number.NaN,
      inner: out[at + BAR_AT.inner] ?? Number.NaN,
      outer: out[at + BAR_AT.outer] ?? Number.NaN,
      light: [
        out[at + BAR_AT.red] ?? Number.NaN,
        out[at + BAR_AT.green] ?? Number.NaN,
        out[at + BAR_AT.blue] ?? Number.NaN,
      ],
    }
  })
}

describe('the knobs', () => {
  it('are clamped to their ranges, and the count is a whole number', () => {
    const wild = spectrumParams({
      bars: 500.4,
      radius: 9,
      length: -3,
      width: 99,
      intensity: 4,
      hueSpread: 2,
      spin: 40,
    })
    expect(wild.bars).toBe(MAX_BARS)
    expect(wild.radius).toBe(SPECTRUM_RANGES.radius[1])
    expect(wild.length).toBe(0)
    expect(wild.width).toBe(SPECTRUM_RANGES.width[1])
    expect(wild.intensity).toBe(SPECTRUM_RANGES.intensity[1])
    expect(wild.hueSpread).toBe(SPECTRUM_RANGES.hueSpread[1])
    expect(wild.spin).toBe(SPECTRUM_RANGES.spin[1])
    expect(spectrumParams({ bars: 31.6 }).bars).toBe(32)
  })

  it('leave nothing to draw when none is given, or when one is not a number', () => {
    expect(fillBars(spectrumParams({}), packet([1, 1, 1, 1, 1]), 0, 1920, 1080, rows())).toBe(0)
    const nan = spectrumParams({ ...BASE, length: Number.NaN, intensity: Number.NaN })
    expect(nan.length).toBe(0)
    expect(nan.intensity).toBe(0)
    expect(fillBars(nan, packet([1, 1, 1, 1, 1]), 0, 1920, 1080, rows())).toBe(0)
  })
})

describe('five bands round a ring', () => {
  it('is a run from one pole to the other and back, the same either side of the axis', () => {
    for (const bars of [8, 31, 64, 96]) {
      for (let bar = 0; bar < bars; bar += 1) {
        const here = spectrumPosition((bar + 0.5) / bars)
        const there = spectrumPosition((bars - 1 - bar + 0.5) / bars)
        expect(here, `${bar} of ${bars}`).toBeCloseTo(there, 12)
        expect(here).toBeGreaterThan(0)
        expect(here).toBeLessThanOrEqual(1)
      }
    }

    expect(spectrumPosition(0)).toBe(0)
    expect(spectrumPosition(0.5)).toBe(1)
    expect(spectrumPosition(1)).toBe(0)
  })

  it('reads a band’s own value at that band, and never a value the bands do not hold between two of them', () => {
    const values = [0.9, 0.1, 0.6, 0.3, 0.8]
    values.forEach((value, band) =>
      expect(blendBands(values, band / (values.length - 1)), `band ${band}`).toBeCloseTo(value, 12),
    )

    for (let step = 0; step <= 400; step += 1) {
      const position = step / 400
      const along = position * 4
      const below = Math.min(Math.floor(along), 3)
      const low = Math.min(values[below] ?? 0, values[below + 1] ?? 0)
      const high = Math.max(values[below] ?? 0, values[below + 1] ?? 0)
      const value = blendBands(values, position)
      expect(value).toBeGreaterThanOrEqual(low - 1e-12)
      expect(value).toBeLessThanOrEqual(high + 1e-12)
    }
  })

  it('has no slope at a band or at either pole, so the mirror is not a crease and the ring has no seam', () => {
    const values = [0.9, 0.1, 0.6, 0.3, 0.8]
    const h = 1e-5
    for (const band of [0, 1, 2, 3, 4]) {
      const at = band / 4
      const rise =
        (blendBands(values, Math.min(1, at + h)) - blendBands(values, Math.max(0, at - h))) /
        (2 * h)
      // Away from the ends it is a central difference; at the ends the one-sided one.
      expect(Math.abs(rise), `band ${band}`).toBeLessThan(1e-3)
    }
  })

  it('steps by little between neighbouring bars all the way round, the seam and the far pole included', () => {
    // The worst case is a value that swings from 1 to 0 between adjacent bands.
    const levels = [1, 0, 1, 0, 1]
    for (const bars of [32, 64, 96]) {
      const fractions = Array.from({ length: bars }, (_, bar) =>
        blendBands(levels, spectrumPosition((bar + 0.5) / bars)),
      )
      // A smoothstep climbs at most 1.5 a unit and a bar is 8 / bars of the way to the next band.
      const most = (1.5 * 8) / bars
      for (let bar = 0; bar < bars; bar += 1) {
        const next = fractions[(bar + 1) % bars] ?? 0
        expect(Math.abs(next - (fractions[bar] ?? 0)), `${bar} of ${bars}`).toBeLessThanOrEqual(
          most + 1e-9,
        )
      }
    }
  })
})

describe('a bar’s length', () => {
  it('follows its level and grows with it, to the full length and no further', () => {
    const fractions = [0, 0.1, 0.25, 0.5, 0.75, 1].map((level) => barFraction(level, 0))
    fractions.forEach((value, step) => {
      if (step > 0) expect(value).toBeGreaterThan(fractions[step - 1] ?? 0)
    })

    expect(barFraction(0, 0)).toBe(0)
    expect(barFraction(1, 0)).toBe(1)
    expect(barFraction(1, 1)).toBe(1)
    expect(barFraction(9, 9)).toBe(1)
    expect(barFraction(-1, 1)).toBe(0)
  })

  it('is kicked by its own band’s pulse, and by no other', () => {
    const level = [0.4, 0.4, 0.4, 0.4, 0.4]
    const calm = barsOf(BASE, packet(level))
    const kicked = barsOf(BASE, packet(level, [1, 0, 0, 0, 0]))
    expect(kicked).toHaveLength(calm.length)
    const span = (bar: { inner: number; outer: number } | undefined) =>
      (bar?.outer ?? 0) - (bar?.inner ?? 0)
    // The bars at the sub's pole, which are the first and the last.
    expect(span(kicked[0])).toBeGreaterThan(span(calm[0]) * (1 + KICK / 2))
    expect(span(kicked.at(-1))).toBeCloseTo(span(kicked[0]), 6)
    // A quarter of the way round the pulse's own band has gone, and the treble's pole is untouched.
    const treble = Math.floor(calm.length / 2)
    expect(span(kicked[treble])).toBeCloseTo(span(calm[treble]), 6)
    expect(span(kicked[calm.length - 1 - treble])).toBeCloseTo(span(calm[treble]), 6)
  })

  it('cannot be drawn from nothing by a pulse, so a band with no level has no bar', () => {
    expect(barsOf(BASE, packet([0, 0, 0, 0, 0], [1, 1, 1, 1, 1]))).toHaveLength(0)
  })

  it('is the ring’s mirror image, bar for bar, in length and in colour', () => {
    const features = packet([0.9, 0.2, 0.7, 0.4, 0.6], [0.3, 0, 0.8, 0, 0.1])
    features[F.keyHue] = 0.4
    const bars = barsOf({ ...BASE, bars: 48 }, features)
    expect(bars).toHaveLength(48)

    bars.forEach((bar, index) => {
      const twin = bars[bars.length - 1 - index]
      expect(bar.outer - bar.inner, `bar ${index}`).toBeCloseTo(
        (twin?.outer ?? 0) - (twin?.inner ?? 0),
        4,
      )

      bar.light.forEach((value, channel) =>
        expect(value, `bar ${index} channel ${channel}`).toBeCloseTo(twin?.light[channel] ?? 0, 5),
      )
    })
  })

  it('takes a short bar’s light down to a floor and a full bar’s up to the intensity', () => {
    const features = packet([1, 0.5, 0.05, 0.5, 1])
    const bars = barsOf(BASE, features)
    expect(bars.length).toBeGreaterThan(8)
    for (const bar of bars) {
      // The palette is scaled so its brightest channel is 1, so the brightest one here is the light itself.
      const fraction = (bar.outer - bar.inner) / (BASE.length * 1080)
      expect(Math.max(...bar.light)).toBeCloseTo(
        BASE.intensity * (LIGHT_FLOOR + (1 - LIGHT_FLOOR) * fraction),
        5,
      )
    }

    const brightest = Math.max(...bars.map((bar) => Math.max(...bar.light)))
    expect(brightest).toBeLessThanOrEqual(BASE.intensity + 1e-6)
    expect(brightest).toBeGreaterThan(BASE.intensity * 0.95)
  })

  it('draws nothing for a bar too short to see, and packs what is left to the front', () => {
    // A level so small that the longest bar is under a pixel.
    const tiny = (MIN_BAR_PIXELS * 0.5) / (BASE.length * 1080)
    expect(barsOf(BASE, packet([tiny, tiny, tiny, tiny, tiny]))).toHaveLength(0)
    const half = barsOf(BASE, packet([1, 0, 0, 0, 0]))
    expect(half.length).toBeGreaterThan(0)
    expect(half.length).toBeLessThan(BASE.bars)
    for (const bar of half) expect(bar.outer - bar.inner).toBeGreaterThanOrEqual(MIN_BAR_PIXELS)
  })
})

describe('nothing to draw', () => {
  it('draws nothing on a silent packet, and on one that is not a number', () => {
    expect(barsOf(BASE, new Float32Array(PACKET_LENGTH))).toHaveLength(0)
    expect(barsOf(BASE, new Float32Array(PACKET_LENGTH).fill(Number.NaN))).toHaveLength(0)
  })

  it('draws nothing with no count, no light, no length or no width', () => {
    const loud = packet([1, 1, 1, 1, 1])
    for (const off of [{ bars: 0 }, { intensity: 0 }, { length: 0 }, { width: 0 }])
      expect(barsOf({ ...BASE, ...off }, loud), JSON.stringify(off)).toHaveLength(0)
  })

  it('holds every level to 0 to 1, so a wild packet cannot make a bar past the length asked for', () => {
    const bars = barsOf(BASE, packet([9, 9, -3, 9, 9], [9, 9, 9, 9, 9]))
    for (const bar of bars)
      expect(bar.outer - bar.inner).toBeLessThanOrEqual(BASE.length * 1080 + 1e-6)
  })
})

describe('the ring is round and the bars are real pixels on any canvas', () => {
  it('stands every foot the same distance from the middle, evenly spaced round it, on seven shapes', () => {
    const features = packet([1, 1, 1, 1, 1])
    for (const [width, height] of SHAPES) {
      const bars = barsOf(BASE, features, 0.137, width, height)
      expect(bars, `${width} by ${height}`).toHaveLength(BASE.bars)
      const foot = barRadiusPixels(BASE, width, height)
      const angles = bars.map((bar) => {
        expect(bar.inner).toBeCloseTo(foot, 3)
        expect(Math.hypot(bar.cos, bar.sin)).toBeCloseTo(1, 6)
        return Math.atan2(bar.sin, bar.cos)
      })

      angles.forEach((angle, bar) => {
        const next = angles[(bar + 1) % angles.length] ?? 0
        const step = (((next - angle) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        expect(step, `${width} by ${height} bar ${bar}`).toBeCloseTo((2 * Math.PI) / BASE.bars, 6)
      })
    }
  })

  it('scales the foot and the length with the short side and not the width', () => {
    const features = packet([1, 1, 1, 1, 1])
    const wide = barsOf(BASE, features, 0, 3840, 1080)[0]
    const square = barsOf(BASE, features, 0, 1080, 1080)[0]
    expect(wide?.inner).toBeCloseTo(square?.inner ?? 0, 6)
    expect(wide?.outer).toBeCloseTo(square?.outer ?? 0, 6)
    const big = barsOf(BASE, features, 0, 3840, 2160)[0]
    expect(big?.inner).toBeCloseTo((square?.inner ?? 0) * 2, 6)
    expect(big?.outer).toBeCloseTo((square?.outer ?? 0) * 2, 6)
  })

  it('makes a width a real number of pixels against the short side, and hands it to the shader', () => {
    expect(barWidthPixels(3, 1920, 1080)).toBeCloseTo(3, 9)
    expect(barWidthPixels(3, 3840, 2160)).toBeCloseTo(6, 9)
    expect(barWidthPixels(3, 1080, 1920)).toBeCloseTo(3, 9)
    const out = new Float32Array(BAR_UNIFORM_FLOATS)
    writeBarUniform(BASE, 1080, 1920, out)
    expect([...out]).toEqual([1080, 1920, 3, 0])
  })

  it('puts the sub’s pole at the bottom of the frame and the treble’s at the top before it turns', () => {
    const bars = barsOf(BASE, packet([1, 1, 1, 1, 1]), 0)
    // Bar 0 is the sub's, half a step round from straight down, where y runs down.
    expect(bars[0]?.sin).toBeGreaterThan(0.99)
    const treble = bars[BASE.bars / 2 - 1]
    expect(treble?.sin).toBeLessThan(-0.99)
  })
})

describe('bars never overlap at the feet', () => {
  it('keeps the chord between neighbouring feet at a bar’s width and its edge on each side, at every count and width', () => {
    for (const [width, height] of SHAPES)
      for (const bars of [2, 3, 8, 33, 64, 96])
        for (const barWidth of [0, 1, 2.5, 5, 8])
          for (const radius of [0.05, 0.1, 0.22, 0.4]) {
            const params = { ...BASE, bars, width: barWidth, radius }
            const foot = barRadiusPixels(params, width, height)
            const chord = 2 * foot * Math.sin(Math.PI / bars)
            const need = barWidthPixels(barWidth, width, height) + 2 * EDGE_PIXELS
            expect(
              chord,
              `${bars} bars, ${barWidth} wide, radius ${radius}, ${width} by ${height}`,
            ).toBeGreaterThanOrEqual(need - 1e-9)
          }
  })

  it('leaves the study’s own radius alone whenever it has room, and only lifts it when it does not', () => {
    expect(barRadiusPixels(BASE, 1920, 1080)).toBeCloseTo(0.22 * 1080, 9)
    const crowded = { ...BASE, bars: 96, width: 8, radius: 0.05 }
    expect(barRadiusPixels(crowded, 1920, 1080)).toBeGreaterThan(0.05 * 1080 * 2)
    expect(barRadiusPixels({ ...crowded, bars: 1 }, 1920, 1080)).toBeCloseTo(0.05 * 1080, 9)
  })

  it('holds at the tightest radius the range allows with the most bars, at their widest', () => {
    const tight = { ...BASE, bars: MAX_BARS, width: SPECTRUM_RANGES.width[1], radius: 0.05 }
    const bars = barsOf(tight, packet([1, 1, 1, 1, 1]), 0, 1080, 1080)
    expect(bars).toHaveLength(MAX_BARS)
    // The foot circle's own circumference has room for every bar's width and edges.
    expect(2 * Math.PI * (bars[0]?.inner ?? 0)).toBeGreaterThanOrEqual(
      MAX_BARS * (SPECTRUM_RANGES.width[1] + 2 * EDGE_PIXELS),
    )
  })
})

describe('the ring turns per second', () => {
  it('is the same turn after the same seconds at 30, 60, 144 and 240 steps a second', () => {
    const turned = [30, 60, 144, 240].map((fps) => {
      let turns = 0
      for (let step = 0; step < 7 * fps; step += 1) turns = advanceSpin(turns, 0.13, 1 / fps)
      return turns
    })

    for (const turn of turned) expect(turn).toBeCloseTo(0.91, 6)
  })

  it('is the same through a change of spin, which is what a build asks of it, at any rate', () => {
    const turned = [30, 144].map((fps) => {
      let turns = 0
      for (let step = 0; step < 4 * fps; step += 1) {
        const seconds = step / fps
        turns = advanceSpin(turns, seconds < 2 ? 0.05 : 0.2, 1 / fps)
      }
      return turns
    })

    expect(turned[0]).toBeCloseTo(0.5, 6)
    expect(turned[1]).toBeCloseTo(0.5, 6)
  })

  it('keeps the turn under one whatever the song’s length, and ignores a step that is not a time', () => {
    let turns = 0.4
    for (let step = 0; step < 100_000; step += 1) turns = advanceSpin(turns, 0.5, 1 / 30)
    expect(turns).toBeGreaterThanOrEqual(0)
    expect(turns).toBeLessThan(1)
    expect(advanceSpin(0.3, 0.2, 0)).toBeCloseTo(0.3, 12)
    expect(advanceSpin(0.3, 0.2, Number.NaN)).toBeCloseTo(0.3, 12)
    expect(advanceSpin(0.3, 0.2, -1)).toBeCloseTo(0.3, 12)
  })

  it('carries each bar round by its turn and leaves its length and light where they were', () => {
    const features = packet([0.9, 0.3, 0.6, 0.2, 0.7])
    const still = barsOf(BASE, features, 0)
    const half = barsOf(BASE, features, 0.5)
    expect(half).toHaveLength(still.length)
    still.forEach((bar, index) => {
      expect(half[index]?.cos).toBeCloseTo(-bar.cos, 5)
      expect(half[index]?.sin).toBeCloseTo(-bar.sin, 5)
      expect(half[index]?.outer).toBeCloseTo(bar.outer, 6)
    })
  })
})

describe('how much of the frame the bars can cover', () => {
  /** The rectangles of every bar at full length, marked on a grid, counting a pixel under more than one. */
  function raster(params: SpectrumParams, width: number, height: number) {
    const bars = barsOf(params, packet([1, 1, 1, 1, 1]), 0, width, height)
    const half = barWidthPixels(params.width, width, height) / 2 + EDGE_PIXELS
    const reach = EDGE_PIXELS
    // Behind the foot the light is already nothing, and the bound is not about that sliver.
    let covered = 0
    let stacked = 0
    // Every pixel that any bar's rectangle could reach: the disc out to its longest tip.
    const outer = Math.max(...bars.map((bar) => bar.outer)) + reach + 1
    const x0 = Math.max(0, Math.floor(width / 2 - outer))
    const x1 = Math.min(width, Math.ceil(width / 2 + outer))
    const y0 = Math.max(0, Math.floor(height / 2 - outer))
    const y1 = Math.min(height, Math.ceil(height / 2 + outer))
    for (let y = y0; y < y1; y += 1)
      for (let x = x0; x < x1; x += 1) {
        const px = x + 0.5 - width / 2
        const py = y + 0.5 - height / 2
        let under = 0
        for (const bar of bars) {
          const along = px * bar.cos + py * bar.sin
          const across = -px * bar.sin + py * bar.cos
          if (along >= bar.inner && along <= bar.outer + reach && Math.abs(across) <= half)
            under += 1
        }

        if (under > 0) covered += 1
        if (under > 1) stacked += 1
      }

    return { covered: covered / (width * height), stacked }
  }

  it('is an upper bound on what a raster of the same bars lights, on every shape', () => {
    const params = { ...BASE, bars: 48, length: 0.18, width: 3.5 }
    for (const [width, height] of [
      [640, 360],
      [360, 640],
      [500, 500],
      [800, 300],
    ] as const)
      expect(raster(params, width, height).covered, `${width} by ${height}`).toBeLessThanOrEqual(
        barCoverage(params, width, height) + 1e-9,
      )
  })

  it('stacks no pixel under two bars, even with the most bars at their widest at the tightest radius', () => {
    const tight = { ...BASE, bars: MAX_BARS, width: SPECTRUM_RANGES.width[1], radius: 0.05 }
    expect(raster(tight, 400, 400).stacked).toBe(0)
    expect(raster({ ...BASE, bars: 40, radius: 0.1 }, 640, 360).stacked).toBe(0)
  })

  it('falls on a wide canvas and rises on a square one, since everything scales with the short side', () => {
    expect(barCoverage(BASE, 1080, 1080)).toBeGreaterThan(barCoverage(BASE, 1920, 1080))
    expect(barCoverage(BASE, 3840, 1080)).toBeLessThan(barCoverage(BASE, 1920, 1080))
    expect(barCoverage({ ...BASE, bars: 0 }, 1920, 1080)).toBe(0)
  })
})
