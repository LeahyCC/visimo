import { describe, expect, it } from 'vitest'

import { F, FeatureExtractor } from './FeatureExtractor'
import {
  analyse,
  atLevel,
  breakdown,
  fft,
  fourOnTheFloor,
  padOnly,
  steadyHits,
  synthesize,
  twoStep,
} from './synthetic'
import type { Section } from './synthetic'

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
