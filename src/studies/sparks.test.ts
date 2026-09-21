/**
 * The sparks as a study: where it lives in the character space, what the music
 * and a build do to its knobs, and that a silent packet through its whole path
 * draws nothing. The field's own numbers have their tests in
 * `impls/particles.params.test.ts` and its GPU side in
 * `impls/ParticleField.test.ts`; the generic bar every study meets is
 * `registry.test.ts`.
 *
 * It used to run on a CPU ring of 96 quads. That pool is gone and the sparks
 * live in a storage buffer now, so the tests that stepped a pool step the
 * field's spawn plan instead: what a hit throws, what it throws when nothing
 * was struck, and what all of it puts in the air at once.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { closeness } from '../director/score'
import { HARDSTYLE, LOFI } from '../director/song.fixture'
import {
  fieldRuns,
  particleCoverage,
  particleParams,
  particlesAlive,
  planSpawns,
  SPARK_RANGES,
  SPARKS_PROFILE,
  spawnState,
} from '../impls/particles.params'
import type { SpawnGroup, SpawnState } from '../impls/particles.params'
import { SPARKS_KNOBS } from './impls'
import { findStudy, sceneOf } from './registry'
import { resolveStudy } from './resolve'
import type { RowState } from './resolve'

const study = findStudy('sparks')
if (!study) throw new Error('Expected the sparks study')

const silent = () => new Float32Array(PACKET_LENGTH)

/** A packet with the named rows set and everything else silent. */
const with_ = (rows: Record<number, number>) => {
  const out = silent()
  for (const [row, value] of Object.entries(rows)) out[Number(row)] = value
  return out
}

const at = (packet: Float32Array, tension = 0) =>
  resolveStudy(study, undefined, packet, tension, 1, {})

/**
 * The same, with the throw's envelope given time to reach the packet it is
 * being held at. The `burst` row reads the treble's own hit through an
 * envelope, so it is where the last second put it and a stateless reading of
 * it is a reading of a study that has just arrived. Two seconds at 60 frames
 * is a dozen time constants of the 320 ms release.
 */
const settled = (packet: Float32Array, tension = 0) => {
  const out: Record<string, number> = {}
  const states: RowState[] = []
  for (let frame = 0; frame < 120; frame += 1)
    resolveStudy(study, undefined, packet, tension, 1, out, 1 / 60, states)
  return out
}

/**
 * The throw frame by frame through one hit: the pulse held for a sixth of a
 * second and then let go, so the envelope's release is what is being read. The
 * hold is counted in frames rather than against a clock, so the hit is the
 * same sixth of a second at 30, 60 and 144 and a comparison between them is
 * the envelope's and not the grid's. A sixth is also a whole number of frames
 * at all three, so `burst` below reads the same instant.
 */
const burstAfterAHit = (fps: number, seconds = 1) => {
  const packet = with_({ ...GROOVE, [F.treblePulse]: 1 })
  const out: Record<string, number> = {}
  const states: RowState[] = []
  const read: number[] = []
  const dt = 1 / fps
  const hold = Math.round(fps / 6)
  for (let frame = 0; frame < Math.round(seconds * fps); frame += 1) {
    packet[F.treblePulse] = frame < hold ? 1 : 0
    resolveStudy(study, undefined, packet, 0, 1, out, dt, states)
    read.push(out.burst ?? 0)
  }

  return {
    peak: Math.max(...read),
    /** The throw that many seconds in, which has to land on a frame. */
    count: (at: number) => read[Math.round(at * fps) - 1] ?? 0,
  }
}

/** A groove: the music is on, the hits are the hats, and nothing is winding up. */
const GROOVE = {
  [F.energy]: 0.5,
  [F.treble]: 0.5,
  [F.highMid]: 0.5,
  [F.pace]: 0.4,
  [F.hardness]: 0.5,
  [F.weight]: 0.4,
  [F.swell]: 0.5,
}

/** The rows a hat writes: the hit itself and where in the treble it landed. */
const hatRows = (strength: number, width: number): Record<number, number> => ({
  [F.trebleHit]: strength,
  [F.trebleHitCentre]: 0.9,
  [F.trebleHitWidth]: width,
})

const NO_HIT: Record<number, number> = {}

/** Everything one run of the spawn planner threw, over a stretch of frames. */
function thrown(
  knobs: Readonly<Record<string, number>>,
  frames: (step: number) => Float32Array,
  steps: number,
  fps = 60,
): number {
  const params = particleParams(knobs, SPARKS_PROFILE)
  const state: SpawnState = spawnState()
  const groups: SpawnGroup[] = []
  let total = 0
  for (let step = 1; step <= steps; step += 1) {
    const live = planSpawns(params, SPARKS_PROFILE, frames(step), 1 / fps, state, groups)
    for (let group = 0; group < live; group += 1) total += groups[group]?.count ?? 0
  }

  return total
}

describe('the sparks study', () => {
  it('is the ink for the groove and the drop and for nothing else', () => {
    expect(study.kind).toBe('ink')
    expect(study.impl).toBe('sparks')
    expect(study.moments).toEqual({ intro: 0, groove: 1, build: 0, drop: 1, rest: 0, outro: 0 })
    expect(study.cost).toBe('cheap')
  })

  it('rests on every knob its implementation has, and no others', () => {
    expect(Object.keys(study.knobs).sort()).toEqual([...SPARKS_KNOBS].sort())
    // The pool is tens of thousands, which is what the field bought over the
    // ring of 96 the sparks had.
    expect(study.knobs.count).toBeGreaterThanOrEqual(10000)
  })

  it('reads as the sparks when it is the only ink, on the canvas’s own line', () => {
    expect(sceneOf(['sparks'])).toBe('sparks')
  })

  // The catalogue says bright and fast, on a groove or a drop, with a moderate
  // reach: a lo-fi track never gets it and a hardstyle one does.
  it('is in the bright, fast corner: a lo-fi character never reaches it and a hardstyle one does', () => {
    expect(closeness(study, LOFI)).toBeLessThan(0.5)
    expect(closeness(study, HARDSTYLE)).toBeGreaterThan(0.6)
    expect(closeness(study, HARDSTYLE)).toBeGreaterThan(closeness(study, LOFI) + 0.25)
    // Moderate: wider than the shards' 0.35 and narrower than the ribbon's 1.
    expect(study.reach).toBeGreaterThan(0.3)
    expect(study.reach).toBeLessThan(0.6)
    // Bright means light on the weight axis, and fast means high on the drive one.
    expect(study.home.weight).toBeLessThan(0.4)
    expect(study.home.drive).toBeGreaterThan(0.6)
  })
})

describe('what the music does to the sparks', () => {
  it('lets a busier track shimmer more between hits, on `pace`', () => {
    const slow = at(with_({ ...GROOVE, [F.pace]: 0.1 }))
    const busy = at(with_({ ...GROOVE, [F.pace]: 0.9 }))
    expect(busy.rate ?? 0).toBeGreaterThan((slow.rate ?? 0) + 250)
  })

  it('throws a harder track faster, on `hardness`', () => {
    const soft = at(with_({ ...GROOVE, [F.hardness]: 0 }))
    const hard = at(with_({ ...GROOVE, [F.hardness]: 1 }))
    expect(hard.speed ?? 0).toBeGreaterThan((soft.speed ?? 0) + 0.2)
  })

  it('throws more sparks while the hats are cracking, and does not brighten them', () => {
    const dull = settled(with_({ ...GROOVE, [F.treblePulse]: 0 }))
    const bright = settled(with_({ ...GROOVE, [F.treblePulse]: 1 }))
    expect(bright.burst ?? 0).toBeGreaterThan(dull.burst ?? 0)
    // The treble is the tempting row for the light, and it would break the
    // rule that a full packet is no brighter than rest, so it must not be
    // there, as a level or as a hit.
    expect(
      study.mapping.filter(
        (row) => (row.from === 'treble' || row.from === 'treblePulse') && row.to === 'intensity',
      ),
    ).toEqual([])
    expect(bright.intensity).toBe(dull.intensity)
  })

  // The envelope is the study saying how long its own hit lasts, rather than
  // taking the extractor's pulse decay as it comes. Up in 5 milliseconds is
  // the crack, one frame at any frame rate; down over 320 is the taper that
  // keeps a run of sixteenths fat.
  it('swells the throw on a hit and tapers it over about a third of a second', () => {
    const read = burstAfterAHit(60)
    const rest = study.knobs.burst ?? 0
    expect(read.peak).toBeGreaterThan(rest + 490)
    // And never past its own gain, so nothing about the shape can add light.
    expect(read.peak).toBeLessThanOrEqual(rest + 500 + 1e-9)
    // The release is 320 ms, so the tail falls by e^(-1) over any 320 ms of
    // itself, wherever the hit ended. Two readings a release apart say so
    // without the test having to know when the pulse let go.
    const early = read.count(0.5) - rest
    const late = read.count(0.82) - rest
    expect(early).toBeGreaterThan(0)
    expect(late / early).toBeCloseTo(Math.exp(-1), 2)
  })

  it('tapers it along the same curve at 30, 60 and 144 frames a second', () => {
    const curves = [30, 60, 144].map((fps) => ({ fps, read: burstAfterAHit(fps) }))
    const first = curves[0]
    if (!first) throw new Error('Expected a frame rate')
    // Sixths of a second, which is a whole number of frames at each of them.
    for (let sixth = 1; sixth <= 6; sixth += 1) {
      const time = sixth / 6
      for (const { fps, read } of curves)
        expect(read.count(time), `${fps} fps at ${time}s`).toBeCloseTo(first.read.count(time), 6)
    }
  })

  it('is no brighter on a full packet than at rest, and dimmer as the music fills', () => {
    const rest = at(silent()).intensity ?? 0
    const full = new Float32Array(PACKET_LENGTH).fill(1)
    const loud = at(full).intensity ?? 0
    expect(loud).toBeLessThan(rest)
    expect(loud).toBeGreaterThan(rest * 0.4)
  })

  it('keeps every knob inside what the field allows at a full packet', () => {
    const full = new Float32Array(PACKET_LENGTH).fill(1)
    for (const tension of [0, 1]) {
      const knobs = settled(full, tension)
      for (const knob of SPARKS_KNOBS) {
        const [low, high] = SPARK_RANGES[knob]
        expect(knobs[knob] ?? 0, knob).toBeGreaterThanOrEqual(low)
        expect(knobs[knob] ?? 0, knob).toBeLessThanOrEqual(high)
      }
    }
  })
})

describe('what tension does to the sparks', () => {
  it('makes a hit throw more and moves nothing else', () => {
    const groove = with_({ ...GROOVE, [F.treblePulse]: 0.6 })
    const calm = settled(groove, 0)
    const wound = settled(groove, 1)
    expect(wound.burst ?? 0).toBeGreaterThan((calm.burst ?? 0) + 400)
    for (const knob of SPARKS_KNOBS) {
      if (knob === 'burst') continue
      expect(wound[knob], knob).toBe(calm[knob])
    }
  })

  it('throws more sparks over a run of hats with tension up', () => {
    const born = (tension: number) => {
      // A run of hats holds the throw's envelope near its top, which is the
      // spray each crack lets go.
      const knobs = settled(with_({ ...GROOVE, [F.treblePulse]: 0.8 }), tension)
      // Sixteenths at 174, a hat every 86 ms, for ten seconds at 60 steps a second.
      let next = 0
      return thrown(
        knobs,
        (step) => {
          const now = step / 60
          const due = now >= next
          if (due) next += 0.086
          return with_({ ...GROOVE, ...(due ? hatRows(0.8, 0.05) : NO_HIT) })
        },
        600,
      )
    }

    expect(born(1)).toBeGreaterThan(born(0) * 1.2)
  })
})

describe('silence through the whole path', () => {
  it('resolves a silent packet and throws nothing, however long it runs', () => {
    const knobs = at(silent())
    // The shimmer is what the rate would spawn, and it rests above zero, so the
    // silent case is the study's own gate and not an empty knob.
    expect(thrown(knobs, () => silent(), 60 * 30)).toBeGreaterThan(0)
    // What must not happen is a hit: nothing was struck, so no burst is planned.
    const params = particleParams(knobs, SPARKS_PROFILE)
    const groups: SpawnGroup[] = []
    const state = spawnState()
    for (let step = 0; step < 60 * 5; step += 1) {
      const live = planSpawns(params, SPARKS_PROFILE, silent(), 1 / 60, state, groups)
      for (let group = 0; group < live; group += 1)
        expect(groups[group]?.shape, 'a silent packet threw a burst').toBe('field')
    }
  })

  it('throws no burst for a hit that a silent band cannot have made, as the bench’s synthetic packet writes', () => {
    const params = particleParams(at(silent()), SPARKS_PROFILE)
    const groups: SpawnGroup[] = []
    const state = spawnState()
    for (let step = 0; step < 120; step += 1) {
      const live = planSpawns(
        params,
        SPARKS_PROFILE,
        with_({ [F.trebleHit]: 0.6, [F.highMidHit]: 0.8 }),
        1 / 60,
        state,
        groups,
      )
      for (let group = 0; group < live; group += 1) expect(groups[group]?.shape).toBe('field')
    }
  })

  it('draws nothing at all when the count is nothing', () => {
    const params = particleParams({ ...at(silent()), count: 0 }, SPARKS_PROFILE)
    expect(fieldRuns(params, 1)).toBe(false)
    expect(planSpawns(params, SPARKS_PROFILE, silent(), 1 / 60, spawnState(), [])).toBe(0)
  })
})

describe('coverage', () => {
  const SHAPES = [
    [320, 320],
    [640, 360],
    [1000, 1000],
    [1920, 1080],
    [1080, 1920],
    [2560, 1440],
    [3840, 1080],
    [3840, 2160],
  ] as const

  /** The knobs the study reaches at the very most, as the field reads them. */
  const reached = (tension: number) => {
    const full = new Float32Array(PACKET_LENGTH).fill(1)
    return particleParams(settled(full, tension), SPARKS_PROFILE)
  }

  it('is under a twentieth of the frame at the most the study’s own mapping reaches, on every shape', () => {
    for (const tension of [0, 1])
      for (const [width, height] of SHAPES)
        expect(
          particleCoverage(reached(tension), width, height),
          `${width} by ${height} at tension ${tension}`,
        ).toBeLessThan(1 / 20)
  })

  it('has a pool that is not what limits it: the throw is, so the pool is never full', () => {
    for (const tension of [0, 1]) {
      const params = reached(tension)
      expect(particlesAlive(params)).toBeLessThan(params.count)
      // Thousands in the air at the busiest, out of a pool of tens of thousands.
      expect(particlesAlive(params)).toBeGreaterThan(1000)
    }
  })
})
