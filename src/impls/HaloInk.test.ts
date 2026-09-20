/**
 * The halo's GPU side against a stand-in for the device, so what it makes
 * once, what it uploads and what it encodes can be counted, and so the
 * binding it declares can be read against the shader that uses it. What the
 * pass looks like needs a browser; that an ink with nothing to draw costs
 * nothing, and that the two halves of the ink agree about the uniform, does
 * not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import shader from '../shaders/halo.wgsl?raw'
import { HALO_UNIFORM_FLOATS } from './halo.params'
import { HaloInk } from './HaloInk'

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

/** What the study resolves to over a quiet passage, near enough. */
const QUIET = { radius: 0.1, hollow: 0.15, softness: 0.6, intensity: 0.028, hue: 0 }
/** What it resolves to at a silent packet: no size, so nothing to draw. */
const SILENT = { ...QUIET, radius: 0 }
/** What it resolves to a little under nothing, on a near-silent build. */
const UNDER = { ...QUIET, radius: -0.05 }

let gpu: ReturnType<typeof fakeDevice>
let ink: HaloInk

beforeEach(() => {
  gpu = fakeDevice()
  ink = new HaloInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
})

describe('the halo ink', () => {
  it('makes its uniform and its pipeline once, and adds light through the ink blend', () => {
    expect(gpu.calls.buffers.map((buffer) => buffer.size)).toEqual([HALO_UNIFORM_FLOATS * 4])
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

  // What a silent packet resolves to: cast, but a glow of no size.
  it('encodes no pass and uploads nothing while there is no radius, or a radius under nothing', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, SILENT, 1)
      ink.render(gpu.encoder, view)
      ink.update(packet, 1 / 60, UNDER, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('encodes no pass and uploads nothing while there is no light', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, { ...QUIET, intensity: 0 }, 1)
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

  it('uploads one uniform and draws one quad a frame, which is six vertices and no instances', () => {
    ink.update(packet, 1 / 60, QUIET, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.writes.map((write) => write.floats)).toEqual([HALO_UNIFORM_FLOATS])
    expect(gpu.calls.passes).toBe(1)
    expect(gpu.calls.draws).toEqual([[6, undefined]])
  })

  it('hands the shader the canvas it was told about, and a radius against its short side', () => {
    ink.resize(1080, 1920)
    ink.update(packet, 1 / 60, QUIET, 1)
    const data = gpu.calls.writes[0]?.data
    expect([data?.[0], data?.[1]]).toEqual([1080, 1920])
    expect(data?.[2]).toBeCloseTo(0.1 * 1080, 4)
  })

  it('carries its presence in the blend constant, which is how an ink fades', () => {
    ink.update(packet, 1 / 60, QUIET, 0.25)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.blend).toEqual([{ r: 0.25, g: 0.25, b: 0.25, a: 1 }])
  })

  it('stops drawing the frame after the glow goes', () => {
    ink.update(packet, 1 / 60, QUIET, 1)
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
      const other = new HaloInk()
      other.init({ device: fresh.device, format: 'rgba16float', software: false })
      other.resize(1920, 1080)
      for (let frame = 0; frame < 5; frame += 1) other.update(packet, dt, QUIET, 1)
      return fresh.calls.writes.at(-1)?.data
    }

    expect(at(1 / 144)).toEqual(at(1 / 30))
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
    const bare = new HaloInk()
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
  it('reads binding 0 as the uniform, in both stages, as the layout says', () => {
    expect(shader).toMatch(/@group\(0\)\s+@binding\(0\)\s+var<uniform>\s+params\s*:\s*Params/)
    const entries = [...(gpu.calls.layouts[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0])
    expect(entries[0]?.buffer?.type).toBe('uniform')
    // The vertex stage sizes the quad and the fragment stage shapes the light.
    expect(entries[0]?.visibility).toBe(1 | 2)
    const vertex = shader.slice(shader.indexOf('@vertex'), shader.indexOf('@fragment'))
    const fragment = shader.slice(shader.indexOf('@fragment'))
    expect(vertex).toMatch(/params\.screen/)
    expect(fragment).toMatch(/params\.shape/)
    expect(fragment).toMatch(/params\.light/)
  })

  it('binds the uniform to binding 0', () => {
    const entries = [...(gpu.calls.groups[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0])
    expect((entries[0]?.resource as GPUBufferBinding).buffer).toBe(gpu.calls.buffers[0])
  })

  it('declares three vec4s, which is the twelve floats the fill writes, in the order it writes them', () => {
    const body = shader.match(/struct Params\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const order = [...body.matchAll(/^\s*(\w+)\s*:\s*vec4<f32>,/gm)].map((match) => match[1])
    expect(order).toEqual(['screen', 'shape', 'light'])
    expect(order.length * 4).toBe(HALO_UNIFORM_FLOATS)
  })

  it('reads each part of the uniform from the slot the fill writes it to', () => {
    // screen: canvas x and y, and the radius in pixels.
    expect(shader).toMatch(/0\.5\s*\*\s*params\.screen\.xy/)
    expect(shader).toMatch(/corner\s*\*\s*params\.screen\.z/)
    expect(shader).toMatch(/params\.screen\.x\b/)
    expect(shader).toMatch(/params\.screen\.y\b/)
    // shape: the peak's place, the dip and the exponent.
    expect(shader).toMatch(/params\.shape\.x/)
    expect(shader).toMatch(/params\.shape\.y/)
    expect(shader).toMatch(/params\.shape\.z/)
    // light: rgb, already times the intensity.
    expect(shader).toMatch(/params\.light\.rgb/)
  })

  it('makes the falloff the one the params file mirrors: a smoothstep raised to the exponent, zero at the edge', () => {
    expect(shader).toMatch(/u \* u \* \(3\.0 - 2\.0 \* u\)/)
    expect(shader).toMatch(/pow\(smooth_u, params\.shape\.z\)/)
    expect(shader).toMatch(/\(1\.0 - d\) \/ \(1\.0 - peak\)/)
    expect(shader).toMatch(/1\.0 - params\.shape\.y \* \(1\.0 - d \/ peak\)/)
    expect(shader).toMatch(/select\(0\.0, pow\(smooth_u, params\.shape\.z\), smooth_u > 0\.0\)/)
  })

  it('has the entry points the pipeline names, and draws a quad of six corners', () => {
    expect(shader).toMatch(/@vertex\s+fn quad\(/)
    expect(shader).toMatch(/@fragment\s+fn fs\(/)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    expect(descriptor.vertex.entryPoint).toBe('quad')
    expect(descriptor.fragment?.entryPoint).toBe('fs')
    expect(shader).toMatch(/array<vec2<f32>, 6>/)
  })

  it('writes alpha as 1 and the light in rgb, which the blend leaves alone', () => {
    expect(shader).toMatch(/return vec4<f32>\(params\.light\.rgb \* light, 1\.0\)/)
  })
})
