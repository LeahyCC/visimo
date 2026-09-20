import { describe, expect, it } from 'vitest'

import { levelWaveform, resampleWaveform, windowStart } from './waveform'

/** `cycles` whole turns of a sine over `length` samples, starting `phase` turns in. */
const sine = (length: number, cycles: number, phase = 0) =>
  Float32Array.from({ length }, (_, index) =>
    Math.sin(((index / length) * cycles + phase) * Math.PI * 2),
  )

describe('resampling the waveform', () => {
  it('fills exactly the buffer it is given', () => {
    for (const points of [1, 64, 256, 300]) {
      const out = new Float32Array(points)
      expect(resampleWaveform(sine(4096, 3), out, 1536, 512)).toBe(out)
      expect(out).toHaveLength(points)
    }
  })

  it('reads silence as silence, with no NaN anywhere', () => {
    const out = new Float32Array(256).fill(7)
    resampleWaveform(new Float32Array(4096), out, 1536, 512)
    for (const value of out) expect(value).toBe(0)
  })

  it('counts a value that is not a finite number as silence', () => {
    const source = sine(512, 2)
    source[100] = Number.NaN
    source[300] = Number.POSITIVE_INFINITY
    const out = resampleWaveform(source, new Float32Array(64), 512)
    for (const value of out) expect(Number.isFinite(value)).toBe(true)
  })

  it('gives a sine back as the same sine, at the same height', () => {
    // Whole cycles across the span and no search, so the window is the source
    // itself and slot n is where the tone is at (n + 1/2) / points of the way.
    const points = 256
    const cycles = 4
    const out = resampleWaveform(sine(2048, cycles), new Float32Array(points), 2048)
    for (let slot = 0; slot < points; slot++) {
      const wanted = Math.sin(((slot + 0.5) / points) * cycles * Math.PI * 2)
      expect(out[slot]).toBeCloseTo(wanted, 2)
    }

    expect(Math.max(...out)).toBeCloseTo(1, 2)
    expect(Math.min(...out)).toBeCloseTo(-1, 2)
  })

  it('averages a tone too fast for the points instead of aliasing it', () => {
    // 1000 cycles in 2048 samples is two samples a cycle, far above what 64
    // points can show. Picking every 32nd sample would draw a false slow
    // wave; the average of the bin is nothing at all.
    const out = resampleWaveform(sine(2048, 1000), new Float32Array(64), 2048)
    for (const value of out) expect(Math.abs(value)).toBeLessThan(0.1)
  })

  it('draws only the newest samples when the span is short', () => {
    const source = new Float32Array(1000)
    source.fill(0.9, 0, 500)
    source.fill(-0.4, 500)
    const out = resampleWaveform(source, new Float32Array(32), 400)
    for (const value of out) expect(value).toBeCloseTo(-0.4, 5)
  })

  it('stays smooth when there are more points than samples', () => {
    const out = resampleWaveform(Float32Array.from([0, 1]), new Float32Array(8), 2)
    for (let slot = 1; slot < out.length; slot++)
      expect(out[slot] ?? 0).toBeGreaterThanOrEqual(out[slot - 1] ?? 0)
  })

  it('survives a span or search that asks for more than there is', () => {
    const source = sine(256, 2)
    for (const [span, search] of [
      [10_000, 10_000],
      [0, 0],
      [-5, -5],
      [Number.NaN, Number.NaN],
    ] as const) {
      const out = resampleWaveform(source, new Float32Array(32), span, search)
      for (const value of out) expect(Number.isFinite(value)).toBe(true)
    }

    expect(resampleWaveform(new Float32Array(0), new Float32Array(4).fill(3), 8)).toEqual(
      new Float32Array(4),
    )
    expect(resampleWaveform(source, new Float32Array(0), 8)).toHaveLength(0)
  })
})

describe('starting the window on a rising zero crossing', () => {
  // Negative, then a crossing at index 10, then positive, then negative again.
  const tone = () => {
    const source = new Float32Array(100)
    source.fill(-0.5, 0, 10)
    source.fill(0.5, 10, 60)
    source.fill(-0.5, 60)
    return source
  }

  it('starts at the first sample that is not below zero after one that is', () => {
    expect(windowStart(tone(), 60, 40)).toBe(10)
  })

  it('looks no further back than it is allowed to', () => {
    // The crossing is at 10, which is 30 samples before the newest window.
    expect(windowStart(tone(), 60, 5)).toBe(40)
    expect(windowStart(tone(), 60, 40)).toBe(10)
  })

  it('uses the newest window when there is nothing to cross', () => {
    expect(windowStart(new Float32Array(100), 60, 40)).toBe(40)
    expect(windowStart(new Float32Array(100).fill(-1), 60, 40)).toBe(40)
    expect(windowStart(new Float32Array(100).fill(1), 60, 40)).toBe(40)
    // A falling crossing does not count.
    expect(windowStart(Float32Array.from([1, 1, -1, -1]), 2, 2)).toBe(2)
  })

  it('never starts a window that runs past the end', () => {
    for (const [span, search] of [
      [60, 40],
      [100, 40],
      [100, 0],
      [30, 1000],
    ] as const) {
      const start = windowStart(tone(), span, search)
      expect(start).toBeGreaterThanOrEqual(0)
      expect(start + Math.min(span, 100)).toBeLessThanOrEqual(100)
    }
  })

  it('draws a tone from the same place however far along it is', () => {
    // The tone is 5 cycles in 512 samples. Slide it along one sample at a time
    // and the line must not follow it more than a sample and a bit: the slide
    // is what shows as a line jittering sideways.
    const length = 4096
    const period = 512 / 5
    const at = (offset: number) =>
      Float32Array.from({ length }, (_, index) =>
        Math.sin(((index + offset) / period) * Math.PI * 2),
      )
    const first = resampleWaveform(at(0), new Float32Array(256), 1536, 512)
    for (const offset of [3, 17, 40, 71]) {
      const shifted = resampleWaveform(at(offset), new Float32Array(256), 1536, 512)
      for (let slot = 0; slot < 256; slot += 16)
        expect(Math.abs((shifted[slot] ?? 0) - (first[slot] ?? 0))).toBeLessThan(0.15)
    }
  })

  it('makes a sine begin at the middle and go up', () => {
    const out = resampleWaveform(sine(4096, 37.3), new Float32Array(256), 1536, 512)
    // 37.3 cycles in 4096 samples is a period near 110, and the first slot
    // averages the six samples after the crossing, a third of a radian: a
    // little above zero and going up, whatever the phase the tone came in on.
    expect(out[0] ?? -1).toBeGreaterThanOrEqual(0)
    expect(out[0] ?? 1).toBeLessThan(0.3)
    expect(out[3] ?? 0).toBeGreaterThan(out[0] ?? 0)
  })
})

describe('levelling the waveform', () => {
  const tone = (amplitude: number) =>
    Float32Array.from({ length: 256 }, (_, n) => amplitude * Math.sin((n / 256) * Math.PI * 8))
  const tallest = (points: Float32Array) => points.reduce((m, p) => Math.max(m, Math.abs(p)), 0)

  it('draws a quiet sound as tall as a loud one', () => {
    const loud = tone(0.9)
    const quiet = tone(0.05)
    levelWaveform(loud, 0, 1 / 60)
    levelWaveform(quiet, 0, 1 / 60)
    expect(tallest(quiet)).toBeCloseTo(tallest(loud), 5)
    expect(tallest(loud)).toBeCloseTo(0.8, 5)
  })

  it('lets near silence shrink and leaves silence alone', () => {
    const hiss = tone(0.002)
    levelWaveform(hiss, 0, 1 / 60)
    expect(tallest(hiss)).toBeLessThan(0.1)
    const nothing = new Float32Array(256)
    expect(levelWaveform(nothing, 0, 1 / 60)).toBe(0)
    expect(tallest(nothing)).toBe(0)
  })

  it('remembers a loud hit, so the quiet after it grows back slowly', () => {
    const peak = levelWaveform(tone(0.9), 0, 1 / 60)
    const after = tone(0.09)
    const next = levelWaveform(after, peak, 1 / 60)
    expect(tallest(after)).toBeLessThan(0.1)
    expect(next).toBeLessThan(peak)
    const later = tone(0.09)
    levelWaveform(later, peak, 30)
    expect(tallest(later)).toBeCloseTo(0.8, 5)
  })

  it('shrugs off a bad step or a bad memory', () => {
    const points = tone(0.5)
    expect(Number.isFinite(levelWaveform(points, Number.NaN, Number.NaN))).toBe(true)
    expect(tallest(points)).toBeCloseTo(0.8, 5)
  })
})
