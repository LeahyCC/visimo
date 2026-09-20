import { describe, expect, it } from 'vitest'

import { F, IMPACT_DECAY_SECONDS, PACKET_LENGTH } from '../../src/audio/FeatureExtractor'
import { BENCH_ROWS, overridePacket, overridesFor, ROWS_OF, stepImpact } from './packet'

const filled = () => Float32Array.from({ length: PACKET_LENGTH }, (_, at) => 0.001 * (at + 1))

describe('overridePacket', () => {
  it('hands back the packet it was given, changed in place', () => {
    const packet = filled()
    const out = overridePacket(packet, [{ row: F.tension, value: 0.9, mode: 'set' }])
    expect(out).toBe(packet)
    expect(packet[F.tension]).toBeCloseTo(0.9)
  })

  it('touches the rows it is told to and nothing else', () => {
    const packet = filled()
    const before = packet.slice()
    overridePacket(packet, overridesFor({ tension: 0.8, hardness: 0.2 }, false))
    const touched = new Set<number>([F.tension, F.hardness])
    for (let row = 0; row < PACKET_LENGTH; row += 1)
      if (!touched.has(row)) expect(packet[row]).toBe(before[row])
    expect(packet[F.tension]).toBeCloseTo(0.8)
    expect(packet[F.hardness]).toBeCloseTo(0.2)
  })

  it('raises a row without ever lowering it, so a real impact under a fired one stays a 1', () => {
    const packet = filled()
    packet[F.impact] = 1
    overridePacket(packet, [{ row: F.impact, value: 0.4, mode: 'raise' }])
    expect(packet[F.impact]).toBe(1)
    packet[F.impact] = 0
    overridePacket(packet, [{ row: F.impact, value: 0.4, mode: 'raise' }])
    expect(packet[F.impact]).toBeCloseTo(0.4)
  })

  it('ignores a row that is not in the packet', () => {
    const packet = filled()
    const before = packet.slice()
    overridePacket(packet, [
      { row: -1, value: 1, mode: 'set' },
      { row: PACKET_LENGTH, value: 1, mode: 'set' },
    ])
    expect(packet).toEqual(before)
  })

  it('does nothing with no overrides', () => {
    const packet = filled()
    const before = packet.slice()
    overridePacket(packet, [])
    expect(packet).toEqual(before)
  })
})

describe('overridesFor', () => {
  it('writes only the controls that are held over a live packet', () => {
    expect(overridesFor({}, false)).toEqual([])
    const rows = overridesFor({ release: 0.5 }, false).map((entry) => entry.row)
    expect(rows).toEqual([F.release])
  })

  it('writes every control over a synthetic packet, at rest where nothing holds it', () => {
    const packet = new Float32Array(PACKET_LENGTH)
    overridePacket(packet, overridesFor({ tension: 0.7 }, true))
    expect(packet[F.tension]).toBeCloseTo(0.7)
    expect(packet[F.release]).toBe(0)
    expect(packet[F.rest]).toBe(0)
    // An axis nobody holds is no opinion, and no opinion is the middle.
    expect(packet[F.weight]).toBeCloseTo(0.5)
    expect(packet[F.hardness]).toBeCloseTo(0.5)
  })

  it('writes drive to both rows the character reader averages, so it reads back whole', () => {
    const packet = new Float32Array(PACKET_LENGTH)
    overridePacket(packet, overridesFor({ drive: 0.8 }, false))
    expect(packet[F.pace]).toBeCloseTo(0.8)
    expect(packet[F.tempo]).toBeCloseTo(0.8)
  })

  it('keeps a value inside 0 to 1, since a hash can say anything', () => {
    const packet = new Float32Array(PACKET_LENGTH)
    overridePacket(packet, overridesFor({ tension: 7, rest: -3 }, false))
    expect(packet[F.tension]).toBe(1)
    expect(packet[F.rest]).toBe(0)
  })

  it('gives every control at least one row, and no two of them the same row', () => {
    const seen = new Set<number>()
    for (const key of BENCH_ROWS) {
      expect(ROWS_OF[key].length).toBeGreaterThan(0)
      for (const row of ROWS_OF[key]) {
        expect(seen.has(row)).toBe(false)
        seen.add(row)
      }
    }
  })
})

describe('stepImpact', () => {
  it('is 1 on the frame it is fired, whatever it was before', () => {
    expect(stepImpact(0, true, 1 / 60)).toBe(1)
    expect(stepImpact(0.3, true, 1 / 60)).toBe(1)
  })

  it('falls the way the extractor does: to 1/e in its own decay time', () => {
    let level = stepImpact(0, true, 1 / 60)
    const frames = Math.round(IMPACT_DECAY_SECONDS * 60)
    for (let frame = 0; frame < frames; frame += 1) level = stepImpact(level, false, 1 / 60)
    expect(level).toBeCloseTo(Math.exp(-1), 1)
  })

  it('falls the same at any frame rate', () => {
    const after = (fps: number) => {
      let level = 1
      for (let frame = 0; frame < Math.round(0.36 * fps); frame += 1)
        level = stepImpact(level, false, 1 / fps)
      return level
    }

    expect(after(30)).toBeCloseTo(after(144), 2)
  })
})
