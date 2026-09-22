import type { FlowStudy } from '../types'
import { NO_CURL, NO_LENS } from './shared'

/**
 * The drop, thrown outward from the middle. It fires on `impact`, which is 1
 * on the frame the payoff lands and is down to a third of that within a fifth
 * of a second, so the push is a punch and not a level; `release` carries a
 * quarter of it for the phrase that follows, so the payoff keeps opening long
 * after the hit itself is gone.
 *
 * `falloff` is what makes it read as a burst rather than as a zoom out. At
 * rest it is 2, which puts the fastest ring halfway to the corner; `impact`
 * takes it to 4 on the frame of the drop, which pulls that ring in to a
 * quarter of the way out and leaves the rim standing. As the hit decays the
 * ring travels back outward, so the push sweeps out of the middle.
 *
 * It has no real use for tension, and the one row it has says so honestly
 * rather than inventing a job: the slow outward drift it carries at rest is
 * taken away exactly as tension reaches 1, so through a build the frame is
 * held still and nothing is opening when the drop arrives. The catalogue's
 * entry is "none; fires on impact", and that is what this is.
 */
export const RADIAL_BURST: FlowStudy = {
  id: 'radial-burst',
  kind: 'flow',
  name: 'Radial burst',
  impl: 'analytic',
  home: { drive: 0.7, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.8 },
  reach: 0.55,
  moments: { intro: 0, groove: 0, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: { ...NO_CURL, ...NO_LENS, radial: 0.05, falloff: 2, swirl: 0, twist: 0 },
  mapping: [
    { from: 'impact', to: 'radial', gain: 1.1, curve: 'linear' },
    { from: 'release', to: 'radial', gain: 0.3, curve: 'linear' },
    { from: 'tension', to: 'radial', gain: -0.05, curve: 'linear' },
    { from: 'impact', to: 'falloff', gain: 2, curve: 'linear' },
  ],
  cost: 'cheap',
}
