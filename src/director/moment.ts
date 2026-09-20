/**
 * Where in the song we are, as six weights that sum to 1.
 *
 * The extractor already says how wound up, how paid off and how empty the
 * music is, in rows 47 to 50. Three of the six are those rows straight, and
 * groove is what is left when all three are low, which is the whole reason
 * groove needs no row of its own. A weight rather than a label because real
 * songs are not clean: a build bleeds into a drop, and a blend slides where a
 * label would flicker at the edge.
 *
 * Intro and outro are the two the extractor cannot see, because both are
 * about position in the track rather than about the sound. Both are split out
 * of `rest`, so the six still sum to 1: an intro is a quiet passage with
 * nothing behind it, and an outro is a quiet passage with everything behind
 * it.
 *
 * Everything is stepped with the real `dt` and every threshold is a level or
 * a count, so 60 and 144 frames a second read the same weights.
 */
import { F } from '../audio/FeatureExtractor'
import type { Moment } from '../studies/types'

export type MomentWeights = Readonly<Record<Moment, number>>

/** How many sections an intro may survive. By the third, the track has started. */
export const INTRO_SECTIONS = 2

/** Once `recall` has been this high, a passage has come back and the intro is over. */
export const RECALL_HEARD = 0.5

/**
 * What the two rows read when the thing they measure is wholly there. They
 * are levels of evidence and not shares of a moment, and neither reaches 1 on
 * music: `impact` fires when `release` crosses 0.35, and a real drop peaked
 * at 0.41 and a real build at 0.49 on the first track it was tried on. Read
 * raw, a drop was four tenths drop and six tenths groove, so a study written
 * for drops alone scored 0.4 against about 1 for one that suits groove and
 * drop both, and was never cast: not once in three minutes of a real track
 * and not on the scripted song. A build lost the same way. So each row is
 * read against the level that means it is happening, and a drop that fired
 * is a drop.
 */
export const BUILD_FULL = 0.5
export const DROP_FULL = 0.4

/** `swell` is 0.5 when loudness is steady against the last half minute. */
const SWELL_STEADY = 0.5
const SWELL_FALLING = 0.06

/** Seconds of falling before an outro starts to read, and before it reads whole. */
export const OUTRO_FROM_SECONDS = 12
export const OUTRO_TO_SECONDS = 30

/** A track has to have run this long for a quiet fall in it to be an ending. */
export const OUTRO_TRACK_SECONDS = 90

/** A fall that stops recovers faster than it accrued, so one loud bar ends it. */
const OUTRO_RECOVER = 3

/** Under this, `energy` is not music, and nothing about position is stepped. */
const SOUND_FLOOR = 0.02

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

export class MomentReader {
  private readonly value: Record<Moment, number> = {
    intro: 0,
    groove: 1,
    build: 0,
    drop: 0,
    rest: 0,
    outro: 0,
  }

  private heard = 0
  private sections = 0
  private section = 0
  private recalled = false
  private falling = 0

  /** The weights so far. The same object every frame; nothing here allocates. */
  get weights(): MomentWeights {
    return this.value
  }

  /** How many sections have been confirmed, 1 from the first packet with a section in it. */
  get sectionsSeen(): number {
    return this.sections
  }

  step(features: Float32Array, dt: number): MomentWeights {
    if (dt > 0 && (features[F.energy] ?? 0) >= SOUND_FLOOR) this.position(features, dt)
    const release = clamp01((features[F.release] ?? 0) / DROP_FULL)
    // A drop that has fired is the build over. The tension row is slow to let
    // go by design, and is still near its top on the frame of the impact: on
    // a real track that read as build 0.47 and drop 0.53, the build's flow
    // kept its seat on the strength of its margin, and the cut chose the cast
    // that was already there, through both drops of the track. The extractor
    // cuts tension by release itself, but by the raw row, which tops out near
    // 0.4; this is the same cut at the level the release is read at here.
    const tension = clamp01((features[F.tension] ?? 0) / BUILD_FULL) * (1 - release)
    const rest = clamp01(features[F.rest] ?? 0)

    // Groove is the room the other three leave. Past a full frame's worth
    // between them there is no room, and the three share it out instead.
    const held = tension + release + rest
    const scale = held > 1 ? 1 / held : 1
    this.value.build = tension * scale
    this.value.drop = release * scale
    this.value.groove = held > 1 ? 0 : 1 - held

    const quiet = rest * scale
    const intro = quiet * this.introShare()
    const outro = (quiet - intro) * this.outroShare(tension)
    this.value.intro = intro
    this.value.outro = outro
    this.value.rest = quiet - intro - outro
    return this.value
  }

  /** Everything that is about position in the track rather than about the sound. */
  private position(features: Float32Array, dt: number) {
    this.heard += dt
    const section = features[F.section] ?? 0
    if (section > 0 && section !== this.section) {
      this.section = section
      this.sections += 1
    }

    if ((features[F.recall] ?? 0) >= RECALL_HEARD) this.recalled = true

    // `energy` is scaled by its own recent peak, so it sits near 1 through a
    // fade as much as through a chorus and can never show a fall. `swell` is
    // the same loudness against the last half minute, which can.
    const swell = features[F.swell] ?? SWELL_STEADY
    const tension = clamp01(features[F.tension] ?? 0)
    const falling = swell < SWELL_STEADY - SWELL_FALLING && tension < 0.2
    this.falling = Math.max(
      0,
      Math.min(OUTRO_TO_SECONDS, this.falling + (falling ? dt : -dt * OUTRO_RECOVER)),
    )
  }

  /**
   * An intro is a quiet passage with nothing behind it: nothing has come back
   * yet and barely any of the track has been heard. It fades out over the
   * first few sections rather than switching off, so the first boundary is
   * not a step in the weights.
   */
  private introShare(): number {
    if (this.recalled) return 0
    const past = Math.max(0, this.sections - 1)
    return clamp01((INTRO_SECTIONS - past) / INTRO_SECTIONS)
  }

  /**
   * An outro is loudness that has been falling for a long stretch, with
   * nothing winding up, late in a track that has already run for a while.
   *
   * What this can and cannot know. The director is handed packets one frame
   * at a time and is never told how long the track is or how much of it is
   * left, so there is no such thing here as "the last thirty seconds". What
   * it can see is the shape an ending has: a long fall with no tension under
   * it. So it reads a fade-out, a track that thins out over its last chorus,
   * and a long quiet close. It cannot tell any of those from a long quiet
   * passage two thirds of the way through a fifteen-minute mix, which will
   * read as an outro until the music comes back. It cannot see an outro at
   * all in a track under a minute and a half, and it never sees one in a
   * track that ends at full energy on the last beat, which is most of dance
   * music. The weights are shared out, so the cost of missing one is that
   * `rest` keeps the weight instead, which is the next best answer.
   */
  private outroShare(tension: number): number {
    if (this.heard < OUTRO_TRACK_SECONDS) return 0
    const span = OUTRO_TO_SECONDS - OUTRO_FROM_SECONDS
    const fell = clamp01((this.falling - OUTRO_FROM_SECONDS) / span)
    return fell * (1 - tension)
  }
}
