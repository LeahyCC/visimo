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
  /**
   * The one velocity field the live flows blended to, or null when nothing is
   * carrying the picture. It is a function rather than a value because which
   * half of a ping-pong pair it names alternates and because two flows are
   * summed into a third only once the encoder exists: it is worth reading
   * inside `render`, after the renderer has blended, and worth nothing at
   * `init` or `update`.
   *
   * Optional, so an implementation that does not ask for a flow is unchanged
   * and a test may build a context without one.
   */
  flow?: () => Flow | null
  /**
   * Last frame's canvas: the half of the post stack's history that is NOT
   * being written this frame, so an ink may read the picture while drawing
   * into it. Null before the first frame has been composited and whenever the
   * stack has not sized its textures yet.
   *
   * Two things about it decide whether an ink may use it at all:
   *
   * - **It is one frame behind.** What comes back is the frame the composite
   *   last wrote, feedback pass and all, and never anything this frame's inks
   *   have drawn. An ink that wants to line something up with what is on
   *   screen is lining it up with where it was a frame ago.
   * - **It is a loop.** The picture already holds everything this ink drew a
   *   frame ago, so an ink that covers much of the frame and adds back most of
   *   what it read runs away into white within a second or two. An ink that
   *   reads the canvas has to stay sparse, keep its gain under one, or both.
   *   `impls/CanvasQuadInk.ts` is the worked example and says what it keeps to.
   */
  canvas?: () => CanvasSample | null
}

/**
 * The canvas offered back to an ink: the texture to bind, and the size it was
 * written at, which is the draw size and not always the canvas element's.
 */
export type CanvasSample = {
  readonly view: GPUTextureView
  readonly width: number
  readonly height: number
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
