/**
 * The post stack's GPU side against a stand-in for the device, so what it
 * builds, when, and what it encodes each frame can be counted. What the passes
 * draw needs a browser; that a frame allocates nothing, that the bloom chain is
 * the passes it should be at each radius, and that they share one named
 * bind group layout, does not.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { PACKET_LENGTH } from '../audio/FeatureExtractor'
import { bloomLevelCount, bloomWeights } from './bloom'
import type { PostPatch } from './params'
import { PostStack } from './PostStack'

vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, STORAGE: 2, COPY_DST: 4 })
vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2 })
vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2, COPY_DST: 4 })

type Pipeline = {
  label: string
  scaled: boolean
  layout: unknown
  getBindGroupLayout: () => unknown
}
type Pass = { label: string; scaled: boolean; load: string; constant: number | undefined }
type Texture = { width: number; height: number; destroyed: boolean }

/** Which shader a module is, from a line only it has. */
const LABELS: [string, string][] = [
  ['One step down the bloom chain', 'down'],
  ['One step up the bloom chain', 'up'],
  ['Bright pass and the first downsample', 'bright'],
  ['The last pass', 'composite'],
]

function fakeDevice() {
  const counts = { groups: 0, textures: 0, buffers: 0, views: 0, layouts: 0 }
  const textures: Texture[] = []
  const layouts: { entries: unknown[] }[] = []
  const groups: { layout: unknown }[] = []
  const passes: Pass[] = []
  const pipelines: Pipeline[] = []
  const pipelineLayouts = new Map<unknown, unknown>()

  const device = {
    createShaderModule: ({ code }: { code: string }) => ({
      code,
      getCompilationInfo: () => Promise.resolve({ messages: [] }),
    }),
    createBuffer: () => {
      counts.buffers += 1
      return { destroy: vi.fn() }
    },
    createSampler: () => ({}),
    createBindGroupLayout: (descriptor: { entries: unknown[] }) => {
      counts.layouts += 1
      layouts.push(descriptor)
      return descriptor
    },
    createPipelineLayout: ({ bindGroupLayouts }: { bindGroupLayouts: unknown[] }) => {
      const layout = { bindGroupLayouts }
      pipelineLayouts.set(layout, bindGroupLayouts[0])
      return layout
    },
    createRenderPipeline: (descriptor: {
      layout: unknown
      fragment: { module: { code: string }; targets: { blend?: unknown }[] }
    }) => {
      const code = descriptor.fragment.module.code
      const label = LABELS.find(([mark]) => code.includes(mark))?.[1] ?? 'other'
      const pipeline: Pipeline = {
        label,
        scaled: !!descriptor.fragment.targets[0]?.blend && label === 'down',
        layout: pipelineLayouts.get(descriptor.layout),
        getBindGroupLayout: () => ({}),
      }
      pipelines.push(pipeline)
      return pipeline
    },
    createTexture: ({ size }: { size: { width: number; height: number } }) => {
      counts.textures += 1
      const texture: Texture = { width: size.width, height: size.height, destroyed: false }
      textures.push(texture)
      return {
        createView: () => {
          counts.views += 1
          return {}
        },
        destroy: () => (texture.destroyed = true),
      }
    },
    createBindGroup: (descriptor: { layout: unknown }) => {
      counts.groups += 1
      groups.push(descriptor)
      return {}
    },
    queue: { writeBuffer: vi.fn(), writeTexture: vi.fn() },
  }

  const encoder = {
    beginRenderPass: ({ colorAttachments }: { colorAttachments: { loadOp: string }[] }) => {
      const pass: Pass & { end: () => void } = {
        label: '',
        scaled: false,
        load: colorAttachments[0]?.loadOp ?? '',
        constant: undefined,
        end: () => passes.push({ ...pass }),
      }
      return {
        setPipeline: (pipeline: Pipeline) => {
          pass.label = pipeline.label
          pass.scaled = pipeline.scaled
        },
        setBlendConstant: (colour: { r: number }) => (pass.constant = colour.r),
        setBindGroup: vi.fn(),
        draw: vi.fn(),
        end: pass.end,
      }
    },
  }

  return {
    counts,
    textures,
    layouts,
    groups,
    passes,
    pipelines,
    device: device as unknown as GPUDevice,
    encoder: encoder as unknown as GPUCommandEncoder,
  }
}

const features = new Float32Array(PACKET_LENGTH)
const canvasView = {} as GPUTextureView
const two = [{ view: {} }, { view: {} }] as never[]

function setup(width = 2560, height = 1440, patch: PostPatch = {}) {
  const rig = fakeDevice()
  const stack = new PostStack()
  stack.init(rig.device, 'bgra8unorm')
  stack.setParams(patch)
  const frame = (at: number) => {
    stack.target(width, height)
    stack.prepare(features, null)
    stack.render(rig.encoder, canvasView, features, two[at % 2] ?? null)
  }

  return { ...rig, stack, frame }
}

/** The passes of one frame's bloom, by label, in the order they were encoded. */
const bloomPasses = (passes: Pass[]) =>
  passes.filter((pass) => ['bright', 'down', 'up'].includes(pass.label))

let rig: ReturnType<typeof setup>

describe('the post stack allocates nothing once it has been sized', () => {
  beforeEach(() => {
    rig = setup()
  })

  it('makes no bind group, texture, view or buffer across a hundred frames', () => {
    // Enough frames for the history to swap, the flow to alternate and every
    // pairing the feedback group can see to have been seen.
    rig.frame(0)
    const sized = rig.counts.groups
    for (let at = 1; at < 6; at++) rig.frame(at)
    // The feedback pass did run, and built its groups on the way: without that
    // this would count a stack that never drew the pass it is about.
    expect(rig.counts.groups).toBeGreaterThan(sized)
    const before = { ...rig.counts }
    for (let at = 6; at < 106; at++) rig.frame(at)
    expect(rig.counts).toEqual(before)
  })

  it('builds again only when the canvas changes size', () => {
    rig.frame(0)
    const before = rig.counts.textures
    rig.stack.target(1280, 720)
    expect(rig.counts.textures).toBeGreaterThan(before)
    // And what it replaced is destroyed, so a resize does not leak.
    expect(rig.textures.slice(1, before).every((texture) => texture.destroyed)).toBe(true)
  })
})

describe('the bloom chain as the stack encodes it', () => {
  it('runs one more level than the canvas has to, and the last is 16 to 32 pixels tall', () => {
    const { textures, frame } = setup(3840, 2160)
    frame(0)
    // The still texel from init, the two history textures, then the levels:
    // half the canvas and down.
    const levels = textures.slice(3, 3 + bloomLevelCount(3840, 2160))
    expect(levels).toHaveLength(7)
    expect(levels[0]).toMatchObject({ width: 1920, height: 1080 })
    const last = levels.at(-1)
    expect(last?.height).toBeGreaterThanOrEqual(16)
    expect(last?.height).toBeLessThanOrEqual(32)
  })

  it('runs the three tight levels at a radius of 0 and every level at a radius of 1', () => {
    const tight = setup(2560, 1440, { feedback: { enabled: false }, bloom: { radius: 0 } })
    tight.frame(0)
    const wide = setup(2560, 1440, { feedback: { enabled: false }, bloom: { radius: 1 } })
    wide.frame(0)
    const count = (passes: Pass[], label: string) =>
      passes.filter((pass) => pass.label === label).length
    expect(count(tight.passes, 'bright')).toBe(1)
    expect(count(tight.passes, 'down')).toBe(2)
    expect(count(tight.passes, 'up')).toBe(2)
    expect(count(wide.passes, 'down')).toBe(bloomLevelCount(2560, 1440) - 1)
    expect(count(wide.passes, 'up')).toBe(bloomLevelCount(2560, 1440) - 1)
  })

  it('scales the last level as it is written and each other level as it is added into', () => {
    const rigged = setup(2560, 1440, { feedback: { enabled: false } })
    rigged.frame(0)
    const count = bloomLevelCount(2560, 1440)
    const weights = bloomWeights(rigged.stack.params.bloom, new Float32Array(count))
    const chain = bloomPasses(rigged.passes)
    // Down the chain: only the last is scaled, by its own weight.
    const downs = chain.filter((pass) => pass.label === 'down')
    expect(downs.filter((pass) => pass.scaled)).toHaveLength(1)
    expect(downs.at(-1)?.scaled).toBe(true)
    expect(downs.at(-1)?.constant).toBeCloseTo(weights[count - 1] ?? -1, 6)
    // Up it, level 4 first and level 0 last, each keeping its own weight.
    const ups = chain.filter((pass) => pass.label === 'up')
    expect(ups.map((pass) => pass.constant)).toEqual(
      Array.from({ length: count - 1 }, (_, at) => Math.fround(weights[count - 2 - at] ?? -1)),
    )
    // A blend constant is a share of one, whatever the radius.
    for (const pass of chain) expect(pass.constant ?? 0).toBeLessThanOrEqual(1)
    // The chain adds into what is there, so it does not clear it; the writes
    // that start each level from nothing do.
    for (const pass of ups) expect(pass.load).toBe('load')
    for (const pass of downs) expect(pass.load).toBe('clear')
  })

  it('draws nothing of it with the stage off, and clears the glow when it has no weight', () => {
    const off = setup(2560, 1440, { feedback: { enabled: false }, bloom: { enabled: false } })
    off.frame(0)
    expect(bloomPasses(off.passes)).toHaveLength(0)
    const none = setup(2560, 1440, {
      feedback: { enabled: false },
      bloom: { radius: 0, weights: [0, 0, 0] },
    })
    none.frame(0)
    expect(bloomPasses(none.passes)).toHaveLength(0)
    // Level 0 is emptied so the composite does not add last frame's glow.
    expect(none.passes.some((pass) => pass.label === '' && pass.load === 'clear')).toBe(true)
  })

  it('costs the tight chain only, until a look asks for a radius', () => {
    const passesAt = (radius: number) => {
      const rigged = setup(2560, 1440, { feedback: { enabled: false }, bloom: { radius } })
      rigged.frame(0)
      return bloomPasses(rigged.passes).length
    }

    expect(passesAt(0)).toBe(5)
    expect(passesAt(0.3)).toBe(11)
    expect(passesAt(1)).toBe(11)
  })
})

describe('the bloom passes share one named bind group layout', () => {
  it('makes it once, at three bindings, and every bloom group is built on it', () => {
    const { layouts, groups, pipelines, frame } = setup()
    frame(0)
    // The bloom layout is the one that is neither the feedback's (five
    // bindings), the measuring ladder's (two) nor the ribbon's.
    const three = layouts.filter((layout) => layout.entries.length === 3)
    expect(three).toHaveLength(1)
    const [named] = three
    for (const label of ['bright', 'down', 'up'])
      for (const pipeline of pipelines.filter((one) => one.label === label))
        expect(pipeline.layout, label).toBe(named)
    // Two chains' worth of groups, all on it: bright for each history texture,
    // a down and an up for each level but the ends.
    const count = bloomLevelCount(2560, 1440)
    expect(groups.filter((group) => group.layout === named)).toHaveLength(2 + 2 * (count - 1))
  })
})

describe('what the stack does with a patch mid-run', () => {
  it('reads the radius each frame, with nothing rebuilt', () => {
    const rigged = setup(2560, 1440, { feedback: { enabled: false } })
    rigged.frame(0)
    const counts = { ...rigged.counts }
    rigged.stack.setParams({ bloom: { radius: 0 } })
    rigged.passes.length = 0
    rigged.frame(1)
    expect(bloomPasses(rigged.passes)).toHaveLength(5)
    expect(rigged.counts).toEqual(counts)
  })
})
