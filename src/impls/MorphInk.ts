/**
 * One lit solid in the middle of the frame that turns and melts from form to
 * form, which is the `morph` ink. Everything about reaching the canvas is the
 * raymarch kit's (`RaymarchInk.ts`): the march runs on a target half the ink
 * target's size, is scaled back up, and is added at the study's presence. What
 * is left here is the state one frame needs, which is the melt and its clock,
 * and filling the uniform.
 *
 * `morph.params.ts` decides everything the picture is: which forms, how far
 * between them, the two light colours out of the palette, and the level the
 * light is cut at. Nothing in this file chooses anything.
 *
 * A silent packet draws nothing at all: no pass is encoded and no buffer is
 * written, which is what `morphLit` is for.
 *
 * It sets no `maxFps`, unlike the fractal, and the reason is a measurement
 * rather than a principle. The fractal marches every pixel of the frame and
 * costs about 13 ms, so a cap saves a fast display most of its GPU; this
 * marches a quarter of the pixels and most of those rays leave through the far
 * plane in a handful of steps, which came to about 0.1 ms at 2560x1440 on an
 * RTX 5080. A cap is taken as the lowest of the live inks', so one here would
 * hold the whole cast to 60 for an ink that costs nothing.
 */
import type { Tuning } from '../presets/knobs'
import { MAX_SCALE } from './raymarch.params'
import shader from '../shaders/morph.wgsl?raw'
import {
  MORPH_UNIFORM_FLOATS,
  morphLit,
  morphParams,
  MorphShape,
  morphSteps,
  writeMorphUniform,
} from './morph.params'
import { RaymarchInk } from './RaymarchInk'

export class MorphInk extends RaymarchInk {
  protected readonly label = 'Shape morph'
  protected readonly code = shader
  protected readonly uniformFloats = MORPH_UNIFORM_FLOATS

  private readonly shape = new MorphShape()

  get detail() {
    return `${this.shape.detail} / ${this.marchWidth}x${this.marchHeight} marched`
  }

  /**
   * Marched at the ink target's own size rather than the kit's half.
   *
   * The kit halves by default because a march is expensive, and this one is
   * not: measured at 0.2 ms at 2560x1440 on the development GPU, against 0.09
   * at half. What half cost instead was the picture. A solid is read by its
   * edges, and a bilinear upscale of a thin bright outline is a soft one; at
   * full size the facets have hard planes and the fresnel edge is a line
   * rather than a glow. The knob is the kit's to offer and this ink's to
   * decline.
   */
  protected scaleOf(): number {
    return MAX_SCALE
  }

  protected fill(
    features: Float32Array,
    dt: number,
    knobs: Tuning,
    _presence: number,
    width: number,
    height: number,
    out: Float32Array,
  ): boolean {
    const params = morphParams(knobs)
    // The melt is stepped whether or not anything is drawn this frame, so a
    // section that turns over during a quiet bar has already landed when the
    // music comes back rather than starting its melt then.
    this.shape.step(features, dt)
    if (!morphLit(params, features)) return false
    writeMorphUniform(params, this.shape, features, width, height, morphSteps(this.software), out)
    return true
  }
}
