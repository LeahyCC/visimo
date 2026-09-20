/**
 * Where the song sits in the character space, stepped once a frame.
 *
 * The five axes are the ones `docs/canvas-plan.md` draws and `studies/types.ts`
 * names, and every one of them reads a packet row that is already slow. This
 * smooths them slower still, over tens of seconds, because the question it
 * answers is "what kind of track is this" and a number that changes its mind
 * inside a bar is no answer at all.
 *
 * It is also where each row is stretched onto the range an axis is supposed
 * to use. A row is built to say one thing truly and not to fill 0 to 1, and
 * read raw the twenty tracks measured for the spans below sat inside a corner
 * a fifth of the space wide, which left every study about the same distance
 * from every track. The stretching lives here and not in the extractor
 * because the rows are public API and a preset's mapping reads them raw.
 *
 * Two of the axes are slower than the other
 * three: `keyClarity` falls the moment the notes stop and `tempoConfidence`
 * dips through any bar the tracker doubts, and neither of those is the track
 * becoming a different track.
 *
 * Nothing here is worth believing at once, so it also says how settled it is.
 * A track opens neutral and drifts to its own place over the first half
 * minute, and the director opens on a cast that suits anything and lets the
 * character take over as `settled` climbs. A host that knows the track (a
 * genre tag, or the values saved from the last play) hands in a starting
 * point instead, which moves where the drift starts and not how long it is:
 * the reading is still a guess until the music has been heard.
 *
 * Every smoother is a one-pole over the real `dt`, so 60 and 144 frames a
 * second settle on the same numbers at the same times.
 */
import { F } from '../audio/FeatureExtractor'
import { CHARACTER_AXES } from '../studies/types'
import type { Character, CharacterAxis } from '../studies/types'

/** No opinion on any axis. Where a track starts unless a host says otherwise. */
export const NEUTRAL_CHARACTER: Character = {
  drive: 0.5,
  weight: 0.5,
  tonality: 0.5,
  steadiness: 0.5,
  hardness: 0.5,
}

/** Drive, weight and hardness: slow, but they may still follow a track that changes gear. */
export const CHARACTER_SECONDS = 15

/**
 * Tonality and steadiness. Both of their rows answer "is this being heard
 * clearly right now" rather than "is this track tonal", so they are averaged
 * over twice as long before they count as the track's own.
 */
export const CHARACTER_SLOW_SECONDS = 30

/** Seconds of sound before the reading is worth anything, and before it is settled. */
export const SETTLE_FROM_SECONDS = 10
export const SETTLE_TO_SECONDS = 30

/**
 * Under this, `energy` is not music. Silence holds every axis where the last
 * sound left it and stops the settle clock, the way the extractor's own slow
 * rows hold through a pause, a seek and the gap between two tracks.
 */
const SOUND_FLOOR = 0.02

export type CharacterOptions = {
  /** What a host that knows the track hands in. Axes it leaves out start neutral. */
  start?: Partial<Character>
  settleFrom?: number
  settleTo?: number
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

const SLOW_AXES: readonly CharacterAxis[] = ['tonality', 'steadiness']

/**
 * Where a row really sits on real music, so an axis uses the whole of 0 to 1.
 *
 * The rows are built to be loudness independent and frame-rate independent,
 * which they are, and nobody ever asked them to use their range: `pace` is a
 * count of hits against four a second, `weight` is a centroid between two
 * groups it never reaches, and `tempoConfidence` is a correlation. Read
 * straight, every track landed in one small corner of the space, every study
 * was about the same distance from every track, and the character decided
 * almost nothing. These are the measured ends, over 60 to 150 seconds of
 * twenty tracks, with the track at each end named. That late, because these
 * are slow readings and half of them are still settling at 30 seconds.
 * Remeasure with `scripts/character-table.mjs` before moving one.
 *
 * Widening a row itself was the other option and is the wrong one: the rows
 * are public API, Musimo pins a tag, and a preset's mapping reads them raw.
 * Where an axis is read is the one place that can change without anything
 * else moving.
 */
const span = (value: number, low: number, high: number) => clamp01((value - low) / (high - low))

/** Wilco at 0.28, Kate McGill's strummed guitar at 0.72. */
const DRIVE_SLOW = 0.22
const DRIVE_FAST = 0.78
/** Subtronics at 0.65, Christian Loffler at 1. Nothing real reads under 0.6. */
const WEIGHT_BRIGHT = 0.6
const WEIGHT_DEEP = 1
/** Adagio for TRON at 0.02, FISHER at 0.78. */
const STEADY_LOOSE = 0.05
const STEADY_TIGHT = 0.8

/**
 * What the hits are worth to the hardness axis, and the reading at which they
 * say nothing either way.
 *
 * `hardness` is how abrupt a track's hits are, which is half of what a
 * listener means and the smaller half. It is also the half that goes wrong
 * where it matters most: a wall of distorted guitars has few sharp hits over
 * its own sustained level, so metal read 0.09 to 0.15 against hip hop's 0.47.
 * So `grit`, the sound between the hits, carries the axis, and the hits move
 * it a third of a step either way: a four to the floor kick and a dry snare
 * still count for something, and a track whose hits are mush is still softer
 * than one whose hits crack. 0.25 is what an ordinary track reads on row 46.
 */
const HIT_EVEN = 0.25
const HIT_SWAY = 0.35

/**
 * The row values an axis reads back as `value`: what a bench slider writes.
 * The hardness slider writes `grit` and leaves row 46 at the reading that
 * neither lifts nor lowers, since two rows cannot be worked back out of one
 * number and `grit` is the one that carries the axis.
 */
export function rowsForAxis(axis: CharacterAxis, value: number): readonly RowValue[] {
  const held = clamp01(value)
  const unspan = (low: number, high: number) => low + held * (high - low)
  switch (axis) {
    case 'drive': {
      const row = unspan(DRIVE_SLOW, DRIVE_FAST)
      return [
        { row: F.pace, value: row },
        { row: F.tempo, value: row },
      ]
    }

    case 'weight':
      return [{ row: F.weight, value: unspan(WEIGHT_BRIGHT, WEIGHT_DEEP) }]
    case 'tonality':
      return [{ row: F.keyClarity, value: held }]
    case 'steadiness':
      return [{ row: F.tempoConfidence, value: unspan(STEADY_LOOSE, STEADY_TIGHT) }]
    case 'hardness':
      return [
        { row: F.grit, value: held },
        { row: F.hardness, value: HIT_EVEN },
      ]
  }
}

/** One packet row and what to write into it. */
export type RowValue = { readonly row: number; readonly value: number }

export class CharacterReader {
  private readonly value: Record<CharacterAxis, number>
  private readonly target: Record<CharacterAxis, number>
  private readonly settleFrom: number
  private readonly settleTo: number
  private heard = 0

  constructor(options: CharacterOptions = {}) {
    this.value = { ...NEUTRAL_CHARACTER, ...options.start }
    for (const axis of CHARACTER_AXES) this.value[axis] = clamp01(this.value[axis])
    this.target = { ...this.value }
    this.settleFrom = options.settleFrom ?? SETTLE_FROM_SECONDS
    this.settleTo = options.settleTo ?? SETTLE_TO_SECONDS
  }

  /** The reading so far. The same object every frame; nothing here allocates. */
  get character(): Character {
    return this.value
  }

  /**
   * 0 while the reading is still a guess and 1 once it has heard enough to be
   * the track's own, from seconds of actual sound rather than of wall clock.
   */
  get settled(): number {
    const span = this.settleTo - this.settleFrom
    return span <= 0
      ? this.heard >= this.settleTo
        ? 1
        : 0
      : clamp01((this.heard - this.settleFrom) / span)
  }

  /** Seconds of sound heard so far. */
  get heardSeconds(): number {
    return this.heard
  }

  step(features: Float32Array, dt: number): Character {
    if (dt <= 0) return this.value
    if ((features[F.energy] ?? 0) < SOUND_FLOOR) return this.value
    this.heard += dt
    this.read(features)
    for (const axis of CHARACTER_AXES) {
      const tau = SLOW_AXES.includes(axis) ? CHARACTER_SLOW_SECONDS : CHARACTER_SECONDS
      const rise = 1 - Math.exp(-dt / tau)
      this.value[axis] += (this.target[axis] - this.value[axis]) * rise
    }

    return this.value
  }

  /**
   * What each axis is before it is smoothed. Which rows feed which axis is a
   * rule about music and lives here rather than in a helper.
   */
  private read(features: Float32Array) {
    const pace = clamp01(features[F.pace] ?? 0)
    const tempo = clamp01(features[F.tempo] ?? 0)
    // A tempo of 0 is the tracker saying it has not settled, not a slow track,
    // so pace carries the axis alone until it has.
    const busy = tempo > 0 ? (pace + tempo) / 2 : pace
    this.target.drive = span(busy, DRIVE_SLOW, DRIVE_FAST)
    this.target.weight = span(features[F.weight] ?? 0.5, WEIGHT_BRIGHT, WEIGHT_DEEP)
    // The one row that already uses its range, so it is taken as it comes.
    this.target.tonality = clamp01(features[F.keyClarity] ?? 0.5)
    this.target.steadiness = span(features[F.tempoConfidence] ?? 0.5, STEADY_LOOSE, STEADY_TIGHT)
    this.target.hardness = clamp01(
      (features[F.grit] ?? 0) + HIT_SWAY * ((features[F.hardness] ?? HIT_EVEN) - HIT_EVEN),
    )
  }
}
