/**
 * The beat rings as a study: that it is the ink for a steady groove and a
 * build, that a silent packet and a track with no steady beat draw nothing,
 * what the music and tension do to it, and the two things the ink is held to,
 * that it is sparse and that it is bright enough to be seen on the canvas the
 * director builds. The rings' numbers and the ink have their own tests beside
 * them; the generic bar every study meets is `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness, momentFit } from '../director/score'
import { HARDSTYLE, HOUSE, LOFI } from '../director/song.fixture'
import {
  arcInside,
  CANVAS_FLOOR,
  CONFIDENCE_ON,
  RING_FLOATS,
  RING_POOL,
  RING_RANGES,
  ringEdgePixels,
  ringParams,
  ringPassPeak,
  RingPool,
  ringReach,
  ringsCoverage,
  ringsPerBeat,
  ringThicknessPixels,
} from '../impls/rings.params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { carriedCanvas } from './cast'
import { RINGS_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { castFrame, resolveLive, resolveStudy } from './resolve'
import { MOMENTS } from './types'
import type { Moment } from './types'

const study = findStudy('beat-rings')
if (!study) throw new Error('Expected the beat rings study')

/** A packet with the fields the rings read set and everything else at nothing. */
const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

/** A steady four to the floor: a beat that is believed, and some sound. */
const GROOVE = { tempoConfidence: 0.85, energy: 0.4 } as const

/** Every audio field at one level, so the two ends of what a packet can be. */
const filled = (level: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') out[F[field]] = level
  return out
}

const SHAPES = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
  [2520, 1080],
  [1440, 1080],
  [3840, 2160],
  [640, 640],
  [3840, 1080],
] as const

/** The tracker's fastest tempo, which is the most rings a second a roll can ask for. */
const FASTEST = 200

describe('the beat rings study', () => {
  it('is the ink for a steady groove and a build, on a steady track, with a moderate reach', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('rings')
    expect(study.moments.groove).toBe(1)
    expect(study.moments.build).toBe(1)
    for (const moment of ['intro', 'drop', 'rest', 'outro'] as const)
      expect(study.moments[moment], moment).toBe(0)
    expect(study.home.steadiness).toBeGreaterThan(0.8)
    expect(study.reach).toBe(0.5)
    // One instanced strip a ring and a pool of 24.
    expect(study.cost).toBe('cheap')
  })

  it('offers exactly the implementation’s knobs', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...RINGS_KNOBS].sort())
  })

  it('reads as the rings when it is the only ink, on the canvas’s own line', () => {
    expect(sceneOf(['beat-rings'])).toBe('rings')
  })

  it('is at home with a house and a hardstyle track and less so with a lo-fi one', () => {
    expect(closeness(study, HOUSE)).toBeGreaterThan(0.9)
    expect(closeness(study, HARDSTYLE)).toBeGreaterThan(0.6)
    expect(closeness(study, LOFI)).toBeLessThan(closeness(study, HOUSE) - 0.3)
  })

  it('suits a groove and a build fully and nothing else at all', () => {
    for (const moment of MOMENTS) {
      const weights: Record<Moment, number> = {
        intro: 0,
        groove: 0,
        build: 0,
        drop: 0,
        rest: 0,
        outro: 0,
        [moment]: 1,
      }
      expect(momentFit(study.moments, weights), moment).toBe(
        moment === 'groove' || moment === 'build' ? 1 : 0,
      )
    }
  })
})

describe('silence and a beat that is not believed', () => {
  // A silent packet has every row at 0, the confidence included, and the
  // intensity is the rest value less the whole of it at a confidence of 0.
  it('resolves a silent packet to no light, at any tension', () => {
    for (const tension of [0, 0.25, 0.5, 1])
      expect(at(packetOf(), tension).intensity, `tension ${tension}`).toBe(0)
  })

  it('draws more as the beat is more surely heard, in step with the confidence', () => {
    const light = [0, 0.2, 0.45, 0.85, 1].map(
      (tempoConfidence) => at(packetOf({ tempoConfidence })).intensity ?? Number.NaN,
    )
    light.forEach((value, step) => {
      if (step > 0) expect(value).toBeGreaterThan(light[step - 1] ?? 0)
    })

    expect(light[0]).toBe(0)
    expect(light[4]).toBeCloseTo(study.knobs.intensity ?? 0, 6)
    expect(light[3]).toBeCloseTo((study.knobs.intensity ?? 0) * 0.85, 6)
  })

  it('is handed no ring, through the whole path, while the beat is under what it believes', () => {
    // A breakdown or a drumless passage: energy, a tempo phase running on and a confidence under the gate.
    const pool = new RingPool()
    const dt = 1 / 60
    for (let step = 0; step < 60 * 8; step += 1) {
      const beats = step * dt * 2
      const packet = packetOf({
        energy: 0.6,
        tempoConfidence: CONFIDENCE_ON - 0.05,
        beatPhase: beats - Math.floor(beats),
      })
      pool.step(packet, dt, ringParams(at(packet)))
    }

    expect(pool.born).toBe(0)
  })

  it('is handed no ring on a silent packet, however long, or with the phase still at zero', () => {
    const pool = new RingPool()
    for (let step = 0; step < 600; step += 1) {
      const packet = packetOf({ tempoConfidence: 0.9, beatPhase: 0 })
      pool.step(packet, 1 / 60, ringParams(at(packet)))
      const silent = packetOf()
      pool.step(silent, 1 / 60, ringParams(at(silent)))
    }

    expect(pool.born).toBe(0)
  })
})

describe('what the music does to the rings', () => {
  const packet = packetOf(GROOVE)

  it('rests at one ring a beat, travelling at a steady rate, thin, with the ribbon’s hue stepping a little', () => {
    const rest = ringParams(at(packet))
    expect(rest.rate).toBe(1)
    expect(rest.speed).toBeCloseTo(0.24, 12)
    expect(rest.hueSpread).toBeGreaterThan(0)
    expect(rest.thickness).toBeLessThan(4)
  })

  it('thickens with the energy, at every step, and stays thin', () => {
    const widths = [0, 0.25, 0.5, 0.75, 1].map(
      (energy) => at(packetOf({ ...GROOVE, energy })).thickness ?? 0,
    )
    widths.forEach((value, step) => {
      if (step > 0) expect(value).toBeGreaterThan(widths[step - 1] ?? 0)
    })

    expect(widths[4]).toBeLessThan(RING_RANGES.thickness[1] / 2)
    expect(widths[4]).toBeLessThanOrEqual(RING_RANGES.thickness[1])
  })

  it('travels a little faster on a heavy low end, and only a little', () => {
    const still = at(packetOf({ ...GROOVE, sub: 0, bass: 0 })).speed ?? 0
    const kicked = at(packetOf({ ...GROOVE, sub: 1 })).speed ?? 0
    const bass = at(packetOf({ ...GROOVE, bass: 1 })).speed ?? 0
    expect(kicked).toBeGreaterThan(still)
    expect(bass).toBe(kicked)
    expect(kicked / still).toBeLessThan(1.5)
    expect(kicked).toBeLessThanOrEqual(RING_RANGES.speed[1])
  })

  it('dims with a beat that is less surely held and takes nothing else from the packet’s loudness', () => {
    const quiet = at(packetOf({ tempoConfidence: 0.85, energy: 0.1 })).intensity ?? 0
    const loud =
      at(packetOf({ tempoConfidence: 0.85, energy: 1, swell: 1, hardness: 1 })).intensity ?? 0
    expect(loud).toBe(quiet)
  })

  it('leaves the colour spread to the cast', () => {
    expect(at(packetOf({ ...GROOVE, keyHue: 0.7 })).hueSpread).toBe(study.knobs.hueSpread)
  })
})

describe('what tension does to the rings', () => {
  const packet = packetOf(GROOVE)

  it('takes the rate from one ring a beat to four, which is the roll, in the beat’s own subdivisions', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1]
    const rate = steps.map((tension) => at(packet, tension).rate ?? 0)
    expect(rate[0]).toBe(1)
    expect(rate[4]).toBe(4)
    rate.forEach((value, step) => {
      if (step > 0) expect(value).toBeGreaterThan(rate[step - 1] ?? 0)
    })

    expect(rate.map(ringsPerBeat)).toEqual([1, 2, 2, 4, 4])
  })

  it('halves the spacing each time the rate doubles: the rings born in a stretch of music go 1, 2, 4', () => {
    const born = [0, 0.5, 1].map((tension) => {
      const pool = new RingPool()
      const dt = 1 / 60
      let last = 0
      for (let step = 0; step <= 8 * 60; step += 1) {
        const beats = 0.1 + step * dt * 2
        last = beats
        const frame = packetOf({ ...GROOVE, beatPhase: beats - Math.floor(beats) })
        pool.step(frame, dt, ringParams(at(frame, tension)))
      }

      expect(last).toBeGreaterThan(16)
      return pool.born
    })

    // Sixteen beats in eight seconds at 120 a minute.
    expect(born).toEqual([16, 32, 64])
  })

  it('shortens the rings’ life as the roll gets faster, so it is a burst of small rings and not a crowd', () => {
    const life = [0, 0.5, 1].map((tension) => at(packet, tension).life ?? 0)
    expect(life[0]).toBeGreaterThan(life[1] ?? 0)
    expect(life[1]).toBeGreaterThan(life[2] ?? 0)
    expect(life[2]).toBeGreaterThan(RING_RANGES.life[0])
  })

  it('leaves the light, the speed and the width alone, so a build adds rings and not brightness', () => {
    const calm = at(packet, 0)
    const wound = at(packet, 1)
    expect(wound.intensity).toBe(calm.intensity)
    expect(wound.speed).toBe(calm.speed)
    expect(wound.thickness).toBe(calm.thickness)
  })

  it('never lights a silent build', () => {
    expect(at(packetOf(), 1).intensity).toBe(0)
  })
})

// The bar for an ink: sparse, and the worst case stated. A ring is a thin
// band and the canvas keeps 93 percent of itself, so the picture can be
// smeared to a wash if there are too many, and this is where that is held.
describe('how much of the frame it lights', () => {
  /** The most the study reaches: a roll at full tension on a loud, low, busy packet, at the fastest tempo. */
  const worst = () => {
    const packet = packetOf({ ...GROOVE, energy: 1, sub: 1, bass: 1 })
    return ringParams(at(packet, 1))
  }

  it('reaches four rings a beat at 3.3 px and 0.32 frame heights a second, for at most 0.9 s, at its worst', () => {
    const params = worst()
    expect(params.rate).toBe(4)
    expect(params.thickness).toBeCloseTo(3.3, 9)
    expect(params.speed).toBeCloseTo(0.32, 9)
    expect(params.life).toBeCloseTo(0.9, 9)
  })

  it('lights under a tenth of the frame at that worst, with the most rings alive, on every canvas shape', () => {
    for (const [width, height] of SHAPES)
      expect(ringsCoverage(worst(), FASTEST, width, height), `${width} by ${height}`).toBeLessThan(
        0.1,
      )
  })

  it('is under 4 percent of a 16:9 frame and 7 percent of a square one, which is the largest', () => {
    expect(ringsCoverage(worst(), FASTEST, 1920, 1080)).toBeLessThan(0.04)
    expect(ringsCoverage(worst(), FASTEST, 1080, 1080)).toBeLessThan(0.07)
    expect(ringsCoverage(worst(), FASTEST, 1080, 1080)).toBeGreaterThan(
      ringsCoverage(worst(), FASTEST, 1920, 1080),
    )
  })

  it('has a full pool at that worst only if the tempo is high enough, and never more than the pool', () => {
    const params = worst()
    const gap = 60 / (4 * FASTEST)
    expect(Math.ceil(params.life / gap)).toBeLessThanOrEqual(RING_POOL)
  })

  it('lights under a tenth at rest too, at any tempo the tracker reports, on every shape', () => {
    const rest = ringParams(at(packetOf(GROOVE), 0))
    for (const [width, height] of SHAPES)
      for (const bpm of [60, 128, FASTEST])
        expect(
          ringsCoverage(rest, bpm, width, height),
          `${width} by ${height} at ${bpm}`,
        ).toBeLessThan(0.1)
  })

  // One ring is one flash in the sense of WCAG 2.3.1, and the rule counts a
  // flash by the area it covers, so what matters is how much of the frame one
  // ring is, at its thickest and at its widest.
  it('is under 2 percent of the frame for one ring, which is far under the large area a flash counts', () => {
    const params = worst()
    for (const [width, height] of SHAPES) {
      const band =
        2 *
        ringReach(
          ringThicknessPixels(params.thickness, width, height),
          ringEdgePixels(width, height),
        )
      let most = 0
      for (let radius = 1; radius < Math.hypot(width, height) / 2; radius += 1)
        most = Math.max(most, (arcInside(radius, width, height) * band) / (width * height))
      expect(most, `${width} by ${height}`).toBeLessThan(0.02)
    }
  })
})

// Brightness was first chosen from a sum on paper for the last two inks and
// both were invisible on a real adapter, because the canvas a director builds
// takes its floor off every pixel every frame and light that moves does not
// sum as a still image does. The rings' number was set by looking at a capture
// beside the ribbon; what is held here is the arithmetic that says it can be seen.
describe('how bright it is on the canvas the director builds', () => {
  const ceilingAt = (packet: Float32Array, tension: number) =>
    resolveLive([{ id: 'beat-rings', presence: 1 }], carriedCanvas(), packet, tension, castFrame())
      .post.feedback.ceiling

  // The canvas moved under these inks when the hold landed: it keeps 0.975 a
  // frame now and fades dim light away rather than subtracting a fixed amount,
  // so a still core sums several times higher than the budget below allows
  // for. Re-budgeting the four inks that carry it is a pass of its own (see
  // docs/open-leads.md), so what the budget was written against is pinned
  // here and the drift is held in plain sight rather than left to be found.
  it('is budgeted against the canvas as it stood before the hold', () => {
    expect(CANVAS_FLOOR).toBe(0.018)
    expect(carriedCanvas().knobs['feedback.floor']).toBe(0)
    expect(carriedCanvas().knobs['feedback.fade']).toBeGreaterThan(0)
    expect(carriedCanvas().knobs['feedback.decay']).toBeGreaterThan(0.93)
  })

  it('adds many times what the canvas takes off a frame, so a moving ring builds something', () => {
    expect(study.knobs.intensity ?? 0).toBeGreaterThan(CANVAS_FLOOR * 20)
    const rest = ringParams(at(packetOf(GROOVE)))
    const peak = ringPassPeak(
      rest.intensity,
      rest.speed * 1080,
      ringThicknessPixels(rest.thickness, 1920, 1080),
      ringEdgePixels(1920, 1080),
    )
    // A pixel reaches all of what one frame adds, and is well over the floor's own scale.
    expect(peak).toBeGreaterThanOrEqual(rest.intensity - 1e-9)
    expect(peak).toBeGreaterThan(CANVAS_FLOOR * 20)
  })

  it('never sums past the ceiling at a full packet, at the slowest and the fastest the mapping travels', () => {
    for (const tension of [0, 1]) {
      const packet = filled(1)
      const ceiling = ceilingAt(packet, tension)
      for (const speed of [study.knobs.speed ?? 0, (study.knobs.speed ?? 0) + 0.08]) {
        const peak = ringPassPeak(
          at(packet, tension).intensity ?? 0,
          speed * 1080,
          ringThicknessPixels(at(packet, tension).thickness ?? 0, 1920, 1080),
          ringEdgePixels(1920, 1080),
        )
        expect(peak, `tension ${tension}, speed ${speed}`).toBeLessThan(ceiling)
      }
    }
  })

  it('is no brighter at a full packet than at rest, and no brighter with a build', () => {
    const rest = at(packetOf(GROOVE)).intensity ?? 0
    expect(at(filled(1), 0).intensity ?? 0).toBeLessThanOrEqual(study.knobs.intensity ?? 0)
    expect(rest).toBeLessThanOrEqual(study.knobs.intensity ?? 0)
    expect(at(filled(1), 1).intensity ?? 0).toBeLessThanOrEqual(study.knobs.intensity ?? 0)
  })
})

describe('the same at any frame rate', () => {
  it('draws the same rings after the same seconds at 30, 60, 144 and 240 steps a second, tension and all', () => {
    const seen = [30, 60, 144, 240].map((fps) => {
      const pool = new RingPool()
      const dt = 1 / fps
      let last = packetOf()
      let params = ringParams(at(last, 0.6))
      for (let step = 0; step <= 4 * fps; step += 1) {
        const beats = 0.3 + step * dt * (128 / 60)
        last = packetOf({
          ...GROOVE,
          sub: 0.5,
          beatPhase: beats - Math.floor(beats),
        })
        params = ringParams(at(last, 0.6))
        pool.step(last, step === 0 ? Number.MIN_VALUE : dt, params)
      }

      const out = new Float32Array(RING_POOL * RING_FLOATS)
      const count = pool.fill(out, params, last, 1920, 1080)
      return Array.from(
        { length: count },
        (_, ring) => out[ring * RING_FLOATS + 3] ?? Number.NaN,
      ).sort((a, b) => a - b)
    })

    const [first, ...rest] = seen
    expect(first?.length).toBeGreaterThan(4)
    for (const other of rest) {
      expect(other.length).toBe(first?.length)
      other.forEach((radius, ring) => expect(radius).toBeCloseTo(first?.[ring] ?? Number.NaN, 2))
    }
  })
})

describe('with other studies', () => {
  it('resolves beside a flow, the ribbon and a look, each on its own numbers', () => {
    const frame = resolveLive(
      [
        { id: 'lazy-fluid', presence: 1 },
        { id: 'ribbon', presence: 1 },
        { id: 'beat-rings', presence: 1 },
        { id: 'clean-glass', presence: 1 },
      ],
      carriedCanvas(),
      packetOf(GROOVE),
      0,
      castFrame(),
    )
    const knobs = frame.knobs.get('beat-rings')
    expect(Object.keys(knobs ?? {}).sort()).toEqual([...RINGS_KNOBS].sort())
    expect(knobs?.intensity).toBeGreaterThan(0.5)
  })

  it('is not resolved at presence 0', () => {
    const frame = resolveLive(
      [{ id: 'beat-rings', presence: 0 }],
      carriedCanvas(),
      packetOf(GROOVE),
      0,
      castFrame(),
    )
    expect(frame.knobs.has('beat-rings')).toBe(false)
  })
})
