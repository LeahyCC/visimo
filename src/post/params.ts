/**
 * The post stack's parameters and the pure maths that turns them, plus the
 * current feature packet, into the uniform every pass reads. No GPU objects
 * here, so all of it is unit tested; `PostStack.ts` owns the textures and the
 * passes and nothing else decides a number.
 *
 * One plain object holds every stage, so a later presets step can hand the
 * renderer a patch per preset and the stack needs no new API for it.
 */
import { F } from '../audio/FeatureExtractor'

/** The previous frame, warped a little and decayed, added under the new one. */
export type FeedbackParams = {
  enabled: boolean
  /** How much of the decayed history survives, 0 to 1. */
  amount: number
  /** Decay of the history, 0 to 1. */
  decay: number
  /** Scale applied to the history; above 1 pushes trails outward. */
  zoom: number
  /** Radians of rotation applied to the history. */
  rotate: number
  /**
   * How far the scene's own velocity field drags the history, 0 for none.
   * At 1 the last frame is read back exactly one step along the flow, so
   * every part of the screen bends its own way instead of the whole picture
   * turning about the middle. A scene that solves no field ignores it.
   */
  carry: number
  /**
   * The most light one frame may carry back from the history. A trail near
   * gain 1 sums without bound otherwise, and half floats reach 65504 before
   * anything stops them. Below half of this nothing changes; above it the
   * brightest channel bends toward the ceiling and never reaches it, and the
   * other two follow it, because limiting each channel on its own bleaches
   * the colour toward white.
   */
  ceiling: number
}
// The first four numbers above are what one frame does at 60 frames a
// second. `feedbackStep` converts them by the real step, so a trail lasts and
// travels the same number of seconds on any display. `carry` is per second
// already, since the velocity it scales is, and `ceiling` is a brightness
// and has no rate in it at all.

export type BloomParams = {
  enabled: boolean
  /** Luminance a pixel must pass to bloom at all. */
  threshold: number
  /** Width of the soft knee around the threshold, so notes fade in. */
  knee: number
  /** How much of the blurred levels is added back. */
  intensity: number
  /** Weight per blur level, widest last. */
  weights: [number, number, number]
}

/** Red and blue read at slightly different radii; the beat pushes them apart. */
export type ChromaticParams = {
  enabled: boolean
  /** Split at the corner with no beat, in texture coordinates. */
  amount: number
  /** Extra split at `beatPulse` 1. */
  beat: number
}

export type TonemapParams = {
  enabled: boolean
  exposure: number
  /**
   * Where the roll-off starts, 0 to 1. Below it nothing changes; above it a
   * value is bent toward 1 and never reaches it, so no core clips flat.
   */
  shoulder: number
}

export type GrainParams = {
  enabled: boolean
  /** Peak-to-peak noise added at the end, in output units. */
  amount: number
}

export type PostParams = {
  /** Off skips every stage, leaving the composite a straight copy. */
  enabled: boolean
  feedback: FeedbackParams
  bloom: BloomParams
  chromatic: ChromaticParams
  tonemap: TonemapParams
  grain: GrainParams
}

/** A partial update, one stage at a time; what a preset will hand over. */
export type PostPatch = {
  enabled?: boolean
  feedback?: Partial<FeedbackParams>
  bloom?: Partial<BloomParams>
  chromatic?: Partial<ChromaticParams>
  tonemap?: Partial<TonemapParams>
  grain?: Partial<GrainParams>
}

/** post.composite.wgsl has one texture binding per level, so they match. */
export const BLOOM_LEVELS = 3

/**
 * Tuned by eye on real tracks at 3840 by 2160; see docs/visualizer.md. The
 * field already fills most of the frame, so anything generous here turns it
 * into a milky haze. The feedback gain on a still image at 60 frames a second
 * is 1 / (1 - amount * decay), about 1.19, and the bloom threshold sits high
 * enough that only the attractor cores glow.
 */
export const DEFAULT_POST_PARAMS: PostParams = {
  enabled: true,
  feedback: {
    enabled: true,
    amount: 0.22,
    decay: 0.72,
    zoom: 1.012,
    rotate: 0.002,
    // Off: the pass is the zoom and turn it always was. The ceiling sits far
    // above anything a scene draws, so the shipped presets never meet it.
    carry: 0,
    ceiling: 16,
  },
  bloom: {
    enabled: true,
    threshold: 0.85,
    knee: 0.2,
    intensity: 0.35,
    weights: [0.5, 0.32, 0.18],
  },
  chromatic: { enabled: true, amount: 0.0008, beat: 0.003 },
  tonemap: { enabled: true, exposure: 1, shoulder: 0.6 },
  grain: { enabled: true, amount: 0.02 },
}

/** The frame length the feedback numbers are written against. */
export const REFERENCE_FPS = 60

/**
 * Bounds on the step the feedback conversion trusts. A missing or zero dt
 * means the first frame, so it reads as one reference frame and changes
 * nothing; a stalled tab is held to the longest step the renderer allows so
 * one frame cannot fling the warp across the canvas.
 */
const MIN_FEEDBACK_DT = 1 / 480
const MAX_FEEDBACK_DT = 0.1

/**
 * The step this stage trusts, in seconds. Both the per-frame conversion and
 * the distance the flow drags the history take their time from here, so a
 * stalled tab cannot fling either of them across the canvas.
 */
function feedbackSeconds(dt: number): number {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 1 / REFERENCE_FPS
  return Math.min(Math.max(step, MIN_FEEDBACK_DT), MAX_FEEDBACK_DT)
}

/** What the feedback pass applies to the history on one drawn frame. */
export type FeedbackStep = {
  amount: number
  decay: number
  zoom: number
  rotate: number
  /** Weight on the frame the scene just drew, 1 at the reference rate. */
  fresh: number
}

/**
 * A long frame would weight the new frame several times over, and that flash
 * then rides the trail for seconds. Two reference frames is 30 frames a
 * second, below which the picture has bigger problems than its brightness.
 */
const MAX_FRESH_FRAMES = 2

/**
 * Convert per-reference-frame feedback numbers to the step actually taken.
 * Amount and decay are each raised to the frame count so their product, which
 * is what the shader multiplies, compounds like (amount x decay) ^ frames.
 * Zoom compounds the same way and rotation is linear in time, so two steps of
 * half the length land where one whole step does.
 *
 * Matching the decay is not enough on its own. The new frame is added at full
 * weight every drawn frame, so a faster display adds more of them per second
 * and a still image settles at 1 / (1 - gain per frame): 1.19 at 60 frames a
 * second and 1.87 at 144 with the defaults, and far further apart once the
 * gain is near 1. `fresh` scales the new frame so that sum comes out the same
 * at any rate. It is (1 - gain ^ frames) / (1 - gain), which is 1 at the
 * reference rate and tends to `frames` as the gain tends to 1.
 *
 * Pure and GPU free: it is the only place the frame rate enters the stack.
 */
export function feedbackStep(feedback: FeedbackParams, dt: number): FeedbackStep {
  const frames = feedbackSeconds(dt) * REFERENCE_FPS
  // A base above 1 would grow without bound over a long step, so it is held
  // at what one reference frame gives. Below 1 the power is at most 1 already.
  const keep = (base: number) => {
    const safe = Math.max(base, 0)
    return Math.min(safe ** frames, Math.max(safe, 1))
  }
  const amount = keep(feedback.amount)
  const decay = keep(feedback.decay)
  const gain = Math.min(Math.max(feedback.amount, 0) * Math.max(feedback.decay, 0), 1)
  const counted = Math.min(frames, MAX_FRESH_FRAMES)
  const fresh = 1 - gain < 1e-6 ? counted : (1 - gain ** counted) / (1 - gain)
  return {
    amount,
    decay,
    fresh,
    // The shader divides by the zoom, so it never reaches zero or goes negative.
    zoom: Math.max(feedback.zoom, 0.001) ** frames,
    rotate: feedback.rotate * frames,
  }
}

/**
 * The weight the feedback pass puts on the frame the scene just drew. It is
 * a blend constant and not a uniform float, because the scene is already in
 * the target when the pass runs and only the blend can reach it.
 */
export function freshWeight(params: PostParams, features: Float32Array): number {
  if (!stageEnabled(params, 'feedback')) return 1
  return feedbackStep(params.feedback, features[F.dt] ?? 0).fresh
}

/** Floats in the shared uniform; PostParams in post.common.wgsl must match. */
export const POST_UNIFORM_FLOATS = 32

/**
 * Canvas uv to a flow field's own uv, as `Flow.cover` in `scenes/Scene.ts`
 * gives it: the field is square and covers the canvas with the overflow
 * cropped, so the short side sees a band of it.
 */
export type FlowCover = readonly [number, number]

/**
 * The cover the feedback pass is handed. It both multiplies by it, to find
 * the grid point under a pixel, and divides by it, to turn a velocity in grid
 * widths per second into canvas uv per second, so a zero from a canvas with
 * no area would take the whole warp with it. No flow is the identity, which
 * costs nothing since the carry beside it is then zero.
 */
export function flowCover(cover: FlowCover | null): [number, number] {
  const axis = (value: number | undefined) =>
    Number.isFinite(value) && (value ?? 0) > MIN_COVER ? (value as number) : 1
  if (!cover) return [1, 1]
  return [axis(cover[0]), axis(cover[1])]
}

/**
 * Below this a canvas has no area worth drawing and the cover is meaningless;
 * the identity is a better answer than a warp a thousand screens wide.
 */
const MIN_COVER = 1e-4

/** The ceiling divides in the shader, so nothing may write it as zero. */
const MIN_CEILING = 1e-4

const clone = (params: PostParams): PostParams => ({
  enabled: params.enabled,
  feedback: { ...params.feedback },
  bloom: { ...params.bloom, weights: [...params.bloom.weights] },
  chromatic: { ...params.chromatic },
  tonemap: { ...params.tonemap },
  grain: { ...params.grain },
})

export const defaultPostParams = () => clone(DEFAULT_POST_PARAMS)

/** A new object with the patch applied; neither argument is touched. */
export function mergePostParams(base: PostParams, patch: PostPatch): PostParams {
  const merged = clone(base)
  if (patch.enabled !== undefined) merged.enabled = patch.enabled
  Object.assign(merged.feedback, patch.feedback)
  Object.assign(merged.bloom, patch.bloom)
  Object.assign(merged.chromatic, patch.chromatic)
  Object.assign(merged.tonemap, patch.tonemap)
  Object.assign(merged.grain, patch.grain)
  if (patch.bloom?.weights) merged.bloom.weights = [...patch.bloom.weights]
  return merged
}

export type PostStage = 'feedback' | 'bloom' | 'chromatic' | 'tonemap' | 'grain'

const STAGES: readonly PostStage[] = ['feedback', 'bloom', 'chromatic', 'tonemap', 'grain']

/**
 * Every number in the stack a preset may name, read and written one at a
 * time. The renderer holds the preset's stack as it came and a second copy it
 * modulates, so a mapping that points at `bloom.intensity` writes that one
 * lane each frame rather than rebuilding the whole object.
 *
 * `bloom.weights` is deliberately absent: it is three numbers, a preset can
 * still set it outright, and nothing wants a feature riding on it.
 */
export const POST_LANES = {
  'feedback.amount': {
    read: (p: PostParams) => p.feedback.amount,
    write: (p: PostParams, value: number) => {
      p.feedback.amount = value
    },
  },
  'feedback.decay': {
    read: (p: PostParams) => p.feedback.decay,
    write: (p: PostParams, value: number) => {
      p.feedback.decay = value
    },
  },
  'feedback.zoom': {
    read: (p: PostParams) => p.feedback.zoom,
    write: (p: PostParams, value: number) => {
      p.feedback.zoom = value
    },
  },
  'feedback.rotate': {
    read: (p: PostParams) => p.feedback.rotate,
    write: (p: PostParams, value: number) => {
      p.feedback.rotate = value
    },
  },
  'feedback.carry': {
    read: (p: PostParams) => p.feedback.carry,
    write: (p: PostParams, value: number) => {
      p.feedback.carry = value
    },
  },
  'feedback.ceiling': {
    read: (p: PostParams) => p.feedback.ceiling,
    write: (p: PostParams, value: number) => {
      p.feedback.ceiling = value
    },
  },
  'bloom.threshold': {
    read: (p: PostParams) => p.bloom.threshold,
    write: (p: PostParams, value: number) => {
      p.bloom.threshold = value
    },
  },
  'bloom.knee': {
    read: (p: PostParams) => p.bloom.knee,
    write: (p: PostParams, value: number) => {
      p.bloom.knee = value
    },
  },
  'bloom.intensity': {
    read: (p: PostParams) => p.bloom.intensity,
    write: (p: PostParams, value: number) => {
      p.bloom.intensity = value
    },
  },
  'chromatic.amount': {
    read: (p: PostParams) => p.chromatic.amount,
    write: (p: PostParams, value: number) => {
      p.chromatic.amount = value
    },
  },
  'chromatic.beat': {
    read: (p: PostParams) => p.chromatic.beat,
    write: (p: PostParams, value: number) => {
      p.chromatic.beat = value
    },
  },
  'tonemap.exposure': {
    read: (p: PostParams) => p.tonemap.exposure,
    write: (p: PostParams, value: number) => {
      p.tonemap.exposure = value
    },
  },
  'tonemap.shoulder': {
    read: (p: PostParams) => p.tonemap.shoulder,
    write: (p: PostParams, value: number) => {
      p.tonemap.shoulder = value
    },
  },
  'grain.amount': {
    read: (p: PostParams) => p.grain.amount,
    write: (p: PostParams, value: number) => {
      p.grain.amount = value
    },
  },
} as const

export type PostKnob = keyof typeof POST_LANES

export const POST_KNOBS = Object.keys(POST_LANES) as readonly PostKnob[]

export const isPostKnob = (value: string): value is PostKnob =>
  Object.prototype.hasOwnProperty.call(POST_LANES, value)

/** A stage runs only when both it and the whole stack are on. */
export const stageEnabled = (params: PostParams, stage: PostStage) =>
  params.enabled && params[stage].enabled

/**
 * True when at least one stage runs. With none of them the composite is a
 * straight copy of what the scene drew, which is the measurement the frame
 * times in docs/visualizer.md call the stack off.
 */
export const postIsActive = (params: PostParams) =>
  STAGES.some((stage) => stageEnabled(params, stage))

/** One line for the debug overlay: the stages that are on, or `off`. */
export function postSummary(params: PostParams): string {
  const on = STAGES.filter((stage) => stageEnabled(params, stage))
  return on.length ? on.map((stage) => (stage === 'chromatic' ? 'chroma' : stage)).join(' ') : 'off'
}

/** Half, quarter, eighth of the canvas, never smaller than one pixel. */
export const bloomLevelSize = (width: number, height: number, level: number) => ({
  width: Math.max(1, Math.floor(width / 2 ** (level + 1))),
  height: Math.max(1, Math.floor(height / 2 ** (level + 1))),
})

/**
 * The texture a level's horizontal blur reads. Every level but the first
 * reads the level above and halves it on the way in; the first reads what the
 * bright pass already wrote at its own size. The taps are spaced by this
 * texture's texels, so reading the canvas size here would blur level 0 half
 * as wide sideways as it does vertically.
 */
export const bloomSourceSize = (width: number, height: number, level: number) =>
  bloomLevelSize(width, height, Math.max(0, level - 1))

/**
 * Fill the shared uniform. Everything a stage's toggle decides is resolved
 * here rather than branched on in WGSL: a disabled stage writes zeroes that
 * make its term vanish, so the shaders stay straight-line.
 */
export function writePostUniform(
  params: PostParams,
  features: Float32Array,
  width: number,
  height: number,
  out: Float32Array,
  cover: FlowCover | null = null,
): Float32Array {
  const beat = features[F.beatPulse] ?? 0
  out[0] = width
  out[1] = height
  out[2] = 1 / Math.max(1, width)
  out[3] = 1 / Math.max(1, height)

  const feedback = params.feedback
  const trails = stageEnabled(params, 'feedback')
  const step = feedbackStep(feedback, features[F.dt] ?? 0)
  out[4] = trails ? step.amount : 0
  out[5] = trails ? step.decay : 0
  // The shader divides by the zoom, so an off stage still writes the identity
  // warp rather than a zero.
  out[6] = trails ? step.zoom : 1
  out[7] = trails ? step.rotate : 0

  const bloom = params.bloom
  const glow = stageEnabled(params, 'bloom')
  out[8] = bloom.threshold
  out[9] = Math.max(bloom.knee, 0.0001)
  out[10] = glow ? bloom.intensity : 0
  out[11] = 0
  for (let level = 0; level < BLOOM_LEVELS; level++)
    out[12 + level] = glow ? (bloom.weights[level] ?? 0) : 0
  out[15] = glow ? 1 : 0

  // The beat only ever widens the split, so a track with no onsets keeps the
  // resting amount rather than collapsing to none.
  out[16] = stageEnabled(params, 'chromatic')
    ? params.chromatic.amount + params.chromatic.beat * beat
    : 0
  out[17] = 0
  out[18] = 0
  out[19] = 0

  const tone = stageEnabled(params, 'tonemap')
  out[20] = tone ? params.tonemap.exposure : 1
  // A shoulder of 1 would leave no headroom to bend the top into.
  out[21] = Math.min(Math.max(params.tonemap.shoulder, 0), 0.98)
  out[22] = tone ? 1 : 0
  out[23] = 0

  out[24] = stageEnabled(params, 'grain') ? params.grain.amount : 0
  // The hash in the shader loses its bite on large numbers, so the clock the
  // grain rides wraps every thousand seconds.
  out[25] = (features[F.time] ?? 0) % 1000
  out[26] = 0
  out[27] = 0

  // The flow, last, so everything above sits where it always has. The carry
  // is written as the canvas uv one unit of velocity moves in this frame, so
  // the pass never sees a frame rate; with no flow offered, or the stage off,
  // it is zero and the cover beside it is the identity.
  const dragging = trails && !!cover
  out[28] = dragging ? feedback.carry * feedbackSeconds(features[F.dt] ?? 0) : 0
  out[29] = Number.isFinite(feedback.ceiling)
    ? Math.max(feedback.ceiling, MIN_CEILING)
    : MIN_CEILING
  const scale = flowCover(dragging ? cover : null)
  out[30] = scale[0]
  out[31] = scale[1]
  return out
}
