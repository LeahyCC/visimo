/**
 * The caustics' numbers without a browser: that the pattern is the maths its
 * header says, that the lines carry all of the light and the black between
 * them is exactly black, that it stays sparse at the bottom of every range and
 * on every canvas shape, that the same seconds draw the same picture at any
 * frame rate, and that the uniform is laid out the way the shader reads it.
 * The study's own numbers are held in `studies/caustics.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { ribbonColour } from '../post/params'
import {
  advanceClock,
  BAND,
  causticFold,
  causticLine,
  CAUSTICS_RANGES,
  CAUSTICS_UNIFORM_FLOATS,
  causticsLit,
  causticsParams,
  CUT,
  FEEDBACK_KEEP,
  LIT_THRESHOLD,
  MEAN_BUDGET,
  MIN_PIXELS,
  sampleCaustics,
  SETTLE,
  settledMean,
  wavePhases,
  WAVES,
  writeCausticsUniform,
} from './caustics.params'
import type { CausticsClock } from './caustics.params'

const TAU = Math.PI * 2

const REST = { intensity: 0.22, scale: 4, speed: 0.1, sharpness: 8, hueSpread: 0.12 }

/** A packet with a key in it, so the palette has somewhere to be. */
const packetOf = (keyHue: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  out[F.keyHue] = keyHue
  return out
}

const phasesAt = (phase: number) => {
  const out = [0, 0, 0, 0]
  wavePhases(phase, out)
  return out
}

describe('the knobs', () => {
  it('are held to their ranges, and a missing or non-finite one falls to the bottom of its own', () => {
    const wild = causticsParams({
      intensity: 9,
      scale: 99,
      speed: 9,
      sharpness: 99,
      hueSpread: 9,
    })
    expect(wild).toEqual({ intensity: 0.6, scale: 8, speed: 0.4, sharpness: 24, hueSpread: 0.3 })
    const bad = causticsParams({
      intensity: Number.NaN,
      scale: -3,
      speed: Number.POSITIVE_INFINITY,
    })
    // No light and no motion, and the two shape numbers at their mildest.
    expect(bad).toEqual({ intensity: 0, scale: 1, speed: 0, sharpness: 1, hueSpread: 0 })
    expect(causticsLit(bad)).toBe(false)
  })

  it('are lit only when there is light to add', () => {
    expect(causticsLit(causticsParams({ ...REST, intensity: 0 }))).toBe(false)
    expect(causticsLit(causticsParams(REST))).toBe(true)
  })

  it('has a range that starts at a legal value for every knob', () => {
    for (const [low, high] of Object.values(CAUSTICS_RANGES)) expect(low).toBeLessThan(high)
    // The pattern divides by neither, but a scale or a sharpness of 0 is no pattern.
    expect(CAUSTICS_RANGES.scale[0]).toBeGreaterThan(0)
    expect(CAUSTICS_RANGES.sharpness[0]).toBeGreaterThanOrEqual(1)
  })
})

// The header says the pattern is where light piles up under a rippled
// surface. That is a claim about a map, so it is checked against the map: the
// determinant of the Jacobian of `p + gradient(h)` for the surface the waves
// describe, taken numerically, has to be the closed form the pattern uses.
describe('the pattern is the fold of a real map', () => {
  const surface = (x: number, y: number, scale: number, offsets: number[]) => {
    let gx = 0
    let gy = 0
    for (let index = 0; index < WAVES.length; index += 1) {
      const wave = WAVES[index]
      if (!wave) continue
      const cycles = scale * wave.frequency
      const dx = Math.cos(wave.angle)
      const dy = Math.sin(wave.angle)
      // focus = amplitude x wave number squared, so this is the amplitude that has it.
      const amplitude = wave.focus / (TAU * cycles) ** 2
      const slope = amplitude * Math.cos(TAU * (cycles * (dx * x + dy * y) + (offsets[index] ?? 0)))
      gx += slope * TAU * cycles * dx
      gy += slope * TAU * cycles * dy
    }

    return [x + gx, y + gy] as const
  }

  it('has the closed-form determinant of the map at every point tried', () => {
    const step = 1e-5
    for (const scale of [1, 4, 8]) {
      const offsets = phasesAt(0.7)
      for (let sample = 0; sample < 40; sample += 1) {
        const x = Math.sin(sample * 1.7) * 0.9
        const y = Math.cos(sample * 2.3) * 0.5
        const right = surface(x + step, y, scale, offsets)
        const left = surface(x - step, y, scale, offsets)
        const up = surface(x, y + step, scale, offsets)
        const down = surface(x, y - step, scale, offsets)
        const a = (right[0] - left[0]) / (2 * step)
        const b = (up[0] - down[0]) / (2 * step)
        const c = (right[1] - left[1]) / (2 * step)
        const d = (up[1] - down[1]) / (2 * step)
        const numeric = a * d - b * c
        const closed = causticFold(x, y, scale, offsets).determinant
        // Second differences of a wave that is faster at a larger scale lose a
        // little more, so the tolerance follows the scale.
        expect(closed, `scale ${scale} sample ${sample}`).toBeCloseTo(
          numeric,
          3 - Math.log10(scale),
        )
      }
    }
  })

  it('has a slope that is the derivative of the determinant', () => {
    const step = 1e-6
    const offsets = phasesAt(1.3)
    for (let sample = 0; sample < 40; sample += 1) {
      const x = Math.sin(sample * 0.9) * 0.8
      const y = Math.cos(sample * 1.9) * 0.5
      const fold = causticFold(x, y, 4, offsets)
      const dx =
        (causticFold(x + step, y, 4, offsets).determinant -
          causticFold(x - step, y, 4, offsets).determinant) /
        (2 * step)
      const dy =
        (causticFold(x, y + step, 4, offsets).determinant -
          causticFold(x, y - step, 4, offsets).determinant) /
        (2 * step)
      expect(fold.slopeX).toBeCloseTo(dx, 2)
      expect(fold.slopeY).toBeCloseTo(dy, 2)
    }
  })

  it('folds at all: the determinant goes both ways, which it could not if the total focus were under 1', () => {
    expect(WAVES.reduce((sum, wave) => sum + wave.focus, 0)).toBeGreaterThan(1)
    const offsets = phasesAt(0)
    let low = Infinity
    let high = -Infinity
    for (let sample = 0; sample < 2000; sample += 1) {
      const d = causticFold(Math.sin(sample * 0.31), Math.cos(sample * 0.77) * 0.5, 4, offsets)
      low = Math.min(low, d.determinant)
      high = Math.max(high, d.determinant)
    }

    expect(low).toBeLessThan(-BAND)
    expect(high).toBeGreaterThan(BAND)
  })
})

describe('the lines carry the light and everything between them is black', () => {
  const offsets = phasesAt(0.4)
  const points = Array.from({ length: 4000 }, (_, index) => [
    Math.sin(index * 0.37) * 1.1,
    Math.cos(index * 0.61) * 0.55,
  ])
  const pixel = 1 / 1080

  it('is between 0 and 1 everywhere', () => {
    for (const sharpness of [1, 8, 24])
      for (const [x, y] of points) {
        const line = causticLine(x ?? 0, y ?? 0, 4, sharpness, offsets, pixel)
        expect(line).toBeGreaterThanOrEqual(0)
        expect(line).toBeLessThanOrEqual(1)
      }
  })

  it('is exactly zero wherever the determinant is over the band, not a dim haze', () => {
    let far = 0
    for (const [x, y] of points) {
      const fold = causticFold(x ?? 0, y ?? 0, 4, offsets)
      const band = Math.max(BAND, MIN_PIXELS * pixel * Math.hypot(fold.slopeX, fold.slopeY))
      if (Math.abs(fold.determinant) < band * 1.001) continue
      far += 1
      // At the mildest sharpness there is, so a power is not doing the work.
      expect(causticLine(x ?? 0, y ?? 0, 4, 1, offsets, pixel)).toBe(0)
    }

    // And that is most of the frame: the dark is not a corner case.
    expect(far / points.length).toBeGreaterThan(0.75)
  })

  it('has next to nothing dim: what is not black is a line, and few pixels are in between', () => {
    // A haze is a lot of pixels at a little light. Count pixels that are on
    // but under the lit threshold, at the resting sharpness. Before the cut
    // the shoulder of every line was a share of the frame as big as the line.
    let dim = 0
    let on = 0
    for (const [x, y] of points) {
      const line = causticLine(x ?? 0, y ?? 0, 4, REST.sharpness, offsets, pixel)
      if (line > 0) on += 1
      if (line > 0 && line <= LIT_THRESHOLD) dim += 1
    }

    expect(on).toBeGreaterThan(0)
    expect(dim / points.length).toBeLessThan(0.01)
    expect(dim).toBeLessThan(on / 5)
  })

  it('takes the faint shoulder off a line: what the power leaves under the cut is exactly zero, and the peak still reaches 1', () => {
    let peak = 0
    for (const [x, y] of points) {
      const fold = causticFold(x ?? 0, y ?? 0, 4, offsets)
      const band = Math.max(BAND, MIN_PIXELS * pixel * Math.hypot(fold.slopeX, fold.slopeY))
      const ratio = fold.determinant / band
      const raised = Math.pow(Math.max(1 - ratio * ratio, 0), 8) * (BAND / band)
      const line = causticLine(x ?? 0, y ?? 0, 4, 8, offsets, pixel)
      if (raised <= CUT) expect(line).toBe(0)
      else expect(line).toBeCloseTo((raised - CUT) / (1 - CUT), 9)
      peak = Math.max(peak, line)
    }

    expect(peak).toBeGreaterThan(0.6)
    expect(peak).toBeLessThanOrEqual(1)
  })

  it('is brightest on the fold itself', () => {
    // Walk along x until the determinant changes sign, and the brightness is
    // near its peak there and far lower a little either side of it.
    const start = phasesAt(0.4)
    let found = false
    for (let step = 0; step < 4000 && !found; step += 1) {
      const x = -1 + step * 0.0005
      const here = causticFold(x, 0.1, 4, start).determinant
      const next = causticFold(x + 0.0005, 0.1, 4, start).determinant
      if (here * next >= 0) continue
      found = true
      const on = causticLine(x, 0.1, 4, 4, start, pixel)
      const off = causticLine(x + 0.05, 0.1, 4, 4, start, pixel)
      expect(on).toBeGreaterThan(0.3)
      expect(on).toBeGreaterThan(off)
    }

    expect(found).toBe(true)
  })

  it('thins as the sharpness rises: fewer pixels lit and less light, at every step', () => {
    const shapes = [1, 2, 4, 8, 12, 16, 24].map((sharpness) => sampleCaustics(4, sharpness))
    for (let step = 1; step < shapes.length; step += 1) {
      expect(shapes[step]?.coverage ?? 1).toBeLessThan(shapes[step - 1]?.coverage ?? 0)
      expect(shapes[step]?.mean ?? 1).toBeLessThan(shapes[step - 1]?.mean ?? 0)
    }
  })

  // The determinant's slope is huge on some folds, which are then thinner than
  // a pixel and would dash and crawl. They are widened to a pixel and a half
  // and dimmed by the same ratio, so the light in the frame is the same.
  it('keeps the light in a line when a pixel widens it, so the mean does not depend on the canvas', () => {
    const fine = sampleCaustics(4, 8, 16 / 9, 48, 8, 1 / 4320).mean
    const coarse = sampleCaustics(4, 8, 16 / 9, 48, 8, 1 / 270).mean
    expect(Math.abs(coarse - fine) / fine).toBeLessThan(0.1)
  })
})

describe('how much of the frame it lights', () => {
  // The bottom of the sharpness range is the widest the lines get, and the
  // scale and the canvas shape are free: whatever a cast does, the share of
  // the frame that is lit at all stays under a fifth.
  it('is under a fifth of the frame at the mildest sharpness, at every scale and on every canvas shape', () => {
    for (const scale of [1, 4, 8])
      for (const aspect of [16 / 9, 1, 9 / 16, 32 / 9]) {
        const { coverage } = sampleCaustics(scale, CAUSTICS_RANGES.sharpness[0], aspect, 48, 8)
        expect(coverage, `scale ${scale} aspect ${aspect}`).toBeLessThan(1 / 5)
        expect(coverage, `scale ${scale} aspect ${aspect}`).toBeGreaterThan(0.03)
      }
  })

  it('does not depend on how many cells there are, only on how thin the lines are', () => {
    const few = sampleCaustics(1, 8).coverage
    const many = sampleCaustics(8, 8).coverage
    expect(Math.abs(few - many) / many).toBeLessThan(0.15)
  })
})

// The arithmetic the header states: the canvas keeps FEEDBACK_KEEP of itself a
// frame, so a still image sums to about fourteen times what a frame adds.
describe('the mean light the canvas can settle at', () => {
  it('is fourteen times what one frame adds, at the trail the longest cast keeps', () => {
    expect(FEEDBACK_KEEP).toBe(0.93)
    expect(SETTLE).toBeCloseTo(14.29, 2)
    let sum = 0
    for (let frame = 0; frame < 2000; frame += 1) sum += FEEDBACK_KEEP ** frame
    expect(sum).toBeCloseTo(SETTLE, 6)
  })

  it('is a budget the lowest legal ceiling clears: the ceiling bends only above half of it', () => {
    // The lowest ceiling a cast may set is 0.5, and it bends above half of that.
    expect(MEAN_BUDGET).toBeLessThan(0.5 / 2)
  })

  it('is nothing with no light, and grows with the intensity', () => {
    expect(settledMean(causticsParams({ ...REST, intensity: 0 }))).toBe(0)
    const dim = settledMean(causticsParams({ ...REST, intensity: 0.1 }))
    const bright = settledMean(causticsParams({ ...REST, intensity: 0.2 }))
    expect(bright).toBeCloseTo(dim * 2, 6)
  })

  it('is under the budget at the top of the light range only if the lines are thin enough, which is what the sharpness is for', () => {
    const top = causticsParams({ ...REST, intensity: CAUSTICS_RANGES.intensity[1] })
    // Nothing stops a cast writing the top of the range, so the budget is not
    // held there and the study's rows are what hold it.
    expect(settledMean(top)).toBeGreaterThan(MEAN_BUDGET)
    expect(settledMean(causticsParams(REST))).toBeLessThan(MEAN_BUDGET)
  })
})

describe('the same at any frame rate', () => {
  it('runs the clocks by the real step, so the same seconds are the same phase at 30, 60, 144 and 240 a second', () => {
    const at = (fps: number) => {
      const clock: CausticsClock = { phase: 0, seconds: 0 }
      for (let frame = 0; frame < fps * 4; frame += 1) advanceClock(clock, 0.1, 1 / fps)
      return clock
    }

    const reference = at(60)
    expect(reference.phase).toBeCloseTo(0.4, 9)
    expect(reference.seconds).toBeCloseTo(4, 9)
    for (const fps of [30, 144, 240]) {
      expect(at(fps).phase).toBeCloseTo(reference.phase, 9)
      expect(at(fps).seconds).toBeCloseTo(reference.seconds, 9)
    }
  })

  it('draws the same picture after the same seconds at any frame rate', () => {
    const picture = (fps: number) => {
      const clock: CausticsClock = { phase: 0, seconds: 0 }
      for (let frame = 0; frame < fps * 5; frame += 1) advanceClock(clock, 0.2, 1 / fps)
      const offsets = phasesAt(clock.phase)
      return Array.from({ length: 200 }, (_, index) =>
        causticLine(Math.sin(index) * 0.8, Math.cos(index * 1.3) * 0.5, 4, 4, offsets, 1 / 1080),
      )
    }

    const reference = picture(60)
    for (const fps of [30, 144, 240])
      picture(fps).forEach((value, index) =>
        expect(value).toBeCloseTo(reference[index] ?? Number.NaN, 5),
      )
  })

  it('does not advance on a step that is not a time, and stops with a speed of 0', () => {
    const clock: CausticsClock = { phase: 1, seconds: 2 }
    advanceClock(clock, 0.1, 0)
    advanceClock(clock, 0.1, Number.NaN)
    advanceClock(clock, 0.1, -1)
    expect(clock).toEqual({ phase: 1, seconds: 2 })
    advanceClock(clock, 0, 1)
    expect(clock.phase).toBe(1)
    expect(clock.seconds).toBe(3)
  })

  it('moves: the pattern is not the same a second on, and the waves turn at different rates and directions', () => {
    const a = phasesAt(0)
    const b = phasesAt(0.5)
    for (let index = 0; index < a.length; index += 1)
      expect(b[index]).not.toBeCloseTo(a[index] ?? Number.NaN, 3)
    const rates = WAVES.map((wave) => wave.rate)
    expect(new Set(rates.map(Math.abs)).size).toBe(rates.length)
    expect(rates.some((rate) => rate < 0)).toBe(true)
    expect(rates.some((rate) => rate > 0)).toBe(true)
  })

  it('keeps each wave’s offset in one cycle however long the song runs, so the sines stay accurate', () => {
    for (const phase of [0, 0.3, 17, 3600, 1e6]) {
      for (const offset of phasesAt(phase)) {
        expect(offset).toBeGreaterThanOrEqual(0)
        expect(offset).toBeLessThan(1)
      }
    }

    // Wrapping is not a jump: a step from one side of a cycle to the other is a small change.
    const before = causticLine(0.2, 0.1, 4, 4, phasesAt(3600), 1 / 1080)
    const after = causticLine(0.2, 0.1, 4, 4, phasesAt(3600 + 1e-7), 1 / 1080)
    expect(Math.abs(after - before)).toBeLessThan(1e-3)
  })
})

describe('the uniform', () => {
  const clock: CausticsClock = { phase: 1.25, seconds: 30 }
  const params = causticsParams(REST)
  const packet = packetOf(0.3)
  const out = writeCausticsUniform(
    params,
    clock,
    packet,
    1920,
    1080,
    new Float32Array(CAUSTICS_UNIFORM_FLOATS),
  )

  it('is forty-four floats, the eleven vec4s the shader declares', () => {
    expect(CAUSTICS_UNIFORM_FLOATS).toBe(44)
    expect(out).toHaveLength(44)
  })

  it('leads with the canvas and the sharpness', () => {
    expect([...out.slice(0, 4)]).toEqual([1920, 1080, REST.sharpness, 0].map(Math.fround))
  })

  it('carries each wave’s offset, wrapped to a cycle', () => {
    const offsets = phasesAt(clock.phase)
    for (let index = 0; index < 4; index += 1) {
      expect(out[4 + index]).toBeCloseTo(offsets[index] ?? Number.NaN, 6)
      expect(out[4 + index] ?? -1).toBeGreaterThanOrEqual(0)
      expect(out[4 + index] ?? 2).toBeLessThan(1)
    }
  })

  it('carries the shape of a line: the band, the least width in pixels and the cut', () => {
    expect([...out.slice(12, 16)]).toEqual([BAND, MIN_PIXELS, CUT, 0].map(Math.fround))
  })

  it('carries the colour gradient and the drift on the real clock', () => {
    expect(Math.hypot(out[8] ?? 0, out[9] ?? 0)).toBeCloseTo(0.2, 6)
    expect(out[10]).toBeCloseTo(0.6, 6)
    // The real clock, not the pattern's: a speed of 0 does not stop the colour.
    const still = writeCausticsUniform(
      causticsParams({ ...REST, speed: 0 }),
      { phase: 0, seconds: 25 },
      packet,
      1920,
      1080,
      new Float32Array(CAUSTICS_UNIFORM_FLOATS),
    )
    const later = writeCausticsUniform(
      causticsParams({ ...REST, speed: 0 }),
      { phase: 0, seconds: 26 },
      packet,
      1920,
      1080,
      new Float32Array(CAUSTICS_UNIFORM_FLOATS),
    )
    expect(still[10]).not.toBeCloseTo(later[10] ?? Number.NaN, 3)
  })

  it('carries each wave as a unit direction, cycles across the short side with the scale in, and its focus', () => {
    WAVES.forEach((wave, index) => {
      const at = 16 + index * 4
      expect(Math.hypot(out[at] ?? 0, out[at + 1] ?? 0)).toBeCloseTo(1, 6)
      expect(out[at + 2]).toBeCloseTo(REST.scale * wave.frequency, 6)
      expect(out[at + 3]).toBeCloseTo(wave.focus, 6)
    })
  })

  it('is the ribbon’s palette at the key, at three places round it, already times the intensity', () => {
    const [red, green, blue] = ribbonColour(packet, 0)
    expect(out[36]).toBeCloseTo(red * REST.intensity, 6)
    expect(out[37]).toBeCloseTo(green * REST.intensity, 6)
    expect(out[38]).toBeCloseTo(blue * REST.intensity, 6)
    const low = ribbonColour(packet, -REST.hueSpread / 2)
    const high = ribbonColour(packet, REST.hueSpread / 2)
    expect(out[32]).toBeCloseTo(low[0] * REST.intensity, 6)
    expect(out[42]).toBeCloseTo(high[2] * REST.intensity, 6)
    // The spread is real: the ends are not the middle.
    expect(
      Math.abs((out[32] ?? 0) - (out[40] ?? 0)) + Math.abs((out[34] ?? 0) - (out[42] ?? 0)),
    ).toBeGreaterThan(0.01)
  })

  it('is all one colour with no spread, and follows the key', () => {
    const flat = writeCausticsUniform(
      causticsParams({ ...REST, hueSpread: 0 }),
      clock,
      packet,
      1920,
      1080,
      new Float32Array(CAUSTICS_UNIFORM_FLOATS),
    )
    for (let part = 0; part < 3; part += 1) {
      expect(flat[32 + part]).toBeCloseTo(flat[36 + part] ?? Number.NaN, 9)
      expect(flat[40 + part]).toBeCloseTo(flat[36 + part] ?? Number.NaN, 9)
    }

    const other = writeCausticsUniform(
      params,
      clock,
      packetOf(0.75),
      1920,
      1080,
      new Float32Array(CAUSTICS_UNIFORM_FLOATS),
    )
    expect([...other.slice(36, 39)]).not.toEqual([...out.slice(36, 39)])
  })

  it('leaves the padding at nothing', () => {
    for (const at of [3, 11, 15, 35, 39, 43]) expect(out[at]).toBe(0)
  })
})
