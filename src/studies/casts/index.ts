/**
 * The five shipped presets written as pinned casts, parsed at load. They are
 * JSON for the reason the presets are: a cast is numbers a person tunes, and
 * a file of numbers and nothing else is easier to read next to the preset it
 * came from. The studies beside them are TypeScript instead, because a study
 * is vocabulary and the compiler can hold its knobs to its implementation.
 *
 * Each of these resolves to exactly the numbers its preset does, which
 * `cast.test.ts` checks at a silent packet, a full one and three mixed ones.
 * Two things are deliberately not the same:
 *
 * - Melt's flow moves. Today its `flowParams` sit still, because nothing in a
 *   preset's mapping reaches the flow; as a study it carries Turbulent
 *   fluid's own rows, so the fluid under the fractal now answers the music.
 *   That is the rule the handoff sets for every study and the reason a study
 *   owns its mapping. Its resting numbers are Melt's to the digit. Turbulent
 *   rather than lazy because Melt's flow rests at a thin viscosity, 0.12
 *   against Plume's 0.2, and the lazy fluid gives the treble 0.18 of it,
 *   which from 0.12 is a negative viscosity and no solve at all.
 * - Every study carries a `tension` row, and tension is zero everywhere until
 *   the estimator card lands. At zero these are the presets exactly.
 *
 * Nothing draws a cast yet, so neither difference is on screen.
 */
import { parseCast } from '../cast'
import type { PinnedCast } from '../cast'
import drift from './drift.json'
import melt from './melt.json'
import plume from './plume.json'
import prism from './prism.json'
import wash from './wash.json'

/** The order the presets are listed in, so the two lists read side by side. */
export const CASTS: readonly PinnedCast[] = [
  parseCast(plume, 'studies/casts/plume.json'),
  parseCast(wash, 'studies/casts/wash.json'),
  parseCast(drift, 'studies/casts/drift.json'),
  parseCast(prism, 'studies/casts/prism.json'),
  parseCast(melt, 'studies/casts/melt.json'),
]

export const findCast = (id: string): PinnedCast | undefined => CASTS.find((cast) => cast.id === id)
