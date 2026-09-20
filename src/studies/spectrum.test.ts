/**
 * The spectrum ring as a study: that it is the ink for a groove on any track, that a
 * silent packet draws nothing, what the music and tension do to it, and the
 * two things the ink is held to, that it is sparse and that it is bright enough
 * to be seen on the canvas the director builds. The bars' numbers and the ink
 * have their own tests beside them; the generic bar every study meets is
 * `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness, momentFit } from '../director/score'
import { HARDSTYLE, HOUSE, LOFI } from '../director/song.fixture'
import {
  advanceSpin,
  BAND_LEVELS,
  BAR_FLOATS,
  barCoverage,
  barRadiusPixels,
  CANVAS_FLOOR,
  fillBars,
  MAX_BARS,
  SPECTRUM_RANGES,
  spectrumParams,
} from '../impls/spectrum.params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { carriedCanvas } from './cast'
import { SPECTRUM_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { castFrame, resolveLive, resolveStudy } from './resolve'
import { MOMENTS } from './types'
import type { Moment } from './types'

const study = findStudy('spectrum-ring')
if (!study) throw new Error('Expected the spectrum ring study')

/** A packet with the fields the ring reads set and everything else at nothing. */
const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

/** A groove: every band sounding at a middling level, a beat and some energy. */
const GROOVE = {
  sub: 0.7,
  bass: 0.6,
  lowMid: 0.5,
  highMid: 0.4,
  treble: 0.3,
  energy: 0.5,
} as const

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

/** How many bars the study lights for a packet, at a tension, on a canvas. */
const lit = (packet: Float32Array, tension = 0, width = 1920, height = 1080) =>
  fillBars(
    spectrumParams(at(packet, tension)),
    packet,
    0,
    width,
    height,
    new Float32Array(MAX_BARS * BAR_FLOATS),
  )

describe('the spectrum ring study', () => {
  it('is the ink for a groove, on any track, with the widest reach there is', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('spectrum')
    expect(study.moments.groove).toBe(1)
    for (const moment of ['intro', 'build', 'drop', 'rest', 'outro'] as const)
      expect(study.moments[moment], moment).toBe(0)
    expect(study.reach).toBe(1)
    for (const axis of Object.values(study.home)) expect(axis).toBe(0.5)
    // One instanced quad a bar and a pool of 96.
    expect(study.cost).toBe('cheap')
  })

  it('offers exactly the implementation’s knobs', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...SPECTRUM_KNOBS].sort())
  })

  it('reads as the spectrum when it is the only ink, on the canvas’s own line', () => {
    expect(sceneOf(['spectrum-ring'])).toBe('spectrum')
  })

  it('is at home with a house, a hardstyle and a lo-fi track alike', () => {
    for (const character of [HOUSE, HARDSTYLE, LOFI])
      expect(closeness(study, character)).toBeGreaterThan(0.6)
  })

  it('suits a groove fully and nothing else at all', () => {
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
      expect(momentFit(study.moments, weights), moment).toBe(moment === 'groove' ? 1 : 0)
    }
  })
})

describe('silence', () => {
  it('lights no bar on a silent packet, at any tension, on any shape', () => {
    for (const tension of [0, 0.25, 0.5, 1])
      for (const [width, height] of SHAPES)
        expect(lit(packetOf(), tension, width, height), `tension ${tension}`).toBe(0)
  })

  it('lights bars as soon as there is sound in a band, and a pulse with no level lights none', () => {
    expect(lit(packetOf({ sub: 0.4 }))).toBeGreaterThan(0)
    expect(lit(packetOf({ subPulse: 1, bassPulse: 1, treblePulse: 1, beatPulse: 1 }))).toBe(0)
  })

  it('draws the whole ring of bars from a groove, with the count the study rests at', () => {
    expect(lit(packetOf(GROOVE))).toBe(study.knobs.bars)
  })
})

describe('what the music does to the ring', () => {
  it('rests at 64 bars on a ring a fifth of the short side out, turning slowly, thin', () => {
    const rest = spectrumParams(at(packetOf({ sub: 0.1 })))
    expect(rest.bars).toBe(64)
    expect(rest.radius).toBeCloseTo(0.22, 12)
    expect(rest.spin).toBeCloseTo(0.02, 12)
    expect(rest.width).toBeLessThan(4)
    expect(rest.hueSpread).toBeGreaterThan(0)
  })

  it('lengthens its bars with the energy, at every step, and stays inside the range', () => {
    const lengths = [0, 0.25, 0.5, 0.75, 1].map(
      (energy) => at(packetOf({ ...GROOVE, energy })).length ?? 0,
    )
    lengths.forEach((value, step) => {
      if (step > 0) expect(value).toBeGreaterThan(lengths[step - 1] ?? 0)
    })

    expect(lengths[4]).toBeLessThanOrEqual(SPECTRUM_RANGES.length[1])
  })

  it('breathes on the beat: a kick opens the ring a little and it comes back', () => {
    const still = at(packetOf({ ...GROOVE, beatPulse: 0 })).radius ?? 0
    const kicked = at(packetOf({ ...GROOVE, beatPulse: 1 })).radius ?? 0
    expect(kicked).toBeGreaterThan(still)
    // A little: under a tenth of the short side from side to side of what the beat does.
    expect(kicked - still).toBeLessThan(0.03)
  })

  it('turns faster on a busy track, and only a little', () => {
    const calm = at(packetOf({ ...GROOVE, pace: 0 })).spin ?? 0
    const busy = at(packetOf({ ...GROOVE, pace: 1 })).spin ?? 0
    expect(busy).toBeGreaterThan(calm)
    expect(busy).toBeLessThan(0.15)
  })

  it('thickens its bars on a heavy low end', () => {
    const thin = at(packetOf({ ...GROOVE, sub: 0, bass: 0 })).width ?? 0
    const kicked = at(packetOf({ ...GROOVE, sub: 1 })).width ?? 0
    const bass = at(packetOf({ ...GROOVE, bass: 1 })).width ?? 0
    expect(kicked).toBeGreaterThan(thin)
    expect(bass).toBe(kicked)
    expect(kicked).toBeLessThan(5)
  })

  it('takes nothing from the key: the palette’s place is the ribbon’s, and its spread is the cast’s', () => {
    expect(at(packetOf({ ...GROOVE, keyHue: 0.7 })).hueSpread).toBe(study.knobs.hueSpread)
  })

  it('dims a little as the music fills the frame and never brightens', () => {
    const quiet = at(packetOf({ ...GROOVE, energy: 0.1, swell: 0.5, hardness: 0.5 })).intensity ?? 0
    const loud = at(packetOf({ ...GROOVE, energy: 1, swell: 1, hardness: 1 })).intensity ?? 0
    expect(loud).toBeLessThan(quiet)
    expect(loud).toBeGreaterThan((study.knobs.intensity ?? 0) / 2)
    expect(quiet).toBeLessThanOrEqual(study.knobs.intensity ?? 0)
  })
})

describe('what tension does to the ring', () => {
  const packet = packetOf(GROOVE)

  it('contracts it: the feet come in as tension climbs, at every step, by seven hundredths of the short side at the top', () => {
    const steps = [0, 0.25, 0.5, 0.75, 1]
    const radius = steps.map((tension) => at(packet, tension).radius ?? 0)
    radius.forEach((value, step) => {
      if (step > 0) expect(value).toBeLessThan(radius[step - 1] ?? 0)
    })

    expect((radius[0] ?? 0) - (radius[4] ?? 0)).toBeCloseTo(0.07, 9)
    expect(radius[4]).toBeGreaterThanOrEqual(SPECTRUM_RANGES.radius[0])
  })

  it('winds it: the turn quickens with tension', () => {
    const spin = [0, 0.5, 1].map((tension) => at(packet, tension).spin ?? 0)
    expect(spin[1]).toBeGreaterThan(spin[0] ?? 0)
    expect(spin[2]).toBeGreaterThan(spin[1] ?? 0)
  })

  it('leaves the light, the length, the width and the count alone, so a build closes the ring in and does not brighten it', () => {
    const calm = at(packet, 0)
    const wound = at(packet, 1)
    expect(wound.intensity).toBe(calm.intensity)
    expect(wound.length).toBe(calm.length)
    expect(wound.width).toBe(calm.width)
    expect(wound.bars).toBe(calm.bars)
  })

  it('never lights a silent build', () => {
    expect(lit(packetOf(), 1)).toBe(0)
  })

  it('does not crowd the bars as the ring closes: the radius is never lifted at its tightest', () => {
    const tightest = spectrumParams(at(filled(1), 1))
    for (const [width, height] of SHAPES)
      expect(barRadiusPixels(tightest, width, height), `${width} by ${height}`).toBeCloseTo(
        tightest.radius * Math.min(width, height),
        6,
      )
  })
})

// The bar for an ink: sparse, and the worst case stated. A bar is thin and the
// canvas keeps 93 percent of itself, so the picture can be smeared to a wash if
// there is too much of it, and this is where that is held.
describe('how much of the frame it lights', () => {
  /** The most the study reaches: a full packet, with every bar at its full length. */
  const worst = () => spectrumParams(at(filled(1), 0))

  it('reaches 64 bars 0.18 of the short side long and 3.5 px wide at its worst', () => {
    const params = worst()
    expect(params.bars).toBe(64)
    expect(params.length).toBeCloseTo(0.18, 9)
    expect(params.width).toBeCloseTo(3.5, 9)
  })

  it('lights under a tenth of the frame at that worst, on every canvas shape', () => {
    for (const [width, height] of SHAPES)
      expect(barCoverage(worst(), width, height), `${width} by ${height}`).toBeLessThan(0.1)
  })

  it('is under 4 percent of a 16:9 frame and 6 percent of a square one, which is the largest', () => {
    expect(barCoverage(worst(), 1920, 1080)).toBeLessThan(0.04)
    expect(barCoverage(worst(), 1080, 1080)).toBeLessThan(0.06)
    expect(barCoverage(worst(), 1080, 1080)).toBeGreaterThan(barCoverage(worst(), 1920, 1080))
  })

  it('lights under a tenth at every tension and every level between, on every shape', () => {
    for (const level of [0.25, 0.5, 0.75, 1])
      for (const tension of [0, 0.5, 1])
        for (const [width, height] of SHAPES)
          expect(
            barCoverage(spectrumParams(at(filled(level), tension)), width, height),
            `level ${level} tension ${tension} ${width} by ${height}`,
          ).toBeLessThan(0.1)
  })

  it('is far under 3 percent of the frame for a single bar, so no bar is a large-area flash', () => {
    const params = { ...worst(), bars: 1 }
    for (const [width, height] of SHAPES)
      expect(barCoverage(params, width, height), `${width} by ${height}`).toBeLessThan(0.005)
  })
})

// Brightness was first chosen from a sum on paper for the last two inks and
// both were invisible on a real adapter, and this one was too: the canvas a
// director builds takes its floor off every pixel every frame and thin light
// that moves does not sum as a still image does. The number this study rests at
// was set from captures beside the ribbon, at a quiet level and a loud one; what
// is held here is that it stays clear of the floor and never rises with the music.
describe('how bright it is on the canvas the director builds', () => {
  const ceilingAt = (packet: Float32Array, tension: number) =>
    resolveLive(
      [{ id: 'spectrum-ring', presence: 1 }],
      carriedCanvas(),
      packet,
      tension,
      castFrame(),
    ).post.feedback.ceiling

  it('reads the canvas’s floor as the params file says', () => {
    expect(carriedCanvas().knobs['feedback.floor']).toBe(CANVAS_FLOOR)
  })

  it('adds many times what the canvas takes off a frame, so a bar builds something', () => {
    expect(study.knobs.intensity ?? 0).toBeGreaterThan(CANVAS_FLOOR * 10)
    // Even the dimmest a loud passage takes it to is well clear of the floor.
    expect(at(filled(1), 0).intensity ?? 0).toBeGreaterThan(CANVAS_FLOOR * 8)
  })

  it('is no brighter at a full packet than at rest, and no brighter with a build', () => {
    const rest = study.knobs.intensity ?? 0
    expect(at(packetOf(GROOVE)).intensity ?? 0).toBeLessThanOrEqual(rest)
    expect(at(filled(1), 0).intensity ?? 0).toBeLessThanOrEqual(rest)
    expect(at(filled(1), 1).intensity ?? 0).toBeLessThanOrEqual(rest)
  })

  it('never adds more on one frame than the canvas’s ceiling at a full packet, and rests far under the top of the range', () => {
    for (const tension of [0, 1])
      expect(at(filled(1), tension).intensity ?? 0).toBeLessThan(ceilingAt(filled(1), tension))
    expect(study.knobs.intensity ?? 0).toBeLessThan(SPECTRUM_RANGES.intensity[1])
  })
})

describe('the same at any frame rate', () => {
  it('turns to the same place after the same seconds at 30, 60, 144 and 240 steps a second, tension and all', () => {
    const turned = [30, 60, 144, 240].map((fps) => {
      let turns = 0
      for (let step = 0; step < 6 * fps; step += 1) {
        const packet = packetOf({ ...GROOVE, pace: 0.4 })
        // Tension climbing across the six seconds, as it does through a build.
        const tension = step / (6 * fps)
        turns = advanceSpin(turns, at(packet, tension).spin ?? 0, 1 / fps)
      }

      return turns
    })

    const [first, ...rest] = turned
    for (const turn of rest) expect(turn).toBeCloseTo(first ?? Number.NaN, 2)
  })

  it('lengthens a bar by the packet alone, so nothing about it depends on how often it is drawn', () => {
    const packet = packetOf(GROOVE)
    const rows = (dt: number) => {
      const out = new Float32Array(MAX_BARS * BAR_FLOATS)
      fillBars(spectrumParams(at(packet)), packet, advanceSpin(0, 0.02, dt), 1920, 1080, out)
      return out.slice(0, BAR_FLOATS * 8)
    }

    // The same packet at two steps: the lengths and colours are the same, and only the turn differs.
    const short = rows(1 / 144)
    const long = rows(1 / 30)
    for (let bar = 0; bar < 8; bar += 1)
      for (const slot of [2, 3, 4, 5, 6]) {
        const index = bar * BAR_FLOATS + slot
        expect(long[index]).toBeCloseTo(short[index] ?? Number.NaN, 5)
      }
  })
})

describe('with other studies', () => {
  it('resolves beside a flow, the ribbon and a look, each on its own numbers', () => {
    const frame = resolveLive(
      [
        { id: 'lazy-fluid', presence: 1 },
        { id: 'ribbon', presence: 1 },
        { id: 'spectrum-ring', presence: 1 },
        { id: 'clean-glass', presence: 1 },
      ],
      carriedCanvas(),
      packetOf(GROOVE),
      0,
      castFrame(),
    )
    const knobs = frame.knobs.get('spectrum-ring')
    expect(Object.keys(knobs ?? {}).sort()).toEqual([...SPECTRUM_KNOBS].sort())
    expect(knobs?.intensity).toBeGreaterThan(0.2)
  })

  it('is not resolved at presence 0', () => {
    const frame = resolveLive(
      [{ id: 'spectrum-ring', presence: 0 }],
      carriedCanvas(),
      packetOf(GROOVE),
      0,
      castFrame(),
    )
    expect(frame.knobs.has('spectrum-ring')).toBe(false)
  })

  it('reads its bands from the packet the resolver was handed and nothing else', () => {
    // The five bands are the only rows a bar's length comes from.
    expect(BAND_LEVELS).toHaveLength(5)
    const only = packetOf({ treble: 0.8 })
    expect(lit(only)).toBeGreaterThan(0)
    expect(lit(packetOf({ energy: 1, keyHue: 0.5, tempoConfidence: 1 }))).toBe(0)
  })
})
