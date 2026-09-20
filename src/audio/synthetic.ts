/**
 * A small drum machine and an offline stand-in for the AnalyserNode, so the
 * extractor can be run over music-like signals with a known tempo in Node.
 * Test support only: nothing in the visualizer imports it.
 *
 * The synthetic spectra the tests started with, a band jumping to -20 dB for
 * one frame, say what a detector does with a step; they cannot say what the
 * tempo tracker does with a two-step, because that failure came from the
 * hats and the kick and the snare each having a period of their own. So this
 * is a kick, a snare, a hat and a bass note, placed on a grid in beats,
 * summed into samples, and read back through a Blackman window and an FFT
 * scaled the way Chromium scales the analyser's, dB per bin and -Infinity
 * for nothing. What comes out is what `getFloatFrequencyData` would fill.
 *
 * Two more voices were added for `hardness`, a clipped kick and a soft pulse,
 * for the same reason: a synthetic step says nothing about how a hit arrives,
 * and how a hit arrives is the whole of what that feature measures.
 */

export type Drum = 'kick' | 'hardKick' | 'snare' | 'hat' | 'bass' | 'pulse'

/** One hit on the grid: which drum, which beat of the bar, how loud. */
export type Hit = {
  drum: Drum
  /** Beat within the bar, 0 up to `beats`; fractions are fine. */
  at: number
  /** Peak amplitude, 0 to 1. */
  gain: number
}

export type Pattern = {
  bpm: number
  /** Beats in a bar. The hits repeat every bar. */
  beats: number
  hits: readonly Hit[]
  /** A sustained chord under everything, as an amplitude; 0 for none. */
  pad?: number
}

/** A run of one pattern for so many seconds; sections are played back to back. */
export type Section = { pattern: Pattern; seconds: number }

/** Deterministic noise, so a run is the same every time. */
export function noise(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296 - 0.5
  }
}

/** How long each voice runs, in seconds. */
const VOICE_SECONDS: Record<Drum, number> = {
  kick: 0.35,
  hardKick: 0.35,
  snare: 0.25,
  hat: 0.06,
  bass: 0.6,
  pulse: 0.5,
}

/**
 * Six voices, each rendered into a buffer once and mixed in wherever the
 * grid asks for it. A kick is a sine sweeping down from 150 Hz to 50 with a
 * click on the front; a snare is a burst of noise with a 180 Hz body; a hat
 * is a short burst of differenced noise, which leans it toward the top of
 * the spectrum; a bass note is a 55 Hz tone with a soft attack and a long
 * tail, so it reads as a note rather than a hit.
 *
 * `hardKick` and `pulse` are the two ends of `hardness`, and they are a pair:
 * the same low register struck as hard and as softly as a signal can be, so
 * that a test can hold the rate and the loudness fixed and change only how
 * the hit arrives.
 */
function voice(drum: Drum, sampleRate: number, random: () => number): Float32Array {
  const seconds = VOICE_SECONDS[drum]
  const length = Math.round(seconds * sampleRate)
  const out = new Float32Array(length)
  let phase = 0
  let previous = 0
  for (let index = 0; index < length; index++) {
    const t = index / sampleRate
    let sample = 0
    if (drum === 'kick') {
      const hz = 50 + 100 * Math.exp(-t / 0.03)
      phase += (2 * Math.PI * hz) / sampleRate
      sample = Math.sin(phase) * Math.exp(-t / 0.12)
      if (t < 0.003) sample += random() * 0.8
    } else if (drum === 'hardKick') {
      const hz = 50 + 100 * Math.exp(-t / 0.03)
      phase += (2 * Math.PI * hz) / sampleRate
      // The same kick driven into a clipper, which is what makes a hardstyle
      // kick one: while the envelope is above the clip point the sine is a
      // square, so its harmonics run to Nyquist and the waveform sits at the
      // ceiling instead of decaying away from it.
      sample = Math.tanh(8 * Math.sin(phase) * Math.exp(-t / 0.12))
    } else if (drum === 'pulse') {
      // The soft end: one partial, no click, and an attack spread over
      // several analyser windows rather than landing inside one.
      const attack = 0.12
      const envelope =
        t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : Math.exp(-(t - attack) / 0.2)
      sample = Math.sin(2 * Math.PI * 55 * t) * envelope * 0.9
    } else if (drum === 'snare') {
      const body = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-t / 0.05) * 0.6
      sample = body + random() * 1.4 * Math.exp(-t / 0.08)
    } else if (drum === 'hat') {
      const white = random()
      // The difference of white noise rises 6 dB an octave, which is enough
      // to put most of its power above 4 kHz.
      sample = (white - previous) * 1.4 * Math.exp(-t / 0.02)
      previous = white
    } else {
      const attack = Math.min(1, t / 0.02)
      sample = Math.sin(2 * Math.PI * 55 * t) * attack * Math.exp(-t / 0.4) * 0.9
    }

    out[index] = sample
  }

  return out
}

/**
 * The sections played back to back, as samples. Hits are placed to the
 * sample, so the tempo in the signal is exactly the tempo asked for.
 */
export function synthesize(sections: readonly Section[], sampleRate = 48000): Float32Array {
  const random = noise(1)
  const voices: Record<Drum, Float32Array> = {
    kick: voice('kick', sampleRate, random),
    hardKick: voice('hardKick', sampleRate, random),
    snare: voice('snare', sampleRate, random),
    hat: voice('hat', sampleRate, random),
    bass: voice('bass', sampleRate, random),
    pulse: voice('pulse', sampleRate, random),
  }
  const total = sections.reduce((sum, section) => sum + Math.round(section.seconds * sampleRate), 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const { pattern, seconds } of sections) {
    const length = Math.round(seconds * sampleRate)
    const beat = 60 / pattern.bpm
    const bar = beat * pattern.beats
    for (let start = 0; start < seconds; start += bar) {
      for (const hit of pattern.hits) {
        const at = Math.round((start + hit.at * beat) * sampleRate)
        if (at >= length) continue
        const samples = voices[hit.drum]
        for (let index = 0; index < samples.length && at + index < length; index++)
          out[offset + at + index] =
            (out[offset + at + index] ?? 0) + (samples[index] ?? 0) * hit.gain
      }
    }

    if (pattern.pad) {
      for (let index = 0; index < length; index++) {
        const t = index / sampleRate
        const chord =
          Math.sin(2 * Math.PI * 220 * t) +
          Math.sin(2 * Math.PI * 277.2 * t) +
          Math.sin(2 * Math.PI * 329.6 * t) +
          0.5 * Math.sin(2 * Math.PI * 659.3 * t)
        out[offset + index] = (out[offset + index] ?? 0) + chord * pattern.pad * 0.25
      }
    }

    offset += length
  }

  return out
}

/** In-place radix-2 FFT. `re` and `im` are the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array) {
  const length = re.length
  for (let i = 1, j = 0; i < length; i++) {
    let bit = length >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i] ?? 0
      re[i] = re[j] ?? 0
      re[j] = tr
      const ti = im[i] ?? 0
      im[i] = im[j] ?? 0
      im[j] = ti
    }
  }

  for (let size = 2; size <= length; size <<= 1) {
    const angle = (-2 * Math.PI) / size
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let start = 0; start < length; start += size) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < size / 2; k++) {
        const even = start + k
        const odd = even + size / 2
        const xr = (re[odd] ?? 0) * cr - (im[odd] ?? 0) * ci
        const xi = (re[odd] ?? 0) * ci + (im[odd] ?? 0) * cr
        re[odd] = (re[even] ?? 0) - xr
        im[odd] = (im[even] ?? 0) - xi
        re[even] = (re[even] ?? 0) + xr
        im[even] = (im[even] ?? 0) + xi
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

export type AnalyserOptions = {
  sampleRate: number
  fftSize: number
  /** Frames a second the analyser is read at. */
  frameRate: number
}

/**
 * The frames `getFloatFrequencyData` would fill if the analyser were read at
 * `frameRate` while `samples` played: for each frame the last `fftSize`
 * samples under a Blackman window, the magnitude of each bin over the FFT
 * size, in dB. Chromium's scaling, so a full-scale sine reads about -14 dB
 * in its bin and a bin with nothing in it is -Infinity.
 */
export function analyse(samples: Float32Array, options: AnalyserOptions): Float32Array[] {
  const { sampleRate, fftSize, frameRate } = options
  const bins = fftSize / 2
  const window = new Float64Array(fftSize)
  for (let n = 0; n < fftSize; n++)
    window[n] =
      0.42 -
      0.5 * Math.cos((2 * Math.PI * n) / (fftSize - 1)) +
      0.08 * Math.cos((4 * Math.PI * n) / (fftSize - 1))
  const re = new Float64Array(fftSize)
  const im = new Float64Array(fftSize)
  const frames: Float32Array[] = []
  const hop = sampleRate / frameRate
  for (let end = fftSize; end <= samples.length; end += hop) {
    const start = Math.round(end) - fftSize
    for (let n = 0; n < fftSize; n++) {
      re[n] = (samples[start + n] ?? 0) * (window[n] ?? 0)
      im[n] = 0
    }

    fft(re, im)
    const frame = new Float32Array(bins)
    for (let bin = 0; bin < bins; bin++) {
      const magnitude = Math.hypot(re[bin] ?? 0, im[bin] ?? 0) / fftSize
      frame[bin] = magnitude > 0 ? 20 * Math.log10(magnitude) : -Infinity
    }

    frames.push(frame)
  }

  return frames
}

/** A beat of the bar, for laying out hits. */
const on = (drum: Drum, at: number, gain: number): Hit => ({ drum, at, gain })

/**
 * Four to the floor: kick on every beat, snare on two and four, hats on
 * every eighth with the off-beats softer, a bass note under each kick.
 */
export function fourOnTheFloor(bpm: number, pad = 0): Pattern {
  const hits: Hit[] = []
  for (let beat = 0; beat < 4; beat++) {
    hits.push(on('kick', beat, 0.9), on('bass', beat, 0.5))
    hits.push(on('hat', beat, 0.35), on('hat', beat + 0.5, 0.2))
  }

  hits.push(on('snare', 1, 0.7), on('snare', 3, 0.7))
  return { bpm, beats: 4, hits, pad }
}

/** How loud each drum plays in a pattern, 0 to 1. */
export type Mix = { kick: number; snare: number; hat: number }

/**
 * The drum and bass two-step: kick on one and on the and of three, snare on
 * two and four, a ghost snare before the second kick, hats on every eighth.
 * The kicks are a dotted quarter apart, which is the figure that read as
 * two thirds of the tempo on the real tracks. Nothing in it plays on every
 * beat, which is why it is the hard case.
 */
export function twoStep(
  bpm: number,
  pad = 0,
  mix: Mix = { kick: 0.9, snare: 0.8, hat: 0.35 },
): Pattern {
  const hits: Hit[] = [
    on('kick', 0, mix.kick),
    on('bass', 0, 0.5),
    on('snare', 1, mix.snare),
    on('snare', 1.75, mix.snare * 0.3),
    on('kick', 2.5, mix.kick),
    on('bass', 2.5, 0.5),
    on('snare', 3, mix.snare),
  ]
  for (let eighth = 0; eighth < 8; eighth++)
    hits.push(on('hat', eighth / 2, eighth % 2 ? mix.hat * 0.6 : mix.hat))
  return { bpm, beats: 4, hits, pad }
}

/** A breakdown: no drums, just the pad and a bass note on the one. */
export function breakdown(bpm: number, pad = 0.6): Pattern {
  return { bpm, beats: 4, hits: [on('bass', 0, 0.4)], pad }
}

/**
 * One voice on every beat and nothing else, so two kinds of hit can be
 * compared at the same rate with nothing else in the mix to read.
 */
export function steadyHits(bpm: number, drum: Drum, gain = 0.9): Pattern {
  return { bpm, beats: 4, hits: [0, 1, 2, 3].map((beat) => on(drum, beat, gain)) }
}

/** A sustained chord and nothing struck at all: no onsets after the first. */
export function padOnly(bpm: number, pad = 0.5): Pattern {
  return { bpm, beats: 4, hits: [], pad }
}

/** The root mean square of a rendered buffer. */
export function level(samples: Float32Array): number {
  let squares = 0
  for (let index = 0; index < samples.length; index++) squares += (samples[index] ?? 0) ** 2
  return Math.sqrt(squares / Math.max(1, samples.length))
}

/**
 * The same buffer at a given RMS, for holding loudness fixed across a
 * comparison of two patterns, or for asking the same one 20 dB down.
 */
export function atLevel(samples: Float32Array, target: number): Float32Array {
  const gain = target / Math.max(level(samples), 1e-12)
  const out = new Float32Array(samples.length)
  for (let index = 0; index < samples.length; index++) out[index] = (samples[index] ?? 0) * gain
  return out
}
