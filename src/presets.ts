/**
 * The presets and the vocabulary they are written in. Numbers and parsing
 * only, nothing that touches the GPU, so this lands in a host's main bundle
 * alongside `visimo/catalog`.
 */
export {
  PRESETS,
  DEFAULT_PRESET_ID,
  findPreset,
  firstPresetOf,
  presetOrDefault,
  stepPreset,
} from './presets/index'
export { parsePreset } from './presets/parse'
export type { Preset, Mapping } from './presets/types'
export type { AudioField, Curve, FluidKnob, Tuning } from './presets/knobs'
export { POST_LANES, POST_KNOBS } from './post/params'
export type { PostParams } from './post/params'
