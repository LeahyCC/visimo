/**
 * Every cast, walked, which is what `presets/postMapping.test.ts` did for the
 * presets before they became casts. Nothing here names a cast except Prism's
 * silence, so one added later is held to the same rules without anyone
 * remembering to add it: nothing it switches on may sit still.
 *
 * The safe ranges moved to `registry.test.ts`, which already sweeps every
 * cast at both ends of tension. What is left here is the rule that is about
 * the cast rather than the study: a cast is the sum of its studies' rows, its
 * own overrides and its canvas's, and only the sum can say whether a stage
 * that is on has anything driving it.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { POST_KNOBS, POST_LANES, POST_STAGES, ribbonRuns, stageEnabled } from '../post/params'
import type { PostStage } from '../post/params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { bend } from '../presets/resolve'
import { castStudyIds } from './cast'
import type { CanvasKnob, Cast } from './cast'
import { CASTS, findCast } from './casts/index'
import { findStudy } from './registry'
import { castFrame, resolveCast, studyFeature } from './resolve'
import type { StudyMapping } from './types'

const packetAt = (level: number, swell: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') out[F[field]] = level
  // Swell is centred, so 0 and 1 are a breakdown and a drop and 0.5 is steady;
  // it gets its own sweep because neither extreme of the others reaches 0.5.
  out[F.swell] = swell
  return out
}

const SILENT = packetAt(0, 0)

const PACKETS = [0, 1].flatMap((level) =>
  [0, 0.5, 1].map((swell) => ({
    label: `level ${level}, swell ${swell}`,
    packet: packetAt(level, swell),
  })),
)

const resolved = (cast: Cast, packet: Float32Array) => resolveCast(cast, packet, 0, castFrame())

/** Whether a lane of the stage lands somewhere else at some packet than at silence. */
const stageMoves = (cast: Cast, stage: PostStage) =>
  POST_KNOBS.filter((knob) => knob.startsWith(`${stage}.`)).some((knob) =>
    PACKETS.some(({ packet }) => {
      const now = POST_LANES[knob].read(resolved(cast, packet).post)
      return Math.abs(now - POST_LANES[knob].read(resolved(cast, SILENT).post)) > 1e-12
    }),
  )

/** Whether any knob of this study lands somewhere else at some packet than at silence. */
const studyMoves = (cast: Cast, id: string) =>
  PACKETS.some(({ packet }) => {
    const now = resolved(cast, packet).knobs.get(id) ?? {}
    const rest = resolved(cast, SILENT).knobs.get(id) ?? {}
    return Object.keys(now).some((knob) => Math.abs((now[knob] ?? 0) - (rest[knob] ?? 0)) > 1e-12)
  })

describe('nothing a cast puts on screen is static', () => {
  for (const cast of CASTS) {
    it(`${cast.name}: every post stage it switches on is driven by the music`, () => {
      for (const stage of POST_STAGES) {
        if (!stageEnabled(resolved(cast, SILENT).post, stage)) continue
        expect(
          stageMoves(cast, stage),
          `${cast.name} switches ${stage} on and nothing moves it`,
        ).toBe(true)
      }
    })

    it(`${cast.name}: every flow and ink it holds moves`, () => {
      for (const id of castStudyIds(cast)) {
        const study = findStudy(id)
        if (!study || study.kind === 'look') continue
        expect(studyMoves(cast, id), `${cast.name} holds ${id} and nothing moves it`).toBe(true)
      }
    })
  }

  // The guard sweeps `POST_KNOBS`, so a knob added to a stage is covered the
  // moment it becomes a lane. That is the whole of the contract, and it is
  // worth writing down: the five that came with the canvas hold are all off
  // by default, so a cast that switches the feedback on and drives only one
  // of them must still count as a canvas that moves.
  it('sweeps the knobs the canvas hold brought with it', () => {
    const living: readonly CanvasKnob[] = [
      'feedback.fade',
      'feedback.hold',
      'feedback.hue',
      'feedback.cool',
      'feedback.sharpen',
    ]
    for (const knob of living) expect(POST_KNOBS, knob).toContain(knob)
    const plume = findCast('plume')
    if (!plume) throw new Error('Expected the Plume cast')
    for (const knob of living) {
      const only: Cast = {
        ...plume,
        canvas: {
          ...plume.canvas,
          mapping: [{ from: 'energy', to: knob, gain: 0.01, curve: 'linear' }],
        },
        overrides: {},
      }
      expect(stageMoves(only, 'feedback'), knob).toBe(true)
    }
  })

  // The guard is only worth having if it can fail.
  it('notices a cast whose stage has nothing driving it', () => {
    const plume = findCast('plume')
    if (!plume) throw new Error('Expected the Plume cast')
    const still: Cast = {
      ...plume,
      canvas: { ...plume.canvas, mapping: [] },
      overrides: {},
      look: 'clean-glass',
    }
    // Clean glass drives the bloom and the tonemap, and nothing at all now
    // reaches the feedback, which the canvas above switched on.
    expect(stageMoves(still, 'feedback')).toBe(false)
    expect(stageMoves(still, 'bloom')).toBe(true)
  })
})

describe('Prism in silence', () => {
  /** Every row a cast applies: its studies' own, its overrides' and its canvas's. */
  const rowsOf = (cast: Cast): readonly StudyMapping[] => {
    const out: StudyMapping[] = []
    for (const id of castStudyIds(cast)) {
      out.push(...(findStudy(id)?.mapping ?? []))
      out.push(...(cast.overrides[id]?.mapping ?? []))
    }

    return out
  }

  // The tests and the docs both rely on a silent Prism being exact black. A
  // mapping row adds to a resting value, so black stays black only while no
  // row adds light when every feature is 0 and no stage makes light of its own.
  it('renders exact black: no row lifts light and no stage adds any of its own', () => {
    const prism = findCast('prism')
    if (!prism) throw new Error('Expected the Prism cast')
    for (const row of rowsOf(prism))
      expect(
        row.gain * bend(studyFeature(SILENT, row.from, 0, 1), row.curve),
        `${row.from} to ${row.to} lifts light at a silent packet`,
      ).toBeLessThanOrEqual(0)

    // The grain and the ribbon are the two stages that draw where nothing has
    // been drawn; the rest scale what the inks drew.
    const { post } = resolved(prism, SILENT)
    expect(stageEnabled(post, 'grain')).toBe(false)
    expect(ribbonRuns(post)).toBe(false)
  })
})
