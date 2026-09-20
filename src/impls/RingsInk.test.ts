/**
 * The rings' GPU side against a stand-in for the device, so what it makes once,
 * what it uploads and what it encodes can be counted, and so the bindings it
 * declares can be read against the shader that uses them. What a ring looks
 * like needs a browser; that an ink with no beat to draw costs nothing, and that
 * the two halves of the ink agree about the buffers, does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import shader from '../shaders/rings.wgsl?raw'
import { RING_FLOATS, RING_POOL, RING_SEGMENTS, RING_UNIFORM_FLOATS } from './rings.params'
import { RingsInk } from './RingsInk'

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
      writeBuffer: (
        buffer: Buffer,
        _offset: number,
        data: Float32Array,
        dataOffset = 0,
        size = data.length - dataOffset,
      ) => {
        calls.writes.push({
          buffer,
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

/** What the study resolves to over a steady groove, near enough. */
const GROOVE = { rate: 1, speed: 0.3, thickness: 3, intensity: 0.8, life: 2.4, hueSpread: 0.1 }

/** A packet at a place in the beat, believed. */
const beat = (phase: number, confidence = 0.9) => {
  const out = new Float32Array(PACKET_LENGTH)
  out[F.beatPhase] = phase
  out[F.tempoConfidence] = confidence
  return out
}

let gpu: ReturnType<typeof fakeDevice>
let ink: RingsInk

/** Steps the ink through `seconds` of a steady beat, and renders each frame. */
function play(
  target: RingsInk,
  encoder: GPUCommandEncoder,
  knobs: Record<string, number>,
  seconds: number,
  fps: number,
  presence = 1,
  confidence = 0.9,
  bpm = 120,
) {
  for (let step = 0; step <= Math.round(seconds * fps); step += 1) {
    const beats = (step / fps) * (bpm / 60)
    target.update(beat(beats - Math.floor(beats), confidence), 1 / fps, knobs, presence)
    target.render(encoder, view)
  }
}

beforeEach(() => {
  gpu = fakeDevice()
  ink = new RingsInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
})

describe('the rings ink', () => {
  it('makes its two buffers and its pipeline once, sized for a full pool, and adds light through the ink blend', () => {
    expect(gpu.calls.buffers.map((buffer) => buffer.size)).toEqual([
      RING_UNIFORM_FLOATS * 4,
      RING_POOL * RING_FLOATS * 4,
    ])
    expect(gpu.calls.pipelines).toHaveLength(1)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    const targets = [...(descriptor.fragment?.targets ?? [])]
    expect(targets[0]?.blend).toBe(INK_BLEND)
    // One closed strip a ring, so a ring is a band and not the square round it.
    expect(descriptor.primitive?.topology).toBe('triangle-strip')
    play(ink, gpu.encoder, GROOVE, 2, 60)
    expect(gpu.calls.buffers).toHaveLength(2)
    expect(gpu.calls.pipelines).toHaveLength(1)
  })

  it('has nothing to say on the overlay while no ring is out, and how many once one is', () => {
    expect(ink.detail).toBe('')
    play(ink, gpu.encoder, GROOVE, 1, 60)
    expect(ink.detail).toMatch(/^\d+ rings?$/)
  })

  // A track with no steady beat: cast, believed by nothing.
  it('encodes no pass and uploads nothing while the beat is not believed', () => {
    play(ink, gpu.encoder, GROOVE, 5, 60, 1, 0.1)
    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('encodes no pass and uploads nothing on a silent packet', () => {
    for (let frame = 0; frame < 120; frame += 1) {
      ink.update(new Float32Array(PACKET_LENGTH), 1 / 60, GROOVE, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('encodes no pass and uploads nothing while there is no light', () => {
    play(ink, gpu.encoder, { ...GROOVE, intensity: 0 }, 5, 60)
    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('encodes no pass and uploads nothing at presence 0, however steady the beat', () => {
    play(ink, gpu.encoder, GROOVE, 5, 60, 0)
    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('uploads the rings and the uniform and draws one strip an instance once a ring is out', () => {
    play(ink, gpu.encoder, GROOVE, 1.5, 60)
    expect(gpu.calls.passes).toBeGreaterThan(0)
    const strip = 2 * (RING_SEGMENTS + 1)
    for (const [vertices, instances] of gpu.calls.draws) {
      expect(vertices).toBe(strip)
      expect(instances).toBeGreaterThan(0)
      expect(instances).toBeLessThanOrEqual(RING_POOL)
    }

    // The rings and then the uniform, a pair every frame that has something lit.
    const [uniform, rings] = gpu.calls.buffers
    const writes = (buffer: Buffer | undefined) =>
      gpu.calls.writes.filter((write) => write.buffer === buffer)
    expect(writes(uniform)).toHaveLength(gpu.calls.passes)
    expect(writes(rings)).toHaveLength(gpu.calls.passes)
    for (const write of writes(uniform)) expect(write.floats).toBe(RING_UNIFORM_FLOATS)
    for (const write of writes(rings)) expect(write.floats % RING_FLOATS).toBe(0)
  })

  it('hands the shader the canvas it was told about and the thickness against its short side', () => {
    ink.resize(1080, 1920)
    play(ink, gpu.encoder, GROOVE, 1.5, 60)
    const uniform = gpu.calls.writes.find((write) => write.buffer === gpu.calls.buffers[0])?.data
    expect(uniform?.[0]).toBe(1080)
    expect(uniform?.[1]).toBe(1920)
    expect(uniform?.[2]).toBeCloseTo(3, 6)
    expect(uniform?.[3]).toBeCloseTo(1, 6)
  })

  it('carries its presence in the blend constant, which is how an ink fades', () => {
    play(ink, gpu.encoder, GROOVE, 1.5, 60, 0.25)
    expect(gpu.calls.blend.length).toBeGreaterThan(0)
    for (const colour of gpu.calls.blend)
      expect(colour).toEqual({ r: 0.25, g: 0.25, b: 0.25, a: 1 })
  })

  it('writes the same rings for the same seconds at 30 and at 144 steps a second', () => {
    const rowsAt = (fps: number) => {
      const fresh = fakeDevice()
      const other = new RingsInk()
      other.init({ device: fresh.device, format: 'rgba16float', software: false })
      other.resize(1920, 1080)
      play(other, fresh.encoder, { ...GROOVE, rate: 2 }, 3, fps, 1, 0.9, 128)
      return fresh.calls.writes.filter((write) => write.buffer === fresh.calls.buffers[1]).at(-1)
        ?.data
    }

    const slow = rowsAt(30)
    const fast = rowsAt(144)
    expect(slow?.length).toBeGreaterThan(RING_FLOATS * 4)
    expect(fast?.length).toBe(slow?.length)
    slow?.forEach((value, at) => expect(fast?.[at] ?? Number.NaN).toBeCloseTo(value, 2))
  })

  it('stops drawing the frame after the last ring has gone', () => {
    play(ink, gpu.encoder, { ...GROOVE, life: 0.3 }, 1, 60)
    const passes = gpu.calls.passes
    // The beat is lost, and a life of 0.3 s is a few frames.
    for (let frame = 0; frame < 120; frame += 1) {
      ink.update(beat(0.3, 0.05), 1 / 60, { ...GROOVE, life: 0.3 }, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.passes).toBeGreaterThan(passes - 1)
    const settled = gpu.calls.passes
    for (let frame = 0; frame < 60; frame += 1) {
      ink.update(beat(0.3, 0.05), 1 / 60, { ...GROOVE, life: 0.3 }, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.passes).toBe(settled)
  })

  it('releases its buffers and does nothing after that', () => {
    ink.dispose()
    expect(gpu.calls.buffers.every((buffer) => buffer.destroyed)).toBe(true)
    expect(() => play(ink, gpu.encoder, GROOVE, 2, 60)).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })

  it('does nothing before it has a device', () => {
    const bare = new RingsInk()
    expect(() => play(bare, gpu.encoder, GROOVE, 2, 60)).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })
})

// WGSL is compiled only by a browser, so what can be checked here is that the
// two halves agree about the buffers: the binding numbers and kinds, the size of
// the uniform, the number of corners, and where each thing sits in it.
describe('the shader against the buffers it reads', () => {
  it('reads binding 0 as the uniform and binding 1 as the rings, in the stages the layout says', () => {
    expect(shader).toMatch(/@group\(0\)\s+@binding\(0\)\s+var<uniform>\s+params\s*:\s*Params/)
    expect(shader).toMatch(
      /@group\(0\)\s+@binding\(1\)\s+var<storage,\s*read>\s+rings\s*:\s*array<vec4<f32>>/,
    )
    const entries = [...(gpu.calls.layouts[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0, 1])
    expect(entries[0]?.buffer?.type).toBe('uniform')
    expect(entries[1]?.buffer?.type).toBe('read-only-storage')
    // The vertex stage places the corners from both, and the fragment stage shapes the edge from the uniform.
    expect(entries[0]?.visibility).toBe(1 | 2)
    expect(entries[1]?.visibility).toBe(1)
    const vertex = shader.slice(shader.indexOf('@vertex'), shader.indexOf('@fragment'))
    const fragment = shader.slice(shader.indexOf('@fragment'))
    expect(vertex).toMatch(/rings\[ii\]/)
    expect(vertex).toMatch(/params\.size/)
    expect(fragment).toMatch(/params\.thickness/)
    expect(fragment).toMatch(/params\.edge/)
    expect(fragment).not.toMatch(/rings\[/)
  })

  it('binds the two buffers made, in that order', () => {
    const entries = [...(gpu.calls.groups[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0, 1])
    expect((entries[0]?.resource as GPUBufferBinding).buffer).toBe(gpu.calls.buffers[0])
    expect((entries[1]?.resource as GPUBufferBinding).buffer).toBe(gpu.calls.buffers[1])
  })

  it('declares the uniform as four floats in the order the fill writes them, and a ring as one vec4', () => {
    const body = shader.match(/struct Params\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const order = [...body.matchAll(/^\s*(\w+)\s*:\s*(vec2<f32>|f32)\s*,/gm)].map(
      (match) => `${match[1]}:${match[2]}`,
    )
    expect(order).toEqual(['size:vec2<f32>', 'thickness:f32', 'edge:f32'])
    // Two, then one, then one: the four floats of RING_UNIFORM_FLOATS.
    expect(2 + 1 + 1).toBe(RING_UNIFORM_FLOATS)
    expect(RING_FLOATS).toBe(4)
  })

  it('reads a ring’s light from rgb and its radius from w, which is the order the fill writes them', () => {
    expect(shader).toMatch(/let radius = ring\.w/)
    expect(shader).toMatch(/out\.light = ring\.rgb/)
  })

  it('has as many pieces to a ring as the ink draws, and closes the strip on the first corner', () => {
    expect(shader).toMatch(new RegExp(`const SEGMENTS: u32 = ${RING_SEGMENTS}u`))
    // Two corners a piece, from the inner edge to the outer, and one piece more to close it.
    expect(shader).toMatch(/f32\(vi \/ 2u\) \* \(TAU \/ f32\(SEGMENTS\)\)/)
    expect(shader).toMatch(/f32\(vi % 2u\) \* 2\.0 - 1\.0/)
  })

  it('makes the falloff the one the params file mirrors: a smoothstep from the thickness less the edge to the thickness plus it', () => {
    expect(shader).toMatch(/let half_width = params\.thickness \* 0\.5/)
    expect(shader).toMatch(/max\(half_width - params\.edge, 0\.0\)/)
    expect(shader).toMatch(/half_width \+ params\.edge/)
    expect(shader).toMatch(/1\.0 - smoothstep\(ramp_start, ramp_end, abs\(in\.across\)\)/)
    // And the strip reaches as far as the light does, and no further.
    expect(shader).toMatch(/let reach = params\.thickness \* 0\.5 \+ params\.edge/)
  })

  it('has the entry points the pipeline names, and writes alpha as 1 with the light in rgb, which the blend leaves alone', () => {
    expect(shader).toMatch(/@vertex\s+fn strip\(/)
    expect(shader).toMatch(/@fragment\s+fn fs\(/)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    expect(descriptor.vertex.entryPoint).toBe('strip')
    expect(descriptor.fragment?.entryPoint).toBe('fs')
    expect(shader).toMatch(/return vec4<f32>\(in\.light \* light, 1\.0\)/)
  })

  // `from` was one of these, and only the browser said so. A test cannot compile
  // WGSL, but it can keep a name off the spec's list of words held back for later.
  it('names nothing with a word the WGSL spec reserves', () => {
    const declared = [
      ...shader.matchAll(/\b(?:let|var|const|fn|struct)\s+(\w+)/g),
      ...shader.matchAll(/^\s*(\w+)\s*:\s*[\w<>, ]+,\s*(?:\/\/.*)?$/gm),
    ].map((match) => match[1] ?? '')
    expect(declared.length).toBeGreaterThan(10)
    for (const name of declared) expect(WGSL_RESERVED, name).not.toContain(name)
  })
})
