/**
 * The black hole ink against a stand-in device: what it makes once, what it
 * uploads and encodes on a frame it draws, and the four things it must not do
 * (draw at presence 0, draw on a silent packet, derive its bind group layout,
 * or rebuild its group on a frame the canvas has not alternated).
 *
 * It is the second ink to read the canvas sampler, so the half of this file
 * about binding last frame's picture is `CanvasQuadInk.test.ts`'s question
 * asked again of a study. The numbers it draws with are
 * `blackhole.params.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import type { CanvasSample, SceneContext } from '../scenes/Scene'
import { bendGain, blackHoleParams } from './blackhole.params'
import { BlackHoleInk } from './BlackHoleInk'

vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 })
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 })
vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 })

/** What the study rests at, which is what a resolved frame hands the ink. */
const KNOBS = {
  disc: 0.08,
  width: 0.011,
  annulus: 0.075,
  heat: 0.85,
  beam: 0.5,
  bend: 0.5,
  intensity: 1.15,
  hue: 0,
  spin: 0,
}

/** Nothing resolved, which is what a silent packet leaves: no light at all. */
const DARK = { ...KNOBS, intensity: 0 }

function fakeDevice() {
  const calls = {
    writes: [] as Float32Array[],
    passes: 0,
    draws: [] as number[],
    blend: [] as unknown[],
    layouts: [] as GPUBindGroupLayoutDescriptor[],
    groups: [] as GPUBindGroupDescriptor[],
    pipelines: [] as GPURenderPipelineDescriptor[],
    textures: 0,
    destroyed: 0,
  }

  const pass = {
    setPipeline: vi.fn(),
    setBlendConstant: (colour: unknown) => calls.blend.push(colour),
    setBindGroup: vi.fn(),
    draw: (vertices: number) => calls.draws.push(vertices),
    end: vi.fn(),
  }

  const device = {
    createShaderModule: () => ({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
    createBuffer: ({ size }: { size: number }) => ({
      size,
      destroy: () => (calls.destroyed += 1),
    }),
    createTexture: () => {
      calls.textures += 1
      return { createView: () => ({ still: true }), destroy: () => (calls.destroyed += 1) }
    },
    createSampler: () => ({ sampler: true }),
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => {
      calls.layouts.push(descriptor)
      return { layout: true }
    },
    createPipelineLayout: () => ({}),
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
      calls.pipelines.push(descriptor)
      return {}
    },
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
      calls.groups.push(descriptor)
      return { group: true }
    },
    queue: {
      writeBuffer: (_b: unknown, _o: number, data: Float32Array) => calls.writes.push(data.slice()),
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
const packet = new Float32Array(PACKET_LENGTH)

let gpu: ReturnType<typeof fakeDevice>
let picture: CanvasSample | null
let ink: BlackHoleInk

const lastFrame = (id: number) =>
  ({ view: { id } as unknown as GPUTextureView, width: 1920, height: 1080 }) as CanvasSample

beforeEach(() => {
  gpu = fakeDevice()
  picture = null
  const context: SceneContext = {
    device: gpu.device,
    format: 'rgba16float',
    software: false,
    canvas: () => picture,
  }
  ink = new BlackHoleInk()
  ink.init(context)
  ink.resize(1920, 1080)
})

describe('what it makes and what it draws', () => {
  it('names its layout rather than deriving one, and adds light through the ink blend', () => {
    expect(gpu.calls.layouts).toHaveLength(1)
    expect([...(gpu.calls.layouts[0]?.entries ?? [])].map((entry) => entry.binding)).toEqual([
      0, 1, 2,
    ])
    expect(gpu.calls.pipelines[0]?.layout).not.toBe('auto')
    const targets = [...(gpu.calls.pipelines[0]?.fragment?.targets ?? [])]
    expect(targets[0] && 'blend' in targets[0] ? targets[0].blend : null).toBe(INK_BLEND)
  })

  it('makes its buffer, its sampler and its one stand-in texel once', () => {
    expect(gpu.calls.textures).toBe(1)
    picture = lastFrame(1)
    for (let frame = 0; frame < 5; frame += 1) {
      ink.update(packet, 1 / 60, KNOBS, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.textures).toBe(1)
    expect(gpu.calls.pipelines).toHaveLength(1)
  })

  it('encodes nothing and uploads nothing at presence 0', () => {
    picture = lastFrame(1)
    ink.update(packet, 1 / 60, KNOBS, 0)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(0)
    expect(gpu.calls.writes).toEqual([])
  })

  it('encodes nothing and uploads nothing on a silent packet', () => {
    picture = lastFrame(1)
    ink.update(packet, 1 / 60, DARK, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(0)
    expect(gpu.calls.writes).toEqual([])
  })

  it('draws one quad and uploads one block on a frame it is lit', () => {
    picture = lastFrame(1)
    ink.update(packet, 1 / 60, KNOBS, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(1)
    expect(gpu.calls.draws).toEqual([6])
    expect(gpu.calls.writes).toHaveLength(1)
  })

  it('puts the presence in the blend constant', () => {
    picture = lastFrame(1)
    ink.update(packet, 1 / 60, KNOBS, 0.4)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.blend).toEqual([{ r: 0.4, g: 0.4, b: 0.4, a: 1 }])
  })

  it('releases its buffer and its texel on dispose', () => {
    ink.dispose()
    expect(gpu.calls.destroyed).toBe(2)
  })
})

describe('the canvas it reads', () => {
  it('binds last frame’s picture and rebuilds its group only when that alternates', () => {
    const first = lastFrame(1)
    picture = first
    for (let frame = 0; frame < 4; frame += 1) {
      ink.update(packet, 1 / 60, KNOBS, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.groups).toHaveLength(1)
    expect([...(gpu.calls.groups[0]?.entries ?? [])][1]?.resource).toBe(first.view)

    picture = lastFrame(2)
    ink.update(packet, 1 / 60, KNOBS, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.groups).toHaveLength(2)
  })

  // The ring is the study; the annulus is what needs a picture. With none,
  // which is the frame after the trails are reset, the ring still draws and
  // the gain goes to nothing rather than the whole ink going dark.
  it('still draws the ring with no canvas, at a gain of nothing', () => {
    picture = null
    ink.update(packet, 1 / 60, KNOBS, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(1)
    expect(gpu.calls.writes[0]?.[12]).toBe(0)
    // And the stand-in texel is what it bound, not an uninitialised view.
    expect([...(gpu.calls.groups[0]?.entries ?? [])][1]?.resource).toEqual({ still: true })
  })

  it('writes the gain the step is worth once there is a picture', () => {
    picture = lastFrame(1)
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      ink.update(packet, dt, KNOBS, 1)
      ink.render(gpu.encoder, view)
    }

    const wanted = [1 / 30, 1 / 60, 1 / 144].map((dt) => bendGain(blackHoleParams(KNOBS), dt))
    gpu.calls.writes.forEach((write, at) => expect(write[12]).toBeCloseTo(wanted[at] ?? 0, 6))
  })

  it('takes the key from the packet, so both hues turn with the song', () => {
    picture = lastFrame(1)
    const keyed = new Float32Array(PACKET_LENGTH)
    keyed[F.keyHue] = 0.3
    ink.update(keyed, 1 / 60, KNOBS, 1)
    ink.render(gpu.encoder, view)
    const hot = gpu.calls.writes[0]?.[16] ?? 0
    const cool = gpu.calls.writes[0]?.[17] ?? 0
    expect(hot).toBeGreaterThan(0.3)
    expect(cool - hot).toBeCloseTo(1 / 3, 5)
  })
})
