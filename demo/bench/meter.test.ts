import { describe, expect, it } from 'vitest'

import { FrameMeter, WINDOW_MS } from './meter'

const feed = (meter: FrameMeter, ms: number, seconds: number) => {
  for (let time = 0; time < seconds * 1000; time += ms) meter.push(ms)
}

describe('FrameMeter', () => {
  it('reads nothing before there is a frame', () => {
    const meter = new FrameMeter()
    expect(meter.average).toBe(0)
    expect(meter.worst).toBe(0)
    expect(meter.frames).toBe(0)
  })

  it('reads a steady rate as itself, average and worst', () => {
    const meter = new FrameMeter()
    feed(meter, 8.5, 5)
    expect(meter.average).toBeCloseTo(8.5, 3)
    expect(meter.worst).toBeCloseTo(8.5, 3)
  })

  it('shows one hitch in the worst and hardly at all in the average', () => {
    const meter = new FrameMeter()
    feed(meter, 8, 1)
    meter.push(60)
    feed(meter, 8, 0.5)
    expect(meter.worst).toBe(60)
    expect(meter.average).toBeLessThan(11)
  })

  it('forgets a hitch once two seconds of frames have gone by since it', () => {
    const meter = new FrameMeter()
    meter.push(90)
    feed(meter, 16, 1)
    expect(meter.worst).toBe(90)
    feed(meter, 16, 2.2)
    expect(meter.worst).toBeCloseTo(16, 3)
  })

  it('holds two seconds of frames and not more, at any rate', () => {
    for (const ms of [4, 8.33, 16.67, 33]) {
      const meter = new FrameMeter()
      feed(meter, ms, 10)
      expect(meter.frames * ms).toBeLessThanOrEqual(WINDOW_MS + ms)
      expect(meter.frames * ms).toBeGreaterThan(WINDOW_MS - 2 * ms)
    }
  })

  it('still reads when one frame is longer than the whole window', () => {
    const meter = new FrameMeter()
    feed(meter, 16, 1)
    meter.push(5000)
    expect(meter.frames).toBe(1)
    expect(meter.average).toBe(5000)
    expect(meter.worst).toBe(5000)
  })

  it('survives more frames than it has room for', () => {
    const meter = new FrameMeter()
    feed(meter, 0.05, 20)
    expect(meter.frames).toBeGreaterThan(0)
    expect(meter.average).toBeCloseTo(0.05, 3)
  })

  it('takes no notice of a number that is not a time', () => {
    const meter = new FrameMeter()
    feed(meter, 10, 1)
    meter.push(Number.NaN)
    meter.push(-4)
    meter.push(Number.POSITIVE_INFINITY)
    expect(meter.average).toBeCloseTo(10, 3)
  })

  it('starts again on reset', () => {
    const meter = new FrameMeter()
    feed(meter, 20, 1)
    meter.reset()
    expect(meter.frames).toBe(0)
    expect(meter.average).toBe(0)
    expect(meter.worst).toBe(0)
  })
})
