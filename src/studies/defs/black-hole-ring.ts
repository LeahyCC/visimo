import type { InkStudy } from '../types'

/**
 * The half of the black hole you look at: a thin, hot accretion ring on the
 * rim of an empty middle, brightest on one side, with an annulus around it
 * that reads last frame's canvas through a radial displacement so the picture
 * outside appears to bend round the hole. `black-hole` is the flow that keeps
 * the middle empty; the two share a home and a moment so the director casts
 * them together, and `docs/studies/black-hole.md` says which references this
 * was built to and what makes them striking.
 *
 * **The dark middle is an absence, not a colour.** Inks only add light, so
 * nothing here can paint a disc black; what reads as the hole is that this
 * ink draws exactly nothing inside `disc` and the flow beside it carries away
 * what lands. A disc painted actually black waits for `subtract-blend`, which
 * has no card yet.
 *
 * **The bass is what burns.** `heat` is the ring's fire as a multiple of the
 * intensity and the low end is what drives it: `lowEnd` adds 0.55 through a
 * square root, the sub's own hit another 0.35 and the drop 0.25, so a kick
 * lights the ring and a pad does not. The core rests over 1 so the bloom
 * catches it, and the colour lives in the shoulders: white only at the very
 * centre, the hot hue around it and the cooler one at the edges.
 *
 * **Nothing here brightens with the level, and the punch is still there.**
 * The registry guard forbids raising `intensity` with the music, and the
 * answer is not to lower it either: `intensity` only ever gates down, on
 * `energy` through an invert, so it reads its resting 1.15 at a full packet
 * and exactly 0 at a silent one, which is what makes the frame black in
 * silence. What the music moves instead is the ring's heat and width, the
 * disc's radius, how far the annulus bends and, through the flow beside it,
 * the pull. Tension grows the disc and strengthens the bend, which is the
 * catalogue's own entry for it, and `impact` throws heat at the ring on the
 * frame the drop lands.
 *
 * **The annulus is a loop and is bounded by construction.** It reads the
 * picture the composite last wrote, which already holds what this ink drew a
 * frame ago. Two things keep it from feeding itself: the read always comes
 * from a radius strictly further out, so light only ever marches inward and
 * leaves the annulus in two or three hops, and the gain is a share of what
 * the canvas lets go of over the same real step rather than a fixed number
 * per frame, which makes the settled annulus at most `bend` times the picture
 * it is bending. `bend` rests at 0.5 and reaches 0.8; the texture gain that
 * comes out of that is 0.0125 at 60 frames a second and 0.005 at 144, two
 * orders under one. `blackhole.params.test.ts` runs the loop forward at four
 * frame rates and holds the settled profile under the surround.
 *
 * **Its colours are its own.** Two saturated hues a third of a turn apart,
 * amber for the fire and blue-white for the lensed sky, both turned together
 * by `keyHue` with `harmonicChange` and `swell` nudging them further. The
 * amber is not a choice: the Event Horizon Telescope image, Gargantua and
 * every offline render of gas at a few thousand kelvin are all that colour,
 * and a ring that followed the key all the way round would draw a green
 * black hole. Outside the annulus the ink draws nothing at all, so the sky
 * around it stays true black.
 *
 * **Coverage.** The ink can only light the band between the disc's rim and
 * the outer radius, since it returns nothing on either side of it. At rest
 * that is about 4 percent of a 16:9 frame and 8 of a square one; at the
 * widest its mapping reaches, about 10 and 18. `blackhole.test.ts` holds it
 * under 20 percent on eight canvas shapes. It is flash safe by construction:
 * nothing in it toggles, the ring's heat follows the low end's own envelope,
 * and the one event row is `impact`, which the extractor cannot fire closer
 * than 0.8 s apart.
 *
 * Its home is `black-hole`'s, the measured low-weight, hard corner where
 * dubstep, drum and bass and the demo's track sit, at a reach of 0.35. It is
 * deliberately away from the shards (0.5 weight) and the lightning (0.35):
 * all three want the drop, and three drop inks in one corner would mean two
 * of them are never cast. The small groove fit is what keeps it from being an
 * ink that only two moments in six can ever reach.
 */
export const BLACK_HOLE_RING: InkStudy = {
  id: 'black-hole-ring',
  kind: 'ink',
  name: 'Black hole ring',
  impl: 'blackhole',
  home: { drive: 0.52, weight: 0.2, tonality: 0.32, steadiness: 0.56, hardness: 0.74 },
  reach: 0.35,
  moments: { intro: 0, groove: 0.2, build: 1, drop: 0.85, rest: 0, outro: 0 },
  knobs: {
    disc: 0.08,
    width: 0.011,
    annulus: 0.075,
    heat: 0.85,
    beam: 0.5,
    bend: 0.5,
    intensity: 1.15,
    hue: 0,
    spin: 0,
  },
  mapping: [
    { from: 'energy', to: 'disc', gain: 0.018, curve: 'sqrt' },
    { from: 'lowEnd', to: 'disc', gain: 0.012, curve: 'linear' },
    { from: 'tension', to: 'disc', gain: 0.02, curve: 'linear' },
    { from: 'lowEnd', to: 'width', gain: 0.005, curve: 'linear' },
    { from: 'bassPulse', to: 'width', gain: 0.004, curve: 'linear' },
    { from: 'tension', to: 'width', gain: 0.002, curve: 'linear' },
    { from: 'swell', to: 'annulus', gain: 0.012, curve: 'linear' },
    { from: 'tension', to: 'annulus', gain: 0.013, curve: 'linear' },
    { from: 'lowEnd', to: 'heat', gain: 0.55, curve: 'sqrt' },
    { from: 'subPulse', to: 'heat', gain: 0.35, curve: 'linear' },
    { from: 'impact', to: 'heat', gain: 0.25, curve: 'linear' },
    { from: 'hardness', to: 'beam', gain: 0.25, curve: 'linear' },
    { from: 'beatPulse', to: 'beam', gain: 0.15, curve: 'linear' },
    { from: 'energy', to: 'bend', gain: 0.2, curve: 'sqrt' },
    { from: 'tension', to: 'bend', gain: 0.1, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -1.15, curve: 'invert' },
    { from: 'harmonicChange', to: 'hue', gain: 0.1, curve: 'linear' },
    { from: 'swell', to: 'hue', gain: 0.06, curve: 'linear' },
    // The beamed side walks round the ring rather than standing, so the
    // brightest part of a mark the canvas remembers for seconds is always
    // moving. Only an integrating row can drive an angle.
    {
      from: 'pace',
      to: 'spin',
      gain: 1,
      curve: 'linear',
      shape: { kind: 'integrate', rate: 0.04, wrap: 1 },
    },
  ],
  cost: 'medium',
}
