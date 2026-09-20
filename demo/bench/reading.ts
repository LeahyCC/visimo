/**
 * What the director would cast for the packet the bench is writing, as if the
 * song had already settled there. The director's own reading is smoothed over
 * tens of seconds and its moment weights depend on where in a track it is, so
 * watching it follow a slider would mean waiting half a minute per change.
 * This asks the same two readers the same question with the smoothing
 * removed: the character is snapped to what the packet's rows say, and the
 * moment is read as mid-track, so a high `rest` is the rest and not an intro.
 * Then it asks `pickCast` what it would put on screen.
 *
 * It is a preview of the choice, and the picture the bench draws is whatever
 * its slots say, so the two can be compared side by side.
 */
import { F } from '../../src/audio/FeatureExtractor'
import { CharacterReader } from '../../src/director/character'
import { pickCast } from '../../src/director/director'
import type { PickedCast } from '../../src/director/director'
import { MomentReader } from '../../src/director/moment'
import type { MomentWeights } from '../../src/director/moment'
import type { Character } from '../../src/presets'

export type Reading = {
  character: Character
  weights: MomentWeights
  cast: PickedCast | undefined
}

/** Longer than any smoother's time constant, so one step lands on the target. */
const SNAP_SECONDS = 1e6

/** Under the sound floor a reader holds where it was, which would read a silent bench as neutral. */
const AUDIBLE = 0.5

export function readingOf(packet: Float32Array): Reading {
  // A copy the readers may be told white lies on, since the packet is the
  // bench's own and is drawn from.
  const heard = packet.slice()
  heard[F.energy] = Math.max(heard[F.energy] ?? 0, AUDIBLE)
  const character = { ...new CharacterReader().step(heard, SNAP_SECONDS) }
  // A passage that has come back is past its intro, which is what mid-track means.
  heard[F.recall] = 1
  const weights = { ...new MomentReader().step(heard, 1) }
  return { character, weights, cast: pickCast({ character, weights, settled: 1 }) }
}
