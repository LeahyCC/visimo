import type { InkStudy } from '../types'

/**
 * Club laser fans sweeping through haze, for the groove and the drop of a
 * steady, mid to high drive, fairly hard track: house, trance, techno. The
 * beams are thrown from points just off the top and bottom edges and swung by
 * the beat, so the study reads as light in the air of a room and not as a
 * picture drawn on the frame. Its home is the measured middle of those
 * tracks: FISHER's house reads 0.64 on drive at 0.92 steady and John Summit's
 * tech house 0.53 at 0.68, so the home sits at a drive of 0.6, a steadiness
 * of 0.75 and a hardness of 0.6, with a reach of 0.35: a house or a techno
 * track is at home with it and a lo-fi one is not. The catalogue gives it the
 * groove strongly, the drop at full and the build at half, and nothing else.
 *
 * A fan is a point origin and a spread of thin beams about a base direction
 * into the frame. Origins alternate between the two edges and stand evenly
 * along the x axis, so neighbours lean across each other. `energy` brings the
 * fan count from 3 to 6 through a square root, so the first sound puts
 * several fans up, and opens the spread and the swing amplitude, so a loud
 * passage sweeps wider. `treble` fattens a fan to 6 beams. The swing's
 * position is the beat clock's, read from the packet the way the rings read
 * it: the angle is `sweep x (0.5 - beatPhase)`, so every fan crosses the
 * middle of its travel on the predicted beat, and even fans run backwards,
 * crossing their neighbours twice a beat. `tempoConfidence` gates the light
 * through `invert`, as it gates the rings: a track with no steady beat dims
 * the fans out rather than sweeping them at a wrong tempo, and a silent
 * packet takes the intensity to 0, which is the study's silence gate.
 *
 * Tension closes every fan to one beam, as the catalogue says: it takes the
 * spread from 0.45 to 0 at full tension, so a build is a row of single beams
 * sweeping, and lifts the intensity by only 0.02, so a build is narrower and
 * not brighter. On the drop, `impact` throws the spread to the top of its
 * range for its frame, which is the fans flung wide the moment the held-back
 * beat lands.
 *
 * The treble answers one beam at a time. `flick` rests at 0 and `treblePulse`
 * lifts it to near 1 on a hit, and while it is up the beam the beat clock
 * selects in each fan carries twice its light, so a hit reads as single beams
 * flashing and not as the fans brightening. The pulse decays as the packet's
 * own pulse does, per second, and nothing in the study integrates per frame:
 * there is no clock and no state, so the same song at 60 and at 144 frames a
 * second draws the same frame.
 *
 * It is sparse by construction. At the worst there is, a full packet with six
 * fans of six beams at full spread, each beam lights a band about 5 px wide
 * (the core 1.5 px and the soft edge past it) across at most the frame's
 * diagonal, and the beams cross in small groups, so the lit share of a 16:9
 * frame stays around 8 percent (`lasersCoverage`, measured on a grid with
 * every lit pixel counted once however many beams cross it), and a test holds
 * it under 15 percent on a 16:9, a square and a tall canvas. That is the
 * flash statement for WCAG 2.3.1: the lit area is a small share of the frame,
 * the beams move continuously with the beat, and nothing toggles a large area
 * of luminance on or off, so there is no strobe in the construction.
 *
 * The intensity is the number to trust least. It rests at 0.8, gated by the
 * tempo confidence, and `energy` and `hardness` pull it back (not `swell`, which rests at a half in silence and would take a gated intensity under 0) as the
 * frame fills, the halo's arithmetic: a beam is thin and moves, so it adds
 * its one frame and the floor eats the wake, and crossings only sum a few
 * beams at a pixel before the sweep carries them on. If it is faint beside
 * the ribbon on the adapter, the `width` is the knob to raise before the
 * `intensity`.
 */
export const LASERS: InkStudy = {
  id: 'lasers',
  kind: 'ink',
  name: 'Lasers',
  impl: 'lasers',
  home: { drive: 0.6, weight: 0.35, tonality: 0.4, steadiness: 0.75, hardness: 0.6 },
  reach: 0.35,
  moments: { intro: 0, groove: 0.8, build: 0.5, drop: 1, rest: 0, outro: 0 },
  knobs: {
    fans: 3,
    beams: 4,
    spread: 0.45,
    sweep: 0.25,
    width: 1.2,
    glow: 1.0,
    intensity: 0.8,
    flick: 0,
    hue: 0,
  },
  mapping: [
    { from: 'energy', to: 'fans', gain: 3, curve: 'sqrt' },
    { from: 'treble', to: 'beams', gain: 2, curve: 'linear' },
    { from: 'energy', to: 'spread', gain: 0.35, curve: 'linear' },
    { from: 'tension', to: 'spread', gain: -0.45, curve: 'linear' },
    { from: 'impact', to: 'spread', gain: 0.4, curve: 'linear' },
    { from: 'energy', to: 'sweep', gain: 0.3, curve: 'linear' },
    { from: 'energy', to: 'width', gain: 0.3, curve: 'linear' },
    { from: 'hardness', to: 'glow', gain: -0.5, curve: 'linear' },
    { from: 'tempoConfidence', to: 'intensity', gain: -0.8, curve: 'invert' },
    { from: 'energy', to: 'intensity', gain: -0.12, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.04, curve: 'square' },
    { from: 'beatPulse', to: 'intensity', gain: 0.06, curve: 'linear' },
    { from: 'tension', to: 'intensity', gain: 0.02, curve: 'linear' },
    { from: 'treblePulse', to: 'flick', gain: 0.9, curve: 'linear' },
    { from: 'harmonicChange', to: 'hue', gain: 0.04, curve: 'linear' },
  ],
  cost: 'cheap',
}
