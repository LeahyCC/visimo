/**
 * The dust as a study: where it lives in the character space, that a silent
 * packet through its whole path draws nothing while a quiet passage does, what
 * tension does to it, that it stays sparse at the most its own mapping
 * reaches, and that the same song draws the same dust at any frame rate. The
 * numbers and the ink have their own tests beside them; the generic bar every
 * study meets is `registry.test.ts`.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness } from '../director/score'
import { HARDSTYLE, HOUSE, LOFI } from '../director/song.fixture'
import {
  advanceClock,
  DUST_RANGES,
  dustCoverage,
  dustParams,
  fillSpecks,
  MAX_SPECKS,
  SPECK_AT,
  SPECK_FLOATS,
} from '../impls/dust.params'
import type { DustClock } from '../impls/dust.params'
import { DUST_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { resolveStudy } from './resolve'

const study = findStudy('dust')
if (!study) throw new Error('Expected the dust study')

/** A packet with the fields the dust reads set and everything else at nothing. */
const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

const SIZES = [
  [1920, 1080],
  [1080, 1920],
  [2560, 1440],
  [3840, 2160],
  [3840, 1080],
  [1080, 1080],
  [320, 320],
] as const

describe('the dust study', () => {
  it('is the ink for the quiet end and for nothing else', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('dust')
    expect(study.moments).toEqual({ intro: 1, groove: 0, build: 0, drop: 0, rest: 1, outro: 1 })
    expect(study.cost).toBe('cheap')
  })

  it('offers exactly the implementation’s knobs and rests at nothing to draw', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...DUST_KNOBS].sort())
    expect(study.knobs.count).toBe(0)
    expect(study.knobs.gather).toBe(0)
  })

  it('reads as the dust when it is the only ink, on the canvas’s own line', () => {
    expect(sceneOf(['dust'])).toBe('dust')
  })

  // The handoff says the dust is for soft, slow tracks and hardstyle never
  // gets it. The three tracks are the ones the director's own tests play.
  it('is in the soft, slow corner: a lo-fi track is at home, a house one is a stretch and a hardstyle one is out of reach', () => {
    const lofi = closeness(study, LOFI)
    const house = closeness(study, HOUSE)
    const hardstyle = closeness(study, HARDSTYLE)
    expect(lofi).toBeGreaterThan(0.6)
    expect(house).toBeLessThan(lofi * 0.6)
    expect(hardstyle).toBeLessThan(0.2)
    expect(hardstyle).toBeLessThan(house)
  })
})

describe('silence and quiet', () => {
  const silent = packetOf()

  // A silent packet has to draw nothing, and the count is what says so: it is
  // the level that brings the specks in, and at nothing there is no pass.
  it('resolves a silent packet to a count of nothing, and draws nothing, at any tension', () => {
    for (const tension of [0, 0.5, 1]) {
      const knobs = at(silent, tension)
      expect(knobs.count).toBe(0)
      const out = new Float32Array(MAX_SPECKS * SPECK_FLOATS).fill(-1)
      expect(
        fillSpecks(dustParams(knobs), { travel: 3, seconds: 4 }, silent, 1920, 1080, out),
      ).toBe(0)
      expect(out.every((value) => value === -1)).toBe(true)
    }
  })

  // A quiet passage is not silence, and it is where the dust is meant to show.
  // The energy is scaled by the track's own recent peak, so the quietest a
  // passage gets is a few hundredths and it is well up from that most of the
  // time; the first sound at all already brings a good part of the dust in.
  it('draws in a quiet passage, and starts with the first sound at all', () => {
    for (const energy of [0.01, 0.05, 0.1, 0.3]) {
      const packet = packetOf({ energy })
      const lit = fillSpecks(
        dustParams(at(packet)),
        { travel: 3, seconds: 4 },
        packet,
        1920,
        1080,
        new Float32Array(MAX_SPECKS * SPECK_FLOATS),
      )
      expect(lit, `energy ${energy}`).toBeGreaterThanOrEqual(10)
    }
  })

  it('has more dust in the quiet than under a full packet', () => {
    const loud = at(packetOf({ energy: 1 })).count ?? 0
    for (const energy of [0.1, 0.2, 0.3, 0.5]) {
      const quiet = at(packetOf({ energy })).count ?? 0
      expect(quiet, `energy ${energy}`).toBeGreaterThan(loud * 1.5)
    }

    // It does not fall to nothing under a full packet either: a soft track
    // spends its loudest moments at the top of the scale.
    expect(loud).toBeGreaterThan(10)
  })

  it('rises from silence to a peak in the quiet and falls from there, never past its range', () => {
    const counts = Array.from(
      { length: 101 },
      (_, step) => at(packetOf({ energy: step / 100 })).count ?? 0,
    )
    const peak = Math.max(...counts)
    const peakAt = counts.indexOf(peak)
    expect(counts[0]).toBe(0)
    // The top of the hump is in the middle of the scale and not at its ends.
    expect(peakAt).toBeGreaterThan(20)
    expect(peakAt).toBeLessThan(70)
    for (let step = 1; step <= peakAt; step += 1)
      expect(counts[step]).toBeGreaterThanOrEqual(counts[step - 1] ?? 0)
    for (let step = peakAt + 1; step < counts.length; step += 1)
      expect(counts[step]).toBeLessThanOrEqual(counts[step - 1] ?? 0)
    expect(peak).toBeLessThanOrEqual(DUST_RANGES.count[1])
    for (const count of counts) expect(count).toBeGreaterThanOrEqual(0)
  })
})

describe('what the music does to the dust', () => {
  it('lifts the drift with the swell, so a lifting passage drifts faster than a falling one', () => {
    const falling = at(packetOf({ swell: 0 })).drift ?? 0
    const steady = at(packetOf({ swell: 0.5 })).drift ?? 0
    const lifting = at(packetOf({ swell: 1 })).drift ?? 0
    expect(steady).toBeGreaterThan(falling)
    expect(lifting).toBeGreaterThan(steady)
    // Slow all the way: at the top a speck crosses the frame in under half a minute.
    expect(lifting).toBeLessThan(0.05)
  })

  it('deepens the twinkle with the treble', () => {
    const dull = at(packetOf({ treble: 0 })).twinkle ?? 0
    const bright = at(packetOf({ treble: 1 })).twinkle ?? 0
    expect(bright).toBeGreaterThan(dull + 0.3)
    expect(bright).toBeLessThanOrEqual(DUST_RANGES.twinkle[1])
  })

  it('never gets brighter than at rest as the music gets louder or harder', () => {
    const rest = study.knobs.intensity ?? 0
    for (const packet of [
      packetOf({ energy: 1 }),
      packetOf({ swell: 1 }),
      packetOf({ hardness: 1 }),
    ])
      expect(at(packet).intensity).toBeLessThanOrEqual(rest)
    expect(at(packetOf({ energy: 1, swell: 1, hardness: 1 })).intensity).toBeLessThan(rest * 0.6)
  })
})

describe('what tension does to the dust', () => {
  const packet = packetOf({ energy: 0.3 })

  it('gathers it: the pull toward the centre climbs with tension, to half at a full build', () => {
    const levels = [0, 0.25, 0.5, 0.75, 1].map((tension) => at(packet, tension).gather ?? -1)
    expect(levels[0]).toBe(0)
    for (let step = 1; step < levels.length; step += 1)
      expect(levels[step]).toBeGreaterThan(levels[step - 1] ?? 0)
    expect(levels[4]).toBeCloseTo(0.5, 9)
  })

  it('moves the specks in toward the middle of the frame, and only that', () => {
    const [width, height] = [1920, 1080]
    const draw = (tension: number) => {
      const out = new Float32Array(MAX_SPECKS * SPECK_FLOATS)
      const lit = fillSpecks(
        dustParams(at(packet, tension)),
        { travel: 2, seconds: 3 },
        packet,
        width,
        height,
        out,
      )
      return { lit, out }
    }

    const calm = draw(0)
    const wound = draw(1)
    // The same specks, the same light, the same size: only the place moves.
    expect(wound.lit).toBe(calm.lit)
    let calmReach = 0
    let woundReach = 0
    for (let index = 0; index < calm.lit; index += 1) {
      const base = index * SPECK_FLOATS
      for (const part of [SPECK_AT.radius, SPECK_AT.red, SPECK_AT.green, SPECK_AT.blue])
        expect(wound.out[base + part]).toBe(calm.out[base + part])
      calmReach += Math.hypot(
        (calm.out[base] ?? 0) - width / 2,
        (calm.out[base + 1] ?? 0) - height / 2,
      )

      woundReach += Math.hypot(
        (wound.out[base] ?? 0) - width / 2,
        (wound.out[base + 1] ?? 0) - height / 2,
      )
    }

    expect(woundReach / calmReach).toBeCloseTo(0.5, 3)
  })

  it('does not change the count, the size or the light', () => {
    const calm = at(packet, 0)
    const wound = at(packet, 1)
    for (const knob of DUST_KNOBS) {
      if (knob === 'gather') continue
      expect(wound[knob], knob).toBe(calm[knob])
    }
  })
})

describe('how much of the frame it covers', () => {
  // The most the study's own mapping can reach: the top of the count's hump,
  // at the study's size, whatever the packet does.
  const worst = () => {
    let count = 0
    for (let step = 0; step <= 200; step += 1)
      for (const swell of [0, 0.5, 1])
        count = Math.max(count, at(packetOf({ energy: step / 200, swell })).count ?? 0)
    return dustParams({ size: study.knobs.size ?? 0, count })
  }

  it('is a fraction of a percent at the most its own mapping reaches, on every canvas shape', () => {
    const reach = worst()
    expect(reach.count).toBeGreaterThan(60)
    expect(reach.count).toBeLessThan(80)
    // 70 specks 10 pixels across on a canvas 1080 high.
    expect(dustCoverage(reach, 1080, 1080)).toBeCloseTo(0.006, 3)
    expect(dustCoverage(reach, 1920, 1080)).toBeCloseTo(0.0034, 3)
    for (const [width, height] of SIZES)
      expect(dustCoverage(reach, width, height), `${width} by ${height}`).toBeLessThan(0.0075)
  })

  it('is under a twentieth of the frame with every knob at the top of its range, on every canvas shape', () => {
    const top = dustParams({ count: DUST_RANGES.count[1], size: DUST_RANGES.size[1] })
    for (const [width, height] of SIZES)
      expect(dustCoverage(top, width, height), `${width} by ${height}`).toBeLessThan(1 / 20)
  })

  // Gathering lays specks over one another, and additive light that piles up
  // is what would turn the middle into a white dot. At a full build, half the
  // way in, no pixel is under more than a few of them.
  it('does not pile the specks up at a full build', () => {
    const [width, height] = [1920, 1080]
    const params = { ...worst(), gather: at(packetOf({ energy: 0.3 }), 1).gather ?? 0 }
    const out = new Float32Array(MAX_SPECKS * SPECK_FLOATS)
    let deepest = 0
    for (let step = 0; step < 30; step += 1) {
      const lit = fillSpecks(
        params,
        { travel: step * 0.7, seconds: step * 3 },
        packetOf(),
        width,
        height,
        out,
      )
      const under = new Map<number, number>()
      for (let index = 0; index < lit; index += 1) {
        const x = out[index * SPECK_FLOATS + SPECK_AT.x] ?? 0
        const y = out[index * SPECK_FLOATS + SPECK_AT.y] ?? 0
        const radius = out[index * SPECK_FLOATS + SPECK_AT.radius] ?? 0
        for (let row = Math.floor(y - radius); row <= Math.ceil(y + radius); row += 1)
          for (let column = Math.floor(x - radius); column <= Math.ceil(x + radius); column += 1)
            if ((column - x) ** 2 + (row - y) ** 2 <= radius * radius) {
              const key = row * 8192 + column
              under.set(key, (under.get(key) ?? 0) + 1)
            }
      }

      for (const count of under.values()) deepest = Math.max(deepest, count)
    }

    expect(deepest).toBeLessThanOrEqual(3)
  })
})

describe('the same at any frame rate', () => {
  // The whole path a frame takes: resolve the study, step the clocks, place the
  // specks. A frame rate is only a number of steps, so after the same seconds
  // the same picture is drawn.
  it('draws the same dust after the same seconds at 30, 60, 144 and 240 frames a second', () => {
    const packet = packetOf({ energy: 0.3, swell: 0.7, treble: 0.4, keyHue: 0.2 })
    const drawn = (fps: number) => {
      const clock: DustClock = { travel: 0, seconds: 0 }
      const params = dustParams(at(packet, 0.4))
      for (let frame = 0; frame < fps * 4; frame += 1) advanceClock(clock, params.drift, 1 / fps)
      const out = new Float32Array(MAX_SPECKS * SPECK_FLOATS)
      const lit = fillSpecks(params, clock, packet, 1920, 1080, out)
      return { lit, out }
    }

    const reference = drawn(60)
    expect(reference.lit).toBeGreaterThan(30)
    for (const fps of [30, 144, 240]) {
      const other = drawn(fps)
      expect(other.lit).toBe(reference.lit)
      for (let index = 0; index < reference.lit * SPECK_FLOATS; index += 1)
        expect(other.out[index]).toBeCloseTo(reference.out[index] ?? Number.NaN, 2)
    }
  })
})
