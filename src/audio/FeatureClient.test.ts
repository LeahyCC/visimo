import { afterEach, describe, expect, it, vi } from 'vitest'

import { FeatureClient } from './FeatureClient'
import { F, PACKET_LENGTH } from './FeatureExtractor'
import type { FromWorker, ToWorker } from './features.protocol'

class TestWorker {
  static latest: TestWorker
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  messages: ToWorker[] = []
  failSend = false
  constructor() {
    TestWorker.latest = this
  }
  postMessage(message: ToWorker) {
    if (this.failSend) throw new Error('Worker unavailable')
    this.messages.push(message)
    if (message.type === 'frame')
      structuredClone(message.spectrum, { transfer: [message.spectrum.buffer] })
  }
  terminate = vi.fn()
  reply(packet: Float32Array) {
    this.onmessage?.({
      data: { type: 'features', packet, spectrum: new Float32Array(8) },
    } as MessageEvent<FromWorker>)
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * The analyser as far as the client touches it. The waveform is a ramp that
 * starts where the frame counter is, so a test can tell one read from the next.
 */
const analyser = (reads = { waveform: 0 }) =>
  ({
    context: { sampleRate: 48000 },
    fftSize: 16,
    frequencyBinCount: 8,
    getFloatFrequencyData: (out: Float32Array) => out.fill(-20),
    getFloatTimeDomainData: (out: Float32Array) => {
      reads.waveform++
      for (let index = 0; index < out.length; index++) out[index] = reads.waveform + index / 100
    },
  }) as unknown as AnalyserNode

describe('audio frames consumed by the renderer', () => {
  const create = () => {
    vi.stubGlobal('Worker', TestWorker)
    return new FeatureClient(analyser())
  }

  it('consumes a hit once while preserving levels and the public packet', () => {
    const client = create()
    const packet = new Float32Array(PACKET_LENGTH)
    packet[F.subHit] = 0.8
    packet[F.onset] = 1
    packet[F.sub] = 0.5
    packet[F.subPulse] = 0.9
    TestWorker.latest.reply(packet)
    const out = new Float32Array(PACKET_LENGTH)
    client.readInto(out)
    expect(out[F.subHit]).toBeCloseTo(0.8)
    client.readInto(out)
    expect(out[F.subHit]).toBe(0)
    expect(out[F.onset]).toBe(0)
    expect(out[F.sub]).toBe(0.5)
    expect(out[F.subPulse]).toBeCloseTo(0.9)
    expect(client.packet[F.subHit]).toBeCloseTo(0.8)
    TestWorker.latest.reply(packet)
    client.readInto(out)
    expect(out[F.subHit]).toBeCloseTo(0.8)
    client.dispose()
  })

  it('includes the elapsed time of render ticks skipped while the worker is busy', () => {
    const client = create()
    client.pump(0.01)
    client.pump(0.02)
    client.pump(0.03)
    TestWorker.latest.reply(new Float32Array(PACKET_LENGTH))
    client.pump(0.01)
    const frames = TestWorker.latest.messages.filter((message) => message.type === 'frame')
    expect(frames).toHaveLength(2)
    expect(frames[1]?.dt).toBeCloseTo(0.06)
    client.dispose()
  })

  it.each(['onerror', 'onmessageerror'] as const)(
    'recovers from %s after transferring a frame and ignores late worker replies',
    (event) => {
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const client = create()
      const worker = TestWorker.latest
      const lateReply = worker.onmessage
      const fail = worker[event]
      client.pump(0.02)
      fail?.()
      fail?.()
      client.pump(0.02)
      expect(client.packet[F.energy]).toBeGreaterThan(0)
      const packet = client.packet.slice()
      lateReply?.({
        data: {
          type: 'features',
          packet: new Float32Array(PACKET_LENGTH),
          spectrum: new Float32Array(8),
        },
      } as MessageEvent<FromWorker>)
      expect(client.packet).toEqual(packet)
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(warning).toHaveBeenCalledTimes(1)
      client.dispose()
      client.pump(0.1)
      expect(client.packet).toEqual(packet)
    },
  )

  it('falls back when posting a frame fails', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = create()
    TestWorker.latest.failSend = true
    client.pump(0.02)
    expect(client.packet[F.energy]).toBeGreaterThan(0)
    client.dispose()
  })

  it('falls back when the browser cannot create a worker', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Workers unavailable')
        }
      },
    )
    const client = new FeatureClient(analyser())
    client.pump(0.02)
    expect(client.packet[F.energy]).toBeGreaterThan(0)
    client.dispose()
  })
})

describe('the waveform', () => {
  const create = (reads = { waveform: 0 }) => {
    vi.stubGlobal('Worker', TestWorker)
    return new FeatureClient(analyser(reads))
  }

  it('is one buffer as long as the analyser window, read into on every pump', () => {
    const client = create()
    const buffer = client.waveform
    expect(buffer).toHaveLength(16)
    client.pump(0.01)
    expect(client.waveform).toBe(buffer)
    expect(buffer[0]).toBe(1)
    expect(buffer[15]).toBeCloseTo(1.15)
    client.pump(0.01)
    // The same object again, now holding the second read: nothing was allocated.
    expect(client.waveform).toBe(buffer)
    expect(buffer[0]).toBe(2)
    client.dispose()
  })

  it('stays fresh while the worker still holds the spectrum', () => {
    const reads = { waveform: 0 }
    const client = create(reads)
    client.pump(0.01)
    // The spectrum went away with that frame and no reply has brought it back,
    // so this pump sends nothing, but the waveform is not the worker's.
    client.pump(0.01)
    client.pump(0.01)
    expect(TestWorker.latest.messages.filter((message) => message.type === 'frame')).toHaveLength(1)
    expect(reads.waveform).toBe(3)
    expect(client.waveform[0]).toBe(3)
    client.dispose()
  })

  it('is read on the main thread and never sent to the worker', () => {
    const client = create()
    client.pump(0.01)
    const frame = TestWorker.latest.messages.find((message) => message.type === 'frame')
    expect(Object.keys(frame ?? {}).sort()).toEqual(['dt', 'spectrum', 'type'])
    client.dispose()
  })

  it('is read when the extractor has fallen back to the main thread too', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = create()
    TestWorker.latest.failSend = true
    client.pump(0.02)
    expect(client.waveform[0]).toBe(1)
    client.pump(0.02)
    expect(client.waveform[0]).toBe(2)
    client.dispose()
  })

  it('is left alone once the client is disposed', () => {
    const reads = { waveform: 0 }
    const client = create(reads)
    client.dispose()
    client.pump(0.1)
    expect(reads.waveform).toBe(0)
  })
})
