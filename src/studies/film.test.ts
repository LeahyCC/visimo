/**
 * `film`, the look for the quiet end of a song: heavy grain, a resting vignette
 * and a slight weave, with more of each the quieter it gets, and a build that
 * settles it down. The blanket guards in `registry.test.ts` hold it to the bar
 * every study is held to; this is what it is for, and how it leaves.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { MAX_WEAVE, POST_UNIFORM_FLOATS, writePostUniform } from '../post/params'
import { defaultCanvas } from './cast'
import type { CastCanvas } from './cast'
import { findStudy } from './registry'
import { castFrame, resolveLive, resolveStudy } from './resolve'

const packet = (values: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

const study = (id: string) => {
  const found = findStudy(id)
  if (!found) throw new Error(`Expected ${id} in the registry`)
  return found
}

const knobsAt = (id: string, features: Float32Array, tension: number) =>
  resolveStudy(study(id), undefined, features, tension, 1, {})

/** The stack's own feedback numbers, switched off: a look is what is measured here. */
const STILL: CastCanvas = { ...defaultCanvas(), enabled: false }

/** A quiet passage that is neither lifting nor dropping. */
const QUIET = { energy: 0.05, swell: 0.5, time: 42.5 }

/** A loud one, and a build's tension on top of it where the test asks. */
const LOUD = { energy: 1, swell: 0.5, time: 42.5 }

describe('film', () => {
  const film = study('film')

  it('is a look for the quiet end: intro, rest and outro, soft and slow, and cheap', () => {
    expect(film.kind).toBe('look')
    expect(film.cost).toBe('cheap')
    expect(film.moments).toMatchObject({ intro: 1, rest: 1, outro: 1 })
    expect(film.moments.groove).toBe(0)
    expect(film.moments.build).toBe(0)
    expect(film.moments.drop).toBe(0)
    expect(film.home.drive).toBeLessThan(0.5)
    expect(film.home.hardness).toBeLessThan(0.5)
  })

  it('switches on bloom, tonemap, grain and the grade, and not the split', () => {
    const { post } = resolveLive(
      [{ id: 'film', presence: 1 }],
      STILL,
      packet(QUIET),
      0,
      castFrame(),
    )

    expect(post.bloom.enabled).toBe(true)
    expect(post.tonemap.enabled).toBe(true)
    expect(post.grain.enabled).toBe(true)
    expect(post.grade.enabled).toBe(true)
    expect(post.chromatic.enabled).toBe(false)
  })

  it('has heavier grain than warm-soft, at rest and at its lightest', () => {
    const warmest = Math.max(
      ...[0, 0.5, 1].map(
        (hardness) => knobsAt('warm-soft', packet({ hardness }), 0)['grain.amount'] ?? 0,
      ),
    )

    for (const energy of [0, 0.5, 1])
      expect(knobsAt('film', packet({ energy }), 0)['grain.amount']).toBeGreaterThan(warmest)
  })

  it('puts more film in the quiet: grain and weave both grow as the energy falls', () => {
    let grain = knobsAt('film', packet({ energy: 1 }), 0)['grain.amount'] ?? 0
    let weave = knobsAt('film', packet({ energy: 1 }), 0)['grade.weave'] ?? 0
    for (const energy of [0.75, 0.5, 0.25, 0]) {
      const now = knobsAt('film', packet({ energy }), 0)
      expect(now['grain.amount'], `grain at ${energy}`).toBeGreaterThan(grain)
      expect(now['grade.weave'], `weave at ${energy}`).toBeGreaterThan(weave)
      grain = now['grain.amount'] ?? 0
      weave = now['grade.weave'] ?? 0
    }
  })

  it('draws the frame in as the passage falls away, and opens it as it lifts', () => {
    let last = knobsAt('film', packet({ swell: 1 }), 0)['grade.vignette'] ?? 0
    for (const swell of [0.75, 0.5, 0.25, 0]) {
      const now = knobsAt('film', packet({ swell }), 0)['grade.vignette'] ?? 0
      expect(now, `vignette at swell ${swell}`).toBeGreaterThan(last)
      last = now
    }
  })

  it('rests under 1 in the light and the colour, like stock held back', () => {
    const rest = knobsAt('film', packet(), 0)
    expect(rest['tonemap.exposure']).toBeLessThan(1)
    expect(rest['tonemap.exposure']).toBeGreaterThan(0.9)
    expect(rest['grade.saturation']).toBeLessThan(1)
    expect(rest['bloom.knee']).toBeGreaterThan(knobsAt('warm-soft', packet(), 0)['bloom.knee'] ?? 1)
    expect(rest['bloom.intensity']).toBeLessThan(
      knobsAt('warm-soft', packet(), 0)['bloom.intensity'] ?? 0,
    )
  })

  // The wash-out guard in registry.test.ts holds this for every study at a full
  // packet; stated here as well, since a quiet look that lifted under load
  // would be the one that washed out.
  it('does not wash out: a full packet is no brighter and no more saturated than rest', () => {
    const full = packet()
    for (const name of Object.keys(F) as (keyof typeof F)[]) full[F[name]] = 1
    const rest = knobsAt('film', packet(), 0)
    for (const tension of [0, 1]) {
      const loud = knobsAt('film', full, tension)
      expect(loud['tonemap.exposure'], `exposure at tension ${tension}`).toBeLessThanOrEqual(
        rest['tonemap.exposure'] ?? 0,
      )

      expect(loud['grade.saturation'], `saturation at tension ${tension}`).toBeLessThanOrEqual(
        rest['grade.saturation'] ?? 0,
      )
    }
  })

  describe('under tension', () => {
    const at = (tension: number, values = QUIET) => knobsAt('film', packet(values), tension)

    it('closes the vignette a little, drains the colour a little and thins the glow', () => {
      let last = at(0)
      for (const tension of [0.25, 0.5, 0.75, 1]) {
        const now = at(tension)
        expect(now['grade.vignette'], `vignette at ${tension}`).toBeGreaterThan(
          last['grade.vignette'] ?? 0,
        )

        expect(now['grade.saturation'], `saturation at ${tension}`).toBeLessThan(
          last['grade.saturation'] ?? 0,
        )

        expect(now['bloom.intensity'], `bloom at ${tension}`).toBeLessThan(
          last['bloom.intensity'] ?? 0,
        )

        last = now
      }

      // A little: even at the top of a build the frame is not closed hard.
      expect((at(1)['grade.vignette'] ?? 0) - (at(0)['grade.vignette'] ?? 0)).toBeLessThan(0.2)
    })

    it('stills the weave, and a loud build has none left', () => {
      let last = at(0)['grade.weave'] ?? 0
      for (const tension of [0.25, 0.5, 0.75, 1]) {
        const now = at(tension)['grade.weave'] ?? 0
        expect(now, `weave at ${tension}`).toBeLessThan(last)
        last = now
      }

      expect(at(1, LOUD)['grade.weave'] ?? 1).toBeLessThanOrEqual(0)
    })
  })

  it('never weaves by more than a pixel or two, at any packet or tension', () => {
    // Felt and not seen: past this the drift reads as motion.
    for (const energy of [0, 0.25, 0.5, 1])
      for (const tension of [0, 0.5, 1])
        expect(
          knobsAt('film', packet({ energy }), tension)['grade.weave'] ?? 0,
          `energy ${energy}, tension ${tension}`,
        ).toBeLessThanOrEqual(1.5)
    expect(MAX_WEAVE).toBeGreaterThan(1.5)
  })
})

// Film is the look with the weave, and the shipped looks have none. When one
// fades against another that has no grade, its weave has to thin to nothing on
// its way out, and the crop that comes with it, or the frame would jump by a
// pixel or two when the stage switched off.
describe('film, fading out against a look with no grade', () => {
  const features = packet(QUIET)

  const fade = (presence: number, against = 'clean-glass') =>
    resolveLive(
      [
        { id: 'film', presence },
        { id: against, presence: 1 - presence },
      ],
      STILL,
      features,
      0,
      castFrame(),
    ).post

  const uniform = (presence: number, against?: string) =>
    writePostUniform(
      fade(presence, against),
      features,
      1920,
      1080,
      new Float32Array(POST_UNIFORM_FLOATS),
    )

  const own = fade(1).grade

  it('is the look’s own weave while it is alone', () => {
    expect(own.enabled).toBe(true)
    expect(own.weave).toBeGreaterThan(0)
  })

  it('thins the weave in proportion as the look leaves, to nothing', () => {
    let last = own.weave
    for (const presence of [0.9, 0.5, 0.25, 0.1, 0.01]) {
      const { grade } = fade(presence)
      expect(grade.enabled).toBe(true)
      expect(grade.weave, `at ${presence}`).toBeLessThan(last)
      expect(grade.weave, `at ${presence}`).toBeCloseTo(presence * own.weave, 10)
      last = grade.weave
    }
  })

  it('does not snap when the stage switches off: the step is one percent of the look', () => {
    const nearly = uniform(0.01)
    const gone = uniform(0)
    expect(fade(0).grade.enabled).toBe(false)
    // The crop is what would show a jump, since it is the whole weave at rest.
    expect(Array.from(gone.slice(48, 52))).toEqual([0, 0, 0, 0])
    expect(Math.abs((nearly[50] ?? 0) - (gone[50] ?? 0))).toBeLessThan(
      0.01 * (uniform(1)[50] ?? 0) + 1e-9,
    )

    expect(Math.abs((nearly[51] ?? 0) - (gone[51] ?? 0))).toBeLessThan(
      0.01 * (uniform(1)[51] ?? 0) + 1e-9,
    )
    // And the offset, which is under the crop's own reach at every presence.
    for (const presence of [1, 0.5, 0.1, 0.01]) {
      const out = uniform(presence)
      expect(Math.abs(out[48] ?? 0)).toBeLessThanOrEqual((out[50] ?? 0) / 2 + 1e-9)
      expect(Math.abs(out[49] ?? 0)).toBeLessThanOrEqual((out[51] ?? 0) / 2 + 1e-9)
    }
  })

  it('does the same against a look that has the grain and not the grade', () => {
    // Warm and soft has grain, so the two share that stage and differ on the
    // grade: the weave and the vignette thin, and the grain is a plain blend.
    for (const presence of [0.75, 0.5, 0.25]) {
      const post = fade(presence, 'warm-soft')
      expect(post.grade.weave).toBeCloseTo(presence * own.weave, 10)
      expect(post.grade.vignette).toBeCloseTo(presence * own.vignette, 10)
      expect(post.grade.saturation).toBeCloseTo(presence * own.saturation + (1 - presence), 10)
    }
  })
})
