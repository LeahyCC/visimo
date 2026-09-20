import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { visibleExtent } from '../scenes/fluid.params'
import {
  BLOOM_LEVELS,
  bloomLevelSize,
  bloomSourceSize,
  defaultPostParams,
  feedbackStep,
  flowCover,
  freshWeight,
  mergePostParams,
  POST_LANES,
  POST_UNIFORM_FLOATS,
  postIsActive,
  postSummary,
  writePostUniform,
} from './params'
import type { FlowCover, PostParams } from './params'

const packet = (values: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

const write = (
  params: PostParams,
  features = packet(),
  width = 1920,
  height = 1080,
  cover: FlowCover | null = null,
) => writePostUniform(params, features, width, height, new Float32Array(POST_UNIFORM_FLOATS), cover)

/** The cover a canvas of this shape gives, as the fluid scene reports it. */
const coverOf = (width: number, height: number): FlowCover => {
  const visible = visibleExtent(width, height)
  return [visible.x * 2, visible.y * 2]
}

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

describe('carrying the history along a flow', () => {
  const carrying = (patch = {}) =>
    mergePostParams(defaultPostParams(), { feedback: { carry: 1, ceiling: 2, ...patch } })

  it('reads and writes the two new numbers as lanes', () => {
    const params = defaultPostParams()
    expect(POST_LANES['feedback.carry'].read(params)).toBe(0)
    expect(POST_LANES['feedback.ceiling'].read(params)).toBe(defaultPostParams().feedback.ceiling)
    POST_LANES['feedback.carry'].write(params, 0.75)
    POST_LANES['feedback.ceiling'].write(params, 3)
    expect(params.feedback.carry).toBe(0.75)
    expect(params.feedback.ceiling).toBe(3)
    // The lanes are what a preset may name, so the parser sees them too.
    expect(POST_LANES['feedback.amount'].read(params)).toBe(defaultPostParams().feedback.amount)
  })

  it('leaves every float the stack already had exactly where it was', () => {
    const features = packet({ dt: 1 / 144, time: 7.5, beatPulse: 0.4 })
    const before = write(defaultPostParams(), features)
    const after = write(carrying(), features, 1920, 1080, coverOf(1920, 1080))
    expect(Array.from(after.slice(0, 28))).toEqual(Array.from(before.slice(0, 28)))
    expect(POST_UNIFORM_FLOATS).toBe(32)
  })

  it('makes the carry vanish with no flow, no carry or the stage off', () => {
    const features = packet({ dt: 1 / 60 })
    const cover = coverOf(1920, 1080)
    // A flow is offered but the preset asks for none of it.
    expect(write(carrying({ carry: 0 }), features, 1920, 1080, cover)[28]).toBe(0)
    // The preset asks for it but the scene solves no field.
    expect(write(carrying(), features)[28]).toBe(0)
    const off = mergePostParams(carrying(), { feedback: { enabled: false } })
    expect(write(off, features, 1920, 1080, cover)[28]).toBe(0)
    // And with the carry gone the cover it would have scaled is the identity.
    expect([write(off, features, 1920, 1080, cover)[30], write(carrying(), features)[31]]).toEqual([
      1, 1,
    ])
  })

  it('writes the carry as the canvas uv one unit of velocity moves this frame', () => {
    const cover = coverOf(1920, 1080)
    const at = (dt: number, carry = 1) =>
      write(carrying({ carry }), packet({ dt }), 1920, 1080, cover)[28] ?? 0
    expect(at(1 / 60)).toBeCloseTo(1 / 60, 6)
    expect(at(1 / 120)).toBeCloseTo(1 / 120, 6)
    expect(at(1 / 60, 0.5)).toBeCloseTo(0.5 / 60, 6)
    // A missing step reads as one reference frame and a stall is held short,
    // so neither flings the history across the canvas.
    expect(at(0)).toBeCloseTo(1 / 60, 6)
    expect(at(30)).toBeCloseTo(0.1, 6)
  })

  it('never lets the ceiling or the cover the shader divides by reach zero', () => {
    const features = packet({ dt: 1 / 60 })
    for (const ceiling of [0, -4, Number.NaN]) {
      const out = write(carrying({ ceiling }), features, 1920, 1080, coverOf(1920, 1080))
      expect(out[29]).toBeGreaterThan(0)
    }
    // A canvas with no area gives a cover of zero, and the identity beats a
    // warp a thousand screens wide.
    const none = write(carrying(), features, 1920, 1080, [0, 0])
    expect([none[30], none[31]]).toEqual([1, 1])
  })
})

describe('the cover a flow is measured against', () => {
  it('is the identity on a square canvas and the band on any other', () => {
    expect(flowCover(coverOf(600, 600))).toEqual([1, 1])
    // Wide: the whole grid across, a band of it down.
    const wide = flowCover(coverOf(1920, 1080))
    expect(wide[0]).toBeCloseTo(1, 6)
    expect(wide[1]).toBeCloseTo(1080 / 1920, 6)
    // Tall is the same the other way round.
    const tall = flowCover(coverOf(1080, 1920))
    expect(tall[0]).toBeCloseTo(1080 / 1920, 6)
    expect(tall[1]).toBeCloseTo(1, 6)
  })

  it('falls back to the identity rather than a nonsense scale', () => {
    expect(flowCover(null)).toEqual([1, 1])
    expect(flowCover([0, 0.5])).toEqual([1, 0.5])
    expect(flowCover([Number.NaN, -1])).toEqual([1, 1])
  })
})
