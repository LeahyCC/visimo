/**
 * The plate's GPU side against a stand-in for the device, so what it makes
 * once, what it uploads and what it encodes can be counted, and so the binding
 * it declares can be read against the shader that uses it. What the pass looks
 * like needs a browser; that an ink with nothing to draw costs nothing, and
 * that the two halves of the ink agree about the buffer, does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import shader from '../shaders/cymatics.wgsl?raw'
import { CYMATICS_UNIFORM_FLOATS } from './cymatics.params'
import { CymaticsInk } from './CymaticsInk'

vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 })
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 })

type Buffer = { size: number; destroyed: boolean; destroy: () => void }

/** Every call the ink makes on the device, so a test can say what did and did not happen. */
function fakeDevice() {
  const calls = {
    buffers: [] as Buffer[],
    writes: [] as { buffer: Buffer; floats: number; data: Float32Array }[],
    passes: 0,
    draws: [] as [number, number | undefined][],
    blend: [] as unknown[],
    pipelines: [] as unknown[],
    layouts: [] as GPUBindGroupLayoutDescriptor[],
    groups: [] as GPUBindGroupDescriptor[],
    modules: [] as { code: string }[],
  }

  const pass = {
    setPipeline: vi.fn(),
    setBlendConstant: (colour: unknown) => calls.blend.push(colour),
    setBindGroup: vi.fn(),
    draw: (vertices: number, instances?: number) => calls.draws.push([vertices, instances]),
    end: vi.fn(),
  }

  const device = {
    createShaderModule: (descriptor: { code: string }) => {
      calls.modules.push(descriptor)
      return { getCompilationInfo: () => Promise.resolve({ messages: [] }) }
    },
    createBuffer: ({ size }: { size: number }) => {
      const buffer: Buffer = { size, destroyed: false, destroy: () => (buffer.destroyed = true) }
      calls.buffers.push(buffer)
      return buffer
    },
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => {
      calls.layouts.push(descriptor)
      return {}
    },
    createPipelineLayout: () => ({}),
    createRenderPipeline: (descriptor: unknown) => {
      calls.pipelines.push(descriptor)
      return {}
    },
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
      calls.groups.push(descriptor)
      return {}
    },
    queue: {
      writeBuffer: (buffer: Buffer, _offset: number, data: Float32Array) => {
        calls.writes.push({ buffer, floats: data.length, data: data.slice() })
      },
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

/** A held triad at the study's resting shape, near enough. */
const RINGING = {
  mode0: 1,
  mode4: 1,
  mode7: 1,
  layer: 0.1,
  sharp: 0.25,
  width: 1,
  glow: 2.5,
  strike: 0.35,
  intensity: 1.2,
}
/** What a silent packet resolves to: no note ringing, so nothing to draw. */
const SILENT = { ...RINGING, mode0: 0, mode4: 0, mode7: 0 }

let gpu: ReturnType<typeof fakeDevice>
let ink: CymaticsInk

beforeEach(() => {
  gpu = fakeDevice()
  ink = new CymaticsInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
})

describe('the cymatics ink', () => {
  it('makes its uniform and its pipeline once, and adds light through the ink blend', () => {
    expect(gpu.calls.buffers.map((buffer) => buffer.size)).toEqual([CYMATICS_UNIFORM_FLOATS * 4])
    expect(gpu.calls.pipelines).toHaveLength(1)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    const targets = [...(descriptor.fragment?.targets ?? [])]
    expect(targets[0]?.blend).toBe(INK_BLEND)
    ink.update(packet, 1 / 60, RINGING, 1)
    ink.update(packet, 1 / 60, RINGING, 1)
    expect(gpu.calls.buffers).toHaveLength(1)
    expect(gpu.calls.pipelines).toHaveLength(1)
  })

  it('hands the shader file whole to the compiler, which is what the shader check reads it as', () => {
    expect(gpu.calls.modules).toHaveLength(1)
    expect(gpu.calls.modules[0]?.code).toBe(shader)
  })

  it('says nothing of its own on the overlay', () => {
    expect(ink.detail).toBe('')
  })

  // What a silent packet resolves to: cast, but with no note ringing.
  it('encodes no pass and uploads nothing while no note is ringing', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, SILENT, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('encodes no pass and uploads nothing while there is no light', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, { ...RINGING, intensity: 0 }, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('encodes no pass and uploads nothing at presence 0, however loud the passage', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, RINGING, 0)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('uploads one uniform and draws one triangle a frame', () => {
    ink.update(packet, 1 / 60, RINGING, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.writes.map((write) => write.floats)).toEqual([CYMATICS_UNIFORM_FLOATS])
    expect(gpu.calls.passes).toBe(1)
    expect(gpu.calls.draws).toEqual([[3, undefined]])
  })

  it('hands the shader the canvas it was told about', () => {
    ink.resize(1080, 1920)
    ink.update(packet, 1 / 60, RINGING, 1)
    const data = gpu.calls.writes[0]?.data
    expect([data?.[0], data?.[1]]).toEqual([1080, 1920])
    // The plate is a square against the short side.
    expect(data?.[2]).toBeCloseTo(0.8 * 1080, 3)
  })

  it('carries its presence in the blend constant, which is how an ink fades', () => {
    ink.update(packet, 1 / 60, RINGING, 0.25)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.blend).toEqual([{ r: 0.25, g: 0.25, b: 0.25, a: 1 }])
  })

  it('stops drawing the frame after the notes go', () => {
    ink.update(packet, 1 / 60, RINGING, 1)
    ink.render(gpu.encoder, view)
    ink.update(packet, 1 / 60, SILENT, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(1)
  })

  // It has no clock, so a frame rate has nothing to change: the same knobs at
  // any step draw the same uniform.
  it('writes the same uniform at any step, since nothing in it runs on a clock', () => {
    const at = (dt: number) => {
      const fresh = fakeDevice()
      const other = new CymaticsInk()
      other.init({ device: fresh.device, format: 'rgba16float', software: false })
      other.resize(1920, 1080)
      for (let frame = 0; frame < 5; frame += 1) other.update(packet, dt, RINGING, 1)
      return fresh.calls.writes.at(-1)?.data
    }

    expect(at(1 / 240)).toEqual(at(1 / 30))
  })

  it('releases its buffer and does nothing after that', () => {
    ink.dispose()
    expect(gpu.calls.buffers.every((buffer) => buffer.destroyed)).toBe(true)
    expect(() => {
      ink.update(packet, 1 / 60, RINGING, 1)
      ink.render(gpu.encoder, view)
    }).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })

  it('does nothing before it has a device', () => {
    const bare = new CymaticsInk()
    expect(() => {
      bare.update(packet, 1 / 60, RINGING, 1)
      bare.render(gpu.encoder, view)
    }).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })
})

describe('the pipeline against the shader', () => {
  it('names its one binding, as the uniform, in the fragment stage, as the shader declares it', () => {
    expect(shader).toMatch(/@group\(0\)\s+@binding\(0\)\s+var<uniform>\s+params\s*:\s*Params/)
    const entries = [...(gpu.calls.layouts[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0])
    expect(entries[0]?.buffer?.type).toBe('uniform')
    // The vertex stage reads nothing of it: the triangle covers the frame.
    expect(entries[0]?.visibility).toBe(2)
    const vertex = shader.slice(shader.indexOf('@vertex'), shader.indexOf('fn smooth_step'))
    expect(vertex).not.toMatch(/params\./)
  })

  it('binds the uniform to binding 0', () => {
    const entries = [...(gpu.calls.groups[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0])
    expect((entries[0]?.resource as GPUBufferBinding).buffer).toBe(gpu.calls.buffers[0])
  })

  it('has the entry points the pipeline names', () => {
    expect(shader).toMatch(/@vertex\s+fn vs\(/)
    expect(shader).toMatch(/@fragment\s+fn fs\(/)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    expect(descriptor.vertex.entryPoint).toBe('vs')
    expect(descriptor.fragment?.entryPoint).toBe('fs')
  })

  it('writes alpha as 1 and the light in rgb, which the blend leaves alone', () => {
    expect(shader).toMatch(
      /return vec4<f32>\(colour \* params\.line\.w \* params\.drive\.x \* edge, 1\.0\)/,
    )
  })
})
