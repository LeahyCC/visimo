import type { InkStudy } from '../types'

/**
 * Tall slow curtains of light that sway, for the quiet end of a song: ambient,
 * classical and acoustic, the corner the library had the least in. It is a
 * fullscreen fragment pass, so the whole of the arithmetic is about how little
 * of the frame it may light, and it lives in `aurora.params.ts`: black sky
 * between and above the curtains, a hard bright foot, fine vertical rays that
 * dissolve upward and are exactly nothing at a curtain's top.
 *
 * Its colour is held to the real thing. A curtain is green at the foot and
 * violet to magenta at the top, so the key and the chord move two hues inside
 * their own bands, the foot's from green to cyan and the top's from violet to
 * magenta, and never out of them. `keyHue` places both, and `hue` is turns a
 * moving chord has added, integrated from `harmonicChange` the way the halo's
 * colour is, so a chord change is a nudge of colour inside the arc that
 * settles over seconds. It reads no colour from the shared palette.
 *
 * What draws it is the level, the mids and the chroma, and never `tension`,
 * `release` or `impact`, which real tracks rarely reach. The light rests at 1.6
 * as the light the foot settles at on a still canvas, over 1 so the bloom
 * finds the foot, and the level and the key's clarity gate it: `energy` and
 * `keyClarity` each take their share off through `invert`, so a silent packet
 * resolves to exactly no light and no pass is encoded, and a passage of drums
 * with no key in it draws a dimmer curtain, which is right for a tonal study.
 * The gate is the only thing that moves the intensity with the music, and it
 * only ever falls from rest, so a loud passage is never dimmer than a quiet
 * one that has a key. The punch goes where the brief puts it: more curtains
 * (`energy` from 1.4 to nearly four), taller ones, sharper rays on the treble,
 * more sway on the mids and a stronger ripple, which is a swell a hit sends
 * along one curtain and not a flash of the frame.
 *
 * Tension lowers and dims the curtains, as the catalogue says: fewer, shorter,
 * stiller and slower, and the light down by a quarter through a `scale` on
 * `energy`, so the row cannot take the intensity under nothing on a silent
 * build. The study draws nothing of its own through a build, since there is no
 * standing light to wind in.
 *
 * Home is the soft, tonal, slow end of `tracks.fixture.ts`: low drive, weight in
 * the low to middle, high tonality and low hardness, with a reach of 0.4. Its
 * moments are the intro, the rest and the outro, and a nod at the groove.
 */
export const AURORA: InkStudy = {
  id: 'aurora',
  kind: 'ink',
  name: 'Aurora',
  impl: 'aurora',
  home: { drive: 0.25, weight: 0.6, tonality: 0.8, steadiness: 0.35, hardness: 0.06 },
  reach: 0.33,
  moments: { intro: 1, groove: 0.3, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: {
    intensity: 1.6,
    curtains: 1.4,
    height: 0.55,
    sway: 0.012,
    drift: 0.018,
    rays: 0.5,
    ripple: 0.3,
    hue: 0,
  },
  mapping: [
    { from: 'energy', to: 'intensity', gain: -0.9, curve: 'invert' },
    { from: 'keyClarity', to: 'intensity', gain: -0.7, curve: 'invert' },
    {
      from: 'tension',
      to: 'intensity',
      gain: -0.6,
      curve: 'linear',
      scale: { from: 'energy', curve: 'linear' },
    },
    { from: 'energy', to: 'curtains', gain: 2.4, curve: 'linear' },
    { from: 'tension', to: 'curtains', gain: -1.2, curve: 'linear' },
    { from: 'energy', to: 'height', gain: 0.3, curve: 'linear' },
    { from: 'tension', to: 'height', gain: -0.3, curve: 'linear' },
    { from: 'lowMid', to: 'sway', gain: 0.02, curve: 'linear' },
    { from: 'highMid', to: 'sway', gain: 0.02, curve: 'linear' },
    { from: 'tension', to: 'sway', gain: -0.008, curve: 'linear' },
    { from: 'swell', to: 'drift', gain: 0.025, curve: 'linear' },
    { from: 'tension', to: 'drift', gain: -0.01, curve: 'linear' },
    { from: 'treble', to: 'rays', gain: 0.25, curve: 'linear' },
    { from: 'energy', to: 'rays', gain: 0.2, curve: 'linear' },
    { from: 'energy', to: 'ripple', gain: 0.25, curve: 'linear' },
    { from: 'highMidPulse', to: 'ripple', gain: 0.2, curve: 'linear' },
    { from: 'tension', to: 'ripple', gain: -0.2, curve: 'linear' },
    {
      from: 'harmonicChange',
      to: 'hue',
      gain: 1,
      curve: 'linear',
      shape: { kind: 'integrate', rate: 0.06, wrap: 1 },
    },
  ],
  cost: 'medium',
}
