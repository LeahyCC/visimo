import type { CymaticsKnob } from '../impls'
import type { InkStudy, StudyField, StudyMapping } from '../types'

/**
 * One note's mode: its own row of the packet, through an envelope, into its
 * own knob. The attack is slow enough to be seen and the release slower, so a
 * chord change is one set of modes handing the plate to the next and the
 * figure is a shape in the middle of turning into another for a second and a
 * half, never a cut.
 */
const mode = (from: StudyField, to: CymaticsKnob): StudyMapping => ({
  from,
  to,
  gain: 1,
  curve: 'linear',
  shape: { kind: 'envelope', attackMs: 120, releaseMs: 1400 },
})

/**
 * A hit on the plate: a spring toward the hit's own level, so the strike lands
 * at once, overshoots and rings, and settles a moment later instead of
 * sliding back. Under-damped on purpose; the number is what a struck plate's
 * sand does, which is jump and then lie down.
 */
const struck = (from: StudyField, gain: number): StudyMapping => ({
  from,
  to: 'strike',
  gain,
  curve: 'linear',
  shape: { kind: 'spring', frequency: 2.5, damping: 0.35 },
})

/**
 * Sand on a vibrating plate, for the intro, the groove and the rest of any
 * tonal music that is soft to mid in how it hits. The pattern is set by the
 * notes actually playing, so you see the sound: each pitch class rings one
 * mode of a square plate, weighted by how strongly that note sounds, and the
 * ink draws the curves where the sum of them is still, which is where sand
 * gathers. One note is one figure and a chord is the figure of the three modes
 * added, so a chord change is the whole pattern reorganising at once, and
 * because every mode moves through an envelope it does so as a morph and not a
 * cut. The library had nothing for acoustic and organic music, and this is a
 * picture of what an instrument does, which suits it as well as it suits a
 * synth pad.
 *
 * Its home is tonal and not hard, with the middle of the other axes and a
 * reach of 0.4. Against the twenty tracks in `director/tracks.fixture.ts` that
 * is a closeness of 0.7 to 0.99 for the acoustic track, the folk rock one, the
 * pop one, the jam band and the ambient and IDM ones, and 0.36 to 0.45 for the
 * metal, the metalcore and the dubstep, which have no notes for it to draw. It shares a home with chord
 * petals and takes the same three moments (the intro and the rest at 0.8, the
 * groove in full) but it does not share a cast with it: both are a figure in
 * the middle of the frame made of the same twelve rows, and two of them on top
 * of each other is a picture of neither. `excludes` says so, and the director
 * gives the slot to whichever scores better for the track.
 *
 * What the moments do. `tension` sharpens: the line is drawn thinner and the
 * glow tighter as the build winds up, so the pattern resolves into hairlines
 * that are still the same figure, and it lays the second set of finer modes
 * down. The catalogue asks for exactly this. It does not touch the light,
 * which nothing loud raises either: the registry forbids it, and the loud is
 * put into how wide the line is, how far its glow reaches, how many modes are
 * ringing and how hard the plate has been struck.
 *
 * A hit re-strikes the plate. `strike` is on a spring under-damped enough to
 * ring, fed by the beat, the mid-low hits (a plucked string is a mid-low
 * onset, where a kick is not) and the level, and it makes the line fat and its
 * glow wide for a moment before it lies down again. A chord change is a strike
 * too, through `harmonicChange`: the sand is thrown off the old figure and laid
 * again in the new one, which is what the change looks like as the modes
 * hand over, and while they do the ink draws the line dimmer (`unsettled` in
 * `cymatics.params.ts`), so the ghost the morph leaves on the canvas is faint.
 * A drop strikes it hard through `impact`. None of these rests on
 * `tension`, `release` or `impact` alone, which real tracks rarely take high:
 * the notes and the level are what draw it.
 *
 * The bar this ink is built to is in `docs/studies/cymatics.md`, from
 * photographs of the real thing. A pattern of luminous thin lines on true black, white-hot at
 * the centre with the colour in the glow round them, and a bright point where
 * lines meet. It has a colour of its own and not the shared palette's: each
 * note has a saturated hue at its place on the circle of fifths turned by
 * `keyHue`, and the colour at a point of the plate is the notes' hues weighted
 * by how much of the sum each is there. The intensity rests at 1.2, above 1 on
 * purpose, so the core clears the bloom's threshold while the glow does not.
 *
 * It is sparse by construction, a line drawing and no fill. Measured on a grid
 * over every canvas shape (`cymaticsCoverage`, with tests that hold it), a
 * triad at rest lights about 1 percent of a 16:9 frame, a loud one under 5 and a
 * loud seven-note scale about 5, and the plate is a square, so a square canvas
 * is the worst frame there is and even there the loudest reads under 10. That is also the flash
 * statement for WCAG 2.3.1: the light is a set of thin lines in a bounded
 * square, no mode changes faster than its 120 ms attack and 1.4 s release allow,
 * and the spring rebounds once or twice at 2.5 Hz, moving a line's width, so
 * nothing toggles a large area of luminance on or off and there is no strobe in
 * the construction.
 *
 * A packet with no note in it lights no mode, and a plate with none ringing
 * draws nothing: no pass encoded and nothing uploaded. That is the silence gate,
 * and it is what drums alone and a passage with no key do as well, since the
 * note rows read nothing there. Presence 0 does the same.
 */
export const CYMATICS: InkStudy = {
  id: 'cymatics',
  kind: 'ink',
  name: 'Cymatics',
  impl: 'cymatics',
  home: { drive: 0.5, weight: 0.55, tonality: 0.8, steadiness: 0.5, hardness: 0.2 },
  reach: 0.4,
  moments: { intro: 0.8, groove: 1, build: 0, drop: 0, rest: 0.8, outro: 0 },
  excludes: ['chord-petals'],
  knobs: {
    mode0: 0,
    mode1: 0,
    mode2: 0,
    mode3: 0,
    mode4: 0,
    mode5: 0,
    mode6: 0,
    mode7: 0,
    mode8: 0,
    mode9: 0,
    mode10: 0,
    mode11: 0,
    layer: 0.1,
    sharp: 0.25,
    width: 1,
    glow: 2.5,
    strike: 0.45,
    intensity: 1.2,
  },
  mapping: [
    mode('chroma0', 'mode0'),
    mode('chroma1', 'mode1'),
    mode('chroma2', 'mode2'),
    mode('chroma3', 'mode3'),
    mode('chroma4', 'mode4'),
    mode('chroma5', 'mode5'),
    mode('chroma6', 'mode6'),
    mode('chroma7', 'mode7'),
    mode('chroma8', 'mode8'),
    mode('chroma9', 'mode9'),
    mode('chroma10', 'mode10'),
    mode('chroma11', 'mode11'),
    { from: 'energy', to: 'layer', gain: 0.75, curve: 'sqrt' },
    { from: 'tension', to: 'layer', gain: -0.1, curve: 'linear' },
    { from: 'tension', to: 'sharp', gain: 0.75, curve: 'linear' },
    { from: 'energy', to: 'width', gain: 0.6, curve: 'sqrt' },
    {
      from: 'bassPulse',
      to: 'glow',
      gain: 3,
      curve: 'linear',
      shape: { kind: 'envelope', attackMs: 5, releaseMs: 300 },
    },
    { from: 'energy', to: 'glow', gain: 2, curve: 'sqrt' },
    { from: 'harmonicChange', to: 'glow', gain: 2, curve: 'linear' },
    struck('beatPulse', 0.25),
    struck('lowMidPulse', 0.12),
    struck('harmonicChange', 0.16),
    struck('impact', 0.12),
    { from: 'energy', to: 'strike', gain: 0.15, curve: 'linear' },
    { from: 'tension', to: 'intensity', gain: -0.1, curve: 'linear' },
  ],
  cost: 'cheap',
}
