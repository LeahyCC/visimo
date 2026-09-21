/**
 * The palette every cast drew in before there were others, kept whole so a
 * pinned cast renders as it always did. It is not designed: it is the table
 * the fluid shipped with, and it is the one palette where the key still walks
 * the coordinate along the ring instead of turning the hue.
 *
 * The table was six sRGB stops mixed in RGB. A palette is OKLCH stops mixed in
 * OKLCH, so the legacy ramp is sampled densely and each sample stored as a
 * stop: stops that close together make the two ways of mixing agree to within
 * a level of 8-bit rounding, which `palettes.test.ts` holds it to against the
 * old table. Nothing here is a design decision, and the stops are not meant to
 * be tuned; tune the others.
 */
import { srgbToOklch } from '../colour/oklch'
import type { Rgb } from '../colour/oklch'
import type { Palette, PaletteStop } from './palette'

type LegacyStop = { at: number; colour: Rgb }

/**
 * Deep blue through teal and green into warm orange and magenta, then back to
 * the first colour. Encoded sRGB, and the values the fluid had before palettes.
 */
export const LEGACY_STOPS: readonly LegacyStop[] = [
  { at: 0, colour: [0.04, 0.09, 0.34] },
  { at: 0.2, colour: [0.04, 0.45, 0.66] },
  { at: 0.38, colour: [0.14, 0.74, 0.54] },
  { at: 0.56, colour: [0.92, 0.72, 0.22] },
  { at: 0.74, colour: [0.94, 0.31, 0.26] },
  { at: 0.88, colour: [0.72, 0.22, 0.72] },
  { at: 1, colour: [0.04, 0.09, 0.34] },
]

/** The old table at one coordinate: the RGB mix it always was. */
export function legacyAt(coordinate: number): Rgb {
  const at = ((coordinate % 1) + 1) % 1
  let next = 1
  while (next < LEGACY_STOPS.length - 1 && (LEGACY_STOPS[next]?.at ?? 1) < at) next++
  const from = LEGACY_STOPS[next - 1]
  const to = LEGACY_STOPS[next] ?? from
  if (!from || !to) return [0, 0, 0]
  const span = to.at - from.at
  const mix = span > 0 ? (at - from.at) / span : 0
  const part = (index: number) =>
    (from.colour[index] ?? 0) + ((to.colour[index] ?? 0) - (from.colour[index] ?? 0)) * mix
  return [part(0), part(1), part(2)]
}

/** Samples between the old stops. A hundred and twenty-eight spans is close enough that the mixes agree. */
const SAMPLES = 128

/**
 * The places sampled: an even grid, plus every corner the old table had, so a
 * kink in the RGB ramp lands on a stop and is not rounded off between two.
 */
const PLACES = [
  ...new Set([
    ...Array.from({ length: SAMPLES }, (_, index) => index / SAMPLES),
    ...LEGACY_STOPS.slice(0, -1).map((stop) => stop.at),
  ]),
].sort((left, right) => left - right)

const stops: readonly PaletteStop[] = PLACES.map((at) => ({ at, ...srgbToOklch(legacyAt(at)) }))

export const CLASSIC: Palette = {
  id: 'classic',
  name: 'Classic',
  mood: 'The original: teal, orange and magenta on a deep navy. Pinned casts keep it.',
  stops,
  key: 'walk',
}
