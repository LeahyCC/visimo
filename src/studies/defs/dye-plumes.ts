import type { InkStudy } from '../types'

/**
 * The fluid's dye, one emitter per band. It has nothing to draw into unless a
 * fluid flow is stirring the field, hence `requires`, and it covers most of
 * the frame, so it does not share a cast with the fractal. Tension thins the
 * dye: a build drains colour and the drop puts it back.
 */
export const DYE_PLUMES: InkStudy = {
  id: 'dye-plumes',
  kind: 'ink',
  name: 'Dye plumes',
  impl: 'dye',
  home: { drive: 0.4, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.25 },
  reach: 0.55,
  moments: { intro: 1, groove: 1, build: 0, drop: 0, rest: 1, outro: 0 },
  knobs: {
    dyeDecay: 0.22,
    intensity: 1.15,
    saturation: 0.65,
    dye: 1.6,
    hitDye: 1.1,
    colourShift: 0,
    colourDrift: 0,
    eventDye: 2.5,
  },
  mapping: [
    { from: 'keyHue', to: 'colourShift', gain: 1, curve: 'linear' },
    { from: 'energy', to: 'dyeDecay', gain: 0.3, curve: 'linear' },
    { from: 'energy', to: 'dye', gain: 0.7, curve: 'linear' },
    { from: 'beatPulse', to: 'intensity', gain: 0.3, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.14, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.09, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.09, curve: 'square' },
    { from: 'energy', to: 'saturation', gain: -0.1, curve: 'square' },
    { from: 'swell', to: 'saturation', gain: -0.08, curve: 'square' },
    { from: 'hardness', to: 'saturation', gain: -0.08, curve: 'square' },
    { from: 'tension', to: 'dye', gain: -0.3, curve: 'linear' },
  ],
  cost: 'cheap',
  requires: ['fluid'],
  excludes: ['fractal-glints'],
}
