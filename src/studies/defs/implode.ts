import type { FlowStudy } from '../types'
import { NO_CURL } from './shared'

/**
 * Everything drawn to the middle, as a build winds up. The pull IS the
 * tension: at 0 the radial coefficient is a hundredth of a field width a
 * second, which shrinks the picture by under two percent over a whole second
 * and reads as nothing, and at 1 it is half a field width and the frame is
 * gathered firmly into its own centre. Its tension row is the study; the
 * `energy` row beside it only lets a loud build pull a little harder than a
 * quiet one.
 *
 * `falloff` stays at 0, which makes the pull grow with the radius: a plain
 * zoom about the middle, everything converging at one rate. A pull that was
 * strongest near the centre would read as a hole in the picture rather than
 * as the picture gathering, which is the opposite of what a build wants.
 *
 * Its home is the middle of the character space with the widest reach there
 * is, because the catalogue gives it no character at all: any song that winds
 * up can implode.
 */
export const IMPLODE: FlowStudy = {
  id: 'implode',
  kind: 'flow',
  name: 'Implode',
  impl: 'analytic',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 0, groove: 0, build: 1, drop: 0, rest: 0, outro: 0 },
  knobs: { ...NO_CURL, radial: -0.01, falloff: 0, swirl: 0, twist: 0 },
  mapping: [
    { from: 'tension', to: 'radial', gain: -0.4, curve: 'linear' },
    { from: 'energy', to: 'radial', gain: -0.08, curve: 'linear' },
  ],
  cost: 'cheap',
}
