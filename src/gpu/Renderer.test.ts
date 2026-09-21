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
 * resolved to before it was deleted (Plume's frames are the folded cast's,
 * see `studies/cast.test.ts`), and these tests drive real frames and
 * compare what each implementation and the post stack are handed against it.
 * The cast tests prove the studies layer lands on those numbers; this proves
 * the renderer hands each of them to the right implementation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { rowsForAxis } from '../director/character'
import { LOFI, METAL, playSong, SONG_SECONDS } from '../director/song.fixture'
import type { PaletteChoice } from '../palettes/palette'
import {
  defaultPostParams,
  mergePostParams,
  POST_KNOBS,
  POST_LANES,
  POST_STAGES,
} from '../post/params'
import type { PostParams } from '../post/params'
import { AUDIO_FIELDS } from '../presets/knobs'
import { defaultCanvas, parseCast } from '../studies/cast'
import { castOrDefault } from '../studies/casts/index'
import frames from '../studies/casts/preset-frames.json'
import {
  CAUSTICS_KNOBS,
  DUST_KNOBS,
  HALO_KNOBS,
  RINGS_KNOBS,
  SPARKS_KNOBS,
  SPECTRUM_KNOBS,
} from '../studies/impls'
import type { ImplId } from '../studies/impls'
import { STUDIES } from '../studies/registry'
import type { LiveCast } from '../studies/resolve'
import type { Character } from '../studies/types'
import type { Gpu } from './Device'

type PresetFrame = {
  preset: string
  packet: string
  level: number
  swell: number
  scene: Readonly<Record<string, number>>
  flow: Readonly<Record<string, number>> | null
  // The capture was taken before the grade stage existed, so it has none.
  post: Omit<PostParams, 'grade'>
}

const FRAMES = frames as unknown as readonly PresetFrame[]

const device = vi.hoisted(() => ({
  acquireGpu: vi.fn<() => Promise<Gpu | null>>(),
  unsubscribe: vi.fn(),
}))

const graphics = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn() }))

// The packet the mocked feature client writes, so a frame can be driven at
// any level without an AudioContext.
const audio = vi.hoisted(() => ({
  attached: false,
  packet: null as Float32Array | null,
  newTracks: 0,
  seeks: 0,
}))

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
    newTrack() {
      audio.newTracks += 1
    }
    seeked() {
      audio.seeks += 1
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

vi.mock('../impls/StreaksInk', () => ({
  StreaksInk: class {
    readonly detail = ''
    constructor() {
      impls.built.streaks = (impls.built.streaks ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('streaks', knobs, presence)
    }
    render() {
      impls.drawn.push('streaks')
    }
    dispose() {
      impls.disposed.streaks = (impls.disposed.streaks ?? 0) + 1
    }
  },
}))

vi.mock('../impls/ShardsInk', () => ({
  ShardsInk: class {
    readonly detail = ''
    constructor() {
      impls.built.shards = (impls.built.shards ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('shards', knobs, presence)
    }
    render() {
      impls.drawn.push('shards')
    }
    dispose() {
      impls.disposed.shards = (impls.disposed.shards ?? 0) + 1
    }
  },
}))

vi.mock('../impls/CausticsInk', () => ({
  CausticsInk: class {
    readonly detail = ''
    constructor() {
      impls.built.caustics = (impls.built.caustics ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('caustics', knobs, presence)
    }
    render() {
      impls.drawn.push('caustics')
    }
    dispose() {
      impls.disposed.caustics = (impls.disposed.caustics ?? 0) + 1
    }
  },
}))

vi.mock('../impls/RingsInk', () => ({
  RingsInk: class {
    readonly detail = ''
    constructor() {
      impls.built.rings = (impls.built.rings ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('rings', knobs, presence)
    }
    render() {
      impls.drawn.push('rings')
    }
    dispose() {
      impls.disposed.rings = (impls.disposed.rings ?? 0) + 1
    }
  },
}))

vi.mock('../impls/SpectrumInk', () => ({
  SpectrumInk: class {
    readonly detail = ''
    constructor() {
      impls.built.spectrum = (impls.built.spectrum ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('spectrum', knobs, presence)
    }
    render() {
      impls.drawn.push('spectrum')
    }
    dispose() {
      impls.disposed.spectrum = (impls.disposed.spectrum ?? 0) + 1
    }
  },
}))

// The dust and the sparks are two profiles over one implementation, so one
// stand-in covers both and keys itself off the profile it was handed.
vi.mock('../impls/ParticleField', () => ({
  ParticleField: class {
    readonly detail = ''
    private readonly name: string
    constructor(profile: { label: string }) {
      this.name = profile.label
      impls.built[this.name] = (impls.built[this.name] ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record(this.name, knobs, presence)
    }
    render() {
      impls.drawn.push(this.name)
    }
    dispose() {
      impls.disposed[this.name] = (impls.disposed[this.name] ?? 0) + 1
    }
  },
}))

vi.mock('../impls/HaloInk', () => ({
  HaloInk: class {
    readonly detail = ''
    constructor() {
      impls.built.halo = (impls.built.halo ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('halo', knobs, presence)
    }
    render() {
      impls.drawn.push('halo')
    }
    dispose() {
      impls.disposed.halo = (impls.disposed.halo ?? 0) + 1
    }
  },
}))

vi.mock('../impls/LasersInk', () => ({
  LasersInk: class {
    readonly detail = ''
    constructor() {
      impls.built.lasers = (impls.built.lasers ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('lasers', knobs, presence)
    }
    render() {
      impls.drawn.push('lasers')
    }
    dispose() {
      impls.disposed.lasers = (impls.disposed.lasers ?? 0) + 1
    }
  },
}))

vi.mock('../impls/MorphInk', () => ({
  MorphInk: class {
    readonly detail = ''
    constructor() {
      impls.built.morph = (impls.built.morph ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('morph', knobs, presence)
    }
    render() {
      impls.drawn.push('morph')
    }
    dispose() {
      impls.disposed.morph = (impls.disposed.morph ?? 0) + 1
    }
  },
}))

vi.mock('../impls/PetalsInk', () => ({
  PetalsInk: class {
    readonly detail = ''
    constructor() {
      impls.built.petals = (impls.built.petals ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('petals', knobs, presence)
    }
    render() {
      impls.drawn.push('petals')
    }
    dispose() {
      impls.disposed.petals = (impls.disposed.petals ?? 0) + 1
    }
  },
}))

vi.mock('../impls/LightningInk', () => ({
  LightningInk: class {
    readonly detail = ''
    constructor() {
      impls.built.lightning = (impls.built.lightning ?? 0) + 1
    }
    init() {}
    resize() {}
    update(_features: Float32Array, _dt: number, knobs: Record<string, number>, presence: number) {
      record('lightning', knobs, presence)
    }
    render() {
      impls.drawn.push('lightning')
    }
    dispose() {
      impls.disposed.lightning = (impls.disposed.lightning ?? 0) + 1
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
  audio.newTracks = 0
  audio.seeks = 0
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

// The riser streaks are cast with the fractal, which is the ink the WebGL2
// path can draw, so one cast serves both halves of this.
const RISING = parseCast(
  {
    id: 'rising',
    name: 'Rising',
    inks: ['fractal-glints', 'riser-streaks'],
    look: 'clean-glass',
    canvas: { enabled: false },
    overrides: {},
  },
  'Renderer.test.ts',
)

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
    // Melt is another flow on the same solver, and puts a fractal and the
    // ribbon where the dye was.
    renderer.setPreset(castOrDefault('melt'))
    expect(impls.built.fluid).toBe(1)
    expect(impls.disposed.fluid).toBe(0)
    expect(impls.built.ribbon).toBe(1)
    // An id that was folded into Plume is Plume: nothing is rebuilt for it.
    renderer.setPreset(castOrDefault('wash'))
    expect(impls.built.fluid).toBe(1)
    expect(impls.disposed.fluid).toBe(0)
    expect(renderer.presetId).toBe('plume')
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

  // The streaks are compute-free but the WebGL2 path has one program and only
  // ever ran the fractal, so they are skipped like the fluid and the ribbon.
  it('skips the riser streaks without throwing, whatever the tension', async () => {
    const packet = packetAt(0.3, 0.5)
    packet[F.tension] = 1
    audio.attached = true
    audio.packet = packet
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    const failure = vi.fn()
    renderer.setPreset(RISING)
    await expect(renderer.attach(element, canvas(), failure)).resolves.toBe('ok')
    expect(() => draw(16)).not.toThrow()
    expect(impls.built.streaks ?? 0).toBe(0)
    expect(impls.drawn).toEqual([])
    expect(graphics.render).toHaveBeenCalledTimes(1)
    expect(failure).not.toHaveBeenCalled()
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

describe('the riser streaks', () => {
  /** Attach the cast above, feed a packet with this tension, draw one frame. */
  const drawWound = async (tension: number) => {
    const packet = packetAt(0, 0)
    packet[F.tension] = tension
    audio.attached = true
    audio.packet = packet
    const { element, draw } = sizedCanvas(1280, 720)
    renderer.setPreset(RISING)
    await renderer.attach(element, canvas(), vi.fn())
    draw(1000)
    return element
  }

  it('are built, drawn in cast order and printed with the cast', async () => {
    const element = await drawWound(0)
    expect(impls.built.streaks).toBe(1)
    expect(impls.drawn).toEqual(['fractal', 'streaks'])
    expect(element.dataset.cast).toBe('fractal-glints riser-streaks clean-glass')
    // The fractal is the scene, as it is for Prism, and the streaks add nothing to the line.
    expect(element.dataset.scene).toBe('kaleidoscope')
    expect(element.dataset.detail).toBe('fractal detail')
  })

  it('are handed nothing to draw until tension winds them up', async () => {
    await drawWound(0)
    expect(impls.seen.streaks?.knobs.count).toBe(0)
    expect(impls.seen.streaks?.knobs.intensity).toBe(0)
    expect(impls.seen.streaks?.presence).toBe(1)
  })

  it('are handed the packet’s tension, and more of them, longer, as it climbs', async () => {
    await drawWound(1)
    const wound = impls.seen.streaks?.knobs
    expect(wound?.count).toBeCloseTo(48, 9)
    expect(wound?.intensity).toBeCloseTo(0.7, 9)
    expect(wound?.length ?? 0).toBeGreaterThan(0.3)
    expect(wound?.speed ?? 0).toBeGreaterThan(1)
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
      // A stage that arrived after the capture is at the stack's default,
      // off and neutral, which is what the preset path did without it.
      // Merged a stage at a time, so a knob added to a stage the capture does
      // record reads the stack's own default for it; see `expectedPost` in
      // studies/cast.test.ts, which says why.
      const expected: PostParams = mergePostParams(defaultPostParams(), golden.post)
      expect(post.enabled).toBe(expected.enabled)
      for (const stage of POST_STAGES)
        expect(post[stage].enabled, `${golden.preset} ${stage}`).toBe(expected[stage].enabled)
      // The two knobs the wide bloom added are the looks' to move and are
      // pinned in studies/cast.test.ts; the captures never had them.
      for (const knob of POST_KNOBS)
        if (knob !== 'bloom.radius' && knob !== 'bloom.tint')
          expect(POST_LANES[knob].read(post), `${golden.preset} ${knob}`).toBeCloseTo(
            POST_LANES[knob].read(expected),
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
    await drawWith('melt', 0.3, 0.5)
    expect(impls.drawn).toEqual(['fractal', 'ribbon'])
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

  // Wash and Drift were folded into Plume, and a host that pins either by id
  // is handed Plume. What it reads back off the canvas is the cast's own id, so
  // a test written against `data-preset` sees `plume` and never the old name.
  it('prints plume for an id that was folded into it', async () => {
    for (const id of ['wash', 'drift']) {
      const element = await drawWith(id, 0.3, 0.5)
      expect(element.dataset.preset, id).toBe('plume')
      expect(element.dataset.cast, id).toBe('lazy-fluid dye-plumes warm-soft')
    }
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
  async function playThrough(
    preset: 'auto' | ReturnType<typeof castOrDefault>,
    character?: Character,
    each?: (palette: PaletteChoice, live: number) => void,
  ) {
    vi.resetModules()
    impls.reset()
    stack.reset = 0
    const fresh = (await import('./Renderer')).renderer
    // The palette is module state, so the copy the renderer just built is the
    // one to read, and it is only in the registry now the renderer is imported.
    const { heldPalette } = await import('../palettes/active')
    const { element, draw } = sizedCanvas(1280, 720)
    audio.attached = true
    fresh.setPreset(preset)
    await fresh.attach(element, canvas(), vi.fn())
    const trace: string[] = []
    let now = 0
    let frames = 0
    for (const frame of playSong(FPS, character)) {
      audio.packet = frame.features
      now += 1000 / FPS
      draw(now)
      each?.(heldPalette(), fresh.liveCast.studies.length)
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
  // The solver is no longer live for the whole song. The tunnel is a flow of
  // another implementation entirely and wins this song's build outright, for
  // long enough that the fluid's grace runs out and it is released, so what
  // is held to here is the invariant rather than the count: one solver per
  // stretch in which a fluid study is live, stepped once on each of those
  // frames whichever of the two studies is fading into the other.
  it('never empties the canvas and never builds a second solver', async () => {
    // The lo-fi song, because it is the one that still fades one fluid study
    // into the other (turbulent into lazy at the breakdown): two studies of
    // one solver live at once, which is the case a second solver would be
    // built for. The hardstyle song did until the beat pump took its groove
    // and its drop, and it never has a fluid now.
    const song = await playThrough('auto', LOFI)
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

  // A host hands over a ref once and keeps writing to it, as it would to an
  // audio element's own `currentTime`: no call is made per frame, and a
  // renderer with none reads a track that ends loud as no outro at all.
  it('reads the playhead a host gave from the ref on every frame', async () => {
    vi.resetModules()
    impls.reset()
    const fresh = (await import('./Renderer')).renderer
    const { element, draw } = sizedCanvas(1280, 720)
    audio.attached = true
    const source = { current: { currentTime: 0, duration: METAL.seconds } }
    fresh.setPlayhead(source)
    fresh.setPreset('auto')
    await fresh.attach(element, canvas(), vi.fn())
    let now = 0
    for (const frame of playSong(FPS, undefined, undefined, METAL)) {
      audio.packet = frame.features
      source.current.currentTime = frame.time
      now += 1000 / FPS
      draw(now)
    }

    expect(fresh.moments.outro).toBeGreaterThan(0.9)
    fresh.setPlayhead(null)
    draw((now += 1000 / FPS))
    expect(fresh.moments.outro).toBe(0)
    fresh.dispose()
  })

  // The extractor keeps the track it has been hearing: its sections, and the
  // scales a boundary is measured against. A seek reads to it as the widest
  // change the track ever made, and the song before reads as this one's past.
  it('tells the extractor of a seek and of a new track, and of nothing else', async () => {
    vi.resetModules()
    impls.reset()
    const fresh = (await import('./Renderer')).renderer
    const { element, draw } = sizedCanvas(1280, 720)
    audio.attached = true
    const source = { current: { currentTime: 0, duration: 240 } }
    fresh.setPlayhead(source)
    fresh.setPreset('auto')
    await fresh.attach(element, canvas(), vi.fn())
    audio.packet = new Float32Array(PACKET_LENGTH)
    let now = 0
    const play = (seconds: number) => {
      for (let frame = 0; frame < seconds * FPS; frame += 1) {
        source.current.currentTime += 1 / FPS
        draw((now += 1000 / FPS))
      }
    }
    play(3)
    expect(audio.seeks).toBe(0)
    // Paused: the frames go on and the playhead does not.
    for (let frame = 0; frame < FPS; frame += 1) draw((now += 1000 / FPS))
    expect(audio.seeks).toBe(0)
    source.current.currentTime = 120
    play(1)
    expect(audio.seeks).toBe(1)
    source.current.currentTime = 10
    play(1)
    expect(audio.seeks).toBe(2)

    expect(audio.newTracks).toBe(0)
    fresh.newTrack()
    expect(audio.newTracks).toBe(1)
    // The next track starts at its own beginning, which is not a seek.
    source.current.currentTime = 0
    play(1)
    expect(audio.seeks).toBe(2)
    fresh.dispose()
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

  // The colour follows the look, and a pinned cast is exempt: it is a fixed
  // picture, drawn before looks named a palette.
  it('colours a chosen cast by its looks, and holds a pinned one to classic', async () => {
    const chosen = new Set<string>()
    const auto = await playThrough('auto', undefined, (palette, live) => {
      // The first frame, before the director has chosen anything, is classic.
      if (live === 0) return
      chosen.add(palette.from)
      chosen.add(palette.to)
    })
    auto.renderer.dispose()
    // The song changes look as it goes, so the colour changes with it.
    expect(chosen.size).toBeGreaterThan(1)
    expect(chosen.has('classic')).toBe(false)

    const fixed = new Set<string>()
    const pinned = await playThrough(castOrDefault('plume'), undefined, (palette) => {
      fixed.add(`${palette.from} ${palette.to} ${palette.mix}`)
    })
    pinned.renderer.dispose()
    expect([...fixed]).toEqual(['classic classic 0'])
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

  // Curl drift is meant to be that path's flow one day, so what is held to
  // here is that today it is skipped without a sound: a cast built on it is
  // drawn as far as the fallback can and nothing throws or is reported.
  it('does not throw on a cast built on curl drift', async () => {
    vi.resetModules()
    impls.reset()
    const fresh = (await import('./Renderer')).renderer
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    audio.attached = true
    const failure = vi.fn()
    fresh.setPreset('auto')
    await expect(fresh.attach(element, canvas(), failure)).resolves.toBe('ok')
    fresh.setBench({
      live: {
        studies: ['curl-drift', 'ribbon', 'clean-glass'].map((id) => ({ id, presence: 1 })),
        canvas: defaultCanvas(),
        tension: 0.5,
      },
    })
    let now = 0
    for (let frame = 0; frame < 120; frame += 1) {
      now += 1000 / FPS
      expect(() => draw(now)).not.toThrow()
    }

    expect(failure).not.toHaveBeenCalled()
    expect(impls.built.analytic).toBe(0)
    expect(impls.updates.analytic).toBeUndefined()
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
        // The hardness slider's rows, as the bench writes them.
        for (const { row, value } of rowsForAxis('hardness', 1)) packet[row] = value
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
    // Nothing is built there, whichever implementations there are: counted
    // rather than listed, so a new one does not break this by existing.
    expect(Object.values(impls.built).reduce((sum, count) => sum + count, 0)).toBe(0)
    expect(graphics.render).toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('builds the shards ink for its study, hands it its numbers and draws it in cast order', async () => {
    const { draw } = await start()
    renderer.setBench({
      live: live('ribbon', 'shards', 'clean-glass'),
      frame: (packet) => {
        packet[F.tension] = 0
      },
    })
    draw(1000)
    expect(impls.built.shards).toBe(1)
    expect(impls.drawn).toEqual(['ribbon', 'shards'])
    expect(impls.seen.shards?.presence).toBe(1)
    const calm = impls.seen.shards?.knobs.intensity ?? 0
    expect(Object.keys(impls.seen.shards?.knobs ?? {}).sort()).toEqual(
      ['burst', 'hitRate', 'intensity', 'life', 'size', 'speed', 'spin'].sort(),
    )

    // The study's own tension row reaches the ink through the resolver.
    renderer.setBench({
      live: renderer.liveCast,
      frame: (packet) => {
        packet[F.tension] = 1
      },
    })
    draw(2000)
    expect(impls.seen.shards?.knobs.intensity).toBeLessThan(calm)
  })

  it('does not build the shards ink for a study that is faded to nothing', async () => {
    const { draw } = await start()
    const cast = live('ribbon', 'shards', 'clean-glass')
    const shards = cast.studies[1]
    if (!shards) throw new Error('the shards are in the cast')
    shards.presence = 0
    renderer.setBench({ live: cast })
    draw(1000)
    expect(impls.built.shards).toBeUndefined()
    expect(impls.updates.shards).toBeUndefined()
    shards.presence = 0.5
    draw(2000)
    expect(impls.built.shards).toBe(1)
    expect(impls.seen.shards?.presence).toBe(0.5)
  })

  it('skips the shards on the WebGL2 path, which has no compute and draws the fractal alone', async () => {
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    const failure = vi.fn()
    renderer.setPreset(castOrDefault('prism'))
    renderer.setBench({ live: live('ribbon', 'shards', 'clean-glass') })
    await expect(renderer.attach(element, canvas(), failure)).resolves.toBe('ok')
    expect(() => draw(1000)).not.toThrow()
    expect(impls.built.shards).toBeUndefined()
    expect(graphics.render).toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('builds the dust ink for its study, hands it its numbers and draws it in cast order', async () => {
    const { draw } = await start()
    renderer.setBench({
      live: live('ribbon', 'dust', 'clean-glass'),
      frame: (packet) => {
        packet[F.energy] = 0.3
        packet[F.tension] = 0
      },
    })
    draw(1000)
    expect(impls.built.dust).toBe(1)
    expect(impls.drawn).toEqual(['ribbon', 'dust'])
    expect(impls.seen.dust?.presence).toBe(1)
    expect(Object.keys(impls.seen.dust?.knobs ?? {}).sort()).toEqual([...DUST_KNOBS].sort())
    // A quiet passage is not silence: there is dust to draw, and none gathered.
    expect(impls.seen.dust?.knobs.count ?? 0).toBeGreaterThan(30)
    expect(impls.seen.dust?.knobs.gather).toBe(0)

    // The study's tension row reaches the ink through the resolver.
    renderer.setBench({
      live: renderer.liveCast,
      frame: (packet) => {
        packet[F.energy] = 0.3
        packet[F.tension] = 1
      },
    })
    draw(2000)
    expect(impls.seen.dust?.knobs.gather).toBeCloseTo(0.5, 9)
  })

  it('is handed a count of nothing at a silent packet, which is how it draws nothing', async () => {
    const { draw } = await start()
    renderer.setBench({ live: live('ribbon', 'dust', 'clean-glass') })
    draw(1000)
    expect(impls.seen.dust?.knobs.count).toBe(0)
  })

  it('does not build the dust ink for a study that is faded to nothing', async () => {
    const { draw } = await start()
    const cast = live('ribbon', 'dust', 'clean-glass')
    const dust = cast.studies[1]
    if (!dust) throw new Error('the dust is in the cast')
    dust.presence = 0
    renderer.setBench({ live: cast })
    draw(1000)
    expect(impls.built.dust).toBeUndefined()
    expect(impls.updates.dust).toBeUndefined()
    dust.presence = 0.5
    draw(2000)
    expect(impls.built.dust).toBe(1)
    expect(impls.seen.dust?.presence).toBe(0.5)
  })

  it('skips the dust on the WebGL2 path, which has no compute and draws the fractal alone', async () => {
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    const failure = vi.fn()
    renderer.setPreset(castOrDefault('prism'))
    renderer.setBench({ live: live('ribbon', 'dust', 'clean-glass') })
    await expect(renderer.attach(element, canvas(), failure)).resolves.toBe('ok')
    expect(() => draw(1000)).not.toThrow()
    expect(impls.built.dust).toBeUndefined()
    expect(graphics.render).toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('builds the caustics ink for its study, hands it its numbers and draws it in cast order', async () => {
    const { draw } = await start()
    renderer.setBench({
      live: live('ribbon', 'caustics', 'clean-glass'),
      frame: (packet) => {
        packet[F.energy] = 0.3
        packet[F.keyClarity] = 0.8
        packet[F.tension] = 0
      },
    })
    draw(1000)
    expect(impls.built.caustics).toBe(1)
    expect(impls.drawn).toEqual(['ribbon', 'caustics'])
    expect(impls.seen.caustics?.presence).toBe(1)
    expect(Object.keys(impls.seen.caustics?.knobs ?? {}).sort()).toEqual([...CAUSTICS_KNOBS].sort())
    // A tonal quiet passage has light to draw.
    expect(impls.seen.caustics?.knobs.intensity ?? 0).toBeGreaterThan(0.1)
    const calm = impls.seen.caustics?.knobs.sharpness ?? 0

    // The study's tension row reaches the ink through the resolver.
    renderer.setBench({
      live: renderer.liveCast,
      frame: (packet) => {
        packet[F.energy] = 0.3
        packet[F.keyClarity] = 0.8
        packet[F.tension] = 1
      },
    })
    draw(2000)
    expect(impls.seen.caustics?.knobs.sharpness ?? 0).toBeGreaterThan(calm + 2)
  })

  it('is handed no light at a silent packet, which is how it draws nothing', async () => {
    const { draw } = await start()
    renderer.setBench({ live: live('ribbon', 'caustics', 'clean-glass') })
    draw(1000)
    expect(impls.seen.caustics?.knobs.intensity).toBe(0)
  })

  it('does not build the caustics ink for a study that is faded to nothing', async () => {
    const { draw } = await start()
    const cast = live('ribbon', 'caustics', 'clean-glass')
    const caustics = cast.studies[1]
    if (!caustics) throw new Error('the caustics are in the cast')
    caustics.presence = 0
    renderer.setBench({ live: cast })
    draw(1000)
    expect(impls.built.caustics).toBeUndefined()
    expect(impls.updates.caustics).toBeUndefined()
    caustics.presence = 0.5
    draw(2000)
    expect(impls.built.caustics).toBe(1)
    expect(impls.seen.caustics?.presence).toBe(0.5)
  })

  it('skips the caustics on the WebGL2 path, which has no compute and draws the fractal alone', async () => {
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    const failure = vi.fn()
    renderer.setPreset(castOrDefault('prism'))
    renderer.setBench({ live: live('ribbon', 'caustics', 'clean-glass') })
    await expect(renderer.attach(element, canvas(), failure)).resolves.toBe('ok')
    expect(() => draw(1000)).not.toThrow()
    expect(impls.built.caustics).toBeUndefined()
    expect(graphics.render).toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('builds the halo ink for its study, hands it its numbers and draws it in cast order', async () => {
    const { draw } = await start()
    renderer.setBench({
      live: live('ribbon', 'halo', 'clean-glass'),
      frame: (packet) => {
        packet[F.energy] = 0.3
        packet[F.tension] = 0
      },
    })
    draw(1000)
    expect(impls.built.halo).toBe(1)
    expect(impls.drawn).toEqual(['ribbon', 'halo'])
    expect(impls.seen.halo?.presence).toBe(1)
    expect(Object.keys(impls.seen.halo?.knobs ?? {}).sort()).toEqual([...HALO_KNOBS].sort())
    // A passage with some sound in it has a glow to draw.
    const calm = impls.seen.halo?.knobs.radius ?? 0
    expect(calm).toBeGreaterThan(0.1)

    // The study's tension row reaches the ink through the resolver: a build
    // tightens the glow.
    renderer.setBench({
      live: renderer.liveCast,
      frame: (packet) => {
        packet[F.energy] = 0.3
        packet[F.tension] = 1
      },
    })
    draw(2000)
    expect(impls.seen.halo?.knobs.radius ?? 0).toBeLessThan(calm - 0.05)
  })

  it('is handed no radius at a silent packet, which is how it draws nothing', async () => {
    const { draw } = await start()
    renderer.setBench({ live: live('ribbon', 'halo', 'clean-glass') })
    draw(1000)
    expect(impls.seen.halo?.knobs.radius).toBe(0)
  })

  it('does not build the halo ink for a study that is faded to nothing', async () => {
    const { draw } = await start()
    const cast = live('ribbon', 'halo', 'clean-glass')
    const halo = cast.studies[1]
    if (!halo) throw new Error('the halo is in the cast')
    halo.presence = 0
    renderer.setBench({ live: cast })
    draw(1000)
    expect(impls.built.halo).toBeUndefined()
    expect(impls.updates.halo).toBeUndefined()
    halo.presence = 0.5
    draw(2000)
    expect(impls.built.halo).toBe(1)
    expect(impls.seen.halo?.presence).toBe(0.5)
  })

  it('skips the halo on the WebGL2 path, which has no compute and draws the fractal alone', async () => {
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    const failure = vi.fn()
    renderer.setPreset(castOrDefault('prism'))
    renderer.setBench({ live: live('ribbon', 'halo', 'clean-glass') })
    await expect(renderer.attach(element, canvas(), failure)).resolves.toBe('ok')
    expect(() => draw(1000)).not.toThrow()
    expect(impls.built.halo).toBeUndefined()
    expect(graphics.render).toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('builds the rings ink for its study, hands it its numbers and draws it in cast order', async () => {
    const { draw } = await start()
    renderer.setBench({
      live: live('ribbon', 'beat-rings', 'clean-glass'),
      frame: (packet) => {
        packet[F.energy] = 0.3
        packet[F.tempoConfidence] = 0.9
        packet[F.tension] = 0
      },
    })
    draw(1000)
    expect(impls.built.rings).toBe(1)
    expect(impls.drawn).toEqual(['ribbon', 'rings'])
    expect(impls.seen.rings?.presence).toBe(1)
    expect(Object.keys(impls.seen.rings?.knobs ?? {}).sort()).toEqual([...RINGS_KNOBS].sort())
    // A steady beat has light to draw, and one ring a beat at rest.
    expect(impls.seen.rings?.knobs.intensity ?? 0).toBeGreaterThan(0.2)
    expect(impls.seen.rings?.knobs.rate).toBe(1)

    // The study's tension row reaches the ink through the resolver: a build
    // rolls, which is more rings a beat.
    renderer.setBench({
      live: renderer.liveCast,
      frame: (packet) => {
        packet[F.energy] = 0.3
        packet[F.tempoConfidence] = 0.9
        packet[F.tension] = 1
      },
    })
    draw(2000)
    expect(impls.seen.rings?.knobs.rate ?? 0).toBe(4)
  })

  it('is handed no light at a packet with no steady beat, which is how it draws nothing', async () => {
    const { draw } = await start()
    renderer.setBench({ live: live('ribbon', 'beat-rings', 'clean-glass') })
    draw(1000)
    expect(impls.seen.rings?.knobs.intensity).toBe(0)
  })

  it('does not build the rings ink for a study that is faded to nothing', async () => {
    const { draw } = await start()
    const cast = live('ribbon', 'beat-rings', 'clean-glass')
    const rings = cast.studies[1]
    if (!rings) throw new Error('the rings are in the cast')
    rings.presence = 0
    renderer.setBench({ live: cast })
    draw(1000)
    expect(impls.built.rings).toBeUndefined()
    expect(impls.updates.rings).toBeUndefined()
    rings.presence = 0.5
    draw(2000)
    expect(impls.built.rings).toBe(1)
    expect(impls.seen.rings?.presence).toBe(0.5)
  })

  it('skips the rings on the WebGL2 path, which has no compute and draws the fractal alone', async () => {
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    const failure = vi.fn()
    renderer.setPreset(castOrDefault('prism'))
    renderer.setBench({ live: live('ribbon', 'beat-rings', 'clean-glass') })
    await expect(renderer.attach(element, canvas(), failure)).resolves.toBe('ok')
    expect(() => draw(1000)).not.toThrow()
    expect(impls.built.rings).toBeUndefined()
    expect(graphics.render).toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('builds the spectrum ink for its study, hands it its numbers and draws it in cast order', async () => {
    const { draw } = await start()
    renderer.setBench({
      live: live('ribbon', 'spectrum-ring', 'clean-glass'),
      frame: (packet) => {
        packet[F.energy] = 0.5
        packet[F.tension] = 0
      },
    })
    draw(1000)
    expect(impls.built.spectrum).toBe(1)
    expect(impls.drawn).toEqual(['ribbon', 'spectrum'])
    expect(impls.seen.spectrum?.presence).toBe(1)
    expect(Object.keys(impls.seen.spectrum?.knobs ?? {}).sort()).toEqual([...SPECTRUM_KNOBS].sort())
    expect(impls.seen.spectrum?.knobs.bars).toBeGreaterThan(0)
    expect(impls.seen.spectrum?.knobs.intensity ?? 0).toBeGreaterThan(0.02)
    const wide = impls.seen.spectrum?.knobs.radius ?? 0

    // The study's tension row reaches the ink through the resolver: a build
    // contracts the ring.
    renderer.setBench({
      live: renderer.liveCast,
      frame: (packet) => {
        packet[F.energy] = 0.5
        packet[F.tension] = 1
      },
    })
    draw(2000)
    expect(impls.seen.spectrum?.knobs.radius ?? 1).toBeLessThan(wide - 0.05)
  })

  it('does not build the spectrum ink for a study that is faded to nothing', async () => {
    const { draw } = await start()
    const cast = live('ribbon', 'spectrum-ring', 'clean-glass')
    const ring = cast.studies[1]
    if (!ring) throw new Error('the spectrum ring is in the cast')
    ring.presence = 0
    renderer.setBench({ live: cast })
    draw(1000)
    expect(impls.built.spectrum).toBeUndefined()
    expect(impls.updates.spectrum).toBeUndefined()
    ring.presence = 0.5
    draw(2000)
    expect(impls.built.spectrum).toBe(1)
    expect(impls.seen.spectrum?.presence).toBe(0.5)
  })

  it('skips the spectrum ring on the WebGL2 path, which has no compute and draws the fractal alone', async () => {
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    const failure = vi.fn()
    renderer.setPreset(castOrDefault('prism'))
    renderer.setBench({ live: live('ribbon', 'spectrum-ring', 'clean-glass') })
    await expect(renderer.attach(element, canvas(), failure)).resolves.toBe('ok')
    expect(() => draw(1000)).not.toThrow()
    expect(impls.built.spectrum).toBeUndefined()
    expect(graphics.render).toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('builds the sparks ink for its study, hands it its numbers and draws it in cast order', async () => {
    const { draw } = await start()
    renderer.setBench({
      live: live('ribbon', 'sparks', 'clean-glass'),
      frame: (packet) => {
        packet[F.energy] = 0.5
        packet[F.tension] = 0
      },
    })
    draw(1000)
    expect(impls.built.sparks).toBe(1)
    expect(impls.drawn).toEqual(['ribbon', 'sparks'])
    expect(impls.seen.sparks?.presence).toBe(1)
    expect(Object.keys(impls.seen.sparks?.knobs ?? {}).sort()).toEqual([...SPARKS_KNOBS].sort())
    // The count is the pool, which is tens of thousands of slots on the GPU,
    // and the light of one particle among them is a small number.
    expect(impls.seen.sparks?.knobs.count ?? 0).toBeGreaterThan(10000)
    expect(impls.seen.sparks?.knobs.intensity ?? 0).toBeGreaterThan(0)
    const calm = impls.seen.sparks?.knobs.burst ?? 0

    // The study's tension row reaches the ink through the resolver: a build
    // makes a hit throw more.
    renderer.setBench({
      live: renderer.liveCast,
      frame: (packet) => {
        packet[F.energy] = 0.5
        packet[F.tension] = 1
      },
    })
    draw(2000)
    expect(impls.seen.sparks?.knobs.burst ?? 0).toBeGreaterThan(calm + 100)
  })

  it('does not build the sparks ink for a study that is faded to nothing', async () => {
    const { draw } = await start()
    const cast = live('ribbon', 'sparks', 'clean-glass')
    const sparks = cast.studies[1]
    if (!sparks) throw new Error('the sparks are in the cast')
    sparks.presence = 0
    renderer.setBench({ live: cast })
    draw(1000)
    expect(impls.built.sparks).toBeUndefined()
    expect(impls.updates.sparks).toBeUndefined()
    sparks.presence = 0.5
    draw(2000)
    expect(impls.built.sparks).toBe(1)
    expect(impls.seen.sparks?.presence).toBe(0.5)
  })

  it('skips the sparks on the WebGL2 path, which has no compute and draws the fractal alone', async () => {
    const { element, draw } = sizedCanvas(640, 480)
    device.acquireGpu.mockResolvedValue(null)
    const failure = vi.fn()
    renderer.setPreset(castOrDefault('prism'))
    renderer.setBench({ live: live('ribbon', 'sparks', 'clean-glass') })
    await expect(renderer.attach(element, canvas(), failure)).resolves.toBe('ok')
    expect(() => draw(1000)).not.toThrow()
    expect(impls.built.sparks).toBeUndefined()
    expect(graphics.render).toHaveBeenCalled()
    expect(failure).not.toHaveBeenCalled()
  })

  it('does not change what a renderer with no bench draws', async () => {
    const { draw } = await start()
    draw(1000)
    expect(impls.drawn).toEqual(['fractal'])
  })
})
