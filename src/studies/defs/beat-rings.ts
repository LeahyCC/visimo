import type { InkStudy } from '../types'

/**
 * The beat made visible: thin circles born at the middle on the predicted
 * beat and spreading out, for a steady groove and for a build, where a roll of
 * them is the tension drawn. A ring is born where `beatPhase` wraps and not
 * where an onset falls, so it lands on the beat the tracker expects, and the
 * ink births none while `tempoConfidence` is under its gate: a phase on a wrong
 * tempo is a steady rhythm in the wrong place. The gate is here as well as in
 * the ink, as the same `invert` row the caustics use for the key: the intensity
 * is its rest value times the confidence, so a silent packet resolves to no
 * light and an unsteady track to a dim one the ink then refuses to birth for.
 *
 * Tension takes `rate` from 1 to 4 rings a beat, which the ink snaps to 1, 2 or
 * 4, so spacing halves the way a snare roll does. It also takes 1.5 s off the
 * life, which is the row that keeps a roll sparse: four a beat at the same life
 * would be a crowd. Nothing else in the light moves with a build, so it adds
 * rings and not brightness. Energy thickens a ring by under a pixel and a
 * heavy low end quickens it by a third, and both are small on purpose.
 *
 * It is sparse by design. At its worst, a roll at full tension on a loud,
 * low-heavy passage at 200 beats a minute, a ring is 3.3 px thick at 1080 high
 * plus its edge and 12 are alive at once, which lights 3.6% of a 16:9 frame,
 * 6.4% of a square one and 6.1% of a tall one (`ringsCoverage`, an upper bound
 * that counts every ring at full light and none overlapping), and a test holds
 * it under a tenth on eight canvas shapes. One ring is under 2% of a frame.
 * That is the flash statement for WCAG 2.3.1: what a ring does to the frame is
 * a thin moving line and never a large-area change of luminance, and the rate
 * is the beat's own, about 13 a second at the fastest tempo the tracker
 * reports, each too small to count as a flash by area.
 *
 * The intensity is the number to trust least, and it was set by looking. It
 * first rested at 0.45, from the sum: light that moves does not sum the way a
 * still image does, and the canvas takes 0.018 off every pixel every frame, so
 * a ring adds its one frame and a wake that the floor eats. Beside the ribbon
 * on the adapter in the bench at a quiet level that was a faint ring you had to
 * look for. At 1 the rings were clear and a little bold beside the ribbon, and
 * 0.8 sits between: the newest ring reads about as bright as the ribbon and the
 * older ones fade to the black behind them. A moving ring peaks at exactly its
 * own intensity, 0.8 (`ringPassPeak`), which the feedback pass bends a little
 * at a loud level and never clips; only a ring slower than the range allows
 * would stand on a pixel long enough to sum higher.
 *
 * Its home is the steady, hard-ish middle of the space, with a moderate reach:
 * a house or a hardstyle track is at home with it and a lo-fi one is not.
 */
export const BEAT_RINGS: InkStudy = {
  id: 'beat-rings',
  kind: 'ink',
  name: 'Beat rings',
  impl: 'rings',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.85, hardness: 0.55 },
  reach: 0.5,
  moments: { intro: 0, groove: 1, build: 1, drop: 0, rest: 0, outro: 0 },
  knobs: {
    rate: 1,
    speed: 0.24,
    thickness: 2.5,
    intensity: 0.8,
    life: 2.4,
    hueSpread: 0.12,
  },
  mapping: [
    { from: 'tension', to: 'rate', gain: 3, curve: 'linear' },
    { from: 'tension', to: 'life', gain: -1.5, curve: 'linear' },
    { from: 'tempoConfidence', to: 'intensity', gain: -0.8, curve: 'invert' },
    { from: 'lowEnd', to: 'speed', gain: 0.08, curve: 'linear' },
    { from: 'energy', to: 'thickness', gain: 0.8, curve: 'linear' },
  ],
  cost: 'cheap',
}
