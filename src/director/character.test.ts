import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { CHARACTER_AXES } from '../studies/types'
import type { Character } from '../studies/types'
import { CharacterReader, NEUTRAL_CHARACTER, rowsForAxis } from './character'

const packet = (values: Partial<Record<keyof typeof F, number>>) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

/**
 * A packet that reads back as this character, loud enough to be heard. The
 * rows are worked out by `rowsForAxis`, which is the inverse of the reading
 * under test, so a test says which axis it means and not which row.
 */
const track = (character: Character) => {
  const out = packet({ energy: 0.9 })
  for (const axis of CHARACTER_AXES)
    for (const { row, value } of rowsForAxis(axis, character[axis])) out[row] = value
  return out
}

/** A track with an opinion on every axis. */
const TRACK = track({
  drive: 0.7,
  weight: 0.2,
  tonality: 0.9,
  steadiness: 0.85,
  hardness: 0.95,
})

const play = (reader: CharacterReader, features: Float32Array, seconds: number, fps: number) => {
  const dt = 1 / fps
  for (let frame = 0; frame < Math.round(seconds * fps); frame += 1) reader.step(features, dt)
  return reader.character
}

describe('CharacterReader', () => {
  it('starts neutral and knows it has heard nothing', () => {
    const reader = new CharacterReader()
    expect(reader.character).toEqual(NEUTRAL_CHARACTER)
    expect(reader.settled).toBe(0)
  })

  it('starts where a host that knows the track says, on the axes it names', () => {
    const reader = new CharacterReader({ start: { hardness: 0.9 } })
    expect(reader.character.hardness).toBe(0.9)
    expect(reader.character.drive).toBe(0.5)
    // Still a guess: a host's tag is where the drift starts, not a reading.
    expect(reader.settled).toBe(0)
  })

  it('drifts to where the packet says over tens of seconds', () => {
    const reader = new CharacterReader()
    play(reader, TRACK, 4, 60)
    const early = { ...reader.character }
    expect(early.hardness).toBeGreaterThan(0.5)
    expect(early.hardness).toBeLessThan(0.75)
    play(reader, TRACK, 116, 60)
    expect(reader.character.hardness).toBeGreaterThan(0.9)
    expect(reader.character.weight).toBeLessThan(0.25)
    expect(reader.character.tonality).toBeGreaterThan(0.8)
    expect(reader.character.steadiness).toBeGreaterThan(0.8)
    // drive is pace and tempo together.
    expect(reader.character.drive).toBeCloseTo(0.7, 1)
  })

  it('reads drive from pace alone until the tempo tracker has settled', () => {
    const reader = new CharacterReader()
    play(reader, packet({ energy: 0.9, pace: 0.8, tempo: 0 }), 120, 60)
    expect(reader.character.drive).toBeGreaterThan(0.75)
  })

  // Tonality and steadiness answer "is this being heard clearly now" rather
  // than "is this track tonal", so they are averaged over longer.
  it('moves tonality and steadiness slower than the rest', () => {
    const reader = new CharacterReader()
    play(reader, TRACK, 15, 60)
    const character = reader.character
    expect(character.hardness - 0.5).toBeGreaterThan(character.tonality - 0.5)
  })

  it('settles over the first half minute of sound and not before', () => {
    const reader = new CharacterReader()
    play(reader, TRACK, 9, 60)
    expect(reader.settled).toBe(0)
    play(reader, TRACK, 11, 60)
    expect(reader.settled).toBeCloseTo(0.5, 2)
    play(reader, TRACK, 11, 60)
    expect(reader.settled).toBe(1)
  })

  it('holds everything through silence, and the settle clock with it', () => {
    const reader = new CharacterReader()
    play(reader, TRACK, 20, 60)
    const heard = reader.heardSeconds
    const held: Character = { ...reader.character }
    play(reader, packet({ energy: 0, hardness: 0 }), 30, 60)
    expect(reader.heardSeconds).toBe(heard)
    for (const axis of CHARACTER_AXES) expect(reader.character[axis]).toBe(held[axis])
  })

  // A one-pole over the real dt settles on the same number at the same second
  // whatever the display is doing.
  it('reads the same at 60 and at 144 frames a second', () => {
    const slow = new CharacterReader()
    const fast = new CharacterReader()
    play(slow, TRACK, 90, 60)
    play(fast, TRACK, 90, 144)
    for (const axis of CHARACTER_AXES)
      expect(fast.character[axis]).toBeCloseTo(slow.character[axis], 6)
    expect(fast.settled).toBeCloseTo(slow.settled, 6)
  })
})
