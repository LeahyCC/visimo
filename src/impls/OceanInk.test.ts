/**
 * The ocean's GPU side against a stand-in for the device, so what it makes
 * once, what it uploads and what it encodes can be counted, and so the module
 * it hands the device can be read. What the water looks like needs a browser;
 * that an ink with nothing to draw costs nothing, and that the layout says
 * the three bindings the shader declares, does not.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import { HEIGHT_BANDS, HEIGHT_COLUMNS, HEIGHT_ROWS, HEIGHT_VIEW_FLOATS } from './height.params'
import { OCEAN_UNIFORM_FLOATS } from './ocean.params'
import { OceanInk } from './OceanInk'

vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 })
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 })

type Buffer = { label: string; size: number; destroyed: boolean; destroy: () => void }

function fakeDevice() {
  const calls = {
    buffers: [] as Buffer[],
    writes: [] as { label: string; floats: number; data: Float32Array }[],
    passes: 0,
    draws: [] as number[],
    blend: [] as unknown[],
    pipelines: [] as GPURenderPipelineDescriptor[],
    layouts: [] as GPUBindGroupLayoutDescriptor[],
    groups: [] as GPUBindGroupDescriptor[],
    modules: [] as string[],
  }

  const pass = {
    setPipeline: vi.fn(),
    setBlendConstant: (colour: unknown) => calls.blend.push(colour),
    setBindGroup: vi.fn(),
    draw: (vertices: number) => calls.draws.push(vertices),
    end: vi.fn(),
  }

  const device = {
    createShaderModule: ({ code }: { code: string }) => {
      calls.modules.push(code)
      return { getCompilationInfo: () => Promise.resolve({ messages: [] }) }
    },
    createBuffer: ({ label, size }: { label: string; size: number }) => {
      const buffer: Buffer = {
        label,
        size,
        destroyed: false,
        destroy: () => (buffer.destroyed = true),
      }
      calls.buffers.push(buffer)
      return buffer
    },
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => {
      calls.layouts.push(descriptor)
      return {}
    },
    createPipelineLayout: () => ({}),
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
      calls.pipelines.push(descriptor)
      return {}
    },
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
      calls.groups.push(descriptor)
      return {}
    },
    queue: {
      writeBuffer: (
        buffer: Buffer,
        _offset: number,
        data: Float32Array,
        dataOffset = 0,
        size = data.length - dataOffset,
      ) => {
        calls.writes.push({
          label: buffer.label,
          floats: size,
          data: data.slice(dataOffset, dataOffset + size),
        })
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

const view = {} as GPUTextureView

/** What the study resolves to over a busy groove, near enough. */
const GROOVE = {
  speed: 2,
  swell: 0.6,
  chop: 0.5,
  path: 0.4,
  glints: 0.3,
  intensity: 2,
  hue: 0,
  horizon: 0.08,
}

const sounding = () => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const band of HEIGHT_BANDS) out[band] = 0.6
  return out
}

let gpu: ReturnType<typeof fakeDevice>
let ink: OceanInk

function play(
  knobs: Record<string, number>,
  seconds: number,
  fps: number,
  presence = 1,
  features = sounding(),
) {
  for (let step = 0; step < Math.round(seconds * fps); step += 1) {
    ink.update(features, 1 / fps, knobs, presence)
    ink.render(gpu.encoder, view)
  }
}

const lookWrites = () => gpu.calls.writes.filter((write) => write.label === 'Ocean look')
const rowWrites = () => gpu.calls.writes.filter((write) => write.label === 'Height rows')

beforeEach(() => {
  gpu = fakeDevice()
  ink = new OceanInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
})

describe('the ocean ink', () => {
  it('makes its three buffers and its pipeline once, and adds light through the ink blend', () => {
    expect(gpu.calls.buffers.map((buffer) => [buffer.label, buffer.size])).toEqual([
      ['Height view', HEIGHT_VIEW_FLOATS * 4],
      ['Height rows', HEIGHT_ROWS * HEIGHT_COLUMNS * 4],
      ['Ocean look', OCEAN_UNIFORM_FLOATS * 4],
    ])
    expect(gpu.calls.pipelines).toHaveLength(1)
    const targets = [...(gpu.calls.pipelines[0]?.fragment?.targets ?? [])]
    expect(targets[0]?.blend).toBe(INK_BLEND)
    play(GROOVE, 2, 60)
    expect(gpu.calls.buffers).toHaveLength(3)
    expect(gpu.calls.pipelines).toHaveLength(1)
  })

  it('names its layout: the kit at 0 and 1 and its own uniform at 2, all read by the fragment stage', () => {
    const entries = [...(gpu.calls.layouts[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0, 1, 2])
    expect(entries.every((entry) => entry.visibility === 2)).toBe(true)
    expect(entries.map((entry) => entry.buffer?.type)).toEqual([
      'uniform',
      'read-only-storage',
      'uniform',
    ])

    expect([...(gpu.calls.groups[0]?.entries ?? [])].map((entry) => entry.binding)).toEqual([
      0, 1, 2,
    ])
  })

  it('hands the device the kit and the sea as one module', () => {
    expect(gpu.calls.modules).toHaveLength(1)
    expect(gpu.calls.modules[0]).toContain('struct HeightView')
    expect(gpu.calls.modules[0]).toContain('struct Look')
    expect(gpu.calls.modules[0]?.indexOf('struct HeightView')).toBeLessThan(
      gpu.calls.modules[0]?.indexOf('struct Look') ?? 0,
    )
  })

  it('has nothing to say on the overlay', () => {
    expect(ink.detail).toBe('')
  })

  it('encodes no pass and uploads nothing on a silent packet, however long', () => {
    play({ ...GROOVE, intensity: 0 }, 5, 60)
    expect(gpu.calls.passes).toBe(0)
    expect(gpu.calls.writes).toHaveLength(0)
  })

  it('encodes nothing and uploads nothing at presence 0', () => {
    play(GROOVE, 2, 60, 0)
    expect(gpu.calls.passes).toBe(0)
    expect(gpu.calls.writes).toHaveLength(0)
  })

  it('draws one triangle in one pass a frame, with the presence in the blend constant', () => {
    play(GROOVE, 1, 60, 0.4)
    expect(gpu.calls.passes).toBe(60)
    expect(gpu.calls.draws.every((vertices) => vertices === 3)).toBe(true)
    expect(gpu.calls.blend[0]).toEqual({ r: 0.4, g: 0.4, b: 0.4, a: 1 })
  })

  it('uploads the whole ring once and then only the rows the flight has crossed', () => {
    play(GROOVE, 1, 60)
    // 2 units a second is five rows a second: the first frame's full ring, then
    // a few rows a frame, and never the ring again.
    const rows = rowWrites().reduce((sum, write) => sum + write.floats / HEIGHT_COLUMNS, 0)
    expect(rowWrites()[0]?.floats).toBe(HEIGHT_ROWS * HEIGHT_COLUMNS)
    expect(rows).toBeLessThan(HEIGHT_ROWS + 8)
    expect(lookWrites()).toHaveLength(60)
  })

  it('keeps flying and the water’s own clock ticking while it is dark', () => {
    play({ ...GROOVE, intensity: 0 }, 3, 60)
    expect(gpu.calls.writes).toHaveLength(0)
    play(GROOVE, 1 / 60, 60)
    expect(rowWrites().reduce((sum, write) => sum + write.floats, 0)).toBe(
      HEIGHT_ROWS * HEIGHT_COLUMNS,
    )
  })

  it('releases everything on dispose and draws nothing after', () => {
    ink.dispose()
    expect(gpu.calls.buffers.every((buffer) => buffer.destroyed)).toBe(true)
    gpu.calls.writes.length = 0
    play(GROOVE, 1, 60)
    expect(gpu.calls.passes).toBe(0)
    expect(gpu.calls.writes).toHaveLength(0)
  })
})
