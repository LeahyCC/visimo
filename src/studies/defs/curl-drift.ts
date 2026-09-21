import type { FlowStudy } from '../types'

/**
 * Slow noise that folds the picture over on itself, for the passages where
 * nothing else is moving it: an intro, a rest, an outro. It is the curl of a
 * smooth potential, so it drifts and stretches what is on the canvas without
 * gathering it in one place or thinning it in another, and it needs no solver,
 * which is also why it is the flow the WebGL2 path will use.
 *
 * It rests at 0.02 field widths a second at the fastest, about 50 pixels a
 * second across a 2560 wide canvas, which is a drift you see over half a
 * minute and not a motion you see over a second. That is on purpose: it sits
 * under dye plumes in a quiet passage and must not fight them. It is also not
 * silent at silence, since a flow is not asked to draw anything: at a silent
 * packet it still carries what is left of the picture at that resting speed,
 * so an outro that is fading to black keeps turning as it goes.
 *
 * Nothing sits still. Loudness and a lifting passage speed the drift, `pace`
 * and `weight` set the size of the cells (a busy track finer, a bass-led one
 * larger) and `pace` also hurries the pattern's own evolution. Tension speeds
 * both the drift and the evolution: a riser in an intro reads as the picture
 * beginning to churn. At tension 1 and a full packet the speed is 0.15, which
 * is still about 385 pixels a second at the fastest point and well short of a
 * flow that would smear a plume into a band.
 *
 * Its home is the middle of the space with the widest reach there is, because
 * the catalogue gives it no character at all. The catalogue gives it the quiet
 * moments and only those, so it is never the flow of a groove or a drop.
 */
export const CURL_DRIFT: FlowStudy = {
  id: 'curl-drift',
  kind: 'flow',
  name: 'Curl drift',
  impl: 'analytic',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 1, groove: 0, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: { radial: 0, falloff: 0, swirl: 0, twist: 0, curl: 0.02, curlScale: 3.5, curlRate: 0.05 },
  mapping: [
    { from: 'energy', to: 'curl', gain: 0.05, curve: 'linear' },
    { from: 'swell', to: 'curl', gain: 0.02, curve: 'linear' },
    { from: 'tension', to: 'curl', gain: 0.06, curve: 'linear' },
    { from: 'pace', to: 'curlScale', gain: 2, curve: 'linear' },
    { from: 'weight', to: 'curlScale', gain: -1, curve: 'linear' },
    { from: 'pace', to: 'curlRate', gain: 0.05, curve: 'linear' },
    { from: 'tension', to: 'curlRate', gain: 0.05, curve: 'linear' },
  ],
  cost: 'cheap',
}
