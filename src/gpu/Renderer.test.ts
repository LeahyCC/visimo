import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Gpu } from './Device'

const device = vi.hoisted(() => ({
  acquireGpu: vi.fn<() => Promise<Gpu | null>>(),
  unsubscribe: vi.fn(),
}))

const graphics = vi.hoisted(() => ({ render: vi.fn(), dispose: vi.fn() }))
const scene = vi.hoisted(() => ({ resize: vi.fn() }))

vi.mock('../scenes/Kaleidoscope', () => ({
  Kaleidoscope: class {
    init() {}
    resize = scene.resize
    dispose() {}
  },
}))

vi.mock('../post/PostStack', () => ({
  SCENE_FORMAT: 'rgba16float',
  PostStack: class {
    init() {}
    useParams() {}
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
  configureCanvas: () => ({ unconfigure: vi.fn() }),
}))

let renderer: typeof import('./Renderer').renderer

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
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

describe('renderer attachment lifetime', () => {
  it('sizes a fresh scene when the attached canvas already has its display dimensions', async () => {
    device.acquireGpu.mockResolvedValue({
      device: {} as GPUDevice,
      format: 'bgra8unorm',
      info: { vendor: '', architecture: '', device: '', description: '', software: false },
      lost: false,
    })
    const element = {
      width: 1412,
      height: 1020,
      clientWidth: 1412,
      clientHeight: 1020,
      dataset: {},
      ownerDocument: {
        defaultView: {
          devicePixelRatio: 1,
          performance: { now: () => 0 },
          requestAnimationFrame: () => 1,
          cancelAnimationFrame: vi.fn(),
          ResizeObserver: class {
            observe() {}
            disconnect() {}
          },
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    } as unknown as HTMLCanvasElement
    renderer.setScene('kaleidoscope')
    await expect(renderer.attach(element, canvas(), vi.fn())).resolves.toBe('ok')
    expect(scene.resize).toHaveBeenCalledWith(1412, 1020)
    expect(element.width).toBe(1412)
    expect(element.height).toBe(1020)
  })

  it('cancels the old mount when the same canvas attaches again', async () => {
    const finish = pendingAcquisition()
    const element = canvas()
    const stale = renderer.attach(element, canvas(), vi.fn())
    renderer.detach(element)
    const current = renderer.attach(element, canvas(), vi.fn())
    finish()
    await expect(stale).resolves.toBe('cancelled')
    await expect(current).resolves.toBe('unsupported')
  })

  it('does not cancel another canvas waiting for the device', async () => {
    const finish = pendingAcquisition()
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
    renderer.setScene('kaleidoscope')
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
    renderer.setScene('kaleidoscope')
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
