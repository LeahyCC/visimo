/**
 * Turns analyser frames into a small packet of musical features for the
 * visualizer. Pure TypeScript, no DOM: the input is the Float32Array that
 * `AnalyserNode.getFloatFrequencyData` fills (dB per bin, -Infinity for
 * silence) plus the seconds since the previous frame, and the output is a
 * fixed-layout Float32Array the renderer uploads as one uniform buffer.
 *
 * Packet layout. Read by name through `F`, never by a literal index.
 *
 *   index  name            range     meaning
 *   0      sub             0..1      20 to 60 Hz envelope, scaled by its recent peak
 *   1      bass            0..1      60 to 250 Hz
 *   2      lowMid          0..1      250 to 1000 Hz
 *   3      highMid         0..1      1000 to 4000 Hz
 *   4      treble          0..1      4000 to 16000 Hz
 *   5-9    subHit..trebleHit
 *                          0..1      the frame that band's own onset fired, carrying
 *                                    its strength; 0 on every other frame
 *   10-14  subPulse..treblePulse
 *                          0..1      jumps to 1 on that band's onset, then decays
 *   15     energy          0..1      smoothed RMS across 20 Hz to 16 kHz, scaled by its recent peak
 *   16     flux            0..       spectral flux over its rolling mean; about 1 in a steady passage
 *   17     fluxThreshold   0..       the adaptive onset threshold in the same units as flux
 *   18     onset           0 | 1     1 on the frame an onset was detected anywhere
 *   19     onsetStrength   0..1      how that onset compares with the loudest recent one
 *   20     beatPulse       0..1      jumps to 1 on an onset, then decays
 *   21     tempoBpm        bpm       0 until the flux autocorrelation settles on a period
 *   22     time            s         seconds of features so far
 *   23     dt              s         this frame's step
 *   24     pace            0..1      onsets a second, decayed over half a minute
 *   25     swell           0..1      energy now against energy over half a minute; 0.5 is steady
 *   26     weight          0..1      low against high over ten seconds; 1 is bass-led
 *   27     tempo           0..1      `tempoBpm` across 60 to 200, smoothed so it ramps
 *
 * Each band detects its own onsets, against its own flux and its own adaptive
 * threshold, which is what lets one emitter answer the kick and another the
 * hats. The three global rows are the same detector run over the whole
 * spectrum, kept because the post stack, the preset vocabulary and the debug
 * overlay all read them.
 *
 * The last four rows are the song rather than the frame. Everything above them
 * answers "what is happening now"; those answer "what kind of track is this"
 * and "where in it are we". They are levels like any other, so a preset reads
 * them through the same mapping table.
 *
 * Nothing on the GPU binds this. Every consumer reads the Float32Array on the
 * CPU, so the layout is free of any vec4 alignment.
 */

export const PACKET_LENGTH = 28

/** The five bands, in order. Band `i` is packet slot `i`. */
export const BAND_NAMES = ['sub', 'bass', 'lowMid', 'highMid', 'treble'] as const
export type BandName = (typeof BAND_NAMES)[number]
export const BAND_COUNT = BAND_NAMES.length

/** Where a band's own onset lands, and where its decaying pulse does. */
export const BAND_HIT = BAND_COUNT
export const BAND_PULSE = BAND_COUNT * 2

export const F = {
  sub: 0,
  bass: 1,
  lowMid: 2,
  highMid: 3,
  treble: 4,
  subHit: 5,
  bassHit: 6,
  lowMidHit: 7,
  highMidHit: 8,
  trebleHit: 9,
  subPulse: 10,
  bassPulse: 11,
  lowMidPulse: 12,
  highMidPulse: 13,
  treblePulse: 14,
  energy: 15,
  flux: 16,
  fluxThreshold: 17,
  onset: 18,
  onsetStrength: 19,
  beatPulse: 20,
  tempoBpm: 21,
  time: 22,
  dt: 23,
  pace: 24,
  swell: 25,
  weight: 26,
  tempo: 27,
} as const

export type BandSpec = {
  name: string
  /** Hz, inclusive. */
  low: number
  /** Hz, exclusive. */
  high: number
  attackMs: number
  releaseMs: number
}

// Treble moves fastest, sub slowest: a hi-hat is over in milliseconds and a
// bass note should not flicker.
export const DEFAULT_BANDS: readonly BandSpec[] = [
  { name: 'sub', low: 20, high: 60, attackMs: 20, releaseMs: 250 },
  { name: 'bass', low: 60, high: 250, attackMs: 12, releaseMs: 180 },
  { name: 'lowMid', low: 250, high: 1000, attackMs: 10, releaseMs: 150 },
  { name: 'highMid', low: 1000, high: 4000, attackMs: 8, releaseMs: 120 },
  { name: 'treble', low: 4000, high: 16000, attackMs: 5, releaseMs: 90 },
]

export type FeatureOptions = {
  sampleRate: number
  /** Must equal the analyser's fftSize; the frame has fftSize / 2 bins. */
  fftSize: number
  bands?: readonly BandSpec[]
  /** Rolling window for the flux mean and deviation, in seconds. */
  fluxWindowSeconds?: number
  /** k in mean + k * sigma. */
  fluxThresholdSigma?: number
  /**
   * How far above its running mean the flux has to rise before a crossing of
   * the threshold counts, in the units the flux is measured in. This is what
   * keeps a sustained pad from firing: the deviation of a nearly flat signal
   * is nearly nothing, so mean plus a few of it is a bar anything clears.
   */
  fluxFloor?: number
  /** Two onsets closer than this are one. */
  onsetRefractoryMs?: number
  /** beatPulse falls to 1/e in this long. */
  beatDecaySeconds?: number
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

/** -Infinity (a silent bin) becomes 0, 0 dB becomes 1. */
export const dbToLinear = (db: number) => (db === -Infinity ? 0 : 10 ** (db / 20))

/**
 * How much of each bin belongs to a band. A bin is centred on its own
 * frequency and covers half a bin either side, so the two bins that straddle
 * an edge are split between the neighbouring bands rather than rounded wholly
 * into one. That is what makes a band cover the Hz it asks for at any FFT
 * size: rounding to whole bins put the 20 to 60 Hz sub band at 23 to 70 Hz,
 * which is a tenth of the bass band inside the sub one.
 *
 * It does not fix the analyser's own window, whose main lobe is about three
 * bins wide, so a pure tone still spreads into its neighbours.
 */
export type BandFilter = {
  /** First bin the band touches. */
  start: number
  /** One past the last bin it touches. */
  end: number
  /** How much of bin `start + i` is inside, 0 to 1. */
  weights: Float32Array
  /** The weights summed: the band's width in bins, fractions included. */
  total: number
}

export function bandFilter(
  low: number,
  high: number,
  fftSize: number,
  sampleRate: number,
): BandFilter {
  const bins = fftSize / 2
  const width = sampleRate / fftSize
  const from = low / width
  const to = high / width
  const start = Math.max(0, Math.floor(from - 0.5))
  const end = Math.min(bins, Math.max(start + 1, Math.ceil(to + 0.5)))
  const weights = new Float32Array(end - start)
  let total = 0
  for (let index = 0; index < weights.length; index++) {
    const bin = start + index
    const overlap = Math.min(bin + 0.5, to) - Math.max(bin - 0.5, from)
    const weight = Math.min(1, Math.max(0, overlap))
    weights[index] = weight
    total += weight
  }

  // A band pushed past Nyquist would otherwise divide by nothing.
  return { start, end, weights, total: Math.max(total, 1e-6) }
}

/** One-pole envelope follower with separate attack and release times. */
export class Envelope {
  value = 0
  private readonly attack: number
  private readonly release: number

  constructor(attackMs: number, releaseMs: number) {
    this.attack = attackMs / 1000
    this.release = releaseMs / 1000
  }

  step(input: number, dt: number) {
    const tau = input > this.value ? this.attack : this.release
    const keep = tau <= 0 ? 0 : Math.exp(-dt / tau)
    this.value = input + (this.value - input) * keep
    return this.value
  }
}

/**
 * A level that follows its input upwards at once and lets go slowly, for
 * scaling a band by the loudest it has recently been. The floor keeps
 * near-silence from being scaled up into noise.
 */
class PeakHold {
  value = 0
  constructor(
    private readonly halfLifeSeconds: number,
    private readonly floor: number,
  ) {}

  step(input: number, dt: number) {
    this.value = Math.max(input, this.value * 0.5 ** (dt / this.halfLifeSeconds))
    return Math.max(this.value, this.floor)
  }
}

// Linear magnitude of roughly -60 dB. Below this a band reads as quiet rather
// than being stretched to fill 0..1.
const QUIET = 1e-3
const PEAK_HALF_LIFE = 2
// The warm-up before a detector will call anything: too few samples and the
// deviation is noise.
const MIN_FLUX_SAMPLES = 8
// The most frames a rolling window keeps. 1.5 s at 240 frames a second is
// 360; beyond the capacity the oldest goes whatever its age.
const FLUX_WINDOW_CAPACITY = 512
// Flux is the rise over this much time rather than over one frame. Two
// analyser reads a frame apart overlap by 45% at 60 frames a second and by
// 92% at 144, so a per-frame rise shrank with the frame rate and the
// detectors ended up firing on the jitter between reads. Measured over a
// fixed span the same hit is the same number at any frame rate.
const FLUX_LAG_SECONDS = 0.03
// Past log spectra kept to find one that old: 16 covers the lag at 240 fps
// and then some.
const FLUX_HISTORY = 16
// The rise above its running mean a flux has to make, in mean log rise per
// bin, before a threshold crossing counts. Measured on a real track: a
// sustained pad jitters by up to 0.19 in every band, a kick in the sub band
// rises by one to three, a hat spread across the treble band by 0.3 to 0.6.
const FLUX_FLOOR = 0.2
// A band a couple of bins wide averages nothing out, so its jitter runs
// higher than a wide band's; its floor is raised in proportion. Below four
// bins the correction is sqrt(4 / bins), above it nothing.
const FLUX_FLOOR_NARROW_BINS = 4
// Flux is measured on log magnitude so that the same hit reads the same in a
// loud passage as in a quiet one. The gain has to be this large because the
// magnitudes are small: a bin at -40 dB is 0.01, and log1p of that is 0.00995,
// which is no compression at all.
const FLUX_COMPRESSION = 1000
// How long the song-scale features take to make up their minds. Pace and the
// long arm of swell settle over half a minute, which is about a verse; weight
// over ten seconds; the tempo ramp over five, which is only there to stop the
// guess stepping.
const PACE_SECONDS = 30
// Onsets a second, in any band, that counts as fully busy. A pad with a pulse
// runs about 2, a full kit with hats about 6 and drum and bass past 12, so
// this puts most tracks across the useful middle.
const PACE_FULL = 12
const SWELL_SHORT_MS = 2000
const SWELL_LONG_MS = 30000
const WEIGHT_MS = 10000
const TEMPO_RAMP_MS = 5000
const MIN_DT = 0.001
const MAX_DT = 0.1
const TEMPO_MIN_BPM = 60
const TEMPO_MAX_BPM = 200
// The flux is resampled to this rate for the autocorrelation, so the window
// and the lags are in seconds whatever the frame rate. Replaying recorded
// tracks through longer windows made the beat lose out to the bar more often,
// not less.
const TEMPO_RATE = 100
const TEMPO_WINDOW_SECONDS = 5
const TEMPO_EVERY_SECONDS = 1
const TEMPO_PREFERRED_BPM = 120
// Width of the preference, in octaves: 60 and 240 score about half of 120.
const TEMPO_PREFERENCE_OCTAVES = 0.9
// Below this normalised correlation nothing is periodic enough to call.
const TEMPO_MIN_CORRELATION = 0.05
const TEMPO_HALF_LAG_RATIO = 0.6
const TEMPO_COMPRESSION = 3
// One reading a second can still jump for a bar; the median of the last few
// holds the tempo steady through it.
const TEMPO_MEDIAN_OF = 5

/** What one run of the detector found this frame. */
export type Onset = {
  /** Flux in units of its own rolling mean; about 1 in a steady passage. */
  flux: number
  /** The adaptive threshold, in those same units. */
  threshold: number
  onset: boolean
  /** How the hit compares with the loudest recent one, 0 on a frame with none. */
  strength: number
  /** 1 on the hit, decaying after it. */
  pulse: number
}

/**
 * Flux in, onsets out. One of these runs over the whole spectrum and one runs
 * over each band, which is the only reason a kick and a hat can be told apart:
 * every copy keeps its own rolling window, so a busy band cannot raise the bar
 * a quiet one has to clear.
 *
 * All the state that used to sit loose on the extractor lives here, and the
 * behaviour is the same to the float; what changed is that there is now more
 * than one of it.
 */
export class OnsetDetector {
  private readonly window = new Float32Array(FLUX_WINDOW_CAPACITY)
  private readonly steps = new Float32Array(FLUX_WINDOW_CAPACITY)
  /** Where the next sample goes; once the ring is full, also the oldest. */
  private at = 0
  private count = 0
  /** Seconds the samples in the ring cover. */
  private span = 0
  private sum = 0
  private sumSquares = 0
  private peak = 0
  private last = 0
  private since = Infinity
  private beat = 0

  constructor(
    private readonly windowSeconds: number,
    private readonly sigma: number,
    private readonly refractory: number,
    private readonly beatDecay: number,
    private readonly floor: number,
  ) {}

  /**
   * `flux` is the raw half-wave rectified rise, already divided by how many
   * bins it was summed over so that a wide band and a narrow one are on the
   * same scale.
   */
  step(flux: number, dt: number): Onset {
    // The threshold is measured against the window before this frame joins
    // it, so a hit cannot raise the bar it has to clear.
    const count = this.count
    const mean = count ? this.sum / count : 0
    const variance = count ? Math.max(0, this.sumSquares / count - mean * mean) : 0
    const threshold = mean + this.sigma * Math.sqrt(variance)
    this.push(flux, dt)
    this.peak = Math.max(flux, this.peak * 0.5 ** (dt / PEAK_HALF_LIFE))
    this.since += dt
    // Rising through the threshold is the onset, provided the rise clears the
    // floor as well: the threshold is relative to the window and the floor is
    // not, and it is the floor that keeps a nearly flat signal quiet. Waiting
    // for the peak would cost a frame; the refractory time stops a long swell
    // from counting twice.
    const onset =
      count >= MIN_FLUX_SAMPLES &&
      flux > threshold &&
      flux - mean >= this.floor &&
      flux > QUIET * QUIET &&
      flux >= this.last &&
      this.since >= this.refractory
    this.last = flux
    // A hit is graded against the loudest recent hit, never against the
    // baseline alone: the mean of flux over its own mean is 1 by construction,
    // which would hide every hit in sustained music.
    const range = Math.max(this.peak - mean, 2 * mean)
    const strength = range > 0 ? clamp01((flux - mean) / range) : 0
    if (onset) {
      this.since = 0
      this.beat = 1
    } else this.beat *= Math.exp(-dt / this.beatDecay)

    const unit = mean > 0 ? 1 / mean : 0
    return {
      flux: flux * unit,
      threshold: threshold * unit,
      onset,
      strength: onset ? strength : 0,
      pulse: this.beat,
    }
  }

  /**
   * The rolling window, as a ring of samples and the step each arrived with.
   * The window is a span of time, not a count of frames: samples are dropped
   * from the old end once the ring covers more than `windowSeconds`, so the
   * threshold looks back the same distance at any frame rate. The sums are
   * kept incrementally rather than recomputed.
   */
  private push(flux: number, dt: number) {
    const { window, steps } = this
    if (this.count === window.length) this.evict()
    window[this.at] = flux
    steps[this.at] = dt
    this.at = (this.at + 1) % window.length
    this.count++
    this.span += dt
    this.sum += flux
    this.sumSquares += flux * flux
    while (this.count > 1 && this.span - this.oldestStep() >= this.windowSeconds) this.evict()
  }

  private oldestStep() {
    const oldest = (this.at - this.count + this.window.length) % this.window.length
    return this.steps[oldest] ?? 0
  }

  private evict() {
    const oldest = (this.at - this.count + this.window.length) % this.window.length
    const old = this.window[oldest] ?? 0
    this.sum -= old
    this.sumSquares -= old * old
    this.span -= this.steps[oldest] ?? 0
    this.count--
  }
}

/** What kind of track this is, and where in it we are. */
export type Character = {
  /** Onsets a second, decayed over half a minute and scaled. */
  pace: number
  /** Energy now against energy over half a minute. 0.5 is steady. */
  swell: number
  /** Low against high. 1 is a bass-led track, 0 a bright sparse one. */
  weight: number
  /** The BPM guess across 60 to 200, smoothed so it ramps rather than steps. */
  tempo: number
}

/**
 * The song rather than the frame. Everything else in this file answers what
 * the music is doing in the last few milliseconds; this answers what kind of
 * track it is and whether this passage is lifting or dropping, so a scene can
 * be calm through a ballad and busy through drum and bass without a preset
 * being swapped.
 *
 * All four are slow on purpose. The point is a number that has made up its
 * mind, not another thing that flickers, so nothing here is allowed to move
 * quickly even when the music does.
 *
 * It reads what `update()` has already worked out, so it costs no pass over
 * the bins.
 */
export class Song {
  /** Onsets, each decaying away over `PACE_SECONDS`. */
  private paceCount = 0
  private readonly short = new Envelope(SWELL_SHORT_MS, SWELL_SHORT_MS)
  private readonly long = new Envelope(SWELL_LONG_MS, SWELL_LONG_MS)
  private readonly low = new Envelope(WEIGHT_MS, WEIGHT_MS)
  private readonly high = new Envelope(WEIGHT_MS, WEIGHT_MS)
  private readonly ramp = new Envelope(TEMPO_RAMP_MS, TEMPO_RAMP_MS)
  private elapsed = 0

  /**
   * `loudness` is the raw RMS, deliberately not the packet's `energy`: that
   * one is divided by its own recent peak, so it reads about 1 through any
   * steady passage however loud, and a feature built on it could never see a
   * chorus coming. `bands` are the normalised levels, where what is wanted is
   * which parts of the spectrum are occupied rather than by how much.
   */
  step(onset: boolean, loudness: number, bands: Float32Array, bpm: number, dt: number): Character {
    this.elapsed += dt
    // A decayed count rather than a rate measured between hits: it needs no
    // memory of when the last one was and it cannot spike on one close pair.
    this.paceCount = this.paceCount * Math.exp(-dt / PACE_SECONDS) + (onset ? 1 : 0)

    const short = this.short.step(loudness, dt)
    this.long.step(loudness, dt)
    // Until the long arm has seen a full window there is no average to be
    // above or below, so it is held at the short one and swell reads steady.
    // Without this every track's first half minute is a permanent drop, since
    // a cold envelope climbs from zero while the short one is already there.
    if (this.elapsed < SWELL_LONG_MS / 1000) this.long.value = short
    const long = this.long.value
    // Centred on 0.5 so one row can lift a knob in a drop and another thin it
    // in a breakdown, from this one feature with opposite gains.
    const swell = long > 1e-9 ? clamp01(short / long - 0.5) : 0.5

    const low = this.low.step(Math.max(bands[F.sub] ?? 0, bands[F.bass] ?? 0), dt)
    const high = this.high.step(Math.max(bands[F.highMid] ?? 0, bands[F.treble] ?? 0), dt)
    const spread = low + high

    // A bpm of 0 means the autocorrelation has not settled; hold the ramp
    // where it is rather than dragging the scene down to nothing.
    const target = bpm > 0 ? clamp01((bpm - TEMPO_MIN_BPM) / (TEMPO_MAX_BPM - TEMPO_MIN_BPM)) : null
    const tempo = target === null ? this.ramp.value : this.ramp.step(target, dt)

    return {
      pace: clamp01(this.paceCount / PACE_SECONDS / PACE_FULL),
      swell,
      weight: spread > 1e-4 ? low / spread : 0.5,
      tempo,
    }
  }
}

export class FeatureExtractor {
  readonly packet = new Float32Array(PACKET_LENGTH)
  readonly bands: readonly BandSpec[]
  private readonly bins: number
  private readonly filters: BandFilter[]
  private readonly span: BandFilter
  private readonly magnitudes: Float32Array
  /** Log magnitudes of this frame; flux is the rise over the ones kept below. */
  private readonly logs: Float32Array
  /**
   * The last few frames of log magnitudes and when each was taken, so the
   * flux can be read over a fixed span of time rather than over one frame.
   */
  private readonly history: Float32Array[]
  private readonly historyAt = new Float64Array(FLUX_HISTORY)
  private historyHead = 0
  private historyCount = 0
  private readonly envelopes: Envelope[]
  private readonly peaks: PeakHold[]
  private readonly energyEnvelope = new Envelope(15, 300)
  private readonly energyPeak = new PeakHold(PEAK_HALF_LIFE, QUIET)
  /** One detector per band, and one over the whole spectrum. */
  private readonly detectors: OnsetDetector[]
  private readonly detector: OnsetDetector
  /** Each band's half-wave rectified rise, refilled in the band loop. */
  private readonly bandFlux: Float32Array
  /** The song-scale features, one step a frame off what the rest works out. */
  private readonly song = new Song()
  private readonly tempoWindow = new Float32Array(TEMPO_RATE * TEMPO_WINDOW_SECONDS)
  private tempoAt = 0
  private tempoFilled = 0
  /** Seconds since the flux was last resampled into the tempo window. */
  private tempoClock = 0
  private sinceTempo = 0
  private tempo = 0
  private readonly tempoReadings = new Float32Array(TEMPO_MEDIAN_OF)
  private tempoReadingAt = 0
  private time = 0

  constructor(options: FeatureOptions) {
    this.bands = options.bands ?? DEFAULT_BANDS
    this.bins = options.fftSize / 2
    this.filters = this.bands.map((band) =>
      bandFilter(band.low, band.high, options.fftSize, options.sampleRate),
    )
    this.span = bandFilter(20, 16000, options.fftSize, options.sampleRate)
    this.magnitudes = new Float32Array(this.bins)
    this.logs = new Float32Array(this.bins)
    this.history = Array.from({ length: FLUX_HISTORY }, () => new Float32Array(this.bins))
    this.envelopes = this.bands.map((band) => new Envelope(band.attackMs, band.releaseMs))
    this.peaks = this.bands.map(() => new PeakHold(PEAK_HALF_LIFE, QUIET))
    const floor = options.fluxFloor ?? FLUX_FLOOR
    const detector = (bins: number) =>
      new OnsetDetector(
        options.fluxWindowSeconds ?? 1.5,
        options.fluxThresholdSigma ?? 2.5,
        (options.onsetRefractoryMs ?? 80) / 1000,
        options.beatDecaySeconds ?? 0.18,
        floor * Math.max(1, Math.sqrt(FLUX_FLOOR_NARROW_BINS / Math.max(bins, 1e-6))),
      )
    // Every band is tuned the same, apart from the narrow ones' floor. What
    // makes them behave differently is that each one only ever sees its own
    // flux, so each settles on its own threshold: a sustained pad in the mids
    // cannot deafen the treble.
    this.detectors = this.filters.map((filter) => detector(filter.total))
    this.detector = detector(this.span.total)
    this.bandFlux = new Float32Array(this.bands.length)
  }

  /**
   * Consume one analyser frame. `spectrum` holds fftSize / 2 dB values and is
   * not kept, so the caller may reuse or transfer it. Returns the packet,
   * which is this instance's own array and is overwritten by the next call.
   */
  update(spectrum: Float32Array, dtSeconds: number): Float32Array {
    const dt = Math.min(MAX_DT, Math.max(MIN_DT, dtSeconds))
    const now = this.time + dt
    const { magnitudes, logs, packet } = this
    for (let bin = 0; bin < this.bins; bin++) {
      const magnitude = dbToLinear(spectrum[bin] ?? -Infinity)
      magnitudes[bin] = magnitude
      logs[bin] = Math.log1p(FLUX_COMPRESSION * magnitude)
    }

    // The frame the flux is measured against: the newest one at least the lag
    // old. Until there is one, the first few frames of a run, there is no
    // flux, which is also what keeps the first frame from reading as a hit.
    const previousLogs = this.reference(now) ?? logs

    // One pass per band does the level and the band's own flux together. The
    // rise is readable here for the cost of a subtract per bin and no second
    // sweep. Both are weighted by how much of each bin the band owns, and
    // divided by those weights, so a wide band and a narrow one are on the
    // same scale and the bins on an edge count only for their share.
    for (let band = 0; band < this.bands.length; band++) {
      const filter = this.filters[band]
      if (!filter) continue
      const { start, weights, total } = filter
      let squares = 0
      let rises = 0
      for (let index = 0; index < weights.length; index++) {
        const weight = weights[index] ?? 0
        if (weight === 0) continue
        const bin = start + index
        const magnitude = magnitudes[bin] ?? 0
        squares += weight * magnitude * magnitude
        const rise = (logs[bin] ?? 0) - (previousLogs[bin] ?? 0)
        if (rise > 0) rises += weight * rise
      }
      // The root mean square, which is what the energy in a band is; the mean
      // of the magnitudes would divide one bright partial by the whole band.
      const level = Math.sqrt(squares / total)
      const envelope = this.envelopes[band]?.step(level, dt) ?? 0
      const peak = this.peaks[band]?.step(level, dt) ?? QUIET
      packet[band] = clamp01(envelope / peak)
      this.bandFlux[band] = rises / total
    }

    const { start, weights, total } = this.span
    let squares = 0
    let flux = 0
    for (let index = 0; index < weights.length; index++) {
      const weight = weights[index] ?? 0
      if (weight === 0) continue
      const bin = start + index
      const magnitude = magnitudes[bin] ?? 0
      squares += weight * magnitude * magnitude
      const rise = (logs[bin] ?? 0) - (previousLogs[bin] ?? 0)
      if (rise > 0) flux += weight * rise
    }
    this.remember(logs, now)
    const rms = Math.sqrt(squares / total)
    packet[F.energy] = clamp01(this.energyEnvelope.step(rms, dt) / this.energyPeak.step(rms, dt))

    // Each band against its own history. A band that is always busy settles on
    // a high threshold and a quiet one on a low threshold, which is what lets
    // the hats keep firing through a passage the kick is sitting out.
    let anyBand = false
    for (let band = 0; band < this.bands.length; band++) {
      const found = this.detectors[band]?.step(this.bandFlux[band] ?? 0, dt)
      packet[BAND_HIT + band] = found?.strength ?? 0
      packet[BAND_PULSE + band] = found?.pulse ?? 0
      anyBand ||= found?.onset ?? false
    }

    const whole = this.detector.step(flux / total, dt)
    packet[F.flux] = whole.flux
    packet[F.fluxThreshold] = whole.threshold
    packet[F.onset] = whole.onset ? 1 : 0
    packet[F.onsetStrength] = whole.strength
    packet[F.beatPulse] = whole.pulse

    // Flux over its mean, compressed: a few huge hits would otherwise own
    // the autocorrelation and the beat between them would not register.
    this.trackTempo(Math.log1p(TEMPO_COMPRESSION * whole.flux), dt)
    packet[F.tempoBpm] = this.tempo

    // Pace counts a hit in any band, since a kick that lives in three sub
    // bins barely moves the flux of the whole spectrum; the global detector
    // is for broadband hits and the beat pulse the post stack reads.
    const song = this.song.step(anyBand || whole.onset, rms, packet, this.tempo, dt)
    packet[F.pace] = song.pace
    packet[F.swell] = song.swell
    packet[F.weight] = song.weight
    packet[F.tempo] = song.tempo

    this.time = now
    packet[F.time] = this.time
    packet[F.dt] = dt
    return packet
  }

  /** The newest remembered frame that is at least the flux lag old, if any. */
  private reference(now: number): Float32Array | null {
    for (let back = 0; back < this.historyCount; back++) {
      const slot = (this.historyHead - 1 - back + FLUX_HISTORY) % FLUX_HISTORY
      if (now - (this.historyAt[slot] ?? 0) >= FLUX_LAG_SECONDS) return this.history[slot] ?? null
    }

    return null
  }

  private remember(logs: Float32Array, now: number) {
    this.history[this.historyHead]?.set(logs)
    this.historyAt[this.historyHead] = now
    this.historyHead = (this.historyHead + 1) % FLUX_HISTORY
    this.historyCount = Math.min(FLUX_HISTORY, this.historyCount + 1)
  }

  // Autocorrelation of the last few seconds of compressed flux, once a
  // second, over the lags that mean 60 to 200 beats per minute. The flux is
  // resampled to a fixed rate on the way in, so the lags mean the same
  // tempos whatever the frame rate. Correlations are normalised so long lags
  // are not penalised for having fewer samples.
  // Each lag is scored with its multiples added in (a beat's half-bar and bar
  // agree with it) and weighted toward the tempos people tap (around 120),
  // because a bar-long pattern correlates as well as a beat-long one and
  // would otherwise read half-time. When the half lag correlates nearly as
  // well it wins for the same reason.
  private trackTempo(flux: number, dt: number) {
    const window = this.tempoWindow
    // Sample and hold: a frame longer than the resampling period fills the
    // samples it spans with its own reading.
    this.tempoClock += dt
    while (this.tempoClock >= 1 / TEMPO_RATE) {
      this.tempoClock -= 1 / TEMPO_RATE
      window[this.tempoAt] = flux
      this.tempoAt = (this.tempoAt + 1) % window.length
      this.tempoFilled = Math.min(window.length, this.tempoFilled + 1)
    }
    this.sinceTempo += dt
    if (this.sinceTempo < TEMPO_EVERY_SECONDS || this.tempoFilled < window.length) return
    this.sinceTempo = 0
    const length = window.length
    let mean = 0
    for (let i = 0; i < length; i++) mean += window[i] ?? 0
    mean /= length
    let variance = 0
    for (let i = 0; i < length; i++) variance += ((window[i] ?? 0) - mean) ** 2
    variance /= length
    if (variance <= 0) {
      this.report(0)
      return
    }
    const minLag = Math.max(1, Math.floor((60 * TEMPO_RATE) / TEMPO_MAX_BPM))
    const maxLag = Math.min(length >> 1, Math.ceil((60 * TEMPO_RATE) / TEMPO_MIN_BPM))
    const correlation = new Float32Array(maxLag + 1)
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0
      for (let i = lag; i < length; i++) {
        const a = (window[(this.tempoAt + i) % length] ?? 0) - mean
        const b = (window[(this.tempoAt + i - lag) % length] ?? 0) - mean
        sum += a * b
      }
      correlation[lag] = sum / ((length - lag) * variance)
    }
    const bpm = (lag: number) => (60 * TEMPO_RATE) / lag
    const preference = (lag: number) =>
      Math.exp(-0.5 * (Math.log2(bpm(lag) / TEMPO_PREFERRED_BPM) / TEMPO_PREFERENCE_OCTAVES) ** 2)
    let bestLag = 0
    let best = 0
    let total = 0
    for (let lag = minLag; lag <= maxLag; lag++) {
      const value = correlation[lag] ?? 0
      total += value
      const harmonics =
        value + 0.5 * (correlation[2 * lag] ?? 0) + 0.25 * (correlation[4 * lag] ?? 0)
      const score = harmonics * preference(lag)
      if (score > best) {
        best = score
        bestLag = lag
      }
    }
    const average = total / (maxLag - minLag + 1)
    const raw = correlation[bestLag] ?? 0
    if (!bestLag || raw < TEMPO_MIN_CORRELATION || raw < 3 * Math.max(average, 0)) {
      this.report(0)
      return
    }
    const half = Math.round(bestLag / 2)
    if (half >= minLag && (correlation[half] ?? 0) >= TEMPO_HALF_LAG_RATIO * raw) bestLag = half
    // The peak is refined between samples with a parabola through its
    // neighbours, since at 100 samples a second one lag is 2% of a tempo.
    const left = correlation[bestLag - 1] ?? 0
    const right = correlation[bestLag + 1] ?? 0
    const centre = correlation[bestLag] ?? 0
    const curve = left - 2 * centre + right
    const offset = curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / curve)) : 0
    this.report(bpm(bestLag + offset))
  }

  private report(reading: number) {
    this.tempoReadings[this.tempoReadingAt] = reading
    this.tempoReadingAt = (this.tempoReadingAt + 1) % TEMPO_MEDIAN_OF
    const sorted = Array.from(this.tempoReadings).sort((a, b) => a - b)
    this.tempo = sorted[TEMPO_MEDIAN_OF >> 1] ?? 0
  }
}
