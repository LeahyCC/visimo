import type { LookStudy } from '../types'

/**
 * A few frames of lifted exposure on the drop, and then gone. It is built to
 * the flash rule (WCAG 2.3.1: no more than three flashes in any second over a
 * large area, a flash being a large change in relative luminance) and not
 * tuned to it afterwards, in two ways.
 *
 * The rate is the extractor's, not this file's. `impact` fires on `release`
 * crossing up through 0.35 and rearms only once `release` has fallen back
 * under 0.12, and `release` falls with a time constant of half a phrase, at
 * shortest 0.75 s. So two drops are at least 0.8 s apart however hard the
 * music is played, which is at most two flashes in any second, and in a real
 * track they are a section apart. The look adds no trigger of its own: the one
 * row is on `impact`, which is 1 for a frame and a third of that in 0.18 s.
 *
 * The size is capped. `impact` never goes above 1, so the gain is the lift:
 * 0.2, an exposure of 1.2 on the frame of the drop, which the tonemap's
 * shoulder then bends, so the brightest parts barely move and it is the
 * middle of the picture that lifts. `registry.test.ts` holds that cap and
 * the rate; a cast's own rows could add to it, which is why the cap is
 * stated as a number a test reads rather than left as a habit.
 *
 * That lift is also the one place a full packet is allowed to end brighter
 * than rest, since a full packet has `impact` in it. The guard in the test
 * takes `impact` out and checks the rest of the packet still leaves the light
 * under rest, and then that the lift is all that is left over.
 *
 * It rests as Clean glass does, and says nothing at the other moments.
 */
export const IMPACT_FLASH: LookStudy = {
  id: 'impact-flash',
  kind: 'look',
  name: 'Impact flash',
  impl: 'look',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 0, groove: 0, build: 0, drop: 1, rest: 0, outro: 0 },
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
    { from: 'impact', to: 'tonemap.exposure', gain: 0.2, curve: 'linear' },
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.06, curve: 'linear' },
    { from: 'treble', to: 'bloom.threshold', gain: -0.08, curve: 'linear' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.04, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'tonemap'],
  // The drop lands as heat, against squeeze's cold build before it.
  palette: 'ember',
}
