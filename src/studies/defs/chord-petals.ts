import type { PetalKnob } from '../impls'
import type { InkStudy, StudyField, StudyMapping } from '../types'

/** One note's petal: its own row of the packet, through an envelope, into its own knob. */
const petal = (from: StudyField, to: PetalKnob): StudyMapping => ({
  from,
  to,
  gain: 1,
  curve: 'linear',
  shape: { kind: 'envelope', attackMs: 40, releaseMs: 900 },
})

/**
 * A flower of twelve petals, one a note, for the intro, the groove and the
 * rest of tonal music that is soft to mid in how it hits: jazz, classical,
 * soul, pop. The notes sounding are the petals lit, so a chord is a cluster of
 * light and a chord change is one cluster easing out as the next comes up.
 * Its home is where the measured tracks with a clear key sit, high on
 * tonality and soft to middling on hardness: the ambient and downtempo tracks
 * read 0.8 on tonality at a hardness under 0.15, the acoustic and the pop one
 * 0.68 at 0.28. So the home is a tonality of 0.8, a hardness of 0.15, and the
 * middle of the other three axes, with a reach of 0.4 that welcomes any drive
 * and any steadiness and turns a metal track away. The catalogue gives it the
 * intro and the rest at 0.8, the groove in full, the build at 0.4 and nothing
 * for the drop or the outro.
 *
 * The twelve petals stand in circle-of-fifths order, so notes that sound well
 * together sit side by side. Each note's petal is fed from its own row of the
 * packet, `chroma0` to `chroma11`, through an envelope with a 40 ms attack and
 * a 900 ms release: a chord blooms in a blink and eases back over a second or two,
 * slower than the extractor's own release so that one chord is still fading
 * when the next is up, and the two are seen at once. A note is a petal that is
 * longer and brighter the more it sounds. The petals are turned so the key's
 * own note stands at the top, which is `keyHue`, and the colour of each is its
 * place on the wheel with the key added, so a modulation is the whole flower
 * turning to a new note at the top over the seconds the key takes to move.
 *
 * What the moments do to the shape. `release` opens the flower, from `open`'s
 * resting half toward full bloom, and `impact` throws it open for the frame
 * of the drop and eases back over a second. `tension` closes it: at full
 * tension `open` is 0, every petal is a third of its length and standing
 * close, which is a bud, and it takes 0.12 off the light and the whole second
 * whorl with it, so a build is a flower holding its breath and not a brighter
 * one. The drop lets it go.
 *
 * The loud parts are put into size and reach, never into light. `beatPulse`
 * swells the radius, `bassPulse` widens the glow round every petal and turns
 * the flower a step, and `energy` opens a second, smaller whorl of twelve
 * petals half a step behind the first, so a loud passage doubles the number of
 * petals a lit note has. The rotation is an `integrate` row on `energy` and
 * one on `bassPulse`, both wrapping at a turn: a loud passage turns the flower
 * once in about half a minute, a quiet one in a couple of minutes, and the
 * bass gives it a nudge on the beat. Silence holds it where it is.
 *
 * The bar this ink is built to is a backlit petal and not a filled shape.
 * Every petal is a soft luminous outline with a bright rim round it, a dim
 * translucent body that is a little darker in the middle than near the edge, a
 * halo outside, and a point of light gathered at the tip, on true black. It has
 * a colour of its own and not the shared palette's: a fully saturated hue for
 * its note, so twelve petals are twelve colours and a chord is three of them.
 * The intensity rests at 1.3, above 1 on purpose, so the rim clears the bloom's
 * threshold while the body does not, and nothing loud raises it, which is the
 * registry's rule. `docs/studies/chord-petals.md` says what it was built to.
 *
 * It is sparse by construction. Measured on a grid at the top of every row
 * that adds to the shape (`petalsCoverage`, with tests that hold it): a triad
 * at rest lights 3 percent of a 16:9 frame, a loud triad 15, a seven-note
 * scale 25, and all twelve notes at once 37, which the extractor's flat-chroma
 * gate keeps from ever being read. A square frame is the same flower over less
 * frame and reads about twice those. That is the flash statement for WCAG
 * 2.3.1: the light is a bounded shape at the middle that grows and eases over
 * a second, no note's petal changes faster than its 40 ms attack and 900 ms
 * release allow, and nothing toggles a large area of luminance on or off, so
 * there is no strobe in the construction.
 *
 * A packet with no note in it lights no petal, and a flower with none lit
 * draws nothing: no pass encoded and nothing uploaded. That is the study's
 * silence gate, and it is also what drums alone do, which is right for a study
 * that is about harmony.
 */
export const CHORD_PETALS: InkStudy = {
  id: 'chord-petals',
  kind: 'ink',
  name: 'Chord petals',
  impl: 'petals',
  home: { drive: 0.5, weight: 0.6, tonality: 0.85, steadiness: 0.5, hardness: 0.1 },
  reach: 0.4,
  moments: { intro: 0.8, groove: 1, build: 0.4, drop: 0, rest: 0.8, outro: 0 },
  knobs: {
    note0: 0,
    note1: 0,
    note2: 0,
    note3: 0,
    note4: 0,
    note5: 0,
    note6: 0,
    note7: 0,
    note8: 0,
    note9: 0,
    note10: 0,
    note11: 0,
    open: 0.5,
    size: 0.36,
    width: 0.75,
    layer: 0.1,
    glow: 10,
    intensity: 1.3,
    turn: 0,
  },
  mapping: [
    petal('chroma0', 'note0'),
    petal('chroma1', 'note1'),
    petal('chroma2', 'note2'),
    petal('chroma3', 'note3'),
    petal('chroma4', 'note4'),
    petal('chroma5', 'note5'),
    petal('chroma6', 'note6'),
    petal('chroma7', 'note7'),
    petal('chroma8', 'note8'),
    petal('chroma9', 'note9'),
    petal('chroma10', 'note10'),
    petal('chroma11', 'note11'),
    { from: 'release', to: 'open', gain: 0.3, curve: 'linear' },
    {
      from: 'impact',
      to: 'open',
      gain: 0.35,
      curve: 'linear',
      // The drop's own bloom rather than the extractor's fifth of a second: it
      // is thrown open at once and settles over a second.
      shape: { kind: 'envelope', attackMs: 25, releaseMs: 900 },
    },
    { from: 'tension', to: 'open', gain: -0.5, curve: 'linear' },
    {
      from: 'beatPulse',
      to: 'size',
      gain: 0.05,
      curve: 'linear',
      shape: { kind: 'envelope', attackMs: 10, releaseMs: 250 },
    },
    { from: 'tension', to: 'size', gain: -0.05, curve: 'linear' },
    { from: 'lowEnd', to: 'width', gain: 0.15, curve: 'linear' },
    { from: 'harmonicChange', to: 'width', gain: 0.1, curve: 'linear' },
    { from: 'energy', to: 'layer', gain: 0.8, curve: 'sqrt' },
    { from: 'tension', to: 'layer', gain: -0.1, curve: 'linear' },
    {
      from: 'bassPulse',
      to: 'glow',
      gain: 12,
      curve: 'linear',
      shape: { kind: 'envelope', attackMs: 5, releaseMs: 300 },
    },
    { from: 'energy', to: 'glow', gain: 8, curve: 'sqrt' },
    { from: 'tension', to: 'glow', gain: -3, curve: 'linear' },
    { from: 'tension', to: 'intensity', gain: -0.12, curve: 'linear' },
    {
      from: 'energy',
      to: 'turn',
      gain: 1,
      curve: 'linear',
      // A turn of the flower, at 0.02 turns a second of loud music. It wraps
      // where the angle does, so nothing steps.
      shape: { kind: 'integrate', rate: 0.02, wrap: 1 },
    },
    {
      from: 'bassPulse',
      to: 'turn',
      gain: 1,
      curve: 'linear',
      shape: { kind: 'integrate', rate: 0.03, wrap: 1 },
    },
  ],
  cost: 'cheap',
}
