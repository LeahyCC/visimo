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
import { paletteAt } from '../palettes/active'

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
   * The multiplicative floor: the brightness below which light stops being
   * light and fades away. Where `floor` takes a fixed amount off every pixel
   * and so clips a dim one to black in steps, this scales the history by
   * `peak / (peak + fade)`, which is 1 for anything far above the knee and
   * falls away smoothly under it. Bright light keeps its own decay, a dim
   * tail collapses faster the dimmer it gets, and nothing is ever clipped, so
   * a trail ends rather than stopping.
   *
   * For light well above the knee the two are the same thing: the gate takes
   * about `fade` off a pixel each frame, so a knee reads like a floor of the
   * same size. Under the knee they part company, which is the whole point.
   * 0 is off and is exactly off: the gate is 1 everywhere.
   */
  fade: number
  /**
   * The mean brightness the whole canvas is held at, 0 for no holding at all.
   * This is the gain control inside the loop, and it is what lets the decay
   * run long. Inks only ever add, so with a keep near 1 a frame that lights
   * most of its pixels sums toward `fresh / (1 - keep)` and goes to white;
   * the old answer was to shorten the memory whenever the music got loud,
   * which made the loudest moments the dullest.
   *
   * Instead the stack measures the last frame's mean on the GPU (see
   * `PostStack`, which reduces it to one texel and never reads it back) and
   * scales what survives by `hold / mean` whenever the mean is over the hold.
   * Only the carried sum is scaled. The frame the inks just drew is added at
   * its own weight whatever the canvas is doing, so a thin fresh mark reads at
   * full brightness on the frame it lands and the picture still gets brighter
   * when the music does. What is bounded is how much of the past may pile up
   * under it.
   */
  hold: number
  /**
   * Radians the surviving light's hue turns each frame, 0 for none. Old light
   * shifts colour as it ages, so a trail reads as a run of hues rather than
   * one smeared colour, which is the thing a long memory makes possible and a
   * short one never could. It is a rotation about the grey axis, so it moves
   * a hue and leaves its brightness alone, and 0 is the identity exactly.
   */
  hue: number
  /**
   * How differently the three channels decay, 0 for not at all. Positive
   * cools the trail, holding red back so what is left of it drifts blue;
   * negative warms it the same way with blue. Green is the reference and is
   * never touched, and neither channel is ever kept more than the decay
   * keeps, so this can only ever take light out.
   */
  cool: number
  /**
   * How hard the history is sharpened on its way back, 0 for not at all. A
   * long trail read back through a linear sampler loses a little detail every
   * frame and after a second it is mush; a small unsharp against a four-tap
   * cross puts the filaments back. It compounds, so it is held to
   * `MAX_SHARPEN` once the step has scaled it, and the result is floored at
   * zero, so the overshoot either side of an edge cannot go negative.
   */
  sharpen: number
  /**
   * The most light one frame may carry back from the history. A trail near
   * gain 1 sums without bound otherwise, and half floats reach 65504 before
   * anything stops them. Below half of this nothing changes; above it the
   * brightest channel bends toward the ceiling and never reaches it, and the
   * other two follow it, because limiting each channel on its own bleaches
   * the colour toward white.
   *
   * It is a per-pixel limit and `hold` is a whole-frame one: the ceiling says
   * how bright one carried pixel may be and the hold says how bright the sum
   * of all of them may be, so a canvas that holds its mean may still carry a
   * core far above it.
   */
  ceiling: number
}
// The first four numbers above, `floor`, `hue` and `sharpen` are what one
// frame does at 60 frames a second, and so are `fade` and `cool`, which are
// keep factors the pass raises to the step. `feedbackStep` converts all of
// them by the real step, so a trail lasts, travels, turns and cools the same
// number of seconds on any display. `carry` is per second already, since the
// velocity it scales is, and `ceiling` and `hold` are brightnesses and have no
// rate in them at all.

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

/**
 * The frame's edges, its colour and its steadiness, in the composite before the
 * tonemap, so the tonemap still bends the highlights that survive it. All three
 * numbers are neutral at rest, so switching the stage on with nothing said
 * changes nothing. `writePostUniform` holds each to its own range, because a
 * row may carry a lane past its end (an impact undoing what tension did does
 * exactly that) and the shader should only ever see a number it can use.
 */
export type GradeParams = {
  enabled: boolean
  /**
   * How far the frame closes in, 0 for none and 1 for closed down hard to the
   * centre. See `vignetteLight` for the shape, which is what makes the middle
   * of the range already plain to see.
   */
  vignette: number
  /**
   * 1 leaves the colour alone and 0 is grey. Colour is scaled about the pixel's
   * own luminance and no channel is clamped, so a hue is thinned and not bent.
   * It stops at 1: above it the smallest channel of a saturated pixel goes
   * negative, and the composite's last `max` then clips it, which is the hue
   * shift the tonemap is built to avoid.
   */
  saturation: number
  /**
   * Gate weave: how far the whole frame drifts, at most, in pixels on a 1080
   * pixel canvas and scaled with the canvas, 0 for none. It is the way a strip
   * wanders in the gate of a projector, a pixel or two, slowly and never
   * repeating, and it is meant to be felt and not seen: a weave that reads as
   * motion is too much. See `gateWeave` for the path and `weaveUv` for how the
   * frame's edge is kept clean.
   */
  weave: number
}

export type PostParams = {
  /** Off skips every stage, leaving the composite a straight copy. */
  enabled: boolean
  ribbon: RibbonParams
  feedback: FeedbackParams
  bloom: BloomParams
  chromatic: ChromaticParams
  grade: GradeParams
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
  grade?: Partial<GradeParams>
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
    // the history, nothing holds its mean, nothing ages its colour or its
    // detail, and the ceiling sits far above anything a scene draws, so the
    // shipped casts meet none of it. Every one of these is exactly off at its
    // default, which is why the pinned casts draw what they always drew
    // without a compatibility path of their own.
    carry: 0,
    floor: 0,
    fade: 0,
    hold: 0,
    hue: 0,
    cool: 0,
    sharpen: 0,
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
  // Off, so no shipped cast prints `grade` in `data-post`, and neutral even
  // when a look switches it on: no vignette, every colour as it was, and a
  // frame that stays where it is.
  grade: { enabled: false, vignette: 0, saturation: 1, weave: 0 },
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
  /** This drawn frame in reference frames, which the pass raises its gates to. */
  frames: number
  /**
   * The lever the canvas hold pulls on, `keep / (1 - keep)` at the reference
   * rate. See `canvasKeep` for what it is doing there; it is worked out here
   * because the reference keep is a CPU number and the hold's own factor is
   * not.
   */
  pull: number
  /** The knee of the multiplicative floor, which has no rate in it. */
  fade: number
  /** The mean the canvas is held at, which has no rate in it either. */
  hold: number
  /** Radians of hue turned on this drawn frame. */
  hue: number
  /** How differently the channels decay, per reference frame. */
  cool: number
  /** Unsharp on this drawn frame, held to `MAX_SHARPEN`. */
  sharpen: number
}

/**
 * The most unsharp one drawn frame may apply. The pass adds `k x (history -
 * its own blur)` back, so the most a pixel can gain is `1 + k` of itself and
 * the ringing beside an edge is the same size. At a half that is a visible
 * crispening and still well short of the halo that a sharpen near 1 draws,
 * and since the amount compounds every frame a long step must not be allowed
 * to spend a second's worth of it at once.
 */
export const MAX_SHARPEN = 0.5

/**
 * How far the canvas hold may cut what survives in one reference frame. It is
 * a guard and not a taste: the hold divides by the measured mean, and a frame
 * that is twenty times the hold would otherwise leave nothing of the past at
 * all for as long as it lasts.
 */
export const MIN_CANVAS_GAIN = 0.05

/** The smallest `1 - keep` the pull is worked out over, so it stays finite. */
const MIN_KEEP_SLACK = 1e-3

/**
 * What the canvas hold asks of the history this frame: 1 for leave it alone,
 * and `hold / mean` once the last frame's mean brightness is over the hold.
 * It only ever takes light out, which is what keeps silence exactly black: a
 * hold that could push a gain above 1 would amplify whatever the last frame
 * had left in it, and an empty canvas would grow its own noise.
 *
 * The pass computes this from a texel the GPU measured, and this states the
 * same arithmetic so the loop can be tested without one.
 */
export function canvasGain(measured: number, hold: number): number {
  if (!(hold > 0) || !Number.isFinite(measured) || measured <= hold) return 1
  return Math.min(Math.max(hold / measured, MIN_CANVAS_GAIN), 1)
}

/**
 * What one drawn frame keeps of the history once the hold has had its say.
 *
 * The obvious thing, multiplying the step's keep by the gain, is wrong at any
 * rate but the reference one: the fresh frame's weight is normalised against
 * the keep the CPU knows about and not against the gain the GPU found, so a
 * 144 Hz display would settle somewhere else than a 60 Hz one, by a fifth at
 * the far end. The fix is to ask what per-reference-frame keep the gain means
 * (`keep x gain`) and then take the step that lands on the same settled level,
 * which works out as a straight line in `1 - keep ^ frames`:
 *
 *   kept = base - (1 - base) x pull x (1 - gain),   pull = keep / (1 - keep)
 *
 * At one reference frame `base` is `keep` and this is `keep x gain` exactly;
 * at a gain of 1 the second term is exactly zero, so a canvas with no hold
 * keeps precisely what it always kept. `settled` in the tests is what proves
 * both ends of that.
 */
export function canvasKeep(step: FeedbackStep, gain: number): number {
  const base = step.amount * step.decay
  return Math.min(Math.max(base - (1 - base) * step.pull * (1 - gain), 0), 1)
}

/**
 * What the multiplicative floor leaves of a pixel whose brightest channel is
 * `peak`, over a step of `frames` reference frames. Far above the knee it is
 * 1 and the pixel decays as it always did; at the knee it is a half; under it
 * the pixel is taken out in a hurry and smoothly, never clipped. A knee of 0
 * is exactly 1, with no division by zero at a black pixel.
 */
export function fadeKeep(peak: number, fade: number, frames: number): number {
  if (!(fade > 0)) return 1
  const light = Math.max(peak, 0)
  return (light / (light + fade)) ** frames
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
    frames,
    // The reference keep is what the hold's own factor is turned into a step
    // against; see `canvasKeep`. Held clear of 1 so the lever stays finite,
    // which costs nothing because a keep of 1 is a canvas that never fades.
    pull: gain / Math.max(1 - gain, MIN_KEEP_SLACK),
    // A knee and a mean, both brightnesses: the pass raises the first to the
    // step and compares the second against what it measured, so neither has a
    // rate of its own to convert here.
    fade: Math.max(feedback.fade, 0),
    hold: Math.max(feedback.hold, 0),
    // Radians and an unsharp, both linear in time the way the rotation is.
    hue: feedback.hue * frames,
    sharpen: Math.min(Math.max(feedback.sharpen, 0) * frames, MAX_SHARPEN),
    // A keep offset per reference frame, which the pass raises to the step
    // alongside the decay. Held inside a whole channel either way, since past
    // that a channel would be kept backwards rather than merely dropped.
    cool: Math.min(Math.max(feedback.cool, -1), 1),
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

/** Floats in the shared uniform, fifteen vec4s; PostParams in post.common.wgsl must match. */
export const POST_UNIFORM_FLOATS = 60

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
 * The colour of the line: the palette showing, at the song's key, scaled so its
 * brightest channel is 1. Classic's dimmest stop peaks at 0.34 and its
 * brightest at 0.94, and the designed palettes differ from one another too, so
 * left as they are the line would be about a third as bright in one key or one
 * palette as in another and `intensity` would mean a different thing in each.
 * Scaled, it is the peak brightness whatever the key.
 *
 * `offset` moves along the palette from the ribbon's own place in it, so the
 * streaks can scatter their hues around the ribbon's without a palette of
 * their own. At 0 it is the ribbon's colour exactly.
 */
export function ribbonColour(features: Float32Array, offset = 0): [number, number, number] {
  return peakPaletteAt((features[F.keyHue] ?? 0) + RIBBON_TINT + offset)
}

/**
 * The palette showing at one coordinate, scaled so its brightest channel is 1.
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

/**
 * How wide the vignette's edge is, in the same units as its distance. It rides
 * in the uniform, so the two composites read one number and cannot drift.
 */
export const VIGNETTE_SOFTNESS = 0.75

/**
 * The share of light a pixel keeps under the vignette, which the composite
 * computes on the GPU and this states so the shape can be tested. `distance`
 * runs from 0 at the centre to 1 at a corner, so the middle of an edge is
 * about 0.7, and the frame follows its own shape rather than a circle.
 *
 * The clear zone shrinks as the number climbs: it reaches the corner at 0,
 * where nothing is touched, and the centre at 1. The edge is a smoothstep as
 * wide as `VIGNETTE_SOFTNESS`, which is what keeps the middle of the range
 * strong: at a half the corners are down to a quarter of their light while the
 * middle of each edge has lost a fifth, where a plain power of the distance
 * would spend the whole range before it showed. At 1 the edges are black and
 * only the middle of the frame is lit.
 */
export function vignetteLight(distance: number, vignette: number): number {
  const inner = 1 - vignette
  const t = Math.min(Math.max((distance - inner) / VIGNETTE_SOFTNESS, 0), 1)
  return 1 - t * t * (3 - 2 * t)
}

/**
 * A grade number as the shader may see it: held to its own range, and to the
 * neutral one if it is not a number at all, since a NaN would take the frame.
 */
const gradeValue = (value: number, neutral: number) =>
  Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : neutral

/**
 * The most weave the uniform will carry, in pixels at 1080 high. Past a few
 * pixels the drift stops being a wander in a gate and starts to be a camera
 * shake, and the frame's edge is cropped by twice this, so a row that runs
 * away is held here rather than trusted.
 */
export const MAX_WEAVE = 4

/** The canvas height a `grade.weave` is written against, the ribbon's as well. */
const WEAVE_REFERENCE_HEIGHT = 1080

/**
 * One axis of the weave: a few sines that never line up, so the path does not
 * repeat over any span anyone will watch. Rates are in hertz and the weights
 * sum to 1 (in sixteenths, so the sum is exact), which is what makes the path stay
 * inside -1 to 1. The slowest is the wander and the fastest is the flutter on
 * top of it, kept small; the whole path moves at most about 2 pixels a second
 * per pixel of weave.
 */
type WeaveTerm = { hertz: number; phase: number; weight: number }

const WEAVE_X: readonly WeaveTerm[] = [
  { hertz: 0.113, phase: 0.7, weight: 0.5 },
  { hertz: 0.271, phase: 2.9, weight: 0.3125 },
  { hertz: 0.613, phase: 4.4, weight: 0.1875 },
]

// Different rates from the horizontal, and none of them a simple ratio of one
// there, so the frame wanders in a loop that does not close instead of along a
// diagonal or round a circle.
const WEAVE_Y: readonly WeaveTerm[] = [
  { hertz: 0.157, phase: 5.1, weight: 0.5 },
  { hertz: 0.349, phase: 1.3, weight: 0.3125 },
  { hertz: 0.719, phase: 3.6, weight: 0.1875 },
]

const weaveAxis = (terms: readonly WeaveTerm[], seconds: number) => {
  let sum = 0
  for (const term of terms)
    sum += term.weight * Math.sin(Math.PI * 2 * term.hertz * seconds + term.phase)
  return sum
}

/**
 * Where the strip sits in the gate, as a unit offset on each axis, -1 to 1.
 * It is a function of the clock and of nothing else, so it reads the same at
 * any frame rate and the same song weaves the same way twice; nothing here
 * counts frames or draws a random number. The clock is the packet's `time`
 * unwrapped, since the grain's is wrapped every thousand seconds and a weave
 * that jumped there would be seen.
 */
export function gateWeave(seconds: number): [number, number] {
  const clock = Number.isFinite(seconds) ? seconds : 0
  return [weaveAxis(WEAVE_X, clock), weaveAxis(WEAVE_Y, clock)]
}

/**
 * What the composite needs to move the frame: the offset it samples at and how
 * much of the frame it gives up to keep the edge clean, both in canvas uv.
 *
 * A frame shifted by a pixel shows one pixel of whatever lies past its edge. A
 * clamped sampler would repeat the last row there, a streak that comes and goes
 * along the border, which is the seam this exists to prevent. So the frame is
 * sampled from a span narrowed by the weave's own reach on both sides
 * (`shrink`), which is under a fifth of a percent of the frame for each pixel
 * of weave, and the offset then moves that span about inside the picture and
 * never off it. It costs a fixed crop the size of the weave and nothing else,
 * and at a weave of 0 it is the identity exactly, so nothing else moves.
 */
export type WeaveUv = {
  offset: readonly [number, number]
  shrink: readonly [number, number]
}

const NO_WEAVE: WeaveUv = { offset: [0, 0], shrink: [0, 0] }

export function weaveUv(weave: number, seconds: number, width: number, height: number): WeaveUv {
  const reach = Number.isFinite(weave) ? Math.min(Math.max(weave, 0), MAX_WEAVE) : 0
  // Plain zeros and not a product with them, which is a negative zero half the
  // time.
  if (reach === 0) return NO_WEAVE
  // Pixels at this canvas. A canvas with no area has nowhere to move the frame.
  const pixels = (reach * height) / WEAVE_REFERENCE_HEIGHT
  const across = Math.max(1, width)
  const down = Math.max(1, height)
  const [x, y] = gateWeave(seconds)
  return {
    offset: [(pixels * x) / across, (pixels * y) / down],
    shrink: [(2 * pixels) / across, (2 * pixels) / down],
  }
}

const clone = (params: PostParams): PostParams => ({
  enabled: params.enabled,
  ribbon: { ...params.ribbon },
  feedback: { ...params.feedback },
  bloom: { ...params.bloom, weights: [...params.bloom.weights] },
  chromatic: { ...params.chromatic },
  grade: { ...params.grade },
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
  Object.assign(out.grade, patch.grade)
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
  grade: { ...base.grade, ...patch.grade },
  tonemap: { ...base.tonemap, ...patch.tonemap },
  grain: { ...base.grain, ...patch.grain },
})

export type PostStage =
  'ribbon' | 'feedback' | 'bloom' | 'chromatic' | 'grade' | 'tonemap' | 'grain'

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
  'grade',
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
  'feedback.fade': {
    read: (p: PostParams) => p.feedback.fade,
    write: (p: PostParams, value: number) => {
      p.feedback.fade = value
    },
  },
  'feedback.hold': {
    read: (p: PostParams) => p.feedback.hold,
    write: (p: PostParams, value: number) => {
      p.feedback.hold = value
    },
  },
  'feedback.hue': {
    read: (p: PostParams) => p.feedback.hue,
    write: (p: PostParams, value: number) => {
      p.feedback.hue = value
    },
  },
  'feedback.cool': {
    read: (p: PostParams) => p.feedback.cool,
    write: (p: PostParams, value: number) => {
      p.feedback.cool = value
    },
  },
  'feedback.sharpen': {
    read: (p: PostParams) => p.feedback.sharpen,
    write: (p: PostParams, value: number) => {
      p.feedback.sharpen = value
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
  'grade.vignette': {
    read: (p: PostParams) => p.grade.vignette,
    write: (p: PostParams, value: number) => {
      p.grade.vignette = value
    },
  },
  'grade.saturation': {
    read: (p: PostParams) => p.grade.saturation,
    write: (p: PostParams, value: number) => {
      p.grade.saturation = value
    },
  },
  'grade.weave': {
    read: (p: PostParams) => p.grade.weave,
    write: (p: PostParams, value: number) => {
      p.grade.weave = value
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
 * How far each rung of the measuring ladder shrinks the one above it. Four
 * bilinear taps average a 4 by 4 block exactly, so quartering each way is the
 * most one pass can do without leaving texels unread, and it takes a 4K frame
 * to one texel in seven passes of almost nothing.
 */
const MEASURE_STEP = 4

/**
 * The rungs of the ladder that measures the canvas, largest first and one
 * texel last. Pure, so the ladder can be checked without a GPU: every rung is
 * smaller than the one before it, the list ends at one texel, and a canvas
 * with no area still gets the single rung the pass has to read.
 */
export function measureSizes(
  width: number,
  height: number,
): readonly { width: number; height: number }[] {
  const out: { width: number; height: number }[] = []
  let w = Math.max(1, Math.floor(width))
  let h = Math.max(1, Math.floor(height))
  do {
    w = Math.max(1, Math.ceil(w / MEASURE_STEP))
    h = Math.max(1, Math.ceil(h / MEASURE_STEP))
    out.push({ width: w, height: h })
  } while (w > 1 || h > 1)
  return out
}

/**
 * Whether the canvas hold runs this frame. With it off the ladder is not
 * encoded at all and the pass reads a zeroed texel, so a cast that does not
 * ask for the hold pays nothing for it.
 */
export const holdRuns = (params: PostParams) =>
  stageEnabled(params, 'feedback') && params.feedback.hold > 0

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
  // which takes nothing off the history, and so is the knee beside it, which
  // leaves the multiplicative floor's gate at 1 for every pixel.
  out[32] = trails ? step.floor : 0
  out[33] = trails ? step.fade : 0
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

  // The grade, last, in a vec4 of its own. Off writes the neutral pair, which
  // the shader turns into no vignette and colour exactly as it was, so no
  // branch. The softness is a constant that rides along so the composites
  // share it.
  const graded = stageEnabled(params, 'grade')
  out[44] = graded ? gradeValue(params.grade.vignette, 0) : 0
  out[45] = graded ? gradeValue(params.grade.saturation, 1) : 1
  out[46] = VIGNETTE_SOFTNESS
  out[47] = 0

  // The weave, in a vec4 of its own, the grade's having no float left. The
  // offset and the crop are worked out here in canvas uv, so the composites
  // only add and scale, and off is zeros, which changes no sample at all.
  const weave = weaveUv(graded ? params.grade.weave : 0, features[F.time] ?? 0, width, height)
  out[48] = weave.offset[0]
  out[49] = weave.offset[1]
  out[50] = weave.shrink[0]
  out[51] = weave.shrink[1]

  // The canvas hold, in a vec4 of its own past every float the uniform
  // already had. `frames` is the step the pass raises its two gates to, and
  // it is 1 rather than 0 with the stage off so a gate of 1 stays 1. A hold
  // of 0 is off, and the pass then never divides by what it measured.
  out[52] = trails ? step.frames : 1
  out[53] = trails ? step.pull : 0
  out[54] = trails ? step.hold : 0
  // The floor on the hold's own factor rides along rather than being written
  // twice, so `canvasGain` and the pass cannot drift apart.
  out[55] = MIN_CANVAS_GAIN

  // What ages inside the loop: the turn of the hue, how far the channels part
  // and the unsharp, all zero with the stage off and all exactly off at zero.
  out[56] = trails ? step.hue : 0
  out[57] = trails ? step.cool : 0
  out[58] = trails ? step.sharpen : 0
  out[59] = 0
  return out
}
