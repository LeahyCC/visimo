/**
 * The streaks' numbers without a device: where they are, that they are the
 * same at any frame rate and any canvas shape, that they draw nothing until
 * tension lifts them, and that they stay sparse.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { ribbonColour } from '../post/params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { findStudy } from '../studies/registry'
import { resolveStudy } from '../studies/resolve'
import {
  advanceTravel,
  fillStreaks,
  hash01,
  MAX_STREAKS,
  STREAK_AT,
  STREAK_FLOATS,
  STREAK_RANGES,
  streakCoverage,
  streakParams,
  streakWidthPixels,
  travelled,
  writeStreakUniform,
} from './streaks.params'
import type { StreakParams } from './streaks.params'

const study = findStudy('riser-streaks')
if (!study) throw new Error('Expected the riser streaks study')

const silence = () => new Float32Array(PACKET_LENGTH)

/** Every field at one level, the way the registry guard's full packet is. */
const loud = (level: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') out[F[field]] = level
  return out
}

/** The study's own numbers at a packet and a tension, clamped the way the ink clamps them. */
const knobsAt = (packet: Float32Array, tension: number): StreakParams =>
  streakParams(resolveStudy(study, undefined, packet, tension, 1, {}))

const buffer = () => new Float32Array(MAX_STREAKS * STREAK_FLOATS)

/** A study's numbers written by hand, everything not named at rest. */
const params = (over: Partial<StreakParams> = {}): StreakParams => ({
  count: 24,
  length: 0.3,
  speed: 0.5,
  width: 2,
  intensity: 0.3,
  hueSpread: 0,
  ...over,
})

const SIZES = [
  [1920, 1080],
  [1080, 1920],
  [2560, 1440],
  [3840, 2160],
  [1080, 1080],
  [320, 320],
] as const

const read = (out: Float32Array, index: number, field: keyof typeof STREAK_AT) =>
  out[index * STREAK_FLOATS + STREAK_AT[field]] ?? Number.NaN

describe('the streaks’ knobs', () => {
  it('are clamped to their ranges', () => {
    const wild = streakParams({
      count: 500,
      length: 9,
      speed: -4,
      width: 99,
      intensity: 7,
      hueSpread: 3,
    })
    expect(wild.count).toBe(STREAK_RANGES.count[1])
    expect(wild.length).toBe(STREAK_RANGES.length[1])
    expect(wild.speed).toBe(0)
    expect(wild.width).toBe(STREAK_RANGES.width[1])
    expect(wild.intensity).toBe(1)
    expect(wild.hueSpread).toBe(STREAK_RANGES.hueSpread[1])
  })

  it('read as nothing when they are missing or not numbers', () => {
    expect(streakParams({})).toEqual({
      count: 0,
      length: 0,
      speed: 0,
      width: 0,
      intensity: 0,
      hueSpread: 0,
    })
    expect(streakParams({ count: Number.NaN, length: Number.POSITIVE_INFINITY }).count).toBe(0)
    expect(streakParams({ length: Number.POSITIVE_INFINITY }).length).toBe(0)
  })
})

describe('the hash', () => {
  it('is the same for the same inputs and always in [0, 1)', () => {
    for (let index = 0; index < 200; index += 1) {
      const value = hash01(index, index * 7, 3)
      expect(value).toBe(hash01(index, index * 7, 3))
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('changes with each of its three inputs and spreads evenly', () => {
    expect(hash01(1, 0, 0)).not.toBe(hash01(2, 0, 0))
    expect(hash01(1, 0, 0)).not.toBe(hash01(1, 1, 0))
    expect(hash01(1, 0, 0)).not.toBe(hash01(1, 0, 1))
    let sum = 0
    const buckets = new Array<number>(10).fill(0)
    for (let index = 0; index < 5000; index += 1) {
      const value = hash01(index, 0, 3)
      sum += value
      buckets[Math.floor(value * 10)] = (buckets[Math.floor(value * 10)] ?? 0) + 1
    }

    expect(sum / 5000).toBeCloseTo(0.5, 1)
    for (const count of buckets) expect(count).toBeGreaterThan(400)
  })
})

describe('travel', () => {
  // Per second, never per frame: the clock a streak reads is speed times the
  // real time, so a second is a second at any rate the display runs at.
  it('is the same after a second at any frame rate', () => {
    const advanced = (fps: number) => {
      let phase = 0
      for (let frame = 0; frame < fps * 2; frame += 1) phase = advanceTravel(phase, 0.75, 1 / fps)
      return phase
    }

    for (const fps of [24, 30, 60, 120, 144, 240]) expect(advanced(fps)).toBeCloseTo(1.5, 9)
  })

  it('does not move on a step that is not a step, or a speed below nothing', () => {
    expect(advanceTravel(2, 1, 0)).toBe(2)
    expect(advanceTravel(2, 1, -0.1)).toBe(2)
    expect(advanceTravel(2, 1, Number.NaN)).toBe(2)
    expect(advanceTravel(2, -1, 0.1)).toBe(2)
  })

  it('leaves every streak where it was at any frame rate', () => {
    const packet = silence()
    packet[F.keyHue] = 0.3
    const settings = params({ speed: 1.1 })
    const place = (fps: number) => {
      let phase = 0
      for (let frame = 0; frame < fps * 3; frame += 1)
        phase = advanceTravel(phase, settings.speed, 1 / fps)
      const out = buffer()
      fillStreaks(settings, phase, packet, 1920, 1080, out)
      return out
    }

    const reference = place(60)
    for (const fps of [30, 144, 240]) {
      const out = place(fps)
      // Pixels held as 32-bit floats, so a few thousandths is the same place.
      for (let at = 0; at < settings.count * STREAK_FLOATS; at += 1)
        expect(out[at]).toBeCloseTo(reference[at] ?? Number.NaN, 2)
    }
  })

  it('plays the same picture twice from the same clock', () => {
    const first = buffer()
    const second = buffer()
    fillStreaks(params(), 4.2, loud(0.5), 1920, 1080, first)
    fillStreaks(params(), 4.2, loud(0.5), 1920, 1080, second)
    expect(first).toEqual(second)
  })

  it('reaches a new ray each time a streak is reborn', () => {
    const packet = silence()
    const settings = params({ count: 1 })
    const angleAt = (phase: number) => {
      const out = buffer()
      fillStreaks(settings, phase, packet, 1920, 1080, out)
      return Math.atan2(read(out, 0, 'sin'), read(out, 0, 'cos'))
    }

    const seen = new Set<string>()
    // Two units of clock apart is more than a lap even for the slowest
    // streak, so every one of these is a generation of its own.
    for (let lap = 0; lap < 12; lap += 1) seen.add(angleAt(lap * 2).toFixed(6))
    expect(seen.size).toBe(12)
  })
})

describe('a streak', () => {
  const packet = silence()

  /**
   * The shared clock at which streak 0 is `trip` of the way along its `lap`th
   * lap. Its travel is a start plus a rate times the clock, so the start is
   * the travel at 0 and the rate is what one more unit of clock adds.
   */
  const clockFor = (lap: number, trip: number) => {
    const start = travelled(0, 0)
    return (lap + trip - start) / (travelled(0, 1) - start)
  }

  it('is drawn only when there is a count, light, length and width', () => {
    for (const off of [{ count: 0 }, { intensity: 0 }, { length: 0 }, { width: 0 }]) {
      const out = buffer().fill(-1)
      expect(fillStreaks(params(off), 3, packet, 1920, 1080, out)).toBe(0)
      // Nothing written either, so nothing is uploaded.
      expect(out.every((value) => value === -1)).toBe(true)
    }
  })

  it('lights streaks in one at a time as the count climbs', () => {
    const full = buffer()
    const half = buffer()
    expect(fillStreaks(params({ count: 3 }), 2, packet, 1920, 1080, full)).toBe(3)
    expect(fillStreaks(params({ count: 2.5 }), 2, packet, 1920, 1080, half)).toBe(3)
    // The streaks that are fully lit are the same in both; the last is half.
    for (let index = 0; index < 2; index += 1)
      expect(read(half, index, 'red')).toBeCloseTo(read(full, index, 'red'), 9)
    expect(read(half, 2, 'red')).toBeCloseTo(read(full, 2, 'red') * 0.5, 9)
    expect(fillStreaks(params({ count: 999 }), 2, packet, 1920, 1080, buffer())).toBe(MAX_STREAKS)
  })

  it('sits on a ray from the middle of the canvas and never past its edge', () => {
    for (const [width, height] of SIZES) {
      const out = buffer()
      for (let step = 0; step < 40; step += 1) {
        const lit = fillStreaks(
          params({ count: MAX_STREAKS }),
          step * 0.37,
          packet,
          width,
          height,
          out,
        )
        for (let index = 0; index < lit; index += 1) {
          const cos = read(out, index, 'cos')
          const sin = read(out, index, 'sin')
          // A unit direction in pixels, so an angle is an angle and not a
          // fraction of a side.
          expect(cos * cos + sin * sin).toBeCloseTo(1, 5)
          const head = read(out, index, 'head')
          expect(head).toBeGreaterThan(0)
          expect(read(out, index, 'tail')).toBeGreaterThan(head)
          expect(Math.abs(cos * head)).toBeLessThanOrEqual(width / 2 + 1e-3)
          expect(Math.abs(sin * head)).toBeLessThanOrEqual(height / 2 + 1e-3)
        }
      }
    }
  })

  // A circle of streaks is a circle: the rays are spread over the angles of
  // the canvas in pixels, so on a wide canvas and a tall one alike they are
  // as often across as down. In a canvas's own units they would not be.
  it('is spread over every direction on a wide canvas and a tall one alike', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [3840, 800],
    ] as const) {
      let across = 0
      let samples = 0
      const out = buffer()
      for (let step = 0; step < 60; step += 1) {
        const lit = fillStreaks(
          params({ count: MAX_STREAKS }),
          step * 1.13,
          packet,
          width,
          height,
          out,
        )
        for (let index = 0; index < lit; index += 1) {
          across += read(out, index, 'cos') ** 2
          samples += 1
        }
      }

      expect(across / samples).toBeCloseTo(0.5, 1)
    }
  })

  it('is born on the edge, outside the eye, and reaches the eye by the end of its trip', () => {
    const out = buffer()
    const [width, height] = [1920, 1080]
    const at = (lap: number, trip: number) => {
      fillStreaks(params({ count: 1 }), clockFor(lap, trip), packet, width, height, out)
      return { cos: read(out, 0, 'cos'), sin: read(out, 0, 'sin'), head: read(out, 0, 'head') }
    }

    // A hair past the start of the lap, so rounding cannot land it on the
    // end of the one before.
    const born = at(3, 1e-7)
    const bornX = Math.abs(born.cos * born.head)
    const bornY = Math.abs(born.sin * born.head)
    // On the boundary of the canvas, one side or the other.
    expect(Math.min(Math.abs(bornX - width / 2), Math.abs(bornY - height / 2))).toBeLessThan(1e-2)
    const arrived = at(3, 0.99999)
    expect(arrived.head).toBeCloseTo(0.04 * Math.min(width, height), 1)
    expect(arrived.head).toBeLessThan(born.head)
  })

  it('fades to nothing as it reaches the eye', () => {
    const out = buffer()
    const lightAt = (trip: number) => {
      fillStreaks(params({ count: 1 }), clockFor(5, trip), packet, 1920, 1080, out)
      return Math.max(read(out, 0, 'red'), read(out, 0, 'green'), read(out, 0, 'blue'))
    }

    expect(lightAt(0.3)).toBeGreaterThan(0.1)
    expect(lightAt(0.99)).toBeLessThan(lightAt(0.3) * 0.01)
  })

  it('is as wide and as long in pixels as the canvas makes it', () => {
    expect(streakWidthPixels(2, 1920, 1080)).toBeCloseTo(2, 9)
    expect(streakWidthPixels(2, 3840, 2160)).toBeCloseTo(4, 9)
    expect(streakWidthPixels(2, 1080, 1920)).toBeCloseTo(2, 9)
    expect(streakWidthPixels(2, 540, 960)).toBeCloseTo(1, 9)
    const small = buffer()
    const big = buffer()
    fillStreaks(params({ count: 1 }), 2.2, packet, 1920, 1080, small)
    fillStreaks(params({ count: 1 }), 2.2, packet, 3840, 2160, big)
    const span = (out: Float32Array) => read(out, 0, 'tail') - read(out, 0, 'head')
    expect(span(big)).toBeCloseTo(span(small) * 2, 6)
    const uniform = writeStreakUniform(params(), 3840, 2160, new Float32Array(4))
    expect([...uniform]).toEqual([3840, 2160, 4, 0])
  })
})

describe('the colour of a streak', () => {
  it('is the ribbon’s, at the song’s key, when the hues are not scattered', () => {
    for (const keyHue of [0, 0.21, 0.5, 0.83]) {
      const packet = silence()
      packet[F.keyHue] = keyHue
      const out = buffer()
      fillStreaks(params({ hueSpread: 0, count: 8 }), 1.7, packet, 1920, 1080, out)
      const [red, green, blue] = ribbonColour(packet)
      for (let index = 0; index < 8; index += 1) {
        const light = Math.max(
          read(out, index, 'red'),
          read(out, index, 'green'),
          read(out, index, 'blue'),
        )
        expect(light).toBeGreaterThan(0)
        expect(read(out, index, 'red') / light).toBeCloseTo(red, 5)
        expect(read(out, index, 'green') / light).toBeCloseTo(green, 5)
        expect(read(out, index, 'blue') / light).toBeCloseTo(blue, 5)
      }
    }
  })

  it('moves with the key', () => {
    const one = silence()
    const other = silence()
    other[F.keyHue] = 0.45
    const first = buffer()
    const second = buffer()
    fillStreaks(params(), 1, one, 1920, 1080, first)
    fillStreaks(params(), 1, other, 1920, 1080, second)
    expect(read(first, 0, 'red')).not.toBeCloseTo(read(second, 0, 'red'), 3)
  })

  it('scatters round the ribbon’s when it is asked to', () => {
    const packet = silence()
    const still = buffer()
    const spread = buffer()
    fillStreaks(params({ hueSpread: 0, count: 24 }), 1.3, packet, 1920, 1080, still)
    fillStreaks(params({ hueSpread: 0.4, count: 24 }), 1.3, packet, 1920, 1080, spread)
    const peak = (out: Float32Array, index: number) =>
      Math.max(read(out, index, 'red'), read(out, index, 'green'), read(out, index, 'blue'))
    // The colour without its light, so a streak that has faded still counts.
    const hue = (out: Float32Array, index: number) =>
      (['red', 'green', 'blue'] as const).map((part) => read(out, index, part) / peak(out, index))
    let differing = 0
    let counted = 0
    for (let index = 0; index < 24; index += 1) {
      if (peak(still, index) < 1e-4) continue
      counted += 1
      const [one, two] = [hue(still, index), hue(spread, index)]
      if (one.some((value, part) => Math.abs(value - (two[part] ?? value)) > 0.02)) differing += 1
    }

    expect(differing).toBeGreaterThan(counted / 2)
    // Every colour is still the palette's, at the peak the ribbon uses: the
    // brightest channel is never more than the light the streak has.
    for (let index = 0; index < 24; index += 1)
      expect(peak(spread, index)).toBeLessThanOrEqual(0.3 + 1e-6)
  })
})

describe('riser streaks, wound up by tension', () => {
  it('draw nothing at tension 0, in silence or under a full packet', () => {
    for (const packet of [silence(), loud(1)]) {
      const rest = knobsAt(packet, 0)
      expect(rest.count).toBe(0)
      expect(rest.intensity).toBe(0)
      expect(fillStreaks(rest, 3, packet, 1920, 1080, buffer())).toBe(0)
    }
  })

  it('climb through a build: more of them, longer, faster, brighter and finer', () => {
    const packet = silence()
    const levels = [0, 0.25, 0.5, 0.75, 1].map((tension) => knobsAt(packet, tension))
    for (let at = 1; at < levels.length; at += 1) {
      const before = levels[at - 1]
      const now = levels[at]
      if (!before || !now) throw new Error('Expected five levels')
      expect(now.count).toBeGreaterThan(before.count)
      expect(now.length).toBeGreaterThan(before.length)
      expect(now.speed).toBeGreaterThan(before.speed)
      expect(now.intensity).toBeGreaterThan(before.intensity)
      expect(now.width).toBeLessThan(before.width)
    }

    expect(fillStreaks(levels[2] ?? params(), 3, packet, 1920, 1080, buffer())).toBe(24)
    expect(fillStreaks(levels[4] ?? params(), 3, packet, 1920, 1080, buffer())).toBe(48)
  })

  it('go when the build does', () => {
    const packet = silence()
    expect(fillStreaks(knobsAt(packet, 0.6), 3, packet, 1920, 1080, buffer())).toBeGreaterThan(0)
    expect(fillStreaks(knobsAt(packet, 0), 3, packet, 1920, 1080, buffer())).toBe(0)
  })

  // The one fast row: a build with a busy top end flicks its streaks longer.
  it('flick longer on the onset flux', () => {
    const quiet = silence()
    const busy = silence()
    busy[F.flux] = 1
    expect(knobsAt(busy, 1).length).toBeGreaterThan(knobsAt(quiet, 1).length + 0.05)
  })

  it('stay in their ranges at full tension, on a full packet', () => {
    const wound = knobsAt(loud(1), 1)
    for (const [knob, [low, high]] of Object.entries(STREAK_RANGES)) {
      const value = wound[knob as keyof StreakParams]
      expect(value).toBeGreaterThanOrEqual(low)
      expect(value).toBeLessThanOrEqual(high)
    }
  })
})

describe('the coverage of the frame', () => {
  const wound = knobsAt(loud(1), 1)

  it('is a few percent at full tension on a square canvas and less on a wide one', () => {
    // 48 streaks, 0.48 of the short side long and 1.5 px wide at 1080 high.
    expect(streakCoverage(wound, 1080, 1080)).toBeCloseTo(0.032, 3)
    expect(streakCoverage(wound, 1920, 1080)).toBeCloseTo(0.018, 3)
  })

  it('is under a tenth at full tension on every canvas shape and size', () => {
    for (const [width, height] of SIZES)
      expect(streakCoverage(wound, width, height), `${width} by ${height}`).toBeLessThan(0.1)
  })

  // Length and width both scale with the short side, so a bigger canvas is
  // not a busier one.
  it('does not change with the size of a canvas of the same shape', () => {
    const small = streakCoverage(wound, 1280, 720)
    for (const scale of [1.5, 2, 3])
      expect(streakCoverage(wound, 1280 * scale, 720 * scale)).toBeCloseTo(small, 9)
  })

  it('is nothing when nothing is lit', () => {
    expect(streakCoverage(knobsAt(silence(), 0), 1920, 1080)).toBe(0)
  })
})
