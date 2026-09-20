/**
 * Turns analyser frames into a small packet of musical features for the
 * visualizer. Pure TypeScript, no DOM: the input is the Float32Array that
 * `AnalyserNode.getFloatFrequencyData` fills (dB per bin, -Infinity for
 * silence) plus the seconds since the previous frame, and the output is a
 * fixed-layout Float32Array consumed on the CPU by the renderer and scenes.
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
 *   21     tempoBpm        bpm       0 until the tempo tracker settles on a period
 *   22     time            s         seconds of features so far
 *   23     dt              s         this frame's step
 *   24     pace            0..1      audible hits a second, decayed over half a minute
 *   25     swell           0..1      loudness now against the last half minute, in dB; 0.5 is steady
 *   26     weight          0..1      where the spectral centroid sits over ten seconds; 1 is bass-led
 *   27     tempo           0..1      `tempoBpm` across 60 to 200, smoothed so it ramps
 *   28     keyHue          0..1      the key's place on the circle of fifths, a relative
 *                                    major and minor sharing one; ramps over seconds
 *   29     keyClarity      0..1      how surely a key is heard: 0 on silence or drums alone
 *   30     harmonicChange  0..1      how far the harmony has moved in the last two seconds
 *   31     recall          0..1      how closely this passage matches one heard earlier
 *   32     novelty         0..1      how different this passage is from ten seconds ago
 *   33     section         1..       which section this is; a number comes back with its passage
 *   34-38  subHitCentre..trebleHitCentre
 *                          0..1      where across the spectrum, in octaves from 20 Hz to
 *                                    16 kHz, that band's rise landed this frame
 *   39-43  subHitWidth..trebleHitWidth
 *                          0..1      how wide that rise was, as a fraction of the same span
 *   44     tempoConfidence 0..1      how well the chosen period correlates; gate `tempo` on it
 *   45     beatPhase       0..1      where in the beat we are, 0 on the beat and rising to the next
 *   46     hardness        0..1      how abrupt and how saturated this track's hits are,
 *                                    averaged over twenty seconds; 0.5 before any
 *
 * Each band detects its own onsets, against its own flux and its own adaptive
 * threshold, which is what lets one emitter answer the kick and another the
 * hats. The three global rows are the same detector run over the whole
 * spectrum, kept because the post stack, the preset vocabulary and the debug
 * overlay all read them.
 *
 * Rows 24 to 27 are the song rather than the frame. Everything above them
 * answers "what is happening now"; those answer "what kind of track is this"
 * and "where in it are we". They are levels like any other, so a preset reads
 * them through the same mapping table.
 *
 * Rows 28 to 30 are the harmony: a chroma read from spectral peaks, folded
 * into a key. They give the song a colour of its own and a way to notice a
 * chord moving, which no amount of band energy could.
 *
 * Rows 31 to 33 are the structure: a memory of what the last few minutes
 * sounded like, so a drop that comes back is known to be the same drop.
 * `section` is an id rather than a level, read by a scene the way it reads
 * an onset, and it is what lets a returning passage return to the same look.
 *
 * Rows 34 to 43 say where each band's hit landed and how wide it was, so a
 * scene can give a sound a place of its own: a kick low and fat, a hat high
 * and small, a note between at its pitch. They are written every frame from
 * the rise the band saw, and mean something on the frame the band's hit
 * fired; between hits they hold the last rise, or the band's own middle.
 *
 * Rows 44 and 45 are the beat as a clock rather than as a reaction.
 * `beatPhase` runs ahead to where the next beat is predicted, and
 * `tempoConfidence` says how much to believe it; both come from the tempo
 * tracker in `TempoTracker.ts`, which reads each band's own rise.
 *
 * Row 46 belongs with rows 24 to 27 and sits here only because rows are
 * added at the end. `hardness` is how a track's hits arrive rather than how
 * often or how loudly: how much of a hit's rise over the bed under it holds
 * near its own peak, and how much of the spectrum that hit's power is spread
 * across, averaged over the hits of the last twenty seconds. Over the bed
 * and not over the mix, or a pad loud enough would make every hit look held.
 * `onsetStrength` cannot stand in for it, since that grades a hit against
 * the loudest recent one and is therefore relative to the track.
 *
 * Nothing on the GPU binds this. Every consumer reads the Float32Array on the
 * CPU, so the layout is free of any vec4 alignment. Rows are only ever added
 * at the end: the indices are public API.
 */
import { TEMPO_MAX_BPM, TEMPO_MIN_BPM, TempoTracker } from './TempoTracker'

export const PACKET_LENGTH = 47

/** The five bands, in order. Band `i` is packet slot `i`. */
export const BAND_NAMES = ['sub', 'bass', 'lowMid', 'highMid', 'treble'] as const
export type BandName = (typeof BAND_NAMES)[number]
export const BAND_COUNT = BAND_NAMES.length

/** Where a band's own onset lands, and where its decaying pulse does. */
export const BAND_HIT = BAND_COUNT
export const BAND_PULSE = BAND_COUNT * 2
/** Where each band's hit landed across the spectrum, and how wide it was. */
export const BAND_HIT_CENTRE = 34
export const BAND_HIT_WIDTH = BAND_HIT_CENTRE + BAND_COUNT

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
  keyHue: 28,
  keyClarity: 29,
  harmonicChange: 30,
  recall: 31,
  novelty: 32,
  section: 33,
  subHitCentre: 34,
  bassHitCentre: 35,
  lowMidHitCentre: 36,
  highMidHitCentre: 37,
  trebleHitCentre: 38,
  subHitWidth: 39,
  bassHitWidth: 40,
  lowMidHitWidth: 41,
  highMidHitWidth: 42,
  trebleHitWidth: 43,
  tempoConfidence: 44,
  beatPhase: 45,
  hardness: 46,
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
// Audible hits a second, in any band, that counts as fully busy. A hit is one
// struck sound however many bands it trips, so this is a rate of sounds and
// not of detector firings: four to the floor at 128 BPM settles at 2.1 and a
// two-step at 174 at 2.9, since a hat under a kick or a pad is worth little.
// Full is 4 a second, which puts 80 BPM near a third, 128 near a half and
// drum and bass near three quarters. It was 12 while the count ran two or
// three times the true rate, and left at 12 every track would sit in the
// bottom quarter of the range with nothing to tell them apart. Not yet
// re-measured on real tracks.
const PACE_FULL = 4
const SWELL_SHORT_MS = 2000
const SWELL_LONG_MS = 30000
// A passage this many dB above its half-minute average reads as a full drop,
// and this many below as a full breakdown. Measured in dB so the two are the
// same distance from steady: as a ratio, half the loudness was the floor and
// one and a half times was already the ceiling.
const SWELL_RANGE_DB = 6
const WEIGHT_MS = 10000
const TEMPO_RAMP_MS = 5000
// Hardness is a mean over the hits of roughly the last twenty seconds. Long
// enough that one odd hit cannot move it, short enough that a track that
// changes its character is followed inside a section.
const HARDNESS_SECONDS = 20
// A hit is watched for this long. A hit that lands while a window is open
// joins it rather than starting one, so a window is always the full tail and
// the same sound is scored once at any frame rate: one struck sound often
// trips two bands a frame or two apart, and when a second reading could cut
// the first one's window short the number of hits scored, and with it the
// mean, moved with the frame rate.
const HARDNESS_TAIL_SECONDS = 0.1
// Frames in a window, at the smallest step the extractor allows. Past this
// the oldest is dropped, which can only happen on a run at 1000 frames a
// second and costs the measure a few percent of its window.
const HARDNESS_WINDOW_CAPACITY = 128
// And the fewest a window may be scored on. One frame is its own peak by
// definition, so a run slow enough to put two frames in a tenth of a second
// would read everything as held; under about 30 frames a second the measure
// gathers no evidence at all and holds at its neutral, which is the honest
// answer when the frames are wider than the thing being measured.
const HARDNESS_MIN_FRAMES = 3
// Sound with no hit in it for this long is evidence of softness, at this
// many hits' worth a second. Without it a pad, which has no onsets to
// average, would sit on the neutral it started at for ever. Two seconds
// because anything played on a kit hits more often than that, so a track
// with drums never pays the drag.
const HARDNESS_GAP_SECONDS = 2
const HARDNESS_SOFT_PER_SECOND = 1
// The neutral the measure starts at, and how many hits' worth of evidence it
// is worth. A prior rather than a threshold, so there is no step the moment
// the extractor decides it has heard enough: the value leaves 0.5 as fast as
// the evidence arrives and never jumps.
const HARDNESS_NEUTRAL = 0.5
const HARDNESS_PRIOR = 4
// The bed a hit has to lift the mix above is tracked by a level that falls
// to the RMS at once and creeps back up over this long, so between hits it
// settles on whatever is playing under them. Long enough that it does not
// climb into the hit it is the baseline for, short enough to follow a mix
// that thins out.
const HARDNESS_FLOOR_MS = 300
// The mean of a hit's rise over the bed, against that rise's own peak: how
// much of the window the hit spends at the top rather than swelling into
// place or ringing away. Measured over 25 seconds of each synthetic track at
// 60 and at 144 frames a second: hardstyle 0.88 to 0.92, isolated clipped
// kicks 0.81 to 0.91, house 0.67 to 0.73, isolated soft pulses 0.48 to 0.61,
// lo-fi 0.38 to 0.47.
const HOLD_SOFT = 0.55
const HOLD_HARD = 0.9
// How much of the spectrum the hit's power is spread across, which is what a
// clipper does to a sine: 1 for a flat spectrum, one over the bin count for
// a single partial. Measured on the same runs: clipped kicks 0.029 to 0.038,
// soft pulses 0.0026 to 0.0037, a kit with hats in it 0.031 to 0.17. Read on
// a log scale, since the two ends are a decade apart and not a difference.
const SPREAD_TONAL = 0.003
const SPREAD_BROAD = 0.035
// How far a hit lifted the mix above its bed, as a share of the window's
// peak. Under the first the rise is too small a part of what is sounding for
// its shape to mean anything, and the hit counts as soft rather than as
// whatever the noise on it happened to look like; over the second the hit is
// most of what is there. Measured: a clipped kick under a pad six times its
// own size lifts by 0.01, the same kick alone by 0.98.
const LIFT_BURIED = 0.1
const LIFT_CLEAR = 0.5
const MIN_DT = 0.001
const MAX_DT = 0.1
// The span a hit's place is measured across, in octaves: 20 Hz to 16 kHz is
// 9.64 of them, and a place is the fraction of the way up.
const SPAN_LOW_HZ = 20
const SPAN_OCTAVES = Math.log2(16000 / SPAN_LOW_HZ)
// Chroma is read from spectral peaks between these, each weighted by its
// log magnitude. Peaks rather than every bin because drums fill every bin
// and flatten a magnitude chroma: on a real track the peak-picked chroma
// found the key and the magnitude one wavered between it and its relatives.
const CHROMA_LOW_HZ = 100
const CHROMA_HIGH_HZ = 5000
// A peak below this log magnitude, about -60 dB, is noise.
const CHROMA_FLOOR = Math.log1p(FLUX_COMPRESSION * QUIET)
// Three views of the chroma: what is sounding now, the last couple of
// seconds, and the passage. The change is the first against the second;
// the key is read from the third.
const CHROMA_SHORT_MS = 300
const CHROMA_MID_MS = 2000
const CHROMA_LONG_MS = 8000
const KEY_EVERY_SECONDS = 0.5
const KEY_RAMP_MS = 3000
// Added to every bin before the medium chroma is normalised, so that once
// the notes have faded it reads as flat rather than as the last note held
// for ever. One peak weighs about one to five; a tonal passage sums to
// dozens, so this only tells when there is next to nothing left.
const CHROMA_FLAT_WEIGHT = 0.5
// Krumhansl and Kessler's key profiles for C major and C minor, how much a
// listener expects each pitch class; the other keys rotate them.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
// A correlation with the best profile below the first reads as no key at
// all, above the second as certain.
const KEY_CLARITY_LOW = 0.4
const KEY_CLARITY_HIGH = 0.9
// The cosine distance between the short and the medium chroma, scaled so a
// chord change reads near 1 and the drift within a chord stays low.
const HARMONIC_CHANGE_GAIN = 3
// The structure's view of "now" is this long, and it is remembered this
// often, for this long. Ten minutes of snapshots every two seconds is 300
// vectors of 23 floats, which is nothing.
const STRUCTURE_NOW_MS = 2000
const SNAPSHOT_SECONDS = 2
const SNAPSHOT_CAPACITY = 300
const COMPARE_SECONDS = 0.5
// Nothing is remembered until the vector has had this long to settle, since
// a memory of the cold start would read as a boundary against everything.
const STRUCTURE_WARM_SECONDS = 4
// Novelty compares now with this long ago.
const NOVELTY_LAG_SECONDS = 10
// Cosine similarities mapped onto recall. On a real track the drops matched
// one another at 1.00 and a verse its own return at 0.98 to 0.99, while a
// drop against the intro sat at 0.96 and against a verse at 0.94, so the
// map is steep and sits just above those.
const RECALL_LOW = 0.94
const RECALL_HIGH = 0.99
const NOVELTY_GAIN = 5
// A boundary starts as a candidate, novelty at or past this once a section
// has run this long, and is confirmed a few seconds later by the new
// passage's mean against the ending section's: at least this similar and
// it was a fill, not a section. The candidate is a level rather than a
// rising edge, because a riser running straight into a drop keeps the
// novelty up across both and an edge would miss the second. A confirmed boundary joins an old
// section when the recall to it is at least this.
const CANDIDATE_NOVELTY = 0.4
const MIN_SECTION_SECONDS = 6
const CONFIRM_SECONDS = 6
const SAME_SECTION_SIMILARITY = 0.965
const RECALL_TO_REJOIN = 0.6
// A section's mean starts this long after it began, and a candidate's this
// long after the candidate, so neither takes in the passage before it. The
// section's mean also only takes samples while the novelty is low: what a
// section sounds like when it is not changing, so a riser running into a
// drop cannot fold the drop into the riser's section before the drop has
// had its own boundary.
const SECTION_MEAN_FROM_SECONDS = 4
const CANDIDATE_MEAN_FROM_SECONDS = 1.5
// Hits a second in a band that count as fully busy in the structure vector,
// and how much the chroma's shape weighs against a band level.
const STRUCTURE_RATE_FULL = 3
const STRUCTURE_CHROMA_WEIGHT = 1
// The top two band levels weigh double. Every level is scaled by its own
// recent peak, so a drop and a quiet passage share their low end; whether
// the top of the spectrum is occupied is what tells them apart, and at
// equal weight a drop matched the intro at 0.94, which is too close to a
// return. Doubled it is 0.89, with the drops still matching at 1.00.
const STRUCTURE_HIGH_WEIGHT = 2
const RECALL_RAMP_MS = 1000
const NOVELTY_RAMP_MS = 500

const decibels = (level: number) => 20 * Math.log10(Math.max(level, QUIET))

/**
 * The log-frequency centroid of a spectrum that is flat between two edges,
 * which is where the centroid of a band with nothing in particular in it
 * sits. The integral of log2(f) has a closed form, and this is it divided by
 * the width.
 */
export function flatLogCentroid(low: number, high: number): number {
  const antiderivative = (hz: number) => hz * Math.log2(hz) - hz / Math.LN2
  return (antiderivative(high) - antiderivative(low)) / (high - low)
}

// Weight maps the spectral centroid between the low group's flat centroid
// and the high group's: a track that is all sub and bass reads about 1, one
// that is all highMid and treble reads 0, and equal power per octave reads
// about 0.6, because the low group is fewer octaves wide than the high one.
const LOW_GROUP_CENTROID = flatLogCentroid(
  DEFAULT_BANDS[0]?.low ?? 20,
  DEFAULT_BANDS[1]?.high ?? 250,
)
const HIGH_GROUP_CENTROID = flatLogCentroid(
  DEFAULT_BANDS[3]?.low ?? 1000,
  DEFAULT_BANDS[4]?.high ?? 16000,
)

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

export const PITCH_NAMES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const

/** Which of the twelve a frequency is nearest, 0 for C. */
export const pitchClass = (hz: number) =>
  ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12 + 9) % 12

/**
 * A key's place on the circle of fifths as a fraction of the way round, C at
 * 0, G a twelfth on, F a twelfth back. Neighbours on the circle share most of
 * their notes, so a modulation to the dominant is a small step of colour and
 * a jump to a distant key a large one. A minor key sits where its relative
 * major does, since the two are the same notes; that is also what keeps the
 * profile's habit of flipping between relatives from moving the colour.
 */
export const keyHueOf = (tonic: number, major: boolean) =>
  ((((major ? tonic : tonic + 3) % 12) * 7) % 12) / 12

/** The relative major at that place on the circle, with its minor: "A / F#m". */
export function keyLabel(hue: number): string {
  const position = ((Math.round(hue * 12) % 12) + 12) % 12
  // Seven fifths is a semitone, so seven steps undoes the multiply above.
  const major = (position * 7) % 12
  const minor = (major + 9) % 12
  return `${PITCH_NAMES[major]} / ${PITCH_NAMES[minor]}m`
}

const pearson = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let meanA = 0
  let meanB = 0
  for (let i = 0; i < 12; i++) {
    meanA += (a[i] ?? 0) / 12
    meanB += (b[i] ?? 0) / 12
  }
  let cross = 0
  let squareA = 0
  let squareB = 0
  for (let i = 0; i < 12; i++) {
    const da = (a[i] ?? 0) - meanA
    const db = (b[i] ?? 0) - meanB
    cross += da * db
    squareA += da * da
    squareB += db * db
  }
  const scale = Math.sqrt(squareA * squareB)
  return scale > 0 ? cross / scale : 0
}

/** The key a chroma fits best, by correlation with the rotated profiles. */
export function keyOf(chroma: ArrayLike<number>): { tonic: number; major: boolean; r: number } {
  let best = { tonic: 0, major: true, r: -Infinity }
  const rotated = new Float32Array(12)
  for (const [profile, major] of [
    [MAJOR_PROFILE, true],
    [MINOR_PROFILE, false],
  ] as const) {
    for (let tonic = 0; tonic < 12; tonic++) {
      for (let i = 0; i < 12; i++) rotated[(i + tonic) % 12] = profile[i] ?? 0
      const r = pearson(chroma, rotated)
      if (r > best.r) best = { tonic, major, r }
    }
  }

  return best
}

export type HarmonyReading = {
  keyHue: number
  keyClarity: number
  harmonicChange: number
}

/**
 * The harmony of the passage: a chroma built from the spectral peaks of each
 * frame, folded into a key and a measure of how far the harmony has moved.
 *
 * A twelve-bin chroma is kept at three speeds. What is sounding now against
 * the last couple of seconds is the change: a chord that moves pulls the two
 * apart for as long as the slower one takes to catch up. The key is read from
 * the slowest, twice a second, and the hue it lands on is ramped as a unit
 * vector so a key a full turn away is still the short way round.
 */
export class Harmony {
  /** The medium chroma, normalised to sum to 1; flat when nothing sounds. */
  readonly chroma = new Float32Array(12).fill(1 / 12)
  private readonly frame = new Float32Array(12)
  private readonly short = Array.from(
    { length: 12 },
    () => new Envelope(CHROMA_SHORT_MS, CHROMA_SHORT_MS),
  )
  private readonly mid = Array.from(
    { length: 12 },
    () => new Envelope(CHROMA_MID_MS, CHROMA_MID_MS),
  )
  private readonly long = Array.from(
    { length: 12 },
    () => new Envelope(CHROMA_LONG_MS, CHROMA_LONG_MS),
  )
  private readonly longChroma = new Float32Array(12)
  private readonly hueX = new Envelope(KEY_RAMP_MS, KEY_RAMP_MS)
  private readonly hueY = new Envelope(KEY_RAMP_MS, KEY_RAMP_MS)
  private readonly clarity = new Envelope(KEY_RAMP_MS, KEY_RAMP_MS)
  private sinceKey = Infinity
  private target = { hue: 0, clarity: 0 }

  /** One spectral peak of this frame, weighted by its log magnitude. */
  add(hz: number, weight: number) {
    const at = pitchClass(hz)
    this.frame[at] = (this.frame[at] ?? 0) + weight
  }

  step(dt: number): HarmonyReading {
    let shortSum = 0
    let midSum = 0
    let longSum = 0
    for (let k = 0; k < 12; k++) {
      const value = this.frame[k] ?? 0
      this.frame[k] = 0
      shortSum += this.short[k]?.step(value, dt) ?? 0
      midSum += this.mid[k]?.step(value, dt) ?? 0
      longSum += this.long[k]?.step(value, dt) ?? 0
    }

    // The change is a cosine distance, so it is about which notes are
    // sounding and not how loudly.
    let cross = 0
    let squareShort = 0
    let squareMid = 0
    for (let k = 0; k < 12; k++) {
      const a = this.short[k]?.value ?? 0
      const b = this.mid[k]?.value ?? 0
      cross += a * b
      squareShort += a * a
      squareMid += b * b
    }
    const scale = Math.sqrt(squareShort * squareMid)
    const distance = scale > 1e-12 ? 1 - cross / scale : 0
    const harmonicChange = clamp01(HARMONIC_CHANGE_GAIN * distance)
    for (let k = 0; k < 12; k++)
      this.chroma[k] =
        ((this.mid[k]?.value ?? 0) + CHROMA_FLAT_WEIGHT) / (midSum + 12 * CHROMA_FLAT_WEIGHT)

    this.sinceKey += dt
    if (this.sinceKey >= KEY_EVERY_SECONDS) {
      this.sinceKey = 0
      if (longSum > 1e-6) {
        for (let k = 0; k < 12; k++) this.longChroma[k] = this.long[k]?.value ?? 0
        const key = keyOf(this.longChroma)
        // How surely the key is heard: how well the profile fits, and whether
        // anything tonal is sounding now at all. The second term is what
        // lets the clarity fall the moment the notes stop, while the slow
        // chroma the key is read from still remembers them.
        const fit = clamp01((key.r - KEY_CLARITY_LOW) / (KEY_CLARITY_HIGH - KEY_CLARITY_LOW))
        const presence = clamp01(shortSum / Math.max(longSum, 1e-6))
        this.target = { hue: keyHueOf(key.tonic, key.major), clarity: fit * presence }
      } else this.target = { hue: this.target.hue, clarity: 0 }
    }

    const angle = this.target.hue * 2 * Math.PI
    const x = this.hueX.step(Math.cos(angle), dt)
    const y = this.hueY.step(Math.sin(angle), dt)
    const keyHue = x * x + y * y > 1e-9 ? (Math.atan2(y, x) / (2 * Math.PI) + 1) % 1 : 0
    return { keyHue, keyClarity: this.clarity.step(this.target.clarity, dt), harmonicChange }
  }
}

export type StructureReading = {
  recall: number
  novelty: number
  section: number
}

const cosine = (a: Float32Array, b: Float32Array) => {
  let cross = 0
  let squareA = 0
  let squareB = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    cross += x * y
    squareA += x * x
    squareB += y * y
  }
  // Nothing against nothing is the same thing, so silence is not a change;
  // nothing against something is as different as it gets.
  if (squareA < 1e-12 && squareB < 1e-12) return 1
  const scale = Math.sqrt(squareA * squareB)
  return scale > 1e-12 ? cross / scale : 0
}

/** Band levels and energy, a hit rate per band, and the chroma's shape: 23 floats. */
const STRUCTURE_DIMS = BAND_COUNT + 1 + BAND_COUNT + 12

/** A running mean of vectors, one sample at a time. */
class Mean {
  readonly value = new Float32Array(STRUCTURE_DIMS)
  count = 0

  add(sample: Float32Array) {
    this.count++
    for (let k = 0; k < STRUCTURE_DIMS; k++)
      this.value[k] = (this.value[k] ?? 0) + ((sample[k] ?? 0) - (this.value[k] ?? 0)) / this.count
  }

  reset() {
    this.value.fill(0)
    this.count = 0
  }

  copy(from: Mean) {
    this.value.set(from.value)
    this.count = from.count
  }
}

/**
 * The song's shape, remembered. A vector of what the last couple of seconds
 * sounded like (which bands, how busy each, which notes) is kept every two
 * seconds for the novelty, and every section that has ended is kept as one
 * mean vector. Twice a second the present is compared with those section
 * means; the best match is `recall`, so a steady passage does not recall its
 * own start and a returning one recalls the whole of its first time round.
 * Whole sections rather than the snapshots, because a single two-second
 * snapshot of an intro's last bar matched a drop well enough to call the
 * drop a return of the intro. How far the present has moved from ten
 * seconds ago is `novelty`.
 *
 * A `section` boundary takes two steps, because the fast novelty also lifts
 * on a fill. High novelty is a candidate; six seconds on, the mean of the
 * new passage is set against the mean of the section it would end, and if
 * the two are nearly the same the candidate is dropped. A confirmed boundary
 * either starts a new section or, when the recall to an older one is high,
 * rejoins it. On a real track that put all three drops in one section and
 * the quiet passages together, with the first drop called four seconds
 * late and a boundary or two more than a listener would count. Swell is
 * deliberately not in the vector: it is loudness against the last half
 * minute, so the same quiet passage reads differently after a drop and
 * after silence, and a returning one failed to recall itself.
 */
export class Structure {
  private readonly now = new Float32Array(STRUCTURE_DIMS)
  private readonly nowEnvelopes = Array.from(
    { length: STRUCTURE_DIMS },
    () => new Envelope(STRUCTURE_NOW_MS, STRUCTURE_NOW_MS),
  )
  private readonly rates = new Float32Array(BAND_COUNT)
  private readonly snapshots: Float32Array[] = []
  private readonly snapshotAt: number[] = []
  /** Every section that has ended, as one mean vector each, by id. */
  private readonly past = new Map<number, Float32Array>()
  private readonly recallRamp = new Envelope(RECALL_RAMP_MS, RECALL_RAMP_MS)
  private readonly noveltyRamp = new Envelope(NOVELTY_RAMP_MS, NOVELTY_RAMP_MS)
  /** What this section has sounded like so far, and what a candidate has. */
  private readonly sectionMean = new Mean()
  private readonly candidateMean = new Mean()
  private candidateAt: number | null = null
  /** The closest an ended section has come to the present since the candidate opened. */
  private candidateMatch = { similarity: -1, section: 0 }
  private sinceSnapshot = Infinity
  private sinceCompare = Infinity
  private sinceBoundary = 0
  private sectionStartedAt = 0
  private elapsed = 0
  private section = 1
  private sections = 1
  private recallTarget = 0
  private noveltyTarget = 0

  /**
   * `packet` supplies the band levels, energy and hits; `chroma` is the
   * normalised medium chroma the harmony keeps.
   */
  step(packet: Float32Array, chroma: Float32Array, dt: number): StructureReading {
    this.elapsed += dt
    this.sinceBoundary += dt
    // Hits a second per band, each hit decaying over the vector's own time,
    // then scaled so a busy band reads about 1.
    const keep = Math.exp(-dt / (STRUCTURE_NOW_MS / 1000))
    for (let band = 0; band < BAND_COUNT; band++) {
      const hit = (packet[BAND_HIT + band] ?? 0) > 0 ? 1000 / STRUCTURE_NOW_MS : 0
      this.rates[band] = (this.rates[band] ?? 0) * keep + hit
    }

    const now = this.now
    const level = (at: number, value: number) => {
      now[at] = this.nowEnvelopes[at]?.step(value, dt) ?? 0
    }

    for (let band = 0; band < BAND_COUNT; band++) {
      const weight = band >= BAND_COUNT - 2 ? STRUCTURE_HIGH_WEIGHT : 1
      level(band, weight * (packet[band] ?? 0))
      now[BAND_COUNT + 1 + band] = clamp01((this.rates[band] ?? 0) / STRUCTURE_RATE_FULL)
    }
    level(BAND_COUNT, packet[F.energy] ?? 0)
    // The chroma's shape, not its mass: flat contributes nothing, so a
    // passage with no notes is not made to look like every other such.
    for (let k = 0; k < 12; k++)
      level(2 * BAND_COUNT + 1 + k, STRUCTURE_CHROMA_WEIGHT * ((chroma[k] ?? 0) - 1 / 12))

    if (this.candidateAt === null) {
      if (
        this.elapsed - this.sectionStartedAt >= SECTION_MEAN_FROM_SECONDS &&
        this.noveltyTarget < CANDIDATE_NOVELTY
      )
        this.sectionMean.add(now)
    } else if (this.elapsed - this.candidateAt >= CANDIDATE_MEAN_FROM_SECONDS)
      this.candidateMean.add(now)

    this.sinceCompare += dt
    if (this.sinceCompare >= COMPARE_SECONDS) {
      this.sinceCompare = 0
      this.compare()
    }

    this.sinceSnapshot += dt
    if (this.sinceSnapshot >= SNAPSHOT_SECONDS && this.elapsed >= STRUCTURE_WARM_SECONDS) {
      this.sinceSnapshot = 0
      this.remember()
    }

    return {
      recall: this.recallRamp.step(this.recallTarget, dt),
      novelty: this.noveltyRamp.step(this.noveltyTarget, dt),
      section: this.section,
    }
  }

  private remember() {
    if (this.snapshots.length === SNAPSHOT_CAPACITY) {
      this.snapshots.shift()
      this.snapshotAt.shift()
    }
    this.snapshots.push(new Float32Array(this.now))
    this.snapshotAt.push(this.elapsed)
  }

  /**
   * The best match among the sections that have ended, and which it is. A
   * section is remembered only once it has ended, so a steady passage on its
   * first time round recalls nothing, while a section that has come back
   * recalls its own first time; at a boundary the section that is ending is
   * left out, since it is the passage being left.
   */
  private best(vector: Float32Array, except?: number): { similarity: number; section: number } {
    let similarity = -1
    let section = this.section
    for (const [id, mean] of this.past) {
      if (id === except) continue
      const found = cosine(vector, mean)
      if (found > similarity) {
        similarity = found
        section = id
      }
    }

    return { similarity, section }
  }

  private recallOf(similarity: number) {
    return similarity < 0 ? 0 : clamp01((similarity - RECALL_LOW) / (RECALL_HIGH - RECALL_LOW))
  }

  private compare() {
    this.recallTarget = this.recallOf(this.best(this.now).similarity)

    // The youngest snapshot at least the lag old, less half a snapshot's
    // spacing so one is always in reach once the track is that long.
    let past: Float32Array | null = null
    let pastAge = Infinity
    for (let index = 0; index < this.snapshots.length; index++) {
      const age = this.elapsed - (this.snapshotAt[index] ?? 0)
      if (age >= NOVELTY_LAG_SECONDS - SNAPSHOT_SECONDS / 2 && age < pastAge) {
        pastAge = age
        past = this.snapshots[index] ?? null
      }
    }
    this.noveltyTarget = past ? clamp01(NOVELTY_GAIN * (1 - cosine(this.now, past))) : 0

    if (
      this.noveltyTarget >= CANDIDATE_NOVELTY &&
      this.candidateAt === null &&
      this.sinceBoundary >= MIN_SECTION_SECONDS &&
      this.sectionMean.count > 0
    ) {
      this.candidateAt = this.elapsed
      this.candidateMean.reset()
      this.candidateMatch = { similarity: -1, section: 0 }
    }

    // While a candidate is open the present is still becoming the new
    // passage, so the rejoin is judged on the closest it has come to an
    // ended section over the whole window rather than on the last look.
    if (this.candidateAt !== null) {
      const match = this.best(this.now, this.section)
      if (match.similarity > this.candidateMatch.similarity) this.candidateMatch = match
    }

    if (this.candidateAt === null || this.elapsed - this.candidateAt < CONFIRM_SECONDS) return
    const candidateAt = this.candidateAt
    this.candidateAt = null
    if (this.candidateMean.count === 0) return
    if (cosine(this.candidateMean.value, this.sectionMean.value) >= SAME_SECTION_SIMILARITY) return

    // A boundary. The section that ends is remembered as its mean, folded
    // into what was remembered of it before if it has been here already.
    // The memories were judged with the present as the window ran, rather
    // than with the candidate's mean, which still carries the first seconds
    // of the change.
    this.retire()
    const match = this.candidateMatch
    const section =
      this.recallOf(match.similarity) >= RECALL_TO_REJOIN ? match.section : this.sections + 1
    this.sections = Math.max(this.sections, section)
    this.section = section
    this.sectionStartedAt = candidateAt
    this.sinceBoundary = this.elapsed - candidateAt
    this.sectionMean.copy(this.candidateMean)
  }

  private retire() {
    if (this.sectionMean.count === 0) return
    const known = this.past.get(this.section)
    if (known)
      for (let k = 0; k < STRUCTURE_DIMS; k++)
        known[k] = ((known[k] ?? 0) + (this.sectionMean.value[k] ?? 0)) / 2
    else this.past.set(this.section, new Float32Array(this.sectionMean.value))
  }
}

/**
 * How hard the track hits, as a running mean over its hits.
 *
 * `onsetStrength` cannot answer this: it grades a hit against the loudest
 * recent hit, so it says how big this one was for this track and nothing
 * about whether the track's hits are sharp or soft in general. What separates
 * a hardstyle kick from a busy jazz kit at the same pace and the same weight
 * is the shape of one hit, and two numbers say it.
 *
 * Everything here is measured against the bed the hit arrives over, never
 * against the mix. A level that falls to the RMS at once and creeps back up
 * settles between hits on whatever is sustaining under them, and a hit's
 * window is the rise above that. The first version read the mix itself, and
 * a track with a pad, a bass line or a vocal under its drums kept every
 * frame within a tenth of the window's peak whatever the drums did: house
 * read 0.50, and lo-fi, whose pad is the loudest thing in it, read 0.53,
 * above house and nowhere near soft. With the bed taken out lo-fi reads 0.05
 * and house 0.62.
 *
 * The first number is how much of the hundred milliseconds after a hit that
 * rise spends near its own peak, as the mean of the rise over its peak. A
 * hit that arrives at once and is held there sits near its peak for the
 * whole window, which is what a clipper and a limiter between them do to a
 * sound; a hit that swells into place or rings away passes through its peak
 * and spends the rest of the window under it.
 *
 * The second is how much of the spectrum the hit's power is spread across:
 * the mean magnitude squared over the mean square, which is 1 for a flat
 * spectrum and one over the bin count for a single partial. A clipped hit is
 * a square wave and its harmonics run to Nyquist; a soft one is a partial or
 * two standing over the floor. Both are ratios of a signal to itself, so a
 * level change cannot touch either.
 *
 * The two are combined as a geometric mean, so a hit has to do both to count
 * as hard. That is what tells the three synthetic tracks apart: hats are
 * broadband, so every kit in them reads as spread as a clipped kick, and
 * averaging the two rather than multiplying left lo-fi at 0.35 against
 * house's 0.68, on the strength of its hats alone. What a hat does not do is
 * hold. A bass note swelling under a pad holds but is one partial, and it
 * fails the other way.
 *
 * A hit that barely lifts the mix at all is scored as soft rather than on
 * the shape of its rise, since a rise that is a hundredth of what is
 * sounding is mostly noise: a clipped kick under a pad six times its size
 * read a hold anywhere between 0.31 and 0.68 from one hit to the next, and
 * the track came out at 0.19 at 60 frames a second and 0.15 at 144. Weighted
 * by the lift it comes out at 0.07 at both.
 *
 * What did not work. Attack time, as the share of a hit's rise landing in
 * its first analyser frame against the following 100 ms, moved with the
 * frame rate: the detector fires the moment the flux crosses its threshold,
 * which at 144 frames a second is part of the way up the ramp and at 60 is
 * most of the way. The crest of the flux trace, peak over mean, does not
 * move with the frame rate but barely moves with the music either, 0.68 to
 * 0.71 for clipped kicks against 0.67 to 0.73 for soft pulses, because the
 * flux is a rise in log magnitude and the loudest part of any attack in log
 * terms is the quiet beginning of it, whatever shape the rest has. Spectral
 * flatness proper, the geometric mean of the spectrum over its arithmetic
 * mean, needs a floor under the geometric mean, and with the -60 dB floor
 * the rest of this file uses nearly every bin at fftSize 4096 is under it:
 * it read 0.65 for the clipped kicks and 0.84 for the soft pulses, which is
 * both saturated and the wrong way round. Counting the share of the window
 * within a tenth of the peak, rather than taking the mean over the peak,
 * quantises: a tenth of a second at 60 frames a second is six samples, and
 * one of them was two thirds of the range the share was mapped over, which
 * put hardstyle 0.12 apart between 60 and 144. The spread read at the frame
 * the detector fired on moved for the same reason the attack time did, so it
 * is taken over the window instead, where the frame the hit most fills is
 * the same frame at any rate.
 *
 * The mean is kept as a decayed sum over a decayed count, which is what makes
 * it slow and what makes it hold: a frame with nothing in it steps neither,
 * so the ratio is exactly where the last sound left it, the way `weight`
 * holds its centroid. A neutral 0.5 is carried as a prior worth a few hits
 * rather than as a value held until a threshold, so the measure leaves the
 * middle as fast as the evidence arrives and never steps. Neutral rather than
 * 0 because a track that has not been heard yet is not a soft track, and 0.5
 * is where a scene would put an unknown.
 */
export class Hardness {
  /** Scores of the hits heard, and how many, both decayed over the window. */
  private sum = 0
  private evidence = 0
  private sinceHit = Infinity
  /**
   * The quietest the mix has been lately: it falls to the level at once and
   * creeps back up, so between hits it settles on whatever is playing under
   * them. That is the bed a hit has to lift the mix above.
   */
  private readonly floor = new Envelope(HARDNESS_FLOOR_MS, 0)
  /** The open hit's window: the rise above the bed, and each frame's step. */
  private readonly rises = new Float32Array(HARDNESS_WINDOW_CAPACITY)
  private readonly steps = new Float32Array(HARDNESS_WINDOW_CAPACITY)
  private frames = 0
  private base = 0
  private peak = 0
  private peakRise = 0
  private elapsed = 0
  private spread = 0
  private open = false
  /**
   * How audible the hit whose window closed on the last step was, 0 to 1, and
   * 0 on every other step. `pace` counts hits from here, so that a hit is one
   * hit however many bands it tripped and however many frames they were
   * spread over.
   */
  settled = 0

  /**
   * `loudness` is the raw RMS across the span, the same one `swell` reads,
   * and `spread` is how much of the spectrum this frame's power covers.
   */
  step(hit: boolean, loudness: number, spread: number, dt: number): number {
    this.settled = 0
    // Nothing in the frame and no hit being measured: the mean is left
    // exactly where the last sound put it.
    if (loudness <= 0 && !hit && !this.open) return this.value()
    const keep = Math.exp(-dt / HARDNESS_SECONDS)
    this.sum *= keep
    this.evidence *= keep
    const floor = this.floor.step(loudness, dt)
    if (this.open) {
      if (this.elapsed >= HARDNESS_TAIL_SECONDS) this.close()
      else this.add(loudness, spread, dt)
    }

    if (hit) this.sinceHit = 0
    else {
      this.sinceHit += dt
      // Softness is only evidence when there is something to hear: under the
      // quiet floor there is no telling a pad from a room.
      if (loudness >= QUIET && this.sinceHit >= HARDNESS_GAP_SECONDS)
        this.evidence += HARDNESS_SOFT_PER_SECOND * dt
    }

    // A hit that lands while a window is open belongs to that window rather
    // than starting one of its own.
    if (hit && !this.open) {
      this.open = true
      this.frames = 0
      this.base = floor
      this.peak = 0
      this.peakRise = 0
      this.spread = 0
      this.elapsed = 0
      this.add(loudness, spread, dt)
    }

    return this.value()
  }

  private value() {
    return clamp01(
      (this.sum + HARDNESS_NEUTRAL * HARDNESS_PRIOR) / (this.evidence + HARDNESS_PRIOR),
    )
  }

  private add(loudness: number, spread: number, dt: number) {
    const rise = Math.max(0, loudness - this.base)
    if (this.frames < HARDNESS_WINDOW_CAPACITY) {
      this.rises[this.frames] = rise
      this.steps[this.frames] = dt
      this.frames++
    }

    this.peak = Math.max(this.peak, loudness)
    this.peakRise = Math.max(this.peakRise, rise)
    this.spread = Math.max(this.spread, spread)
    this.elapsed += dt
  }

  /** Score the hit whose window has just ended, and fold it into the mean. */
  private close() {
    this.open = false
    if (this.peak <= 0 || this.peakRise <= 0) return
    const presence = clamp01((this.peakRise / this.peak - LIFT_BURIED) / (LIFT_CLEAR - LIFT_BURIED))
    this.settled = presence
    if (this.frames < HARDNESS_MIN_FRAMES) return
    // Weighted by time and not by frame, so the window reads the same at any
    // frame rate.
    let held = 0
    let total = 0
    for (let at = 0; at < this.frames; at++) {
      const step = this.steps[at] ?? 0
      total += step
      held += step * (this.rises[at] ?? 0)
    }

    if (total <= 0) return
    const hold = clamp01((held / total / this.peakRise - HOLD_SOFT) / (HOLD_HARD - HOLD_SOFT))
    const spread = clamp01(
      Math.log(Math.max(this.spread, 1e-9) / SPREAD_TONAL) / Math.log(SPREAD_BROAD / SPREAD_TONAL),
    )
    // A geometric mean rather than an average: a hit has to both hold and
    // fill the spectrum to be a hard one, and either alone is a hat or a
    // swell. The hit still counts as evidence whatever it scores, so a track
    // whose hits are all soft reads soft rather than reading unknown.
    this.sum += presence * Math.sqrt(hold * spread)
    this.evidence += 1
  }
}

/** What kind of track this is, and where in it we are. */
export type Character = {
  /** Audible hits a second, decayed over half a minute and scaled. */
  pace: number
  /** Loudness now against loudness over half a minute, in dB. 0.5 is steady. */
  swell: number
  /** Where the spectral centroid sits. 1 is a bass-led track, 0 a bright sparse one. */
  weight: number
  /** The BPM guess across 60 to 200, smoothed so it ramps rather than steps. */
  tempo: number
  /** How abrupt and how saturated this track's hits are. 0.5 before any. */
  hardness: number
}

/** What one frame hands the song: the whole-spectrum numbers it is summarised by. */
export type Frame = {
  onset: boolean
  /** The raw RMS across the whole span, not the packet's normalised `energy`. */
  loudness: number
  /**
   * The spectral centroid, already mapped so 0 is the low group's flat
   * centroid and 1 the high group's; NaN on a frame with nothing in it.
   */
  brightness: number
  bpm: number
  /**
   * How much of the spectrum this frame's power is spread across: the mean
   * magnitude squared over the mean square, 1 for a flat spectrum and one
   * over the bin count for a single partial.
   */
  spread: number
}

/**
 * The song rather than the frame. Everything else in this file answers what
 * the music is doing in the last few milliseconds; this answers what kind of
 * track it is and whether this passage is lifting or dropping, so a scene can
 * be calm through a ballad and busy through drum and bass without a preset
 * being swapped.
 *
 * All five are slow on purpose. The point is a number that has made up its
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
  private readonly brightness = new Envelope(WEIGHT_MS, WEIGHT_MS)
  private brightnessSeen = false
  private readonly ramp = new Envelope(TEMPO_RAMP_MS, TEMPO_RAMP_MS)
  private readonly hardness = new Hardness()
  private elapsed = 0

  /**
   * `loudness` is the raw RMS, deliberately not the packet's `energy`: that
   * one is divided by its own recent peak, so it reads about 1 through any
   * steady passage however loud, and a feature built on it could never see a
   * chorus coming. `brightness` is the centroid of the raw power, not of the
   * normalised levels, for the same reason: two bands that both have content
   * both normalise toward 1, and a balance read from them sat at 0.5 for
   * anything with a kick and a hat in it.
   */
  step(frame: Frame, dt: number): Character {
    const { onset, loudness, brightness, bpm, spread } = frame
    this.elapsed += dt

    // Hardness reads the raw RMS for the same reason swell does, and because
    // a hit's window is judged against its own peak rather than against any
    // fixed level.
    const hardness = this.hardness.step(onset, loudness, spread, dt)
    // Pace counts the hits the hardness windows close, not the frames the
    // detectors fired on. It counted frames once, and one struck sound trips
    // several bands at once, the sub band trailing the rest by about 70 ms, so
    // a kick was one count when those onsets shared a frame and two or three
    // when they did not. A faster display splits the same kick over more
    // frames: the same 25 seconds of hardstyle read 0.24 at 60 frames a second
    // and 0.38 at 144, though each band fired on the same 62 kicks at both.
    // The detectors were not the cause and the decay was not either: a decayed
    // count of the same hits is the same count at any rate. A window is a span
    // of time, so a hit is one hit at any rate.
    //
    // Each hit counts for how far it stands above what is under it. A quiet
    // hat over a pad is a hat nobody hears, and counting it as much as a kick
    // read a lo-fi track at 80 BPM as twice as busy as hardstyle at 150, since
    // the detectors hear the sparse quiet hats and not the dense loud ones.
    //
    // A decayed count rather than a rate measured between hits: it needs no
    // memory of when the last one was and it cannot spike on one close pair.
    this.paceCount = this.paceCount * Math.exp(-dt / PACE_SECONDS) + this.hardness.settled

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
    const swell =
      long > 1e-9 ? clamp01(0.5 + (decibels(short) - decibels(long)) / (2 * SWELL_RANGE_DB)) : 0.5

    // The centroid is only smoothed on frames that have one. Silence holds
    // whatever the last passage was, and the first frame with anything in it
    // is taken outright rather than ramped up to from the middle.
    if (Number.isFinite(brightness)) {
      if (this.brightnessSeen) this.brightness.step(brightness, dt)
      else {
        this.brightness.value = brightness
        this.brightnessSeen = true
      }
    }

    const weight = this.brightnessSeen ? 1 - this.brightness.value : 0.5

    // A bpm of 0 means the tracker has not settled; hold the ramp where it
    // is rather than dragging the scene down to nothing.
    const target = bpm > 0 ? clamp01((bpm - TEMPO_MIN_BPM) / (TEMPO_MAX_BPM - TEMPO_MIN_BPM)) : null
    const tempo = target === null ? this.ramp.value : this.ramp.step(target, dt)

    return {
      pace: clamp01(this.paceCount / PACE_SECONDS / PACE_FULL),
      swell,
      weight,
      tempo,
      hardness,
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
  /** Where that rise sat across the spectrum, and how wide it was. */
  private readonly bandCentre: Float32Array
  private readonly bandWidth: Float32Array
  /** Each bin's place across the span, 0 at 20 Hz to 1 at 16 kHz, by octave. */
  private readonly octaves: Float32Array
  /** Each band's own middle on the same scale, for a frame with no rise. */
  private readonly bandMiddle: Float32Array
  /** log2 of each bin's centre frequency, for the centroid `weight` reads. */
  private readonly logFrequencies: Float32Array
  /** The song-scale features, one step a frame off what the rest works out. */
  private readonly song = new Song()
  private readonly harmony = new Harmony()
  private readonly structure = new Structure()
  /** The tempo and the beat, off the bands' own flux. */
  private readonly tempo: TempoTracker
  private readonly binHz: number
  /** The bins the chroma reads peaks between, inclusive. */
  private readonly chromaLow: number
  private readonly chromaHigh: number
  private time = 0

  constructor(options: FeatureOptions) {
    this.bands = options.bands ?? DEFAULT_BANDS
    this.bins = options.fftSize / 2
    this.filters = this.bands.map((band) =>
      bandFilter(band.low, band.high, options.fftSize, options.sampleRate),
    )
    this.span = bandFilter(20, 16000, options.fftSize, options.sampleRate)
    this.binHz = options.sampleRate / options.fftSize
    this.chromaLow = Math.max(1, Math.ceil(CHROMA_LOW_HZ / this.binHz))
    this.chromaHigh = Math.min(this.bins - 2, Math.floor(CHROMA_HIGH_HZ / this.binHz))
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
    this.bandCentre = new Float32Array(this.bands.length)
    this.bandWidth = new Float32Array(this.bands.length)
    const place = (hz: number) =>
      clamp01(Math.log2(Math.max(hz, SPAN_LOW_HZ) / SPAN_LOW_HZ) / SPAN_OCTAVES)
    this.octaves = new Float32Array(this.bins)
    for (let bin = 0; bin < this.bins; bin++) this.octaves[bin] = place(bin * this.binHz)
    this.bandMiddle = new Float32Array(
      this.bands.map((band) => place(Math.sqrt(band.low * band.high))),
    )
    this.bandCentre.set(this.bandMiddle)
    this.logFrequencies = new Float32Array(this.bins)
    // Bin 0 is DC and outside every band; it gets a finite number so a stray
    // weight on it cannot poison the centroid.
    for (let bin = 0; bin < this.bins; bin++)
      this.logFrequencies[bin] = Math.log2(Math.max(bin, 0.5) * this.binHz)
    this.tempo = new TempoTracker(this.bands.length)
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
      // The rise's first and second moments across the span, so a hit can
      // say where it landed and how wide it was.
      let risePlace = 0
      let riseSpread = 0
      for (let index = 0; index < weights.length; index++) {
        const weight = weights[index] ?? 0
        if (weight === 0) continue
        const bin = start + index
        const magnitude = magnitudes[bin] ?? 0
        squares += weight * magnitude * magnitude
        const rise = (logs[bin] ?? 0) - (previousLogs[bin] ?? 0)
        if (rise > 0) {
          const weighted = weight * rise
          const place = this.octaves[bin] ?? 0
          rises += weighted
          risePlace += weighted * place
          riseSpread += weighted * place * place
        }
      }

      if (rises > 0) {
        const centre = risePlace / rises
        this.bandCentre[band] = centre
        this.bandWidth[band] = Math.sqrt(Math.max(0, riseSpread / rises - centre * centre))
      }
      // The root mean square, which is what the energy in a band is; the mean
      // of the magnitudes would divide one bright partial by the whole band.
      const level = Math.sqrt(squares / total)
      const envelope = this.envelopes[band]?.step(level, dt) ?? 0
      const peak = this.peaks[band]?.step(level, dt) ?? QUIET
      packet[band] = clamp01(envelope / peak)
      this.bandFlux[band] = rises / total
    }

    // The whole span in one pass: its power, its flux, and where its power
    // sits on a log-frequency axis, which is the centroid `weight` reads.
    const { start, weights, total } = this.span
    let squares = 0
    let flux = 0
    let centroid = 0
    // The mean magnitude, for the spread the hardness of a hit is read from;
    // gathered here because the pass is already running.
    let sum = 0
    for (let index = 0; index < weights.length; index++) {
      const weight = weights[index] ?? 0
      if (weight === 0) continue
      const bin = start + index
      const magnitude = magnitudes[bin] ?? 0
      const power = weight * magnitude * magnitude
      squares += power
      centroid += power * (this.logFrequencies[bin] ?? 0)
      sum += weight * magnitude
      const rise = (logs[bin] ?? 0) - (previousLogs[bin] ?? 0)
      if (rise > 0) flux += weight * rise
    }
    this.remember(logs, now)
    const rms = Math.sqrt(squares / total)
    // Below the quiet floor there is nothing to take the centroid of; the
    // song holds its last reading rather than reading noise.
    const brightness =
      rms >= QUIET
        ? clamp01(
            (centroid / squares - LOW_GROUP_CENTROID) / (HIGH_GROUP_CENTROID - LOW_GROUP_CENTROID),
          )
        : NaN
    // How much of the spectrum the power is spread across: the mean magnitude
    // squared over the mean square, which is the share of the bins a flat
    // spectrum of this shape would need. A ratio of magnitudes to magnitudes,
    // so it says nothing about how loud the frame was.
    const spread = squares > 0 ? (sum * sum) / (total * squares) : 0

    // The chroma, from the peaks of the log spectrum. A peak's frequency is
    // refined between bins with a parabola through its neighbours, since a
    // bin is wider than a semitone below about 200 Hz.
    for (let bin = this.chromaLow; bin <= this.chromaHigh; bin++) {
      const centre = logs[bin] ?? 0
      if (centre < CHROMA_FLOOR) continue
      const left = logs[bin - 1] ?? 0
      const right = logs[bin + 1] ?? 0
      if (centre <= left || centre < right) continue
      const curve = left - 2 * centre + right
      const offset = curve < 0 ? (0.5 * (left - right)) / curve : 0
      this.harmony.add((bin + offset) * this.binHz, centre)
    }
    packet[F.energy] = clamp01(this.energyEnvelope.step(rms, dt) / this.energyPeak.step(rms, dt))

    // Each band against its own history. A band that is always busy settles on
    // a high threshold and a quiet one on a low threshold, which is what lets
    // the hats keep firing through a passage the kick is sitting out.
    let anyBand = false
    for (let band = 0; band < this.bands.length; band++) {
      const found = this.detectors[band]?.step(this.bandFlux[band] ?? 0, dt)
      packet[BAND_HIT + band] = found?.strength ?? 0
      packet[BAND_PULSE + band] = found?.pulse ?? 0
      packet[BAND_HIT_CENTRE + band] = this.bandCentre[band] ?? 0
      packet[BAND_HIT_WIDTH + band] = this.bandWidth[band] ?? 0
      anyBand ||= found?.onset ?? false
    }

    const whole = this.detector.step(flux / total, dt)
    packet[F.flux] = whole.flux
    packet[F.fluxThreshold] = whole.threshold
    packet[F.onset] = whole.onset ? 1 : 0
    packet[F.onsetStrength] = whole.strength
    packet[F.beatPulse] = whole.pulse

    // The tempo reads each band's own rise rather than the whole spectrum's,
    // for the reason pace does below: a kick that lives in three sub bins
    // barely moves the flux of the whole spectrum, and the beat in most music
    // is the kick and the snare taking turns.
    const beat = this.tempo.step(this.bandFlux, dt)
    packet[F.tempoBpm] = beat.bpm
    packet[F.tempoConfidence] = beat.confidence
    packet[F.beatPhase] = beat.phase

    // Pace counts a hit in any band, since a kick that lives in three sub
    // bins barely moves the flux of the whole spectrum; the global detector
    // is for broadband hits and the beat pulse the post stack reads.
    const song = this.song.step(
      { onset: anyBand || whole.onset, loudness: rms, brightness, bpm: beat.bpm, spread },
      dt,
    )
    packet[F.pace] = song.pace
    packet[F.swell] = song.swell
    packet[F.weight] = song.weight
    packet[F.tempo] = song.tempo
    packet[F.hardness] = song.hardness

    const harmony = this.harmony.step(dt)
    packet[F.keyHue] = harmony.keyHue
    packet[F.keyClarity] = harmony.keyClarity
    packet[F.harmonicChange] = harmony.harmonicChange

    const structure = this.structure.step(packet, this.harmony.chroma, dt)
    packet[F.recall] = structure.recall
    packet[F.novelty] = structure.novelty
    packet[F.section] = structure.section

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
}
