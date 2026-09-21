import { describe, expect, it } from 'vitest'

import { STUDIES } from '../studies/registry'
import { MOMENTS } from '../studies/types'
import { pickCast } from './director'
import type { MomentWeights } from './moment'
import { TRACKS } from './tracks.fixture'

/**
 * Whether the library shares the screen. The director scores a study by where
 * it sits and how it suits the moment, and a study that sits nearly everywhere
 * and suits most moments is in nearly every cast: that was the Ribbon, and
 * nothing else in the suite could see it, since each other test asks whether a
 * cast is right and not how often one study is in it.
 *
 * Every cast the twenty measured tracks can be given: each of the six moments
 * as pure weights, read once as a track that is known (`settled` 1) and once
 * as the opening guess (`settled` 0). That is 240 casts. It is a count of the
 * library and not of a listening session, so a share here is a comparison
 * between studies and not a claim about how long any of them is on screen.
 */

type Share = { all: number; known: number; opening: number }

const pureWeights = (moment: (typeof MOMENTS)[number]): MomentWeights => ({
  intro: 0,
  groove: 0,
  build: 0,
  drop: 0,
  rest: 0,
  outro: 0,
  [moment]: 1,
})

/** Percent of casts each study is in, over all of them and over each half. */
const shares = (): Map<string, Share> => {
  const counts = new Map<string, { all: number; known: number; opening: number }>(
    STUDIES.map((study) => [study.id, { all: 0, known: 0, opening: 0 }]),
  )
  let known = 0
  let opening = 0
  for (const { character } of TRACKS)
    for (const moment of MOMENTS)
      for (const settled of [1, 0]) {
        const cast = pickCast({ character, weights: pureWeights(moment), settled })
        if (!cast) continue
        if (settled === 1) known += 1
        else opening += 1
        const ids = cast.flow ? [cast.flow, ...cast.inks, cast.look] : [...cast.inks, cast.look]
        for (const id of ids) {
          const count = counts.get(id)
          if (!count) continue
          count.all += 1
          if (settled === 1) count.known += 1
          else count.opening += 1
        }
      }

  const percent = (count: number, of: number) => (of === 0 ? 0 : (100 * count) / of)
  return new Map(
    [...counts].map(([id, count]) => [
      id,
      {
        all: percent(count.all, known + opening),
        known: percent(count.known, known),
        opening: percent(count.opening, opening),
      },
    ]),
  )
}

/** The table a failing assertion prints, so the next person sees who took the screen. */
const tableOf = (found: ReadonlyMap<string, Share>): string =>
  [
    'study            kind    all %  known %  opening %',
    ...STUDIES.map((study) => {
      const share = found.get(study.id)
      const cell = (value: number | undefined) => (value ?? 0).toFixed(1).padStart(7)
      return `${study.id.padEnd(16)} ${study.kind.padEnd(6)} ${cell(share?.all)} ${cell(share?.known)} ${cell(share?.opening)}`
    }),
  ].join('\n')

describe('how the library shares the screen over twenty real tracks', () => {
  const found = shares()
  const inks = STUDIES.filter((study) => study.kind === 'ink')

  it('casts the Ribbon in at most 35 percent of casts', () => {
    expect(found.get('ribbon')?.all ?? 0, tableOf(found)).toBeLessThanOrEqual(35)
  })

  // Dust and caustics sit at about 40 and are expected to for now: they are the
  // quiet end's inks, three of the six moments are quiet, and the quiet end of
  // the library is thin. The soft studies still to come are what brings them
  // down, and the bar is set above them until then and not at them.
  it('leaves no ink in more than 45 percent of casts', () => {
    const crowded = inks
      .filter((study) => (found.get(study.id)?.all ?? 0) > 45)
      .map((study) => study.id)
    expect(crowded, tableOf(found)).toEqual([])
  })

  // Only inks are asked here. The flows and the looks are held to a seat by
  // `director.test.ts`, and the one study the README documents as never cast
  // on a real track, `radial-burst`, is a flow (see "Measured" there): a flow
  // whose only moment is the drop cannot outscore one that also suits the
  // groove while the two are complements. It is not fixed here. An ink that
  // ever joins it in the README's list is left out of this one with a comment
  // pointing there, and not by loosening the rule.
  it('casts every ink at least once for a track that is known', () => {
    const unseen = inks
      .filter((study) => (found.get(study.id)?.known ?? 0) === 0)
      .map((study) => study.id)
    expect(unseen, tableOf(found)).toEqual([])
  })
})
