import type { InkStudy } from '../types'

/**
 * The waveform as a line or a circle, drawn under the feedback so the trails
 * turn it into sheets. Tension thins the line and shrinks the circle.
 *
 * It first had the middle of the space and a reach of 1, on the argument that
 * any song has a waveform. That mistook what a study can draw for where it is
 * wanted. The director reads `home` and `reach` as the second, so a study at
 * the middle with the whole space for a welcome was a fair fit for every track
 * there is, and with a fit of 1 for groove, build and drop it was in nearly
 * every cast. The waveform is at its best on a clear, steady, punchy signal,
 * where the line is a crisp shape the trails can turn into sheets; on a soft
 * or a chaotic mix it is a smear. So it sits with the electro, house and
 * techno end of `tracks.fixture.ts` (steady, fairly hard, mid drive) and a
 * reach of 0.4, in the range the other inks use. The build is what it is best
 * at, since a thin line drawing tight is the tension made visible, and a
 * groove has plenty of inks that suit it as well or better.
 */
export const RIBBON: InkStudy = {
  id: 'ribbon',
  kind: 'ink',
  name: 'Ribbon',
  impl: 'ribbon',
  home: { drive: 0.55, weight: 0.4, tonality: 0.5, steadiness: 0.75, hardness: 0.6 },
  reach: 0.4,
  moments: { intro: 0, groove: 0.5, build: 1, drop: 0.7, rest: 0, outro: 0 },
  knobs: {
    'ribbon.intensity': 0.15,
    'ribbon.width': 2.5,
    'ribbon.height': 0.2,
    'ribbon.shape': 0,
  },
  mapping: [
    { from: 'energy', to: 'ribbon.intensity', gain: 0.3, curve: 'linear' },
    { from: 'weight', to: 'ribbon.width', gain: 1.5, curve: 'linear' },
    { from: 'tension', to: 'ribbon.width', gain: -0.8, curve: 'linear' },
    { from: 'tension', to: 'ribbon.height', gain: -0.05, curve: 'linear' },
  ],
  cost: 'cheap',
}
