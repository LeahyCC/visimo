import type { InkStudy } from '../types'

/**
 * The neon grid floor to the horizon, for the groove and the build of a
 * steady, mid drive, bright, mid hard track: synthwave, house, electro. Lines
 * only, drawn analytically from the ground coordinate each pixel looks at, on
 * a floor the music writes: height-kit lays the five bands across the width,
 * bass in the middle and treble at the edges, mirrored so the middle is a
 * valley you fly down, and the rows scroll toward you. The floor ripples with
 * the bass, the hills at the sides rise with the mids and highs, and each line
 * is brighter where the ground under it is tall and where it faces you, so the
 * music is light running over the terrain. `docs/studies/grid-3d.md` says what
 * the references it was built to are and what makes them striking.
 *
 * Its home is the measured middle of the music it is for. FISHER's house reads
 * 0.64 on drive at 0.92 steady and 0.49 hard, and John Summit's tech house
 * 0.53 at 0.68 and 0.56, so the home sits at a drive of 0.55, a steadiness of
 * 0.8 and a hardness of 0.5. Bright is a low weight, 0.32 to 0.45 on those two,
 * and tonality falls between them at 0.5. The reach is 0.35: a house or an
 * electro track is at home with it, a lo-fi or an orchestral one is not. The
 * catalogue gives it the groove strongly, the build at nine tenths, the drop
 * at half and the intro at 0.4, and nothing else.
 *
 * Speed is pace and the beat, in world units a second with a cell one unit
 * and the camera one unit high. It rests at 1.2 and `pace` adds up to 3, so a
 * groove at half pace flies at about 2.7 cells a second. The beat surges it
 * through a `spring` on `beatPulse`: the pulse jumps on the hit and the
 * spring overshoots it by a sixth and rings back inside a beat, so the floor
 * lunges and settles and the average speed is where `pace` put it. The surge
 * is a single unit, well under half the speed, or the floor would judder. It
 * is this slow because the canvas carries: see the last paragraph.
 *
 * Tension rushes the grid toward you and narrows the valley, as the catalogue
 * says. It adds 5 to the speed, so a full build flies at nearly three times a
 * groove's, and takes 0.3 off the valley's edge, so the hills close in from
 * both sides and the road is a corridor. On the drop `impact` sends a bright
 * band racing in from the horizon along the lines, which is the one event the
 * study draws: the build is a closing in and the drop is a light arriving. The
 * valley opens again through `swell`, a passage lifting.
 *
 * The punch is not in the light. The registry forbids raising `intensity` with
 * the level, and the intensity here only ever gates down, on `energy`: it
 * rests at 1.6, past 1 on purpose so the bloom catches the cores, and reads
 * that at a full packet and nothing at a silent one, which is what makes it
 * black in silence. What the music does instead is the height (the level and a
 * kick's crest), the width of a line (the level and the beat), the glow (a
 * kick blooms it, a hard track tightens it) and the speed. Lines thin with
 * distance and are fogged to exactly nothing at 46 units. The lines that cross
 * the view are also drawn fainter as they pack together, from about 3.5 units
 * out, and are gone by about 17 at 1080, since a pixel there spans more than
 * a line and drawing them would only alias; the lines that run into the
 * distance carry on to the fog. Past that the floor is dark and a hairline
 * horizon with a glow, and the near floor is a few lines.
 *
 * The colour is its own and not the shared palette's: two hues a third of a
 * turn apart, magenta near and cyan at the horizon at a key of 0, both of them
 * turned by `keyHue` (`harmonicChange` and `swell` nudge them further), with
 * a white-hot spine down each line and a saturated glow round it. A study that
 * drew one palette colour at a time would be a line drawing of a grid.
 *
 * It is sparse by construction and safe for flashes. On flat ground, the
 * worst case for how close the lines lie, `gridCoverage` lights about 8 to 11
 * percent of a 16:9 frame at the resting width and at most 17 percent at the
 * widest its mapping reaches (a full packet, a kick landing, a soft track);
 * `grid3d.test.ts` holds it under a fifth on a 16:9, a square and a tall
 * canvas. The grid moves continuously and no large area of luminance toggles.
 * The one thing that changes brightness fast is the pulse, a band about three
 * percent of the frame tall that crosses in 1.1 s, and impacts cannot come
 * closer than 0.8 s, so it is at most two thin bands a second and never a
 * flash of the frame.
 *
 * What the canvas does to it is the thing to know. The director's canvas keeps
 * about two thirds of a second of what was drawn, and a line that moves leaves
 * a trail as long as its speed times that. The gap between two crossing lines
 * shrinks with distance in step with their speed, so the trail is the same
 * number of gaps at every depth, and at 2.7 cells a second that is more than
 * one: the lines smear into each other and the floor between them fills with a
 * violet wash instead of black. More light does not cure it (three times the
 * intensity was captured, brighter and no crisper) and by the arithmetic
 * thinner lines would not either. Fresh, the frame is black
 * between crisp lines; that is what the ink draws. What the picture shows is
 * that with the canvas's memory added, which is why the speed is low, the
 * lines that stand still on screen (the ones into the distance) are drawn at
 * a twelfth of their light, and the horizon's glow is a few hundredths of a
 * line's, since anything that does not move is summed to about forty times
 * what is drawn. A pinned cast with a short canvas, or none, would show the
 * fresh frame, and that is the cast to make for Outrun.
 */
export const GRID_3D: InkStudy = {
  id: 'grid-3d',
  kind: 'ink',
  name: '3D grid',
  impl: 'grid',
  home: { drive: 0.55, weight: 0.35, tonality: 0.5, steadiness: 0.8, hardness: 0.5 },
  reach: 0.35,
  moments: { intro: 0.4, groove: 1, build: 0.9, drop: 0.5, rest: 0, outro: 0 },
  knobs: {
    speed: 1.2,
    height: 0.55,
    valley: 0.5,
    width: 0.8,
    glow: 3.2,
    intensity: 1.6,
    pulse: 0,
    hue: 0,
  },
  mapping: [
    { from: 'pace', to: 'speed', gain: 3, curve: 'linear' },
    { from: 'tension', to: 'speed', gain: 5, curve: 'linear' },
    {
      from: 'beatPulse',
      to: 'speed',
      gain: 1,
      curve: 'linear',
      shape: { kind: 'spring', frequency: 5, damping: 0.5 },
    },
    { from: 'energy', to: 'height', gain: 0.35, curve: 'sqrt' },
    { from: 'bassPulse', to: 'height', gain: 0.1, curve: 'linear' },
    { from: 'tension', to: 'valley', gain: -0.3, curve: 'linear' },
    { from: 'swell', to: 'valley', gain: 0.12, curve: 'linear' },
    { from: 'energy', to: 'width', gain: 0.4, curve: 'linear' },
    { from: 'beatPulse', to: 'width', gain: 0.5, curve: 'linear' },
    { from: 'hardness', to: 'glow', gain: -1.4, curve: 'linear' },
    { from: 'bassPulse', to: 'glow', gain: 2.5, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -1.6, curve: 'invert' },
    { from: 'impact', to: 'pulse', gain: 1, curve: 'linear' },
    { from: 'harmonicChange', to: 'hue', gain: 0.12, curve: 'linear' },
    { from: 'swell', to: 'hue', gain: 0.08, curve: 'linear' },
  ],
  cost: 'cheap',
}
