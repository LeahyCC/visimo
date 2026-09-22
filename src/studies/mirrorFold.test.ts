/**
 * The mirror fold as a study, and the one piece of machinery it is the first
 * to use: a flow's patch on the canvas.
 *
 * The fold itself, its arithmetic and the flash rule it is inside are
 * `post/params.test.ts`, where the pass's own reference lives. Here is what
 * the study asks for, that the patch is merged the way it says, and that the
 * director hands it over at the study's presence and takes it away again.
 * The generic bar every study meets is `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { Director } from '../director/director'
import { closeness } from '../director/score'
import { TRACKS } from '../director/tracks.fixture'
import { FOLD_EDGE, FOLD_REACH, foldSectors, MAX_FOLD, POST_LANES } from '../post/params'
import feedbackSource from '../shaders/post.feedback.wgsl?raw'
import { CANVAS_KNOBS, canvasBuffers, carriedCanvas, patchCanvas } from './cast'
import { CASTS } from './casts/index'
import { findStudy, STUDIES } from './registry'
import { castFrame, resolveLive, resolveStudy } from './resolve'
import type { StudyCanvas } from './types'

const study = findStudy('mirror-fold')
if (!study || study.kind !== 'flow') throw new Error('Expected the mirror fold flow')
const patch = study.canvas
if (!patch) throw new Error('Expected the mirror fold to carry a canvas patch')

const silent = () => new Float32Array(PACKET_LENGTH)

const packet = (values: Partial<Record<keyof typeof F, number>>) => {
  const out = silent()
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

/** The canvas this study asks for, resolved through the stack at one packet. */
const canvasAt = (features: Float32Array, tension = 0, presence = 1) => {
  const merged = patchCanvas(carriedCanvas(), patch, presence, canvasBuffers())
  return resolveLive([], merged, features, tension, castFrame()).post.feedback
}

describe('the mirror fold study', () => {
  it('is the flow of a groove and a drop, on the analytic field and cheap', () => {
    expect([study.kind, study.impl, study.cost]).toEqual(['flow', 'analytic', 'cheap'])
    expect(study.moments).toEqual({ intro: 0, groove: 1, build: 0.5, drop: 0.8, rest: 0, outro: 0 })
    // It adds no term to the analytic flow: the swirl and the radial are the
    // two it uses and everything else is off or is a shape of the curl.
    expect(study.knobs['curl']).toBe(0)
    expect(study.knobs['twist']).toBe(0)
    expect(study.knobs['falloff']).toBe(0)
  })

  it('turns slowly enough to read, at rest and at the loudest', () => {
    const swirl = (features: Float32Array, tension = 0) =>
      resolveStudy(study, undefined, features, tension, 1, {})['swirl'] ?? 0
    // Turns a second. At rest a whole turn takes a hundred seconds, and six
    // sectors put a seam past a point about every seventeen.
    expect(swirl(silent())).toBeCloseTo(0.01, 6)
    const loudest = swirl(packet({ energy: 1, swell: 1, harmonicChange: 1 }), 1)
    expect(loudest).toBeCloseTo(0.04, 6)
    // A turn in twenty-five seconds is the fastest it ever goes, which is a
    // kaleidoscope turning and not a pinwheel spinning.
    expect(1 / loudest).toBeGreaterThan(20)
  })

  it('folds on the level and the beat, not on tension alone', () => {
    const mix = (features: Float32Array, tension = 0) => canvasAt(features, tension).foldMix
    // A track that never winds up is still folded: these are the fields that
    // are high on real music for minutes at a time.
    expect(mix(packet({ energy: 0.6 }))).toBeGreaterThan(0.4)
    expect(mix(packet({ energy: 1, swell: 1, beatPulse: 1 }))).toBeGreaterThan(0.9)
    // Quiet is barely creased, and tension on its own cannot make up for it.
    expect(mix(silent())).toBeLessThan(0.2)
    expect(mix(silent(), 1)).toBeLessThan(0.2)
    expect(mix(silent())).toBeLessThan(mix(packet({ energy: 0.3 })))
  })

  it('steps the count up with tension and with impact, and never past a doily', () => {
    const fold = (features: Float32Array, tension = 0) =>
      foldSectors(canvasAt(features, tension).fold)
    expect(fold(silent())).toBe(6)
    expect(fold(silent(), 1)).toBe(8)
    expect(fold(packet({ impact: 1 }))).toBe(10)
    expect(fold(packet({ impact: 1 }), 1)).toBe(12)
    // Whatever a packet does, the count stays a whole even number inside the
    // range the pass allows, so the frame never becomes a doily.
    for (const level of [0, 0.5, 1])
      for (const tension of [0, 0.5, 1]) {
        const features = silent()
        for (const field of ['energy', 'swell', 'impact', 'beatPulse', 'release'] as const)
          features[F[field]] = level
        const count = fold(features, tension)
        expect(count % 2).toBe(0)
        expect(count).toBeGreaterThanOrEqual(6)
        expect(count).toBeLessThanOrEqual(MAX_FOLD)
      }
  })

  it('keeps every other canvas knob exactly where the director had it', () => {
    const base = carriedCanvas()
    const merged = patchCanvas(base, patch, 1, canvasBuffers())
    for (const knob of CANVAS_KNOBS) {
      if (knob === 'feedback.fold' || knob === 'feedback.foldMix') continue
      expect(merged.knobs[knob], knob).toBe(base.knobs[knob])
    }

    // The canvas's own rows are still there, and the patch's come after them.
    expect(merged.mapping.slice(0, base.mapping.length)).toEqual(base.mapping)
    expect(merged.mapping.length).toBe(base.mapping.length + (patch.mapping?.length ?? 0))
  })

  it('costs nothing at all at silence: a black canvas stays black', () => {
    const folded = canvasAt(silent())
    expect(folded.foldMix).toBeGreaterThan(0)
    // The fold moves where light is read from. With nothing drawn there is
    // nothing to read, and none of the numbers that carry light have moved:
    // the whole of the study's patch on a silent packet is the two knobs.
    const plain = resolveLive([], carriedCanvas(), silent(), 0, castFrame()).post
    for (const knob of CANVAS_KNOBS) {
      if (knob === 'feedback.fold' || knob === 'feedback.foldMix') continue
      expect(POST_LANES[knob].read({ ...plain, feedback: folded }), knob).toBe(
        POST_LANES[knob].read(plain),
      )
    }
  })

  it('is at home in the middle and reaches the tracks the catalogue names', () => {
    expect(study.reach).toBeCloseTo(0.4, 6)
    const of = (name: string) => {
      const track = TRACKS.find((entry) => entry.name.startsWith(name))
      if (!track) throw new Error(`Expected ${name} in the fixture`)
      return closeness(study, track.character)
    }

    // The crowded middle it was written for.
    expect(of('Mac Miller')).toBeGreaterThan(0.9)
    expect(of('Noisia')).toBeGreaterThan(0.85)
    expect(of('Radiohead')).toBeGreaterThan(0.8)
    expect(of('John Summit')).toBeGreaterThan(0.8)
    // And the two ends of the space, which it has no business in.
    expect(of('Daft Punk')).toBeLessThan(0.5)
    expect(of('Christian Loffler')).toBeLessThan(0.5)
  })

  it('is transcribed in the pass, off the two floats the uniform has spare', () => {
    expect(feedbackSource).toContain('let sectors = post.floor.z;')
    expect(feedbackSource).toContain('let foldMix = post.floor.w;')
    // The same guard the CPU side has, so no fold and no mix is the lookup
    // the pass always had, with no second read of the history.
    expect(feedbackSource).toContain('if (sectors >= 2.0 && foldMix > 0.0)')
    // Two wedges to a period and the abs that mirrors the second over the
    // first, which is `foldAngle` in post/params.ts.
    expect(feedbackSource).toContain('let period = 2.0 * TWO_PI / sectors;')
    expect(feedbackSource).toContain('return abs(at - period * floor(at / period + 0.5));')
    // The length is put back as it was, so only the angle moves.
    expect(feedbackSource).toContain('vec2<f32>(cos(aimed), sin(aimed)) * radius')
    // The mix is a cross-fade of two reads, thinned past the fold's reach.
    expect(feedbackSource).toContain('let amount = foldMix * held;')
    expect(feedbackSource).toContain(
      'got = mix(got, read(folded / aspect + vec2<f32>(0.5), crisp), amount);',
    )
    for (const name of [`FOLD_REACH: f32 = ${FOLD_REACH}`, `FOLD_EDGE: f32 = ${FOLD_EDGE}`])
      expect(feedbackSource).toContain(name)
  })
})

describe('a flow’s patch on the canvas', () => {
  const base = carriedCanvas()
  const named: StudyCanvas = {
    knobs: { 'feedback.fold': 8, 'feedback.zoom': 1.02 },
    mapping: [{ from: 'energy', to: 'feedback.foldMix', gain: 0.5, curve: 'linear' }],
  }

  it('is the canvas it was given when there is no patch', () => {
    expect(patchCanvas(base, undefined, 1, canvasBuffers())).toBe(base)
  })

  it('is the canvas it was given at presence 0, and not a copy of it', () => {
    expect(patchCanvas(base, named, 0, canvasBuffers())).toBe(base)
    expect(patchCanvas(base, named, -1, canvasBuffers())).toBe(base)
  })

  it('is the patch at presence 1', () => {
    const merged = patchCanvas(base, named, 1, canvasBuffers())
    expect(merged.knobs['feedback.fold']).toBe(8)
    expect(merged.knobs['feedback.zoom']).toBe(1.02)
    expect(merged.knobs['feedback.decay']).toBe(base.knobs['feedback.decay'])
    expect(merged.mapping.at(-1)).toEqual(named.mapping?.[0])
  })

  it('walks each knob from the canvas’s own value by presence', () => {
    for (const presence of [0.25, 0.5, 0.75]) {
      const merged = patchCanvas(base, named, presence, canvasBuffers())
      const from = base.knobs['feedback.fold']
      expect(merged.knobs['feedback.fold']).toBeCloseTo(from + (8 - from) * presence, 9)
      const zoom = base.knobs['feedback.zoom']
      expect(merged.knobs['feedback.zoom']).toBeCloseTo(zoom + (1.02 - zoom) * presence, 9)
      // A row fades by the same presence, so the knob and what drives it
      // arrive together rather than the row landing at full strength.
      expect(merged.mapping.at(-1)?.gain).toBeCloseTo(0.5 * presence, 9)
    }
  })

  it('allocates nothing once its buffers have been grown', () => {
    const buffers = canvasBuffers()
    const first = patchCanvas(base, named, 0.5, buffers)
    const rows = first.mapping
    const second = patchCanvas(base, named, 0.9, buffers)
    expect(second).toBe(first)
    expect(second.mapping).toBe(rows)
  })

  // Only a flow may carry a patch: a cast has exactly one flow, so there is
  // exactly one, and two inks patching the same canvas would fight.
  it('is a flow’s alone, and the type is what says so', () => {
    const carrying = STUDIES.filter((entry) => 'canvas' in entry && entry.canvas !== undefined)
    expect(carrying.map((entry) => entry.id)).toEqual(['mirror-fold'])
    for (const entry of carrying) expect(entry.kind).toBe('flow')
  })
})

describe('the director and a flow’s canvas', () => {
  const step = (director: Director, features: Float32Array, seconds: number, dt = 1 / 60) => {
    let last = director.step(features, dt)
    for (let at = dt; at < seconds; at += dt) last = director.step(features, dt)
    return last
  }

  /** A packet loud enough to be a groove, so the fold's own flow can win. */
  const groove = () => {
    const out = silent()
    for (const field of ['energy', 'swell', 'beatPulse', 'pace'] as const) out[F[field]] = 0.8
    return out
  }

  it('hands the canvas over untouched while no flow carries a patch', () => {
    const director = new Director({ studies: [] })
    const live = step(director, groove(), 1)
    expect(live.canvas.knobs['feedback.fold']).toBe(0)
    expect(live.canvas.knobs['feedback.foldMix']).toBe(0)
  })

  it('a pinned cast’s own canvas file still wins', () => {
    const pinned = CASTS[0]
    if (!pinned) throw new Error('Expected a pinned cast')
    const director = new Director({ pinned })
    const live = step(director, groove(), 1)
    expect(live.canvas).toBe(pinned.canvas)
    expect(live.canvas.knobs['feedback.fold']).toBe(0)
  })

  it('brings the fold in with the flow and takes it away again', () => {
    // Only this flow and the studies a cast needs beside it, so the pick is
    // not a race between flows: what is under test is the fade.
    const look = findStudy('warm-soft')
    const ink = findStudy('dust')
    if (!look || !ink) throw new Error('Expected a look and an ink')
    const director = new Director({ studies: [study, ink, look], glideSeconds: 2 })
    const features = groove()
    const first = director.step(features, 1 / 60)
    const arriving = first.canvas.knobs['feedback.fold'] ?? 0
    // One frame into a two second glide the fold is barely there.
    expect(arriving).toBeGreaterThan(0)
    expect(arriving).toBeLessThan(1)
    const settled = step(director, features, 4)
    expect(settled.canvas.knobs['feedback.fold']).toBeCloseTo(6, 6)
    expect(settled.canvas.knobs['feedback.foldMix']).toBeCloseTo(0.12, 6)
    // And the rest of the canvas is the director's own, untouched.
    const base = carriedCanvas()
    for (const knob of CANVAS_KNOBS) {
      if (knob === 'feedback.fold' || knob === 'feedback.foldMix') continue
      expect(settled.canvas.knobs[knob], knob).toBe(base.knobs[knob])
    }
  })
})
