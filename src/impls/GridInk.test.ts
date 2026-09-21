/**
 * The grid's GPU side against a stand-in for the device, so what it makes once,
 * what it uploads and what it encodes can be counted, and so the module it hands
 * the device can be read. What a line looks like needs a browser; that an ink
 * with nothing to draw costs nothing, and that the layout says the three
 * bindings the shader declares, does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import { GRID_UNIFORM_FLOATS, PULSE_SECONDS } from './grid.params'
import { GridInk } from './GridInk'
import { HEIGHT_BANDS, HEIGHT_COLUMNS, HEIGHT_ROWS, HEIGHT_VIEW_FLOATS } from './height.params'

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
  speed: 4,
  height: 0.8,
  valley: 0.5,
  width: 1,
  glow: 3.2,
  intensity: 1.6,
  pulse: 0,
  hue: 0,
}

const sounding = () => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const band of HEIGHT_BANDS) out[band] = 0.6
  return out
}

let gpu: ReturnType<typeof fakeDevice>
let ink: GridInk

/** Steps the ink through `seconds` of sound, and renders each frame. */
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

const lookWrites = () => gpu.calls.writes.filter((write) => write.label === 'Grid look')
const rowWrites = () => gpu.calls.writes.filter((write) => write.label === 'Height rows')

beforeEach(() => {
  gpu = fakeDevice()
  ink = new GridInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
})

describe('the grid ink', () => {
  it('makes its three buffers and its pipeline once, and adds light through the ink blend', () => {
    expect(gpu.calls.buffers.map((buffer) => [buffer.label, buffer.size])).toEqual([
      ['Height view', HEIGHT_VIEW_FLOATS * 4],
      ['Height rows', HEIGHT_ROWS * HEIGHT_COLUMNS * 4],
      ['Grid look', GRID_UNIFORM_FLOATS * 4],
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

  it('hands the device the kit and the grid as one module', () => {
    expect(gpu.calls.modules).toHaveLength(1)
    expect(gpu.calls.modules[0]).toContain('struct HeightView')
    expect(gpu.calls.modules[0]).toContain('struct Look')
    // The kit first, since the grid's shader calls it.
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
    // 4 units a second is ten rows a second: the first frame's full ring, then a
    // few rows a frame, and never the ring again.
    const rows = rowWrites().reduce((sum, write) => sum + write.floats / HEIGHT_COLUMNS, 0)
    expect(rowWrites()[0]?.floats).toBe(HEIGHT_ROWS * HEIGHT_COLUMNS)
    expect(rows).toBeLessThan(HEIGHT_ROWS + 12)
    // One look and one view a lit frame.
    expect(lookWrites()).toHaveLength(60)
  })

  it('keeps flying while it is dark, and brings the ground up in one go when the sound comes back', () => {
    play({ ...GROOVE, intensity: 0 }, 3, 60)
    expect(gpu.calls.writes).toHaveLength(0)
    play(GROOVE, 1 / 60, 60)
    expect(rowWrites().reduce((sum, write) => sum + write.floats, 0)).toBe(
      HEIGHT_ROWS * HEIGHT_COLUMNS,
    )
  })

  it('scrolls the lines by distance and not by frames: the same phase after the same seconds at any rate', () => {
    const phases = [30, 60, 144].map((fps) => {
      const local = fakeDevice()
      const one = new GridInk()
      one.init({ device: local.device, format: 'rgba16float', software: false })
      one.resize(1920, 1080)
      for (let step = 0; step < Math.round(2.5 * fps); step += 1) {
        one.update(sounding(), 1 / fps, { ...GROOVE, speed: 3 }, 1)
        one.render(local.encoder, view)
      }

      const writes = local.calls.writes.filter((write) => write.label === 'Grid look')
      return writes.at(-1)?.data[8] ?? Number.NaN
    })

    // 3 units a second for 2.5 s, which is a whole number of frames at all three rates, is 7.5 units: half a cell.
    for (const phase of phases) expect(phase).toBeCloseTo(0.5, 4)
  })

  it('starts one pulse on an impact and runs it out in its own time, at any frame rate', () => {
    const strengths = (fps: number) => {
      const local = fakeDevice()
      const one = new GridInk()
      one.init({ device: local.device, format: 'rgba16float', software: false })
      one.resize(1920, 1080)
      const seen: number[] = []
      for (let step = 0; step < Math.round(2 * fps); step += 1) {
        const pulse = step === 0 ? 1 : step < 0.4 * fps ? 0.6 : 0
        one.update(sounding(), 1 / fps, { ...GROOVE, pulse }, 1)
        seen.push(
          local.calls.writes.filter((write) => write.label === 'Grid look').at(-1)?.data[11] ?? 0,
        )
      }

      return seen
        .map((strength, step) => (strength > 0 ? step / fps : -1))
        .filter((time) => time >= 0)
    }

    for (const fps of [30, 60, 144]) {
      const times = strengths(fps)
      // In the air for about a pulse's length, once.
      expect(times.at(-1) ?? 0, `${fps}`).toBeGreaterThan(PULSE_SECONDS * 0.85)
      expect(times.at(-1) ?? 9, `${fps}`).toBeLessThan(PULSE_SECONDS + 0.1)
    }
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
