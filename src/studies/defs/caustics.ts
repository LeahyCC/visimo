import type { InkStudy } from '../types'

/**
 * Soft moving light like the floor of a pool, for the quiet end of a song on a
 * soft, tonal track: intro, rest and outro. It is the ink most at risk of
 * washing the canvas out, because a caustic is a pattern over the whole frame,
 * so every choice here is about how little of the frame it may light. The
 * pattern is a thin network with black between its lines, and the whole of the
 * arithmetic is in `caustics.params.ts`: at the study's own numbers under a
 * tenth of the frame is lit at all (0.088) and the canvas settles at a mean of
 * about 0.16 if the pattern sat still, and a full packet takes both lower,
 * which `caustics.test.ts` holds. Measured on the adapter in the bench, after
 * thirty seconds over lazy fluid three quarters of the frame is still black.
 *
 * The light is the key's, not the sound's. What draws it is `keyClarity`, how
 * surely a key is heard, and the intensity is that times its resting value:
 * the `invert` row takes the rest value off again at a clarity of 0, so a
 * silent packet resolves to no light and no pass is encoded, and so does a
 * passage of drums with no key in it, which is right for a tonal study. A
 * count is what gates the dust; the caustics have no count, so the gate has to
 * be here, and it sits in the one knob that draws.
 *
 * Music that fills the frame makes it sparser and not brighter. Energy raises
 * the sharpness, which thins the lines and leaves more black, and dims the
 * light along with hardness; a full packet ends at about two thirds of the
 * light at rest and at a sharpness of 12.5, which is 8 at rest. On a loud passage
 * with no key in it those two dims meet a gate that is already shut and
 * resolve a little under zero, which the ink holds at 0, so it draws nothing
 * either way. Swell lifts the speed, so a passage that is opening drifts a
 * little faster and one falling away slows.
 *
 * Tension dims it, as the catalogue says, and does it through the sharpness:
 * a build adds 6 to it, and the lines thin to a few bright threads. It cannot go through the
 * intensity, because that already rests at nothing in silence and a tension
 * row there would take it below zero on a silent build. Thinner lines are less
 * light and more black, which is what dimming means for a pattern that has no
 * dim body to turn down.
 *
 * `scale` and `hueSpread` sit still on purpose, and the guard has the reasons.
 * Its home is the soft, tonal, slow corner, the dust's neighbour, and its
 * reach is narrow for the same reason theirs is.
 *
 * It is a fullscreen fragment pass, which is why it was expected to be
 * medium, and it is cheap because the fragment is four sines and some
 * arithmetic: 0.07 ms a pass at 2560 by 1440 on an RTX 5080, the same at every
 * knob, against 6.7 ms for the animation loop's own cap. That is one adapter,
 * and a fullscreen pass scales with the pixels, so a GPU a tenth as fast reads
 * under 1 ms at that size.
 */
export const CAUSTICS: InkStudy = {
  id: 'caustics',
  kind: 'ink',
  name: 'Caustics',
  impl: 'caustics',
  home: { drive: 0.15, weight: 0.5, tonality: 0.85, steadiness: 0.4, hardness: 0.1 },
  reach: 0.35,
  moments: { intro: 1, groove: 0, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: {
    intensity: 0.22,
    scale: 4,
    speed: 0.1,
    sharpness: 8,
    hueSpread: 0.12,
  },
  mapping: [
    { from: 'keyClarity', to: 'intensity', gain: -0.22, curve: 'invert' },
    { from: 'energy', to: 'intensity', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.03, curve: 'square' },
    { from: 'swell', to: 'speed', gain: 0.15, curve: 'linear' },
    { from: 'energy', to: 'sharpness', gain: 4.5, curve: 'linear' },
    { from: 'tension', to: 'sharpness', gain: 6, curve: 'linear' },
  ],
  cost: 'cheap',
}
