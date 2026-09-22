/**
 * The black hole ink's numbers. The one that matters most is the last block:
 * the annulus reads last frame's canvas, which already holds what this ink
 * drew a frame ago, and the whole of the card's brief for it was to prove
 * that it cannot feed itself to white. Everything above that is the geometry
 * and the falloffs the shader is a transcription of.
 */
import { describe, expect, it } from 'vitest'

import { REFERENCE_FPS } from '../post/params'
import shader from '../shaders/blackhole.wgsl?raw'
import { BLACKHOLE_KNOBS } from '../studies/impls'
import {
  BEND_SHIFT,
  BEND_TINT,
  bendGain,
  bendShift,
  bendWindow,
  BLACKHOLE_CORE_HUE,
  BLACKHOLE_HUE_GAP,
  BLACKHOLE_RANGES,
  BLACKHOLE_UNIFORM_FLOATS,
  blackHoleCoverage,
  blackHoleGeometry,
  blackHoleLit,
  blackHoleLoop,
  blackHoleParams,
  CANVAS_KEEP,
  canvasLoss,
  ringLight,
  ringPeak,
  writeBlackHoleUniform,
} from './blackhole.params'

/** What the study rests at, so the numbers below are the ones that ship. */
const REST = blackHoleParams({
  disc: 0.08,
  width: 0.011,
  annulus: 0.075,
  heat: 0.85,
  beam: 0.5,
  bend: 0.5,
  intensity: 1.15,
  hue: 0,
  spin: 0,
})

/** Every knob at the top of its range, which is past what the mapping reaches. */
const WIDEST = blackHoleParams(
  Object.fromEntries(BLACKHOLE_KNOBS.map((knob) => [knob, BLACKHOLE_RANGES[knob][1]])),
)

const RATES = [1 / 30, 1 / 60, 1 / 144, 1 / 240]

describe('the knobs', () => {
  it('gives every knob a range and a resting value inside it', () => {
    for (const knob of BLACKHOLE_KNOBS) {
      const [low, high] = BLACKHOLE_RANGES[knob]
      expect(low, knob).toBeGreaterThanOrEqual(0)
      expect(high, knob).toBeGreaterThan(low)
      expect(REST[knob], knob).toBeGreaterThanOrEqual(low)
      expect(REST[knob], knob).toBeLessThanOrEqual(high)
    }
  })

  it('clamps what it is handed, and falls back on a missing or broken one', () => {
    const wild = blackHoleParams({ disc: 9, bend: -4, heat: Number.NaN })
    expect(wild.disc).toBe(BLACKHOLE_RANGES.disc[1])
    expect(wild.bend).toBe(0)
    expect(wild.heat).toBe(0)
    expect(blackHoleParams({}).intensity).toBe(0)
  })

  it('draws nothing with no light, no width at all, or a dead ring under a dead bend', () => {
    expect(blackHoleLit(REST)).toBe(true)
    expect(blackHoleLit({ ...REST, intensity: 0 })).toBe(false)
    expect(blackHoleLit({ ...REST, width: 0, annulus: 0 })).toBe(false)
    expect(blackHoleLit({ ...REST, heat: 0, bend: 0 })).toBe(false)
    // A ring with no heat still has an annulus to bend, and the other way about.
    expect(blackHoleLit({ ...REST, heat: 0 })).toBe(true)
    expect(blackHoleLit({ ...REST, bend: 0 })).toBe(true)
  })
})

describe('the three rings of radius', () => {
  it('stacks the ring on the disc rim and the annulus on the ring', () => {
    const geometry = blackHoleGeometry(REST)
    expect(geometry.disc).toBeCloseTo(0.08, 12)
    expect(geometry.ring).toBeCloseTo(0.091, 12)
    expect(geometry.bend0).toBeCloseTo(0.102, 12)
    expect(geometry.outer).toBeCloseTo(0.177, 12)
    expect(geometry.ring - geometry.half).toBeCloseTo(geometry.disc, 12)
    expect(geometry.ring + geometry.half).toBeCloseTo(geometry.bend0, 12)
  })

  it('lights the ring across itself and exactly nothing past its own width', () => {
    const geometry = blackHoleGeometry(REST)
    const at = (radius: number) => ringLight(radius / geometry.outer, geometry)
    expect(at(geometry.ring)).toBeCloseTo(1, 12)
    // At the two edges the shape is zero to the last bit that dividing by the
    // outer radius and multiplying back leaves; a step past either of them is
    // exactly zero, which is what lets the annulus start where the ring ends.
    expect(at(geometry.disc)).toBeLessThan(1e-30)
    expect(at(geometry.bend0)).toBeLessThan(1e-30)
    expect(at(geometry.disc - 0.001)).toBe(0)
    expect(at(geometry.bend0 + 0.001)).toBe(0)
    // And it climbs all the way in, with no slope at either end.
    let last = 0
    for (let step = 1; step <= 20; step += 1) {
      const light = at(geometry.disc + (step / 20) * geometry.half)
      expect(light, `step ${step}`).toBeGreaterThanOrEqual(last)
      last = light
    }
  })

  it('rests with a core over 1, so the bloom catches it', () => {
    expect(ringPeak(REST)).toBeGreaterThan(1)
    expect(ringPeak({ ...REST, intensity: 0 })).toBe(0)
  })
})

describe('the coverage', () => {
  const SHAPES = [16 / 9, 21 / 9, 4 / 3, 1, 3 / 4, 9 / 16, 2.4, 0.5]

  it('lights a small share of the frame at rest and under a fifth at its widest', () => {
    for (const aspect of SHAPES) {
      expect(blackHoleCoverage(REST, aspect), `rest at ${aspect}`).toBeLessThan(0.09)
      expect(blackHoleCoverage(WIDEST, aspect), `widest at ${aspect}`).toBeLessThan(0.2)
    }

    expect(blackHoleCoverage(REST, 16 / 9)).toBeLessThan(0.05)
    expect(blackHoleCoverage(WIDEST, 16 / 9)).toBeLessThan(0.11)
  })

  it('counts nothing at all with nothing to draw', () => {
    expect(blackHoleCoverage({ ...REST, intensity: 0 })).toBe(0)
  })
})

/**
 * The loop. Two claims, and the second is the one the card asked for.
 */
describe('the annulus as a feedback loop', () => {
  // Rule 1. The gain and the displacement share one window, so the ink can
  // never read the radius it is drawing at. Without this the settled value
  // would be a fixed point rather than a chain and the bound below would say
  // nothing.
  it('never reads anything at a radius it is not also stepping away from', () => {
    for (const params of [REST, WIDEST, blackHoleParams({ ...REST, annulus: 0.005 })]) {
      const geometry = blackHoleGeometry(params)
      for (let step = 0; step <= 400; step += 1) {
        const x = step / 400
        const window = bendWindow(x, geometry)
        if (window <= 0) continue
        expect(bendShift(x, geometry), `x ${x}`).toBeGreaterThan(0)
      }
    }

    // And at the outer edge both are exactly nothing, so the chain ends.
    const geometry = blackHoleGeometry(REST)
    expect(bendWindow(1, geometry)).toBe(0)
    expect(bendShift(1, geometry)).toBe(0)
    expect(BEND_SHIFT).toBeGreaterThan(0)
  })

  // Rule 2. The gain is a share of what the canvas lets go of over the same
  // step, so it is the same loop at any frame rate and two orders under one.
  it('keeps the gain far under one, and the same share at every frame rate', () => {
    expect(canvasLoss(1 / REFERENCE_FPS)).toBeCloseTo(1 - CANVAS_KEEP, 12)
    for (const dt of RATES) {
      const gain = bendGain(WIDEST, dt)
      expect(gain, `${dt}`).toBeGreaterThan(0)
      expect(gain, `${dt}`).toBeLessThan(0.05)
      expect(gain / canvasLoss(dt), `${dt}`).toBeCloseTo(WIDEST.bend, 12)
    }

    expect(bendGain(REST, 1 / 60)).toBeCloseTo(0.5 * 0.025, 6)
    expect(bendGain({ ...REST, intensity: 0 }, 1 / 60)).toBe(0)
  })

  // The claim itself, run forward rather than argued. A picture that is white
  // everywhere, for ever, feeding the annulus: what it settles to has to stay
  // under what it is reading, at every radius and every frame rate.
  it('cannot feed itself to white, at four frame rates', () => {
    for (const params of [REST, WIDEST]) {
      for (const dt of RATES) {
        const settled = blackHoleLoop(params, dt, 900, 1)
        for (let sample = 0; sample < settled.length; sample += 1) {
          const value = settled[sample] ?? 0
          expect(Number.isFinite(value), `${dt} at ${sample}`).toBe(true)
          expect(value, `${dt} at ${sample}`).toBeLessThanOrEqual(1 + 1e-6)
        }
      }
    }
  })

  it('settles to the same profile at every frame rate, since the gain follows the loss', () => {
    const readings = RATES.map((dt) => blackHoleLoop(REST, dt, 2000, 1))
    const first = readings[0]
    if (!first) throw new Error('Expected a profile')
    for (const reading of readings.slice(1))
      for (let sample = 0; sample < reading.length; sample += 4)
        expect(reading[sample] ?? 0, `sample ${sample}`).toBeCloseTo(first[sample] ?? 0, 2)
  })

  it('goes to nothing once the picture it reads does', () => {
    const dark = blackHoleLoop(REST, 1 / 60, 1200, 0)
    for (const value of dark) expect(value).toBeCloseTo(0, 12)
  })

  // A fixed per-frame gain is exactly the mistake this design avoids, so the
  // test says what would have happened: at the canvas's keep, a gain of a
  // tenth settles at four times what it read.
  it('would have run away at a gain fixed per frame, which is why it is not', () => {
    expect(0.1 / (1 - CANVAS_KEEP)).toBeGreaterThan(1)
  })
})

describe('the uniform', () => {
  it('lays every number out where the shader reads it', () => {
    const out = writeBlackHoleUniform(REST, 0.25, 1 / 60, 1920, 1080, new Float32Array(20))
    const geometry = blackHoleGeometry(REST)
    expect(out[0]).toBe(1920)
    expect(out[1]).toBe(1080)
    expect(out[2]).toBeCloseTo(geometry.outer * 1080, 3)
    expect(out[4]).toBeCloseTo(geometry.disc / geometry.outer, 6)
    expect(out[5]).toBeCloseTo(geometry.ring / geometry.outer, 6)
    expect(out[6]).toBeCloseTo(geometry.half / geometry.outer, 6)
    expect(out[7]).toBeCloseTo(geometry.bend0 / geometry.outer, 6)
    expect(out[8]).toBeCloseTo(REST.intensity * REST.heat, 6)
    expect(out[9]).toBeCloseTo(REST.beam, 6)
    expect(out[10]).toBeCloseTo(REST.spin, 6)
    expect(out[12]).toBeCloseTo(bendGain(REST, 1 / 60), 6)
    expect(out[13]).toBeCloseTo(BEND_SHIFT, 6)
    expect(out[14]).toBeCloseTo(BEND_TINT, 6)
    expect(out[16]).toBeCloseTo(0.25 + BLACKHOLE_CORE_HUE, 6)
    expect(out[17]).toBeCloseTo(0.25 + BLACKHOLE_CORE_HUE + BLACKHOLE_HUE_GAP, 6)
    for (const pad of [3, 11, 15, 18, 19]) expect(out[pad], `float ${pad}`).toBe(0)
  })

  it('turns both hues together with the key and the offset, a third of a turn apart', () => {
    const out = writeBlackHoleUniform(
      { ...REST, hue: 0.2 },
      0.4,
      1 / 60,
      800,
      600,
      new Float32Array(20),
    )
    expect((out[17] ?? 0) - (out[16] ?? 0)).toBeCloseTo(1 / 3, 6)
    expect(out[16]).toBeCloseTo(0.4 + BLACKHOLE_CORE_HUE + 0.2, 6)
  })

  it('is a whole number of vec4s', () => {
    expect(BLACKHOLE_UNIFORM_FLOATS % 4).toBe(0)
    expect(BLACKHOLE_UNIFORM_FLOATS).toBe(20)
  })
})

describe('the shader says the same thing', () => {
  it('names the bindings and the falloffs this file holds', () => {
    expect(shader).toContain('@group(0) @binding(0) var<uniform> params: Params;')
    expect(shader).toContain('@group(0) @binding(1) var canvas: texture_2d<f32>;')
    expect(shader).toContain('@group(0) @binding(2) var samp: sampler;')
    expect(shader).toContain('fn quad(')
    expect(shader).toContain('fn fs(')
    expect(shader).toContain('fn ring_light(')
    expect(shader).toContain('fn bend_window(')
    expect(shader).toContain('fn vivid(')
  })

  it('reads five vec4s, one per block of the uniform', () => {
    const block = shader.slice(shader.indexOf('struct Params {'), shader.indexOf('@group(0)'))
    expect((block.match(/vec4<f32>,/g) ?? []).length).toBe(BLACKHOLE_UNIFORM_FLOATS / 4)
  })

  // The compile check in `test/wgsl.test.ts` catches a reserved word; this
  // catches the ones that are legal WGSL and still a mistake to lean on.
  it('uses no name WGSL keeps for itself', () => {
    for (const reserved of ['from', 'target', 'shared', 'common', 'filter'])
      expect(shader, reserved).not.toMatch(new RegExp(`(let|var|fn) ${reserved}\\b`))
  })
})
