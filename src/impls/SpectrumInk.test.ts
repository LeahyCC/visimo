/**
 * The spectrum ring's GPU side against a stand-in for the device, so what it
 * makes once, what it uploads and what it encodes can be counted, and so the
 * bindings it declares can be read against the shader that uses them. What a
 * bar looks like needs a browser; that an ink with nothing to draw costs
 * nothing, and that the two halves of the ink agree about the buffers, does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import { INK_BLEND } from '../scenes/Impl'
import shader from '../shaders/spectrum.wgsl?raw'
import {
  BAND_LEVELS,
  BAND_PULSES,
  BAR_AT,
  BAR_FLOATS,
  BAR_UNIFORM_FLOATS,
  EDGE_PIXELS,
  MAX_BARS,
  TIP_LIGHT,
} from './spectrum.params'
import { SpectrumInk } from './SpectrumInk'

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

/** What the study resolves to over a busy groove, near enough. */
const GROOVE = {
  bars: 64,
  radius: 0.22,
  length: 0.15,
  width: 3,
  intensity: 0.3,
  hueSpread: 0.3,
  spin: 0.05,
}

/** A packet with something in every band. */
const sounding = (level = 0.6) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of BAND_LEVELS) out[field] = level
  for (const field of BAND_PULSES) out[field] = 0.3
  return out
}

let gpu: ReturnType<typeof fakeDevice>
let ink: SpectrumInk

/** Steps the ink through `seconds` of sound, and renders each frame. */
function play(
  target: SpectrumInk,
  encoder: GPUCommandEncoder,
  knobs: Record<string, number>,
  seconds: number,
  fps: number,
  presence = 1,
  features = sounding(),
) {
  for (let step = 0; step < Math.round(seconds * fps); step += 1) {
    target.update(features, 1 / fps, knobs, presence)
    target.render(encoder, view)
  }
}

beforeEach(() => {
  gpu = fakeDevice()
  ink = new SpectrumInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(1920, 1080)
})

describe('the spectrum ink', () => {
  it('makes its two buffers and its pipeline once, sized for a full ring, and adds light through the ink blend', () => {
    expect(gpu.calls.buffers.map((buffer) => buffer.size)).toEqual([
      BAR_UNIFORM_FLOATS * 4,
      MAX_BARS * BAR_FLOATS * 4,
    ])
    expect(gpu.calls.pipelines).toHaveLength(1)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    const targets = [...(descriptor.fragment?.targets ?? [])]
    expect(targets[0]?.blend).toBe(INK_BLEND)
    // One quad a bar, so a bar is a rectangle of real pixels and not a hairline.
    expect(descriptor.primitive?.topology).toBe('triangle-list')
    play(ink, gpu.encoder, GROOVE, 2, 60)
    expect(gpu.calls.buffers).toHaveLength(2)
    expect(gpu.calls.pipelines).toHaveLength(1)
  })

  it('has nothing to say on the overlay while no bar stands, and how many once they do', () => {
    expect(ink.detail).toBe('')
    play(ink, gpu.encoder, GROOVE, 1, 60)
    expect(ink.detail).toMatch(/^\d+ bars$/)
  })

  it('encodes no pass and uploads nothing on a silent packet, however long', () => {
    for (let frame = 0; frame < 300; frame += 1) {
      ink.update(new Float32Array(PACKET_LENGTH), 1 / 60, GROOVE, 1)
      ink.render(gpu.encoder, view)
    }

    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
    expect(ink.detail).toBe('')
  })

  it('encodes no pass and uploads nothing while there is no light, no count, no length or no width', () => {
    for (const off of [{ intensity: 0 }, { bars: 0 }, { length: 0 }, { width: 0 }]) {
      play(ink, gpu.encoder, { ...GROOVE, ...off }, 2, 60)
      expect(gpu.calls.writes, JSON.stringify(off)).toHaveLength(0)
      expect(gpu.calls.passes, JSON.stringify(off)).toBe(0)
    }
  })

  it('encodes no pass and uploads nothing at presence 0, however loud', () => {
    play(ink, gpu.encoder, GROOVE, 3, 60, 0, sounding(1))
    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('uploads the bars and the uniform and draws one quad an instance once there is sound', () => {
    play(ink, gpu.encoder, GROOVE, 1, 60)
    expect(gpu.calls.passes).toBe(60)
    for (const [vertices, instances] of gpu.calls.draws) {
      expect(vertices).toBe(6)
      expect(instances).toBeGreaterThan(0)
      expect(instances).toBeLessThanOrEqual(MAX_BARS)
    }

    // The bars and then the uniform, a pair every frame that has something lit.
    const [uniform, bars] = gpu.calls.buffers
    const writes = (buffer: Buffer | undefined) =>
      gpu.calls.writes.filter((write) => write.buffer === buffer)
    expect(writes(uniform)).toHaveLength(gpu.calls.passes)
    expect(writes(bars)).toHaveLength(gpu.calls.passes)
    for (const write of writes(uniform)) expect(write.floats).toBe(BAR_UNIFORM_FLOATS)
    for (const write of writes(bars)) expect(write.floats % BAR_FLOATS).toBe(0)
    // The whole ring at 64 bars is what this sound lights.
    expect(gpu.calls.draws.at(-1)?.[1]).toBe(64)
  })

  it('never draws more bars than its buffer holds, whatever count it is asked for', () => {
    play(ink, gpu.encoder, { ...GROOVE, bars: 5000 }, 1, 60, 1, sounding(1))
    for (const [, instances] of gpu.calls.draws) expect(instances).toBe(MAX_BARS)
    for (const write of gpu.calls.writes)
      expect(write.floats).toBeLessThanOrEqual(MAX_BARS * BAR_FLOATS)
  })

  it('hands the shader the canvas it was told about and the width against its short side', () => {
    ink.resize(1080, 1920)
    play(ink, gpu.encoder, GROOVE, 1, 60)
    const uniform = gpu.calls.writes.find((write) => write.buffer === gpu.calls.buffers[0])?.data
    expect(uniform?.[0]).toBe(1080)
    expect(uniform?.[1]).toBe(1920)
    expect(uniform?.[2]).toBeCloseTo(3, 6)
  })

  it('carries its presence in the blend constant, which is how an ink fades', () => {
    play(ink, gpu.encoder, GROOVE, 1, 60, 0.25)
    expect(gpu.calls.blend.length).toBeGreaterThan(0)
    for (const colour of gpu.calls.blend)
      expect(colour).toEqual({ r: 0.25, g: 0.25, b: 0.25, a: 1 })
  })

  it('turns the same amount in the same seconds at 30 and at 144 steps a second', () => {
    const directionAt = (fps: number) => {
      const fresh = fakeDevice()
      const other = new SpectrumInk()
      other.init({ device: fresh.device, format: 'rgba16float', software: false })
      other.resize(1920, 1080)
      play(other, fresh.encoder, { ...GROOVE, spin: 0.13 }, 3, fps)
      const rows = fresh.calls.writes
        .filter((write) => write.buffer === fresh.calls.buffers[1])
        .at(-1)?.data
      return [rows?.[BAR_AT.cos], rows?.[BAR_AT.sin]]
    }

    const slow = directionAt(30)
    const fast = directionAt(144)
    expect(slow[0]).toBeDefined()
    expect(fast[0]).toBeCloseTo(slow[0] ?? Number.NaN, 5)
    expect(fast[1]).toBeCloseTo(slow[1] ?? Number.NaN, 5)
  })

  it('keeps its clock through a silence, so the ring is where its turn has got to when the sound comes back', () => {
    const at = () => {
      const rows = gpu.calls.writes
        .filter((write) => write.buffer === gpu.calls.buffers[1])
        .at(-1)?.data
      return Math.atan2(rows?.[BAR_AT.sin] ?? 0, rows?.[BAR_AT.cos] ?? 0)
    }

    const knobs = { ...GROOVE, spin: 0.1 }
    play(ink, gpu.encoder, knobs, 1, 60)
    const before = at()
    for (let frame = 0; frame < 60; frame += 1)
      ink.update(new Float32Array(PACKET_LENGTH), 1 / 60, knobs, 1)
    play(ink, gpu.encoder, knobs, 1 / 60, 60)
    // The second of silence and the frame that came back are 61 frames, at a tenth of a turn a second.
    const turned = (((at() - before) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    expect(turned).toBeCloseTo((2 * Math.PI * 0.1 * 61) / 60, 3)
  })

  it('releases its buffers and does nothing after that', () => {
    ink.dispose()
    expect(gpu.calls.buffers.every((buffer) => buffer.destroyed)).toBe(true)
    expect(() => play(ink, gpu.encoder, GROOVE, 2, 60)).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })

  it('does nothing before it has a device', () => {
    const bare = new SpectrumInk()
    expect(() => play(bare, gpu.encoder, GROOVE, 2, 60)).not.toThrow()
    expect(gpu.calls.passes).toBe(0)
  })
})

// WGSL is compiled only by a browser, so what can be checked here is that the
// two halves agree about the buffers: the binding numbers and kinds, the size of
// the uniform and of a bar, and where each thing sits in them.
describe('the shader against the buffers it reads', () => {
  it('reads binding 0 as the uniform and binding 1 as the bars, in the stages the layout says', () => {
    expect(shader).toMatch(/@group\(0\)\s+@binding\(0\)\s+var<uniform>\s+params\s*:\s*Params/)
    expect(shader).toMatch(
      /@group\(0\)\s+@binding\(1\)\s+var<storage,\s*read>\s+bars\s*:\s*array<Bar>/,
    )
    const entries = [...(gpu.calls.layouts[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0, 1])
    expect(entries[0]?.buffer?.type).toBe('uniform')
    expect(entries[1]?.buffer?.type).toBe('read-only-storage')
    // The vertex stage places the corners from both, and the fragment stage shapes the sides from the uniform.
    expect(entries[0]?.visibility).toBe(1 | 2)
    expect(entries[1]?.visibility).toBe(1)
    const vertex = shader.slice(shader.indexOf('@vertex'), shader.indexOf('@fragment'))
    const fragment = shader.slice(shader.indexOf('@fragment'))
    expect(vertex).toMatch(/bars\[ii\]/)
    expect(vertex).toMatch(/params\.size/)
    expect(vertex).toMatch(/params\.width/)
    expect(fragment).toMatch(/params\.width/)
    expect(fragment).not.toMatch(/bars\[/)
  })

  it('binds the two buffers made, in that order', () => {
    const entries = [...(gpu.calls.groups[0]?.entries ?? [])]
    expect(entries.map((entry) => entry.binding)).toEqual([0, 1])
    expect((entries[0]?.resource as GPUBufferBinding).buffer).toBe(gpu.calls.buffers[0])
    expect((entries[1]?.resource as GPUBufferBinding).buffer).toBe(gpu.calls.buffers[1])
  })

  it('declares the uniform as four floats in the order the fill writes them', () => {
    const body = shader.match(/struct Params\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const order = [...body.matchAll(/^\s*(\w+)\s*:\s*(vec2<f32>|f32)\s*,/gm)].map(
      (match) => `${match[1]}:${match[2]}`,
    )
    expect(order).toEqual(['size:vec2<f32>', 'width:f32', 'pad:f32'])
    // Two, then one, then one: the four floats of BAR_UNIFORM_FLOATS.
    expect(2 + 1 + 1).toBe(BAR_UNIFORM_FLOATS)
  })

  it('declares a bar as two vec4s, which is the eight floats the fill writes, and reads each field from the slot it is written to', () => {
    const body = shader.match(/struct Bar\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const order = [...body.matchAll(/^\s*(\w+)\s*:\s*(vec4<f32>)\s*,/gm)].map(
      (match) => `${match[1]}:${match[2]}`,
    )
    expect(order).toEqual(['line:vec4<f32>', 'light:vec4<f32>'])
    expect(2 * 4).toBe(BAR_FLOATS)
    // The direction in xy, then the foot and the tip, and the light in rgb.
    expect(BAR_AT.cos).toBe(0)
    expect(BAR_AT.sin).toBe(1)
    expect(BAR_AT.inner).toBe(2)
    expect(BAR_AT.outer).toBe(3)
    expect([BAR_AT.red, BAR_AT.green, BAR_AT.blue]).toEqual([4, 5, 6])
    expect(shader).toMatch(/let dir = bar\.line\.xy/)
    expect(shader).toMatch(/let foot = bar\.line\.z/)
    expect(shader).toMatch(/let tip = bar\.line\.w/)
    expect(shader).toMatch(/out\.light = bar\.light\.rgb/)
  })

  it('draws a quad of six corners a bar, from one pixel behind the foot to one past the tip and a pixel past each side', () => {
    expect(shader).toMatch(/array<vec2<f32>,\s*6>/)
    expect(EDGE_PIXELS).toBe(1)
    expect(shader).toMatch(/mix\(foot - 1\.0, tip \+ 1\.0, corner\.x\)/)
    expect(shader).toMatch(/let reach = params\.width \* 0\.5 \+ 1\.0/)
    expect(shader).toMatch(/clamp\(params\.width \* 0\.5 \+ 0\.5 - abs\(in\.across\), 0\.0, 1\.0\)/)
    expect(shader).toMatch(/clamp\(in\.along \+ 1\.0, 0\.0, 1\.0\)/)
    expect(shader).toMatch(/clamp\(in\.span - in\.along \+ 1\.0, 0\.0, 1\.0\)/)
  })

  it('tapers to the tip’s share of the light that the params file says', () => {
    expect(shader).toContain(`const TIP_LIGHT: f32 = ${TIP_LIGHT};`)
    expect(shader).toMatch(
      /mix\(1\.0, TIP_LIGHT, clamp\(in\.along \/ max\(in\.span, 1\.0\), 0\.0, 1\.0\)\)/,
    )
  })

  it('has the entry points the pipeline names, and writes alpha as 1 with the light in rgb, which the blend leaves alone', () => {
    expect(shader).toMatch(/@vertex\s+fn quad\(/)
    expect(shader).toMatch(/@fragment\s+fn fs\(/)
    const descriptor = gpu.calls.pipelines[0] as GPURenderPipelineDescriptor
    expect(descriptor.vertex.entryPoint).toBe('quad')
    expect(descriptor.fragment?.entryPoint).toBe('fs')
    expect(shader).toMatch(/return vec4<f32>\(in\.light \* \(side \* ends \* taper\), 1\.0\)/)
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
