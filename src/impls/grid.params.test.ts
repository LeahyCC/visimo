/**
 * The grid's numbers: the knobs the study resolves, the pulse's clock, the
 * line's light across itself and the coverage the study is held to. Pure
 * arithmetic, no device. What the lines look like is judged on a real adapter;
 * what is measured here is what the picture is made of.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  GRID_BASE_HUE,
  GRID_CELL,
  GRID_HUE_GAP,
  GRID_LOD,
  GRID_RANGES,
  GRID_REACH,
  GRID_UNIFORM_FLOATS,
  gridCoverage,
  gridGlowPixels,
  gridLit,
  gridParams,
  gridWidthPixels,
  HORIZON_GAIN,
  idlePulse,
  lineCrowding,
  lineDetail,
  lineLight,
  lineNearness,
  lineThinning,
  PULSE_FAR,
  PULSE_NEAR,
  PULSE_SECONDS,
  pulseAt,
  stepPulse,
  writeGridUniform,
} from './grid.params'

const REST = {
  speed: 1.2,
  height: 0.55,
  valley: 0.5,
  width: 0.8,
  glow: 3.2,
  intensity: 1.6,
  pulse: 0,
  hue: 0,
}

describe('the knobs', () => {
  it('holds every knob to its range and takes a missing or broken one from the fallback', () => {
    const params = gridParams({ speed: 900, height: -3, valley: 4, width: Number.NaN, glow: -1 })
    for (const [knob, [low, high]] of Object.entries(GRID_RANGES))
      expect(params[knob as keyof typeof params]).toBeGreaterThanOrEqual(low)
    expect(params.speed).toBe(GRID_RANGES.speed[1])
    expect(params.height).toBe(0)
    expect(params.valley).toBe(GRID_RANGES.valley[1])
    expect(params.width).toBe(0.8)
    expect(params.glow).toBe(GRID_RANGES.glow[0])
    // A study that resolved nothing draws nothing.
    expect(gridLit(gridParams({}))).toBe(false)
    expect(gridLit(gridParams(REST))).toBe(true)
  })

  it('sizes a line in pixels of the canvas it is drawn on, so a 4K one is the same line', () => {
    expect(gridWidthPixels(1, 1920, 1080)).toBe(1)
    expect(gridWidthPixels(1, 3840, 2160)).toBe(2)
    expect(gridGlowPixels(3, 1080, 1920)).toBe(3)
    expect(gridGlowPixels(3, 2160, 3840)).toBe(6)
  })
})

describe('the pulse', () => {
  const run = (seconds: number, fps: number, trigger: (time: number) => number) => {
    const state = idlePulse()
    const starts: number[] = []
    let last = state.age
    for (let step = 0; step < Math.round(seconds * fps); step += 1) {
      stepPulse(state, trigger(step / fps), 1 / fps)
      if (state.age < last) starts.push(step / fps)
      last = state.age
    }

    return { state, starts }
  }

  it('is idle until an impact, and starts one pulse on it however slowly it decays', () => {
    expect(pulseAt(idlePulse().age)).toEqual({ position: 0, strength: 0 })
    // The packet's impact is 1 for a frame and falls to 1/e in 180 ms, so it is
    // over the trigger for a few frames; that is one pulse and not several.
    const { starts } = run(3, 60, (time) => (time < 0.5 ? 0 : Math.exp(-(time - 0.5) / 0.18)))
    expect(starts).toHaveLength(1)
    expect(starts[0]).toBeCloseTo(0.5, 1)
  })

  it('starts another for the next impact once the trigger has fallen', () => {
    const { starts } = run(3, 60, (time) => {
      for (const at of [0.2, 1.4])
        if (time >= at) if (time < at + 0.6) return Math.exp(-(time - at) / 0.18)
      return 0
    })
    expect(starts).toHaveLength(2)
  })

  it('takes the same seconds to cross at any frame rate', () => {
    const ages = [30, 60, 144, 240].map((fps) => {
      const state = idlePulse()
      stepPulse(state, 1, 1 / fps)
      for (let step = 1; step < Math.round(0.5 * fps); step += 1) stepPulse(state, 0, 1 / fps)
      return state.age
    })

    for (const age of ages) expect(age).toBeCloseTo(0.5 - 1 / 30, 1)
    expect(Math.max(...ages) - Math.min(...ages)).toBeLessThan(1 / 30 + 1e-9)
  })

  it('does not wake from a hidden tab with the pulse already over', () => {
    const state = idlePulse()
    stepPulse(state, 1, 1 / 60)
    stepPulse(state, 0, 60)
    expect(state.age).toBeLessThan(0.2)
    stepPulse(state, 0, Number.NaN)
    expect(Number.isFinite(state.age)).toBe(true)
  })

  it('runs from the horizon to the camera and gets faster on the way', () => {
    const start = pulseAt(0.001)
    const end = pulseAt(PULSE_SECONDS * 0.999)
    expect(start.position).toBeCloseTo(1 / PULSE_FAR, 3)
    expect(end.position).toBeCloseTo(1 / PULSE_NEAR, 1)
    let previous = pulseAt(0).position
    let previousStep = 0
    for (let step = 1; step <= 50; step += 1) {
      const { position } = pulseAt((step / 51) * PULSE_SECONDS)
      expect(position).toBeGreaterThan(previous)
      // Squared, so each step is longer than the one before.
      expect(position - previous).toBeGreaterThanOrEqual(previousStep - 1e-9)
      previousStep = position - previous
      previous = position
    }
  })

  it('fades in and out, so it is never a cut, and is nothing outside its time', () => {
    expect(pulseAt(0).strength).toBe(0)
    expect(pulseAt(PULSE_SECONDS * 0.5).strength).toBe(1)
    expect(pulseAt(PULSE_SECONDS * 0.99).strength).toBeLessThan(0.2)
    expect(pulseAt(PULSE_SECONDS)).toEqual({ position: 0, strength: 0 })
    expect(pulseAt(-1)).toEqual({ position: 0, strength: 0 })
    expect(pulseAt(Number.NaN)).toEqual({ position: 0, strength: 0 })
  })
})

describe('a line across itself', () => {
  it('keeps its whole width at any place on the pixel grid, which is what anti-aliased means', () => {
    for (const half of [0.4, 0.8, 1.7])
      for (const offset of [0, 0.13, 0.5, 0.77, 0.99]) {
        let sum = 0
        for (let pixel = -8; pixel <= 8; pixel += 1)
          sum += lineLight(Math.abs(pixel + 0.5 - (offset + 0.5)), half, 3).core

        expect(sum, `half ${half} at ${offset}`).toBeCloseTo(2 * half, 9)
      }
  })

  it('has a core that is all of it in the middle and none past a pixel of its edge, and a glow that only falls', () => {
    expect(lineLight(0, 0.8, 3).core).toBe(1)
    expect(lineLight(0.8 + 0.5, 0.8, 3).core).toBe(0)
    let previous = Number.POSITIVE_INFINITY
    for (let distance = 0; distance < 30; distance += 0.5) {
      const { glow } = lineLight(distance, 0.8, 3)
      expect(glow).toBeLessThanOrEqual(previous)
      previous = glow
    }

    expect(lineLight(0, 0.8, 3).glow).toBe(0.5)
    expect(lineLight(60, 0.8, 3).glow).toBeLessThan(1e-9)
  })

  it('fades lines out once a pixel spans too many of them, and never adds any', () => {
    expect(lineDetail(0)).toBe(1)
    expect(lineDetail(GRID_LOD.start)).toBe(1)
    expect(lineDetail(GRID_LOD.end)).toBe(0)
    expect(lineDetail(50)).toBe(0)
    let previous = 1
    for (let footprint = 0; footprint < 0.6; footprint += 0.01) {
      expect(lineDetail(footprint)).toBeLessThanOrEqual(previous)
      previous = lineDetail(footprint)
    }
  })

  it('thins with distance, and leaves less of the crossing lines as they pack and of the nearest ones', () => {
    expect(lineThinning(0)).toBe(1)
    expect(lineThinning(GRID_REACH)).toBeCloseTo(0.4, 9)
    expect(lineCrowding(0)).toBe(1)
    expect(lineCrowding(1)).toBeCloseTo(0.1, 9)
    expect(lineNearness(0.5)).toBeCloseTo(0.3, 9)
    expect(lineNearness(10)).toBe(1)
  })
})

describe('the uniform', () => {
  const features = new Float32Array(PACKET_LENGTH)
  const write = (over: Partial<typeof REST> = {}, keyHue = 0, pulseAge = PULSE_SECONDS) => {
    features[F.keyHue] = keyHue
    return writeGridUniform(
      gridParams({ ...REST, ...over }),
      features,
      1920,
      1080,
      0.25,
      pulseAge,
      new Float32Array(GRID_UNIFORM_FLOATS),
    )
  }

  it('lays its twelve floats out as the shader reads them', () => {
    const out = write()
    expect(out).toHaveLength(12)
    expect(out[2]).toBeCloseTo(1.6, 6)
    expect(out[3]).toBeCloseTo(3.2, 6)
    expect(out[4]).toBeCloseTo(0.8, 6)
    expect(out[5]).toBe(GRID_CELL)
    expect(out[6]).toBe(GRID_REACH)
    expect(out[7]).toBeCloseTo(HORIZON_GAIN, 6)
    expect(out[8]).toBe(0.25)
    // No pulse in the air: nothing of it reaches the shader.
    expect(out[11]).toBe(0)
  })

  it('colours the near lines and the horizon a third of a turn apart, and turns both with the key', () => {
    for (const key of [0, 0.25, 0.7]) {
      const out = write({}, key)
      expect((out[1] ?? 0) - (out[0] ?? 0)).toBeCloseTo(GRID_HUE_GAP, 6)
      expect(out[0]).toBeCloseTo(key + GRID_BASE_HUE, 6)
    }

    expect(GRID_HUE_GAP).toBeCloseTo(1 / 3, 12)
    // The offset a chord change adds moves both, not one.
    const nudged = write({ hue: 0.1 })
    expect((nudged[1] ?? 0) - (nudged[0] ?? 0)).toBeCloseTo(GRID_HUE_GAP, 6)
    expect(nudged[0]).toBeCloseTo(GRID_BASE_HUE + 0.1, 6)
  })

  it('hands the shader the pulse only while it is in the air', () => {
    const out = write({}, 0, PULSE_SECONDS * 0.5)
    expect(out[9]).toBeGreaterThan(1 / PULSE_FAR)
    expect(out[11]).toBe(1)
  })
})

describe('what it lights', () => {
  // The widest lines the study reaches: a full packet with the hardness at
  // nothing and the bass pulse up, at the intensity it rests at.
  const WIDEST = gridParams({ ...REST, width: 1.7, glow: 5.7 })
  const CANVASES = [
    [480, 270],
    [270, 270],
    [200, 360],
  ] as const

  it('lights a small share of the frame at the widest, on a wide, a square and a tall canvas', () => {
    for (const [width, height] of CANVASES) {
      const share = gridCoverage(WIDEST, width, height)
      expect(share, `${width} by ${height}`).toBeGreaterThan(0.02)
      expect(share, `${width} by ${height}`).toBeLessThan(0.25)
    }
  })

  it('lights less at the resting width than at the widest', () => {
    expect(gridCoverage(gridParams(REST), 480, 270)).toBeLessThan(gridCoverage(WIDEST, 480, 270))
  })

  it('lights the same share of a frame at two sizes, so a 4K canvas is not a denser grid', () => {
    const small = gridCoverage(gridParams(REST), 320, 180)
    const large = gridCoverage(gridParams(REST), 640, 360)
    expect(Math.abs(small - large)).toBeLessThan(0.04)
  })

  it('lights nothing with no light', () => {
    expect(gridCoverage(gridParams({ ...REST, intensity: 0 }), 160, 90)).toBe(0)
  })
})
