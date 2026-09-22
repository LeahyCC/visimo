/**
 * The aurora's GPU side against a stand-in for the device, so what it makes
 * once, what it uploads and what it encodes can be counted, and so the
 * binding it declares can be read against the shader that uses it. What the
 * pass looks like needs a browser; that an ink with nothing to draw costs
 * nothing, and that the two halves of the ink agree about the uniform, does
 * not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import shader from '../shaders/aurora.wgsl?raw'
import { AURORA_DEFAULTS, AURORA_UNIFORM_FLOATS } from './aurora.params'
import { AuroraInk } from './AuroraInk'

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

/** The study's own resting knobs: lit, since intensity and curtains both rest above nothing. */
const LIT = AURORA_DEFAULTS
/** What the gates resolve an unnamed knob set to: no light and no curtain. */
const NOTHING = {}

let gpu: ReturnType<typeof fakeDevice>
let ink: AuroraInk

beforeEach(() => {
  gpu = fakeDevice()
  ink = new AuroraInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
})

describe('the aurora ink', () => {
  it('makes its uniform and its pipeline once, and never remakes them across many frames', () => {
    expect(gpu.calls.buffers.map((buffer) => buffer.size)).toEqual([AURORA_UNIFORM_FLOATS * 4])
    expect(gpu.calls.pipelines).toHaveLength(1)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    const targets = [...(descriptor.fragment?.targets ?? [])]
    expect(targets[0]?.blend).toBe(INK_BLEND)
    for (let frame = 0; frame < 100; frame += 1) {
      ink.update(packet, 1 / 60, LIT, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.buffers).toHaveLength(1)
    expect(gpu.calls.pipelines).toHaveLength(1)
  })

  it('encodes no pass and uploads nothing at presence 0, however bright the passage', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, LIT, 0)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  // What a knob set with no light or no curtain in it resolves to: cast, but nothing to draw.
  it('encodes no pass and uploads nothing while the gates resolve to no light', () => {
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet, 1 / 60, NOTHING, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('uploads one uniform and draws one fullscreen triangle a frame while it is lit', () => {
    ink.update(packet, 1 / 60, LIT, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.writes.map((write) => write.floats)).toEqual([AURORA_UNIFORM_FLOATS])
    expect(gpu.calls.passes).toBe(1)
    expect(gpu.calls.draws).toEqual([[3, undefined]])
  })

  it('carries its presence in the blend constant, which is how an ink fades', () => {
    ink.update(packet, 1 / 60, LIT, 0.25)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.blend).toEqual([{ r: 0.25, g: 0.25, b: 0.25, a: 1 }])
  })

  it('releases its buffer and does nothing after that', () => {
    ink.dispose()
    expect(gpu.calls.buffers.every((buffer) => buffer.destroyed)).toBe(true)
    expect(() => {
      ink.update(packet, 1 / 60, LIT, 1)
      ink.render(gpu.encoder, view)
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

  it('declares the struct in the order the fill writes it, summing to the floats it allocates', () => {
    const body = shader.match(/struct Params\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const order = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((match) => match[1] ?? '')
    expect(order).toEqual(['screen', 'shape', 'colour', 'foot', 'light', 'path', 'span', 'ripples'])

    // Three single vec4s, then five arrays of vec4 at the counts the params
    // file's offsets assume: four curtains apiece and eight ripple slots.
    const singles = new Set(['screen', 'shape', 'colour'])
    const arrayCounts: Record<string, number> = { foot: 4, light: 4, path: 4, span: 4, ripples: 8 }
    let floats = 0
    for (const name of order) {
      if (singles.has(name)) {
        expect(body, name).toMatch(new RegExp(`${name}\\s*:\\s*vec4<f32>,`))
        floats += 4
      } else {
        const found = body.match(new RegExp(`${name}\\s*:\\s*array<vec4<f32>,\\s*(\\d+)>`))
        expect(Number(found?.[1]), name).toBe(arrayCounts[name])
        floats += (arrayCounts[name] ?? 0) * 4
      }
    }

    expect(floats).toBe(AURORA_UNIFORM_FLOATS)
  })

  it('reads each slot of the uniform the fill writes it to', () => {
    // screen: canvas width and height, the fresh light scale, the curtain count.
    expect(shader).toMatch(/params\.screen\.x\b/)
    expect(shader).toMatch(/params\.screen\.y\b/)
    expect(shader).toMatch(/params\.screen\.z\b/)
    expect(shader).toMatch(/params\.screen\.w\b/)
    // shape: the height knob, the sway, the ray sharpness, the ray clock.
    expect(shader).toMatch(/params\.shape\.x\b/)
    expect(shader).toMatch(/params\.shape\.y\b/)
    expect(shader).toMatch(/params\.shape\.z\b/)
    expect(shader).toMatch(/params\.shape\.w\b/)
    // colour: the foot hue, the tip hue, the saturation.
    expect(shader).toMatch(/params\.colour\.x\b/)
    expect(shader).toMatch(/params\.colour\.y\b/)
    expect(shader).toMatch(/params\.colour\.z\b/)
    // Per curtain, read by index: the edge rest, the swing, the tall, and the
    // rays via the whole vector; the light, the shift and the slow share; the
    // path's phases and the sway's; the span's two presence phases.
    expect(shader).toMatch(/place\s*=\s*params\.foot\[k\]/)
    expect(shader).toMatch(/own\s*=\s*params\.light\[k\]/)
    expect(shader).toMatch(/phase\s*=\s*params\.path\[k\]/)
    expect(shader).toMatch(/cover\s*=\s*params\.span\[k\]/)
    expect(shader).toMatch(/place\.x\b/)
    expect(shader).toMatch(/place\.y\b/)
    expect(shader).toMatch(/place\.z\b/)
    expect(shader).toMatch(/place\.w\b/)
    expect(shader).toMatch(/own\.x\b/)
    expect(shader).toMatch(/own\.y\b/)
    expect(shader).toMatch(/own\.z\b/)
    expect(shader).toMatch(/phase\.x\b/)
    expect(shader).toMatch(/phase\.y\b/)
    expect(shader).toMatch(/phase\.z\b/)
    expect(shader).toMatch(/phase\.w\b/)
    expect(shader).toMatch(/cover\.x\b/)
    expect(shader).toMatch(/cover\.y\b/)
    // Ripples, read by a loop over every slot the fill writes.
    expect(shader).toMatch(/ripple\s*=\s*params\.ripples\[r\]/)
    expect(shader).toMatch(/ripple\.x\b/)
    expect(shader).toMatch(/ripple\.y\b/)
    expect(shader).toMatch(/ripple\.z\b/)
    expect(shader).toMatch(/ripple\.w\b/)
  })

  it('loops over the four curtains and the eight ripple slots the uniform allocates', () => {
    expect(shader).toMatch(/for \(var k = 0u; k < 4u;/)
    expect(shader).toMatch(/for \(var r = 0u; r < 8u;/)
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
    expect(shader).toMatch(/return vec4<f32>\(total \* params\.screen\.z, 1\.0\)/)
  })
})
