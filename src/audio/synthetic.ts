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

/**
 * A riser: a swarm of partials sliding up together, under everything else.
 * `from` and `to` are where the lowest of them starts and ends, in Hz, and
 * the slide is exponential so it climbs by the same interval every second.
 */
export type Sweep = { from: number; to: number; gain: number }

/**
 * A wall: band-limited noise held through the whole section, which is what a
 * distorted guitar and a ride cymbal look like to five bands. `tilt` splits
 * it between the low side and the high side of 800 Hz, 0 for all low and 1
 * for all high, so two passages can differ in a couple of bands and in
 * nothing else.
 */
export type Wall = { gain: number; tilt: number }

export type Pattern = {
  bpm: number
  /** Beats in a bar. The hits repeat every bar. */
  beats: number
  hits: readonly Hit[]
  /** A sustained chord under everything, as an amplitude; 0 for none. */
  pad?: number
  /** A riser climbing across the whole of this section; absent for none. */
  sweep?: Sweep
  /** A wall of noise under everything, for a dense track; absent for none. */
  wall?: Wall
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

    if (pattern.sweep) {
      const { from, to, gain } = pattern.sweep
      // Twelve partials at irrational spacings, all sliding up together. A
      // riser has to lift the top of the spectrum without putting a key in
      // it, and a harmonic stack does put one in it: its partials fold onto
      // one pitch class and the chroma reads a note climbing. Spaced by an
      // irrational step the twelve land on twelve different pitch classes at
      // every moment of the slide, so `keyClarity` stays where the rest of
      // the mix left it. The amplitude is flat across the slide, so what
      // climbs is where the power sits and not how much of it there is.
      const partials = 12
      const each = (gain * 0.9) / Math.sqrt(partials)
      for (let partial = 0; partial < partials; partial++) {
        const ratio = 1 + partial * 0.3718
        // Dropped whole rather than cut off part way up: a partial silenced
        // mid-slide is a click, and a click is an onset.
        if (ratio * to > 16000) continue
        let phase = 0
        for (let index = 0; index < length; index++) {
          const hz = ratio * from * (to / from) ** (index / length)
          phase += (2 * Math.PI * hz) / sampleRate
          out[offset + index] = (out[offset + index] ?? 0) + Math.sin(phase) * each
        }
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

    if (pattern.wall) {
      const { gain, tilt } = pattern.wall
      // One pole at about 800 Hz, and what it leaves behind. Noise rather
      // than partials because a wall has to fill every band without putting
      // a key in any of them: a chroma read off it is flat, so two walls
      // differ in where their power sits and in nothing the harmony hears.
      const alpha = 1 - Math.exp((-2 * Math.PI * 800) / sampleRate)
      let low = 0
      for (let index = 0; index < length; index++) {
        const white = random()
        low += (white - low) * alpha
        const high = white - low
        // The low side is the quieter of the two for the same amplitude,
        // being one pole down, so it is lifted to keep the two sides worth
        // about the same to a band.
        out[offset + index] =
          (out[offset + index] ?? 0) + (3 * low * (1 - tilt) + high * tilt) * gain
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
 * A build, as sections rather than as one pattern, because everything that
 * makes a build a build changes from bar to bar and a pattern repeats.
 *
 * The three things a listener hears coming: a snare roll that doubles, from
 * quarters to eighths to sixteenths; a riser climbing the whole way; and the
 * kick walking out for the last bar, which is what leaves the hole the drop
 * falls into. Each stage runs two bars so that the whole is the four to
 * sixteen seconds the slow measures are built to read, bar the last, which
 * is one.
 *
 * `fizzle` replaces that last bar with the groove carrying on quietly: the
 * riser stops, the roll stops and nothing lands. It is the case a tension
 * that only ever went up would get wrong, since not every riser ends in a
 * drop.
 */
export function build(bpm: number, pad = 0.25, fizzle = false): Section[] {
  const bar = 240 / bpm
  // The roll gets quieter per hit as it gets denser, the way a drummer's
  // does, so what climbs is the rate of hits and not the loudness of one.
  // Flat gain was tried and the low end never emptied for the last bar: a
  // snare's body is at 180 Hz, so sixteen loud ones a bar keep the low group
  // as full as the kick did, and the drop had nothing to come back from.
  const roll = (division: number): Hit[] =>
    Array.from({ length: division }, (_, step) =>
      on('snare', (step * 4) / division, 0.55 / Math.sqrt(division / 4)),
    )
  const kicks = [0, 1, 2, 3].map((beat) => on('kick', beat, 0.9))
  const stage = (division: number, from: number, to: number, gain: number): Section => ({
    pattern: { bpm, beats: 4, hits: [...kicks, ...roll(division)], pad, sweep: { from, to, gain } },
    seconds: 2 * bar,
  })
  const last: Section = fizzle
    ? { pattern: { bpm, beats: 4, hits: [...kicks, on('hat', 2, 0.15)], pad }, seconds: bar }
    : {
        pattern: { bpm, beats: 4, hits: roll(16), pad, sweep: { from: 1400, to: 2600, gain: 0.3 } },
        seconds: bar,
      }
  return [stage(4, 200, 420, 0.12), stage(8, 420, 850, 0.18), stage(16, 850, 1400, 0.24), last]
}

/**
 * One voice on every beat and nothing else, so two kinds of hit can be
 * compared at the same rate with nothing else in the mix to read.
 */
export function steadyHits(bpm: number, drum: Drum, gain = 0.9): Pattern {
  return { bpm, beats: 4, hits: [0, 1, 2, 3].map((beat) => on(drum, beat, gain)) }
}

/**
 * A dense passage: a wall of noise with a kit over it, loud from end to end,
 * which is what a metal track looks like to five bands. Everything a
 * structure vector reads is pinned near the top of its range and stays
 * there, so two of these are 0.98 alike however differently they are played,
 * and the novelty between them never comes near the 0.4 a dance track's
 * boundaries clear. `busy` doubles the kit the way a chorus doubles it, and
 * the tilt moves a little of the wall between the low and the high side.
 *
 * It exists because every threshold in the structure was read off a track
 * whose passages sound nothing alike, and a bar that suits that hears no
 * structure at all in this.
 */
export function densePassage(bpm: number, tilt: number, busy: boolean): Pattern {
  const hits: Hit[] = []
  for (let beat = 0; beat < 4; beat++) {
    hits.push(on('kick', beat, 0.9))
    if (busy) hits.push(on('kick', beat + 0.5, 0.8))
    hits.push(on('hat', beat, 0.3), on('hat', beat + 0.5, 0.25))
  }

  hits.push(on('snare', 1, 0.8), on('snare', 3, 0.8))
  if (busy) hits.push(on('snare', 0, 0.5), on('snare', 2, 0.5))
  return { bpm, beats: 4, hits, wall: { gain: 0.35, tilt } }
}

/** The two passages of the dense song: a verse and the chorus it opens into. */
export const denseVerse = (bpm = 150): Pattern => densePassage(bpm, 0.35, false)
export const denseChorus = (bpm = 150): Pattern => densePassage(bpm, 0.55, true)

/** A sustained chord and nothing struck at all: no onsets after the first. */
export function padOnly(bpm: number, pad = 0.5): Pattern {
  return { bpm, beats: 4, hits: [], pad }
}

/**
 * One voice on every beat, sixteenth hats over it and a pad under it: enough
 * of a track for `hardness` to be asked a real question, which `steadyHits`
 * cannot since it plays one voice into silence. Changing only the voice, the
 * hats and the pad gives a hardstyle track, a house one and a lo-fi one that
 * differ in nothing else.
 */
export function kit(bpm: number, drum: Drum, hat: number, pad = 0): Pattern {
  const hits: Hit[] = []
  for (let beat = 0; beat < 4; beat++) hits.push(on(drum, beat, 0.9))
  for (let sixteenth = 0; sixteenth < 16; sixteenth++) hits.push(on('hat', sixteenth / 4, hat))
  return { bpm, beats: 4, hits, pad }
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
