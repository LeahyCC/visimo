import { describe, expect, it } from 'vitest'

import { BAND_COUNT, BAND_HIT, F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  KALEIDOSCOPE_DEFAULTS,
  KALEIDOSCOPE_UNIFORM_FLOATS,
  KaleidoscopeMotion,
  kaleidoscopeParams,
  kaleidoscopeZoom,
  writeKaleidoscopeUniform,
} from './kaleidoscope.params'

describe('kaleidoscope', () => {
  it('bounds mapped geometry and rejects non-finite tuning', () => {
    const params = kaleidoscopeParams({ symmetry: 5.8, zoom: -100, complexity: 50, intensity: NaN })
    expect(params.symmetry).toBe(6)
    expect(params.zoom).toBe(0.4)
    expect(params.complexity).toBe(10)
    expect(params.intensity).toBe(KALEIDOSCOPE_DEFAULTS.intensity)
  })

  it('keeps motion and envelope timing consistent at 30, 60 and 144 Hz', () => {
    const params = kaleidoscopeParams({ bassLift: 1, sparkle: 1, rotationSpeed: -0.1 })
    const samples = [30, 60, 144].map((hz) => {
      const motion = new KaleidoscopeMotion()
      for (let i = 0; i < hz * 2; i++) motion.step(params, 1 / hz)
      return motion
    })
    for (const motion of samples)
      for (const key of ['rotation', 'travel', 'morph', 'colour', 'lift', 'sparkle'] as const)
        expect(motion[key]).toBeCloseTo(samples[0]?.[key] ?? 0, 8)
  })

  it('changing speed preserves the accumulated position', () => {
    const motion = new KaleidoscopeMotion()
    for (let i = 0; i < 1000; i++) motion.step(KALEIDOSCOPE_DEFAULTS, 0.1)
    const before = motion.rotation
    motion.step(kaleidoscopeParams({ rotationSpeed: 0.2 }), 0.01)
    expect(motion.rotation - before).toBeCloseTo(0.002, 10)
  })

  it('writes a finite aligned uniform and caps software detail', () => {
    const out = new Float32Array(KALEIDOSCOPE_UNIFORM_FLOATS)
    writeKaleidoscopeUniform(
      kaleidoscopeParams({ complexity: 10 }),
      new KaleidoscopeMotion(),
      0,
      0,
      true,
      out,
    )
    expect([...out].every(Number.isFinite)).toBe(true)
    expect(out[0]).toBe(1)
    expect(out[1]).toBe(1)
    expect(out[8]).toBe(5)
    expect(out[17]).toBe(1)
    expect(out.byteLength % 16).toBe(0)
  })

  it('an isolated band only lights and hits its own layer, then releases into silence', () => {
    for (let band = 0; band < BAND_COUNT; band++) {
      const motion = new KaleidoscopeMotion()
      const features = new Float32Array(PACKET_LENGTH)
      features[band] = 1
      features[BAND_HIT + band] = 1
      motion.step(KALEIDOSCOPE_DEFAULTS, 1 / 60, features)
      for (let other = 0; other < BAND_COUNT; other++) {
        if (other === band) {
          expect(motion.bands[other * 4]).toBeGreaterThan(0)
          expect(motion.bands[other * 4 + 1]).toBe(1)
        } else {
          expect(motion.bands[other * 4]).toBe(0)
          expect(motion.bands[other * 4 + 1]).toBe(0)
        }
      }
      features.fill(0)
      for (let frame = 0; frame < 180; frame++) motion.step(KALEIDOSCOPE_DEFAULTS, 1 / 60, features)
      expect(motion.bands[band * 4]).toBeLessThan(0.005)
      expect(motion.bands[band * 4 + 1]).toBeLessThan(0.005)
    }
  })

  it('zooms both ways continuously and holds position when zoom speed stops', () => {
    const params = kaleidoscopeParams({ zoomAmount: 1, zoomSpeed: 1 })
    const motion = new KaleidoscopeMotion()
    const samples: number[] = []
    for (let frame = 0; frame < 630; frame++) {
      motion.step(params, 0.01)
      samples.push(kaleidoscopeZoom(params, motion))
    }
    expect(Math.max(...samples)).toBeGreaterThan(params.zoom * 2.7)
    expect(Math.min(...samples)).toBeLessThan(params.zoom * 0.38)
    const before = kaleidoscopeZoom(params, motion)
    motion.step({ ...params, zoomSpeed: 0 }, 0.1)
    expect(kaleidoscopeZoom(params, motion)).toBe(before)
    for (let i = 1; i < samples.length; i++)
      expect(Math.abs(samples[i]! - samples[i - 1]!)).toBeLessThan(0.03)
  })

  it('holds a short treble hit across render frames without repeating it', () => {
    const motion = new KaleidoscopeMotion()
    const features = new Float32Array(PACKET_LENGTH)
    features[F.trebleHit] = 1
    motion.step(KALEIDOSCOPE_DEFAULTS, 1 / 144, features)
    features.fill(0)
    motion.step(KALEIDOSCOPE_DEFAULTS, 1 / 144, features)
    expect(motion.bands[17]).toBeGreaterThan(0.9)
    for (let frame = 0; frame < 144; frame++) motion.step(KALEIDOSCOPE_DEFAULTS, 1 / 144, features)
    expect(motion.bands[17]).toBeLessThan(0.001)
  })
})
