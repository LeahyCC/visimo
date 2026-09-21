/**
 * OKLCH: a colour as lightness, chroma and hue, in the OKLab space Björn
 * Ottosson published (https://bottosson.github.io/posts/oklab/). Pure maths
 * with no opinion about what colours are wanted; the palettes that use it
 * live in `palettes/`.
 *
 * The reason to work here and not in RGB is that OKLab's lightness tracks
 * what an eye reports, so a straight line between two colours stays a
 * straight line in brightness, and a hue turn changes the colour without
 * changing how bright it is. In sRGB the midpoint of two saturated colours is
 * a duller, darker one, which is the mud this replaces.
 *
 * Hue is in degrees and chroma is in OKLab units (0 is grey, and sRGB reaches
 * about 0.32 at its most saturated blue). Every function here takes and
 * returns fresh values and keeps no state.
 */

export type Oklch = { l: number; c: number; h: number }

/** Three channels from 0 to 1, in whichever encoding the function says. */
export type Rgb = [number, number, number]

/**
 * Under this a colour is grey for the purposes of hue: its angle is noise, so
 * a mix takes the other colour's hue rather than sweeping through a meaningless
 * one.
 */
const ACHROMATIC = 1e-4

/** How far a channel may sit outside 0 to 1 and still count as inside the gamut. */
const GAMUT_SLACK = 1e-6

/** Bisection steps for the chroma clip: the answer is within 2^-24 of the true edge. */
const CLIP_STEPS = 24

/** sRGB's transfer function, both ways, for a channel already inside 0 to 1. */
export const srgbToLinear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

export const linearToSrgb = (value: number) =>
  value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** An angle in degrees folded into 0 (inclusive) to 360 (exclusive). */
export const wrapHue = (degrees: number) => ((degrees % 360) + 360) % 360

/**
 * OKLCH to linear sRGB, unclipped. A colour outside the gamut comes back with
 * a channel below 0 or above 1, which is how `inGamut` tells; nothing here
 * hides it.
 */
export function oklchToLinearSrgb({ l, c, h }: Oklch): Rgb {
  const radians = (h * Math.PI) / 180
  const a = c * Math.cos(radians)
  const b = c * Math.sin(radians)
  // Ottosson's inverse: OKLab to the cube roots of the cone responses, then
  // cubed back to the responses, then the linear sRGB matrix.
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ]
}

/** Linear sRGB to OKLCH. A grey has no hue, and comes back with 0. */
export function linearSrgbToOklch([red, green, blue]: Rgb): Oklch {
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue)
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue)
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue)
  const l = 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short
  const a = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short
  const b = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short
  const c = Math.hypot(a, b)
  return { l, c, h: c < ACHROMATIC ? 0 : wrapHue((Math.atan2(b, a) * 180) / Math.PI) }
}

/** Whether every channel of a linear colour can be shown, give or take rounding. */
export const inGamut = ([red, green, blue]: Rgb) =>
  [red, green, blue].every((value) => value >= -GAMUT_SLACK && value <= 1 + GAMUT_SLACK)

/**
 * The colour with the same lightness and hue and the most chroma sRGB can
 * show, up to the chroma asked for. Reducing chroma and leaving the other two
 * alone is the point: clamping RGB channels instead shifts the hue and the
 * lightness along with the saturation, so a vivid stop would come out a
 * different colour and not merely a duller one.
 *
 * Lightness at or past the ends is white or black whatever the chroma, since
 * no chroma exists there.
 */
export function clipChroma(colour: Oklch): Oklch {
  if (colour.l >= 1) return { l: 1, c: 0, h: colour.h }
  if (colour.l <= 0) return { l: 0, c: 0, h: colour.h }
  if (inGamut(oklchToLinearSrgb(colour))) return { ...colour }
  // Grey at this lightness is always inside, so 0 is a floor the search can trust.
  let low = 0
  let high = colour.c
  for (let step = 0; step < CLIP_STEPS; step++) {
    const middle = (low + high) / 2
    if (inGamut(oklchToLinearSrgb({ ...colour, c: middle }))) low = middle
    else high = middle
  }

  return { l: colour.l, c: low, h: colour.h }
}

/** OKLCH to encoded sRGB, 0 to 1, chroma reduced to fit first. */
export function oklchToSrgb(colour: Oklch): Rgb {
  const [red, green, blue] = oklchToLinearSrgb(clipChroma(colour))
  // The clip leaves a channel a hair outside 0 to 1 at worst; the clamp only
  // removes that, so the transfer function is never handed a negative.
  return [linearToSrgb(clamp01(red)), linearToSrgb(clamp01(green)), linearToSrgb(clamp01(blue))]
}

/** Encoded sRGB, 0 to 1, to OKLCH. */
export const srgbToOklch = ([red, green, blue]: Rgb): Oklch =>
  linearSrgbToOklch([srgbToLinear(red), srgbToLinear(green), srgbToLinear(blue)])

/**
 * The signed angle from one hue to another the short way round, from -180 up
 * to but not including 180. Blue at 350 and red at 10 are 20 apart, not 340.
 * Exactly opposite hues have no short way, and go up.
 */
export function hueGap(from: number, to: number) {
  const gap = ((((to - from) % 360) + 540) % 360) - 180
  return gap === -180 ? 180 : gap
}

/**
 * A hue between two, going the short way round the circle: blue at 350 and red
 * at 10 meet at 0 through a 20 degree gap, not at 180 through 340, which is
 * what a plain average of the two numbers would take.
 */
export const mixHue = (from: number, to: number, at: number) =>
  wrapHue(from + hueGap(from, to) * at)

/**
 * Two colours a fraction of the way between, in OKLCH. At 0 it is `from` and
 * at 1 it is `to` exactly, so a fade that has finished leaves nothing of the
 * other colour behind.
 *
 * The hue goes the short way round unless `gap` says otherwise: the signed
 * angle to travel, which is `hueGap` by default. A caller mixing along a row of
 * pairs passes its own so the route can stay the same from one pair to the
 * next, since the short way flips direction wherever two hues pass half a
 * circle apart.
 *
 * A grey has no hue to move from, so when either end is grey the other's hue
 * is kept and only lightness and chroma move: a fade to grey stays the colour
 * it was, going paler, rather than swinging through whatever angle the grey
 * happened to carry.
 */
export function mixOklch(from: Oklch, to: Oklch, at: number, gap?: number): Oklch {
  if (at <= 0) return { ...from }
  if (at >= 1) return { ...to }
  const fromGrey = from.c < ACHROMATIC
  const toGrey = to.c < ACHROMATIC
  let h = wrapHue(from.h + (gap ?? hueGap(from.h, to.h)) * at)
  if (fromGrey && !toGrey) h = to.h
  else if (toGrey && !fromGrey) h = from.h
  return { l: from.l * (1 - at) + to.l * at, c: from.c * (1 - at) + to.c * at, h }
}
