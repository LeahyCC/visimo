/**
 * The studies, the casts built from them, and the vocabulary both are written
 * in. Numbers and parsing only, nothing that touches the GPU, so this lands
 * in a host's main bundle alongside `visimo/catalog`.
 *
 * The entry is still called `presets` and still exports the five names a host
 * on 0.1 was written against. They now hold pinned casts rather than presets;
 * see "Upgrading from 0.1" in the README for everything that changed.
 */
export {
  CASTS,
  DEFAULT_CAST_ID,
  castOrDefault,
  findCast,
  stepCast,
  // The 0.1 names for the same five, so a host changes the type it imports
  // and nothing else.
  CASTS as PRESETS,
  DEFAULT_CAST_ID as DEFAULT_PRESET_ID,
  castOrDefault as presetOrDefault,
  findCast as findPreset,
  stepCast as stepPreset,
} from './studies/casts/index'
export { STUDIES, findStudy, sceneOf, studiesOfKind } from './studies/registry'
export { parseCast, castStudyIds, CANVAS_KNOBS, isCanvasKnob, MAX_INKS } from './studies/cast'
export {
  blendKnobs,
  castFrame,
  liveCast,
  resolveCast,
  resolveLive,
  resolveStudy,
  studyFeature,
} from './studies/resolve'
export {
  COUNT_KNOBS,
  IMPL_IDS,
  IMPL_KNOBS,
  IMPL_SCENES,
  implKnobs,
  isCountKnob,
  isImplId,
  isImplKnob,
  LOOK_KNOBS,
  LOOK_STAGES,
  LOOK_STRENGTH_KNOBS,
  RIBBON_KNOBS,
} from './studies/impls'
export { CHARACTER_AXES, COSTS, MOMENTS, STUDY_FIELDS, STUDY_KINDS, isLook } from './studies/types'
export type { Cast, CastCanvas, CastOverride, CanvasKnob, PinnedCast } from './studies/cast'
export type { CastFrame, KnobsAt, LiveCast, LiveStudy } from './studies/resolve'
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
export type { AudioField, Curve, FluidKnob, KaleidoscopeKnob, Tuning } from './presets/knobs'
export { AUDIO_FIELDS, CURVES } from './presets/knobs'
export { POST_LANES, POST_KNOBS } from './post/params'
export type { PostParams } from './post/params'
