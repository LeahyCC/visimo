/**
 * Where the song sits in the character space, stepped once a frame.
 *
 * The five axes are the ones `docs/canvas-plan.md` draws and `studies/types.ts`
 * names, and every one of them reads a packet row that is already slow. This
 * smooths them slower still, over tens of seconds, because the question it
 * answers is "what kind of track is this" and a number that changes its mind
 * inside a bar is no answer at all. Two of the axes are slower than the other
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
    this.target.drive = tempo > 0 ? (pace + tempo) / 2 : pace
    this.target.weight = clamp01(features[F.weight] ?? 0.5)
    this.target.tonality = clamp01(features[F.keyClarity] ?? 0.5)
    this.target.steadiness = clamp01(features[F.tempoConfidence] ?? 0.5)
    this.target.hardness = clamp01(features[F.hardness] ?? 0.5)
  }
}
