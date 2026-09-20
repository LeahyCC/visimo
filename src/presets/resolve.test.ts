import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { AUDIO_FIELDS } from './knobs'
import { bend, feature } from './resolve'

const packet = (values: Partial<Record<keyof typeof F, number>>) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

describe('feature', () => {
  it('reads the packet by name', () => {
    expect(feature(packet({ treble: 0.4 }), 'treble')).toBeCloseTo(0.4)
    expect(feature(packet({ beatPulse: 1 }), 'beatPulse')).toBe(1)
  })

  // The vocabulary and the packet are two lists that have to stay in step; a
  // name in one and not the other is how a preset silently reads a zero.
  it('reads every name the vocabulary offers out of the packet', () => {
    for (const field of AUDIO_FIELDS) {
      if (field === 'lowEnd') continue
      const at = F[field]
      expect(at).toBeLessThan(PACKET_LENGTH)
      expect(feature(packet({ [field]: 0.7 }), field)).toBeCloseTo(0.7)
    }
  })

  it('gives lowEnd the louder of sub and bass', () => {
    expect(feature(packet({ sub: 0.2, bass: 0.7 }), 'lowEnd')).toBeCloseTo(0.7)
    expect(feature(packet({ sub: 0.9, bass: 0.1 }), 'lowEnd')).toBeCloseTo(0.9)
  })
})

describe('bend', () => {
  it('keeps 0 at 0 and 1 at 1 except where inverting', () => {
    for (const curve of ['linear', 'square', 'sqrt'] as const) {
      expect(bend(0, curve)).toBe(0)
      expect(bend(1, curve)).toBeCloseTo(1)
    }

    expect(bend(0, 'invert')).toBe(1)
    expect(bend(1, 'invert')).toBe(0)
  })

  it('squares and roots in between', () => {
    expect(bend(0.5, 'square')).toBeCloseTo(0.25)
    expect(bend(0.25, 'sqrt')).toBeCloseTo(0.5)
  })

  it('never lets a negative feature through', () => {
    expect(bend(-1, 'linear')).toBe(0)
    expect(bend(-1, 'square')).toBe(0)
    expect(bend(-1, 'sqrt')).toBe(0)
    expect(bend(-1, 'invert')).toBe(1)
  })
})
