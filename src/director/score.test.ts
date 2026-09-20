import { describe, expect, it } from 'vitest'

import { MOMENTS } from '../studies/types'
import type { Character, InkStudy, Moments } from '../studies/types'
import type { MomentWeights } from './moment'
import { characterDistance, closeness, falloff, momentFit, place, scoreStudy } from './score'
import { HARDSTYLE, HOUSE, LOFI } from './song.fixture'

const NOTHING: MomentWeights = { intro: 0, groove: 0, build: 0, drop: 0, rest: 0, outro: 0 }

const weights = (values: Partial<MomentWeights>): MomentWeights => ({ ...NOTHING, ...values })

const moments = (values: Partial<Moments>): Moments => ({ ...NOTHING, ...values })

/** Every moment at 1, so a comparison between two of these is about character alone. */
const ANY_MOMENT = moments({ intro: 1, groove: 1, build: 1, drop: 1, rest: 1, outro: 1 })

const ink = (id: string, home: Character, reach: number, fit: Moments): InkStudy => ({
  id,
  kind: 'ink',
  name: id,
  impl: 'dye',
  home,
  reach,
  moments: fit,
  knobs: {},
  mapping: [],
  cost: 'cheap',
})

const DUST = ink(
  'dust',
  { drive: 0.15, weight: 0.55, tonality: 0.6, steadiness: 0.4, hardness: 0.1 },
  0.5,
  ANY_MOMENT,
)

const SHARDS = ink(
  'shards',
  { drive: 0.85, weight: 0.45, tonality: 0.35, steadiness: 0.85, hardness: 0.95 },
  0.45,
  ANY_MOMENT,
)

const RISER = ink(
  'riser-streaks',
  { drive: 0.9, weight: 0.2, tonality: 0.1, steadiness: 0.9, hardness: 0.9 },
  0.3,
  moments({ build: 1 }),
)

const SPECTRUM = ink(
  'spectrum-ring',
  { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  1,
  moments({ groove: 1 }),
)

/** A groove study sitting exactly where a lo-fi track sits, so the character half of the score is as strong as it can be. */
const HOMELY = ink('homely', LOFI, 1, moments({ groove: 1 }))

describe('falloff', () => {
  it('is whole at home and a third of the way out at the reach', () => {
    expect(falloff(0, 0.5)).toBe(1)
    expect(falloff(0.5, 0.5)).toBeCloseTo(1 / Math.E)
    expect(falloff(1, 0.5)).toBeLessThan(falloff(0.5, 0.5))
  })

  it('welcomes nothing but home when the reach is nothing', () => {
    expect(falloff(0, 0)).toBe(1)
    expect(falloff(0.01, 0)).toBe(0)
  })
})

describe('characterDistance', () => {
  const corner = (value: number): Character => ({
    drive: value,
    weight: value,
    tonality: value,
    steadiness: value,
    hardness: value,
  })

  it('is nothing between a character and itself', () => {
    expect(characterDistance(LOFI, LOFI)).toBe(0)
  })

  it('is 1 between opposite corners of the space', () => {
    expect(characterDistance(corner(0), corner(1))).toBeCloseTo(1)
  })

  // The root mean square is what keeps one axis out of five from reading as
  // far away, which a sum of the five would.
  it('counts one axis apart as less than all five', () => {
    const one: Character = { ...corner(0), hardness: 1 }
    expect(characterDistance(corner(0), one)).toBeLessThan(0.5)
  })
})

describe('closeness', () => {
  it('is highest on a study’s own home ground', () => {
    expect(closeness(DUST, DUST.home)).toBe(1)
    expect(closeness(DUST, SHARDS.home)).toBeLessThan(0.5)
  })

  it('widens with the reach', () => {
    const near = ink('near', DUST.home, 0.3, ANY_MOMENT)
    const wide = ink('wide', DUST.home, 1, ANY_MOMENT)
    expect(closeness(wide, HARDSTYLE)).toBeGreaterThan(closeness(near, HARDSTYLE))
  })
})

describe('momentFit', () => {
  it('is the study’s fits against the weights of the moment', () => {
    expect(
      momentFit(moments({ build: 1, drop: 0.5 }), weights({ build: 0.6, drop: 0.4 })),
    ).toBeCloseTo(0.8)
  })

  it('is nothing for a study written for none of what is happening', () => {
    expect(momentFit(moments({ drop: 1 }), weights({ rest: 1 }))).toBe(0)
  })
})

describe('scoreStudy', () => {
  it('is the closeness times the fit', () => {
    const at = weights({ groove: 1 })
    expect(scoreStudy(SPECTRUM, LOFI, at)).toBeCloseTo(
      closeness(SPECTRUM, LOFI) * momentFit(SPECTRUM.moments, at),
    )
  })

  // The first half minute: the character is a guess, so the widest welcome
  // stands in for it and the reading takes over as it settles.
  it('reads the reach in place of the character until the character has settled', () => {
    expect(place(SHARDS, LOFI, 0)).toBeCloseTo(SHARDS.reach)
    expect(place(SHARDS, LOFI, 1)).toBeCloseTo(closeness(SHARDS, LOFI))
    const half = place(SHARDS, LOFI, 0.5)
    expect(half).toBeGreaterThan(place(SHARDS, LOFI, 1))
    expect(half).toBeLessThan(place(SHARDS, LOFI, 0))
  })
})

// The rules the catalogue is written to: a lo-fi track never gets the shards
// and a hardstyle track never gets the dust, whatever is happening in either.
describe('the character decides the family', () => {
  it('never ranks shards above dust for a lo-fi track', () => {
    for (const moment of MOMENTS) {
      const at = weights({ [moment]: 1 })
      expect(scoreStudy(SHARDS, LOFI, at)).toBeLessThan(scoreStudy(DUST, LOFI, at))
    }
  })

  it('never ranks dust above shards for a hardstyle track', () => {
    for (const moment of MOMENTS) {
      const at = weights({ [moment]: 1 })
      expect(scoreStudy(DUST, HARDSTYLE, at)).toBeLessThan(scoreStudy(SHARDS, HARDSTYLE, at))
    }
  })
})

// And the moment decides which of the family is on now, which has to hold
// even where the character would have said otherwise.
describe('the moment decides which of the family', () => {
  it('ranks a build study first through a build, whatever the track is', () => {
    const at = weights({ build: 1 })
    for (const character of [LOFI, HOUSE, HARDSTYLE]) {
      expect(scoreStudy(RISER, character, at)).toBeGreaterThan(scoreStudy(SPECTRUM, character, at))
      // Even against a groove study sitting exactly where the track sits.
      expect(scoreStudy(RISER, character, at)).toBeGreaterThan(scoreStudy(HOMELY, character, at))
    }
  })

  it('drops the same build study to nothing once the build is over', () => {
    const at = weights({ groove: 1 })
    for (const character of [LOFI, HOUSE, HARDSTYLE])
      expect(scoreStudy(RISER, character, at)).toBe(0)
  })
})
