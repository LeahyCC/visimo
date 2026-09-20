/**
 * The caustics' GPU side against a stand-in for the device, so what it makes
 * once, what it uploads and what it encodes can be counted, and so the
 * binding it declares can be read against the shader that uses it. What the
 * pass looks like needs a browser; that an ink with nothing to draw costs
 * nothing, and that the two halves of the ink agree about the uniform, does
 * not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import shader from '../shaders/caustics.wgsl?raw'
import { CAUSTICS_UNIFORM_FLOATS, WAVES } from './caustics.params'
import { CausticsInk } from './CausticsInk'

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
  }

  const pass = {
    setPipeline: vi.fn(),
    setBlendConstant: (colour: unknown) => calls.blend.push(colour),
    setBindGroup: vi.fn(),
    draw: (vertices: number, instances?: number) => calls.draws.push([vertices, instances]),
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

/** What the study resolves to over a quiet tonal passage, near enough. */
const QUIET = { intensity: 0.2, scale: 4, speed: 0.1, sharpness: 8, hueSpread: 0.12 }
/** What it resolves to at a silent packet: no light. */
const SILENT = { ...QUIET, intensity: 0 }

let gpu: ReturnType<typeof fakeDevice>
let ink: CausticsInk

beforeEach(() => {
  gpu = fakeDevice()
  ink = new CausticsInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
})

describe('the caustics ink', () => {
  it('makes its uniform and its pipeline once, and adds light through the ink blend', () => {
    expect(gpu.calls.buffers.map((buffer) => buffer.size)).toEqual([CAUSTICS_UNIFORM_FLOATS * 4])
    expect(gpu.calls.pipelines).toHaveLength(1)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    const targets = [...(descriptor.fragment?.targets ?? [])]
    expect(targets[0]?.blend).toBe(INK_BLEND)
    ink.update(packet, 1 / 60, QUIET, 1)
    ink.update(packet, 1 / 60, QUIET, 1)
    expect(gpu.calls.buffers).toHaveLength(1)
    expect(gpu.calls.pipelines).toHaveLength(1)
  })

  it('says nothing of its own on the overlay', () => {
    expect(ink.detail).toBe('')
  })

  // What a silent packet resolves to: cast, but nothing to draw.
  it('encodes no pass and uploads nothing while there is no light', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, SILENT, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('encodes no pass and uploads nothing at presence 0, however bright the passage', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, QUIET, 0)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('uploads one uniform and draws one fullscreen triangle a frame', () => {
    ink.update(packet, 1 / 60, QUIET, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.writes.map((write) => write.floats)).toEqual([CAUSTICS_UNIFORM_FLOATS])
    expect(gpu.calls.passes).toBe(1)
    expect(gpu.calls.draws).toEqual([[3, undefined]])
  })

  it('hands the shader the canvas it was told about', () => {
    ink.resize(2560, 1440)
    ink.update(packet, 1 / 60, QUIET, 1)
    const data = gpu.calls.writes[0]?.data
    expect([data?.[0], data?.[1]]).toEqual([2560, 1440])
    expect(data?.[2]).toBe(8)
  })

  it('carries its presence in the blend constant, which is how an ink fades', () => {
    ink.update(packet, 1 / 60, QUIET, 0.25)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.blend).toEqual([{ r: 0.25, g: 0.25, b: 0.25, a: 1 }])
  })

  it('stops drawing the frame after the light goes', () => {
    ink.update(packet, 1 / 60, QUIET, 1)
    ink.render(gpu.encoder, view)
    ink.update(packet, 1 / 60, SILENT, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(1)
  })

  it('keeps its clocks running while there is no light, so the pattern that comes in is mid-drift', () => {
    const fresh = new CausticsInk()
    const other = fakeDevice()
    fresh.init({ device: other.device, format: 'rgba16float', software: false })
    fresh.resize(1920, 1080)
    for (let frame = 0; frame < 120; frame += 1) fresh.update(packet, 1 / 60, SILENT, 1)
    fresh.update(packet, 1 / 60, QUIET, 1)
    ink.update(packet, 1 / 60, QUIET, 1)
    // Two seconds have turned the waves, so the two uniforms do not agree.
    const later = other.calls.writes[0]?.data
    const first = gpu.calls.writes[0]?.data
    expect(later?.[4]).not.toBeCloseTo(first?.[4] ?? Number.NaN, 3)
  })

  it('releases its buffer and does nothing after that', () => {
    ink.dispose()
    expect(gpu.calls.buffers.every((buffer) => buffer.destroyed)).toBe(true)
    expect(() => {
      ink.update(packet, 1 / 60, QUIET, 1)
      ink.render(gpu.encoder, view)
    }).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })

  it('does nothing before it has a device', () => {
    const bare = new CausticsInk()
    expect(() => {
      bare.update(packet, 1 / 60, QUIET, 1)
      bare.render(gpu.encoder, view)
    }).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })
})

// WGSL is compiled only by a browser, so what can be checked here is that the
// two halves agree about the buffer: the binding number and kind, the size of
// the uniform, and where each thing sits in it.
describe('the shader against the uniform it reads', () => {
  it('reads binding 0 as the uniform, in the fragment stage only, as the layout says', () => {
    expect(shader).toMatch(/@group\(0\)\s+@binding\(0\)\s+var<uniform>\s+params\s*:\s*Params/)
    const entries = [...(gpu.calls.layouts[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0])
    expect(entries[0]?.buffer?.type).toBe('uniform')
    expect(entries[0]?.visibility).toBe(2)
    // The vertex stage draws the triangle and reads nothing of it.
    const vertex = shader.slice(shader.indexOf('@vertex'), shader.indexOf('@fragment'))
    expect(vertex).not.toMatch(/params\./)
  })

  it('binds the uniform to binding 0', () => {
    const entries = [...(gpu.calls.groups[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0])
    expect((entries[0]?.resource as GPUBufferBinding).buffer).toBe(gpu.calls.buffers[0])
  })

  it('declares eleven vec4s, which is the forty-four floats the fill writes', () => {
    const body = shader.match(/struct Params\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const single = [...body.matchAll(/^\s*(\w+)\s*:\s*vec4<f32>,/gm)].map((match) => match[1])
    const waves = body.match(/waves\s*:\s*array<vec4<f32>,\s*(\d+)>/)
    // In the order the file lays them out.
    expect(single).toEqual(['screen', 'phase', 'tint', 'shape', 'low', 'mid', 'high'])
    expect(Number(waves?.[1])).toBe(WAVES.length)
    expect(single.length + WAVES.length).toBe(CAUSTICS_UNIFORM_FLOATS / 4)
    // Arrays of vec4 keep their 16 byte stride in a uniform, so the waves sit
    // between `shape` and `low` at floats 16 to 31.
    const order = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((match) => match[1])
    expect(order).toEqual(['screen', 'phase', 'tint', 'shape', 'waves', 'low', 'mid', 'high'])
  })

  it('reads each part of the uniform from the slot the fill writes it to', () => {
    // screen: canvas x, y and sharpness.
    expect(shader).toMatch(/params\.screen\.xy/)
    expect(shader).toMatch(/params\.screen\.x\b/)
    expect(shader).toMatch(/params\.screen\.z/)
    // phase: the four offsets, by component.
    for (const part of ['x', 'y', 'z', 'w']) expect(shader).toContain(`params.phase.${part}`)
    // shape: the band, the least width in pixels, and the cut.
    expect(shader).toMatch(/params\.shape\.x/)
    expect(shader).toMatch(/params\.shape\.y/)
    expect(shader).toMatch(/params\.shape\.z/)
    // tint: the gradient across x and y, and its phase.
    expect(shader).toMatch(/params\.tint\.x/)
    expect(shader).toMatch(/params\.tint\.y/)
    expect(shader).toMatch(/params\.tint\.z/)
    // Each wave's vec4 is a direction, cycles and focus.
    expect(shader).toMatch(/wave\.z\s*\*\s*dot\(wave\.xy,\s*at\)/)
    expect(shader).toMatch(/wave\.w\s*\*\s*sin\(angle\)/)
    // Three colours, blended low to mid to high.
    for (const colour of ['low', 'mid', 'high']) expect(shader).toContain(`params.${colour}.rgb`)
  })

  it('loops over as many waves as the params file has', () => {
    expect(shader).toMatch(new RegExp(`for \\(var i = 0u; i < ${WAVES.length}u;`))
    expect(shader).toMatch(new RegExp(`array<f32, ${WAVES.length}>`))
    expect(shader).toMatch(new RegExp(`b < ${WAVES.length}u`))
  })

  it('has the entry points the pipeline names, and one triangle covers the frame', () => {
    expect(shader).toMatch(/@vertex\s+fn vs\(/)
    expect(shader).toMatch(/@fragment\s+fn fs\(/)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    expect(descriptor.vertex.entryPoint).toBe('vs')
    expect(descriptor.fragment?.entryPoint).toBe('fs')
    // Three vertices from the index, the way the other fullscreen passes do it.
    expect(shader).toMatch(/\(i << 1u\) & 2u/)
    expect(shader).toMatch(/f32\(i & 2u\)/)
  })

  it('writes alpha as 1 and the light in rgb, which the blend leaves alone', () => {
    expect(shader).toMatch(/return vec4<f32>\(colour \* line, 1\.0\)/)
  })
})
