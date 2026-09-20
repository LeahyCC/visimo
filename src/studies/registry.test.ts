/**
 * Every study, walked, in the spirit of `presets/postMapping.test.ts`. Nothing
 * here names a study except through the allow list, so a study added later is
 * held to the same rules without anyone remembering to add it:
 *
 * - nothing it enables sits still, unless the allow list says why,
 * - every flow and every ink says what tension does to it,
 * - no knob leaves the safe range for its implementation, at silence or at a
 *   full packet, with tension at either end,
 * - a full packet leaves the light and the colour at or under rest,
 * - its id, its excludes and its requires all name something real.
 *
 * The casts are walked too, because a cast adds rows of its own and the
 * preset guard next door cannot see them at a tension the presets never had.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { ANALYTIC_RANGES } from '../impls/analytic.params'
import { SHARD_RANGES } from '../impls/shards.params'
import { STREAK_RANGES } from '../impls/streaks.params'
import { MAX_WEAVE, POST_KNOBS, POST_LANES } from '../post/params'
import type { PostKnob } from '../post/params'
import { AUDIO_FIELDS } from '../presets/knobs'
import type { AnalyticKnob, KaleidoscopeKnob, ShardKnob } from '../presets/knobs'
import { KALEIDOSCOPE_RANGES } from '../scenes/kaleidoscope.params'
import { CASTS } from './casts/index'
import { IMPL_IDS, implKnobs, isImplId, isImplKnob } from './impls'
import type { ImplId, StreaksKnob } from './impls'
import { findStudy, STUDIES } from './registry'
import { castFrame, resolveCast, resolveStudy } from './resolve'
import { STUDY_FIELDS, STUDY_KINDS } from './types'
import type { Study } from './types'

const packetAt = (level: number, swell: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') out[F[field]] = level
  out[F.swell] = swell
  return out
}

/** Silence and a full packet, each swept over swell, each at both ends of tension. */
const CASES = [0, 1].flatMap((level) =>
  [0, 0.5, 1].flatMap((swell) =>
    [0, 1].map((tension) => ({
      label: `level ${level}, swell ${swell}, tension ${tension}`,
      packet: packetAt(level, swell),
      tension,
    })),
  ),
)

const FULL = { packet: packetAt(1, 1), tension: 1 }

/**
 * What every post lane may reach, inclusive. It mirrors the table in the
 * preset guard, for the same reasons: the feedback gain must stay clear of 1,
 * a bloom threshold near 0 blooms the whole frame, and the exposure sits in a
 * band either side of 1.
 */
const SAFE_POST: Record<PostKnob, readonly [number, number]> = {
  'ribbon.intensity': [0, 1.5],
  'ribbon.width': [0, 12],
  'ribbon.height': [0, 0.5],
  'ribbon.shape': [0, 1],
  'feedback.amount': [0, 1],
  'feedback.decay': [0, 0.98],
  'feedback.zoom': [0.98, 1.05],
  'feedback.rotate': [-0.02, 0.02],
  'feedback.carry': [0, 2],
  'feedback.floor': [0, 0.1],
  'feedback.ceiling': [0.5, 64],
  'bloom.threshold': [0.4, 2],
  'bloom.knee': [0, 1],
  'bloom.intensity': [0, 1],
  'chromatic.amount': [0, 0.01],
  'chromatic.beat': [0, 0.02],
  // Wider than what the grade takes, on purpose: a row may carry a lane past
  // its end, which is how impact undoes what tension did, and the uniform
  // holds the number to 0 to 1. Wide enough for that, tight enough to catch a
  // row that runs away.
  'grade.vignette': [-1, 1],
  'grade.saturation': [0, 2],
  // Below 0 for the same reason as the vignette: a tension row that stills the
  // weave may carry it past nothing, and the uniform holds it to 0 to MAX_WEAVE.
  'grade.weave': [-2, MAX_WEAVE],
  'tonemap.exposure': [0.6, 1.5],
  'tonemap.shoulder': [0, 0.98],
  'grain.amount': [0, 0.08],
}

const isPostSafe = (knob: string): knob is PostKnob =>
  Object.prototype.hasOwnProperty.call(SAFE_POST, knob)

const isKaleidoscopeKnob = (knob: string): knob is KaleidoscopeKnob =>
  Object.prototype.hasOwnProperty.call(KALEIDOSCOPE_RANGES, knob)

const isAnalyticKnob = (knob: string): knob is AnalyticKnob =>
  Object.prototype.hasOwnProperty.call(ANALYTIC_RANGES, knob)
const isStreaksKnob = (knob: string): knob is StreaksKnob =>
  Object.prototype.hasOwnProperty.call(STREAK_RANGES, knob)
const isShardKnob = (knob: string): knob is ShardKnob =>
  Object.prototype.hasOwnProperty.call(SHARD_RANGES, knob)

/** The fluid's rates and sizes may run backwards; every other one is a size or a level. */
const SIGNED = new Set(['colourDrift'])

/**
 * The safe range for one knob of one implementation. The fractal's, the
 * analytic flow's and the shards' are their own files' tables; the post ones
 * are the table above; the fluid has no table, so the rule is the preset
 * guard's, that nothing but a signed knob may go negative.
 *
 * The analytic flow needs a table of its own rather than the fluid's rule,
 * because a pull and a push are one term at two signs: its `radial` is
 * meant to go negative and the ceiling on it is what matters, since a
 * velocity of a field width a second already carries the whole picture off
 * the edge in about one.
 */
function safeRange(impl: ImplId, knob: string): readonly [number, number] | undefined {
  if (impl === 'fractal' && isKaleidoscopeKnob(knob)) return KALEIDOSCOPE_RANGES[knob]
  if (impl === 'analytic' && isAnalyticKnob(knob)) return ANALYTIC_RANGES[knob]
  if (impl === 'streaks' && isStreaksKnob(knob)) return STREAK_RANGES[knob]
  if (impl === 'shards' && isShardKnob(knob)) return SHARD_RANGES[knob]
  if (isPostSafe(knob)) return SAFE_POST[knob]
  return SIGNED.has(knob) ? undefined : [0, Number.POSITIVE_INFINITY]
}

/** Light and colour: the three that may not climb when the music gets loud. */
const INTENSITY_KNOBS = ['intensity', 'saturation', 'grade.saturation', 'tonemap.exposure']

/**
 * The one way a full packet may end brighter than rest, and why. A full packet
 * has `impact` in it, and `impact` is not a level: it is 1 for a frame and a
 * third of that in 0.18 s, and a flash on the drop is what the study is for.
 * The guard below does not skip these knobs. It takes `impact` out of the
 * packet and holds the rest to rest as it does any other, and then holds what
 * `impact` adds to the cap, which is the size of the flash.
 */
const LIFTS: Record<string, Record<string, { cap: number; reason: string }>> = {
  'impact-flash': {
    'tonemap.exposure': {
      cap: 0.2,
      reason: 'the flash on the drop, capped so that one is not violent; see looks.test.ts',
    },
  },
  // Squeeze's `impact` rows are there to throw open what tension closed, each
  // the mirror of a tension row. With nothing winding up there is nothing to
  // undo, so the colour resolves past 1, and the cap is that mirror's size.
  'squeeze': {
    'grade.saturation': {
      cap: 0.55,
      reason:
        'undoes what tension drained; the uniform writer clamps saturation at 1, so none of it shows',
    },
  },
}

/**
 * A knob whose light is born of tension, and the most it may reach at full
 * tension. Everything else is held to its resting value at tension 1 as well,
 * which is what a study that only ever dims under load wants. A study that
 * rests at nothing and lets a build bring it in cannot pass that, and the
 * answer is not to loosen the rule for everyone but to say here how much light
 * it may add and why that is safe. Loud music with no build in it is held to
 * rest regardless: this only opens the tension end.
 */
const BUILT_LIGHT: Record<string, Record<string, { max: number; why: string }>> = {
  'riser-streaks': {
    intensity: {
      max: 0.7,
      why: 'rests at 0 so nothing draws without a build; at most 48 lines under 2 px wide, so under 4% of the frame is lit, and it thins its width as the count climbs',
    },
  },
}

/**
 * What a flow that has no curl in it says of the three curl knobs. Its speed
 * is 0 and the other two are the shape curl drift rests at, which is why they
 * sit still and not because nobody thought of them.
 */
const UNUSED_CURL = {
  curl: 'the curl term is off in this flow, and its speed at 0 is what off means',
  curlScale:
    'a shape of the curl term, held where curl drift rests so a change to it blends only speed',
  curlRate: 'the same: a shape of the curl term, held where curl drift rests',
}

/**
 * Knobs a study deliberately leaves still, and why. A knob that is in neither
 * this list nor a mapping row fails, so leaving one static is a decision
 * someone writes down rather than an oversight.
 */
const ALLOWED: Record<string, Record<string, string>> = {
  'lazy-fluid': {
    emitters: 'how many plumes there are, which is the composition and changes with the section',
    voice: 'how far an emitter stands for its own band, the scene’s shape rather than a level',
    events: 'the size of the pool behind the bed; the hits themselves are what fill it',
    eventLife: 'how long one hit lasts, so that a hit reads as a hit at any level',
    eventForce: 'what one hit is worth over its life; the hit’s own strength is the drive',
    eventRadius: 'the size of one hit before its band and its width scale it',
  },
  'turbulent-fluid': {
    force: 'this flow trickles at a steady rate and puts the music into the hits instead',
    orbitSpeed: 'a slow steady orbit is what keeps the filaments apart in this flow',
    emitters: 'how many plumes there are, which is the composition and changes with the section',
    voice: 'how far an emitter stands for its own band, the scene’s shape rather than a level',
    events: 'the size of the pool behind the bed; the hits themselves are what fill it',
    eventLife: 'how long one hit lasts, so that a hit reads as a hit at any level',
    eventForce: 'what one hit is worth over its life; the hit’s own strength is the drive',
    eventRadius: 'the size of one hit before its band and its width scale it',
  },
  'implode': {
    falloff:
      'a plain zoom about the middle: the shape of the pull is what makes it read as gathering',
    swirl: 'this flow is the radial term alone; a turn about the centre is the vortex study',
    twist: 'the same, and a twist that varies with radius is the polar twist study',
    ...UNUSED_CURL,
  },
  'radial-burst': {
    swirl: 'this flow is the radial term alone; a turn about the centre is the vortex study',
    twist: 'the same, and a twist that varies with radius is the polar twist study',
    ...UNUSED_CURL,
  },
  'curl-drift': {
    radial: 'this flow is the curl term alone; a pull to the middle is the implode study',
    falloff: 'the shape of the radial term, which this flow does not use',
    swirl: 'this flow is the curl term alone; a turn about the centre is the vortex study',
    twist: 'the same, and a twist that varies with radius is the polar twist study',
  },
  'dye-plumes': {
    hitDye: 'which sound fires it differs by cast, the low end in Plume and the treble in Wash',
    colourDrift: 'the palette drifts on a clock of its own; the key moves where it drifts from',
    eventDye: 'what one hit’s puff is worth over its life; the hit’s strength is the drive',
  },
  'ribbon': {
    'ribbon.shape': 'a line or a circle, which is a choice of the cast and not a level',
  },
  'riser-streaks': {
    hueSpread: 'how far the hues scatter round the ribbon’s, a setting of the look and not a level',
  },
  'fractal-glints': {
    symmetry: 'how many times the frame is folded, a whole number; moving it flickers the fold',
    complexity: 'recursions, rounded, and each one costs: a budget rather than a level',
    zoomAmount: 'the breathing zoom is a clock of its own; the music moves where it starts from',
    zoomSpeed: 'the same clock’s rate, which a moving value would make stutter',
    bandReaction: 'how hard each band drives its own recursion, which the scene reads itself',
    morphSpeed: 'the fold morphs on a clock of its own',
    bassLift: 'off in both casts; it lifts the whole image, which is what washes a frame out',
    sparkle: 'a little grit on the ridges, at a fixed level',
    colourDrift: 'the palette drifts on a clock of its own; the key moves where it drifts from',
    glintKnee: 'how soft the threshold’s edge is; the level it sits at is what moves',
  },
  'warm-soft': {
    'grade.vignette': 'the grade is off in this look, so its number is the stack’s neutral one',
    'grade.saturation': 'the grade is off in this look, so its number is the stack’s neutral one',
    'grade.weave': 'the grade is off in this look, so its number is the stack’s neutral one',
    'bloom.knee': 'the softness of the threshold; the threshold itself is what moves',
    'chromatic.beat':
      'the beat is already inside the stage: the split is amount + beat × beatPulse',
    'tonemap.shoulder': 'where the roll-off starts, which is a shape and not a level',
  },
  'clean-glass': {
    'grade.vignette': 'the grade is off in this look, so its number is the stack’s neutral one',
    'grade.saturation': 'the grade is off in this look, so its number is the stack’s neutral one',
    'grade.weave': 'the grade is off in this look, so its number is the stack’s neutral one',
    'bloom.knee': 'the softness of the threshold; the threshold itself is what moves',
    'chromatic.amount': 'the split is off in this look, so its numbers are the stack’s defaults',
    'chromatic.beat': 'the split is off in this look, so its numbers are the stack’s defaults',
    'tonemap.shoulder': 'where the roll-off starts, which is a shape and not a level',
    'grain.amount': 'the grain is off in this look, so its number is the stack’s default',
  },
  'hard-clean': {
    'grade.vignette': 'the grade is off in this look, so its number is the stack’s neutral one',
    'grade.saturation': 'the grade is off in this look, so its number is the stack’s neutral one',
    'grade.weave': 'the grade is off in this look, so its number is the stack’s neutral one',
    'bloom.knee': 'the softness of the threshold; the threshold itself is what moves',
    'chromatic.beat':
      'the beat is already inside the stage: the split is amount + beat × beatPulse',
    'tonemap.shoulder': 'where the roll-off starts, which is a shape and not a level',
    'grain.amount': 'the grain is off in this look, so its number is the stack’s default',
  },
  'squeeze': {
    'grade.weave': 'the weave is film’s and this look says nothing of it, so it rests at none',
    'bloom.knee': 'the softness of the threshold; the threshold itself is what moves',
    'chromatic.amount': 'the split is off in this look, so its numbers are the stack’s defaults',
    'chromatic.beat': 'the split is off in this look, so its numbers are the stack’s defaults',
    'tonemap.shoulder': 'where the roll-off starts, which is a shape and not a level',
    'grain.amount': 'the grain is off in this look, so its number is the stack’s default',
  },
  'impact-flash': {
    'grade.vignette': 'the grade is off in this look, so its number is the stack’s neutral one',
    'grade.saturation': 'the grade is off in this look, so its number is the stack’s neutral one',
    'grade.weave': 'the grade is off in this look, so its number is the stack’s neutral one',
    'bloom.knee': 'the softness of the threshold; the threshold itself is what moves',
    'chromatic.amount': 'the split is off in this look, so its numbers are the stack’s defaults',
    'chromatic.beat': 'the split is off in this look, so its numbers are the stack’s defaults',
    'tonemap.shoulder': 'where the roll-off starts, which is a shape and not a level',
    'grain.amount': 'the grain is off in this look, so its number is the stack’s default',
  },
  'film': {
    'bloom.knee': 'the softness of the threshold; the threshold itself is what moves',
    'chromatic.amount': 'the split is off in this look, so its numbers are the stack’s defaults',
    'chromatic.beat': 'the split is off in this look, so its numbers are the stack’s defaults',
    'tonemap.shoulder': 'where the roll-off starts, which is a shape and not a level',
  },
}

const driven = (study: Study, knob: string) =>
  study.mapping.some((row) => row.to === knob && row.gain !== 0)

const resting = (study: Study, knob: string) => study.knobs[knob] ?? 0

const at = (study: Study, packet: Float32Array, tension: number) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

describe('every study is well formed', () => {
  it('has a unique, kebab-case id', () => {
    const seen = new Set<string>()
    for (const study of STUDIES) {
      expect(study.id, `${study.name} has an id that is not kebab-case`).toMatch(
        /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
      )
      expect(seen.has(study.id), `${study.id} is in the registry twice`).toBe(false)
      seen.add(study.id)
    }
  })

  for (const study of STUDIES) {
    it(`${study.name}: says what it is and what draws it`, () => {
      expect(STUDY_KINDS).toContain(study.kind)
      expect(isImplId(study.impl), `${study.id} names no implementation`).toBe(true)
      expect(IMPL_IDS).toContain(study.impl)
      expect(study.reach, `${study.id} reach`).toBeGreaterThan(0)
      expect(study.reach, `${study.id} reach`).toBeLessThanOrEqual(1)
    })

    it(`${study.name}: offers exactly its implementation’s knobs`, () => {
      expect(Object.keys(study.knobs).sort()).toEqual([...implKnobs(study.impl)].sort())
      for (const row of study.mapping) {
        expect(
          isImplKnob(study.impl, row.to),
          `${study.id} maps onto ${row.to}, which ${study.impl} does not have`,
        ).toBe(true)
        expect(STUDY_FIELDS, `${study.id} reads ${row.from}`).toContain(row.from)
      }
    })

    it(`${study.name}: excludes and requires name something real`, () => {
      for (const other of study.excludes ?? []) {
        expect(
          findStudy(other),
          `${study.id} excludes ${other}, which is not a study`,
        ).toBeDefined()
        expect(other, `${study.id} excludes itself`).not.toBe(study.id)
      }

      for (const impl of study.requires ?? [])
        expect(isImplId(impl), `${study.id} requires ${impl}, which is no implementation`).toBe(
          true,
        )
    })
  }
})

describe('nothing a study draws is static', () => {
  for (const study of STUDIES) {
    it(`${study.name}: every knob is driven or is allowed to sit still, with a reason`, () => {
      const allowed = ALLOWED[study.id] ?? {}
      for (const knob of implKnobs(study.impl)) {
        if (driven(study, knob)) continue
        const reason = allowed[knob]
        expect(reason, `${study.id} leaves ${knob} static and says nothing about why`).toBeDefined()
        expect(
          (reason ?? '').length,
          `${study.id}: the reason for ${knob} is too short`,
        ).toBeGreaterThan(20)
      }
    })

    it(`${study.name}: every knob it drives actually moves`, () => {
      for (const knob of implKnobs(study.impl)) {
        if (!driven(study, knob)) continue
        const still = at(study, packetAt(0, 0), 0)[knob]
        const moved = CASES.some(
          (entry) =>
            Math.abs((at(study, entry.packet, entry.tension)[knob] ?? 0) - (still ?? 0)) > 1e-12,
        )
        expect(moved, `${study.id} maps ${knob} but nothing moves it`).toBe(true)
      }
    })

    it(`${study.name}: its allow list names knobs it has and does not drive`, () => {
      for (const knob of Object.keys(ALLOWED[study.id] ?? {})) {
        expect(isImplKnob(study.impl, knob), `${study.id} allows ${knob}, which it has not`).toBe(
          true,
        )
        expect(driven(study, knob), `${study.id} allows ${knob} and drives it anyway`).toBe(false)
      }
    })
  }

  // Every flow and ink must say what tension does to it: a build is the one
  // place in a song where what happens next is nearly certain, and a study
  // that ignores it cannot wind up with the music.
  for (const study of STUDIES) {
    if (study.kind === 'look') continue
    it(`${study.name}: says what tension does to it`, () => {
      expect(
        study.mapping.some((row) => row.from === 'tension' && row.gain !== 0),
        `${study.id} has no row from tension`,
      ).toBe(true)
    })
  }

  // The same for the list of ceilings a build may lift: it names knobs the
  // study has, and each says why the light it adds is safe.
  it('lets only a knob the study has, and drives, rise above rest with a build', () => {
    for (const [id, knobs] of Object.entries(BUILT_LIGHT)) {
      const study = findStudy(id)
      if (!study) throw new Error(`${id} has a ceiling and is not a study`)
      for (const [knob, built] of Object.entries(knobs)) {
        expect(INTENSITY_KNOBS, `${id} ${knob} is not a light knob`).toContain(knob)
        expect(driven(study, knob), `${id} has a ceiling for ${knob} and nothing drives it`).toBe(
          true,
        )
        expect(built.why.length, `${id}: the reason for ${knob} is too short`).toBeGreaterThan(20)
      }
    }
  })

  // The lifts are only worth having if they can fail either.
  it('lets a study lift the light only by a knob it has, drives from impact and says why', () => {
    for (const [id, knobs] of Object.entries(LIFTS)) {
      const study = findStudy(id)
      if (!study) throw new Error(`Expected ${id}`)
      for (const [knob, lift] of Object.entries(knobs)) {
        expect(
          study.mapping.some((row) => row.to === knob && row.from === 'impact' && row.gain > 0),
          `${id} may lift ${knob} and nothing lifts it from impact`,
        ).toBe(true)
        expect(lift.reason.length).toBeGreaterThan(20)
      }
    }
  })

  // The allow list is only worth having if it can fail.
  it('notices a study that leaves a knob static with nothing said about it', () => {
    const ribbon = findStudy('ribbon')
    if (!ribbon) throw new Error('Expected the ribbon')
    expect(driven(ribbon, 'ribbon.shape')).toBe(false)
    expect(ALLOWED['ribbon']?.['ribbon.shape']).toBeDefined()
    expect(ALLOWED['ribbon']?.['ribbon.width']).toBeUndefined()
  })
})

describe('every study stays inside a safe range', () => {
  for (const study of STUDIES) {
    it(`${study.name}: at silence and at a full packet, with and without tension`, () => {
      for (const entry of CASES) {
        const out = at(study, entry.packet, entry.tension)
        for (const [knob, value] of Object.entries(out)) {
          expect(Number.isFinite(value), `${study.id} ${knob} at ${entry.label}`).toBe(true)
          const range = safeRange(study.impl, knob)
          if (!range) continue
          expect(value, `${study.id} ${knob} at ${entry.label}`).toBeGreaterThanOrEqual(range[0])
          expect(value, `${study.id} ${knob} at ${entry.label}`).toBeLessThanOrEqual(range[1])
        }
      }
    })

    // A loud, hard passage puts its force into motion and structure. The
    // picture gets no brighter and no more saturated than it is at rest, and
    // that holds with nothing winding up, which is what a loud song with no
    // build in it is.
    it(`${study.name}: a full packet is no brighter and no more saturated than rest`, () => {
      const out = at(study, FULL.packet, 0)
      // The same packet without the one event in it, for a study whose lift
      // is allowed to come from that event alone.
      const noImpact = packetAt(1, 1)
      noImpact[F.impact] = 0
      const withoutImpact = at(study, noImpact, 0)
      for (const knob of INTENSITY_KNOBS) {
        if (!(knob in study.knobs)) continue
        const lift = LIFTS[study.id]?.[knob]
        if (lift) {
          expect(withoutImpact[knob], `${study.id} ${knob} without impact`).toBeLessThanOrEqual(
            resting(study, knob) + 1e-9,
          )

          expect(out[knob], `${study.id} ${knob} at a full packet`).toBeLessThanOrEqual(
            resting(study, knob) + lift.cap + 1e-9,
          )

          continue
        }

        expect(out[knob], `${study.id} ${knob} at a full packet`).toBeLessThanOrEqual(
          resting(study, knob) + 1e-9,
        )
      }
    })

    // With tension at full the same holds, unless the study says in
    // `BUILT_LIGHT` how much light a build may bring in and why that is safe.
    it(`${study.name}: at full tension it is no brighter than rest, or than it says it may be`, () => {
      const out = at(study, FULL.packet, FULL.tension)
      for (const knob of INTENSITY_KNOBS) {
        if (!(knob in study.knobs)) continue
        const built = BUILT_LIGHT[study.id]?.[knob]
        // A full packet has `impact` in it, so a study allowed a lift from
        // that event is allowed it here as well, and no more than its cap.
        const lift = LIFTS[study.id]?.[knob]?.cap ?? 0
        expect(
          out[knob],
          `${study.id} ${knob} at a full packet and full tension`,
        ).toBeLessThanOrEqual((built?.max ?? resting(study, knob)) + lift + 1e-9)
      }
    })
  }
})

describe('every cast stays inside a safe range', () => {
  for (const cast of CASTS) {
    it(`${cast.name}: with its own rows on top, at every packet and tension`, () => {
      for (const entry of CASES) {
        const frame = resolveCast(cast, entry.packet, entry.tension, castFrame())
        for (const [id, knobs] of frame.knobs) {
          const study = findStudy(id)
          if (!study) throw new Error(`${cast.id} holds ${id}, which is not a study`)
          for (const [knob, value] of Object.entries(knobs)) {
            const range = safeRange(study.impl, knob)
            if (!range) continue
            expect(value, `${cast.name} ${id} ${knob} at ${entry.label}`).toBeGreaterThanOrEqual(
              range[0],
            )

            expect(value, `${cast.name} ${id} ${knob} at ${entry.label}`).toBeLessThanOrEqual(
              range[1],
            )
          }
        }

        for (const knob of POST_KNOBS) {
          const [low, high] = SAFE_POST[knob]
          const value = POST_LANES[knob].read(frame.post)
          expect(value, `${cast.name} ${knob} at ${entry.label}`).toBeGreaterThanOrEqual(low)
          expect(value, `${cast.name} ${knob} at ${entry.label}`).toBeLessThanOrEqual(high)
        }

        expect(
          frame.post.feedback.amount * frame.post.feedback.decay,
          `${cast.name} feedback gain at ${entry.label}`,
        ).toBeLessThan(0.98)
      }
    })
  }
})
