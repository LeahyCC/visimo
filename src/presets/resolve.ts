/**
 * The two pieces every mapping row is made of: what a field reads out of the
 * packet, and how a curve bends it before the gain multiplies it.
 *
 *   value = resting + Σ gain × curve(feature[from])
 *
 * The sum itself is `studies/resolve.ts`, which is the only place a mapping
 * is applied. These are here because they are the vocabulary's own, beside
 * the fields and the curves in `knobs.ts`, and because nothing about them is
 * a study's business: `resolveScene` and `resolvePost` were the preset path
 * and went with it.
 */
import { F } from '../audio/FeatureExtractor'
import type { AudioField, Curve } from './knobs'

/** What a mapping's `from` reads. `lowEnd` is the louder of sub and bass. */
export function feature(features: Float32Array, field: AudioField): number {
  if (field === 'lowEnd') return Math.max(features[F.sub] ?? 0, features[F.bass] ?? 0)
  return features[F[field]] ?? 0
}

/** How the feature is bent before the gain. Negative input never survives. */
export function bend(value: number, curve: Curve): number {
  const level = Math.max(0, value)
  if (curve === 'square') return level * level
  if (curve === 'sqrt') return Math.sqrt(level)
  if (curve === 'invert') return 1 - Math.min(1, level)
  return level
}
