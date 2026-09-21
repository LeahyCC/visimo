import type { LookStudy } from '../types'

/**
 * Low contrast, grain and a gentle bloom: what Plume is shown through. A
 * hard track splits more and is clean, a soft one splits less and is grainy,
 * which is the one row `hardness` owns here. Tension pulls the glow back
 * before the drop puts it out again.
 */
export const WARM_SOFT: LookStudy = {
  id: 'warm-soft',
  kind: 'look',
  name: 'Warm and soft',
  impl: 'look',
  home: { drive: 0.25, weight: 0.7, tonality: 0.6, steadiness: 0.4, hardness: 0.15 },
  reach: 0.5,
  moments: { intro: 1, groove: 1, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: {
    'bloom.threshold': 0.85,
    'bloom.knee': 0.2,
    'bloom.intensity': 0.35,
    'chromatic.amount': 0.0002,
    'chromatic.beat': 0.003,
    'grade.vignette': 0,
    'grade.saturation': 1,
    'grade.weave': 0,
    'tonemap.exposure': 1,
    'tonemap.shoulder': 0.6,
    'grain.amount': 0.012,
  },
  mapping: [
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.1, curve: 'linear' },
    { from: 'treble', to: 'bloom.threshold', gain: -0.1, curve: 'linear' },
    { from: 'hardness', to: 'chromatic.amount', gain: 0.0006, curve: 'linear' },
    { from: 'hardness', to: 'grain.amount', gain: 0.008, curve: 'invert' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.04, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'tension', to: 'bloom.intensity', gain: -0.05, curve: 'linear' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'chromatic', 'tonemap', 'grain'],
  // Warm and soft asks for colour to match: the low-chroma pastel, which is
  // the quiet end of the catalogue's colour as this is its quiet look.
  palette: 'dusk',
}
