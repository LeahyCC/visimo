import type { InkStudy } from '../types'

/**
 * The ink for the drop's biggest hits: branching bolts, built on the CPU by
 * midpoint displacement and gone in about eight hundredths of a second, so
 * the canvas's own long memory is what carries the afterglow. It is the
 * shards' neighbour: it exists to make the release unmistakable, it is held
 * back for it, and nothing fires on any other moment, so the pool is empty
 * through a build and a groove and an empty pool draws and uploads nothing.
 *
 * Two ways in, and only two: `impact` fires one bolt at full strength, and a
 * strong hit in the low end or the mids while `release` is still high fires
 * one at the hit's strength. A token bucket holds one strike and refills at
 * `rate`, capped at one and a half a second, so with the banked one no song
 * fires more than three bolts a second, which is the WCAG 2.3.1 line held by
 * construction; and one bolt at the most the mapping reaches is under two
 * percent of a 16:9 frame, far under the large area a flash counts. Every
 * bolt is seeded from the section id and the strike count, so the same song
 * throws the same bolts.
 *
 * A bolt is lit the way the photographs are: a near white core that rests
 * above 1 so the bloom catches it, a saturated glow around it that turns
 * with the key hue, and forks that carry a neighbouring hue a step per fork
 * depth. The palette is its own, not one borrowed from the ribbon, and the
 * frame around a bolt stays true black: the line's light is zero past its
 * reach and nothing else stands lit.
 *
 * Tension is the holdback, nothing else: it takes the strike rate down, the
 * length and the life down a little and the intensity down by 0.15, so
 * through a build the bolts that do fire are fewer, shorter, briefer and
 * dimmer, and what they held back lands with the drop. The `impact` row on
 * `rate` is the mirror: the frame the drop lands, the bucket the tension
 * drained is what fires the bolt. The study draws nothing of its own through
 * a build: there is no standing light to wind in. Loudness never moves the
 * intensity either way; what a drop gains is more and bigger bolts (energy
 * lifts `forks`, `length` and `width`), not brighter ones.
 *
 * The intensity is reasoned from the canvas's arithmetic, not set from a
 * capture. The canvas keeps 0.975 of itself a frame now and holds its own
 * mean at 0.13, so what a bolt leaves behind falls to a tenth in about a
 * second and a half and to a thousandth in about four and a half, with the
 * fade knee taking the last of the tail. That memory is the afterglow, so
 * the bolt itself is brief: at the resting intensity of 1.05 the middle of
 * the line writes about 2.6 a frame and the canvas settles it at its 1.8
 * ceiling within two frames, which is the hot core the bloom reads. The hold
 * scales only the carried mean, so a single hot filament is left alone. At a
 * full packet the intensity resolves 1.05, at a full packet at full tension
 * 0.90.
 *
 * Its home is the hard, heavy, high drive corner of the space, the metal,
 * dubstep and drum and bass readings of `tracks.fixture.ts`, with a narrow
 * reach of 0.35: a lo-fi or ambient track never sees it. A groove fit of 0.3
 * is a nod for a busy hard groove and not an invitation; the study is the
 * drop's. Coverage at the worst the mapping reaches, three bolts alive inside
 * a second at length 0.7 and width 3.2, is under five percent of the frame
 * (`lightningCoverage` overcounts on purpose), the brief's number.
 *
 * The intensity is the number to trust least, as it was for the rings and the
 * halo: it was reasoned from the canvas sum, not set from a capture. If the
 * bolts read faint beside the shards on the adapter, raise the resting
 * intensity before anything else.
 */
export const LIGHTNING: InkStudy = {
  id: 'lightning',
  kind: 'ink',
  name: 'Lightning',
  impl: 'lightning',
  home: { drive: 0.65, weight: 0.35, tonality: 0.25, steadiness: 0.55, hardness: 0.7 },
  reach: 0.35,
  moments: { intro: 0, groove: 0.3, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: {
    rate: 0.8,
    forks: 2,
    length: 0.45,
    width: 2.2,
    life: 0.08,
    intensity: 1.05,
  },
  mapping: [
    { from: 'pace', to: 'rate', gain: 0.35, curve: 'linear' },
    { from: 'tension', to: 'rate', gain: -0.35, curve: 'linear' },
    { from: 'impact', to: 'rate', gain: 0.3, curve: 'linear' },
    { from: 'energy', to: 'forks', gain: 2, curve: 'linear' },
    { from: 'energy', to: 'length', gain: 0.25, curve: 'linear' },
    { from: 'tension', to: 'length', gain: -0.1, curve: 'linear' },
    { from: 'energy', to: 'width', gain: 1, curve: 'linear' },
    { from: 'tension', to: 'life', gain: -0.03, curve: 'linear' },
    { from: 'tension', to: 'intensity', gain: -0.15, curve: 'linear' },
  ],
  cost: 'cheap',
}
