/**
 * The pinned casts against the presets they came from. This is the whole point
 * of the port: a cast is a different shape, resolved by different code, and it
 * must land on the same numbers. Anything else is a preset quietly changing on
 * the way through.
 *
 * The presets themselves are gone, so what they resolved to was captured
 * first: `preset-frames.json` beside the casts is the old path's own output,
 * written by running it over the same five packets these tests use. It is a
 * record of what shipped in 0.1 and nothing regenerates it, with one
 * exception: Plume, Wash and Drift were folded into one cast on 2026-09-20,
 * so the Plume frames are what the new cast resolves to at those packets, and
 * the Wash and Drift frames are gone. Prism's and Melt's are still the 0.1
 * ones.
 *
 * Tension is zero throughout, which is what every preset saw when the frames
 * were recorded, and every study's tension row is written so that zero adds
 * nothing.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  defaultPostParams,
  feedbackStep,
  mergePostParams,
  POST_KNOBS,
  POST_LANES,
  POST_STAGES,
  postSummary,
} from '../post/params'
import type { PostParams } from '../post/params'
import { AUDIO_FIELDS } from '../presets/knobs'
import type { AudioField } from '../presets/knobs'
import { glintLevel, kaleidoscopeParams } from '../scenes/kaleidoscope.params'
import { CANVAS_KNOBS, castStudyIds, defaultCanvas, parseCast } from './cast'
import { castOrDefault, CASTS, DEFAULT_CAST_ID, findCast, stepCast } from './casts/index'
import melt from './casts/melt.json'
import plume from './casts/plume.json'
import frames from './casts/preset-frames.json'
import prism from './casts/prism.json'
import { findStudy } from './registry'
import { castFrame, resolveCast } from './resolve'

/**
 * One captured frame of the preset path. The file is generated, so its own
 * types are as loose as JSON is: the stack's bloom weights come back as a
 * list rather than the triple the stack holds, which is the one thing this
 * narrowing buys. It was taken before the grade stage existed, so it has none.
 */
type PresetFrame = {
  preset: string
  packet: string
  level: number
  swell: number
  scene: Readonly<Record<string, number>>
  flow: Readonly<Record<string, number>> | null
  post: Omit<PostParams, 'grade'>
}

const FRAMES = frames as unknown as readonly PresetFrame[]

/**
 * What the preset path resolved to, as a whole stack. A stage that arrived
 * after the capture is at the stack's own default, which is off and neutral:
 * the preset path had no such stage, so that is what it did, and it is what
 * the shipped casts must still do. The merge is per stage rather than a
 * spread over the whole object, so a knob added to a stage the capture does
 * record, as the canvas hold and its company were to the feedback, reads the
 * stack's default for it and not `undefined`. Every one of those defaults is
 * exactly off, which is why the pinned casts need no compatibility path.
 */
const expectedPost = (golden: PresetFrame): PostParams =>
  mergePostParams(defaultPostParams(), golden.post)

/**
 * The moment rows. The frames were captured before these existed, so a packet
 * that is to land on them says the same, as `gpu/Renderer.test.ts` does.
 * Plume's own frames are read with them at 0 as well, so the `rest` row its
 * trails answer to is pinned by the tests of its own below and not by these.
 */
const MOMENT_FIELDS: readonly string[] = ['tension', 'release', 'rest', 'impact']

/** Every field a mapping can read at one level; `lowEnd` is derived and follows. */
const packetAt = (level: number, swell: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS)
    if (field !== 'lowEnd' && !MOMENT_FIELDS.includes(field)) out[F[field]] = level
  out[F.swell] = swell
  return out
}

const framesOf = (id: string) => FRAMES.filter((entry) => entry.preset === id)

/** One band sustained and driving, so a threshold that is on is not zero. */
const LOUD_BANDS = Float32Array.from({ length: 20 }, (_, slot) => (slot === 0 ? 1 : 0))

describe('a pinned cast resolves to its preset', () => {
  // The capture has to cover every cast, or one could pass by being compared
  // against nothing at all.
  it('has a captured frame for every cast at five packets', () => {
    for (const cast of CASTS) expect(framesOf(cast.id).length, cast.name).toBe(5)
  })

  for (const cast of CASTS) {
    it(`${cast.name}: the scene knobs match at every packet`, () => {
      for (const golden of framesOf(cast.id)) {
        const packet = packetAt(golden.level, golden.swell)
        const frame = resolveCast(cast, packet, 0, castFrame())
        // Every knob the drawing scene had, wherever in the cast it now
        // lives: the fluid presets split theirs between a flow and an ink.
        const drawn: Record<string, number> = {}
        for (const knobs of frame.knobs.values())
          for (const [knob, value] of Object.entries(knobs))
            if (knob in golden.scene) drawn[knob] = value
        expect(Object.keys(drawn).sort(), `${cast.name} at ${golden.packet}`).toEqual(
          Object.keys(golden.scene).sort(),
        )
        for (const [knob, value] of Object.entries(golden.scene))
          expect(drawn[knob], `${cast.name} ${knob} at ${golden.packet}`).toBeCloseTo(value, 10)
      }
    })

    it(`${cast.name}: the whole post stack matches at every packet`, () => {
      for (const golden of framesOf(cast.id)) {
        const packet = packetAt(golden.level, golden.swell)
        const { post } = resolveCast(cast, packet, 0, castFrame())
        const expected = expectedPost(golden)
        expect(post.enabled, `${cast.name} enabled at ${golden.packet}`).toBe(expected.enabled)
        for (const stage of POST_STAGES)
          expect(post[stage].enabled, `${cast.name} ${stage} at ${golden.packet}`).toBe(
            expected[stage].enabled,
          )
        expect(post.bloom.weights, `${cast.name} bloom weights at ${golden.packet}`).toEqual(
          expected.bloom.weights,
        )
        for (const knob of POST_KNOBS)
          expect(
            POST_LANES[knob].read(post),
            `${cast.name} ${knob} at ${golden.packet}`,
          ).toBeCloseTo(POST_LANES[knob].read(expected), 10)
      }
    })
  }

  /**
   * The captures above are walked by the knobs they recorded, so a knob that
   * did not exist in 0.1 is invisible to them: `glint` and `glintKnee` are
   * not in `preset-frames.json` and nothing regenerates that file, because it
   * is a record of what shipped and not a list of what exists. So the two new
   * knobs are pinned here instead, at every packet the captures use.
   *
   * Prism has to resolve `glint` to exactly 0, or its picture is not the one
   * it has always drawn: its canvas is off, nothing carries, and the ink was
   * never the thing filling it. The study rests above 0 and rises with the
   * music, so Prism's cast sets the rest to 0 and carries a row against each
   * of the study's own. Subtracting the same product it added lands on 0 to
   * the bit, and this is what holds a row added later to doing the same.
   *
   * The two gains cancel to the last bit rather than to nothing, so what is
   * pinned is the level the shader is handed: `glintLevel` treats a knob
   * under a ten-thousandth as off, and that is what Prism lands on.
   *
   * Melt is the other way round and is the one preset this change is meant to
   * alter: it draws on a canvas that keeps 94 percent of itself, and without
   * a threshold its drop filled edge to edge. Its cast names a glint of its
   * own, above the study's rest, and that number is recorded here.
   */
  it('pins the threshold the captures cannot see', () => {
    const prism = findCast('prism')
    const melt = findCast('melt')
    if (!prism || !melt) throw new Error('Expected Prism and Melt')
    // These are about the moment rows, which the frames' packet leaves at 0,
    // so `release` is put back: the glint rises with it.
    const released = (level: number, swell: number) => {
      const packet = packetAt(level, swell)
      packet[F.release] = level
      return packet
    }

    for (const golden of framesOf('prism')) {
      const packet = released(golden.level, golden.swell)
      const knobs = resolveCast(prism, packet, 0, castFrame()).knobs.get('fractal-glints')
      const params = kaleidoscopeParams(knobs ?? {})
      expect(knobs?.glint, `Prism glint at ${golden.packet}`).toBeCloseTo(0, 12)
      expect(knobs?.glintKnee, `Prism knee at ${golden.packet}`).toBe(0.35)
      // What the shader is handed, which is the number that decides the frame.
      expect(glintLevel(params, LOUD_BANDS), `Prism level at ${golden.packet}`).toBe(0)
    }

    for (const golden of framesOf('melt')) {
      const packet = released(golden.level, golden.swell)
      const knobs = resolveCast(melt, packet, 0, castFrame()).knobs.get('fractal-glints')
      expect(knobs?.glint, `Melt glint at ${golden.packet}`).toBeCloseTo(
        0.38 + 0.3 * golden.level + 0.25 * golden.level,
        7,
      )
    }
  })

  // Melt's flow is the one number the port does not leave alone, and it is
  // the resting values that have to survive: as a study the fluid under the
  // fractal now answers the music, which a preset's flow never did.
  it('Melt keeps its flow at the numbers the preset set', () => {
    const cast = findCast('melt')
    const golden = framesOf('melt').find((entry) => entry.packet === 'silence')
    if (!cast || !golden?.flow) throw new Error('Expected Melt')
    const frame = resolveCast(cast, packetAt(0, 0), 0, castFrame())
    expect(frame.knobs.get('turbulent-fluid')).toEqual(golden.flow)
  })
})

// `data-post` on the canvas is the summary, and a consumer's tests assert it,
// so the five have to print exactly what they printed as presets.
describe('the casts', () => {
  const summaryOf = (id: string) => {
    const cast = findCast(id)
    if (!cast) throw new Error(`Expected the ${id} cast`)
    return postSummary(resolveCast(cast, packetAt(0.3, 0.5), 0, castFrame()).post)
  }

  it('have unique ids and names', () => {
    expect(new Set(CASTS.map((cast) => cast.id)).size).toBe(CASTS.length)
    expect(new Set(CASTS.map((cast) => cast.name)).size).toBe(CASTS.length)
  })

  it('has a default that exists and is carried by a fluid', () => {
    const cast = castOrDefault(DEFAULT_CAST_ID)
    expect(cast.id).toBe(DEFAULT_CAST_ID)
    expect(cast.flow).toBe('lazy-fluid')
    // An id nobody recognises falls back rather than throwing.
    expect(castOrDefault('gone').id).toBe(DEFAULT_CAST_ID)
  })

  it('steps both ways and wraps', () => {
    const first = CASTS[0]
    const last = CASTS[CASTS.length - 1]
    if (!first || !last) throw new Error('Expected casts')
    expect(stepCast(first.id, 1).id).toBe(CASTS[1]?.id)
    expect(stepCast(first.id, -1).id).toBe(last.id)
    expect(stepCast(last.id, 1).id).toBe(first.id)
    // An id nobody recognises starts the walk from the top rather than off it.
    expect(stepCast('gone', 1).id).toBe(CASTS[1]?.id)
  })

  it('print the stages they always did unless they hold the ribbon', () => {
    expect(summaryOf('plume')).toBe('feedback bloom chroma tonemap grain')
    expect(summaryOf('prism')).toBe('bloom tonemap')
    expect(summaryOf('melt')).toBe('ribbon feedback bloom tonemap')
  })

  it('hold the ribbon in Melt and nowhere else', () => {
    for (const cast of CASTS)
      expect(cast.inks.includes('ribbon'), cast.name).toBe(cast.id === 'melt')
  })
})

/**
 * Plume is three casts folded into one (2026-09-20, at the owner's request):
 * Plume's dye reactivity, Wash's colour, Drift's trails when the music is calm
 * and Wash's short ones when it is loud. These pin the choices the numbers in
 * `plume.json` were made from, so a later tune moves them on purpose.
 */
describe('Plume, the three fluid casts folded into one', () => {
  const plume = findCast('plume')
  if (!plume) throw new Error('Expected the Plume cast')

  type Fields = Partial<Record<AudioField, number>>

  // Only the named fields set, the rest silent. `lowEnd` is the louder of two
  // bands, so it goes in as the bass.
  const packetOf = (fields: Fields) => {
    const out = new Float32Array(PACKET_LENGTH)
    for (const field of AUDIO_FIELDS) {
      const value = fields[field]
      if (value !== undefined) out[field === 'lowEnd' ? F.bass : F[field]] = value
    }

    return out
  }

  const at = (fields: Fields, tension = 0) =>
    resolveCast(plume, packetOf(fields), tension, castFrame())
  const dyeAt = (fields: Fields, tension = 0) => at(fields, tension).knobs.get('dye-plumes') ?? {}
  const FULL: Fields = Object.fromEntries(AUDIO_FIELDS.map((field) => [field, 1]))

  // A passage with the floor dropped away, and one at the track's own peak.
  // Everything else is silent, so what moves is what `energy` and `rest` move.
  const CALM: Fields = { energy: 0, rest: 1, swell: 0.5 }
  const LOUD: Fields = { energy: 1, rest: 0, swell: 0.5 }

  it('is listed once, and the ids it absorbed still find it', () => {
    expect(CASTS.map((cast) => cast.id)).toEqual(['plume', 'prism', 'melt'])
    for (const id of ['wash', 'drift']) {
      expect(
        CASTS.some((cast) => cast.id === id),
        id,
      ).toBe(false)
      expect(findCast(id), id).toBe(plume)
      // What `data-preset` prints is the cast's own id, never the one asked for.
      expect(castOrDefault(id).id, id).toBe('plume')
    }

    expect(findCast('gone')).toBeUndefined()
    // A host that stored one of them steps on from Plume's place in the list.
    expect(stepCast('drift', 1).id).toBe('prism')
    expect(stepCast('wash', -1).id).toBe('melt')
  })

  // A cast has one flow and no way to give a member a presence of its own, so
  // the two fluids cannot both be in it: the lazy one moves toward the
  // turbulent tuning by its own knobs instead.
  it('holds the lazy fluid alone and no ribbon', () => {
    expect(plume.flow).toBe('lazy-fluid')
    expect(plume.inks).toEqual(['dye-plumes'])
    expect(castStudyIds(plume)).not.toContain('turbulent-fluid')
  })

  it('moves the lazy fluid toward the turbulent tuning as the track gets loud', () => {
    const calm = at(CALM).knobs.get('lazy-fluid') ?? {}
    const loud = at(LOUD).knobs.get('lazy-fluid') ?? {}
    // Turbulent fluid rests at a vorticity of 26 and an orbit of 0.1, and the
    // lazy one starts from Drift's 18 and 0.19.
    expect(calm.vorticity).toBe(18)
    expect(loud.vorticity).toBeCloseTo(26, 10)
    expect(loud.orbitSpeed ?? 0).toBeLessThan(calm.orbitSpeed ?? 0)
    expect(loud.velocityDecay ?? 0).toBeGreaterThan(calm.velocityDecay ?? 0)
    // The treble already takes 0.18 of the viscosity, so a full packet has to
    // leave some or the solver has nothing to solve (the trap Melt's cast
    // names): thinner when loud, never below nothing.
    expect(loud.viscosity ?? 0).toBeLessThan(calm.viscosity ?? 0)
    expect(at({ ...LOUD, treble: 1 }).knobs.get('lazy-fluid')?.viscosity ?? 0).toBeGreaterThan(0)
  })

  it('rests the palette half a turn from the key and lets the low end shove it', () => {
    expect(dyeAt({}).colourShift).toBeCloseTo(0.5, 10)
    // The packet is single precision, so the key hue comes back a hair off.
    expect(dyeAt({ keyHue: 0.2 }).colourShift).toBeCloseTo(0.7, 6)
    expect(dyeAt({ lowEnd: 1 }).colourShift).toBeCloseTo(0.75, 10)
    // A square row: a soft low end barely moves it, a kick does.
    expect(dyeAt({ lowEnd: 0.5 }).colourShift).toBeCloseTo(0.5 + 0.25 * 0.25, 10)
  })

  // Wash's treble hit row is left out on purpose. At a full packet the hit
  // dye is a rest of 0.55 plus one each from the low end and novelty, 2.55;
  // the row's 1.2 would make 3.75, past the 3.1 the old Plume reached and
  // near double Wash's 2.1, so it does push the frame past what either cast
  // drew at the same packet.
  it('reacts to harmony, bass and novelty, and not to the treble', () => {
    const rest = dyeAt({})
    expect((dyeAt({ harmonicChange: 1 }).dye ?? 0) - (rest.dye ?? 0)).toBeCloseTo(2, 10)
    expect((dyeAt({ lowEnd: 1 }).hitDye ?? 0) - (rest.hitDye ?? 0)).toBeCloseTo(1, 10)
    expect((dyeAt({ novelty: 1 }).hitDye ?? 0) - (rest.hitDye ?? 0)).toBeCloseTo(1, 10)
    expect(dyeAt({ treble: 1 }).hitDye).toBe(rest.hitDye)
    expect(dyeAt(FULL).hitDye ?? 0).toBeLessThanOrEqual(3.1)
  })

  it('keeps the trails long when calm and short when loud, and falls smoothly between', () => {
    const calm = at(CALM).post.feedback
    const loud = at(LOUD).post.feedback
    // Drift's 0.93 at least, and Wash's 0.68 at the top.
    expect(calm.decay).toBeGreaterThanOrEqual(0.93)
    expect(loud.decay).toBeCloseTo(0.68, 10)
    // The decay alone would leave a loud trail at 0.68 of itself a frame, more
    // than three times Wash's 0.2: the amount is what takes it down to 0.3.
    expect(calm.amount).toBe(1)
    expect(loud.amount).toBeCloseTo(0.3, 10)
    expect(loud.carry).toBeLessThan(calm.carry)

    let last = at({ energy: 0, rest: 0, swell: 0.5 }).post.feedback
    for (let step = 1; step <= 10; step += 1) {
      const now = at({ energy: step / 10, rest: 0, swell: 0.5 }).post.feedback
      expect(now.decay).toBeLessThanOrEqual(last.decay)
      expect(now.amount).toBeLessThanOrEqual(last.amount)
      last = now
    }

    // A breakdown reads as calm to the trails even when the level is middling.
    expect(at({ energy: 0.5, rest: 1 }).post.feedback.decay).toBeGreaterThan(
      at({ energy: 0.5, rest: 0 }).post.feedback.decay,
    )
  })

  it('keeps Drift’s floor and ceiling rows', () => {
    const rest = at({}).post.feedback
    expect(rest.floor).toBe(0.018)
    expect(rest.ceiling).toBe(1.8)
    expect(at({ energy: 1 }).post.feedback.ceiling).toBeCloseTo(1.8 - 0.25, 10)
    expect(at({ swell: 1 }).post.feedback.ceiling).toBeCloseTo(1.8 - 0.15, 10)
    expect(at({ hardness: 1 }).post.feedback.ceiling).toBeCloseTo(1.8 - 0.15, 10)
    expect(at({ energy: 1 }).post.feedback.floor).toBeGreaterThan(rest.floor)
  })

  // Per second and not per frame, and the trap is that the decay alone is not
  // enough: the fresh frame's weight has to match as well, or a faster display
  // settles a still picture brighter. Both the trail and the settled level are
  // held across the two rates at both ends of the cast, since the trail knobs
  // are the ones the music moves.
  it('leaves the same trail a second at 60 and at 144 frames a second', () => {
    for (const fields of [CALM, LOUD]) {
      const { feedback } = at(fields).post
      const at60 = feedbackStep(feedback, 1 / 60)
      const at144 = feedbackStep(feedback, 1 / 144)
      const kept = (step: typeof at60, fps: number) => (step.amount * step.decay) ** fps
      expect(kept(at144, 144)).toBeCloseTo(kept(at60, 60), 9)
      const settled = (step: typeof at60) => step.fresh / (1 - step.amount * step.decay)
      expect(settled(at144)).toBeCloseTo(settled(at60), 6)
      expect(at144.zoom ** 144).toBeCloseTo(at60.zoom ** 60, 9)
      expect(at144.rotate * 144).toBeCloseTo(at60.rotate * 60, 9)
      expect(at144.floor * 144).toBeCloseTo(at60.floor * 60, 9)
    }
  })

  it('sets no knob that nothing drives', () => {
    for (const id of castStudyIds(plume)) {
      const study = findStudy(id)
      if (!study) throw new Error(`Expected ${id}`)
      const rows = [...study.mapping, ...(plume.overrides[id]?.mapping ?? [])]
      for (const knob of Object.keys(plume.overrides[id]?.knobs ?? {}))
        expect(
          rows.some((row) => row.to === knob),
          `${id} sets ${knob} and no row moves it`,
        ).toBe(true)
    }

    // Only the knobs Plume moved off the stack's own defaults: a knob it
    // leaves where the stack rests it is a knob it has not set, and the ones
    // that arrived with the canvas hold are all off there.
    const rest = defaultCanvas().knobs
    for (const knob of CANVAS_KNOBS) {
      if (plume.canvas.knobs[knob] === rest[knob]) continue
      expect(
        plume.canvas.mapping.some((row) => row.to === knob),
        `the canvas sets ${knob} and no row moves it`,
      ).toBe(true)
    }
  })

  // The light knobs sit at their resting values at a silent packet, and no row
  // takes them anywhere else: nothing is added that a silent song did not ask
  // for. What is left is the fluid's own quiet trickle, at Drift's rest of the
  // dye, which is the level the canvas floor was tuned to hold near black.
  it('adds no light at a silent packet', () => {
    const silent = at({})
    for (const id of ['lazy-fluid', 'dye-plumes']) {
      const study = findStudy(id)
      if (!study) throw new Error(`Expected ${id}`)
      const rest: Record<string, number> = { ...study.knobs, ...plume.overrides[id]?.knobs }
      const knobs = silent.knobs.get(id) ?? {}
      for (const knob of ['dye', 'hitDye', 'eventDye', 'intensity', 'force', 'hitForce'])
        if (knob in rest) expect(knobs[knob], `${id} ${knob}`).toBe(rest[knob])
    }
  })

  it('is no brighter and no more saturated than rest at a full packet', () => {
    const study = findStudy('dye-plumes')
    if (!study) throw new Error('Expected the dye plumes')
    const rest: Record<string, number> = { ...study.knobs, ...plume.overrides['dye-plumes']?.knobs }
    for (const tension of [0, 1]) {
      const knobs = dyeAt(FULL, tension)
      expect(knobs.intensity ?? 0, `intensity at tension ${tension}`).toBeLessThanOrEqual(
        (rest.intensity ?? 0) + 1e-9,
      )

      expect(knobs.saturation ?? 0, `saturation at tension ${tension}`).toBeLessThanOrEqual(
        (rest.saturation ?? 0) + 1e-9,
      )
    }
  })
})

describe('parseCast', () => {
  it('resolves the canvas over the stack’s own feedback defaults', () => {
    const cast = parseCast(plume, 'plume.json')
    expect(cast.canvas.enabled).toBe(true)
    expect(cast.canvas.knobs['feedback.decay']).toBe(0.9)
    expect(cast.canvas.knobs['feedback.amount']).toBe(1)
  })

  it('reads a cast with no flow at all', () => {
    const cast = parseCast(prism, 'prism.json')
    expect(cast.flow).toBeUndefined()
    expect(cast.canvas.enabled).toBe(false)
  })

  it('names the file and the path in every message', () => {
    expect(() => parseCast({ ...plume, inks: ['nonsense'] }, 'casts/plume.json')).toThrow(
      /casts\/plume\.json: inks\[0\] is not a study/,
    )
  })

  it('refuses a study that is not there, and one of the wrong kind', () => {
    expect(() => parseCast({ ...plume, look: 'ribbon' }, 'bad')).toThrow(/is an ink where a look/)
    expect(() => parseCast({ ...plume, flow: 'dye-plumes' }, 'bad')).toThrow(
      /is an ink where a flow/,
    )
  })

  it('refuses a second flow, wherever it is named', () => {
    expect(() => parseCast({ ...plume, inks: ['turbulent-fluid'] }, 'bad')).toThrow(
      /a cast has one flow/,
    )
  })

  it('refuses a cast with no look and one with no ink', () => {
    const { look: _look, ...noLook } = plume
    expect(() => parseCast(noLook, 'bad')).toThrow(/look is missing/)
    expect(() => parseCast({ ...plume, inks: [] }, 'bad')).toThrow(/at least one ink/)
  })

  // The cap is on the count and is checked before the names, so it holds
  // however large the registry grows.
  it('refuses a fourth ink', () => {
    const inks = ['dye-plumes', 'ribbon', 'dye-plumes', 'ribbon']
    expect(() => parseCast({ ...plume, inks }, 'bad')).toThrow(/bad: inks names 4 inks.*at most 3/)
  })

  it('refuses two studies that exclude each other', () => {
    expect(() => parseCast({ ...melt, inks: ['fractal-glints', 'dye-plumes'] }, 'bad')).toThrow(
      /may not share a cast/,
    )
  })

  it('refuses an ink whose implementation has nothing to draw into', () => {
    const { flow: _flow, ...noFlow } = plume
    expect(() => parseCast(noFlow, 'bad')).toThrow(/needs the fluid implementation/)
  })

  it('refuses a knob the study’s implementation does not have', () => {
    const overrides = { 'dye-plumes': { knobs: { vorticity: 1 } } }
    expect(() => parseCast({ ...plume, overrides }, 'bad')).toThrow(/is not a knob of dye/)
    const rows = { 'dye-plumes': { mapping: [{ from: 'energy', to: 'vorticity', gain: 1 }] } }
    expect(() => parseCast({ ...plume, overrides: rows }, 'bad')).toThrow(/is not a knob of dye/)
  })

  it('refuses an override for a study the cast does not hold', () => {
    const overrides = { 'hard-clean': { knobs: { 'grain.amount': 0.01 } } }
    expect(() => parseCast({ ...plume, overrides }, 'bad')).toThrow(/does not hold/)
  })

  it('refuses a canvas knob that is not the canvas’s, and a row aimed off it', () => {
    const canvas = { knobs: { 'bloom.intensity': 1 } }
    expect(() => parseCast({ ...plume, canvas }, 'bad')).toThrow(/is not a canvas knob/)
    const rows = { mapping: [{ from: 'energy', to: 'bloom.intensity', gain: 1 }] }
    expect(() => parseCast({ ...plume, canvas: rows }, 'bad')).toThrow(/is not a canvas knob/)
  })

  it('takes tension as a field like any other, and refuses one that is not a field', () => {
    const overrides = { 'dye-plumes': { mapping: [{ from: 'tension', to: 'dye', gain: -1 }] } }
    expect(
      parseCast({ ...plume, overrides }, 'good').overrides['dye-plumes']?.mapping?.[0],
    ).toEqual({ from: 'tension', to: 'dye', gain: -1, curve: 'linear' })
    const bad = { 'dye-plumes': { mapping: [{ from: 'vibe', to: 'dye', gain: -1 }] } }
    expect(() => parseCast({ ...plume, overrides: bad }, 'bad')).toThrow(/is not a field/)
  })

  it('refuses a key that is not part of a cast', () => {
    expect(() => parseCast({ ...plume, scene: 'fluid' }, 'bad')).toThrow(/scene is not part/)
  })
})
