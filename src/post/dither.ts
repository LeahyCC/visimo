/**
 * The composite's dither, stated so it can be tested; post.composite.wgsl is
 * this maths. A wide soft glow is a slow ramp, and on an 8-bit canvas a slow
 * ramp steps: each band is one code value wide and reads as a contour. Noise
 * a code value across, added before the canvas rounds, trades the steps for a
 * grain too fine to see. This is not the grain knob: it is always on, always
 * the same size and never louder than one code value.
 */

/** The canvas is 8 bits a channel, so one step of it is a 255th. */
export const DITHER_STEP = 1 / 255

/**
 * Interleaved gradient noise (Jimenez, 2014): a value in [0, 1) for a pixel,
 * from a fixed dot product and two fract calls. Neighbouring pixels differ
 * by a set amount rather than at random, which puts its energy at high
 * frequencies where the eye is least sensitive: it reads as finer than a
 * hash of the same amplitude, and it has no texture to load.
 */
export function interleavedGradient(x: number, y: number): number {
  const inner = (x * 0.06711056 + y * 0.00583715) % 1
  return (52.9829189 * inner) % 1
}

/** The golden ratio's fraction, so a shift of it lands far from the last. */
const GOLDEN = 0.6180339887

/**
 * What the composite adds to a channel at this pixel, in output units. The
 * clock moves the pattern each frame, by a golden-ratio step per sixtieth of
 * a second, so a still picture is dithered differently every time and the
 * eye averages the error out over frames as well as over pixels.
 *
 * It is held to half a code value either way and never above. That is the
 * amount at which a black pixel stays black: a value under half a step rounds
 * back to 0, and the same amount below it is clipped by the canvas's floor.
 * Triangular noise a step either side would decorrelate a little better and
 * would light up an empty frame.
 */
export function ditherOffset(x: number, y: number, seconds: number): number {
  const noise = (interleavedGradient(x, y) + GOLDEN * seconds * 60) % 1
  return (noise - 0.5) * DITHER_STEP
}
