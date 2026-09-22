import type { InkStudy } from '../types'

/**
 * A sea to the horizon, for the intro, the groove and the rest of ambient,
 * downtempo and reggae: low to mid drive, mid weight, high tonality, mid
 * steadiness, soft hardness. Nearly black; what is seen is the sky it
 * reflects, the same as `docs/studies/ocean.md` builds to from real sea
 * photography and a good offline render. It is the second study on
 * height-kit and needs no change to it: the sea replaces the kit's terrain
 * (a valley and hills) with its own march over a surface of travelling wave
 * trains, and reads the ring's five bands as the height of two kinds of wave
 * rather than as a landscape.
 *
 * Its home sits at the quiet end deliberately, where the catalogue and the
 * open leads both say the library is thin. Emancipator's "Baralku" reads
 * 0.71 drive, 0.78 weight, 0.8 tonality, 0.72 steady, 0.1 hard and Christian
 * Löffler's "Mosaics" 0.3, 0.99, 0.79, 0.56, 0 (`director/tracks.fixture.ts`),
 * so the home sits at a drive of 0.4, a weight of 0.55, a tonality of 0.8, a
 * steadiness of 0.55 and a hardness of 0.08; the reach is 0.4, which reads
 * both of those at three quarters closeness or more and a hard track like
 * August Burns Red at under half of that. The catalogue gives it the intro
 * and the rest strongly, the groove at seven tenths, the outro strongly, and
 * nothing else.
 *
 * The surface is nine sine trains summed: three long ones, the swell, that
 * carry the height and lift with the low end, and six short ones, the chop,
 * that barely lift the water but tilt it and answer the mids and the
 * treble. Only the swell is marched; both decide the slope everywhere, which
 * is what the light reads. `ocean.params.ts` has the maths and
 * `shaders/ocean.wgsl` the drawing.
 *
 * Water reads by its light and not by its body. The sea itself is a deep hue
 * a third of a turn from the warm one that lights the horizon, the path and
 * the glints, both turning with `keyHue`; the deep colour never shows past
 * Fresnel's own share of it, which is why the water is black under the
 * camera and coloured toward the horizon. A path of light runs from the
 * light to the camera and breaks up into a shimmer with the chop, and glints
 * snap on only where a slope is inside a narrow band and the treble is up.
 *
 * The punch is never in the light: `intensity` rests past 1 for the bloom
 * and only ever gates to 0 with silence. What the music does instead is the
 * swell's height, the chop's height, the glint band's width, the path's
 * width and the travel speed, driven from `energy`, the packet's own
 * `swell` and the treble band, never from `tension`, `release` or `impact`
 * alone.
 *
 * Tension drains and stills the sea, as the catalogue asks: speed, swell and
 * chop each lose a flat share and a further share scaled by how loud the
 * passage is, so a quiet build barely slows the water and a loud one nearly
 * stops it, but never past zero. The scaled rows are sized to the worst real
 * combination of a loud, unpaced passage and full tension, not only to a
 * uniform level, since a quiet track can swell in energy with nothing
 * driving `pace`; `registry.test.ts`'s per-frame sweep and `ocean.test.ts`
 * both hold every knob at or above its floor there. The packet's own
 * `swell` row, a passage lifting, is what lets the water back in on a build
 * that resolves upward rather than into a drop this study never gets.
 *
 * It is sparse by construction: `oceanCoverage` (the shader's arithmetic in
 * TypeScript) holds the share of the frame over its lit threshold under a
 * third of the frame at the widest the mapping reaches, on eight canvas
 * shapes, and under that again at rest. `docs/studies/ocean.md` has the
 * measured shares on a real track through a headless adapter, since this
 * study was built without one reachable directly from the session that
 * wrote it.
 */
export const OCEAN: InkStudy = {
  id: 'ocean',
  kind: 'ink',
  name: 'Ocean',
  impl: 'ocean',
  home: { drive: 0.4, weight: 0.55, tonality: 0.8, steadiness: 0.55, hardness: 0.08 },
  reach: 0.4,
  moments: { intro: 1, groove: 0.7, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: {
    speed: 0.9,
    swell: 0.25,
    chop: 0.22,
    path: 0.3,
    glints: 0.06,
    intensity: 2.2,
    hue: 0,
    horizon: 0.07,
  },
  mapping: [
    { from: 'pace', to: 'speed', gain: 2, curve: 'linear' },
    { from: 'energy', to: 'speed', gain: 1.2, curve: 'sqrt' },
    { from: 'tension', to: 'speed', gain: -0.9, curve: 'linear' },
    {
      from: 'tension',
      to: 'speed',
      gain: -1,
      curve: 'linear',
      scale: { from: 'energy', curve: 'linear' },
    },
    { from: 'energy', to: 'swell', gain: 0.5, curve: 'sqrt' },
    { from: 'swell', to: 'swell', gain: 0.2, curve: 'linear' },
    { from: 'tension', to: 'swell', gain: -0.2, curve: 'linear' },
    {
      from: 'tension',
      to: 'swell',
      gain: -0.4,
      curve: 'linear',
      scale: { from: 'energy', curve: 'linear' },
    },
    { from: 'highMid', to: 'chop', gain: 0.3, curve: 'linear' },
    { from: 'treble', to: 'chop', gain: 0.2, curve: 'linear' },
    { from: 'energy', to: 'chop', gain: 0.15, curve: 'linear' },
    { from: 'tension', to: 'chop', gain: -0.08, curve: 'linear' },
    {
      from: 'tension',
      to: 'chop',
      gain: -0.15,
      curve: 'linear',
      scale: { from: 'energy', curve: 'linear' },
    },
    { from: 'energy', to: 'path', gain: 0.35, curve: 'linear' },
    {
      from: 'bassPulse',
      to: 'path',
      gain: 0.15,
      curve: 'linear',
      shape: { kind: 'envelope', attackMs: 15, releaseMs: 400 },
    },
    { from: 'tension', to: 'path', gain: -0.2, curve: 'linear' },
    { from: 'treble', to: 'glints', gain: 0.5, curve: 'linear' },
    {
      from: 'treblePulse',
      to: 'glints',
      gain: 0.4,
      curve: 'linear',
      shape: { kind: 'envelope', attackMs: 5, releaseMs: 150 },
    },
    { from: 'tension', to: 'glints', gain: -0.05, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -2.2, curve: 'invert' },
    { from: 'harmonicChange', to: 'hue', gain: 0.1, curve: 'linear' },
    { from: 'swell', to: 'hue', gain: 0.06, curve: 'linear' },
    { from: 'energy', to: 'horizon', gain: 0.06, curve: 'linear' },
    { from: 'bassPulse', to: 'horizon', gain: 0.02, curve: 'linear' },
  ],
  cost: 'medium',
}
