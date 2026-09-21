import type { InkStudy } from '../types'

/**
 * Slow specks adrift, for the quiet end of a song: intro, rest and outro on a
 * soft, slow track. It is the one ink that is at its best when the music is
 * least, so its rows are written against how much there is to hear, not how
 * much there is to draw.
 *
 * It is a particle field now (`impls/ParticleField.ts`, the `DUST_PROFILE` in
 * `impls/particles.params.ts`) and not a CPU pool of a few dozen quads. Three
 * things changed with it and one did not. The count is tens of thousands
 * rather than tens, so the quiet end reads as a haze of light rather than as a
 * handful of dots. A speck rides the live flow, which the pool could not: it
 * used to drift on a closed-form curve and let the canvas smear it along the
 * current, and now it goes with the current and the canvas smears the result.
 * And the drift is a real curl noise, so two neighbouring specks bend the same
 * way and the field reads as one slow body of air. What did not change is the
 * study: the same id, the same home, the same moments, the same rows against
 * the same fields.
 *
 * A quiet passage is not silence, and that is what decides the count. The
 * catalogue asks for more dust in the quiet, which is `energy` inverted, but a
 * bare inversion is at its largest at silence, and a silent packet has to draw
 * nothing. So the count is a hump: the square root of the energy lets the dust
 * in with the first sound at all, a square takes it away again as the music
 * fills the frame, and at a silent packet the count resolves to 0, no pass is
 * encoded and nothing is dispatched. The count carries the gate and the
 * intensity does not, because a count is a level that brings the specks in a
 * few at a time, so a sound arriving is the field filling up rather than the
 * whole of it at once, while an intensity of 0 would still leave a pass of
 * invisible quads to draw. The hump peaks at about 22,000 specks at an energy
 * of 0.44 and is back to 7,000 at a full packet.
 *
 * Tension makes the specks gather: it is a pull toward the middle of the
 * canvas, half a short side a second at a full build, which is the one thing
 * here that a build does. It is a rate and not a fraction, so the specks draw
 * in over a second or two rather than jumping, and the drag holds them off the
 * one point they would otherwise pile onto. The drop lets them go again as
 * tension falls.
 *
 * It is sparse by construction. At the most its own mapping reaches, 22,000
 * specks of 1.5 px on a 1080 high canvas, it covers 4.3 percent of a square
 * frame and 2.4 percent of a 16:9 one (`particleCoverage`, an upper bound
 * since the shader draws a soft disc inside each quad), and a test holds that
 * under a twentieth on every canvas shape. With every knob at the top of its
 * own range instead, which no mapping here reaches, 40,000 specks of 4 px
 * cover 55 percent of a square frame: the pool is a budget and the ranges are
 * what keep the study inside it, which is the one thing a field cannot claim
 * the way a pool of 160 could.
 *
 * The intensity is the number to trust least, and it is a different number
 * from the one the pool used: the light of a frame is the count times the area
 * times this, and the count went up three hundredfold while the area went down
 * forty-fourfold, so 0.5 on a 10 px speck became 0.08 on a 1.5 px one for the
 * same light in the frame. What that arithmetic cannot say is how a haze of
 * twenty thousand points reads against a handful, since a speck barely moves
 * and the canvas sums it for seconds. It wants looking at on the adapter at a
 * quiet passage before it is trusted.
 *
 * Its home is the soft, slow corner, the opposite of the shards, and its reach
 * is narrow for the same reason theirs is: a lo-fi track is at home with it
 * and a hardstyle one is not.
 */
export const DUST: InkStudy = {
  id: 'dust',
  kind: 'ink',
  name: 'Dust',
  impl: 'dust',
  home: { drive: 0.15, weight: 0.55, tonality: 0.6, steadiness: 0.4, hardness: 0.1 },
  reach: 0.3,
  moments: { intro: 1, groove: 0, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: {
    count: 0,
    size: 1.5,
    curl: 0.02,
    curlScale: 1.5,
    twinkle: 0.45,
    intensity: 0.08,
    hueSpread: 0.12,
    gather: 0,
  },
  mapping: [
    { from: 'energy', to: 'count', gain: 45000, curve: 'sqrt' },
    { from: 'energy', to: 'count', gain: -38500, curve: 'square' },
    { from: 'swell', to: 'curl', gain: 0.05, curve: 'linear' },
    { from: 'treble', to: 'twinkle', gain: 0.5, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.02, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.01, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.01, curve: 'square' },
    { from: 'tension', to: 'gather', gain: 0.5, curve: 'linear' },
  ],
  cost: 'cheap',
}
