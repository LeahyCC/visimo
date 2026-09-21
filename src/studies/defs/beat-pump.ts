import type { FlowStudy } from '../types'
import { NO_CURL } from './shared'

/**
 * A zoom pulse that lands on the predicted beat: the flow for the groove and
 * the drop of a steady, hard track. The radial term is a sawtooth in the beat
 * phase, and everything below is why it is that one and not another.
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
 * How deep. The scale swings by about 2.5 percent peak to peak at the rim at
 * 128 BPM (0.24 x the beat / 8 field widths, 36 px at 2560 wide), which is
 * more than twice what the canvas's own `beatPhase` zoom row swings, about 1
 * percent (that row is one-sided, it only ever zooms out faster on the beat, so
 * it is a surge and never a pump). It is a velocity, so the depth scales with
 * the length of a beat: 1.8 percent at 175 BPM and 3.5 at 90. The 0.24 is the
 * number to trust least: too deep judders the whole picture and too shallow is
 * invisible, and it can only be judged on a real adapter.
 *
 * Confidence. Rows add, so nothing here can scale the pulse by how sure the
 * beat is, and it does not fade: at a confidence of 0 with a phase still
 * running the sawtooth is as deep as ever, which is the tracker's own choice (a
 * ramp that carries on through a bar of doubt is less jarring than one that
 * stalls). What a row can do is take out the constant. Before any tempo has
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
 * Tension deepens it by widening it. The swing is the phase row's gain and no
 * row can multiply it, but `falloff` is a shape: at 0 the speed is proportional
 * to the radius and only the rim takes the full swing, and at 1.5 most of the
 * frame does, which is 1.67 times the mean speed over a 16:9 frame with the
 * rim a tenth slower. It stays zero mean at every falloff, so a build brings
 * the pulse into the middle of the picture and never starts a drift.
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
    { from: 'beatPhase', to: 'radial', gain: -0.24, curve: 'linear' },
    { from: 'tempoConfidence', to: 'radial', gain: 0.12, curve: 'sqrt' },
    { from: 'tension', to: 'falloff', gain: 1.5, curve: 'linear' },
  ],
  cost: 'cheap',
}
