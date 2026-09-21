/**
 * The field's GPU side against a stand-in for the device, so what it makes
 * once, what it uploads, what it dispatches and what it encodes can all be
 * counted, and so the bindings it declares can be read against the shaders
 * that use them. What the pass looks like needs a browser; that a field with
 * nothing to draw costs nothing, that the pool is never reallocated, and that
 * the two halves agree about their bindings, does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import type { Flow, SceneContext } from '../scenes/Scene'
import common from '../shaders/particles.common.wgsl?raw'
import draw from '../shaders/particles.draw.wgsl?raw'
import simulation from '../shaders/particles.sim.wgsl?raw'
import { ParticleField } from './ParticleField'
import {
  DUST_PROFILE,
  GRID_CELLS,
  GRID_SLOTS,
  PARTICLE_FLOATS,
  PARTICLE_UNIFORM_FLOATS,
  PARTICLE_WORKGROUP,
  SPARKS_PROFILE,
} from './particles.params'

vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 })
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 })
vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2 })

type Buffer = { label?: string; size: number; destroyed: boolean; destroy: () => void }

/** Every call the field makes on the device, so a test can say what happened. */
function fakeDevice() {
  const calls = {
    buffers: [] as Buffer[],
    textures: 0,
    writes: [] as { buffer: Buffer; data: Float32Array }[],
    computePasses: 0,
    renderPasses: 0,
    dispatches: [] as { pipeline: unknown; groups: number }[],
    draws: [] as [number, number][],
    blend: [] as unknown[],
    layouts: [] as GPUBindGroupLayoutDescriptor[],
    groups: [] as GPUBindGroupDescriptor[],
    computePipelines: [] as GPUComputePipelineDescriptor[],
    renderPipelines: [] as GPURenderPipelineDescriptor[],
    modules: [] as string[],
  }

  let bound: unknown = null
  const compute = {
    setBindGroup: vi.fn(),
    setPipeline: (pipeline: unknown) => (bound = pipeline),
    dispatchWorkgroups: (groups: number) => calls.dispatches.push({ pipeline: bound, groups }),
    end: vi.fn(),
  }

  const render = {
    setPipeline: vi.fn(),
    setBlendConstant: (colour: unknown) => calls.blend.push(colour),
    setBindGroup: vi.fn(),
    draw: (vertices: number, instances: number) => calls.draws.push([vertices, instances]),
    end: vi.fn(),
  }

  const device = {
    createShaderModule: ({ code }: { code: string }) => {
      calls.modules.push(code)
      return { getCompilationInfo: () => Promise.resolve({ messages: [] }) }
    },
    createBuffer: ({ label, size }: { label?: string; size: number }) => {
      const buffer: Buffer = {
        label,
        size,
        destroyed: false,
        destroy: () => (buffer.destroyed = true),
      }
      calls.buffers.push(buffer)
      return buffer
    },
    createTexture: () => {
      calls.textures += 1
      return { createView: () => ({ still: true }), destroy: vi.fn() }
    },
    createSampler: () => ({ sampler: true }),
    createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => {
      calls.layouts.push(descriptor)
      return { layout: descriptor.label }
    },
    createPipelineLayout: () => ({}),
    createComputePipeline: (descriptor: GPUComputePipelineDescriptor) => {
      calls.computePipelines.push(descriptor)
      return { entry: descriptor.compute.entryPoint }
    },
    createRenderPipeline: (descriptor: GPURenderPipelineDescriptor) => {
      calls.renderPipelines.push(descriptor)
      return {}
    },
    createBindGroup: (descriptor: GPUBindGroupDescriptor) => {
      calls.groups.push(descriptor)
      return { group: descriptor.label }
    },
    queue: {
      writeBuffer: (buffer: Buffer, _offset: number, data: Float32Array) => {
        calls.writes.push({ buffer, data: data.slice() })
      },
    },
  }

  const encoder = {
    beginComputePass: () => {
      calls.computePasses += 1
      return compute
    },
    beginRenderPass: () => {
      calls.renderPasses += 1
      return render
    },
  }

  return {
    calls,
    device: device as unknown as GPUDevice,
    encoder: encoder as unknown as GPUCommandEncoder,
  }
}

const view = {} as GPUTextureView
const flowView = { flow: true } as unknown as GPUTextureView
const FIELD: Flow = { view: flowView, cover: [1.5, 1], size: 128 }

const packet = () => new Float32Array(PACKET_LENGTH)

/** A packet with a hat in it, which is what makes the sparks plan a burst. */
const hat = () => {
  const out = packet()
  out[F.trebleHit] = 0.8
  out[F.treble] = 0.5
  out[F.trebleHitCentre] = 0.9
  out[F.trebleHitWidth] = 0.05
  return out
}

/**
 * What the sparks study resolves to over a groove, near enough. Typed by the
 * key rather than by the knob, because `Tuning` is keyed on the preset
 * vocabulary and the field's knobs are the implementation's own.
 */
const SPARKS: Record<string, number> = {
  count: 20000,
  rate: 500,
  burst: 500,
  speed: 0.5,
  life: 0.55,
  size: 1.2,
  intensity: 0.03,
  hueSpread: 0.12,
}

/** The sparks' knobs with one of them changed, still typed by the key. */
const knobs = (patch: Record<string, number>): Record<string, number> => ({ ...SPARKS, ...patch })

/** The pool the knobs above ask for. */
const COUNT = SPARKS.count ?? 0

let gpu: ReturnType<typeof fakeDevice>
let context: SceneContext
let carried: Flow | null
let field: ParticleField

const build = (profile = SPARKS_PROFILE) => {
  gpu = fakeDevice()
  carried = null
  context = {
    device: gpu.device,
    format: 'rgba16float',
    software: false,
    flow: () => carried,
  }
  field = new ParticleField(profile)
  field.init(context)
  field.resize(1920, 1080)
  return field
}

beforeEach(() => {
  build()
})

describe('what the field makes', () => {
  it('makes its four buffers and its one texture once, sized to the profile and not to the knob', () => {
    expect(gpu.calls.buffers.map((buffer) => buffer.size)).toEqual([
      PARTICLE_UNIFORM_FLOATS * 4,
      SPARKS_PROFILE.capacity * PARTICLE_FLOATS * 4,
      GRID_CELLS * 4,
      GRID_CELLS * GRID_SLOTS * 4,
    ])
    expect(gpu.calls.textures).toBe(1)
    const made = gpu.calls.buffers.length
    for (let frame = 0; frame < 20; frame += 1) {
      field.update(hat(), 1 / 60, SPARKS, 1)
      field.render(gpu.encoder, view)
    }

    // The pool follows the knob and is never reallocated.
    expect(gpu.calls.buffers).toHaveLength(made)
  })

  it('names both bind group layouts rather than deriving either', () => {
    expect(gpu.calls.layouts.map((entry) => entry.label)).toEqual([
      'Particle simulate',
      'Particle draw',
    ])
    for (const descriptor of gpu.calls.renderPipelines) expect(descriptor.layout).not.toBe('auto')
    for (const descriptor of gpu.calls.computePipelines) expect(descriptor.layout).not.toBe('auto')
  })

  it('builds one compute pipeline per step of the simulation and one draw', () => {
    expect(gpu.calls.computePipelines.map((entry) => entry.compute.entryPoint)).toEqual([
      'clear_grid',
      'bin',
      'step',
    ])
    expect(gpu.calls.renderPipelines).toHaveLength(1)
  })

  it('adds its light through the shared ink blend', () => {
    const descriptor = gpu.calls.renderPipelines[0]
    const targets = [...(descriptor?.fragment?.targets ?? [])]
    expect(targets).toHaveLength(1)
    expect(targets[0] && 'blend' in targets[0] ? targets[0].blend : null).toBe(INK_BLEND)
  })

  it('releases every buffer and the still texture when it is disposed', () => {
    field.dispose()
    expect(gpu.calls.buffers.every((buffer) => buffer.destroyed)).toBe(true)
  })
})

describe('what a frame costs', () => {
  it('encodes nothing and dispatches nothing at presence 0', () => {
    field.update(hat(), 1 / 60, SPARKS, 0)
    field.render(gpu.encoder, view)
    expect(gpu.calls.computePasses).toBe(0)
    expect(gpu.calls.renderPasses).toBe(0)
    expect(gpu.calls.dispatches).toEqual([])
    expect(gpu.calls.writes).toEqual([])
  })

  it('encodes nothing with no count, no light or no size', () => {
    for (const dark of [knobs({ count: 0 }), knobs({ intensity: 0 }), knobs({ size: 0 })]) {
      build()
      field.update(hat(), 1 / 60, dark, 1)
      field.render(gpu.encoder, view)
      expect(gpu.calls.computePasses).toBe(0)
      expect(gpu.calls.renderPasses).toBe(0)
      expect(gpu.calls.writes).toEqual([])
    }
  })

  it('runs one compute pass, one dispatch and one draw while it is live', () => {
    field.update(hat(), 1 / 60, SPARKS, 1)
    field.render(gpu.encoder, view)
    expect(gpu.calls.computePasses).toBe(1)
    expect(gpu.calls.renderPasses).toBe(1)
    // No boids in the sparks' profile, so the two binning passes are skipped.
    expect(gpu.calls.dispatches).toHaveLength(1)
    expect(gpu.calls.dispatches[0]?.groups).toBe(Math.ceil(COUNT / PARTICLE_WORKGROUP))
    expect(gpu.calls.draws).toEqual([[6, COUNT]])
    expect(gpu.calls.writes).toHaveLength(1)
    expect(gpu.calls.writes[0]?.data).toHaveLength(PARTICLE_UNIFORM_FLOATS)
  })

  it('clears and fills the grid only when a steering term is live', () => {
    const steering = knobs({ neighbourhood: 0.1, cohesion: 1 })
    field.update(hat(), 1 / 60, steering, 1)
    field.render(gpu.encoder, view)
    expect(gpu.calls.dispatches.map((entry) => entry.pipeline)).toEqual([
      { entry: 'clear_grid' },
      { entry: 'bin' },
      { entry: 'step' },
    ])
    expect(gpu.calls.dispatches[0]?.groups).toBe(Math.ceil(GRID_CELLS / PARTICLE_WORKGROUP))
  })

  it('follows the count knob without touching the buffers', () => {
    for (const count of [10000, 500, 20000, 1]) {
      field.update(hat(), 1 / 60, knobs({ count }), 1)
      field.render(gpu.encoder, view)
    }

    expect(gpu.calls.draws.map(([, instances]) => instances)).toEqual([10000, 500, 20000, 1])
    expect(gpu.calls.dispatches.map((entry) => entry.groups)).toEqual(
      [10000, 500, 20000, 1].map((count) => Math.ceil(count / PARTICLE_WORKGROUP)),
    )
  })

  it('holds the count to what the canvas is worth', () => {
    field.resize(320, 320)
    field.update(hat(), 1 / 60, SPARKS, 1)
    field.render(gpu.encoder, view)
    const drawn = gpu.calls.draws[0]?.[1] ?? 0
    expect(drawn).toBeGreaterThan(0)
    expect(drawn).toBeLessThan(COUNT)
  })

  it('puts the presence in the blend constant', () => {
    field.update(hat(), 1 / 60, SPARKS, 0.4)
    field.render(gpu.encoder, view)
    expect(gpu.calls.blend).toEqual([{ r: 0.4, g: 0.4, b: 0.4, a: 1 }])
  })

  it('uploads one block a frame and nothing else', () => {
    for (let frame = 0; frame < 10; frame += 1) {
      field.update(hat(), 1 / 60, SPARKS, 1)
      field.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(10)
    for (const write of gpu.calls.writes) expect(write.buffer.label).toBe('Particle field uniform')
  })
})

describe('the flow it rides', () => {
  it('binds the still texel with no flow in the cast, and builds the group once', () => {
    for (let frame = 0; frame < 5; frame += 1) {
      field.update(hat(), 1 / 60, SPARKS, 1)
      field.render(gpu.encoder, view)
    }

    const simulate = gpu.calls.groups.filter((entry) => entry.label === 'Particle simulate')
    expect(simulate).toHaveLength(1)
    const entries = [...(simulate[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0, 1, 2, 3, 4, 5])
    expect(entries[4]?.resource).toEqual({ still: true })
  })

  it('binds the field the flows blended to, and rebuilds only when it moves', () => {
    carried = FIELD
    for (let frame = 0; frame < 5; frame += 1) {
      field.update(hat(), 1 / 60, SPARKS, 1)
      field.render(gpu.encoder, view)
    }

    const simulate = gpu.calls.groups.filter((entry) => entry.label === 'Particle simulate')
    expect(simulate).toHaveLength(1)
    expect([...(simulate[0]?.entries ?? [])][4]?.resource).toBe(flowView)
    // The flow's cover reaches the uniform, so the shader can undo it.
    const written = gpu.calls.writes.at(-1)?.data
    expect(written?.[28]).toBeCloseTo(1.5, 6)
    expect(written?.[30]).toBe(1)

    // Which half of a ping-pong a flow offers alternates, so a new view is a
    // new group and nothing else is.
    carried = { ...FIELD, view: { other: true } as unknown as GPUTextureView }
    field.update(hat(), 1 / 60, SPARKS, 1)
    field.render(gpu.encoder, view)
    expect(gpu.calls.groups.filter((entry) => entry.label === 'Particle simulate')).toHaveLength(2)
  })
})

describe('the overlay’s line', () => {
  it('says what the sparks are drawing and leaves the dust silent', () => {
    field.update(hat(), 1 / 60, SPARKS, 1)
    expect(field.detail).toBe(`${COUNT} sparks`)
    field.update(hat(), 1 / 60, knobs({ count: 0 }), 1)
    expect(field.detail).toBe('')

    const dust = build(DUST_PROFILE)
    const specks: Record<string, number> = { count: 5000, size: 1.5, intensity: 0.08 }
    dust.update(packet(), 1 / 60, specks, 1)
    expect(dust.detail).toBe('')
  })
})

describe('a software rasteriser', () => {
  it('is given a pool it can actually run', () => {
    const slow = new ParticleField(SPARKS_PROFILE)
    const other = fakeDevice()
    slow.init({ device: other.device, format: 'rgba16float', software: true })
    slow.resize(1920, 1080)
    slow.update(hat(), 1 / 60, SPARKS, 1)
    slow.render(other.encoder, view)
    expect(other.calls.draws[0]?.[1] ?? 0).toBeLessThanOrEqual(2000)
  })
})

describe('the shaders read what the ink declares', () => {
  const sim = common + simulation
  const drawn = common + draw

  it('prepends the shared block to both halves', () => {
    expect(gpu.calls.modules).toHaveLength(2)
    for (const code of gpu.calls.modules) expect(code.startsWith(common)).toBe(true)
  })

  it('binds the six things the simulation reads, in the order the layout names them', () => {
    const layout = gpu.calls.layouts.find((entry) => entry.label === 'Particle simulate')
    expect([...(layout?.entries ?? [])].map((entry) => entry.binding)).toEqual([0, 1, 2, 3, 4, 5])
    expect(sim).toContain('@group(0) @binding(0) var<uniform> params: Params;')
    expect(sim).toContain('@group(0) @binding(1) var<storage, read_write> pool: array<Particle>;')
    expect(sim).toContain(
      '@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;',
    )
    expect(sim).toContain('@group(0) @binding(3) var<storage, read_write> slots: array<u32>;')
    expect(sim).toContain('@group(0) @binding(4) var flow: texture_2d<f32>;')
    expect(sim).toContain('@group(0) @binding(5) var samp: sampler;')
  })

  it('binds the two things the draw reads, with the pool read-only there', () => {
    const layout = gpu.calls.layouts.find((entry) => entry.label === 'Particle draw')
    const entries = [...(layout?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0, 1])
    expect(entries[1]?.buffer?.type).toBe('read-only-storage')
    expect(drawn).toContain('@group(0) @binding(0) var<uniform> params: Params;')
    expect(drawn).toContain('@group(0) @binding(1) var<storage, read> pool: array<Particle>;')
  })

  it('has an entry point for every step the ink encodes, and the two the draw names', () => {
    for (const entry of ['clear_grid', 'bin', 'step']) expect(sim).toContain(`fn ${entry}(`)
    expect(drawn).toContain('fn quad(')
    expect(drawn).toContain('fn fs(')
    expect(gpu.calls.renderPipelines[0]?.vertex.entryPoint).toBe('quad')
    expect(gpu.calls.renderPipelines[0]?.fragment?.entryPoint).toBe('fs')
  })

  it('declares a particle of exactly the floats the uniform is written against', () => {
    // Two vec4s, which is the eight floats `PARTICLE_FLOATS` sizes the pool by.
    expect(common).toContain('struct Particle {')
    expect(PARTICLE_FLOATS).toBe(8)
    const struct = common.slice(common.indexOf('struct Particle {'))
    const body = struct.slice(0, struct.indexOf('}'))
    expect(body.match(/vec4<f32>/g)).toHaveLength(2)
  })

  it('declares the same workgroup the ink counts its dispatches in', () => {
    expect(
      sim
        .match(/@workgroup_size\((\d+)\)/g)
        ?.every((size) => size.includes(String(PARTICLE_WORKGROUP))),
    ).toBe(true)
  })

  it('keeps the grid’s slot count the same on both sides', () => {
    expect(sim).toContain(`const GRID_SLOTS: u32 = ${GRID_SLOTS}u;`)
  })

  it('uses no name on WGSL’s reserved list', () => {
    // `target` is the one that bit the long-memory canvas: only the adapter
    // said so, and the shader silently drew nothing.
    for (const reserved of ['\\btarget\\s*:', '\\blet target\\b', '\\bvar target\\b'])
      for (const code of [sim, drawn]) expect(code).not.toMatch(new RegExp(reserved))
  })
})
