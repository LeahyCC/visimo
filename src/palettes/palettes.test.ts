import { afterEach, describe, expect, it } from 'vitest'

import { inGamut, oklchToLinearSrgb, srgbToOklch } from '../colour/oklch'
import type { Oklch, Rgb } from '../colour/oklch'
import {
  heldPalette,
  paletteAt,
  paletteLut,
  paletteVersion,
  resetPalette,
  setPalette,
} from './active'
import { PALETTES } from './defs'
import {
  bakePalette,
  isPaletteId,
  keyTurn,
  lutBytes,
  MIN_LIGHTNESS,
  PALETTE_IDS,
  PALETTE_SIZE,
  readBaked,
  ringAt,
} from './palette'
import type { Palette, PaletteId } from './palette'

const ALL = PALETTE_IDS.map((id) => PALETTES[id])
const DESIGNED = ALL.filter((palette) => palette.id !== 'classic')

/** Keys that cover the circle, including the two either side of its seam. */
const KEYS = [0, 0.083, 0.25, 0.4, 0.5, 0.667, 0.75, 0.917, 0.999]

const single = (palette: Palette) => ({ from: palette, to: palette, mix: 0 })

/** A baked row as OKLCH colours, one a texel. */
function lightness(baked: Float32Array): Oklch[] {
  const out: Oklch[] = []
  for (let index = 0; index < baked.length / 3; index++)
    out.push(
      srgbToOklch([baked[index * 3] ?? 0, baked[index * 3 + 1] ?? 0, baked[index * 3 + 2] ?? 0]),
    )
  return out
}

afterEach(() => resetPalette())

/**
 * The table the fluid shipped with before there were palettes, copied here as
 * it was: six sRGB stops and an RGB mix between them. It is written out again
 * rather than imported so the test cannot agree with the code by construction.
 */
const OLD_STOPS: readonly { at: number; colour: Rgb }[] = [
  { at: 0, colour: [0.04, 0.09, 0.34] },
  { at: 0.2, colour: [0.04, 0.45, 0.66] },
  { at: 0.38, colour: [0.14, 0.74, 0.54] },
  { at: 0.56, colour: [0.92, 0.72, 0.22] },
  { at: 0.74, colour: [0.94, 0.31, 0.26] },
  { at: 0.88, colour: [0.72, 0.22, 0.72] },
  { at: 1, colour: [0.04, 0.09, 0.34] },
]

function oldAt(coordinate: number): Rgb {
  const at = ((coordinate % 1) + 1) % 1
  let next = 1
  while (next < OLD_STOPS.length - 1 && (OLD_STOPS[next]?.at ?? 1) < at) next++
  const from = OLD_STOPS[next - 1]
  const to = OLD_STOPS[next]
  if (!from || !to) return [0, 0, 0]
  const mix = (at - from.at) / (to.at - from.at)
  const part = (index: number) =>
    (from.colour[index] ?? 0) + ((to.colour[index] ?? 0) - (from.colour[index] ?? 0)) * mix
  return [part(0), part(1), part(2)]
}

describe('the palette list', () => {
  it('has classic and at least six designed palettes, each with a name and a stated mood', () => {
    expect(PALETTE_IDS).toContain('classic')
    expect(DESIGNED.length).toBeGreaterThanOrEqual(6)
    for (const palette of ALL) {
      expect(palette.name.length).toBeGreaterThan(0)
      expect(palette.mood.length).toBeGreaterThan(10)
    }
  })

  it('keys every palette by its own id', () => {
    for (const id of PALETTE_IDS) expect(PALETTES[id].id).toBe(id)
    expect(isPaletteId('ember')).toBe(true)
    expect(isPaletteId('beige')).toBe(false)
  })

  it('keeps every ring sorted, from 0, with no stop at 1 and no two in one place', () => {
    for (const { id, stops } of ALL) {
      expect(stops[0]?.at, id).toBe(0)
      stops.forEach((stop, index) => {
        expect(stop.at, id).toBeGreaterThanOrEqual(0)
        expect(stop.at, id).toBeLessThan(1)
        if (index > 0) expect(stop.at, id).toBeGreaterThan(stops[index - 1]?.at ?? 0)
      })
    }
  })

  it('keeps every hue in 0 to 360 and no chroma below nothing', () => {
    for (const { id, stops } of ALL)
      for (const stop of stops) {
        expect(stop.h, id).toBeGreaterThanOrEqual(0)
        expect(stop.h, id).toBeLessThan(360)
        expect(stop.c, id).toBeGreaterThanOrEqual(0)
      }
  })
})

describe('the ring', () => {
  it('lands on each stop exactly', () => {
    for (const { stops } of ALL)
      for (const stop of stops) {
        const colour = ringAt(stops, stop.at)
        expect(colour.l).toBeCloseTo(stop.l, 9)
        expect(colour.c).toBeCloseTo(stop.c, 9)
        expect(colour.h).toBeCloseTo(stop.h, 6)
      }
  })

  it('closes with no seam, the last stop running back into the first', () => {
    for (const { id, stops } of ALL) {
      const start = ringAt(stops, 0)
      const end = ringAt(stops, 1 - 1e-9)
      expect(end.l, id).toBeCloseTo(start.l, 6)
      expect(end.c, id).toBeCloseTo(start.c, 6)
    }
  })

  it('wraps its coordinate, so a key and a drift can push it round any number of times', () => {
    for (const { stops } of ALL)
      for (const at of [0, 0.13, 0.5, 0.87]) {
        const wanted = ringAt(stops, at)
        for (const turns of [-2, -1, 1, 3]) {
          const got = ringAt(stops, at + turns)
          expect(got.l).toBeCloseTo(wanted.l, 9)
          expect(got.c).toBeCloseTo(wanted.c, 9)
        }
      }
  })

  it('goes the short way round the hue circle between two stops', () => {
    // Sampled finely, the hue moves by a few degrees a step. The long way
    // round between two stops would show as one step of a hundred degrees or
    // more, where the ring crosses the top of the circle or a palette runs
    // past a half turn between neighbours.
    for (const { id, stops } of ALL)
      for (let index = 0; index < 200; index++) {
        const a = ringAt(stops, index / 200)
        const b = ringAt(stops, (index + 1) / 200)
        const step = Math.abs(((b.h - a.h + 540) % 360) - 180)
        if (a.c > 0.01 && b.c > 0.01) expect(step, id).toBeLessThan(40)
      }
  })
})

describe('what a palette is built to', () => {
  it('has no stop darker than the floor, so nothing reads as a hole', () => {
    for (const { id, stops } of DESIGNED)
      for (const stop of stops)
        expect(stop.l, `${id} at ${stop.at}`).toBeGreaterThanOrEqual(MIN_LIGHTNESS)
  })

  it('leaves classic its own floor, which is the navy the designed palettes were made to avoid', () => {
    // Not held to MIN_LIGHTNESS: it is the legacy table, kept as it was. Held
    // to what it has, so it cannot get any darker.
    const darkest = Math.min(...PALETTES.classic.stops.map((stop) => stop.l))
    expect(darkest).toBeGreaterThan(0.24)
    expect(darkest).toBeLessThan(MIN_LIGHTNESS)
  })

  it('never bakes a texel darker than the floor, in any key', () => {
    for (const palette of DESIGNED)
      for (const key of KEYS)
        for (const colour of lightness(bakePalette(single(palette), key)))
          expect(colour.l, palette.id).toBeGreaterThanOrEqual(MIN_LIGHTNESS - 0.005)
  })

  it('has no hard line in its row in any key, so a hue turn never clips a stop into a kink', () => {
    // The key turns the hue, and where the turned hue meets a sharp corner of
    // the sRGB gamut (blue at any lightness above the middle, the green
    // cusp) the chroma clip bites hard and the row steps by a fifth of the
    // range in one texel. The steepest step any palette has, over every key,
    // stays under this; the first cuts of neon and aurora did not.
    const step = (row: Float32Array) => {
      let worst = 0
      for (let index = 1; index < PALETTE_SIZE; index++)
        for (let part = 0; part < 3; part++)
          worst = Math.max(
            worst,
            Math.abs((row[index * 3 + part] ?? 0) - (row[(index - 1) * 3 + part] ?? 0)),
          )
      return worst
    }

    for (const palette of DESIGNED)
      for (let key = 0; key < 1; key += 0.02)
        expect(step(bakePalette(single(palette), key)), `${palette.id} in ${key}`).toBeLessThan(
          0.09,
        )
  })

  it('is shaped the same way in each: one dark anchor, a body that climbs, one bright accent, a return that falls', () => {
    for (const { id, stops } of DESIGNED) {
      const values = stops.map((stop) => stop.l)
      const peak = values.indexOf(Math.max(...values))
      // The anchor is the first stop and the darkest of them.
      expect(values[0], id).toBe(Math.min(...values))
      // Strictly climbing to the accent and strictly falling after it: one
      // maximum and no wobble, which is what lets `paletteAt` at a low
      // coordinate always be darker than at a high one within the plumes.
      for (let index = 1; index <= peak; index++)
        expect(values[index] ?? 0, `${id} climbs at ${index}`).toBeGreaterThan(
          values[index - 1] ?? 0,
        )
      for (let index = peak + 1; index < values.length; index++)
        expect(values[index] ?? 0, `${id} falls at ${index}`).toBeLessThan(values[index - 1] ?? 0)
      // The accent is where the ribbon and the far-side inks read it, half a
      // turn from the key.
      const at = stops[peak]?.at ?? 0
      expect(at, id).toBeGreaterThanOrEqual(0.45)
      expect(at, id).toBeLessThanOrEqual(0.65)
      // And it is bright, and the anchor is not.
      expect(values[peak] ?? 0, id).toBeGreaterThanOrEqual(0.85)
    }
  })

  it('has a body between anchor and accent, so the mid of the ring is neither', () => {
    for (const { id, stops } of DESIGNED) {
      const middle = ringAt(stops, 0.3).l
      expect(middle, id).toBeGreaterThan(0.5)
      expect(middle, id).toBeLessThan(0.75)
    }
  })

  it('takes classic through the same shape, measured on its baked ring: dark at the seam, bright about half way', () => {
    const ring = lightness(bakePalette(single(PALETTES.classic), 0))
    const values = ring.map((colour) => colour.l)
    const peak = values.indexOf(Math.max(...values))
    expect(values[0]).toBeLessThan(0.3)
    expect(peak / (values.length - 1)).toBeGreaterThan(0.45)
    expect(peak / (values.length - 1)).toBeLessThan(0.65)
  })

  it('writes every stop as the colour it says, needing no clipping to fit sRGB', () => {
    for (const { id, stops } of ALL)
      for (const stop of stops)
        expect(inGamut(oklchToLinearSrgb(stop)), `${id} at ${stop.at}`).toBe(true)
  })

  it('is a different picture from every other designed palette, not a near copy', () => {
    // The mean distance between two rings in OKLab, sampled round the ring. If
    // two looks were given palettes this close, the director's choice of look
    // would not be a choice of colour.
    const lab = (colour: Oklch) => [
      colour.l,
      colour.c * Math.cos((colour.h * Math.PI) / 180),
      colour.c * Math.sin((colour.h * Math.PI) / 180),
    ]
    const apart = (one: Palette, two: Palette) => {
      let total = 0
      for (let step = 0; step < 64; step++) {
        const a = lab(ringAt(one.stops, step / 64))
        const b = lab(ringAt(two.stops, step / 64))
        total += Math.hypot(
          (a[0] ?? 0) - (b[0] ?? 0),
          (a[1] ?? 0) - (b[1] ?? 0),
          (a[2] ?? 0) - (b[2] ?? 0),
        )
      }

      return total / 64
    }

    for (let first = 0; first < DESIGNED.length; first++)
      for (let second = first + 1; second < DESIGNED.length; second++) {
        const one = DESIGNED[first]
        const two = DESIGNED[second]
        if (one && two) expect(apart(one, two), `${one.id} against ${two.id}`).toBeGreaterThan(0.04)
      }
  })
})

describe('the baked table', () => {
  it('is one opaque row of 256 texels', () => {
    for (const palette of ALL) {
      const bytes = lutBytes(bakePalette(single(palette), 0))
      expect(bytes).toHaveLength(PALETTE_SIZE * 4)
      for (let index = 3; index < bytes.length; index += 4) expect(bytes[index]).toBe(255)
    }
  })

  it('is inside the sRGB gamut at every texel, in every key, and finite', () => {
    for (const palette of ALL)
      for (const key of KEYS)
        for (const value of bakePalette(single(palette), key)) {
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
  })

  it('is inside the gamut for every pair of palettes at every mix', () => {
    for (const from of ALL)
      for (const to of ALL)
        for (const mix of [0.25, 0.5, 0.75])
          for (const value of bakePalette({ from, to, mix }, 0.3)) {
            expect(value).toBeGreaterThanOrEqual(0)
            expect(value).toBeLessThanOrEqual(1)
          }
  })

  it('starts and ends on the same colour, so the coordinate wraps with no seam', () => {
    for (const palette of ALL)
      for (const key of KEYS) {
        const baked = bakePalette(single(palette), key)
        const last = (PALETTE_SIZE - 1) * 3
        for (let part = 0; part < 3; part++)
          expect(baked[last + part] ?? 0, `${palette.id} in ${key}`).toBeCloseTo(
            baked[part] ?? 0,
            5,
          )
      }
  })

  it('bakes classic to what the old table had, within a level of rounding', () => {
    const bytes = lutBytes(bakePalette(single(PALETTES.classic), 0))
    for (let index = 0; index < PALETTE_SIZE; index++) {
      const old = oldAt(index / (PALETTE_SIZE - 1))
      for (let part = 0; part < 3; part++)
        expect(
          Math.abs((bytes[index * 4 + part] ?? 0) - Math.round((old[part] ?? 0) * 255)),
          `texel ${index} channel ${part}`,
        ).toBeLessThanOrEqual(1)
    }
  })

  it('bakes classic the same in every key, since the key walks its coordinate and never its colour', () => {
    const wanted = bakePalette(single(PALETTES.classic), 0)
    for (const key of KEYS) expect(bakePalette(single(PALETTES.classic), key)).toEqual(wanted)
  })

  it('reads back at a coordinate by the same linear step the GPU takes, wrapping', () => {
    const baked = bakePalette(single(PALETTES.ember), 0)
    for (const at of [0, 0.31, 0.5, 0.9])
      readBaked(baked, at).forEach((value, part) => {
        expect(readBaked(baked, at + 3)[part]).toBeCloseTo(value, 6)
        expect(readBaked(baked, at - 1)[part]).toBeCloseTo(value, 6)
      })
    // On a texel it is that texel.
    readBaked(baked, 10 / (PALETTE_SIZE - 1)).forEach((value, part) =>
      expect(value).toBeCloseTo(baked[10 * 3 + part] ?? 0, 6),
    )
  })
})

describe('the key', () => {
  const swinging = DESIGNED.filter((palette) => palette.key !== 'walk')

  it('swings every designed palette, and only classic walks', () => {
    expect(swinging).toHaveLength(DESIGNED.length)
    expect(PALETTES.classic.key).toBe('walk')
  })

  it('turns the hue and leaves the lightness where it was', () => {
    // The point of turning in OKLCH: the same place on the ring is as bright
    // in every key. Compared at the coordinates the inks ask for, key plus an
    // offset, since that is how every consumer names a place.
    for (const palette of swinging)
      for (const offset of [0, 0.15, 0.3, 0.5, 0.7]) {
        const at = (key: number) => {
          const baked = bakePalette(single(palette), key)
          return srgbToOklch(readBaked(baked, key + offset))
        }
        const base = at(0)
        for (const key of KEYS)
          expect(at(key).l, `${palette.id} at ${offset}`).toBeCloseTo(base.l, 1)
      }
  })

  it('does turn the hue, by no more than the palette’s swing', () => {
    for (const palette of swinging) {
      if (palette.key === 'walk') continue
      const swing = palette.key
      const hues = KEYS.map((key) => {
        const baked = bakePalette(single(palette), key)
        return srgbToOklch(readBaked(baked, key + 0.5)).h
      })
      const spread = Math.max(
        ...hues.map((h) => Math.abs(((h - (hues[0] ?? 0) + 540) % 360) - 180)),
      )
      expect(spread, palette.id).toBeLessThanOrEqual(2 * swing + 4)
      if (swing >= 20) expect(spread, palette.id).toBeGreaterThan(swing / 2)
    }
  })

  it('is continuous over the seam of the key, so neighbours on the circle of fifths look alike', () => {
    for (const palette of swinging) {
      const before = keyTurn(palette, 0.9999)
      const after = keyTurn(palette, 0.0001)
      expect(Math.abs(before - after), palette.id).toBeLessThan(0.2)
    }
  })

  it('is no turn at all for a walking palette', () => {
    expect(keyTurn(PALETTES.classic, 0.3)).toBe(0)
  })
})

describe('cross-fading two palettes', () => {
  const PAIRS: readonly [PaletteId, PaletteId][] = [
    ['ember', 'abyss'],
    ['classic', 'neon'],
    ['dusk', 'mono-gold'],
    ['aurora', 'classic'],
  ]

  it('is the first palette at 0 and the second at 1, texel for texel', () => {
    for (const [a, b] of PAIRS)
      for (const key of [0, 0.37]) {
        const from = PALETTES[a]
        const to = PALETTES[b]
        expect(bakePalette({ from, to, mix: 0 }, key)).toEqual(bakePalette(single(from), key))
        expect(bakePalette({ from, to, mix: 1 }, key)).toEqual(bakePalette(single(to), key))
      }
  })

  it('at 0 and 1 bakes to the same bytes as either palette alone', () => {
    for (const [a, b] of PAIRS) {
      const from = PALETTES[a]
      const to = PALETTES[b]
      expect(lutBytes(bakePalette({ from, to, mix: 0 }, 0.2))).toEqual(
        lutBytes(bakePalette(single(from), 0.2)),
      )

      expect(lutBytes(bakePalette({ from, to, mix: 1 }, 0.2))).toEqual(
        lutBytes(bakePalette(single(to), 0.2)),
      )
    }
  })

  it('mixes in OKLCH: the middle is between the two in lightness at every texel', () => {
    for (const [a, b] of PAIRS) {
      const from = PALETTES[a]
      const to = PALETTES[b]
      const one = lightness(bakePalette(single(from), 0))
      const two = lightness(bakePalette(single(to), 0))
      const middle = lightness(bakePalette({ from, to, mix: 0.5 }, 0))
      middle.forEach((colour, index) => {
        const low = Math.min(one[index]?.l ?? 0, two[index]?.l ?? 0)
        const high = Math.max(one[index]?.l ?? 0, two[index]?.l ?? 0)
        expect(colour.l).toBeGreaterThanOrEqual(low - 0.01)
        expect(colour.l).toBeLessThanOrEqual(high + 0.01)
      })
    }
  })

  it('is not the average of the two in RGB, which is the mud it replaces', () => {
    const from = PALETTES.neon
    const to = PALETTES.ember
    const one = bakePalette(single(from), 0)
    const two = bakePalette(single(to), 0)
    const middle = bakePalette({ from, to, mix: 0.5 }, 0)
    let differs = 0
    for (let index = 0; index < middle.length; index++)
      if (Math.abs((middle[index] ?? 0) - ((one[index] ?? 0) + (two[index] ?? 0)) / 2) > 0.02)
        differs++
    expect(differs).toBeGreaterThan(20)
  })

  it('has no hard edge along the row at any mix, for any pair the director can fade between', () => {
    // Where two rings sit about half a hue circle apart, the short way round
    // flips direction from one texel to the next and the mix jumps between two
    // routes: ember into abyss showed a hard-edged band across the middle of
    // the row. The step between neighbouring texels has to stay small, as the
    // steepest step in either palette on its own does.
    const step = (row: Float32Array) => {
      let worst = 0
      for (let index = 1; index < PALETTE_SIZE; index++)
        for (let part = 0; part < 3; part++)
          worst = Math.max(
            worst,
            Math.abs((row[index * 3 + part] ?? 0) - (row[(index - 1) * 3 + part] ?? 0)),
          )
      return worst
    }

    for (const from of DESIGNED)
      for (const to of DESIGNED)
        for (const key of [0, 0.3])
          for (const mix of [0.25, 0.5, 0.75])
            expect(
              step(bakePalette({ from, to, mix }, key)),
              `${from.id} into ${to.id}`,
            ).toBeLessThan(0.09)
  })

  it('moves smoothly with the mix, no texel jumping by more than a fifth from step to step', () => {
    const from = PALETTES.abyss
    const to = PALETTES.ember
    let last = bakePalette({ from, to, mix: 0 }, 0)
    for (let step = 1; step <= 32; step++) {
      const next = bakePalette({ from, to, mix: step / 32 }, 0)
      next.forEach((value, index) => expect(Math.abs(value - (last[index] ?? 0))).toBeLessThan(0.2))
      last = next
    }
  })
})

describe('the palette that is showing', () => {
  it('starts as classic, and is what the old table gave', () => {
    resetPalette()
    expect(heldPalette()).toEqual({ from: 'classic', to: 'classic', mix: 0, key: 0 })
    for (const at of [0, 0.2, 0.56, 0.88]) {
      const wanted = oldAt(at)
      // The row is 256 texels read by a linear step, as the GPU reads it, so a
      // corner of the old ramp is rounded by up to a level and a half.
      paletteAt(at).forEach((value, part) =>
        expect(Math.abs(value - (wanted[part] ?? 0))).toBeLessThan(0.01),
      )
    }
  })

  it('is the lookup table, texel for texel', () => {
    for (const id of PALETTE_IDS) {
      setPalette({ from: id, to: id, mix: 0 }, 0.3)
      const bytes = paletteLut()
      for (let index = 0; index < PALETTE_SIZE; index++) {
        const colour = paletteAt(index / (PALETTE_SIZE - 1))
        for (let part = 0; part < 3; part++)
          expect(bytes[index * 4 + part]).toBe(Math.round((colour[part] ?? 0) * 255))
      }
    }
  })

  it('wraps its coordinate, so 1 is 0 and a negative one counts back from the end', () => {
    setPalette({ from: 'neon', to: 'neon', mix: 0 }, 0.2)
    paletteAt(1).forEach((value, part) => expect(value).toBeCloseTo(paletteAt(0)[part] ?? 0, 6))
    paletteAt(-0.25).forEach((value, part) =>
      expect(value).toBeCloseTo(paletteAt(0.75)[part] ?? 0, 6),
    )
  })

  it('changes what paletteAt returns when the choice changes, and bumps the version once', () => {
    resetPalette()
    const before = paletteVersion()
    const classic = paletteAt(0.5)
    setPalette({ from: 'abyss', to: 'abyss', mix: 0 }, 0)
    expect(paletteVersion()).toBe(before + 1)
    expect(paletteAt(0.5)).not.toEqual(classic)
    // The same choice again is not a change, and costs no rebake or upload.
    setPalette({ from: 'abyss', to: 'abyss', mix: 0 }, 0)
    expect(paletteVersion()).toBe(before + 1)
  })

  it('ignores the key when only walking palettes are showing, so it never rebakes for it', () => {
    resetPalette()
    const before = paletteVersion()
    for (const key of [0.1, 0.5, 0.9]) setPalette({ from: 'classic', to: 'classic', mix: 0 }, key)
    expect(paletteVersion()).toBe(before)
  })

  it('rebakes for the key when a swinging palette is showing, and only for a step the eye could see', () => {
    setPalette({ from: 'neon', to: 'neon', mix: 0 }, 0)
    const before = paletteVersion()
    setPalette({ from: 'neon', to: 'neon', mix: 0 }, 0.0001)
    expect(paletteVersion()).toBe(before)
    setPalette({ from: 'neon', to: 'neon', mix: 0 }, 0.25)
    expect(paletteVersion()).toBe(before + 1)
  })

  it('reads a key with no number in it as 0, and any whole turns of it as the same key', () => {
    setPalette({ from: 'neon', to: 'neon', mix: 0 }, Number.NaN)
    const nan = Array.from(paletteLut())
    setPalette({ from: 'neon', to: 'neon', mix: 0 }, 0)
    expect(Array.from(paletteLut())).toEqual(nan)
    setPalette({ from: 'neon', to: 'neon', mix: 0 }, 0.3)
    const once = Array.from(paletteLut())
    setPalette({ from: 'neon', to: 'neon', mix: 0 }, 2.3)
    expect(Array.from(paletteLut())).toEqual(once)
  })

  it('is one palette when both ends are the same, whatever the mix', () => {
    setPalette({ from: 'dusk', to: 'dusk', mix: 0.6 }, 0)
    expect(heldPalette().mix).toBe(0)
  })

  it('holds a mix to 0 to 1', () => {
    setPalette({ from: 'dusk', to: 'ember', mix: 4 }, 0)
    expect(heldPalette().mix).toBe(1)
    setPalette({ from: 'dusk', to: 'ember', mix: -2 }, 0)
    expect(heldPalette().mix).toBe(0)
  })

  it('at a mix of 0 or 1 is exactly the palette named, in its bytes', () => {
    setPalette({ from: 'ember', to: 'abyss', mix: 0 }, 0.4)
    const ember = Array.from(paletteLut())
    setPalette({ from: 'ember', to: 'ember', mix: 0 }, 0.4)
    expect(Array.from(paletteLut())).toEqual(ember)
    setPalette({ from: 'ember', to: 'abyss', mix: 1 }, 0.4)
    const abyss = Array.from(paletteLut())
    setPalette({ from: 'abyss', to: 'abyss', mix: 0 }, 0.4)
    expect(Array.from(paletteLut())).toEqual(abyss)
  })

  it('is what the ribbon and the inks read, at any coordinate, through one call', () => {
    setPalette({ from: 'ember', to: 'ember', mix: 0 }, 0.4)
    const [red, , blue] = paletteAt(0.4 + 0.5)
    // Ember's accent is a pale amber: red high, blue well under it.
    expect(red).toBeGreaterThan(blue)
  })
})
