import type { FlowStudy } from '../types'
import { NO_CURL } from './shared'

/**
 * A zoom pulse that lands on the predicted beat: the flow for the groove and
 * the drop of a steady, hard track. The radial term is a sawtooth in the beat
 * phase through a spring, and everything below is why it is that one and not
 * another.
 *
 * The sign. The feedback pass reads the last frame back at `uv - velocity x
 * step`, so the history moves WITH the velocity, and a positive `radial` pushes
 * the picture outward. The kick is outward and the settle is inward.
 *
 * The curve. `beatPhase` is 0 on the beat and rises to 1, so a negative gain on
 * it is highest at the beat and falls in a straight line to the next: an
 * `invert` on it would draw the same line. The line is the row and the offset
 * that makes its mean zero is the confidence row, and not a resting value, for
 * the reason under "confidence" below. At a confidence of 1 the radial speed is
 * 0.12 - 0.24 x phase: +0.12 field widths a second on the beat, 0 half a beat
 * later and -0.12 just before the next, so the mean over a beat is 0 and the
 * picture breathes about where it was instead of marching off the edge. The
 * picture is at its smallest on the beat and its widest half a beat later: the
 * velocity reverses on the beat, and the reversal is what reads as the hit.
 *
 * The spring is what makes it a kick rather than a ramp. A sawtooth alone is
 * a straight line down and a reversal at the beat, and the reversal is the
 * whole of what there is to see in it: the picture slides evenly across the
 * beat and changes direction. Through a spring at 8 hertz and a damping of
 * 0.5 the same row snaps and rings. The signal steps by a whole turn where
 * the phase wraps, so the spring passes the target on the way down (the
 * overshoot of a step at a damping ratio is `exp(-pi z / sqrt(1 - z^2))`, 16
 * percent at 0.5, which is how the number was chosen rather than by eye) and
 * rings back with a period of 144 milliseconds, decaying with a time constant
 * of 40, so it has settled inside a third of a beat at 128 BPM. The beat is
 * then an outward kick that reaches 0.134 field widths a second against the
 * sawtooth's flat 0.12, a small bounce, and the settle.
 *
 * The reversal lands 26 milliseconds after the tracker's beat, and at every
 * tempo, since what sets it is the spring's own period and not the beat's:
 * the velocity crosses zero going outward there, which is where the picture
 * is at its smallest and what a viewer reads as the hit. A reacted-to hit
 * reaches the screen 65 to 100 milliseconds late (see open leads), so this is
 * still the thing the predicted phase exists for. A spring tracking a ramp
 * also sits `2 z / w` seconds behind it, 20 milliseconds here, which is the
 * same figure seen on the slide rather than at the kick.
 *
 * It does not spend anything. A spring has a gain of 1 at nothing per second,
 * so the mean of its output over a beat is the mean of the sawtooth it is
 * fed, and the confidence row that made the sawtooth zero mean makes the
 * sprung one zero mean too: the picture still breathes about where it was.
 * The swing it breathes by is barely touched, 2.4 percent of the scale at the
 * rim at 128 BPM against the sawtooth's 2.45, since a spring reshapes the
 * velocity and does not add any.
 *
 * It also settles exactly. A spring rests on its signal, so a passage where
 * the phase has stopped moving (no tempo found, the phase stuck at 0) is the
 * row it would have been with no spring at all, and the silent packet still
 * resolves to nothing. And it is the same curve at any frame rate: the peak,
 * the trough and the swing over a beat agree to better than half a percent at
 * 30, 60 and 144 frames a second, which is the analytic step doing its job
 * (`presets/shapes.ts`) and is what `beatPump.test.ts` holds.
 *
 * How deep. The scale swings by about 2.4 percent peak to peak at the rim at
 * 128 BPM (34 px at 2560 wide), which is more than twice what the canvas's own
 * `beatPhase` zoom row swings, about 1 percent (that row is one-sided, it only
 * ever zooms out faster on the beat, so it is a surge and never a pump). It is
 * a velocity, so the depth scales with the length of a beat: 1.7 percent at
 * 175 BPM and 3.4 at 90. The 0.24 is the number to trust least: too deep
 * judders the whole picture and too shallow is invisible, and it can only be
 * judged on a real adapter.
 *
 * Confidence. A row may carry a `scale`, so the pulse could be scaled by how
 * sure the beat is, and it deliberately is not. At a confidence of 0 with a
 * phase still running the sawtooth is as deep as ever, which is the tracker's
 * own choice: a ramp that carries on through a bar of doubt is less jarring
 * than one that stalls, and a pump that thinned every time the correlation
 * dipped would be the stall drawn. What the row does instead is take out the
 * constant. Before any tempo has
 * been found the phase is stuck at 0, the top of the sawtooth, and any resting
 * offset would leave the picture pushed outward for as long as that lasts. So
 * the offset is `sqrt(tempoConfidence)`, which is 0 with no beat, keeps the
 * silent packet still (the flow encodes nothing) and rises fast enough that a
 * two-step at 0.45 is only a sixth of a swing under level. In a doubted bar
 * with the phase running there is a slow inward drift, -0.12 field widths a
 * second at the worst, which the canvas's own outward zoom (0.05 to 0.15 at
 * the rim) largely cancels. The real gate is the director: `steadiness` is the
 * character axis the tracker's confidence feeds, the home is 0.9 and the reach
 * is moderate, so a track without a steady beat never has this cast and one
 * that loses it is faded out over a glide.
 *
 * Tension deepens it by widening it. A `scale` on the phase row could deepen
 * the swing itself now, and widening is still the better answer: a deeper
 * swing is more velocity, and the depth is already the number that judders
 * the picture when it is too big, where `falloff` is a shape and costs
 * nothing at the rim. At 0 the speed is proportional to the radius and only
 * the rim takes the full swing, and at 1.5 most of the frame does, which is
 * 1.67 times the mean speed over a 16:9 frame with the rim a tenth slower. It
 * stays zero mean at every falloff, so a build brings the pulse into the
 * middle of the picture and never starts a drift.
 * `beatPulse` is left out on purpose: it is a decaying pulse with a positive
 * mean, so any gain on it is a net outward push, and the onset it reports is
 * what the tracker's phase is already made from.
 *
 * Its home is steady and hard, in the corner where a hardstyle or techno groove
 * lives, and its reach is moderate, so a lo-fi track is not welcome there.
 * Steady is 0.85 and hard is 0.75 rather than the 0.9 and 0.85 they were: a
 * house track reads 0.92 steady and the hardest track measured reads 0.79
 * hard, so the old corner was past the end of the space and only one track in
 * twenty could get there.
 */
export const BEAT_PUMP: FlowStudy = {
  id: 'beat-pump',
  kind: 'flow',
  name: 'Beat pump',
  impl: 'analytic',
  home: { drive: 0.7, weight: 0.5, tonality: 0.5, steadiness: 0.85, hardness: 0.75 },
  reach: 0.5,
  moments: { intro: 0, groove: 1, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: { ...NO_CURL, radial: 0, falloff: 0, swirl: 0, twist: 0 },
  mapping: [
    {
      from: 'beatPhase',
      to: 'radial',
      gain: -0.24,
      curve: 'linear',
      // The sawtooth snaps and rings instead of sliding: see "The spring"
      // above for the overshoot, the lag and why the mean is untouched.
      shape: { kind: 'spring', frequency: 8, damping: 0.5 },
    },
    { from: 'tempoConfidence', to: 'radial', gain: 0.12, curve: 'sqrt' },
    { from: 'tension', to: 'falloff', gain: 1.5, curve: 'linear' },
  ],
  cost: 'cheap',
}
