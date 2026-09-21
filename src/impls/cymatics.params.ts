/**
 * The plate's numbers: which modes a struck square plate is ringing in, how
 * strongly, and how the line where the sand gathers is drawn, worked out on
 * the CPU and handed to the shader as a finished uniform. Pure TypeScript with
 * no GPU objects, the way `petals.params.ts` is, so what decides the picture
 * can be tested without a browser.
 *
 * Sand on a vibrating plate leaves the plate's nodal set: the curves where the
 * plate is still. A square plate rings in the modes `cos(n pi x) cos(m pi y)`
 * and its transpose, each with its own pitch, and a mix of them is one plate
 * with one figure: the sum's zero set. Each of the twelve pitch classes gets a
 * mode pair of its own, so a chord is a handful of modes summed and the figure
 * is the notes that are sounding. The pairs run from the plainest (1, 2) up in
 * order of `n^2 + m^2`, which is how a plate's resonances climb, so a higher
 * pitch class is a busier figure and one note is always the same figure.
 *
 * A note's strength is the mode's weight, and that is all `mode0` to `mode11`
 * are. A second set of twelve finer modes, the partners, rings along with the
 * first in the share `layer` says, so a hard strike puts more modes into the
 * plate the way a hard strike puts more overtones into a bell. Only the
 * relative weights decide where the lines go, so the level is not in the
 * figure at all: a quiet chord and a loud one are the same lines, and how loud
 * shows in how wide and how bright they are drawn.
 *
 * The line is drawn from the sum itself. Near the nodal set the distance to it
 * is `|f| / |grad f|`, and the gradient is what the GPU already knows from the
 * neighbouring pixels, so a line is a pixel or two wide at any resolution and
 * has no aliasing to shimmer. The same expression is done here with the
 * analytic gradient, which is what the tests measure.
 *
 * Nothing here runs on a clock. The figure is a function of the note knobs and
 * the key, and the knobs are shaped by the study per second, so the same song
 * at any frame rate draws the same plate.
 */
import { CHROMA_ROW, F } from '../audio/FeatureExtractor'
import type { CymaticsKnob } from '../studies/impls'
import { fifthsPlace } from './petals.params'

/** Floats in the uniform; the shader's `Params` struct reads them in this order. */
export const CYMATICS_UNIFORM_FLOATS = 160

/** Notes in the scale, and so modes in each set. */
export const NOTES = 12

/**
 * The mode pair each pitch class rings, as `[n, m]` with `n < m`. `n = m`
 * would be its own transpose and cancel, and the list is the twelve plainest
 * pairs under `m = 6` in order of `n^2 + m^2`: 5, 10, 13, 17, 20, 25, 26, 29,
 * 34, 37, 40, 41.
 */
export const BASE_PAIRS: readonly (readonly [number, number])[] = [
  [1, 2],
  [1, 3],
  [2, 3],
  [1, 4],
  [2, 4],
  [3, 4],
  [1, 5],
  [2, 5],
  [3, 5],
  [1, 6],
  [2, 6],
  [4, 5],
]

/**
 * The finer modes that ring along at a hard strike, one for each note: the
 * next twelve pairs up, `n^2 + m^2` from 45 to 85. The highest number in
 * either list is 8, which is what the shader's table of cosines holds.
 */
export const PARTNER_PAIRS: readonly (readonly [number, number])[] = [
  [3, 6],
  [1, 7],
  [4, 6],
  [2, 7],
  [3, 7],
  [5, 6],
  [4, 7],
  [1, 8],
  [2, 8],
  [3, 8],
  [5, 7],
  [6, 7],
]

/** The largest mode number, so the shader knows how many cosines to tabulate. */
export const TOP_MODE = 8

/**
 * How a mode mixes with its transpose: `+1` or `-1`. An antisymmetric mode
 * always has the diagonal as a nodal line, and a plate that only ever rang in
 * those would draw the same diagonal in every figure, so the signs are mixed
 * and a chord almost always has both kinds in it.
 */
export const SIGNS: readonly number[] = [-1, 1, 1, -1, 1, -1, -1, 1, -1, 1, 1, -1]

/** The partner's sign is another note's, so a note and its partner do not share a symmetry. */
export const partnerSign = (note: number) => SIGNS[(note + 5) % NOTES] ?? 1

/** How strongly a partner rings against the note it belongs to, when `layer` is full. */
export const PARTNER_GAIN = 0.6

/** A note under this is not ringing, and a plate with none of them draws nothing. */
export const MODE_MIN = 0.01

/** The plate's side as a share of the canvas's short side. */
export const PLATE = 0.8

/** The canvas height a width in pixels is written against. */
const REFERENCE_HEIGHT = 1080

/**
 * The strongest note at which the whole figure is drawn at full light. Under
 * it the figure fades, so a chord that has all but died away goes out as a
 * dimming and not as a line drawing that stays at full strength until the last
 * note drops under `MODE_MIN` and then vanishes. The lines' places do not
 * depend on the level, so without this a fading chord would not look faded.
 */
export const FULL_AT = 0.4
export const FADE_FROM = 0.03

/**
 * The line, in the units the intensity multiplies. The core is a thin line of
 * full light that is pulled toward white, so it is hot at the centre, and the
 * glow round it is the note's own colour and carries less than a tenth of the
 * core's light. The canvas keeps 0.975 of itself a frame, so a figure that
 * holds still settles at about forty times what a frame adds: what is drawn
 * has to be thin for what accumulates to be thin, and the glow is small for
 * the same reason the petals' halo is.
 */
export const GLOW_GAIN = 0.09
export const CORE_WHITE = 0.35

/** What each knob may reach, inclusive. The params clamp to them. */
export const CYMATICS_RANGES: Record<CymaticsKnob, readonly [number, number]> = {
  mode0: [0, 1],
  mode1: [0, 1],
  mode2: [0, 1],
  mode3: [0, 1],
  mode4: [0, 1],
  mode5: [0, 1],
  mode6: [0, 1],
  mode7: [0, 1],
  mode8: [0, 1],
  mode9: [0, 1],
  mode10: [0, 1],
  mode11: [0, 1],
  // How far the finer partner modes have come up, 0 to 1.
  layer: [0, 1],
  // 0 is the loosest line and 1 the thinnest and tightest.
  sharp: [0, 1],
  // A line's half width in device pixels, and the glow's reach in pixels at the
  // reference height.
  width: [0.4, 4],
  glow: [1, 24],
  // How hard the plate has been struck. The struck plate rings, so the study
  // reaches this through a spring, which may overshoot a little either way.
  strike: [0, 1],
  // Past 1 on purpose: the canvas is half float and the bloom needs something
  // over its threshold. Nothing loud raises it; that is the registry's rule.
  intensity: [0, 3],
}

export type CymaticsParams = Record<CymaticsKnob, number>

const KNOBS = Object.keys(CYMATICS_RANGES) as CymaticsKnob[]

/** What a knob a study did not resolve falls to: nothing ringing, and a plain thin line. */
const FALLBACK: CymaticsParams = {
  mode0: 0,
  mode1: 0,
  mode2: 0,
  mode3: 0,
  mode4: 0,
  mode5: 0,
  mode6: 0,
  mode7: 0,
  mode8: 0,
  mode9: 0,
  mode10: 0,
  mode11: 0,
  layer: 0,
  sharp: 0.25,
  width: 1,
  glow: 4,
  strike: 0.3,
  intensity: 0,
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

const smooth = (low: number, high: number, value: number) => {
  const at = clamp((value - low) / (high - low), 0, 1)
  return at * at * (3 - 2 * at)
}

/** The knobs a study resolved, clamped to their ranges; a missing or non-finite one takes its fallback. */
export function cymaticsParams(knobs: Readonly<Partial<Record<string, number>>>): CymaticsParams {
  const out: CymaticsParams = { ...FALLBACK }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = CYMATICS_RANGES[knob]
    out[knob] = clamp(
      value !== undefined && Number.isFinite(value) ? value : FALLBACK[knob],
      low,
      high,
    )
  }

  return out
}

/** How strongly a pitch class rings, 0 to 1. */
export const noteAmplitude = (params: CymaticsParams, note: number): number =>
  params[`mode${note}` as CymaticsKnob]

/** The strongest note ringing. */
export function loudestNote(params: CymaticsParams): number {
  let loudest = 0
  for (let note = 0; note < NOTES; note += 1)
    loudest = Math.max(loudest, noteAmplitude(params, note))
  return loudest
}

/** Whether anything is drawn this frame: some light in the intensity and some note ringing. */
export const cymaticsLit = (params: CymaticsParams): boolean =>
  params.intensity > 0 && loudestNote(params) >= MODE_MIN

/** How much of its light the figure is drawn at: a chord dying away goes out as a dimming. */
export const vigour = (params: CymaticsParams): number =>
  smooth(FADE_FROM, FULL_AT, loudestNote(params))

/**
 * How far the plate still has to travel to the notes that are sounding now: the
 * sum over the twelve of how far each mode is from its note's own row in the
 * packet. The modes follow the rows through an envelope, so this is 0 while a
 * chord is held and about the number of notes in it, twice over, in the instant
 * one chord gives way to another. It is read from the packet and the knobs and
 * from nothing that remembers, so it is the same at any frame rate.
 */
export function unsettled(params: CymaticsParams, features: Float32Array): number {
  let gap = 0
  for (let note = 0; note < NOTES; note += 1)
    gap += Math.abs((features[CHROMA_ROW + note] ?? 0) - noteAmplitude(params, note))
  return gap
}

/**
 * What the lines are drawn at while the plate is still catching up, as a share
 * of full light: sand that has not settled is not gathered, and a line that
 * sweeps across the plate at full light leaves a full light sheet behind it on
 * a canvas that keeps 0.975 of itself. Dimmed, the ghost of the last chord is
 * faint and the new figure lights as it lands, which is what the change reads
 * as. It never goes out: the sweep is seen.
 */
export const SETTLED_FLOOR = 0.3
export const SETTLED_SCALE = 2.5
export const settledLight = (gap: number): number =>
  SETTLED_FLOOR + (1 - SETTLED_FLOOR) / (1 + (gap / SETTLED_SCALE) ** 2)

/** Pixels on this canvas for something written at the reference height. */
export const platePixels = (value: number, width: number, height: number) =>
  value * (Math.min(width, height) / REFERENCE_HEIGHT)

/** The plate's side in pixels. */
export const plateSide = (width: number, height: number) => PLATE * Math.min(width, height)

/**
 * A line's half width in device pixels: `width` at rest, wider the harder the
 * plate has been struck, and thinned by the sharpness. A struck plate throws
 * its sand about, so the line is fat for a moment and settles as the spring
 * does. It is not scaled by the canvas: a line is a pixel or two wide on any
 * canvas because what it is anti-aliased against is the device's own pixels,
 * and a line that grew with the canvas would be four wide at 4K and no longer a
 * line. The glow is the light spreading and is a share of the picture, so that
 * one does scale.
 */
export const lineWidth = (params: CymaticsParams): number =>
  params.width * (0.75 + 1.1 * params.strike) * (1 - 0.5 * params.sharp)

/** The glow's width in pixels, under the same three things. */
export const glowWidth = (params: CymaticsParams, width: number, height: number): number =>
  platePixels(params.glow * (0.6 + 0.8 * params.strike) * (1 - 0.65 * params.sharp), width, height)

/** One mode of the plate. */
export type Mode = {
  n: number
  m: number
  /** How strongly it rings. */
  amplitude: number
  /** How it mixes with its transpose, `+1` or `-1`. */
  sign: number
}

/** The twenty-four modes for this frame: twelve notes, then their partners. */
export function modesFor(params: CymaticsParams): Mode[] {
  const out: Mode[] = []
  for (let note = 0; note < NOTES; note += 1) {
    const [n, m] = BASE_PAIRS[note] ?? [1, 2]
    out.push({ n, m, amplitude: noteAmplitude(params, note), sign: SIGNS[note] ?? 1 })
  }

  for (let note = 0; note < NOTES; note += 1) {
    const [n, m] = PARTNER_PAIRS[note] ?? [3, 6]
    out.push({
      n,
      m,
      amplitude: noteAmplitude(params, note) * params.layer * PARTNER_GAIN,
      sign: partnerSign(note),
    })
  }

  return out
}

/**
 * The plate's displacement at a point of the plate, `x` and `y` running 0 to 1
 * across it, and its gradient in the same units. The sum of every ringing mode
 * of `cos(n pi x) cos(m pi y) + sign cos(m pi x) cos(n pi y)`.
 */
export function plateAt(modes: readonly Mode[], x: number, y: number) {
  let f = 0
  let gx = 0
  let gy = 0
  for (const { n, m, amplitude, sign } of modes) {
    if (amplitude <= 0) continue
    const cnx = Math.cos(n * Math.PI * x)
    const cmx = Math.cos(m * Math.PI * x)
    const cny = Math.cos(n * Math.PI * y)
    const cmy = Math.cos(m * Math.PI * y)
    f += amplitude * (cnx * cmy + sign * cmx * cny)
    gx +=
      amplitude *
      -Math.PI *
      (n * Math.sin(n * Math.PI * x) * cmy + sign * m * Math.sin(m * Math.PI * x) * cny)
    gy +=
      amplitude *
      -Math.PI *
      (m * cnx * Math.sin(m * Math.PI * y) + sign * n * cmx * Math.sin(n * Math.PI * y))
  }

  return { f, gx, gy }
}

/**
 * How far a point is from the nearest nodal line, in pixels: the sum over the
 * length of its own gradient, which is exact on the line and a good estimate
 * within a few pixels of it. This is what the shader computes with the
 * screen-space derivatives.
 */
export function nodalDistance(
  modes: readonly Mode[],
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const side = plateSide(width, height)
  const u = (x - width / 2) / side + 0.5
  const v = (y - height / 2) / side + 0.5
  const { f, gx, gy } = plateAt(modes, u, v)
  const gradient = Math.hypot(gx, gy) / side
  return Math.abs(f) / Math.max(gradient, 1e-9)
}

/**
 * The light of the line at a distance from the nodal set, before the colour
 * and the intensity: the core, a thin line with a one pixel feather so it
 * covers what it covers of each pixel and no more, and the glow. The two are
 * kept apart because the colour treats them differently. This is the shader's
 * `line`.
 */
export function lineProfile(distance: number, half: number, glow: number) {
  const core = 1 - smooth(half - 0.5, half + 0.5, distance)
  const halo = GLOW_GAIN * Math.exp(-distance / Math.max(glow, 0.5))
  return { core, halo }
}

/**
 * The plate's light at a pixel: the core and the glow, times the intensity and
 * the fade, and nothing outside the plate. The sum, and so the line, is the
 * same at every level; only `vigour` and the widths know how loud it is.
 */
export function cymaticsAt(
  x: number,
  y: number,
  params: CymaticsParams,
  width: number,
  height: number,
): number {
  if (!cymaticsLit(params)) return 0
  const side = plateSide(width, height)
  const inside = Math.min(
    x - (width - side) / 2,
    (width + side) / 2 - x,
    y - (height - side) / 2,
    (height + side) / 2 - y,
  )
  if (inside <= 0) return 0
  const modes = modesFor(params)
  const distance = nodalDistance(modes, x, y, width, height)
  const { core, halo } = lineProfile(distance, lineWidth(params), glowWidth(params, width, height))
  return (core + halo) * params.intensity * vigour(params) * smooth(0, 1, inside)
}

/** A pixel counts as lit, for coverage, when its light passes this: a twentieth of the core. */
export const LIT_THRESHOLD = 0.05

/**
 * The share of a frame the figure lights, on a canvas this shape: the pixels
 * brighter than `LIT_THRESHOLD` counted on a grid. Nothing outside the plate
 * is lit, so a frame that is wide or tall has less of it than a square one.
 */
export function cymaticsCoverage(
  params: CymaticsParams,
  canvasWidth: number,
  canvasHeight: number,
  rows = 270,
): number {
  if (!cymaticsLit(params)) return 0
  const columns = Math.round((rows * canvasWidth) / canvasHeight)
  // The grid samples the canvas and does not shrink it: a line is a pixel or
  // two wide, and one drawn on a grid of a few hundred rows would be a feather
  // wider than the line. Every sample is a point of the real canvas, with the
  // real widths, and the share of them that are lit is the share of the frame.
  const modes = modesFor(params)
  const side = plateSide(canvasWidth, canvasHeight)
  const half = lineWidth(params)
  const glow = glowWidth(params, canvasWidth, canvasHeight)
  const fade = vigour(params) * params.intensity
  let lit = 0
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      const x = ((column + 0.5) * canvasWidth) / columns
      const y = ((row + 0.5) * canvasHeight) / rows
      if (Math.abs(x - canvasWidth / 2) > side / 2 || Math.abs(y - canvasHeight / 2) > side / 2)
        continue
      const distance = nodalDistance(modes, x, y, canvasWidth, canvasHeight)
      const { core, halo } = lineProfile(distance, half, glow)
      if ((core + halo) * fade > LIT_THRESHOLD) lit += 1
    }

  return lit / (columns * rows)
}

/**
 * A fully saturated hue, brightest channel at 1: three cosines a third of a
 * turn apart. It is `vivid` in the shader, done here so the twelve notes'
 * colours can go into the uniform as they are. The shared palette is one
 * colour at a time and a chord is not.
 */
export function vividColour(turns: number): [number, number, number] {
  const c = [0, 1, 2].map((at) => 0.5 + 0.5 * Math.cos(2 * Math.PI * (turns + at / 3)))
  const sat = c.map((value) => value * value)
  const peak = Math.max(...sat, 1e-4)
  return [(sat[0] ?? 0) / peak, (sat[1] ?? 0) / peak, (sat[2] ?? 0) / peak]
}

/**
 * A note's colour: its place on the circle of fifths as a place on the wheel,
 * turned by the key, so notes that sound well together are neighbours in
 * colour and a modulation is the whole wheel moving. The key is where the song
 * sits on the same circle, so the dominant note's colour follows `keyHue`.
 */
export const noteHue = (note: number, keyHue: number) => fifthsPlace(note) / NOTES + keyHue

/**
 * The uniform the shader reads, in floats:
 *
 *   0 to 3      canvas width and height in pixels, the plate's side in pixels, a pad
 *   4 to 7      the line's half width, the glow's width in pixels, the glow's gain, the intensity
 *   8 to 11     the fade (the level and how settled the plate is), then three pads
 *   12 to 15    a pad, so the modes start on a 64 byte boundary
 *   16 to 63    the twelve notes' modes, four floats each: n, m, amplitude, sign
 *   64 to 111   the twelve partners, in the same four
 *   112 to 159  the twelve notes' colours, four floats each: red, green, blue and a pad
 *
 * A partner takes the colour of the note it belongs to, so it has no slot of
 * its own.
 */
export function writeCymaticsUniform(
  params: CymaticsParams,
  features: Float32Array,
  width: number,
  height: number,
  out: Float32Array,
): Float32Array {
  const key = features[F.keyHue] ?? 0
  out.fill(0)
  out[0] = width
  out[1] = height
  out[2] = plateSide(width, height)
  out[4] = lineWidth(params)
  out[5] = glowWidth(params, width, height)
  out[6] = GLOW_GAIN
  out[7] = params.intensity
  out[8] = vigour(params) * settledLight(unsettled(params, features))
  modesFor(params).forEach((mode, at) => {
    const slot = 16 + 4 * at
    out[slot] = mode.n
    out[slot + 1] = mode.m
    out[slot + 2] = mode.amplitude
    out[slot + 3] = mode.sign
  })

  for (let note = 0; note < NOTES; note += 1) {
    const [red, green, blue] = vividColour(noteHue(note, key))
    const slot = 112 + 4 * note
    out[slot] = red
    out[slot + 1] = green
    out[slot + 2] = blue
  }

  return out
}
