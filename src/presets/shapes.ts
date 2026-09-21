/**
 * The maths behind the four shapes a mapping row may carry. Generic helpers
 * and nothing else: a follower, a damped spring, and the fold a wrapping
 * total needs. Nothing here knows what a study is, what a knob is or what a
 * packet holds, which is why it sits beside the vocabulary in `knobs.ts`
 * rather than inside the resolver that uses it. The state is the caller's,
 * one object per shaped row, because this runs on every animation frame and
 * there is nothing here worth allocating.
 *
 * Every step takes the real seconds since the last one and is the same curve
 * at any frame rate, which is the whole point of the file. Two things buy
 * that. The follower and the spring are both solved in closed form over the
 * step rather than nudged toward the target by a fraction of it, so 144
 * frames of a sixth of a second land exactly where 5 frames of it do; and
 * every step clamps its own `dt` at `SHAPE_MAX_DT`, so a tab that was hidden
 * for a minute comes back and moves by one frame's worth rather than
 * teleporting. The renderer already clamps the frame's `dt` to the same
 * number, and this clamps again because a helper that is stable at any step
 * is one less thing to hold in mind.
 */

/**
 * The longest step any shape will take at once, in seconds, which is the
 * renderer's own clamp. Past this a shape moves slower than real time rather
 * than jumping, which is the right trade for a picture: a jump is seen and a
 * sixteenth of a second of lost motion is not.
 */
export const SHAPE_MAX_DT = 0.1

const clampStep = (dt: number) => (dt > SHAPE_MAX_DT ? SHAPE_MAX_DT : dt > 0 ? dt : 0)

/**
 * A one-pole follower with a different time constant each way: the value
 * moves toward `target` with `attackMs` while it is rising and `releaseMs`
 * while it is falling. The step is the exact exponential over `dt`, so the
 * same seconds give the same value at any frame rate, and a time constant of
 * 0 means "at once".
 */
export function follow(
  value: number,
  target: number,
  attackMs: number,
  releaseMs: number,
  dt: number,
): number {
  const step = clampStep(dt)
  const tau = (target > value ? attackMs : releaseMs) / 1000
  if (tau <= 0 || step <= 0) return step <= 0 ? value : target
  return target + (value - target) * Math.exp(-step / tau)
}

/** Where a spring is: its value, and how fast that value is moving. */
export type Spring = {
  value: number
  velocity: number
}

/**
 * One step of a damped spring toward `target`, written into `state`.
 *
 * `frequency` is the undamped frequency in hertz and `damping` the ratio: 0
 * is a spring that never stops, under 1 overshoots and rings, 1 is the
 * fastest approach that never passes the target, and over 1 crawls in from
 * one side. The overshoot of a step input is `exp(-pi z / sqrt(1 - z^2))` of
 * the step, so a damping of 0.5 passes the target by 16 percent and one of
 * 0.7 by 5, which is how a study picks a number rather than by eye.
 *
 * The step is the analytic solution of `x'' + 2 z w x' + w^2 x = 0` for the
 * error `x = value - target` over `dt`, in the three cases the roots fall
 * into. That is what makes it stable at any step: a semi-implicit or an
 * Euler integration of the same equation blows up once `dt` passes about one
 * over the frequency, and 0.1 s at any frequency a study would reach is well
 * past that. It also rests exactly on the target: an error and a velocity of
 * 0 stay 0 in all three branches, so a row whose signal has stopped moving
 * is the row it would have been with no spring at all.
 */
export function stepSpring(
  state: Spring,
  target: number,
  frequency: number,
  damping: number,
  dt: number,
): void {
  const step = clampStep(dt)
  const omega = 2 * Math.PI * frequency
  if (step <= 0) return
  // No spring to speak of: nothing would ever pull the value anywhere, so the
  // shape gets out of the way rather than holding the last thing it saw.
  if (omega <= 0) {
    state.value = target
    state.velocity = 0
    return
  }

  const zeta = damping > 0 ? damping : 0
  const error = state.value - target
  const velocity = state.velocity
  let moved = 0
  let rate = 0
  if (zeta < 1 - 1e-6) {
    const ringing = omega * Math.sqrt(1 - zeta * zeta)
    const decay = Math.exp(-zeta * omega * step)
    const cosine = Math.cos(ringing * step)
    const sine = Math.sin(ringing * step)
    moved = decay * (error * cosine + ((velocity + zeta * omega * error) / ringing) * sine)
    rate =
      decay *
      (velocity * cosine - ((omega * omega * error + zeta * omega * velocity) / ringing) * sine)
  } else if (zeta <= 1 + 1e-6) {
    const decay = Math.exp(-omega * step)
    const slope = velocity + omega * error
    moved = decay * (error + slope * step)
    rate = decay * (velocity - omega * slope * step)
  } else {
    const root = omega * Math.sqrt(zeta * zeta - 1)
    const slow = -zeta * omega + root
    const fast = -zeta * omega - root
    const second = (slow * error - velocity) / (slow - fast)
    const first = error - second
    const slowDecay = Math.exp(slow * step)
    const fastDecay = Math.exp(fast * step)
    moved = first * slowDecay + second * fastDecay
    rate = first * slow * slowDecay + second * fast * fastDecay
  }

  state.value = target + moved
  state.velocity = rate
}

/** A running total folded back into 0 up to `wrap`; `wrap` of 0 or less is no fold. */
export const wrapTotal = (value: number, wrap: number) =>
  wrap > 0 ? ((value % wrap) + wrap) % wrap : value

/**
 * A running total advanced by `rate` times `signal` over `dt`, folded if it
 * wraps. The clamp on the step is the reason this is here rather than inline:
 * a total that ran on real time through a hidden tab would come back a long
 * way round, and a phase that jumps is a picture that jumps.
 */
export const integrate = (value: number, signal: number, rate: number, wrap: number, dt: number) =>
  wrapTotal(value + rate * signal * clampStep(dt), wrap)

/**
 * Whether a phase that runs 0 to 1 and wraps has just wrapped between two
 * readings. A fall of more than half a turn is a wrap and anything smaller is
 * the tracker nudging its running phase back toward a beat it has just
 * measured, which it does by at most 0.175 of a turn and which is not a
 * boundary.
 */
export const wrapped = (from: number, to: number) => from - to > 0.5
