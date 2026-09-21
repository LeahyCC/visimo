/**
 * The maths of the four shapes, on its own: the same curve at any frame rate,
 * a spring that is stable at a step no spring should survive, and a rest that
 * is exactly the target. What a mapping row does with these is
 * `studies/resolve.test.ts`.
 *
 * Every frame-rate comparison holds the input still between the instants all
 * three rates share. That is the only honest way to compare them: a signal
 * that changes between two frames is a different signal at a different rate,
 * and what is being tested here is the step and not the sampling. Sixths of a
 * second are a whole number of frames at 30, 60 and 144.
 */
import { describe, expect, it } from 'vitest'

import { follow, integrate, SHAPE_MAX_DT, stepSpring, wrapped, wrapTotal } from './shapes'
import type { Spring } from './shapes'

const RATES = [30, 60, 144]
/** A sixth of a second, the coarsest instant all three rates land on. */
const SIXTH = 1 / 6

/** A square wave of one third of a second: half a sixth up, half a sixth down. */
const square = (time: number) => (Math.floor(time / SIXTH) % 2 === 0 ? 1 : 0)

/**
 * A shape run at one frame rate over a signal that only ever changes on a
 * sixth, read back at each sixth. The frame count is worked out in frames
 * rather than from a clock, so the readings are the same instants at every
 * rate and nothing depends on a float landing exactly on a boundary.
 */
function run(fps: number, sixths: number, step: (signal: number, dt: number) => number) {
  const perSixth = Math.round(fps * SIXTH)
  const read: number[] = []
  let value = 0
  for (let sixth = 0; sixth < sixths; sixth += 1) {
    const signal = square(sixth * SIXTH)
    for (let frame = 0; frame < perSixth; frame += 1) value = step(signal, 1 / fps)
    read.push(value)
  }

  return read
}

describe('follow', () => {
  it('rises over its attack and falls over its release', () => {
    // One time constant of each, so the value is 1 - 1/e up and 1/e back. The
    // release takes four steps because one step is clamped at a tenth of a
    // second, and exponentials of the same constant compose exactly.
    let value = follow(0, 1, 100, 400, 0.1)
    expect(value).toBeCloseTo(1 - Math.exp(-1), 9)
    value = 1
    for (let step = 0; step < 4; step += 1) value = follow(value, 0, 100, 400, 0.1)
    expect(value).toBeCloseTo(Math.exp(-1), 9)
  })

  it('reaches the same curve at 30, 60 and 144 frames a second', () => {
    const curves = RATES.map((fps) => {
      let value = 0
      return {
        fps,
        read: run(fps, 12, (signal, dt) => (value = follow(value, signal, 20, 250, dt))),
      }
    })

    const first = curves[0]?.read ?? []
    for (const { fps, read } of curves)
      read.forEach((value, at) =>
        expect(value, `${fps} fps at sixth ${at}`).toBeCloseTo(first[at] ?? 0, 9),
      )
  })

  it('is the target at once when the time constant is 0, and still at no step', () => {
    expect(follow(0.3, 1, 0, 0, 1 / 60)).toBe(1)
    expect(follow(0.3, 1, 20, 250, 0)).toBe(0.3)
  })

  it('never passes its target, whichever way it is going', () => {
    let value = 0
    for (let frame = 0; frame < 600; frame += 1) {
      value = follow(value, 1, 5, 5, 1 / 60)
      expect(value).toBeLessThanOrEqual(1)
    }

    for (let frame = 0; frame < 600; frame += 1) {
      value = follow(value, 0, 5, 5, 1 / 60)
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })

  it('moves by one clamped step and no more, however long the frame was', () => {
    const long = follow(0, 1, 100, 100, 10)
    expect(long).toBe(follow(0, 1, 100, 100, SHAPE_MAX_DT))
  })
})

describe('stepSpring', () => {
  const spring = (): Spring => ({ value: 0, velocity: 0 })

  it('passes its target by the overshoot its damping says, and settles back', () => {
    for (const damping of [0.3, 0.5, 0.7]) {
      const state = spring()
      let peak = 0
      for (let frame = 0; frame < 1200; frame += 1) {
        stepSpring(state, 1, 4, damping, 1 / 600)
        peak = Math.max(peak, state.value)
      }

      const wanted = 1 + Math.exp((-Math.PI * damping) / Math.sqrt(1 - damping * damping))
      expect(peak, `damping ${damping}`).toBeCloseTo(wanted, 2)
      expect(state.value, `damping ${damping}`).toBeCloseTo(1, 6)
    }
  })

  it('never passes its target at a damping of 1 or more', () => {
    for (const damping of [1, 1.5, 4]) {
      const state = spring()
      for (let frame = 0; frame < 600; frame += 1) {
        stepSpring(state, 1, 4, damping, 1 / 60)
        expect(state.value, `damping ${damping}`).toBeLessThanOrEqual(1 + 1e-12)
      }

      expect(state.value, `damping ${damping}`).toBeGreaterThan(0.9)
    }
  })

  it('draws the same curve at 30, 60 and 144 frames a second', () => {
    const curves = RATES.map((fps) => {
      const state = spring()
      return {
        fps,
        read: run(fps, 12, (signal, dt) => {
          stepSpring(state, signal, 6, 0.4, dt)
          return state.value
        }),
      }
    })

    const first = curves[0]?.read ?? []
    for (const { fps, read } of curves)
      read.forEach((value, at) =>
        expect(value, `${fps} fps at sixth ${at}`).toBeCloseTo(first[at] ?? 0, 6),
      )
  })

  // A hundred milliseconds is the longest step anything here will take, and
  // at 12 hertz that is more than a whole ring: an Euler or semi-implicit
  // integration of the same equation diverges well before this.
  it('is stable at a tenth of a second, at every damping and frequency', () => {
    for (const frequency of [1, 6, 12, 40])
      for (const damping of [0.1, 0.2, 1, 3]) {
        const state = spring()
        for (let frame = 0; frame < 2000; frame += 1) {
          stepSpring(state, frame % 2 === 0 ? 1 : 0, frequency, damping, 0.1)
          expect(Number.isFinite(state.value), `${frequency} Hz, damping ${damping}`).toBe(true)
          expect(Math.abs(state.value), `${frequency} Hz, damping ${damping}`).toBeLessThan(8)
        }
      }
  })

  it('rests exactly on its target, and stays there', () => {
    const state: Spring = { value: 0.375, velocity: 0 }
    for (const dt of [1 / 144, 1 / 60, 0.1]) {
      stepSpring(state, 0.375, 6, 0.4, dt)
      expect(state.value).toBe(0.375)
      expect(state.velocity).toBe(0)
    }
  })

  it('gets out of the way at no frequency, and does nothing at no step', () => {
    const state = spring()
    stepSpring(state, 0.7, 0, 0.5, 1 / 60)
    expect(state.value).toBe(0.7)
    const held: Spring = { value: 0.2, velocity: 3 }
    stepSpring(held, 1, 6, 0.4, 0)
    expect(held).toEqual({ value: 0.2, velocity: 3 })
  })
})

describe('integrate', () => {
  it('adds its rate times its signal every second, at any frame rate', () => {
    for (const fps of RATES) {
      let value = 0
      for (let frame = 0; frame < fps; frame += 1) value = integrate(value, 0.5, 2, 0, 1 / fps)
      expect(value, `${fps} fps`).toBeCloseTo(1, 9)
    }
  })

  it('folds the total back into the wrap, going either way', () => {
    expect(integrate(0.9, 1, 4, 1, 0.1)).toBeCloseTo(0.3, 9)
    expect(integrate(0.1, 1, -4, 1, 0.1)).toBeCloseTo(0.7, 9)
    expect(wrapTotal(2.25, 1)).toBeCloseTo(0.25, 9)
    expect(wrapTotal(-0.25, 1)).toBeCloseTo(0.75, 9)
    expect(wrapTotal(9, 0)).toBe(9)
  })

  it('takes one clamped step for a frame that ran long', () => {
    expect(integrate(0, 1, 1, 0, 10)).toBeCloseTo(SHAPE_MAX_DT, 12)
  })
})

describe('wrapped', () => {
  it('is a fall of more than half a turn and nothing smaller', () => {
    expect(wrapped(0.97, 0.02)).toBe(true)
    expect(wrapped(0.4, 0.3)).toBe(false)
    // The tracker nudges its running phase by at most 0.175 of a turn toward a
    // beat it has just measured, either way, and neither is a boundary.
    expect(wrapped(0.925, 0.75)).toBe(false)
    expect(wrapped(0.1, 0.925)).toBe(false)
  })
})
