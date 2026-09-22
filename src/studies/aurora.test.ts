/**
 * The aurora as a study: that it is the quiet end's ink and nothing else's,
 * that it draws from the level, the mids and the chroma and never from
 * `tension`, `release` or `impact` alone, that a silent packet is black
 * through the whole path, what tension does to it, that a loud passage is
 * never dimmer than a quiet one that has a key, and that the frame it lights
 * at the worst its mapping reaches is under the bar. The maths and the ink
 * have their own tests beside them; the generic bar every study meets is
 * `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness } from '../director/score'
import { TRACKS } from '../director/tracks.fixture'
import {
  AURORA_DEFAULTS,
  AURORA_RANGES,
  auroraHues,
  auroraLit,
  auroraParams,
  sampleAurora,
} from '../impls/aurora.params'
import { carriedCanvas } from './cast'
import { AURORA_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { castFrame, resolveLive, resolveStudy } from './resolve'
import type { RowState } from './resolve'

const study = findStudy('aurora')
if (!study) throw new Error('Expected the aurora study')

const silent = () => new Float32Array(PACKET_LENGTH)

const packetOf = (fields: Partial<Record<keyof typeof F, number>>) => {
  const out = silent()
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

/** Ambient music heard at a quiet passage: a key, soft mids, a little treble, no drums to speak of. */
const QUIET = () =>
  packetOf({ energy: 0.35, keyClarity: 0.8, lowMid: 0.3, highMid: 0.25, treble: 0.15, swell: 0.4 })

/** The loudest, most tonal packet there is, with none of the estimator's rows in it. */
const LOUD = () =>
  packetOf({
    energy: 1,
    keyClarity: 1,
    lowMid: 1,
    highMid: 1,
    treble: 1,
    swell: 1,
    sub: 1,
    bass: 1,
    pace: 1,
    hardness: 1,
  })

/** Drums and no key: loud, atonal. */
const DRUMS = () => packetOf({ energy: 1, keyClarity: 0, sub: 1, bass: 1, treble: 1 })

describe('the aurora study', () => {
  it('is the quiet end’s ink: the intro, the rest and the outro, and a nod at the groove', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('aurora')
    expect(study.moments).toEqual({ intro: 1, groove: 0.3, build: 0, drop: 0, rest: 1, outro: 1 })
    expect(study.cost).toBe('medium')
  })

  it('rests at the numbers the implementation falls back on, and offers exactly its knobs', () => {
    expect(study.knobs).toEqual(AURORA_DEFAULTS)
    expect(Object.keys(study.knobs).sort()).toEqual([...AURORA_KNOBS].sort())
  })

  it('reads as the aurora when it is the only ink', () => {
    expect(sceneOf(['aurora'])).toBe('aurora')
  })

  // The home is the soft, tonal, slow corner: the ambient, orchestral and folk
  // tracks of tracks.fixture. The metal and the dance music are far from it.
  it('is at home with an ambient track and far from a hard one', () => {
    const near = TRACKS.filter((track) =>
      ['ambient', 'ambient house', 'orchestral', 'folk rock'].includes(track.kind),
    )
    expect(near.length).toBeGreaterThan(2)
    for (const track of near)
      expect(closeness(study, track.character), track.name).toBeGreaterThan(0.5)
    const metal = TRACKS.find((track) => track.kind === 'metalcore')
    if (!metal) throw new Error('Expected a metalcore track')
    expect(closeness(study, metal.character)).toBeLessThan(0.15)
  })
})

describe('what draws it', () => {
  it('shows up on a quiet passage of real music with no help from tension, release or impact', () => {
    const quiet = at(QUIET(), 0)
    const params = auroraParams(quiet)
    expect(auroraLit(params)).toBe(true)
    expect(params.intensity).toBeGreaterThan(0.6)
    expect(params.curtains).toBeGreaterThan(2)
  })

  it('reads no row of its own from release or impact, and takes only things away with tension', () => {
    for (const row of study.mapping) {
      expect(['release', 'impact'], `${row.from} to ${row.to}`).not.toContain(row.from)
      if (row.from === 'tension') expect(row.gain, `tension to ${row.to}`).toBeLessThan(0)
    }
  })

  it('is driven by the level, the mids and the chroma', () => {
    const from = (field: string) => study.mapping.some((row) => row.from === field)
    expect(from('energy')).toBe(true)
    expect(from('lowMid')).toBe(true)
    expect(from('highMid')).toBe(true)
    expect(from('keyClarity')).toBe(true)
    expect(from('harmonicChange')).toBe(true)
  })

  it('is black on a silent packet, at full tension too, so no pass is encoded', () => {
    for (const tension of [0, 0.5, 1]) {
      const params = auroraParams(at(silent(), tension))
      expect(params.intensity, `tension ${tension}`).toBeCloseTo(0, 9)
      expect(auroraLit(params)).toBe(false)
    }
  })

  it('draws a dimmer curtain for drums with no key in it, and still draws one', () => {
    const drums = auroraParams(at(DRUMS(), 0))
    const tonal = auroraParams(at(LOUD(), 0))
    expect(auroraLit(drums)).toBe(true)
    expect(drums.intensity).toBeLessThan(tonal.intensity)
  })

  it('is never dimmer for being loud: the light only ever falls from rest, with the key heard', () => {
    const rest = study.knobs.intensity ?? 0
    const loud = at(LOUD(), 0).intensity ?? 0
    expect(loud).toBeLessThanOrEqual(rest + 1e-9)
    // Louder is brighter, or the same, and never less, for a passage that has a key.
    const soft = at(packetOf({ energy: 0.4, keyClarity: 0.9 }), 0).intensity ?? 0
    const fuller = at(packetOf({ energy: 0.8, keyClarity: 0.9 }), 0).intensity ?? 0
    expect(fuller).toBeGreaterThan(soft)
  })

  it('puts the punch into curtains, height, ray sharpness, sway and the ripple', () => {
    const quiet = at(QUIET(), 0)
    const loud = at(LOUD(), 0)
    for (const knob of ['curtains', 'height', 'rays', 'sway', 'ripple'] as const)
      expect(loud[knob] ?? 0, knob).toBeGreaterThan(quiet[knob] ?? 0)
  })

  it('reaches four curtains, nearly, at the top of the level', () => {
    expect(at(LOUD(), 0).curtains ?? 0).toBeGreaterThan(3.5)
    expect(at(LOUD(), 0).curtains ?? 0).toBeLessThanOrEqual(4)
  })

  it('turns the swell into a slower and faster drift', () => {
    expect(at(packetOf({ swell: 1 }), 0).drift ?? 0).toBeGreaterThan(
      at(packetOf({ swell: 0 }), 0).drift ?? 0,
    )
  })

  it('carries the chord as turns added to the key, from harmonicChange, and never past a turn', () => {
    const states: RowState[] = []
    const out: Record<string, number> = {}
    const moving = packetOf({ harmonicChange: 1, energy: 0.5 })
    let last = 0
    let wrapped = false
    for (let frame = 0; frame < 60 * 40; frame += 1) {
      resolveStudy(study, undefined, moving, 0, 1, out, 1 / 60, states)
      const hue = out.hue ?? 0
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(1)
      if (hue < last - 0.5) wrapped = true
      last = hue
    }

    // 0.06 turns a second at a full change: a lap in under twenty seconds.
    expect(wrapped).toBe(true)
    // And whatever that turn, the colour stays inside the arc.
    for (let chord = 0; chord < 1; chord += 0.05) {
      const { base, tip } = auroraHues(0.4, chord)
      expect(base).toBeLessThan(0.5)
      expect(tip).toBeGreaterThan(0.7)
    }
  })
})

describe('what tension does to the aurora', () => {
  // Fewer curtains, lower, dimmer, stiller and slower, and nothing rises.
  it('lowers and dims the curtains, and raises nothing', () => {
    const calm = at(LOUD(), 0)
    const wound = at(LOUD(), 1)
    expect(wound.curtains ?? 0).toBeLessThan((calm.curtains ?? 0) - 1)
    expect(wound.height ?? 0).toBeLessThan((calm.height ?? 0) - 0.2)
    expect(wound.intensity ?? 0).toBeLessThan((calm.intensity ?? 0) - 0.3)
    for (const knob of AURORA_KNOBS) {
      if (knob === 'hue') continue
      expect(wound[knob] ?? 0, knob).toBeLessThanOrEqual((calm[knob] ?? 0) + 1e-9)
    }
  })

  it('dims the light on screen: the same picture with less of it, and less of the frame lit', () => {
    const lit = (tension: number) =>
      sampleAurora(auroraParams(at(LOUD(), tension)), 1920, 1080, 60, 4).mean
    expect(lit(1)).toBeLessThan(lit(0))
  })

  it('cannot take the light under nothing on a silent build: the row is gated by the level', () => {
    expect(at(silent(), 1).intensity ?? 0).toBeCloseTo(0, 9)
    expect(at(silent(), 1).curtains ?? 0).toBeGreaterThan(0)
  })
})

describe('what it may light', () => {
  const packets = [silent(), QUIET(), LOUD(), DRUMS()]

  it('keeps every knob inside its range at silence and at a full packet, at either end of tension', () => {
    for (const packet of packets)
      for (const tension of [0, 1])
        for (const [knob, value] of Object.entries(at(packet, tension))) {
          const range = AURORA_RANGES[knob as keyof typeof AURORA_RANGES]
          expect(value, `${knob} at tension ${tension}`).toBeGreaterThanOrEqual(range[0])
          expect(value, `${knob} at tension ${tension}`).toBeLessThanOrEqual(range[1])
        }
  })

  it('lights well under a third of the frame at the worst its mapping reaches, on every canvas shape', () => {
    // The loudest tonal packet is the worst: the most curtains, the tallest,
    // the sharpest rays. Settled light over 0.3 and over 0.8 of the frame.
    const worst = auroraParams(at(LOUD(), 0))
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
      [2520, 1080],
      [1440, 1080],
      [3840, 1080],
      [1280, 1024],
      [800, 1200],
    ] as const) {
      const share = sampleAurora(worst, width, height)
      expect(share.lit, `${width} by ${height}`).toBeLessThan(0.12)
      expect(share.bright, `${width} by ${height}`).toBeLessThan(0.05)
    }
  })
})

describe('with other studies', () => {
  it('resolves beside a flow and a look, on its own numbers', () => {
    const frame = resolveLive(
      [
        { id: 'curl-drift', presence: 1 },
        { id: 'aurora', presence: 1 },
        { id: 'clean-glass', presence: 1 },
      ],
      carriedCanvas(),
      QUIET(),
      0,
      castFrame(),
    )
    const knobs = frame.knobs.get('aurora')
    expect(Object.keys(knobs ?? {}).sort()).toEqual([...AURORA_KNOBS].sort())
    expect(knobs?.intensity).toBeGreaterThan(0.6)
  })

  it('is not resolved at presence 0', () => {
    const frame = resolveLive(
      [{ id: 'aurora', presence: 0 }],
      carriedCanvas(),
      QUIET(),
      0,
      castFrame(),
    )
    expect(frame.knobs.has('aurora')).toBe(false)
  })
})
