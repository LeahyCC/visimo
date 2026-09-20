import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  BLOOM_LEVELS,
  bloomLevelSize,
  bloomSourceSize,
  defaultPostParams,
  feedbackStep,
  freshWeight,
  mergePostParams,
  POST_UNIFORM_FLOATS,
  postIsActive,
  postSummary,
  writePostUniform,
} from './params'
import type { PostParams } from './params'

const packet = (values: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

const write = (params: PostParams, features = packet(), width = 1920, height = 1080) =>
  writePostUniform(params, features, width, height, new Float32Array(POST_UNIFORM_FLOATS))

describe('post parameters', () => {
  it('applies a patch without touching the object it was given', () => {
    const base = defaultPostParams()
    const patched = mergePostParams(base, {
      bloom: { intensity: 2, weights: [1, 0, 0] },
      grain: { enabled: false },
    })

    expect(patched.bloom.intensity).toBe(2)
    expect(patched.bloom.weights).toEqual([1, 0, 0])
    expect(patched.grain.enabled).toBe(false)
    // Untouched stages keep their values, and the original is unchanged.
    expect(patched.feedback).toEqual(base.feedback)
    expect(base.bloom.intensity).toBe(defaultPostParams().bloom.intensity)
    expect(base.grain.enabled).toBe(true)
  })

  it('is inactive only when the stack or every stage is off', () => {
    const base = defaultPostParams()
    expect(postIsActive(base)).toBe(true)
    expect(postIsActive(mergePostParams(base, { enabled: false }))).toBe(false)
    const nothing = mergePostParams(base, {
      feedback: { enabled: false },
      bloom: { enabled: false },
      chromatic: { enabled: false },
      tonemap: { enabled: false },
      grain: { enabled: false },
    })

    expect(postIsActive(nothing)).toBe(false)
    expect(postSummary(nothing)).toBe('off')
    expect(postSummary(mergePostParams(base, { bloom: { enabled: false } }))).toBe(
      'feedback chroma tonemap grain',
    )
    // The stack's own switch overrides the stages under it.
    const stackOff = mergePostParams(base, { enabled: false })
    expect(postSummary(stackOff)).toBe('off')
    expect(write(stackOff, packet({ beatPulse: 1 }))[16]).toBe(0)
    expect(write(stackOff)[10]).toBe(0)
  })

  it('halves each bloom level and never goes under a pixel', () => {
    expect(bloomLevelSize(1920, 1080, 0)).toEqual({ width: 960, height: 540 })
    expect(bloomLevelSize(1920, 1080, BLOOM_LEVELS - 1)).toEqual({ width: 240, height: 135 })
    expect(bloomLevelSize(3, 1, 2)).toEqual({ width: 1, height: 1 })
  })

  it('spaces a horizontal blur by the texels of the texture it reads', () => {
    // The first level reads what the bright pass wrote at its own size, not
    // the canvas; the rest read the level above and halve it on the way in.
    expect(bloomSourceSize(1920, 1080, 0)).toEqual(bloomLevelSize(1920, 1080, 0))
    for (let level = 1; level < BLOOM_LEVELS; level++) {
      expect(bloomSourceSize(1920, 1080, level)).toEqual(bloomLevelSize(1920, 1080, level - 1))
    }
  })
})

describe('the post uniform', () => {
  it('carries the resolution and its reciprocal', () => {
    const out = write(defaultPostParams(), packet(), 800, 400)
    expect([out[0], out[1]]).toEqual([800, 400])
    expect(out[2]).toBeCloseTo(1 / 800)
    expect(out[3]).toBeCloseTo(1 / 400)
  })

  it('widens the chromatic split with the beat pulse and never below the resting split', () => {
    const params = mergePostParams(defaultPostParams(), {
      chromatic: { enabled: true, amount: 0.001, beat: 0.004 },
    })

    expect(write(params, packet({ beatPulse: 0 }))[16]).toBeCloseTo(0.001)
    expect(write(params, packet({ beatPulse: 0.5 }))[16]).toBeCloseTo(0.003)
    expect(write(params, packet({ beatPulse: 1 }))[16]).toBeCloseTo(0.005)
  })

  it('zeroes each stage that is off, leaving the identity warp behind', () => {
    const off = mergePostParams(defaultPostParams(), {
      feedback: { enabled: false },
      bloom: { enabled: false },
      chromatic: { enabled: false },
      tonemap: { enabled: false },
      grain: { enabled: false },
    })

    const out = write(off, packet({ beatPulse: 1 }))
    expect([out[4], out[5], out[7]]).toEqual([0, 0, 0])
    // A zero zoom would divide by nothing in the shader.
    expect(out[6]).toBe(1)
    expect([out[10], out[12], out[13], out[14], out[15]]).toEqual([0, 0, 0, 0, 0])
    expect(out[16]).toBe(0)
    // An exposure of one and a mix of zero leave the colour as it was.
    expect([out[20], out[22]]).toEqual([1, 0])
    expect(out[24]).toBe(0)
  })

  it('passes the bloom weights and the tonemap through when they are on', () => {
    const params = mergePostParams(defaultPostParams(), {
      bloom: { threshold: 0.4, knee: 0.2, intensity: 0.8, weights: [0.5, 0.3, 0.2] },
      tonemap: { enabled: true, exposure: 1.2, shoulder: 0.5 },
    })

    // Single precision, so every value comes back a rounding away.
    const out = write(params)
    const slice = (from: number, count: number) =>
      Array.from({ length: count }, (_, offset) => out[from + offset] ?? 0)

    for (const [got, want] of [
      [slice(8, 3), [0.4, 0.2, 0.8]],
      [slice(12, 4), [0.5, 0.3, 0.2, 1]],
      [slice(20, 3), [1.2, 0.5, 1]],
    ]) {
      want?.forEach((value, index) => expect(got?.[index]).toBeCloseTo(value))
    }
  })

  it('keeps the grain clock small enough for the hash to stay noisy', () => {
    expect(write(defaultPostParams(), packet({ time: 12.5 }))[25]).toBeCloseTo(12.5)
    expect(write(defaultPostParams(), packet({ time: 4321 }))[25]).toBeCloseTo(321)
  })

  it('never lets a zero knee or a shoulder with no headroom divide in the shader', () => {
    const params = mergePostParams(defaultPostParams(), {
      bloom: { knee: 0 },
      tonemap: { shoulder: 1 },
    })

    const out = write(params)
    expect(out[9]).toBeGreaterThan(0)
    expect(out[21]).toBeLessThan(1)
  })
})

describe('feedback per second', () => {
  const feedback = defaultPostParams().feedback
  const REFERENCE = 1 / 60

  it('leaves the numbers as written at one 60 Hz frame', () => {
    const step = feedbackStep(feedback, REFERENCE)
    expect(step.amount).toBeCloseTo(feedback.amount, 6)
    expect(step.decay).toBeCloseTo(feedback.decay, 6)
    expect(step.zoom).toBeCloseTo(feedback.zoom, 6)
    expect(step.rotate).toBeCloseTo(feedback.rotate, 6)
  })

  it('compounds two steps of 1/120 to the same as one of 1/60', () => {
    const half = feedbackStep(feedback, 1 / 120)
    const whole = feedbackStep(feedback, REFERENCE)
    expect((half.amount * half.decay) ** 2).toBeCloseTo(whole.amount * whole.decay, 9)
    expect(half.zoom ** 2).toBeCloseTo(whole.zoom, 9)
    expect(half.rotate * 2).toBeCloseTo(whole.rotate, 9)
  })

  it('trails as long in seconds at 144 Hz as at 60 Hz', () => {
    const gainAfterASecond = (fps: number) => {
      const step = feedbackStep(feedback, 1 / fps)
      return (step.amount * step.decay) ** fps
    }
    expect(gainAfterASecond(144)).toBeCloseTo(gainAfterASecond(60), 9)
  })

  it('settles a still image at the same brightness at any frame rate', () => {
    // The sum of a constant frame under the trail is fresh / (1 - gain per frame).
    const settled = (from: typeof feedback, fps: number) => {
      const step = feedbackStep(from, 1 / fps)
      return step.fresh / (1 - step.amount * step.decay)
    }
    const long = { ...feedback, amount: 1, decay: 0.97 }
    for (const from of [feedback, long]) {
      const wanted = 1 / (1 - from.amount * from.decay)
      for (const fps of [30, 60, 144, 240]) expect(settled(from, fps)).toBeCloseTo(wanted, 6)
    }
    expect(feedbackStep(feedback, REFERENCE).fresh).toBeCloseTo(1, 9)
  })

  it('does not let a stalled frame flash the trail', () => {
    const held = { ...feedback, amount: 1, decay: 1 }
    expect(feedbackStep(held, 0.1).fresh).toBeLessThanOrEqual(2)
    expect(feedbackStep(held, 1 / 120).fresh).toBeCloseTo(0.5, 6)
  })

  it('weights the new frame fully when the stage is off', () => {
    const off = mergePostParams(defaultPostParams(), { feedback: { enabled: false } })
    expect(freshWeight(off, packet({ dt: 1 / 144 }))).toBe(1)
    expect(freshWeight(defaultPostParams(), packet({ dt: 1 / 144 }))).toBeLessThan(1)
  })

  it('reads a missing or bad step as one reference frame', () => {
    const whole = feedbackStep(feedback, REFERENCE)
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(feedbackStep(feedback, dt).zoom).toBeCloseTo(whole.zoom, 9)
    }
    // A packet with no step in it, as in the older tests, is the same as zero.
    expect(write(defaultPostParams(), packet())[4]).toBeCloseTo(feedback.amount, 6)
  })

  it('holds a stalled frame to the longest step', () => {
    expect(feedbackStep(feedback, 30)).toEqual(feedbackStep(feedback, 0.1))

    // A base above 1 must not grow past what one reference frame gives.
    const step = feedbackStep({ ...feedback, amount: 1.5, decay: 1.2 }, 0.1)
    expect(step.amount).toBeLessThanOrEqual(1.5)
    expect(step.decay).toBeLessThanOrEqual(1.2)
  })

  it('writes the converted numbers into the uniform', () => {
    const out = write(defaultPostParams(), packet({ dt: 1 / 120 }))
    const step = feedbackStep(feedback, Math.fround(1 / 120))
    const written = [out[4], out[5], out[6], out[7]].map((value) => value ?? 0)
    const wanted = [step.amount, step.decay, step.zoom, step.rotate].map(Math.fround)
    written.forEach((value, index) => expect(value).toBeCloseTo(wanted[index] ?? 0, 6))
  })

  it('still makes a disabled stage vanish at any step', () => {
    const off = mergePostParams(defaultPostParams(), { feedback: { enabled: false } })
    for (const dt of [0, 1 / 144, 0.5]) {
      const out = write(off, packet({ dt }))
      expect([out[4], out[5], out[6], out[7]]).toEqual([0, 0, 1, 0])
    }
  })

  it('never lets a zoom the shader divides by reach zero', () => {
    for (const zoom of [0, -2, 1e-9]) {
      for (const dt of [0, 1 / 240, 0.1]) {
        expect(feedbackStep({ ...feedback, zoom }, dt).zoom).toBeGreaterThan(0)
      }
    }
    // A negative amount or decay is a preset mistake, not a NaN in the history.
    const bad = feedbackStep({ ...feedback, amount: -1, decay: -1 }, 1 / 144)
    expect(Number.isNaN(bad.amount)).toBe(false)
    expect(Number.isNaN(bad.decay)).toBe(false)
  })
})
