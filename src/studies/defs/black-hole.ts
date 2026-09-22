import type { FlowStudy } from '../types'
import { NO_CURL } from './shared'

/**
 * The pull half of the black hole, on the analytic flow's `lens` term. It is
 * the flow that sweeps the middle of the frame clear and piles what it takes
 * into a ring, and `black-hole-ring` is the ink that burns on that ring and
 * bends the picture round it. The two are one picture and share a home and a
 * moment, so the director casts them together; each still stands on its own,
 * because a lens with nothing lit in the middle is still a lens.
 *
 * **A lens is a velocity you can write down**, which is why this is a term on
 * the analytic flow and not a simulation. Outside the photon radius it draws
 * in and falls off with the square of the distance, as a pull does. Inside it
 * pushes gently out, zero at the exact centre and zero again at the photon
 * radius, so the two halves join with no step. That inside half is the whole
 * trick: a pull that ran all the way to the middle would gather the picture
 * there into a bright dot, which is the one thing a black hole must not look
 * like. With the sign turned over, nothing ever draws toward the middle and
 * the little that lands there is carried back out to the ring. See
 * `lensProfile` in `impls/analytic.params.ts`.
 *
 * **That is also what makes the middle dark, and it has to be**, because an
 * ink can only add light: nothing in the library can paint a disc black. A
 * disc painted actually black waits for `subtract-blend`, the darkening blend
 * the catalogue lists, which has no card yet. Until then the dark is an
 * absence that this flow keeps empty, and on a canvas with a long memory that
 * reads as a hole rather than as a gap.
 *
 * The photon radius rests at 0.07 of the way to the corner, which on a 16:9
 * canvas is about 0.071 of the short side, just inside where the ink puts the
 * rim of its disc. The pull peaks at one and a half times that, 0.107, which
 * is just outside the ring: light is swept off the middle and piles up where
 * the ring is burning, which is where the picture wants it.
 *
 * Tension is the study, as the catalogue asks: it adds 0.18 to the pull and
 * 0.03 to the photon radius, so a build both strengthens the pull and grows
 * the dark middle, and the frame closes in on the hole as the drop comes. The
 * low end and the level add to the pull as well, so the thing shows up on a
 * real track and not only on a build: `release`, `impact` and `tension` are
 * rarely high on real music, and a study that waits for them draws nothing for
 * whole songs.
 *
 * The small swirl is frame dragging, which a spinning hole really does to the
 * light around it, and it is what stops the bend being a straight zoom: the
 * picture winds as it is drawn in. It rests at 0.01 turns a second, about
 * four degrees, and reaches 0.045 at a loud build.
 *
 * Its home is the measured low-weight, hard corner of `tracks.fixture.ts`,
 * which is where dubstep, drum and bass and the demo's own track sit:
 * Subtronics reads 0.69 drive, 0.18 weight, 0.39 tonality, 0.52 steadiness
 * and 0.75 hardness, Pendulum 0.53, 0.22, 0.22, 0.66, 0.70. The catalogue
 * calls that corner heavy, and the measurement calls it light, because
 * `weight` reads high for a bass-led spectrum and dubstep is mostly treble;
 * the number follows the measurement, which is the catalogue's own rule. The
 * reach is 0.35, so those three and the deathcore track are at home and a
 * folk or ambient one never sees it. It deliberately does not sit where the
 * shards (0.5 weight) or the lightning (0.35) sit: three studies for the drop
 * in one corner would mean two of them are never cast.
 */
export const BLACK_HOLE: FlowStudy = {
  id: 'black-hole',
  kind: 'flow',
  name: 'Black hole',
  impl: 'analytic',
  home: { drive: 0.52, weight: 0.2, tonality: 0.32, steadiness: 0.56, hardness: 0.74 },
  reach: 0.35,
  moments: { intro: 0, groove: 0.2, build: 1, drop: 0.85, rest: 0, outro: 0 },
  knobs: { ...NO_CURL, radial: 0, falloff: 0, swirl: 0.01, twist: 0, lens: 0.14, photon: 0.07 },
  mapping: [
    { from: 'energy', to: 'lens', gain: 0.12, curve: 'sqrt' },
    { from: 'lowEnd', to: 'lens', gain: 0.1, curve: 'linear' },
    { from: 'tension', to: 'lens', gain: 0.18, curve: 'linear' },
    { from: 'energy', to: 'photon', gain: 0.015, curve: 'linear' },
    { from: 'tension', to: 'photon', gain: 0.03, curve: 'linear' },
    { from: 'energy', to: 'swirl', gain: 0.02, curve: 'sqrt' },
    { from: 'tension', to: 'swirl', gain: 0.015, curve: 'linear' },
  ],
  cost: 'cheap',
}
