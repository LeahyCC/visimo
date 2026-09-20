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
export type { AudioField, Curve, FluidKnob, KaleidoscopeKnob, Tuning } from './presets/knobs'
export { POST_LANES, POST_KNOBS } from './post/params'
export type { PostParams } from './post/params'

// The studies, which are what the presets above become. Nothing draws a cast
// yet; this is the contract the renderer and the director are built against.
export { STUDIES, findStudy, studiesOfKind } from './studies/registry'
export { CASTS, findCast } from './studies/casts/index'
export { parseCast, castStudyIds, CANVAS_KNOBS, isCanvasKnob, MAX_INKS } from './studies/cast'
export { castFrame, resolveCast, resolveLive, resolveStudy, studyFeature } from './studies/resolve'
export {
  IMPL_IDS,
  IMPL_KNOBS,
  implKnobs,
  isImplId,
  isImplKnob,
  LOOK_KNOBS,
  LOOK_STAGES,
  LOOK_STRENGTH_KNOBS,
  RIBBON_KNOBS,
} from './studies/impls'
export { CHARACTER_AXES, COSTS, MOMENTS, STUDY_FIELDS, STUDY_KINDS, isLook } from './studies/types'
export type { Cast, CastCanvas, CastOverride, CanvasKnob, PinnedCast } from './studies/cast'
export type { CastFrame, LiveStudy } from './studies/resolve'
export type { ImplId, ImplKnob, LookStage } from './studies/impls'
export type {
  Character,
  CharacterAxis,
  Cost,
  FlowStudy,
  InkStudy,
  LookStudy,
  Moment,
  Moments,
  Study,
  StudyField,
  StudyKind,
  StudyMapping,
} from './studies/types'
