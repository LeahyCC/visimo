/**
 * The ink against a device that only counts, since a browser is the only thing
 * that compiles WGSL and draws. What this can say is what the ink asks of the
 * GPU and when: nothing between drops, one small upload and one pass while a
 * burst is flying, the presence in the blend constant and nowhere else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import shader from '../shaders/shards.wgsl?raw'
import { SHARD_BYTES, SHARD_FLOATS, SHARD_POOL, SHARD_UNIFORM_FLOATS } from './shards.params'
import { ShardsInk } from './ShardsInk'

type Made = { label?: string; size: number; usage: number; destroy: () => void }
type Write = {
  target: Made
  data: Float32Array
  from: number | undefined
  count: number | undefined
}

function fake() {
  const buffers: Made[] = []
  const writes: Write[] = []
  const passes: {
    descriptor: unknown
    blend: unknown[]
    draws: [number, number | undefined][]
    vertexBuffers: unknown[]
  }[] = []
  let pipeline: GPURenderPipelineDescriptor | null = null
  const device = {
    createShaderModule: () => ({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
    createBuffer: (descriptor: { label?: string; size: number; usage: number }) => {
      const made: Made = { ...descriptor, destroy: vi.fn() }
      buffers.push(made)
      return made
    },
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
      pipeline = descriptor
      return { getBindGroupLayout: () => ({}) }
    },
    createBindGroup: () => ({}),
    queue: {
      writeBuffer: (
        target: Made,
        _offset: number,
        data: Float32Array,
        from?: number,
        count?: number,
      ) => writes.push({ target, data, from, count }),
    },
  } as unknown as GPUDevice
  const encoder = {
    beginRenderPass: (descriptor: unknown) => {
      const pass = {
        descriptor,
        blend: [] as unknown[],
        draws: [] as [number, number | undefined][],
        vertexBuffers: [] as unknown[],
      }
      passes.push(pass)
      return {
        setPipeline: () => {},
        setBindGroup: () => {},
        setBlendConstant: (value: unknown) => pass.blend.push(value),
        setVertexBuffer: (_slot: number, buffer: unknown) => pass.vertexBuffers.push(buffer),
        draw: (vertices: number, instances?: number) => pass.draws.push([vertices, instances]),
        end: () => {},
      }
    },
  } as unknown as GPUCommandEncoder

  return { device, encoder, buffers, writes, passes, pipeline: () => pipeline }
}

const packet = (rows: Record<number, number> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [row, value] of Object.entries(rows)) out[Number(row)] = value
  return out
}

const VIEW = {} as GPUTextureView

beforeEach(() => {
  vi.stubGlobal('GPUBufferUsage', { VERTEX: 0x20, COPY_DST: 0x08, UNIFORM: 0x40 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function start() {
  const gpu = fake()
  const ink = new ShardsInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
  const instances = gpu.buffers.find((made) => made.label === 'Shards instances')
  const uniform = gpu.buffers.find((made) => made.label === 'Shards view')
  if (!instances || !uniform) throw new Error('Expected both buffers')
  const uploads = () => gpu.writes.filter((write) => write.target === instances)
  return { ...gpu, ink, instances, uniform, uploads }
}

describe('between drops', () => {
  it('uploads nothing and encodes nothing while the pool is empty', () => {
    const { ink, encoder, passes, uploads } = start()
    for (let frame = 0; frame < 600; frame += 1) {
      ink.update(packet({ [F.energy]: 0.9, [F.bass]: 0.9 }), 1 / 60, {}, 1)
      ink.render(encoder, VIEW)
    }

    expect(uploads()).toHaveLength(0)
    expect(passes).toHaveLength(0)
    expect(ink.detail).toBe('')
  })

  it('makes its buffers once, at the size of the pool, and never again', () => {
    const { ink, buffers, instances, uniform } = start()
    for (let frame = 0; frame < 60; frame += 1)
      ink.update(packet({ [F.impact]: frame === 0 ? 1 : 0 }), 1 / 60, {}, 1)
    expect(buffers).toHaveLength(2)
    expect(instances.size).toBe(SHARD_POOL * SHARD_BYTES)
    expect(uniform.size).toBe(SHARD_UNIFORM_FLOATS * 4)
  })

  it('writes the aspect when the size changes and not per frame', () => {
    const { ink, writes, uniform } = start()
    const after = writes.filter((write) => write.target === uniform).length
    for (let frame = 0; frame < 60; frame += 1) ink.update(packet(), 1 / 60, {}, 1)
    expect(writes.filter((write) => write.target === uniform)).toHaveLength(after)
    ink.resize(1000, 1000)
    const last = writes.filter((write) => write.target === uniform).at(-1)
    expect(last?.data[0]).toBe(1)
  })
})

describe('on a drop', () => {
  it('uploads the living rows and draws them in one call', () => {
    const { ink, encoder, passes, uploads, instances } = start()
    for (let frame = 0; frame < 20; frame += 1) {
      ink.update(packet({ [F.impact]: frame === 0 ? 1 : 0 }), 1 / 60, {}, 1)
      ink.render(encoder, VIEW)
    }

    // A pass and an upload each frame from the first shard on, both the same size.
    expect(passes).toHaveLength(20)
    const last = uploads().at(-1)
    const drawn = passes.at(-1)?.draws[0]
    expect(drawn?.[0]).toBe(3)
    expect(drawn?.[1]).toBe(48)
    expect(last?.count).toBe(48 * SHARD_FLOATS)
    expect(last?.from).toBe(0)
    expect(passes.at(-1)?.vertexBuffers).toEqual([instances])
    expect(ink.detail).toBe('48 shards')
  })

  it('draws over what is there, at the presence, through the shared additive blend', () => {
    const { ink, encoder, passes, pipeline } = start()
    ink.update(packet({ [F.impact]: 1 }), 1 / 60, {}, 0.4)
    ink.render(encoder, VIEW)
    expect(passes[0]?.blend).toEqual([{ r: 0.4, g: 0.4, b: 0.4, a: 1 }])
    const attachment = (passes[0]?.descriptor as GPURenderPassDescriptor).colorAttachments
    expect([...attachment][0]).toMatchObject({ loadOp: 'load', storeOp: 'store' })
    const targets = [...(pipeline()?.fragment?.targets ?? [])]
    expect(targets[0]?.blend).toBe(INK_BLEND)
  })

  it('reads the knobs it is handed', () => {
    const { ink, encoder, passes } = start()
    for (let frame = 0; frame < 20; frame += 1)
      ink.update(packet({ [F.impact]: frame === 0 ? 1 : 0 }), 1 / 60, { burst: 20 }, 1)
    ink.render(encoder, VIEW)
    expect(passes[0]?.draws[0]?.[1]).toBe(20)
  })

  it('goes quiet again when the shards have gone', () => {
    const { ink, encoder, passes, uploads } = start()
    ink.update(packet({ [F.impact]: 1 }), 1 / 60, {}, 1)
    for (let frame = 0; frame < 240; frame += 1) ink.update(packet(), 1 / 60, {}, 1)
    const uploaded = uploads().length
    const drawn = passes.length
    for (let frame = 0; frame < 120; frame += 1) {
      ink.update(packet(), 1 / 60, {}, 1)
      ink.render(encoder, VIEW)
    }

    expect(uploads()).toHaveLength(uploaded)
    expect(passes).toHaveLength(drawn)
    expect(ink.detail).toBe('')
  })
})

describe('what the pipeline hands the shader', () => {
  it('is one 32-byte instance row of three attributes that match the struct in the shader', () => {
    const { pipeline } = start()
    const buffers = [...(pipeline()?.vertex.buffers ?? [])]
    expect(buffers).toHaveLength(1)
    const layout = buffers[0]
    expect(layout).toMatchObject({ arrayStride: 32, stepMode: 'instance' })
    expect([...(layout?.attributes ?? [])]).toEqual([
      { shaderLocation: 0, offset: 0, format: 'float32x2' },
      { shaderLocation: 1, offset: 8, format: 'float32x2' },
      { shaderLocation: 2, offset: 16, format: 'float32x4' },
    ])
    // The same three in the shader, in the same order and of the same width.
    expect(shader).toMatch(/@location\(0\) centre: vec2<f32>/)
    expect(shader).toMatch(/@location\(1\) turn: vec2<f32>/)
    expect(shader).toMatch(/@location\(2\) light: vec4<f32>/)
    expect(SHARD_BYTES).toBe(32)
  })

  it('binds the aspect where the shader reads it, at binding 0 of group 0, as one vec4', () => {
    expect(shader).toMatch(/@group\(0\) @binding\(0\) var<uniform> view: vec4<f32>/)
    expect(SHARD_UNIFORM_FLOATS).toBe(4)
  })
})

describe('letting go', () => {
  it('destroys its buffers and does nothing after', () => {
    const { ink, encoder, passes, buffers } = start()
    ink.update(packet({ [F.impact]: 1 }), 1 / 60, {}, 1)
    ink.dispose()
    for (const made of buffers) expect(made.destroy).toHaveBeenCalledTimes(1)
    expect(() => {
      ink.update(packet({ [F.impact]: 1 }), 1 / 60, {}, 1)
      ink.render(encoder, VIEW)
      ink.resize(100, 100)
    }).not.toThrow()
    expect(passes).toHaveLength(0)
  })
})
