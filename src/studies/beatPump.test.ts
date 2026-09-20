/**
 * The beat pump as a study: which way it pushes, that a beat nets to nothing,
 * what a silent packet and a missing beat leave of it, what tension does to it,
 * and where the director puts it. The maths of the field is
 * `impls/analytic.params.test.ts` and the generic bar every study meets is
 * `registry.test.ts`; this is what is particular to this one.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { Director, pickCast } from '../director/director'
import type { MomentWeights } from '../director/moment'
import { HARDSTYLE, HOUSE, LOFI, playSong } from '../director/song.fixture'
import { analyticField, analyticVelocity, fieldMoves } from '../impls/analytic.params'
import { visibleExtent } from '../scenes/fluid.params'
import { carriedCanvas } from './cast'
import { findStudy, STUDIES } from './registry'
import { resolveStudy } from './resolve'
import type { Character } from './types'

const study = findStudy('beat-pump')
if (!study) throw new Error('Expected the beat pump study')
const curlDrift = findStudy('curl-drift')
if (!curlDrift) throw new Error('Expected the curl drift study')

const WIDE = visibleExtent(2560, 1440)
const silent = () => new Float32Array(PACKET_LENGTH)

const heard = (values: Partial<Record<keyof typeof F, number>>) => {
  const packet = silent()
  for (const [name, value] of Object.entries(values)) packet[F[name as keyof typeof F]] = value
  return packet
}

/** A steady beat: the phase we are at and how sure the tracker is of it. */
const beat = (phase: number, confidence = 1, more: Partial<Record<keyof typeof F, number>> = {}) =>
  heard({ beatPhase: phase, tempoConfidence: confidence, ...more })

const at = (packet = silent(), tension = 0, presence = 1) =>
  resolveStudy(study, undefined, packet, tension, presence, {})

/** The radial speed the study asks for at this phase, at full presence. */
const radialAt = (phase: number, confidence = 1, tension = 0) =>
  at(beat(phase, confidence), tension).radial ?? 0

/** The mean of `read` over one beat, sampled at the middle of `steps` equal slices of it. */
const overABeat = (read: (phase: number) => number, steps = 1000) => {
  let sum = 0
  for (let step = 0; step < steps; step += 1) sum += read((step + 0.5) / steps)
  return sum / steps
}

/** A point on the right of the canvas, level with the centre. */
const RIGHT: readonly [number, number] = [0.9, 0.5]

const velocityAt = (phase: number, confidence = 1, tension = 0, point = RIGHT) =>
  analyticVelocity(analyticField(at(beat(phase, confidence), tension), 1, WIDE), point)

/** The mean speed over a grid of the canvas at one phase, and the speed at the corner. */
const frameSpeed = (tension: number, phase = 0) => {
  const field = analyticField(at(beat(phase), tension), 1, WIDE)
  let sum = 0
  let count = 0
  for (let column = 0; column < 64; column += 1)
    for (let row = 0; row < 36; row += 1) {
      const point: [number, number] = [
        (column + 0.5) / 64,
        0.5 + ((row + 0.5) / 36 - 0.5) * 2 * WIDE.y,
      ]
      sum += Math.hypot(...analyticVelocity(field, point))
      count += 1
    }
  const corner = Math.hypot(...analyticVelocity(field, [0.5 + WIDE.x, 0.5 + WIDE.y]))
  return { mean: sum / count, corner }
}

describe('the beat pump study', () => {
  it('is a cheap flow on the analytic implementation, for the groove and the drop', () => {
    expect(study.kind).toBe('flow')
    expect(study.impl).toBe('analytic')
    expect(study.moments).toEqual({ intro: 0, groove: 1, build: 0, drop: 1, rest: 0, outro: 0 })
    expect(study.cost).toBe('cheap')
  })

  it('lives where a beat is steady and hard, with a moderate reach', () => {
    expect(study.home.steadiness).toBeGreaterThanOrEqual(0.85)
    expect(study.home.hardness).toBeGreaterThanOrEqual(0.8)
    expect(study.reach).toBeGreaterThanOrEqual(0.4)
    expect(study.reach).toBeLessThanOrEqual(0.6)
  })

  it('uses the radial term alone', () => {
    for (const phase of [0, 0.3, 0.9])
      for (const tension of [0, 1]) {
        const knobs = at(beat(phase), tension)
        expect([knobs.swirl, knobs.twist]).toEqual([0, 0])
      }
  })

  // A crossfade between two analytic studies blends their knobs, so the shape
  // of a term one of them has switched off must not differ between them.
  it('rests the curl term where curl drift does, so a crossfade does not slide it', () => {
    const rest = at()
    expect(rest.curl).toBe(0)
    expect(rest.curlScale).toBe(curlDrift.knobs.curlScale)
    expect(rest.curlRate).toBe(curlDrift.knobs.curlRate)
    for (const tension of [0, 1])
      for (const packet of [silent(), beat(0.4, 0.9, { energy: 1, swell: 1 })]) {
        const knobs = at(packet, tension)
        expect([knobs.curl, knobs.curlScale, knobs.curlRate]).toEqual([
          0,
          curlDrift.knobs.curlScale,
          curlDrift.knobs.curlRate,
        ])
      }
  })

  it('is in the registry once', () => {
    expect(STUDIES.filter((entry) => entry.id === 'beat-pump')).toHaveLength(1)
  })
})

// The sign and the curve, worked out and then held: positive is outward on
// screen, the feedback pass moves the history with the velocity, and the phase
// is 0 on the beat and rises to 1.
describe('the shape of one beat', () => {
  it('kicks outward on the beat and settles inward before the next', () => {
    const [onBeat] = velocityAt(0)
    const [justBefore] = velocityAt(0.999)
    expect(onBeat).toBeGreaterThan(0)
    expect(justBefore).toBeLessThan(0)
    // A point left of the centre is pushed the other way, which is outward too.
    expect(velocityAt(0, 1, 0, [0.1, 0.5])[0]).toBeLessThan(0)
    // And one above the centre goes up, which is a texture's negative y.
    expect(velocityAt(0, 1, 0, [0.5, 0.3])[1]).toBeLessThan(0)
  })

  it('peaks on the beat and falls in a straight line to the next', () => {
    expect(radialAt(0)).toBeCloseTo(0.12, 12)
    expect(radialAt(0.5)).toBeCloseTo(0, 12)
    expect(radialAt(1)).toBeCloseTo(-0.12, 12)
    let last = radialAt(0)
    for (let phase = 0.05; phase <= 1.0001; phase += 0.05) {
      const now = radialAt(phase)
      expect(now).toBeLessThan(last)
      expect(last - now).toBeCloseTo(0.24 * 0.05, 7)
      last = now
    }
  })

  // The net over a beat is what makes it a pump and not a march: the picture
  // is pushed out as far as it is pulled back, so it breathes about where it
  // was and does not walk off the edge.
  it('nets to nothing over a beat', () => {
    expect(overABeat((phase) => radialAt(phase))).toBeCloseTo(0, 9)
    // At the point of the frame too, not only in the coefficient.
    expect(overABeat((phase) => velocityAt(phase)[0])).toBeCloseTo(0, 9)
  })

  it('nets to nothing over a beat at any falloff tension gives it', () => {
    for (const tension of [0, 0.4, 1])
      for (const point of [RIGHT, [0.7, 0.62], [0.55, 0.5]] as const)
        expect(overABeat((phase) => velocityAt(phase, 1, tension, point)[0])).toBeCloseTo(0, 9)
  })

  it('swings the picture by about 2.5 percent at the rim at 128 BPM, and not more than 4 at 90', () => {
    // The position is the running sum of the velocity; the rim is one
    // reference radius from the centre, so the scale change is the distance
    // moved over that radius.
    const reference = analyticField(at(beat(0)), 1, WIDE).reference
    const swing = (bpm: number) => {
      const seconds = 60 / bpm
      const steps = 2000
      let position = 0
      let low = 0
      let high = 0
      for (let step = 0; step < steps; step += 1) {
        position += radialAt((step + 0.5) / steps) * (seconds / steps)
        low = Math.min(low, position)
        high = Math.max(high, position)
      }
      return (high - low) / reference
    }

    expect(swing(128)).toBeGreaterThan(0.022)
    expect(swing(128)).toBeLessThan(0.027)
    expect(swing(175)).toBeLessThan(swing(128))
    expect(swing(90)).toBeLessThan(0.04)
  })
})

// The bar: the same at any frame rate. The velocity is per second and the
// resolver holds nothing between frames, so the same beat moves the picture
// the same distance at 30, 60 and 144 a second. 120 BPM is a whole number of
// frames at each.
describe('at any frame rate', () => {
  const beatAt = (fps: number) => {
    const frames = fps / 2
    let position = 0
    let high = 0
    for (let frame = 0; frame < frames; frame += 1) {
      const phase = (frame + 0.5) / frames
      position += radialAt(phase) / fps
      high = Math.max(high, position)
    }
    return { net: position, high }
  }

  it('moves the picture the same distance in a beat and returns it', () => {
    const reference = beatAt(144).high
    expect(reference).toBeCloseTo((0.24 * 0.5) / 8, 3)
    for (const fps of [30, 60, 144]) {
      const { net, high } = beatAt(fps)
      expect(net, `${fps} fps`).toBeCloseTo(0, 8)
      expect(Math.abs(high - reference) / reference, `${fps} fps`).toBeLessThan(0.01)
    }
  })
})

// Rows add and do not multiply, so confidence cannot scale the pulse. What it
// takes out is the constant, which is the part that would march the picture.
describe('with no steady beat', () => {
  it('draws nothing at a silent packet, and the flow encodes no pass', () => {
    const knobs = at(silent(), 0)
    expect(knobs.radial).toBe(0)
    expect(knobs.falloff).toBe(0)
    expect(fieldMoves(analyticField(knobs, 1, WIDE))).toBe(false)
  })

  it('stays still before any tempo has been found, however loud the music is', () => {
    // The phase is stuck at 0 and the confidence at 0 until the tracker has
    // locked, and 0 is the top of the sawtooth: an offset in the resting value
    // would leave the picture pushed outward for the whole of that time.
    for (const energy of [0, 0.5, 1]) {
      const knobs = at(heard({ energy, swell: 1, beatPulse: 1 }), 0)
      expect(knobs.radial, `energy ${energy}`).toBe(0)
      expect(fieldMoves(analyticField(knobs, 1, WIDE))).toBe(false)
    }
  })

  it('takes the constant out, and only the constant, as the beat comes in', () => {
    const top = (confidence: number) => radialAt(0, confidence)
    expect(top(0)).toBe(0)
    expect(top(0.05)).toBeGreaterThan(0)
    for (let confidence = 0.05; confidence < 1; confidence += 0.05)
      expect(top(confidence + 0.05)).toBeGreaterThan(top(confidence))
    // The swing does not fade, by design: the tracker keeps the phase running
    // through a bar of doubt. So the pulse is as deep as ever...
    const swing = (confidence: number) => radialAt(0, confidence) - radialAt(1, confidence)
    for (const confidence of [0, 0.2, 0.45, 0.85, 1])
      expect(swing(confidence)).toBeCloseTo(0.24, 12)
  })

  it('is nearly level on a two-step and level on four to the floor', () => {
    const mean = (confidence: number) => overABeat((phase) => radialAt(phase, confidence))
    // ...and what is left is a slow drift inward, at worst half a swing.
    expect(mean(0)).toBeCloseTo(-0.12, 9)
    expect(Math.abs(mean(0.45))).toBeLessThan(0.24 / 5)
    expect(Math.abs(mean(0.85))).toBeLessThan(0.24 / 20)
    expect(mean(1)).toBeCloseTo(0, 9)
    for (const confidence of [0, 0.2, 0.45, 0.85, 1])
      expect(mean(confidence)).toBeLessThanOrEqual(1e-9)
  })

  it('costs nothing at presence 0, and scales the whole swing with presence', () => {
    expect(fieldMoves(analyticField(at(beat(0), 1, 0), 0, WIDE))).toBe(false)
    const half = analyticField(at(beat(0)), 0.5, WIDE)
    expect(half.radial).toBeCloseTo(0.06, 12)
    // The mean stays 0 at any presence, since both rows are scaled.
    expect(overABeat((phase) => analyticField(at(beat(phase)), 0.5, WIDE).radial)).toBeCloseTo(0, 9)
  })
})

// The bar: a test shows tension moving a knob. It cannot make the swing bigger,
// since that is a row's gain and no row multiplies, so it widens the pulse.
describe('what tension does to it', () => {
  it('widens the pulse from the rim toward the whole frame, and leaves the swing alone', () => {
    const calm = at(beat(0), 0)
    const wound = at(beat(0), 1)
    expect(calm.falloff).toBe(0)
    expect(wound.falloff).toBeCloseTo(1.5, 12)
    expect(wound.radial).toBe(calm.radial)
  })

  it('takes the mean speed over the frame up by two thirds and the rim down by a tenth', () => {
    const calm = frameSpeed(0)
    const wound = frameSpeed(1)
    expect(wound.mean / calm.mean).toBeGreaterThan(1.5)
    expect(wound.mean / calm.mean).toBeLessThan(1.8)
    expect(wound.corner / calm.corner).toBeGreaterThan(0.85)
    expect(wound.corner / calm.corner).toBeLessThan(0.95)
  })

  it('deepens it smoothly over the whole of a build', () => {
    let last = frameSpeed(0).mean
    for (let tension = 0.05; tension <= 1.0001; tension += 0.05) {
      const now = frameSpeed(tension).mean
      expect(now).toBeGreaterThan(last)
      expect(now / last).toBeLessThan(1.05)
      last = now
    }
  })

  it('stays inside the range the analytic flow may reach at a full packet', () => {
    for (const phase of [0, 0.5, 0.999])
      for (const tension of [0, 1]) {
        const knobs = at(beat(phase, 1, { energy: 1, swell: 1 }), tension)
        expect(Math.abs(knobs.radial ?? 0)).toBeLessThanOrEqual(0.12 + 1e-12)
        expect(knobs.falloff).toBeLessThanOrEqual(1.5 + 1e-12)
      }
  })
})

// The pump sits on top of the canvas's own beat zoom, which is one-sided: it
// only ever zooms out, faster on the beat. That is why the pump has to be a
// net-zero term of its own and cannot lean on the canvas to bring it back.
describe('beside the canvas', () => {
  it('rides a canvas whose own beat zoom only ever goes outward', () => {
    const canvas = carriedCanvas()
    expect(canvas.knobs['feedback.zoom']).toBeGreaterThan(1)
    const row = canvas.mapping.find((entry) => entry.from === 'beatPhase')
    expect(row?.to).toBe('feedback.zoom')
    expect(row?.gain).toBeGreaterThan(0)
  })
})

describe('in the director', () => {
  const weights = (values: Partial<MomentWeights>): MomentWeights => ({
    intro: 0,
    groove: 0,
    build: 0,
    drop: 0,
    rest: 0,
    outro: 0,
    ...values,
  })

  const characters: Record<string, Character> = {
    'lo-fi': LOFI,
    'house': HOUSE,
    'hardstyle': HARDSTYLE,
  }

  it('is the flow of a hardstyle groove and of its drop', () => {
    for (const moment of ['groove', 'drop'] as const)
      expect(pickCast({ character: HARDSTYLE, weights: weights({ [moment]: 1 }) })?.flow).toBe(
        'beat-pump',
      )
  })

  it('is never the flow of a lo-fi groove or drop, or of any quiet moment or a build', () => {
    for (const moment of ['groove', 'drop', 'build', 'intro', 'rest', 'outro'] as const)
      for (const settled of [0, 1])
        expect(
          pickCast({ character: LOFI, weights: weights({ [moment]: 1 }), settled })?.flow,
          `${moment} settled ${settled}`,
        ).not.toBe('beat-pump')
  })

  it('has no moment of its own outside the groove and the drop', () => {
    for (const [name, character] of Object.entries(characters))
      for (const moment of ['build', 'intro', 'rest', 'outro'] as const)
        expect(
          pickCast({ character, weights: weights({ [moment]: 1 }) })?.flow,
          `${name} ${moment}`,
        ).not.toBe('beat-pump')
  })

  // The whole scripted song, so it is the director's own smoothing and margins
  // that decide and not a single pick.
  it('is cast through a hardstyle song and never through a lo-fi one', () => {
    for (const [name, character] of Object.entries(characters)) {
      const director = new Director()
      let frames = 0
      for (const { dt, features } of playSong(30, character)) {
        director.step(features, dt)
        if (director.cast?.flow === 'beat-pump') frames += 1
      }

      if (name === 'lo-fi') expect(frames, name).toBe(0)
      if (name === 'hardstyle') expect(frames, name).toBeGreaterThan(30 * 60)
    }
  })

  it('leaves an ink beside it, since the dye needs a fluid and there is none', () => {
    const cast = pickCast({ character: HARDSTYLE, weights: weights({ groove: 1 }) })
    expect(cast?.inks.length).toBeGreaterThan(0)
    expect(cast?.inks).not.toContain('dye-plumes')
  })
})
