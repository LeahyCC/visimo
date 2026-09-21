/**
 * The particle field's numbers on their own: the knobs clamped, the spawns
 * planned, the step mirrored and the uniform laid out. The pool itself lives
 * on the GPU and never comes back, so these are the decisions either side of
 * it, which are the ones a machine with no adapter can still be held to.
 *
 * The one thing worth saying about the step's test is why a tolerance and not
 * an equality. Drag is closed form and exact at any step, but the flow, the
 * curl and the gravity are integrated with symplectic Euler, so two frame
 * rates agree to the order of the step and not beyond it. The bar is that a
 * particle is in the same place after the same seconds to within a fraction of
 * a pixel, which is what "the same at any frame rate" means for a field.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { PARTICLE_KNOBS } from '../studies/impls'
import {
  attractorX,
  attractorY,
  boidsRun,
  canvasCeiling,
  cellSize,
  curlNoise,
  DUST_PROFILE,
  fieldRuns,
  GRID_SIDE,
  MAX_SPAWN_GROUPS,
  PARTICLE_UNIFORM_FLOATS,
  PARTICLE_UNIFORM_HEAD,
  particleColours,
  particleCoverage,
  particleDiameter,
  particleHit,
  particleParams,
  particlesAlive,
  PIXELS_PER_PARTICLE,
  planSpawns,
  ringPosition,
  ringSpread,
  SPARKS_PROFILE,
  SPAWN_FLOATS,
  spawnState,
  stepParticle,
  TREBLE_BANDS,
  valueNoise,
  writeParticleUniform,
} from './particles.params'
import type { ParticleParams, ParticleState, SpawnGroup } from './particles.params'

const silent = () => new Float32Array(PACKET_LENGTH)

const with_ = (rows: Record<number, number>) => {
  const out = silent()
  for (const [row, value] of Object.entries(rows)) out[Number(row)] = value
  return out
}

/** A hat: the treble struck, the band sounding, and where in it the crack sat. */
const HAT = {
  [F.trebleHit]: 0.8,
  [F.treble]: 0.5,
  [F.trebleHitCentre]: 0.9,
  [F.trebleHitWidth]: 0.05,
}

const groups = (): SpawnGroup[] => []

/** The sparks' knobs with something in every one that matters, for a plan. */
const throwing = (patch: Partial<Record<string, number>> = {}) =>
  particleParams({ count: 5000, rate: 600, burst: 400, life: 0.5, ...patch }, SPARKS_PROFILE)

describe('the knobs', () => {
  it('lays a study’s knobs over the profile’s and clamps both to the profile’s ranges', () => {
    const params = particleParams({ count: 1200, size: 900 }, DUST_PROFILE)
    expect(params.count).toBe(1200)
    // Past the dust's own ceiling on the size, not the vocabulary's.
    expect(params.size).toBe(DUST_PROFILE.ranges.size[1])
    // Everything the study did not name is the profile's resting value.
    expect(params.drag).toBe(DUST_PROFILE.defaults.drag)
    expect(params.flow).toBe(DUST_PROFILE.defaults.flow)
  })

  it('falls back to the profile for a knob that is missing or is not a number', () => {
    const params = particleParams({ count: Number.NaN, size: undefined }, SPARKS_PROFILE)
    expect(params.count).toBe(SPARKS_PROFILE.defaults.count)
    expect(params.size).toBe(SPARKS_PROFILE.defaults.size)
  })

  it('rounds the three counts and holds the pool to what the buffers have', () => {
    const params = particleParams(
      { count: 1e9, rate: 10.6, burst: 3.2, size: 2, intensity: 1 },
      SPARKS_PROFILE,
    )
    expect(params.count).toBe(SPARKS_PROFILE.capacity)
    expect(params.rate).toBe(11)
    expect(params.burst).toBe(3)
  })

  it('gives every knob in the vocabulary a range and every profile a value for it', () => {
    for (const knob of PARTICLE_KNOBS)
      for (const profile of [DUST_PROFILE, SPARKS_PROFILE]) {
        const [low, high] = profile.ranges[knob]
        expect(Number.isFinite(low), `${profile.label} ${knob}`).toBe(true)
        expect(high, `${profile.label} ${knob}`).toBeGreaterThanOrEqual(low)
        expect(profile.defaults[knob], `${profile.label} ${knob}`).toBeGreaterThanOrEqual(low)
        expect(profile.defaults[knob], `${profile.label} ${knob}`).toBeLessThanOrEqual(high)
      }
  })

  it('says a field with no count, no light or no size runs nothing at all', () => {
    const live = throwing({ intensity: 0.1, size: 2 })
    expect(fieldRuns(live, 1)).toBe(true)
    expect(fieldRuns(live, 0)).toBe(false)
    expect(fieldRuns({ ...live, count: 0 }, 1)).toBe(false)
    expect(fieldRuns({ ...live, intensity: 0 }, 1)).toBe(false)
    expect(fieldRuns({ ...live, size: 0 }, 1)).toBe(false)
  })

  it('only runs the grid when a steering term is live and something to look at', () => {
    const base = throwing({ intensity: 1, size: 2 })
    expect(boidsRun(base)).toBe(false)
    expect(boidsRun({ ...base, neighbourhood: 0.1 })).toBe(false)
    expect(boidsRun({ ...base, neighbourhood: 0.1, cohesion: 1 })).toBe(true)
    expect(boidsRun({ ...base, neighbourhood: 0, cohesion: 1 })).toBe(false)
  })
})

describe('the count against the canvas', () => {
  it('never puts more than one particle in its own block of pixels', () => {
    expect(canvasCeiling(1920, 1080)).toBe(Math.floor((1920 * 1080) / PIXELS_PER_PARTICLE))
    expect(canvasCeiling(320, 320)).toBeLessThan(canvasCeiling(1920, 1080))
    expect(canvasCeiling(0, 0)).toBeGreaterThan(0)
  })

  it('holds the coverage to the ceiling, so a small canvas is no denser than a large one', () => {
    const params = throwing({ count: 40000, rate: 40000, burst: 0, life: 1, size: 1.5 })
    const small = particleCoverage(params, 320, 320)
    const large = particleCoverage(params, 1920, 1080)
    expect(small).toBeLessThan(1 / 8)
    expect(large).toBeLessThan(1 / 8)
  })

  it('scales a size with the short side and never draws under a pixel', () => {
    expect(particleDiameter(2, 1920, 1080)).toBeCloseTo(2, 6)
    expect(particleDiameter(2, 3840, 2160)).toBeCloseTo(4, 6)
    expect(particleDiameter(0.001, 320, 320)).toBe(1)
  })
})

describe('what a hit throws', () => {
  it('hears the stronger of the two bands, and only a band that is sounding', () => {
    expect(particleHit(silent(), TREBLE_BANDS)).toBeNull()
    // A hit written on a band with nothing in it, as the bench's packet does.
    expect(particleHit(with_({ [F.trebleHit]: 0.9, [F.highMidHit]: 0.9 }), TREBLE_BANDS)).toBeNull()
    const both = with_({
      [F.trebleHit]: 0.4,
      [F.treble]: 0.5,
      [F.highMidHit]: 0.9,
      [F.highMid]: 0.5,
      [F.highMidHitCentre]: 0.3,
    })
    expect(particleHit(both, TREBLE_BANDS)?.strength).toBeCloseTo(0.9, 6)
    expect(particleHit(both, TREBLE_BANDS)?.centre).toBeCloseTo(0.3, 6)
  })

  it('lays a high hit near the top of the ring and a low one near the bottom', () => {
    expect(ringPosition(0.95)).toBeGreaterThan(0.8)
    expect(ringPosition(0.2)).toBe(0)
    expect(ringPosition(Number.NaN)).toBe(0)
    expect(ringPosition(0.6)).toBeGreaterThan(0)
    expect(ringPosition(0.6)).toBeLessThan(1)
  })

  it('fans a wide hit wider than a narrow one, up to the study’s own ceiling', () => {
    expect(ringSpread(0.2, 1)).toBeGreaterThan(ringSpread(0.05, 1))
    expect(ringSpread(10, 1)).toBe(1)
    expect(ringSpread(0.2, 0.25)).toBeCloseTo(ringSpread(0.2, 1) * 0.25, 9)
    expect(ringSpread(Number.NaN, 1)).toBe(0)
  })

  it('plans a ring burst on a hit and none without one', () => {
    const params = throwing()
    const out = groups()
    const quiet = planSpawns(params, SPARKS_PROFILE, silent(), 1 / 60, spawnState(), out)
    // The shimmer is a field spawn and never a burst.
    for (let group = 0; group < quiet; group += 1) expect(out[group]?.shape).toBe('field')

    const live = planSpawns(params, SPARKS_PROFILE, with_(HAT), 1 / 60, spawnState(), out)
    const burst = out.slice(0, live).find((group) => group.shape === 'ring')
    expect(burst).toBeDefined()
    // A hit at 0.8 spends 0.8 of the throw.
    expect(burst?.count).toBe(Math.round(params.burst * 0.8))
    expect(burst?.x).toBeCloseTo(ringPosition(0.9), 6)
    expect(burst?.radius).toBe(SPARKS_PROFILE.ringRadius)
    expect(burst?.strength).toBeCloseTo(0.8, 6)
  })

  it('never plans a burst for a profile with no bands, however loud the packet', () => {
    const params = particleParams({ count: 5000, rate: 100 }, DUST_PROFILE)
    const out = groups()
    const live = planSpawns(params, DUST_PROFILE, with_(HAT), 1 / 60, spawnState(), out)
    for (let group = 0; group < live; group += 1) expect(out[group]?.shape).toBe('field')
  })

  it('plans nothing at all with no count or no step', () => {
    const out = groups()
    expect(
      planSpawns(throwing({ count: 0 }), SPARKS_PROFILE, with_(HAT), 1 / 60, spawnState(), out),
    ).toBe(0)
    expect(planSpawns(throwing(), SPARKS_PROFILE, with_(HAT), 0, spawnState(), out)).toBe(0)
  })

  it('never plans more groups than the uniform holds', () => {
    const out = groups()
    const state = spawnState()
    for (let step = 0; step < 200; step += 1)
      expect(
        planSpawns(throwing(), SPARKS_PROFILE, with_(HAT), 1 / 60, state, out),
      ).toBeLessThanOrEqual(MAX_SPAWN_GROUPS)
  })
})

describe('the ring the spawns walk', () => {
  it('spawns the same number a second at 30, 60, 144 and 240 steps a second', () => {
    const params = throwing({ rate: 733, burst: 0 })
    const born = (fps: number) => {
      const state = spawnState()
      const out = groups()
      let total = 0
      for (let frame = 0; frame < fps * 5; frame += 1) {
        const live = planSpawns(params, SPARKS_PROFILE, silent(), 1 / fps, state, out)
        for (let group = 0; group < live; group += 1) total += out[group]?.count ?? 0
      }

      return total
    }

    const reference = born(60)
    expect(reference).toBeCloseTo(733 * 5, -1)
    for (const fps of [30, 144, 240]) expect(born(fps) / reference).toBeCloseTo(1, 3)
  })

  it('walks the cursor round the pool and never past it, so a slot is always in range', () => {
    const params = throwing({ count: 1000, rate: 2000, burst: 900 })
    const state = spawnState()
    const out = groups()
    for (let step = 0; step < 500; step += 1) {
      const live = planSpawns(params, SPARKS_PROFILE, with_(HAT), 1 / 60, state, out)
      for (let group = 0; group < live; group += 1) {
        const spawn = out[group]
        expect(spawn?.first).toBeGreaterThanOrEqual(0)
        expect(spawn?.first).toBeLessThan(params.count)
        expect(spawn?.count).toBeLessThanOrEqual(params.count)
      }

      expect(state.cursor).toBeGreaterThanOrEqual(0)
      expect(state.cursor).toBeLessThan(params.count)
    }
  })

  // A rate under one a frame has to keep its remainder, or it rounds to
  // nothing every frame and the field never fills.
  it('keeps a rate under one a frame rather than dropping it', () => {
    const params = throwing({ count: 1000, rate: 20, burst: 0 })
    const state = spawnState()
    const out = groups()
    let total = 0
    for (let frame = 0; frame < 600; frame += 1) {
      const live = planSpawns(params, SPARKS_PROFILE, silent(), 1 / 60, state, out)
      for (let group = 0; group < live; group += 1) total += out[group]?.count ?? 0
    }

    expect(total).toBeGreaterThan(190)
    expect(total).toBeLessThanOrEqual(200)
  })
})

describe('the step', () => {
  const rest = (patch: Partial<ParticleState> = {}): ParticleState => ({
    x: 0.1,
    y: 0.2,
    vx: 0.3,
    vy: -0.1,
    age: 0,
    life: 2,
    seed: 0.4,
    hue: 0.1,
    ...patch,
  })

  const moving = (): ParticleParams =>
    particleParams({ count: 100, size: 2, intensity: 1, life: 2, speed: 0.5 }, SPARKS_PROFILE)

  it('puts a particle in the same place after the same seconds at 30, 60, 144 and 240 steps', () => {
    const params = { ...moving(), curl: 0.4, curlScale: 3 }
    const after = (fps: number) => {
      const particle = rest({ life: 10 })
      for (let frame = 0; frame < fps * 2; frame += 1)
        stepParticle(particle, params, 1 / fps, frame / fps)
      return particle
    }

    const reference = after(60)
    expect(Math.hypot(reference.x - 0.1, reference.y - 0.2)).toBeGreaterThan(0.05)
    for (const fps of [30, 144, 240]) {
      const other = after(fps)
      // A short side is 1080 px on a normal canvas, so 0.001 is about a pixel.
      expect(Math.abs(other.x - reference.x), `${fps} fps x`).toBeLessThan(0.004)
      expect(Math.abs(other.y - reference.y), `${fps} fps y`).toBeLessThan(0.004)
      expect(other.age, `${fps} fps age`).toBeCloseTo(reference.age, 6)
    }
  })

  it('loses speed to the drag at the same rate at any step, which is the closed form', () => {
    const params = { ...moving(), gravity: 0, curl: 0, flow: 0, gather: 0 }
    const after = (fps: number) => {
      const particle = rest({ life: 10, vx: 1, vy: 0 })
      for (let frame = 0; frame < fps; frame += 1) stepParticle(particle, params, 1 / fps, 0)
      return particle.vx
    }

    // One second at a drag of 2 leaves e^-2 of the speed, at every frame rate.
    for (const fps of [30, 60, 144, 240]) expect(after(fps)).toBeCloseTo(Math.exp(-2), 9)
  })

  it('falls along the gravity’s own angle, and rises at half a turn', () => {
    const fall = rest({ vx: 0, vy: 0, life: 10 })
    const rise = rest({ vx: 0, vy: 0, life: 10 })
    const base = { ...moving(), drag: 0, curl: 0, flow: 0, gather: 0, gravity: 1 }
    for (let frame = 0; frame < 60; frame += 1) {
      stepParticle(fall, { ...base, gravityAngle: 0 }, 1 / 60, 0)
      stepParticle(rise, { ...base, gravityAngle: Math.PI }, 1 / 60, 0)
    }

    expect(fall.y).toBeLessThan(0.2)
    expect(rise.y).toBeGreaterThan(0.2)
    expect(fall.y - 0.2).toBeCloseTo(-(rise.y - 0.2), 6)
  })

  it('takes the share of the flow that the knob names, and none with the knob at nothing', () => {
    // A steady current of one short side a second to the right.
    const current = () => [1, 0] as const
    const base = { ...moving(), drag: 0, curl: 0, gravity: 0, gather: 0 }
    const after = (flow: number) => {
      const particle = rest({ vx: 0, vy: 0, life: 10 })
      for (let frame = 0; frame < 60; frame += 1)
        stepParticle(particle, { ...base, flow }, 1 / 60, 0, current)
      return particle.x
    }

    // Half a second squared of acceleration at one short side a second
    // squared, which is where a particle starting at rest gets to.
    expect(after(1) - 0.1).toBeCloseTo(0.5, 1)
    expect(after(0.5) - 0.1).toBeCloseTo(0.25, 1)
    expect(after(0)).toBe(0.1)
  })

  it('draws a particle in toward the attractor and never past it', () => {
    const params = {
      ...moving(),
      drag: 0,
      curl: 0,
      flow: 0,
      gravity: 0,
      gather: 3,
      attractX: 0.5,
      attractY: 0.5,
    }
    const particle = rest({ vx: 0, vy: 0, life: 10, x: 0.4, y: 0.4 })
    expect(attractorX(params)).toBe(0)
    expect(attractorY(params)).toBe(0)
    let last = Math.hypot(particle.x, particle.y)
    for (let frame = 0; frame < 300; frame += 1) {
      stepParticle(particle, params, 1 / 60, 0)
      const now = Math.hypot(particle.x, particle.y)
      expect(now).toBeLessThanOrEqual(last + 1e-12)
      last = now
    }

    expect(last).toBeLessThan(0.01)
  })

  it('dies at its life and stays dead', () => {
    const particle = rest({ life: 0.5 })
    for (let frame = 0; frame < 60; frame += 1) stepParticle(particle, moving(), 1 / 60, 0)
    expect(particle.life).toBe(0)
    const stopped = { ...particle }
    stepParticle(particle, moving(), 1 / 60, 0)
    expect(particle).toEqual(stopped)
  })
})

describe('the curl noise', () => {
  it('stays inside 0 to 1 and repeats on its own cell grid', () => {
    for (let step = 0; step < 200; step += 1) {
      const value = valueNoise(step * 0.37, step * -0.21)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }

    // Smooth: two points a hundredth of a cell apart are close together.
    expect(Math.abs(valueNoise(1.5, 2.5) - valueNoise(1.51, 2.5))).toBeLessThan(0.1)
  })

  it('has next to no divergence, so a particle riding it is stirred and never gathered', () => {
    const e = 1e-3
    for (const [x, y] of [
      [0.3, 1.7],
      [4.1, -2.2],
      [11.5, 6.25],
    ]) {
      const dx =
        (curlNoise((x ?? 0) + e, y ?? 0, 0)[0] - curlNoise((x ?? 0) - e, y ?? 0, 0)[0]) / (2 * e)
      const dy =
        (curlNoise(x ?? 0, (y ?? 0) + e, 0)[1] - curlNoise(x ?? 0, (y ?? 0) - e, 0)[1]) / (2 * e)
      expect(Math.abs(dx + dy)).toBeLessThan(1)
    }
  })

  it('moves on the clock', () => {
    expect(curlNoise(2, 3, 0)[0]).not.toBe(curlNoise(2, 3, 30)[0])
  })
})

describe('the grid', () => {
  it('sizes a cell to the neighbourhood, and never under the canvas over its side', () => {
    const wide = particleParams({ neighbourhood: 0.2 }, SPARKS_PROFILE)
    expect(cellSize(wide, 1920, 1080)).toBeCloseTo(0.2, 9)
    const tight = particleParams({ neighbourhood: 0.0001 }, SPARKS_PROFILE)
    // 1920 by 1080 is 16 / 9 short sides across, over 64 cells.
    expect(cellSize(tight, 1920, 1080)).toBeCloseTo(16 / 9 / GRID_SIDE, 9)
    const none = particleParams({ neighbourhood: 0 }, SPARKS_PROFILE)
    expect(cellSize(none, 1920, 1080)).toBeCloseTo(16 / 9, 9)
  })

  it('always covers the whole canvas, on every shape', () => {
    const params = particleParams({ neighbourhood: 0.05 }, SPARKS_PROFILE)
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [3840, 1080],
      [320, 320],
    ] as const)
      expect(cellSize(params, width, height) * GRID_SIDE).toBeGreaterThanOrEqual(
        Math.max(width, height) / Math.min(width, height) - 1e-9,
      )
  })
})

describe('how much it covers', () => {
  it('counts the rate over a life plus everything the hits can throw, held to the pool', () => {
    const params = throwing({ count: 100000, rate: 1000, burst: 500, life: 0.5 })
    expect(particlesAlive(params, 8)).toBe(1000 * 0.5 + 500 * 8 * 0.5)
    expect(particlesAlive({ ...params, count: 100 }, 8)).toBe(100)
  })

  it('does not change with the size of a canvas at one shape', () => {
    const params = throwing({ count: 20000, rate: 20000, burst: 0, life: 1, size: 2 })
    expect(particleCoverage(params, 1920, 1080)).toBeCloseTo(
      particleCoverage(params, 3840, 2160),
      6,
    )
  })
})

describe('the palette and the uniform', () => {
  it('reads three stops either side of the ribbon’s colour at the key', () => {
    const out = new Float32Array(9)
    particleColours(with_({ [F.keyHue]: 0.3 }), 0.4, out)
    expect(out).toHaveLength(9)
    for (const value of out) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }

    // The two ends differ once there is a spread, and do not without one.
    const flat = new Float32Array(9)
    particleColours(with_({ [F.keyHue]: 0.3 }), 0, flat)
    expect(flat.slice(0, 3)).toEqual(flat.slice(6, 9))
    expect(out.slice(0, 3)).not.toEqual(out.slice(6, 9))
  })

  it('lays the block out as the shader’s struct reads it', () => {
    const params = throwing({
      count: 1234,
      size: 2,
      grow: 0.5,
      intensity: 0.4,
      drag: 1.5,
      gravity: 0.25,
      gravityAngle: 0,
      flow: 0.6,
      neighbourhood: 0.1,
      separation: 1,
      alignment: 2,
      cohesion: 3,
      streak: 0.04,
      hueSpread: 0.2,
    })
    const colours = new Float32Array(9).fill(0.5)
    const out = new Float32Array(PARTICLE_UNIFORM_FLOATS)
    const spawn: SpawnGroup = {
      first: 7,
      count: 9,
      x: 0.75,
      y: 0,
      spread: 0.3,
      speed: 0.5,
      life: 0.6,
      shape: 'ring',
      radius: 0.2,
      cone: 0.4,
      strength: 0.8,
    }
    writeParticleUniform(
      params,
      {
        width: 1920,
        height: 1080,
        dt: 1 / 60,
        time: 12,
        colours,
        groups: [spawn],
        groupCount: 1,
        flowCover: [1.5, 1],
        wrap: true,
      },
      out,
    )

    expect([out[0], out[1], out[2]]).toEqual([1920, 1080, 1080])
    expect(out[3]).toBeCloseTo(1, 6)
    expect(out[4]).toBeCloseTo(1 / 60, 6)
    expect(out[5]).toBe(12)
    expect(out[6]).toBe(1234)
    expect(out[7]).toBeCloseTo(cellSize(params, 1920, 1080), 6)
    expect(out[8]).toBe(1.5)
    // Straight down with y up.
    expect(out[9]).toBeCloseTo(0, 9)
    expect(out[10]).toBeCloseTo(-0.25, 9)
    expect(out[11]).toBeCloseTo(0.6, 6)
    expect(out[15]).toBeCloseTo(0.1, 6)
    expect([out[16], out[17], out[18]]).toEqual([1, 2, 3])
    expect(out[19]).toBeCloseTo(0.04, 6)
    expect([out[22], out[23]]).toEqual([2, 1])
    expect(out[24]).toBeCloseTo(0.4, 6)
    expect(out[26]).toBeCloseTo(params.twinkle, 6)
    expect(out[27]).toBeCloseTo(0.2, 6)
    expect([out[28], out[29], out[30]]).toEqual([1.5, 1, 1])
    expect(out[31]).toBe(GRID_SIDE)
    expect(out[35]).toBeCloseTo(params.heat, 6)
    expect(out[39]).toBeCloseTo(params.pale, 6)
    expect(out[44]).toBe(1)
    expect(out[45]).toBe(1)
    const at = PARTICLE_UNIFORM_HEAD
    const wanted = [7, 9, 0.75, 0, 0.3, 0.5, 0.6, 0, 1, 0.2, 0.4, 0.8]
    for (let slot = 0; slot < SPAWN_FLOATS; slot += 1)
      expect(out[at + slot], `spawn float ${slot}`).toBeCloseTo(wanted[slot] ?? 0, 6)
  })

  it('writes a flow that is not there as no flow, and zeroes the groups it was not given', () => {
    const out = new Float32Array(PARTICLE_UNIFORM_FLOATS).fill(-1)
    writeParticleUniform(
      throwing(),
      {
        width: 800,
        height: 800,
        dt: 1 / 60,
        time: 0,
        colours: new Float32Array(9),
        groups: [],
        groupCount: 0,
        flowCover: null,
        wrap: false,
      },
      out,
    )

    expect(out[30]).toBe(0)
    expect(out[44]).toBe(0)
    expect(out[45]).toBe(0)
    expect(out.slice(PARTICLE_UNIFORM_HEAD).every((value) => value === 0)).toBe(true)
  })
})
