import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function browserGpu() {
  const device = {
    addEventListener: vi.fn(),
    lost: new Promise<GPUDeviceLostInfo>(() => {}),
  }
  const adapter = {
    info: { vendor: 'test', architecture: '', device: '', description: '' },
    requestDevice: vi.fn().mockResolvedValue(device),
  }
  const requestAdapter = vi.fn().mockResolvedValue(adapter)
  vi.stubGlobal('navigator', {
    gpu: { requestAdapter, getPreferredCanvasFormat: () => 'bgra8unorm' },
  })

  return { adapter, device, requestAdapter }
}

describe('GPU startup recovery', () => {
  it('shares one pending request and reuses a successful device', async () => {
    const { device, requestAdapter } = browserGpu()
    const { acquireGpu } = await import('./Device')
    const first = acquireGpu()
    expect(acquireGpu()).toBe(first)
    expect((await first)?.device).toBe(device)
    expect(await acquireGpu()).toBe(await first)
    expect(requestAdapter).toHaveBeenCalledTimes(1)
  })

  it('recovers from temporary adapter failure using the browser default', async () => {
    const { device, requestAdapter } = browserGpu()
    requestAdapter.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
    const { acquireGpu } = await import('./Device')
    const pending = acquireGpu()
    await vi.runAllTimersAsync()
    expect((await pending)?.device).toBe(device)
    expect(requestAdapter.mock.calls).toEqual([
      [{ powerPreference: 'high-performance' }],
      [{}],
      [{}],
    ])
  })

  it('stops after three failures and allows a later explicit retry', async () => {
    const { adapter, requestAdapter } = browserGpu()
    requestAdapter.mockResolvedValue(null)
    const { acquireGpu } = await import('./Device')
    const pending = acquireGpu()
    await vi.runAllTimersAsync()
    expect(await pending).toBeNull()
    expect(requestAdapter).toHaveBeenCalledTimes(3)
    requestAdapter.mockResolvedValue(adapter)
    expect(await acquireGpu()).not.toBeNull()
  })

  it('retries device-request failures and handles an absent WebGPU API', async () => {
    const { adapter, device } = browserGpu()
    adapter.requestDevice.mockRejectedValueOnce(new Error('GPU process restarting'))
    const { acquireGpu } = await import('./Device')
    const pending = acquireGpu()
    await vi.runAllTimersAsync()
    expect((await pending)?.device).toBe(device)
    vi.resetModules()
    vi.stubGlobal('navigator', {})
    expect(await (await import('./Device')).acquireGpu()).toBeNull()
  })
})
