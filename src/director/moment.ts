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
 * about position in the track rather than about the sound. Both are taken out
 * of what build and drop leave, so the six still sum to 1. An intro is where
 * the track has only just begun, however loud it is: it is read off how much
 * has been heard and how many sections have been confirmed, so a track that
 * opens at full energy has one too, at half the weight (`INTRO_LOUD_SHARE`). An
 * outro is where the track is ending, and how much of that can be known
 * depends on the host. Given the playhead and the length it is the last
 * stretch of the track, loud or quiet. Given neither it is the shape an
 * ending has, a long fall in loudness, which is all the director can see of
 * an ending on its own.
 *
 * Everything is stepped with the real `dt` and every threshold is a level or
 * a count, so 60 and 144 frames a second read the same weights.
 */
import { F } from '../audio/FeatureExtractor'
import type { Moment } from '../studies/types'

export type MomentWeights = Readonly<Record<Moment, number>>

/**
 * What a host that plays a file knows. An audio element has exactly this
 * shape, so a host can hand its element in as it is.
 */
export type Playhead = { readonly currentTime: number; readonly duration: number }

/**
 * How long an intro is read to last, in seconds heard. Real intros run from
 * about 8 seconds (a count-in and a riff, a fill and a verse) to about 30 (a
 * long pad, a slow build in on a club track). An opening is wholly an intro
 * for the shortest of them, since no track has started before then whatever
 * it is doing, and has handed over wholly by the longest.
 */
export const INTRO_FULL_SECONDS = 8
export const INTRO_GONE_SECONDS = 30

/**
 * How much of a loud opening is an intro. A quiet opening is wholly one, but
 * every study made for an intro was made for a quiet one and dims as the music
 * gets loud, so a riff at full energy read as all intro was handed curl drift
 * and dust for its first half minute, which is an empty picture under the
 * loudest part of the track. A loud opening keeps the rest as groove, so the
 * studies of the track's own character can win it and the intro still shows.
 */
export const INTRO_LOUD_SHARE = 0.5

/** How many sections an intro may survive. By the third, the track has started. */
export const INTRO_SECTIONS = 2

/**
 * Once `recall` has been this high, a passage has come back and the intro is
 * over. A recall needs a whole section to have ended and returned, so it is
 * late and it is certain, and it cuts the intro off outright.
 */
export const RECALL_HEARD = 0.5

/**
 * How long the sections take to hand the intro over, from none confirmed to
 * `INTRO_SECTIONS` past the first. A count only steps at a boundary, and a
 * boundary is confirmed about six seconds after the music changed, so the
 * count is eased in rather than read: nothing in the weights steps when one
 * lands.
 */
const INTRO_HANDOVER_SECONDS = 6

/**
 * A short track has a short intro: a punk song of a minute has a count-in and
 * not half a minute of it. With the length known, the spans above are scaled
 * by how much of a typical three minute track this one is, down to a floor,
 * since a track has to be almost nothing for its intro to shrink to nothing.
 */
export const INTRO_TRACK_SECONDS = 180
const INTRO_MIN_SCALE = 0.25

/**
 * With the length known, the last tenth of a track is where its outro is:
 * twenty seconds of a three and a half minute song. A short track gets a
 * short one and a long mix does not get five minutes of it, so the stretch is
 * kept between these two. It leans in over its first half, so the middle of
 * the stretch is already wholly an outro and not about to be.
 */
export const OUTRO_LAST_SHARE = 0.1
export const OUTRO_MIN_STRETCH_SECONDS = 4
export const OUTRO_MAX_STRETCH_SECONDS = 30
const OUTRO_LEAN_IN = 0.5

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

/**
 * The track's length, or 0 when there is none to use. An element reports NaN
 * until its metadata has loaded and Infinity for a stream, and a host may hand
 * in anything, so only a real length counts and everything else reads as a
 * host that gave none.
 */
const lengthOf = (playhead: Playhead | undefined): number =>
  playhead !== undefined && Number.isFinite(playhead.duration) && playhead.duration > 0
    ? playhead.duration
    : 0

/** Where the playhead is in seconds, or 0 when what it says is not a position. */
const positionOf = (playhead: Playhead | undefined): number =>
  playhead !== undefined && Number.isFinite(playhead.currentTime)
    ? Math.max(0, playhead.currentTime)
    : 0

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
  /** How far the sections have handed the intro over, 0 to 1, and never back. */
  private started = 0

  /** The weights so far. The same object every frame; nothing here allocates. */
  get weights(): MomentWeights {
    return this.value
  }

  /** How many sections have been confirmed, 1 from the first packet with a section in it. */
  get sectionsSeen(): number {
    return this.sections
  }

  /**
   * `playhead` is optional and is read fresh every frame, so a host can hand
   * in the same object each time and let it change under the reader. Without
   * one, nothing here knows where in the track we are or how long it is.
   */
  step(features: Float32Array, dt: number, playhead?: Playhead): MomentWeights {
    if (dt > 0 && (features[F.energy] ?? 0) >= SOUND_FLOOR) this.position(features, dt)
    const release = clamp01(features[F.release] ?? 0)
    // A drop that has fired is the build over. The tension row is slow to let
    // go by design, and is still near its top on the frame of the impact: on
    // a real track that read as build 0.47 and drop 0.53, the build's flow
    // kept its seat on the strength of its margin, and the cut chose the cast
    // that was already there, through both drops of the track. The extractor
    // cuts tension by release itself, but by the raw row, which tops out near
    // 0.4; this is the same cut at the level the release is read at here.
    const tension = clamp01(features[F.tension] ?? 0) * (1 - release)
    const rest = clamp01(features[F.rest] ?? 0)

    // Groove is the room the other three leave. Past a full frame's worth
    // between them there is no room, and the three share it out instead.
    const held = tension + release + rest
    const scale = held > 1 ? 1 / held : 1
    this.value.build = tension * scale
    this.value.drop = release * scale

    // Intro and outro are cut from what is left, room and rest alike, and
    // never from build or drop: a track that opens on a build, or fires an
    // impact in its first seconds, still reads a build or a drop.
    const room = held > 1 ? 0 : 1 - held
    const quiet = rest * scale
    const length = lengthOf(playhead)
    const position = length > 0 ? positionOf(playhead) : 0
    const intro = this.introShare(length, position)
    const introRoom = room * intro * INTRO_LOUD_SHARE
    const roomLeft = room - introRoom
    const quietLeft = quiet * (1 - intro)

    // Position takes the room and the quiet alike, which is how a loud ending
    // can be an outro. The shape of a fall is only ever a quiet passage, so it
    // takes from `rest` alone, as it always has, and where both read the
    // stronger of the two wins.
    const ending = this.endingShare(length, position, tension)
    const outroRoom = roomLeft * ending
    const outroQuiet = quietLeft * Math.max(ending, this.outroShare(tension))
    this.value.intro = introRoom + quiet * intro
    this.value.groove = roomLeft - outroRoom
    this.value.rest = quietLeft - outroQuiet
    this.value.outro = outroRoom + outroQuiet
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

    const past = clamp01((this.sections - 1) / INTRO_SECTIONS)
    this.started = Math.min(past, this.started + dt / INTRO_HANDOVER_SECONDS)

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
   * An intro is where the track is and not how quiet it is: barely any of it
   * has been heard and nothing has come back yet. A track that opens loud,
   * which is most heavy music and a lot else, is in its intro as much as one
   * that opens on a pad, and its first seconds are not groove.
   *
   * Two things end it and the nearer wins. The clock, since no intro runs
   * past about half a minute, which needs no section to have been confirmed
   * and so serves a track that goes straight into its verse. And the sections:
   * the first change is the sign the track has started, and a passage coming
   * back is a certain one. Both are eased and not stepped, so nothing in the
   * weights jumps as a boundary is confirmed.
   *
   * `heard` counts sound only, so silence before the first note is not intro
   * time used up. With the playhead the clock is the later of that and the
   * position, so a seek to the middle of a track does not start it again
   * from an opening the listener has skipped.
   */
  private introShare(length: number, position: number): number {
    if (this.recalled) return 0
    const scale =
      length > 0 ? Math.max(INTRO_MIN_SCALE, Math.min(1, length / INTRO_TRACK_SECONDS)) : 1
    const from = INTRO_FULL_SECONDS * scale
    const to = INTRO_GONE_SECONDS * scale
    const clock = 1 - clamp01((Math.max(this.heard, position) - from) / (to - from))
    return Math.min(clock, 1 - this.started)
  }

  /**
   * The last stretch of the track, read off the playhead, or 0 when the host
   * has given none. It is cut by tension, so a track that ends on a build, or
   * is still winding up in its last seconds, is not called an outro while it
   * winds. How long the stretch is scales with the track: see `OUTRO_LAST_SHARE`.
   */
  private endingShare(length: number, position: number, tension: number): number {
    if (length <= 0) return 0
    const stretch = Math.min(
      OUTRO_MAX_STRETCH_SECONDS,
      Math.max(OUTRO_MIN_STRETCH_SECONDS, length * OUTRO_LAST_SHARE),
    )
    const left = Math.max(0, length - position)
    return clamp01((stretch - left) / (stretch * OUTRO_LEAN_IN)) * (1 - tension)
  }

  /**
   * The shape of an ending, for a host that gave no playhead: loudness that
   * has been falling for a long stretch, with nothing winding up, late in a
   * track that has already run for a while. It still reads beside
   * `endingShare` when there is one, and the stronger of the two wins.
   *
   * What this can and cannot know without the length. The director is handed
   * packets one frame at a time, so unless the host says otherwise there is no
   * such thing here as "the last thirty seconds". What it can see is the shape
   * an ending has: a long fall with no tension under it. So it reads a
   * fade-out, a track that thins out over its last chorus, and a long quiet
   * close. It cannot tell any of those from a long quiet passage two thirds of
   * the way through a fifteen-minute mix, which will read as an outro until
   * the music comes back. It cannot see an outro at all in a track under a
   * minute and a half, and it never sees one in a track that ends at full
   * energy on the last beat, which is most of dance music. The weights are
   * shared out, so the cost of missing one is that `rest` keeps the weight
   * instead, which is the next best answer.
   *
   * A host that gives the playhead and the length has the last two of those
   * problems solved: `endingShare` wants neither a fall nor a minute and a
   * half, and the last stretch of a track that ends loud is an outro all the
   * same. The first stays, since this reading is not gated by position and a
   * fall in the middle of a mix still looks like an ending to it.
   */
  private outroShare(tension: number): number {
    if (this.heard < OUTRO_TRACK_SECONDS) return 0
    const span = OUTRO_TO_SECONDS - OUTRO_FROM_SECONDS
    const fell = clamp01((this.falling - OUTRO_FROM_SECONDS) / span)
    return fell * (1 - tension)
  }
}
