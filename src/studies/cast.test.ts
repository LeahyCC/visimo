/**
 * The five pinned casts against the five presets they came from. This is the
 * whole point of the port: a cast is a different shape, resolved by different
 * code, and it must land on the same numbers. Anything else is a preset
 * quietly changing on the way through.
 *
 * Tension is zero throughout, which is what it is until the estimator lands,
 * and every study's tension row is written so that zero adds nothing.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { defaultPostParams, POST_KNOBS, POST_LANES, POST_STAGES } from '../post/params'
import { findPreset } from '../presets/index'
import { AUDIO_FIELDS } from '../presets/knobs'
import { resolvePost, resolveScene } from '../presets/resolve'
import { parseCast } from './cast'
import { CASTS, findCast } from './casts/index'
import melt from './casts/melt.json'
import plume from './casts/plume.json'
import prism from './casts/prism.json'
import { castFrame, resolveCast } from './resolve'

/** Every field a mapping can read at one level; `lowEnd` is derived and follows. */
const packetAt = (level: number, swell: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') out[F[field]] = level
  out[F.swell] = swell
  return out
}

const PACKETS = [
  { label: 'silence', packet: packetAt(0, 0) },
  { label: 'a full packet', packet: packetAt(1, 1) },
  { label: 'a quiet steady passage', packet: packetAt(0.3, 0.5) },
  { label: 'a loud lifting passage', packet: packetAt(0.7, 0.8) },
  { label: 'a middling passage dropping away', packet: packetAt(0.55, 0.2) },
]

describe('a pinned cast resolves to its preset', () => {
  for (const cast of CASTS) {
    const preset = findPreset(cast.id)

    it(`${cast.name}: the scene knobs match at every packet`, () => {
      if (!preset) throw new Error(`Expected the ${cast.id} preset`)
      for (const { label, packet } of PACKETS) {
        const scene: Record<string, number> = {}
        resolveScene(preset.sceneParams, preset.audioMapping, packet, scene)
        const frame = resolveCast(cast, packet, 0, castFrame())
        // Every knob the drawing scene has, wherever in the cast it now lives:
        // the fluid presets split theirs between a flow and an ink.
        const drawn: Record<string, number> = {}
        for (const knobs of frame.knobs.values())
          for (const [knob, value] of Object.entries(knobs)) if (knob in scene) drawn[knob] = value
        expect(Object.keys(drawn).sort(), `${cast.name} at ${label}`).toEqual(
          Object.keys(scene).sort(),
        )
        for (const [knob, value] of Object.entries(scene))
          expect(drawn[knob], `${cast.name} ${knob} at ${label}`).toBeCloseTo(value, 10)
      }
    })

    it(`${cast.name}: the whole post stack matches at every packet`, () => {
      if (!preset) throw new Error(`Expected the ${cast.id} preset`)
      for (const { label, packet } of PACKETS) {
        const post = resolvePost(
          preset.postParams,
          preset.audioMapping,
          packet,
          defaultPostParams(),
        )
        const { post: mine } = resolveCast(cast, packet, 0, castFrame())
        expect(mine.enabled, `${cast.name} enabled at ${label}`).toBe(post.enabled)
        for (const stage of POST_STAGES)
          expect(mine[stage].enabled, `${cast.name} ${stage} at ${label}`).toBe(post[stage].enabled)
        expect(mine.bloom.weights, `${cast.name} bloom weights at ${label}`).toEqual(
          post.bloom.weights,
        )
        for (const knob of POST_KNOBS)
          expect(POST_LANES[knob].read(mine), `${cast.name} ${knob} at ${label}`).toBeCloseTo(
            POST_LANES[knob].read(post),
            10,
          )
      }
    })
  }

  // Melt's flow is the one number the port does not leave alone, and it is
  // the resting values that have to survive: as a study the fluid under the
  // fractal now answers the music, which a preset's flow never did.
  it('Melt keeps its flow at the numbers the preset set', () => {
    const preset = findPreset('melt')
    const cast = findCast('melt')
    if (!preset || !cast) throw new Error('Expected Melt')
    const frame = resolveCast(cast, packetAt(0, 0), 0, castFrame())
    expect(frame.knobs.get('turbulent-fluid')).toEqual(preset.flowParams)
  })
})

describe('parseCast', () => {
  it('resolves the canvas over the stack’s own feedback defaults', () => {
    const cast = parseCast(plume, 'plume.json')
    expect(cast.canvas.enabled).toBe(true)
    expect(cast.canvas.knobs['feedback.decay']).toBe(0.69)
    expect(cast.canvas.knobs['feedback.amount']).toBe(defaultPostParams().feedback.amount)
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
