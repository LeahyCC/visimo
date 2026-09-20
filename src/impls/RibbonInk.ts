/**
 * The waveform drawn as a line or a circle. It is an ink like any other, and
 * the only one whose pass belongs to the post stack: the line reads the same
 * uniform every post pass does, and its points buffer is made once at
 * start-up, so moving the pass out would mean a second uniform saying the
 * same things. What this owns is when it runs, which is its place in the
 * cast's ink order, between the inks drawn before it and the feedback that
 * carries all of them.
 *
 * Its knobs are post lanes, so the studies resolver has already written them
 * into the stack, including scaling its light by presence: the stack knows
 * nothing of presence and the line would otherwise arrive and leave at full
 * strength while every other ink glides. So the only thing this keeps from a
 * frame is the packet, which the stack reads the step out of.
 */
import type { PostStack } from '../post/PostStack'
import type { InkImpl } from '../scenes/Impl'

export class RibbonInk implements InkImpl {
  /** The stage shows in `data-post`, so there is nothing to add to the detail line. */
  readonly detail = ''
  private features: Float32Array | null = null

  constructor(
    private readonly post: PostStack,
    /** The analyser's newest samples, or null before anything has played. */
    private readonly waveform: () => Float32Array | null,
  ) {}

  init() {}

  resize() {}

  update(features: Float32Array) {
    this.features = features
  }

  render(encoder: GPUCommandEncoder, view: GPUTextureView) {
    const features = this.features
    if (!features) return
    this.post.drawRibbon(encoder, view, features, this.waveform())
  }

  dispose() {}
}
