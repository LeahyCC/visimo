import type { Tuning } from '../presets/knobs'

export type SceneContext = {
  device: GPUDevice
  format: GPUTextureFormat
  /** True on a software rasteriser; scenes should scale their work down. */
  software: boolean
}

export interface Scene {
  /** One short line naming the scene's workload, for the overlay and tests. */
  readonly detail: string
  /**
   * Frames per second worth drawing. A scene that costs a lot per frame and
   * moves slowly sets this so a fast display does not multiply its GPU load.
   */
  readonly maxFps?: number
  init(context: SceneContext): void
  resize(width: number, height: number): void
  /**
   * Per-frame CPU work: camera, parameters. `features` is the latest packet,
   * which a scene reads for the clock, its individual band voices and events;
   * `tuning` is the preset's numbers with its audio mapping already added, so
   * mappings control the overall scene while each band keeps its own identity.
   */
  update(features: Float32Array, dt: number, tuning: Tuning): void
  render(encoder: GPUCommandEncoder, view: GPUTextureView): void
  dispose(): void
}
