import type { InkStudy } from '../types'

/**
 * Prism's raymarched ridges, bright parts only. The fractal is a full-frame
 * image and a full-frame ink fills a canvas that carries to its ceiling
 * inside a second, which is why Melt washed out on a drop. `glint` is the
 * threshold that makes it a glint: the ink drops its own dim body and adds
 * only what reaches a share of the brightest the frame can be this instant,
 * worked out in `scenes/kaleidoscope.params.ts`.
 *
 * It rests at 0.3 and rises with the two things that fill the frame. `energy`
 * is the plain one: every band loud drives every fold and a lit pixel reaches
 * the full enamel, so loud is when the ink must give the most back.
 * `release` is the drop itself, which is louder still and lands on a canvas
 * whose trails have just been let out again. Together they reach 0.85 at a
 * full packet, where the ink lights 22.8 percent of the worst frame there is
 * against 83.6 percent with the threshold off, measured on the adapter. They
 * stop short of 1, which would be an ink that draws nothing at all.
 *
 * Its resting `intensity` is 0.5 rather than Prism's 1, because 1 was tuned
 * for a canvas with no feedback and everything the director builds carries.
 * Prism's cast puts it back, the way Melt's cast already pulled it down.
 *
 * Tension sweeps the zoom in, which is the catalogue's own entry for it: a
 * build travels into the fold rather than changing what is drawn, and the
 * threshold is left alone through a build because a build is the quiet part
 * and the drive it is measured against has already fallen with the music.
 */
export const FRACTAL_GLINTS: InkStudy = {
  id: 'fractal-glints',
  kind: 'ink',
  name: 'Fractal glints',
  impl: 'fractal',
  home: { drive: 0.6, weight: 0.5, tonality: 0.8, steadiness: 0.5, hardness: 0.7 },
  reach: 0.5,
  moments: { intro: 0, groove: 1, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: {
    symmetry: 6,
    zoom: 0.85,
    zoomAmount: 0.8,
    zoomSpeed: 0.22,
    bandReaction: 1,
    depth: 0.55,
    rotationSpeed: 0.025,
    travelSpeed: 0.035,
    morphSpeed: 0.055,
    complexity: 7,
    warp: 0.35,
    thickness: 0.42,
    bassLift: 0,
    sparkle: 0.1,
    intensity: 0.5,
    saturation: 1.1,
    colourShift: 0,
    colourDrift: 0.009,
    glint: 0.3,
    glintKnee: 0.35,
  },
  mapping: [
    { from: 'keyHue', to: 'colourShift', gain: 1, curve: 'linear' },
    { from: 'pace', to: 'travelSpeed', gain: 0.035, curve: 'linear' },
    { from: 'swell', to: 'depth', gain: 0.15, curve: 'linear' },
    { from: 'harmonicChange', to: 'warp', gain: 0.2, curve: 'linear' },
    { from: 'energy', to: 'rotationSpeed', gain: 0.02, curve: 'linear' },
    { from: 'weight', to: 'thickness', gain: 0.08, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.08, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.03, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.04, curve: 'square' },
    { from: 'energy', to: 'saturation', gain: -0.08, curve: 'square' },
    { from: 'swell', to: 'saturation', gain: -0.06, curve: 'square' },
    { from: 'hardness', to: 'saturation', gain: -0.08, curve: 'square' },
    { from: 'tension', to: 'zoom', gain: -0.2, curve: 'linear' },
    { from: 'energy', to: 'glint', gain: 0.3, curve: 'linear' },
    { from: 'release', to: 'glint', gain: 0.25, curve: 'linear' },
  ],
  cost: 'heavy',
  excludes: ['dye-plumes'],
}
