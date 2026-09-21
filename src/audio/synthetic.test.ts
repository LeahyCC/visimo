import { describe, expect, it } from 'vitest'

import { F, FeatureExtractor } from './FeatureExtractor'
import {
  analyse,
  atLevel,
  breakdown,
  build,
  denseChorus,
  denseVerse,
  fft,
  fourOnTheFloor,
  kit,
  padOnly,
  steadyHits,
  synthesize,
  twoStep,
} from './synthetic'
import type { Pattern, Section } from './synthetic'

const SAMPLE_RATE = 48000
const FFT_SIZE = 4096

/** Play samples through the extractor at a frame rate; one packet copy a frame. */
function run(samples: Float32Array, frameRate: number) {
  const frames = analyse(samples, { sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, frameRate })
  const extractor = new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE })
  return frames.map((frame) => extractor.update(frame, 1 / frameRate).slice())
}

/** Play sections through the extractor at a frame rate. */
function play(sections: readonly Section[], frameRate: number) {
  return run(synthesize(sections, SAMPLE_RATE), frameRate)
}

/** The packet nearest to `seconds` in, allowing for the analyser's window. */
const at = (packets: Float32Array[], seconds: number, frameRate: number) =>
  packets[Math.min(packets.length - 1, Math.round(seconds * frameRate))] ?? new Float32Array()

describe('the analyser stand-in', () => {
  it('transforms an impulse into a flat spectrum', () => {
    const re = new Float64Array(8)
    const im = new Float64Array(8)
    re[0] = 1
    fft(re, im)
    for (let bin = 0; bin < 8; bin++) {
      expect(re[bin]).toBeCloseTo(1)
      expect(im[bin]).toBeCloseTo(0)
    }
  })

  it('puts a tone in its bin at about the level Chromium would, and silence at -Infinity', () => {
    const samples = new Float32Array(SAMPLE_RATE)
    for (let index = 0; index < samples.length; index++)
      samples[index] = Math.sin((2 * Math.PI * 1000 * index) / SAMPLE_RATE)
    const [frame] = analyse(samples, { sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, frameRate: 60 })
    expect(frame).toBeDefined()
    const bin = Math.round((1000 * FFT_SIZE) / SAMPLE_RATE)
    let loudest = 0
    for (let index = 0; index < FFT_SIZE / 2; index++)
      if ((frame?.[index] ?? -Infinity) > (frame?.[loudest] ?? -Infinity)) loudest = index
    expect(Math.abs(loudest - bin)).toBeLessThanOrEqual(1)
    // A full-scale sine under a Blackman window over the FFT size.
    expect(frame?.[loudest]).toBeGreaterThan(-16)
    expect(frame?.[loudest]).toBeLessThan(-12)
    expect(frame?.[loudest] ?? 0).toBeGreaterThan((frame?.[loudest + 40] ?? 0) + 40)

    const [quiet] = analyse(new Float32Array(SAMPLE_RATE), {
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
      frameRate: 60,
    })
    expect(quiet?.[bin]).toBe(-Infinity)
  })

  it('places hits to the sample, so the signal holds exactly the tempo asked for', () => {
    const samples = synthesize([{ pattern: fourOnTheFloor(120), seconds: 4 }], SAMPLE_RATE)
    expect(samples.length).toBe(4 * SAMPLE_RATE)
    // A kick opens with a click; the sample at the second beat is not silent.
    let loud = 0
    for (let index = 0; index < 200; index++)
      loud = Math.max(loud, Math.abs(samples[SAMPLE_RATE / 2 + index] ?? 0))
    expect(loud).toBeGreaterThan(0.1)
  })
})

describe('tempo on synthesised drums', () => {
  it('reads four to the floor at 128 to within a beat, at 60 and at 120 frames a second', () => {
    const sections = [{ pattern: fourOnTheFloor(128, 0.15), seconds: 24 }]
    const at60 = play(sections, 60)
    const at120 = play(sections, 120)
    const bpm60 = at60[at60.length - 1]?.[F.tempoBpm] ?? 0
    const bpm120 = at120[at120.length - 1]?.[F.tempoBpm] ?? 0
    expect(Math.abs(bpm60 - 128)).toBeLessThan(1)
    expect(Math.abs(bpm120 - 128)).toBeLessThan(1)
    expect(Math.abs(bpm60 - bpm120)).toBeLessThan(0.5)
    expect(at60[at60.length - 1]?.[F.tempoConfidence] ?? 0).toBeGreaterThan(0.5)
  }, 60000)

  it('lands the beat phase on the kick', () => {
    const frameRate = 60
    const packets = play([{ pattern: fourOnTheFloor(128, 0.15), seconds: 20 }], frameRate)
    // Frame k holds the window ending at sample fftSize + k * hop, and a hit
    // has to get some way into the window before its rise shows, so the
    // phase is read three frames after the window that ends on the kick and
    // runs a few hundredths of a beat behind the signal. What is checked is
    // that the offset is small and the same on every beat.
    const phases: number[] = []
    for (let beat = 24; beat < 40; beat++) {
      const seconds = (beat * 60) / 128
      const frame = Math.round((seconds - FFT_SIZE / SAMPLE_RATE) * frameRate) + 3
      phases.push(packets[frame]?.[F.beatPhase] ?? 0)
    }

    for (const phase of phases) {
      expect(phase).toBeGreaterThanOrEqual(0)
      expect(phase).toBeLessThan(0.2)
    }

    expect(Math.max(...phases) - Math.min(...phases)).toBeLessThan(0.08)
  }, 60000)

  // The bar, on the pattern the bar was built for. Four to the floor has the
  // same kick on all four beats, so which of them is the downbeat is the
  // fallback, four-beat counting from the first beat the tracker was sure of;
  // what has to hold is that the bar is four beats long, wraps once through
  // them, and wraps on a beat and not between two.
  it('wraps the bar phase once every four beats, on the beat', () => {
    const frameRate = 60
    const packets = play([{ pattern: fourOnTheFloor(128, 0.15), seconds: 24 }], frameRate)
    const beat = 60 / 128
    const read = packets.map((packet, frame) => ({
      seconds: frame / frameRate,
      bar: packet[F.barPhase] ?? 0,
      phase: packet[F.beatPhase] ?? 0,
    }))

    const late = read.filter((entry) => entry.seconds > 14)
    const wraps: number[] = []
    for (let at = 1; at < late.length; at++) {
      const was = late[at - 1]?.bar ?? 0
      const now = late[at]?.bar ?? 0
      if (was - now > 0.5) wraps.push(late[at]?.seconds ?? 0)
    }

    // Nine seconds of 128 BPM is about nineteen beats, so four or five bars.
    expect(wraps.length).toBeGreaterThanOrEqual(4)
    expect(wraps.length).toBeLessThanOrEqual(5)
    for (let at = 1; at < wraps.length; at++)
      expect((wraps[at] ?? 0) - (wraps[at - 1] ?? 0)).toBeCloseTo(4 * beat, 1)
    // A bar begins on a beat: the beat phase is at the start of one too.
    for (const seconds of wraps) {
      const entry = late.find((other) => other.seconds === seconds)
      expect(entry?.phase ?? 1, `${seconds}s`).toBeLessThan(0.1)
    }

    // And it covers the whole of 0 to 1 across the four beats.
    expect(Math.min(...late.map((entry) => entry.bar))).toBeLessThan(0.05)
    expect(Math.max(...late.map((entry) => entry.bar))).toBeGreaterThan(0.95)
  }, 60000)

  // And with a low end that says which beat is the one, the bar lands on it.
  // What the estimator can see is the low end firing and not how hard: the
  // band levels are scaled by their own recent peak, so a louder kick among
  // kicks barely reads louder, and a pattern whose low end lands only on the
  // one is the case it is for. Four to the floor above is the other case, and
  // gets the counting.
  it('lands the bar on the beat the low end fires on', () => {
    const frameRate = 60
    const bpm = 128
    const oneAndSnares: Pattern = {
      bpm,
      beats: 4,
      hits: [
        { drum: 'kick', at: 0, gain: 0.9 },
        { drum: 'bass', at: 0, gain: 0.6 },
        { drum: 'snare', at: 1, gain: 0.7 },
        { drum: 'snare', at: 2, gain: 0.5 },
        { drum: 'snare', at: 3, gain: 0.7 },
        ...Array.from({ length: 8 }, (_, eighth) => ({
          drum: 'hat' as const,
          at: eighth / 2,
          gain: eighth % 2 ? 0.2 : 0.35,
        })),
      ],
      pad: 0.15,
    }

    const packets = play([{ pattern: oneAndSnares, seconds: 30 }], frameRate)
    const beat = 60 / bpm
    // The window ends fftSize samples in and a rise takes a few frames to
    // show, which is the offset `lands the beat phase on the kick` measures;
    // the same offset is used here so the reading is taken where the kick is.
    const readings: number[] = []
    for (let bar = 6; bar < 13; bar++) {
      const seconds = bar * 4 * beat
      const frame = Math.round((seconds - FFT_SIZE / SAMPLE_RATE) * frameRate) + 3
      readings.push(packets[frame]?.[F.barPhase] ?? 1)
    }

    for (const reading of readings) expect(reading).toBeLessThan(0.1)
  }, 60000)

  it('reads a two-step at a level of its metre, never the dotted figure', () => {
    // Nothing in a two-step plays on every beat: the kicks are a dotted
    // quarter apart and the snares a half bar. The half bar is a level of the
    // metre and reading it is a choice of octave; the dotted quarter is not,
    // and reading it, as the whole-spectrum flux did on real tracks, gives a
    // phase that drifts against the music.
    const packets = play([{ pattern: twoStep(174, 0.15), seconds: 24 }], 60)
    const bpm = packets[packets.length - 1]?.[F.tempoBpm] ?? 0
    const ratio = bpm / 174
    const level = [0.5, 1, 2].some((wanted) => Math.abs(ratio - wanted) < 0.02)
    expect(level).toBe(true)
    expect(Math.abs(ratio - 2 / 3)).toBeGreaterThan(0.05)
    expect(packets[packets.length - 1]?.[F.tempoConfidence] ?? 0).toBeGreaterThan(0.3)
  }, 60000)
})

describe('the song on synthesised music', () => {
  const frameRate = 60
  const sections = [
    { pattern: fourOnTheFloor(128, 0.15), seconds: 20 },
    { pattern: breakdown(128, 0.25), seconds: 15 },
    { pattern: fourOnTheFloor(128, 0.15), seconds: 15 },
  ]
  const packets = play(sections, frameRate)

  it('reads a section change as novelty, and a steady passage as none', () => {
    const steady = at(packets, 18, frameRate)[F.novelty] ?? 1
    expect(steady).toBeLessThan(0.1)
    let peak = 0
    for (let seconds = 20; seconds < 26; seconds += 0.5)
      peak = Math.max(peak, at(packets, seconds, frameRate)[F.novelty] ?? 0)
    expect(peak).toBeGreaterThan(0.3)
    // The drums coming back is a smaller change than their leaving, since the
    // pad and the bass note carry on through both, but it is still well clear
    // of the floor a steady passage sits on.
    let drop = 0
    for (let seconds = 35; seconds < 41; seconds += 0.5)
      drop = Math.max(drop, at(packets, seconds, frameRate)[F.novelty] ?? 0)
    expect(drop).toBeGreaterThan(0.2)
    expect(drop).toBeGreaterThan(steady * 5)
  })

  it('lifts swell when the drums come back over a quiet passage', () => {
    const before = at(packets, 34, frameRate)[F.swell] ?? 0
    const after = at(packets, 38, frameRate)[F.swell] ?? 0
    expect(after).toBeGreaterThan(before + 0.2)
    expect(after).toBeGreaterThan(0.7)
  })

  it('loses confidence in the tempo through the breakdown and finds it again', () => {
    expect(at(packets, 19, frameRate)[F.tempoConfidence] ?? 0).toBeGreaterThan(0.5)
    expect(at(packets, 30, frameRate)[F.tempoConfidence] ?? 1).toBeLessThan(0.3)
    expect(at(packets, 49, frameRate)[F.tempoConfidence] ?? 0).toBeGreaterThan(0.5)
    expect(Math.abs((at(packets, 49, frameRate)[F.tempoBpm] ?? 0) - 128)).toBeLessThan(1)
  })

  it('reads a bass-heavy mix as weighty', () => {
    expect(at(packets, 19, frameRate)[F.weight] ?? 0).toBeGreaterThan(0.8)
  })
})

describe('hardness on synthesised hits', () => {
  // The pair the measure is tuned on: the same register struck as hard and as
  // softly as a signal can be, on the same grid and held to the same RMS. The
  // level is well clear of the quiet floor so that 20 dB down is too.
  const seconds = 20
  const LOUD = 0.5
  const hard = synthesize([{ pattern: steadyHits(128, 'hardKick'), seconds }], SAMPLE_RATE)
  const soft = synthesize([{ pattern: steadyHits(128, 'pulse'), seconds }], SAMPLE_RATE)
  const last = (packets: Float32Array[]) => packets[packets.length - 1]?.[F.hardness] ?? 0
  const heard = (samples: Float32Array, gain: number, frameRate = 60) =>
    last(run(atLevel(samples, gain), frameRate))

  it('reads a clipped kick well above a soft pulse at the same rate and loudness', () => {
    const clipped = heard(hard, LOUD)
    const pulses = heard(soft, LOUD)
    expect(clipped).toBeGreaterThan(0.8)
    expect(pulses).toBeLessThan(0.2)
    expect(clipped - pulses).toBeGreaterThan(0.6)
  }, 60000)

  // Both halves of the measure are ratios of a signal to itself: a window
  // against its own peak, and the spectrum's mean against its mean square. So
  // the only thing 20 dB could take away is the onsets, and those are read
  // off log magnitudes for the same reason.
  it('keeps the ordering and the values 20 dB down', () => {
    const quiet = LOUD / 10
    expect(heard(hard, quiet)).toBeGreaterThan(0.8)
    expect(heard(soft, quiet)).toBeLessThan(0.2)
    expect(Math.abs(heard(hard, quiet) - heard(hard, LOUD))).toBeLessThan(0.07)
    expect(Math.abs(heard(soft, quiet) - heard(soft, LOUD))).toBeLessThan(0.07)
  }, 60000)

  // The share is of time and not of frames, and the window is a span of time,
  // so a display twice as fast sees the same hit the same way.
  it('reads the same at 60 and at 144 frames a second', () => {
    expect(Math.abs(heard(hard, LOUD, 144) - heard(hard, LOUD, 60))).toBeLessThan(0.07)
    expect(Math.abs(heard(soft, LOUD, 144) - heard(soft, LOUD, 60))).toBeLessThan(0.07)
  }, 60000)

  it('reads a sustained pad with nothing struck in it as soft', () => {
    const pad = synthesize([{ pattern: padOnly(128, 0.5), seconds }], SAMPLE_RATE)
    expect(heard(pad, LOUD)).toBeLessThan(0.2)
  }, 60000)

  it('holds its value through silence', () => {
    const packets = run(
      atLevel(
        synthesize(
          [
            { pattern: steadyHits(128, 'hardKick'), seconds },
            { pattern: padOnly(128, 0), seconds: 6 },
          ],
          SAMPLE_RATE,
        ),
        LOUD,
      ),
      60,
    )
    const playing = packets[Math.round(19 * 60)]?.[F.hardness] ?? 0
    expect(playing).toBeGreaterThan(0.8)
    // Six seconds of nothing, a third of the window the mean is kept over,
    // and it has not moved: silence steps neither half of the ratio.
    expect(Math.abs(last(packets) - playing)).toBeLessThan(0.02)
  }, 60000)

  it('moves slowly enough that one odd hit barely shifts it', () => {
    const packets = run(
      atLevel(
        synthesize(
          [
            { pattern: steadyHits(128, 'pulse'), seconds },
            // One beat of it, so exactly one clipped kick lands.
            { pattern: steadyHits(128, 'hardKick'), seconds: 60 / 128 },
            { pattern: steadyHits(128, 'pulse'), seconds: 4 },
          ],
          SAMPLE_RATE,
        ),
        LOUD,
      ),
      60,
    )
    const before = packets[Math.round(19.5 * 60)]?.[F.hardness] ?? 0
    const after = packets[Math.round(22 * 60)]?.[F.hardness] ?? 0
    expect(before).toBeLessThan(0.2)
    expect(after).toBeGreaterThan(before)
    expect(after - before).toBeLessThan(0.1)
  }, 60000)
})

describe('pace on whole tracks', () => {
  // The same three tracks as hardness below. Pace is a property of the song, so
  // a listener on a 144 Hz display has to read what one on a 60 Hz display does.
  // It did not: one struck sound trips several bands a few frames apart, and
  // pace counted the frames, so the same kick was worth more the finer the
  // frames. Twenty-five seconds of each read 0.24, 0.17 and 0.25 at 60 and
  // 0.38, 0.32 and 0.38 at 144.
  const seconds = 25
  const LOUD = 0.5
  const RATES = [60, 120, 144]
  const tracks = {
    hardstyle: kit(150, 'hardKick', 0.3),
    house: kit(124, 'kick', 0.3, 0.2),
    lofi: kit(80, 'pulse', 0.1, 0.6),
  }
  const heard = (pattern: Pattern, frameRate: number) =>
    run(atLevel(synthesize([{ pattern, seconds }], SAMPLE_RATE), LOUD), frameRate).at(-1)?.[
      F.pace
    ] ?? 0

  it('reads each of the three the same at 60, 120 and 144 frames a second', () => {
    for (const pattern of Object.values(tracks)) {
      const paces = RATES.map((rate) => heard(pattern, rate))
      expect(Math.max(...paces) - Math.min(...paces)).toBeLessThan(0.03)
    }
  }, 180000)

  // A kick every 0.4 seconds at 150 BPM, and nothing else the detectors hear
  // over it: the count is of hits, so 2.5 a second over 25 seconds of a
  // half-minute decay, at 4 a second for full.
  it('counts a hardstyle kick once, at any frame rate', () => {
    const expected = (2.5 * (1 - Math.exp(-seconds / 30))) / 4
    for (const rate of RATES)
      expect(Math.abs(heard(tracks.hardstyle, rate) - expected)).toBeLessThan(0.015)
  }, 180000)

  // 80 BPM with quiet hats over a pad against 150 BPM with loud ones. The
  // detectors hear the lo-fi hats, each band being measured against its own
  // history, and do not hear hardstyle's dense loud ones, so counting every
  // onset as one put lo-fi at twice hardstyle. A hit is worth how far it
  // stands above what is under it, and a hat under a pad is under it.
  it('reads lo-fi clearly slower than hardstyle at every frame rate', () => {
    for (const rate of RATES) {
      const hardstyle = heard(tracks.hardstyle, rate)
      const lofi = heard(tracks.lofi, rate)
      expect(lofi).toBeLessThan(hardstyle * 0.85)
      expect(lofi).toBeLessThan(heard(tracks.house, rate))
    }
  }, 180000)
})

describe('hardness on whole tracks', () => {
  // Three tracks that differ only in the voice on the beat, the weight of the
  // hats and the pad under them. This is the case the feature exists for, and
  // the case a hit measured against the mix rather than against its own bed
  // got wrong: with a loud pad under it every frame sat within a tenth of the
  // window's peak, so lo-fi read above house.
  const seconds = 25
  const LOUD = 0.5
  const heard = (pattern: Pattern, frameRate: number) =>
    run(atLevel(synthesize([{ pattern, seconds }], SAMPLE_RATE), LOUD), frameRate).at(-1)?.[
      F.hardness
    ] ?? 0
  const tracks = {
    hardstyle: kit(150, 'hardKick', 0.3),
    house: kit(124, 'kick', 0.3, 0.2),
    lofi: kit(80, 'pulse', 0.1, 0.6),
  }

  it('puts hardstyle above house above lo-fi', () => {
    const hardstyle = heard(tracks.hardstyle, 60)
    const house = heard(tracks.house, 60)
    const lofi = heard(tracks.lofi, 60)
    expect(hardstyle - house).toBeGreaterThan(0.15)
    expect(house - lofi).toBeGreaterThan(0.15)
    // Lo-fi is a soft track, not a middling one. The pad it is built on is
    // the loudest thing in it and must not be mistaken for a held hit.
    expect(lofi).toBeLessThan(0.35)
  }, 120000)

  it('reads each of the three the same at 60 and at 144 frames a second', () => {
    for (const pattern of Object.values(tracks))
      expect(Math.abs(heard(pattern, 144) - heard(pattern, 60))).toBeLessThan(0.05)
  }, 180000)

  // The guard on a hit that barely moves the mix. A rise a hundredth of what
  // is sounding is mostly noise, and scoring its shape read the same clipped
  // kick anywhere from soft to hard depending on the frame rate.
  it('reads a hit drowned under a pad as soft rather than on the shape of its rise', () => {
    const drowned: Pattern = {
      bpm: 100,
      beats: 4,
      hits: [0, 1, 2, 3].map((beat) => ({ drum: 'hardKick' as const, at: beat, gain: 0.25 })),
      pad: 6,
    }
    expect(heard(drowned, 60)).toBeLessThan(0.2)
    expect(Math.abs(heard(drowned, 144) - heard(drowned, 60))).toBeLessThan(0.05)
  }, 120000)
})

/**
 * The moment on a synthesised story: groove, breakdown, groove, build, drop.
 * The build is the reason `build()` exists, since nothing else in this file
 * changes from bar to bar and a build is nothing but change from bar to bar.
 *
 * Everything is measured at three frame rates and at two levels 20 dB apart,
 * because both are ways the same music can arrive at the extractor and both
 * have caught a bug here: the low end's peak follower replaced a pair of
 * means that swung with the bar and agreed with each other only by luck, and
 * the riser was read off the centroid until it turned out the centroid is
 * held at NaN under the -60 dB floor, which a normal mix 20 dB down is under.
 */
describe('the moment on a synthesised story', () => {
  const BPM = 128
  const LOUD = 0.5
  const RATES = [60, 120, 144]
  const groove = fourOnTheFloor(BPM, 0.15)
  // Where each part begins. The build is four sections of `build()`: three
  // stages of two bars and a last bar with no kick, so 13.125 s at 128.
  const BREAKDOWN_AT = 24
  const BUILD_AT = 56
  const DROP_AT = 69.125
  const story = (fizzle: boolean): Section[] => [
    { pattern: groove, seconds: BREAKDOWN_AT },
    { pattern: breakdown(BPM, 0.12), seconds: 16 },
    { pattern: groove, seconds: 16 },
    ...build(BPM, 0.25, fizzle),
    { pattern: groove, seconds: 20 },
  ]

  // Rendered once per story and kept. Several tests below listen to the same
  // ninety seconds at the same frame rate, and rendering it again for each of
  // them made this block most of the suite's running time.
  const stories = new Map<string, Float32Array[]>()
  const heard = (fizzle: boolean, frameRate: number, gain = LOUD) => {
    const key = `${fizzle} ${frameRate} ${gain}`
    let packets = stories.get(key)
    if (!packets) {
      packets = run(atLevel(synthesize(story(fizzle), SAMPLE_RATE), gain), frameRate)
      stories.set(key, packets)
    }

    return packets
  }

  const peak = (packets: Float32Array[], row: number, from: number, to: number, rate: number) => {
    let best = 0
    for (let i = Math.round(from * rate); i < Math.min(packets.length, Math.round(to * rate)); i++)
      best = Math.max(best, packets[i]?.[row] ?? 0)
    return best
  }
  /** When the impact row reached 1, which it does on one frame per drop. */
  const impacts = (packets: Float32Array[], rate: number) =>
    packets.flatMap((packet, index) => ((packet[F.impact] ?? 0) >= 0.999 ? [index / rate] : []))

  // The rows are published against the level that means the thing is wholly
  // happening, so a consumer reads 0 to 1 and means it. As evidence a build
  // reached 0.71 here and 0.49 on a real track, and a drop 0.5 and 0.41: a
  // study written so that a tension of 1 is the whole effect, which is how
  // they are all written, ran at half strength through a real build.
  it('publishes a whole build and a whole drop as 1', () => {
    const packets = heard(false, 60)
    expect(peak(packets, F.tension, BUILD_AT, DROP_AT, 60)).toBeGreaterThan(0.95)
    expect(peak(packets, F.release, DROP_AT, DROP_AT + 1, 60)).toBeGreaterThan(0.95)
    // And neither row ever leaves 0 to 1, whatever the evidence does.
    for (const packet of packets) {
      expect(packet[F.tension]).toBeLessThanOrEqual(1)
      expect(packet[F.release]).toBeLessThanOrEqual(1)
    }
  }, 300000)

  // Both halves matter. Loudness rising over four to sixteen seconds is a
  // build and it is also the drums coming back over a breakdown, which is
  // what the middle of this story is, so a tension that read only the rise
  // wound up through the whole of 40 to 56 s at nothing happening.
  it('climbs through the build and not before it', () => {
    for (const rate of RATES) {
      const packets = heard(false, rate)
      expect(peak(packets, F.tension, BUILD_AT, DROP_AT, rate)).toBeGreaterThan(0.6)
      expect(peak(packets, F.tension, 0, BUILD_AT, rate)).toBeLessThan(0.1)
    }
  }, 300000)

  it('lands one impact within a beat of the drop', () => {
    for (const rate of RATES) {
      const found = impacts(heard(false, rate), rate)
      expect(found).toHaveLength(1)
      expect(Math.abs((found[0] ?? 0) - DROP_AT)).toBeLessThan(60 / BPM)
    }
  }, 300000)

  // A phrase here is eight beats, 3.75 s at 128, and release falls to 1/e
  // over half of one, so one phrase on it is at a seventh of its peak.
  it('holds release across the drop and lets it go a phrase later', () => {
    const phrase = (8 * 60) / BPM
    for (const rate of RATES) {
      const packets = heard(false, rate)
      expect(peak(packets, F.release, DROP_AT, DROP_AT + 1, rate)).toBeGreaterThan(0.4)
      expect(peak(packets, F.release, DROP_AT + phrase, DROP_AT + phrase + 1, rate)).toBeLessThan(
        0.5,
      )
      expect(peak(packets, F.release, 0, BUILD_AT, rate)).toBeLessThan(0.1)
    }
  }, 300000)

  // Rest is slow on purpose, so it is read at the end of the breakdown and
  // well into the groove rather than at either edge.
  it('reads rest high in the breakdown and low in the groove', () => {
    for (const rate of RATES) {
      const packets = heard(false, rate)
      expect(peak(packets, F.rest, BREAKDOWN_AT + 12, BREAKDOWN_AT + 16, rate)).toBeGreaterThan(0.6)
      expect(peak(packets, F.rest, 8, BREAKDOWN_AT, rate)).toBeLessThan(0.1)
      expect(peak(packets, F.rest, 48, BUILD_AT, rate)).toBeLessThan(0.1)
    }
  }, 300000)

  // The case that says tension is built out of changes and not out of
  // levels: the sweep and the roll stop, nothing lands, and tension falls
  // back on its own because its evidence stopped being evidence.
  it('lets tension fall and fires nothing when a build fizzles', () => {
    for (const rate of RATES) {
      const packets = heard(true, rate)
      expect(peak(packets, F.tension, BUILD_AT, DROP_AT, rate)).toBeGreaterThan(0.5)
      expect(peak(packets, F.tension, DROP_AT + 4, DROP_AT + 6, rate)).toBeLessThan(0.4)
      expect(impacts(packets, rate)).toHaveLength(0)
    }
  }, 300000)

  it('sits in groove through a minute of steady house', () => {
    for (const rate of [60, 144]) {
      const packets = run(
        atLevel(synthesize([{ pattern: groove, seconds: 60 }], SAMPLE_RATE), LOUD),
        rate,
      )
      for (const row of [F.tension, F.release, F.rest])
        expect(peak(packets, row, 4, 60, rate)).toBeLessThan(0.1)
      expect(impacts(packets, rate)).toHaveLength(0)
    }
  }, 300000)

  // Nothing to hear: a pause, a seek, the gap between two tracks. The arms
  // are means of dB, and stepped through five seconds of silence they sank so
  // far that the groove coming back read as rest at a half for twenty more.
  const silence: Pattern = { ...groove, hits: [], pad: 0 }
  const around = (gap: number): Section[] => [
    { pattern: groove, seconds: 30 },
    { pattern: silence, seconds: gap },
    { pattern: groove, seconds: 24 },
  ]

  it('reads rest through a pause and lets it go when the music comes back', () => {
    for (const rate of [60, 144]) {
      const back = 35
      const packets = run(atLevel(synthesize(around(5), SAMPLE_RATE), LOUD), rate)
      expect(peak(packets, F.rest, 33, back, rate)).toBeGreaterThan(0.6)
      // Rest is slow on purpose, so it is given its own ramp twice over.
      expect(peak(packets, F.rest, back + 6, back + 24, rate)).toBeLessThan(0.1)
      expect(peak(packets, F.tension, back, back + 24, rate)).toBeLessThan(0.1)
      expect(impacts(packets, rate)).toHaveLength(0)
    }
  }, 300000)

  // Longer than any break a track would hold: what follows is another track,
  // and it opens the way the first one did.
  it('starts again after a gap too long to be a break', () => {
    const back = 42
    const packets = run(atLevel(synthesize(around(12), SAMPLE_RATE), LOUD), 60)
    expect(peak(packets, F.rest, back + 6, back + 24, 60)).toBeLessThan(0.1)
    expect(peak(packets, F.tension, back, back + 24, 60)).toBeLessThan(0.1)
    expect(impacts(packets, 60)).toHaveLength(0)
  }, 300000)

  // The bar of nothing some tracks put before the drop. It is the top of the
  // build and not the end of it, so the drop after it still has to land.
  it('still lands the drop after a bar of silence', () => {
    const bar = (4 * 60) / BPM
    const held: Section[] = [
      { pattern: groove, seconds: BREAKDOWN_AT },
      { pattern: breakdown(BPM, 0.12), seconds: 16 },
      { pattern: groove, seconds: 16 },
      ...build(BPM, 0.25, false),
      { pattern: silence, seconds: bar },
      { pattern: groove, seconds: 20 },
    ]
    for (const rate of [60, 144]) {
      const packets = run(atLevel(synthesize(held, SAMPLE_RATE), LOUD), rate)
      const found = impacts(packets, rate)
      expect(found).toHaveLength(1)
      expect(Math.abs((found[0] ?? 0) - (DROP_AT + bar))).toBeLessThan(60 / BPM)
    }
  }, 300000)

  // Twenty dB is a listener turning the music down, and nothing about the
  // shape of the song changed when they did.
  it('reads the same story 20 dB down', () => {
    for (const rate of [60, 144]) {
      const quiet = heard(false, rate, LOUD / 10)
      expect(peak(quiet, F.tension, BUILD_AT, DROP_AT, rate)).toBeGreaterThan(0.6)
      expect(peak(quiet, F.tension, 0, BUILD_AT, rate)).toBeLessThan(0.1)
      expect(peak(quiet, F.rest, BREAKDOWN_AT + 12, BREAKDOWN_AT + 16, rate)).toBeGreaterThan(0.6)
      const found = impacts(quiet, rate)
      expect(found).toHaveLength(1)
      expect(Math.abs((found[0] ?? 0) - DROP_AT)).toBeLessThan(60 / BPM)
    }
  }, 300000)

  // The whole point of measuring differences of dB between arms that are
  // spans of time: three displays hear one song. Measured across tension in
  // the build, rest in the breakdown and release at the drop, the widest
  // gap between 60, 120 and 144 frames a second is 0.04.
  it('agrees with itself at 60, 120 and 144 frames a second', () => {
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values)
    const runs = RATES.map((rate) => ({ rate, packets: heard(false, rate) }))
    expect(
      spread(runs.map(({ rate, packets }) => peak(packets, F.tension, BUILD_AT, DROP_AT, rate))),
    ).toBeLessThan(0.05)

    expect(
      spread(
        runs.map(({ rate, packets }) =>
          peak(packets, F.rest, BREAKDOWN_AT + 12, BREAKDOWN_AT + 16, rate),
        ),
      ),
    ).toBeLessThan(0.05)

    expect(
      spread(runs.map(({ rate, packets }) => peak(packets, F.release, DROP_AT, DROP_AT + 1, rate))),
    ).toBeLessThan(0.1)
  }, 300000)
})

/**
 * The dense song: a verse, a chorus and the verse again, a wall of noise
 * with a kit over it throughout. Its two passages differ in a couple of
 * bands and in how busy the kit is and in nothing else, which is what a
 * metal track's passages do. Under the fixed gain and the fixed bar this
 * song's novelty peaked at 0.24 at 60 frames a second and 0.12 at 144, so
 * nothing was ever proposed and the whole of it was one section; measured
 * against its own reach the same signal peaks near 1.
 */
describe('the structure on a dense song', () => {
  const VERSE_ENDS = 30
  const CHORUS_ENDS = 60
  // A boundary is only a section once six seconds of it have been heard, and
  // the novelty it starts from is the present against ten seconds ago, so a
  // change is called about ten seconds after it happened however dense the
  // track is. It is the same lateness the tuned-on dance track has.
  const LAG = 13
  const song: Section[] = [
    { pattern: denseVerse(), seconds: VERSE_ENDS },
    { pattern: denseChorus(), seconds: CHORUS_ENDS - VERSE_ENDS },
    { pattern: denseVerse(), seconds: 30 },
  ]

  /** Every frame the section id changes, and what it changed to. */
  const boundaries = (packets: Float32Array[], frameRate: number) => {
    const found: { at: number; section: number }[] = []
    let last = 1
    packets.forEach((packet, index) => {
      const section = packet[F.section] ?? 0
      if (section !== last) found.push({ at: index / frameRate, section })

      last = section
    })

    return found
  }

  const peakOf = (packets: Float32Array[], row: number, from: number, frameRate: number) =>
    packets
      .slice(Math.round(from * frameRate))
      .reduce((most, packet) => Math.max(most, packet[row] ?? 0), 0)

  for (const frameRate of [60, 144]) {
    describe(`at ${frameRate} frames a second`, () => {
      const packets = play(song, frameRate)

      it('finds both of its boundaries', () => {
        const found = boundaries(packets, frameRate)
        expect(found).toHaveLength(2)
        expect(found[0]?.at ?? 0).toBeGreaterThanOrEqual(VERSE_ENDS)
        expect(found[0]?.at ?? 0).toBeLessThan(VERSE_ENDS + LAG)
        expect(found[1]?.at ?? 0).toBeGreaterThanOrEqual(CHORUS_ENDS)
        expect(found[1]?.at ?? 0).toBeLessThan(CHORUS_ENDS + LAG)
      })

      it('lifts novelty where a fixed gain left it flat', () => {
        expect(peakOf(packets, F.novelty, VERSE_ENDS, frameRate)).toBeGreaterThan(0.4)
      })

      it('gives the verse its own number when it comes back', () => {
        const found = boundaries(packets, frameRate)
        expect(found[0]?.section).toBe(2)
        expect(found[1]?.section).toBe(1)
        expect(peakOf(packets, F.recall, CHORUS_ENDS, frameRate)).toBeGreaterThan(0.7)
      })

      // A listener drags the playhead out of a sparse intro into the wall.
      // The present against ten seconds ago is then one part of the song
      // against another, the widest thing the extractor ever sees, and as
      // the most the track has done it pins the scale at the top: the fixed
      // bar back again, and the dense song one section from there on. Told
      // of the seek, the scales start over and the song's own changes show.
      // The spectra are worked out as the file loads, the way `packets` is,
      // so the test itself is two passes of the extractor and no transforms.
      const before = 20
      const frames = analyse(
        synthesize([{ pattern: padOnly(90, 0.3), seconds: before }, ...song], SAMPLE_RATE),
        { sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, frameRate },
      )

      it('does not take a seek for the widest change the track makes', () => {
        const found = (told: boolean) => {
          const extractor = new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE })
          const packets = frames.map((frame, index) => {
            if (told && index === Math.round(before * frameRate)) extractor.seeked()
            return extractor.update(frame, 1 / frameRate).slice()
          })
          return boundaries(packets, frameRate).filter(({ at }) => at > before + LAG + 5)
        }
        expect(found(false).length).toBeLessThan(2)
        expect(found(true)).toHaveLength(2)
      }, 30_000)

      it('finds nothing in ninety seconds of one passage', () => {
        const steady = play([{ pattern: denseVerse(), seconds: 90 }], frameRate)
        expect(boundaries(steady, frameRate)).toHaveLength(0)
        // The floor under the relative bar is what does this: a passage
        // going nowhere is not stretched into structure.
        // 0.4 is the bar a candidate has to clear, now a share of the
        // track's own reach rather than a level.
        expect(peakOf(steady, F.novelty, 20, frameRate)).toBeLessThan(0.4)
      })
    })
  }
})
