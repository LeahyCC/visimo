/**
 * What draws a study. Behind every `impl` id in `studies/impls.ts` there is
 * one of these two, and nothing else in the renderer knows which study it is
 * drawing: the studies layer has already turned a cast and a packet into a
 * set of knobs per id, and the renderer hands each implementation its own.
 *
 * Both are handed a `presence`, 0 to 1, which is the director's fade. At 0 an
 * implementation is not called at all and, if nothing else needs it, is not
 * even constructed, so a study that is off costs nothing. Between 0 and 1 an
 * ink scales its light and a flow scales its velocity. What that means is the
 * implementation's business, because thinning a fluid is not the same
 * operation as thinning a line.
 *
 * The split is the one the canvas plan draws: a flow says how the picture
 * moves and never draws, an ink says what is drawn into it this frame and
 * never carries anything. A look is the post stack and has no object here.
 */
import type { Tuning } from '../presets/knobs'
import type { Flow, SceneContext } from './Scene'

/**
 * How an ink reaches the shared target: its own light times the blend
 * constant, added to whatever is there, with the alpha left where the clear
 * put it. The constant is the ink's presence, which is what "an ink scales
 * its light" means for every ink at once, in one place, with no shader
 * knowing about it. At presence 1 over a cleared target this is exactly the
 * opaque draw each of these used to make on its own.
 */
export const INK_BLEND: GPUBlendState = {
  color: { srcFactor: 'constant', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
}

type Shared = {
  /**
   * One short line naming this implementation's workload, for the overlay and
   * for `data-detail`. Empty when it has nothing of its own to say, as the
   * ribbon has, so the renderer can leave it out of the line.
   */
  readonly detail: string
  init(context: SceneContext): void
  resize(width: number, height: number): void
  /**
   * Per-frame CPU work. `features` is the latest packet, read for the clock,
   * the per-band voices and events; `knobs` is this study's own numbers with
   * its mapping already added, so every magnitude arrives resolved.
   */
  update(features: Float32Array, dt: number, knobs: Tuning, presence: number): void
  dispose(): void
}

export type FlowImpl = Shared & {
  /** Step the field into this encoder. Nothing is drawn. */
  simulate(encoder: GPUCommandEncoder): void
  /**
   * The field this flow has just written, read every frame after `simulate`
   * since the half of a ping-pong pair it names alternates.
   */
  readonly flow: Flow | null
}

export type InkImpl = Shared & {
  /**
   * Draw into the shared target, additively and over what is already there.
   * The renderer clears the target once a frame and then runs every live ink
   * in cast order, so two inks sum rather than one replacing the other.
   */
  render(encoder: GPUCommandEncoder, view: GPUTextureView): void
  /**
   * Frames per second worth drawing. An ink that costs a lot per frame and
   * moves slowly sets this so a fast display does not multiply its GPU load;
   * the renderer takes the lowest of the live inks'.
   */
  readonly maxFps?: number
  /**
   * The most pixels worth drawing. Past this the inks and the post stack run
   * smaller and the composite scales the result up to the canvas.
   */
  readonly maxPixels?: number
}
