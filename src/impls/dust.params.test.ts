/**
 * The dust's numbers without a device: where the specks are, that they are the
 * same at any frame rate and any canvas shape, that they wrap without a pop,
 * that they drift on a gentle curve and twinkle slowly on their own phases,
 * and that they stay sparse.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { ribbonColour } from '../post/params'
import {
  advanceClock,
  DUST_RANGES,
  DUST_UNIFORM_FLOATS,
  dustCoverage,
  dustParams,
  fillSpecks,
  MAX_SPECKS,
  PALE,
  SPECK_AT,
  SPECK_FLOATS,
  speckDiameter,
  writeDustUniform,
} from './dust.params'
import type { DustClock, DustParams } from './dust.params'

const silence = () => new Float32Array(PACKET_LENGTH)

const buffer = () => new Float32Array(MAX_SPECKS * SPECK_FLOATS)

/** A study's numbers written by hand, everything not named at rest. */
const params = (over: Partial<DustParams> = {}): DustParams => ({
  count: 24,
  size: 8,
  drift: 0.05,
  twinkle: 0.5,
  intensity: 0.1,
  hueSpread: 0,
  gather: 0,
  ...over,
})

const clockAt = (travel: number, seconds = 0): DustClock => ({ travel, seconds })

const SIZES = [
  [1920, 1080],
  [1080, 1920],
  [2560, 1440],
  [3840, 2160],
  [3840, 1080],
  [1080, 1080],
  [320, 320],
] as const

const read = (out: Float32Array, index: number, field: keyof typeof SPECK_AT) =>
  out[index * SPECK_FLOATS + SPECK_AT[field]] ?? Number.NaN

/** The brightest channel of a speck, which is its light since the palest colour peaks at 1. */
const light = (out: Float32Array, index: number) =>
  Math.max(read(out, index, 'red'), read(out, index, 'green'), read(out, index, 'blue'))

describe('the dust’s knobs', () => {
  it('are clamped to their ranges', () => {
    const wild = dustParams({
      count: 500,
      size: 99,
      drift: -4,
      twinkle: 7,
      intensity: 7,
      hueSpread: 3,
      gather: 2,
    })
    expect(wild.count).toBe(DUST_RANGES.count[1])
    expect(wild.size).toBe(DUST_RANGES.size[1])
    expect(wild.drift).toBe(0)
    expect(wild.twinkle).toBe(1)
    expect(wild.intensity).toBe(DUST_RANGES.intensity[1])
    expect(wild.hueSpread).toBe(DUST_RANGES.hueSpread[1])
    expect(wild.gather).toBe(1)
  })

  it('read as nothing when they are missing or not numbers', () => {
    expect(dustParams({})).toEqual({
      count: 0,
      size: 0,
      drift: 0,
      twinkle: 0,
      intensity: 0,
      hueSpread: 0,
      gather: 0,
    })
    expect(dustParams({ count: Number.NaN, size: Number.POSITIVE_INFINITY }).count).toBe(0)
    expect(dustParams({ size: Number.POSITIVE_INFINITY }).size).toBe(0)
  })
})

describe('the clocks', () => {
  // Per second, never per frame: travel is drift times the real time and the
  // twinkle's clock is the real time, so a second is a second at any rate.
  it('are the same after a second at any frame rate', () => {
    const run = (fps: number) => {
      const clock = clockAt(0)
      for (let frame = 0; frame < fps * 2; frame += 1) advanceClock(clock, 0.05, 1 / fps)
      return clock
    }

    for (const fps of [24, 30, 60, 120, 144, 240]) {
      expect(run(fps).travel).toBeCloseTo(0.1, 9)
      expect(run(fps).seconds).toBeCloseTo(2, 9)
    }
  })

  it('stop travelling when the drift does and twinkle on', () => {
    const clock = clockAt(1, 1)
    advanceClock(clock, 0, 0.5)
    expect(clock).toEqual({ travel: 1, seconds: 1.5 })
  })

  it('do not move on a step that is not a step, or a drift below nothing', () => {
    for (const dt of [0, -0.1, Number.NaN]) {
      const clock = clockAt(2, 3)
      advanceClock(clock, 1, dt)
      expect(clock).toEqual({ travel: 2, seconds: 3 })
    }

    const clock = clockAt(2, 3)
    advanceClock(clock, -1, 0.1)
    expect(clock.travel).toBe(2)
  })

  it('leave every speck where it was at any frame rate', () => {
    const packet = silence()
    packet[F.keyHue] = 0.3
    const settings = params({ drift: 0.08, twinkle: 1 })
    const place = (fps: number) => {
      const clock = clockAt(0)
      for (let frame = 0; frame < fps * 3; frame += 1) advanceClock(clock, settings.drift, 1 / fps)
      const out = buffer()
      fillSpecks(settings, clock, packet, 1920, 1080, out)
      return out
    }

    const reference = place(60)
    for (const fps of [30, 144, 240]) {
      const out = place(fps)
      // Pixels held as 32-bit floats, so a few thousandths is the same place,
      // and the light comes with the twinkle, so it is the same phase too.
      for (let at = 0; at < settings.count * SPECK_FLOATS; at += 1)
        expect(out[at]).toBeCloseTo(reference[at] ?? Number.NaN, 2)
    }
  })

  it('play the same picture twice from the same clocks', () => {
    const first = buffer()
    const second = buffer()
    fillSpecks(params(), clockAt(4.2, 7.7), silence(), 1920, 1080, first)
    fillSpecks(params(), clockAt(4.2, 7.7), silence(), 1920, 1080, second)
    expect(first).toEqual(second)
  })
})

describe('a speck', () => {
  const packet = silence()

  it('is drawn only when there is a count, light and size', () => {
    for (const off of [{ count: 0 }, { intensity: 0 }, { size: 0 }]) {
      const out = buffer().fill(-1)
      expect(fillSpecks(params(off), clockAt(3), packet, 1920, 1080, out)).toBe(0)
      // Nothing written either, so nothing is uploaded.
      expect(out.every((value) => value === -1)).toBe(true)
    }
  })

  it('comes in one at a time as the count climbs', () => {
    const full = buffer()
    const half = buffer()
    expect(fillSpecks(params({ count: 3 }), clockAt(2, 1), packet, 1920, 1080, full)).toBe(3)
    expect(fillSpecks(params({ count: 2.5 }), clockAt(2, 1), packet, 1920, 1080, half)).toBe(3)
    // The specks that are fully lit are the same in both; the last is half.
    for (let index = 0; index < 2; index += 1)
      expect(read(half, index, 'red')).toBeCloseTo(read(full, index, 'red'), 9)
    expect(read(half, 2, 'red')).toBeCloseTo(read(full, 2, 'red') * 0.5, 9)
    expect(fillSpecks(params({ count: 999 }), clockAt(2), packet, 1920, 1080, buffer())).toBe(
      MAX_SPECKS,
    )
  })

  it('keeps its own place when the count changes, so the ones already there do not move', () => {
    const few = buffer()
    const many = buffer()
    fillSpecks(params({ count: 5 }), clockAt(1.3), packet, 1920, 1080, few)
    fillSpecks(params({ count: 50 }), clockAt(1.3), packet, 1920, 1080, many)
    for (let index = 0; index < 5; index += 1) {
      expect(read(many, index, 'x')).toBe(read(few, index, 'x'))
      expect(read(many, index, 'y')).toBe(read(few, index, 'y'))
    }
  })

  it('is always on the canvas, whatever the shape of it and however long the drift has run', () => {
    for (const [width, height] of SIZES) {
      const out = buffer()
      for (let step = 0; step < 60; step += 1) {
        const lit = fillSpecks(
          params({ count: MAX_SPECKS }),
          clockAt(step * 0.91),
          packet,
          width,
          height,
          out,
        )
        for (let index = 0; index < lit; index += 1) {
          expect(read(out, index, 'x')).toBeGreaterThanOrEqual(0)
          expect(read(out, index, 'x')).toBeLessThanOrEqual(width)
          expect(read(out, index, 'y')).toBeGreaterThanOrEqual(0)
          expect(read(out, index, 'y')).toBeLessThanOrEqual(height)
        }
      }
    }
  })

  it('is spread over the whole canvas, on a wide one and a tall one alike', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [3840, 800],
    ] as const) {
      const out = buffer()
      fillSpecks(params({ count: MAX_SPECKS }), clockAt(2.5), packet, width, height, out)
      let across = 0
      let down = 0
      for (let index = 0; index < MAX_SPECKS; index += 1) {
        across += read(out, index, 'x') / width
        down += read(out, index, 'y') / height
      }

      expect(Math.abs(across / MAX_SPECKS - 0.5)).toBeLessThan(0.08)
      expect(Math.abs(down / MAX_SPECKS - 0.5)).toBeLessThan(0.08)
    }
  })

  it('is as big in pixels as the canvas makes it, and round', () => {
    expect(speckDiameter(8, 1920, 1080)).toBeCloseTo(8, 9)
    expect(speckDiameter(8, 3840, 2160)).toBeCloseTo(16, 9)
    expect(speckDiameter(8, 1080, 1920)).toBeCloseTo(8, 9)
    expect(speckDiameter(8, 540, 960)).toBeCloseTo(4, 9)
    const small = buffer()
    const big = buffer()
    fillSpecks(params(), clockAt(1), packet, 1920, 1080, small)
    fillSpecks(params(), clockAt(1), packet, 3840, 2160, big)
    for (let index = 0; index < 24; index += 1) {
      expect(read(big, index, 'radius')).toBeCloseTo(read(small, index, 'radius') * 2, 6)
      // Each is between a quarter and a half of the knob across, radius being half of that.
      expect(read(small, index, 'radius')).toBeGreaterThanOrEqual(8 * 0.25 - 1e-6)
      expect(read(small, index, 'radius')).toBeLessThanOrEqual(8 * 0.5 + 1e-6)
    }

    // Size is against the short side, so the same canvas turned on its side draws the same speck.
    const tall = buffer()
    fillSpecks(params(), clockAt(1), packet, 1080, 1920, tall)
    for (let index = 0; index < 24; index += 1)
      expect(read(tall, index, 'radius')).toBeCloseTo(read(small, index, 'radius'), 9)
  })

  it('pads its two vec4s and writes nothing outside the fields the shader reads', () => {
    const out = buffer().fill(-1)
    fillSpecks(params({ count: 4 }), clockAt(1), packet, 1920, 1080, out)
    for (let index = 0; index < 4; index += 1) {
      expect(out[index * SPECK_FLOATS + 3]).toBe(0)
      expect(out[index * SPECK_FLOATS + 7]).toBe(0)
    }

    expect(out[4 * SPECK_FLOATS]).toBe(-1)
  })

  // The wrap is where a speck could pop: it leaves one edge and is at the
  // other on the next frame. Its light has to be gone by then.
  it('is dark either side of the wrap and never changes brightness in a step', () => {
    const [width, height] = [1920, 1080]
    const count = 12
    const settings = params({ count, twinkle: 0, intensity: 0.1 })
    const before = buffer()
    const after = buffer()
    let wraps = 0
    let biggest = 0
    // A step of a thousandth of a short side of drift: about a pixel.
    for (let step = 0; step < 9000; step += 1) {
      fillSpecks(settings, clockAt(step * 0.001), silence(), width, height, before)
      fillSpecks(settings, clockAt((step + 1) * 0.001), silence(), width, height, after)
      for (let index = 0; index < count; index += 1) {
        const jumped =
          Math.abs(read(after, index, 'x') - read(before, index, 'x')) > width / 2 ||
          Math.abs(read(after, index, 'y') - read(before, index, 'y')) > height / 2
        const change = Math.abs(light(after, index) - light(before, index))
        if (jumped) {
          wraps += 1
          expect(light(before, index)).toBeLessThan(0.01 * settings.intensity)
          expect(light(after, index)).toBeLessThan(0.01 * settings.intensity)
        }

        biggest = Math.max(biggest, change)
      }
    }

    // Vacuous unless something wrapped.
    expect(wraps).toBeGreaterThan(5)
    // A pop would be the whole intensity in one step. The fade runs over
    // sixty pixels and a step is at most a pixel and a half.
    expect(biggest).toBeLessThan(0.05 * settings.intensity)
  })

  it('is lit in full away from the edges', () => {
    const out = buffer()
    fillSpecks(params({ count: MAX_SPECKS, twinkle: 0 }), clockAt(3.3), silence(), 1920, 1080, out)
    let full = 0
    for (let index = 0; index < MAX_SPECKS; index += 1)
      if (light(out, index) > 0.1 * 0.999) full += 1
    // Most of the frame is clear of the seam, so most of the specks are at full light.
    expect(full).toBeGreaterThan(MAX_SPECKS * 0.6)
  })
})

describe('the drift', () => {
  const packet = silence()

  /** A speck's place in short sides of the canvas, at a clock. */
  const place = (travel: number, index = 0, gather = 0) => {
    const out = buffer()
    fillSpecks(params({ count: index + 1, gather }), clockAt(travel), packet, 1920, 1080, out)
    return { x: read(out, index, 'x') / 1080, y: read(out, index, 'y') / 1080 }
  }

  it('moves every speck, each at a pace of its own, and stops when the clock does', () => {
    const paces = new Set<string>()
    for (let index = 0; index < 12; index += 1) {
      const a = place(1, index)
      const b = place(1.05, index)
      const moved = Math.hypot(b.x - a.x, b.y - a.y)
      // A speck that crossed the seam in that step is a jump and not a pace.
      if (moved > 0.5) continue
      // Half to one and a half of the distance the clock ran, with the sway on top.
      expect(moved).toBeGreaterThan(0.05 * 0.4)
      expect(moved).toBeLessThan(0.05 * 1.7)
      paces.add(moved.toFixed(4))
      // The same clock is the same place.
      expect(place(1, index)).toEqual(a)
    }

    expect(paces.size).toBeGreaterThan(6)
  })

  // A gentle curve and not a straight line or a jitter: the radius of
  // curvature, worked out from three points either side, is never tighter than
  // a fifth of the short side and is not zero either.
  it('is a gentle curve', () => {
    let tightest = 0
    let gentlest = Number.POSITIVE_INFINITY
    for (let index = 0; index < 12; index += 1) {
      for (let travel = 0.5; travel < 1.5; travel += 0.05) {
        const step = 0.01
        const a = place(travel - step, index)
        const b = place(travel, index)
        const c = place(travel + step, index)
        const ab = { x: b.x - a.x, y: b.y - a.y }
        const bc = { x: c.x - b.x, y: c.y - b.y }
        const ac = { x: c.x - a.x, y: c.y - a.y }
        // The wrap is a jump and not a curve.
        if (Math.hypot(ab.x, ab.y) > 0.5 || Math.hypot(bc.x, bc.y) > 0.5) continue
        const curvature =
          (2 * Math.abs(ab.x * bc.y - ab.y * bc.x)) /
          (Math.hypot(ab.x, ab.y) * Math.hypot(bc.x, bc.y) * Math.hypot(ac.x, ac.y))
        tightest = Math.max(tightest, curvature)
        gentlest = Math.min(gentlest, curvature)
      }
    }

    // The sway is 0.03 across a length of half to one short side, so the
    // sharpest a path gets is 0.03 x (2 pi / 0.5) squared, which is 4.7.
    expect(tightest).toBeLessThan(5)
    expect(tightest).toBeGreaterThan(1)
    expect(gentlest).toBeLessThan(tightest)
  })

  it('does not depend on the canvas beyond its shape: a bigger one draws the same picture', () => {
    const small = buffer()
    const big = buffer()
    fillSpecks(params(), clockAt(2.1), packet, 1280, 720, small)
    fillSpecks(params(), clockAt(2.1), packet, 2560, 1440, big)
    for (let index = 0; index < 24; index += 1) {
      expect(read(big, index, 'x')).toBeCloseTo(read(small, index, 'x') * 2, 3)
      expect(read(big, index, 'y')).toBeCloseTo(read(small, index, 'y') * 2, 3)
    }
  })
})

describe('the gather', () => {
  const packet = silence()
  const [width, height] = [1920, 1080]

  const placed = (gather: number, index: number) => {
    const out = buffer()
    fillSpecks(params({ gather }), clockAt(1.7), packet, width, height, out)
    return { x: read(out, index, 'x'), y: read(out, index, 'y') }
  }

  it('leaves the specks where they drifted at 0', () => {
    const out = buffer()
    fillSpecks(params({ gather: 0 }), clockAt(1.7), packet, width, height, out)
    const same = buffer()
    fillSpecks({ ...params(), gather: 0 }, clockAt(1.7), packet, width, height, same)
    expect(out).toEqual(same)
  })

  it('pulls every speck toward the centre by that share of its distance from it', () => {
    for (let index = 0; index < 24; index += 1) {
      const free = placed(0, index)
      for (const gather of [0.25, 0.5, 0.9]) {
        const pulled = placed(gather, index)
        expect(pulled.x - width / 2).toBeCloseTo((free.x - width / 2) * (1 - gather), 3)
        expect(pulled.y - height / 2).toBeCloseTo((free.y - height / 2) * (1 - gather), 3)
      }
    }
  })

  it('puts every speck on the centre at 1', () => {
    for (let index = 0; index < 24; index += 1) {
      const pulled = placed(1, index)
      expect(pulled.x).toBeCloseTo(width / 2, 3)
      expect(pulled.y).toBeCloseTo(height / 2, 3)
    }
  })

  // The fade belongs to the wrap and not to where the speck is drawn, so a
  // gathered speck still fades out as it crosses the seam in the space it
  // drifts through, and its light does not depend on the gather.
  it('does not change a speck’s light, so nothing pops as the gather moves', () => {
    const free = buffer()
    const pulled = buffer()
    fillSpecks(params({ gather: 0 }), clockAt(1.7), packet, width, height, free)
    fillSpecks(params({ gather: 0.6 }), clockAt(1.7), packet, width, height, pulled)
    for (let index = 0; index < 24; index += 1)
      expect(light(pulled, index)).toBeCloseTo(light(free, index), 9)
  })
})

describe('the twinkle', () => {
  const [width, height] = [1920, 1080]

  /** Every speck's light at one moment of real time, the drift held still. */
  const lightsAt = (twinkle: number, seconds: number, count = 48) => {
    const out = buffer()
    fillSpecks(params({ count, twinkle }), clockAt(2.2, seconds), silence(), width, height, out)
    return Array.from({ length: count }, (_, index) => light(out, index))
  }

  it('does nothing at 0', () => {
    const still = lightsAt(0, 0)
    for (const seconds of [0.7, 3.1, 9.4]) expect(lightsAt(0, seconds)).toEqual(still)
  })

  it('dims a speck by at most its own share at the bottom, and never lifts one past full', () => {
    for (const twinkle of [0.3, 0.6, 1]) {
      const flat = lightsAt(0, 0)
      for (let seconds = 0; seconds < 11; seconds += 0.5) {
        const lit = lightsAt(twinkle, seconds)
        lit.forEach((value, index) => {
          const full = flat[index] ?? 0
          expect(value).toBeLessThanOrEqual(full + 1e-9)
          expect(value).toBeGreaterThanOrEqual(full * (1 - twinkle) - 1e-9)
        })
      }
    }
  })

  it('takes every speck through its whole range in one slow cycle', () => {
    const flat = lightsAt(0, 0)
    const low = flat.map(() => 1)
    const high = flat.map(() => 0)
    // A cycle is at most ten seconds, so eleven cover every speck's.
    for (let seconds = 0; seconds <= 11; seconds += 0.05) {
      lightsAt(1, seconds).forEach((value, index) => {
        const share = (flat[index] ?? 0) > 0 ? value / (flat[index] ?? 1) : Number.NaN
        if (Number.isNaN(share)) return
        low[index] = Math.min(low[index] ?? 1, share)
        high[index] = Math.max(high[index] ?? 0, share)
      })
    }

    flat.forEach((value, index) => {
      if (value <= 0) return
      expect(low[index]).toBeLessThan(0.02)
      expect(high[index]).toBeGreaterThan(0.98)
    })
  })

  it('is slow: no speck changes by more than a few percent between two frames at 60', () => {
    let biggest = 0
    let previous = lightsAt(1, 0)
    for (let frame = 1; frame < 60 * 12; frame += 1) {
      const now = lightsAt(1, frame / 60)
      now.forEach((value, index) => {
        const before = previous[index] ?? 0
        biggest = Math.max(biggest, Math.abs(value - before))
      })
      previous = now
    }

    // The quickest speck cycles 0.4 times a second: a sine's steepest is
    // half of two pi times that a second, which is 0.021 a frame at 60.
    const full = params().intensity
    expect(biggest / full).toBeLessThan(0.03)
  })

  it('is on each speck’s own phase, so they are not in step', () => {
    const now = lightsAt(1, 5)
    const flat = lightsAt(0, 5)
    const shares = now.map((value, index) => value / (flat[index] || 1))
    const mean = shares.reduce((sum, value) => sum + value, 0) / shares.length
    const spread = Math.sqrt(
      shares.reduce((sum, value) => sum + (value - mean) ** 2, 0) / shares.length,
    )
    // In step they would all read one share; a sine over a random phase has a spread near 0.35.
    expect(spread).toBeGreaterThan(0.15)
  })
})

describe('the colour of a speck', () => {
  it('is the ribbon’s at the song’s key, taken toward white, when the hues are not scattered', () => {
    for (const keyHue of [0, 0.21, 0.5, 0.83]) {
      const packet = silence()
      packet[F.keyHue] = keyHue
      const out = buffer()
      fillSpecks(params({ hueSpread: 0, count: 8 }), clockAt(1.7), packet, 1920, 1080, out)
      const ribbon = ribbonColour(packet)
      for (let index = 0; index < 8; index += 1) {
        const peak = light(out, index)
        expect(peak).toBeGreaterThan(0)

        ;(['red', 'green', 'blue'] as const).forEach((part, channel) => {
          const wanted = (ribbon[channel] ?? 0) * (1 - PALE) + PALE
          expect(read(out, index, part) / peak).toBeCloseTo(wanted, 5)
        })
      }
    }
  })

  it('is pale: no channel is far behind the brightest', () => {
    const out = buffer()
    fillSpecks(params({ hueSpread: 0.3, count: 48 }), clockAt(1.2), silence(), 1920, 1080, out)
    for (let index = 0; index < 48; index += 1) {
      const peak = light(out, index)
      if (peak <= 0) continue
      for (const part of ['red', 'green', 'blue'] as const)
        expect(read(out, index, part) / peak).toBeGreaterThanOrEqual(PALE - 1e-6)
    }
  })

  it('never carries more light than the intensity', () => {
    const out = buffer()
    fillSpecks(
      params({ intensity: 0.3, count: MAX_SPECKS }),
      clockAt(0.4),
      silence(),
      1920,
      1080,
      out,
    )
    for (let index = 0; index < MAX_SPECKS; index += 1)
      expect(light(out, index)).toBeLessThanOrEqual(0.3 + 1e-6)
  })

  it('moves with the key', () => {
    const one = silence()
    const other = silence()
    other[F.keyHue] = 0.45
    const first = buffer()
    const second = buffer()
    fillSpecks(params(), clockAt(1), one, 1920, 1080, first)
    fillSpecks(params(), clockAt(1), other, 1920, 1080, second)
    const share = (out: Float32Array) => read(out, 0, 'red') / light(out, 0)
    expect(share(first)).not.toBeCloseTo(share(second), 3)
  })

  it('scatters round the ribbon’s a little when it is asked to', () => {
    const packet = silence()
    const still = buffer()
    const spread = buffer()
    fillSpecks(params({ hueSpread: 0, count: 24 }), clockAt(1.3), packet, 1920, 1080, still)
    fillSpecks(params({ hueSpread: 0.3, count: 24 }), clockAt(1.3), packet, 1920, 1080, spread)
    const hue = (out: Float32Array, index: number) =>
      (['red', 'green', 'blue'] as const).map((part) => read(out, index, part) / light(out, index))
    let differing = 0
    let counted = 0
    for (let index = 0; index < 24; index += 1) {
      if (light(still, index) < 1e-4) continue
      counted += 1
      const [one, two] = [hue(still, index), hue(spread, index)]
      if (one.some((value, part) => Math.abs(value - (two[part] ?? value)) > 0.01)) differing += 1
    }

    expect(differing).toBeGreaterThan(counted / 2)
  })
})

describe('the uniform', () => {
  it('is the canvas in pixels and a pad', () => {
    const uniform = writeDustUniform(3840, 2160, new Float32Array(DUST_UNIFORM_FLOATS))
    expect([...uniform]).toEqual([3840, 2160, 0, 0])
    expect(DUST_UNIFORM_FLOATS * 4).toBe(16)
  })
})

describe('the coverage of the frame', () => {
  // Every knob at the top of its range at once: more than any study reaches.
  const top = dustParams({ count: MAX_SPECKS, size: 16 })

  it('is a few percent at the top of every range on a square canvas and less on a wide one', () => {
    // 160 specks 16 pixels across on a canvas 1080 high.
    expect(dustCoverage(top, 1080, 1080)).toBeCloseTo(0.0351, 4)
    expect(dustCoverage(top, 1920, 1080)).toBeCloseTo(0.01975, 4)
  })

  it('is under a twentieth of the frame with every knob at the top of its range, on every canvas shape and size', () => {
    for (const [width, height] of SIZES)
      expect(dustCoverage(top, width, height), `${width} by ${height}`).toBeLessThan(1 / 20)
  })

  it('does not change with the size of a canvas of the same shape', () => {
    const small = dustCoverage(top, 1280, 720)
    for (const scale of [1.5, 2, 3])
      expect(dustCoverage(top, 1280 * scale, 720 * scale)).toBeCloseTo(small, 9)
  })

  it('is largest on a square canvas', () => {
    const square = dustCoverage(top, 1080, 1080)
    for (const [width, height] of SIZES)
      expect(dustCoverage(top, width, height)).toBeLessThanOrEqual(square + 1e-12)
  })

  it('is nothing when nothing is lit', () => {
    expect(dustCoverage(dustParams({ count: 0, size: 16 }), 1920, 1080)).toBe(0)
    expect(dustCoverage(dustParams({ count: 160, size: 0 }), 1920, 1080)).toBe(0)
  })

  // The bound has to be one: the quads the shader draws are squares of the
  // speck's own diameter, so no speck may be drawn bigger than it says.
  it('bounds what is actually drawn: no speck is wider than the knob', () => {
    const out = buffer()
    for (const [width, height] of SIZES) {
      const lit = fillSpecks(top, clockAt(1.9), silence(), width, height, out)
      for (let index = 0; index < lit; index += 1)
        expect(2 * read(out, index, 'radius')).toBeLessThanOrEqual(
          speckDiameter(16, width, height) + 1e-6,
        )
    }
  })
})
