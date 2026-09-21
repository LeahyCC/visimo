/**
 * The bolts' numbers: that the builder is deterministic and seeded by the
 * section and the count, that a bolt forks deeper on a harder hit, that the
 * light over the life is a closed form of the age, that silence and a quiet
 * passage fire nothing, that the bucket holds the flash rule's three a
 * second, and that the study's worst case stays inside the coverage it
 * claims. The pool's frame-rate proof is here too: the same seconds stepped
 * at 60 and at 144 hand back the same segments at the same light.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  boltEdgePixels,
  boltFade,
  boltFlicker,
  boltHash,
  boltLight,
  boltReach,
  boltWidthPixels,
  buildBolt,
  CORE_LIFT,
  displace,
  lightningCoverage,
  lightningParams,
  LIGHTNING_DEFAULTS,
  LIGHTNING_POOL,
  LightningPool,
  LIGHTNING_RANGES,
  newStrike,
  SEGMENT_FLOATS,
  STRIKE_SEGMENTS,
  writeLightningUniform,
} from './lightning.params'

/** A packet with the fields a test names set, everything else at nothing. */
const packetOf = (fields: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(fields)) out[F[name as keyof typeof F]] = value
  return out
}

/** The strongest drop packet: impact, release up, the low bands hitting. */
const DROP = () =>
  packetOf({ impact: 1, release: 1, subHit: 1, energy: 1, keyHue: 0.6, section: 2 })

/** Every knob at its rest value, the way the study defines them. */
const REST = lightningParams(LIGHTNING_DEFAULTS)

/** The most the study's own mapping reaches: a loud drop at full release. */
const WORST = lightningParams({ ...LIGHTNING_DEFAULTS, length: 0.7, width: 3.2, life: 0.5 })

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

describe('the ranges and the params they clamp', () => {
  it('rests at the defaults the study defines', () => {
    expect(lightningParams({})).toEqual(REST)
    expect(REST).toEqual(LIGHTNING_DEFAULTS)
  })

  it('clamps every knob to its range, and a missing one takes its rest value', () => {
    const wild = { rate: 90, forks: 9, length: -1, width: 40, life: 9, intensity: -3 }
    const params = lightningParams(wild)
    for (const [knob, value] of Object.entries(params)) {
      const range = LIGHTNING_RANGES[knob as keyof typeof LIGHTNING_RANGES]
      expect(value, knob).toBeGreaterThanOrEqual(range[0])
      expect(value, knob).toBeLessThanOrEqual(range[1])
    }

    expect(lightningParams({ rate: Number.NaN }).rate).toBe(REST.rate)
  })
})

describe('midpoint displacement', () => {
  const pick = (channel: number) => boltHash(1234, channel)

  it('makes two to the levels plus one points, holding both ends', () => {
    for (const levels of [1, 2, 3, 5]) {
      const points = displace({ x: -0.4, y: 0.1 }, { x: 0.3, y: -0.2 }, levels, pick, 0)
      expect(points).toHaveLength(2 ** levels + 1)
      expect(points[0]).toEqual({ x: -0.4, y: 0.1 })
      expect(points[points.length - 1]).toEqual({ x: 0.3, y: -0.2 })
    }
  })

  it('kicks only sideways: the channel stays as long as it started', () => {
    const straight = displace({ x: 0, y: 0 }, { x: 1, y: 0 }, 5, () => 0.5, 0)
    let length = 0
    for (let at = 0; at + 1 < straight.length; at += 1) {
      const a = straight[at]
      const b = straight[at + 1]
      if (a && b) length += Math.hypot(b.x - a.x, b.y - a.y)
    }

    expect(length).toBeCloseTo(1, 6)
  })

  it('rebuilds the same channel from the same seed and a different one from another', () => {
    const a = displace({ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, 4, pick, 0)
    const b = displace({ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, 4, pick, 0)
    const c = displace({ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, 4, (n) => boltHash(987, n), 0)
    expect(b).toEqual(a)
    expect(c).not.toEqual(a)
  })
})

describe('the bolt a strike builds', () => {
  const build = (seed: number, strength = 1, params = REST, key = 0.6) => {
    const strike = newStrike()
    buildBolt(strike, seed, strength, params, key)
    return strike
  }

  it('stays inside its segment budget, however deep the forks', () => {
    for (const seed of [1, 7, 42, 1337, 99999])
      expect(build(seed, 1, lightningParams({ ...LIGHTNING_DEFAULTS, forks: 4 })).count).toBeLessThanOrEqual(
        STRIKE_SEGMENTS,
      )
  })

  it('is the same bolt for the same seed and a different one for another section', () => {
    expect(build(77).segments).toEqual(build(77).segments)
    expect(build(77, 1).segments).not.toEqual(build(78, 1).segments)
  })

  it('is near white with only a tint of the key colour in it', () => {
    const built = [0, 0.25, 0.5, 0.75].map((key) => build(5, 1, REST, key))
    for (const strike of built)
      for (const channel of [strike.red, strike.green, strike.blue]) {
        expect(channel).toBeGreaterThan(0.6)
        expect(channel).toBeLessThanOrEqual(1)
      }

    // The tint is the key's: a different key shifts the mix.
    expect(built[0]?.red).not.toBe(built[2]?.red)
  })

  it('forks deeper on a harder hit: a full hit carries more segments than a weak one', () => {
    const deep = build(11, 1, lightningParams({ ...LIGHTNING_DEFAULTS, forks: 4 }))
    const shallow = build(11, 0.2, lightningParams({ ...LIGHTNING_DEFAULTS, forks: 4 }))
    expect(deep.count).toBeGreaterThan(shallow.count)
  })

  it('forks deeper at a higher forks knob: two levels carry fewer segments than four', () => {
    const two = build(11, 1, lightningParams({ ...LIGHTNING_DEFAULTS, forks: 2 }))
    const four = build(11, 1, lightningParams({ ...LIGHTNING_DEFAULTS, forks: 4 }))
    expect(four.count).toBeGreaterThan(two.count)
  })
})

describe('the light across the life', () => {
  it('peaks at one plus the core lift in the middle and is zero past the reach', () => {
    expect(boltLight(0, 3, 1)).toBeCloseTo(1 + CORE_LIFT, 6)
    expect(boltLight(boltReach(3, 1), 3, 1)).toBe(0)
    let last = Number.POSITIVE_INFINITY
    for (let d = 0; d <= boltReach(3, 1); d += 0.05) {
      const at = boltLight(d, 3, 1)
      expect(at).toBeLessThanOrEqual(last)
      last = at
    }
  })

  it('fades to nothing by the end of the life, full at the start', () => {
    expect(boltFade(0, 0.12)).toBe(1)
    expect(boltFade(0.12, 0.12)).toBe(0)
    expect(boltFade(0.06, 0.12)).toBeCloseTo(0.75, 6)
  })

  it('flickers between three quarters and one, on the age alone, the same at any step', () => {
    for (const age of [0, 0.004, 0.013, 0.05, 0.11]) {
      const a = boltFlicker(42, age)
      const b = boltFlicker(42, age)
      expect(a).toBe(b)
      expect(a).toBeGreaterThanOrEqual(0.75)
      expect(a).toBeLessThanOrEqual(1)
    }

    expect(boltFlicker(42, 0)).not.toBe(boltFlicker(43, 0))
  })
})

describe('the pool and what may fire', () => {
  it('fires nothing on a silent packet, however long it runs', () => {
    const pool = new LightningPool()
    for (let step = 0; step < 60 * 30; step += 1) pool.step(packetOf(), 1 / 60, REST)
    expect(pool.fired).toBe(0)
    expect(pool.alive).toBe(0)
  })

  it('fires one bolt on the frame impact lands, however long impact holds', () => {
    const pool = new LightningPool()
    // Impact alone, no release and no hits behind it: exactly one way in.
    for (let step = 0; step < 10; step += 1) {
      const packet = packetOf()
      packet[F.impact] = 1
      pool.step(packet, 1 / 60, REST)
    }

    expect(pool.fired).toBe(1)
    expect(pool.alive).toBe(1)
  })

  it('holds impact bolts half a second apart, whoever fired impact', () => {
    const pool = new LightningPool()
    // Two impacts a quarter second apart: the second is swallowed.
    for (let step = 0; step < 60; step += 1) {
      const packet = packetOf()
      if (step === 0 || step === 15) packet[F.impact] = 1
      pool.step(packet, 1 / 60, REST)
    }

    expect(pool.fired).toBe(1)
  })

  it('fires on a strong low or mid hit only while release is still high', () => {
    const hits = (release: number) => {
      const pool = new LightningPool()
      for (let step = 0; step < 30; step += 1)
        pool.step(packetOf({ release, bassHit: 0.9 }), 1 / 60, REST)
      return pool.fired
    }

    expect(hits(1)).toBeGreaterThan(0)
    expect(hits(0.1)).toBe(0)
  })

  it('ignores hits under the strength the brief names', () => {
    const pool = new LightningPool()
    for (let step = 0; step < 30; step += 1)
      pool.step(packetOf({ release: 1, trebleHit: 1, subHit: 0.3 }), 1 / 60, REST)
    expect(pool.fired).toBe(0)
  })

  it('never fires more than three bolts a second, however busy the packet', () => {
    const pool = new LightningPool()
    const times: number[] = []
    for (let step = 0; step < 60 * 4; step += 1) {
      const packet = packetOf({ release: 1, subHit: 1, bassHit: 1, impact: step % 3 === 0 ? 1 : 0 })
      const before = pool.fired
      pool.step(packet, 1 / 60, lightningParams({ ...LIGHTNING_DEFAULTS, rate: 2 }))
      if (pool.fired > before) times.push(pool.clock)
    }

    for (let at = 0; at < times.length; at += 1) {
      const end = times[at] ?? 0
      const since = times.filter((t) => t <= end && t > end - 1)
      expect(since.length, `the second ending ${end.toFixed(3)}s`).toBeLessThanOrEqual(3)
    }

    expect(times.length).toBeGreaterThan(4)
  })

  it('hands the same segments to the same song twice, seeded by section and count', () => {
    const run = () => {
      const pool = new LightningPool()
      const out = new Float32Array(LIGHTNING_POOL * STRIKE_SEGMENTS * SEGMENT_FLOATS)
      for (let step = 0; step < 120; step += 1) {
        const packet = packetOf()
        if (step === 0) packet[F.impact] = 1
        if (step === 30) {
          packet[F.release] = 1
          packet[F.bassHit] = 0.9
        }

        pool.step(packet, 1 / 60, REST)
      }

      const count = pool.fill(out, REST)
      return Array.from(out.slice(0, count * SEGMENT_FLOATS))
    }

    expect(run()).toEqual(run())
  })

  it('draws nothing once the bolt has lived its life', () => {
    const pool = new LightningPool()
    const out = new Float32Array(LIGHTNING_POOL * STRIKE_SEGMENTS * SEGMENT_FLOATS)
    pool.step(DROP(), 1 / 60, REST)
    expect(pool.fill(out, REST)).toBeGreaterThan(0)
    for (let step = 0; step < 60; step += 1) pool.step(packetOf(), 1 / 60, REST)
    expect(pool.alive).toBe(0)
    expect(pool.fill(out, REST)).toBe(0)
  })
})

describe('the same at any frame rate', () => {
  it('hands back the same segments at the same light at 60 and at 144 steps a second', () => {
    const play = (fps: number) => {
      const pool = new LightningPool()
      const out = new Float32Array(LIGHTNING_POOL * STRIKE_SEGMENTS * SEGMENT_FLOATS)
      const dt = 1 / fps
      // Both grids land on whole seconds and on twelfths of one, so the
      // impact and the read-back fall on steps of either rate.
      const readAt = 1 + 1 / 12
      let count = 0
      for (let step = 0; step <= Math.round(readAt * fps); step += 1) {
        const time = step * dt
        const packet = packetOf()
        if (Math.abs(time - 1) < dt / 2) packet[F.impact] = 1
        pool.step(packet, step === 0 ? Number.MIN_VALUE : dt, REST)
        if (Math.abs(time - readAt) < dt / 2) count = pool.fill(out, REST)
      }

      return Array.from(out.slice(0, count * SEGMENT_FLOATS))
    }

    const slow = play(60)
    const fast = play(144)
    expect(slow.length).toBeGreaterThan(0)
    expect(fast.length).toBe(slow.length)
    slow.forEach((value, at) => expect(fast[at]).toBeCloseTo(value, 6))
  })
})

describe('how much of the frame it lights', () => {
  it('is under five percent at the mapping worst, three bolts alive, on every canvas shape', () => {
    for (const [width, height] of SHAPES)
      expect(lightningCoverage(WORST, 3, width, height), `${width} by ${height}`).toBeLessThan(0.05)
  })

  it('is far less at rest than at the worst', () => {
    expect(lightningCoverage(REST, 3, 1920, 1080)).toBeLessThan(
      lightningCoverage(WORST, 3, 1920, 1080) / 3,
    )
  })

  it('scales the width with the canvas, and holds the edge at a floor', () => {
    expect(boltWidthPixels(2.2, 3840, 2160)).toBeCloseTo(2.2 * 2, 6)
    expect(boltEdgePixels(640, 640)).toBeGreaterThan(0)
  })

  it('writes the uniform the shader reads: aspect, height, width and edge in pixels, the core lift', () => {
    const out = writeLightningUniform(REST, 1920, 1080, new Float32Array(8))
    expect(out[0]).toBeCloseTo(16 / 9, 6)
    expect(out[1]).toBe(1080)
    expect(out[2]).toBeCloseTo(2.2, 6)
    expect(out[3]).toBeCloseTo(1, 6)
    expect(out[4]).toBe(CORE_LIFT)
  })
})
