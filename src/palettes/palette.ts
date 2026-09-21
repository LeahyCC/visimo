/**
 * What a palette is, and how one becomes the row of texels the fluid samples.
 * Pure: the palettes themselves are in `defs.ts` and which one is showing is
 * `active.ts`'s business.
 *
 * A palette is a ring of OKLCH stops. The ring is what the dye's coordinate
 * walks: 0 to 1 and wrapping, so the last stop runs back into the first with
 * no seam. Every stop has a lightness, a chroma and a hue, and the baked table
 * is the ring interpolated in OKLCH, so a mix of two stops is a colour of
 * in-between brightness and not the muddier RGB average.
 *
 * Every palette is built to one value structure, and the tests hold each to it:
 * a dark anchor at the seam, a body that climbs through the middle, one bright
 * accent about half way round, and a return that falls back to the anchor. The
 * anchor is never darker than `MIN_LIGHTNESS`, because the dye is drawn over
 * near black and a stop that dark is a hole in the picture.
 */
import { hueGap, mixOklch, oklchToSrgb, wrapHue } from '../colour/oklch'
import type { Oklch, Rgb } from '../colour/oklch'

export const PALETTE_IDS = [
  'classic',
  'ember',
  'abyss',
  'aurora',
  'neon',
  'dusk',
  'mono-gold',
] as const
export type PaletteId = (typeof PALETTE_IDS)[number]

export const isPaletteId = (value: string): value is PaletteId =>
  (PALETTE_IDS as readonly string[]).includes(value)

/** Texels in the lookup table the fluid samples. */
export const PALETTE_SIZE = 256

/**
 * The darkest lightness any stop may have. The dye is drawn additively over a
 * background at about 0.01, so a stop under this reads as absent rather than
 * as a dark colour, and the plume going through it looks torn.
 */
export const MIN_LIGHTNESS = 0.3

export type PaletteStop = {
  /** Where on the ring, from 0 up to but not including 1. */
  at: number
} & Oklch

export type Palette = {
  id: PaletteId
  name: string
  /** What it is for, in a line, so a reader picking looks knows what to reach for. */
  mood: string
  /**
   * The ring, sorted by `at`. It is closed by the last stop running round to
   * the first, so nothing is repeated at 1.
   */
  stops: readonly PaletteStop[]
  /**
   * What the song's key does to it. `'walk'` is how the fluid has always
   * worked: the key moves the coordinate along the ring, so each key shows a
   * different stretch of it and the lightness moves with the stretch. A number
   * is the most degrees of OKLCH hue the key may turn the palette by, in either
   * direction, and the ring stays where it is, so a key changes the colour of
   * the picture and never how bright it is.
   *
   * The swing is a sine of the key rather than a multiple of it. The key is a
   * position on the circle of fifths and wraps, so a multiple would jump by
   * the whole swing between the last key and the first, which are neighbours.
   */
  key: 'walk' | number
}

const wrap = (value: number) => ((value % 1) + 1) % 1

/**
 * The ring at one place, as an OKLCH colour that may be outside the gamut,
 * because two palettes are mixed before it is fitted to sRGB and fitting twice
 * would dull the mix.
 */
export function ringAt(stops: readonly PaletteStop[], place: number): Oklch {
  const first = stops[0]
  if (!first) return { l: 0, c: 0, h: 0 }
  const at = wrap(place)
  // Before the first stop the ring is on the segment that closes it, so the
  // place is read as past the end.
  const position = at < first.at ? at + 1 : at
  let from = stops.length - 1
  for (let index = 0; index < stops.length; index++)
    if ((stops[index]?.at ?? 1) <= position) from = index
  const start = stops[from] ?? first
  const wraps = from + 1 >= stops.length
  const end = stops[wraps ? 0 : from + 1] ?? first
  const span = end.at + (wraps ? 1 : 0) - start.at
  return mixOklch(start, end, span > 0 ? (position - start.at) / span : 0)
}

/** How far the key has turned a swinging palette, in degrees. */
export const keyTurn = (palette: Palette, key: number) =>
  palette.key === 'walk' ? 0 : palette.key * Math.sin(2 * Math.PI * key)

/**
 * The palette at a dye coordinate, for a song in this key. A walking palette
 * is the ring at the coordinate itself. A swinging one is the ring at the
 * coordinate's distance from the key, which is what makes the key mean the
 * same thing for every consumer of the coordinate: everything that asks for
 * the key plus an offset gets the ring at that offset, whatever the key, and
 * then the hue swings.
 */
export function paletteColour(palette: Palette, coordinate: number, key: number): Oklch {
  if (palette.key === 'walk') return ringAt(palette.stops, coordinate)
  const colour = ringAt(palette.stops, coordinate - key)
  return { ...colour, h: wrapHue(colour.h + keyTurn(palette, key)) }
}

/**
 * Which palettes are showing, by id: what a set of looks resolves to. `mix` is
 * how far `from` has faded into `to`, 0 to 1, and `from` and `to` are the same
 * palette when only one is live.
 */
export type PaletteChoice = { from: PaletteId; to: PaletteId; mix: number }

/** The same, with the palettes themselves in hand. */
export type PaletteMix = {
  from: Palette
  to: Palette
  /** 0 is all `from`, 1 is all `to`. */
  mix: number
}

/**
 * One row of the lookup table as unquantised floats, three a texel, from 0 to
 * 1. The coordinate of texel `index` is `index / (size - 1)`, so the last
 * texel is coordinate 1, which wraps to 0: the two are the same colour and the
 * row ends where it began.
 *
 * The blend of two palettes is done in OKLCH per texel and fitted to the gamut
 * once, after. At `mix` 0 it is `from` and at 1 it is `to`, texel for texel.
 */
export function bakePalette(state: PaletteMix, key: number, size = PALETTE_SIZE): Float32Array {
  const out = new Float32Array(size * 3)
  const { from, to, mix } = state
  // The hue gap the last texel was mixed across, so the next can keep to the
  // same route. The short way round flips direction wherever the two rings sit
  // half a hue circle apart, and with a fresh choice at every texel the mix
  // jumped between two routes there: ember into abyss showed a hard-edged band
  // across the middle of the row. Taking the way round nearest the last
  // texel's makes it one route the whole length, which costs "the short way"
  // only where the two rings' own hues cross half a circle, and there the
  // alternative is a seam.
  //
  // Two rings that wind the hue circle differently still meet in a seam at the
  // wrap. Classic winds once round and the designed palettes do not, and only
  // designed ones are ever faded: classic is what a pinned cast holds, and
  // nothing fades out of a pinned cast.
  let route = 0
  for (let index = 0; index < size; index++) {
    const coordinate = size > 1 ? index / (size - 1) : 0
    const start = paletteColour(from, coordinate, key)
    let colour = start
    if (mix > 0 && from !== to) {
      const end = paletteColour(to, coordinate, key)
      let gap = hueGap(start.h, end.h)
      if (index > 0) gap += 360 * Math.round((route - gap) / 360)
      route = gap
      colour = mixOklch(start, end, mix, gap)
    }

    const rgb: Rgb = oklchToSrgb(colour)
    out.set(rgb, index * 3)
  }

  return out
}

/** A baked row as `rgba8unorm` texels, ready for `writeTexture`. */
export function lutBytes(baked: Float32Array): Uint8Array {
  const size = baked.length / 3
  const out = new Uint8Array(size * 4)
  for (let index = 0; index < size; index++) {
    for (let part = 0; part < 3; part++)
      out[index * 4 + part] = Math.round(
        Math.min(1, Math.max(0, baked[index * 3 + part] ?? 0)) * 255,
      )
    out[index * 4 + 3] = 255
  }

  return out
}

/**
 * A baked row read at a coordinate, wrapping, by linear interpolation between
 * its two nearest texels. This is how the CPU asks for a colour, so an ink
 * gets exactly what the GPU's linear sampler would give it.
 */
export function readBaked(baked: Float32Array, coordinate: number): Rgb {
  const size = baked.length / 3
  if (size < 1) return [0, 0, 0]
  const place = wrap(coordinate) * (size - 1)
  const low = Math.floor(place)
  const high = Math.min(low + 1, size - 1)
  const at = place - low
  const part = (channel: number) =>
    (baked[low * 3 + channel] ?? 0) * (1 - at) + (baked[high * 3 + channel] ?? 0) * at
  return [part(0), part(1), part(2)]
}
