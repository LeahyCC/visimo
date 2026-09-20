import { BAND_COUNT, BAND_HIT } from '../audio/FeatureExtractor'
import type { KaleidoscopeKnob, Tuning } from '../presets/knobs'

export type KaleidoscopeParams = Record<KaleidoscopeKnob, number>

/** Limits also cover audio mappings, which can push beyond a slider's range. */
export const KALEIDOSCOPE_RANGES: Record<KaleidoscopeKnob, readonly [number, number]> = {
  symmetry: [3, 16],
  zoom: [0.4, 3],
  zoomAmount: [0, 1.5],
  zoomSpeed: [-1, 1],
  bandReaction: [0, 2],
  depth: [0, 1],
  rotationSpeed: [-0.3, 0.3],
  travelSpeed: [-0.3, 0.3],
  morphSpeed: [0, 0.4],
  complexity: [3, 10],
  warp: [0, 1],
  thickness: [0.1, 1],
  bassLift: [0, 1],
  sparkle: [0, 1],
  intensity: [0, 2],
  saturation: [0, 1.5],
  colourShift: [0, 1],
  colourDrift: [-0.1, 0.1],
  glint: [0, 1],
  glintKnee: [0.05, 1],
}

export const KALEIDOSCOPE_DEFAULTS: KaleidoscopeParams = {
  symmetry: 6,
  zoom: 0.85,
  zoomAmount: 0.8,
  zoomSpeed: 0.22,
  bandReaction: 1,
  depth: 0.55,
  rotationSpeed: 0.025,
  travelSpeed: 0.035,
  morphSpeed: 0.055,
  complexity: 7,
  warp: 0.35,
  thickness: 0.42,
  bassLift: 0,
  sparkle: 0.1,
  intensity: 1,
  saturation: 1.1,
  colourShift: 0,
  colourDrift: 0.009,
  // Off, so a tuning that names no threshold draws what it always drew.
  glint: 0,
  glintKnee: 0.35,
}

export const wrapPhase = (value: number, period = Math.PI * 2) =>
  ((value % period) + period) % period

export function kaleidoscopeParams(tuning: Tuning): KaleidoscopeParams {
  const params = { ...KALEIDOSCOPE_DEFAULTS }
  for (const name of Object.keys(params) as KaleidoscopeKnob[]) {
    const value = tuning[name]
    const [low, high] = KALEIDOSCOPE_RANGES[name]
    if (value !== undefined && Number.isFinite(value))
      params[name] = Math.min(high, Math.max(low, value))
  }
  params.symmetry = Math.round(params.symmetry)
  params.complexity = Math.round(params.complexity)
  return params
}

/** Integrating speed preserves position when a preset or the music changes it. */
export class KaleidoscopeMotion {
  rotation = 0
  travel = 0
  morph = 0
  colour = 0
  lift = 0
  sparkle = 0
  zoomPhase = 0
  /** One vec4 per band: sustained level, hit envelope, motion phase, padding. */
  readonly bands = new Float32Array(BAND_COUNT * 4)

  step(params: KaleidoscopeParams, dt: number, features?: Float32Array) {
    const elapsed = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0
    this.rotation = wrapPhase(this.rotation + params.rotationSpeed * elapsed)
    this.travel = wrapPhase(this.travel + params.travelSpeed * elapsed)
    this.morph = wrapPhase(this.morph + params.morphSpeed * elapsed)
    this.colour = wrapPhase(this.colour + params.colourDrift * elapsed, 1)
    this.zoomPhase = wrapPhase(this.zoomPhase + params.zoomSpeed * elapsed)
    this.lift += (params.bassLift - this.lift) * (1 - Math.exp(-elapsed / 0.12))
    this.sparkle += (params.sparkle - this.sparkle) * (1 - Math.exp(-elapsed / 0.055))
    // Like Plume, a hit belongs to its own band. Lower sounds keep their
    // weight longer; high sounds leave a brief accent instead of a global flash.
    for (let band = 0; band < BAND_COUNT; band++) {
      const slot = band * 4
      const bounded = (value: number | undefined) =>
        Number.isFinite(value) ? Math.min(1, Math.max(0, value ?? 0)) : 0
      const level = bounded(features?.[band])
      const hit = bounded(features?.[BAND_HIT + band])
      const previous = this.bands[slot] ?? 0
      const response = level > previous ? 0.035 : 0.28 - band * 0.04
      this.bands[slot] = previous + (level - previous) * (1 - Math.exp(-elapsed / response))
      this.bands[slot + 1] = Math.max(
        hit,
        (this.bands[slot + 1] ?? 0) * Math.exp(-elapsed / (0.42 - band * 0.07)),
      )

      this.bands[slot + 2] = wrapPhase(
        (this.bands[slot + 2] ?? 0) +
          elapsed * (0.08 + band * 0.035 + level * params.bandReaction * 0.45),
      )
    }
  }
}

/**
 * The brightness threshold, which is what keeps this ink sparse.
 *
 * The fractal is a full-frame image. On a canvas with no history that is
 * fine, and Prism has drawn it that way from the start. On a canvas that
 * keeps most of itself every frame it is not: light that covers every pixel
 * is summed by the trail until the whole frame sits at the ceiling, which is
 * why Melt washed out on a drop. So the ink drops its own dim body before it
 * leaves the shader and adds only the bright parts.
 *
 * What the level is measured against is the whole of the decision, and an
 * absolute one is the wrong answer. The fractal's light swings with the
 * music: at a full packet every band drives its own folds to the clamp and a
 * lit pixel reaches the full enamel, and in a quiet passage the same pixel is
 * a fraction of that. A fixed level would take the loud frame whole, which is
 * exactly where it must be sparse, and take the quiet one to black, where
 * there was nothing wrong in the first place.
 *
 * So the level is a share of the brightest this frame can be, and that is a
 * number the CPU already holds. Two things scale the whole picture, and the
 * fixed 2.2 the shader multiplies by sits with them:
 *
 *   intensity       the ink's own light, the last thing the shader multiplies
 *   drive           how hard the bands are driving their folds, below
 *
 * A lit pixel is mixed toward the enamel by `mask × gain × 0.98` clamped to
 * 1, and `gain` is the band's own level and hit through `bandReaction`. So a
 * ridge, where the mask is 1, is scaled by that clamped drive and by nothing
 * else the CPU cannot see, and `glint` is where on that scale the cut sits.
 * What survives is then decided by the shape of the frame rather than by how
 * loud the music is.
 *
 * It is worked out here rather than in the shader because the shader would
 * have to be handed the band envelopes' own gain curve a second time, and a
 * copy of a curve is a copy that drifts. The uniform carries the finished
 * level, so the shader's whole share of this is a dot product, a smoothstep
 * and a multiply.
 *
 * What it does not measure against is how much of the frame the fractal is
 * covering, which the CPU cannot know: that follows the zoom sweep, and at
 * the sweep's inward extreme the camera is inside the fold and nearly every
 * pixel is a fully lit surface. Measured at a full packet on an RTX 5080,
 * the ink lights 21 percent of the frame there and 4 percent at the outward
 * extreme, at the same knob. A threshold on brightness thins that frame
 * rather than making it sparse. The README says so under Kaleidoscope.
 */
export const GLINT_LIGHT = 2.2

/**
 * Where a `glint` of 1 cuts, as a share of `intensity × GLINT_LIGHT × drive`.
 *
 * Measured rather than derived. The ink was rendered on its own into an
 * rgba16float target at a full packet on an RTX 5080 and read back: the
 * brightest pixel of the frame sat between 0.51 and 0.68 of that reference
 * over the whole zoom sweep, and the body of the lit frame sat under 0.2 of
 * it. So 0.2 is the top of the body, and the knob spends its range on the
 * body rather than on the last third nothing is in.
 */
export const GLINT_CUT = 0.2

/**
 * How hard the bands are driving the folds, 0 to 1. It is the shader's own
 * `gain`, the loudest band's, times the 0.98 the mix weight carries and
 * clamped where that weight clamps, so it is exactly the factor the brightest
 * pixel of the frame is scaled by.
 */
export function glintDrive(params: KaleidoscopeParams, bands: Float32Array): number {
  let drive = 0
  for (let band = 0; band < BAND_COUNT; band++) {
    const slot = band * 4
    const level = bands[slot] ?? 0
    const hit = bands[slot + 1] ?? 0
    // smoothstep(0.005, 0.035, level): a band under its own floor is silent.
    const edge = Math.min(1, Math.max(0, (level - 0.005) / 0.03))
    const gate = edge * edge * (3 - 2 * edge)
    drive = Math.max(drive, gate * Math.min(1.5, params.bandReaction * (level + hit * 0.55)))
  }

  return Math.min(1, drive * 0.98)
}

/**
 * Where the knob stops being a threshold. A cut this far down sits under a
 * ten-thousandth of the frame's own brightest and takes nothing off anything
 * a display can show, and a cast that has taken the study's rows back off
 * lands here rather than exactly on zero: two gains added and then subtracted
 * leave the last bit behind. Prism is that cast, and it has to be off.
 */
const GLINT_OFF = 1e-4

/** The brightness the ink's own light is cut at this frame, 0 for no cut. */
export const glintLevel = (params: KaleidoscopeParams, bands: Float32Array) =>
  params.glint <= GLINT_OFF
    ? 0
    : params.glint * GLINT_CUT * params.intensity * GLINT_LIGHT * glintDrive(params, bands)

/**
 * What one pixel of the ink keeps, 0 to 1, given its outgoing luminance. The
 * shader applies this to the whole colour rather than to each channel: a
 * per-channel limit pulls the three together and bleaches the light toward
 * white, which is the reason the post stack's tonemap and its ceiling roll
 * the brightest channel and let the other two follow.
 *
 * The knee is a share of the level rather than an absolute width, so the edge
 * stays equally soft as the level moves with the music. Without it the
 * threshold is a hard contour, and a hard contour on a fractal that is
 * marching through its own folds crawls from frame to frame.
 */
export function glintSurvival(light: number, level: number, knee: number): number {
  if (!(level > 0)) return 1
  const soft = Math.max(1e-5, level * knee)
  const along = Math.min(1, Math.max(0, (light - (level - soft)) / (2 * soft)))
  return along * along * (3 - 2 * along)
}

export const KALEIDOSCOPE_UNIFORM_FLOATS = 40

/** Logarithmic scale gives equal visual travel inward and outward. */
export function kaleidoscopeZoom(params: KaleidoscopeParams, motion: KaleidoscopeMotion) {
  return params.zoom * Math.exp(params.zoomAmount * Math.sin(motion.zoomPhase))
}

export function writeKaleidoscopeUniform(
  params: KaleidoscopeParams,
  motion: KaleidoscopeMotion,
  width: number,
  height: number,
  software: boolean,
  out: Float32Array,
) {
  out.set([
    Math.max(1, width),
    Math.max(1, height),
    motion.rotation,
    motion.travel,
    motion.morph,
    params.symmetry,
    kaleidoscopeZoom(params, motion),
    params.depth,
    software ? Math.min(5, params.complexity) : params.complexity,
    params.warp,
    params.thickness,
    motion.lift,
    motion.sparkle,
    params.intensity,
    params.saturation,
    wrapPhase(params.colourShift + motion.colour, 1),
    params.bandReaction,
    software ? 1 : 0,
    glintLevel(params, motion.bands),
    params.glintKnee,
  ])
  out.set(motion.bands, 20)
}
