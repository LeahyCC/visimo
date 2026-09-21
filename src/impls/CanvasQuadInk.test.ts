/**
 * The canvas sampler, through the one ink that uses it. Two halves: that the
 * post stack offers back the half of its history it is not writing this frame,
 * which is the whole correctness claim, and that an ink handed that texture
 * binds it, draws once and encodes nothing when there is none.
 *
 * `CanvasQuadInk` is not registered with the director and no study names it.
 * It exists for this file.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import { PostStack, SCENE_FORMAT } from '../post/PostStack'
import { INK_BLEND } from '../scenes/Impl'
import type { CanvasSample, SceneContext } from '../scenes/Scene'
import shader from '../shaders/canvas.quad.wgsl?raw'
import {
  CANVAS_QUAD_UNIFORM_FLOATS,
  CanvasQuadInk,
  DEFAULT_QUAD,
  MAX_GAIN,
  writeCanvasQuadUniform,
} from './CanvasQuadInk'

vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 })
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 })
vi.stubGlobal('GPUTextureUsage', {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
})

type Buffer = { size: number; destroyed: boolean; destroy: () => void }

function fakeDevice() {
  const calls = {
    writes: [] as Float32Array[],
    passes: 0,
    draws: [] as number[],
    blend: [] as unknown[],
    layouts: [] as GPUBindGroupLayoutDescriptor[],
    groups: [] as GPUBindGroupDescriptor[],
    pipelines: [] as GPURenderPipelineDescriptor[],
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
    createBuffer: ({ size }: { size: number }) => {
      const buffer: Buffer = { size, destroyed: false, destroy: () => (buffer.destroyed = true) }
      return buffer
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
      writeBuffer: (_b: Buffer, _o: number, data: Float32Array) => calls.writes.push(data.slice()),
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
let ink: CanvasQuadInk

beforeEach(() => {
  gpu = fakeDevice()
  picture = null
  const context: SceneContext = {
    device: gpu.device,
    format: 'rgba16float',
    software: false,
    canvas: () => picture,
  }
  ink = new CanvasQuadInk()
  ink.init(context)
})

describe('an ink that reads the canvas', () => {
  it('names its layout rather than deriving one, and adds light through the ink blend', () => {
    expect(gpu.calls.layouts).toHaveLength(1)
    expect([...(gpu.calls.layouts[0]?.entries ?? [])].map((entry) => entry.binding)).toEqual([
      0, 1, 2,
    ])
    expect(gpu.calls.pipelines[0]?.layout).not.toBe('auto')
    const targets = [...(gpu.calls.pipelines[0]?.fragment?.targets ?? [])]
    expect(targets[0] && 'blend' in targets[0] ? targets[0].blend : null).toBe(INK_BLEND)
  })

  it('encodes nothing before the first frame has been composited', () => {
    ink.update(packet, 1 / 60, {}, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(0)
    expect(gpu.calls.writes).toEqual([])
  })

  it('binds last frame’s canvas and draws one quad once there is one', () => {
    const last = { picture: true } as unknown as GPUTextureView
    picture = { view: last, width: 1920, height: 1080 }
    ink.update(packet, 1 / 60, {}, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(1)
    expect(gpu.calls.draws).toEqual([6])
    expect([...(gpu.calls.groups[0]?.entries ?? [])][1]?.resource).toBe(last)
  })

  it('rebuilds its group only when the half of the history it reads alternates', () => {
    const first = { a: true } as unknown as GPUTextureView
    const second = { b: true } as unknown as GPUTextureView
    picture = { view: first, width: 8, height: 8 }
    for (let frame = 0; frame < 4; frame += 1) {
      ink.update(packet, 1 / 60, {}, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.groups).toHaveLength(1)
    picture = { view: second, width: 8, height: 8 }
    ink.update(packet, 1 / 60, {}, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.groups).toHaveLength(2)
  })

  it('encodes nothing at presence 0 or with no gain', () => {
    picture = { view: {} as GPUTextureView, width: 8, height: 8 }
    ink.update(packet, 1 / 60, {}, 0)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(0)
    ink.setQuad({ ...DEFAULT_QUAD, gain: 0 })
    ink.update(packet, 1 / 60, {}, 1)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.passes).toBe(0)
  })

  it('puts the presence in the blend constant', () => {
    picture = { view: {} as GPUTextureView, width: 8, height: 8 }
    ink.update(packet, 1 / 60, {}, 0.3)
    ink.render(gpu.encoder, view)
    expect(gpu.calls.blend).toEqual([{ r: 0.3, g: 0.3, b: 0.3, a: 1 }])
  })

  // The picture already holds what this ink drew a frame ago, so a gain of one
  // over a quad that covers the frame is a loop with no decay in it. Holding
  // the gain under one is what makes each trip round dimmer than the last.
  it('holds the gain under one, whatever it is handed', () => {
    const out = new Float32Array(CANVAS_QUAD_UNIFORM_FLOATS)
    expect(writeCanvasQuadUniform({ ...DEFAULT_QUAD, gain: 5 }, out)[8]).toBeCloseTo(MAX_GAIN, 6)
    expect(writeCanvasQuadUniform({ ...DEFAULT_QUAD, gain: -1 }, out)[8]).toBe(0)
    expect(MAX_GAIN).toBeLessThan(1)
    expect(DEFAULT_QUAD.gain).toBeLessThan(MAX_GAIN)
  })

  it('lays the quad and its source out as the shader reads them', () => {
    const out = new Float32Array(CANVAS_QUAD_UNIFORM_FLOATS)
    writeCanvasQuadUniform(
      {
        centre: [0.25, 0.75],
        half: [0.1, 0.2],
        source: [0.4, 0.6],
        sourceHalf: [0.3, 0.35],
        gain: 0.5,
      },
      out,
    )

    const wanted = [0.25, 0.75, 0.1, 0.2, 0.4, 0.6, 0.3, 0.35, 0.5, 0, 0, 0]
    for (let slot = 0; slot < CANVAS_QUAD_UNIFORM_FLOATS; slot += 1)
      expect(out[slot], `float ${slot}`).toBeCloseTo(wanted[slot] ?? 0, 6)
    expect(shader).toContain('@group(0) @binding(0) var<uniform> params: Params;')
    expect(shader).toContain('@group(0) @binding(1) var canvas: texture_2d<f32>;')
    expect(shader).toContain('@group(0) @binding(2) var samp: sampler;')
    expect(shader).toContain('fn quad(')
    expect(shader).toContain('fn fs(')
  })
})

/**
 * The stack's half of the promise, against a stand-in device: what it offers
 * back is the history the inks are not drawing into, and it offers nothing
 * before a frame has been composited.
 */
describe('what the post stack offers back', () => {
  function stackDevice() {
    const made: { view: { id: number }; texture: { destroy: () => void } }[] = []
    let next = 0
    const device = {
      createShaderModule: () => ({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
      createBuffer: () => ({ destroy: vi.fn() }),
      createSampler: () => ({}),
      createBindGroupLayout: () => ({}),
      createPipelineLayout: () => ({}),
      createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
      createBindGroup: () => ({}),
      createTexture: () => {
        const entry = { view: { id: next++ }, texture: { destroy: vi.fn() } }
        made.push(entry)
        return { createView: () => entry.view, destroy: entry.texture.destroy }
      },
      queue: { writeBuffer: vi.fn(), writeTexture: vi.fn() },
    }

    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setBlendConstant: vi.fn(),
      setVertexBuffer: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    }

    return {
      device: device as unknown as GPUDevice,
      encoder: { beginRenderPass: () => pass } as unknown as GPUCommandEncoder,
    }
  }

  it('offers nothing before a frame has been composited, and the other half after', () => {
    const gear = stackDevice()
    const stack = new PostStack()
    stack.init(gear.device, SCENE_FORMAT)
    expect(stack.lastCanvas).toBeNull()

    const first = stack.target(320, 240)
    expect(first).not.toBeNull()
    // Still nothing: the inks have drawn into `first`, and there is no frame
    // behind it for them to read.
    expect(stack.lastCanvas).toBeNull()
    stack.render(gear.encoder, view, packet)

    // The frame just composited is now what an ink reads, and the inks are
    // handed the other half to draw into.
    const behind = stack.lastCanvas
    expect(behind?.view).toBe(first)
    expect(behind?.width).toBe(320)
    expect(behind?.height).toBe(240)
    const second = stack.target(320, 240)
    expect(second).not.toBe(first)
    expect(stack.lastCanvas?.view).toBe(first)

    // And it alternates, so an ink is never reading the texture it is writing.
    stack.render(gear.encoder, view, packet)
    expect(stack.lastCanvas?.view).toBe(second)
    expect(stack.target(320, 240)).toBe(first)
  })

  it('offers nothing again once the trails have been reset', () => {
    const gear = stackDevice()
    const stack = new PostStack()
    stack.init(gear.device, SCENE_FORMAT)
    stack.target(320, 240)
    stack.render(gear.encoder, view, packet)
    expect(stack.lastCanvas).not.toBeNull()
    stack.resetHistory()
    expect(stack.lastCanvas).toBeNull()
  })
})
