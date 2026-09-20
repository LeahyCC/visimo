/**
 * Twenty real tracks, as the character reads them.
 *
 * Every number here was measured and none was chosen: each is the mean of
 * that axis over 60 to 150 seconds of the track, through the real extractor
 * and the real `CharacterReader`, with `scripts/character-table.mjs`. The
 * window opens at a minute because these are slow readings and half of them
 * are still settling at thirty seconds.
 *
 * They are here so a test can ask what a real song gets rather than what a
 * made-up one does. `song.fixture.ts` invents three characters to play a
 * synthetic song as, which is the right tool for asking whether the director
 * changes cast on the beat; it cannot say whether the library covers the
 * music people actually put on. That is what these are for, and the one test
 * that matters is that every study wins a seat somewhere among them.
 *
 * The list is deliberately wide rather than deliberately even: three kinds of
 * metal, four kinds of dance music, hip hop, folk, an orchestral cue and an
 * ambient piece. Remeasure and rewrite them if the reading changes; they are
 * a record of what the character does today, not a contract.
 */
import type { Character } from '../studies/types'

export type TrackCharacter = {
  /** Artist and title, for a failing test to name. */
  name: string
  /** What a listener would call it. */
  kind: string
  character: Character
}

export const TRACKS: readonly TrackCharacter[] = [
  {
    name: 'Bring Me The Horizon, Antivist',
    kind: 'metal',
    character: { drive: 0.6, weight: 0.34, tonality: 0.11, steadiness: 0.44, hardness: 0.65 },
  },
  {
    name: 'Whitechapel, Prisoner 666',
    kind: 'deathcore',
    character: { drive: 0.39, weight: 0.51, tonality: 0.18, steadiness: 0.32, hardness: 0.53 },
  },
  {
    name: 'August Burns Red, Thirty and Seven',
    kind: 'metalcore',
    character: { drive: 0.64, weight: 0.31, tonality: 0.11, steadiness: 0.59, hardness: 0.71 },
  },
  {
    name: 'Pendulum, The Terminal',
    kind: 'drum and bass',
    character: { drive: 0.53, weight: 0.22, tonality: 0.22, steadiness: 0.66, hardness: 0.7 },
  },
  {
    name: 'Noisia, Nova (Red Bull Symphonic)',
    kind: 'drum and bass with an orchestra',
    character: { drive: 0.37, weight: 0.62, tonality: 0.59, steadiness: 0.65, hardness: 0.34 },
  },
  {
    name: 'Subtronics, Final Breath',
    kind: 'dubstep',
    character: { drive: 0.69, weight: 0.18, tonality: 0.39, steadiness: 0.52, hardness: 0.75 },
  },
  {
    name: 'FISHER, Freaks',
    kind: 'house',
    character: { drive: 0.64, weight: 0.45, tonality: 0.21, steadiness: 0.92, hardness: 0.49 },
  },
  {
    name: 'John Summit, Go Back',
    kind: 'tech house',
    character: { drive: 0.53, weight: 0.32, tonality: 0.82, steadiness: 0.68, hardness: 0.56 },
  },
  {
    name: 'Daft Punk, Adagio For TRON',
    kind: 'orchestral',
    character: { drive: 0.17, weight: 0.82, tonality: 0.69, steadiness: 0.03, hardness: 0.06 },
  },
  {
    name: 'Mac Miller, Frick Park Market',
    kind: 'hip hop',
    character: { drive: 0.66, weight: 0.54, tonality: 0.52, steadiness: 0.42, hardness: 0.41 },
  },
  {
    name: 'Skepta, Back 2 Back',
    kind: 'grime',
    character: { drive: 0.49, weight: 0.47, tonality: 0.03, steadiness: 0.29, hardness: 0.43 },
  },
  {
    name: 'Emancipator, Baralku',
    kind: 'downtempo',
    character: { drive: 0.71, weight: 0.78, tonality: 0.8, steadiness: 0.72, hardness: 0.1 },
  },
  {
    name: 'Christian Loffler, Mosaics',
    kind: 'ambient house',
    character: { drive: 0.3, weight: 0.99, tonality: 0.79, steadiness: 0.56, hardness: 0.0 },
  },
  {
    name: 'Jon Hopkins, To Feel Again',
    kind: 'ambient',
    character: { drive: 0.62, weight: 0.64, tonality: 0.83, steadiness: 0.71, hardness: 0.15 },
  },
  {
    name: "Kate McGill, It's True",
    kind: 'acoustic',
    character: { drive: 0.81, weight: 0.56, tonality: 0.68, steadiness: 0.81, hardness: 0.28 },
  },
  {
    name: 'Wilco, Hell Is Chrome',
    kind: 'folk rock',
    character: { drive: 0.13, weight: 0.79, tonality: 0.77, steadiness: 0.28, hardness: 0.04 },
  },
  {
    name: 'The Weeknd, Alone Again',
    kind: 'pop',
    character: { drive: 0.29, weight: 0.6, tonality: 0.68, steadiness: 0.09, hardness: 0.28 },
  },
  {
    name: "Umphrey's McGee, In the Kitchen",
    kind: 'jam and funk',
    character: { drive: 0.5, weight: 0.62, tonality: 0.66, steadiness: 0.64, hardness: 0.13 },
  },
  {
    name: 'Radiohead, Skttrbrain (Four Tet remix)',
    kind: 'idm remix',
    character: { drive: 0.51, weight: 0.52, tonality: 0.72, steadiness: 0.48, hardness: 0.17 },
  },
  {
    name: 'Ecstasy Of Soul',
    kind: "the demo's dance track",
    character: { drive: 0.33, weight: 0.18, tonality: 0.34, steadiness: 0.5, hardness: 0.79 },
  },
]
