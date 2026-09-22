/**
 * The ocean's numbers: the wave trains, the surface they sum to, the sky a
 * facet reflects and the coverage the study is held to. Pure arithmetic, no
 * device. What the water looks like is judged on a real adapter; what is
 * measured here is what the picture is made of.
 */
import { describe, expect, it } from 'vitest'

import {
  facetSky,
  fresnel,
  glintBand,
  glintResolved,
  glintWidth,
  lightWindow,
  lineWindow,
  OCEAN_CHOP_HEIGHT,
  OCEAN_GLINT_ELEVATION,
  OCEAN_GLINT_WINDOW,
  OCEAN_RANGES,
  OCEAN_SUN_ELEVATION,
  OCEAN_SWELL_HEIGHT,
  OCEAN_TRAINS,
  oceanCoverage,
  oceanLit,
  oceanParams,
  SeaClock,
  seaEnvelope,
  seaFootprint,
  seaSurface,
  SWELL_TRAINS,
  trainHeights,
  trainPhases,
  trainSpeed,
  waveRate,
} from './ocean.params'

const REST = {
  speed: 0.9,
  swell: 0.25,
  chop: 0.22,
  path: 0.3,
  glints: 0.06,
  intensity: 2.2,
  hue: 0,
  horizon: 0.07,
}

describe('the knobs', () => {
  it('holds every knob to its range and takes a missing or broken one from the fallback', () => {
    const params = oceanParams({ speed: 900, swell: -3, chop: 4, path: Number.NaN, glints: -1 })
    for (const [knob, [low, high]] of Object.entries(OCEAN_RANGES)) {
      expect(params[knob as keyof typeof params]).toBeGreaterThanOrEqual(low)
      expect(params[knob as keyof typeof params]).toBeLessThanOrEqual(high)
    }

    expect(params.speed).toBe(OCEAN_RANGES.speed[1])
    expect(params.swell).toBe(0)
    expect(params.chop).toBe(OCEAN_RANGES.chop[1])
    // A study that resolved nothing draws nothing.
    expect(oceanLit(oceanParams({}))).toBe(false)
    expect(oceanLit(oceanParams(REST))).toBe(true)
  })
})

describe('the trains', () => {
  it('splits the swell from the chop, each summing its own weights to 1', () => {
    const swell = OCEAN_TRAINS.slice(0, SWELL_TRAINS)
    const chop = OCEAN_TRAINS.slice(SWELL_TRAINS)
    expect(swell.length).toBeGreaterThanOrEqual(3)
    expect(chop.length).toBeGreaterThan(3)
    const sum = (trains: typeof swell) => trains.reduce((total, t) => total + t.weight, 0)
    expect(sum(swell)).toBeCloseTo(1, 9)
    expect(sum(chop)).toBeCloseTo(1, 9)
  })

  it('gives every train a distinct wavelength and angle, so no two crest alike', () => {
    const wavelengths = new Set(OCEAN_TRAINS.map((t) => t.wavelength))
    expect(wavelengths.size).toBe(OCEAN_TRAINS.length)
  })

  it('runs deep-water trains faster the longer they are', () => {
    const [a, b] = OCEAN_TRAINS
    if (!a || !b) throw new Error('expected at least two trains')
    expect(trainSpeed(a)).toBeGreaterThan(trainSpeed(b))
  })
})

describe('the surface is the same at any frame rate', () => {
  it('reads the same point after the same seconds of travel at 30, 60, 144 and 240 steps a second', () => {
    const heights = trainHeights(oceanParams(REST))
    const readings = [30, 60, 144, 240].map((fps) => {
      const clock = new SeaClock()
      let travel = 0
      const step = 1 / fps
      for (let frame = 0; frame < Math.round(3 * fps); frame += 1) {
        clock.step(step, REST.speed)
        travel += REST.speed * step
      }

      const phases = trainPhases(travel, clock.time)
      return seaSurface(phases, heights, 2, 5, 0.8, 0.6, 0.05)
    })

    for (const reading of readings.slice(1)) {
      expect(reading.height).toBeCloseTo(readings[0]?.height ?? Number.NaN, 4)
      expect(reading.across).toBeCloseTo(readings[0]?.across ?? Number.NaN, 4)
      expect(reading.along).toBeCloseTo(readings[0]?.along ?? Number.NaN, 4)
    }
  })

  it('travels per second: the same second of travel reads the same whether it is one step or many', () => {
    const one = trainPhases(0, 0)[0] ?? 0
    let travel = 0
    const fine = new SeaClock()
    for (let frame = 0; frame < 300; frame += 1) {
      fine.step(1 / 300, REST.speed)
      travel += REST.speed / 300
    }
    const many = trainPhases(travel, fine.time)[0] ?? 0

    let coarseTravel = 0
    const coarse = new SeaClock()
    for (let frame = 0; frame < 30; frame += 1) {
      coarse.step(1 / 30, REST.speed)
      coarseTravel += REST.speed / 30
    }
    const few = trainPhases(coarseTravel, coarse.time)[0] ?? 0

    expect(many).toBeCloseTo(few, 6)
    expect(one).not.toBeCloseTo(many, 3)
  })

  it('never stills the water completely: the rate has a floor even at zero speed', () => {
    expect(waveRate(0)).toBeGreaterThan(0)
  })
})

describe('what the ring leaves a wave at silence', () => {
  it('never drops a wave to nothing: the floor keeps the sea moving through a quiet hi-hat', () => {
    expect(seaEnvelope(0)).toBeGreaterThan(0)
    expect(seaEnvelope(0)).toBeLessThan(1)
    expect(seaEnvelope(1)).toBeCloseTo(1, 9)
  })
})

describe('the sky a facet mirrors', () => {
  it('reflects nothing when the facet points the reflection down, into the water', () => {
    const steep = facetSky({ x: 0, y: -0.4 }, 0, 30)
    expect(steep.sky).toBe(0)
  })

  it('reflects the sky when the reflection points up and forward', () => {
    const flat = facetSky({ x: 0, y: -0.5 }, 0, 0)
    expect(flat.sky).toBeGreaterThan(0.9)
  })

  it('is nearly all reflection at a grazing angle and nearly none looking straight down', () => {
    const grazing = fresnel(0.02)
    const steep = fresnel(0.98)
    expect(grazing).toBeGreaterThan(0.8)
    expect(steep).toBeLessThan(0.1)
    expect(grazing).toBeGreaterThan(steep)
  })
})

describe('the glint band lights only the slopes it claims to', () => {
  it('is exactly zero outside the band and positive at its centre, once a pixel can resolve it', () => {
    const width = glintWidth(1)
    const resolved = (OCEAN_GLINT_WINDOW.from + OCEAN_GLINT_WINDOW.full) / 2
    const centre = glintBand(OCEAN_GLINT_ELEVATION, 0, width, resolved)
    const far = glintBand(OCEAN_GLINT_ELEVATION + 10 * width, 0, width, resolved)
    expect(centre).toBeGreaterThan(0)
    expect(far).toBe(0)
  })

  it('is nothing at all when the knob asks for no glints', () => {
    expect(glintBand(OCEAN_GLINT_ELEVATION, 0, glintWidth(0), 0.2)).toBe(0)
  })

  it('resolves nothing right under the horizon, where a pixel cannot see a single facet', () => {
    expect(glintResolved(0)).toBe(0)
    expect(glintResolved(OCEAN_GLINT_WINDOW.full)).toBeCloseTo(1, 9)
  })

  it('lights the light itself even where the line has faded, and the line even where the light has not reached', () => {
    const width = glintWidth(1)
    const midLine = (OCEAN_GLINT_WINDOW.from + OCEAN_GLINT_WINDOW.lineFade) / 2
    const onLine = glintBand(OCEAN_GLINT_ELEVATION, 0, width, midLine)
    expect(onLine).toBeGreaterThan(0)

    const pastLine = (OCEAN_GLINT_WINDOW.lineGone + OCEAN_GLINT_WINDOW.lightFade) / 2
    const onLight = glintBand(OCEAN_SUN_ELEVATION, 0, width, pastLine)
    const onOldLine = glintBand(OCEAN_GLINT_ELEVATION, 0, width, pastLine)
    expect(onLight).toBeGreaterThan(0)
    expect(onOldLine).toBe(0)
  })

  it('the line and the light windows both fall from 1 to 0 and never rise', () => {
    const line = [0, 0.1, 0.2, 0.3, 0.4, 0.6].map(lineWindow)
    const light = [0, 0.2, 0.4, 0.6, 0.8, 1].map(lightWindow)
    for (let i = 1; i < line.length; i += 1) expect(line[i]).toBeLessThanOrEqual(line[i - 1] ?? 1)
    for (let i = 1; i < light.length; i += 1)
      expect(light[i]).toBeLessThanOrEqual(light[i - 1] ?? 1)
  })
})

describe('the lit share is bounded, on eight canvas shapes', () => {
  const params = oceanParams({ ...REST, swell: 1, chop: 1, path: 1, glints: 1, intensity: 3 })
  const shapes: [number, number][] = [
    [1920, 1080],
    [3840, 2160],
    [1080, 1920],
    [1280, 1280],
    [2560, 1440],
    [800, 450],
    [400, 720],
    [960, 600],
  ]

  for (const [w, h] of shapes) {
    it(`${w}x${h}`, () => {
      const share = oceanCoverage(params, w, h, { stride: 8 })
      expect(share).toBeGreaterThan(0)
      expect(share).toBeLessThan(0.32)
    })
  }

  it('is sparse at rest, well under the worst case', () => {
    const rest = oceanParams(REST)
    expect(oceanCoverage(rest, 1920, 1080, { stride: 8 })).toBeLessThan(0.2)
  })
})

describe('the ground one pixel spans', () => {
  it('grows with the square of the distance, so a far pixel resolves fewer waves', () => {
    const near = seaFootprint(2, 1080)
    const far = seaFootprint(8, 1080)
    expect(far).toBeCloseTo(near * 16, 6)
  })
})

describe('the swell and the chop are independent knobs', () => {
  it('a taller swell raises the march bound; a taller chop does not', () => {
    const flat = trainHeights(oceanParams({ ...REST, swell: 0, chop: 0 }))
    const swelled = trainHeights(oceanParams({ ...REST, swell: 1, chop: 0 }))
    const choppy = trainHeights(oceanParams({ ...REST, swell: 0, chop: 1 }))
    const swellSum = (h: number[]) => h.slice(0, SWELL_TRAINS).reduce((a, b) => a + b, 0)
    expect(swellSum(swelled)).toBeGreaterThan(swellSum(flat))
    expect(swellSum(choppy)).toBeCloseTo(swellSum(flat), 9)
    expect(swellSum(swelled)).toBeCloseTo(OCEAN_SWELL_HEIGHT, 9)
    const chopSum = (h: number[]) => h.slice(SWELL_TRAINS).reduce((a, b) => a + b, 0)
    expect(chopSum(choppy)).toBeCloseTo(OCEAN_CHOP_HEIGHT, 9)
  })
})
