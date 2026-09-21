import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { defaultPostParams, POST_LANES, POST_STAGES } from '../post/params'
import type { PostParams } from '../post/params'
import { defaultCanvas } from './cast'
import type { CastCanvas } from './cast'
import { LOOK_KNOBS } from './impls'
import { findStudy } from './registry'
import { blendKnobs, castFrame, resolveLive, resolveStudy, studyFeature } from './resolve'
import type { LiveStudy } from './resolve'
import type { InkStudy } from './types'

const packet = (values: Partial<Record<keyof typeof F, number>>) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

const ink: InkStudy = {
  id: 'test-ink',
  kind: 'ink',
  name: 'Test',
  impl: 'dye',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 0, groove: 1, build: 0, drop: 0, rest: 0, outro: 0 },
  knobs: { dye: 1, saturation: 0.5 },
  mapping: [
    { from: 'energy', to: 'dye', gain: 2, curve: 'linear' },
    { from: 'tension', to: 'saturation', gain: -0.4, curve: 'linear' },
  ],
  cost: 'cheap',
}

describe('studyFeature', () => {
  it('reads the packet by name, as a preset does', () => {
    expect(studyFeature(packet({ treble: 0.4 }), 'treble', 0, 1)).toBeCloseTo(0.4)
    expect(studyFeature(packet({ sub: 0.2, bass: 0.7 }), 'lowEnd', 0, 1)).toBeCloseTo(0.7)
  })

  // Neither of these is in the packet the renderer holds: tension arrives as
  // an argument until its row exists, and presence is the director's fade.
  it('takes tension and presence from its arguments', () => {
    expect(studyFeature(packet({}), 'tension', 0.75, 1)).toBe(0.75)
    expect(studyFeature(packet({}), 'presence', 0, 0.25)).toBe(0.25)
  })
})

describe('resolveStudy', () => {
  it('is the resting values where nothing drives a knob', () => {
    expect(resolveStudy(ink, undefined, packet({}), 0, 1, {})).toEqual({ dye: 1, saturation: 0.5 })
  })

  it('adds gain times the bent field, tension included', () => {
    const out = resolveStudy(ink, undefined, packet({ energy: 0.5 }), 0.5, 1, {})
    expect(out.dye).toBeCloseTo(2)
    expect(out.saturation).toBeCloseTo(0.3)
  })

  it('takes the cast’s knobs, then the study’s rows, then the cast’s rows', () => {
    const overrides = {
      knobs: { dye: 4 },
      mapping: [{ from: 'energy', to: 'dye', gain: 1, curve: 'linear' } as const],
    }
    expect(resolveStudy(ink, overrides, packet({ energy: 1 }), 0, 1, {}).dye).toBeCloseTo(7)
  })

  it('ignores a row aimed at a knob the study does not have', () => {
    const overrides = { mapping: [{ from: 'energy', to: 'vorticity', gain: 9, curve: 'linear' }] }
    const out = resolveStudy(ink, overrides as never, packet({ energy: 1 }), 0, 1, {})
    expect(out).toEqual({ dye: 3, saturation: 0.5 })
  })

  it('rewrites the object it is given rather than keeping the last study’s knobs', () => {
    const out: Record<string, number> = {}
    resolveStudy(ink, undefined, packet({}), 0, 1, out)
    const fluid = findStudy('lazy-fluid')
    if (!fluid) throw new Error('Expected the lazy fluid')
    resolveStudy(fluid, undefined, packet({}), 0, 1, out)
    expect(Object.keys(out).sort()).toEqual(Object.keys(fluid.knobs).sort())
  })
})

/** The stack with nothing live: the defaults, the canvas off and every stage off. */
const bare = (): PostParams => {
  const out = defaultPostParams()
  for (const stage of POST_STAGES) out[stage].enabled = false
  return out
}

/** The stack's own feedback numbers, switched off: a look is what is measured here. */
const STILL: CastCanvas = { ...defaultCanvas(), enabled: false }

const FEATURES = packet({ energy: 0.5, treble: 0.5 })

/** The post stack with these studies live and nothing else. */
const live = (...studies: LiveStudy[]): PostParams =>
  resolveLive(studies, STILL, FEATURES, 0, castFrame()).post

const alone = (id: string, presence = 1) => live({ id, presence })

describe('blendKnobs', () => {
  // Lazy fluid's numbers and turbulent fluid's, near enough: the two studies
  // one solver is shared between.
  const lazy = { vorticity: 12, viscosity: 0.2, emitters: 5, events: 12 }
  const turbulent = { vorticity: 34, viscosity: 0.12, emitters: 3, events: 20 }

  it('is the one study when the other is at nothing', () => {
    const out = {}
    expect(
      blendKnobs(
        [
          { knobs: lazy, presence: 1 },
          { knobs: turbulent, presence: 0 },
        ],
        2,
        out,
      ),
    ).toEqual(lazy)
  })

  it('is halfway at a half each, with the counts whole', () => {
    const out = blendKnobs(
      [
        { knobs: lazy, presence: 0.5 },
        { knobs: turbulent, presence: 0.5 },
      ],
      2,
      {},
    )
    expect(out.vorticity).toBeCloseTo(23, 10)
    expect(out.viscosity).toBeCloseTo(0.16, 10)
    // Half an emitter is not a thing the solver can place.
    expect(out.emitters).toBe(4)
    expect(out.events).toBe(16)
  })

  // The presences are normalised, so two studies a third of the way through
  // a fade stir as hard as either of them alone.
  it('normalises, so a pair mid-fade is not a fraction of either', () => {
    const out = blendKnobs(
      [
        { knobs: lazy, presence: 0.2 },
        { knobs: turbulent, presence: 0.2 },
      ],
      2,
      {},
    )
    expect(out.vorticity).toBeCloseTo(23, 10)
  })

  it('takes only as much of the buffer as the count says', () => {
    const parts = [
      { knobs: lazy, presence: 1 },
      { knobs: turbulent, presence: 1 },
    ]
    expect(blendKnobs(parts, 1, {})).toEqual(lazy)
  })

  it('writes into the object it is handed, since it runs every frame', () => {
    const out = { vorticity: 0, gone: 1 }
    const result = blendKnobs([{ knobs: lazy, presence: 1 }], 1, out)
    expect(result).toBe(out)
    expect(out.gone).toBeUndefined()
  })
})

describe('the looks, blended', () => {
  it('at full presence is the look’s own numbers', () => {
    const out = alone('warm-soft')
    expect(out.bloom.threshold).toBeCloseTo(0.85 - 0.1 * 0.5)
    expect(out.grain.amount).toBeCloseTo(0.012 + 0.008)
  })

  it('switches on the stages it names and leaves the rest alone', () => {
    const out = alone('clean-glass')
    expect(out.bloom.enabled).toBe(true)
    expect(out.tonemap.enabled).toBe(true)
    expect(out.grain.enabled).toBe(false)
    expect(out.chromatic.enabled).toBe(false)
  })

  it('at presence 0 contributes nothing at all', () => {
    expect(alone('warm-soft', 0)).toEqual(bare())
  })

  // A look has nothing to fade against but another look, and half a tonemap
  // is a wrong picture rather than a soft one.
  it('on its own is wholly itself at any presence', () => {
    const faint = alone('warm-soft', 0.2)
    const full = alone('warm-soft')
    for (const stage of POST_STAGES) expect(faint[stage].enabled).toBe(full[stage].enabled)
    for (const knob of LOOK_KNOBS)
      expect(POST_LANES[knob].read(faint), knob).toBeCloseTo(POST_LANES[knob].read(full), 10)
  })

  // The whole reason a look acts on presence: two of them can be on at once
  // while the director slides one into the other, and neither knows it.
  it('two looks that share a stage land halfway between them at a half each', () => {
    const both = live({ id: 'warm-soft', presence: 0.5 }, { id: 'hard-clean', presence: 0.5 })
    const first = alone('warm-soft')
    const second = alone('hard-clean')
    for (const knob of LOOK_KNOBS) {
      // Grain is warm-soft's alone, and is the next test.
      if (knob.startsWith('grain.')) continue
      const lane = POST_LANES[knob]
      expect(lane.read(both), `${knob} halfway`).toBeCloseTo(
        (lane.read(first) + lane.read(second)) / 2,
        10,
      )
    }
  })

  // The bug this replaced: fading toward the stack's defaults made a leaving
  // look's grain climb toward the default 0.02 and then snap off.
  it('a stage only one look has thins to nothing as that look leaves', () => {
    const full = alone('warm-soft').grain.amount
    let last = full
    for (const presence of [0.75, 0.5, 0.25, 0.05]) {
      const out = live({ id: 'warm-soft', presence }, { id: 'hard-clean', presence: 1 - presence })
      expect(out.grain.enabled).toBe(true)
      expect(out.grain.amount).toBeCloseTo(full * presence, 10)
      expect(out.grain.amount).toBeLessThan(last)
      last = out.grain.amount
    }

    expect(
      live({ id: 'warm-soft', presence: 0 }, { id: 'hard-clean', presence: 1 }).grain.enabled,
    ).toBe(false)
  })

  it('a stage only one look has keeps its shape while it fades', () => {
    // clean-glass has no chromatic, so its resting split must not drag
    // warm-soft's about while warm-soft leaves.
    const out = live({ id: 'warm-soft', presence: 0.25 }, { id: 'clean-glass', presence: 0.75 })
    expect(out.bloom.threshold).toBeCloseTo(
      0.25 * alone('warm-soft').bloom.threshold + 0.75 * alone('clean-glass').bloom.threshold,
      10,
    )
    expect(out.chromatic.amount).toBeCloseTo(0.25 * alone('warm-soft').chromatic.amount, 10)
  })
})

// The grade is the first stage whose strength knob is neutral at 1 and not 0.
// Fading its saturation toward 0 as a look leaves would drain the colour on
// the way out, which is backwards, and the stage switching off at the end
// would then snap the colour back.
describe('a look with the grade, fading out against one without', () => {
  // Squeeze at the top of a build: the frame closed to 0.6 and the colour at 0.45.
  const fade = (presence: number) =>
    resolveLive(
      [
        { id: 'squeeze', presence },
        { id: 'clean-glass', presence: 1 - presence },
      ],
      STILL,
      FEATURES,
      1,
      castFrame(),
    ).post

  const own = fade(1).grade

  it('is the look’s own numbers while it is alone', () => {
    expect(own.enabled).toBe(true)
    expect(own.vignette).toBeCloseTo(0.6, 10)
    expect(own.saturation).toBeCloseTo(0.45, 10)
  })

  it('never drains colour below what the look itself had, and heads for untouched', () => {
    let last = own.saturation
    for (const presence of [0.9, 0.75, 0.5, 0.25, 0.1, 0.01]) {
      const grade = fade(presence).grade
      expect(grade.enabled).toBe(true)
      expect(grade.saturation, `at ${presence}`).toBeGreaterThan(last)
      expect(grade.saturation, `at ${presence}`).toBeLessThanOrEqual(1)
      // A fade toward 0 would put this at 0.2 at a half.
      expect(grade.saturation, `at ${presence}`).toBeCloseTo(
        presence * own.saturation + (1 - presence),
        10,
      )
      last = grade.saturation
    }
  })

  it('opens the vignette as the look leaves, to nothing', () => {
    let last = own.vignette
    for (const presence of [0.9, 0.5, 0.1, 0.01]) {
      const grade = fade(presence).grade
      expect(grade.vignette, `at ${presence}`).toBeLessThan(last)
      expect(grade.vignette, `at ${presence}`).toBeCloseTo(presence * own.vignette, 10)
      last = grade.vignette
    }
  })

  it('does not snap when the stage switches off', () => {
    const nearly = fade(0.01).grade
    const gone = fade(0).grade
    expect(gone.enabled).toBe(false)
    // Off, the numbers are the neutral ones, and the step to them from the
    // last frame it was on is the size of one percent of the look, not of it.
    expect(gone.saturation).toBe(1)
    expect(gone.vignette).toBe(0)
    expect(1 - nearly.saturation).toBeLessThan(0.01)
    expect(nearly.vignette).toBeLessThan(0.01)
  })

  // The other way round is the ordinary case, and it must not have changed:
  // a stage whose neutral is 0 still thins to 0 and not toward anything else.
  it('leaves the strength knobs whose neutral is 0 fading to nothing, as they did', () => {
    const out = resolveLive(
      [
        { id: 'warm-soft', presence: 0.5 },
        { id: 'squeeze', presence: 0.5 },
      ],
      STILL,
      FEATURES,
      0,
      castFrame(),
    ).post
    expect(out.grain.enabled).toBe(true)
    expect(out.chromatic.enabled).toBe(true)
    // Squeeze has neither, so warm-soft's are thinned by half and not averaged
    // with squeeze's resting numbers.
    expect(out.chromatic.amount).toBeCloseTo(0.5 * alone('warm-soft').chromatic.amount, 10)
    expect(out.grain.amount).toBeCloseTo(0.5 * alone('warm-soft').grain.amount, 10)
  })
})

describe('resolveLive', () => {
  it('holds two flows and two looks at once, which a cast cannot say', () => {
    const frame = resolveLive(
      [
        { id: 'lazy-fluid', presence: 0.5 },
        { id: 'turbulent-fluid', presence: 0.5 },
        { id: 'warm-soft', presence: 0.5 },
        { id: 'hard-clean', presence: 0.5 },
      ],
      STILL,
      FEATURES,
      0,
      castFrame(),
    )
    expect([...frame.knobs.keys()]).toEqual(['lazy-fluid', 'turbulent-fluid'])
  })

  it('leaves a study at presence 0 out, and drops one that has gone', () => {
    const frame = castFrame()
    resolveLive([{ id: 'lazy-fluid', presence: 1 }], STILL, FEATURES, 0, frame)
    expect(frame.knobs.has('lazy-fluid')).toBe(true)
    resolveLive([{ id: 'lazy-fluid', presence: 0 }], STILL, FEATURES, 0, frame)
    expect(frame.knobs.has('lazy-fluid')).toBe(false)
  })

  it('keeps the same knob object for a study from frame to frame', () => {
    const frame = castFrame()
    const entry = [{ id: 'lazy-fluid', presence: 1 }]
    const first = resolveLive(entry, STILL, FEATURES, 0, frame).knobs.get('lazy-fluid')
    const second = resolveLive(entry, STILL, FEATURES, 0, frame).knobs.get('lazy-fluid')
    expect(second).toBe(first)
  })

  // The post stack draws the ribbon and knows nothing of presence, so the
  // resolver is the only place its fade can happen.
  it('scales the ribbon’s light by its presence', () => {
    const full = live({ id: 'ribbon', presence: 1 }).ribbon
    const faint = live({ id: 'ribbon', presence: 0.1 }).ribbon
    expect(full.enabled).toBe(true)
    expect(faint.enabled).toBe(true)
    expect(faint.intensity).toBeCloseTo(full.intensity * 0.1, 10)
    expect(faint.width).toBe(full.width)
    expect(live({ id: 'ribbon', presence: 0 }).ribbon.enabled).toBe(false)
  })
})
