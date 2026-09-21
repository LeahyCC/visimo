/**
 * The arithmetic of the wide bloom, kept off the GPU so it can be checked.
 *
 * The chain is a bright pass into level 0 at half the canvas, a downsample
 * from each level into the next, and then a tent upsample back up that adds
 * every level into the one above it. The composite reads the level 0 that is
 * left. Two numbers decide how the light is shared between the levels: how
 * many there are, which follows the canvas, and what each one is worth, which
 * follows `bloom.radius`.
 */
import { BLOOM_LEVELS } from './params'
import type { BloomParams } from './params'

/** Fewest levels the chain runs, so even a small canvas has a wide halo. */
export const BLOOM_MIN_LEVELS = 6
/** Most levels: an 8K canvas is already down to about 17 pixels at the 8th. */
export const BLOOM_MAX_LEVELS = 8

/**
 * The tallest the smallest level may be. Below about 16 pixels a level is a
 * few texels across and adds nothing the one above it did not; above 32 there
 * is still a wider glow left to add. The count is the fewest that get there.
 */
const BLOOM_SMALLEST = 32

/**
 * How much of the light the widest setting sends to the wide levels. Under 1
 * on purpose: at a radius of 1 the tight glow still has 40 percent of it, so
 * a mark keeps a bright edge inside its halo instead of becoming a smear.
 */
export const BLOOM_WIDE_SHARE = 0.6

/**
 * What each wide level gets against the one before it. Each level is twice as
 * wide as the last, so an equal share would put the most light in the levels
 * that lift the whole frame; a falloff under 1 keeps the halo weighted toward
 * the middle of its own reach.
 */
const BLOOM_WIDE_FALLOFF = 0.8

/**
 * A level worth less than this of the whole is not run. The light it would
 * have carried is under a fifth of a percent, and at a radius of 0 it is what
 * lets the chain stop at the three tight levels, so a cast that never asks for
 * a wide glow pays for none.
 */
const BLOOM_NEGLIGIBLE = 1 / 512

/** A number held to 0 to 1, and to 0 if it is not a number at all. */
const unit = (value: number) => (Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0)

/**
 * How many levels the chain runs for a canvas: enough that the smallest is
 * about 16 to 32 pixels tall, and always between 6 and 8. It follows the
 * shorter side, so a tall canvas gets the same glow as a wide one of the
 * same height.
 */
export function bloomLevelCount(width: number, height: number): number {
  const short = Math.min(width, height)
  if (!Number.isFinite(short) || short < 1) return BLOOM_MIN_LEVELS
  const wanted = Math.ceil(Math.log2(short / BLOOM_SMALLEST))
  return Math.min(Math.max(wanted, BLOOM_MIN_LEVELS), BLOOM_MAX_LEVELS)
}

/**
 * What each level is worth, into `out` and to the `out.length` levels it
 * holds. They sum to 1 whenever the tight weights name any light at all, so the
 * radius moves light between levels and never adds any: a frame that is bright
 * all over glows exactly as much at every radius, and only a mark that stands
 * out from its surroundings changes, its light going from a bright edge to a
 * wide faint halo.
 *
 * The first three are `bloom.weights`, the tight glow the stage always had,
 * scaled to leave room; the rest share what the radius takes from them. At a
 * radius of 0 the wide levels are exactly 0 and the tight ones are the
 * weights as they were.
 */
export function bloomWeights(bloom: BloomParams, out: Float32Array): Float32Array {
  out.fill(0)
  const wide = out.length - BLOOM_LEVELS
  const share = wide > 0 ? BLOOM_WIDE_SHARE * unit(bloom.radius) : 0

  const held = (level: number) => {
    const weight = bloom.weights[level] ?? 0
    return Number.isFinite(weight) ? Math.max(weight, 0) : 0
  }

  let tight = 0
  for (let level = 0; level < Math.min(BLOOM_LEVELS, out.length); level++) tight += held(level)
  if (tight > 0)
    for (let level = 0; level < Math.min(BLOOM_LEVELS, out.length); level++)
      out[level] = ((1 - share) * held(level)) / tight

  let total = 0
  for (let level = 0; level < wide; level++) total += BLOOM_WIDE_FALLOFF ** level
  for (let level = 0; level < wide; level++)
    out[BLOOM_LEVELS + level] = (share * BLOOM_WIDE_FALLOFF ** level) / total
  return out
}

/**
 * How many levels of the chain have anything to add: one past the last that
 * is worth running. The rest are neither downsampled nor upsampled. 0 means
 * the glow is nothing at all.
 */
export function bloomActiveLevels(weights: Float32Array): number {
  for (let level = weights.length - 1; level >= 0; level--)
    if ((weights[level] ?? 0) > BLOOM_NEGLIGIBLE) return level + 1
  return 0
}
