/**
 * The two halves of the fluid, without a device. Neither builds anything on
 * the GPU until `init`, so what a flow says it is doing and how it takes an
 * ink's numbers can be checked here; the passes themselves need a browser.
 */
import { describe, expect, it } from 'vitest'

import { DyeInk, FluidFlow } from './fluid'

const packet = new Float32Array(8)

describe('a fluid flow', () => {
  it('names its grid until an ink names the same one', () => {
    const flow = new FluidFlow(512)
    // No field is allocated without a device, so the size reads 0; what
    // matters is which of the two lines is printed.
    expect(flow.detail).toBe('0 flow')
    new DyeInk(flow).update(packet, 1 / 60, {}, 1)
    expect(flow.detail).toBe('')
  })

  // The flows update before the inks every frame, so a dye ink that has left
  // the cast simply stops setting its half and the flow goes back to naming
  // its own grid. Nothing has to tell it the ink is gone.
  it('forgets an ink that stopped updating', () => {
    const flow = new FluidFlow(512)
    const ink = new DyeInk(flow)
    ink.update(packet, 1 / 60, {}, 1)
    expect(flow.detail).toBe('')
    flow.update(packet, 1 / 60, {}, 1)
    expect(flow.detail).toBe('0 flow')
  })

  it('gives a dye ink the field its flow is stirring', () => {
    const flow = new FluidFlow(512)
    const ink = new DyeInk(flow)
    expect(ink.source).toBe(flow)
    expect(ink.detail).toBe('0 fluid')
  })
})
