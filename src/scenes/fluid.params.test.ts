import { describe, expect, it } from 'vitest'

import {
  BAND_HIT,
  BAND_HIT_CENTRE,
  BAND_HIT_WIDTH,
  F,
  PACKET_LENGTH,
} from '../audio/FeatureExtractor'
import type { Tuning } from '../presets/knobs'
import { castOrDefault } from '../studies/casts/index'
import { castFrame, resolveCast } from '../studies/resolve'
import { DEFAULT_FLUID_SIZE, SOFTWARE_FLUID_SIZE } from './catalog'
import {
  BAND_GROUPS,
  bandsOf,
  EMITTER_REACH,
  emitterCount,
  eventEnvelope,
  EventPool,
  FLUID_DEFAULTS,
  fluidFrame,
  fluidParams,
  fluidTuning,
  LAYOUT_BLEND_SECONDS,
  layoutMix,
  layoutOf,
  LAYOUTS,
  MAX_BED_EMITTERS,
  MAX_EMITTERS,
  MAX_EVENTS,
  PALETTE_SIZE,
  PALETTE_STOPS,
  paletteAt,
  paletteLut,
  SIM_UNIFORM_FLOATS,
  simSize,
  STILL_LAYOUT,
  visibleExtent,
  writeSimUniform,
} from './fluid.params'
import type { LiveEvent } from './fluid.params'

const packet = (values: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

const square = { x: 0.5, y: 0.5 }

// The shipped Plume cast, resolved the way the renderer resolves it and put
// back together the way the solver reads it, so these read the behaviour the
// stage actually has rather than a bare default.
const plume = castOrDefault('plume')

const plumeTuning = (features: Float32Array): Tuning => {
  const resolved = resolveCast(plume, features, 0, castFrame())
  return fluidTuning(
    resolved.knobs.get('lazy-fluid') ?? {},
    1,
    resolved.knobs.get('dye-plumes') ?? null,
    {},
  )
}

/** Its resting numbers: nothing in the cast adds anything at a silent packet. */
const plumeRest = fluidParams(plumeTuning(new Float32Array(PACKET_LENGTH)))

const frame = (
  values: Partial<Record<keyof typeof F, number>> = {},
  dt = 1 / 60,
  visible = square,
) => {
  const features = packet(values)
  const tuning = plumeTuning(features)
  return fluidFrame(fluidParams(tuning), features, dt, visible)
}

describe('fluid grid size', () => {
  it('takes an offered size and falls back to the default for anything else', () => {
    expect(simSize(1024, false)).toBe(1024)
    expect(simSize(512, false)).toBe(512)
    expect(simSize(2048, false)).toBe(DEFAULT_FLUID_SIZE)
  })

  it('gives a software rasteriser the small grid whatever was chosen', () => {
    expect(simSize(1024, true)).toBe(SOFTWARE_FLUID_SIZE)
  })
})

describe('visible extent', () => {
  it('shows the whole square on a square canvas', () => {
    expect(visibleExtent(600, 600)).toEqual({ x: 0.5, y: 0.5 })
  })

  it('crops the short axis, so the scale is the same on both', () => {
    const wide = visibleExtent(1920, 1080)
    expect(wide.x).toBe(0.5)
    expect(wide.y).toBeCloseTo(0.5 / (1920 / 1080), 6)
    const tall = visibleExtent(1080, 1920)
    expect(tall.y).toBe(0.5)
    expect(tall.x).toBeCloseTo(0.5 * (1080 / 1920), 6)
  })

  it('survives a canvas with no area rather than dividing by zero', () => {
    const extent = visibleExtent(0, 0)
    expect(Number.isFinite(extent.x)).toBe(true)
    expect(Number.isFinite(extent.y)).toBe(true)
  })
})

describe('fluidParams', () => {
  it('takes the resolved value where there is one and the default otherwise', () => {
    expect(fluidParams({ vorticity: 40 }).vorticity).toBe(40)
    expect(fluidParams({}).viscosity).toBe(FLUID_DEFAULTS.viscosity)
    // A knob no scene offers; the parser rejects one, so this is the backstop.
    expect(fluidParams({ flow: 3 } as Tuning)).toEqual(FLUID_DEFAULTS)
  })
})

describe('fluid frame', () => {
  it('places every emitter inside the part of the grid the canvas shows', () => {
    const wide = visibleExtent(1920, 1080)
    // Louder music spreads the emitters further, so the loudest case is the
    // one that could push them off screen.
    for (const time of [0, 1.7, 5.3, 11, 23.5]) {
      const built = frame({ time, energy: 1 }, 1 / 60, wide)
      expect(built.splats).toHaveLength(plumeRest.emitters)
      for (const splat of built.splats) {
        expect(Math.abs(splat.x - 0.5)).toBeLessThanOrEqual(wide.x)
        expect(Math.abs(splat.y - 0.5)).toBeLessThanOrEqual(wide.y)
      }
    }
  })

  it('pushes along the orbit, so the direction is a unit vector', () => {
    const built = frame({ time: 3.1 })
    for (const splat of built.splats) expect(Math.hypot(splat.dx, splat.dy)).toBeCloseTo(1, 6)
  })

  it('injects much harder on an onset, and harder still with bass', () => {
    const quiet = frame()
    const hit = frame({ onset: 1, onsetStrength: 1 })
    const loud = frame({ onset: 1, onsetStrength: 1, bass: 1 })
    const force = (frame: { splats: { force: number }[] }) => frame.splats[0]?.force ?? 0
    const dye = (frame: { splats: { dye: number }[] }) => frame.splats[0]?.dye ?? 0

    expect(force(hit)).toBeGreaterThan(force(quiet) * 5)
    expect(force(loud)).toBeGreaterThan(force(hit))
    expect(dye(hit)).toBeGreaterThan(dye(quiet) * 5)
    expect(dye(loud)).toBeGreaterThan(dye(hit))
  })

  it('keeps a trickle between onsets, scaled by the step so the rate holds', () => {
    const slow = frame()
    const fast = frame({}, 1 / 120)
    expect(slow.splats[0]?.dye ?? 0).toBeGreaterThan(0)
    expect(fast.splats[0]?.dye ?? 0).toBeCloseTo((slow.splats[0]?.dye ?? 0) / 2, 6)
  })

  it('clamps the step, so a stalled tab cannot advance the sim by a second', () => {
    expect(frame({}, 1).dt).toBeLessThanOrEqual(1 / 30)
    expect(frame({}, 0).dt).toBeGreaterThan(0)
  })

  it('raises vorticity with treble and clears the dye faster with energy', () => {
    const dull = frame()
    const bright = frame({ treble: 1 })
    expect(bright.vorticity).toBeGreaterThan(dull.vorticity)
    // More treble means less smoothing, so the detail survives.
    expect(bright.viscosity).toBeLessThan(dull.viscosity)

    const loud = frame({ energy: 1 })
    expect(loud.dyeDecay).toBeGreaterThan(dull.dyeDecay)
    expect(loud.velocityDecay).toBeGreaterThan(dull.velocityDecay)
  })

  it('keeps the palette coordinate inside the table', () => {
    for (const time of [0, 9, 60, 600, 4000]) {
      const built = frame({ time, treble: 1 })
      for (const splat of built.splats) {
        expect(splat.colour).toBeGreaterThanOrEqual(0)
        expect(splat.colour).toBeLessThan(1)
      }
    }
  })
})

describe('layouts', () => {
  const at = (section: number, mix = 1, time = 7.3) => {
    const to = layoutOf(section)
    return fluidFrame(plumeRest, packet({ time }), 1 / 60, square, {
      from: layoutOf(1),
      to,
      mix,
    })
  }

  it('starts at the first layout and cycles once the ranks run out', () => {
    expect(layoutOf(1)).toBe(LAYOUTS[0])
    expect(layoutOf(2)).toBe(LAYOUTS[1])
    expect(layoutOf(LAYOUTS.length + 1)).toBe(LAYOUTS[0])
    expect(layoutOf(0)).toBe(LAYOUTS[0])
    expect(layoutOf(2.4)).toBe(LAYOUTS[1])
  })

  it('eases a change in over the blend time', () => {
    expect(layoutMix(0)).toBe(0)
    expect(layoutMix(LAYOUT_BLEND_SECONDS / 2)).toBeCloseTo(0.5, 6)
    expect(layoutMix(LAYOUT_BLEND_SECONDS)).toBe(1)
    expect(layoutMix(LAYOUT_BLEND_SECONDS * 3)).toBe(1)
    expect(layoutMix(-1)).toBe(0)
  })

  it('changes where the emitters are, and glides there', () => {
    const before = at(2, 0).splats
    const after = at(2, 1).splats
    const halfway = at(2, 0.5).splats
    const still = fluidFrame(plumeRest, packet({ time: 7.3 }), 1 / 60, square)
    let moved = 0
    before.forEach((splat, index) => {
      // At mix 0 a change has not started: the same frame as no change.
      expect(splat.x).toBeCloseTo(still.splats[index]?.x ?? -1, 6)
      expect(splat.y).toBeCloseTo(still.splats[index]?.y ?? -1, 6)
      const to = after[index]
      const mid = halfway[index]
      if (!to || !mid) throw new Error('missing splat')
      if (Math.hypot(to.x - splat.x, to.y - splat.y) > 0.01) moved++
      // Halfway to within half a percent of the canvas: the glide is a straight
      // mix of the two figures, and the bend that keeps emitters off the wall
      // comes after it, so far out the midpoint sits a little inside the chord.
      expect(mid.x).toBeCloseTo((splat.x + to.x) / 2, 2)
      expect(mid.y).toBeCloseTo((splat.y + to.y) / 2, 2)
    })
    expect(moved).toBeGreaterThan(0)
  })

  it('keeps every emitter on screen in every layout at the loudest spread', () => {
    const wide = visibleExtent(1920, 1080)
    const features = packet({ time: 4.2, energy: 1, swell: 1 })
    const tuning = plumeTuning(features)
    LAYOUTS.forEach((layout, index) => {
      const built = fluidFrame(fluidParams(tuning), features, 1 / 60, wide, {
        from: layout,
        to: layout,
        mix: 1,
      })
      for (const splat of built.splats) {
        expect(Math.abs(splat.x - 0.5), `layout ${index}`).toBeLessThanOrEqual(wide.x)
        expect(Math.abs(splat.y - 0.5), `layout ${index}`).toBeLessThanOrEqual(wide.y)
      }
    })
  })

  it('keeps every emitter off the wall through a whole orbit of the loudest drop', () => {
    const features = (time: number) => packet({ time, energy: 1, swell: 1 })
    LAYOUTS.forEach((layout, index) => {
      for (let time = 0; time < 40; time += 0.37) {
        const packed = features(time)
        const tuning = plumeTuning(packed)
        const built = fluidFrame(fluidParams(tuning), packed, 1 / 60, square, {
          from: layout,
          to: layout,
          mix: 1,
        })
        for (const splat of built.splats) {
          expect(Math.abs(splat.x - 0.5), `layout ${index}`).toBeLessThan(square.x * EMITTER_REACH)
          expect(Math.abs(splat.y - 0.5), `layout ${index}`).toBeLessThan(square.y * EMITTER_REACH)
        }
      }
    })
  })

  it('never pushes in no direction, whatever the figure', () => {
    LAYOUTS.forEach((layout) => {
      for (const time of [0, 1.1, 3.7, 20]) {
        const built = fluidFrame(plumeRest, packet({ time }), 1 / 60, square, {
          from: layout,
          to: layout,
          mix: 1,
        })
        for (const splat of built.splats) expect(Math.hypot(splat.dx, splat.dy)).toBeCloseTo(1, 6)
      }
    })
  })
})

describe('palette', () => {
  it('is one opaque row of the requested length', () => {
    const lut = paletteLut()
    expect(lut).toHaveLength(PALETTE_SIZE * 4)
    for (let index = 3; index < lut.length; index += 4) expect(lut[index]).toBe(255)
  })

  it('starts and ends on the same colour, so the coordinate wraps with no seam', () => {
    const lut = paletteLut()
    const last = (PALETTE_SIZE - 1) * 4
    for (let part = 0; part < 3; part++) expect(lut[last + part]).toBe(lut[part])
  })

  it('lands on each stop and moves between them', () => {
    const lut = paletteLut(PALETTE_SIZE)
    const stop = PALETTE_STOPS[3]
    expect(stop).toBeDefined()
    const at = Math.round((stop?.at ?? 0) * (PALETTE_SIZE - 1)) * 4
    expect(lut[at]).toBeCloseTo(Math.round((stop?.colour[0] ?? 0) * 255), -1)
    // Not one flat colour: the middle differs from the ends.
    expect(lut[PALETTE_SIZE * 2]).not.toBe(lut[0])
  })

  it('gives the colour at a coordinate as floats, landing on each stop', () => {
    for (const stop of PALETTE_STOPS.slice(0, -1)) {
      const [red, green, blue] = paletteAt(stop.at)
      expect(red).toBeCloseTo(stop.colour[0], 9)
      expect(green).toBeCloseTo(stop.colour[1], 9)
      expect(blue).toBeCloseTo(stop.colour[2], 9)
    }

    // Halfway between two stops is halfway between their colours.
    const [from, to] = [PALETTE_STOPS[2], PALETTE_STOPS[3]]
    const middle = paletteAt(((from?.at ?? 0) + (to?.at ?? 0)) / 2)
    expect(middle[0]).toBeCloseTo(((from?.colour[0] ?? 0) + (to?.colour[0] ?? 0)) / 2, 9)
  })

  it('wraps its coordinate, so the key and a drift can push it round any number of times', () => {
    for (const at of [0, 0.13, 0.5, 0.87]) {
      const wanted = paletteAt(at)
      for (const turns of [-2, -1, 1, 3]) {
        const got = paletteAt(at + turns)
        got.forEach((value, index) => expect(value).toBeCloseTo(wanted[index] ?? 0, 9))
      }
    }

    paletteAt(1).forEach((value, index) => expect(value).toBeCloseTo(paletteAt(0)[index] ?? 0, 9))
  })

  it('is the lookup table, texel for texel', () => {
    const lut = paletteLut()
    for (let index = 0; index < PALETTE_SIZE; index++) {
      const colour = paletteAt(index / (PALETTE_SIZE - 1))
      for (let part = 0; part < 3; part++)
        expect(lut[index * 4 + part]).toBe(Math.round((colour[part] ?? 0) * 255))
    }
  })
})

describe('sim uniform', () => {
  it('writes the grid, its texel and the cover scale the shader divides by', () => {
    const visible = visibleExtent(1920, 1080)
    const built = frame({}, 1 / 60, visible)
    const out = writeSimUniform(built, 512, visible, new Float32Array(SIM_UNIFORM_FLOATS))

    expect(out[0]).toBe(512)
    expect(out[1]).toBe(512)
    expect(out[2]).toBeCloseTo(1 / 512, 8)
    expect(out[12]).toBeCloseTo(visible.x * 2, 6)
    expect(out[13]).toBeCloseTo(visible.y * 2, 6)
  })

  it('carries the saturation in the slot the shader reads it from', () => {
    const out = writeSimUniform(frame(), 512, square, new Float32Array(SIM_UNIFORM_FLOATS))
    expect(out[11]).toBeCloseTo(plumeRest.saturation, 6)
  })

  it('never writes a radius the shader would divide by zero', () => {
    const built = frame()
    built.splats = []
    const out = writeSimUniform(built, 1024, square, new Float32Array(SIM_UNIFORM_FLOATS))
    for (let index = 0; index < MAX_EMITTERS; index++)
      expect(out[16 + index * 8 + 5] ?? 0).toBeGreaterThan(0)
  })

  it('carries every emitter through in order', () => {
    const built = frame({ time: 2, onset: 1, onsetStrength: 1 })
    const out = writeSimUniform(built, 512, square, new Float32Array(SIM_UNIFORM_FLOATS))
    built.splats.forEach((splat, index) => {
      const base = 16 + index * 8
      expect(out[base]).toBeCloseTo(splat.x, 6)
      expect(out[base + 1]).toBeCloseTo(splat.y, 6)
      expect(out[base + 4]).toBeCloseTo(splat.force, 6)
      expect(out[base + 6]).toBeCloseTo(splat.dye, 6)
    })
  })
})

describe('emitter count', () => {
  const counted = (emitters: number, values: Partial<Record<keyof typeof F, number>> = {}) =>
    fluidFrame(fluidParams({ emitters }), packet(values), 1 / 60, square)

  it('rounds a knob that arrives between two whole emitters', () => {
    expect(emitterCount(fluidParams({ emitters: 3.4 }))).toBe(3)
    expect(emitterCount(fluidParams({ emitters: 3.6 }))).toBe(4)
  })

  // A mapping may drive this knob like any other, so both ends need holding:
  // zero emitters is a dead stage and more than the array holds reads past it.
  it('clamps a knob driven past either end to a slot that exists', () => {
    expect(emitterCount(fluidParams({ emitters: -3 }))).toBe(1)
    expect(emitterCount(fluidParams({ emitters: 99 }))).toBe(MAX_BED_EMITTERS)
  })

  it('builds one splat per emitter asked for', () => {
    for (const count of [1, 3, MAX_BED_EMITTERS]) expect(counted(count).splats).toHaveLength(count)
  })

  it('spaces the orbit by the count rather than by a fixed three', () => {
    // Five emitters on the same orbit sit at five places, so no two share one.
    const places = counted(5, { time: 3 }).splats.map((splat) => `${splat.x},${splat.y}`)
    expect(new Set(places).size).toBe(5)
  })

  it('tells the shader how many slots this frame filled', () => {
    const out = writeSimUniform(counted(5), 512, square, new Float32Array(SIM_UNIFORM_FLOATS))
    expect(out[10]).toBe(5)
  })

  it('leaves no dye in the slots past the count', () => {
    const built = counted(2, { onset: 1, onsetStrength: 1 })
    const out = writeSimUniform(built, 512, square, new Float32Array(SIM_UNIFORM_FLOATS))
    for (let index = 2; index < MAX_EMITTERS; index++) {
      expect(out[16 + index * 8 + 4]).toBe(0)
      expect(out[16 + index * 8 + 6]).toBe(0)
    }
  })
})

describe('emitter bands', () => {
  const voiced = (
    emitters: number,
    voice: number,
    values: Partial<Record<keyof typeof F, number>> = {},
  ) => fluidFrame(fluidParams({ emitters, voice }), packet(values), 1 / 60, square)

  it('has a grouping for every count an emitter knob can reach', () => {
    expect(BAND_GROUPS).toHaveLength(MAX_BED_EMITTERS)
    BAND_GROUPS.forEach((row, index) => expect(row).toHaveLength(index + 1))
  })

  // Every band heard once at any count is what makes the knob safe to drag:
  // a gap would silence part of the music, an overlap would double it.
  it('covers every band exactly once at every count', () => {
    for (const row of BAND_GROUPS) {
      const seen: number[] = []
      for (const [from, to] of row) for (let band = from; band < to; band++) seen.push(band)
      expect(seen).toEqual([0, 1, 2, 3, 4])
    }
  })

  it('gives each emitter its own band when there are five', () => {
    expect(bandsOf(5, 0)).toEqual([0, 1])
    expect(bandsOf(5, 4)).toEqual([4, 5])
    expect(bandsOf(1, 0)).toEqual([0, 5])
  })

  // The knob resting at zero is what keeps every preset written before bands
  // existed looking the way it did, so this is the row that must not move.
  it('leaves the splats exactly as they were when the knob is at zero', () => {
    const values = { time: 4, energy: 0.8, bass: 0.9, onset: 1, onsetStrength: 1 }
    const before = fluidFrame(fluidParams({ emitters: 3 }), packet(values), 1 / 60, square)
    expect(voiced(3, 0, values).splats).toEqual(before.splats)
  })

  it('feeds an emitter whose band is playing and starves one whose is not', () => {
    const built = voiced(5, 1, { sub: 1, treble: 0 })
    expect(built.splats[0]?.dye ?? 0).toBeGreaterThan(0)
    expect(built.splats[4]?.dye ?? 0).toBe(0)
    expect(built.splats[4]?.force ?? 0).toBe(0)
  })

  // The point of the per-band detectors: a hit in one band is that band's
  // event and reaches nothing else, even a band that is playing just as loud.
  it('lands a hit on the emitter whose band fired and on no other', () => {
    const built = voiced(5, 1, { sub: 1, treble: 1, subHit: 1 })
    const quiet = voiced(5, 1, { sub: 1, treble: 1 })
    expect(built.splats[0]?.force ?? 0).toBeGreaterThan(quiet.splats[0]?.force ?? 0)
    expect(built.splats[4]?.force ?? 0).toBe(quiet.splats[4]?.force ?? 0)
  })

  it('still hears a band after its emitter has merged with a neighbour', () => {
    // Two emitters: the first covers sub through lowMid, so a sub hit is its.
    expect(bandsOf(2, 0)).toEqual([0, 3])
    const built = voiced(2, 1, { sub: 1, subHit: 1 })
    const quiet = voiced(2, 1, { sub: 1 })
    expect(built.splats[0]?.force ?? 0).toBeGreaterThan(quiet.splats[0]?.force ?? 0)
  })

  it('sets each emitter apart by colour and by size', () => {
    const built = voiced(5, 1, { time: 0 })
    expect(new Set(built.splats.map((splat) => splat.colour)).size).toBe(5)
    // Low bands are the fat ones, high bands the small ones.
    expect(built.splats[0]?.radius ?? 0).toBeGreaterThan(built.splats[4]?.radius ?? 0)
  })

  it('never drives an emitter backwards on a negative reading', () => {
    const built = voiced(5, 1, { sub: -4, subHit: -4 })
    expect(built.splats[0]?.dye ?? -1).toBe(0)
    expect(built.splats[0]?.force ?? -1).toBe(0)
  })
})

describe('event pool', () => {
  const hit = (band: number, centre: number, width = 0.05, strength = 1) => {
    const out = packet({ time: 2 })
    out[BAND_HIT + band] = strength
    out[BAND_HIT_CENTRE + band] = centre
    out[BAND_HIT_WIDTH + band] = width
    return out
  }
  const withEvents = (events: number) => fluidParams({ ...plumeRest, events })

  it('spawns one event per band that hit and no more', () => {
    const pool = new EventPool()
    pool.step(hit(0, 0.1), 1 / 60, 32, 1)
    expect(pool.live()).toHaveLength(1)
    pool.step(packet(), 1 / 60, 32, 1)
    expect(pool.live()).toHaveLength(1)
    pool.step(hit(4, 0.9), 1 / 60, 32, 1)
    expect(pool.live().map((event) => event.band)).toEqual([0, 4])
  })

  it('lets an event die after its life and no sooner', () => {
    const pool = new EventPool()
    pool.step(hit(1, 0.3), 1 / 60, 32, 0.5)
    for (let frame = 0; frame < 24; frame++) pool.step(packet(), 1 / 60, 32, 0.5)
    expect(pool.live()).toHaveLength(1)
    for (let frame = 0; frame < 12; frame++) pool.step(packet(), 1 / 60, 32, 0.5)
    expect(pool.live()).toHaveLength(0)
  })

  it('holds the cap by replacing the event nearest its end', () => {
    const pool = new EventPool()
    pool.step(hit(0, 0.1), 1 / 60, 2, 1)
    pool.step(hit(1, 0.3), 1 / 60, 2, 1)
    pool.step(hit(2, 0.5), 1 / 60, 2, 1)
    const live = pool.live()
    expect(live).toHaveLength(2)
    // The first, oldest, gave way; the second and third stay.
    expect(live.map((event) => event.band).sort()).toEqual([1, 2])
  })

  it('is off at zero and never holds more than the pool', () => {
    const pool = new EventPool()
    pool.step(hit(0, 0.1), 1 / 60, 0, 1)
    expect(pool.live()).toHaveLength(0)
    for (let frame = 0; frame < 80; frame++) pool.step(hit(frame % 5, 0.5), 1 / 60, 999, 10)
    expect(pool.live().length).toBeLessThanOrEqual(MAX_EVENTS)
  })

  it('draws an event under its band and at the height of its pitch', () => {
    const low: LiveEvent = { band: 0, centre: 0.1, width: 0.05, strength: 1, age: 0, life: 1 }
    const high: LiveEvent = { band: 4, centre: 0.9, width: 0.05, strength: 1, age: 0, life: 1 }
    const built = fluidFrame(withEvents(8), packet({ time: 2 }), 1 / 60, square, STILL_LAYOUT, [
      low,
      high,
    ])
    expect(built.splats).toHaveLength(plumeRest.emitters + 2)
    const [subBed, , , , trebleBed, lowSplat, highSplat] = built.splats
    expect(lowSplat?.x).toBe(subBed?.x)
    expect(highSplat?.x).toBe(trebleBed?.x)
    // Grid y runs down the screen, so a low sound sits at a larger y.
    expect(lowSplat?.y ?? 0).toBeGreaterThan(highSplat?.y ?? 1)
    expect(lowSplat?.y ?? 0).toBeGreaterThan(0.5)
    expect(highSplat?.y ?? 1).toBeLessThan(0.5)
  })

  it('makes a wide low hit fatter than a narrow high one', () => {
    const kick: LiveEvent = { band: 0, centre: 0.1, width: 0.2, strength: 1, age: 0, life: 1 }
    const hat: LiveEvent = { band: 4, centre: 0.9, width: 0.05, strength: 1, age: 0, life: 1 }
    const built = fluidFrame(withEvents(8), packet({ time: 2 }), 1 / 60, square, STILL_LAYOUT, [
      kick,
      hat,
    ])
    const [, , , , , kickSplat, hatSplat] = built.splats
    expect(kickSplat?.radius ?? 0).toBeGreaterThan((hatSplat?.radius ?? 0) * 2)
  })

  // The knob is what an event adds over its whole life, so summing the frames
  // of a life comes to the knob whatever the frame rate.
  it('adds the same dye over a life at any frame rate', () => {
    const params = withEvents(8)
    const total = (dt: number) => {
      let sum = 0
      for (let age = 0; age < 1; age += dt) {
        const event: LiveEvent = { band: 2, centre: 0.5, width: 0.1, strength: 1, age, life: 1 }
        const built = fluidFrame(params, packet({ time: 2 }), dt, square, STILL_LAYOUT, [event])
        sum += built.splats[plumeRest.emitters]?.dye ?? 0
      }
      return sum
    }
    expect(total(1 / 60) / params.eventDye).toBeCloseTo(1, 1)
    expect(total(1 / 144) / params.eventDye).toBeCloseTo(1, 1)
    expect(eventEnvelope(0, 1)).toBe(1)
    expect(eventEnvelope(1, 1)).toBe(0)
  })

  it('draws no event past the cap and none when the knob is off', () => {
    const events: LiveEvent[] = [0, 1, 2].map((band) => ({
      band,
      centre: 0.5,
      width: 0.1,
      strength: 1,
      age: 0,
      life: 1,
    }))
    const capped = fluidFrame(
      withEvents(2),
      packet({ time: 2 }),
      1 / 60,
      square,
      STILL_LAYOUT,
      events,
    )
    expect(capped.splats).toHaveLength(plumeRest.emitters + 2)
    const off = fluidFrame(withEvents(0), packet({ time: 2 }), 1 / 60, square, STILL_LAYOUT, events)
    expect(off.splats).toHaveLength(plumeRest.emitters)
  })

  it('sizes the uniform for the bed and the whole pool', () => {
    expect(MAX_EMITTERS).toBe(MAX_BED_EMITTERS + MAX_EVENTS)
    expect(SIM_UNIFORM_FLOATS).toBe(16 + MAX_EMITTERS * 8)
  })
})

describe('fluidTuning', () => {
  const solver = { velocityDecay: 0.1, force: 0.8, hitForce: 0.4, eventForce: 0.6, vorticity: 26 }
  const ink = { dye: 1.6, hitDye: 1.1, intensity: 1.15 }

  it('is the two halves as one, untouched at full presence', () => {
    expect(fluidTuning(solver, 1, ink, {})).toEqual({ ...solver, ...ink })
  })

  // Presence scales what the flow puts into the field and nothing else; the
  // dye is the ink's own light and is faded where the ink is drawn.
  it('scales only what a flow pushes with', () => {
    const half = fluidTuning(solver, 0.5, ink, {})
    expect(half.force).toBeCloseTo(0.4, 12)
    expect(half.hitForce).toBeCloseTo(0.2, 12)
    expect(half.eventForce).toBeCloseTo(0.3, 12)
    expect(half.velocityDecay).toBe(0.1)
    expect(half.vorticity).toBe(26)
    expect(half.dye).toBe(1.6)
  })

  // Melt is a flow with no dye ink on it: the ink's knobs are absent and the
  // fluid falls back to its own defaults, which is what its preset was handed.
  it('leaves the ink’s knobs out when no ink is live', () => {
    const alone = fluidTuning(solver, 1, null, {})
    expect(alone).toEqual(solver)
    expect(fluidParams(alone).dye).toBe(FLUID_DEFAULTS.dye)
  })

  it('rewrites the object it is given rather than keeping the last frame', () => {
    const out: Record<string, number> = {}
    fluidTuning(solver, 1, ink, out)
    fluidTuning({ vorticity: 3 }, 1, null, out)
    expect(out).toEqual({ vorticity: 3 })
  })
})
