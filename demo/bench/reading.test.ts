import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../../src/audio/FeatureExtractor'
import { MOMENTS } from '../../src/presets'
import { overridePacket, overridesFor } from './packet'
import { readingOf } from './reading'

const packetWith = (held: Parameters<typeof overridesFor>[0]) => {
  const packet = new Float32Array(PACKET_LENGTH)
  packet[F.energy] = 0.7
  return overridePacket(packet, overridesFor(held, true))
}

describe('readingOf', () => {
  it('reads the character the sliders set, with no smoothing to wait out', () => {
    const { character } = readingOf(
      packetWith({ drive: 0.9, weight: 0.2, tonality: 0.7, steadiness: 0.1, hardness: 0.8 }),
    )
    expect(character.drive).toBeCloseTo(0.9, 2)
    expect(character.weight).toBeCloseTo(0.2, 2)
    expect(character.tonality).toBeCloseTo(0.7, 2)
    expect(character.steadiness).toBeCloseTo(0.1, 2)
    expect(character.hardness).toBeCloseTo(0.8, 2)
  })

  it('reads the moment the sliders set, and shares one whole frame between the six', () => {
    const { weights } = readingOf(packetWith({ tension: 0.3 }))
    expect(weights.build).toBeCloseTo(0.3, 2)
    expect(weights.groove).toBeCloseTo(0.7, 2)
    expect(MOMENTS.reduce((sum, moment) => sum + weights[moment], 0)).toBeCloseTo(1, 6)
  })

  it('reads a high rest as the rest and not as an intro', () => {
    const { weights } = readingOf(packetWith({ rest: 0.8 }))
    expect(weights.rest).toBeCloseTo(0.8, 2)
    expect(weights.intro).toBe(0)
  })

  it('casts something for a build and something else for a drop', () => {
    const build = readingOf(packetWith({ tension: 1 })).cast
    const drop = readingOf(packetWith({ release: 1 })).cast
    expect(build?.inks.length).toBeGreaterThan(0)
    expect(drop?.inks.length).toBeGreaterThan(0)
    expect(build?.look).toBeTruthy()
  })

  it('is the same answer for the same packet, and leaves the packet alone', () => {
    const packet = packetWith({ tension: 0.5, drive: 0.3 })
    const before = packet.slice()
    expect(readingOf(packet)).toEqual(readingOf(packet))
    expect(packet).toEqual(before)
  })
})
