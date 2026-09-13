/**
 * Which scene draws and how hard it works. Plain values, no GPU or WGSL
 * behind them, so a host's main bundle can carry the picker.
 */
export {
  SCENE_IDS,
  SCENE_LABELS,
  DEFAULT_SCENE,
  isSceneId,
  FLUID_SIZES,
  DEFAULT_FLUID_SIZE,
  SOFTWARE_FLUID_SIZE,
} from './scenes/catalog'
export type { SceneId } from './scenes/catalog'
