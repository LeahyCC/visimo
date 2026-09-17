import { describe, expect, it } from 'vitest'

import { ENVELOPE_RATE, parabolicOffset, TempoTracker } from './TempoTracker'

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
