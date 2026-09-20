/**
 * The two things every implementation shares: the device it is built on, and
 * the velocity field a flow offers. The `Scene` interface that used to live
 * here is gone, because nothing is a scene any more: a preset named one scene
 * and owned the whole picture, and a cast is a handful of implementations
 * drawing on one canvas instead. What each of those looks like is `Impl.ts`
 * beside this file.
 */

export type SceneContext = {
  device: GPUDevice
  format: GPUTextureFormat
  /** True on a software rasteriser; an implementation should scale its work down. */
  software: boolean
}

/**
 * A flow's velocity field, offered to the post stack so the feedback pass can
 * read the last frame back along it instead of only zooming it about the
 * middle. A cast with no flow offers nothing and the pass behaves as it
 * always has.
 */
export type Flow = {
  /**
   * The field just written, velocity in its x and y channels. Which of a
   * ping-pong pair that is alternates every frame, so this is read once per
   * frame rather than kept.
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
  /** The field's width in texels; it is square, and the blend target follows it. */
  readonly size: number
}
