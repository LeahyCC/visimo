/**
 * What the stage can choose: which scene draws, and how much work that scene
 * does. Plain values with no GPU, WGSL or React imports, so the top bar can
 * read them without pulling the visualizer tree into the main bundle.
 *
 * Keep this list free of scene implementations so pickers stay lightweight.
 */

export const SCENE_IDS = ['fluid', 'kaleidoscope'] as const
export type SceneId = (typeof SCENE_IDS)[number]

export const SCENE_LABELS: Record<SceneId, string> = {
  fluid: 'Fluid',
  kaleidoscope: 'Kaleidoscope',
}

export const DEFAULT_SCENE: SceneId = 'fluid'

export const isSceneId = (value: string): value is SceneId =>
  (SCENE_IDS as readonly string[]).includes(value)

/** Fluid grid sizes, in texels each side. The grid is square either way. */
export const FLUID_SIZES: readonly number[] = [512, 1024]
export const DEFAULT_FLUID_SIZE = 512
/** A CPU rasteriser gets the small grid whatever was chosen. */
export const SOFTWARE_FLUID_SIZE = 512
