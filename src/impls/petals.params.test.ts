/**
 * The petals' numbers against the flower they describe: that the twelve notes
 * stand in circle-of-fifths order with the key's note at the top, that a shut
 * flower is shorter and a lit petal longer, that the rim is the only light
 * past 1, that a silent flower draws nothing and that the worst frame the
 * study can draw stays under the sparse bar. Pure arithmetic, no GPU objects.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  BODY,
  BUD_LENGTH,
  fifthsPlace,
  HUB,
  LIT_THRESHOLD,
  NOTE_MIN,
  openness,
  PETAL_RANGES,
  PETAL_UNIFORM_FLOATS,
  petalLength,
  petalLight,
  petalParams,
  petalsAt,
  petalsCoverage,
  petalsFor,
  petalsLit,
  RIM,
  writePetalsUniform,
} from './petals.params'
import type { PetalParams } from './petals.params'

/** The resting numbers, with the notes named. Anything unsaid is at rest. */
const flower = (notes: readonly number[], rest: Partial<PetalParams> = {}): PetalParams =>
  petalParams({
    open: 1,
    size: 0.36,
    width: 0.75,
    layer: 0,
    glow: 10,
    intensity: 1.3,
    turn: 0,
    ...Object.fromEntries(notes.map((note) => [`note${note}`, 1])),
    ...rest,
  })

const C_MAJOR = [0, 4, 7]
const ALL = Array.from({ length: 12 }, (_, note) => note)

describe('petalParams', () => {
  it('clamps every knob to its range and falls back on a missing one', () => {
    const params = petalParams({ note0: 9, note1: -2, size: 9, width: 0, glow: 999, intensity: 99 })
    expect(params.note0).toBe(1)
    expect(params.note1).toBe(0)
    expect(params.size).toBe(PETAL_RANGES.size[1])
    expect(params.width).toBe(PETAL_RANGES.width[0])
    expect(params.glow).toBe(PETAL_RANGES.glow[1])
    expect(params.intensity).toBe(PETAL_RANGES.intensity[1])
    expect(params.open).toBe(0.5)
    expect(petalParams({ size: Number.NaN }).size).toBe(0.3)
  })

  // Two integrating rows may each wrap at a turn and their sum is past one;
  // a clamp would stop the flower there and then jump it back.
  it('wraps the turn and does not clamp it', () => {
    expect(petalParams({ turn: 1.25 }).turn).toBeCloseTo(0.25)
    expect(petalParams({ turn: -0.25 }).turn).toBeCloseTo(0.75)
    expect(petalParams({ turn: 0.4 }).turn).toBeCloseTo(0.4)
  })

  it('draws nothing at no intensity or with no note lit, which is the silence gate', () => {
    expect(petalsLit(flower(C_MAJOR))).toBe(true)
    expect(petalsLit(flower(C_MAJOR, { intensity: 0 }))).toBe(false)
    expect(petalsLit(flower([]))).toBe(false)
    expect(petalsLit(petalParams({ intensity: 1.3, note3: NOTE_MIN / 2 }))).toBe(false)
    for (const [x, y] of [
      [960, 540],
      [960, 300],
    ] as const)
      expect(petalsAt(x ?? 0, y ?? 0, flower([], { layer: 1 }), 0, 1920, 1080)).toBe(0)
  })
})

describe('where the petals stand', () => {
  it('puts the notes in circle-of-fifths order, so a chord is a cluster', () => {
    expect(fifthsPlace(0)).toBe(0)
    expect(fifthsPlace(7)).toBe(1)
    expect(fifthsPlace(2)).toBe(2)
    expect(fifthsPlace(5)).toBe(11)
    // Every place is taken once.
    expect(new Set(ALL.map(fifthsPlace)).size).toBe(12)
  })

  it('stands the key’s own note at the top and turns the flower with a change of key', () => {
    const top = (keyHue: number) => petalsFor(flower(ALL), keyHue)
    // In C the C petal points straight up: y down, so its y is -1.
    expect(top(0)[0]?.dirX).toBeCloseTo(0)
    expect(top(0)[0]?.dirY).toBeCloseTo(-1)
    // In G, which is a twelfth on, it is the G petal that does.
    expect(top(1 / 12)[7]?.dirX).toBeCloseTo(0)
    expect(top(1 / 12)[7]?.dirY).toBeCloseTo(-1)
    // A fifth up turns the C petal a twelfth of a turn the other way.
    const moved = top(1 / 12)[0]
    expect(Math.atan2(moved?.dirX ?? 0, -(moved?.dirY ?? 0))).toBeCloseTo(-Math.PI / 6)
  })

  it('gives each petal a hue of its own, a twelfth of the wheel from its neighbour', () => {
    const hues = petalsFor(flower(ALL), 0).map((petal) => petal.hue)
    expect(new Set(hues.map((hue) => hue.toFixed(4))).size).toBe(12)
    // Neighbours on the circle of fifths are neighbours on the wheel.
    expect((hues[7] ?? 0) - (hues[0] ?? 0)).toBeCloseTo(1 / 12)
    // And the key turns the whole wheel.
    expect((petalsFor(flower(ALL), 0.25)[0]?.hue ?? 0) - (hues[0] ?? 0)).toBeCloseTo(0.25)
  })

  it('turns every petal by the same angle', () => {
    const still = petalsFor(flower(ALL), 0)
    const turned = petalsFor(flower(ALL, { turn: 0.25 }), 0)
    for (let note = 0; note < 12; note += 1) {
      const a = still[note]
      const b = turned[note]
      // A quarter turn: (x, y) becomes (-y, x).
      expect(b?.dirX).toBeCloseTo(-(a?.dirY ?? 0))
      expect(b?.dirY).toBeCloseTo(a?.dirX ?? 0)
    }
  })
})

describe('how long a petal is', () => {
  const radius = 400
  const base = HUB * radius

  it('is a bud’s shorter length shut and the whole reach open', () => {
    expect(openness(0)).toBeCloseTo(BUD_LENGTH)
    expect(openness(1)).toBe(1)
    const shut = petalLength(flower(C_MAJOR, { open: 0 }), 1, radius, base)
    const open = petalLength(flower(C_MAJOR, { open: 1 }), 1, radius, base)
    expect(shut / open).toBeCloseTo(BUD_LENGTH)
  })

  it('is longer for a louder note and never nothing', () => {
    const params = flower(C_MAJOR)
    const quiet = petalLength(params, 0.1, radius, base)
    const loud = petalLength(params, 1, radius, base)
    expect(quiet).toBeGreaterThan(0)
    expect(loud).toBeGreaterThan(quiet)
    // A full note in a full bloom reaches the radius.
    expect(base + loud).toBeCloseTo(radius)
  })
})

describe('the light of a petal', () => {
  const [width, height] = [1920, 1080]
  // The C petal points straight up at a key of C, so its axis is x = 960.
  const params = flower([0])
  const petal = petalsFor(params, 0)[0]
  if (!petal) throw new Error('Expected a petal')
  const light = (x: number, y: number) => petalLight(params, petal, false, x, y, width, height)

  it('is a rim, brighter than the body it encloses and past 1 once the intensity is on it', () => {
    // Walk out along the middle of the petal and find the brightest and the dimmest lit pixel.
    let peak = 0
    for (let y = 540; y > 0; y -= 1) peak = Math.max(peak, light(960, y))
    expect(peak).toBeGreaterThan(BODY * 2)
    expect(peak * (params.intensity || 1)).toBeGreaterThan(1)
    // The body on its own sits under the bloom's threshold, so only the outline blooms.
    expect(BODY * params.intensity).toBeLessThan(1)
    expect(RIM * params.intensity).toBeGreaterThan(1)
  })

  it('is exactly nothing where no note is lit, and falls to nothing away from the petal', () => {
    expect(petalLight(params, { ...petal, lit: 0 }, false, 960, 300, width, height)).toBe(0)
    expect(light(100, 1000)).toBeLessThan(1e-6)
    expect(light(1800, 100)).toBeLessThan(1e-6)
  })

  it('leaves black between neighbouring petals', () => {
    // C and G stand side by side, a twelfth of a turn apart. Half way between
    // their axes and a good way out the frame is black at the default width.
    const pair = flower([0, 7])
    const petals = petalsFor(pair, 0)
    const at = (x: number, y: number) =>
      petals.reduce((sum, each) => sum + petalLight(pair, each, false, x, y, width, height), 0)
    const angle = Math.PI / 12
    const r = 0.36 * height * 0.85
    expect(at(960 + r * Math.sin(angle), 540 - r * Math.cos(angle))).toBeLessThan(LIT_THRESHOLD * 4)
  })

  it('brings the second whorl up only as the layer rises, half a step behind the first', () => {
    const doubled = flower(C_MAJOR, { layer: 1 })
    const between = (params_: PetalParams) => {
      const rest = petalsFor(params_, 0)[0]
      if (!rest) return 0
      // Half a step round from the C petal, a little inside the inner whorl's tip.
      const angle = Math.PI / 12
      const r = 0.36 * height * 0.4
      return petalLight(
        params_,
        rest,
        true,
        960 + r * Math.sin(angle),
        540 - r * Math.cos(angle),
        width,
        height,
      )
    }

    expect(between(flower(C_MAJOR, { layer: 0 }))).toBe(0)
    expect(between(doubled)).toBeGreaterThan(LIT_THRESHOLD)
  })
})

describe('how much of the frame it lights', () => {
  // The most the study's own mapping reaches: the top of every row that adds
  // to the shape, with the notes named.
  const LOUD = { open: 1, size: 0.41, width: 1, layer: 0.9, glow: 30 }
  // A scale, seven neighbours on the circle of fifths.
  const SCALE = [0, 7, 2, 9, 4, 11, 5]

  it('lights about a seventh of a 16:9 frame for a loud triad and a quarter for a scale', () => {
    expect(petalsCoverage(flower(C_MAJOR, LOUD), 1920, 1080)).toBeLessThan(0.2)
    expect(petalsCoverage(flower(SCALE, LOUD), 1920, 1080)).toBeLessThan(0.3)
  })

  // All twelve at once is what the extractor's flat-chroma gate stops from
  // ever being read, so this is a ceiling and not a case.
  it('lights under 40 percent of a 16:9 frame with every note at once at the top of the mapping', () => {
    expect(petalsCoverage(flower(ALL, LOUD), 1920, 1080)).toBeLessThan(0.4)
  })

  it('holds the same share of the short side on a square frame and a tall one', () => {
    // A square frame is a smaller area for the same flower, so it is a larger share.
    expect(petalsCoverage(flower(C_MAJOR, LOUD), 1000, 1000)).toBeLessThan(0.32)
    expect(petalsCoverage(flower(SCALE, LOUD), 1000, 1000)).toBeLessThan(0.5)
    expect(petalsCoverage(flower(SCALE, LOUD), 1080, 1920)).toBeLessThan(0.3)
  })

  it('lights only a few percent at rest, for an ordinary chord of three notes', () => {
    const rest = { open: 0.5, layer: 0.1, glow: 10 }
    expect(petalsCoverage(flower(C_MAJOR, rest), 1920, 1080)).toBeLessThan(0.06)
  })

  it('lights nothing at all when the gate is closed', () => {
    expect(petalsCoverage(flower([]), 1920, 1080)).toBe(0)
  })

  it('is smaller shut than open', () => {
    const shut = petalsCoverage(flower(C_MAJOR, { open: 0 }), 1920, 1080)
    const open = petalsCoverage(flower(C_MAJOR, { open: 1 }), 1920, 1080)
    expect(shut).toBeLessThan(open)
  })
})

describe('the uniform', () => {
  const packet = new Float32Array(PACKET_LENGTH)

  it('writes sixty-four floats: the canvas, the shape, the light and the twelve petals', () => {
    expect(PETAL_UNIFORM_FLOATS).toBe(64)
    const out = new Float32Array(PETAL_UNIFORM_FLOATS).fill(-1)
    const params = flower(C_MAJOR, { layer: 0.5 })
    writePetalsUniform(params, packet, 1920, 1080, out)
    expect(Array.from(out.slice(0, 4))).toEqual(
      [1920, 1080, 0.36 * 1080, HUB * 0.36 * 1080].map(Math.fround),
    )
    expect(out[4]).toBeCloseTo(1)
    expect(out[5]).toBeCloseTo(0.75)
    expect(out[6]).toBeCloseTo(0.5)
    expect(out[8]).toBeCloseTo(1.3)
    // Every petal is a unit vector, its light and its hue.
    for (let note = 0; note < 12; note += 1) {
      const slot = 16 + 4 * note
      expect(Math.hypot(out[slot] ?? 0, out[slot + 1] ?? 0)).toBeCloseTo(1)
      expect(out[slot + 2]).toBe(C_MAJOR.includes(note) ? 1 : 0)
    }
  })

  it('brightens the heart with how much of the chord is lit and reads the key from the packet', () => {
    const heart = (notes: readonly number[]) => {
      const out = new Float32Array(PETAL_UNIFORM_FLOATS)
      writePetalsUniform(flower(notes), packet, 1920, 1080, out)
      return out[10] ?? 0
    }

    expect(heart([])).toBe(0)
    expect(heart([0])).toBeCloseTo(1 / 3)
    expect(heart(C_MAJOR)).toBe(1)
    expect(heart(ALL)).toBe(1)

    const keyed = new Float32Array(PACKET_LENGTH)
    keyed[F.keyHue] = 0.25
    const out = new Float32Array(PETAL_UNIFORM_FLOATS)
    writePetalsUniform(flower(C_MAJOR), keyed, 1920, 1080, out)
    expect(out[11]).toBeCloseTo(0.25)
    // The C petal is no longer at the top.
    expect(Math.abs(out[16] ?? 0)).toBeGreaterThan(0.5)
  })

  it('scales the rim and the glow with the short side', () => {
    const at = (width: number, height: number) => {
      const out = new Float32Array(PETAL_UNIFORM_FLOATS)
      writePetalsUniform(flower(C_MAJOR), packet, width, height, out)
      return out
    }

    const small = at(1280, 720)
    const big = at(2560, 1440)
    expect((big[7] ?? 0) / (small[7] ?? 1)).toBeCloseTo(2)
    expect((big[9] ?? 0) / (small[9] ?? 1)).toBeCloseTo(2)
  })
})
