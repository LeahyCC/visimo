/**
 * How well a study suits the song right now:
 *
 *   score = closeness to home x moment fit
 *
 * The two halves answer the two separate questions in
 * `docs/studies-handoff.md`. Closeness is "what kind of song is this", and it
 * decides the family: a lo-fi track never reaches the shards because the
 * shards live in a corner it never visits. Moment fit is "where in the song
 * are we", and it decides which of the family is on now: a build gets the
 * riser and the drop gets the burst. A product rather than a sum, because
 * either one being zero has to mean no.
 *
 * Every function here is pure and reads a `Study` and nothing else, so a
 * study added to the registry tomorrow needs no change in this file.
 */
import { CHARACTER_AXES, MOMENTS } from '../studies/types'
import type { Character, Moments, Study } from '../studies/types'
import type { MomentWeights } from './moment'

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

/**
 * A bell that is 1 at no distance and 1/e at the reach. Generic: it says
 * nothing about what is being measured, only how fast welcome runs out.
 */
export const falloff = (distance: number, reach: number): number => {
  if (reach <= 0) return distance <= 0 ? 1 : 0
  const scaled = distance / reach
  return Math.exp(-(scaled * scaled))
}

/**
 * How far apart two characters are, as the root mean square of the five axes
 * rather than their sum. A study that disagrees on one axis and matches on
 * four is near, which a sum would not say; and the answer stays in 0 to 1,
 * so one reach means the same width whatever a study is.
 */
export const characterDistance = (a: Character, b: Character): number => {
  let sum = 0
  for (const axis of CHARACTER_AXES) {
    const gap = a[axis] - b[axis]
    sum += gap * gap
  }

  return Math.sqrt(sum / CHARACTER_AXES.length)
}

/** How much this song's character is this study's home ground. */
export const closeness = (study: Study, character: Character): number =>
  falloff(characterDistance(study.home, character), study.reach)

/** The study's fit for each moment against the weights of this one. */
export const momentFit = (moments: Moments, weights: MomentWeights): number => {
  let sum = 0
  for (const moment of MOMENTS) sum += moments[moment] * weights[moment]
  return sum
}

/**
 * Half of the score: how much this study belongs to this track at all.
 *
 * `settled` is how far the character is to be believed, from
 * `CharacterReader`. At 1 this is the closeness; at 0 it is the study's reach
 * instead, so a track that has not been heard yet picks the studies whose
 * welcome is widest and drifts into its own as the reading settles.
 */
export const place = (study: Study, character: Character, settled = 1): number => {
  const held = clamp01(settled)
  return held * closeness(study, character) + (1 - held) * clamp01(study.reach)
}

/**
 * The whole score. The moment is not faded by `settled` the way the character
 * is, because the moment is about the last few seconds and is worth believing
 * from the first one.
 */
export const scoreStudy = (
  study: Study,
  character: Character,
  weights: MomentWeights,
  settled = 1,
): number => place(study, character, settled) * momentFit(study.moments, weights)
