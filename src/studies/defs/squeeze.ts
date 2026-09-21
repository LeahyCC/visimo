import type { LookStudy } from '../types'

/**
 * The build as a picture: the frame closes in and the colour drains as
 * tension climbs, and the drop throws it all open at once. It rests as a plain
 * clean look, Clean glass's numbers, so it can sit under a whole build without
 * having said anything until the song does.
 *
 * Every tension row has an `impact` row of the same size the other way, which
 * is what "opens" means here: at tension 1 they cancel exactly, and at less
 * they overshoot, which is the point. The drop is when tension is already
 * falling, and the frame of the drop has to be wide open then and not at what
 * is left of the build, so a vignette below 0 reads as none and a saturation
 * above 1 as untouched, and `writePostUniform` holds both there. The bloom is
 * left to overshoot, briefly, since the glow opening is part of the payoff.
 * Vignette and colour are where it lives; the bloom only follows them, its
 * threshold rising and its glow thinning so the picture tightens all over.
 *
 * Its home is the middle of the space with the widest reach, because any
 * song that winds up can be squeezed. It is a build look and has no use for
 * anything else, so it says nothing at the other moments.
 */
export const SQUEEZE: LookStudy = {
  id: 'squeeze',
  kind: 'look',
  name: 'Squeeze',
  impl: 'look',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 0, groove: 0, build: 1, drop: 0, rest: 0, outro: 0 },
  knobs: {
    'bloom.threshold': 0.8,
    'bloom.knee': 0.2,
    'bloom.intensity': 0.15,
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
    { from: 'tension', to: 'grade.vignette', gain: 0.6, curve: 'linear' },
    { from: 'impact', to: 'grade.vignette', gain: -0.6, curve: 'linear' },
    { from: 'tension', to: 'grade.saturation', gain: -0.55, curve: 'linear' },
    { from: 'impact', to: 'grade.saturation', gain: 0.55, curve: 'linear' },
    { from: 'tension', to: 'bloom.threshold', gain: 0.1, curve: 'linear' },
    { from: 'impact', to: 'bloom.threshold', gain: -0.1, curve: 'linear' },
    { from: 'tension', to: 'bloom.intensity', gain: -0.08, curve: 'linear' },
    { from: 'impact', to: 'bloom.intensity', gain: 0.08, curve: 'linear' },
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.06, curve: 'linear' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.04, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'tonemap', 'grade'],
  // The build holds its breath, and cold is what that looks like. Impact flash
  // is ember, so the drop's turn to heat is also a turn of colour.
  palette: 'abyss',
}
