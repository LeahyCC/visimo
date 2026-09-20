import { describe, expect, it } from 'vitest'

import { BAND_COUNT, BAND_HIT, F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  GLINT_CUT,
  GLINT_LIGHT,
  glintDrive,
  glintLevel,
  glintSurvival,
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

/**
 * Two real frames of this ink, as the share of the frame in each eightieth of
 * `intensity × GLINT_LIGHT × drive`, which is the brightness the threshold is
 * a share of. Both were rendered on their own into an rgba16float target on
 * an RTX 5080 at 1280 by 720, read back, and binned; trailing zeroes are cut.
 * Nothing regenerates them, in the spirit of the cast captures.
 *
 * `LOUD` is the worst case there is: a full packet at the inward extreme of
 * the zoom sweep, where the camera is inside the fold and nearly every pixel
 * is a lit surface. `QUIET` is the same frame at a quarter of the level. The
 * two are nearly the same shape, which is the whole case for measuring the
 * threshold against the drive: the same knob covers the same share of the
 * frame whether the music is loud or quiet.
 */
const LOUD = [
  0.00037, 0.03598, 0.05324, 0.07435, 0.07758, 0.0677, 0.07266, 0.07221, 0.07247, 0.07585, 0.07261,
  0.07029, 0.0475, 0.01963, 0.01682, 0.01325, 0.01096, 0.01018, 0.00945, 0.00909, 0.00871, 0.00791,
  0.00752, 0.00708, 0.0069, 0.00701, 0.00731, 0.00752, 0.00767, 0.00768, 0.00741, 0.00683, 0.00634,
  0.00562, 0.00482, 0.0038, 0.00267, 0.00179, 0.00132, 0.00087, 0.00055, 0.00027, 0.00014, 0.00004,
  0.00001,
]

const QUIET = [
  0.00008, 0.01623, 0.04901, 0.06459, 0.10056, 0.10358, 0.09104, 0.09746, 0.10253, 0.0889, 0.08337,
  0.03835, 0.02282, 0.02149, 0.01908, 0.01758, 0.01849, 0.01679, 0.01482, 0.0086, 0.00613, 0.00355,
  0.00202, 0.00112, 0.00083, 0.00065, 0.00059, 0.00052, 0.00047, 0.00042, 0.00034, 0.00037, 0.00043,
  0.00049, 0.00054, 0.00064, 0.00067, 0.0006, 0.0005, 0.00049, 0.00045, 0.00044, 0.0004, 0.00035,
  0.00029, 0.00023, 0.00022, 0.00024, 0.00025, 0.00022, 0.00011, 0.00001,
]

const BIN = 1 / 80

/**
 * What share of one of those frames the ink still lights once the threshold
 * has run, counting a pixel as lit when what is left of it clears a twentieth
 * of the same reference. `light × survival` climbs with the light, so the
 * bin the cut falls in is found by halving and split rather than counted
 * whole: that one bin is the cliff and rounding it either way moves the
 * answer by two points.
 */
function coverage(frame: readonly number[], glint: number, knee: number) {
  const level = glint * GLINT_CUT
  const lit = (light: number) => light * glintSurvival(light, level, knee)
  let low = 0
  let high = frame.length * BIN
  for (let step = 0; step < 60; step++) {
    const middle = (low + high) / 2
    if (lit(middle) > 0.05) high = middle
    else low = middle
  }

  return frame.reduce((share, weight, bin) => {
    const above = Math.min(1, Math.max(0, ((bin + 1) * BIN - high) / BIN))
    return share + weight * above
  }, 0)
}

describe('the glint threshold', () => {
  it('draws exactly what it drew before at a glint of 0', () => {
    // The shader takes the same branch, so this is the picture to the bit.
    for (const light of [0, 0.001, 0.05, 0.4, 3]) expect(glintSurvival(light, 0, 0.35)).toBe(1)
    const params = kaleidoscopeParams({})
    expect(params.glint).toBe(0)
    expect(glintLevel(params, new KaleidoscopeMotion().bands)).toBe(0)
  })

  it('measures the drive against the bands the way the shader does', () => {
    const params = kaleidoscopeParams({})
    const silent = new KaleidoscopeMotion()
    expect(glintDrive(params, silent.bands)).toBe(0)
    const loud = new KaleidoscopeMotion()
    const packet = new Float32Array(PACKET_LENGTH)
    packet[0] = 1
    for (let frame = 0; frame < 120; frame++) loud.step(params, 1 / 60, packet)
    expect(glintDrive(params, loud.bands)).toBeCloseTo(0.98, 6)
    // A band under its own floor drives nothing, so a fading track fades out.
    const faint = new KaleidoscopeMotion()
    faint.bands[0] = 0.004
    expect(glintDrive(params, faint.bands)).toBe(0)
  })

  it('is a soft edge on the light, not a hard one', () => {
    const level = 0.2
    const knee = 0.35
    expect(glintSurvival(level, level, knee)).toBeCloseTo(0.5, 10)
    expect(glintSurvival(level * (1 - knee), level, knee)).toBe(0)
    expect(glintSurvival(level * (1 + knee), level, knee)).toBe(1)
    let last = -1
    for (let light = 0; light <= 0.4; light += 0.005) {
      const now = glintSurvival(light, level, knee)
      expect(now).toBeGreaterThanOrEqual(last)
      last = now
    }
  })

  it('scales the level with the ink’s own light and the drive', () => {
    const bands = new Float32Array(20)
    bands[0] = 1
    const params = kaleidoscopeParams({ glint: 0.5, intensity: 1 })
    expect(glintLevel(params, bands)).toBeCloseTo(0.5 * GLINT_CUT * GLINT_LIGHT * 0.98, 10)
    // Half the light, half the level: what survives does not change.
    const dim = kaleidoscopeParams({ glint: 0.5, intensity: 0.5 })
    expect(glintLevel(dim, bands)).toBeCloseTo(glintLevel(params, bands) / 2, 10)
  })

  it('lights under a quarter of the worst frame there is at a full packet', () => {
    // Fractal glints rests at 0.3 and a full packet takes it to 0.85.
    const knee = KALEIDOSCOPE_DEFAULTS.glintKnee
    expect(coverage(LOUD, 0, knee)).toBeGreaterThan(0.8)
    expect(coverage(LOUD, 0.3, knee)).toBeGreaterThan(0.6)
    expect(coverage(LOUD, 0.85, knee)).toBeLessThan(0.25)
    // Measured on the adapter itself, per pixel, at 0.228.
    expect(coverage(LOUD, 0.85, knee)).toBeCloseTo(0.23, 2)
  })

  it('covers the same share of a quiet frame as of a loud one', () => {
    const knee = KALEIDOSCOPE_DEFAULTS.glintKnee
    for (const glint of [0.3, 0.85])
      expect(Math.abs(coverage(LOUD, glint, knee) - coverage(QUIET, glint, knee))).toBeLessThan(0.1)
  })

  it('carries the level and the knee in the last two floats of the uniform', () => {
    const params = kaleidoscopeParams({ glint: 0.6, glintKnee: 0.2 })
    const motion = new KaleidoscopeMotion()
    const packet = new Float32Array(PACKET_LENGTH)
    packet[0] = 1
    for (let frame = 0; frame < 120; frame++) motion.step(params, 1 / 60, packet)
    const out = new Float32Array(KALEIDOSCOPE_UNIFORM_FLOATS)
    writeKaleidoscopeUniform(params, motion, 1920, 1080, false, out)
    expect(out[18]).toBeCloseTo(glintLevel(params, motion.bands), 7)
    expect(out[19]).toBeCloseTo(0.2, 7)
    expect([...out].every(Number.isFinite)).toBe(true)
  })
})
