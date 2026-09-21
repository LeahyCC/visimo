import type { InkStudy } from '../types'

/**
 * The bands as bars round a circle, the most literal study there is: it shows
 * the listener the sound itself beside the ribbon, and the trails turn its bars
 * into petals. It suits a groove on any track, so its home is the middle of the
 * space with the widest reach, and it says nothing at the other moments.
 *
 * The packet has five bands and five bars is not a ring, so the study lays them
 * out and does not invent any. The bands run along one half of the circle, sub
 * at one pole and treble at the other, and are mirrored across that axis for the
 * other half, so the ring is symmetric and closes without a seam. A bar between
 * two bands takes a smoothstep of the two nearest, which has no slope at a band
 * or at a pole, so the mirror has no crease. Each band's pulse kicks the bars
 * that stand for it, by the same blend, and multiplies the level rather than
 * adding to it. The colour runs the ribbon's palette from one pole to the other
 * on both sides, round the key like every ink. The ink reads the five levels and
 * five pulses from the packet for its bars and the key for their colour, and
 * nothing else: not the analyser's spectrum, and not `energy`, which only sets
 * how far a full bar reaches. All of it is in `spectrum.params.ts`.
 *
 * Silence needs no gate in a knob, because a bar's length is its band's level:
 * a silent packet is every bar at nothing, no pass is encoded and nothing is
 * uploaded, and a pulse with no level under it draws nothing either. Tension
 * contracts the ring, as the catalogue says: it brings the feet in by 0.07 of the
 * short side, from 0.22 to 0.15, and quickens the turn by 0.03 turns a second,
 * so a build closes in and winds up. It leaves the light, the length and the
 * width alone, so it adds no brightness. The other rows are `energy` on the
 * length (0.05 of the short side at rest, 0.18 at full), `beatPulse` on the
 * radius (0.015, so the ring breathes on the beat), `pace` on the turn (0.02
 * turns a second at rest and 0.05 more at full, so it is per second and not per
 * frame) and `lowEnd` on the width (a kick thickens the bars by a pixel). The
 * count and the palette's spread are settings and sit still.
 *
 * Bars cannot overlap. They stand on a circle, so neighbours are nearest at
 * their feet, and the radius is bounded from below by what the count and the
 * width need (`barRadiusPixels`): the chord between two feet is always the
 * width plus a pixel of edge either side. The resting 64 bars need 56 px at
 * most and the ring stands at 238 px at 1080 high, so the bound never bites
 * here, and it holds for any cast that raises the count or the width.
 *
 * It is sparse by design. At its worst, a full packet with every bar at full
 * length (64 bars 0.18 of the short side long and 3.5 px wide at 1080 high, edge
 * pixels included), it lights 3.3% of a 16:9 frame, 5.9% of a square one and
 * 2.5% of a wide 21:9 one (`barCoverage`, an upper bound that counts every bar
 * whole), and 7.5% of a 640 pixel square, where the edge pixels do not shrink
 * with it. A test holds it under a tenth on eight canvas shapes and at every
 * level and tension between. That is the flash statement for WCAG 2.3.1: the
 * whole ring is never more than a few percent of the frame, so a bar changing
 * length with the beat is a small change and never a large-area one.
 *
 * The intensity is the number to trust least, and it has now been wrong three
 * times. The sum on paper said a still bar settles at fourteen times what a
 * frame adds over the canvas's floor, and 0.05 was chosen from that. On the
 * adapter in the bench it was not there: the brightest pixel of the ring's
 * band read 2 of 255 at a quiet level and 19 at a loud one, and 0.08 read 19
 * and 41. A bar is thin and its length follows the sound, the ring turns and
 * the flow carries its trail sideways, so what builds is a small part of the
 * paper sum, and a short bar carries less light than a long one. It is 0.35 at
 * rest, a bar's light going from 0.6 of that when it is short to all of it when
 * it is full, and `energy` takes 0.1 off at full (so 0.23 at a full packet, with `swell` and `hardness`
 * a hundredth each). Measured on an NVIDIA Blackwell adapter in headless Edge at
 * the bench, over lazy fluid at a quiet level (0.25) beside the ribbon, the
 * ring is a small, clear ring of short teal-to-orange ticks the brightest of
 * which reads 147 of 255 alone; at a loud one (0.85) it is a ring of tapered petals bent by the
 * fluid that reads 197, about as bright as the ribbon and no brighter. With no
 * flow at all it reads 135 at a loud level, and under curl drift, the slowest
 * flow, 201 at its single brightest pixel, with under 0.01% of the band over 200
 * and no wash-out. It is the number to look at first on a real track.
 */
export const SPECTRUM_RING: InkStudy = {
  id: 'spectrum-ring',
  kind: 'ink',
  name: 'Spectrum ring',
  impl: 'spectrum',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 0, groove: 1, build: 0, drop: 0, rest: 0, outro: 0 },
  knobs: {
    bars: 64,
    radius: 0.22,
    length: 0.05,
    width: 2.5,
    intensity: 0.35,
    hueSpread: 0.3,
    spin: 0.02,
  },
  mapping: [
    { from: 'energy', to: 'length', gain: 0.13, curve: 'linear' },
    { from: 'beatPulse', to: 'radius', gain: 0.015, curve: 'linear' },
    { from: 'tension', to: 'radius', gain: -0.07, curve: 'linear' },
    { from: 'lowEnd', to: 'width', gain: 1, curve: 'linear' },
    { from: 'pace', to: 'spin', gain: 0.05, curve: 'linear' },
    { from: 'tension', to: 'spin', gain: 0.03, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.1, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.01, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.01, curve: 'square' },
  ],
  cost: 'cheap',
}
