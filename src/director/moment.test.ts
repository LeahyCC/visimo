import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { MOMENTS } from '../studies/types'
import { BUILD_FULL, DROP_FULL, MomentReader, OUTRO_TRACK_SECONDS } from './moment'
import type { MomentWeights } from './moment'

const packet = (values: Partial<Record<keyof typeof F, number>>) => {
  const out = new Float32Array(PACKET_LENGTH)
  out[F.energy] = 0.8
  out[F.swell] = 0.5
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

const play = (reader: MomentReader, features: Float32Array, seconds: number, fps: number) => {
  const dt = 1 / fps
  for (let frame = 0; frame < Math.round(seconds * fps); frame += 1) reader.step(features, dt)
  return reader.weights
}

const total = (weights: MomentWeights) => MOMENTS.reduce((sum, at) => sum + weights[at], 0)

describe('MomentReader', () => {
  it('always shares one whole frame out between the six', () => {
    const reader = new MomentReader()
    for (const features of [
      packet({}),
      packet({ tension: 0.8 }),
      packet({ release: 0.6, tension: 0.2 }),
      packet({ rest: 0.9 }),
      // More between them than there is to share: they split it rather than
      // overflowing, and groove is what is left, which is nothing.
      packet({ tension: 0.9, release: 0.9, rest: 0.9 }),
    ]) {
      const weights = reader.step(features, 1 / 60)
      expect(total(weights)).toBeCloseTo(1, 6)
      expect(weights.groove).toBeGreaterThanOrEqual(0)
    }
  })

  it('is all groove when nothing else is happening', () => {
    const reader = new MomentReader()
    expect(play(reader, packet({ section: 2, recall: 0.9 }), 2, 60).groove).toBeCloseTo(1)
  })

  // Each row is read against the level that means it is wholly happening,
  // since neither reaches 1 on music: `impact` fires at a release of 0.35.
  it('reads a build from tension and a drop from release, against what each reads when full', () => {
    const reader = new MomentReader()
    const half = reader.step(packet({ tension: BUILD_FULL / 2, section: 3, recall: 0.9 }), 1 / 60)
    expect(half.build).toBeCloseTo(0.5)
    expect(half.groove).toBeCloseTo(0.5)
    const drop = reader.step(packet({ release: DROP_FULL / 2, section: 4, recall: 0.9 }), 1 / 60)
    expect(drop.drop).toBeCloseTo(0.5)
    expect(drop.build).toBe(0)
  })

  // What a drop-only study needs in order to be cast at all. Read raw, a real
  // drop was 0.41 drop and 0.59 groove, and a study for groove and drop both
  // outscored it every time.
  it('reads a drop that fired as a whole drop, and a real build as a whole build', () => {
    const reader = new MomentReader()
    const drop = reader.step(packet({ release: 0.41, section: 4, recall: 0.9 }), 1 / 60)
    expect(drop.drop).toBeCloseTo(1)
    expect(drop.groove).toBeCloseTo(0)
    const build = reader.step(packet({ tension: 0.7, section: 3, recall: 0.9 }), 1 / 60)
    expect(build.build).toBeCloseTo(1)
  })

  // Seen on a real track: tension was still 0.41 on the frame of the impact,
  // the moment read as build 0.47 and drop 0.53, and the build's flow kept
  // its seat through both drops.
  it('ends the build when the drop fires, however slow tension is to let go', () => {
    const reader = new MomentReader()
    const landed = reader.step(
      packet({ tension: 0.41, release: 0.37, section: 4, recall: 0.9 }),
      1 / 60,
    )
    expect(landed.drop).toBeGreaterThan(0.9)
    expect(landed.build).toBeLessThan(0.1)
  })

  // An intro is a quiet passage with nothing behind it. The weight comes out
  // of rest, so the six still sum to one.
  it('splits an intro out of rest while nothing has come back', () => {
    const reader = new MomentReader()
    const weights = play(reader, packet({ rest: 0.6, section: 1 }), 2, 60)
    expect(weights.intro).toBeCloseTo(0.6)
    expect(weights.rest).toBeCloseTo(0)
    expect(weights.groove).toBeCloseTo(0.4)
  })

  it('fades the intro out over the first few sections', () => {
    const reader = new MomentReader()
    const quiet = (section: number) => packet({ rest: 0.6, section })
    expect(play(reader, quiet(1), 1, 60).intro).toBeCloseTo(0.6)
    expect(play(reader, quiet(2), 1, 60).intro).toBeCloseTo(0.3)
    expect(play(reader, quiet(3), 1, 60).intro).toBeCloseTo(0)
  })

  it('ends the intro the moment a passage comes back', () => {
    const reader = new MomentReader()
    expect(play(reader, packet({ rest: 0.6, section: 1 }), 1, 60).intro).toBeCloseTo(0.6)
    const weights = play(reader, packet({ rest: 0.6, section: 1, recall: 0.9 }), 1, 60)
    expect(weights.intro).toBe(0)
    expect(weights.rest).toBeCloseTo(0.6)
  })

  // What it can see of an ending: a long fall with no tension under it, late
  // in a track that has already run a while. It cannot see the track's length.
  it('reads an outro out of a long fall late in a long track', () => {
    const reader = new MomentReader()
    play(reader, packet({ section: 2, recall: 0.9 }), OUTRO_TRACK_SECONDS + 5, 60)
    const fading = packet({ section: 3, recall: 0.9, rest: 0.8, swell: 0.3 })
    expect(play(reader, fading, 8, 60).outro).toBe(0)
    expect(play(reader, fading, 10, 60).outro).toBeGreaterThan(0)
    expect(play(reader, fading, 20, 60).outro).toBeCloseTo(0.8, 2)
  })

  it('never reads an outro in a track that has not run long enough', () => {
    const reader = new MomentReader()
    const fading = packet({ section: 2, recall: 0.9, rest: 0.8, swell: 0.3 })
    const weights = play(reader, fading, 60, 60)
    expect(weights.outro).toBe(0)
    expect(weights.rest).toBeCloseTo(0.8)
  })

  it('lets one loud passage call the ending off', () => {
    const reader = new MomentReader()
    play(reader, packet({ section: 2, recall: 0.9 }), OUTRO_TRACK_SECONDS + 5, 60)
    play(reader, packet({ section: 3, recall: 0.9, rest: 0.8, swell: 0.3 }), 25, 60)
    expect(reader.weights.outro).toBeGreaterThan(0)
    play(reader, packet({ section: 4, recall: 0.9, swell: 0.6 }), 10, 60)
    const back = play(reader, packet({ section: 4, recall: 0.9, rest: 0.8, swell: 0.3 }), 1, 60)
    expect(back.outro).toBe(0)
  })

  it('holds its reading of the track through silence', () => {
    const reader = new MomentReader()
    play(reader, packet({ section: 2, recall: 0.9 }), 30, 60)
    const seen = reader.sectionsSeen
    play(reader, packet({ energy: 0, section: 7 }), 20, 60)
    expect(reader.sectionsSeen).toBe(seen)
  })

  it('reads the same at 60 and at 144 frames a second', () => {
    const slow = new MomentReader()
    const fast = new MomentReader()
    const steady = packet({ section: 2, recall: 0.9 })
    const fading = packet({ section: 3, recall: 0.9, rest: 0.8, swell: 0.3 })
    for (const reader of [slow, fast]) {
      const fps = reader === slow ? 60 : 144
      play(reader, steady, OUTRO_TRACK_SECONDS + 5, fps)
      play(reader, fading, 20, fps)
    }

    for (const moment of MOMENTS) expect(fast.weights[moment]).toBeCloseTo(slow.weights[moment], 6)
  })
})
