import type { InkStudy } from '../types'

/**
 * One central glow that breathes with the music. It is modest everywhere: a
 * companion to other inks and never the whole picture.
 *
 * It was first written as the ink the director can always fall back on, with
 * a fit of 0.5 in every moment, the middle of the space and the whole of it
 * for a reach. That is the ribbon's mistake (see there): a study that is a
 * fair fit for every track and every moment is in most casts, and it was
 * still taking the last slot where studies written for the moment had a
 * claim, at 53 percent of the casts the twenty measured tracks can be given.
 * One glow at the middle is at its best under music that leaves it room, soft,
 * tonal and slower (the ambient, downtempo, folk and orchestral end of
 * `tracks.fixture.ts`), where a single breathing shape anchors the picture
 * and does not sit on top of a busy one. So it has a home there, a reach of
 * 0.45, a full fit for intro, rest and outro, less for a groove, and little
 * for a drop, where a glow at the middle is a smaller thing than the hit.
 *
 * It breathes, and it is written so that silence draws nothing. `energy` sets
 * the radius, through a square root, so the first sound lets a small glow in
 * and a full packet makes it a large one; at a silent packet the radius is 0
 * and the ink encodes no pass. The radius carries the gate and the intensity
 * does not, for the dust's reason: a size that is 0 draws nothing however much
 * light there is, so tension can lift the light without a silent build lighting
 * anything. It is also why a near-silent packet at full tension resolves the
 * radius a little under 0, which the ink holds at 0 (the registry guard has the
 * exception). `beatPulse` adds a little light on the beat, and `lowEnd` opens
 * the hollow, so a kick pushes the peak of the falloff out from the middle and
 * the glow opens toward a ring and closes again. `hardness` tightens the core
 * of a hard track and softens a soft one, which is the one way the study reads
 * the song's character. The hue is the ribbon's palette at the key and sits
 * still; it is a setting for a cast to offset, and not a level.
 *
 * Tension tightens it to a point, as the catalogue says: it takes the radius
 * down by 0.07 of the short side and the hollow to nothing, and lifts the
 * intensity a little, so a build draws the glow in and brightens it and the
 * drop lets it out. A quiet build (an energy of 0.15) goes from a radius of
 * 0.10 to 0.03, which is a point.
 *
 * How much light is the arithmetic that matters, because the halo sits at the
 * middle of a canvas whose flows mostly pull toward or push from that point,
 * so light piles up there before it does anywhere else. The canvas keeps 0.93
 * of itself a frame and takes a floor of 0.018 off what it kept, so a still
 * image sums to 1 / (1 - 0.93), about fourteen times what one frame adds over
 * that floor. The resting intensity is 0.055, so the middle of a glow that
 * sits still settles at about 0.52. The feedback pass bends light above half
 * its ceiling, and a director-built canvas holds a ceiling of 1.25 at a full
 * packet, so the knee is at 0.625; a full packet dims the light to 0.032 and
 * the most any packet reaches is 0.061 (a beat with no sound and a full
 * build), which settles at 0.61, under the knee. `halo.test.ts` sums it frame
 * by frame and holds both. That the light rises with a build at all is within
 * the wash-out guard on its own: a full packet at full tension is 0.034,
 * under rest, so it needs no entry in `BUILT_LIGHT`.
 *
 * It is one quad sized to the glow: at its widest the study reaches, a radius
 * of 0.26 of the short side on a loud packet, it lights about 6% of a 16:9
 * frame (`haloCoverage`), and at rest on a quiet passage about 1%. The pass is
 * one draw of six vertices into the shared target.
 *
 * The intensity is the number to trust least, and it has already been wrong
 * once. It was first chosen from the sum alone, with the canvas's floor left
 * out of the sum: 0.028, reckoned to settle at 0.4. With the floor under it
 * that is 0.14, and on a real adapter it was a faint ring at a quiet level and
 * could not be found at all beside the ribbon. At 0.055 it reads as a small
 * pale glow in the quiet and as a ring a kick opens in a groove, with the
 * fluid pulling a wisp off it, and it is still a companion and not the
 * picture. The ceiling leaves almost no room above it, so if it wants to be
 * brighter it is the radius and not the light that has to give.
 */
export const HALO: InkStudy = {
  id: 'halo',
  kind: 'ink',
  name: 'Halo',
  impl: 'halo',
  home: { drive: 0.25, weight: 0.75, tonality: 0.7, steadiness: 0.35, hardness: 0.05 },
  reach: 0.3,
  moments: { intro: 1, groove: 0.4, build: 0.4, drop: 0.15, rest: 1, outro: 1 },
  knobs: {
    radius: 0,
    hollow: 0.15,
    softness: 0.6,
    intensity: 0.055,
    hue: 0,
  },
  mapping: [
    { from: 'energy', to: 'radius', gain: 0.26, curve: 'sqrt' },
    { from: 'tension', to: 'radius', gain: -0.07, curve: 'linear' },
    { from: 'lowEnd', to: 'hollow', gain: 0.5, curve: 'linear' },
    { from: 'tension', to: 'hollow', gain: -0.15, curve: 'linear' },
    { from: 'hardness', to: 'softness', gain: -0.4, curve: 'linear' },
    { from: 'beatPulse', to: 'intensity', gain: 0.004, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.015, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.006, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.006, curve: 'square' },
    { from: 'tension', to: 'intensity', gain: 0.002, curve: 'linear' },
  ],
  cost: 'cheap',
}
