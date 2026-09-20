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
import { resampleWaveform } from '../audio/waveform'
import { paletteAt } from '../scenes/fluid.params'

/**
 * The sound drawn as a line, added to the scene's own picture before the
 * feedback pass adds the history, so the trails carry it. Every number in it
 * is a resting value the preset may move.
 */
export type RibbonParams = {
  /** Off draws nothing and uploads nothing. */
  enabled: boolean
  /** Peak brightness of the line, 0 for none. The colour is scaled so its brightest channel is 1. */
  intensity: number
  /** Width in pixels on a 1080 pixel canvas, scaled with the canvas. */
  width: number
  /**
   * How far the sound pushes the line off its resting place, as a fraction of
   * the canvas: its height for the horizontal line, its short side for the
   * circle. A full-scale sample moves the line that far.
   */
  height: number
  /** 0 is a horizontal line across the middle, 1 a circle about the centre. Halfway rounds up. */
  shape: number
}

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
   * Light taken off the carried history every frame, 0 for none. A scene
   * that adds a constant to every pixel, as the fluid's background colour
   * is, sums that constant to `base / (1 - amount x decay)` under a long
   * trail and the whole frame lifts into a haze. Subtracting a little more
   * than the constant holds the blacks black, which is most of why
   * MilkDrop's trails read as well as they do. It comes off the brightest
   * channel and the other two are scaled by the same fraction, for the
   * reason `ceiling` gives.
   *
   * It is subtractive, so faint light dies faster than bright light: a
   * trail lasts roughly its own brightness divided by this, in frames, once
   * the decay is near 1.
   */
  floor: number
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
// The first four numbers above, and `floor`, are what one frame does at 60
// frames a second. `feedbackStep` converts them by the real step, so a trail
// lasts and travels the same number of seconds on any display. `carry` is per
// second already, since the velocity it scales is, and `ceiling` is a
// brightness and has no rate in it at all.

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
  ribbon: RibbonParams
  feedback: FeedbackParams
  bloom: BloomParams
  chromatic: ChromaticParams
  tonemap: TonemapParams
  grain: GrainParams
}

/** A partial update, one stage at a time; what a preset will hand over. */
export type PostPatch = {
  enabled?: boolean
  ribbon?: Partial<RibbonParams>
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
  // Off, and at no intensity even when a preset switches it on, so the stage
  // draws nothing until a preset says how bright.
  ribbon: { enabled: false, intensity: 0, width: 3, height: 0.25, shape: 0 },
  feedback: {
    enabled: true,
    amount: 0.22,
    decay: 0.72,
    zoom: 1.012,
    rotate: 0.002,
    // Off: the pass is the zoom and turn it always was. Nothing is taken off
    // the history, and the ceiling sits far above anything a scene draws, so
    // the shipped presets meet neither.
    carry: 0,
    floor: 0,
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
  /** Light taken off the history on this drawn frame. */
  floor: number
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
    // Light per unit of time, so it scales with the step the way the rotation
    // does rather than compounding the way the decay does. A negative one
    // would add light instead of taking it, which is not what the knob means.
    floor: Math.max(feedback.floor, 0) * frames,
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
export const POST_UNIFORM_FLOATS = 44

/**
 * Points along the ribbon. A few hundred is a smooth line at 4K, and the
 * buffer they live in is sized from this once and never again.
 */
export const RIBBON_POINTS = 256

/**
 * How much sound the line shows. The span is 1536 samples, about 32 ms: a
 * couple of cycles of a kick, so the shape of a bass note is readable, and
 * plenty of a hat. The search is how many older samples the window may give
 * up to start on a rising zero crossing. The two together stay inside the
 * 4096 samples the analyser holds.
 */
export const RIBBON_SPAN = 1536
export const RIBBON_SEARCH = 512

/** The canvas height a `ribbon.width` is written against, in pixels. */
const RIBBON_REFERENCE_HEIGHT = 1080

/** How far out the circle sits at rest, as a fraction of the canvas's short side. */
const RIBBON_RADIUS = 0.28

/**
 * Where in the fluid's palette the line sits, as an offset from the key. The
 * fluid's plumes are shades within under half a palette of the key, so half a
 * palette on is the far side of them, and a line drawn there reads against the
 * dye instead of vanishing into it. It moves with the key like everything else.
 */
export const RIBBON_TINT = 0.5

/** Vertices in the strip: two a point, and one point more than there are to close a circle. */
export const RIBBON_VERTICES = 2 * (RIBBON_POINTS + 1)

/**
 * Whether the ribbon draws at all this frame. A line with no light or no width
 * adds nothing, so it is skipped rather than drawn as nothing.
 */
export const ribbonRuns = (params: PostParams) =>
  stageEnabled(params, 'ribbon') && params.ribbon.intensity > 0 && params.ribbon.width > 0

/**
 * The colour of the line: the fluid's own palette at the song's key, scaled so
 * its brightest channel is 1. The palette's dimmest stop peaks at 0.34 and its
 * brightest at 0.94, so left as they are the line would be about a third as
 * bright in one key as in another and `intensity` would mean a different
 * thing in each. Scaled, it is the peak brightness whatever the key.
 *
 * `offset` moves along the palette from the ribbon's own place in it, so the
 * streaks can scatter their hues around the ribbon's without a palette of
 * their own. At 0 it is the ribbon's colour exactly.
 */
export function ribbonColour(features: Float32Array, offset = 0): [number, number, number] {
  return peakPaletteAt((features[F.keyHue] ?? 0) + RIBBON_TINT + offset)
}

/**
 * The fluid's palette at one coordinate, scaled so its brightest channel is 1.
 * Split out of `ribbonColour` so an ink that spreads its colour around the
 * key, the shards, draws from the same palette at the same peak brightness
 * and does not keep a second one.
 */
export function peakPaletteAt(coordinate: number): [number, number, number] {
  const [red, green, blue] = paletteAt(coordinate)
  const peak = Math.max(red, green, blue)
  // Written so that a NaN from a bad key falls through to white, not to NaN.
  return peak > 1e-4 ? [red / peak, green / peak, blue / peak] : [1, 1, 1]
}

/** The newest sound as the ribbon's points, into a buffer the caller keeps. */
export const fillRibbonPoints = (waveform: Float32Array, out: Float32Array): Float32Array =>
  resampleWaveform(waveform, out, RIBBON_SPAN, RIBBON_SEARCH)

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
  ribbon: { ...params.ribbon },
  feedback: { ...params.feedback },
  bloom: { ...params.bloom, weights: [...params.bloom.weights] },
  chromatic: { ...params.chromatic },
  tonemap: { ...params.tonemap },
  grain: { ...params.grain },
})

export const defaultPostParams = () => clone(DEFAULT_POST_PARAMS)

/**
 * A patch applied in place. The renderer resolves the cast into one object it
 * keeps and hands to the stack, so the development handle's override has to
 * reach that object rather than a copy of it.
 */
export function patchPostParams(out: PostParams, patch: PostPatch): PostParams {
  if (patch.enabled !== undefined) out.enabled = patch.enabled
  Object.assign(out.ribbon, patch.ribbon)
  Object.assign(out.feedback, patch.feedback)
  Object.assign(out.bloom, patch.bloom)
  Object.assign(out.chromatic, patch.chromatic)
  Object.assign(out.tonemap, patch.tonemap)
  Object.assign(out.grain, patch.grain)
  if (patch.bloom?.weights) out.bloom.weights = [...patch.bloom.weights]
  return out
}

/** A new object with the patch applied; neither argument is touched. */
export const mergePostParams = (base: PostParams, patch: PostPatch): PostParams =>
  patchPostParams(clone(base), patch)

/**
 * Two patches as one, stage by stage. A shallow spread would drop whatever
 * the earlier patch said about a stage the later one also names, which for
 * the development handle means switching one stage off and then moving a
 * number in it puts it back on.
 */
export const mergePostPatch = (base: PostPatch, patch: PostPatch): PostPatch => ({
  ...base,
  ...patch,
  ribbon: { ...base.ribbon, ...patch.ribbon },
  feedback: { ...base.feedback, ...patch.feedback },
  bloom: { ...base.bloom, ...patch.bloom },
  chromatic: { ...base.chromatic, ...patch.chromatic },
  tonemap: { ...base.tonemap, ...patch.tonemap },
  grain: { ...base.grain, ...patch.grain },
})

export type PostStage = 'ribbon' | 'feedback' | 'bloom' | 'chromatic' | 'tonemap' | 'grain'

/**
 * Every stage, in the order the passes run. `postSummary` prints the running
 * ones in this order and the canvas's `data-post` is that line, so a stage
 * that is off by default leaves every preset that does not turn it on
 * printing exactly what it did.
 */
export const POST_STAGES: readonly PostStage[] = [
  'ribbon',
  'feedback',
  'bloom',
  'chromatic',
  'tonemap',
  'grain',
]

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
  'ribbon.intensity': {
    read: (p: PostParams) => p.ribbon.intensity,
    write: (p: PostParams, value: number) => {
      p.ribbon.intensity = value
    },
  },
  'ribbon.width': {
    read: (p: PostParams) => p.ribbon.width,
    write: (p: PostParams, value: number) => {
      p.ribbon.width = value
    },
  },
  'ribbon.height': {
    read: (p: PostParams) => p.ribbon.height,
    write: (p: PostParams, value: number) => {
      p.ribbon.height = value
    },
  },
  'ribbon.shape': {
    read: (p: PostParams) => p.ribbon.shape,
    write: (p: PostParams, value: number) => {
      p.ribbon.shape = value
    },
  },
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
  'feedback.floor': {
    read: (p: PostParams) => p.feedback.floor,
    write: (p: PostParams, value: number) => {
      p.feedback.floor = value
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
  POST_STAGES.some((stage) => stageEnabled(params, stage))

/** One line for the debug overlay: the stages that are on, or `off`. */
export function postSummary(params: PostParams): string {
  const on = POST_STAGES.filter((stage) => stageEnabled(params, stage))
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

  // The floor wants a vec4 of its own, the flow one being full. Off is zero,
  // which takes nothing off the history.
  out[32] = trails ? step.floor : 0
  out[33] = 0
  out[34] = 0
  out[35] = 0

  // The ribbon, last again. It is resolved to pixels here so the shader does
  // no scaling of its own. A ribbon that is off, or has no light or no width,
  // writes zeros, so were it ever drawn it would add nothing.
  const drawn = ribbonRuns(params)
  const ribbon = params.ribbon
  const circle = drawn && ribbon.shape >= 0.5
  const short = Math.min(width, height)
  const [red, green, blue] = drawn ? ribbonColour(features) : [0, 0, 0]
  out[36] = drawn ? ribbon.intensity : 0
  out[37] = drawn ? ribbon.width * (short / RIBBON_REFERENCE_HEIGHT) : 0
  // A height is a fraction of the canvas in the direction the sound pushes:
  // down the frame for the line, out from the middle for the circle.
  out[38] = drawn ? Math.max(ribbon.height, 0) * (circle ? short : height) : 0
  out[39] = circle ? 1 : 0
  out[40] = red ?? 0
  out[41] = green ?? 0
  out[42] = blue ?? 0
  out[43] = circle ? RIBBON_RADIUS * short : 0
  return out
}
