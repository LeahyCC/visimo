import type { InkStudy } from '../types'

/**
 * Particles thrown off the treble and upper-mid hits, for the groove and the
 * drop of a bright, fast track. The shards are the drop's one big gesture and
 * these are the groove's constant small ones: every hat and every crack of a
 * snare throws a few points of light, each a tiny bright head with a short
 * streak along its own velocity, and the canvas's trail carries them along the
 * flow. The ink reads no flow itself, so it sits over any of them.
 *
 * Its home is the bright, fast corner, a light weight and a high drive, with a
 * reach of 0.4: wider than the shards' 0.35 and narrower than the turbulent
 * fluid's, so a lo-fi track scores it 0.39 and a hardstyle one 0.64. The
 * catalogue gives it the groove and the drop and nothing else.
 *
 * Where a spark is born is where the hit landed. The packet says where in the
 * spectrum each band's hit sat and how wide it was, and the sparks lay the two
 * bands they answer to (the highMid and the treble) round a circle the way the
 * spectrum ring lays the bands: the bottom is the low edge of the highMid, the
 * top is the top of the treble, the two halves are mirrors and a coin per spark
 * picks the side. A hat lands high on the ring and a snare's crack lower, and a
 * wide hit fans its sparks across more of the ring than a narrow one. The
 * circle is 0.2 of the short side from the middle, and a spark leaves it
 * outward, within 0.4 radians either side of straight. Then a little drag and a
 * little gravity, in closed form, so a spark sinks about 7 percent of the short
 * side over its longest life. It lives under a second, colour going from nearly
 * white at birth to the ribbon's palette at the key as it cools.
 *
 * The rate is the study's own limit, a bucket: `rate` sparks a second refill it
 * and it holds one hit's worth, so a run of sixteenth-note hats cannot throw
 * more than the knob allows. It rests at 20 and `pace` adds up to 20 more.
 * Tension is the catalogue's row and it is on the rate: a build adds 20, so a
 * snare roll that would have been rationed is let through, and the limit still
 * holds even the busiest packet to 60 a second. It leaves the light alone. On
 * the bench's synthetic beat, which throws about 14 sparks a second and so never
 * reaches the limit, tension has nothing to let through and the sparks alive do
 * not move; it shows on a run of sixteenths (see `sparks.test.ts`).
 *
 * The treble is the tempting row for the intensity and it would break the
 * wash-out rule, since a bright full packet would then draw brighter than rest.
 * It goes on the count instead: `treble` adds up to 3 sparks a hit, and that
 * cannot add light on its own, because the bucket holds the sparks a second and
 * a bigger hit only spends it faster. `hardness` puts up to 0.45 on the speed,
 * so a hard track throws its sparks harder. `pace` shortens their life by up to
 * 0.2 s and `weight` makes them up to 2 px fatter on a bass-led track. Energy,
 * swell and hardness each take a square off the intensity, 0.5, 0.3 and 0.2, so
 * a full packet draws at 1.4 against a rest of 2.4 and never brighter.
 *
 * It is sparse by design. With the pool full (96) and every knob at the top of
 * its range, a spark as the whole quad it is drawn in, at its widest and with
 * the longest streak the top speed allows, none overlapping another, covers 3.9
 * percent of a square frame, 2.2 percent of a 16:9 one and 1.1 percent of a
 * 32:9 one (`worstSparkCoverage`, an upper bound, since the shader tapers each
 * quad to a comet), and a test holds it under a twentieth on eight canvas
 * shapes. Nothing the knobs allow can fill the pool: at most 66 are alive at
 * once. At the most the study's own mapping reaches, a full packet at full
 * tension, 32 can be alive and cover 1.1 percent of a square frame and 0.6 of a
 * 16:9 one, and a groove at a pace of 0.4 covers 0.13 percent of a 16:9 one.
 * That is the flash statement for WCAG 2.3.1: a spark is a few pixels wide, the
 * whole pool is a few percent of the frame at the very most, and each fades over
 * a fraction of a second, so nothing here is a large-area change of luminance.
 *
 * The intensity is the number to trust least, and it was set by looking. It
 * first rested at 1 with a 2.5 px spark, and beside the ribbon on the adapter
 * at a quiet level the sparks were a few faint hairlines you had to look for,
 * the brightest pixel of a frame with one in it reading no more than 163 of 255 and mostly under 100. At 1.6
 * a 4 px spark was still thin. At 2.4 they read at once beside the ribbon at
 * both a quiet level (0.25, 128 beats a minute) and a loud one (0.85, 174): the
 * brightest pixel of a frame with sparks in it mostly reads 180 to 230 of 255 at
 * both, over lazy fluid and over curl drift, the dimmer frames being sparks near
 * the end of their life, with 0.05 to 0.6 percent of the frame over 8 and never
 * more than 0.15 percent over 64. A spark moves, so it does
 * not build up as a still image would: it adds its one frame and the floor eats
 * the wake, which is why the number is far over the 1 that a single frame of
 * light suggests. The top of the range is 4. It is the number to look at first
 * on a real track.
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
    rate: 20,
    count: 3,
    speed: 0.5,
    life: 0.55,
    size: 4,
    intensity: 2.4,
    hueSpread: 0.12,
  },
  mapping: [
    { from: 'pace', to: 'rate', gain: 20, curve: 'linear' },
    { from: 'tension', to: 'rate', gain: 20, curve: 'linear' },
    { from: 'treble', to: 'count', gain: 3, curve: 'linear' },
    { from: 'hardness', to: 'speed', gain: 0.45, curve: 'linear' },
    { from: 'pace', to: 'life', gain: -0.2, curve: 'linear' },
    { from: 'weight', to: 'size', gain: 2, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.5, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.3, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.2, curve: 'square' },
  ],
  cost: 'cheap',
}
