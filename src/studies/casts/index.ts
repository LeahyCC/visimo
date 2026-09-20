/**
 * The five shipped presets written as pinned casts, parsed at load. They are
 * JSON for the reason the presets are: a cast is numbers a person tunes, and
 * a file of numbers and nothing else is easier to read next to the preset it
 * came from. The studies beside them are TypeScript instead, because a study
 * is vocabulary and the compiler can hold its knobs to its implementation.
 *
 * Each of these resolves to exactly the numbers its preset does, which
 * `cast.test.ts` checks at a silent packet, a full one and three mixed ones.
 * Three things are deliberately not the same:
 *
 * - Melt's flow moves. Today its `flowParams` sit still, because nothing in a
 *   preset's mapping reaches the flow; as a study it carries Turbulent
 *   fluid's own rows, so the fluid under the fractal now answers the music.
 *   That is the rule the handoff sets for every study and the reason a study
 *   owns its mapping. Its resting numbers are Melt's to the digit. Turbulent
 *   rather than lazy because Melt's flow rests at a thin viscosity, 0.12
 *   against Plume's 0.2, and the lazy fluid gives the treble 0.18 of it,
 *   which from 0.12 is a negative viscosity and no solve at all.
 * - Melt has a brightness threshold, which changes how it looks on a drop.
 *   That is the point: the fractal is a full-frame ink and Melt's canvas keeps
 *   94 percent of itself, so a drop filled edge to edge with no black in it.
 *   The ink now has a `glint` knob, Melt's cast names 0.38 of it, and the dim
 *   body of the fractal is dropped before the canvas ever sums it. Prism goes
 *   the other way and takes the threshold back off, because its canvas is
 *   switched off and there was never anything to wash out. Neither number is
 *   in `preset-frames.json`, which records what 0.1 drew; both are pinned by a
 *   test of their own.
 * - Every study carries a `tension` row, and the renderer reads tension from
 *   the packet for a pinned cast as for any other. With nothing winding up,
 *   which is most of a track, tension is 0 and these are the presets exactly;
 *   through a build they now wind up with it, which no preset ever did.
 *
 * These five are what the stage draws and what a host picks between, so the
 * names the preset list had are kept beside the cast ones: a host written
 * against 0.1 changes the type it names and nothing else.
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

/** The fluid as PR #58 tuned it, which is what the stage shows by default. */
export const DEFAULT_CAST_ID = 'plume'

export const findCast = (id: string): PinnedCast | undefined => CASTS.find((cast) => cast.id === id)

/** The cast named, or the default; a stored choice goes through here. */
export function castOrDefault(id: string): PinnedCast {
  const found = findCast(id) ?? findCast(DEFAULT_CAST_ID) ?? CASTS[0]
  if (!found) throw new Error('casts: none were loaded')
  return found
}

/** Where `[` and `]` land from here. Wraps both ways. */
export function stepCast(id: string, delta: number): PinnedCast {
  const at = CASTS.findIndex((entry) => entry.id === id)
  const from = at < 0 ? 0 : at
  const next = (((from + delta) % CASTS.length) + CASTS.length) % CASTS.length
  return CASTS[next] ?? castOrDefault(DEFAULT_CAST_ID)
}
