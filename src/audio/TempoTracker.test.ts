import { describe, expect, it } from 'vitest'

import { BAR_BEATS, ENVELOPE_RATE, parabolicOffset, TempoTracker } from './TempoTracker'

const BANDS = 5

/** Deterministic noise for the tests that need some. */
function random(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/**
 * Feed a tracker a train of hits placed in real time rather than by frame,
 * so the same music can be played through it at any frame rate: a frame
 * carries a hit when a beat boundary fell inside it. `gains` is each band's
 * share of a hit; a band at 0 is silent throughout.
 */
function play(
  tracker: TempoTracker,
  options: {
    bpm: number
    seconds: number
    /** Seconds per frame, or a function giving the next frame's step. */
    dt: number | (() => number)
    gains?: readonly number[]
    /** Called on every frame with what the tracker said and whether a hit landed. */
    onFrame?: (beat: ReturnType<TempoTracker['step']>, hit: boolean, time: number) => void
  },
) {
  const gains = options.gains ?? [1, 1, 1, 1, 1]
  const period = 60 / options.bpm
  const flux = new Float32Array(BANDS)
  let time = 0
  let nextHit = 0
  let last = tracker.step(flux, 0)
  while (time < options.seconds) {
    const dt = typeof options.dt === 'function' ? options.dt() : options.dt
    const hit = nextHit < time + dt
    for (let band = 0; band < BANDS; band++) flux[band] = hit ? (gains[band] ?? 0) : 0
    if (hit) nextHit += period
    time += dt
    last = tracker.step(flux, dt)
    options.onFrame?.(last, hit, time)
  }

  return last
}

describe('parabolicOffset', () => {
  it('puts a symmetric peak on its centre and leans toward the higher neighbour', () => {
    expect(parabolicOffset(new Float32Array([0, 1, 0]), 1, 0, 2)).toBeCloseTo(0)
    expect(parabolicOffset(new Float32Array([0.5, 1, 0]), 1, 0, 2)).toBeLessThan(0)
    expect(parabolicOffset(new Float32Array([0, 1, 0.5]), 1, 0, 2)).toBeGreaterThan(0)
  })

  it('stays within half a sample and gives nothing at the ends or off a peak', () => {
    expect(Math.abs(parabolicOffset(new Float32Array([0.99, 1, 0]), 1, 0, 2))).toBeLessThanOrEqual(
      0.5,
    )
    expect(parabolicOffset(new Float32Array([1, 0.5, 0]), 0, 0, 2)).toBe(0)
    expect(parabolicOffset(new Float32Array([0, 0.5, 1]), 2, 0, 2)).toBe(0)
    expect(parabolicOffset(new Float32Array([1, 0, 1]), 1, 0, 2)).toBe(0)
  })
})

describe('TempoTracker', () => {
  it('reads a click train to within half a beat per minute', () => {
    // 127 is chosen because no whole number of frames at 60 Hz means it: the
    // lags either side are 125 and 129.7, so getting within half a beat is
    // the interpolation working and not the grid happening to fit.
    const beat = play(new TempoTracker(BANDS), { bpm: 127, seconds: 20, dt: 1 / 60 })
    expect(beat.bpm).toBeGreaterThan(126.5)
    expect(beat.bpm).toBeLessThan(127.5)
    // The confidence is the correlation at the nearest whole lag, and 127 sits
    // between two, so even a perfect click train does not read 1 here.
    expect(beat.confidence).toBeGreaterThan(0.6)
  })

  it('reads the same tempo at any frame rate, steady or not', () => {
    const at60 = play(new TempoTracker(BANDS), { bpm: 127, seconds: 20, dt: 1 / 60 }).bpm
    const at144 = play(new TempoTracker(BANDS), { bpm: 127, seconds: 20, dt: 1 / 144 }).bpm
    const next = random(3)
    const jittered = play(new TempoTracker(BANDS), {
      bpm: 127,
      seconds: 20,
      dt: () => 1 / 50 + (next() * 1) / 100,
    }).bpm
    expect(Math.abs(at60 - at144)).toBeLessThan(0.5)
    expect(Math.abs(at60 - jittered)).toBeLessThan(0.5)
  })

  it('has a first reading inside five seconds', () => {
    let first = Infinity
    play(new TempoTracker(BANDS), {
      bpm: 120,
      seconds: 8,
      dt: 1 / 60,
      onFrame: (beat, _hit, time) => {
        if (beat.bpm > 0 && time < first) first = time
      },
    })
    expect(first).toBeLessThan(5)
  })

  it('reads a strong and soft alternation at the beat rather than the bar', () => {
    // The soft beat is a different band from the strong one, as a snare is
    // from a kick, so no single band is periodic at the beat; the bands
    // together are.
    const tracker = new TempoTracker(BANDS)
    const flux = new Float32Array(BANDS)
    let time = 0
    let next = 0
    let count = 0
    let beat = tracker.step(flux, 0)
    const dt = 1 / 60
    while (time < 20) {
      const hit = next < time + dt
      flux.fill(0)
      if (hit) {
        if (count % 2 === 0) flux[0] = flux[1] = 1
        else flux[2] = flux[3] = 1
        flux[4] = 0.5
        next += 60 / 140
        count++
      }

      time += dt
      beat = tracker.step(flux, dt)
    }

    expect(beat.bpm).toBeGreaterThan(139)
    expect(beat.bpm).toBeLessThan(141)
  })

  it('locks the phase to the beat and runs it forward between hits', () => {
    const phases: number[] = []
    const between: number[] = []
    play(new TempoTracker(BANDS), {
      bpm: 120,
      seconds: 20,
      dt: 1 / 60,
      onFrame: (beat, hit, time) => {
        if (time < 10 || beat.bpm === 0) return
        if (hit) phases.push(beat.phase)
        else between.push(beat.phase)
      },
    })
    expect(phases.length).toBeGreaterThan(10)
    // On the frame a hit lands the phase is at the start of a beat, within
    // the tick it was quantised to.
    for (const phase of phases) expect(Math.min(phase, 1 - phase)).toBeLessThan(0.1)
    // And it covers the whole beat in between, rather than sitting still.
    expect(Math.max(...between)).toBeGreaterThan(0.85)
  })

  it('carries the phase on through a passage with no tempo', () => {
    const tracker = new TempoTracker(BANDS)
    play(tracker, { bpm: 120, seconds: 12, dt: 1 / 60 })
    const flux = new Float32Array(BANDS)
    let moved = 0
    let last = tracker.step(flux, 1 / 60).phase
    for (let frame = 0; frame < 600; frame++) {
      const beat = tracker.step(flux, 1 / 60)
      if (beat.phase !== last) moved++
      last = beat.phase
    }

    expect(moved).toBeGreaterThan(500)
  })

  it('calls nothing on noise and nothing on silence', () => {
    const tracker = new TempoTracker(BANDS)
    const next = random(11)
    const flux = new Float32Array(BANDS)
    let called = 0
    let confidence = 0
    for (let frame = 0; frame < 1200; frame++) {
      for (let band = 0; band < BANDS; band++) flux[band] = next()
      const beat = tracker.step(flux, 1 / 60)
      if (beat.bpm > 0) called++
      confidence = Math.max(confidence, beat.confidence)
    }

    expect(called / 1200).toBeLessThan(0.1)
    expect(confidence).toBeLessThan(0.3)

    const silent = new TempoTracker(BANDS)
    flux.fill(0)
    let beat = silent.step(flux, 1 / 60)
    for (let frame = 0; frame < 1200; frame++) beat = silent.step(flux, 1 / 60)
    expect(beat.bpm).toBe(0)
    expect(beat.confidence).toBe(0)
    expect(beat.phase).toBe(0)
  })

  it('resamples a frame across the ticks it spans', () => {
    // A hit in one long frame and the same hit in several short ones should
    // read the same tempo: the envelope is time, not frames.
    const slow = play(new TempoTracker(BANDS), { bpm: 100, seconds: 20, dt: 1 / 25 }).bpm
    const fast = play(new TempoTracker(BANDS), { bpm: 100, seconds: 20, dt: 1 / 200 }).bpm
    expect(Math.abs(slow - 100)).toBeLessThan(1)
    expect(Math.abs(fast - 100)).toBeLessThan(1)
    expect(ENVELOPE_RATE).toBe(100)
  })
})

/**
 * The bar. Four beats counted off the beat phase, with the downbeat put where
 * the low end is loudest, so a row on `barPhase` changes once a bar and lands
 * on the one.
 */
describe('TempoTracker bars', () => {
  /**
   * The same train as `play`, with a gain per band that may differ from beat
   * to beat, which is what a kick on the one and a softer one elsewhere looks
   * like to five bands. Every frame is kept, with which beat of the train had
   * just landed, so a test can ask where the bar was when a particular hit
   * sounded.
   */
  function playBeats(
    tracker: TempoTracker,
    options: {
      bpm: number
      seconds: number
      dt: number
      gainsAt: (beat: number) => readonly number[]
    },
  ) {
    const period = 60 / options.bpm
    const flux = new Float32Array(BANDS)
    const frames: { time: number; hit: number; beat: ReturnType<TempoTracker['step']> }[] = []
    let time = 0
    let nextHit = 0
    let beat = 0
    while (time < options.seconds) {
      const hit = nextHit < time + options.dt
      const gains = hit ? options.gainsAt(beat) : undefined
      for (let band = 0; band < BANDS; band++) flux[band] = gains?.[band] ?? 0
      if (hit) {
        nextHit += period
        beat++
      }

      time += options.dt
      frames.push({ time, hit: hit ? beat - 1 : -1, beat: tracker.step(flux, options.dt) })
    }

    return frames
  }

  const EVEN = [1, 1, 1, 1, 1]
  /** A kick on the one: the low two bands three times as loud there. */
  const ACCENT = [3, 3, 1, 1, 1]

  /** Where the bar phase fell, frame by frame, over the last of a run. */
  const tail = (
    frames: ReturnType<typeof playBeats>,
    seconds: number,
  ): ReturnType<typeof playBeats> => frames.filter((frame) => frame.time >= seconds)

  it('wraps once every four beats and lands on the beat', () => {
    const frames = playBeats(new TempoTracker(BANDS), {
      bpm: 120,
      seconds: 30,
      dt: 1 / 60,
      gainsAt: () => EVEN,
    })

    const late = tail(frames, 20)
    const wraps: number[] = []
    for (let at = 1; at < late.length; at++) {
      const was = late[at - 1]?.beat.barPhase ?? 0
      const now = late[at]?.beat.barPhase ?? 0
      if (was - now > 0.5) wraps.push(late[at]?.time ?? 0)
    }

    // Ten seconds at 120 BPM is twenty beats, so five bars.
    expect(wraps.length).toBe(5)
    for (let at = 1; at < wraps.length; at++)
      expect((wraps[at] ?? 0) - (wraps[at - 1] ?? 0)).toBeCloseTo((BAR_BEATS * 60) / 120, 1)
    // A bar begins on a beat, so the beat phase is back at the start too.
    for (const time of wraps) {
      const frame = late.find((entry) => entry.time === time)
      expect(frame?.beat.phase ?? 1).toBeLessThan(1 / 60 / 0.5 + 1e-6)
    }

    // And it is the whole of 0 to 1 across the four, a quarter to a beat.
    const phases = late.map((frame) => frame.beat.barPhase)
    expect(Math.min(...phases)).toBeLessThan(0.02)
    expect(Math.max(...phases)).toBeGreaterThan(0.98)
  })

  it('puts the downbeat on the loudest low end of the four', () => {
    const frames = playBeats(new TempoTracker(BANDS), {
      bpm: 120,
      seconds: 40,
      dt: 1 / 60,
      gainsAt: (beat) => (beat % BAR_BEATS === 0 ? ACCENT : EVEN),
    })

    // Every accented hit of the last ten seconds should land at the start of
    // a bar, and every unaccented one somewhere else.
    const accents = tail(frames, 30).filter((frame) => frame.hit >= 0 && frame.hit % 4 === 0)
    expect(accents.length).toBeGreaterThan(4)
    for (const frame of accents) expect(frame.beat.barPhase, `beat ${frame.hit}`).toBeLessThan(0.1)
    const others = tail(frames, 30).filter((frame) => frame.hit > 0 && frame.hit % 4 !== 0)
    for (const frame of others)
      expect(frame.beat.barPhase, `beat ${frame.hit}`).toBeGreaterThan(0.15)
  })

  // A hop slides the whole bar, which is worse than being a beat out, so one
  // odd bar must not move it. Here the third beat is briefly the loudest.
  it('does not hop the downbeat for a single loud bar elsewhere', () => {
    const tracker = new TempoTracker(BANDS)
    const seconds = 40
    const frames = playBeats(tracker, {
      bpm: 120,
      seconds,
      dt: 1 / 60,
      gainsAt: (beat) => {
        // One bar, well after the downbeat has settled, with the accent moved.
        const odd = beat >= 48 && beat < 52
        const place = beat % BAR_BEATS
        if (odd) return place === 2 ? ACCENT : EVEN
        return place === 0 ? ACCENT : EVEN
      },
    })

    const accents = tail(frames, 34).filter((frame) => frame.hit >= 0 && frame.hit % 4 === 0)
    expect(accents.length).toBeGreaterThan(2)
    for (const frame of accents) expect(frame.beat.barPhase, `beat ${frame.hit}`).toBeLessThan(0.1)
  })

  it('reads the same bar at any frame rate', () => {
    const bars = [1 / 30, 1 / 60, 1 / 144].map((dt) => {
      const frames = playBeats(new TempoTracker(BANDS), {
        bpm: 120,
        seconds: 30,
        dt,
        gainsAt: (beat) => (beat % BAR_BEATS === 0 ? ACCENT : EVEN),
      })

      const accents = tail(frames, 20).filter((frame) => frame.hit >= 0 && frame.hit % 4 === 0)
      return { dt, phases: accents.map((frame) => frame.beat.barPhase) }
    })

    for (const { dt, phases } of bars) {
      expect(phases.length, `dt ${dt}`).toBeGreaterThan(4)
      for (const phase of phases) expect(phase, `dt ${dt}`).toBeLessThan(0.1)
    }
  })

  it('says nothing about the bar until it knows the beat', () => {
    const tracker = new TempoTracker(BANDS)
    const flux = new Float32Array(BANDS)
    for (let frame = 0; frame < 120; frame++) {
      const beat = tracker.step(flux, 1 / 60)
      expect(beat.bpm).toBe(0)
      expect(beat.barPhase).toBe(0)
    }
  })
})
