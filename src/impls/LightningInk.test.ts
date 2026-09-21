/**
 * The lightning's GPU side against a stand-in for the device, so what it makes
 * once, what it uploads and what it encodes can be counted, and so the
 * bindings it declares can be read against the shader that uses them. What a
 * bolt looks like needs a browser; that an ink with nothing to fire costs
 * nothing, and that the two halves of the ink agree about the buffers, does
 * not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import shader from '../shaders/lightning.wgsl?raw'
import {
  LIGHTNING_DEFAULTS,
  LIGHTNING_POOL,
  LIGHTNING_UNIFORM_FLOATS,
  SEGMENT_FLOATS,
  STRIKE_SEGMENTS,
} from './lightning.params'
import { LightningInk } from './LightningInk'

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

/** A packet that fires on the first frame and is quiet after. */
const strikePacket = () => {
  const out = new Float32Array(PACKET_LENGTH)
  out[F.impact] = 1
  out[F.release] = 1
  out[F.keyHue] = 0.6
  return out
}

let gpu: ReturnType<typeof fakeDevice>
let ink: LightningInk

/** Steps the ink through `frames` frames after the strike, rendering each. */
function play(target: LightningInk, encoder: GPUCommandEncoder, frames: number, presence = 1) {
  for (let frame = 0; frame < frames; frame += 1) {
    target.update(
      frame === 0 ? strikePacket() : new Float32Array(PACKET_LENGTH),
      1 / 60,
      LIGHTNING_DEFAULTS,
      presence,
    )
    target.render(encoder, view)
  }
}

beforeEach(() => {
  gpu = fakeDevice()
  ink = new LightningInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
})

describe('the lightning ink', () => {
  it('makes its two buffers and its pipeline once, sized for a full pool, and adds light through the ink blend', () => {
    expect(gpu.calls.buffers.map((buffer) => buffer.size)).toEqual([
      LIGHTNING_UNIFORM_FLOATS * 4,
      LIGHTNING_POOL * STRIKE_SEGMENTS * SEGMENT_FLOATS * 4,
    ])
    expect(gpu.calls.pipelines).toHaveLength(1)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    const targets = [...(descriptor.fragment?.targets ?? [])]
    expect(targets[0]?.blend).toBe(INK_BLEND)
    // Six corners a segment, one instance a segment.
    expect(descriptor.primitive?.topology).toBe('triangle-list')
    play(ink, gpu.encoder, 5)
    expect(gpu.calls.buffers).toHaveLength(2)
    expect(gpu.calls.pipelines).toHaveLength(1)
  })

  it('has nothing to say on the overlay while no bolt is lit, and how many once one is', () => {
    expect(ink.detail).toBe('')
    play(ink, gpu.encoder, 3)
    expect(ink.detail).toMatch(/^[1-9]\d* bolts$/)
  })

  it('encodes no pass and uploads nothing on a silent packet', () => {
    for (let frame = 0; frame < 120; frame += 1) {
      ink.update(new Float32Array(PACKET_LENGTH), 1 / 60, LIGHTNING_DEFAULTS, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('encodes no pass and uploads nothing at presence 0, however loud the drop', () => {
    play(ink, gpu.encoder, 5, 0)
    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('uploads the segments and the uniform and draws one quad a segment once a bolt is lit', () => {
    play(ink, gpu.encoder, 3)
    expect(gpu.calls.passes).toBeGreaterThan(0)
    for (const [vertices, instances] of gpu.calls.draws) {
      expect(vertices).toBe(6)
      expect(instances).toBeGreaterThan(0)
      expect(instances).toBeLessThanOrEqual(LIGHTNING_POOL * STRIKE_SEGMENTS)
    }

    // The segments and then the uniform, a pair every frame a bolt is lit.
    const [uniform, segments] = gpu.calls.buffers
    const writes = (buffer: Buffer | undefined) =>
      gpu.calls.writes.filter((write) => write.buffer === buffer)
    expect(writes(uniform)).toHaveLength(gpu.calls.passes)
    expect(writes(segments)).toHaveLength(gpu.calls.passes)
    for (const write of writes(uniform)) expect(write.floats).toBe(LIGHTNING_UNIFORM_FLOATS)
    for (const write of writes(segments)) expect(write.floats % SEGMENT_FLOATS).toBe(0)
  })

  it('hands the shader the canvas it was told about and the width against its short side', () => {
    ink.resize(1080, 1920)
    play(ink, gpu.encoder, 3)
    const uniform = gpu.calls.writes.find((write) => write.buffer === gpu.calls.buffers[0])?.data
    expect(uniform?.[0]).toBeCloseTo(1080 / 1920, 6)
    expect(uniform?.[1]).toBe(1920)
    expect(uniform?.[2]).toBeCloseTo(2.2, 6)
    expect(uniform?.[3]).toBeCloseTo(1, 6)
  })

  it('carries its presence in the blend constant, which is how an ink fades', () => {
    play(ink, gpu.encoder, 3, 0.25)
    expect(gpu.calls.blend.length).toBeGreaterThan(0)
    for (const colour of gpu.calls.blend)
      expect(colour).toEqual({ r: 0.25, g: 0.25, b: 0.25, a: 1 })
  })

  it('stops drawing the frame after the last bolt has gone', () => {
    play(ink, gpu.encoder, 30)
    const settled = gpu.calls.passes
    for (let frame = 0; frame < 60; frame += 1) {
      ink.update(new Float32Array(PACKET_LENGTH), 1 / 60, LIGHTNING_DEFAULTS, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.passes).toBe(settled)
  })

  it('releases its buffers and does nothing after that', () => {
    ink.dispose()
    expect(gpu.calls.buffers.every((buffer) => buffer.destroyed)).toBe(true)
    expect(() => play(ink, gpu.encoder, 5)).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })

  it('does nothing before it has a device', () => {
    const bare = new LightningInk()
    expect(() => play(bare, gpu.encoder, 5)).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })
})

// WGSL is compiled only by a browser, so what can be checked here is that the
// two halves agree about the buffers: the binding numbers and kinds, the size
// of the uniform, and where each thing sits in it.
describe('the shader against the buffers it reads', () => {
  it('reads binding 0 as the uniform and binding 1 as the segments, in the stages the layout says', () => {
    expect(shader).toMatch(/@group\(0\)\s+@binding\(0\)\s+var<uniform>\s+view\s*:\s*View/)
    expect(shader).toMatch(
      /@group\(0\)\s+@binding\(1\)\s+var<storage,\s*read>\s+segments\s*:\s*array<vec4<f32>>/,
    )
    const entries = [...(gpu.calls.layouts[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0, 1])
    expect(entries[0]?.buffer?.type).toBe('uniform')
    expect(entries[1]?.buffer?.type).toBe('read-only-storage')
    // The vertex stage widens the segments with both bindings; the fragment shapes the line from the uniform.
    expect(entries[0]?.visibility).toBe(1 | 2)
    expect(entries[1]?.visibility).toBe(1)
    const vertex = shader.slice(shader.indexOf('@vertex'), shader.indexOf('@fragment'))
    const fragment = shader.slice(shader.indexOf('@fragment'))
    expect(vertex).toMatch(/segments\[ii \* 2u\]/)
    expect(vertex).toMatch(/view\.aspect/)
    expect(fragment).toMatch(/view\.width/)
    expect(fragment).toMatch(/view\.edge/)
    expect(fragment).not.toMatch(/segments\[/)
  })

  it('binds the two buffers made, in that order', () => {
    const entries = [...(gpu.calls.groups[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0, 1])
    expect((entries[0]?.resource as GPUBufferBinding).buffer).toBe(gpu.calls.buffers[0])
    expect((entries[1]?.resource as GPUBufferBinding).buffer).toBe(gpu.calls.buffers[1])
  })

  it('declares the uniform as the aspect, the height, the width, the edge and the core, in the order the fill writes them', () => {
    const body = shader.match(/struct View\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const order = [...body.matchAll(/^\s*(\w+)\s*:\s*f32\s*,/gm)].map((match) => match[1])
    expect(order).toEqual(['aspect', 'height', 'width', 'edge', 'core'])
    // Padded to two vec4s, which is what the buffer holds.
    expect(order.length).toBeLessThanOrEqual(LIGHTNING_UNIFORM_FLOATS)
    expect(LIGHTNING_UNIFORM_FLOATS % 4).toBe(0)
  })

  it('widens each segment into six corners of two triangles', () => {
    expect(shader).toMatch(/var<private> corners = array<vec2<f32>, 6>/)
    expect(shader).toMatch(/mix\(p1, p2, corner\.x\) \+ perp \* side \* reach_px \/ view\.height/)
    // The quad reaches as far as the light does, and no further.
    expect(shader).toMatch(/let reach_px = view\.width \* 0\.5 \+ view\.edge/)
  })

  it('makes the falloff the one the params file mirrors: body and hot core over a smoothstep', () => {
    expect(shader).toMatch(/let half_width = view\.width \* 0\.5/)
    expect(shader).toMatch(/max\(half_width - view\.edge, 0\.0\)/)
    expect(shader).toMatch(/half_width \+ view\.edge/)
    expect(shader).toMatch(/1\.0 - smoothstep\(ramp_start, ramp_end, abs\(in\.across\)\)/)
    expect(shader).toMatch(/let core_half = half_width \* 0\.45/)
    // The body carries the colour, the core adds white on top.
    expect(shader).toMatch(
      /let glow = in\.colour \* body \+ vec3<f32>\(1\.0\) \* \(view\.core \* core\)/,
    )
    expect(shader).toMatch(/vec4<f32>\(glow \* in\.light, 1\.0\)/)
  })

  it('has the entry points the pipeline names, and writes alpha as 1 with the light in rgb, which the blend leaves alone', () => {
    expect(shader).toMatch(/@vertex\s+fn vs\(/)
    expect(shader).toMatch(/@fragment\s+fn fs\(/)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    expect(descriptor.vertex.entryPoint).toBe('vs')
    expect(descriptor.fragment?.entryPoint).toBe('fs')
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
