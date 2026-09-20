/**
 * The dust's GPU side against a stand-in for the device, so what it makes
 * once, what it uploads and what it encodes can be counted, and so the
 * bindings it declares can be read against the shader that uses them. What the
 * pass looks like needs a browser; that an ink with nothing to draw costs
 * nothing, and that the two halves of the ink agree about the buffers, does
 * not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import shader from '../shaders/dust.wgsl?raw'
import { DUST_UNIFORM_FLOATS, MAX_SPECKS, SPECK_AT, SPECK_FLOATS } from './dust.params'
import { DustInk } from './DustInk'

vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 })
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 })

type Buffer = { size: number; destroyed: boolean; destroy: () => void }

/** Every call the ink makes on the device, so a test can say what did and did not happen. */
function fakeDevice() {
  const calls = {
    buffers: [] as Buffer[],
    writes: [] as { buffer: Buffer; floats: number; data: Float32Array }[],
    passes: 0,
    draws: [] as [number, number][],
    blend: [] as unknown[],
    pipelines: [] as unknown[],
    layouts: [] as GPUBindGroupLayoutDescriptor[],
    groups: [] as GPUBindGroupDescriptor[],
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
      writeBuffer: (buffer: Buffer, _offset: number, data: Float32Array, at = 0, size?: number) => {
        const floats = size ?? data.length - at
        calls.writes.push({ buffer, floats, data: data.slice(at, at + floats) })
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

/** What the study resolves to over a quiet passage, near enough. */
const QUIET = {
  count: 40,
  size: 8,
  drift: 0.03,
  twinkle: 0.5,
  intensity: 0.25,
  hueSpread: 0.12,
  gather: 0,
}
/** What it resolves to at a silent packet: a count of nothing. */
const SILENT = { ...QUIET, count: 0 }
const FEW = { ...QUIET, count: 10 }

let gpu: ReturnType<typeof fakeDevice>
let ink: DustInk

beforeEach(() => {
  gpu = fakeDevice()
  ink = new DustInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
})

describe('the dust ink', () => {
  it('makes its two buffers and its pipeline once, and adds light through the ink blend', () => {
    expect(gpu.calls.buffers.map((buffer) => buffer.size)).toEqual([
      DUST_UNIFORM_FLOATS * 4,
      MAX_SPECKS * SPECK_FLOATS * 4,
    ])
    expect(gpu.calls.pipelines).toHaveLength(1)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    const targets = [...(descriptor.fragment?.targets ?? [])]
    expect(targets[0]?.blend).toBe(INK_BLEND)
    ink.update(packet, 1 / 60, QUIET, 1)
    ink.update(packet, 1 / 60, QUIET, 1)
    expect(gpu.calls.buffers).toHaveLength(2)
    expect(gpu.calls.pipelines).toHaveLength(1)
  })

  it('says nothing of its own on the overlay', () => {
    expect(ink.detail).toBe('')
  })

  // What a silent packet resolves to: cast, but nothing to draw.
  it('encodes no pass and uploads nothing while nothing is lit', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, SILENT, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('encodes no pass and uploads nothing at presence 0, however quiet the passage', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, QUIET, 0)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('uploads only the specks that are lit and draws one quad each', () => {
    ink.update(packet, 1 / 60, FEW, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.writes.map((write) => write.floats)).toEqual([
      10 * SPECK_FLOATS,
      DUST_UNIFORM_FLOATS,
    ])
    expect(gpu.calls.passes).toBe(1)
    expect(gpu.calls.draws).toEqual([[6, 10]])
  })

  it('carries its presence in the blend constant, which is how an ink fades', () => {
    ink.update(packet, 1 / 60, QUIET, 0.25)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.blend).toEqual([{ r: 0.25, g: 0.25, b: 0.25, a: 1 }])
  })

  it('stops drawing the frame after the sound goes', () => {
    ink.update(packet, 1 / 60, QUIET, 1)
    ink.render(gpu.encoder, view)
    ink.update(packet, 1 / 60, SILENT, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(1)
  })

  it('keeps its clocks running while nothing is lit, so the specks that come in are mid-drift', () => {
    const fresh = new DustInk()
    const other = fakeDevice()
    fresh.init({ device: other.device, format: 'rgba16float', software: false })
    fresh.resize(1920, 1080)
    for (let frame = 0; frame < 120; frame += 1) fresh.update(packet, 1 / 60, SILENT, 1)
    fresh.update(packet, 1 / 60, FEW, 1)
    ink.update(packet, 1 / 60, FEW, 1)
    // Two seconds of drift has moved them, so the two buffers are not the same.
    const placed = other.calls.writes[0]?.data
    const first = gpu.calls.writes[0]?.data
    expect(placed).toHaveLength(10 * SPECK_FLOATS)
    expect(first).toHaveLength(10 * SPECK_FLOATS)
    expect(placed?.[SPECK_AT.x]).not.toBeCloseTo(first?.[SPECK_AT.x] ?? Number.NaN, 1)
  })

  it('releases its buffers and does nothing after that', () => {
    ink.dispose()
    expect(gpu.calls.buffers.every((buffer) => buffer.destroyed)).toBe(true)
    expect(() => {
      ink.update(packet, 1 / 60, QUIET, 1)
      ink.render(gpu.encoder, view)
    }).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })

  it('does nothing before it has a device', () => {
    const bare = new DustInk()
    expect(() => {
      bare.update(packet, 1 / 60, QUIET, 1)
      bare.render(gpu.encoder, view)
    }).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })
})

// WGSL is compiled only by a browser, so what can be checked here is that the
// two halves agree about the buffers: the binding numbers and kinds, the size
// of the uniform, and the layout of a speck in the storage buffer.
describe('the shader against the buffers it reads', () => {
  it('reads binding 0 as the uniform and binding 1 as read-only storage, as the layout says', () => {
    expect(shader).toMatch(/@group\(0\)\s+@binding\(0\)\s+var<uniform>\s+params\s*:\s*Params/)
    expect(shader).toMatch(
      /@group\(0\)\s+@binding\(1\)\s+var<storage,\s*read>\s+specks\s*:\s*array<Speck>/,
    )
    const entries = [...(gpu.calls.layouts[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0, 1])
    expect(entries[0]?.buffer?.type).toBe('uniform')
    expect(entries[1]?.buffer?.type).toBe('read-only-storage')
    // Both are read in the vertex stage, and the fragment stage reads neither.
    for (const entry of entries) expect(entry.visibility & 1).toBe(1)
    const fragment = shader.slice(shader.indexOf('@fragment'))
    expect(fragment).not.toMatch(/params\.|specks\[/)
  })

  it('binds the uniform to binding 0 and the specks to binding 1', () => {
    const entries = [...(gpu.calls.groups[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0, 1])
    const [uniform, specks] = gpu.calls.buffers
    expect((entries[0]?.resource as GPUBufferBinding).buffer).toBe(uniform)
    expect((entries[1]?.resource as GPUBufferBinding).buffer).toBe(specks)
  })

  it('declares a uniform of two vec2s and a speck of two vec4s, the sizes it is filled at', () => {
    // 16 bytes: a vec2 for the canvas and a vec2 of padding, and nothing else.
    const params = shader.match(/struct Params\s*\{([^}]*)\}/)?.[1] ?? ''
    expect([...params.matchAll(/\w+\s*:\s*vec2<f32>/g)]).toHaveLength(2)
    expect([...params.matchAll(/\w+\s*:/g)]).toHaveLength(2)
    expect(DUST_UNIFORM_FLOATS).toBe(4)
    // 32 bytes, so the storage array's stride is the eight floats a speck is written as.
    const speck = shader.match(/struct Speck\s*\{([^}]*)\}/)?.[1] ?? ''
    expect([...speck.matchAll(/\w+\s*:\s*vec4<f32>/g)]).toHaveLength(2)
    expect([...speck.matchAll(/\w+\s*:/g)]).toHaveLength(2)
    expect(SPECK_FLOATS).toBe(8)
  })

  it('reads the centre, radius and light from the floats the fill writes them to', () => {
    // spot = floats 0 to 3: x, y, radius; light = floats 4 to 7: rgb.
    expect(SPECK_AT).toEqual({ x: 0, y: 1, radius: 2, red: 4, green: 5, blue: 6 })
    expect(shader).toMatch(/speck\.spot\.xy/)
    expect(shader).toMatch(/speck\.spot\.z/)
    expect(shader).toMatch(/speck\.light\.rgb/)
  })

  it('has the entry points the pipeline names', () => {
    expect(shader).toMatch(/@vertex\s+fn quad\(/)
    expect(shader).toMatch(/@fragment\s+fn fs\(/)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    expect(descriptor.vertex.entryPoint).toBe('quad')
    expect(descriptor.fragment?.entryPoint).toBe('fs')
  })
})
