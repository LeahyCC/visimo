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
    0,
    0,
  ])
  out.set(motion.bands, 20)
}
