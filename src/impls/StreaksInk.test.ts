/**
 * The streaks' GPU side against a stand-in for the device, so what it makes
 * once, what it uploads and what it encodes can be counted. What the passes
 * look like needs a browser; that an ink with nothing to draw costs nothing
 * does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import { STREAK_FLOATS, STREAK_UNIFORM_FLOATS } from './streaks.params'
import { StreaksInk } from './StreaksInk'

vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 })
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 })

type Buffer = { size: number; destroyed: boolean; destroy: () => void }

/** Every call the ink makes on the device, so a test can say what did and did not happen. */
function fakeDevice() {
  const calls = {
    buffers: [] as Buffer[],
    writes: [] as { buffer: Buffer; floats: number }[],
    passes: 0,
    draws: [] as [number, number][],
    blend: [] as unknown[],
    pipelines: [] as unknown[],
  }

  const pass = {
    setPipeline: vi.fn(),
    setBlendConstant: (colour: unknown) => calls.blend.push(colour),
    setBindGroup: vi.fn(),
    draw: (vertices: number, instances: number) => calls.draws.push([vertices, instances]),
    end: vi.fn(),
  }

  const device = {
    createShaderModule: () => ({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
    createBuffer: ({ size }: { size: number }) => {
      const buffer: Buffer = { size, destroyed: false, destroy: () => (buffer.destroyed = true) }
      calls.buffers.push(buffer)
      return buffer
    },
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: (descriptor: unknown) => {
      calls.pipelines.push(descriptor)
      return {}
    },
    createBindGroup: () => ({}),
    queue: {
      writeBuffer: (buffer: Buffer, _offset: number, data: Float32Array, at = 0, size?: number) =>
        calls.writes.push({ buffer, floats: size ?? data.length - at }),
    },
  }

  const encoder = {
    beginRenderPass: () => {
      calls.passes += 1
      return pass
    },
  }

  return {
    calls,
    device: device as unknown as GPUDevice,
    encoder: encoder as unknown as GPUCommandEncoder,
  }
}

const packet = new Float32Array(PACKET_LENGTH)
const view = {} as GPUTextureView

/** A study wound up: what `riser-streaks` resolves to at full tension, near enough. */
const WOUND = { count: 48, length: 0.4, speed: 1, width: 1.5, intensity: 0.7, hueSpread: 0.25 }
const RESTING = { ...WOUND, count: 0, intensity: 0 }
const FEW = { ...WOUND, count: 10 }

let gpu: ReturnType<typeof fakeDevice>
let ink: StreaksInk

beforeEach(() => {
  gpu = fakeDevice()
  ink = new StreaksInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
})

describe('the streaks ink', () => {
  it('makes its two buffers and its pipeline once, and adds light through the ink blend', () => {
    expect(gpu.calls.buffers.map((buffer) => buffer.size)).toEqual([
      STREAK_UNIFORM_FLOATS * 4,
      96 * STREAK_FLOATS * 4,
    ])
    expect(gpu.calls.pipelines).toHaveLength(1)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    const targets = [...(descriptor.fragment?.targets ?? [])]
    expect(targets[0]?.blend).toBe(INK_BLEND)
    ink.update(packet, 1 / 60, WOUND, 1)
    ink.update(packet, 1 / 60, WOUND, 1)
    expect(gpu.calls.buffers).toHaveLength(2)
    expect(gpu.calls.pipelines).toHaveLength(1)
  })

  it('says nothing of its own on the overlay', () => {
    expect(ink.detail).toBe('')
  })

  // Where the study rests until tension lifts it: cast, but nothing to draw.
  it('encodes no pass and uploads nothing while nothing is lit', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, RESTING, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('encodes no pass and uploads nothing at presence 0, however wound up', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, WOUND, 0)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('uploads only the streaks that are lit and draws one quad each', () => {
    ink.update(packet, 1 / 60, FEW, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.writes.map((write) => write.floats)).toEqual([10 * STREAK_FLOATS, 4])
    expect(gpu.calls.passes).toBe(1)
    expect(gpu.calls.draws).toEqual([[6, 10]])
  })

  it('carries its presence in the blend constant, which is how an ink fades', () => {
    ink.update(packet, 1 / 60, WOUND, 0.25)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.blend).toEqual([{ r: 0.25, g: 0.25, b: 0.25, a: 1 }])
  })

  it('stops drawing the frame after the build ends', () => {
    ink.update(packet, 1 / 60, WOUND, 1)
    ink.render(gpu.encoder, view)
    ink.update(packet, 1 / 60, RESTING, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(1)
  })

  it('releases its buffers and does nothing after that', () => {
    ink.dispose()
    expect(gpu.calls.buffers.every((buffer) => buffer.destroyed)).toBe(true)
    expect(() => {
      ink.update(packet, 1 / 60, WOUND, 1)
      ink.render(gpu.encoder, view)
    }).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })

  it('does nothing before it has a device', () => {
    const bare = new StreaksInk()
    expect(() => {
      bare.update(packet, 1 / 60, WOUND, 1)
      bare.render(gpu.encoder, view)
    }).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })
})
