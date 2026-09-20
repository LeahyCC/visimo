/**
 * The five pinned casts against the five presets they came from. This is the
 * whole point of the port: a cast is a different shape, resolved by different
 * code, and it must land on the same numbers. Anything else is a preset
 * quietly changing on the way through.
 *
 * The presets themselves are gone, so what they resolved to was captured
 * first: `preset-frames.json` beside the casts is the old path's own output,
 * written by running it over the same five packets these tests use. It is a
 * record of what shipped in 0.1 and nothing regenerates it.
 *
 * Tension is zero throughout, which is what every preset saw when the frames
 * were recorded, and every study's tension row is written so that zero adds
 * nothing.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { defaultPostParams, POST_KNOBS, POST_LANES, POST_STAGES, postSummary } from '../post/params'
import type { PostParams } from '../post/params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { glintLevel, kaleidoscopeParams } from '../scenes/kaleidoscope.params'
import { parseCast } from './cast'
import { castOrDefault, CASTS, DEFAULT_CAST_ID, findCast, stepCast } from './casts/index'
import melt from './casts/melt.json'
import plume from './casts/plume.json'
import frames from './casts/preset-frames.json'
import prism from './casts/prism.json'
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
 * the five casts must still do.
 */
const expectedPost = (golden: PresetFrame): PostParams => ({
  ...defaultPostParams(),
  ...golden.post,
})

/** Every field a mapping can read at one level; `lowEnd` is derived and follows. */
const packetAt = (level: number, swell: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') out[F[field]] = level
  out[F.swell] = swell
  return out
}

const framesOf = (id: string) => FRAMES.filter((entry) => entry.preset === id)

/** One band sustained and driving, so a threshold that is on is not zero. */
const LOUD_BANDS = Float32Array.from({ length: 20 }, (_, slot) => (slot === 0 ? 1 : 0))

describe('a pinned cast resolves to its preset', () => {
  // The capture has to cover the five, or a cast could pass by being compared
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
    for (const golden of framesOf('prism')) {
      const packet = packetAt(golden.level, golden.swell)
      const knobs = resolveCast(prism, packet, 0, castFrame()).knobs.get('fractal-glints')
      const params = kaleidoscopeParams(knobs ?? {})
      expect(knobs?.glint, `Prism glint at ${golden.packet}`).toBeCloseTo(0, 12)
      expect(knobs?.glintKnee, `Prism knee at ${golden.packet}`).toBe(0.35)
      // What the shader is handed, which is the number that decides the frame.
      expect(glintLevel(params, LOUD_BANDS), `Prism level at ${golden.packet}`).toBe(0)
    }

    for (const golden of framesOf('melt')) {
      const packet = packetAt(golden.level, golden.swell)
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
    expect(summaryOf('wash')).toBe('feedback bloom chroma tonemap grain')
    expect(summaryOf('prism')).toBe('bloom tonemap')
    expect(summaryOf('drift')).toBe('ribbon feedback bloom chroma tonemap grain')
    expect(summaryOf('melt')).toBe('ribbon feedback bloom tonemap')
  })

  it('hold the ribbon in Drift and Melt and nowhere else', () => {
    for (const cast of CASTS)
      expect(cast.inks.includes('ribbon'), cast.name).toBe(['drift', 'melt'].includes(cast.id))
  })
})

describe('parseCast', () => {
  it('resolves the canvas over the stack’s own feedback defaults', () => {
    const cast = parseCast(plume, 'plume.json')
    expect(cast.canvas.enabled).toBe(true)
    expect(cast.canvas.knobs['feedback.decay']).toBe(0.69)
    expect(cast.canvas.knobs['feedback.amount']).toBe(0.22)
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
