/**
 * The rings' numbers without a device: when a ring is born and that it is born
 * where the beat is predicted and not where an onset falls, that it is in the
 * same place after the same seconds at any frame rate and through a change of
 * tempo, that it is round on any canvas, fades and is gone before it leaves the
 * frame, and that it stays sparse.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { ribbonColour } from '../post/params'
import {
  arcInside,
  BIRTH_RADIUS,
  CANVAS_FLOOR,
  CONFIDENCE_OFF,
  CONFIDENCE_ON,
  exitRadius,
  FEEDBACK_KEEP,
  RING_FLOATS,
  RING_POOL,
  RING_RANGES,
  RING_UNIFORM_FLOATS,
  ringEdgePixels,
  ringHue,
  ringLight,
  ringParams,
  ringPassPeak,
  RingPool,
  ringReach,
  ringsCoverage,
  ringsPerBeat,
  ringThicknessPixels,
  writeRingUniform,
} from './rings.params'
import type { RingParams } from './rings.params'

/** A study's numbers written by hand, everything not named at rest. */
const params = (over: Partial<RingParams> = {}): RingParams => ({
  rate: 1,
  speed: 0.3,
  thickness: 3,
  intensity: 0.8,
  life: 2.4,
  hueSpread: 0,
  ...over,
})

const packet = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

const buffer = () => new Float32Array(RING_POOL * RING_FLOATS)

const SIZES = [
  [1920, 1080],
  [1080, 1920],
  [2560, 1440],
  [3840, 2160],
  [1080, 1080],
  [2520, 1080],
  [1440, 1080],
] as const

/** Every ring the pool would draw, as its radius in pixels and its light (the brightest channel). */
function drawn(
  pool: RingPool,
  over: RingParams,
  features: Float32Array,
  width = 1920,
  height = 1080,
) {
  const out = buffer()
  const count = pool.fill(out, over, features, width, height)
  return Array.from({ length: count }, (_, at) => ({
    radius: out[at * RING_FLOATS + 3] ?? Number.NaN,
    light: Math.max(
      out[at * RING_FLOATS] ?? 0,
      out[at * RING_FLOATS + 1] ?? 0,
      out[at * RING_FLOATS + 2] ?? 0,
    ),
  })).sort((a, b) => a.radius - b.radius)
}

/**
 * Step a pool through `seconds` of a steady beat at `fps`, writing the packet
 * a real one would: a phase that rises linearly through each beat and wraps.
 * `offset` is where in the beat the song starts. Returns the packet it ended on.
 */
function play(
  pool: RingPool,
  over: RingParams,
  seconds: number,
  fps: number,
  { bpm = 120, offset = 0, confidence = 0.9 } = {},
) {
  const dt = 1 / fps
  const steps = Math.round(seconds * fps)
  let features = packet()
  for (let step = 0; step <= steps; step += 1) {
    const beats = (step * dt * bpm) / 60 + offset
    features = packet({ beatPhase: beats - Math.floor(beats), tempoConfidence: confidence })
    // The first step only seeds the phase; time starts from the second.
    pool.step(features, step === 0 ? Number.MIN_VALUE : dt, over)
  }

  return features
}

describe('the rings’ knobs', () => {
  it('are clamped to their ranges', () => {
    const wild = ringParams({
      rate: 40,
      speed: 9,
      thickness: 99,
      intensity: 7,
      life: 99,
      hueSpread: 3,
    })
    for (const knob of Object.keys(RING_RANGES) as (keyof RingParams)[])
      expect(wild[knob], knob).toBe(RING_RANGES[knob][1])
    const low = ringParams({ rate: -1, speed: -1, thickness: -1, intensity: -1, life: -1 })
    for (const knob of ['rate', 'speed', 'thickness', 'intensity', 'life'] as const)
      expect(low[knob], knob).toBe(RING_RANGES[knob][0])
  })

  it('take the low end of their range when a study resolved nothing, so no light and no ring', () => {
    const none = ringParams({})
    expect(none.intensity).toBe(0)
    expect(none.thickness).toBe(0)
    expect(ringParams({ intensity: Number.NaN, speed: Number.POSITIVE_INFINITY }).intensity).toBe(0)
  })

  it('snap the rate to a beat’s own subdivisions, 1, 2 or 4', () => {
    expect([1, 1.4, 1.5, 2, 2.9, 3, 3.5, 4].map(ringsPerBeat)).toEqual([1, 1, 2, 2, 2, 4, 4, 4])
  })
})

describe('the light across a ring', () => {
  const edge = 1

  it('is full inside the thickness, half at half of it, and exactly nothing at its reach', () => {
    expect(ringLight(0, 6, edge)).toBe(1)
    expect(ringLight(1.9, 6, edge)).toBe(1)
    expect(ringLight(3, 6, edge)).toBeCloseTo(0.5, 12)
    expect(ringLight(ringReach(6, edge), 6, edge)).toBe(0)
    expect(ringLight(ringReach(6, edge) + 5, 6, edge)).toBe(0)
  })

  it('is the same either side of its middle line and only ever falls away from it', () => {
    let last = 1
    for (let at = 0; at <= 5; at += 0.05) {
      const light = ringLight(at, 6, edge)
      expect(light).toBeCloseTo(ringLight(-at, 6, edge), 12)
      expect(light).toBeLessThanOrEqual(last + 1e-12)
      last = light
    }
  })

  it('keeps a peak of 1 however thin, and is then as wide as its own edge', () => {
    for (const thickness of [0, 0.3, 1, 2]) {
      expect(ringLight(0, thickness, edge), `thickness ${thickness}`).toBe(1)
      expect(ringLight(ringReach(thickness, edge), thickness, edge)).toBe(0)
    }
  })

  it('scales its thickness with the short side of the canvas and never lets its edge drop under a pixel’s worth', () => {
    expect(ringThicknessPixels(3, 1920, 1080)).toBe(3)
    expect(ringThicknessPixels(3, 3840, 2160)).toBe(6)
    // A tall canvas is scaled by its short side, so a ring is as thick there as on a wide one of the same width.
    expect(ringThicknessPixels(3, 1080, 1920)).toBe(3)
    expect(ringEdgePixels(1920, 1080)).toBe(1)
    expect(ringEdgePixels(3840, 2160)).toBe(2)
    expect(ringEdgePixels(320, 180)).toBe(0.75)
  })
})

describe('the hue of each ring', () => {
  it('steps a little from one ring to the next and never jumps, whatever the spread', () => {
    const spread = 0.4
    for (let index = 0; index < 40; index += 1)
      expect(
        Math.abs(ringHue(index + 1, spread) - ringHue(index, spread)),
        `ring ${index}`,
      ).toBeLessThanOrEqual(spread / 4 + 1e-12)
  })

  it('stays within half the spread of the ribbon’s colour either side, and is the ribbon’s at no spread', () => {
    for (let index = 0; index < 40; index += 1) {
      expect(Math.abs(ringHue(index, 0.3))).toBeLessThanOrEqual(0.15 + 1e-12)
      expect(Math.abs(ringHue(index, 0))).toBe(0)
    }
  })

  it('is not the same for two neighbouring rings, or the spread does nothing', () => {
    expect(ringHue(1, 0.3)).not.toBe(ringHue(2, 0.3))
  })
})

describe('when a ring is born', () => {
  it('is on the wrap of the beat phase, once a beat at a rate of 1', () => {
    const pool = new RingPool()
    play(pool, params(), 10, 60, { bpm: 120 })
    // Twenty beats in ten seconds, and the wrap that lands on the last step is counted.
    expect(pool.born).toBeGreaterThanOrEqual(19)
    expect(pool.born).toBeLessThanOrEqual(20)
  })

  it('is twice and four times a beat at a rate of 2 and 4, and the same at 30, 60 and 144 steps a second', () => {
    for (const fps of [30, 60, 144]) {
      for (const [rate, per] of [
        [1, 1],
        [2, 2],
        [4, 4],
      ] as const) {
        const pool = new RingPool()
        play(pool, params({ rate }), 8, fps, { bpm: 120, offset: 0.1 })
        expect(pool.born, `rate ${rate} at ${fps}`).toBe(16 * per)
      }
    }
  })

  it('is at the predicted beat and not at an onset: nothing in the packet but the phase and the confidence decides it', () => {
    // A hat, a kick and a huge onset land where the phase is nowhere near a wrap.
    const pool = new RingPool()
    let features = packet({ beatPhase: 0.3, tempoConfidence: 0.9 })
    pool.step(features, 1 / 60, params())
    for (const at of [0.35, 0.4, 0.45, 0.5]) {
      features = packet({
        beatPhase: at,
        tempoConfidence: 0.9,
        onset: 1,
        onsetStrength: 1,
        beatPulse: 1,
        subPulse: 1,
      })
      pool.step(features, 1 / 60, params())
    }

    expect(pool.born).toBe(0)
    pool.step(packet({ beatPhase: 0.99, tempoConfidence: 0.9 }), 1 / 60, params())
    expect(pool.born).toBe(0)
    pool.step(packet({ beatPhase: 0.02, tempoConfidence: 0.9 }), 1 / 60, params())
    expect(pool.born).toBe(1)
  })

  it('is born where the wrap falls inside the step, so it is already that old when the step ends', () => {
    const pool = new RingPool()
    const over = params({ speed: 0.3 })
    pool.step(packet({ beatPhase: 0.9, tempoConfidence: 0.9 }), 0.1, over)
    // From 0.9 to 0.3 through the wrap is 0.4 of a beat, and 0.3 of it is after the wrap: three quarters of the step.
    pool.step(packet({ beatPhase: 0.3, tempoConfidence: 0.9 }), 0.1, over)
    const [ring] = drawn(pool, over, packet())
    expect(ring?.radius).toBeCloseTo((BIRTH_RADIUS + 0.3 * 0.075) * 1080, 3)
  })

  it('is not born while the beat is not believed, and the gap between on and off keeps it from flickering', () => {
    const quiet = new RingPool()
    play(quiet, params(), 6, 60, { confidence: CONFIDENCE_ON - 0.01 })
    expect(quiet.born).toBe(0)

    // Believed, then drifting down between the two: still believed.
    const pool = new RingPool()
    let features = packet()
    const dt = 1 / 60
    for (let step = 0; step < 6 * 60; step += 1) {
      const beats = step * dt * 2
      const confidence = step < 60 ? 0.9 : (CONFIDENCE_ON + CONFIDENCE_OFF) / 2
      features = packet({ beatPhase: beats - Math.floor(beats), tempoConfidence: confidence })
      pool.step(features, dt, params())
    }

    expect(pool.born).toBeGreaterThan(8)

    // Under the lower edge it stops, and the same middle value does not bring it back.
    const before = pool.born
    for (let step = 0; step < 4 * 60; step += 1) {
      const beats = 6 + step * dt * 2
      const confidence = step < 60 ? CONFIDENCE_OFF - 0.05 : (CONFIDENCE_ON + CONFIDENCE_OFF) / 2
      pool.step(
        packet({ beatPhase: beats - Math.floor(beats), tempoConfidence: confidence }),
        dt,
        params(),
      )
    }

    expect(pool.born).toBe(before)
  })

  it('is not born from silence, from no tempo at all, or with no light to draw', () => {
    const silent = new RingPool()
    for (let step = 0; step < 240; step += 1) silent.step(packet(), 1 / 60, params())
    expect(silent.born).toBe(0)

    // A phase that never moves is a tempo that has never been found.
    const none = new RingPool()
    for (let step = 0; step < 240; step += 1)
      none.step(packet({ beatPhase: 0, tempoConfidence: 0.9 }), 1 / 60, params())
    expect(none.born).toBe(0)

    const dark = new RingPool()
    play(dark, params({ intensity: 0 }), 4, 60)
    expect(dark.born).toBe(0)
  })

  it('does not treat the tracker moving the phase as a beat: a jump backwards or a leap ahead births nothing', () => {
    const pool = new RingPool()
    const over = params()
    const at = (beatPhase: number) =>
      pool.step(packet({ beatPhase, tempoConfidence: 0.9 }), 1 / 60, over)
    at(0.4)
    at(0.42)
    at(0.1)
    expect(pool.born).toBe(0)
    at(0.7)
    expect(pool.born).toBe(0)
    at(0.72)
    expect(pool.born).toBe(0)
  })

  it('does not birth on the first phase it sees, whatever it reads, and copes with a phase that is not a number', () => {
    const pool = new RingPool()
    pool.step(packet({ beatPhase: 0.45, tempoConfidence: 0.9 }), 1 / 60, params({ rate: 4 }))
    expect(pool.born).toBe(0)
    expect(() => {
      pool.step(packet({ beatPhase: Number.NaN, tempoConfidence: 0.9 }), 1 / 60, params())
      pool.step(packet({ beatPhase: 0.5, tempoConfidence: Number.NaN }), Number.NaN, params())
    }).not.toThrow()
    expect(pool.born).toBe(0)
  })

  it('makes the same rings for the same beats, since nothing in it is random', () => {
    const a = new RingPool()
    const b = new RingPool()
    const features = play(a, params({ rate: 2 }), 5, 60, { bpm: 133, offset: 0.3 })
    play(b, params({ rate: 2 }), 5, 60, { bpm: 133, offset: 0.3 })
    expect(drawn(a, params({ hueSpread: 0.3 }), features)).toEqual(
      drawn(b, params({ hueSpread: 0.3 }), features),
    )
  })

  it('cannot be tricked into a burst by the rate changing between two frames', () => {
    const pool = new RingPool()
    const dt = 1 / 60
    let beats = 0.55
    // The rate is 1 up to here and 4 from here on. Counting ticks against each frame's own rate,
    // one beat at 4 a beat is four births; counting them against the last frame's would add two.
    pool.step(packet({ beatPhase: beats, tempoConfidence: 0.9 }), dt, params({ rate: 1 }))
    for (let step = 0; step < 30; step += 1) {
      beats += (dt * 120) / 60
      pool.step(
        packet({ beatPhase: beats - Math.floor(beats), tempoConfidence: 0.9 }),
        dt,
        params({ rate: 4 }),
      )
    }

    // 30 steps at 120 a minute is exactly one beat.
    expect(pool.born).toBe(4)
  })

  it('keeps at most a pool of rings, dropping the oldest, which is the dimmest', () => {
    const pool = new RingPool()
    const over = params({ rate: 4, life: 4, speed: 0.05 })
    const features = play(pool, over, 10, 60, { bpm: 200 })
    expect(pool.born).toBeGreaterThan(RING_POOL)
    const rings = drawn(pool, over, features)
    expect(rings).toHaveLength(RING_POOL)
    // The newest is the smallest, and the oldest that survived is the dimmest.
    expect(rings[0]?.light).toBeGreaterThan(rings[RING_POOL - 1]?.light ?? 1)
  })
})

describe('where a ring is', () => {
  it('is a radius in frame heights a second, from a small birth radius, on any canvas', () => {
    for (const [width, height] of SIZES) {
      const pool = new RingPool()
      const over = params({ speed: 0.25, life: 4, intensity: 1 })
      // One wrap at 0.25 s, then a second more.
      // 30 a minute is a wrap every two seconds: this one at 0.2 s, so the ring is a second old.
      const features = play(pool, over, 1.2, 60, { bpm: 30, offset: 0.9 })
      const [ring] = drawn(pool, over, features, width, height)
      expect(ring?.radius, `${width} by ${height}`).toBeCloseTo(
        (BIRTH_RADIUS + 0.25 * 1) * height,
        1,
      )
    }
  })

  it('is in the same place after the same seconds at 30, 60, 144 and 240 steps a second', () => {
    const over = params({ rate: 2, life: 4, speed: 0.31 })
    const seen = [30, 60, 144, 240].map((fps) => {
      const pool = new RingPool()
      const features = play(pool, over, 3, fps, { bpm: 128, offset: 0.2 })
      return drawn(pool, over, features)
    })

    const [first, ...rest] = seen
    expect(first?.length).toBeGreaterThan(6)
    for (const other of rest) {
      expect(other.length).toBe(first?.length)
      other.forEach((ring, at) => {
        expect(ring.radius).toBeCloseTo(first?.[at]?.radius ?? Number.NaN, 2)
        expect(ring.light).toBeCloseTo(first?.[at]?.light ?? Number.NaN, 4)
      })
    }
  })

  it('does not move when the tempo changes: a ring already born goes on at its own rate', () => {
    // 100 a minute for two seconds, then 170 for two more, with a continuous phase.
    const over = params({ life: 4, speed: 0.2, intensity: 1 })
    const pool = new RingPool()
    const fps = 144
    const dt = 1 / fps
    let beats = 0.02
    let time = 0
    const births: number[] = []
    let last = beats
    pool.step(packet({ beatPhase: beats, tempoConfidence: 0.9 }), Number.MIN_VALUE, over)
    for (let step = 0; step < 4 * fps; step += 1) {
      const bpm = time < 2 ? 100 : 170
      beats += (dt * bpm) / 60
      time += dt
      if (Math.floor(beats) > Math.floor(last)) {
        // The crossing, found from the beat count the test kept and not the pool's own.
        births.push(time - (beats - Math.floor(beats)) / (bpm / 60))
      }

      last = beats
      pool.step(packet({ beatPhase: beats - Math.floor(beats), tempoConfidence: 0.9 }), dt, over)
    }

    const now = 4
    const expected = births
      .map((born) => (BIRTH_RADIUS + 0.2 * (now - born)) * 1080)
      .filter((radius) => radius < exitRadius(16 / 9) * 1080)
      .sort((a, b) => a - b)
    const seen = drawn(pool, over, packet()).map((ring) => ring.radius)
    expect(seen).toHaveLength(expected.length)
    seen.forEach((radius, at) => expect(radius).toBeCloseTo(expected[at] ?? Number.NaN, 1))
  })

  it('does not jump when the speed changes: the distance a ring has come is the speed it had, added up', () => {
    const pool = new RingPool()
    const slow = params({ speed: 0.1, life: 4 })
    const fast = params({ speed: 0.4, life: 4 })
    // Born at 0.2 s, then a second at 0.1 and a second at 0.4, with the next wrap not till 2.2 s.
    play(pool, slow, 1.2, 60, { bpm: 30, offset: 0.9 })
    const before = drawn(pool, slow, packet())[0]?.radius ?? Number.NaN
    expect(before).toBeCloseTo((BIRTH_RADIUS + 0.1) * 1080, 1)
    // Half a second more at 0.4, the phase carrying on from where the first run left it.
    for (let step = 0; step < 30; step += 1) {
      const beats = 1.5 + (step + 1) * (0.5 / 60)
      pool.step(
        packet({ beatPhase: beats - Math.floor(beats), tempoConfidence: 0.9 }),
        1 / 60,
        fast,
      )
    }

    const after = drawn(pool, fast, packet())[0]?.radius ?? Number.NaN
    expect(after).toBeCloseTo((BIRTH_RADIUS + 0.1 + 0.4 * 0.5) * 1080, 1)
  })

  it('is round: a radius in pixels from the middle of the canvas, the same in every direction on any shape', () => {
    // The shader places a corner at `centre + (cos a, sin a) x radius`, so the row's radius is the whole shape.
    for (const [width, height] of SIZES) {
      const pool = new RingPool()
      const over = params({ life: 4 })
      const features = play(pool, over, 2, 60, { bpm: 90 })
      for (const ring of drawn(pool, over, features, width, height)) {
        expect(ring.radius).toBeGreaterThan(BIRTH_RADIUS * height - 1e-3)
        expect(ring.radius / height).toBeLessThan(exitRadius(width / height))
      }
    }

    // The middle is the canvas's own: the uniform carries the canvas and nothing off centre.
    const uniform = writeRingUniform(params(), 1080, 1920, new Float32Array(RING_UNIFORM_FLOATS))
    expect([uniform[0], uniform[1]]).toEqual([1080, 1920])
  })
})

describe('how a ring fades and goes', () => {
  it('falls in brightness every frame from its birth, and is nothing at the end of its life', () => {
    const over = params({ life: 1.5, speed: 0.05, intensity: 1 })
    const pool = new RingPool()
    let features = packet({ beatPhase: 0.99, tempoConfidence: 0.9 })
    pool.step(features, 1 / 240, over)
    features = packet({ beatPhase: 0.0, tempoConfidence: 0.9 })
    pool.step(features, 1 / 240, over)
    let last = Number.POSITIVE_INFINITY
    let frames = 0
    for (let step = 0; step < 1000; step += 1) {
      pool.step(packet({ beatPhase: 0.01 + step * 0.0001, tempoConfidence: 0.9 }), 1 / 240, over)
      const [ring] = drawn(pool, over, features)
      if (!ring) break
      expect(ring.light).toBeLessThan(last)
      last = ring.light
      frames += 1
    }

    expect(frames).toBeGreaterThan(300)
    expect(frames).toBeLessThan(370)
    expect(last).toBeLessThan(1e-3)
  })

  it('is gone by the time it leaves the frame, and dim as it goes, on a wide canvas and a tall one', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
      [2520, 1080],
    ] as const) {
      const over = params({ life: 4, speed: 0.8, intensity: 1 })
      const pool = new RingPool()
      pool.step(packet({ beatPhase: 0.99, tempoConfidence: 0.9 }), 1 / 240, over)
      pool.step(packet({ beatPhase: 0.0, tempoConfidence: 0.9 }), 1 / 240, over)
      let last: { radius: number; light: number } | undefined
      let farthest = 0
      for (let step = 0; step < 2000; step += 1) {
        pool.step(packet({ beatPhase: 0.01 + step * 1e-5, tempoConfidence: 0.9 }), 1 / 240, over)
        const [ring] = drawn(pool, over, packet(), width, height)
        if (!ring) break
        last = ring
        farthest = Math.max(farthest, ring.radius)
      }

      // It never reaches the corner, its last frame is right at it, and it is nearly black by then.
      const corner = exitRadius(width / height) * height
      expect(farthest, `${width} by ${height}`).toBeLessThan(corner)
      expect(last?.radius ?? 0).toBeGreaterThan(corner * 0.99)
      expect(last?.light ?? 1).toBeLessThan(2e-4)
    }
  })

  it('has a life of its own when it is born, so a later change of the knob leaves it fading as it was', () => {
    const pool = new RingPool()
    const long = params({ life: 3.5, speed: 0.05, intensity: 1 })
    play(pool, long, 1.2, 60, { bpm: 30, offset: 0.9 })
    const before = drawn(pool, long, packet())[0]?.light ?? Number.NaN
    const shorter = params({ life: 0.3, speed: 0.05, intensity: 1 })
    expect(drawn(pool, shorter, packet())[0]?.light).toBeCloseTo(before, 6)
  })

  it('takes its colour from the ribbon’s palette at the key, each ring a step on from the last', () => {
    const pool = new RingPool()
    const over = params({ rate: 4, hueSpread: 0.3, life: 4, speed: 0.05, intensity: 1 })
    const features = packet({ keyHue: 0.37, beatPhase: 0, tempoConfidence: 0.9 })
    play(pool, over, 2, 60, { bpm: 120 })
    const out = buffer()
    const count = pool.fill(out, over, features, 1920, 1080)
    expect(count).toBeGreaterThan(4)
    // Rows are in slot order, which is birth order until the ring wraps.
    for (let at = 0; at < count; at += 1) {
      const light = 0.8 // a life of 4 and a speed of 0.05 leave the early rings near full
      const colour = ribbonColour(features, ringHue(at, 0.3))
      const row = [out[at * 4] ?? 0, out[at * 4 + 1] ?? 0, out[at * 4 + 2] ?? 0]
      const scale = Math.max(...row)
      expect(scale).toBeGreaterThan(0)
      expect(scale).toBeLessThan(1 + light)
      colour.forEach((value, channel) => expect(row[channel] ?? 0).toBeCloseTo(value * scale, 4))
    }
  })
})

describe('how sparse it is', () => {
  it('has a circle of any radius inside a frame counted right: the whole of it, and none of it past the corner', () => {
    expect(arcInside(100, 1920, 1080)).toBeCloseTo(2 * Math.PI * 100, 9)
    expect(arcInside(540, 1920, 1080)).toBeCloseTo(2 * Math.PI * 540, 6)
    expect(arcInside(0, 1920, 1080)).toBe(0)
    expect(arcInside(0.5 * Math.hypot(1920, 1080) + 1, 1920, 1080)).toBe(0)
    // A circle that only just clears the short side is a bit under whole.
    expect(arcInside(560, 1920, 1080)).toBeLessThan(2 * Math.PI * 560)
    expect(arcInside(560, 1920, 1080)).toBeGreaterThan(2 * Math.PI * 560 * 0.8)
    // Symmetric in the frame's shape.
    expect(arcInside(700, 1080, 1920)).toBeCloseTo(arcInside(700, 1920, 1080), 6)
  })

  it('counts more than the pixels of a raster of the same rings would light, so it is a bound', () => {
    const over = params({ rate: 4, thickness: 3.3, speed: 0.32, life: 0.9 })
    const width = 640
    const height = 360
    const bound = ringsCoverage(over, 200, width, height)
    const edge = ringEdgePixels(width, height)
    const thickness = ringThicknessPixels(over.thickness, width, height)
    const gap = 60 / (4 * 200)
    const radii: number[] = []
    for (let age = 0; age < over.life; age += gap)
      radii.push((BIRTH_RADIUS + over.speed * age) * height)
    let lit = 0
    for (let y = 0; y < height; y += 1)
      for (let x = 0; x < width; x += 1) {
        const distance = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2)
        const best = radii.reduce(
          (most, radius) => Math.max(most, ringLight(distance - radius, thickness, edge)),
          0,
        )
        if (best > 0) lit += 1
      }

    expect(lit / (width * height)).toBeLessThanOrEqual(bound * 1.02)
    expect(lit / (width * height)).toBeGreaterThan(bound * 0.7)
  })

  it('grows with the rate, the speed the thickness and the tempo, and is nothing with no thickness beyond the edge', () => {
    const base = params({ rate: 1, thickness: 3, life: 4 })
    const at = (over: Partial<RingParams>, bpm = 120) =>
      ringsCoverage({ ...base, ...over }, bpm, 1920, 1080)
    expect(at({ rate: 4 })).toBeGreaterThan(at({ rate: 2 }))
    expect(at({ rate: 2 })).toBeGreaterThan(at({ rate: 1 }))
    expect(at({ thickness: 6 })).toBeGreaterThan(at({ thickness: 3 }))
    expect(at({}, 200)).toBeGreaterThan(at({}, 100))
    expect(at({ life: 0.3 })).toBeLessThan(at({ life: 4 }))
    expect(at({ thickness: 0 })).toBeGreaterThan(0)
  })

  it('holds a pool’s worth of rings at the most a study reaches under a tenth, on every canvas shape', () => {
    // The study's own worst: a roll of four a beat at the fastest tempo the tracker reports, the thickest
    // an energetic passage makes it, the fastest a low end makes it travel, and the shortest life a build leaves.
    const worst = params({ rate: 4, thickness: 3.3, speed: 0.32, life: 0.9 })
    for (const [width, height] of SIZES)
      expect(ringsCoverage(worst, 200, width, height), `${width} by ${height}`).toBeLessThan(0.1)
  })
})

describe('how bright a ring gets', () => {
  const edge = 1

  it('reaches at least the light one frame adds, at any speed a ring travels, and at the slowest not a bar of light', () => {
    // A ring sweeps a pixel in a frame or two and the canvas takes its floor off
    // the wake, so the peak is what a frame adds and the wake does not sum to much more.
    for (const speed of [0.05, 0.1, 0.24, 0.4, 0.8]) {
      const peak = ringPassPeak(0.8, speed * 1080, 3, edge)
      expect(peak, `speed ${speed}`).toBeGreaterThanOrEqual(0.8 - 1e-9)
    }

    // At the resting speed the pixel that gets most is barely over what a frame adds.
    expect(ringPassPeak(0.8, 0.24 * 1080, 3, edge)).toBeLessThan(0.8 * 1.25)
  })

  it('leaves a wake that the floor eats, so a dim ring is not one that builds', () => {
    // An intensity under the floor adds nothing that survives a frame, however slow the ring.
    expect(ringPassPeak(CANVAS_FLOOR * 0.9, 0.24 * 1080, 3, edge)).toBeLessThanOrEqual(
      CANVAS_FLOOR * 0.9 * 1.001,
    )
    // And the decay is the canvas's own.
    expect(FEEDBACK_KEEP).toBe(0.93)
  })
})

describe('the uniform the shader reads', () => {
  it('is the canvas, then the ring’s thickness and its soft edge in pixels', () => {
    const out = writeRingUniform(
      params({ thickness: 4 }),
      3840,
      2160,
      new Float32Array(RING_UNIFORM_FLOATS),
    )
    expect(Array.from(out)).toEqual([3840, 2160, 8, 2])
  })
})
