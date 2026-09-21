import type { FlowStudy } from '../types'

/**
 * Today's solver at Plume's numbers: low vorticity, slow emitters, a smoky
 * drift. Tension slows it further and pulls the emitters in, so a build
 * gathers rather than spreads.
 */
export const LAZY_FLUID: FlowStudy = {
  id: 'lazy-fluid',
  kind: 'flow',
  name: 'Lazy fluid',
  impl: 'fluid',
  home: { drive: 0.2, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.15 },
  reach: 0.55,
  moments: { intro: 1, groove: 1, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: {
    velocityDecay: 0.18,
    vorticity: 12,
    viscosity: 0.2,
    spread: 0.42,
    force: 0.45,
    hitForce: 0.3,
    radius: 0.012,
    orbitSpeed: 0.19,
    emitters: 5,
    voice: 0.85,
    events: 24,
    eventLife: 0.8,
    eventForce: 0.5,
    eventRadius: 0.011,
  },
  mapping: [
    { from: 'pace', to: 'vorticity', gain: 14, curve: 'linear' },
    { from: 'treble', to: 'vorticity', gain: 38, curve: 'linear' },
    { from: 'treble', to: 'viscosity', gain: -0.18, curve: 'linear' },
    { from: 'pace', to: 'orbitSpeed', gain: 0.25, curve: 'linear' },
    { from: 'energy', to: 'velocityDecay', gain: 0.15, curve: 'linear' },
    { from: 'energy', to: 'spread', gain: 0.38, curve: 'linear' },
    { from: 'swell', to: 'spread', gain: 0.2, curve: 'linear' },
    { from: 'energy', to: 'force', gain: 0.6, curve: 'linear' },
    { from: 'novelty', to: 'force', gain: 0.6, curve: 'linear' },
    { from: 'lowEnd', to: 'hitForce', gain: 1.1, curve: 'linear' },
    { from: 'lowEnd', to: 'radius', gain: 0.016, curve: 'linear' },
    { from: 'weight', to: 'radius', gain: 0.006, curve: 'linear' },
    { from: 'tension', to: 'orbitSpeed', gain: -0.08, curve: 'linear' },
    { from: 'tension', to: 'spread', gain: -0.1, curve: 'linear' },
  ],
  cost: 'medium',
}
