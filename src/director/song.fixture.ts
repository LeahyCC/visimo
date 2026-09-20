/**
 * Whole songs, written as packets. Test material only: nothing in the
 * package imports this, and it lives beside the director because the tests do
 * and this repository keeps its tests next to the code they cover.
 *
 * The director is a thing that happens over minutes, so testing it a frame at
 * a time proves almost nothing. `DANCE` writes the four minutes a rule has to
 * hold across: an intro, a groove, a build, a drop, a breakdown, the groove
 * coming back, and an outro. `METAL` is the shape that one is not: it opens
 * at full energy on its first frame, changes section for the first time
 * nearly half a minute in, has neither a build nor a drop nor a breakdown,
 * and ends as loud as it began. What a song does with the intro and the outro
 * is only ever seen on both. The packet rows they fill are the ones the
 * director reads, and they fill them the way the extractor would, including
 * the two habits that matter most:
 *
 * - `section` is confirmed about six seconds after the music changed, while
 *   `novelty` lifts within a second or two of it. That gap is the whole
 *   reason the director has a fast path and a slow one.
 * - the groove that comes back carries the section id it had the first time,
 *   which is what `recall` is for and what a returning cast is keyed on.
 *
 * Everything is a function of the time alone, so the same song at 60 and at
 * 144 frames a second is the same signal sampled twice rather than two
 * signals that drifted apart.
 */
import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { CHARACTER_AXES } from '../studies/types'
import type { Character } from '../studies/types'
import { rowsForAxis } from './character'

export type PartName =
  | 'intro'
  | 'groove'
  | 'build'
  | 'drop'
  | 'breakdown'
  | 'groove-again'
  | 'outro'
  | 'riff'
  | 'verse'
  | 'chorus'
  | 'verse-again'
  | 'chorus-again'
  | 'finale'

export type Part = {
  name: PartName
  /** When the music changes. */
  at: number
  /** The id the extractor confirms `SECTION_LAG` seconds later. */
  section: number
  /** It is a section coming back, and is recalled for its first ten seconds. */
  returns?: boolean
}

/** The four rows of a part the song alone decides; the rest is the same for any. */
export type Rows = { energy: number; swell: number; tension: number; rest: number }

export type Song = {
  name: string
  parts: readonly Part[]
  seconds: number
  /** Where the drop lands, which is the one frame `impact` fires on. None if it has no drop. */
  dropAt?: number
  /** What the part sounds like `since` seconds into it. */
  rows: (part: Part, since: number) => Rows
}

/** How late the extractor is with a section. The README's figure, near enough. */
export const SECTION_LAG = 6

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

/**
 * `swell` is how loud against the last half minute. A step down reads as a
 * fall only until the half minute catches up with it, which is why the
 * breakdown stops reading as a fall after a few seconds and the outro, which
 * keeps falling, does not.
 */
const danceRows = (part: Part, since: number): Rows => {
  const rows: Rows = { energy: 0.9, swell: 0.5, tension: 0, rest: 0 }
  switch (part.name) {
    case 'intro':
      rows.energy = 0.45
      rows.rest = 0.6
      break
    case 'build':
      rows.energy = clamp01(0.85 + since / 100)
      rows.swell = 0.5 + (0.05 * since) / 16
      rows.tension = Math.min(0.8, since / 8)
      break
    case 'drop':
      rows.energy = 1
      rows.swell = 0.5 + 0.2 * Math.exp(-since / 6)
      break
    case 'breakdown':
      rows.energy = 0.55
      rows.swell = 0.5 - 0.2 * Math.exp(-since / 6)
      rows.rest = 0.7
      break
    case 'outro':
      rows.energy = clamp01(0.7 - since / 180)
      rows.swell = 0.34
      rows.rest = clamp01(0.3 + since / 60)
      break
  }

  return rows
}

/** Loud all the way through: no quiet, no build, and no fall at the end. */
const metalRows = (part: Part): Rows => {
  const loud = part.name === 'chorus' || part.name === 'chorus-again' || part.name === 'finale'
  return { energy: part.name === 'riff' ? 0.95 : loud ? 1 : 0.85, swell: 0.5, tension: 0, rest: 0 }
}

/** Where the drop lands, which is the one frame `impact` fires on. */
export const DROP_AT = 76

/** A club track: it opens quiet, builds, drops, breaks, and thins out at the end. */
export const DANCE: Song = {
  name: 'dance',
  parts: [
    { name: 'intro', at: 0, section: 1 },
    { name: 'groove', at: 20, section: 2 },
    { name: 'build', at: 60, section: 3 },
    { name: 'drop', at: 76, section: 4 },
    { name: 'breakdown', at: 100, section: 5 },
    // The groove comes back, and comes back as the section it was.
    { name: 'groove-again', at: 124, section: 2, returns: true },
    { name: 'outro', at: 168, section: 6 },
  ],
  seconds: 240,
  dropAt: DROP_AT,
  rows: danceRows,
}

/**
 * A heavy track: full energy from the first frame, its first change of
 * section 24 seconds in, and a last section as loud as the first.
 */
export const METAL: Song = {
  name: 'metal',
  parts: [
    { name: 'riff', at: 0, section: 1 },
    { name: 'verse', at: 24, section: 2 },
    { name: 'chorus', at: 56, section: 3 },
    { name: 'verse-again', at: 88, section: 2, returns: true },
    { name: 'chorus-again', at: 120, section: 3, returns: true },
    { name: 'finale', at: 152, section: 4 },
  ],
  seconds: 200,
  rows: metalRows,
}

export const SONGS: readonly Song[] = [DANCE, METAL]

export const PARTS: readonly Part[] = DANCE.parts

export const SONG_SECONDS = DANCE.seconds

/** Three tracks to play the same song as. Only the character rows differ. */
export const LOFI: Character = {
  drive: 0.2,
  weight: 0.7,
  tonality: 0.8,
  steadiness: 0.35,
  hardness: 0.08,
}

export const HOUSE: Character = {
  drive: 0.5,
  weight: 0.5,
  tonality: 0.5,
  steadiness: 0.85,
  hardness: 0.6,
}

export const HARDSTYLE: Character = {
  drive: 0.85,
  weight: 0.45,
  tonality: 0.3,
  steadiness: 0.9,
  hardness: 0.95,
}

export const partAt = (time: number, song: Song = DANCE): Part => {
  let held = song.parts[0] as Part
  for (const part of song.parts) if (time >= part.at) held = part
  return held
}

/** The last section the extractor would have confirmed by now. */
const sectionAt = (time: number, song: Song): number => {
  let held = 0
  for (const part of song.parts) if (time >= part.at + SECTION_LAG) held = part.section
  return held
}

/**
 * A spike at every boundary, of the size the extractor calls a candidate. It
 * lifts on the music and not on the confirmation, which is the point of it.
 */
const noveltyAt = (time: number, song: Song): number => {
  const part = partAt(time, song)
  const since = time - part.at
  if (part.at === 0 || since > 3) return 0
  return since < 1.5 ? 0.6 : 0.6 * (1 - (since - 1.5) / 1.5)
}

/**
 * One packet for one moment of the song, written into `out`. Only the rows
 * the director reads are filled; the rest stay 0, which is what a study's
 * own mapping would read and is nothing to do with the choosing.
 */
export function packetAt(
  time: number,
  dt: number,
  character: Character,
  out = new Float32Array(PACKET_LENGTH),
  song: Song = DANCE,
): Float32Array {
  const part = partAt(time, song)
  const since = time - part.at
  const rows = song.rows(part, since)
  out.fill(0)
  out[F.time] = time
  out[F.dt] = dt
  out[F.energy] = rows.energy
  out[F.swell] = rows.swell
  out[F.novelty] = noveltyAt(time, song)
  out[F.section] = sectionAt(time, song)
  // The groove that comes back recalls the one it is a return of.
  out[F.recall] = part.returns && since < 10 ? 0.9 : 0

  out[F.tension] = rows.tension
  if (song.dropAt !== undefined) {
    const sinceDrop = time - song.dropAt
    out[F.release] = sinceDrop >= 0 && sinceDrop < 24 ? 0.5 * Math.exp(-sinceDrop / 4) : 0
    // 1 on the frame the payoff lands, then the extractor's own 180 ms decay.
    // The flat first fortieth of a second is what keeps the fire on the same
    // beat at 30, 60 and 144 frames a second rather than one frame either way.
    out[F.impact] =
      sinceDrop < 0 || sinceDrop > 2 ? 0 : sinceDrop < 0.04 ? 1 : Math.exp(-sinceDrop / 0.18)
  }

  out[F.rest] = rows.rest
  // The character rows are written through the reader's own inverse, so a
  // song says which character it is and the reading hands that back whole.
  for (const axis of CHARACTER_AXES)
    for (const { row, value } of rowsForAxis(axis, character[axis])) out[row] = value
  return out
}

export type SongFrame = { time: number; dt: number; features: Float32Array }

/**
 * The whole song at one frame rate. The packet is one array written over
 * every frame, so a caller that wants to keep a frame has to copy it.
 */
export function* playSong(
  fps: number,
  character: Character = HOUSE,
  seconds?: number,
  song: Song = DANCE,
): Generator<SongFrame> {
  const dt = 1 / fps
  const out = new Float32Array(PACKET_LENGTH)
  const frames = Math.round((seconds ?? song.seconds) * fps)
  for (let frame = 1; frame <= frames; frame += 1) {
    // frame / fps rather than frame * dt, so a boundary at a whole second is
    // a whole second at every frame rate rather than a float a hair off it.
    const time = frame / fps
    yield { time, dt, features: packetAt(time, dt, character, out, song) }
  }
}
