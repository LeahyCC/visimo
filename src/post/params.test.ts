import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { paletteAt } from '../palettes/active'
import { visibleExtent } from '../scenes/fluid.params'
import { CASTS } from '../studies/casts/index'
import { castFrame, resolveCast } from '../studies/resolve'
import {
  BLOOM_LEVELS,
  bloomLevelSize,
  bloomSourceSize,
  defaultPostParams,
  feedbackStep,
  fillRibbonPoints,
  flowCover,
  freshWeight,
  mergePostParams,
  POST_LANES,
  POST_STAGES,
  POST_UNIFORM_FLOATS,
  postIsActive,
  postSummary,
  RIBBON_POINTS,
  RIBBON_SEARCH,
  RIBBON_SPAN,
  RIBBON_VERTICES,
  ribbonColour,
  ribbonRuns,
  VIGNETTE_SOFTNESS,
  vignetteLight,
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
    // The ribbon's two vec4s went on past the flow block and the floor, and
    // the grade's went on past those and the gate weave's past that: thirteen
    // vec4s, 208 bytes.
    expect(POST_UNIFORM_FLOATS).toBe(52)
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

describe('the floor under the trail', () => {
  const REFERENCE = 1 / 60
  const feedback = defaultPostParams().feedback
  const lowering = (floor: number) => mergePostParams(defaultPostParams(), { feedback: { floor } })

  it('takes nothing off the history by default', () => {
    expect(feedback.floor).toBe(0)
    // The whole block past the flow is the floor's, and it is off.
    const out = write(defaultPostParams(), packet({ dt: REFERENCE }))
    expect([out[32], out[33], out[34], out[35]]).toEqual([0, 0, 0, 0])
    // Everything the uniform held before the floor was added is untouched.
    const lowered = write(lowering(0.02), packet({ dt: REFERENCE }))
    expect(Array.from(lowered.slice(0, 32))).toEqual(
      Array.from(write(defaultPostParams(), packet({ dt: REFERENCE })).slice(0, 32)),
    )
  })

  it('reads and writes as a lane', () => {
    const params = defaultPostParams()
    expect(POST_LANES['feedback.floor'].read(params)).toBe(0)
    POST_LANES['feedback.floor'].write(params, 0.03)
    expect(POST_LANES['feedback.floor'].read(params)).toBe(0.03)
    expect(params.feedback.floor).toBe(0.03)
  })

  it('halves when the step halves, so it takes the same light off per second', () => {
    const whole = feedbackStep({ ...feedback, floor: 0.02 }, REFERENCE)
    const half = feedbackStep({ ...feedback, floor: 0.02 }, 1 / 120)
    expect(whole.floor).toBeCloseTo(0.02, 9)
    expect(half.floor).toBeCloseTo(whole.floor / 2, 9)
    expect(feedbackStep({ ...feedback, floor: 0.02 }, 1 / 30).floor).toBeCloseTo(0.04, 9)
  })

  it('never adds light, whatever a mapping drives it to', () => {
    expect(feedbackStep({ ...feedback, floor: -1 }, REFERENCE).floor).toBe(0)
    expect(write(lowering(-1), packet({ dt: REFERENCE }))[32]).toBe(0)
  })

  it('writes a floor of zero when the stage is off, at any step', () => {
    const off = mergePostParams(lowering(0.05), { feedback: { enabled: false } })
    for (const dt of [0, 1 / 144, 0.5]) expect(write(off, packet({ dt }))[32]).toBe(0)
    const stackOff = mergePostParams(lowering(0.05), { enabled: false })
    expect(write(stackOff, packet({ dt: REFERENCE }))[32]).toBe(0)
  })

  it('settles a constant at (c - f) / (1 - gain), which is what a preset aims at', () => {
    // The fluid adds 0.02 to every pixel, and Drift's floor is set against it.
    const constant = 0.02
    const settled = (floor: number, fps: number) => {
      const step = feedbackStep({ ...feedback, amount: 1, decay: 0.94, floor }, 1 / fps)
      return (constant * step.fresh - step.floor) / (1 - step.amount * step.decay)
    }
    expect(settled(0, 60)).toBeCloseTo(constant / (1 - 0.94), 6)
    expect(settled(0.018, 60)).toBeCloseTo(0.002 / (1 - 0.94), 6)
    // The floor scales with the step and the decay compounds with it, so the
    // two only agree exactly as the gain approaches 1. At a gain of 0.94 a
    // 144 Hz display settles a shade higher, which on an eight-bit canvas is
    // a code value or two out of a background that is nearly black.
    expect(Math.abs(settled(0.018, 144) - settled(0.018, 60))).toBeLessThan(0.01)
    for (const fps of [30, 60, 144, 240]) expect(settled(0.018, fps)).toBeLessThan(0.06)
  })
})

describe('the ribbon', () => {
  const lighting = (patch = {}) =>
    mergePostParams(defaultPostParams(), { ribbon: { enabled: true, intensity: 0.5, ...patch } })
  /** The ribbon's own vec4s, the last two in the uniform. */
  const ribbonFloats = (out: Float32Array) => Array.from(out.slice(36, 44))
  const brightest = (colour: readonly number[]) => Math.max(...colour)

  it('is off by default, and shows nothing when switched on at no intensity', () => {
    const ribbon = defaultPostParams().ribbon
    expect(ribbon.enabled).toBe(false)
    expect(ribbon.intensity).toBe(0)
    expect(ribbonRuns(defaultPostParams())).toBe(false)
    expect(ribbonRuns(lighting({ intensity: 0 }))).toBe(false)
    expect(ribbonRuns(lighting({ width: 0 }))).toBe(false)
    expect(ribbonRuns(lighting({ intensity: -1 }))).toBe(false)
    expect(ribbonRuns(lighting())).toBe(true)
    // The stack's own switch overrides the stage, as it does for every other.
    expect(ribbonRuns(mergePostParams(lighting(), { enabled: false }))).toBe(false)
  })

  it('leaves the uniform’s existing floats exactly as they were', () => {
    // The stack at its defaults, one 60 Hz frame, written out by hand from the
    // defaults above: every number here is what this file wrote before the
    // ribbon existed, and none of them moves.
    const features = packet({ dt: 1 / 60, time: 5 })
    const out = write(defaultPostParams(), features)
    const wanted = [
      ...[1920, 1080, 1 / 1920, 1 / 1080],
      ...[0.22, 0.72, 1.012, 0.002],
      ...[0.85, 0.2, 0.35, 0],
      ...[0.5, 0.32, 0.18, 1],
      ...[0.0008, 0, 0, 0],
      ...[1, 0.6, 1, 0],
      ...[0.02, 5, 0, 0],
      ...[0, 16, 1, 1],
      ...[0, 0, 0, 0],
    ]
    expect(wanted).toHaveLength(36)
    wanted.forEach((value, index) => expect(out[index]).toBeCloseTo(value, 6))
    // And turning the ribbon on moves none of them either.
    const drawing = write(lighting({ shape: 1 }), features)
    expect(Array.from(drawing.slice(0, 36))).toEqual(Array.from(out.slice(0, 36)))
  })

  it('writes values that make it vanish when it is off', () => {
    const features = packet({ keyHue: 0.3 })
    const zeros = [0, 0, 0, 0, 0, 0, 0, 0]
    expect(ribbonFloats(write(defaultPostParams(), features))).toEqual(zeros)
    expect(ribbonFloats(write(lighting({ enabled: false }), features))).toEqual(zeros)
    expect(ribbonFloats(write(mergePostParams(lighting(), { enabled: false }), features))).toEqual(
      zeros,
    )
    // Off with every other number a preset might have left behind it.
    const off = lighting({ enabled: false, shape: 1, width: 9, height: 0.4 })
    expect(ribbonFloats(write(off, features))).toEqual(zeros)
  })

  it('writes its width in pixels at 1080p and scales it with the canvas', () => {
    const width = (w: number, h: number, patch = {}) =>
      write(lighting({ width: 3, ...patch }), packet(), w, h)[37]
    expect(width(1920, 1080)).toBeCloseTo(3, 6)
    expect(width(3840, 2160)).toBeCloseTo(6, 6)
    expect(width(1280, 720)).toBeCloseTo(2, 6)
    // The short side, so a phone held upright draws the line a wide screen would.
    expect(width(1080, 1920)).toBeCloseTo(3, 6)
    expect(width(1920, 1080, { width: 7.5 })).toBeCloseTo(7.5, 6)
  })

  it('writes its intensity and never a negative one', () => {
    expect(write(lighting({ intensity: 0.7 }), packet())[36]).toBeCloseTo(0.7, 6)
    expect(write(lighting({ intensity: -2 }), packet())[36]).toBe(0)
  })

  it('makes its height a fraction of the canvas in the direction the sound pushes', () => {
    const at = (w: number, h: number, patch = {}) =>
      write(lighting({ height: 0.25, ...patch }), packet(), w, h)
    // The line moves up and down the frame: a quarter of its height.
    expect(at(1920, 1080)[38]).toBeCloseTo(270, 4)
    // The circle moves in and out from the middle: a quarter of its short side.
    expect(at(1920, 1080, { shape: 1 })[38]).toBeCloseTo(270, 4)
    expect(at(1000, 500, { shape: 1 })[38]).toBeCloseTo(125, 4)
    expect(at(1000, 500)[38]).toBeCloseTo(125, 4)
    expect(at(1000, 400, { shape: 1 })[38]).toBeCloseTo(100, 4)
    expect(at(1920, 1080, { height: -1 })[38]).toBe(0)
  })

  it('has two shapes, the line at 0 and the circle at 1, and rounds up from halfway', () => {
    const shape = (value: number) => write(lighting({ shape: value }), packet(), 1920, 1080)
    expect(shape(0)[39]).toBe(0)
    expect(shape(0.49)[39]).toBe(0)
    expect(shape(0.5)[39]).toBe(1)
    expect(shape(1)[39]).toBe(1)
    expect(shape(3)[39]).toBe(1)
    // The circle has a radius at rest and the line has none to carry.
    expect(shape(1)[43]).toBeCloseTo(0.28 * 1080, 4)
    expect(shape(0)[43]).toBe(0)
  })

  it('takes its colour from the fluid’s palette at the song’s key', () => {
    for (const keyHue of [0, 1 / 12, 0.3, 7 / 12, 0.95]) {
      const out = write(lighting(), packet({ keyHue }))
      const [red, green, blue] = paletteAt(keyHue + 0.5)
      const peak = Math.max(red, green, blue)
      expect(out[40]).toBeCloseTo(red / peak, 5)
      expect(out[41]).toBeCloseTo(green / peak, 5)
      expect(out[42]).toBeCloseTo(blue / peak, 5)
    }
  })

  it('moves with the key and holds the same brightness in every key', () => {
    const colour = (keyHue: number) => ribbonColour(packet({ keyHue }))
    expect(colour(0)).not.toEqual(colour(0.25))
    for (let step = 0; step < 24; step++) expect(brightest(colour(step / 24))).toBeCloseTo(1, 6)
    // The key wraps, so a hue past 1 is the hue it is a turn from.
    for (const [a, b] of [
      [1.25, 0.25],
      [-0.25, 0.75],
    ] as const)
      colour(a).forEach((value, index) => expect(value).toBeCloseTo(colour(b)[index] ?? 0, 5))
  })

  it('draws white rather than NaN when the key is not a number', () => {
    expect(ribbonColour(packet({ keyHue: Number.NaN }))).toEqual([1, 1, 1])
  })

  it('has a lane for each of its numbers', () => {
    const params = defaultPostParams()
    for (const [lane, value] of [
      ['ribbon.intensity', 0],
      ['ribbon.width', 3],
      ['ribbon.height', 0.25],
      ['ribbon.shape', 0],
    ] as const) {
      expect(POST_LANES[lane].read(params)).toBe(value)
      POST_LANES[lane].write(params, 0.5)
      expect(POST_LANES[lane].read(params)).toBe(0.5)
    }

    expect(params.ribbon).toMatchObject({ intensity: 0.5, width: 0.5, height: 0.5, shape: 0.5 })
    // A lane is a number, and the switch is not one.
    expect('ribbon.enabled' in POST_LANES).toBe(false)
  })

  it('takes a patch without touching what it was given', () => {
    const base = defaultPostParams()
    const patched = mergePostParams(base, { ribbon: { enabled: true, shape: 1 } })
    expect(patched.ribbon).toEqual({ ...base.ribbon, enabled: true, shape: 1 })
    expect(base.ribbon.enabled).toBe(false)
    expect(patched.ribbon).not.toBe(base.ribbon)
  })

  it('is the first stage a summary names, and only when it runs', () => {
    expect(POST_STAGES[0]).toBe('ribbon')
    expect(postSummary(defaultPostParams())).toBe('feedback bloom chroma tonemap grain')
    expect(postSummary(lighting())).toBe('ribbon feedback bloom chroma tonemap grain')
    const alone = mergePostParams(lighting(), {
      feedback: { enabled: false },
      bloom: { enabled: false },
      chromatic: { enabled: false },
      tonemap: { enabled: false },
      grain: { enabled: false },
    })

    expect(postSummary(alone)).toBe('ribbon')
    expect(postIsActive(alone)).toBe(true)
    expect(postSummary(mergePostParams(alone, { ribbon: { enabled: false } }))).toBe('off')
  })

  it('takes its points from the newest sound and never writes a NaN', () => {
    const out = new Float32Array(RIBBON_POINTS).fill(9)
    expect(fillRibbonPoints(new Float32Array(4096), out)).toBe(out)
    for (const value of out) expect(value).toBe(0)
    const tone = Float32Array.from({ length: 4096 }, (_, index) => Math.sin(index / 5))
    fillRibbonPoints(tone, out)
    for (const value of out) expect(Math.abs(value)).toBeLessThanOrEqual(1)
    expect(Math.max(...out)).toBeGreaterThan(0.5)
  })

  it('sizes the strip for the points, one more than there are to close the circle', () => {
    expect(RIBBON_VERTICES).toBe(2 * (RIBBON_POINTS + 1))
    // The window and the room to find a crossing in fit the analyser's 4096.
    expect(RIBBON_SPAN + RIBBON_SEARCH).toBeLessThanOrEqual(4096)
    expect(RIBBON_POINTS).toBeGreaterThanOrEqual(100)
  })

  it('writes a whole, finite uniform for every shipped cast at any canvas', () => {
    // The WebGL2 path writes the same uniform and skips the ribbon, so a cast
    // that turns it on must not put anything in it that could throw.
    const features = packet({ keyHue: 0.4, dt: 1 / 90 })
    for (const cast of CASTS) {
      const { post } = resolveCast(cast, features, 0, castFrame())
      for (const [width, height] of [
        [1920, 1080],
        [1, 1],
        [3840, 2160],
        [600, 1400],
      ] as const) {
        const out = new Float32Array(POST_UNIFORM_FLOATS)
        writePostUniform(post, features, width, height, out)
        for (const value of out) expect(Number.isFinite(value)).toBe(true)
      }
    }
  })
})

describe('the grade stage', () => {
  const graded = (grade: Partial<PostParams['grade']> = {}) =>
    mergePostParams(defaultPostParams(), { grade: { enabled: true, ...grade } })

  it('is off by default, so no shipped look prints it', () => {
    expect(defaultPostParams().grade.enabled).toBe(false)
    expect(postSummary(defaultPostParams())).toBe('feedback bloom chroma tonemap grain')
    expect(postSummary(graded())).toBe('feedback bloom chroma grade tonemap grain')
    // Pass order: after the split and the bloom, before the tonemap.
    expect(POST_STAGES.indexOf('grade')).toBeGreaterThan(POST_STAGES.indexOf('chromatic'))
    expect(POST_STAGES.indexOf('grade')).toBeLessThan(POST_STAGES.indexOf('tonemap'))
  })

  it('has a lane for each number, and the stage switch is not one', () => {
    const params = defaultPostParams()
    expect(POST_LANES['grade.vignette'].read(params)).toBe(0)
    expect(POST_LANES['grade.saturation'].read(params)).toBe(1)
    POST_LANES['grade.vignette'].write(params, 0.4)
    POST_LANES['grade.saturation'].write(params, 0.6)
    expect(params.grade).toMatchObject({ vignette: 0.4, saturation: 0.6 })
    expect('grade.enabled' in POST_LANES).toBe(false)
  })

  it('is neutral when it is on and nothing is said: no vignette, colour as it was', () => {
    const on = write(graded())
    expect([on[44], on[45]]).toEqual([0, 1])
    // And off writes the same pair, so the shader needs no branch for it.
    const off = write(defaultPostParams())
    expect([off[44], off[45]]).toEqual([0, 1])
    const stackOff = write(mergePostParams(graded({ vignette: 0.9 }), { enabled: false }))
    expect([stackOff[44], stackOff[45]]).toEqual([0, 1])
  })

  it('goes past the ribbon’s block and leaves every float before it where it was', () => {
    const features = packet({ dt: 1 / 90, time: 3, beatPulse: 0.3, keyHue: 0.2 })
    const before = write(defaultPostParams(), features)
    const after = write(graded({ vignette: 0.7, saturation: 0.25 }), features)
    expect(Array.from(after.slice(0, 44))).toEqual(Array.from(before.slice(0, 44)))
    expect(after[44]).toBeCloseTo(0.7, 6)
    expect(after[45]).toBe(0.25)
    expect(after[46]).toBe(VIGNETTE_SOFTNESS)
  })

  // A row may push a lane past its end, which is how an impact undoes what
  // tension did, so the writer is where the shader is protected from it.
  it('holds both numbers to 0 to 1 and never writes a NaN', () => {
    const at = (grade: Partial<PostParams['grade']>) => write(graded(grade))
    expect(at({ vignette: -0.4 })[44]).toBe(0)
    expect(at({ vignette: 3 })[44]).toBe(1)
    expect(at({ saturation: -1 })[45]).toBe(0)
    // Above 1 the smallest channel of a saturated pixel goes negative and the
    // composite's last max would clip it.
    expect(at({ saturation: 1.6 })[45]).toBe(1)
    expect([at({ vignette: Number.NaN })[44], at({ saturation: Number.NaN })[45]]).toEqual([0, 1])
  })

  describe('vignetteLight', () => {
    it('touches nothing at 0, out to the corner', () => {
      for (const distance of [0, 0.3, 0.7071, 1]) expect(vignetteLight(distance, 0)).toBe(1)
    })

    it('always leaves the centre lit', () => {
      for (const vignette of [0, 0.25, 0.5, 0.75, 1]) expect(vignetteLight(0, vignette)).toBe(1)
    })

    // The point of the shape: a plain power of the distance spends the whole
    // range before it shows. At a half the corners have to be plainly dark
    // and the middle of an edge only just touched.
    it('is already plain to see in the middle of the range', () => {
      const corner = vignetteLight(1, 0.5)
      const edge = vignetteLight(Math.SQRT1_2, 0.5)
      expect(corner).toBeLessThan(0.35)
      expect(edge).toBeGreaterThan(0.7)
      expect(edge).toBeLessThan(0.95)
    })

    it('is closed down hard to the centre at 1', () => {
      expect(vignetteLight(Math.SQRT1_2, 1)).toBeLessThan(0.05)
      expect(vignetteLight(1, 1)).toBe(0)
      // Which the corner reaches well before the end of the range.
      expect(vignetteLight(1, 0.85)).toBeLessThan(0.02)
    })

    it('only ever closes as the number climbs, and only ever darkens outward', () => {
      for (let distance = 0; distance <= 1; distance += 0.05) {
        let last = 1
        for (let vignette = 0; vignette <= 1; vignette += 0.05) {
          const light = vignetteLight(distance, vignette)
          expect(light).toBeLessThanOrEqual(last + 1e-12)
          expect(light).toBeGreaterThanOrEqual(0)
          last = light
        }
      }

      for (let vignette = 0.1; vignette <= 1; vignette += 0.1) {
        let last = 1
        for (let distance = 0; distance <= 1; distance += 0.05) {
          const light = vignetteLight(distance, vignette)
          expect(light).toBeLessThanOrEqual(last + 1e-12)
          last = light
        }
      }
    })
  })
})
