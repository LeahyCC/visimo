/**
 * The renderer, with every implementation mocked. Two things are checked
 * here and nowhere else.
 *
 * The lifetime: what is built, handed on and released as the cast changes,
 * the canvas resizes, the device is lost and the stage unmounts.
 *
 * And the numbers. `casts/preset-frames.json` is what the preset path
 * resolved to before it was deleted, and these tests drive real frames and
 * compare what each implementation and the post stack are handed against it.
 * The cast tests prove the studies layer lands on those numbers; this proves
 * the renderer hands each of them to the right implementation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { POST_KNOBS, POST_LANES, POST_STAGES } from '../post/params'
import type { PostParams } from '../post/params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { castOrDefault } from '../studies/casts/index'
import frames from '../studies/casts/preset-frames.json'
import type { Gpu } from './Device'

type PresetFrame = {
  preset: string
  packet: string
  level: number
  swell: number
  scene: Readonly<Record<string, number>>
  flow: Readonly<Record<string, number>> | null
  post: PostParams
}

const FRAMES = frames as unknown as readonly PresetFrame[]

const device = vi.hoisted(() => ({
  acquireGpu: vi.fn<() => Promise<Gpu | null>>(),
  unsubscribe: vi.fn(),
}))

const graphics = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn() }))

// The packet the mocked feature client writes, so a frame can be driven at
// any level without an AudioContext.
const audio = vi.hoisted(() => ({ attached: false, packet: null as Float32Array | null }))

/**
 * What the implementations saw. Each cast holds at most one of each, so the
 * class an implementation was built from says which study it is drawing for.
 */
const impls = vi.hoisted(() => ({
  built: { fluid: 0, dye: 0, fractal: 0, ribbon: 0 } as Record<string, number>,
  disposed: { fluid: 0, dye: 0, fractal: 0, ribbon: 0 } as Record<string, number>,
  seen: {} as Record<string, { knobs: Record<string, number>; presence: number }>,
  drawn: [] as string[],
  resized: [] as [number, number][],
  size: 0,
  maxFps: undefined as number | undefined,
  maxPixels: undefined as number | undefined,
  reset() {
    impls.built = { fluid: 0, dye: 0, fractal: 0, ribbon: 0 }
    impls.disposed = { fluid: 0, dye: 0, fractal: 0, ribbon: 0 }
    impls.seen = {}
    impls.drawn = []
    impls.resized = []
  },
}))

const record = (name: string, knobs: Record<string, number>, presence: number) => {
  impls.seen[name] = { knobs: { ...knobs }, presence }
}

vi.mock('../audio/AudioGraph', () => ({
  audioGraph: () => (audio.attached ? { attached: true, analyser: {} } : null),
}))

vi.mock('../audio/FeatureClient', () => ({
  FeatureClient: class {
    readonly waveform = null
    pump() {}
    readInto(out: Float32Array) {
      if (audio.packet) out.set(audio.packet)
    }
    dispose() {}
  },
}))

vi.mock('../impls/fluid', () => ({
  FluidFlow: class {
    readonly flow = null
    detail = 'flow detail'
    constructor(size: number) {
      impls.built.fluid = (impls.built.fluid ?? 0) + 1
      impls.size = size
    }
    init() {}
    resize(width: number, height: number) {
      impls.resized.push([width, height])
    }
    setSize(size: number) {
      impls.size = size
    }
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('fluid', knobs, presence)
    }
    simulate() {}
    dispose() {
      impls.disposed.fluid = (impls.disposed.fluid ?? 0) + 1
    }
  },
  DyeInk: class {
    readonly detail = 'dye detail'
    constructor(readonly source: unknown) {
      impls.built.dye = (impls.built.dye ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('dye', knobs, presence)
    }
    render() {
      impls.drawn.push('dye')
    }
    dispose() {
      impls.disposed.dye = (impls.disposed.dye ?? 0) + 1
    }
  },
}))

vi.mock('../scenes/Kaleidoscope', () => ({
  Kaleidoscope: class {
    readonly detail = 'fractal detail'
    constructor() {
      impls.built.fractal = (impls.built.fractal ?? 0) + 1
    }
    get maxFps() {
      return impls.maxFps
    }
    get maxPixels() {
      return impls.maxPixels
    }
    init() {}
    resize(width: number, height: number) {
      impls.resized.push([width, height])
    }
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('fractal', knobs, presence)
    }
    render() {
      impls.drawn.push('fractal')
    }
    dispose() {
      impls.disposed.fractal = (impls.disposed.fractal ?? 0) + 1
    }
  },
}))

vi.mock('../impls/RibbonInk', () => ({
  RibbonInk: class {
    readonly detail = ''
    constructor() {
      impls.built.ribbon = (impls.built.ribbon ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('ribbon', knobs, presence)
    }
    render() {
      impls.drawn.push('ribbon')
    }
    dispose() {
      impls.disposed.ribbon = (impls.disposed.ribbon ?? 0) + 1
    }
  },
}))

vi.mock('../impls/FlowBlend', () => ({
  FlowBlend: class {
    init() {}
    blend() {
      return null
    }
    dispose() {}
  },
}))

// What the stack was handed. The renderer resolves into one object and keeps
// it, so holding the reference is holding the live numbers.
const stack = vi.hoisted(() => ({ params: null as unknown, cleared: 0, prepared: 0 }))

vi.mock('../post/PostStack', () => ({
  SCENE_FORMAT: 'rgba16float',
  PostStack: class {
    init() {}
    useParams(params: unknown) {
      stack.params = params
    }
    get params() {
      return stack.params
    }
    target() {
      return {}
    }
    clear() {
      stack.cleared++
    }
    prepare() {
      stack.prepared++
    }
    render() {}
    resetHistory() {}
    dispose() {}
  },
}))

vi.mock('../scenes/KaleidoscopeWebGL', () => ({
  KaleidoscopeWebGL: class {
    adapter = 'test'
    detail = 'test'
    render = graphics.render
    dispose = graphics.dispose
    pixelRatio() {
      return 1
    }
  },
}))

vi.mock('../hud/Hud', () => ({
  Hud: class {
    setVisible() {}
    resize() {}
    record() {}
    draw() {}
  },
}))

vi.mock('./Device', () => ({
  acquireGpu: device.acquireGpu,
  onGpuLost: () => device.unsubscribe,
  configureCanvas: () => ({
    unconfigure: vi.fn(),
    getCurrentTexture: () => ({ createView: () => ({}) }),
  }),
}))

let renderer: typeof import('./Renderer').renderer

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  impls.reset()
  impls.maxFps = undefined
  impls.maxPixels = undefined
  audio.attached = false
  audio.packet = null
  stack.params = null
  stack.cleared = 0
  stack.prepared = 0
  renderer = (await import('./Renderer')).renderer
})

afterEach(() => {
  renderer.dispose()
  vi.restoreAllMocks()
})

function pendingAcquisition() {
  let finish: (value: null) => void = () => {}
  const pending = new Promise<null>((resolve) => {
    finish = resolve
  })
  device.acquireGpu.mockReturnValue(pending)
  return () => finish(null)
}

// These paths stop before canvas configuration, so they need no DOM or GPU.
const canvas = () => ({}) as HTMLCanvasElement

const gpuDevice = {
  createCommandEncoder: () => ({ finish: () => ({}) }),
  queue: { submit: vi.fn() },
} as unknown as GPUDevice

/** A canvas whose window hands back the frame callback, so tests can drive it. */
function sizedCanvas(width: number, height: number) {
  device.acquireGpu.mockResolvedValue({
    device: gpuDevice,
    format: 'bgra8unorm',
    info: { vendor: '', architecture: '', device: '', description: '', software: false },
    lost: false,
  })

  const held: { frame?: FrameRequestCallback } = {}
  const element = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    dataset: {} as Record<string, string>,
    ownerDocument: {
      defaultView: {
        devicePixelRatio: 1,
        performance: { now: () => 0 },
        requestAnimationFrame: (callback: FrameRequestCallback) => {
          held.frame = callback
          return 1
        },
        cancelAnimationFrame: vi.fn(),
        ResizeObserver: class {
          observe() {}
          disconnect() {}
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as HTMLCanvasElement

  return { element, draw: (now: number) => held.frame?.(now) }
}

/** Every field a mapping can read at one level; `lowEnd` is derived and follows. */
const packetAt = (level: number, swell: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS) if (field !== 'lowEnd') out[F[field]] = level
  out[F.swell] = swell
  return out
}

describe('renderer attachment lifetime', () => {
  it('sizes fresh implementations when the attached canvas already has its dimensions', async () => {
    const { element } = sizedCanvas(1412, 1020)
    renderer.setPreset(castOrDefault('prism'))
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('ok')
    expect(impls.resized).toContainEqual([1412, 1020])
    expect(element.width).toBe(1412)
    expect(element.height).toBe(1020)
  })

  it('holds an ink to its pixel budget and leaves the canvas at display size', async () => {
    impls.maxPixels = 2560 * 1440
    const { element } = sizedCanvas(3840, 2160)
    renderer.setPreset(castOrDefault('prism'))
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('ok')
    expect(impls.resized.at(-1)).toEqual([2560, 1440])
    expect(element.width).toBe(3840)
    expect(element.height).toBe(2160)
  })

  it('runs a flow beside an ink that solves none, sized with it', async () => {
    const { element } = sizedCanvas(1280, 720)
    renderer.setPreset(castOrDefault('melt'))
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('ok')
    expect(impls.built.fluid).toBe(1)
    expect(impls.resized).toContainEqual([1280, 720])
    // One control, one grid: the flow follows the fluid size wherever it is.
    renderer.setFluidSize(1024)
    expect(impls.size).toBe(1024)
  })

  it('keeps a flowless cast as it was, and drops the flow when one stops asking', async () => {
    const { element } = sizedCanvas(1280, 720)
    renderer.setPreset(castOrDefault('prism'))
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('ok')
    expect(impls.built.fluid).toBe(0)
    renderer.setPreset(castOrDefault('melt'))
    expect(impls.built.fluid).toBe(1)
    renderer.setPreset(castOrDefault('prism'))
    expect(impls.disposed.fluid).toBe(1)
  })

  // Two casts that draw the same way are a change of numbers, not of
  // machinery, and the fluid they share has a field worth keeping.
  it('hands an implementation on rather than rebuilding it', async () => {
    const { element } = sizedCanvas(1280, 720)
    renderer.setPreset(castOrDefault('plume'))
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('ok')
    expect(impls.built.fluid).toBe(1)
    expect(impls.built.dye).toBe(1)
    // Wash is the same solver and the same ink at other numbers.
    renderer.setPreset(castOrDefault('wash'))
    expect(impls.built.fluid).toBe(1)
    expect(impls.built.dye).toBe(1)
    expect(impls.disposed.fluid).toBe(0)
    // Drift adds the ribbon and keeps the rest.
    renderer.setPreset(castOrDefault('drift'))
    expect(impls.built.fluid).toBe(1)
    expect(impls.built.ribbon).toBe(1)
  })

  it('releases every implementation with everything else the device owned', async () => {
    renderer.setPreset(castOrDefault('melt'))
    await expect(renderer.attach(sizedCanvas(800, 600).element, canvas(), vi.fn())).resolves.toBe(
      'ok',
    )
    expect(impls.built.fluid).toBe(1)
    expect(impls.built.fractal).toBe(1)
    expect(impls.built.ribbon).toBe(1)
    renderer.dispose()
    expect(impls.disposed.fluid).toBe(1)
    expect(impls.disposed.fractal).toBe(1)
    expect(impls.disposed.ribbon).toBe(1)
  })

  it('cancels the old mount when the same canvas attaches again', async () => {
    const finish = pendingAcquisition()
    const element = canvas()
    renderer.setPreset(castOrDefault('plume'))
    const stale = renderer.attach(element, canvas(), vi.fn())
    renderer.detach(element)
    const current = renderer.attach(element, canvas(), vi.fn())
    finish()
    await expect(stale).resolves.toBe('cancelled')
    await expect(current).resolves.toBe('unsupported')
  })

  it('does not cancel another canvas waiting for the device', async () => {
    const finish = pendingAcquisition()
    renderer.setPreset(castOrDefault('plume'))
    const previous = canvas()
    const stale = renderer.attach(previous, canvas(), vi.fn())
    const current = renderer.attach(canvas(), canvas(), vi.fn())
    renderer.detach(previous)
    finish()
    await expect(stale).resolves.toBe('cancelled')
    await expect(current).resolves.toBe('unsupported')
  })

  it('cancels disposal during acquisition and removes the loss listener once', async () => {
    const finish = pendingAcquisition()
    const pending = renderer.attach(canvas(), canvas(), vi.fn())
    renderer.dispose()
    renderer.dispose()
    finish()
    await expect(pending).resolves.toBe('cancelled')
    await expect(renderer.attach(canvas(), canvas(), vi.fn())).resolves.toBe('cancelled')
    expect(device.unsubscribe).toHaveBeenCalledTimes(1)
    expect(device.acquireGpu).toHaveBeenCalledTimes(1)
  })

  it('requests a fresh stage when a former WebGPU canvas needs WebGL', async () => {
    device.acquireGpu.mockResolvedValue(null)
    renderer.setPreset(castOrDefault('prism'))
    const element = { dataset: { backend: 'webgpu' } } as unknown as HTMLCanvasElement
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('unsupported')
    expect(graphics.render).not.toHaveBeenCalled()
  })

  it('stops a failed frame and reports failure once, including after visibility changes', async () => {
    let scheduled: FrameRequestCallback | undefined
    let visibility: (() => void) | undefined
    const cancel = vi.fn()
    const request = vi.fn((callback: FrameRequestCallback) => {
      scheduled = callback
      return 17
    })
    const document = {
      visibilityState: 'visible',
      defaultView: {
        performance: { now: () => 0 },
        devicePixelRatio: 1,
        requestAnimationFrame: request,
        cancelAnimationFrame: cancel,
        ResizeObserver: class {
          observe() {}
          disconnect() {}
        },
      },
      addEventListener: (_event: string, callback: () => void) => {
        visibility = callback
      },
      removeEventListener: vi.fn(),
    }
    const element = {
      ownerDocument: document,
      clientWidth: 100,
      clientHeight: 100,
      width: 100,
      height: 100,
      dataset: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as HTMLCanvasElement
    const failure = vi.fn()
    const error = new Error('render target unavailable')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    device.acquireGpu.mockResolvedValue(null)
    graphics.render.mockImplementation(() => {
      throw error
    })
    renderer.setPreset(castOrDefault('prism'))
    await expect(renderer.attach(element, canvas(), failure)).resolves.toBe('ok')
    expect(renderer.postParams).not.toBeNull()
    expect(scheduled).toBeTypeOf('function')
    scheduled?.(16)
    expect(cancel).toHaveBeenCalledWith(17)
    expect(failure).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('Visualizer frame failed:', error)
    visibility?.()
    scheduled?.(32)
    expect(request).toHaveBeenCalledTimes(2)
    expect(graphics.render).toHaveBeenCalledTimes(1)
    expect(failure).toHaveBeenCalledTimes(1)
  })
})

describe('the WebGL2 fallback', () => {
  it('draws a cast that holds the fractal and refuses one that does not', async () => {
    const { element } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    renderer.setPreset(castOrDefault('plume'))
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('unsupported')
    // Melt holds the fractal, so it draws with that and skips the rest.
    renderer.setPreset(castOrDefault('melt'))
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('ok')
  })

  // Melt's fluid and its ribbon have no implementation without compute, and
  // the cast draws with the fractal that is left.
  it('skips the studies it cannot draw and builds nothing', async () => {
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    renderer.setPreset(castOrDefault('melt'))
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('ok')
    draw(16)
    expect(impls.built).toEqual({ fluid: 0, dye: 0, fractal: 0, ribbon: 0 })
    expect(graphics.render).toHaveBeenCalledTimes(1)
  })

  it('reports failure when a cast it cannot draw arrives while it is running', async () => {
    const { element } = sizedCanvas(320, 240)
    device.acquireGpu.mockResolvedValue(null)
    const failure = vi.fn()
    renderer.setPreset(castOrDefault('prism'))
    await expect(renderer.attach(element, canvas(), failure)).resolves.toBe('ok')
    renderer.setPreset(castOrDefault('plume'))
    expect(failure).toHaveBeenCalledTimes(1)
  })
})

describe('a pinned cast reaches its implementations unchanged', () => {
  /** Attach, feed this packet, draw one frame. */
  const drawWith = async (castId: string, level: number, swell: number) => {
    audio.attached = true
    audio.packet = packetAt(level, swell)
    const { element, draw } = sizedCanvas(1280, 720)
    renderer.setPreset(castOrDefault(castId))
    await renderer.attach(element, canvas(), vi.fn())
    // Past the frame cap a capped ink might ask for, so the frame draws.
    draw(1000)
    return element
  }

  for (const golden of FRAMES) {
    it(`${golden.preset} at ${golden.packet}: every implementation gets the preset's numbers`, async () => {
      await drawWith(golden.preset, golden.level, golden.swell)
      const handed: Record<string, number> = {}
      for (const seen of Object.values(impls.seen))
        for (const [knob, value] of Object.entries(seen.knobs))
          if (knob in golden.scene) handed[knob] = value
      expect(Object.keys(handed).sort()).toEqual(Object.keys(golden.scene).sort())
      for (const [knob, value] of Object.entries(golden.scene))
        expect(handed[knob], `${golden.preset} ${knob}`).toBeCloseTo(value, 10)
      for (const seen of Object.values(impls.seen)) expect(seen.presence).toBe(1)
    })

    it(`${golden.preset} at ${golden.packet}: the stack gets the preset's numbers`, async () => {
      await drawWith(golden.preset, golden.level, golden.swell)
      const post = stack.params as PostParams
      expect(post.enabled).toBe(golden.post.enabled)
      for (const stage of POST_STAGES)
        expect(post[stage].enabled, `${golden.preset} ${stage}`).toBe(golden.post[stage].enabled)
      for (const knob of POST_KNOBS)
        expect(POST_LANES[knob].read(post), `${golden.preset} ${knob}`).toBeCloseTo(
          POST_LANES[knob].read(golden.post),
          10,
        )
    })
  }

  // Melt is the one exception the port allows itself: its flow is cast on a
  // study with rows of its own, so the fluid under the fractal now answers
  // the music where the preset's `flowParams` sat still. Its resting numbers
  // are the preset's, which is what a silent packet shows.
  it('hands Melt’s flow the numbers the preset set, at silence', async () => {
    const golden = FRAMES.find((entry) => entry.preset === 'melt' && entry.packet === 'silence')
    if (!golden?.flow) throw new Error('Expected Melt at silence')
    await drawWith('melt', 0, 0)
    expect(impls.seen.fluid?.knobs).toEqual(golden.flow)
  })

  it('draws the inks in cast order, once each, into a cleared target', async () => {
    await drawWith('drift', 0.3, 0.5)
    expect(impls.drawn).toEqual(['dye', 'ribbon'])
    expect(stack.cleared).toBe(1)
    // The uniform before any ink, because the ribbon ink reads it.
    expect(stack.prepared).toBe(1)
  })

  // The detail line is the inks' in cast order and then the flows', with
  // anything empty left out; the ribbon has nothing to say and the real fluid
  // flow goes quiet under a dye ink, which `impls/fluid.test.ts` covers.
  it('prints what the five printed, and the cast beside it', async () => {
    const element = await drawWith('melt', 0.3, 0.5)
    expect(element.dataset.scene).toBe('kaleidoscope')
    expect(element.dataset.preset).toBe('melt')
    expect(element.dataset.detail).toBe('fractal detail + flow detail')
    expect(element.dataset.cast).toBe('turbulent-fluid fractal-glints ribbon clean-glass')
  })

  it('names the fluid as the scene for a cast whose ink is the dye', async () => {
    const element = await drawWith('plume', 0.3, 0.5)
    expect(element.dataset.scene).toBe('fluid')
    expect(element.dataset.cast).toBe('lazy-fluid dye-plumes warm-soft')
  })
})
