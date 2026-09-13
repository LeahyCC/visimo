/**
 * The fluid scene's numbers: the palette lookup table, where the emitters sit,
 * and what the simulation is driven with. Pure TypeScript with no GPU objects,
 * like `post/params.ts`, so every choice here is unit tested and `Fluid.ts` is
 * left moving data between buffers.
 *
 * Which feature drives which of these numbers is the preset's business, not
 * this file's: the magnitudes arrive already modulated. The voice ladder below
 * is not an exception to that. It says which emitter stands for which sound,
 * which is this scene's own shape in the way the Lissajous orbit is, and what
 * that is worth is still a knob the preset sets.
 */
import { BAND_COUNT, BAND_HIT, F } from '../audio/FeatureExtractor'
import { FLUID_KNOBS } from '../presets/knobs'
import type { FluidKnob, Tuning } from '../presets/knobs'
import { DEFAULT_FLUID_SIZE, FLUID_SIZES, SOFTWARE_FLUID_SIZE } from './catalog'

/**
 * One emitter per band, and there are five bands. The WGSL array is this long
 * and the uniform is always sized for all of them; how many a frame fills is
 * the `emitters` knob. Raising this means adding a band in
 * `audio/FeatureExtractor.ts` and raising `MAX_EMITTERS` and the array length
 * in `shaders/fluid.common.wgsl` to match.
 */
export const MAX_EMITTERS = BAND_COUNT
export const PALETTE_SIZE = 256

/** Floats in the sim uniform; the Sim struct in fluid.common.wgsl matches. */
export const SIM_UNIFORM_FLOATS = 16 + MAX_EMITTERS * 8

/** One injection. Positions and radii are fractions of the grid. */
export type Splat = {
  x: number
  y: number
  /** Unit direction the impulse pushes in. */
  dx: number
  dy: number
  /** Velocity added at the centre, in grid widths per second. */
  force: number
  /** Gaussian radius, in grid widths. */
  radius: number
  /** Dye added at the centre. */
  dye: number
  /** Where that dye sits in the palette, 0 to 1 and wrapping. */
  colour: number
}

export type FluidFrame = {
  /** Seconds the sim advances. Clamped, so a stalled tab cannot blow it up. */
  dt: number
  /** Decay of the velocity field, per second. */
  velocityDecay: number
  /** Decay of the dye, per second. */
  dyeDecay: number
  /** Vorticity confinement strength. */
  vorticity: number
  /** Jacobi alpha for the viscosity solve; larger smooths harder. */
  viscosity: number
  /** Multiplier on the dye's colour, before the post stack sees it. */
  intensity: number
  /** How much of the dye's colour is kept, 0 for grey. */
  saturation: number
  splats: Splat[]
}

/** The visible half-extents of the square grid, as `visibleExtent` gives them. */
export type Extent = { x: number; y: number }

const MAX_STEP = 1 / 30
const TWO_PI = Math.PI * 2

/**
 * How much of the square grid a canvas of this shape shows. The grid covers
 * the canvas and the overflow is cropped, so a round splat stays round; the
 * long side of the canvas sees the whole grid and the short side a band of
 * it. Emitters are placed inside that band so nothing is injected off screen.
 */
export function visibleExtent(width: number, height: number): Extent {
  const aspect = Math.max(1e-3, width) / Math.max(1e-3, height)
  return aspect >= 1 ? { x: 0.5, y: 0.5 / aspect } : { x: 0.5 * aspect, y: 0.5 }
}

/** The grid the sim runs on: the choice, or the small one on a rasteriser. */
export const simSize = (wanted: number, software: boolean) => {
  if (software) return SOFTWARE_FLUID_SIZE
  return FLUID_SIZES.includes(wanted) ? wanted : DEFAULT_FLUID_SIZE
}

/** Jacobi sweeps for the pressure solve. Fewer leaves the field divergent. */
export const pressureIterations = (software: boolean) => (software ? 8 : 24)

/** Jacobi sweeps for the viscosity solve. */
export const diffuseIterations = (software: boolean) => (software ? 1 : 2)

type Point = { x: number; y: number }

/**
 * The figures the emitters can ride, each a closed curve inside the unit
 * square. The tangent of a path is taken by difference rather than by hand,
 * so the impulse pushes along the orbit whatever the curve is changed to.
 * The first is the Lissajous figure the scene has always had; the others are
 * what a section can swap it for.
 */
const FIGURES: readonly ((phase: number) => Point)[] = [
  (phase) => ({
    x: Math.cos(phase) * 0.72 + Math.sin(phase * 2.3) * 0.24,
    y: Math.sin(phase * 0.9) * 0.7 + Math.cos(phase * 3.1) * 0.22,
  }),
  // A ring: every emitter the same distance out, circling.
  (phase) => ({ x: Math.cos(phase) * 0.85, y: Math.sin(phase) * 0.85 }),
  // A figure of eight, crossing the middle twice a turn.
  (phase) => ({ x: Math.sin(phase) * 0.9, y: Math.sin(phase * 2) * 0.55 }),
  // A three-lobed sweep, wide and shallow.
  (phase) => ({ x: Math.cos(phase) * 0.8, y: Math.sin(phase * 3) * 0.45 }),
  // A tall figure of eight, the other way up.
  (phase) => ({ x: Math.sin(phase * 2) * 0.5, y: Math.sin(phase) * 0.85 }),
  // A slow wide ellipse, low in the frame.
  (phase) => ({ x: Math.cos(phase) * 0.9, y: Math.sin(phase) * 0.35 - 0.2 }),
]

/**
 * How a section arranges the emitters: which figure they ride, how far out,
 * how fast, how the figure is turned and how bunched they are along it.
 * A song moves numbers all the time; this is the one thing that changes the
 * composition, and it changes only when the structure says a new section
 * has begun. A section that comes back gets its layout back with it.
 */
export type Layout = {
  /** Index into `FIGURES`. */
  figure: number
  /** Multiplier on the preset's spread. */
  spread: number
  /** Multiplier on the orbit speed. */
  speed: number
  /** How far the figure is turned, as a fraction of a full turn. */
  turn: number
  /** How bunched the emitters are along the figure, 0 evenly spaced to 1 close. */
  cluster: number
}

/**
 * One layout per section, by the order the sections first appear in, cycling
 * once a song has more sections than there are layouts. The first is the
 * scene as it always was, so a track before its first boundary looks the way
 * it did before layouts existed.
 */
export const LAYOUTS: readonly Layout[] = [
  { figure: 0, spread: 1, speed: 1, turn: 0, cluster: 0 },
  { figure: 1, spread: 1.2, speed: 0.75, turn: 0, cluster: 0 },
  { figure: 2, spread: 0.8, speed: 1.3, turn: 0.125, cluster: 0.5 },
  { figure: 3, spread: 1.05, speed: 1, turn: 0.25, cluster: 0.25 },
  { figure: 4, spread: 0.9, speed: 1.1, turn: 0, cluster: 0.35 },
  { figure: 5, spread: 1.1, speed: 0.6, turn: 0.5, cluster: 0 },
]

const FIRST_LAYOUT: Layout = { figure: 0, spread: 1, speed: 1, turn: 0, cluster: 0 }

/** The layout for the `rank`th distinct section a scene has seen, 1 being the first. */
export const layoutOf = (rank: number): Layout =>
  LAYOUTS[(Math.max(1, Math.round(rank)) - 1) % LAYOUTS.length] ?? FIRST_LAYOUT

/** Seconds a change of layout takes, so the emitters glide rather than jump. */
export const LAYOUT_BLEND_SECONDS = 4

/** How far into a layout change `since` seconds after it began: an ease in and out. */
export function layoutMix(since: number): number {
  const at = Math.min(1, Math.max(0, since / LAYOUT_BLEND_SECONDS))
  return at * at * (3 - 2 * at)
}

/** A layout change under way: at `mix` 0 all `from`, at 1 all `to`. */
export type LayoutBlend = { from: Layout; to: Layout; mix: number }

/** No change under way: the first layout, settled. */
export const STILL_LAYOUT: LayoutBlend = { from: FIRST_LAYOUT, to: FIRST_LAYOUT, mix: 1 }

/** Where an emitter is on a layout's figure, and where it is about to be. */
function ride(layout: Layout, phase: number, spacing: number): { here: Point; ahead: Point } {
  const figure = FIGURES[layout.figure] ?? FIGURES[0]
  const angle = layout.turn * TWO_PI
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const at = (p: number): Point => {
    const raw = figure?.(p) ?? { x: 0, y: 0 }
    return {
      x: (raw.x * cos - raw.y * sin) * layout.spread,
      y: (raw.x * sin + raw.y * cos) * layout.spread,
    }
  }
  // Bunched emitters sit closer together along the figure; the spacing is
  // never squeezed to nothing, so no two of them ever share a point.
  const p = phase * layout.speed + spacing * (1 - 0.75 * layout.cluster)
  return { here: at(p), ahead: at(p + 0.05) }
}

/** The palette coordinate wraps, and a preset may hand over a negative one. */
const wrap = (value: number) => ((value % 1) + 1) % 1

/** Blend between two numbers. `at` 0 is the first, 1 is the second. */
const mix = (from: number, to: number, at: number) => from + (to - from) * at

/** What one emitter looks like when it stands for a band of its own. */
type Voice = {
  /** Where it sits in the palette, 0 to 1. Low bands are the blue end. */
  tint: number
  /** Multiplier on the emitter radius. Low bands are fatter. */
  size: number
  /** Multiplier on the orbit speed. High bands move quicker. */
  pace: number
}

/**
 * The character of each band, in the packet's band order. The tints walk the
 * palette the way the ear walks the spectrum, the sub at the start of the
 * span and the treble at its end, so a plume's colour says which part of the
 * music it is; the sizes and paces follow the same line, because a kick is a
 * slow fat thing and a hat is a quick small one.
 *
 * The span is under half the palette on purpose. The song's key moves the
 * whole set through `colourShift`, and that is the colour a viewer sees; the
 * bands are shades within it. Spread over the whole palette the bands
 * cancelled the key: every song showed every colour.
 */
const BAND_VOICES: readonly Voice[] = [
  { tint: 0.0, size: 1.9, pace: 0.45 },
  { tint: 0.11, size: 1.55, pace: 0.6 },
  { tint: 0.23, size: 1.1, pace: 0.9 },
  { tint: 0.34, size: 0.75, pace: 1.35 },
  { tint: 0.46, size: 0.5, pace: 1.8 },
]

/**
 * Which bands each emitter covers, as a half-open range, by how many emitters
 * there are. Row `n` splits the five bands into `n` runs, so every band is
 * heard at any count and no band is heard twice. At five it is one each, which
 * is the case the scene is really for; below that the low bands merge first,
 * because the ear separates the top of the spectrum more finely than the
 * bottom and the treble is the part worth keeping on its own.
 */
export const BAND_GROUPS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 5]],
  [
    [0, 3],
    [3, 5],
  ],
  [
    [0, 2],
    [2, 3],
    [3, 5],
  ],
  [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 5],
  ],
  [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
  ],
]

/** The bands emitter `index` covers when there are `count` of them. */
export const bandsOf = (count: number, index: number): readonly [number, number] =>
  BAND_GROUPS[count - 1]?.[index] ?? [0, BAND_COUNT]

/**
 * What a group of bands is doing now: the loudest level among them, and the
 * hardest hit among them. The loudest rather than the mean, because a group
 * stands for "is any of this playing" and a mean would let one busy band be
 * hidden by its quiet neighbours.
 */
function heard(features: Float32Array, [from, to]: readonly [number, number]) {
  let level = 0
  let hit = 0
  for (let band = from; band < to; band++) {
    level = Math.max(level, features[band] ?? 0)
    hit = Math.max(hit, features[BAND_HIT + band] ?? 0)
  }

  return { level: Math.min(1, Math.max(0, level)), hit: Math.min(1, Math.max(0, hit)) }
}

/** How a group of bands looks: the average of its members' characters. */
function look(group: readonly [number, number]): Voice {
  const [from, to] = group
  let tint = 0
  let size = 0
  let pace = 0
  for (let band = from; band < to; band++) {
    const voice = BAND_VOICES[band] ?? BAND_VOICES[0]
    tint += voice?.tint ?? 0
    size += voice?.size ?? 1
    pace += voice?.pace ?? 1
  }

  const width = Math.max(1, to - from)
  return { tint: tint / width, size: size / width, pace: pace / width }
}

/** An onset as the splats want it: nothing, or a floor plus what it was worth. */
const gateOf = (strength: number) => (strength > 0 ? 0.3 + strength * 0.7 : 0)

export type FluidParams = Record<FluidKnob, number>

/**
 * The fluid as PR #58 tuned it by eye at 3840 by 2160. The viscosity started
 * ten times higher and 4K showed enormous soft blobs with no structure in
 * them, which is why it is a knob worth a preset moving.
 */
export const FLUID_DEFAULTS: FluidParams = {
  /** Velocity lost per second. */
  velocityDecay: 0.18,
  /** Dye lost per second. */
  dyeDecay: 0.22,
  /** Vorticity confinement; what keeps filaments alive against the smearing. */
  vorticity: 12,
  /** Jacobi alpha for the viscosity solve; larger smooths harder. */
  viscosity: 0.2,
  /** Multiplier on the dye's colour before the post stack sees it. */
  intensity: 1.15,
  /** How much of the dye's colour is kept, 0 for grey. */
  saturation: 1,
  /** How far out the emitters ride, as a fraction of the visible band. */
  spread: 0.42,
  /** Velocity the emitters trickle each second. */
  force: 0.45,
  /** Dye they trickle each second. */
  dye: 1.6,
  /** Velocity one onset adds on top of the trickle. */
  hitForce: 0.3,
  /** Dye one onset adds. */
  hitDye: 1.1,
  /** Gaussian radius of an emitter, in grid widths. */
  radius: 0.012,
  /** Offset into the palette, 0 to 1 and wrapping. */
  colourShift: 0,
  /** How fast that offset drifts, per second. */
  colourDrift: 0.035,
  /** How fast the emitters ride their Lissajous orbit. */
  orbitSpeed: 0.19,
  /** How many emitters ride it, 1 up to `MAX_EMITTERS`. Rounded on use. */
  emitters: 3,
  /**
   * How far each emitter stands for its own sound rather than the whole mix.
   * At 0 they all behave alike, which is what the scene did before the ladder
   * existed; at 1 each one is only its band, in its own colour and size.
   */
  voice: 0,
}

/**
 * The knob as a count. It is a float like every other knob, so a preset or a
 * mapping may hand over 3.4 or a number off either end; the orbit spacing and
 * the uniform both need a whole number of slots that exist.
 */
export const emitterCount = (params: FluidParams) =>
  Math.min(MAX_EMITTERS, Math.max(1, Math.round(params.emitters)))

/** The resolved knobs as this scene's own object, defaults for the rest. */
export function fluidParams(tuning: Tuning): FluidParams {
  const out = { ...FLUID_DEFAULTS }
  for (const knob of FLUID_KNOBS) out[knob] = tuning[knob] ?? FLUID_DEFAULTS[knob]
  return out
}

/**
 * Everything the sim uniform needs for one frame.
 *
 * Every magnitude comes in already modulated: the preset's resting value plus
 * whatever its mapping added. What stays here is the shape of the thing. The
 * emitters ride a Lissajous orbit and push along its tangent. The trickle is
 * scaled by the step so it does not depend on the frame rate, because a track
 * with long quiet passages otherwise settles into a still frame. Injection is
 * an onset event, packet index 8 with its strength at 9, and the gate is read
 * from the packet here rather than mapped, because it is an event and not a
 * level; what the hit is worth is `hitForce` and `hitDye`.
 *
 * Each emitter also stands for one band, as far as the `voice` knob asks it
 * to. Its band's level scales what that emitter trickles, and its band's own
 * onset is what makes it hit, so a kick fires the sub emitter and leaves the
 * treble one alone rather than the two sharing one trigger at different
 * volumes. The rest of the voice is how it looks: its place in the palette
 * and how fat and how fast it is.
 *
 * The knob at 0 puts every emitter back on the global onset and the shared
 * numbers, which is what the scene did before any of this and what a preset
 * written then still gets.
 *
 * `layout` is where the emitters ride, chosen by the song's section and
 * blended from the last one so a change glides; the scene keeps that state
 * and hands it in, so this stays a function of its arguments.
 */
export function fluidFrame(
  params: FluidParams,
  features: Float32Array,
  dt: number,
  visible: Extent,
  layout: LayoutBlend = STILL_LAYOUT,
): FluidFrame {
  const step = Math.min(MAX_STEP, Math.max(0.001, dt))
  const time = features[F.time] ?? 0
  const whole =
    (features[F.onset] ?? 0) > 0.5 ? gateOf(Math.max(0, features[F.onsetStrength] ?? 0)) : 0

  const count = emitterCount(params)
  const blend = Math.min(1, Math.max(0, params.voice))
  const splats: Splat[] = []
  for (let index = 0; index < count; index++) {
    const group = bandsOf(count, index)
    const band = heard(features, group)
    const voice = look(group)
    // At a blend of 0 every one of these collapses to the number it was
    // before voices existed, which is what keeps the old look reachable.
    const drive = mix(1, band.level, blend)
    const gate = mix(whole, gateOf(band.hit), blend)
    const phase = time * params.orbitSpeed * mix(1, voice.pace, blend)
    const spacing = (index * TWO_PI) / count
    const from = ride(layout.from, phase, spacing)
    const to = ride(layout.to, phase, spacing)
    const here = {
      x: mix(from.here.x, to.here.x, layout.mix),
      y: mix(from.here.y, to.here.y, layout.mix),
    }
    const ahead = {
      x: mix(from.ahead.x, to.ahead.x, layout.mix),
      y: mix(from.ahead.y, to.ahead.y, layout.mix),
    }
    const run = Math.hypot(ahead.x - here.x, ahead.y - here.y) || 1
    // A wide layout on a loud passage can push a figure past the edge; the
    // offset is held inside the visible band so nothing is injected off
    // screen, whatever the spread and the layout add up to.
    const inside = (offset: number) => Math.min(1, Math.max(-1, offset * params.spread))
    splats.push({
      x: 0.5 + inside(here.x) * visible.x,
      y: 0.5 + inside(here.y) * visible.y,
      dx: (ahead.x - here.x) / run,
      dy: (ahead.y - here.y) / run,
      force: (params.force * step + gate * params.hitForce) * drive,
      radius: params.radius * mix(1, voice.size, blend),
      dye: (params.dye * step + gate * params.hitDye) * drive,
      colour: wrap(
        time * params.colourDrift + mix(index / count, voice.tint, blend) + params.colourShift,
      ),
    })
  }

  return {
    dt: step,
    velocityDecay: params.velocityDecay,
    dyeDecay: params.dyeDecay,
    vorticity: params.vorticity,
    viscosity: params.viscosity,
    intensity: params.intensity,
    saturation: Math.max(0, params.saturation),
    splats,
  }
}

type Stop = { at: number; colour: readonly [number, number, number] }

/**
 * Deep blue through teal and green into warm orange and magenta, then back to
 * the first colour so the coordinate can wrap without a seam. The dye carries
 * its place in here as a unit vector, so two plumes that meet average their
 * colours the short way round rather than sweeping the whole palette.
 */
export const PALETTE_STOPS: readonly Stop[] = [
  { at: 0, colour: [0.04, 0.09, 0.34] },
  { at: 0.2, colour: [0.04, 0.45, 0.66] },
  { at: 0.38, colour: [0.14, 0.74, 0.54] },
  { at: 0.56, colour: [0.92, 0.72, 0.22] },
  { at: 0.74, colour: [0.94, 0.31, 0.26] },
  { at: 0.88, colour: [0.72, 0.22, 0.72] },
  { at: 1, colour: [0.04, 0.09, 0.34] },
]

const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255)

/** The palette as one row of `rgba8unorm` texels, ready for `writeTexture`. */
export function paletteLut(size = PALETTE_SIZE): Uint8Array {
  const out = new Uint8Array(size * 4)
  for (let index = 0; index < size; index++) {
    const at = size > 1 ? index / (size - 1) : 0
    let next = 1
    while (next < PALETTE_STOPS.length - 1 && (PALETTE_STOPS[next]?.at ?? 1) < at) next++
    const from = PALETTE_STOPS[next - 1] ?? PALETTE_STOPS[0]
    const to = PALETTE_STOPS[next] ?? from
    if (!from || !to) continue
    const span = to.at - from.at
    const mix = span > 0 ? (at - from.at) / span : 0
    for (let part = 0; part < 3; part++)
      out[index * 4 + part] = channel(
        (from.colour[part] ?? 0) + ((to.colour[part] ?? 0) - (from.colour[part] ?? 0)) * mix,
      )
    out[index * 4 + 3] = 255
  }

  return out
}

/**
 * Fill the sim uniform. The layout is the Sim struct in fluid.common.wgsl:
 * grid, texel, two vec4s of settings, the cover scale, then one pair of
 * vec4s per emitter slot. Every slot is written whether or not this frame
 * uses it, so a count that drops leaves no stale splat behind.
 */
export function writeSimUniform(
  frame: FluidFrame,
  size: number,
  visible: Extent,
  out: Float32Array,
): Float32Array {
  out[0] = size
  out[1] = size
  out[2] = 1 / size
  out[3] = 1 / size
  out[4] = frame.dt
  out[5] = frame.velocityDecay
  out[6] = frame.dyeDecay
  out[7] = frame.vorticity
  out[8] = frame.viscosity
  out[9] = frame.intensity
  // The shader loops to this; the slots past it keep their zeros and cost
  // nothing but the bytes.
  out[10] = frame.splats.length
  out[11] = frame.saturation
  // Canvas coordinates times this land in the grid; it is the visible band.
  out[12] = visible.x * 2
  out[13] = visible.y * 2
  out[14] = 0
  out[15] = 0
  for (let index = 0; index < MAX_EMITTERS; index++) {
    const splat = frame.splats[index]
    const base = 16 + index * 8
    out[base] = splat?.x ?? 0.5
    out[base + 1] = splat?.y ?? 0.5
    out[base + 2] = splat?.dx ?? 0
    out[base + 3] = splat?.dy ?? 0
    out[base + 4] = splat?.force ?? 0
    // The shader divides by the radius squared, so an empty slot still gets
    // a radius rather than a zero.
    out[base + 5] = Math.max(splat?.radius ?? 0.02, 0.001)
    out[base + 6] = splat?.dye ?? 0
    out[base + 7] = splat?.colour ?? 0
  }

  return out
}
