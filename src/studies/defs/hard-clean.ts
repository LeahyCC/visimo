import type { LookStudy } from '../types'

/**
 * High contrast, no grain, and the beat pushing the split wide: the hard end
 * of the catalogue. Nothing pinned uses it yet; it is here for the director,
 * and its numbers are Warm and soft's with the light pulled harder and the
 * grain switched off.
 */
export const HARD_CLEAN: LookStudy = {
  id: 'hard-clean',
  kind: 'look',
  name: 'Hard and clean',
  impl: 'look',
  home: { drive: 0.65, weight: 0.45, tonality: 0.5, steadiness: 0.7, hardness: 0.8 },
  reach: 0.5,
  moments: { intro: 0, groove: 1, build: 0.5, drop: 1, rest: 0, outro: 0 },
  knobs: {
    'bloom.threshold': 0.78,
    'bloom.knee': 0.15,
    'bloom.intensity': 0.45,
    'chromatic.amount': 0.0004,
    'chromatic.beat': 0.006,
    'grade.vignette': 0,
    'grade.saturation': 1,
    'grade.weave': 0,
    'tonemap.exposure': 1,
    'tonemap.shoulder': 0.5,
    'grain.amount': 0.02,
  },
  mapping: [
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.12, curve: 'linear' },
    { from: 'treble', to: 'bloom.threshold', gain: -0.1, curve: 'linear' },
    { from: 'hardness', to: 'chromatic.amount', gain: 0.001, curve: 'linear' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'tension', to: 'bloom.threshold', gain: 0.08, curve: 'linear' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'chromatic', 'tonemap'],
}
