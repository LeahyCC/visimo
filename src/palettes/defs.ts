/**
 * The designed palettes. Each is a ring of OKLCH stops, `l` (lightness, 0 to
 * 1), `c` (chroma, 0 grey to about 0.3 at the most a screen can show) and `h`
 * (hue in degrees: red 30, orange 55, amber 85, yellow 105, green 145, teal
 * 185, cyan 210, blue 260, violet 295, magenta 330).
 *
 * This is the file to tune by eye. Every palette has the same shape, which
 * `palettes.test.ts` holds it to, so a change can move the numbers and keep
 * the structure:
 *
 *   at 0.00   the dark anchor, lightness at or over MIN_LIGHTNESS. The dye's
 *             coordinate for a low band sits here, so the sub is the deepest
 *             colour of the set
 *   0.16-0.46 the body, climbing. The five bands walk it from the sub to the
 *             treble, and the treble is the brightest of them
 *   0.56      the one bright accent. Every ink that sits across the palette
 *             from the plumes (the ribbon, the shards, the sparks) reads it
 *             half a turn from the key, so this is the colour of the lines
 *   0.72-0.86 the return, falling back to the anchor
 *
 * The lightness climbs to the accent and falls after it, and nowhere else
 * turns. Chroma is kept inside what sRGB can show at that lightness and hue,
 * so a stop is the colour written and not a clipped copy of it; the test
 * checks that too. When a stop looks wrong, change its `l` before its `c`:
 * lightness is what the eye reads first.
 *
 * `key` is the most degrees the song's key may turn the hue by. Small for a
 * palette whose identity is its hue (ember stays a fire), large for one that
 * is meant to be a colour of any kind (neon, which stays magenta and blue-green at either end of its swing and never turns orange).
 */
import { CLASSIC } from './classic'
import type { Palette, PaletteId } from './palette'

/**
 * Red-brown coal through red and orange to a white-hot amber, and back. A
 * black-body ramp: the hotter it gets the paler and yellower it is, so the
 * accent is the least saturated stop and the brightest. Warm, dense, urgent.
 */
const EMBER: Palette = {
  id: 'ember',
  name: 'Ember',
  mood: 'Heat: coal red through orange to white-hot amber. Urgent and dense, for the drop.',
  stops: [
    { at: 0, l: 0.34, c: 0.1, h: 28 },
    { at: 0.16, l: 0.5, c: 0.17, h: 32 },
    { at: 0.32, l: 0.64, c: 0.18, h: 42 },
    { at: 0.46, l: 0.78, c: 0.16, h: 70 },
    { at: 0.56, l: 0.91, c: 0.12, h: 95 },
    { at: 0.72, l: 0.66, c: 0.18, h: 40 },
    { at: 0.86, l: 0.48, c: 0.15, h: 30 },
  ],
  key: 20,
}

/**
 * Midnight navy up through deep blue to an icy cyan, and back. Cold and
 * spare: the chroma stays modest so the light does the work and the picture
 * reads as depth and not as decoration.
 */
const ABYSS: Palette = {
  id: 'abyss',
  name: 'Abyss',
  mood: 'Cold: deep blue rising to icy cyan. Held breath, for the build.',
  stops: [
    { at: 0, l: 0.32, c: 0.1, h: 262 },
    { at: 0.16, l: 0.46, c: 0.15, h: 258 },
    { at: 0.32, l: 0.6, c: 0.125, h: 240 },
    { at: 0.46, l: 0.74, c: 0.125, h: 218 },
    { at: 0.56, l: 0.9, c: 0.1, h: 195 },
    { at: 0.72, l: 0.66, c: 0.115, h: 225 },
    { at: 0.86, l: 0.46, c: 0.12, h: 250 },
  ],
  key: 25,
}

/**
 * Violet in the dark, through a blue and teal wash, into green, with a pale
 * mint at the top: the curtain of the northern lights, cool and slow. The one
 * palette that runs through blue on the way and back, and it does it at low
 * chroma on purpose. Blue is where sRGB has least room at any lightness above
 * the middle, so a saturated stop there is clipped, and a clip that changes
 * with the hue shows as a hard line in the row. The extra stops at 0.26, 0.8
 * and 0.88 hold the path through blue to what fits, and the mint's chroma is
 * held under the green cusp for the same reason.
 */
const AURORA: Palette = {
  id: 'aurora',
  name: 'Aurora',
  mood: 'Green and violet, cool and drifting. Clear and tonal, for glass.',
  stops: [
    { at: 0, l: 0.34, c: 0.11, h: 300 },
    { at: 0.18, l: 0.5, c: 0.16, h: 292 },
    { at: 0.26, l: 0.58, c: 0.13, h: 250 },
    { at: 0.34, l: 0.66, c: 0.1, h: 200 },
    { at: 0.44, l: 0.76, c: 0.14, h: 160 },
    { at: 0.56, l: 0.88, c: 0.1, h: 165 },
    { at: 0.72, l: 0.68, c: 0.1, h: 185 },
    { at: 0.8, l: 0.58, c: 0.1, h: 225 },
    { at: 0.88, l: 0.46, c: 0.11, h: 265 },
  ],
  key: 40,
}

/**
 * Magenta and cyan, at the most chroma each stop's lightness has room for: the
 * body is saturated, and the bright end goes pale because sRGB has no room for
 * anything else there. The path between the two hues runs through blue and
 * violet at a lightness that fits, for the reason aurora's does: the first cut
 * took the return from cyan straight to magenta at a lightness where blue has
 * almost no chroma to give, and the clip drew hard lines in the row at
 * several keys.
 */
const NEON: Palette = {
  id: 'neon',
  name: 'Neon',
  mood: 'Magenta and cyan at full chroma. Hard, bright and clean.',
  stops: [
    { at: 0, l: 0.34, c: 0.14, h: 320 },
    { at: 0.16, l: 0.5, c: 0.22, h: 330 },
    { at: 0.3, l: 0.58, c: 0.22, h: 295 },
    { at: 0.4, l: 0.68, c: 0.13, h: 255 },
    { at: 0.48, l: 0.8, c: 0.1, h: 225 },
    { at: 0.56, l: 0.9, c: 0.1, h: 200 },
    { at: 0.66, l: 0.76, c: 0.09, h: 240 },
    { at: 0.74, l: 0.64, c: 0.13, h: 272 },
    { at: 0.86, l: 0.48, c: 0.2, h: 325 },
  ],
  key: 45,
}

/**
 * Dusty mauve through rose and coral to a cream, all at low chroma. The
 * anchor is lighter than the others' on purpose: a soft palette with a hard
 * dark end stops being soft.
 */
const DUSK: Palette = {
  id: 'dusk',
  name: 'Dusk',
  mood: 'Warm pastel at low chroma: mauve, rose, peach, cream. Soft, for the quiet.',
  stops: [
    { at: 0, l: 0.42, c: 0.05, h: 350 },
    { at: 0.16, l: 0.56, c: 0.08, h: 345 },
    { at: 0.32, l: 0.68, c: 0.09, h: 20 },
    { at: 0.46, l: 0.8, c: 0.09, h: 50 },
    { at: 0.56, l: 0.92, c: 0.068, h: 80 },
    { at: 0.72, l: 0.74, c: 0.08, h: 20 },
    { at: 0.86, l: 0.56, c: 0.07, h: 340 },
  ],
  key: 30,
}

/**
 * One hue, gold, and only the value moves: bronze to a pale gold and back. It
 * is the palette with nothing to say about colour, so the picture is light
 * and shadow, like a print.
 */
const MONO_GOLD: Palette = {
  id: 'mono-gold',
  name: 'Mono gold',
  mood: 'One hue, gold, in every value from bronze to pale. Faded stock, for the quiet end.',
  stops: [
    { at: 0, l: 0.34, c: 0.06, h: 75 },
    { at: 0.16, l: 0.5, c: 0.1, h: 78 },
    { at: 0.32, l: 0.64, c: 0.125, h: 82 },
    { at: 0.46, l: 0.78, c: 0.15, h: 88 },
    { at: 0.56, l: 0.9, c: 0.13, h: 95 },
    { at: 0.72, l: 0.7, c: 0.12, h: 85 },
    { at: 0.86, l: 0.48, c: 0.09, h: 78 },
  ],
  key: 12,
}

/** Every palette, by id. A palette missing from here is a compile error. */
export const PALETTES: Readonly<Record<PaletteId, Palette>> = {
  'classic': CLASSIC,
  'ember': EMBER,
  'abyss': ABYSS,
  'aurora': AURORA,
  'neon': NEON,
  'dusk': DUSK,
  'mono-gold': MONO_GOLD,
}

export const findPalette = (id: PaletteId): Palette => PALETTES[id]
