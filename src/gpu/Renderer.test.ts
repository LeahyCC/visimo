/**
 * The renderer, with every implementation mocked. Two things are checked
 * here and nowhere else.
 *
 * The lifetime: what is built, handed on and released as the cast changes,
 * the canvas resizes, the device is lost and the stage unmounts.
 *
 * And the director at the seam it meets the renderer at, played the scripted
 * song of `director/song.fixture.ts` a frame at a time: what a whole track
 * does to what is built, and that two plays of it are the same picture.
 *
 * And the numbers. `casts/preset-frames.json` is what the preset path
 * resolved to before it was deleted, and these tests drive real frames and
 * compare what each implementation and the post stack are handed against it.
 * The cast tests prove the studies layer lands on those numbers; this proves
 * the renderer hands each of them to the right implementation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { playSong, SONG_SECONDS } from '../director/song.fixture'
import { POST_KNOBS, POST_LANES, POST_STAGES } from '../post/params'
import type { PostParams } from '../post/params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { defaultCanvas } from '../studies/cast'
import { castOrDefault } from '../studies/casts/index'
import frames from '../studies/casts/preset-frames.json'
import type { ImplId } from '../studies/impls'
import { STUDIES } from '../studies/registry'
import type { LiveCast } from '../studies/resolve'
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
  built: { fluid: 0, analytic: 0, dye: 0, fractal: 0, ribbon: 0 } as Record<string, number>,
  disposed: { fluid: 0, analytic: 0, dye: 0, fractal: 0, ribbon: 0 } as Record<string, number>,
  seen: {} as Record<string, { knobs: Record<string, number>; presence: number }>,
  /** How many times each was stepped, so a second solver would double it. */
  updates: {} as Record<string, number>,
  drawn: [] as string[],
  /** What the ribbon was told to read its samples from. */
  waveform: null as (() => Float32Array | null) | null,
  resized: [] as [number, number][],
  size: 0,
  maxFps: undefined as number | undefined,
  maxPixels: undefined as number | undefined,
  reset() {
    impls.built = { fluid: 0, analytic: 0, dye: 0, fractal: 0, ribbon: 0 }
    impls.disposed = { fluid: 0, analytic: 0, dye: 0, fractal: 0, ribbon: 0 }
    impls.seen = {}
    impls.updates = {}
    impls.drawn = []
    impls.waveform = null
    impls.resized = []
  },
}))

const record = (name: string, knobs: Record<string, number>, presence: number) => {
  impls.seen[name] = { knobs: { ...knobs }, presence }
  impls.updates[name] = (impls.updates[name] ?? 0) + 1
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

vi.mock('../impls/analytic', () => ({
  AnalyticFlow: class {
    readonly flow = null
    detail = 'analytic detail'
    constructor() {
      impls.built.analytic = (impls.built.analytic ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('analytic', knobs, presence)
    }
    simulate() {}
    dispose() {
      impls.disposed.analytic = (impls.disposed.analytic ?? 0) + 1
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
    constructor(_post: unknown, waveform: () => Float32Array | null) {
      impls.built.ribbon = (impls.built.ribbon ?? 0) + 1
      impls.waveform = waveform
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
const stack = vi.hoisted(() => ({ params: null as unknown, cleared: 0, prepared: 0, reset: 0 }))

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
    resetHistory() {
      stack.reset++
    }
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
  // One test makes this throw, and a mock implementation outlives the test
  // that set it.
  graphics.render.mockImplementation(() => {})
  stack.params = null
  stack.cleared = 0
  stack.prepared = 0
  stack.reset = 0
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

/** Draw for this many seconds, at the longest frame the renderer will take. */
function seconds(draw: (now: number) => void, span: number, from = 0) {
  const step = 100
  for (let at = 1; at <= Math.round((span * 1000) / step); at += 1) draw(from + at * step)
  return from + Math.round((span * 1000) / step) * step
}

/**
 * The moment rows. The preset frames were captured before these existed, so
 * every preset saw them at 0, and a packet that is to land on those frames
 * has to say the same. Tension in particular is read by every study.
 */
const MOMENT_FIELDS: readonly string[] = ['tension', 'release', 'rest', 'impact']

/** Every field a mapping can read at one level; `lowEnd` is derived and follows. */
const packetAt = (level: number, swell: number) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const field of AUDIO_FIELDS)
    if (field !== 'lowEnd' && !MOMENT_FIELDS.includes(field)) out[F[field]] = level
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
    const { element, draw } = sizedCanvas(1280, 720)
    renderer.setPreset(castOrDefault('prism'))
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('ok')
    expect(impls.built.fluid).toBe(0)
    renderer.setPreset(castOrDefault('melt'))
    expect(impls.built.fluid).toBe(1)
    renderer.setPreset(castOrDefault('prism'))
    // Nothing is torn down on the frame its study left: a study that comes
    // straight back finds its implementation still here.
    expect(impls.disposed.fluid).toBe(0)
    seconds(draw, 1)
    expect(impls.disposed.fluid).toBe(0)
    seconds(draw, 7)
    expect(impls.disposed.fluid).toBe(1)
  })

  it('hands a held implementation back rather than building a second', async () => {
    const { element, draw } = sizedCanvas(1280, 720)
    renderer.setPreset(castOrDefault('melt'))
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('ok')
    renderer.setPreset(castOrDefault('prism'))
    seconds(draw, 2)
    renderer.setPreset(castOrDefault('melt'))
    expect(impls.built.fluid).toBe(1)
    expect(impls.disposed.fluid).toBe(0)
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
    expect(impls.built).toEqual({ fluid: 0, analytic: 0, dye: 0, fractal: 0, ribbon: 0 })
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

  // A pinned cast used to carry a tension of its own, fixed at 0, so nothing
  // under the five shipped casts wound up with a build. It is read from the
  // packet now, the way a chosen cast's is.
  it('winds a pinned cast up with the packet’s tension', async () => {
    await drawWith('melt', 0, 0)
    const rest = impls.seen.fluid?.knobs.vorticity ?? 0
    const wound = packetAt(0, 0)
    wound[F.tension] = 1
    audio.packet = wound
    const { element, draw } = sizedCanvas(1280, 720)
    await renderer.attach(element, canvas(), vi.fn())
    draw(2000)
    // Turbulent fluid's own row: tension climbs the vorticity by 12 at full.
    expect(impls.seen.fluid?.knobs.vorticity).toBeCloseTo(rest + 12, 10)
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

describe('the director drives the cast', () => {
  const FPS = 30

  /**
   * Which frames of a trace had a study of this implementation live on them,
   * read from the registry rather than by name, so a study added later is
   * counted without anyone remembering to add it here.
   */
  const liveFrames = (trace: readonly string[], impl: ImplId): boolean[] => {
    const ids = STUDIES.filter((study) => study.impl === impl).map((study) => study.id)
    return trace.map((line) => ids.some((id) => new RegExp(`(^|, )${id} `).test(line)))
  }

  /**
   * A renderer of its own, the scripted song played through it a frame at a
   * time, and what was live on each of those frames. The module is reset so
   * the two plays a determinism test needs start from the same nothing.
   */
  async function playThrough(preset: 'auto' | ReturnType<typeof castOrDefault>) {
    vi.resetModules()
    impls.reset()
    stack.reset = 0
    const fresh = (await import('./Renderer')).renderer
    const { element, draw } = sizedCanvas(1280, 720)
    audio.attached = true
    fresh.setPreset(preset)
    await fresh.attach(element, canvas(), vi.fn())
    const trace: string[] = []
    let now = 0
    let frames = 0
    for (const frame of playSong(FPS)) {
      audio.packet = frame.features
      now += 1000 / FPS
      draw(now)
      frames += 1
      trace.push(
        fresh.liveCast.studies
          .map((entry) => `${entry.id} ${entry.presence.toFixed(6)}`)
          .join(', '),
      )
    }

    return { renderer: fresh, element, trace, frames }
  }

  // The two things the renderer review left for this card, over a whole
  // track rather than over one change: a glide must not empty the canvas,
  // and a fade between two studies of one solver must not build a second.
  //
  // The solver is no longer live for the whole song. Implode is a flow of
  // another implementation entirely and wins this song's build outright, for
  // long enough that the fluid's grace runs out and it is released, so what
  // is held to here is the invariant rather than the count: one solver per
  // stretch in which a fluid study is live, stepped once on each of those
  // frames whichever of the two studies is fading into the other.
  it('never empties the canvas and never builds a second solver', async () => {
    const song = await playThrough('auto')
    expect(stack.reset).toBe(0)
    const stirring = liveFrames(song.trace, 'fluid')
    const frames = stirring.filter(Boolean).length
    const stretches = stirring.filter((on, at) => on && !stirring[at - 1]).length
    expect(frames).toBeGreaterThan(0)
    expect(stretches).toBeGreaterThan(0)
    // Never more than one build per stretch; a stretch that starts again
    // inside the grace takes the solver back rather than building one.
    expect(impls.built.fluid).toBeLessThanOrEqual(stretches)
    expect(impls.disposed.fluid).toBeLessThanOrEqual(impls.built.fluid ?? 0)
    expect(impls.updates.fluid).toBe(frames)
    // What takes its place through the build, which is the analytic flow.
    // The two overlap while the change glides, so this is not the rest of
    // the song; each is stepped on exactly the frames its studies are live.
    expect(frames).toBeLessThan(song.frames)
    expect(impls.updates.analytic).toBe(liveFrames(song.trace, 'analytic').filter(Boolean).length)
    expect(impls.updates.analytic).toBeGreaterThan(0)
    expect(song.trace.some((line) => (line.match(/fluid/g) ?? []).length > 1)).toBe(true)
    expect(new Set(song.trace).size).toBeGreaterThan(1)
    song.renderer.dispose()
  })

  it('plays the same song the same way twice', async () => {
    const first = await playThrough('auto')
    first.renderer.dispose()
    const second = await playThrough('auto')
    second.renderer.dispose()
    expect(second.trace).toEqual(first.trace)
    expect(first.trace.at(-1)).not.toBe('')
  })

  it('prints auto and the live study ids on the canvas', async () => {
    const song = await playThrough('auto')
    expect(song.element.dataset.preset).toBe('auto')
    const ids = song.element.dataset.cast?.split(' ') ?? []
    expect(ids.length).toBeGreaterThan(1)
    for (const id of ids) expect(typeof id).toBe('string')
    expect(song.element.dataset.scene).toBeTypeOf('string')
    song.renderer.dispose()
  })

  // A pinned cast is what it always was, and the director still reads the
  // song behind it, which is what a host saving the character wants.
  it('leaves a pinned cast alone and still reads the song behind it', async () => {
    const song = await playThrough(castOrDefault('plume'))
    expect(song.element.dataset.preset).toBe('plume')
    expect(song.element.dataset.cast).toBe('lazy-fluid dye-plumes warm-soft')
    expect(new Set(song.trace).size).toBe(1)
    expect(song.renderer.settled).toBe(1)
    song.renderer.dispose()
  })

  // Everything the director holds is about one song. Carried into the next,
  // the second track never opens on a guess, its sections are handed the
  // casts the first track's had, and its starting character is never read.
  it('starts the director again for a new track, from that track’s starting character', async () => {
    const song = await playThrough('auto')
    const played = song.renderer
    expect(played.settled).toBe(1)
    const { element, draw } = sizedCanvas(1280, 720)
    await played.attach(element, canvas(), vi.fn())
    played.setStartCharacter({ hardness: 0.95 })
    // Ignored while the first track plays, as it always was.
    draw(1_000_000)
    expect(played.character.hardness).toBeLessThan(0.9)
    played.newTrack()
    draw(1_000_017)
    expect(played.settled).toBe(0)
    expect(played.character.hardness).toBeGreaterThan(0.9)
    // The canvas is left alone: one track into the next is a change of cast.
    expect(stack.reset).toBe(0)
    played.dispose()
  })

  it('reports the character once it has settled and rarely after that', async () => {
    vi.resetModules()
    impls.reset()
    const fresh = (await import('./Renderer')).renderer
    const { element, draw } = sizedCanvas(1280, 720)
    audio.attached = true
    const saved = vi.fn()
    fresh.setStartCharacter({ drive: 0.9 })
    fresh.setOnCharacter(saved)
    fresh.setPreset('auto')
    await fresh.attach(element, canvas(), vi.fn())
    let now = 0
    for (const frame of playSong(FPS)) {
      audio.packet = frame.features
      now += 1000 / FPS
      draw(now)
    }

    // Settled inside the first half minute, then once every thirty seconds
    // of the four minutes that follow.
    expect(saved.mock.calls.length).toBeGreaterThan(2)
    expect(saved.mock.calls.length).toBeLessThan(SONG_SECONDS / 10)
    const [character] = saved.mock.calls.at(-1) ?? []
    expect(character?.drive).toBeGreaterThan(0)
    fresh.dispose()
  })

  it('stands a drawable cast in when the WebGL2 path has nothing of the chosen one', async () => {
    vi.resetModules()
    impls.reset()
    const fresh = (await import('./Renderer')).renderer
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    audio.attached = true
    const failure = vi.fn()
    fresh.setPreset('auto')
    await expect(fresh.attach(element, canvas(), failure)).resolves.toBe('ok')
    let now = 0
    for (const frame of playSong(FPS, undefined, 40)) {
      audio.packet = frame.features
      now += 1000 / FPS
      draw(now)
    }

    // Nothing is built without compute, nothing throws, and the fractal the
    // stand-in holds is what draws.
    expect(impls.built).toEqual({ fluid: 0, analytic: 0, dye: 0, fractal: 0, ribbon: 0 })
    expect(graphics.render).toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
    expect(element.dataset.cast).toContain('fractal-glints')
    fresh.dispose()
  })

  // The WebGL2 path has no flow at all and the analytic flow is not built
  // there. This song's build is one the director wants it for, so playing the
  // whole of it is what proves a cast naming it is skipped rather than thrown
  // on; when that path grows a flow, this is the test that will catch it.
  it('does not throw on the frames the song wants the analytic flow', async () => {
    vi.resetModules()
    impls.reset()
    const fresh = (await import('./Renderer')).renderer
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    audio.attached = true
    const failure = vi.fn()
    fresh.setPreset('auto')
    await expect(fresh.attach(element, canvas(), failure)).resolves.toBe('ok')
    let now = 0
    for (const frame of playSong(FPS)) {
      audio.packet = frame.features
      now += 1000 / FPS
      draw(now)
    }

    expect(failure).not.toHaveBeenCalled()
    expect(impls.built.analytic).toBe(0)
    expect(impls.updates.analytic).toBeUndefined()
    expect(graphics.render).toHaveBeenCalled()
    fresh.dispose()
  })
})

describe('the study bench', () => {
  const live = (...ids: string[]): LiveCast => ({
    studies: ids.map((id) => ({ id, presence: 1 })),
    canvas: defaultCanvas(),
    tension: 0,
  })

  // Prism is the pinned cast and holds the fractal; the bench's cast holds a
  // ribbon and a lazy fluid and no fractal at all, so what is built says which
  // of the two the renderer is drawing.
  const start = async () => {
    const { element, draw } = sizedCanvas(1280, 720)
    renderer.setPreset(castOrDefault('prism'))
    await renderer.attach(element, canvas(), vi.fn())
    return { element, draw }
  }

  it('draws its own cast in place of the pinned one, and gives the picture back when cleared', async () => {
    const { draw } = await start()
    renderer.setBench({ live: live('lazy-fluid', 'ribbon', 'clean-glass') })
    draw(1000)
    expect(impls.drawn).toEqual(['ribbon'])
    expect(impls.built.fractal).toBe(1)
    expect(renderer.liveCast.studies.map((entry) => entry.id)).toEqual([
      'lazy-fluid',
      'ribbon',
      'clean-glass',
    ])
    // What data-preset prints is still what the host pinned.
    expect(renderer.presetId).toBe('prism')

    impls.drawn = []
    renderer.setBench(null)
    draw(2000)
    expect(impls.drawn).toEqual(['fractal'])
  })

  // What the director read in the bench was the sliders and not a song. Left
  // standing it would choose for that character, fully settled, under Auto.
  it('starts the director again when the bench is left', async () => {
    const { draw } = await start()
    audio.attached = true
    const sliders = new Float32Array(PACKET_LENGTH)
    renderer.setBench({
      live: live('lazy-fluid', 'ribbon', 'clean-glass'),
      frame: (packet) => {
        packet[F.energy] = 0.8
        packet[F.hardness] = 1
      },
    })
    audio.packet = sliders
    let now = 0
    for (let frame = 0; frame < 60 * 45; frame += 1) {
      now += 1000 / 60
      draw(now)
    }

    expect(renderer.settled).toBe(1)
    expect(renderer.character.hardness).toBeGreaterThan(0.8)
    renderer.setBench(null)
    draw(now + 17)
    expect(renderer.settled).toBe(0)
    expect(renderer.character.hardness).toBeLessThan(0.6)
  })

  it('hands the frame hook the packet and the real dt before anything reads it', async () => {
    const { draw } = await start()
    const seen: { dt: number; time: number }[] = []
    renderer.setBench({
      live: live('lazy-fluid', 'ribbon', 'clean-glass'),
      frame: (packet, dt) => {
        seen.push({ dt, time: packet[F.time] ?? 0 })
        packet[F.tension] = 0.7
      },
    })
    draw(1000)
    draw(1016)
    expect(seen).toHaveLength(2)
    expect(seen[0]?.dt).toBeCloseTo(0.1, 5)
    expect(seen[1]?.dt).toBeCloseTo(0.016, 5)
    // The renderer wrote its clock before the hook ran, so the hook sees it.
    expect(seen[1]?.time).toBeGreaterThan(seen[0]?.time ?? 0)
    // Every reader saw the row: the studies through the packet, the director
    // through its moment weights.
    expect(renderer.features[F.tension]).toBeCloseTo(0.7, 5)
    expect(renderer.moments.build).toBeCloseTo(0.7, 5)
    const width = impls.seen.ribbon?.knobs['ribbon.width'] ?? 0
    renderer.setBench({
      live: renderer.liveCast,
      frame: (packet) => {
        packet[F.tension] = 0
      },
    })
    draw(2000)
    // Tension narrows the ribbon, so the same study with none is wider.
    expect(impls.seen.ribbon?.knobs['ribbon.width']).toBeGreaterThan(width)
  })

  it('stops calling the hook once it is cleared', async () => {
    const { draw } = await start()
    const frame = vi.fn()
    renderer.setBench({ live: live('lazy-fluid', 'ribbon', 'clean-glass'), frame })
    draw(1000)
    renderer.setBench(null)
    draw(2000)
    expect(frame).toHaveBeenCalledTimes(1)
  })

  it('reads a presence moved in place, and does not step a study faded to nothing', async () => {
    const { draw } = await start()
    const cast = live('lazy-fluid', 'ribbon', 'clean-glass')
    renderer.setBench({ live: cast })
    draw(1000)
    expect(impls.seen.ribbon?.presence).toBe(1)
    const stepped = impls.updates.ribbon ?? 0
    const ribbon = cast.studies[1]
    if (!ribbon) throw new Error('the ribbon is in the cast')
    ribbon.presence = 0.4
    draw(2000)
    expect(impls.seen.ribbon?.presence).toBe(0.4)
    ribbon.presence = 0
    draw(3000)
    draw(4000)
    expect(impls.updates.ribbon).toBe(stepped + 1)
  })

  it('empties the canvas for a different cast and leaves it for the same one handed again', async () => {
    const { draw } = await start()
    const cast = live('lazy-fluid', 'ribbon', 'clean-glass')
    renderer.setBench({ live: cast })
    draw(1000)
    const reset = stack.reset
    renderer.setBench({ live: cast, frame: () => {} })
    draw(2000)
    expect(stack.reset).toBe(reset)
    renderer.setBench({ live: live('lazy-fluid', 'dye-plumes', 'clean-glass') })
    expect(stack.reset).toBeGreaterThan(reset)
  })

  it('feeds the ribbon the bench’s samples, and the analyser’s when it has none', async () => {
    const { draw } = await start()
    const samples = new Float32Array(8).fill(0.5)
    renderer.setBench({ live: live('ribbon', 'clean-glass'), waveform: () => samples })
    draw(1000)
    expect(impls.waveform?.()).toBe(samples)
    renderer.setBench({ live: renderer.liveCast, waveform: () => null })
    // The mocked client has no waveform, which is what the ribbon then reads.
    expect(impls.waveform?.()).toBeNull()
  })

  it('stands the fractal in on the WebGL2 path, which draws nothing else, rather than failing', async () => {
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    const failure = vi.fn()
    renderer.setPreset(castOrDefault('prism'))
    renderer.setBench({ live: live('lazy-fluid', 'ribbon', 'clean-glass') })
    await expect(renderer.attach(element, canvas(), failure)).resolves.toBe('ok')
    draw(1000)
    expect(impls.built).toEqual({ fluid: 0, dye: 0, fractal: 0, ribbon: 0 })
    expect(graphics.render).toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('does not change what a renderer with no bench draws', async () => {
    const { draw } = await start()
    draw(1000)
    expect(impls.drawn).toEqual(['fractal'])
  })
})
