import { describe, expect, it } from 'vitest'

import composite from '../shaders/post.composite.wgsl?raw'
import { DITHER_STEP, ditherOffset, interleavedGradient } from './dither'

/** An 8-bit canvas: a value is rounded to the nearest 255th. */
const store = (value: number) => Math.round(Math.min(Math.max(value, 0), 1) * 255)

describe('the composite dither', () => {
  it('is a value in 0 to 1 that averages a half over a block of pixels', () => {
    let total = 0
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const value = interleavedGradient(x, y)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThan(1)
        total += value
      }

    expect(total / (128 * 128)).toBeGreaterThan(0.48)
    expect(total / (128 * 128)).toBeLessThan(0.52)
  })

  it('never moves a value by half a code value or more', () => {
    for (const seconds of [0, 0.016, 3.7, 999.5])
      for (let y = 0; y < 48; y++)
        for (let x = 0; x < 48; x++) {
          const offset = ditherOffset(x, y, seconds)
          expect(offset).toBeGreaterThanOrEqual(-DITHER_STEP / 2)
          expect(offset).toBeLessThan(DITHER_STEP / 2)
        }
  })

  it('leaves black black, at every pixel and every moment', () => {
    // The last line of the composite is max(colour, 0), then the canvas rounds.
    for (const seconds of [0, 0.5, 12.345, 500])
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) expect(store(0 + ditherOffset(x, y, seconds))).toBe(0)
  })

  it('moves the pattern from one frame to the next', () => {
    let moved = 0
    for (let x = 0; x < 64; x++)
      if (ditherOffset(x, 3, 0) !== ditherOffset(x, 3, 1 / 60)) moved += 1
    expect(moved).toBe(64)
  })

  it('breaks a slow ramp into noise instead of contours', () => {
    // A ramp a code value and a half tall over 512 pixels: what a wide glow
    // fading into the dark looks like. Undithered it is two or three flat
    // bands; the error inside each band is a steady fraction of a step. Any
    // window of the dithered ramp, though, averages back to the ramp.
    const width = 512
    const ramp = (x: number) => 0.2 + ((x / width) * 1.5) / 255
    const worst = (dither: boolean) => {
      let worstError = 0
      for (let y = 0; y < 16; y++)
        for (let start = 0; start + 32 <= width; start += 32) {
          let error = 0
          for (let x = start; x < start + 32; x++)
            error += store(ramp(x) + (dither ? ditherOffset(x, y * 3, 1.25) : 0)) / 255 - ramp(x)
          worstError = Math.max(worstError, Math.abs(error / 32) * 255)
        }

      return worstError
    }

    expect(worst(false)).toBeGreaterThan(0.25)
    expect(worst(true)).toBeLessThan(0.2)
  })

  it('is the same maths as the shader, and does not read the grain', () => {
    for (const literal of ['52.9829189', '0.06711056', '0.00583715', '0.6180339887'])
      expect(composite).toContain(literal)
    const start = composite.indexOf('let gradient')
    const end = composite.indexOf('return vec4', start)
    expect(start).toBeGreaterThan(0)
    const lines = composite.slice(start, end)
    expect(lines).not.toContain('grain.x')
    // The clock is shared with the grain and is written whatever the grain is.
    expect(lines).toContain('post.grain.y')
  })
})
