/**
 * A whole song, written as packets. Test material only: nothing in the
 * package imports this, and it lives beside the director because the tests do
 * and this repository keeps its tests next to the code they cover.
 *
 * The director is a thing that happens over minutes, so testing it a frame at
 * a time proves almost nothing. This writes the four minutes a rule has to
 * hold across: an intro, a groove, a build, a drop, a breakdown, the groove
 * coming back, and an outro. The packet rows it fills are the ones the
 * director reads, and it fills them the way the extractor would, including
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
import type { Character } from '../studies/types'

export type PartName =
  'intro' | 'groove' | 'build' | 'drop' | 'breakdown' | 'groove-again' | 'outro'

export type Part = {
  name: PartName
  /** When the music changes. */
  at: number
  /** The id the extractor confirms `SECTION_LAG` seconds later. */
  section: number
}

/** How late the extractor is with a section. The README's figure, near enough. */
export const SECTION_LAG = 6

export const PARTS: readonly Part[] = [
  { name: 'intro', at: 0, section: 1 },
  { name: 'groove', at: 20, section: 2 },
  { name: 'build', at: 60, section: 3 },
  { name: 'drop', at: 76, section: 4 },
  { name: 'breakdown', at: 100, section: 5 },
  // The groove comes back, and comes back as the section it was.
  { name: 'groove-again', at: 124, section: 2 },
  { name: 'outro', at: 168, section: 6 },
]

export const SONG_SECONDS = 240

/** Where the drop lands, which is the one frame `impact` fires on. */
export const DROP_AT = 76

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

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

export const partAt = (time: number): Part => {
  let held = PARTS[0] as Part
  for (const part of PARTS) if (time >= part.at) held = part
  return held
}

/** The last section the extractor would have confirmed by now. */
const sectionAt = (time: number): number => {
  let held = 0
  for (const part of PARTS) if (time >= part.at + SECTION_LAG) held = part.section
  return held
}

/**
 * A spike at every boundary, of the size the extractor calls a candidate. It
 * lifts on the music and not on the confirmation, which is the point of it.
 */
const noveltyAt = (time: number): number => {
  const part = partAt(time)
  const since = time - part.at
  if (part.at === 0 || since > 3) return 0
  return since < 1.5 ? 0.6 : 0.6 * (1 - (since - 1.5) / 1.5)
}

/**
 * How loud against the last half minute. A step down reads as a fall only
 * until the half minute catches up with it, which is why the breakdown stops
 * reading as a fall after a few seconds and the outro, which keeps falling,
 * does not.
 */
const swellAt = (time: number): number => {
  const part = partAt(time)
  const since = time - part.at
  if (part.name === 'breakdown') return 0.5 - 0.2 * Math.exp(-since / 6)
  if (part.name === 'drop') return 0.5 + 0.2 * Math.exp(-since / 6)
  if (part.name === 'build') return 0.5 + (0.05 * since) / 16
  if (part.name === 'outro') return 0.34
  return 0.5
}

const energyAt = (time: number): number => {
  const part = partAt(time)
  const since = time - part.at
  if (part.name === 'intro') return 0.45
  if (part.name === 'build') return clamp01(0.85 + since / 100)
  if (part.name === 'drop') return 1
  if (part.name === 'breakdown') return 0.55
  if (part.name === 'outro') return clamp01(0.7 - since / 180)
  return 0.9
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
): Float32Array {
  const part = partAt(time)
  const since = time - part.at
  out.fill(0)
  out[F.time] = time
  out[F.dt] = dt
  out[F.energy] = energyAt(time)
  out[F.swell] = swellAt(time)
  out[F.novelty] = noveltyAt(time)
  out[F.section] = sectionAt(time)
  // The groove that comes back recalls the one it is a return of.
  out[F.recall] = part.name === 'groove-again' && since < 10 ? 0.9 : 0

  out[F.tension] = part.name === 'build' ? Math.min(0.8, since / 8) : 0
  const sinceDrop = time - DROP_AT
  out[F.release] = sinceDrop >= 0 && sinceDrop < 24 ? 0.5 * Math.exp(-sinceDrop / 4) : 0
  // 1 on the frame the payoff lands, then the extractor's own 180 ms decay.
  // The flat first fortieth of a second is what keeps the fire on the same
  // beat at 30, 60 and 144 frames a second rather than one frame either way.
  out[F.impact] =
    sinceDrop < 0 || sinceDrop > 2 ? 0 : sinceDrop < 0.04 ? 1 : Math.exp(-sinceDrop / 0.18)

  if (part.name === 'intro') out[F.rest] = 0.6
  else if (part.name === 'breakdown') out[F.rest] = 0.7
  else if (part.name === 'outro') out[F.rest] = clamp01(0.3 + since / 60)

  out[F.pace] = character.drive
  out[F.tempo] = character.drive
  out[F.weight] = character.weight
  out[F.keyClarity] = character.tonality
  out[F.tempoConfidence] = character.steadiness
  out[F.hardness] = character.hardness
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
  seconds = SONG_SECONDS,
): Generator<SongFrame> {
  const dt = 1 / fps
  const out = new Float32Array(PACKET_LENGTH)
  const frames = Math.round(seconds * fps)
  for (let frame = 1; frame <= frames; frame += 1) {
    // frame / fps rather than frame * dt, so a boundary at a whole second is
    // a whole second at every frame rate rather than a float a hair off it.
    const time = frame / fps
    yield { time, dt, features: packetAt(time, dt, character, out) }
  }
}
