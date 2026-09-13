import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { presetOrDefault } from '../presets/index'
import type { Tuning } from '../presets/knobs'
import { resolveScene } from '../presets/resolve'
import { DEFAULT_FLUID_SIZE, SOFTWARE_FLUID_SIZE } from './catalog'
import {
  BAND_GROUPS,
  bandsOf,
  emitterCount,
  FLUID_DEFAULTS,
  fluidFrame,
  fluidParams,
  LAYOUT_BLEND_SECONDS,
  layoutMix,
  layoutOf,
  LAYOUTS,
  MAX_EMITTERS,
  PALETTE_SIZE,
  PALETTE_STOPS,
  paletteLut,
  SIM_UNIFORM_FLOATS,
  simSize,
  visibleExtent,
  writeSimUniform,
} from './fluid.params'

const packet = (values: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

const square = { x: 0.5, y: 0.5 }

// The shipped fluid preset, resolved the way the renderer resolves it, so
// these read the behaviour the stage actually has rather than a bare default.
const plume = presetOrDefault('plume')

const frame = (
  values: Partial<Record<keyof typeof F, number>> = {},
  dt = 1 / 60,
  visible = square,
) => {
  const features = packet(values)
  const tuning = resolveScene(plume.sceneParams, plume.audioMapping, features, {})
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
      expect(built.splats).toHaveLength(plume.sceneParams.emitters)
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
    return fluidFrame(fluidParams(plume.sceneParams), packet({ time }), 1 / 60, square, {
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
    const still = fluidFrame(fluidParams(plume.sceneParams), packet({ time: 7.3 }), 1 / 60, square)
    let moved = 0
    before.forEach((splat, index) => {
      // At mix 0 a change has not started: the same frame as no change.
      expect(splat.x).toBeCloseTo(still.splats[index]?.x ?? -1, 6)
      expect(splat.y).toBeCloseTo(still.splats[index]?.y ?? -1, 6)
      const to = after[index]
      const mid = halfway[index]
      if (!to || !mid) throw new Error('missing splat')
      if (Math.hypot(to.x - splat.x, to.y - splat.y) > 0.01) moved++
      expect(mid.x).toBeCloseTo((splat.x + to.x) / 2, 6)
      expect(mid.y).toBeCloseTo((splat.y + to.y) / 2, 6)
    })
    expect(moved).toBeGreaterThan(0)
  })

  it('keeps every emitter on screen in every layout at the loudest spread', () => {
    const wide = visibleExtent(1920, 1080)
    const features = packet({ time: 4.2, energy: 1, swell: 1 })
    const tuning = resolveScene(plume.sceneParams, plume.audioMapping, features, {})
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

  it('never pushes in no direction, whatever the figure', () => {
    LAYOUTS.forEach((layout) => {
      for (const time of [0, 1.1, 3.7, 20]) {
        const built = fluidFrame(fluidParams(plume.sceneParams), packet({ time }), 1 / 60, square, {
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
    expect(out[11]).toBeCloseTo(plume.sceneParams.saturation, 6)
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
    expect(emitterCount(fluidParams({ emitters: 99 }))).toBe(MAX_EMITTERS)
  })

  it('builds one splat per emitter asked for', () => {
    for (const count of [1, 3, MAX_EMITTERS]) expect(counted(count).splats).toHaveLength(count)
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
    expect(BAND_GROUPS).toHaveLength(MAX_EMITTERS)
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
