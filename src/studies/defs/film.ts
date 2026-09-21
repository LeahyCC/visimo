import type { LookStudy } from '../types'

/**
 * The quiet end of a song: heavy grain, a resting vignette and a slight weave,
 * for the intro, the rest and the outro of a soft, slow track, where the other
 * looks have nothing to say. It is film stock and a projector gate, so it costs
 * what a look costs, which is nothing beyond the composite: no pass of its own,
 * the weave being a shifted read of the picture the composite already samples.
 *
 * More film in the quiet is the whole idea, so grain and weave both rest at a
 * little and take `energy` inverted, which is the most of each when the music
 * is barely there and the least when it is loud (the grain never below its
 * resting 0.026, still twice Warm and soft's). The vignette rests gently and
 * breathes with `swell`: a passage lifting opens the frame and one falling
 * away draws it in. The bloom is softer than Warm and soft's, a wider knee and
 * less of it, and the exposure sits a shade under 1, like stock held back so
 * the blacks are dark. The colour rests a little under 1 for the same reason,
 * a faded stock and not a bright one.
 *
 * Tension tightens even this: the vignette closes a little, the colour drains a
 * little and the weave stills, so a build settles the frame down before it
 * winds it up. The weave is a wander of at most a pixel or two at 1080 high and
 * is meant to be felt and not seen; the rows keep it there, and at tension 1 in
 * a loud passage it is gone.
 *
 * Its home is the soft, slow corner and its reach is narrow, so a hard fast
 * track never sees it. It says nothing at the other moments.
 */
export const FILM: LookStudy = {
  id: 'film',
  kind: 'look',
  name: 'Film',
  impl: 'look',
  home: { drive: 0.15, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.1 },
  reach: 0.55,
  moments: { intro: 1, groove: 0, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: {
    'bloom.threshold': 0.85,
    'bloom.knee': 0.3,
    'bloom.intensity': 0.28,
    'bloom.radius': 0.45,
    'bloom.tint': 0.1,
    'chromatic.amount': 0.0002,
    'chromatic.beat': 0.003,
    'grade.vignette': 0.32,
    'grade.saturation': 0.92,
    'grade.weave': 0.6,
    'tonemap.exposure': 0.96,
    'tonemap.shoulder': 0.6,
    'grain.amount': 0.026,
  },
  mapping: [
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.06, curve: 'linear' },
    { from: 'treble', to: 'bloom.threshold', gain: -0.08, curve: 'linear' },
    { from: 'tension', to: 'bloom.intensity', gain: -0.05, curve: 'linear' },
    { from: 'swell', to: 'bloom.radius', gain: 0.1, curve: 'linear' },
    { from: 'tension', to: 'bloom.radius', gain: -0.1, curve: 'linear' },
    { from: 'keyClarity', to: 'bloom.tint', gain: 0.15, curve: 'linear' },
    { from: 'swell', to: 'grade.vignette', gain: -0.2, curve: 'linear' },
    { from: 'tension', to: 'grade.vignette', gain: 0.15, curve: 'linear' },
    { from: 'energy', to: 'grade.saturation', gain: -0.06, curve: 'square' },
    { from: 'tension', to: 'grade.saturation', gain: -0.1, curve: 'linear' },
    { from: 'energy', to: 'grade.weave', gain: 0.6, curve: 'invert' },
    { from: 'tension', to: 'grade.weave', gain: -1, curve: 'linear' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.04, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'energy', to: 'grain.amount', gain: 0.014, curve: 'invert' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'tonemap', 'grain', 'grade'],
}
