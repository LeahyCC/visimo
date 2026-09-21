/**
 * The plate's numbers against the plate they describe: that the line is drawn
 * where the sum of the modes changes sign and nowhere else, that it is a pixel
 * or two wide on every canvas, that the share of the frame it lights is small
 * on every shape of canvas at every sharpness, that the same song makes the
 * same figure at any step rate, and that the uniform is laid out as the shader
 * reads it. The GPU side has its own test beside it.
 */
import { describe, expect, it } from 'vitest'

import { CHROMA_ROW, F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import shader from '../shaders/cymatics.wgsl?raw'
import { findStudy } from '../studies/registry'
import { resolveStudy } from '../studies/resolve'
import type { RowState } from '../studies/resolve'
import {
  BASE_PAIRS,
  CORE_WHITE,
  CYMATICS_RANGES,
  CYMATICS_UNIFORM_FLOATS,
  cymaticsAt,
  cymaticsCoverage,
  cymaticsLit,
  cymaticsParams,
  glowWidth,
  lineProfile,
  lineWidth,
  LIT_THRESHOLD,
  MODE_MIN,
  modesFor,
  nodalDistance,
  NOTES,
  PARTNER_GAIN,
  PARTNER_PAIRS,
  plateAt,
  plateSide,
  SETTLED_FLOOR,
  settledLight,
  SIGNS,
  TOP_MODE,
  unsettled,
  vigour,
  vividColour,
  writeCymaticsUniform,
} from './cymatics.params'
import type { CymaticsParams } from './cymatics.params'

/** C, E and G, a triad, and a scale, as pitch classes. */
const TRIAD = [0, 4, 7]
const SCALE = [0, 2, 4, 5, 7, 9, 11]
const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

/** A plate with these notes ringing at full strength, at the study's resting shape unless told. */
const plate = (notes: readonly number[], over: Partial<CymaticsParams> = {}): CymaticsParams => {
  const knobs: Record<string, number> = {
    intensity: 1.2,
    layer: 0.1,
    sharp: 0.25,
    width: 1,
    glow: 2.5,
    strike: 0.35,
    ...over,
  }
  for (const note of notes) knobs[`mode${note}`] = over[`mode${note}` as keyof CymaticsParams] ?? 1
  return cymaticsParams(knobs)
}

/**
 * The top of every row that adds to the line: the widest the study's rows can
 * make it at once, which is what the coverage is held to. A quiet passage is
 * far under this.
 */
const LOUD = { layer: 0.85, width: 1.6, glow: 9.5, strike: 1 }

/** Eight canvases, from ultra wide to tall, in pixels. */
const SHAPES: readonly (readonly [number, number])[] = [
  [1920, 1080],
  [1080, 1920],
  [1000, 1000],
  [1440, 1080],
  [1080, 1440],
  [2560, 1080],
  [3440, 1440],
  [1280, 1024],
]

describe('the knobs', () => {
  it('are clamped to their ranges, and a knob that is missing or not a number takes its own fallback', () => {
    const params = cymaticsParams({
      mode0: 9,
      mode1: -3,
      layer: Number.NaN,
      sharp: 5,
      width: 0,
      glow: 1e9,
      strike: 4,
      intensity: 99,
    })
    expect(params.mode0).toBe(1)
    expect(params.mode1).toBe(0)
    expect(params.layer).toBe(0)
    expect(params.sharp).toBe(1)
    expect(params.width).toBe(CYMATICS_RANGES.width[0])
    expect(params.glow).toBe(CYMATICS_RANGES.glow[1])
    expect(params.strike).toBe(1)
    expect(params.intensity).toBe(CYMATICS_RANGES.intensity[1])
    expect(cymaticsParams({}).intensity).toBe(0)
  })

  it('leave the light past 1 reachable, so the bloom has something to find', () => {
    expect(CYMATICS_RANGES.intensity[1]).toBeGreaterThan(1)
  })
})

describe('what draws', () => {
  it('is nothing without a note ringing, and nothing without light', () => {
    expect(cymaticsLit(plate(TRIAD))).toBe(true)
    expect(cymaticsLit(plate([]))).toBe(false)
    expect(cymaticsLit(plate(TRIAD, { intensity: 0 }))).toBe(false)
    expect(cymaticsLit(cymaticsParams({ intensity: 1.2, mode3: MODE_MIN / 2 }))).toBe(false)
    for (const [x, y] of [
      [960, 540],
      [700, 300],
      [1200, 800],
    ])
      expect(cymaticsAt(x ?? 0, y ?? 0, plate([]), 1920, 1080)).toBe(0)
  })

  it('lets a chord that has all but died away go out as a dimming, and not as a cut', () => {
    expect(vigour(plate(TRIAD))).toBe(1)
    expect(vigour(plate([], { mode4: 0.2 }))).toBeGreaterThan(0.1)
    expect(vigour(plate([], { mode4: 0.2 }))).toBeLessThan(1)
    expect(vigour(cymaticsParams({ mode4: 0.02 }))).toBeLessThan(0.05)
    expect(vigour(plate([]))).toBe(0)
  })

  it('draws a plate that is catching up dimmer than one that has settled, and never out', () => {
    expect(settledLight(0)).toBe(1)
    expect(settledLight(0.5)).toBeGreaterThan(0.95)
    expect(settledLight(3)).toBeLessThan(0.7)
    expect(settledLight(100)).toBeGreaterThanOrEqual(SETTLED_FLOOR)
    let last = 2
    for (const gap of [0, 0.5, 1, 2, 4, 8, 16]) {
      expect(settledLight(gap)).toBeLessThan(last)
      last = settledLight(gap)
    }
  })

  it('reads how far the modes are from the notes sounding, and reads nothing while a chord is held', () => {
    const packet = new Float32Array(PACKET_LENGTH)
    for (const note of TRIAD) packet[CHROMA_ROW + note] = 1
    expect(unsettled(plate(TRIAD), packet)).toBe(0)
    // A chord that has been swapped: the old three still ringing and the new
    // three not yet, which is three notes short and three notes over.
    const old = plate([2, 5, 9])
    expect(unsettled(old, packet)).toBeCloseTo(6, 5)
    // And nothing to catch up with while the room is silent and the plate is at rest.
    expect(unsettled(plate([]), new Float32Array(PACKET_LENGTH))).toBe(0)
  })
})

describe('the modes', () => {
  it('are twenty four distinct pairs, plainest first, each under the shader’s table', () => {
    const pairs = [...BASE_PAIRS, ...PARTNER_PAIRS]
    expect(BASE_PAIRS).toHaveLength(NOTES)
    expect(PARTNER_PAIRS).toHaveLength(NOTES)
    expect(new Set(pairs.map(([n, m]) => `${n},${m}`)).size).toBe(pairs.length)
    for (const [n, m] of pairs) {
      // n = m is its own transpose and rings as nothing at all.
      expect(n).toBeLessThan(m)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(m).toBeLessThanOrEqual(TOP_MODE)
    }

    const busy = (list: typeof pairs) => list.map(([n, m]) => n * n + m * m)
    // A higher pitch class rings a busier mode, the way a plate's resonances climb.
    expect(busy([...BASE_PAIRS])).toEqual([...busy([...BASE_PAIRS])].sort((a, b) => a - b))
    expect(busy([...PARTNER_PAIRS])).toEqual([...busy([...PARTNER_PAIRS])].sort((a, b) => a - b))
    expect(Math.min(...busy([...PARTNER_PAIRS]))).toBeGreaterThan(
      Math.max(...busy([...BASE_PAIRS])),
    )
    expect(SIGNS).toHaveLength(NOTES)
    expect(SIGNS.every((sign) => sign === 1 || sign === -1)).toBe(true)
    // Both kinds are there, or every figure would carry the same diagonal.
    expect(SIGNS).toContain(1)
    expect(SIGNS).toContain(-1)
  })

  it('give a note its own mode at its own strength, and its partner a share of that', () => {
    const modes = modesFor(plate([4], { layer: 0.5, mode4: 0.8 }))
    expect(modes).toHaveLength(2 * NOTES)
    const [n, m] = BASE_PAIRS[4] ?? [0, 0]
    expect(modes[4]).toMatchObject({ n, m, amplitude: 0.8 })
    const [pn, pm] = PARTNER_PAIRS[4] ?? [0, 0]
    expect(modes[NOTES + 4]).toMatchObject({ n: pn, m: pm })
    expect(modes[NOTES + 4]?.amplitude).toBeCloseTo(0.8 * 0.5 * PARTNER_GAIN, 6)
    for (const at of [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11]) {
      expect(modes[at]?.amplitude).toBe(0)
      expect(modes[NOTES + at]?.amplitude).toBe(0)
    }

    expect(modesFor(plate([4], { layer: 0 }))[NOTES + 4]?.amplitude).toBe(0)
  })

  it('give a bigger plate to a louder chord in lines and not in places: the level is not in the figure', () => {
    const loud = modesFor(plate(TRIAD, { mode0: 1, mode4: 1, mode7: 1 }))
    const soft = modesFor(plate(TRIAD, { mode0: 0.3, mode4: 0.3, mode7: 0.3 }))
    for (const [x, y] of [
      [0.13, 0.31],
      [0.5, 0.2],
      [0.77, 0.66],
    ]) {
      const a = plateAt(loud, x ?? 0, y ?? 0)
      const b = plateAt(soft, x ?? 0, y ?? 0)
      // The sum is a third of itself and its zero is where it was.
      expect(b.f).toBeCloseTo(a.f * 0.3, 9)
      expect(Math.sign(b.f)).toBe(Math.sign(a.f))
    }
  })
})

describe('the line is where the sum changes sign', () => {
  const width = 1920
  const height = 1080
  const params = plate(TRIAD, { layer: 0 })
  const modes = modesFor(params)
  const side = plateSide(width, height)
  const at = (u: number, v: number) => plateAt(modes, u, v).f

  it('lies exactly on every sign change of the sum along lines across the plate', () => {
    // Scans across the plate at a step of a hundredth of a pixel, so a
    // crossing is found to far better than a pixel.
    const step = 0.01
    const from = (width - side) / 2 + 2
    const to = (width + side) / 2 - 2
    let crossings = 0
    for (const across of [0.11, 0.31, 0.57, 0.83]) {
      const y = height / 2 + (across - 0.5) * side
      const v = (y - height / 2) / side + 0.5
      let previous = at((from - width / 2) / side + 0.5, v)
      for (let x = from + step; x < to; x += step) {
        const now = at((x - width / 2) / side + 0.5, v)
        if (Math.sign(now) !== Math.sign(previous)) {
          crossings += 1
          // On a change of sign the distance is 0 to the accuracy of the scan
          // and the line is at full strength.
          const distance = nodalDistance(modes, x, y, width, height)
          expect(distance, `at x ${x}, row ${across}`).toBeLessThan(0.1)
          expect(lineProfile(distance, 1, 4).core).toBeGreaterThan(0.95)
        }

        previous = now
      }
    }

    // A chord's plate has lines across it and not a single crossing.
    expect(crossings).toBeGreaterThanOrEqual(6)
  })

  it('has no light a few pixels from a sign change, and only glow', () => {
    const y = height / 2 + (0.31 - 0.5) * side
    const half = lineWidth(params)
    const glow = glowWidth(params, width, height)
    for (let x = (width - side) / 2 + 30; x < (width + side) / 2 - 30; x += 0.37) {
      const distance = nodalDistance(modes, x, y, width, height)
      const { core, halo } = lineProfile(distance, half, glow)
      // The core is on only within its half width and a pixel of feather.
      if (distance > half + 0.5) expect(core).toBe(0)
      else expect(core).toBeGreaterThan(0)
      expect(halo).toBeGreaterThan(0)
    }
  })

  it('has the diagonal as a nodal line for a mode that is its own transpose and nothing for one that is not', () => {
    const anti = modesFor(cymaticsParams({ intensity: 1, mode0: 1 }))
    expect(SIGNS[0]).toBe(-1)
    for (const t of [0.05, 0.2, 0.41, 0.77, 0.93]) expect(plateAt(anti, t, t).f).toBeCloseTo(0, 12)
    const sym = modesFor(cymaticsParams({ intensity: 1, mode1: 1 }))
    expect(SIGNS[1]).toBe(1)
    expect(Math.abs(plateAt(sym, 0.2, 0.2).f)).toBeGreaterThan(0.1)
    // The centre cross is nodal for it, because both terms carry a cosine of an odd multiple of half a pi.
    for (const t of [0.1, 0.33, 0.9]) {
      expect(plateAt(sym, 0.5, t).f).toBeCloseTo(0, 12)
      expect(plateAt(sym, t, 0.5).f).toBeCloseTo(0, 12)
    }
  })

  it('measures the distance to a line in pixels', () => {
    const sym = modesFor(cymaticsParams({ intensity: 1, mode1: 1 }))
    // Mode 1 is (1, 3) with a plus, and its middle is a straight nodal line at
    // x = a half. A pixel three to the side of it is three away.
    for (const canvas of [
      [1920, 1080],
      [1280, 720],
      [3840, 2160],
    ] as const) {
      const [w, h] = canvas
      const s = plateSide(w, h)
      const y = h / 2 - 0.3 * s
      for (const offset of [1, 2, 3, 5]) {
        expect(nodalDistance(sym, w / 2 + offset, y, w, h), `${w} at ${offset}`).toBeCloseTo(
          offset,
          1,
        )
        expect(nodalDistance(sym, w / 2 - offset, y, w, h)).toBeCloseTo(offset, 1)
      }
    }
  })

  it('takes its gradient from the modes: what the analytic one says is what a finite difference says', () => {
    const rich = modesFor(plate(SCALE, { layer: 1 }))
    for (const [x, y] of [
      [0.21, 0.37],
      [0.5, 0.9],
      [0.83, 0.11],
    ]) {
      const u = x ?? 0
      const v = y ?? 0
      const eps = 1e-6
      const { gx, gy } = plateAt(rich, u, v)
      const dx = (plateAt(rich, u + eps, v).f - plateAt(rich, u - eps, v).f) / (2 * eps)
      const dy = (plateAt(rich, u, v + eps).f - plateAt(rich, u, v - eps).f) / (2 * eps)
      expect(gx).toBeCloseTo(dx, 4)
      expect(gy).toBeCloseTo(dy, 4)
    }
  })
})

describe('a line is a pixel or two wide, on any canvas', () => {
  // Across the straight nodal line at the middle of mode 1, one pixel at a
  // time, how many pixels are more than half lit by the core.
  const wide = (w: number, h: number, over: Partial<CymaticsParams> = {}) => {
    const params = cymaticsParams({
      intensity: 1,
      mode1: 1,
      width: 1,
      sharp: 0.25,
      strike: 0.35,
      ...over,
    })
    const modes = modesFor(params)
    const y = h / 2 - 0.3 * plateSide(w, h)
    let count = 0
    for (let x = Math.floor(w / 2) - 12; x < Math.floor(w / 2) + 12; x += 1) {
      const distance = nodalDistance(modes, x + 0.5, y, w, h)
      if (lineProfile(distance, lineWidth(params), 4).core > 0.5) count += 1
    }

    return count
  }

  it('at 480, 1080, 2160 and 4320 lines high', () => {
    for (const [w, h] of [
      [854, 480],
      [1920, 1080],
      [3840, 2160],
      [7680, 4320],
    ] as const) {
      expect(wide(w, h), `${h}`).toBeGreaterThanOrEqual(1)
      expect(wide(w, h), `${h}`).toBeLessThanOrEqual(3)
    }
  })

  it('and never so thin that it goes out, however sharp', () => {
    // At the top of the sharpness and the bottom of the width the line is at
    // its thinnest, and it still covers most of the pixel it is in. It is drawn
    // by how much of the pixel it covers, so a hairline is a little dimmer and
    // never a line that flickers in and out as it crosses pixel centres.
    const params = cymaticsParams({ intensity: 1, mode1: 1, width: 0.4, sharp: 1, strike: 0 })
    expect(lineWidth(params)).toBeGreaterThan(0.1)
    expect(lineProfile(0, lineWidth(params), 1).core).toBeGreaterThan(0.6)
    // Half a pixel to either side of it is still lit, so it reaches into the pixels beside it.
    expect(lineProfile(0.5, lineWidth(params), 1).core).toBeGreaterThan(0.05)
  })

  it('has a core that ends and a glow that does not, and each is the shader’s', () => {
    expect(lineProfile(0, 1, 5).core).toBe(1)
    expect(lineProfile(1, 1, 5).core).toBeCloseTo(0.5, 6)
    expect(lineProfile(1.5, 1, 5).core).toBe(0)
    expect(lineProfile(40, 1, 5).core).toBe(0)
    expect(lineProfile(5, 1, 5).halo).toBeCloseTo(lineProfile(0, 1, 5).halo * Math.exp(-1), 8)
    expect(lineProfile(0, 1, 5).halo).toBeGreaterThan(0)
    expect(lineProfile(0, 1, 5).halo).toBeLessThan(0.15)
  })
})

describe('the share of the frame it lights', () => {
  // A line drawing on a black plate. The plate is a square, so the frame that
  // is nearest to one is the worst there is, and each of these is at the top
  // of every row that adds to it, which a real passage never sits at for long.
  it('is under a fifth for a triad at every sharpness, on eight canvases', () => {
    for (const sharp of [0, 0.25, 0.5, 0.75, 1])
      for (const [w, h] of SHAPES)
        expect(
          cymaticsCoverage(plate(TRIAD, { ...LOUD, sharp }), w, h, 135),
          `${w} by ${h} at sharpness ${sharp}`,
        ).toBeLessThan(0.2)
  })

  it('is under a fifth for a whole scale at every sharpness, on eight canvases', () => {
    for (const sharp of [0, 0.5, 1])
      for (const [w, h] of SHAPES)
        expect(
          cymaticsCoverage(plate(SCALE, { ...LOUD, sharp }), w, h, 135),
          `${w} by ${h} at sharpness ${sharp}`,
        ).toBeLessThan(0.2)
  })

  it('is under a fifth even with all twelve at once, which the extractor never reads', () => {
    for (const [w, h] of SHAPES)
      expect(
        cymaticsCoverage(plate(ALL, { ...LOUD, sharp: 0 }), w, h, 135),
        `${w} by ${h}`,
      ).toBeLessThan(0.2)
  })

  it('is a few percent for a triad at rest', () => {
    for (const [w, h] of SHAPES)
      expect(cymaticsCoverage(plate(TRIAD), w, h, 135), `${w} by ${h}`).toBeLessThan(0.03)
  })

  it('is nothing for a silent plate, and less the thinner the line', () => {
    expect(cymaticsCoverage(plate([]), 1920, 1080)).toBe(0)
    const loose = cymaticsCoverage(plate(TRIAD, { ...LOUD, sharp: 0 }), 1000, 1000, 135)
    const tight = cymaticsCoverage(plate(TRIAD, { ...LOUD, sharp: 1 }), 1000, 1000, 135)
    expect(tight).toBeLessThan(loose)
  })

  it('is less on a wide or a tall canvas than on a square one, since the plate is a square', () => {
    const square = cymaticsCoverage(plate(SCALE, LOUD), 1000, 1000, 135)
    expect(cymaticsCoverage(plate(SCALE, LOUD), 2560, 1080, 135)).toBeLessThan(square)
    expect(cymaticsCoverage(plate(SCALE, LOUD), 1080, 1920, 135)).toBeLessThan(square)
  })

  it('counts a pixel as lit by what the canvas would show of it, and nothing outside the plate', () => {
    const light = cymaticsAt(1000, 300, plate(TRIAD), 1920, 1080)
    expect(light).toBeGreaterThanOrEqual(0)
    // Outside the plate, on a wide canvas, is black however loud.
    for (const x of [10, 200, 1900])
      expect(cymaticsAt(x, 540, plate(SCALE, LOUD), 1920, 1080)).toBe(0)
    expect(LIT_THRESHOLD).toBeLessThan(0.1)
  })
})

describe('the colour', () => {
  it('is a full hue for each note, its place on the circle of fifths turned by the key', () => {
    for (let turn = 0; turn < 1; turn += 0.07) {
      const [red, green, blue] = vividColour(turn)
      // Brightest channel at 1, and always a colour and never a grey.
      expect(Math.max(red, green, blue)).toBeCloseTo(1, 6)
      expect(Math.min(red, green, blue)).toBeLessThan(0.3)
    }

    const at = (turn: number) => vividColour(turn).map((value) => value.toFixed(4))
    // A whole turn is the same colour, and a third of a turn moves it round the channels.
    expect(at(0.25)).toEqual(at(1.25))
    expect(at(0)).not.toEqual(at(1 / 3))
  })

  it('has a core that goes toward white and is not white outright', () => {
    expect(CORE_WHITE).toBeGreaterThan(0.4)
    expect(CORE_WHITE).toBeLessThan(1)
  })
})

describe('the same song, at any frame rate', () => {
  const study = findStudy('cymatics')
  if (!study) throw new Error('Expected the cymatics study')

  /**
   * A chord for two and a half seconds and then a different one for half a
   * second, at a step of `1 / rate`, with the beat and the level in it, and
   * what the study resolves at the end.
   */
  const at = (rate: number) => {
    const out: Record<string, number> = {}
    const states: RowState[] = []
    const packet = (notes: readonly number[]) => {
      const packet = new Float32Array(PACKET_LENGTH)
      for (const note of notes) packet[CHROMA_ROW + note] = 1
      packet[F.energy] = 0.6
      packet[F.beatPulse] = 0.4
      packet[F.bassPulse] = 0.5
      packet[F.harmonicChange] = 0.2
      return packet
    }

    const first = packet(TRIAD)
    const second = packet([9, 0, 4])
    for (let time = 0; time < 2.5 - 1e-9; time += 1 / rate)
      resolveStudy(study, undefined, first, 0, 1, out, 1 / rate, states)
    for (let time = 0; time < 0.5 - 1e-9; time += 1 / rate)
      resolveStudy(study, undefined, second, 0, 1, out, 1 / rate, states)
    return { knobs: { ...out }, packet: second }
  }

  it('is the same plate at 30, 60, 144 and 240 steps a second', () => {
    const slow = at(30)
    const uniform = (run: ReturnType<typeof at>) =>
      writeCymaticsUniform(
        cymaticsParams(run.knobs),
        run.packet,
        1920,
        1080,
        new Float32Array(CYMATICS_UNIFORM_FLOATS),
      )
    const base = uniform(slow)
    for (const rate of [60, 144, 240]) {
      const fast = at(rate)
      for (const [knob, value] of Object.entries(slow.knobs))
        expect(fast.knobs[knob] ?? 0, `${knob} at ${rate}`).toBeCloseTo(value, 1)
      const other = uniform(fast)
      for (let float = 0; float < CYMATICS_UNIFORM_FLOATS; float += 1)
        expect(other[float] ?? 0, `float ${float} at ${rate}`).toBeCloseTo(base[float] ?? 0, 1)
    }
  })
})

describe('the uniform, as the shader reads it', () => {
  const params = plate(TRIAD, { layer: 0.5, strike: 0.6, glow: 6 })
  const packet = new Float32Array(PACKET_LENGTH)
  packet[F.keyHue] = 0.25
  for (const note of TRIAD) packet[CHROMA_ROW + note] = 1
  const out = writeCymaticsUniform(
    params,
    packet,
    1920,
    1080,
    new Float32Array(CYMATICS_UNIFORM_FLOATS).fill(-1),
  )

  /** The struct the shader declares, field by field, and how many vec4s each takes. */
  const fields = [
    ...(shader.match(/struct Params\s*\{([\s\S]*?)\n\}/)?.[1] ?? '').matchAll(
      /^\s*(\w+)\s*:\s*(vec4<f32>|array<vec4<f32>,\s*(\d+)>),/gm,
    ),
  ].map((match) => ({ name: match[1] ?? '', vec4s: match[3] ? Number(match[3]) : 1 }))

  /** Where a field starts, in floats: the vec4s before it, four floats each. */
  const slot = (name: string) => {
    let vec4s = 0
    for (const field of fields) {
      if (field.name === name) return 4 * vec4s
      vec4s += field.vec4s
    }

    throw new Error(`the shader has no ${name}`)
  }

  it('is a struct of vec4s that add up to the floats the fill writes', () => {
    expect(fields.map((field) => field.name)).toEqual([
      'screen',
      'line',
      'drive',
      'spare',
      'modes',
      'tints',
    ])
    expect(fields.reduce((sum, field) => sum + field.vec4s, 0) * 4).toBe(CYMATICS_UNIFORM_FLOATS)
    expect(out).toHaveLength(CYMATICS_UNIFORM_FLOATS)
    // A uniform array of vec4s is a stride of sixteen bytes already, and the
    // struct is a whole number of them, so there is no padding to get wrong.
    expect(CYMATICS_UNIFORM_FLOATS * 4).toBe(640)
  })

  it('writes the whole buffer, so nothing a last frame left in it can be read', () => {
    const dirty = new Float32Array(CYMATICS_UNIFORM_FLOATS).fill(-99)
    const again = writeCymaticsUniform(params, packet, 1920, 1080, dirty)
    expect(again).toBe(dirty)
    expect([...again].includes(-99)).toBe(false)
    expect([...again]).toEqual([...out])
  })

  it('reads the screen, the line and the fade from the slots the fill puts them in', () => {
    const screen = slot('screen')
    const line = slot('line')
    expect(screen).toBe(0)
    expect(out[screen]).toBe(1920)
    expect(out[screen + 1]).toBe(1080)
    expect(out[screen + 2]).toBeCloseTo(plateSide(1920, 1080), 4)
    expect(out[line]).toBeCloseTo(lineWidth(params), 6)
    expect(out[line + 1]).toBeCloseTo(glowWidth(params, 1920, 1080), 6)
    expect(out[line + 2]).toBeGreaterThan(0)
    expect(out[line + 3]).toBeCloseTo(1.2, 6)
    // A held chord is settled, so the fade is the level's alone.
    expect(out[slot('drive')]).toBeCloseTo(vigour(params), 6)
    for (let spare = 0; spare < 4; spare += 1) expect(out[slot('spare') + spare]).toBe(0)
  })

  it('reads a mode from four floats and a note’s colour from four more', () => {
    const modes = slot('modes')
    const tints = slot('tints')
    expect(modes).toBe(16)
    expect(tints).toBe(16 + 4 * 2 * NOTES)
    modesFor(params).forEach((mode, at) => {
      expect(out[modes + 4 * at]).toBe(mode.n)
      expect(out[modes + 4 * at + 1]).toBe(mode.m)
      expect(out[modes + 4 * at + 2]).toBeCloseTo(mode.amplitude, 6)
      expect(out[modes + 4 * at + 3]).toBe(mode.sign)
    })

    for (let note = 0; note < NOTES; note += 1) {
      const [red, green, blue] = vividColour(((note * 7) % NOTES) / NOTES + 0.25)
      expect(out[tints + 4 * note]).toBeCloseTo(red, 5)
      expect(out[tints + 4 * note + 1]).toBeCloseTo(green, 5)
      expect(out[tints + 4 * note + 2]).toBeCloseTo(blue, 5)
    }
  })

  it('agrees with the shader on the constants both hold', () => {
    const constant = (name: string) =>
      Number(shader.match(new RegExp(`const ${name} = ([\\d.]+)`))?.[1])
    expect(constant('MODES')).toBe(2 * NOTES)
    expect(constant('NOTES')).toBe(NOTES)
    // The table holds the cosines of zero up to the top mode.
    expect(constant('TABLE')).toBe(TOP_MODE + 1)
    expect(shader).toMatch(/array<f32, 9>/)
    expect(constant('CORE_WHITE')).toBe(CORE_WHITE)
    // And a mode that is not ringing is skipped by the same test the fill uses to leave it at 0.
    expect(constant('AMP_MIN')).toBeLessThan(MODE_MIN)
  })

  it('takes both derivatives, in uniform control flow, before it can leave', () => {
    const body = shader.slice(shader.indexOf('@fragment'))
    // A derivative after an early return or a discard is not in uniform control
    // flow and Tint refuses it; the body has one return and it is the last thing.
    expect(body.match(/\breturn\b/g)).toHaveLength(1)
    expect(body).not.toMatch(/\bdiscard\b/)
    expect(body.indexOf('dpdx(')).toBeGreaterThan(0)
    expect(body.indexOf('dpdx(')).toBeLessThan(body.indexOf('return'))
    // The distance is the sum over the length of its own gradient.
    expect(body).toMatch(/length\(vec2<f32>\(dpdx\(sum\), dpdy\(sum\)\)\)/)
    expect(body).toMatch(/abs\(sum\)\s*\/\s*max\(gradient,/)
  })
})
