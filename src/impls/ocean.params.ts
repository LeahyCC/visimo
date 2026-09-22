/**
 * The ocean's numbers: the wave trains, how high they stand, where the light
 * is and how much of it a slope catches, worked out on the CPU and handed to
 * the shader as a finished uniform. Pure TypeScript with no GPU objects, the
 * way `grid.params.ts` is, so the parts that decide what the picture looks
 * like can be tested without a browser. The ground it flies over is height-kit
 * (`height.params.ts`): the ring holds what the low and the mid bands were a
 * moment ago and the sea reads it as how tall each kind of wave is at that
 * distance. This is only what one study does with it.
 *
 * The sea is nearly black. What is seen is the sky reflected off the slopes:
 * each facet of the water mirrors a piece of the sky, the piece being set by
 * how it is tilted, and the sky is a glow along the horizon with a small hot
 * light in it. The rest follows from that and needs nothing painted on:
 *
 * ```text
 *   flat water        mirrors the sky at the same height below the line as the
 *                     sky is above it, so a glow above the horizon is a glow
 *                     under it, fading down the frame
 *   a tilted facet    mirrors a different height. Tilted away from you it
 *                     shows the glow's brighter, lower part; toward you it
 *                     shows higher, darker sky
 *   the light         a facet whose tilt sends the reflection to the light
 *                     lights up, so a path of them runs from the light down to
 *                     you, wider as the water is rougher
 *   a glint           a facet whose reflection lands in a thin band about the
 *                     glow's brightest line: a narrow band of slopes. Widen the
 *                     band and more of the water is in it
 * ```
 *
 * The trains are sums of sines at different wavelengths and angles. The long
 * ones are the swell, they carry the height, and they lift with the low end;
 * the short ones are the chop, they barely move the surface and mostly tilt
 * it, and they answer the mids. Everything is per second: a train's phase is
 * its wavelength's share of the distance flown plus its own speed, from the
 * deep water relation, times a clock, and both are kept whole in doubles here
 * and handed to the shader as a turn, so nothing loses precision after hours.
 */
import { F } from '../audio/FeatureExtractor'
import type { OceanKnob } from '../studies/impls'
import { groundPoint, HEIGHT_CAMERA, heightFog, pixelToNdc } from './height.params'
import type { HeightCamera, Ndc } from './height.params'

/** Floats in the uniform; the shader's `Look` struct reads them in this order. */
export const OCEAN_UNIFORM_FLOATS = 156

/**
 * Deep water's phase speed is `sqrt(g x wavelength / 2 pi)`. This is g scaled
 * to a sea that is small next to a camera two units up, so the long swell
 * crosses at a little under two units a second and the shortest chop at half
 * a unit.
 */
export const OCEAN_GRAVITY = 1.6

/** A wave train: how long it is, which way its crests run, and its share of its kind's height. */
export type WaveTrain = {
  /** Crest to crest, in world units. */
  wavelength: number
  /** Radians from straight at the camera; the train travels toward the camera and this far round. */
  angle: number
  /** Its share of the height of its kind. The swell's add to 1, and so do the chop's. */
  weight: number
  /** Where in its wavelength it stands at the start, in turns, so no two crest together at the origin. */
  phase: number
}

/**
 * The long trains carry the height and lift with the low end. Three, a few
 * seconds each way apart, at different angles: the water is a swell from one
 * side crossing another, and never one wave.
 */
const SWELL: readonly WaveTrain[] = [
  { wavelength: 15, angle: -0.1, weight: 0.54, phase: 0.13 },
  { wavelength: 9.5, angle: 0.42, weight: 0.3, phase: 0.61 },
  { wavelength: 6, angle: -0.55, weight: 0.16, phase: 0.87 },
]

/**
 * The short trains are the chop and answer the mids. A handful of sines lay a
 * lattice, so there are fourteen, each a step shorter than the last, at angles
 * laid by the golden ratio so no two run alike and spread to either side of the
 * wind: the sum is a rough surface with no pattern in it. Their share of the
 * height climbs with the wavelength, so the tilt each gives is about the same.
 */
const CHOP_COUNT = 14
const CHOP: readonly WaveTrain[] = (() => {
  const raw = Array.from({ length: CHOP_COUNT }, (_, index) => ({
    wavelength: 3.2 * 0.87 ** index,
    angle: (((index * 0.6180339887) % 1) - 0.5) * 2.2,
    phase: (index * 0.7548776662) % 1,
  }))
  const total = raw.reduce((sum, train) => sum + train.wavelength ** 0.9, 0)
  return raw.map((train) => ({ ...train, weight: train.wavelength ** 0.9 / total }))
})()

/** The first `SWELL_TRAINS` of them carry the height and lift with the low end; the rest are the chop. */
export const SWELL_TRAINS = SWELL.length
export const OCEAN_TRAINS: readonly WaveTrain[] = [...SWELL, ...CHOP]

/** How many trains the shader has room for. `OCEAN_TRAINS` may be any number up to it. */
export const OCEAN_MAX_TRAINS = 24

/** The most the swell lifts the water, in world units, when every train is crested at once. The camera is two up. */
export const OCEAN_SWELL_HEIGHT = 0.4

/** The same for the chop. It is small: its work is in the slope it gives, which is its height over its wavelength. */
export const OCEAN_CHOP_HEIGHT = 0.4

/**
 * How much of a wave's height the ring's memory of the band leaves when the
 * band was silent: the sea is never flat for want of a hi-hat.
 */
export const OCEAN_ENVELOPE_FLOOR = 0.45

/**
 * Where the ring's two reads sit across its width. The kit lays the five bands
 * across it, sub on the centre line and treble at the edge, with a smoothstep
 * between neighbours, so these two are the world x that read an even mix of
 * sub and bass (the low end) and of low mid and high mid (the mids).
 */
export const OCEAN_LOW_X = 1.75
export const OCEAN_MID_X = 8.75

/** The distance the sea has faded to nothing at, and exactly nothing past. It is fog to true black. */
export const OCEAN_REACH = 80

/**
 * Where the light is: a little above the horizon and straight ahead, in
 * half-heights of the frame. The facets that reflect it are the path.
 */
export const OCEAN_SUN_ELEVATION = 0.055

/** How far across the light spreads, in half-heights. */
export const OCEAN_SUN_SIGMA = 0.05

/** The height of the reflected sky the glints land at: a hair above the horizon's hairline. */
export const OCEAN_GLINT_ELEVATION = 0.012

/** How wide a glint's band is at its most, in half-heights of reflected sky either side of its centre. */
export const OCEAN_GLINT_WIDTH = 0.02

/** What the path's lobe is at its narrowest and its widest, in half-heights of reflected sky. */
export const OCEAN_PATH_SIGMA = { least: 0.03, most: 0.3 } as const

/** How much of the deep hue the water shows away from the glow, as a share of the glow's own light. */
export const OCEAN_DEEP_SHARE = 0.5

/**
 * How much of the sky a facet's reflection sees as it crosses the horizon: none
 * below `start`, all of it by `end`, in half-heights. A reflection that points
 * down goes into the water, and one that only just clears it meets the next
 * wave's back, so the edge is soft and not a cut.
 */
export const OCEAN_SKY_EDGE = { start: -0.015, end: 0.012 } as const

/** How far the deep colour's glow reaches above the line, as a multiple of the warm glow's reach. */
export const OCEAN_DEEP_REACH = 6

/**
 * Where in the frame the glints are lit, as how far under the horizon a pixel
 * is in half-heights.
 *
 * Right under the horizon a pixel spans many chop wavelengths and cannot see
 * one, so a facet there is a smooth swell slope and a band of slopes is a wide
 * slow stripe, not a spark, and the canvas sums a stripe that stands still to a
 * slab. So no glint is lit before `from` and all of them are by `full`, which
 * is about where the chop is a few pixels wide.
 *
 * Near the camera the trouble is the other way. A glint there crosses the frame
 * in a fraction of a second, the canvas keeps what was drawn, and it leaves a
 * streak as long as it moved in the canvas's memory: a comet, not a spark. The
 * ground is foreshortened, so the speed on screen falls with the square of the
 * distance and the streaks are short in the upper part of the water and long
 * in the lower. The glints on the light fade out lower down than the rest, so
 * the path keeps sparks down to the middle of the frame, and the ones along
 * the horizon's line, which are strips of slopes that close into rings on a
 * rough surface near enough to show them, go first.
 */
export const OCEAN_GLINT_WINDOW = {
  from: 0.05,
  full: 0.11,
  lineFade: 0.16,
  lineGone: 0.3,
  lightFade: 0.3,
  lightGone: 0.6,
} as const

/** A glint that lands in the path is this much hotter, so the path breaks up into sparks and is not a smear. */
export const OCEAN_PATH_GLINT = 2

/** Fresnel at normal incidence, for water. The rest is a fifth power in the cosine. */
export const OCEAN_F0 = 0.02

/**
 * The light of each part, as a multiple of `intensity`, held here and handed
 * to the shader in the uniform so the two cannot disagree. The sheen (the
 * glow in the water) and the path move, and are drawn at their own light. The
 * horizon and the light itself stand still on the screen and the canvas sums
 * a mark that stands still to about forty times what is drawn, so they are
 * drawn at a small share of it: the same lesson as the grid's horizon.
 */
export const OCEAN_GAIN = {
  sheen: 0.005,
  deep: 0.02,
  path: 0.05,
  glint: 0.6,
  still: 0.0012,
} as const

/** How hot the light's own core is against the horizon's hairline, both in `still`. */
export const OCEAN_SUN_PEAK = 9

/**
 * How far round the colour wheel the water's deep hue is from the warm one, in
 * turns. The warm hue is the glow, the path and the glints; the deep one is
 * the body of the water and the sky far above the glow. A third of a turn
 * apart, and the key moves both.
 */
export const OCEAN_HUE_GAP = 1 / 3

/**
 * How far round the wheel the key may take the two hues, in turns, from a key
 * of 0 to the last one on the circle of fifths. Water has a colour: the lightning
 * that followed the key all the way round drew a red bolt, and a sea that did
 * would be green under a red sky. A third of the wheel moves the deep hue from
 * violet through blue to teal and the warm one from gold through red to rose,
 * which is every sunset there is over every sea there is.
 */
export const OCEAN_KEY_SWING = 0.3

/** The warm hue in turns on the shader's cosine wheel at a key of 0: an orange gold, so the deep one is blue. */
export const OCEAN_WARM_HUE = 0.91

/** A pixel that spans this share of a wavelength is starting to alias and is gone by the second. */
export const OCEAN_LOD = { start: 0.25, end: 0.7 } as const

/** The lit threshold the brief names: a pixel counts as lit when its drawn light passes it. */
export const OCEAN_LIT = 0.3

/**
 * What each knob may reach, inclusive. The params clamp to them, and the
 * registry guard holds every study to its own resolved values at silence and
 * at a full packet.
 */
export const OCEAN_RANGES: Record<OceanKnob, readonly [number, number]> = {
  // World units a second the camera flies, and with it how fast the water
  // itself moves (see `waveRate`): a still sea is a slow one.
  speed: [0, 6],
  // How tall the swell is, 0 flat to 1 the most the kit allows under the camera.
  swell: [0, 1],
  // How tall the chop is, which is how rough the surface is under the light.
  chop: [0, 1],
  // How wide the path of light is, 0 a thread to 1 most of the sky's width.
  path: [0, 1],
  // How wide the band of slopes that glint is, so how many facets are lit at once.
  glints: [0, 1],
  // The light of the glow in the water before the parts scale it. Past 1 on
  // purpose: the canvas is half float and the bloom needs a core over its
  // threshold to make a glint a spark and not a dot.
  intensity: [0, 3],
  // Turns added to the key.
  hue: [-0.5, 0.5],
  // How far the horizon's glow reaches above the line, in half-heights of the frame.
  horizon: [0.02, 0.3],
}

export type OceanParams = Record<OceanKnob, number>

const KNOBS = Object.keys(OCEAN_RANGES) as OceanKnob[]

/** What a knob a study did not resolve falls to. The light falls to nothing. */
const FALLBACK: OceanParams = {
  speed: 0,
  swell: 0,
  chop: 0,
  path: 0.3,
  glints: 0,
  intensity: 0,
  hue: 0,
  horizon: 0.07,
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

const smoothstep = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low), 0, 1)
  return t * t * (3 - 2 * t)
}

const TAU = Math.PI * 2

/** The knobs a study resolved, clamped to their ranges; a missing or non-finite one takes its fallback. */
export function oceanParams(knobs: Readonly<Partial<Record<string, number>>>): OceanParams {
  const out: OceanParams = { ...FALLBACK }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = OCEAN_RANGES[knob]
    out[knob] = clamp(
      value !== undefined && Number.isFinite(value) ? value : FALLBACK[knob],
      low,
      high,
    )
  }

  return out
}

/**
 * Whether anything is drawn this frame. The intensity carries the gate: the
 * study takes it to 0 with the level, so a silent packet is no light and so no
 * pass and no upload.
 */
export const oceanLit = (params: OceanParams) => params.intensity > 1e-3

/**
 * How fast the water's own clock runs against the wall clock. The camera's
 * flight is `speed` and the waves keep to it, so a build that stills the sea
 * stills the water and not only the view, but never to a full stop: a sea with
 * no motion in it is a painting.
 */
export const waveRate = (speed: number) => clamp(0.2 + 0.4 * speed, 0, 1.8)

/** Deep water phase speed for a wavelength, world units a second. */
export const trainSpeed = (train: WaveTrain) => Math.sqrt((OCEAN_GRAVITY * train.wavelength) / TAU)

/**
 * The water's clock, in seconds of its own time. Kept as a double for the
 * whole of a session and stepped by the real `dt` at the rate `speed` sets, so
 * the same seconds of the same speed are the same clock at any frame rate.
 * The step is clamped like the renderer's, so a hidden tab does not wake to a
 * sea that has moved on.
 */
export class SeaClock {
  time = 0

  step(dt: number, speed: number): number {
    const step = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0
    this.time += step * waveRate(speed)
    return this.time
  }
}

/**
 * Each train's phase in turns, wrapped to 0 to 1, from how far the camera has
 * flown and the water's own clock. A train's crests run along its angle and
 * travel toward the camera at its own speed, so the flight moves them by the
 * part of it that lies along the train and the clock by its speed.
 */
export function trainPhases(travel: number, time: number, out: number[] = []): number[] {
  OCEAN_TRAINS.forEach((train, index) => {
    const turns =
      (travel * Math.cos(train.angle) + trainSpeed(train) * time) / train.wavelength + train.phase
    out[index] = turns - Math.floor(turns)
  })

  return out
}

/** How tall each train stands before the ring and the distance scale it, in world units. */
export function trainHeights(params: OceanParams, out: number[] = []): number[] {
  OCEAN_TRAINS.forEach((train, index) => {
    const master =
      index < SWELL_TRAINS ? OCEAN_SWELL_HEIGHT * params.swell : OCEAN_CHOP_HEIGHT * params.chop
    out[index] = master * train.weight
  })

  return out
}

/** What the ring's memory of a band does to the height of the waves it drives. The shader's `ENV_FLOOR` line. */
export const seaEnvelope = (level: number) =>
  OCEAN_ENVELOPE_FLOOR + (1 - OCEAN_ENVELOPE_FLOOR) * clamp(level, 0, 1)

/** The most the sea can lift the water, which is what the march's slices are cut between. */
export const seaBound = (heights: readonly number[]) =>
  heights.slice(0, SWELL_TRAINS).reduce((sum, height) => sum + height, 0)

/**
 * How far along the ground one pixel reaches at a distance: the ground is
 * foreshortened, so this grows with the square of it. What decides whether a
 * wave is worth drawing at all, and the shader's `sea_footprint`.
 */
export const seaFootprint = (
  distance: number,
  canvasHeight: number,
  camera: HeightCamera = HEIGHT_CAMERA,
) => ((distance * distance) / (camera.focal * camera.height)) * (2 / canvasHeight)

/** How much of a train survives a pixel that spans `footprint` of the ground. The shader's `sea_lod`. */
export const seaLod = (wavelength: number, footprint: number) =>
  1 - smoothstep(OCEAN_LOD.start, OCEAN_LOD.end, footprint / wavelength)

/** The water at a point: how high it stands and how it is tilted, across and along. */
export type SeaSurface = { height: number; across: number; along: number }

/**
 * The surface at a ground point, `x` across and `dz` ahead of the camera. The
 * height is the swell alone, since that is what the march looks for; the slope
 * is all six trains, since the chop is what the light finds. `low` and `mid`
 * are what the ring read at that distance (0 to 1) and `footprint` is the
 * ground one pixel spans there. The shader's `sea_height` and `sea_slope`.
 */
export function seaSurface(
  phases: readonly number[],
  heights: readonly number[],
  x: number,
  dz: number,
  low: number,
  mid: number,
  footprint: number,
  into: SeaSurface = { height: 0, across: 0, along: 0 },
): SeaSurface {
  let height = 0
  let across = 0
  let along = 0
  OCEAN_TRAINS.forEach((train, index) => {
    const inverse = 1 / train.wavelength
    const turns =
      (x * Math.sin(train.angle) + dz * Math.cos(train.angle)) * inverse + (phases[index] ?? 0)
    const swell = index < SWELL_TRAINS
    const scale =
      (heights[index] ?? 0) * seaEnvelope(swell ? low : mid) * seaLod(train.wavelength, footprint)
    if (swell) height += scale * Math.sin(TAU * turns)
    const tilt = scale * TAU * Math.cos(TAU * turns) * inverse
    across += tilt * Math.sin(train.angle)
    along += tilt * Math.cos(train.angle)
  })

  into.height = height
  into.across = across
  into.along = along
  return into
}

/** Fresnel's reflectance for a view at `cosine` to the surface's normal. */
export const fresnel = (cosine: number) =>
  OCEAN_F0 + (1 - OCEAN_F0) * (1 - clamp(cosine, 0, 1)) ** 5

/**
 * The sky a facet mirrors. `elevation` and `azimuth` are where its reflection
 * points, in half-heights of the frame from the horizon and the middle (the
 * same units the frame is drawn in, so a flat sea has an elevation equal to
 * how far under the horizon the pixel is), `cosine` is the view's angle to the
 * facet's normal and `sky` is whether the reflection points up at all: one
 * that points down goes into the water and shows none.
 */
export type FacetSky = { elevation: number; azimuth: number; cosine: number; sky: number }

export function facetSky(
  ndc: Ndc,
  across: number,
  along: number,
  camera: HeightCamera = HEIGHT_CAMERA,
): FacetSky {
  const dy = ndc.y - camera.horizon
  const length = Math.hypot(ndc.x, dy, camera.focal)
  const view = { x: ndc.x / length, y: dy / length, z: camera.focal / length }
  const normalLength = Math.hypot(across, 1, along)
  const normal = { x: -across / normalLength, y: 1 / normalLength, z: -along / normalLength }
  const facing = view.x * normal.x + view.y * normal.y + view.z * normal.z
  const reflected = {
    x: view.x - 2 * facing * normal.x,
    y: view.y - 2 * facing * normal.y,
    z: view.z - 2 * facing * normal.z,
  }
  const forward = Math.max(reflected.z, 0.05)
  const elevation = (camera.focal * reflected.y) / forward
  return {
    elevation,
    azimuth: (camera.focal * reflected.x) / forward,
    cosine: clamp(-facing, 0, 1),
    sky: reflected.z > 0 ? smoothstep(OCEAN_SKY_EDGE.start, OCEAN_SKY_EDGE.end, elevation) : 0,
  }
}

/** How much of any glint a pixel that far under the horizon may show. The shader's `resolved`. */
export const glintResolved = (depression: number) =>
  smoothstep(OCEAN_GLINT_WINDOW.from, OCEAN_GLINT_WINDOW.full, depression)

/** How much of the glints along the horizon's line it may show. The shader's `along_line`. */
export const lineWindow = (depression: number) =>
  1 - smoothstep(OCEAN_GLINT_WINDOW.lineFade, OCEAN_GLINT_WINDOW.lineGone, depression)

/** How much of the glints on the light it may show. The shader's `along_light`. */
export const lightWindow = (depression: number) =>
  1 - smoothstep(OCEAN_GLINT_WINDOW.lightFade, OCEAN_GLINT_WINDOW.lightGone, depression)

/** The knob to the half width of the glints' band, in half-heights of reflected sky. */
export const glintWidth = (glints: number) => OCEAN_GLINT_WIDTH * clamp(glints, 0, 1)

/** The knob to the path's width, in half-heights of reflected sky. */
export const pathSigma = (path: number) =>
  OCEAN_PATH_SIGMA.least + (OCEAN_PATH_SIGMA.most - OCEAN_PATH_SIGMA.least) * clamp(path, 0, 1)

/**
 * Whether a facet is in a glint's band, 1 at the centre of the band falling to
 * exactly 0 at its edge and nothing past it, so a facet outside it is never
 * lit and the count of lit facets is the band's width. There are two bands: the
 * strip of reflected sky about the glow's brightest line, and the disc round
 * the light itself. `elevation` and `azimuth` are the sky the facet mirrors,
 * `width` is the band's half width from `glintWidth`, and `depression` is how
 * far under the horizon the pixel is, which says whether the pixel can resolve
 * a facet at all (`glintResolved`) and whether the strip may show (`lineWindow`).
 * The shader's `band`.
 */
export const glintBand = (
  elevation: number,
  azimuth: number,
  width: number,
  depression: number,
) => {
  if (width <= 0) return 0
  const onLine =
    lineWindow(depression) *
    (1 - smoothstep(0.5 * width, width, Math.abs(elevation - OCEAN_GLINT_ELEVATION)))
  const onLight =
    lightWindow(depression) *
    (1 - smoothstep(0.5 * width, width, Math.hypot(elevation - OCEAN_SUN_ELEVATION, azimuth)))
  return glintResolved(depression) * Math.max(onLine, onLight)
}

/** The path's lobe: 1 where a facet's reflection lands on the light, falling away round it. */
export const pathLobe = (elevation: number, azimuth: number, sigma: number) => {
  const up = elevation - OCEAN_SUN_ELEVATION
  return Math.exp(-(up * up + azimuth * azimuth) / (2 * sigma * sigma))
}

/** The parts of the water's light at a facet, each before the intensity and the fog. */
export type SeaLight = { sheen: number; path: number; glint: number }

/**
 * What one facet reflects to the eye, in the parts the shader adds:
 *
 * - the sheen, the glow along the horizon mirrored (bright at the line and
 *   fading up the sky) with a little of the deep colour far above it,
 * - the path, the light's lobe,
 * - the glints, the thin band about the glow's brightest line, hotter where
 *   they fall in the path.
 *
 * All three are scaled by Fresnel, which is why the water is black under your
 * feet and bright toward the horizon: a view that grazes the surface reflects
 * nearly everything and one that looks down into it reflects almost nothing.
 * The shader's body of the same name, term for term.
 */
export function seaLight(params: OceanParams, sky: FacetSky, depression: number): SeaLight {
  if (sky.sky <= 0) return { sheen: 0, path: 0, glint: 0 }
  const fres = fresnel(sky.cosine) * sky.sky
  const spread = params.horizon
  const height = Math.max(sky.elevation, 0)
  const sheen =
    fres *
    (Math.exp(-height / spread) * OCEAN_GAIN.sheen +
      OCEAN_DEEP_SHARE * Math.exp(-height / (OCEAN_DEEP_REACH * spread)) * OCEAN_GAIN.deep)
  const lobe = pathLobe(sky.elevation, sky.azimuth, pathSigma(params.path))
  const path = fres * lobe * OCEAN_GAIN.path
  const glint =
    fres *
    glintBand(sky.elevation, sky.azimuth, glintWidth(params.glints), depression) *
    (1 + OCEAN_PATH_GLINT * lobe) *
    OCEAN_GAIN.glint
  return { sheen, path, glint }
}

/**
 * The horizon as two amounts, a hairline at exactly the line and the glow
 * round it, and the light itself. The kit's `height_horizon_glow`, and a
 * small hot core where the light is. Standing still, so drawn at `still`.
 */
export function skyLight(
  params: OceanParams,
  ndc: Ndc,
  canvasHeight: number,
  camera: HeightCamera = HEIGHT_CAMERA,
): number {
  const e = ndc.y - camera.horizon
  const pixel = 2 / canvasHeight
  const line = Math.exp(-(e * e) / (2.8 * pixel * pixel))
  const band = Math.exp(-Math.abs(e) / (params.horizon * (e > 0 ? 1 : 0.9)))
  const up = e - OCEAN_SUN_ELEVATION
  const sun = OCEAN_SUN_PEAK * Math.exp(-(up * up + ndc.x * ndc.x) / (2 * OCEAN_SUN_SIGMA ** 2))
  return (line * 0.9 + band * 0.35 + sun) * OCEAN_GAIN.still
}

/**
 * The share of a frame the sea lights, at the widest its knobs reach: the
 * pixels whose drawn light, at the study's own intensity and after the fog,
 * passes `OCEAN_LIT`. It counts the sea, the horizon and the light. The ring
 * is taken full, which is the tallest the waves ever stand, and the clock is
 * taken at several times, because where the crests are decides which slopes
 * are under the light and the worst of them is what is held. The geometry is
 * the flat sea's, so a crest's displacement is left out; it moves a facet a
 * few pixels and not the count.
 *
 * `stride` samples every that many pixels each way, which is the difference
 * between a test that runs in a moment and one that runs for a minute.
 */
export function oceanCoverage(
  params: OceanParams,
  canvasWidth: number,
  canvasHeight: number,
  options: { stride?: number; times?: readonly number[]; travel?: number } = {},
): number {
  const stride = options.stride ?? 4
  const times = options.times ?? [0, 2.9, 7.3]
  const travel = options.travel ?? 0
  const heights = trainHeights(params)
  const surface: SeaSurface = { height: 0, across: 0, along: 0 }
  let worst = 0
  for (const time of times) {
    const phases = trainPhases(travel, time)
    let lit = 0
    let counted = 0
    for (let py = 0; py < canvasHeight; py += stride)
      for (let px = 0; px < canvasWidth; px += stride) {
        counted += 1
        const ndc = pixelToNdc(px + 0.5, py + 0.5, canvasWidth, canvasHeight)
        let light = skyLight(params, ndc, canvasHeight)
        const ground = groundPoint(HEIGHT_CAMERA, ndc)
        if (ground && ground.z < OCEAN_REACH) {
          seaSurface(
            phases,
            heights,
            ground.x,
            ground.z,
            1,
            1,
            seaFootprint(ground.z, canvasHeight),
            surface,
          )
          const parts = seaLight(
            params,
            facetSky(ndc, surface.across, surface.along),
            HEIGHT_CAMERA.horizon - ndc.y,
          )
          light += (parts.sheen + parts.path + parts.glint) * heightFog(ground.z, OCEAN_REACH)
        }

        if (light * params.intensity > OCEAN_LIT) lit += 1
      }

    worst = Math.max(worst, lit / counted)
  }

  return worst
}

/**
 * Where each block of the uniform starts, in floats. The shader's `Look` struct
 * is these, in this order. The trains have room for `OCEAN_MAX_TRAINS` whatever
 * there are, so a train added is a line in the list and not a change to the
 * struct, and the shader is told how many there are.
 */
export const OCEAN_LAYOUT = {
  /** Per train: 1 / wavelength, sin(angle) / wavelength, cos(angle) / wavelength, the phase in turns. */
  trains: 0,
  /** Each train's height before the ring and the distance scale it, four to a row. */
  heights: OCEAN_MAX_TRAINS * 4,
  /** The rows of four after them, the first being the deep hue, the warm hue (turns), the intensity, the glow's reach. */
  hues: OCEAN_MAX_TRAINS * 5,
} as const

/**
 * The uniform the shader reads: the trains, their heights, then nine rows of
 * four.
 *
 * ```text
 *   hues    the deep hue, the warm hue (turns), the intensity, the glow's reach
 *   sea     the swell's tallest, the path's sigma, the glints' half width, the light's elevation
 *   sky     the light's sigma, the fog's reach, the glint's elevation, the deep share
 *   gain    the light of the sheen, of the path, of the glints, of the parts that stand still
 *   tune    the ring's floor, where a wave starts to be lost to a pixel and where it is gone,
 *           the path glint's boost
 *   more    Fresnel at normal incidence, the light's peak, the ring's low read, its mid read
 *   extra   how far the deep colour's glow reaches, the light of the deep colour, how many trains
 *           there are, how many of them are swell
 *   window  where the glints come in and are all there, where the ones on the line fade and are gone
 *   window2 where the ones on the light fade and are gone, two spare
 * ```
 *
 * The key is read from the packet, not the knobs, because it is a colour the
 * tracker keeps, the way the lasers read it. Every constant of the water is
 * written here rather than declared twice, so the shader and this file cannot
 * disagree about it.
 */
export function writeOceanUniform(
  params: OceanParams,
  features: Float32Array,
  travel: number,
  time: number,
  out: Float32Array,
): Float32Array {
  const heights = trainHeights(params)
  const phases = trainPhases(travel, time)
  out.fill(0, OCEAN_LAYOUT.trains, OCEAN_LAYOUT.hues)
  OCEAN_TRAINS.forEach((train, index) => {
    const inverse = 1 / train.wavelength
    const at = OCEAN_LAYOUT.trains + index * 4
    out[at] = inverse
    out[at + 1] = Math.sin(train.angle) * inverse
    out[at + 2] = Math.cos(train.angle) * inverse
    out[at + 3] = phases[index] ?? 0
    out[OCEAN_LAYOUT.heights + index] = heights[index] ?? 0
  })

  const warm = (features[F.keyHue] ?? 0) * OCEAN_KEY_SWING + OCEAN_WARM_HUE + params.hue
  out.set(
    [
      warm + OCEAN_HUE_GAP,
      warm,
      params.intensity,
      params.horizon,
      seaBound(heights),
      pathSigma(params.path),
      glintWidth(params.glints),
      OCEAN_SUN_ELEVATION,
      OCEAN_SUN_SIGMA,
      OCEAN_REACH,
      OCEAN_GLINT_ELEVATION,
      OCEAN_DEEP_SHARE,
      OCEAN_GAIN.sheen,
      OCEAN_GAIN.path,
      OCEAN_GAIN.glint,
      OCEAN_GAIN.still,
      OCEAN_ENVELOPE_FLOOR,
      OCEAN_LOD.start,
      OCEAN_LOD.end,
      OCEAN_PATH_GLINT,
      OCEAN_F0,
      OCEAN_SUN_PEAK,
      OCEAN_LOW_X,
      OCEAN_MID_X,
      OCEAN_DEEP_REACH,
      OCEAN_GAIN.deep,
      OCEAN_TRAINS.length,
      SWELL_TRAINS,
      OCEAN_GLINT_WINDOW.from,
      OCEAN_GLINT_WINDOW.full,
      OCEAN_GLINT_WINDOW.lineFade,
      OCEAN_GLINT_WINDOW.lineGone,
      OCEAN_GLINT_WINDOW.lightFade,
      OCEAN_GLINT_WINDOW.lightGone,
      0,
      0,
    ],
    OCEAN_LAYOUT.hues,
  )

  return out
}
