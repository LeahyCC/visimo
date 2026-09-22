/**
 * The aurora's numbers: that its colour never leaves the arc a real one
 * lives in whatever the key and the chord do, that a curtain is the same
 * curtain at any frame rate, that its sway is per second and slow enough for
 * the canvas to carry, that its light is exactly nothing below the edge and at
 * the top, that the share of the frame it lights is bounded on any canvas, and
 * that a hit sends a ripple along a curtain and not a flash across the frame.
 * The shader is a transcription of this file, so the constants it shares are
 * read out of the shader text and held equal.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import shader from '../shaders/aurora.wgsl?raw'
import {
  advanceAurora,
  AURORA_ARC,
  AURORA_DEFAULTS,
  AURORA_RANGES,
  AURORA_UNIFORM_FLOATS,
  auroraColour,
  auroraHues,
  auroraLight,
  auroraLit,
  auroraParams,
  AuroraRipples,
  BASE_BAND,
  BODY_POWER,
  CURTAIN_COUNT,
  curtainEdge,
  curtainLight,
  curtainPhases,
  curtainPresence,
  CURTAINS,
  FOOT_GAIN,
  FOOT_HEIGHT,
  hueAlong,
  latticeHash,
  MAX_EDGE_SPEED,
  MAX_RAY_SPEED,
  maxEdgeSpeed,
  maxRaySpeed,
  newClock,
  RAY_SOFTEN,
  rayNoise,
  REACH_HIGH,
  REACH_LOW,
  RIPPLE_GAP_SECONDS,
  RIPPLE_LIFE,
  RIPPLE_SLOTS,
  RIPPLE_SPEED,
  rippleFade,
  sampleAurora,
  SWAY_FREQ,
  SWAY_RATE,
  TIP_BAND,
  writeAuroraUniform,
} from './aurora.params'
import type { AuroraClock, Ripple } from './aurora.params'

const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

/** The knobs at the most the study's own mapping reaches: a full, loud, tonal packet. */
const WORST = auroraParams({
  ...AURORA_DEFAULTS,
  intensity: 1.6,
  curtains: 3.8,
  height: 0.85,
  sway: 0.052,
  drift: 0.043,
  rays: 0.95,
  ripple: 0.8,
})

const REST = auroraParams(AURORA_DEFAULTS)

const SHAPES = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
  [2520, 1080],
  [1440, 1080],
  [3840, 1080],
  [1280, 1024],
  [800, 1200],
] as const

/** The clock after `seconds` of a drift, stepped at `rate` steps a second. */
const run = (seconds: number, rate: number, drift = 0.03): AuroraClock => {
  const clock = newClock()
  for (let step = 0; step < Math.round(seconds * rate); step += 1)
    advanceAurora(clock, drift, 1 / rate)
  return clock
}

describe('the knobs', () => {
  it('rest inside their ranges, and a resolved value is clamped to them', () => {
    for (const [knob, [low, high]] of Object.entries(AURORA_RANGES)) {
      const rest = AURORA_DEFAULTS[knob as keyof typeof AURORA_DEFAULTS]
      expect(rest, knob).toBeGreaterThanOrEqual(low)
      expect(rest, knob).toBeLessThanOrEqual(high)
    }

    const wild = auroraParams({ intensity: 99, curtains: 99, height: -4, sway: 9, drift: 9 })
    expect(wild.intensity).toBe(AURORA_RANGES.intensity[1])
    expect(wild.curtains).toBe(AURORA_RANGES.curtains[1])
    expect(wild.height).toBe(AURORA_RANGES.height[0])
    expect(wild.sway).toBe(AURORA_RANGES.sway[1])
    expect(wild.drift).toBe(AURORA_RANGES.drift[1])
  })

  it('is dark when it is told nothing, and lit only with both light and a curtain', () => {
    expect(auroraLit(auroraParams({}))).toBe(false)
    expect(auroraLit(auroraParams({ ...AURORA_DEFAULTS, intensity: 0 }))).toBe(false)
    expect(auroraLit(auroraParams({ ...AURORA_DEFAULTS, curtains: 0 }))).toBe(false)
    expect(auroraLit(REST)).toBe(true)
    expect(auroraParams({ intensity: Number.NaN, curtains: 1 }).intensity).toBe(0)
  })
})

describe('the colour', () => {
  const keys = Array.from({ length: 101 }, (_, at) => at / 100)
  const chords = Array.from({ length: 97 }, (_, at) => at / 96)

  it('keeps the foot in green to cyan and the top in violet to magenta at every key and chord', () => {
    for (const key of keys)
      for (const chord of chords) {
        const { base, tip } = auroraHues(key, chord)
        expect(base, `key ${key} chord ${chord}`).toBeGreaterThanOrEqual(BASE_BAND.low)
        expect(base, `key ${key} chord ${chord}`).toBeLessThanOrEqual(BASE_BAND.high)
        expect(tip, `key ${key} chord ${chord}`).toBeGreaterThanOrEqual(TIP_BAND.low)
        expect(tip, `key ${key} chord ${chord}`).toBeLessThanOrEqual(TIP_BAND.high)
      }
  })

  it('stays inside the arc all the way up a curtain, at every key', () => {
    for (const key of keys) {
      const { base, tip } = auroraHues(key, 0.13)
      for (let step = 0; step <= 20; step += 1) {
        const hue = hueAlong(base, tip, step / 20)
        expect(hue).toBeGreaterThanOrEqual(AURORA_ARC.low)
        expect(hue).toBeLessThanOrEqual(AURORA_ARC.high)
      }
    }
  })

  it('walks from the foot hue to the tip hue, holding the foot low down and the tip at the top', () => {
    const { base, tip } = auroraHues(0.2, 0)
    expect(hueAlong(base, tip, 0)).toBe(base)
    expect(hueAlong(base, tip, 1)).toBe(tip)
    expect(hueAlong(base, tip, 0.5)).toBeGreaterThan(base)
    expect(hueAlong(base, tip, 0.5)).toBeLessThan(tip)
  })

  it('never draws red: no colour in the arc is red without blue or green beside it', () => {
    for (let step = 0; step <= 200; step += 1) {
      const hue = AURORA_ARC.low + ((AURORA_ARC.high - AURORA_ARC.low) * step) / 200
      const [red, green, blue] = auroraColour(hue)
      // Magenta is red and blue together, so red may lead it by a third and no more.
      expect(Math.max(green, blue * 1.4), `hue ${hue}`).toBeGreaterThanOrEqual(red - 1e-9)
    }
  })

  it('treats the last key and the first as neighbours, since the circle of fifths closes', () => {
    const start = auroraHues(0, 0)
    const end = auroraHues(1, 0)
    expect(end.base).toBeCloseTo(start.base, 9)
    expect(end.tip).toBeCloseTo(start.tip, 9)
    const next = auroraHues(0.01, 0)
    expect(Math.abs(next.base - start.base)).toBeLessThan(0.02)
  })

  it('moves the colour when the chord moves, and both hues turn', () => {
    const still = auroraHues(0.3, 0)
    const moved = auroraHues(0.3, 0.12)
    expect(moved.base).not.toBeCloseTo(still.base, 3)
    expect(moved.tip).not.toBeCloseTo(still.tip, 3)
  })

  it('is fully saturated at the arc, never a pastel', () => {
    const [red, green, blue] = auroraColour(0.4)
    expect(Math.max(red, green, blue)).toBe(1)
    expect(Math.min(red, green, blue)).toBeLessThan(0.1)
  })
})

describe('a curtain across time', () => {
  it('has the same path at 30, 60, 144 and 240 steps a second', () => {
    const clocks = [30, 60, 144, 240].map((rate) => run(7, rate))
    const at = (clock: AuroraClock) => curtainPhases(0, clock)
    for (let index = 0; index < CURTAIN_COUNT; index += 1)
      for (const u of [-0.9, -0.31, 0, 0.44, 1.2]) {
        const reference = curtainEdge(index, u, curtainPhases(index, clocks[0] as AuroraClock))
        for (const clock of clocks) {
          expect(curtainEdge(index, u, curtainPhases(index, clock))).toBeCloseTo(reference, 9)
        }
      }

    for (const clock of clocks) {
      expect(at(clock).path[1]).toBeCloseTo(at(clocks[0] as AuroraClock).path[1], 9)
      expect(at(clock).sway).toBeCloseTo(at(clocks[0] as AuroraClock).sway, 9)
    }
  })

  it('draws the same light at those rates, ray flicker and all', () => {
    const clocks = [30, 60, 144, 240].map((rate) => run(5, rate))
    const light = (clock: AuroraClock) => auroraLight(0.12, 0.62, 1 / 1080, WORST, clock)
    const reference = light(clocks[0] as AuroraClock)
    for (const clock of clocks) expect(light(clock)).toBeCloseTo(reference, 7)
  })

  it('moves per second: twice the time is twice the drift, and a step that is not finite moves nothing', () => {
    expect(run(4, 60, 0.03).drift).toBeCloseTo(2 * run(2, 60, 0.03).drift, 9)
    const clock = newClock()
    advanceAurora(clock, 0.03, Number.NaN)
    advanceAurora(clock, 0.03, -1)
    advanceAurora(clock, 0.03, 0)
    expect(clock.drift).toBe(0)
    expect(clock.rays).toBe(0)
  })

  it('wraps the ray clock where the lattice repeats, without a jump', () => {
    const before = newClock()
    before.rays = 1023.999
    const after = newClock()
    after.rays = 0.0005
    // The lattice is periodic in time, so the value either side of the wrap agrees.
    expect(rayNoise(3.3, before.rays)).toBeCloseTo(rayNoise(3.3, after.rays), 2)
    expect(latticeHash(5, 1024)).toBe(latticeHash(5, 0))
  })

  it('keeps every phase in a turn however long the song runs', () => {
    const clock = newClock()
    clock.drift = 1.5e6
    for (let index = 0; index < CURTAIN_COUNT; index += 1) {
      const phases = curtainPhases(index, clock)
      for (const phase of [...phases.path, ...phases.presence, phases.sway]) {
        expect(phase).toBeGreaterThanOrEqual(0)
        expect(phase).toBeLessThan(1)
      }
    }
  })
})

describe('the sway is per second and slow', () => {
  it('turns at a rate in cycles a second, so a step of any length lands in the same place', () => {
    const slow = run(3, 30, 0.04)
    const fast = run(3, 144, 0.04)
    expect(curtainPhases(1, slow).sway).toBeCloseTo(curtainPhases(1, fast).sway, 9)
    expect(curtainPhases(1, slow).sway).toBeCloseTo(
      (SWAY_RATE * 0.04 * 3 * (CURTAINS[1]?.slow ?? 1) + (CURTAINS[1]?.shift ?? 0) * 0.13) % 1,
      9,
    )
  })

  it('holds the top of a ray under the speed the canvas can carry, at the most the mapping reaches', () => {
    expect(maxRaySpeed(WORST)).toBeLessThan(MAX_RAY_SPEED)
    expect(maxRaySpeed(WORST)).toBeGreaterThan(0)
    const full = auroraParams({ ...AURORA_DEFAULTS, sway: 1, drift: 1 })
    // The top of the range is what the ranges themselves may reach, so this is
    // the bound the ranges are held to, whatever a mapping asks for.
    expect(maxRaySpeed(full)).toBeLessThan(MAX_RAY_SPEED)
  })

  it('holds the lower edge under the speed at which it would leave a glow beneath it', () => {
    expect(maxEdgeSpeed(WORST)).toBeLessThan(MAX_EDGE_SPEED)
    expect(maxEdgeSpeed(auroraParams({ ...AURORA_DEFAULTS, drift: 1 }))).toBeLessThan(
      MAX_EDGE_SPEED * 1.5,
    )
    expect(maxEdgeSpeed(REST)).toBeLessThan(maxEdgeSpeed(WORST))
  })

  it('moves the real edge no faster than the bound says', () => {
    // Read the bound off the curve itself: the edge a second apart.
    const drift = 0.043
    const a = run(10, 60, drift)
    const b = run(11, 60, drift)
    let fastest = 0
    for (let index = 0; index < CURTAIN_COUNT; index += 1)
      for (let u = -1; u <= 1; u += 0.05)
        fastest = Math.max(
          fastest,
          Math.abs(
            curtainEdge(index, u, curtainPhases(index, b)) -
              curtainEdge(index, u, curtainPhases(index, a)),
          ),
        )
    expect(fastest).toBeLessThan(MAX_EDGE_SPEED * 1.2)
  })

  it('leans the top of a ray and leaves the foot where it is', () => {
    const still = auroraParams({ ...AURORA_DEFAULTS, sway: 0 })
    const swayed = auroraParams({ ...AURORA_DEFAULTS, sway: 0.06 })
    const clock = newClock()
    clock.drift = 2.3
    const phases = curtainPhases(0, clock)
    const edge = curtainEdge(0, 0.2, phases)
    // A hair above the foot the two agree; well up the curtain they do not.
    const low = (params: typeof still) =>
      curtainLight(0, 0.2, edge + 0.0004, 1 / 1080, params, clock)
    expect(low(swayed)).toBeCloseTo(low(still), 1)
    let differs = false
    for (let u = 0; u < 0.6; u += 0.013) {
      const upper = (params: typeof still) =>
        curtainLight(0, u, curtainEdge(0, u, phases) + 0.22, 1 / 1080, params, clock)
      if (Math.abs(upper(swayed) - upper(still)) > 1e-4) differs = true
    }
    expect(differs).toBe(true)
  })
})

describe('the light', () => {
  const clock = run(37, 60)

  it('is exactly nothing below the edge of every curtain', () => {
    for (let index = 0; index < CURTAIN_COUNT; index += 1) {
      const phases = curtainPhases(index, clock)
      for (let u = -1.2; u <= 1.2; u += 0.037)
        for (const drop of [0, 0.0001, 0.01, 0.2])
          expect(
            curtainLight(index, u, curtainEdge(index, u, phases) - drop, 1 / 1080, WORST, clock),
          ).toBe(0)
    }
  })

  it('is exactly nothing at the top of a curtain and above it', () => {
    for (let index = 0; index < CURTAIN_COUNT; index += 1) {
      const phases = curtainPhases(index, clock)
      const curtain = CURTAINS[index]
      if (!curtain) continue
      for (let u = -1.2; u <= 1.2; u += 0.037) {
        const top = curtainEdge(index, u, phases) + curtain.tall * WORST.height
        for (const lift of [0, 1e-6, 0.01, 0.3])
          expect(curtainLight(index, u, top + lift, 1 / 1080, WORST, clock), `u ${u}`).toBe(0)
      }
    }
  })

  it('is nothing at the top under a ripple that stretches the curtain, at the stretched top', () => {
    const index = 0
    const phases = curtainPhases(index, clock)
    const ripple: Ripple = { curtain: index, at: 0.1, width: 0.1, strength: 1 }
    const curtain = CURTAINS[index]
    if (!curtain) throw new Error('Expected a curtain')
    for (let u = -0.4; u <= 0.6; u += 0.021) {
      // Wherever the ripple lifts the light it stretches the top by the same
      // share, so the light is still exactly zero there.
      const away = (u - ripple.at) / ripple.width
      const bump = ripple.strength * Math.exp(-away * away)
      const top = curtainEdge(index, u, phases) + curtain.tall * WORST.height * (1 + 0.3 * bump)
      expect(curtainLight(index, u, top, 1 / 1080, WORST, clock, [ripple])).toBe(0)
    }
  })

  it('falls upward from the foot on average, and is brightest at the foot', () => {
    let foot = 0
    let middle = 0
    let upper = 0
    for (let u = -1; u <= 1; u += 0.004) {
      const phases = curtainPhases(0, clock)
      const edge = curtainEdge(0, u, phases)
      const tall = (CURTAINS[0]?.tall ?? 0) * WORST.height
      foot += curtainLight(0, u, edge + 0.004, 1 / 1080, WORST, clock)
      middle += curtainLight(0, u, edge + tall * 0.4, 1 / 1080, WORST, clock)
      upper += curtainLight(0, u, edge + tall * 0.85, 1 / 1080, WORST, clock)
    }

    expect(foot).toBeGreaterThan(middle)
    expect(middle).toBeGreaterThan(upper)
  })

  it('is sparse between rays: the light at one height is zero-ish for a good share of the width', () => {
    const phases = curtainPhases(0, clock)
    let dark = 0
    let total = 0
    for (let u = -1; u <= 1; u += 0.002) {
      const edge = curtainEdge(0, u, phases)
      const value = curtainLight(0, u, edge + 0.05, 1 / 1080, WORST, clock)
      total += 1
      if (value < 0.03) dark += 1
    }

    expect(dark / total).toBeGreaterThan(0.3)
  })

  it('has thin rays: a lit column is a few pixels wide, not a wash', () => {
    const phases = curtainPhases(0, clock)
    // Count how many of the pixel columns across one range of the frame are bright at one height.
    let bright = 0
    let columns = 0
    for (let u = 0.1; u < 0.5; u += 1 / 1920) {
      const edge = curtainEdge(0, u, phases)
      const value = curtainLight(0, u, edge + 0.03, 1 / 1080, WORST, clock)
      columns += 1
      if (value > 0.4) bright += 1
    }

    expect(bright / columns).toBeLessThan(0.5)
  })

  it('fades the last curtain in with a fractional count, and none past it', () => {
    const point = (params: typeof WORST) => {
      let sum = 0
      for (let u = -1; u < 1; u += 0.01) {
        const edge = curtainEdge(3, u, curtainPhases(3, clock))
        sum += curtainLight(3, u, edge + 0.02, 1 / 1080, params, clock)
      }

      return sum
    }

    const off = point({ ...WORST, curtains: 3 })
    const half = point({ ...WORST, curtains: 3.5 })
    const full = point({ ...WORST, curtains: 4 })
    expect(off).toBe(0)
    expect(half).toBeGreaterThan(0)
    expect(half).toBeCloseTo(full / 2, 6)
  })

  it('makes the far curtains dimmer, slower, thinner and smaller than the near ones', () => {
    for (let index = 1; index < CURTAINS.length; index += 1) {
      const near = CURTAINS[index - 1]
      const far = CURTAINS[index]
      if (!near || !far) continue
      expect(far.light).toBeLessThan(near.light)
      expect(far.slow).toBeLessThan(near.slow)
      expect(far.rays).toBeGreaterThan(near.rays)
      expect(far.tall).toBeLessThan(near.tall)
    }
  })

  it('is black in silence: no light means nothing is lit anywhere', () => {
    const dark = auroraParams({ ...AURORA_DEFAULTS, intensity: 0 })
    expect(auroraLit(dark)).toBe(false)
    expect(sampleAurora(dark, 640, 360, 30, 2).lit).toBe(0)
  })

  it('has presence that is exactly zero off the ends of a curtain', () => {
    const phases = curtainPhases(0, clock)
    let zero = 0
    let one = 0
    for (let u = -3; u < 3; u += 0.01) {
      const value = curtainPresence(0, u, phases)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      if (value === 0) zero += 1
      if (value === 1) one += 1
    }

    expect(zero).toBeGreaterThan(0)
    expect(one).toBeGreaterThan(0)
  })
})

describe('how much of the frame it lights', () => {
  // Settled light: the intensity times what a still curtain sums to times the
  // light, over 0.3 and over 0.8. Measured on the adapter in the bench at these
  // numbers the same share reads under 8 percent; the catalogue's bar is well
  // under a third.
  for (const [width, height] of SHAPES) {
    it(`stays well under a third of a ${width} by ${height} canvas at the worst the mapping reaches`, () => {
      const worst = sampleAurora(WORST, width, height)
      expect(worst.lit, `${width}x${height}`).toBeLessThan(0.12)
      expect(worst.bright, `${width}x${height}`).toBeLessThan(0.05)
      const rest = sampleAurora(REST, width, height)
      expect(rest.lit, `${width}x${height} at rest`).toBeLessThan(0.12)
      expect(rest.mean).toBeLessThan(0.13)
    })
  }

  it('lights something at rest, so it is a picture and not an empty ink', () => {
    expect(sampleAurora(REST, 1920, 1080).lit).toBeGreaterThan(0.01)
  })

  it('keeps most of the frame true black at the worst it reaches', () => {
    // Under 0.02 of settled light, which is what the sky between and above the curtains is.
    const shares = SHAPES.map(([width, height]) => {
      const rows = 60
      const columns = Math.round((rows * width) / height)
      const clock = newClock()
      clock.drift = 3.1
      let black = 0
      for (let row = 0; row < rows; row += 1)
        for (let column = 0; column < columns; column += 1) {
          const u = (column + 0.5 - columns / 2) / rows
          const v = 1 - (row + 0.5) / rows
          if (WORST.intensity * auroraLight(u, v, 1 / 1080, WORST, clock) < 0.02) black += 1
        }

      return black / (rows * columns)
    })

    for (const share of shares) expect(share).toBeGreaterThan(0.6)
  })
})

describe('the ripples', () => {
  const HIT = () => packetOf({ lowMidHit: 0.8, section: 2 })
  const play = (rate: number, seconds: number, params = WORST) => {
    const ripples = new AuroraRipples()
    let time = 0
    for (let step = 0; step < Math.round(seconds * rate); step += 1) {
      // A hit every 0.7 seconds, whatever the rate the frames come at.
      const due = Math.floor((time + 1 / rate) / 0.7) !== Math.floor(time / 0.7)
      ripples.step(due ? HIT() : packetOf({ section: 2 }), 1 / rate, params)
      time += 1 / rate
    }

    return ripples
  }

  it('sends nothing on silence, or on a hit too weak to count', () => {
    const ripples = new AuroraRipples()
    for (let step = 0; step < 600; step += 1) ripples.step(packetOf(), 1 / 60, WORST)
    for (let step = 0; step < 600; step += 1)
      ripples.step(packetOf({ lowMidHit: 0.1, bassHit: 0.2 }), 1 / 60, WORST)
    expect(ripples.sent).toBe(0)
    expect(ripples.alive).toBe(0)
  })

  it('sends nothing while the ripple knob has nothing to give, or no curtain is lit', () => {
    const still = new AuroraRipples()
    for (let step = 0; step < 300; step += 1) still.step(HIT(), 1 / 60, { ...WORST, ripple: 0 })
    expect(still.sent).toBe(0)
    const dark = new AuroraRipples()
    for (let step = 0; step < 300; step += 1) dark.step(HIT(), 1 / 60, { ...WORST, curtains: 0 })
    expect(dark.sent).toBe(0)
  })

  it('answers a hit in the bass or the mids, and not a hit in the treble', () => {
    for (const row of ['bassHit', 'lowMidHit', 'highMidHit'] as const) {
      const ripples = new AuroraRipples()
      ripples.step(packetOf({ [row]: 0.9 }), 1 / 60, WORST)
      expect(ripples.sent, row).toBe(1)
    }

    const treble = new AuroraRipples()
    treble.step(packetOf({ trebleHit: 1 }), 1 / 60, WORST)
    expect(treble.sent).toBe(0)
  })

  it('keeps two ripples apart, so a hit every frame sends about two a second and no more', () => {
    const ripples = new AuroraRipples()
    for (let step = 0; step < 60 * 10; step += 1) ripples.step(HIT(), 1 / 60, WORST)
    expect(ripples.sent).toBeLessThanOrEqual(Math.ceil(10 / RIPPLE_GAP_SECONDS) + 1)
    expect(ripples.sent).toBeGreaterThanOrEqual(Math.floor(10 / RIPPLE_GAP_SECONDS) - 1)
  })

  it('travels along a curtain by the second: the same place at any frame rate', () => {
    const read = (rate: number) => play(rate, 2.35).read([])
    const reference = read(30)
    for (const rate of [60, 144, 240]) {
      const found = read(rate)
      expect(found.length).toBe(RIPPLE_SLOTS)
      for (let slot = 0; slot < RIPPLE_SLOTS; slot += 1) {
        const a = reference[slot]
        const b = found[slot]
        expect(b?.curtain).toBe(a?.curtain)
        // A frame at 30 a second can land a hit up to a frame later, which is
        // a frame of travel at most.
        expect(Math.abs((b?.at ?? 0) - (a?.at ?? 0))).toBeLessThan(RIPPLE_SPEED / 30 + 1e-6)
        expect(Math.abs((b?.strength ?? 0) - (a?.strength ?? 0))).toBeLessThan(0.1)
      }
    }
  })

  it('moves at its travel speed and is over in its life', () => {
    const ripples = new AuroraRipples()
    ripples.step(HIT(), 0.05, WORST)
    // Born at the end of that step, so it is read a step later to have an age.
    ripples.step(packetOf(), 0.05, WORST)
    const slots = ripples.read([])
    const slot = slots.findIndex((ripple) => ripple.curtain >= 0)
    expect(slot).toBeGreaterThanOrEqual(0)
    for (let step = 0; step < 60; step += 1) ripples.step(packetOf(), 1 / 60, WORST)
    const later = ripples.read([])[slot]
    expect(Math.abs((later?.at ?? 0) - (slots[slot]?.at ?? 0))).toBeCloseTo(RIPPLE_SPEED, 2)
    for (let step = 0; step < 60 * (RIPPLE_LIFE + 0.5); step += 1)
      ripples.step(packetOf(), 1 / 60, WORST)
    expect(ripples.alive).toBe(0)
    expect(ripples.read([]).every((ripple) => ripple.strength === 0)).toBe(true)
  })

  it('rises and falls, and is exactly nothing before its birth and after its life', () => {
    expect(rippleFade(-1)).toBe(0)
    expect(rippleFade(0)).toBe(0)
    expect(rippleFade(0.2)).toBeGreaterThan(0.6)
    expect(rippleFade(1)).toBeLessThan(rippleFade(0.2))
    expect(rippleFade(RIPPLE_LIFE)).toBe(0)
    expect(rippleFade(RIPPLE_LIFE + 5)).toBe(0)
  })

  it('sends the same ripples for the same song: seeded by the section and the count', () => {
    const a = play(60, 4).read([])
    const b = play(60, 4).read([])
    expect(a).toEqual(b)
    const other = new AuroraRipples()
    for (let step = 0; step < 240; step += 1) {
      const packet = packetOf({ section: 9 })
      if (step % 42 === 0) packet[F.lowMidHit] = 0.8
      other.step(packet, 1 / 60, WORST)
    }

    expect(other.read([])).not.toEqual(a)
  })

  it('only sends a ripple along a curtain that is lit', () => {
    const ripples = new AuroraRipples()
    const one = { ...WORST, curtains: 1 }
    for (let step = 0; step < 60 * 20; step += 1) {
      const packet = packetOf({ lowMidHit: step % 45 === 0 ? 0.9 : 0, section: 1 })
      ripples.step(packet, 1 / 60, one)
    }

    for (const ripple of ripples.read([])) if (ripple.strength > 0) expect(ripple.curtain).toBe(0)
  })

  it('lifts the light where it is and leaves it alone far away, a swell and not a flash of the frame', () => {
    const clock = run(20, 60)
    const ripple: Ripple = { curtain: 0, at: 0, width: 0.1, strength: 1 }
    const edge = curtainEdge(0, 0, curtainPhases(0, clock))
    let lifted = 0
    let plain = 0
    for (let u = -0.02; u <= 0.02; u += 0.001) {
      const height = curtainEdge(0, u, curtainPhases(0, clock)) + 0.03
      lifted += curtainLight(0, u, height, 1 / 1080, WORST, clock, [ripple])
      plain += curtainLight(0, u, height, 1 / 1080, WORST, clock)
    }

    expect(lifted).toBeGreaterThan(plain)
    expect(edge).toBeGreaterThan(0)
    // Far along the curtain, and on another curtain, nothing changes.
    for (let u = 0.9; u <= 1.1; u += 0.02) {
      const height = curtainEdge(0, u, curtainPhases(0, clock)) + 0.03
      expect(curtainLight(0, u, height, 1 / 1080, WORST, clock, [ripple])).toBeCloseTo(
        curtainLight(0, u, height, 1 / 1080, WORST, clock),
        6,
      )
    }

    const other = curtainEdge(1, 0, curtainPhases(1, clock)) + 0.03
    expect(curtainLight(1, 0, other, 1 / 1080, WORST, clock, [ripple])).toBe(
      curtainLight(1, 0, other, 1 / 1080, WORST, clock),
    )
  })

  it('is a local swell: a ripple lights well under a tenth of the frame at its strongest', () => {
    const ripples: Ripple[] = Array.from({ length: RIPPLE_SLOTS }, (_, slot) => ({
      curtain: slot % CURTAIN_COUNT,
      at: -0.8 + slot * 0.23,
      width: 0.15,
      strength: 1,
    }))
    const without = sampleAurora(WORST, 1920, 1080, 60, 3)
    const withAll = sampleAurora(WORST, 1920, 1080, 60, 3, ripples)
    // The area a ripple adds to what is lit is the flash's area, and it is small.
    expect(withAll.lit - without.lit).toBeLessThan(0.1)
  })
})

describe('the uniform', () => {
  it('is what the shader reads: the fresh light, the count, the hues from the key and the chord', () => {
    const out = new Float32Array(AURORA_UNIFORM_FLOATS)
    const features = packetOf({ keyHue: 0.3 })
    const clock = run(3, 60, 0.03)
    const written = writeAuroraUniform(REST, clock, features, [], 2560, 1440, out)
    expect(written).toBe(out)
    expect(out[0]).toBe(2560)
    expect(out[1]).toBe(1440)
    expect(out[2]).toBeCloseTo(REST.intensity * 0.1, 6)
    expect(out[3]).toBeCloseTo(REST.curtains, 6)
    const hues = auroraHues(0.3, REST.hue)
    expect(out[8]).toBeCloseTo(hues.base, 6)
    expect(out[9]).toBeCloseTo(hues.tip, 6)
    for (let index = 0; index < CURTAIN_COUNT; index += 1) {
      expect(out[12 + index * 4]).toBeCloseTo(CURTAINS[index]?.foot ?? -1, 6)
      expect(out[44 + index * 4 + 3]).toBeCloseTo(curtainPhases(index, clock).sway, 6)
    }
  })

  it('marks a free ripple slot with -1 and a live one with its curtain', () => {
    const out = new Float32Array(AURORA_UNIFORM_FLOATS)
    const ripples: Ripple[] = [
      { curtain: 2, at: 0.4, width: 0.1, strength: 0.7 },
      { curtain: -1, at: 0, width: 0.1, strength: 0 },
    ]
    writeAuroraUniform(REST, newClock(), packetOf(), ripples, 1920, 1080, out)
    expect(out[76]).toBe(2)
    expect(out[76 + 1]).toBeCloseTo(0.4, 6)
    expect(out[76 + 3]).toBeCloseTo(0.7, 6)
    expect(out[76 + 4]).toBe(-1)
    expect(out[76 + 8]).toBe(-1)
  })

  it('writes whole vec4s and clears what it does not set', () => {
    expect(AURORA_UNIFORM_FLOATS % 4).toBe(0)
    const out = new Float32Array(AURORA_UNIFORM_FLOATS).fill(9)
    writeAuroraUniform(REST, newClock(), packetOf(), [], 1920, 1080, out)
    expect(out[11]).toBe(0)
    expect(out[out.length - 1]).toBe(-1 + 1)
  })
})

describe('the shader is the transcription the header says it is', () => {
  const constant = (name: string) => {
    const found = new RegExp(`const ${name} = ([0-9.]+);`).exec(shader)
    if (!found) throw new Error(`No ${name} in the shader`)
    return Number(found[1])
  }

  it('carries the same shape numbers', () => {
    expect(constant('FOOT_HEIGHT')).toBe(FOOT_HEIGHT)
    expect(constant('FOOT_GAIN')).toBe(FOOT_GAIN)
    expect(constant('BODY_POWER')).toBe(BODY_POWER)
    expect(constant('REACH_LOW')).toBe(REACH_LOW)
    expect(constant('REACH_HIGH')).toBe(REACH_HIGH)
    expect(constant('RAY_SOFTEN')).toBe(RAY_SOFTEN)
    expect(constant('SWAY_FREQ')).toBe(SWAY_FREQ)
    expect(constant('SWAY_RATE')).toBe(SWAY_RATE)
  })

  it('holds the hue to the same arc', () => {
    expect(constant('ARC_LOW')).toBe(AURORA_ARC.low)
    expect(constant('ARC_HIGH')).toBe(AURORA_ARC.high)
  })

  it('reads the ripple slots and the curtain count the uniform is sized for', () => {
    expect(shader).toContain(`ripples: array<vec4<f32>, ${RIPPLE_SLOTS}>`)
    expect(shader).toContain(`foot: array<vec4<f32>, ${CURTAIN_COUNT}>`)
  })
})
