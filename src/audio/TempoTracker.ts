/**
 * The tempo, the beat and how sure of both it is, from the five bands' onset
 * envelopes. Pure TypeScript, no DOM, fed once a frame by the extractor.
 *
 * What it replaces read the autocorrelation of the whole spectrum's flux over
 * the last 480 frames, and the README measured it: right on two tracks about
 * six times in ten, and two thirds of the truth on both drum and bass tracks,
 * whose dotted-quarter drum pattern correlates better than their beat. Three
 * things here answer that.
 *
 * - Each band's envelope is put over its own mean before the five are summed
 *   and the sum correlated. The whole spectrum's flux was really the
 *   treble's, since a thousand of its bins are treble and four are sub, so a
 *   kick barely registered and what it measured was the snare and the hats.
 *   Here a kick counts as much as a hat, which matters because the beat in
 *   most music is not in any one band: it is the kick and the snare taking
 *   turns, and the sum is what sees them as one pulse. Each band's own
 *   correlation is still measured, to earn it a weight in the sum, so a pad
 *   with nothing periodic in it says nothing.
 * - The envelopes are resampled to a fixed 100 Hz, so the window is eight
 *   seconds at any frame rate and a lag means the same thing on every
 *   machine; and the window is eight seconds rather than five, with every
 *   lag out to four times the slowest measured, so a beat's half-bar and bar
 *   are always there to vouch for it. Before, nothing below 120 BPM had a
 *   harmonic to its name, since the correlations stopped at the 60 BPM lag,
 *   and a dotted figure could outscore the beat with nothing to say it was
 *   no level of the metre.
 * - The peak is interpolated. At 60 frames a second the lags around 140 BPM
 *   are 5 BPM apart and a reading could only ever be one of them; a parabola
 *   through the three around the peak puts it within a fraction of one.
 *
 * It also says where in the beat we are, which the autocorrelation alone
 * never could. A pulse train at the chosen period is laid over the last few
 * seconds and slid to where the onsets are, and the phase then runs forward
 * on its own between estimates, so a scene can anticipate the next beat
 * rather than react to the last one.
 *
 * And where in the bar. The beat phase is counted in fours, and which of the
 * four is the downbeat is decided by the low end: the sub and bass flux of
 * each beat is gathered under its place in the four, as a slow average over
 * about four bars, and the loudest place wins. A margin keeps the incumbent
 * whenever the two are close, because a hop slides the whole bar and is worse
 * than being a beat out, and until two bars have been heard the answer is the
 * first beat counted, which is plain four-beat counting.
 *
 * What that can see is the low end firing and not how hard it fires. The
 * band levels the flux is taken from are scaled by each band's own recent
 * peak, so among four kicks the loudest reads barely louder than the rest:
 * measured on a synthetic bar with the kick on the one at 0.9 and the others
 * at 0.4, the four places came out 0.44, 0.49, 0.51 and 0.34 and the estimate
 * stayed where the counting had put it. Where the low end lands on the one
 * and the snares carry the rest, which is most of the music this is for, they
 * came out 0.27, 0.36, 0.48 and 0.24 and the one was found. Four to the
 * floor has the same kick on every beat and there is nothing there to find,
 * so it keeps the counting, which is the right answer as far as it goes: the
 * bar is four beats long and wraps once through them, and only which of the
 * four is the one is a guess. `synthetic.test.ts` holds both cases.
 *
 * A phase is a prediction and this one is a prediction built on another, so
 * `confidence` is the number to gate it with, exactly as for the beat phase.
 * Nothing here reports a confidence of its own, because a bar read off a
 * wrong tempo is wrong for the same reason and by the same amount.
 */

/** The envelopes are resampled to this many samples a second. */
export const ENVELOPE_RATE = 100
export const TEMPO_MIN_BPM = 60
export const TEMPO_MAX_BPM = 200

const TICK = 1 / ENVELOPE_RATE
// Eight seconds is about four bars at 120 BPM: long enough for a bar-length
// figure to repeat a few times, short enough to follow a change of section.
const WINDOW = 8 * ENVELOPE_RATE
// The first reading comes at four seconds, from the part of the window that
// has filled, rather than waiting the whole eight in silence.
const FIRST = 4 * ENVELOPE_RATE
const EVERY = Math.round(0.5 * ENVELOPE_RATE)
const MIN_LAG = Math.floor((60 * ENVELOPE_RATE) / TEMPO_MAX_BPM)
const MAX_LAG = Math.ceil((60 * ENVELOPE_RATE) / TEMPO_MIN_BPM)
// A lag is only measured against this much overlap; fewer samples and the
// correlation is noise that can outscore a real peak.
const MIN_OVERLAP = 2 * ENVELOPE_RATE
// A beat's half-bar and bar agree with it, so each lag is scored with its
// double and quadruple added in. Whichever of these the window cannot yet
// reach is left out of the score's weight rather than counted as nothing,
// so a slow tempo is not penalised for having harmonics the window is too
// short to see.
const HARMONICS: readonly (readonly [number, number])[] = [
  [2, 0.5],
  [4, 0.25],
]
const PREFERRED_BPM = 120
// Width of the preference, in octaves: 60 and 240 score about half of 120.
const PREFERENCE_OCTAVES = 0.9
// Flux over its mean, compressed: a few huge hits would otherwise own the
// correlation and the beats between them would not register.
const COMPRESSION = 3
// Below this correlation nothing is periodic enough to call. The best of
// seventy lags of noise reaches about 0.1 on an eight second window, and a
// reading off that would be a random tempo with a tenth of confidence.
const MIN_CORRELATION = 0.15
// When the half lag correlates at least this well it wins: a half-time
// backbeat correlates as well at the bar as at the beat, and the faster of
// the two is what people tap.
const HALF_LAG_RATIO = 0.6
// One reading every half second can still jump for a bar; the median of the
// last few holds the tempo steady through it.
const MEDIAN_OF = 5
// A period an octave from the one reported has to outscore it by this much
// to take over. The beat and its half-bar often score within a few percent
// of each other, and a reading that flipped between them every few seconds
// would turn the phase ramp into a lurch; a lag that is not an octave of the
// incumbent is under no such handicap, so a real change of tempo still lands.
const OCTAVE_HYSTERESIS = 1.15
const OCTAVE_TOLERANCE = 0.04
// The phase is read off the last few beats only. A period off by one percent
// drifts 80 ms across eight seconds and 40 across four.
const PHASE_SPAN = 4 * ENVELOPE_RATE
// How far the running phase moves toward each new measurement. The first
// measurement is taken outright; after that a step is a nudge, so a reading
// off by a fraction of a beat turns the ramp rather than snapping it.
const PHASE_PULL = 0.35
/** Beats in a bar. Four, and nothing here tries to read any other metre. */
export const BAR_BEATS = 4
// How much of each bar's low end is kept: a quarter, so the average is about
// four bars of memory. Long enough that one loud snare cannot own it, short
// enough to follow a track that changes its pattern.
const DOWNBEAT_PULL = 0.25
// How much louder a place has to be than the one holding the downbeat before
// it takes over. The kick on the one usually wins by a mile; a margin is for
// the tracks where two places are close, where hopping between them would
// slide the whole bar back and forth.
const DOWNBEAT_MARGIN = 1.2
// Bars to hear before the low end is allowed an opinion at all. Under this
// the downbeat is the first beat counted, which is four-beat counting from
// the first beat the tracker was sure of.
const DOWNBEAT_BARS = 2

export type Beat = {
  /** Beats per minute, 0 until a period has clearly won. */
  bpm: number
  /** How well the chosen period correlates, 0 to 1, averaged over the recent readings. */
  confidence: number
  /** Where in the beat we are: 0 on the beat, rising to 1 just before the next. */
  phase: number
  /** Where in the bar we are: 0 on the downbeat, rising to 1 across four beats. */
  barPhase: number
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)
const bpmOf = (lag: number) => (60 * ENVELOPE_RATE) / lag

/**
 * Where the true peak sits between the three samples around the highest one,
 * as a fraction of a sample either side. Zero when the samples are not a peak.
 */
export function parabolicOffset(values: Float32Array, at: number, low: number, high: number) {
  if (at <= low || at >= high) return 0
  const a = values[at - 1] ?? 0
  const b = values[at] ?? 0
  const c = values[at + 1] ?? 0
  const curvature = a - 2 * b + c
  if (curvature >= 0) return 0
  return Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curvature))
}

export class TempoTracker {
  private readonly bands: number
  /** One ring of envelope samples per band. */
  private readonly rings: Float32Array[]
  /** The part of the current tick each band has accumulated so far. */
  private readonly pending: Float32Array
  private at = 0
  private filled = 0
  /** Seconds into the tick being accumulated. */
  private cursor = 0
  private sinceEstimate = 0
  private readonly readings = new Float32Array(MEDIAN_OF)
  private readonly confidences = new Float32Array(MEDIAN_OF)
  private readingAt = 0
  /** Readings made on a full window, until there are enough to trust the octave. */
  private fullReadings = 0
  private bpm = 0
  /** The last tempo that won, kept so the phase runs on through a bar of doubt. */
  private lastBpm = 0
  private confidence = 0
  private phase = 0
  private phaseKnown = false
  /** Which of the four beats of the bar is in progress, counted from 0. */
  private beatIndex = 0
  /** Which of the four the downbeat is, 0 until the low end has an opinion. */
  private downbeat = 0
  /** Bars counted since the phase was found, so the opinion can wait for a few. */
  private barsHeard = 0
  /** The low end gathered under each of the four places, as a slow average. */
  private readonly lowAt = new Float32Array(BAR_BEATS)
  /**
   * The low end of the beat in progress, time weighted, and the seconds it has
   * run for. Time weighted because the flux is a level that holds for as long
   * as the lag it is measured over and not an amount belonging to the frame.
   */
  private beatLow = 0
  private beatSeconds = 0
  private readonly prior = new Float32Array(MAX_LAG + 1)
  // Scratch for an estimate, allocated once. `series` is each band's window
  // unrolled oldest first, compressed and mean-removed; `summed` the bands
  // added with their weights; `combined` its autocorrelation by lag.
  private readonly series: Float32Array[]
  private readonly weights: Float32Array
  private readonly summed = new Float32Array(WINDOW)
  private readonly combined = new Float32Array(4 * MAX_LAG + 1)
  private readonly score = new Float32Array(MAX_LAG + 1)

  constructor(bands: number) {
    this.bands = bands
    this.rings = Array.from({ length: bands }, () => new Float32Array(WINDOW))
    this.pending = new Float32Array(bands)
    this.series = Array.from({ length: bands }, () => new Float32Array(WINDOW))
    this.weights = new Float32Array(bands)
    for (let lag = MIN_LAG; lag <= MAX_LAG; lag++)
      this.prior[lag] = Math.exp(
        -0.5 * (Math.log2(bpmOf(lag) / PREFERRED_BPM) / PREFERENCE_OCTAVES) ** 2,
      )
  }

  /**
   * One frame: each band's raw half-wave rectified rise over the last 30 ms,
   * and the seconds the frame covered. The rise is a level that holds for as
   * long as the lag it is measured over, not an amount that belongs to the
   * frame, so each tick takes the average of the frames that overlap it,
   * weighted by how much of the tick each covered: a hit is a plateau of the
   * same height and length in the envelope at 120 frames a second as at 30.
   */
  step(flux: Float32Array, dt: number): Beat {
    const step = dt > 0 ? dt : 0
    let remaining = step
    while (remaining > 0) {
      const take = Math.min(TICK - this.cursor, remaining)
      const share = take / TICK
      for (let band = 0; band < this.bands; band++)
        this.pending[band] = (this.pending[band] ?? 0) + (flux[band] ?? 0) * share
      this.cursor += take
      remaining -= take
      if (this.cursor >= TICK - 1e-9) {
        this.emit()
        this.cursor = 0
      }
    }

    // The phase runs forward on the tempo between estimates, and on the last
    // tempo that won while the reading is 0, since a ramp that carries on
    // through a bar of doubt is less jarring than one that stalls.
    //
    // The frame is walked to each beat boundary it crosses rather than
    // advanced whole, so the low end it carries is split between the beat
    // that ended and the one that began. A frame is a twentieth of a beat at
    // 60 a second and a tenth at 30, and giving the whole of it to one side
    // put the kick in the wrong place of the bar at the lower rate. The count
    // is taken here rather than from the phase falling, because `locate`
    // nudges the phase and a nudge across the wrap is not a beat.
    const bpm = this.bpm || this.lastBpm
    const low = (flux[0] ?? 0) + (flux[1] ?? 0)
    if (bpm <= 0) {
      this.beatLow += low * step
      this.beatSeconds += step
    } else {
      const perBeat = 60 / bpm
      let left = step
      // A frame longer than a bar is a stall or a tab coming back, and where
      // in the bar it lands is a guess either way; the guard keeps the walk
      // bounded and the wrap below tidies up whatever is left.
      for (let crossed = 0; crossed < BAR_BEATS; crossed++) {
        const toBoundary = (1 - this.phase) * perBeat
        if (toBoundary > left) break
        this.beatLow += low * toBoundary
        this.beatSeconds += toBoundary
        left -= toBoundary
        this.phase = 0
        this.crossBeat()
      }

      this.beatLow += low * left
      this.beatSeconds += left
      this.phase += left / perBeat
      if (this.phase >= 1) this.phase -= Math.floor(this.phase)
    }

    return {
      bpm: this.bpm,
      confidence: this.confidence,
      phase: this.phaseKnown ? this.phase : 0,
      barPhase: this.phaseKnown ? this.barPhase() : 0,
    }
  }

  /**
   * A beat has gone by: what its low end came to is folded into the average
   * for its place in the bar, the count moves on, and the downbeat is chosen
   * again. The kick on the one is what this is looking for, and it is the one
   * thing about the metre that four bands can see without knowing the music.
   */
  private crossBeat() {
    const mean = this.beatSeconds > 0 ? this.beatLow / this.beatSeconds : 0
    this.beatLow = 0
    this.beatSeconds = 0
    const place = this.beatIndex
    this.lowAt[place] = (this.lowAt[place] ?? 0) * (1 - DOWNBEAT_PULL) + mean * DOWNBEAT_PULL
    this.beatIndex = (place + 1) % BAR_BEATS
    if (this.beatIndex === 0) this.barsHeard++
    this.chooseDownbeat()
  }

  /**
   * The loudest of the four places, once enough bars have been heard, and
   * only if it beats the place holding the downbeat by the margin. A hop
   * slides the whole bar and is worse than being a beat out, so the incumbent
   * keeps it whenever the two are close.
   */
  private chooseDownbeat() {
    if (this.barsHeard < DOWNBEAT_BARS) return
    let best = this.downbeat
    let top = 0
    for (let place = 0; place < BAR_BEATS; place++) {
      const low = this.lowAt[place] ?? 0
      if (low > top) {
        top = low
        best = place
      }
    }

    const held = this.lowAt[this.downbeat] ?? 0
    if (best !== this.downbeat && top > held * DOWNBEAT_MARGIN) this.downbeat = best
  }

  /** Where in the bar the beat in progress is, 0 on the downbeat. */
  private barPhase() {
    const place = (this.beatIndex - this.downbeat + BAR_BEATS) % BAR_BEATS
    return (place + this.phase) / BAR_BEATS
  }

  private emit() {
    for (let band = 0; band < this.bands; band++) {
      const ring = this.rings[band]
      if (ring) ring[this.at] = this.pending[band] ?? 0
    }

    this.pending.fill(0)
    this.at = (this.at + 1) % WINDOW
    this.filled = Math.min(WINDOW, this.filled + 1)
    this.sinceEstimate++
    if (this.filled >= FIRST && this.sinceEstimate >= EVERY) {
      this.sinceEstimate = 0
      this.estimate()
    }
  }

  /**
   * The normalised autocorrelation of a zero-mean series at one lag: how
   * alike the series is to itself shifted, 1 for identical and 0 for
   * unrelated, over the samples the two copies share.
   */
  private static correlation(x: Float32Array, length: number, lag: number, variance: number) {
    let sum = 0
    for (let i = lag; i < length; i++) sum += (x[i] ?? 0) * (x[i - lag] ?? 0)
    return sum / ((length - lag) * variance)
  }

  /**
   * Each band's window on its own: over its mean, compressed, mean removed,
   * then correlated with itself across the tempo range to find out how
   * periodic it is, which is its weight in the sum. Then the sum, correlated
   * at every lag the window can support, into `combined`. Returns the
   * weights' total, 0 when no band had anything periodic in it.
   */
  private correlate(length: number, top: number): number {
    const start = (this.at - length + WINDOW) % WINDOW
    let weightSum = 0
    for (let band = 0; band < this.bands; band++) {
      const ring = this.rings[band]
      const x = this.series[band]
      this.weights[band] = 0
      if (!ring || !x) continue
      let mean = 0
      for (let i = 0; i < length; i++) mean += ring[(start + i) % WINDOW] ?? 0
      mean /= length
      if (mean <= 0) continue
      let mu = 0
      for (let i = 0; i < length; i++) {
        const value = Math.log1p((COMPRESSION * (ring[(start + i) % WINDOW] ?? 0)) / mean)
        x[i] = value
        mu += value
      }

      mu /= length
      let variance = 0
      for (let i = 0; i < length; i++) {
        const value = (x[i] ?? 0) - mu
        x[i] = value
        variance += value * value
      }

      variance /= length
      if (variance <= 0) continue
      let peak = 0
      for (let lag = MIN_LAG; lag <= MAX_LAG; lag++)
        peak = Math.max(peak, TempoTracker.correlation(x, length, lag, variance))
      this.weights[band] = peak
      weightSum += peak
    }

    if (weightSum <= 0) return 0
    // The bands are zero-mean, so their weighted sum is too.
    const summed = this.summed
    let variance = 0
    for (let i = 0; i < length; i++) {
      let value = 0
      for (let band = 0; band < this.bands; band++)
        value += (this.weights[band] ?? 0) * (this.series[band]?.[i] ?? 0)
      value /= weightSum
      summed[i] = value
      variance += value * value
    }

    variance /= length
    if (variance <= 0) return 0
    for (let lag = MIN_LAG; lag <= top; lag++)
      this.combined[lag] = TempoTracker.correlation(summed, length, lag, variance)
    return weightSum
  }

  private estimate() {
    const length = this.filled
    if (length === WINDOW) this.fullReadings++
    const top = Math.min(4 * MAX_LAG, length - MIN_OVERLAP)
    const weightSum = this.correlate(length, top)
    if (weightSum <= 0) {
      this.report(0, 0)
      return
    }

    const combined = this.combined
    let best = 0
    let bestScore = -Infinity
    let total = 0
    for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
      let sum = combined[lag] ?? 0
      let weight = 1
      for (const [multiple, share] of HARMONICS) {
        if (multiple * lag > top) continue
        sum += share * (combined[multiple * lag] ?? 0)
        weight += share
      }

      const score = (sum / weight) * (this.prior[lag] ?? 0)
      this.score[lag] = score
      total += combined[lag] ?? 0
      if (score > bestScore) {
        bestScore = score
        best = lag
      }
    }

    const average = total / (MAX_LAG - MIN_LAG + 1)
    const raw = combined[best] ?? 0
    if (!best || raw < MIN_CORRELATION || raw < 3 * Math.max(average, 0)) {
      this.report(0, 0)
      return
    }

    const half = Math.round(best / 2)
    if (half >= MIN_LAG && (combined[half] ?? 0) >= HALF_LAG_RATIO * raw) best = half
    best = this.holdOctave(best)
    const lag = best + parabolicOffset(this.score, best, MIN_LAG, MAX_LAG)
    this.report(bpmOf(lag), clamp01(combined[best] ?? 0))
    this.locate(length)
  }

  /**
   * The incumbent's lag when the winner is an octave of it and has not beaten
   * it by the margin; otherwise the winner as it is. The incumbent only
   * counts once it is made entirely of readings on a full window: the early
   * ones come from a window too short to reach a slow tempo's bar, and they
   * lean to the half-bar, which the margin would then have locked in.
   */
  private holdOctave(best: number): number {
    if (this.bpm <= 0 || this.fullReadings <= MEDIAN_OF) return best
    const incumbent = Math.round((60 * ENVELOPE_RATE) / this.bpm)
    if (incumbent < MIN_LAG || incumbent > MAX_LAG) return best
    const octave = [0.5, 2].some(
      (ratio) => Math.abs(best / (incumbent * ratio) - 1) <= OCTAVE_TOLERANCE,
    )
    if (!octave) return best
    const held = this.score[incumbent] ?? 0
    return (this.score[best] ?? 0) >= OCTAVE_HYSTERESIS * held ? best : incumbent
  }

  private report(bpm: number, confidence: number) {
    this.readings[this.readingAt] = bpm
    this.confidences[this.readingAt] = confidence
    this.readingAt = (this.readingAt + 1) % MEDIAN_OF
    const sorted = Array.from(this.readings).sort((a, b) => a - b)
    this.bpm = sorted[MEDIAN_OF >> 1] ?? 0
    if (this.bpm > 0) this.lastBpm = this.bpm
    let sum = 0
    for (let i = 0; i < MEDIAN_OF; i++) sum += this.confidences[i] ?? 0
    this.confidence = sum / MEDIAN_OF
  }

  /**
   * Where the beat falls. A pulse train at the reported period is slid
   * across the last few seconds of the summed envelope, and the offset whose
   * pulses gather the most onset is how long ago the last beat was. Each
   * offset is scored by its mean rather than its sum, so one whose train
   * fits an extra pulse into the span is not favoured for it.
   */
  private locate(length: number) {
    if (this.bpm <= 0) return
    const period = (60 * ENVELOPE_RATE) / this.bpm
    const span = Math.min(length, PHASE_SPAN)
    const summed = this.summed
    let bestOffset = 0
    let bestValue = -Infinity
    const offsets = Math.ceil(period)
    for (let offset = 0; offset < offsets; offset++) {
      let sum = 0
      let count = 0
      for (let pulse = 0; ; pulse++) {
        const index = length - 1 - Math.round(offset + pulse * period)
        if (index < length - span) break
        sum += summed[index] ?? 0
        count++
      }

      const value = count ? sum / count : -Infinity
      if (value > bestValue) {
        bestValue = value
        bestOffset = offset
      }
    }

    const measured = (bestOffset / period) % 1
    if (!this.phaseKnown) {
      this.phase = measured
      this.phaseKnown = true
      // The bar is counted from here, which is the first beat the tracker was
      // sure of, and nothing is yet known about where the kick falls.
      this.beatIndex = 0
      this.downbeat = 0
      this.barsHeard = 0
      this.lowAt.fill(0)
      this.beatLow = 0
      this.beatSeconds = 0
      return
    }

    // The short way round the circle, so a beat measured just before the
    // running phase wraps pulls it back a little rather than round a whole
    // turn.
    let difference = measured - this.phase
    difference -= Math.round(difference)
    this.phase = (((this.phase + PHASE_PULL * difference) % 1) + 1) % 1
  }
}
