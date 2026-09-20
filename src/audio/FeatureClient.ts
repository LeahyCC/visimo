/**
 * The player-thread side of the feature worker. Owns one spectrum buffer
 * that shuttles to the worker and back, so a frame costs no allocation, and
 * keeps the newest packet for the renderer to read. If the worker fails to
 * load or communicate, the same extractor runs locally so playback still draws.
 *
 * It also owns the analyser's waveform, which never goes near the worker: the
 * extractor wants the spectrum and nothing else wants the waveform but the
 * renderer, so it is read here on the main thread into a buffer that stays put.
 */
import { BAND_COUNT, BAND_HIT, F, FeatureExtractor, PACKET_LENGTH } from './FeatureExtractor'
import type { FromWorker } from './features.protocol'

export class FeatureClient {
  readonly packet = new Float32Array(PACKET_LENGTH)
  /**
   * The newest `fftSize` samples of the sound, oldest first, as of the last
   * `pump`. One buffer for the life of the client, so read it rather than
   * keeping it; the next frame writes over it.
   */
  readonly waveform: Float32Array<ArrayBuffer>
  private worker: Worker | null = null
  private extractor: FeatureExtractor | null = null
  private spare: Float32Array<ArrayBuffer> | null
  private elapsed = 0
  private fresh = false
  private disposed = false

  constructor(private readonly analyser: AnalyserNode) {
    this.spare = new Float32Array(analyser.frequencyBinCount)
    this.waveform = new Float32Array(analyser.fftSize)
    try {
      const worker = new Worker(new URL('./features.worker.ts', import.meta.url), {
        type: 'module',
      })
      this.worker = worker
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        if (this.disposed || this.worker !== worker) return
        this.packet.set(event.data.packet)
        this.fresh = true
        this.spare = event.data.spectrum
      }
      worker.onerror = () => this.useLocalExtractor()
      worker.onmessageerror = () => this.useLocalExtractor()
      worker.postMessage({
        type: 'configure',
        options: { sampleRate: analyser.context.sampleRate, fftSize: analyser.fftSize },
      })
    } catch {
      this.useLocalExtractor()
    }
  }

  /** Read the analyser and send a frame, unless the last one is still away. */
  pump(dt: number) {
    if (this.disposed) return
    this.elapsed += Math.max(0, dt)
    // Before the spectrum check: the worker holding the spectrum has no say
    // over the waveform, so it is fresh on every tick the renderer pumps.
    this.analyser.getFloatTimeDomainData(this.waveform)
    const spectrum = this.spare
    if (!spectrum) return
    this.spare = null
    this.analyser.getFloatFrequencyData(spectrum)
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'frame', spectrum, dt: this.elapsed }, [spectrum.buffer])
        this.elapsed = 0
        return
      } catch {
        this.useLocalExtractor()
      }
    }
    // The failed worker may own the old buffer, so sample into its replacement.
    const localSpectrum = this.spare ?? spectrum
    if (localSpectrum !== spectrum) this.analyser.getFloatFrequencyData(localSpectrum)
    if (this.extractor) {
      this.packet.set(this.extractor.update(localSpectrum, this.elapsed))
      this.fresh = true
    }
    this.spare = localSpectrum
    this.elapsed = 0
  }

  /**
   * A new track. The extractor is built again, because everything it keeps is
   * about the track it has been hearing: the sections and what they sounded
   * like, the scales a boundary is measured against, the tempo, the loudest
   * the song has been. Carried into the next song, a dance track's wide scale
   * left the metal track after it with no sections at all.
   */
  newTrack() {
    if (this.disposed) return
    const options = { sampleRate: this.analyser.context.sampleRate, fftSize: this.analyser.fftSize }
    if (this.extractor) this.extractor = new FeatureExtractor(options)
    try {
      this.worker?.postMessage({ type: 'configure', options })
    } catch {
      this.useLocalExtractor()
    }
  }

  /** The playhead jumped within the track; see `Structure.rescale`. */
  seeked() {
    if (this.disposed) return
    this.extractor?.seeked()
    try {
      this.worker?.postMessage({ type: 'seek' })
    } catch {
      this.useLocalExtractor()
    }
  }

  /** Levels hold between worker replies, but one hit must spawn only once. */
  readInto(out: Float32Array) {
    out.set(this.packet)
    if (!this.fresh) {
      out.fill(0, BAND_HIT, BAND_HIT + BAND_COUNT)
      out[F.onset] = 0
    }
    this.fresh = false
  }

  // A dead worker cannot return its transferred buffer. Rebuild both the
  // spectrum storage and extractor once, then reject any queued worker replies.
  private useLocalExtractor() {
    if (this.disposed || this.extractor) return
    this.stopWorker()
    this.extractor = new FeatureExtractor({
      sampleRate: this.analyser.context.sampleRate,
      fftSize: this.analyser.fftSize,
    })
    this.spare = new Float32Array(this.analyser.frequencyBinCount)
    console.warn('Feature worker unavailable; audio analysis is running on the main thread.')
  }

  private stopWorker() {
    if (!this.worker) return
    this.worker.onmessage = null
    this.worker.onerror = null
    this.worker.onmessageerror = null
    this.worker.terminate()
    this.worker = null
  }

  dispose() {
    this.disposed = true
    this.stopWorker()
    this.extractor = null
    this.spare = null
  }
}
