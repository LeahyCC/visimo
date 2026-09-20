import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { MOMENTS } from '../studies/types'
import type { Moment } from '../studies/types'
import {
  INTRO_FULL_SECONDS,
  INTRO_GONE_SECONDS,
  INTRO_LOUD_SHARE,
  MomentReader,
  OUTRO_LAST_SHARE,
  OUTRO_MAX_STRETCH_SECONDS,
  OUTRO_MIN_STRETCH_SECONDS,
  OUTRO_TRACK_SECONDS,
} from './moment'
import type { MomentWeights, Playhead } from './moment'
import { DANCE, HOUSE, METAL, playSong, SONGS } from './song.fixture'
import type { Song } from './song.fixture'

const packet = (values: Partial<Record<keyof typeof F, number>>) => {
  const out = new Float32Array(PACKET_LENGTH)
  out[F.energy] = 0.8
  out[F.swell] = 0.5
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

const play = (
  reader: MomentReader,
  features: Float32Array,
  seconds: number,
  fps: number,
  playhead?: Playhead,
) => {
  const dt = 1 / fps
  for (let frame = 0; frame < Math.round(seconds * fps); frame += 1)
    reader.step(features, dt, playhead)
  return reader.weights
}

const total = (weights: MomentWeights) => MOMENTS.reduce((sum, at) => sum + weights[at], 0)

type Sample = { time: number; weights: Record<Moment, number> }

/**
 * A whole song through a reader, the weights copied out of every frame. The
 * playhead is what a host playing the file would hand in: the time the frame
 * is at, and the length of the song unless a test says otherwise.
 */
const listen = (song: Song, fps: number, given?: { duration: number }, seconds?: number) => {
  const reader = new MomentReader()
  const samples: Sample[] = []
  for (const { time, dt, features } of playSong(fps, HOUSE, seconds, song)) {
    const playhead = given ? { currentTime: time, duration: given.duration } : undefined
    samples.push({ time, weights: { ...reader.step(features, dt, playhead) } })
  }

  return samples
}

const frameAt = (samples: readonly Sample[], time: number): Sample => {
  const found = samples.find((sample) => Math.abs(sample.time - time) < 1e-9)
  if (!found) throw new Error(`no frame at ${time}`)
  return found
}

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

  // The rows are published so that 1 is the thing wholly happening, which is
  // the estimator's business, so they are read here as they come.
  it('reads a build from tension and a drop from release', () => {
    const reader = new MomentReader()
    const half = reader.step(packet({ tension: 0.5, section: 3, recall: 0.9 }), 1 / 60)
    expect(half.build).toBeCloseTo(0.5)
    expect(half.groove).toBeCloseTo(0.5)
    const drop = reader.step(packet({ release: 0.5, section: 4, recall: 0.9 }), 1 / 60)
    expect(drop.drop).toBeCloseTo(0.5)
    expect(drop.build).toBe(0)
  })

  // What a drop-only study needs in order to be cast at all: a drop that is
  // wholly a drop leaves no room for groove, so a study for groove and drop
  // both cannot outscore it.
  it('reads a whole drop as all drop, and a whole build as all build', () => {
    const reader = new MomentReader()
    const drop = reader.step(packet({ release: 1, section: 4, recall: 0.9 }), 1 / 60)
    expect(drop.drop).toBeCloseTo(1)
    expect(drop.groove).toBeCloseTo(0)
    const build = reader.step(packet({ tension: 1, section: 3, recall: 0.9 }), 1 / 60)
    expect(build.build).toBeCloseTo(1)
  })

  // Seen on a real track: the evidence for a build was still 0.41 on the frame
  // of the impact and for the drop 0.37, which are published as 0.82 and 0.93,
  // the moment read as build 0.47 and drop 0.53, and the build's flow kept
  // its seat through both drops.
  it('ends the build when the drop fires, however slow tension is to let go', () => {
    const reader = new MomentReader()
    const landed = reader.step(
      packet({ tension: 0.82, release: 0.93, section: 4, recall: 0.9 }),
      1 / 60,
    )
    expect(landed.drop).toBeGreaterThan(0.9)
    expect(landed.build).toBeLessThan(0.1)
  })

  // An intro is where the track is, so it takes all of the quiet and a share
  // of the room groove would have had. The share is not the whole of it: the
  // studies made for an intro are quiet ones, and a loud opening keeps enough
  // groove for the track's own studies to win it.
  it('reads the first seconds of a track as an intro, quiet or not', () => {
    const quiet = play(new MomentReader(), packet({ rest: 1, section: 1 }), 2, 60)
    expect(quiet.intro).toBeCloseTo(1)
    const mixed = play(new MomentReader(), packet({ rest: 0.6, section: 1 }), 2, 60)
    expect(mixed.intro).toBeCloseTo(0.6 + 0.4 * INTRO_LOUD_SHARE)
    expect(mixed.rest).toBeCloseTo(0)
    expect(mixed.groove).toBeCloseTo(0.4 * (1 - INTRO_LOUD_SHARE))
    const loud = play(new MomentReader(), packet({ section: 1 }), 2, 60)
    expect(loud.intro).toBeCloseTo(INTRO_LOUD_SHARE)
    expect(loud.groove).toBeCloseTo(1 - INTRO_LOUD_SHARE)
  })

  it('hands the intro over over the first few sections, and not in a step', () => {
    const reader = new MomentReader()
    const quiet = (section: number) => packet({ rest: 1, section })
    expect(play(reader, quiet(1), 1, 60).intro).toBeCloseTo(1)
    expect(play(reader, quiet(2), 4, 60).intro).toBeCloseTo(0.5)
    expect(play(reader, quiet(3), 4, 60).intro).toBeCloseTo(0)
  })

  it('does not step the weights when a section is confirmed', () => {
    const reader = new MomentReader()
    const before = { ...play(reader, packet({ section: 1 }), 5, 60) }
    const after = reader.step(packet({ section: 2 }), 1 / 60)
    for (const moment of MOMENTS)
      expect(Math.abs(after[moment] - before[moment])).toBeLessThan(0.01)
  })

  it('ends the intro the moment a passage comes back', () => {
    const reader = new MomentReader()
    expect(play(reader, packet({ rest: 1, section: 1 }), 1, 60).intro).toBeCloseTo(1)
    const weights = play(reader, packet({ rest: 1, section: 1, recall: 0.9 }), 1, 60)
    expect(weights.intro).toBe(0)
    expect(weights.rest).toBeCloseTo(1)
    expect(weights.groove).toBeCloseTo(0)
  })

  // A track that goes straight into its verse never confirms a change in its
  // first half minute, so the clock is what ends its intro.
  it('ends the intro off the clock when no section has changed', () => {
    const reader = new MomentReader()
    const steady = packet({ section: 1 })
    expect(play(reader, steady, INTRO_FULL_SECONDS, 60).intro).toBeCloseTo(INTRO_LOUD_SHARE)
    const halfway = (INTRO_FULL_SECONDS + INTRO_GONE_SECONDS) / 2 - INTRO_FULL_SECONDS
    expect(play(reader, steady, halfway, 60).intro).toBeCloseTo(0.5 * INTRO_LOUD_SHARE)
    const gone = play(reader, steady, INTRO_GONE_SECONDS, 60)
    expect(gone.intro).toBe(0)
    expect(gone.groove).toBeCloseTo(1)
  })

  // A build or a drop is something the music is doing, not where it is. An
  // intro takes only what they leave.
  it('never cuts a build or a drop out of the opening of a track', () => {
    const build = new MomentReader().step(packet({ tension: 0.8, section: 1 }), 1 / 60)
    expect(build.build).toBeCloseTo(0.8)
    expect(build.intro).toBeCloseTo(0.2 * INTRO_LOUD_SHARE)
    const drop = new MomentReader().step(packet({ release: 1, section: 1 }), 1 / 60)
    expect(drop.drop).toBeCloseTo(1)
    expect(drop.intro).toBeCloseTo(0)
    const both = new MomentReader().step(packet({ tension: 0.3, release: 0.4 }), 1 / 60)
    expect(both.build).toBeCloseTo(0.3 * 0.6)
    expect(both.drop).toBeCloseTo(0.4)
    expect(total(both)).toBeCloseTo(1, 6)
  })

  it('does not spend the intro on silence before the first note', () => {
    const reader = new MomentReader()
    play(reader, packet({ energy: 0 }), 40, 60)
    expect(play(reader, packet({ section: 1 }), 1, 60).intro).toBeCloseTo(INTRO_LOUD_SHARE)
  })

  // A minute-long track has a count-in and not half a minute of intro, so
  // with its length known the spans shrink to fit it. Without one a twelve
  // second wait for the intro to let go would be a fifth of the track.
  it('gives a short track a short intro when the host says how long it is', () => {
    const short: Playhead = { currentTime: 0, duration: 60 }
    const known = new MomentReader()
    const unknown = new MomentReader()
    expect(play(known, packet({ section: 1 }), 12, 60, short).intro).toBe(0)
    expect(play(unknown, packet({ section: 1 }), 12, 60).intro).toBeGreaterThan(
      0.8 * INTRO_LOUD_SHARE,
    )
    // A track of a normal length keeps the intro it had.
    const normal = new MomentReader()
    const long: Playhead = { currentTime: 0, duration: 240 }
    expect(play(normal, packet({ section: 1 }), 12, 60, long).intro).toBeGreaterThan(
      0.8 * INTRO_LOUD_SHARE,
    )
  })

  // Only a second of sound has been heard, but the listener is two minutes in.
  it('does not read a seek past the opening as an opening', () => {
    const seek: Playhead = { currentTime: 120, duration: 240 }
    expect(play(new MomentReader(), packet({ section: 1 }), 1, 60, seek).intro).toBe(0)
    expect(play(new MomentReader(), packet({ section: 1 }), 1, 60).intro).toBeCloseTo(
      INTRO_LOUD_SHARE,
    )
    // The last stretch is then an outro, though little of the track was heard.
    const end: Playhead = { currentTime: 238, duration: 240 }
    expect(play(new MomentReader(), packet({ section: 1 }), 1, 60, end).outro).toBeCloseTo(1)
  })

  it('reads a length that is not one as no length at all', () => {
    for (const duration of [NaN, Infinity, 0, -5]) {
      const reader = new MomentReader()
      const weights = play(reader, packet({ section: 1 }), 12, 60, { currentTime: 11, duration })
      expect(weights.intro).toBeGreaterThan(0.8 * INTRO_LOUD_SHARE)
      expect(weights.outro).toBe(0)
    }
  })

  // The two songs the fixture writes, the one that opens quiet and the one
  // that opens at full energy on its first frame.
  describe('on a track that opens loud', () => {
    it('reads its first seconds as an intro as much as a groove', () => {
      const samples = listen(METAL, 60)
      for (const time of [1, 4, 8]) {
        const { weights } = frameAt(samples, time)
        expect(weights.intro).toBeCloseTo(INTRO_LOUD_SHARE, 1)
        expect(weights.groove).toBeCloseTo(1 - INTRO_LOUD_SHARE, 1)
      }
    })

    it('has handed the intro over by the time the track has plainly started', () => {
      const samples = listen(METAL, 60)
      // Its first change is at 24 seconds and is confirmed at 30.
      expect(frameAt(samples, 30).weights.intro).toBeCloseTo(0, 6)
      for (const time of [45, 90, 150]) {
        const { weights } = frameAt(samples, time)
        expect(weights.intro).toBe(0)
        expect(weights.groove).toBeCloseTo(1, 6)
      }
    })

    it('lets go of the intro smoothly, at every frame', () => {
      const samples = listen(METAL, 144, undefined, 40)
      let widest = 0
      for (let at = 1; at < samples.length; at += 1)
        for (const moment of MOMENTS)
          widest = Math.max(
            widest,
            Math.abs((samples[at]?.weights[moment] ?? 0) - (samples[at - 1]?.weights[moment] ?? 0)),
          )
      expect(widest).toBeLessThan(0.005)
    })
  })

  describe.each(SONGS)('over the $name song', (song) => {
    it.each([
      ['without', undefined],
      ['with', { duration: song.seconds }],
    ] as const)(
      'shares one whole frame between six weights that are never negative, %s the playhead',
      (_, given) => {
        const reader = new MomentReader()
        for (const { time, dt, features } of playSong(60, HOUSE, undefined, song)) {
          const playhead = given ? { currentTime: time, duration: given.duration } : undefined
          const weights = reader.step(features, dt, playhead)
          expect(total(weights)).toBeCloseTo(1, 6)
          for (const moment of MOMENTS) expect(weights[moment]).toBeGreaterThanOrEqual(0)
        }
      },
    )

    it.each([
      ['without', undefined],
      ['with', { duration: song.seconds }],
    ] as const)(
      'reads the same weights at 60 and at 144 frames a second, %s the playhead',
      (_, given) => {
        const slow = listen(song, 60, given)
        const fast = listen(song, 144, given)
        // Whole and half seconds, which land on a frame at both rates. Either
        // side of an eased boundary the two are a few thousandths apart.
        for (let time = 2.5; time < song.seconds; time += 7.5)
          for (const moment of MOMENTS)
            expect(frameAt(fast, time).weights[moment]).toBeCloseTo(
              frameAt(slow, time).weights[moment],
              2,
            )
      },
    )
  })

  // With the length known the last stretch of a track is an outro by where it
  // is, in whatever the track is doing.
  describe('with the playhead given', () => {
    const settled = (time: number, duration: number, values: Parameters<typeof packet>[0] = {}) => {
      const reader = new MomentReader()
      const features = packet({ section: 2, recall: 0.9, ...values })
      return play(reader, features, 1, 60, { currentTime: time, duration })
    }

    it('leans to outro over the last stretch of a track that ends loud', () => {
      // Twenty seconds of a 200 second track, leaning in over the first ten.
      expect(settled(179, 200).outro).toBe(0)
      expect(settled(185, 200).outro).toBeCloseTo(0.5)
      expect(settled(190, 200).outro).toBeCloseTo(1)
      expect(settled(190, 200).groove).toBeCloseTo(0)
      expect(settled(200, 200).outro).toBeCloseTo(1)
    })

    it('takes it from groove and from rest alike', () => {
      const weights = settled(199, 200, { rest: 0.5 })
      expect(weights.outro).toBeCloseTo(1)
      expect(weights.rest).toBeCloseTo(0)
      expect(total(weights)).toBeCloseTo(1, 6)
    })

    it('scales the stretch with the track, between a floor and a cap', () => {
      expect(OUTRO_LAST_SHARE * 200).toBeGreaterThan(OUTRO_MIN_STRETCH_SECONDS)
      expect(OUTRO_LAST_SHARE * 200).toBeLessThan(OUTRO_MAX_STRETCH_SECONDS)
      // A minute long track gets six seconds, and is wholly outro for the last three.
      expect(settled(53, 60).outro).toBe(0)
      expect(settled(57, 60).outro).toBeCloseTo(1)
      // A very short one is held to the floor and not a tenth of itself.
      expect(settled(15, 20).outro).toBe(0)
      expect(settled(19, 20).outro).toBeCloseTo(1)
      // An hour of a mix does not get six minutes of it.
      expect(settled(3600 - OUTRO_MAX_STRETCH_SECONDS - 1, 3600).outro).toBe(0)
      expect(settled(3600 - OUTRO_MAX_STRETCH_SECONDS / 2, 3600).outro).toBeCloseTo(1)
    })

    it('is cut by tension, so a build in the last seconds is not an outro', () => {
      const winding = settled(199, 200, { tension: 0.8 })
      expect(winding.build).toBeCloseTo(0.8)
      expect(winding.outro).toBeCloseTo(0.2 * 0.2)
      expect(settled(199, 200, { release: 0.5, tension: 0.4 }).drop).toBeCloseTo(0.5)
    })

    it('follows a seek, because the playhead is read fresh every frame', () => {
      const reader = new MomentReader()
      const features = packet({ section: 2, recall: 0.9 })
      const playhead = { currentTime: 190, duration: 200 }
      expect(play(reader, features, 1, 60, playhead).outro).toBeCloseTo(1)
      playhead.currentTime = 40
      expect(play(reader, features, 1, 60, playhead).outro).toBe(0)
    })

    it('leaves the reading of a fall as it was', () => {
      const reader = new MomentReader()
      play(reader, packet({ section: 2, recall: 0.9 }), OUTRO_TRACK_SECONDS + 5, 60)
      const fading = packet({ section: 3, recall: 0.9, rest: 0.8, swell: 0.3 })
      const halfway = { currentTime: 100, duration: 200 }
      expect(play(reader, fading, 30, 60, halfway).outro).toBeCloseTo(0.8, 2)
    })

    it('reads the last stretch of a song that ends loud as an outro', () => {
      const samples = listen(METAL, 60, { duration: METAL.seconds })
      expect(frameAt(samples, 100).weights.outro).toBe(0)
      // The stretch is the last twenty seconds of two hundred.
      expect(frameAt(samples, METAL.seconds - 21).weights.outro).toBe(0)
      for (const time of [METAL.seconds - 8, METAL.seconds - 3, METAL.seconds])
        expect(frameAt(samples, time).weights.outro).toBeGreaterThan(0.9)
    })

    // Which is what the reader does without a playhead, and the limit the
    // header comment gives for it.
    it('and reads nothing of it without one', () => {
      const samples = listen(METAL, 60)
      for (const sample of samples) expect(sample.weights.outro).toBe(0)
    })

    // The dance song cut off at 75 seconds ends on the build to its drop.
    it('does not call a track that ends on a build an outro', () => {
      const cut = 75
      const samples = listen(DANCE, 60, { duration: cut }, cut)
      const build = frameAt(samples, cut)
      expect(build.weights.build).toBeGreaterThan(0.7)
      for (const sample of samples.filter(({ time }) => time > cut - 3))
        expect(sample.weights.outro).toBeLessThan(0.1)
    })
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
