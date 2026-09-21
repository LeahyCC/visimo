import type { FlowStudy } from '../types'

/**
 * The same solver at the numbers the retired Wash cast had: thin viscosity, hard vorticity and a
 * wide slow orbit, which draws fine filaments instead of plumes. Tension
 * climbs the vorticity, so a build frays.
 */
export const TURBULENT_FLUID: FlowStudy = {
  id: 'turbulent-fluid',
  kind: 'flow',
  name: 'Turbulent fluid',
  impl: 'fluid',
  home: { drive: 0.7, weight: 0.35, tonality: 0.5, steadiness: 0.5, hardness: 0.6 },
  reach: 0.5,
  moments: { intro: 0, groove: 1, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: {
    velocityDecay: 0.1,
    vorticity: 26,
    viscosity: 0.06,
    spread: 0.5,
    force: 0.8,
    hitForce: 0.25,
    radius: 0.02,
    orbitSpeed: 0.1,
    emitters: 3,
    voice: 0.7,
    events: 12,
    eventLife: 1.2,
    eventForce: 0.3,
    eventRadius: 0.014,
  },
  mapping: [
    { from: 'lowEnd', to: 'vorticity', gain: 24, curve: 'linear' },
    { from: 'lowEnd', to: 'viscosity', gain: -0.04, curve: 'linear' },
    { from: 'energy', to: 'velocityDecay', gain: 0.14, curve: 'linear' },
    { from: 'energy', to: 'spread', gain: 0.16, curve: 'linear' },
    { from: 'treble', to: 'hitForce', gain: 1.4, curve: 'linear' },
    { from: 'treble', to: 'radius', gain: -0.01, curve: 'linear' },
    { from: 'tension', to: 'vorticity', gain: 12, curve: 'linear' },
  ],
  cost: 'medium',
}
