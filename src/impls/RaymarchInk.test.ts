/**
 * The raymarch kit's GPU side against a stand-in for the device, so what it
 * makes once, what it uploads and what it encodes can be counted, and so the
 * bindings it declares can be read against the two shaders that use them. What
 * a march looks like needs a browser; that an ink with nothing to draw costs
 * nothing, that the marched target is not remade every frame, and that the two
 * halves agree about their bindings, does not.
 *
 * It is driven through a subclass of one line, because that is what the kit
 * is: everything below belongs to any ink built on it and none of it belongs
 * to the shape morph.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import type { Tuning } from '../presets/knobs'
import { INK_BLEND } from '../scenes/Impl'
import common from '../shaders/raymarch.common.wgsl?raw'
import upscale from '../shaders/raymarch.upscale.wgsl?raw'
import { HALF_SIZE, MIN_SCALE, raymarchSize } from './raymarch.params'
import { MARCH_FORMAT, RaymarchInk } from './RaymarchInk'

vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 4 })
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 })
vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 1 })

const UNIFORM_FLOATS = 8

type Buffer = { label?: string; size: number; destroyed: boolean; destroy: () => void }
type Texture = {
  width: number
  height: number
  destroyed: boolean
  destroy: () => void
  createView: () => object
}

function fakeDevice() {
  const calls = {
    buffers: [] as Buffer[],
    textures: [] as Texture[],
    modules: [] as string[],
    writes: [] as Float32Array[],
    passes: [] as GPURenderPassDescriptor[],
    draws: [] as number[],
    blend: [] as unknown[],
    pipelines: [] as GPURenderPipelineDescriptor[],
    layouts: [] as GPUBindGroupLayoutDescriptor[],
    groups: [] as GPUBindGroupDescriptor[],
    samplers: 0,
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
    createBuffer: ({ size, label }: { size: number; label?: string }) => {
      const buffer: Buffer = {
        label,
        size,
        destroyed: false,
        destroy: () => (buffer.destroyed = true),
      }
      calls.buffers.push(buffer)
      return buffer
    },
    createTexture: ({ size }: { size: { width: number; height: number } }) => {
      const texture: Texture = {
        width: size.width,
        height: size.height,
        destroyed: false,
        destroy: () => (texture.destroyed = true),
        createView: () => ({ of: texture }),
      }

      calls.textures.push(texture)
      return texture
    },
    createSampler: () => {
      calls.samplers += 1
      return {}
    },
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => {
      calls.layouts.push(descriptor)
      return { descriptor }
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
      writeBuffer: (_buffer: Buffer, _offset: number, data: Float32Array) => {
        calls.writes.push(data.slice())
      },
    },
  }

  const encoder = {
    beginRenderPass: (descriptor: GPURenderPassDescriptor) => {
      calls.passes.push(descriptor)
      return pass
    },
  }

  return {
    calls,
    device: device as unknown as GPUDevice,
    encoder: encoder as unknown as GPUCommandEncoder,
  }
}

/** The smallest ink the kit can carry: it draws while its one knob is over 0. */
class TestInk extends RaymarchInk {
  protected readonly label = 'Test march'
  protected readonly code = 'fn sceneDistance(p: vec3<f32>) -> f32 { return length(p) - 1.0; }'
  protected readonly uniformFloats = UNIFORM_FLOATS
  /** What the last `fill` was handed, so the size the ink marches at can be read. */
  filled: { width: number; height: number; dt: number } | null = null
  scale = HALF_SIZE

  protected scaleOf(): number {
    return this.scale
  }

  protected fill(
    _features: Float32Array,
    dt: number,
    knobs: Tuning,
    _presence: number,
    width: number,
    height: number,
    out: Float32Array,
  ): boolean {
    this.filled = { width, height, dt }
    if ((knobs.intensity ?? 0) <= 0) return false
    out[0] = width
    out[1] = height
    return true
  }
}

const packet = new Float32Array(PACKET_LENGTH)
const view = {} as GPUTextureView
const LIT = { intensity: 1 }
const DARK = { intensity: 0 }

let gpu: ReturnType<typeof fakeDevice>
let ink: TestInk

const draw = (knobs: Tuning, presence = 1) => {
  ink.update(packet, 1 / 60, knobs, presence)
  ink.render(gpu.encoder, view)
}

beforeEach(() => {
  gpu = fakeDevice()
  ink = new TestInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(2560, 1440)
})

describe('the raymarch kit', () => {
  it('prepends the shared half to the ink’s own shader', () => {
    expect(gpu.calls.modules[0]?.startsWith(common)).toBe(true)
    expect(gpu.calls.modules[0]?.endsWith(ink['code'])).toBe(true)
    expect(gpu.calls.modules[1]).toBe(upscale)
  })

  it('makes its pipelines, its sampler and its uniform once, however many frames run', () => {
    for (let frame = 0; frame < 30; frame += 1) draw(LIT)
    expect(gpu.calls.pipelines).toHaveLength(2)
    expect(gpu.calls.buffers).toHaveLength(1)
    expect(gpu.calls.buffers[0]?.size).toBe(UNIFORM_FLOATS * 4)
    expect(gpu.calls.samplers).toBe(1)
    expect(gpu.calls.textures).toHaveLength(1)
    expect(gpu.calls.writes).toHaveLength(30)
  })

  it('marches into a target of its own and adds the result through the ink blend', () => {
    const [march, up] = gpu.calls.pipelines
    expect([...(march?.fragment?.targets ?? [])][0]?.format).toBe(MARCH_FORMAT)
    expect([...(march?.fragment?.targets ?? [])][0]?.blend).toBeUndefined()
    expect([...(up?.fragment?.targets ?? [])][0]?.blend).toBe(INK_BLEND)
    expect([...(up?.fragment?.targets ?? [])][0]?.format).toBe('rgba16float')
  })

  it('names both its bind group layouts rather than deriving them', () => {
    expect(gpu.calls.layouts).toHaveLength(2)
    expect(gpu.calls.layouts[0]?.entries).toHaveLength(1)
    expect([...(gpu.calls.layouts[1]?.entries ?? [])].map((entry) => entry.binding)).toEqual([0, 1])
    for (const pipeline of gpu.calls.pipelines) expect(pipeline.layout).not.toBe('auto')
  })

  it('marches at half the ink target, and hands the ink that size', () => {
    draw(LIT)
    expect(gpu.calls.textures[0]?.width).toBe(1280)
    expect(gpu.calls.textures[0]?.height).toBe(720)
    expect(ink.filled).toMatchObject({ width: 1280, height: 720 })
    expect(ink.detail).toBe('1280x720 marched')
  })

  it('encodes a march and an upscale, one triangle each, with the presence in the blend', () => {
    draw(LIT, 0.4)
    expect(gpu.calls.draws).toEqual([3, 3])
    expect(gpu.calls.passes).toHaveLength(2)
    expect([...(gpu.calls.passes[0]?.colorAttachments ?? [])][0]?.loadOp).toBe('clear')
    expect([...(gpu.calls.passes[1]?.colorAttachments ?? [])][0]?.loadOp).toBe('load')
    expect([...(gpu.calls.passes[1]?.colorAttachments ?? [])][0]?.view).toBe(view)
    expect(gpu.calls.blend).toEqual([{ r: 0.4, g: 0.4, b: 0.4, a: 1 }])
  })

  it('costs nothing at presence 0, or on a frame the ink says is not lit', () => {
    draw(LIT, 0)
    draw(DARK)
    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toHaveLength(0)
    expect(gpu.calls.textures).toHaveLength(0)
    // The ink is still asked, so a clock of its own keeps running while it is
    // dark, which is what a melt that must land on the beat needs.
    expect(ink.filled).not.toBeNull()
  })

  it('remakes its target only when the size it marches at moves', () => {
    draw(LIT)
    draw(LIT)
    expect(gpu.calls.textures).toHaveLength(1)
    expect(gpu.calls.groups).toHaveLength(2)
    ink.resize(1920, 1080)
    draw(LIT)
    expect(gpu.calls.textures).toHaveLength(2)
    expect(gpu.calls.textures[0]?.destroyed).toBe(true)
    // The group that names the target is remade with it, and only with it.
    expect(gpu.calls.groups).toHaveLength(3)
    draw(LIT)
    expect(gpu.calls.groups).toHaveLength(3)
  })

  it('follows a scale the ink chooses, snapped so a live one cannot thrash', () => {
    ink.scale = MIN_SCALE
    draw(LIT)
    expect([gpu.calls.textures[0]?.width, gpu.calls.textures[0]?.height]).toEqual([
      ...raymarchSize(2560, 1440, MIN_SCALE),
    ])
    ink.scale = MIN_SCALE + 0.001
    draw(LIT)
    expect(gpu.calls.textures).toHaveLength(1)
  })

  it('lets go of everything it made when it is disposed', () => {
    draw(LIT)
    ink.dispose()
    expect(gpu.calls.buffers[0]?.destroyed).toBe(true)
    expect(gpu.calls.textures[0]?.destroyed).toBe(true)
    draw(LIT)
    expect(gpu.calls.passes).toHaveLength(2)
  })
})

describe('the shared WGSL and the ink agree', () => {
  it('holds the one binding the march declares, and the two the upscale does', () => {
    expect(common).toContain('@vertex')
    expect(upscale).toContain('@group(0) @binding(0) var marched: texture_2d<f32>;')
    expect(upscale).toContain('@group(0) @binding(1) var bilinear: sampler;')
    for (const pipeline of gpu.calls.pipelines) {
      expect(pipeline.vertex.entryPoint).toBe('vs')
      expect(pipeline.fragment?.entryPoint).toBe('fs')
    }
  })

  it('offers the march the one function every ink has to write, and calls it', () => {
    for (const call of ['sceneDistance(origin + direction', 'sceneDistance(point + a * epsilon)'])
      expect(common).toContain(call)
  })

  it('uses no name WGSL reserves, and assigns to nothing declared with let', () => {
    for (const source of [common, upscale]) {
      for (const word of ['from', 'target', 'filter', 'sample', 'half', 'smooth', 'union'])
        expect(source).not.toMatch(new RegExp(`(let|var|fn|const)\\s+${word}\\b`))
      for (const line of source.split('\n')) {
        const declared = /^\s*let\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line)
        if (!declared?.[1]) continue
        expect(source).not.toMatch(new RegExp(`^\\s*${declared[1]}\\s*=`, 'm'))
      }
    }
  })
})
