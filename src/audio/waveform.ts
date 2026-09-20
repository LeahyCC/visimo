/**
 * Pure helpers that turn the analyser's time-domain samples into the few
 * hundred points a line is drawn from. No Web Audio and no GPU here; what the
 * points are for, and how much of the sound they cover, is the caller's choice.
 */

/** A count from a caller, made whole and kept off zero and off NaN. */
const whole = (value: number, fallback: number) =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback

/**
 * Where a window of `span` samples should start, so a steady tone is drawn in
 * the same place every frame instead of sliding sideways.
 *
 * The window normally ends on the newest sample. Up to `search` samples of
 * older sound are given up to find a rising zero crossing, a sample that is
 * not below zero after one that is, and the window starts there. A tone then
 * always starts its line going up through the middle. With no crossing in
 * reach, which is silence or a level held above or below zero, the newest
 * window is used, so the line is never older than it has to be.
 *
 * Nothing is read before index 0 or after the last sample, whatever `span`
 * and `search` ask for.
 */
export function windowStart(source: ArrayLike<number>, span: number, search: number): number {
  const length = source.length
  const drawn = Math.min(Math.max(1, whole(span, length)), length)
  const newest = length - drawn
  const first = newest - Math.min(whole(search, 0), newest)
  // A crossing needs the sample before it, so index 0 cannot start one.
  for (let index = Math.max(first, 1); index <= newest; index++) {
    if ((source[index - 1] ?? 0) < 0 && (source[index] ?? 0) >= 0) return index
  }

  return newest
}

/**
 * Resample the newest `span` samples of `source` into `out`, one value per
 * slot, using the window `windowStart` picks. Each output value is the mean of
 * a few evenly spaced reads across the samples it stands for, linearly
 * interpolated, so a busy high band is averaged instead of aliasing into
 * noise and a span shorter than `out` still comes out smooth.
 *
 * A value that is not a finite number counts as silence, so nothing here can
 * put a NaN into a buffer that goes to the GPU. Amplitude is left as it came:
 * a sine in comes out as the same sine, at the same height.
 */
export function resampleWaveform(
  source: ArrayLike<number>,
  out: Float32Array,
  span: number,
  search = 0,
): Float32Array {
  const length = source.length
  if (out.length === 0 || length === 0) return out.fill(0)
  const drawn = Math.min(Math.max(1, whole(span, length)), length)
  const start = windowStart(source, drawn, search)
  const step = drawn / out.length
  const taps = Math.max(1, Math.ceil(step))
  const last = length - 1
  const at = (index: number) => {
    const value = source[Math.min(Math.max(index, 0), last)] ?? 0
    return Number.isFinite(value) ? value : 0
  }

  for (let slot = 0; slot < out.length; slot++) {
    let sum = 0
    for (let tap = 0; tap < taps; tap++) {
      const position = start + (slot + (tap + 0.5) / taps) * step
      const below = Math.floor(position)
      const across = position - below
      sum += at(below) + (at(below + 1) - at(below)) * across
    }

    out[slot] = sum / taps
  }

  return out
}
