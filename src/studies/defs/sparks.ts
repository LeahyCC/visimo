import type { InkStudy } from '../types'

/**
 * Particles thrown off the treble and upper-mid hits, for the groove and the
 * drop of a bright, fast track. The shards are the drop's one big gesture and
 * these are the groove's constant small ones: every hat and every crack of a
 * snare throws a spray of light, each point a tiny bright head with a short
 * streak along its own velocity.
 *
 * It is a particle field now (`impls/ParticleField.ts`, the `SPARKS_PROFILE`
 * in `impls/particles.params.ts`) and not a CPU ring of 96 quads. A hit throws
 * hundreds rather than a handful, so a hat reads as a spray and not as three
 * dots, and a spark rides the live flow instead of only being smeared by the
 * canvas, so a burst bends along whatever is stirring the picture. The study
 * itself did not move: the same id, the same home and reach, the same moments,
 * the same rows against the same fields.
 *
 * Where a spark is born is where the hit landed. The packet says where in the
 * spectrum each band's hit sat and how wide it was, and the sparks lay the two
 * bands they answer to (the highMid and the treble) round a circle the way the
 * spectrum ring lays the bands: the bottom is the low edge of the highMid, the
 * top is the top of the treble, the two halves are mirrors and a coin per
 * spark picks the side. A hat lands high on the ring and a snare's crack
 * lower, and a wide hit fans its sparks across more of the ring than a narrow
 * one. The circle is 0.2 of the short side from the middle, and a spark leaves
 * it outward within 0.4 radians either side of straight. Then a little drag
 * and a little gravity, so a spark sinks about 7 percent of the short side
 * over its longest life. It lives under a second, colour going from nearly
 * white at birth to the ribbon's palette at the key as it cools.
 *
 * Three knobs decide how many there are, and the split matters. `count` is the
 * pool, which is the budget and not the picture: 40,000 slots, enough to hold
 * everything the other two can put in the air at once. `burst` is what one hit
 * throws at its full strength, and `rate` is a thin shimmer between hits so a
 * bar with no hats in it is not empty. On the pool this study had, `count`
 * meant the throw; it means the pool everywhere in the field's vocabulary, and
 * renaming it was the one change a reader of the old def will trip on.
 *
 * `pace` doubles the shimmer, so a busy groove glitters more between hits.
 * Tension is the catalogue's row and it is on the throw: a build doubles what
 * a hit spends, so a snare roll fills the frame with spray, and it leaves the
 * light alone. The treble's own hit adds to the throw as well, through an
 * envelope of 5 milliseconds up and 320 down, which is the shape of the handful
 * rather than its size: up in 5 milliseconds is the crack itself, one frame at
 * any frame rate, and down over 320 is about a third of a second of tapering,
 * so a hat throws a fat spray and then thinner ones and a run of sixteenths
 * never drops back to the single spark between hits that the band's level
 * gives. The level itself is the wrong thing to read here, since it says how
 * much treble is playing and not that something was just struck, so a ride
 * cymbal held down would read as a hit that never ended.
 *
 * The treble is the tempting row for the intensity and it would break the
 * wash-out rule, since a bright full packet would then draw brighter than
 * rest. It goes on the throw instead, and a bigger throw cannot add light on
 * its own for long, because the pool is the budget and a bigger throw only
 * spends it faster. `hardness` puts up to 0.45 on the speed, so a hard track
 * throws its sparks harder. `pace` shortens their life by up to 0.2 s and
 * `weight` makes them up to 0.6 px fatter on a bass-led track. Energy, swell
 * and hardness each take a square off the intensity, so a full packet draws at
 * 0.018 against a rest of 0.03 and never brighter.
 *
 * It is sparse by design. At the most its own mapping reaches, a full packet
 * at full tension over a busy groove of eight hits a second, about 4,550
 * sparks are in the air at once. Each as the whole quad it is drawn in at its
 * widest, they cover 1.3 percent of a square 1080 frame and 0.7 percent of a
 * 16:9 one, rising to 4.4 percent on a 320 by 320 canvas, where a spark cannot
 * be thinner than a pixel and the canvas ceiling is what holds the count down.
 * `particleCoverage` is an upper bound, since the shader tapers each quad to a
 * comet, and a test holds it under a twentieth on eight canvas shapes. That is
 * the flash statement for WCAG 2.3.1: a spark is a pixel or two wide, the
 * whole field is a few percent of the frame at the very most, and each fades
 * over a fraction of a second, so nothing here is a large-area change of
 * luminance.
 *
 * The intensity is the number to trust least and it is a different number from
 * the pool's. The light of a frame is the sparks alive times their area times
 * this: the sparks alive went up a hundred and fortyfold and the area went
 * down elevenfold, so 2.4 on a 4 px spark became 0.03 on a 1.2 px one for
 * about the same light. Whether a spray of four thousand points reads like a
 * scatter of thirty is not something the arithmetic can say. It is the first
 * number to look at on a real track.
 */
export const SPARKS: InkStudy = {
  id: 'sparks',
  kind: 'ink',
  name: 'Sparks',
  impl: 'sparks',
  home: { drive: 0.7, weight: 0.35, tonality: 0.5, steadiness: 0.5, hardness: 0.6 },
  reach: 0.4,
  moments: { intro: 0, groove: 1, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: {
    count: 40000,
    rate: 500,
    burst: 500,
    speed: 0.5,
    life: 0.55,
    size: 1.2,
    intensity: 0.03,
    hueSpread: 0.12,
  },
  mapping: [
    { from: 'pace', to: 'rate', gain: 500, curve: 'linear' },
    { from: 'tension', to: 'burst', gain: 500, curve: 'linear' },
    {
      from: 'treblePulse',
      to: 'burst',
      gain: 500,
      curve: 'linear',
      // The study's own swell for one hit, rather than the extractor's: a
      // crack and a third of a second of taper. See above.
      shape: { kind: 'envelope', attackMs: 5, releaseMs: 320 },
    },
    { from: 'hardness', to: 'speed', gain: 0.45, curve: 'linear' },
    { from: 'pace', to: 'life', gain: -0.2, curve: 'linear' },
    { from: 'weight', to: 'size', gain: 0.6, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.006, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.004, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.002, curve: 'square' },
  ],
  cost: 'cheap',
}
