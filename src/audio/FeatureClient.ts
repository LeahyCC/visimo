/**
 * The player-thread side of the feature worker. Owns one spectrum buffer
 * that shuttles to the worker and back, so a frame costs no allocation, and
 * keeps the newest packet for the renderer to read. If the worker fails to
 * load or communicate, the same extractor runs locally so playback still draws.
 */
import { BAND_COUNT, BAND_HIT, F, FeatureExtractor, PACKET_LENGTH } from './FeatureExtractor'
import type { FromWorker } from './features.protocol'

export class FeatureClient {
  readonly packet = new Float32Array(PACKET_LENGTH)
  private worker: Worker | null = null
  private extractor: FeatureExtractor | null = null
  private spare: Float32Array<ArrayBuffer> | null
  private elapsed = 0
  private fresh = false
  private disposed = false

  constructor(private readonly analyser: AnalyserNode) {
    this.spare = new Float32Array(analyser.frequencyBinCount)
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
