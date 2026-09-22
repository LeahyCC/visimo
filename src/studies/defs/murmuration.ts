import type { InkStudy } from '../types'

/**
 * Thousands of birds moving as one body, for the groove, the build and the
 * drop of a fast, driving track: the DnB, IDM and orchestral end. Where the
 * sparks are small gestures thrown off a hit, this is one animal, and what it
 * does with the music is fold.
 *
 * It is a particle field (`impls/ParticleField.ts`, `MURMURATION_PROFILE` in
 * `impls/particles.params.ts`) and the first one to switch the boids grid on.
 * That took three additions to the field, each off for the dust and the
 * sparks: a bird that is turning is brighter and is carried toward a second
 * hue, so a fold ripples across the body as light and colour; births land on a
 * bird that is already alive, so the flock replenishes where it is instead of
 * having dust converge on it; and the colour is three saturated hues of its
 * own. What it looks like comes from four things working against one another.
 *
 * - **The gather holds it together.** Local cohesion cannot: a bird past the
 *   neighbourhood of every other feels nothing, and a flock held by cohesion
 *   alone is a diffuse flow across the frame (tried). The gather is a pull on
 *   every bird toward the attractor that grows with distance, so the body is a
 *   cloud with a dense core and a thin edge and no wall, and the attractor
 *   moving is what carries the whole flock across the frame.
 * - **Separation stops it collapsing.** With nothing to push back the gather
 *   draws every bird to one point. The rule is a sum over neighbours and not an
 *   average, so a crowd pushes harder than a pair. A kick raises it and the
 *   body opens, the gather and cohesion close it again, and the drop raises it
 *   further. The reach is 0.02 of the short side because the grid keeps eight
 *   birds a cell, and a reach wider than the flock's spacing puts a hundred
 *   birds in a cell and steers the flock by the eight the grid remembers.
 * - **A curl stirs it from inside.** Without it the flock relaxes to a small
 *   round pile between hits. A broad curl (about two eddies across the frame)
 *   stretches the body into a sheet and bends it, which is what a murmuration
 *   does, and the fold is where the light and the colour gather.
 * - **It cruises.** A gravity that turns slowly, a full turn in about 16
 *   seconds of loud music, is the bird's heading, so the body sweeps a loop
 *   round the attractor rather than sitting on it. The attractor itself steps
 *   on the bar, to a place chosen from the mid bands at the downbeat.
 *
 * The count is the level and the hits are the gesture, and neither waits for
 * `tension`, `release` or `impact`, which real tracks rarely push high: the
 * flock's size, its light, its stroke length and its heading speed all read
 * `energy`, `pace` and the band pulses. The bass pulse and the impact both
 * open the body, through envelopes 6 ms up and 300 and 500 down, the shape of
 * a kick and of a drop's tail. `tension` does what the catalogue asks: it
 * raises cohesion by 2 and the gather by 0.6 and takes 0.15 off separation, so
 * a build balls the flock up, and the drop's impact throws it open again.
 *
 * It is dark in silence and does not brighten with loudness. The size of a
 * bird is the gate: it is 0 at a silent packet, so nothing is dispatched.
 * The count and the rate follow `energy` through a square root, so the flock
 * comes in a few birds at a time. The light rests at 0.5 and takes squares off
 * for energy, swell and hardness, to 0.32 at a full packet. What loudness adds
 * is birds, stroke and separation.
 *
 * Its size is the second reason it stays sparse. A bird is a 2.2 px point at
 * the most, and the flock is at most 7,000 of them, so at the most its own
 * mapping reaches it covers 1.6 percent of a 16:9 1080p frame, 3.2 percent of
 * a square one and 4.2 percent at 320 by 320, where the canvas ceiling holds
 * the count down (`particleCoverage`, an upper bound). The canvas keeps 0.975
 * of itself a frame, so a flock moving at 0.1 to 0.2 short sides a second
 * leaves a wake of a second or two: thin streaks and a modest count are what
 * keep that a motion blur behind the body and not a fog. The picture is a
 * body, a wake and black, and about nine tenths of the frame is under 0.02.
 *
 * Flash safe by construction: a bird is a point a couple of pixels wide, the
 * whole flock is a few percent of the frame, the fold's separation is a
 * movement of light across the frame and not a change of its total, and a kick
 * cannot come faster than the extractor's own refractory.
 *
 * Its home is the middle of the space leaning fast: mid to high drive, mid
 * steadiness and hardness, so DnB, IDM and orchestral builds reach it and
 * neither the hardest corner, where the shards and the lightning live, nor the
 * softest, where the dust is, does. A reach of 0.35 is narrow enough that it is
 * cast for those and not for everything.
 */
export const MURMURATION: InkStudy = {
  id: 'murmuration',
  kind: 'ink',
  name: 'Murmuration',
  impl: 'murmuration',
  home: { drive: 0.6, weight: 0.4, tonality: 0.5, steadiness: 0.55, hardness: 0.4 },
  reach: 0.35,
  moments: { intro: 0, groove: 1, build: 0.9, drop: 0.8, rest: 0, outro: 0 },
  knobs: {
    count: 0,
    rate: 0,
    life: 30,
    speed: 0.02,
    size: 0,
    streak: 0.03,
    intensity: 0.5,
    hueSpread: 0.36,
    turnLight: 2.5,
    drag: 1,
    gravity: 0.08,
    gravityAngle: 0,
    curl: 0.16,
    curlScale: 2.2,
    gather: 0.45,
    attractX: 0.3,
    attractY: 0.3,
    separation: 0.3,
    alignment: 3,
    cohesion: 0.8,
    neighbourhood: 0.02,
  },
  mapping: [
    // The flock: how many birds, how fast they are made, and how big one is.
    // The rate is the count over eight seconds, so a slot is overwritten well
    // before the youngest bird's life is out.
    { from: 'energy', to: 'count', gain: 7000, curve: 'sqrt' },
    { from: 'energy', to: 'rate', gain: 880, curve: 'sqrt' },
    { from: 'energy', to: 'size', gain: 2.2, curve: 'sqrt' },
    // The light only ever dims as the music fills.
    { from: 'energy', to: 'intensity', gain: -0.08, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.05, curve: 'square' },
    // The stroke lengthens with the level and with each hat.
    { from: 'energy', to: 'streak', gain: 0.04, curve: 'linear' },
    {
      from: 'treblePulse',
      to: 'streak',
      gain: 0.03,
      curve: 'linear',
      shape: { kind: 'envelope', attackMs: 5, releaseMs: 200 },
    },
    // A kick folds the body open and the drop folds it wider; it closes again.
    {
      from: 'bassPulse',
      to: 'separation',
      gain: 0.4,
      curve: 'linear',
      shape: { kind: 'envelope', attackMs: 6, releaseMs: 300 },
    },
    {
      from: 'impact',
      to: 'separation',
      gain: 0.6,
      curve: 'linear',
      shape: { kind: 'envelope', attackMs: 6, releaseMs: 500 },
    },
    // A build balls the flock up: tighter, drawn in harder and pushing less.
    { from: 'tension', to: 'separation', gain: -0.15, curve: 'linear' },
    { from: 'tension', to: 'cohesion', gain: 2, curve: 'linear' },
    { from: 'tension', to: 'gather', gain: 0.6, curve: 'linear' },
    // A busier track keeps its birds better in step and flies harder.
    { from: 'pace', to: 'alignment', gain: 2, curve: 'linear' },
    { from: 'pace', to: 'gravity', gain: 0.08, curve: 'linear' },
    { from: 'pace', to: 'curl', gain: 0.04, curve: 'linear' },
    // Where the body is drawn to: a step on each bar to a place read from the
    // mid bands at the downbeat, and a lean with the lift and the weight of the
    // passage in between, so it moves before the tracker has found a bar.
    {
      from: 'lowMid',
      to: 'attractX',
      gain: 0.2,
      curve: 'linear',
      shape: { kind: 'hold', per: 'bar' },
    },
    {
      from: 'highMid',
      to: 'attractY',
      gain: 0.2,
      curve: 'linear',
      shape: { kind: 'hold', per: 'bar' },
    },
    { from: 'swell', to: 'attractX', gain: 0.1, curve: 'linear' },
    { from: 'weight', to: 'attractY', gain: 0.1, curve: 'linear' },
    // The heading: a full turn in about 16 seconds of loud music, none in
    // silence, folded back into a turn so nothing is seen at the fold.
    {
      from: 'presence',
      to: 'gravityAngle',
      gain: Math.PI * 2,
      curve: 'linear',
      scale: { from: 'energy', curve: 'sqrt' },
      shape: { kind: 'integrate', rate: 0.06, wrap: 1 },
    },
  ],
  cost: 'medium',
}
