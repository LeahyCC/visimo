import type { InkStudy } from '../types'

/**
 * The ink for the drop's biggest hits: branching bolts, built on the CPU by
 * midpoint displacement and gone in under a fifth of a second, so
 * the canvas's own long memory is what carries the afterglow. It is the
 * shards' neighbour: it exists to make the loud, hard passages unmistakable,
 * tension holds it back for them, and an empty pool draws and uploads nothing.
 *
 * Two ways in: `impact` fires one bolt at full strength, and a strong hit in
 * the low end or the mids fires one at the hit's strength while `release` is
 * still high or the passage is simply loud. It needed `release` at first, and
 * real tracks rarely read one, so a soloed study drew nothing for a whole song. A token bucket holds one strike and refills at
 * `rate`, capped at one and a half a second, so with the banked one no song
 * fires more than three bolts a second, which is the WCAG 2.3.1 line held by
 * construction; and one bolt at the most the mapping reaches is under two
 * percent of a 16:9 frame, far under the large area a flash counts. Every
 * bolt is seeded from the section id and the strike count, so the same song
 * throws the same bolts.
 *
 * A bolt is lit the way the photographs are: a near white core that rests
 * above 1 so the bloom catches it, a saturated glow in the air around it, and
 * forks that carry a neighbouring hue a step per fork depth. The hue stays in
 * the band air glows when a strike ionises it, cyan through blue to violet,
 * and the key moves it inside that band: following the key all the way round
 * drew a red bolt in a red key, which read as a hot wire. The palette is its own, not one borrowed from the ribbon, and the
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
 * The numbers were first reasoned from the canvas's arithmetic and then set by
 * eye on the adapter, where the reasoned ones drew a thin brown scratch that
 * was gone before it read. The bolt is longer, lives longer and rests at 1.8. The canvas keeps 0.975 of itself a frame now and holds its own
 * mean at 0.13, so what a bolt leaves behind falls to a tenth in about a
 * second and a half and to a thousandth in about four and a half, with the
 * fade knee taking the last of the tail. That memory is the afterglow, so
 * the bolt itself is brief. The hold scales only the carried mean, so a single
 * hot filament is left alone. At a full packet the intensity resolves 1.8, at
 * a full packet at full tension 1.65.
 *
 * Its home is the metal end of `tracks.fixture.ts`: hard, atonal and not very
 * steady, with a reach of 0.28, so a lo-fi or ambient track never sees it. It
 * first sat a little nearer the middle with a reach of 0.35, and from there it
 * was the nearer drop ink for every hard track there is, so the shards were
 * never cast at all. The two share a moment and must not share a home: the
 * steady, more tonal hard tracks (dubstep, drum and bass) stay the shards', and
 * the ragged ones are the lightning's. A groove fit of 0.3
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
  home: { drive: 0.6, weight: 0.35, tonality: 0.12, steadiness: 0.45, hardness: 0.68 },
  reach: 0.28,
  moments: { intro: 0, groove: 0.3, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: {
    rate: 0.85,
    forks: 3,
    length: 0.7,
    width: 1.6,
    life: 0.18,
    intensity: 1.8,
  },
  mapping: [
    { from: 'pace', to: 'rate', gain: 0.35, curve: 'linear' },
    { from: 'tension', to: 'rate', gain: -0.35, curve: 'linear' },
    { from: 'impact', to: 'rate', gain: 0.3, curve: 'linear' },
    { from: 'energy', to: 'forks', gain: 1, curve: 'linear' },
    { from: 'energy', to: 'length', gain: 0.25, curve: 'linear' },
    { from: 'tension', to: 'length', gain: -0.1, curve: 'linear' },
    { from: 'energy', to: 'width', gain: 0.6, curve: 'linear' },
    { from: 'tension', to: 'life', gain: -0.03, curve: 'linear' },
    { from: 'tension', to: 'intensity', gain: -0.15, curve: 'linear' },
  ],
  cost: 'cheap',
}
