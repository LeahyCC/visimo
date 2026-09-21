import type { InkStudy } from '../types'

/**
 * Slow specks adrift, for the quiet end of a song: intro, rest and outro on a
 * soft, slow track. It is the one ink that is at its best when the music is
 * least, so its rows are written against how much there is to hear, not how
 * much there is to draw.
 *
 * A quiet passage is not silence, and that is what decides the count. The
 * catalogue asks for more dust in the quiet, which is `energy` inverted, but a
 * bare inversion is at its largest at silence, and a silent packet has to draw
 * nothing. So the count is a hump: the square root of the energy lets the dust
 * in with the first sound at all, a square takes it away again as the music
 * fills the frame, and at a silent packet the count resolves to 0 and no pass
 * is encoded. The count carries the gate and the intensity does not, because a
 * count is a level that brings the specks in one at a time, so a sound
 * arriving is a few specks fading up and not the whole field at once, while an
 * intensity of 0 would still leave a pass of invisible quads to draw. The
 * intensity is an ordinary ceiling that only ever dims under load.
 *
 * Tension makes the specks gather: it pulls every speck's place toward the
 * middle, to half the way at a full build, which is the one thing here that a
 * build does. It stops there on purpose, since at 1 every speck would sit on
 * one point and add up to a white dot. The drop lets them go again as tension
 * falls.
 *
 * It is sparse by construction. At its most, a count of about 70 at a size of
 * 8 covers 0.4% of a square frame and 0.2% of a 16:9 one (`dustCoverage`), and
 * with every knob at the top of its range it is 3.5% and 2%, which a test
 * holds under a twentieth on every canvas shape.
 *
 * The intensity is the number to trust least. A speck barely moves, so the
 * canvas sums it for seconds, and the flow then draws its light out along a
 * trail, so a speck is far dimmer on screen than what one frame adds. It was
 * set on the adapter in the bench at a quiet level: at 0.08 the brightest
 * pixel read 47 of 255 and the dust was nearly invisible, and at 0.25 it read
 * 175 to 199 with the same specks and no wash-out with or without a flow.
 * That was judged by the brightest pixel. Judged as a picture, as the only
 * ink of a quiet cast over curl drift and through the film look, 0.25 left
 * the frame reading as empty, so it rests at 0.5 with a speck of 10 and not
 * 8, which shows as pale specks with short trails on black. The rows that
 * dim it as the music fills were doubled with it, so a loud hard packet
 * still takes it to about half.
 *
 * Its home is the soft, slow corner, the opposite of the shards, and its
 * reach is narrow for the same reason theirs is: a lo-fi track is at home
 * with it and a hardstyle one is not.
 */
export const DUST: InkStudy = {
  id: 'dust',
  kind: 'ink',
  name: 'Dust',
  impl: 'dust',
  home: { drive: 0.15, weight: 0.55, tonality: 0.6, steadiness: 0.4, hardness: 0.1 },
  reach: 0.3,
  moments: { intro: 1, groove: 0, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: {
    count: 0,
    size: 10,
    drift: 0.012,
    twinkle: 0.45,
    intensity: 0.5,
    hueSpread: 0.12,
    gather: 0,
  },
  mapping: [
    { from: 'energy', to: 'count', gain: 140, curve: 'sqrt' },
    { from: 'energy', to: 'count', gain: -120, curve: 'square' },
    { from: 'swell', to: 'drift', gain: 0.03, curve: 'linear' },
    { from: 'treble', to: 'twinkle', gain: 0.5, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.12, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.06, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.06, curve: 'square' },
    { from: 'tension', to: 'gather', gain: 0.5, curve: 'linear' },
  ],
  cost: 'cheap',
}
