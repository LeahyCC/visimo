import type { Tuning } from '../presets/knobs'

export type SceneContext = {
  device: GPUDevice
  format: GPUTextureFormat
  /** True on a software rasteriser; scenes should scale their work down. */
  software: boolean
}

/**
 * A scene's velocity field, offered to the post stack so the feedback pass
 * can read the last frame back along it instead of only zooming it about the
 * middle. A scene that solves no field offers nothing and the pass behaves as
 * it always has.
 */
export type Flow = {
  /**
   * The field the scene has just written, velocity in its x and y channels.
   * Which of a ping-pong pair that is alternates every frame, so this is read
   * once per frame rather than kept.
   */
  readonly view: GPUTextureView
  /**
   * Canvas uv to the field's own uv: `(uv - 0.5) * cover + 0.5`. The field is
   * square and covers the canvas with the overflow cropped, so the short side
   * sees a band of it; `fluid.render.wgsl` draws the dye with the same
   * mapping. Velocity is in field widths per second, so the same two numbers
   * turn it back into canvas uv per second.
   */
  readonly cover: readonly [number, number]
}

export interface Scene {
  /** One short line naming the scene's workload, for the overlay and tests. */
  readonly detail: string
  /**
   * The velocity field this scene is solving, if it solves one. Read every
   * frame after `render`, since the field it names alternates.
   */
  readonly flow?: Flow | null
  /**
   * Frames per second worth drawing. A scene that costs a lot per frame and
   * moves slowly sets this so a fast display does not multiply its GPU load.
   */
  readonly maxFps?: number
  /**
   * The most pixels worth drawing. Past this the scene and the post stack run
   * smaller and the composite scales the result up to the canvas.
   */
  readonly maxPixels?: number
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
