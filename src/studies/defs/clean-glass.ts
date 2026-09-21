import type { LookStudy } from '../types'

/**
 * Bloom and the tonemap and nothing else: no grain and no split, so hard
 * edges stay hard. This is what Prism and Melt are shown through, and the
 * reason the fractal reads as glass rather than as film. Tension lifts the
 * threshold, so fewer things glow as it winds up.
 */
export const CLEAN_GLASS: LookStudy = {
  id: 'clean-glass',
  kind: 'look',
  name: 'Clean glass',
  impl: 'look',
  home: { drive: 0.55, weight: 0.4, tonality: 0.8, steadiness: 0.55, hardness: 0.6 },
  reach: 0.55,
  moments: { intro: 0, groove: 1, build: 0.5, drop: 1, rest: 0, outro: 0 },
  knobs: {
    'bloom.threshold': 0.8,
    'bloom.knee': 0.2,
    'bloom.intensity': 0.15,
    'bloom.radius': 0.3,
    'bloom.tint': 0,
    'chromatic.amount': 0.0008,
    'chromatic.beat': 0.003,
    'grade.vignette': 0,
    'grade.saturation': 1,
    'grade.weave': 0,
    'tonemap.exposure': 1,
    'tonemap.shoulder': 0.6,
    'grain.amount': 0.02,
  },
  mapping: [
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.06, curve: 'linear' },
    { from: 'treble', to: 'bloom.threshold', gain: -0.08, curve: 'linear' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.04, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'tension', to: 'bloom.threshold', gain: 0.06, curve: 'linear' },
    { from: 'swell', to: 'bloom.radius', gain: 0.15, curve: 'linear' },
    { from: 'tension', to: 'bloom.radius', gain: -0.1, curve: 'linear' },
    { from: 'keyClarity', to: 'bloom.tint', gain: 0.2, curve: 'linear' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'tonemap'],
}
