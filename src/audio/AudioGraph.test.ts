import { describe, expect, it } from 'vitest'

import { MIN_VOLUME, volumeGains } from './AudioGraph'

describe('volumeGains', () => {
  // The whole point: whatever the listener set, the analyser is handed the
  // track at full level and the speakers are handed what was asked for.
  it('undoes the volume before the analyser and puts it back after', () => {
    for (const volume of [1, 0.5, 0.2, 0.08, MIN_VOLUME]) {
      const { trim, level } = volumeGains(volume)
      expect(volume * trim).toBeCloseTo(1, 6)
      expect(trim * level).toBeCloseTo(1, 6)
    }
  })

  it('is a wire at full volume', () => {
    expect(volumeGains(1)).toEqual({ trim: 1, level: 1 })
  })

  // Under the floor the lift stops growing, and nothing is ever made louder
  // than the element asked for: the product is still 1.
  it('stops lifting under the quietest volume it undoes', () => {
    const { trim, level } = volumeGains(0)
    expect(trim).toBeCloseTo(1 / MIN_VOLUME)
    expect(trim * level).toBeCloseTo(1, 6)
  })

  it('reads a volume that is not one as full', () => {
    for (const volume of [NaN, Infinity, -1, 4]) {
      const { trim, level } = volumeGains(volume)
      expect(Number.isFinite(trim)).toBe(true)
      expect(trim * level).toBeCloseTo(1, 6)
    }
    expect(volumeGains(NaN)).toEqual({ trim: 1, level: 1 })
  })
})
