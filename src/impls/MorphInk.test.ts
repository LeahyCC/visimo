/**
 * The shape morph's GPU side against a stand-in for the device. The kit's own
 * half is held in `RaymarchInk.test.ts`; what is here is what this ink adds to
 * it: that a silent packet costs nothing, that the melt keeps running while
 * nothing is drawn, that the uniform it uploads is the one its params file
 * wrote, and that its shader names what the kit hands it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import type { Tuning } from '../presets/knobs'
import type { InkImpl } from '../scenes/Impl'
import shader from '../shaders/morph.wgsl?raw'
import common from '../shaders/raymarch.common.wgsl?raw'
import { FORMS, MELT_SECONDS, MORPH_UNIFORM_FLOATS } from './morph.params'
import { MorphInk } from './MorphInk'

vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 4 })
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 })
vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 1 })

function fakeDevice() {
  const calls = { writes: [] as Float32Array[], passes: 0, textures: 0 }
  const pass = {
    setPipeline: vi.fn(),
    setBlendConstant: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  }

  const device = {
    createShaderModule: () => ({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
    createBuffer: ({ size }: { size: number }) => ({ size, destroy: vi.fn() }),
    createTexture: () => {
      calls.textures += 1
      return { destroy: vi.fn(), createView: () => ({}) }
    },
    createSampler: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createRenderPipeline: () => ({}),
    createBindGroup: () => ({}),
    queue: {
      writeBuffer: (_buffer: unknown, _offset: number, data: Float32Array) =>
        calls.writes.push(data.slice()),
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

/** What the study resolves to over a groove, near enough. */
const GROOVE: Tuning = {
  size: 0.55,
  ripple: 0.03,
  rippleScale: 11,
  spin: 0.4,
  tumble: 0.1,
  rim: 0.6,
  specular: 1.8,
  hue: 0.2,
  intensity: 0.8,
  glint: 0.6,
  glintKnee: 0.45,
} as Tuning

const packetAt = (energy: number, section = 1) => {
  const out = new Float32Array(PACKET_LENGTH)
  out[F.energy] = energy
  out[F.section] = section
  return out
}

const view = {} as GPUTextureView

let gpu: ReturnType<typeof fakeDevice>
let ink: MorphInk

const draw = (packet: Float32Array, dt = 1 / 60, presence = 1) => {
  ink.update(packet, dt, GROOVE, presence)
  ink.render(gpu.encoder, view)
}

beforeEach(() => {
  gpu = fakeDevice()
  ink = new MorphInk()
  ink.init({ device: gpu.device, format: 'rgba16float', software: false })
  ink.resize(2560, 1440)
})

describe('the shape morph ink', () => {
  it('draws nothing at all on a silent packet: no upload, no pass, no target', () => {
    for (let frame = 0; frame < 10; frame += 1) draw(packetAt(0))
    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
    expect(gpu.calls.textures).toBe(0)
  })

  it('uploads one uniform and encodes two passes a frame while it is lit', () => {
    draw(packetAt(1))
    expect(gpu.calls.writes).toHaveLength(1)
    expect(gpu.calls.writes[0]).toHaveLength(MORPH_UNIFORM_FLOATS)
    expect(gpu.calls.passes).toBe(2)
  })

  it('costs nothing at presence 0, as the director’s fade requires', () => {
    draw(packetAt(1), 1 / 60, 0)
    expect(gpu.calls.writes).toHaveLength(0)
    expect(gpu.calls.passes).toBe(0)
  })

  it('keeps melting while it is dark, so a section that turned over has landed', () => {
    // A section boundary during a silent passage, then the music comes back
    // after the melt would have finished.
    draw(packetAt(1, 1))
    const first = gpu.calls.writes[0]?.[9]
    for (let frame = 0; frame < Math.round(MELT_SECONDS / (1 / 60)) + 2; frame += 1)
      draw(packetAt(0, 2))
    draw(packetAt(1, 2))
    const after = gpu.calls.writes.at(-1)
    expect(after?.[9]).not.toBe(first)
    // Arrived: the melt is over rather than starting now, and the form it
    // melted out of is the one that was showing before the boundary.
    expect(after?.[10]).toBe(1)
    expect(after?.[8]).toBe(first)
  })

  it('says what is on screen, and at what size, for the overlay', () => {
    draw(packetAt(1, 1))
    // Marched at the ink target's own size, not the kit's half.
    expect(ink.detail).toMatch(/2560x1440 marched$/)
    expect(FORMS.some((form) => ink.detail.startsWith(form))).toBe(true)
  })

  it('caps no frame rate: it marches a quarter of the frame and costs almost nothing', () => {
    // Read through the interface, since the class does not declare the field
    // at all: the renderer takes the lowest cap among the live inks, and one
    // here would hold a whole cast to 60 for an ink that costs 0.1 ms.
    const capped: InkImpl = ink
    expect(capped.maxFps).toBeUndefined()
  })
})

describe('the shader and the ink agree', () => {
  it('writes the one function the kit marches, and reads the uniform the ink fills', () => {
    expect(shader).toContain('fn sceneDistance(point: vec3<f32>) -> f32')
    expect(shader).toContain('@group(0) @binding(0) var<uniform> params: Params;')
    expect(shader).toContain('@fragment')
    // The vertex stage is the shared file's, and this must not declare a second.
    expect(shader).not.toContain('@vertex')
    expect(common).toContain('@vertex')
  })

  it('reads every vec4 the uniform carries, and no more', () => {
    for (const member of ['screen', 'camera', 'form', 'motion', 'light', 'key', 'rim'])
      expect(shader).toContain(`  ${member}: vec4<f32>,`)
    const members = [...shader.matchAll(/^ {2}(\w+): vec4<f32>,$/gm)]
    expect(members).toHaveLength(MORPH_UNIFORM_FLOATS / 4)
  })

  it('uses no name WGSL reserves, and assigns to nothing declared with let', () => {
    for (const word of ['from', 'target', 'filter', 'sample', 'half', 'smooth', 'union'])
      expect(shader).not.toMatch(new RegExp(`(let|var|fn|const)\\s+${word}\\b`))
    for (const line of shader.split('\n')) {
      const declared = /^\s*let\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(line)
      if (!declared?.[1]) continue
      expect(shader).not.toMatch(new RegExp(`^\\s*${declared[1]}\\s*=`, 'm'))
    }
  })

  it('keeps the numbers it shares with its params file in step', () => {
    for (const [name, value] of [
      ['RIM_BASE', '1.8'],
      ['RIM_FRONT', '0.45'],
      ['SHADE_FLOOR', '0.5'],
      ['TERMINATOR', '0.035'],
      ['SPECULAR_WHITE', '0.65'],
      ['MORPH_LIGHT', '2.0'],
      ['MARCH_SAFETY', '0.55'],
    ])
      expect(shader).toContain(`const ${name} = ${value};`)
  })
})
