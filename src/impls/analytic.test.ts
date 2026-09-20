/**
 * The analytic flow against a stub device. The pass itself needs a browser,
 * but the two things the bar asks for are decisions this object makes on the
 * CPU and are checked here: that a still field encodes nothing and offers
 * nothing, and that a moving one encodes exactly one pass and hands the post
 * stack the same `cover` the fluid's field carries.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { visibleExtent } from '../scenes/fluid.params'
import { AnalyticFlow } from './analytic'
import { ANALYTIC_SIZE, ANALYTIC_UNIFORM_FLOATS, fieldCover } from './analytic.params'

const packet = new Float32Array(8)

// The usage flags are browser globals and this runs in Node. Only their
// bitwise or is ever taken, so any distinct bits will do.
beforeAll(() => {
  vi.stubGlobal('GPUTextureUsage', { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 })
  vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 })
})

/**
 * Enough of a device for `init` and `simulate`. Nothing is drawn; what is
 * counted is how many passes were begun and how many uniform writes went out,
 * which is what "costs nothing" means for this implementation.
 */
function stub() {
  const passes: string[] = []
  const writes: Float32Array[] = []
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  }
  const device = {
    createShaderModule: () => ({ getCompilationInfo: () => Promise.resolve({ messages: [] }) }),
    createTexture: () => ({ createView: () => ({}), destroy: vi.fn() }),
    createBuffer: () => ({ destroy: vi.fn() }),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBindGroup: () => ({}),
    queue: {
      writeBuffer: (_buffer: unknown, _offset: number, data: Float32Array) => {
        writes.push(new Float32Array(data))
      },
    },
  }
  const encoder = {
    beginRenderPass: (descriptor: { label?: string }) => {
      passes.push(descriptor.label ?? '')
      return pass
    },
  }

  return { device, encoder, passes, writes }
}

const built = () => {
  const gear = stub()
  const flow = new AnalyticFlow()
  flow.init({
    device: gear.device as unknown as GPUDevice,
    format: 'rgba16float',
    software: false,
  })
  flow.resize(2560, 1440)
  return { flow, ...gear }
}

const step = (gear: ReturnType<typeof built>) =>
  gear.flow.simulate(gear.encoder as unknown as GPUCommandEncoder)

describe('an analytic flow', () => {
  it('says nothing and offers no field before it is built', () => {
    const flow = new AnalyticFlow()
    expect(flow.detail).toBe('')
    expect(flow.flow).toBeNull()
  })

  it('encodes nothing and offers nothing when every coefficient is zero', () => {
    const gear = built()
    gear.flow.update(packet, 1 / 60, { radial: 0, swirl: 0, twist: 0, falloff: 2 }, 1)
    step(gear)
    expect(gear.passes).toEqual([])
    expect(gear.writes).toEqual([])
    expect(gear.flow.flow).toBeNull()
  })

  it('encodes nothing at presence 0, whatever its knobs say', () => {
    const gear = built()
    gear.flow.update(packet, 1 / 60, { radial: -0.5, swirl: 0.3 }, 0)
    step(gear)
    expect(gear.passes).toEqual([])
    expect(gear.flow.flow).toBeNull()
  })

  it('writes one pass and offers the field when it has something to carry', () => {
    const gear = built()
    gear.flow.update(packet, 1 / 60, { radial: -0.4 }, 1)
    step(gear)
    expect(gear.passes).toHaveLength(1)
    expect(gear.writes).toHaveLength(1)
    const field = gear.flow.flow
    expect(field?.size).toBe(ANALYTIC_SIZE)
    // The same crop the fluid's field is read through, so the two blend.
    expect(field?.cover).toEqual(fieldCover(visibleExtent(2560, 1440)))
  })

  // The velocity is a rate, so the same knobs at two frame rates hand the
  // shader the same numbers, and the feedback pass is what multiplies by the
  // real step. The one exception is the curl clock, which is the sum of the
  // real steps and so agrees after the same seconds and not before.
  it('writes the same field at 60 frames a second and at 144, after the same seconds', () => {
    const knobs = { radial: -0.4, swirl: 0.2, curl: 0.05, curlRate: 0.1 }
    const at = (fps: number) => {
      const gear = built()
      for (let frame = 0; frame < fps * 3; frame += 1) {
        gear.flow.update(packet, 1 / fps, knobs, 1)
        step(gear)
      }

      return [...(gear.writes.at(-1) ?? [])]
    }

    const slow = at(60)
    const fast = at(144)
    expect(slow).toHaveLength(ANALYTIC_UNIFORM_FLOATS)
    for (const [index, value] of slow.entries())
      expect(fast[index], `float ${index}`).toBeCloseTo(value, 5)
    // Three seconds at a tenth of a turn a second.
    expect(slow[14]).toBeCloseTo(0.3, 5)
  })

  it('encodes nothing for a curl of 0 and one pass for a curl that is not', () => {
    const quiet = built()
    quiet.flow.update(packet, 1 / 60, { curl: 0, curlScale: 4, curlRate: 0.1 }, 1)
    step(quiet)
    expect(quiet.passes).toEqual([])
    expect(quiet.flow.flow).toBeNull()

    const drifting = built()
    drifting.flow.update(packet, 1 / 60, { curl: 0.03, curlScale: 4, curlRate: 0.1 }, 1)
    step(drifting)
    expect(drifting.passes).toHaveLength(1)
    const written = drifting.writes[0]
    expect(written?.[12]).toBeCloseTo(0.03, 6)
    expect(written?.[13]).toBe(4)
    expect(drifting.flow.flow?.size).toBe(ANALYTIC_SIZE)
  })

  // The clock runs while the curl is off, so a build that brings it in finds
  // the pattern where the seconds have left it, and stops when the flow is
  // taken down, so a flow built again starts from the same place every time.
  it('keeps its clock through a stretch with no curl and starts again from 0 once disposed', () => {
    const gear = built()
    for (let frame = 0; frame < 60; frame += 1) {
      gear.flow.update(packet, 1 / 60, { curl: 0, curlRate: 0.2 }, 1)
      step(gear)
    }

    gear.flow.update(packet, 1 / 60, { curl: 0.05, curlRate: 0.2 }, 1)
    step(gear)
    expect(gear.writes[0]?.[14]).toBeCloseTo(0.2 * (61 / 60), 5)

    gear.flow.dispose()
    gear.flow.init({
      device: gear.device as unknown as GPUDevice,
      format: 'rgba16float',
      software: false,
    })
    gear.flow.update(packet, 1 / 60, { curl: 0.05, curlRate: 0.2 }, 1)
    step(gear)
    expect(gear.writes.at(-1)?.[14]).toBeCloseTo(0.2 / 60, 6)
  })

  it('stops offering a field on the frame its knobs go quiet', () => {
    const gear = built()
    gear.flow.update(packet, 1 / 60, { radial: -0.4 }, 1)
    step(gear)
    expect(gear.flow.flow).not.toBeNull()
    gear.flow.update(packet, 1 / 60, { radial: 0 }, 1)
    step(gear)
    expect(gear.flow.flow).toBeNull()
    expect(gear.passes).toHaveLength(1)
  })
})
