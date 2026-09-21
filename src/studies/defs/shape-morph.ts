import type { InkStudy } from '../types'

/**
 * One solid in the middle of the frame that turns and melts from form to form,
 * for the groove, the build and the drop of a steady, mid to high drive track
 * with some hardness in it: electro, prog, IDM, and most dance music that is
 * built rather than played. It is the catalogue's `shape-morph`, built on the
 * raymarch kit, and it is the first study in the library that is an object
 * rather than a field, a pattern or a spray of particles.
 *
 * **A section is a form.** The packet's `section` id is hashed into one of six
 * primitives, so the same track gives the same run of solids every time it is
 * played and a section boundary always changes what is on screen. The change
 * is a melt over a couple of seconds, made by mixing the two distance fields
 * and welding them together in the middle of it, so one solid grows out of
 * another. The one exception is `impact`: a drop cuts to the next form on the
 * frame, because the handoff says the drop is the one thing that must not be
 * smoothed away. `impls/morph.params.ts` owns all of that; a study cannot,
 * since a study is numbers and the run of forms is a state machine.
 *
 * **What the music does to it**, which is the whole of the mapping:
 *
 * - The bass breathes it. `size` takes the bass through a `spring` at 3.2 Hz
 *   damped at 0.55, so a kick swells the solid, it passes its target by 13
 *   percent and settles inside a beat at any tempo. A follower would only
 *   swell and sag; the overshoot is what reads as a body with weight in it.
 * - The mids ripple its surface. `ripple` takes `highMid` through an
 *   `envelope`, 40 ms up and 420 down, so a snare or a chord stab crawls over
 *   the skin and tapers. The amplitude is held against the frequency in the
 *   params, because a displacement steeper than the march can bound tears
 *   holes in the surface, and `pace` only moves the frequency a little for
 *   the same reason: a finer ripple has to be a shallower one.
 * - The energy turns it. `spin` is an `integrate` at 0.22 turns a second of
 *   energy, so a loud passage turns it once in five seconds and silence holds
 *   it where it is; `tumble` is a slower one on `swell`, so the axis drifts
 *   over a phrase and no two bars show the same face. Both wrap at a turn,
 *   which is where a rotation wraps. The rate is what makes the trail a trail:
 *   at a tenth of it the canvas gets the same silhouette every frame and sums
 *   it into a flat disc, and it was measured against exactly that.
 * - Tension shrinks it and spins it up, which is the catalogue's own entry:
 *   0.18 off the size, which is more than a third of it, and another 0.25
 *   turns a second on the spin. A build is a smaller, faster solid.
 * - `impact` throws the rim light wide (0.3 on top of 0.35) on the frame the
 *   drop lands, and the form cuts under it.
 *
 * **It does not brighten when the music gets loud**, which is the registry's
 * rule, and it does not dim then either, which is the point of it. The punch
 * goes into the size, the ripple, the spin and the width of the rim. The one
 * row on the light is a gate rather than a level: `energy` through `invert` at
 * -0.02 leaves the intensity at rest when the music is there and takes nearly
 * half of it away when there is nothing, which is the same shape the lasers
 * gate themselves with. Under `SILENT_FLOOR` the ink encodes no pass at all.
 *
 * **The light rests at 0.05, which is low on purpose.** A solid sits still in
 * the middle of a canvas that keeps 0.975 of itself a frame, so a pixel it
 * lights every frame settles at about forty times what one frame adds: at the
 * intensity this was first written with, the whole silhouette pinned at the
 * canvas's ceiling inside a second and the study drew a white blob with a
 * halo, which is Melt's fault in miniature. At 0.05 the lit half settles near
 * a third of the ceiling, the terminator survives as a gradient, and the
 * specular still passes it, so the highlight is what blooms.
 *
 * **The threshold is what keeps the rest.** `glint` rests at 0.4 and rises
 * with `energy` and `release` to 0.8 at a full packet, the same two rows and
 * the same reasoning the fractal carries. At rest it cuts under the lit faces
 * and takes the near-black fill; at a drop it cuts through them and leaves the
 * rim, the specular and the brightest facets, so the loudest moment is the one
 * with the most black in it. What is left on the canvas is a sculpted trail of
 * lit edges behind a turning solid.
 *
 * **It is sparse by construction.** Every form is written to one bounding
 * radius and the camera does not move, so the solid covers 3.4 percent of a
 * 16:9 frame over a groove and 5.2 percent at the largest the mapping can make
 * it (`morphCoverage`), before the threshold takes its dim half away.
 *
 * **Its home** is the middle of the dance floor: a drive of 0.58, steady at
 * 0.7, hard at 0.6, with no opinion about tonality, and a reach of 0.35. Of
 * the twenty measured tracks that puts it nearest John Summit's tech house
 * (0.84), Pendulum (0.83) and Subtronics (0.83), and well away from the folk,
 * the orchestral cue and the ambient pieces. It excludes `fractal-glints`: two
 * heavy raymarched inks in one cast is two marches a frame and a budget spent
 * twice over, and both of them want to be the thing being looked at.
 */
export const SHAPE_MORPH: InkStudy = {
  id: 'shape-morph',
  kind: 'ink',
  name: 'Shape morph',
  impl: 'morph',
  home: { drive: 0.58, weight: 0.35, tonality: 0.5, steadiness: 0.7, hardness: 0.6 },
  reach: 0.35,
  moments: { intro: 0, groove: 1, build: 0.8, drop: 0.8, rest: 0, outro: 0 },
  knobs: {
    size: 0.5,
    ripple: 0.012,
    rippleScale: 9,
    spin: 0,
    tumble: 0,
    rim: 0.35,
    specular: 1.4,
    hue: 0,
    intensity: 0.05,
    glint: 0.4,
    glintKnee: 0.45,
  },
  mapping: [
    {
      from: 'bass',
      to: 'size',
      gain: 0.18,
      curve: 'linear',
      shape: { kind: 'spring', frequency: 3.2, damping: 0.55 },
    },
    { from: 'tension', to: 'size', gain: -0.18, curve: 'linear' },
    {
      from: 'highMid',
      to: 'ripple',
      gain: 0.035,
      curve: 'linear',
      shape: { kind: 'envelope', attackMs: 40, releaseMs: 420 },
    },
    { from: 'pace', to: 'rippleScale', gain: 2, curve: 'linear' },
    {
      from: 'energy',
      to: 'spin',
      gain: 1,
      curve: 'linear',
      shape: { kind: 'integrate', rate: 0.22, wrap: 1 },
    },
    {
      from: 'tension',
      to: 'spin',
      gain: 1,
      curve: 'linear',
      shape: { kind: 'integrate', rate: 0.25, wrap: 1 },
    },
    {
      from: 'swell',
      to: 'tumble',
      gain: 1,
      curve: 'linear',
      shape: { kind: 'integrate', rate: 0.08, wrap: 1 },
    },
    { from: 'energy', to: 'rim', gain: 0.25, curve: 'sqrt' },
    { from: 'impact', to: 'rim', gain: 0.3, curve: 'linear' },
    { from: 'hardness', to: 'specular', gain: 0.6, curve: 'linear' },
    { from: 'keyHue', to: 'hue', gain: 1, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.02, curve: 'invert' },
    { from: 'swell', to: 'intensity', gain: -0.0035, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.005, curve: 'square' },
    { from: 'energy', to: 'glint', gain: 0.25, curve: 'linear' },
    { from: 'release', to: 'glint', gain: 0.15, curve: 'linear' },
    { from: 'hardness', to: 'glintKnee', gain: 0.12, curve: 'invert' },
  ],
  cost: 'heavy',
  excludes: ['fractal-glints'],
}
