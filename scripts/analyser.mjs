/**
 * What a browser's AnalyserNode hands the extractor, worked out from decoded
 * samples instead of from a playing element.
 *
 * The extractor's only input is the Float32Array of dB per bin that
 * `getFloatFrequencyData` fills, so the whole of the browser can be replaced
 * by the three steps the spec names: a Blackman window over the newest
 * `fftSize` samples, an FFT, and each magnitude divided by `fftSize` and
 * taken to dB. Every constant in the extractor is tuned against real levels,
 * so the scaling has to be the spec's own and not merely proportional to it.
 *
 * `AudioGraph` sets `smoothingTimeConstant` to 0, which is what lets this be
 * stateless: there is no blend with the previous frame to carry.
 */

/** Blackman, the window the spec names, with the usual 0.16. */
function blackman(size) {
  const window = new Float32Array(size)
  for (let n = 0; n < size; n++) {
    const phase = (2 * Math.PI * n) / size
    window[n] = 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase)
  }

  return window
}

/** Bit-reversal order for an in-place radix-2 transform. */
function reversals(size) {
  const order = new Uint32Array(size)
  const bits = Math.log2(size)
  for (let at = 0; at < size; at++) {
    let reversed = 0
    for (let bit = 0; bit < bits; bit++) reversed |= ((at >> bit) & 1) << (bits - 1 - bit)
    order[at] = reversed
  }

  return order
}

/**
 * One analyser: an FFT of a fixed size, its window and its twiddles worked
 * out once, and a scratch pair of arrays, so a whole track costs no
 * allocation past this.
 */
export function createAnalyser(fftSize) {
  if ((fftSize & (fftSize - 1)) !== 0) throw new Error('analyser: fftSize must be a power of two')
  const window = blackman(fftSize)
  const order = reversals(fftSize)
  const cosines = new Float64Array(fftSize / 2)
  const sines = new Float64Array(fftSize / 2)
  for (let at = 0; at < fftSize / 2; at++) {
    cosines[at] = Math.cos((-2 * Math.PI * at) / fftSize)
    sines[at] = Math.sin((-2 * Math.PI * at) / fftSize)
  }

  const real = new Float64Array(fftSize)
  const imaginary = new Float64Array(fftSize)
  const spectrum = new Float32Array(fftSize / 2)

  /**
   * The dB spectrum of the `fftSize` samples ending at `end`. Samples before
   * the start of the track read as silence, the way an analyser's buffer does
   * before anything has been played through it.
   */
  return function analyse(samples, end) {
    const start = end - fftSize
    for (let at = 0; at < fftSize; at++) {
      const sample = start + at < 0 ? 0 : (samples[start + at] ?? 0)
      real[order[at]] = sample * window[at]
      imaginary[order[at]] = 0
    }

    for (let span = 2; span <= fftSize; span <<= 1) {
      const half = span >> 1
      const step = fftSize / span
      for (let group = 0; group < fftSize; group += span) {
        for (let at = 0; at < half; at++) {
          const twiddle = at * step
          const cosine = cosines[twiddle]
          const sine = sines[twiddle]
          const top = group + at
          const bottom = top + half
          const realPart = real[bottom] * cosine - imaginary[bottom] * sine
          const imaginaryPart = real[bottom] * sine + imaginary[bottom] * cosine
          real[bottom] = real[top] - realPart
          imaginary[bottom] = imaginary[top] - imaginaryPart
          real[top] += realPart
          imaginary[top] += imaginaryPart
        }
      }
    }

    for (let bin = 0; bin < spectrum.length; bin++) {
      // The spec's own scaling: the magnitude over the FFT size, then dB.
      const magnitude = Math.hypot(real[bin], imaginary[bin]) / fftSize
      spectrum[bin] = magnitude > 0 ? 20 * Math.log10(magnitude) : -Infinity
    }

    return spectrum
  }
}
