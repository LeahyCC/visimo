/**
 * Every preset, walked. Nothing here names a preset except Prism's silence, so
 * a preset or a study added later is held to the same rules without anyone
 * remembering to add it: it must drive every post stage it switches on, and
 * nothing it maps may leave a safe range at silence or at full level.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  defaultPostParams,
  isPostKnob,
  POST_KNOBS,
  POST_LANES,
  POST_STAGES,
  ribbonRuns,
  stageEnabled,
} from '../post/params'
import type { PostKnob, PostStage } from '../post/params'
import { PRESETS } from './index'
import { AUDIO_FIELDS } from './knobs'
import type { SceneValues } from './knobs'
import { bend, resolvePost, resolveScene } from './resolve'
import type { Mapping, Preset } from './types'

/** Every field a mapping can read at one level. `lowEnd` is derived, so it follows. */
const packetAt = (level: number, swell: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') out[F[field]] = level
  // Swell is centred, so 0 and 1 are a breakdown and a drop and 0.5 is steady;
  // it gets its own sweep because neither extreme of the others reaches 0.5.
  out[F.swell] = swell
  return out
}

const SILENT = packetAt(0, 0)
const FULL = packetAt(1, 1)

const PACKETS = [0, 1].flatMap((level) =>
  [0, 0.5, 1].map((swell) => ({
    label: `level ${level}, swell ${swell}`,
    packet: packetAt(level, swell),
  })),
)

const resolved = (preset: Preset, packet: Float32Array) => {
  const scene: Record<string, number> = {}
  resolveScene(preset.sceneParams, preset.audioMapping, packet, scene)
  return {
    post: resolvePost(preset.postParams, preset.audioMapping, packet, defaultPostParams()),
    scene,
  }
}

/**
 * What every lane may reach, inclusive. Written out for all of them, so a new
 * lane will not compile until someone says what its safe range is.
 *
 * The feedback gain is `amount x decay` and must stay clear of 1, where a
 * still image sums without bound, so decay stops at 0.98 with the amount at
 * most 1. The bloom threshold has a floor well above 0, because a threshold
 * near 0 blooms the whole frame, and the exposure a band either side of 1.
 */
const SAFE: Record<PostKnob, readonly [number, number]> = {
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
  'tonemap.exposure': [0.6, 1.5],
  'tonemap.shoulder': [0, 0.98],
  'grain.amount': [0, 0.08],
}

const MAX_FEEDBACK_GAIN = 0.98

/** These may run backwards; every other scene knob is a size, a rate or a level. */
const SIGNED_KNOBS = new Set(['zoomSpeed', 'rotationSpeed', 'travelSpeed', 'colourDrift'])

describe('every preset stays inside a safe range', () => {
  for (const preset of PRESETS) {
    it(`${preset.name}: post lanes at silence, full level and each swell`, () => {
      for (const { label, packet } of PACKETS) {
        const { post } = resolved(preset, packet)
        for (const knob of POST_KNOBS) {
          const [low, high] = SAFE[knob]
          const value = POST_LANES[knob].read(post)
          expect(value, `${preset.name} ${knob} at ${label}`).toBeGreaterThanOrEqual(low)
          expect(value, `${preset.name} ${knob} at ${label}`).toBeLessThanOrEqual(high)
        }

        expect(
          post.feedback.amount * post.feedback.decay,
          `${preset.name} feedback gain at ${label}`,
        ).toBeLessThan(MAX_FEEDBACK_GAIN)
      }
    })

    it(`${preset.name}: scene knobs never go negative unless they turn both ways`, () => {
      for (const { label, packet } of PACKETS) {
        for (const [knob, value] of Object.entries(resolved(preset, packet).scene)) {
          expect(Number.isFinite(value), `${preset.name} ${knob} at ${label}`).toBe(true)
          if (!SIGNED_KNOBS.has(knob))
            expect(value, `${preset.name} ${knob} at ${label}`).toBeGreaterThanOrEqual(0)
        }
      }
    })

    // Loud and hard passages get their force from motion and structure, so the
    // light and the colour come back a little, and the exposure with them.
    it(`${preset.name}: a full packet is no brighter and no more saturated than rest`, () => {
      const { post, scene } = resolved(preset, FULL)
      const base: SceneValues = preset.sceneParams
      for (const knob of ['intensity', 'saturation']) {
        const rest = base[knob]
        expect(rest, `${preset.name} has no ${knob}`).toBeDefined()
        expect(scene[knob], `${preset.name} ${knob} at a full packet`).toBeLessThanOrEqual(
          (rest ?? 0) + 1e-9,
        )
      }

      expect(post.tonemap.exposure, `${preset.name} exposure at a full packet`).toBeLessThanOrEqual(
        preset.postParams.tonemap.exposure + 1e-9,
      )
    })
  }
})

/** Whether some row with a real gain aims at this stage. */
const driven = (mapping: readonly Mapping<string>[], stage: PostStage) =>
  mapping.some((row) => row.to.startsWith(`${stage}.`) && row.gain !== 0)

/** Whether a lane of the stage lands somewhere else at full level than at silence. */
const moves = (preset: Preset, stage: PostStage) =>
  POST_KNOBS.filter((knob) => knob.startsWith(`${stage}.`)).some((knob) =>
    PACKETS.some(({ packet }) => {
      const now = POST_LANES[knob].read(resolved(preset, packet).post)
      return Math.abs(now - POST_LANES[knob].read(resolved(preset, SILENT).post)) > 1e-12
    }),
  )

describe('nothing on screen is static', () => {
  for (const preset of PRESETS) {
    it(`${preset.name}: every post stage it switches on is driven by the music`, () => {
      for (const stage of POST_STAGES) {
        if (!stageEnabled(preset.postParams, stage)) continue
        expect(
          driven(preset.audioMapping, stage),
          `${preset.name} enables ${stage} and maps nothing onto it`,
        ).toBe(true)
        expect(moves(preset, stage), `${preset.name} maps ${stage} but nothing moves it`).toBe(true)
      }
    })

    it(`${preset.name}: the scene has rows of its own`, () => {
      expect(
        preset.audioMapping.some((row) => !isPostKnob(row.to) && row.gain !== 0),
        `${preset.name} maps nothing onto its scene`,
      ).toBe(true)
    })
  }

  // The guard is only worth having if it can fail.
  it('notices a preset that switches a stage on and drives none of them', () => {
    const first = PRESETS[0]
    if (!first) throw new Error('Expected a preset')
    const on = POST_STAGES.filter((stage) => stageEnabled(first.postParams, stage))
    expect(on.length).toBeGreaterThan(0)
    expect(on.filter((stage) => !driven([], stage))).toEqual(on)
  })

  it('does not count a row with no gain, or one aimed at a neighbouring stage', () => {
    const rows: Mapping<string>[] = [
      { from: 'energy', to: 'bloom.intensity', gain: 0, curve: 'linear' },
      { from: 'energy', to: 'grain.amount', gain: 1, curve: 'linear' },
    ]
    expect(driven(rows, 'bloom')).toBe(false)
    expect(driven(rows, 'grain')).toBe(true)
  })
})

describe('Prism in silence', () => {
  const prism = PRESETS.find((entry) => entry.id === 'prism')

  // The tests and the docs both rely on a silent Prism being exact black. A
  // mapping row adds to a resting value, so black stays black only while no
  // row adds light when every feature is 0 and no stage makes light of its own.
  it('renders exact black: no row lifts light and no stage adds any of its own', () => {
    if (!prism) throw new Error('Expected the Prism preset')
    for (const row of prism.audioMapping)
      expect(
        row.gain * bend(0, row.curve),
        `${row.from} to ${row.to} lifts light at a silent packet`,
      ).toBeLessThanOrEqual(0)

    // The grain and the ribbon are the two stages that draw where the scene
    // has drawn nothing; the rest scale what the scene drew.
    const { post } = resolved(prism, SILENT)
    expect(stageEnabled(post, 'grain')).toBe(false)
    expect(ribbonRuns(post)).toBe(false)
  })
})
