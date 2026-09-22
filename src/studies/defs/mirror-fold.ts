import type { FlowStudy } from '../types'

/**
 * The kaleidoscope, done to the picture itself rather than to any one ink:
 * the canvas is folded into mirrored sectors, so whatever is drawing is
 * repeated round the frame with reflected seams between the wedges, and a
 * slow turn walks the whole pattern round. It is the MilkDrop mirror, and the
 * catalogue's answer to `fractal-glints` taking the whole of the crowded
 * middle on its own.
 *
 * It is a flow, and the fold is not part of the velocity field. The feedback
 * pass reads the history back along the flow and then zooms and turns it, and
 * the fold is one more step on that same lookup, so this study is two things
 * at once: an analytic field with a swirl and a little zoom in it, and a
 * patch on the canvas that folds the lookup. See `StudyCanvas` in types.ts
 * for why only a flow may carry the second of them.
 *
 * The field is the analytic flow's terms as they already are, and no term was
 * added for this:
 *
 * - `swirl`, a turn about the centre at every radius, which is what walks the
 *   pattern round without shearing it. It rests at 0.01 turns a second, a
 *   full turn in a hundred seconds, which at six sectors puts a seam past any
 *   given point about every seventeen seconds. That is the number the look
 *   lives or dies on: fast enough and a kaleidoscope is a pinwheel, so the
 *   whole of what the music adds to it comes to 0.04 turns a second at the
 *   very loudest point of a full build, a turn in twenty-five seconds and a
 *   seam every four. A chord change gives it a nudge, which is what makes the
 *   turn read as the song's and not a clock's.
 * - `radial` at a `falloff` of 0, a plain zoom about the middle, so light
 *   streams outward along the wedges and off the rim. It rests at 0.02 field
 *   widths a second, half of the tunnel's, because here the zoom is the thing
 *   that feeds the fold rather than the thing being looked at: a mark drawn
 *   near the middle is copied into every sector and then drawn out along it,
 *   which is what makes a kaleidoscope's spokes. Outward and not inward for
 *   the reason the tunnel gives, and because inward would pile every sector's
 *   light into the one place they all meet.
 *
 * The canvas patch is the fold:
 *
 * - `feedback.fold` rests at 6. Six sectors is the count a real kaleidoscope
 *   is built at, it leaves each wedge sixty degrees wide, which is room for a
 *   whole mark, and the seams are far enough apart to be read as seams.
 *   Tension adds 2 and impact adds 4, so a build steps it to 8 and a drop to
 *   10, and a drop out of a full build reaches 12. The count is snapped to a
 *   whole even number by the pass, so those are steps and not a slide; past
 *   about twelve the wedges are narrower than the marks in them and the frame
 *   turns into a doily, which is why nothing here adds more.
 * - `feedback.foldMix` is how far the fold is applied, and it comes up with
 *   the level: 0.12 at rest, so a quiet passage is barely creased, and 0.95
 *   at a loud one, so a groove is fully symmetric. The pass turns each point
 *   toward its mirror rather than cutting to it, so the fold arrives with the
 *   music and leaves with it, and the whole patch is lerped again by this
 *   study's presence, so it also arrives with the study.
 *
 * It has to show up on real music, so the level and the beat drive it as well
 * as tension: `energy` and `swell` bring the fold in and speed the turn,
 * `beatPulse` gives the mix a lift on every hit, and `impact` and `tension`
 * are the two that step the count. A track that never winds up is still
 * folded; `release`, `impact` and `tension` alone would have drawn a plain
 * swirl for whole songs.
 *
 * **A fold step changes no light.** The pass folds the history's lookup and
 * nothing else: the decay, the floor, the fade, the hold and the ceiling are
 * all untouched, and the frame the inks just drew is added over the top at
 * its own weight, unfolded. So a count stepping on a hit moves where light is
 * read from and never how much of it there is, which is why a study that
 * steps on every impact is inside the flash rule. `mirrorFold.test.ts` holds
 * that on the stack's own reference of the pass.
 *
 * **It does not double `fractal-glints`.** The glints draw their own folded
 * fractal, and the two are not excluded from each other, because what this
 * study folds is the history: a glint lands fresh and unfolded where the ink
 * drew it, and only its trail is mirrored round the frame. The two symmetries
 * sit in different places rather than on top of one another.
 *
 * Home is the plain middle of every axis with a reach of 0.4, which is the
 * crowded cell the coverage map says `fractal-glints` has to itself. Tonality
 * sits at the middle because the catalogue gives it none: a kaleidoscope does
 * not care whether there is a key. The reach is narrower than any other
 * flow's, so it is the sharp study at the centre rather than another wide
 * one: against `director/tracks.fixture.ts` it reads 0.95 for Mac Miller,
 * 0.90 for Noisia, 0.83 for Whitechapel and 0.82 for the Four Tet remix, and
 * falls to 0.44 for the Daft Punk cue and 0.46 for Christian Loffler, which
 * are the two ends of the space. It wins a groove outright for Mac Miller and
 * Whitechapel and on the rotation for Noisia and Skepta; it does not beat the
 * tunnel or the beat pump on the two house tracks, which are steadier than
 * the middle and are those two studies' own ground.
 *
 * The moments are the catalogue's, the groove and the drop, with half a build
 * because a fold tightening is a good thing to watch a riser through. Hardness
 * sat at 0.45 first, which put it inside the margin of the lo-fi song's drop
 * and took the turbulent fluid's seat there; the middle is where it belongs
 * anyway and `Renderer.test.ts` is what caught it.
 */
export const MIRROR_FOLD: FlowStudy = {
  id: 'mirror-fold',
  kind: 'flow',
  name: 'Mirror fold',
  impl: 'analytic',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 0.4,
  moments: { intro: 0, groove: 1, build: 0.5, drop: 0.8, rest: 0, outro: 0 },
  knobs: {
    radial: 0.02,
    falloff: 0,
    swirl: 0.01,
    twist: 0,
    curl: 0,
    curlScale: 3.5,
    curlRate: 0.05,
  },
  mapping: [
    { from: 'energy', to: 'swirl', gain: 0.006, curve: 'sqrt' },
    { from: 'swell', to: 'swirl', gain: 0.004, curve: 'linear' },
    { from: 'harmonicChange', to: 'swirl', gain: 0.008, curve: 'linear' },
    { from: 'tension', to: 'swirl', gain: 0.012, curve: 'linear' },
    { from: 'energy', to: 'radial', gain: 0.02, curve: 'linear' },
    { from: 'tension', to: 'radial', gain: 0.03, curve: 'linear' },
  ],
  cost: 'cheap',
  canvas: {
    knobs: { 'feedback.fold': 6, 'feedback.foldMix': 0.12 },
    mapping: [
      { from: 'energy', to: 'feedback.foldMix', gain: 0.53, curve: 'sqrt' },
      { from: 'swell', to: 'feedback.foldMix', gain: 0.2, curve: 'linear' },
      { from: 'beatPulse', to: 'feedback.foldMix', gain: 0.1, curve: 'linear' },
      { from: 'tension', to: 'feedback.fold', gain: 2, curve: 'linear' },
      { from: 'impact', to: 'feedback.fold', gain: 4, curve: 'linear' },
    ],
  },
}
