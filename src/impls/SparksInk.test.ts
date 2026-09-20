/**
 * The ink against a device that only counts, since a browser is the only thing
 * that compiles WGSL and draws. What this can say is what the ink asks of the
 * GPU and when: nothing while no spark is alive, one small upload and one pass
 * while some are flying, the presence in the blend constant and nowhere else,
 * and that the shader and the buffer it reads agree about the layout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import shader from '../shaders/sparks.wgsl?raw'
import {
  HEAD_AT,
  SPARK_AT,
  SPARK_BYTES,
  SPARK_FLOATS,
  SPARK_POOL,
  SPARK_UNIFORM_FLOATS,
} from './sparks.params'
import { SparksInk } from './SparksInk'

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

/** A hat, from a band that is sounding. */
const HAT = {
  [F.trebleHit]: 0.8,
  [F.treble]: 0.6,
  [F.trebleHitCentre]: 0.9,
  [F.trebleHitWidth]: 0.05,
}

/** What the study resolves to near enough, and every knob the ink reads. */
const KNOBS = {
  rate: 24,
  count: 4,
  speed: 0.5,
  life: 0.55,
  size: 4,
  intensity: 2.4,
  hueSpread: 0.12,
}

const VIEW = {} as GPUTextureView

/** The words WGSL holds back for itself, the ones a name is likely to run into. */
const WGSL_RESERVED = [
  'active',
  'alias',
  'as',
  'async',
  'attribute',
  'auto',
  'cast',
  'catch',
  'class',
  'common',
  'compile',
  'concept',
  'default',
  'delete',
  'do',
  'enable',
  'enum',
  'explicit',
  'export',
  'extends',
  'extern',
  'external',
  'filter',
  'final',
  'finally',
  'friend',
  'from',
  'get',
  'goto',
  'handle',
  'import',
  'inline',
  'interface',
  'layout',
  'match',
  'meta',
  'mod',
  'module',
  'move',
  'mut',
  'namespace',
  'new',
  'nil',
  'null',
  'of',
  'operator',
  'package',
  'pass',
  'patch',
  'precise',
  'precision',
  'private',
  'protected',
  'public',
  'ref',
  'register',
  'require',
  'resource',
  'restrict',
  'self',
  'set',
  'shared',
  'smooth',
  'static',
  'std',
  'super',
  'target',
  'template',
  'this',
  'throw',
  'trait',
  'try',
  'type',
  'typedef',
  'typename',
  'typeof',
  'union',
  'unless',
  'use',
  'using',
  'virtual',
  'where',
  'with',
  'yield',
]

beforeEach(() => {
  vi.stubGlobal('GPUBufferUsage', { VERTEX: 0x20, COPY_DST: 0x08, UNIFORM: 0x40 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function start() {
  const gpu = fake()
  const ink = new SparksInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
  const instances = gpu.buffers.find((made) => made.label === 'Sparks instances')
  const uniform = gpu.buffers.find((made) => made.label === 'Sparks canvas')
  if (!instances || !uniform) throw new Error('Expected both buffers')
  const uploads = () => gpu.writes.filter((write) => write.target === instances)
  return { ...gpu, ink, instances, uniform, uploads }
}

describe('while nothing is alive', () => {
  it('uploads nothing and encodes nothing through a whole silent song', () => {
    const { ink, encoder, passes, uploads } = start()
    for (let frame = 0; frame < 600; frame += 1) {
      ink.update(packet({ [F.energy]: 0.9, [F.bass]: 0.9, [F.treble]: 0.9 }), 1 / 60, KNOBS, 1)
      ink.render(encoder, VIEW)
    }

    expect(uploads()).toHaveLength(0)
    expect(passes).toHaveLength(0)
    expect(ink.detail).toBe('')
  })

  it('draws nothing for a hat from a band that is not sounding', () => {
    const { ink, encoder, passes, uploads } = start()
    for (let frame = 0; frame < 120; frame += 1) {
      ink.update(packet({ ...HAT, [F.treble]: 0 }), 1 / 60, KNOBS, 1)
      ink.render(encoder, VIEW)
    }

    expect(uploads()).toHaveLength(0)
    expect(passes).toHaveLength(0)
  })

  it('draws nothing with no light, whatever is alive', () => {
    const { ink, encoder, passes, uploads } = start()
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet(frame === 0 ? HAT : {}), 1 / 60, { ...KNOBS, intensity: 0 }, 1)
      ink.render(encoder, VIEW)
    }

    expect(uploads()).toHaveLength(0)
    expect(passes).toHaveLength(0)
  })

  it('draws nothing with no knobs at all', () => {
    const { ink, encoder, passes } = start()
    for (let frame = 0; frame < 30; frame += 1) {
      ink.update(packet(HAT), 1 / 60, {}, 1)
      ink.render(encoder, VIEW)
    }

    expect(passes).toHaveLength(0)
  })

  it('makes its buffers once, at the size of the pool, and never again', () => {
    const { ink, buffers, instances, uniform } = start()
    for (let frame = 0; frame < 60; frame += 1)
      ink.update(packet(frame % 6 === 0 ? HAT : {}), 1 / 60, KNOBS, 1)
    expect(buffers).toHaveLength(2)
    expect(instances.size).toBe(SPARK_POOL * SPARK_BYTES)
    expect(uniform.size).toBe(SPARK_UNIFORM_FLOATS * 4)
  })

  it('writes the canvas when the size changes and not per frame', () => {
    const { ink, writes, uniform } = start()
    const after = writes.filter((write) => write.target === uniform).length
    for (let frame = 0; frame < 60; frame += 1) ink.update(packet(), 1 / 60, KNOBS, 1)
    expect(writes.filter((write) => write.target === uniform)).toHaveLength(after)
    ink.resize(1000, 700)
    const last = writes.filter((write) => write.target === uniform).at(-1)
    expect([last?.data[0], last?.data[1]]).toEqual([1000, 700])
  })
})

describe('on a hat', () => {
  it('uploads the living rows and draws them in one call of six vertices a spark', () => {
    const { ink, encoder, passes, uploads, instances } = start()
    for (let frame = 0; frame < 6; frame += 1) {
      ink.update(packet(frame === 0 ? HAT : {}), 1 / 60, KNOBS, 1)
      ink.render(encoder, VIEW)
    }

    expect(passes).toHaveLength(6)
    const last = uploads().at(-1)
    expect(passes.at(-1)?.draws[0]).toEqual([6, 4])
    expect(last?.count).toBe(4 * SPARK_FLOATS)
    expect(last?.from).toBe(0)
    expect(passes.at(-1)?.vertexBuffers).toEqual([instances])
    expect(ink.detail).toBe('4 sparks')
  })

  it('draws over what is there, at the presence, through the shared additive blend', () => {
    const { ink, encoder, passes, pipeline } = start()
    ink.update(packet(HAT), 1 / 60, KNOBS, 0.4)
    ink.render(encoder, VIEW)
    expect(passes[0]?.blend).toEqual([{ r: 0.4, g: 0.4, b: 0.4, a: 1 }])
    const attachment = (passes[0]?.descriptor as GPURenderPassDescriptor).colorAttachments
    expect([...attachment][0]).toMatchObject({ loadOp: 'load', storeOp: 'store' })
    const targets = [...(pipeline()?.fragment?.targets ?? [])]
    expect(targets[0]?.blend).toBe(INK_BLEND)
  })

  it('reads the count it is handed', () => {
    const { ink, encoder, passes } = start()
    const two: Record<string, number> = { ...KNOBS, count: 2 }
    ink.update(packet(HAT), 1 / 60, two, 1)
    ink.render(encoder, VIEW)
    expect(passes[0]?.draws[0]?.[1]).toBe(2)
  })

  it('goes quiet again when the sparks have gone', () => {
    const { ink, encoder, passes, uploads } = start()
    ink.update(packet(HAT), 1 / 60, KNOBS, 1)
    for (let frame = 0; frame < 120; frame += 1) ink.update(packet(), 1 / 60, KNOBS, 1)
    const uploaded = uploads().length
    const drawn = passes.length
    for (let frame = 0; frame < 120; frame += 1) {
      ink.update(packet(), 1 / 60, KNOBS, 1)
      ink.render(encoder, VIEW)
    }

    expect(uploads()).toHaveLength(uploaded)
    expect(passes).toHaveLength(drawn)
    expect(ink.detail).toBe('')
  })

  it('writes finished rows: the head on the ring and a light that carries the intensity', () => {
    const { ink, uploads } = start()
    ink.update(packet(HAT), 1 / 60, KNOBS, 1)
    const row = uploads().at(-1)?.data
    expect(row).toBeDefined()
    if (!row) return
    const half = row[SPARK_AT.halfLength] ?? 0
    const headX = (row[SPARK_AT.x] ?? 0) + (row[SPARK_AT.dx] ?? 0) * HEAD_AT * half
    const headY = (row[SPARK_AT.y] ?? 0) + (row[SPARK_AT.dy] ?? 0) * HEAD_AT * half
    expect(Math.hypot(headX - 960, headY - 540)).toBeCloseTo(0.2 * 1080, 3)
    // Brighter than one, since the intensity is more than one and it is nearly white.
    expect(
      Math.max(row[SPARK_AT.red] ?? 0, row[SPARK_AT.green] ?? 0, row[SPARK_AT.blue] ?? 0),
    ).toBeGreaterThan(1)
  })
})

describe('what the pipeline hands the shader', () => {
  it('is one 36-byte instance row of three attributes that match the struct in the shader', () => {
    const { pipeline } = start()
    const buffers = [...(pipeline()?.vertex.buffers ?? [])]
    expect(buffers).toHaveLength(1)
    const layout = buffers[0]
    expect(layout).toMatchObject({ arrayStride: 36, stepMode: 'instance' })
    expect([...(layout?.attributes ?? [])]).toEqual([
      { shaderLocation: 0, offset: 0, format: 'float32x4' },
      { shaderLocation: 1, offset: 16, format: 'float32x2' },
      { shaderLocation: 2, offset: 24, format: 'float32x3' },
    ])
    // The same three in the shader, in the same order and of the same width.
    expect(shader).toMatch(/@location\(0\) place: vec4<f32>/)
    expect(shader).toMatch(/@location\(1\) reach: vec2<f32>/)
    expect(shader).toMatch(/@location\(2\) glow: vec3<f32>/)
    expect(SPARK_BYTES).toBe(36)
    expect(SPARK_FLOATS).toBe(4 + 2 + 3)
  })

  it('reads each field of a row from the slot the fill writes it to', () => {
    // place is the middle then the direction, reach the half length then the half width, glow the colour.
    expect([SPARK_AT.x, SPARK_AT.y, SPARK_AT.dx, SPARK_AT.dy]).toEqual([0, 1, 2, 3])
    expect([SPARK_AT.halfLength, SPARK_AT.halfWidth]).toEqual([4, 5])
    expect([SPARK_AT.red, SPARK_AT.green, SPARK_AT.blue]).toEqual([6, 7, 8])
    expect(shader).toMatch(/let along = spark\.place\.zw/)
    expect(shader).toMatch(/spark\.place\.xy/)
    expect(shader).toMatch(/corner\.x \* spark\.reach\.x/)
    expect(shader).toMatch(/corner\.y \* spark\.reach\.y/)
    expect(shader).toMatch(/out\.colour = spark\.glow/)
  })

  it('binds the canvas where the shader reads it, at binding 0 of group 0, as one vec4', () => {
    expect(shader).toMatch(/@group\(0\) @binding\(0\) var<uniform> canvas: vec4<f32>/)
    expect(SPARK_UNIFORM_FLOATS).toBe(4)
    expect(shader).toMatch(/pixel\.x \/ canvas\.x/)
    expect(shader).toMatch(/pixel\.y \/ canvas\.y/)
  })

  it('draws a quad of six corners a spark, its head where the params say it is', () => {
    expect(shader).toMatch(/array<vec2<f32>,\s*6>/)
    expect(shader).toContain(`const HEAD_AT: f32 = ${HEAD_AT};`)
  })

  it('has the entry points the pipeline names, and writes alpha as 1 with the light in rgb, which the blend leaves alone', () => {
    const { pipeline } = start()
    expect(shader).toMatch(/@vertex\s+fn vs\(/)
    expect(shader).toMatch(/@fragment\s+fn fs\(/)
    expect(pipeline()?.vertex.entryPoint).toBe('vs')
    expect(pipeline()?.fragment?.entryPoint).toBe('fs')
    expect(shader).toMatch(
      /return vec4<f32>\(in\.colour \* \(side \* side \* tail \* front\), 1\.0\)/,
    )
  })

  // `from` was one of these on another ink, and only the browser said so. A
  // test cannot compile WGSL, but it can keep a name off the spec's list of
  // words held back for later.
  it('names nothing with a word the WGSL spec reserves', () => {
    const declared = [
      ...shader.matchAll(/\b(?:let|var|const|fn|struct)\s+(\w+)/g),
      ...shader.matchAll(/^\s*(?:@\w+(?:\([^)]*\))?\s+)*(\w+)\s*:\s*[\w<>, ]+,\s*(?:\/\/.*)?$/gm),
    ].map((match) => match[1] ?? '')
    expect(declared.length).toBeGreaterThan(10)
    for (const name of declared) expect(WGSL_RESERVED, name).not.toContain(name)
  })
})

describe('letting go', () => {
  it('destroys its buffers and does nothing after', () => {
    const { ink, encoder, passes, buffers } = start()
    ink.update(packet(HAT), 1 / 60, KNOBS, 1)
    ink.dispose()
    for (const made of buffers) expect(made.destroy).toHaveBeenCalledTimes(1)
    expect(() => {
      ink.update(packet(HAT), 1 / 60, KNOBS, 1)
      ink.render(encoder, VIEW)
      ink.resize(100, 100)
    }).not.toThrow()
    expect(passes).toHaveLength(0)
  })
})
