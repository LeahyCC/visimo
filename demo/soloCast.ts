/**
 * A one-off cast built around one study, so the demo's picker can put any
 * study the director may choose on screen by hand. The pinned casts are a
 * handful; the registry has two dozen studies and Auto can reach every one.
 *
 * The rest of the cast is picked from the registry rather than named by a
 * list of casts: a study leads with the partners it is usually seen with, and
 * if those break a `requires` or an `excludes`, the next study of that kind in
 * registry order takes its place. So a study added to the registry gets a
 * solo with no change here, provided some partner fits it.
 */
import { findStudy, parseCast, studiesOfKind } from '../src/presets'
import type { PinnedCast, Study, StudyKind } from '../src/presets'
import { canvasBuffers, carriedCanvas, patchCanvas } from '../src/studies/cast'

export const SOLO_PREFIX = 'solo:'

/**
 * Which studies lead when one kind is the one on show. A flow needs something
 * to move, so an ink that reads the fluid if it can and the ribbon if not; an
 * ink needs something to carry it; a look needs both, and the fluid dye is
 * what shows a look off best.
 */
const PARTNERS: Record<StudyKind, Partial<Record<StudyKind, readonly string[]>>> = {
  flow: { ink: ['dye-plumes', 'ribbon'], look: ['clean-glass'] },
  ink: { flow: ['curl-drift'], look: ['clean-glass'] },
  look: { flow: ['lazy-fluid'], ink: ['dye-plumes'] },
}

/** The same rules `parseCast` holds a cast to, asked of a candidate set. */
const fits = (held: readonly Study[]): boolean =>
  held.every(
    (study) =>
      !(study.excludes ?? []).some((other) => held.some((entry) => entry.id === other)) &&
      (study.requires ?? []).every((impl) => held.some((entry) => entry.impl === impl)),
  )

/** The candidates for one slot: the study itself if it is the one on show, else the partners first. */
const options = (slot: StudyKind, study: Study): readonly Study[] => {
  if (study.kind === slot) return [study]
  const led = PARTNERS[study.kind][slot] ?? []
  const all = studiesOfKind(slot)
  const first = led.flatMap((id) => all.filter((entry) => entry.id === id))
  return [...first, ...all.filter((entry) => !led.includes(entry.id))]
}

// A solo has no file to read a canvas from, so it draws on the one the
// director gives a cast it chooses. Otherwise a flow would move nothing.
//
// A flow that patches the canvas has that patch merged in at presence 1, the
// way the director would merge it were it choosing. A solo is a pinned cast
// and a pinned cast's own canvas wins, so without this the one study whose
// whole point is what it does to the canvas would be soloed without it.
const build = (study: Study): PinnedCast => {
  for (const flow of options('flow', study))
    for (const ink of options('ink', study))
      for (const look of options('look', study))
        if (fits([flow, ink, look]))
          return parseCast(
            {
              id: `${SOLO_PREFIX}${study.id}`,
              name: study.name,
              flow: flow.id,
              inks: [ink.id],
              look: look.id,
              canvas: patchCanvas(
                carriedCanvas(),
                flow.kind === 'flow' ? flow.canvas : undefined,
                1,
                canvasBuffers(),
              ),
              overrides: {},
            },
            'demo/soloCast.ts',
          )

  throw new Error(`solo: no flow, ink and look fit around ${study.id}`)
}

// Kept so a solo is the same object each time it is asked for. The panel
// tells an edited cast from a fresh one by identity, and reset relies on it.
const built = new Map<string, PinnedCast>()

export function soloCast(study: Study): PinnedCast {
  const held = built.get(study.id)
  if (held) return held
  const cast = build(study)
  built.set(study.id, cast)
  return cast
}

/** The solo a `solo:<study id>` names, for a value read back from the picker. */
export function findSolo(id: string): PinnedCast | undefined {
  if (!id.startsWith(SOLO_PREFIX)) return undefined
  const study = findStudy(id.slice(SOLO_PREFIX.length))
  return study ? soloCast(study) : undefined
}
