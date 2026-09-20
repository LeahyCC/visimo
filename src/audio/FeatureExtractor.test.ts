import { describe, expect, it } from 'vitest'

import {
  BAND_COUNT,
  BAND_HIT,
  BAND_NAMES,
  BAND_PULSE,
  bandFilter,
  dbToLinear,
  DEFAULT_BANDS,
  Envelope,
  F,
  FeatureExtractor,
  keyHueOf,
  keyLabel,
  keyOf,
  PACKET_LENGTH,
  pitchClass,
  Song,
} from './FeatureExtractor'

const SAMPLE_RATE = 48000
const FFT_SIZE = 2048
const DT = 1 / 60

/** A frame of dB values from a function of frequency, as the analyser would fill it. */
function spectrum(level: (hz: number) => number, fftSize = FFT_SIZE) {
  const bins = fftSize / 2
  const frame = new Float32Array(bins)
  for (let bin = 0; bin < bins; bin++) frame[bin] = level((bin * SAMPLE_RATE) / fftSize)
  return frame
}

const silence = () => -Infinity
const flat = (db: number) => () => db
const only = (low: number, high: number, db: number) => (hz: number) =>
  hz >= low && hz < high ? db : -100

/** Deterministic noise for jitter tests. */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

describe('dbToLinear', () => {
  it('maps silence to 0 and 0 dB to 1', () => {
    expect(dbToLinear(-Infinity)).toBe(0)
    expect(dbToLinear(0)).toBe(1)
    expect(dbToLinear(-20)).toBeCloseTo(0.1)
  })
})

describe('bandFilter', () => {
  const width = (fftSize: number) => SAMPLE_RATE / fftSize

  // The whole point of weighting the edge bins: a band ends up exactly as wide
  // as the Hz it asked for, instead of as wide as the nearest whole bins.
  it('weighs exactly the width the band asked for, at any fft size', () => {
    for (const fftSize of [2048, 4096]) {
      for (const [low, high] of [
        [20, 60],
        [60, 250],
        [250, 1000],
        [4000, 16000],
      ]) {
        const filter = bandFilter(low ?? 0, high ?? 0, fftSize, SAMPLE_RATE)
        expect(filter.total).toBeCloseTo(((high ?? 0) - (low ?? 0)) / width(fftSize), 5)
      }
    }
  })

  // Neighbours must share the bin they straddle, not both claim it and not
  // both round it away, or the levels stop adding up to the spectrum.
  it('splits the bin two neighbours straddle between them', () => {
    const bass = bandFilter(60, 250, 2048, SAMPLE_RATE)
    const lowMid = bandFilter(250, 1000, 2048, SAMPLE_RATE)
    const shared = Math.round(250 / width(2048))
    const inBass = bass.weights[shared - bass.start] ?? 0
    const inLowMid = lowMid.weights[shared - lowMid.start] ?? 0
    expect(inBass).toBeGreaterThan(0)
    expect(inLowMid).toBeGreaterThan(0)
    expect(inBass + inLowMid).toBeCloseTo(1, 5)
  })

  it('keeps weight in the narrowest band at the coarsest fft size', () => {
    const filter = bandFilter(20, 60, 512, SAMPLE_RATE)
    expect(filter.total).toBeGreaterThan(0)
    expect(filter.end).toBeGreaterThan(filter.start)
  })

  it('never runs past the bins there are', () => {
    const filter = bandFilter(20000, 30000, 2048, SAMPLE_RATE)
    expect(filter.end).toBeLessThanOrEqual(1024)
    expect(filter.total).toBeGreaterThan(0)
  })
})

describe('Envelope', () => {
  it('reaches 63% of a step after one attack time and falls to 37% after one release time', () => {
    const envelope = new Envelope(10, 150)
    const step = 0.001
    for (let t = 0; t < 0.01; t += step) envelope.step(1, step)
    expect(envelope.value).toBeCloseTo(1 - Math.exp(-1), 1)
    for (let t = 0; t < 0.15; t += step) envelope.step(0, step)
    expect(envelope.value).toBeCloseTo(Math.exp(-1) * (1 - Math.exp(-1)), 1)
  })
})

describe('FeatureExtractor', () => {
  const make = (fftSize = FFT_SIZE) => new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize })

  it('has the documented packet length and indices', () => {
    expect(PACKET_LENGTH).toBe(47)
    expect(F.treble).toBe(4)
    expect(F.tempoBpm).toBe(21)
    expect(F.dt).toBe(23)
    expect(F.tempo).toBe(27)
    expect(F.harmonicChange).toBe(30)
    expect(F.section).toBe(33)
    expect(F.subHitCentre).toBe(34)
    expect(F.trebleHitWidth).toBe(43)
    // Rows are only ever added at the end, because the indices are public.
    expect(F.tempoConfidence).toBe(44)
    expect(F.beatPhase).toBe(45)
    expect(F.hardness).toBe(46)
    expect(make().packet).toHaveLength(PACKET_LENGTH)
  })

  // The three blocks are read by offset from a band index, so they have to
  // stay contiguous and in the same band order as the levels.
  it('lays the bands out as level, hit and pulse in the same order', () => {
    BAND_NAMES.forEach((name, band) => {
      expect(F[name]).toBe(band)
      expect(F[`${name}Hit` as const]).toBe(BAND_HIT + band)
      expect(F[`${name}Pulse` as const]).toBe(BAND_PULSE + band)
    })
    expect(BAND_COUNT).toBe(DEFAULT_BANDS.length)
  })

  it('collapses a bass-only spectrum into the bass band', () => {
    const extractor = make()
    let packet: Float32Array = extractor.packet
    for (let frame = 0; frame < 120; frame++)
      packet = extractor.update(spectrum(only(80, 200, -20)), DT)
    expect(packet[F.bass]).toBeGreaterThan(0.95)
    for (const index of [F.sub, F.lowMid, F.highMid, F.treble]) {
      expect(packet[index]).toBeLessThan(0.1)
    }
    expect(packet[F.energy]).toBeGreaterThan(0.9)
  })

  it('collapses the same tone the same way at fftSize 4096', () => {
    const extractor = make(4096)
    let packet: Float32Array = extractor.packet
    for (let frame = 0; frame < 120; frame++) {
      packet = extractor.update(spectrum(only(2000, 3000, -20), 4096), DT)
    }
    expect(packet[F.highMid]).toBeGreaterThan(0.95)
    expect(packet[F.bass]).toBeLessThan(0.1)
  })

  it('reads silence as zero without onsets', () => {
    const extractor = make()
    let onsets = 0
    let packet: Float32Array = extractor.packet
    for (let frame = 0; frame < 300; frame++) {
      packet = extractor.update(spectrum(silence), DT)
      onsets += packet[F.onset] ?? 0
    }
    expect(onsets).toBe(0)
    for (let index = 0; index <= F.tempoBpm; index++) expect(packet[index]).toBe(0)
    expect(packet[F.keyClarity]).toBe(0)
    expect(packet[F.harmonicChange]).toBe(0)
    expect(packet[F.recall]).toBe(0)
    expect(packet[F.section]).toBe(1)
    // The song-scale features rest in the middle, not at zero: silence is
    // neither lifting nor dropping, and neither bass-led nor bright.
    expect(packet[F.pace]).toBe(0)
    expect(packet[F.tempo]).toBe(0)
    expect(packet[F.swell]).toBe(0.5)
    expect(packet[F.weight]).toBe(0.5)
    // Hardness rests in the middle too: a track nothing has been heard of is
    // not a soft one.
    expect(packet[F.hardness]).toBe(0.5)
    expect(packet[F.tempoConfidence]).toBe(0)
    expect(packet[F.beatPhase]).toBe(0)
    expect(packet[F.time]).toBeCloseTo(5, 1)
  })

  it('gives treble a faster attack than sub, per the defaults', () => {
    const extractor = make()
    const wide = spectrum(only(20, 16000, -20))
    let packet: Float32Array = extractor.packet
    // After one frame of a step, the faster band has climbed further.
    packet = extractor.update(spectrum(only(20, 16000, -100)), DT)
    packet = extractor.update(wide, DT)
    expect(packet[F.treble]).toBeGreaterThan(packet[F.sub] ?? 0)
    expect(DEFAULT_BANDS[4]?.attackMs).toBeLessThan(DEFAULT_BANDS[0]?.attackMs ?? 0)
  })

  it('detects every click in a click train and none in between, then finds its tempo', () => {
    const extractor = make()
    const quiet = spectrum(flat(-40))
    const click = spectrum(flat(-10))
    const onsetFrames: number[] = []
    let tempo = 0
    // Two clicks a second for twelve seconds: 120 beats per minute.
    for (let frame = 0; frame < 720; frame++) {
      const packet = extractor.update(frame % 30 === 0 ? click : quiet, DT)
      if (packet[F.onset]) onsetFrames.push(frame)
      tempo = packet[F.tempoBpm] ?? 0
    }
    // The first click lands before the window has anything to compare with.
    const expected = Array.from({ length: 23 }, (_, i) => (i + 1) * 30)
    expect(onsetFrames).toEqual(expected)
    expect(tempo).toBeGreaterThan(117)
    expect(tempo).toBeLessThan(123)
  })

  it('reads a kick and snare pattern at the beat, not the bar', () => {
    // 140 BPM at 70 frames a second is 30 frames a beat. Beats alternate a
    // strong and a slightly softer hit, so the two-beat lag correlates as well
    // as the one-beat lag and a naive pick would say 70.
    const extractor = new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE })
    const quiet = spectrum(flat(-40))
    const strong = spectrum(flat(-10))
    const soft = spectrum(flat(-13))
    let tempo = 0
    for (let frame = 0; frame < 70 * 12; frame++) {
      const beat = frame % 30 === 0
      const frameIn = beat ? ((frame / 30) % 2 === 0 ? strong : soft) : quiet
      tempo = extractor.update(frameIn, 1 / 70)[F.tempoBpm] ?? 0
    }
    expect(tempo).toBeGreaterThan(137)
    expect(tempo).toBeLessThan(143)
  })

  it('pulses to 1 on a click and decays afterwards', () => {
    const extractor = make()
    const quiet = spectrum(flat(-40))
    for (let frame = 0; frame < 60; frame++) extractor.update(quiet, DT)
    const hit = extractor.update(spectrum(flat(-10)), DT)
    expect(hit[F.onset]).toBe(1)
    expect(hit[F.beatPulse]).toBe(1)
    expect(hit[F.onsetStrength]).toBeGreaterThan(0.5)
    const later = extractor.update(quiet, DT)
    expect(later[F.beatPulse]).toBeLessThan(1)
    expect(later[F.beatPulse]).toBeGreaterThan(0.8)
    let packet: Float32Array = later
    for (let frame = 0; frame < 60; frame++) packet = extractor.update(quiet, DT)
    expect(packet[F.beatPulse]).toBeLessThan(0.01)
  })

  it('rarely calls steady jitter an onset', () => {
    const extractor = make()
    const next = random(7)
    let onsets = 0
    for (let frame = 0; frame < 600; frame++) {
      const packet = extractor.update(
        spectrum(() => -40 + (next() - 0.5) * 4),
        DT,
      )
      onsets += packet[F.onset] ?? 0
    }
    expect(onsets).toBeLessThanOrEqual(3)
  })

  it('clamps a wild frame step and keeps time', () => {
    const extractor = make()
    const packet = extractor.update(spectrum(silence), 5)
    expect(packet[F.dt]).toBeCloseTo(0.1)
    expect(packet[F.time]).toBeCloseTo(0.1)
  })
})

describe('per-band onsets', () => {
  const make = () => new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE })

  /**
   * Run `frames` frames, clicking each named band on its own period. A click
   * is that band's range jumping to -20 dB for one frame over a quiet floor.
   *
   * Returns how many onsets each band called and what they came to.
   *
   * Worth knowing when reading the assertions: a detector grades a hit against
   * its own recent peak, so a band left exactly silent has a threshold of zero
   * and will call a full-strength onset on any rise at all. A dither does not
   * help, because the threshold is relative and white noise has the same
   * relative spread at any amplitude. So what is checked here is the invariant
   * the band edges actually give: a band hears only bands it shares an edge
   * bin with, and never more often than they were struck.
   */
  function run(frames: number, clicks: Partial<Record<(typeof BAND_NAMES)[number], number>>) {
    const extractor = make()
    const counts: Record<string, number> = {}
    const force: Record<string, number> = {}
    const ranges: Record<string, [number, number]> = {
      sub: [20, 60],
      bass: [60, 250],
      lowMid: [250, 1000],
      highMid: [1000, 4000],
      treble: [4000, 16000],
    }
    for (const name of BAND_NAMES) {
      counts[name] = 0
      force[name] = 0
    }

    for (let frame = 0; frame < frames; frame++) {
      const loud: [number, number][] = []
      for (const [name, every] of Object.entries(clicks))
        if (every && frame > 0 && frame % every === 0) {
          const range = ranges[name]
          if (range) loud.push(range)
        }
      const packet = extractor.update(
        spectrum((hz) => (loud.some(([low, high]) => hz >= low && hz < high) ? -20 : -100)),
        DT,
      )
      BAND_NAMES.forEach((name, band) => {
        const hit = packet[BAND_HIT + band] ?? 0
        if (hit > 0) {
          counts[name] = (counts[name] ?? 0) + 1
          force[name] = (force[name] ?? 0) + hit
        }
      })
    }
    return { counts, force }
  }

  it('fires only the band that was struck', () => {
    const { counts } = run(360, { sub: 30 })
    expect(counts.sub ?? 0).toBeGreaterThan(5)
    for (const name of ['bass', 'lowMid', 'highMid', 'treble']) expect(counts[name] ?? 0).toBe(0)
  })

  // The whole point of the refactor: a kick and a hat on different periods are
  // two different events, not one event arriving at two volumes.
  it('counts two patterns at different rates without either reading the other', () => {
    // Sub every 30 frames, treble every 10, over 360 frames.
    const { counts } = run(360, { sub: 30, treble: 10 })
    expect(counts.treble ?? 0).toBeGreaterThan((counts.sub ?? 0) * 2)
    expect(counts.sub ?? 0).toBeGreaterThan(5)
    // Neither of these shares an edge bin with sub or treble, so both are
    // deaf to the whole run. That is the part that matters.
    for (const name of ['bass', 'lowMid']) expect(counts[name] ?? 0).toBe(0)
    // highMid does share one with treble: the bin centred at 4007.8 Hz
    // straddles the 4 kHz line and 17% of it is highMid's, which is the
    // fractional edge being right rather than leaking. It is 0.13% of
    // highMid's weight, under any threshold a real floor would build, and it
    // can never tick on a frame treble did not.
    expect(counts.highMid ?? 0).toBeLessThanOrEqual(counts.treble ?? 0)
  })

  // Each detector keeps its own rolling window, so a band that is always busy
  // raises only its own bar.
  it('lets a quiet band keep firing while another is saturated', () => {
    const { counts } = run(360, { lowMid: 2, treble: 30 })
    expect(counts.treble ?? 0).toBeGreaterThan(5)
  })

  it('calls no onset in any band on silence', () => {
    const extractor = make()
    let packet: Float32Array = extractor.packet
    for (let frame = 0; frame < 300; frame++) packet = extractor.update(spectrum(silence), DT)
    for (let band = 0; band < BAND_COUNT; band++) {
      expect(packet[BAND_HIT + band]).toBe(0)
      expect(packet[BAND_PULSE + band]).toBe(0)
    }
  })

  it('holds a band pulse up after its hit and lets it fall', () => {
    const extractor = make()
    const quiet = spectrum(only(20, 60, -100))
    const hit = spectrum(only(20, 60, -20))
    let packet: Float32Array = extractor.packet
    for (let frame = 0; frame < 40; frame++) packet = extractor.update(quiet, DT)
    packet = extractor.update(hit, DT)
    expect(packet[F.subHit] ?? 0).toBeGreaterThan(0)
    expect(packet[F.subPulse]).toBe(1)
    packet = extractor.update(quiet, DT)
    expect(packet[F.subPulse] ?? 0).toBeGreaterThan(0.8)
    for (let frame = 0; frame < 60; frame++) packet = extractor.update(quiet, DT)
    expect(packet[F.subPulse] ?? 1).toBeLessThan(0.01)
  })
})

describe('band accuracy', () => {
  const make = (fftSize = FFT_SIZE) => new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize })

  const settle = (extractor: FeatureExtractor, frame: Float32Array, frames = 120) => {
    let packet: Float32Array = extractor.packet
    for (let at = 0; at < frames; at++) packet = extractor.update(frame, DT)
    return packet
  }

  // Rounding to whole bins put the top of the sub band at 70 Hz, so a bass
  // note at 65 read as sub. Weighting the straddling bin splits it instead.
  it('splits a tone sitting on a band edge between both bands', () => {
    const extractor = make()
    // Straddling the 60 Hz line between sub and bass. It has to be this wide
    // because at 2048 a bin is 23 Hz, so a narrower tone falls between bins.
    const packet = settle(extractor, spectrum(only(40, 80, -20)))
    expect(packet[F.sub] ?? 0).toBeGreaterThan(0.1)
    expect(packet[F.bass] ?? 0).toBeGreaterThan(0.1)
    expect(packet[F.lowMid] ?? 0).toBeLessThan(0.1)
  })

  it('keeps a tone well inside a band out of its neighbours', () => {
    const packet = settle(make(), spectrum(only(400, 600, -20)))
    expect(packet[F.lowMid] ?? 0).toBeGreaterThan(0.9)
    expect(packet[F.bass] ?? 0).toBeLessThan(0.1)
    expect(packet[F.highMid] ?? 0).toBeLessThan(0.1)
  })

  // A level is the root mean square, so it follows the power in a band and not
  // how many bins that power is spread over. As a mean of magnitudes, the same
  // power gathered into one bright partial read about sqrt(bins) lower, which
  // in a 512-bin treble band is a factor of over twenty.
  it('reads the same level whether a band is spread out or concentrated', () => {
    const bins = 512
    const spread = 0.01
    const gathered = spread * Math.sqrt(bins)
    const db = (amplitude: number) => 20 * Math.log10(amplitude)
    const extractor = make()
    settle(extractor, spectrum(only(4000, 16000, db(spread))))
    // The same total power, now in a single narrow partial near 8 kHz.
    const packet = settle(
      extractor,
      spectrum(only(8000, 8000 + SAMPLE_RATE / FFT_SIZE, db(gathered))),
      60,
    )
    expect(packet[F.treble] ?? 0).toBeGreaterThan(0.5)
  })
})

describe('onset flux against absolute level', () => {
  const make = () => new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE })

  /** Click the sub band every 30 frames over a floor `db` below it. */
  const hits = (loudDb: number, frames = 360) => {
    const extractor = make()
    const quiet = spectrum(only(20, 60, loudDb - 60))
    const loud = spectrum(only(20, 60, loudDb))
    let count = 0
    for (let frame = 0; frame < frames; frame++) {
      const packet = extractor.update(frame > 0 && frame % 30 === 0 ? loud : quiet, DT)
      if ((packet[F.subHit] ?? 0) > 0) count++
    }
    return count
  }

  // The point of measuring the rise in log magnitude: the same musical hit is
  // the same hit whether the passage around it is loud or quiet. On raw
  // magnitude the rise scaled with the absolute level, so a detector's
  // sensitivity drifted with the mix.
  it('finds the same hits twenty dB apart', () => {
    expect(hits(-20)).toBe(hits(-40))
    expect(hits(-20)).toBeGreaterThan(5)
  })
})

describe('the song rather than the frame', () => {
  const make = () => new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE })

  /** Click the whole spectrum every `every` frames, for `seconds`. */
  function clicks(every: number, seconds: number, extractor = make()) {
    const quiet = spectrum(flat(-100))
    const loud = spectrum(flat(-20))
    let packet: Float32Array = extractor.packet
    const frames = Math.round(seconds / DT)
    for (let frame = 0; frame < frames; frame++)
      packet = extractor.update(frame > 0 && frame % every === 0 ? loud : quiet, DT)
    return packet
  }

  // Hits a second in any band, scaled so 12 is full. A click every 10
  // frames at 60 fps is 6 a second, which is busy but not flat out.
  it('settles pace near how busy the music actually is', () => {
    const busy = clicks(10, 60)[F.pace] ?? 0
    const sparse = clicks(60, 60)[F.pace] ?? 0
    expect(busy).toBeGreaterThan(0.4)
    expect(sparse).toBeLessThan(0.15)
    expect(busy).toBeGreaterThan(sparse * 3)
  })

  // Slow on purpose: the point is a number that has made up its mind, not
  // another thing that flickers.
  it('barely moves pace on a single hit', () => {
    const extractor = make()
    const quiet = spectrum(flat(-100))
    for (let frame = 0; frame < 120; frame++) extractor.update(quiet, DT)
    const before = extractor.packet[F.pace] ?? 0
    extractor.update(spectrum(flat(-20)), DT)
    expect((extractor.packet[F.pace] ?? 0) - before).toBeLessThan(0.01)
  })

  /**
   * A hit every half second for `seconds`, fed to the song bare, at `fps`. Each
   * hit trips three detectors at `spread` seconds after it, the way a kick
   * trips the mids first and the sub band about 70 ms behind, and lifts the
   * mix by `bump` times what is under it before it decays away over 100 ms.
   */
  function paceOf(fps: number, seconds: number, bump: number, spread: readonly number[]) {
    const song = new Song()
    const dt = 1 / fps
    const bed = 0.1
    // The first hit lands a second in, so the bed they are measured over has
    // settled by then.
    const FIRST = 1
    const EVERY = 0.5
    let pace = 0
    for (let frame = 0; frame < Math.round(seconds * fps); frame++) {
      const from = frame * dt
      const to = from + dt
      // Is there a hit's onset, `late` seconds after the hit, inside this frame?
      const onset = spread.some((late) => {
        const next = FIRST + late + Math.ceil((from - FIRST - late) / EVERY - 1e-9) * EVERY
        return next >= FIRST + late - 1e-9 && next < to - 1e-9
      })
      const since = from >= FIRST ? (from - FIRST) % EVERY : Infinity
      const loudness = bed * (1 + bump * Math.exp(-since / 0.1))
      pace = song.step({ onset, loudness, brightness: NaN, bpm: 0, spread: 0.01 }, dt).pace
    }

    return pace
  }

  // The count used to be of frames with an onset in them. One struck sound
  // trips several bands, the sub band trailing the rest by about 70 ms, so a
  // kick was one count when those landed in the same frame and two or three
  // when they did not, and a display that draws faster split the same kick
  // over more frames and read busier for it.
  it('counts one struck sound once however its onsets are spread over frames', () => {
    // Two hits a second for twenty seconds, a decayed count over half a minute
    // and 12 a second for full.
    const expected = (2 * (1 - Math.exp(-20 / 30))) / 12
    for (const fps of [30, 60, 120, 144]) {
      const alone = paceOf(fps, 20, 2, [0])
      const spread = paceOf(fps, 20, 2, [0, 0.02, 0.07])
      expect(Math.abs(alone - expected)).toBeLessThan(0.006)
      expect(Math.abs(spread - alone)).toBeLessThan(0.006)
    }
  })

  // A quiet hat over a pad is a hat nobody hears. The detectors fire on it all
  // the same, each band being measured against its own history, so what it is
  // worth has to come from how far it stands above what is under it.
  it('counts a hit for how far it stands above what is under it', () => {
    const clear = paceOf(60, 20, 2, [0])
    const buried = paceOf(60, 20, 0.03, [0])
    expect(clear).toBeGreaterThan(0.07)
    expect(buried).toBeLessThan(0.01)
  })

  it('holds swell at the middle while the music holds steady', () => {
    const extractor = make()
    const steady = spectrum(flat(-30))
    let packet: Float32Array = extractor.packet
    for (let frame = 0; frame < 3600; frame++) packet = extractor.update(steady, DT)
    expect(packet[F.swell] ?? 0).toBeCloseTo(0.5, 1)
  })

  it('lifts swell when a passage rises over its own average and drops it back', () => {
    const extractor = make()
    const steady = spectrum(flat(-40))
    for (let frame = 0; frame < 1800; frame++) extractor.update(steady, DT)
    const before = extractor.packet[F.swell] ?? 0
    // Ten seconds of a much louder passage: short follows, long lags.
    let packet: Float32Array = extractor.packet
    for (let frame = 0; frame < 600; frame++) packet = extractor.update(spectrum(flat(-20)), DT)
    expect(packet[F.swell] ?? 0).toBeGreaterThan(before)
    // And back down when it drops out.
    for (let frame = 0; frame < 300; frame++) packet = extractor.update(spectrum(flat(-60)), DT)
    expect(packet[F.swell] ?? 0).toBeLessThan(before)
  })

  // Swell is measured in dB, so a passage six dB up reads as far above the
  // middle as one six dB down reads below it. As a ratio, half the loudness
  // was already the floor and one and a half times the ceiling, and a preset
  // could thin a knob in a breakdown far more easily than lift it in a drop.
  it('reads a rise and a fall of the same size as the same distance from steady', () => {
    const swellAfter = (db: number) => {
      const extractor = make()
      for (let frame = 0; frame < 2400; frame++) extractor.update(spectrum(flat(-30)), DT)
      // Three seconds: the short arm has followed, the long arm has barely moved.
      let packet: Float32Array = extractor.packet
      for (let frame = 0; frame < 180; frame++) packet = extractor.update(spectrum(flat(db)), DT)
      return packet[F.swell] ?? 0
    }

    const up = swellAfter(-24) - 0.5
    const down = 0.5 - swellAfter(-36)
    expect(up).toBeGreaterThan(0.25)
    expect(Math.abs(up - down)).toBeLessThan(0.08)
  })

  it('reads weight high on a bass-led track and low on a bright one', () => {
    const extractor = make()
    let packet: Float32Array = extractor.packet
    for (let frame = 0; frame < 1800; frame++)
      packet = extractor.update(spectrum(only(60, 250, -20)), DT)
    expect(packet[F.weight] ?? 0).toBeGreaterThan(0.9)

    const bright = make()
    for (let frame = 0; frame < 1800; frame++)
      packet = bright.update(spectrum(only(4000, 16000, -20)), DT)
    expect(packet[F.weight] ?? 1).toBeLessThan(0.1)
  })

  // Weight is the spectral centroid, so what it reads is the balance of the
  // spectrum rather than which bands have anything in them. The old measure
  // read the normalised levels, and two bands that both had content both
  // normalised toward 1, so anything with a kick and a hat sat at 0.5.
  it('reads weight from the balance rather than from occupancy', () => {
    // Equal power per octave across the spectrum, then the same with the low
    // end ten dB louder: both occupy every band, and only the second is
    // bass-led. The old measure read both as 0.5.
    const pink = (hz: number) => -20 - 10 * Math.log10(Math.max(hz, 20) / 20)
    const weightOf = (level: (hz: number) => number) => {
      const extractor = make()
      let packet: Float32Array = extractor.packet
      for (let frame = 0; frame < 600; frame++) packet = extractor.update(spectrum(level), DT)
      return packet[F.weight] ?? 0
    }

    const balanced = weightOf(pink)
    const heavy = weightOf((hz) => pink(hz) + (hz < 250 ? 10 : 0))
    expect(heavy).toBeGreaterThan(balanced + 0.15)
    // Equal power per octave reads a little bass-led, since the low group is
    // fewer octaves wide than the high one; white noise, which puts most of
    // its power above 4 kHz, reads bright.
    expect(balanced).toBeGreaterThan(0.5)
    expect(balanced).toBeLessThan(0.75)
    expect(weightOf(flat(-30))).toBeLessThan(0.25)
  })

  // The BPM guess steps when the autocorrelation changes its mind, and the
  // README measures how often it is wrong. The ramp is the whole reason the
  // normalised one is worth mapping: the scene drifts rather than lurching.
  it('ramps tempo instead of stepping with the guess', () => {
    const extractor = make()
    let last = 0
    let biggest = 0
    const quiet = spectrum(flat(-100))
    const loud = spectrum(flat(-20))
    for (let frame = 0; frame < 3600; frame++) {
      // 120 BPM for the first half, then twice as busy.
      const every = frame < 1800 ? 30 : 15
      const packet = extractor.update(frame > 0 && frame % every === 0 ? loud : quiet, DT)
      const now = packet[F.tempo] ?? 0
      biggest = Math.max(biggest, Math.abs(now - last))
      last = now
    }
    expect(biggest).toBeLessThan(0.02)
  })
})

describe('onsets at any frame rate', () => {
  const make = (fluxFloor?: number) =>
    new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE, fluxFloor })

  /**
   * Two clicks a second, each 40 ms long, played to an extractor stepped at
   * `fps`. The click is a span of time rather than one frame, the way a real
   * hit is, so a faster frame rate sees more frames of it and not more hits,
   * and it is longer than a frame at the slowest rate so none is skipped.
   */
  function clicksAt(fps: number, seconds: number, floor?: number) {
    const extractor = make(floor)
    const quiet = spectrum(flat(-40))
    const loud = spectrum(flat(-10))
    const dt = 1 / fps
    const hits: number[] = []
    for (let t = 0; t < seconds; t += dt) {
      const inClick = (t + 1e-9) % 0.5 < 0.04
      const packet = extractor.update(inClick ? loud : quiet, dt)
      if (packet[F.onset]) hits.push(Math.round(t * 1000))
    }
    return hits
  }

  // The reason the flux is measured over a fixed lag and the windows over a
  // fixed time: at 144 frames a second two analyser reads a frame apart are
  // nearly the same window, and a detector fed per-frame rises fired on the
  // jitter between them, about twice a second on a sustained pad.
  it('finds the same clicks at 30, 60 and 144 frames a second', () => {
    const at30 = clicksAt(30, 5.9)
    const at60 = clicksAt(60, 5.9)
    const at144 = clicksAt(144, 5.9)
    expect(at60.length).toBeGreaterThan(8)
    expect(at30.length).toBe(at60.length)
    expect(at144.length).toBe(at60.length)
    // And at the same moments, to within a frame of the slowest rate.
    at60.forEach((ms, index) => {
      expect(Math.abs((at144[index] ?? 0) - ms)).toBeLessThan(40)
    })
  })

  // The failure the floor exists for: once the music has stopped for longer
  // than the window, the threshold is mean plus a few deviations of nothing,
  // and without a floor the jitter of a quiet pad clears it.
  it('stays quiet on a jittering pad after the hits stop', () => {
    const extractor = make()
    const next = random(11)
    const loud = spectrum(flat(-10))
    let after = 0
    for (let frame = 0; frame < 900; frame++) {
      const pad = spectrum(() => -40 + (next() - 0.5) * 3)
      const packet = extractor.update(frame < 180 && frame % 30 === 0 ? loud : pad, DT)
      if (frame >= 300 && packet[F.onset]) after++
      if (frame >= 300)
        for (let band = 0; band < BAND_COUNT; band++) after += packet[BAND_HIT + band] ? 1 : 0
    }
    expect(after).toBe(0)
  })

  it('lets the floor be turned off', () => {
    const extractor = make(0)
    const next = random(11)
    let onsets = 0
    for (let frame = 0; frame < 600; frame++) {
      const packet = extractor.update(
        spectrum(() => -40 + (next() - 0.5) * 4),
        DT,
      )
      onsets += packet[F.onset] ?? 0
    }
    expect(onsets).toBeGreaterThan(0)
  })
})

describe('harmony', () => {
  const make = () => new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE })
  const halfBin = SAMPLE_RATE / FFT_SIZE / 2

  /** Tones at these frequencies, each landing on its nearest bin, over a quiet floor. */
  const tones =
    (...hz: number[]) =>
    (at: number) =>
      hz.some((tone) => Math.abs(at - tone) <= halfBin) ? -20 : -100

  const octaves = (...hz: number[]) => hz.flatMap((tone) => [tone, tone * 2, tone * 4])
  const C_MAJOR = tones(...octaves(130.81, 164.81, 196))
  const A_MINOR = tones(...octaves(110, 130.81, 164.81))
  const G_MAJOR = tones(...octaves(196, 246.94, 293.66))
  const F_SHARP_MAJOR = tones(...octaves(185, 233.08, 277.18))

  const hold = (extractor: FeatureExtractor, level: (hz: number) => number, seconds: number) => {
    let packet: Float32Array = extractor.packet
    for (let t = 0; t < seconds; t += DT) packet = extractor.update(spectrum(level), DT)
    return packet
  }

  it('names pitch classes and places keys on the circle of fifths', () => {
    expect(pitchClass(440)).toBe(9)
    expect(pitchClass(261.63)).toBe(0)
    expect(pitchClass(392)).toBe(7)
    expect(keyHueOf(0, true)).toBe(0)
    expect(keyHueOf(7, true)).toBeCloseTo(1 / 12)
    expect(keyHueOf(5, true)).toBeCloseTo(11 / 12)
    // A minor is the same notes as C major, so the same place.
    expect(keyHueOf(9, false)).toBe(keyHueOf(0, true))
    expect(keyLabel(0)).toBe('C / Am')
    expect(keyLabel(1 / 12)).toBe('G / Em')
    expect(keyLabel(3 / 12)).toBe('A / F#m')
  })

  it('finds the key of a held chord and is sure of it', () => {
    const packet = hold(make(), C_MAJOR, 8)
    expect(packet[F.keyHue] ?? 1).toBeLessThan(0.02)
    expect(packet[F.keyClarity] ?? 0).toBeGreaterThan(0.5)
    expect(keyOf([6, 0, 0, 0, 4, 0, 0, 5, 0, 0, 0, 0]).major).toBe(true)
    expect(keyOf([6, 0, 0, 0, 4, 0, 0, 5, 0, 0, 0, 0]).tonic).toBe(0)
  })

  // The reason the hue is by key signature and not by tonic: the profiles
  // flip between a key and its relative on real music every few bars, and a
  // colour that flipped with them would say nothing.
  it('gives a relative minor the same hue as its major', () => {
    const major = hold(make(), C_MAJOR, 8)[F.keyHue] ?? 0
    const minor = hold(make(), A_MINOR, 8)[F.keyHue] ?? 0
    expect(Math.abs(major - minor)).toBeLessThan(0.02)
    const dominant = hold(make(), G_MAJOR, 8)[F.keyHue] ?? 0
    expect(dominant).toBeCloseTo(1 / 12, 1)
  })

  it('lifts harmonicChange when the chord moves and lets it settle', () => {
    const extractor = make()
    const before = hold(extractor, C_MAJOR, 6)[F.harmonicChange] ?? 1
    expect(before).toBeLessThan(0.1)
    const moved = hold(extractor, F_SHARP_MAJOR, 0.6)[F.harmonicChange] ?? 0
    expect(moved).toBeGreaterThan(0.5)
    const settled = hold(extractor, F_SHARP_MAJOR, 8)[F.harmonicChange] ?? 1
    expect(settled).toBeLessThan(0.15)
  })

  it('loses clarity when the notes stop but keeps the hue', () => {
    const extractor = make()
    const sounding = hold(extractor, G_MAJOR, 8)
    const hue = sounding[F.keyHue] ?? 0
    expect(sounding[F.keyClarity] ?? 0).toBeGreaterThan(0.5)
    const silent = hold(extractor, silence, 8)
    expect(silent[F.keyClarity] ?? 1).toBeLessThan(0.1)
    expect(silent[F.keyHue]).toBeCloseTo(hue, 2)
  })

  it('hears little clarity in noise', () => {
    const next = random(3)
    const extractor = make()
    let packet: Float32Array = extractor.packet
    for (let t = 0; t < 8; t += DT)
      packet = extractor.update(
        spectrum(() => -30 + (next() - 0.5) * 30),
        DT,
      )
    expect(packet[F.keyClarity] ?? 1).toBeLessThan(0.4)
  })
})

describe('structure', () => {
  const make = () => new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE })

  /**
   * Two passages that sound nothing alike: a bass-led one clicking the sub
   * band twice a second, and a bright one holding a chord with hats. Each
   * runs for `seconds`, and the packet is sampled every quarter second.
   */
  const passages = {
    low: (frame: number) =>
      spectrum(frame % 30 === 0 ? only(20, 250, -15) : (hz) => (hz < 250 ? -30 : -100)),
    high: (frame: number) =>
      spectrum(
        frame % 10 === 0
          ? (hz) => (hz > 4000 ? -20 : hz > 1000 && hz < 3000 ? -30 : -100)
          : (hz) => (hz > 1000 && hz < 3000 ? -30 : -100),
      ),
  }

  function play(extractor: FeatureExtractor, script: [keyof typeof passages, number][]) {
    const samples: { t: number; section: number; recall: number; novelty: number }[] = []
    let t = 0
    let frame = 0
    for (const [name, seconds] of script) {
      const passage = passages[name]
      for (let s = 0; s < seconds; s += DT) {
        const packet = extractor.update(passage(frame), DT)
        frame++
        t += DT
        if (frame % 15 === 0)
          samples.push({
            t,
            section: packet[F.section] ?? 0,
            recall: packet[F.recall] ?? 0,
            novelty: packet[F.novelty] ?? 0,
          })
      }
    }
    return samples
  }

  const between = (samples: ReturnType<typeof play>, from: number, to: number) =>
    samples.filter((s) => s.t >= from && s.t < to)

  it('numbers a new passage and gives a returning one its old number', () => {
    const samples = play(make(), [
      ['low', 30],
      ['high', 30],
      ['low', 30],
    ])
    const first = between(samples, 10, 30).map((s) => s.section)
    const second = between(samples, 45, 60).map((s) => s.section)
    const third = between(samples, 75, 90).map((s) => s.section)
    expect(new Set(first)).toEqual(new Set([1]))
    expect(new Set(second)).toEqual(new Set([2]))
    expect(new Set(third)).toEqual(new Set([1]))
  })

  it('recalls a passage only once it has come back', () => {
    const samples = play(make(), [
      ['low', 30],
      ['high', 30],
      ['low', 30],
    ])
    const firstTime = Math.max(...between(samples, 20, 30).map((s) => s.recall))
    const comeBack = Math.max(...between(samples, 75, 90).map((s) => s.recall))
    expect(firstTime).toBeLessThan(0.3)
    expect(comeBack).toBeGreaterThan(0.7)
  })

  it('lifts novelty at a boundary and not within a passage', () => {
    const samples = play(make(), [
      ['low', 30],
      ['high', 30],
    ])
    const within = Math.max(...between(samples, 20, 30).map((s) => s.novelty))
    const across = Math.max(...between(samples, 30, 40).map((s) => s.novelty))
    expect(within).toBeLessThan(0.3)
    expect(across).toBeGreaterThan(0.6)
  })

  it('keeps one section through a steady passage and through silence', () => {
    const steady = play(make(), [['high', 60]])
    expect(new Set(steady.map((s) => s.section))).toEqual(new Set([1]))
    const extractor = make()
    let packet: Float32Array = extractor.packet
    for (let s = 0; s < 40; s += DT) packet = extractor.update(spectrum(silence), DT)
    expect(packet[F.section]).toBe(1)
    expect(packet[F.recall]).toBe(0)
    expect(packet[F.novelty]).toBe(0)
  })
})

describe('where a hit landed', () => {
  const make = () => new FeatureExtractor({ sampleRate: SAMPLE_RATE, fftSize: FFT_SIZE })

  /** Quiet for a second, then one frame with `low` to `high` Hz at -15 dB. */
  function strike(low: number, high: number) {
    const extractor = make()
    const quiet = spectrum(flat(-60))
    for (let frame = 0; frame < 60; frame++) extractor.update(quiet, DT)
    return extractor.update(
      spectrum((hz) => (hz >= low && hz < high ? -15 : -60)),
      DT,
    )
  }

  it('puts a low hit low and a high hit high, on the frame it fires', () => {
    const kick = strike(20, 100)
    expect(kick[F.subHit] ?? 0).toBeGreaterThan(0)
    expect(kick[F.subHitCentre] ?? 1).toBeLessThan(0.3)
    const hat = strike(6000, 14000)
    expect(hat[F.trebleHit] ?? 0).toBeGreaterThan(0)
    expect(hat[F.trebleHitCentre] ?? 0).toBeGreaterThan(0.8)
  })

  it('reads a wide hit as wider than a narrow one', () => {
    const wide = strike(1000, 16000)
    const narrow = strike(5000, 6000)
    expect(wide[F.trebleHitWidth] ?? 0).toBeGreaterThan((narrow[F.trebleHitWidth] ?? 0) * 2)
  })

  it('rests at the band middle before any rise', () => {
    const packet = make().update(spectrum(silence), DT)
    expect(packet[F.subHitCentre] ?? 0).toBeGreaterThan(0)
    expect(packet[F.subHitCentre] ?? 1).toBeLessThan(packet[F.trebleHitCentre] ?? 0)
    expect(packet[F.subHitWidth]).toBe(0)
  })
})
