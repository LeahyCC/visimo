/**
 * The black hole ink's numbers: where the disc, the ring and the bending
 * annulus sit, how much light the ring carries, how far the annulus reaches
 * back into last frame's canvas and how much of what it reads it puts back.
 * Pure TypeScript with no GPU objects, the way `halo.params.ts` is, so every
 * choice here is unit tested and `BlackHoleInk.ts` is left moving data into a
 * buffer.
 *
 * Three rings of radius, all in fractions of the canvas's SHORT side, so the
 * picture is round and the same size on a wide canvas and a tall one:
 *
 * ```text
 *   0        disc        ring        bend0                 outer
 *   |---------|===========|===========|---------------------|
 *    nothing    the burning ring        the bending annulus   nothing
 *    is drawn   (2 x width across)      (reads last frame)    is drawn
 * ```
 *
 * **The middle is empty and not black.** Inks only add light, so an ink
 * cannot paint anything darker than what is under it. What makes the middle
 * dark here is that nothing draws there and the `lens` term of the analytic
 * flow carries away what lands (see `analytic.params.ts`). A disc painted
 * actually black waits for `subtract-blend`, the darkening blend the
 * catalogue lists, which has no card yet.
 *
 * **The annulus is a loop, and this is where it is kept safe.** It reads last
 * frame's canvas, which already holds everything this ink drew a frame ago.
 * Two rules make it provably bounded rather than a feedback runaway:
 *
 * 1. **The read always comes from further out.** A pixel at radius `x` samples
 *    `x + shift(x)` with `shift` strictly positive wherever the gain is, so
 *    light only ever marches inward and the chain leaves the annulus in a few
 *    hops. There is no radius that reads itself, which is the only way a loop
 *    with a keep this near 1 could stand up.
 * 2. **The gain is a share of what the canvas lets go of.** The director's
 *    canvas keeps `CANVAS_KEEP` per reference frame, so a mark that stands
 *    still sums to about forty times what one frame adds; a fixed per-frame
 *    gain of even a tenth would therefore settle at four times what it read.
 *    The gain here is `bend x (1 - keep ^ frames)` instead, which makes `bend`
 *    the share of the canvas's own loss the annulus puts back, the same at
 *    every frame rate, and bounds the settled annulus at `bend` times the
 *    picture it reads:
 *
 *    ```text
 *    settled:  H(x) (1 - keep) = gain x H(x + shift)
 *              gain = bend x (1 - keep)
 *              H(x) = bend x H(x + shift)      with bend < 1
 *    ```
 *
 *    So each hop inward is dimmer than the last and the annulus can never be
 *    brighter than the surround it is bending. `blackHoleLoop` runs that
 *    forward on a radial profile and `blackhole.params.test.ts` holds it.
 *
 * The ring's own light is the usual ink budget and is not part of that loop:
 * it is a thin fresh mark the canvas then carries, and the disc radius and
 * the beamed side both move with the music, so it smears rather than standing
 * and summing. Its core rests above 1 so the bloom catches it.
 */
import { REFERENCE_FPS } from '../post/params'
import type { BlackHoleKnob } from '../studies/impls'

/** Floats in the uniform; the `Params` struct in blackhole.wgsl matches. */
export const BLACKHOLE_UNIFORM_FLOATS = 20

/**
 * What the director's canvas keeps of itself per reference frame
 * (`feedback.amount` times `feedback.decay` in `studies/cast.ts`). The gain
 * below is worked out against it, so if that canvas changes this number is
 * the one place this ink has to follow it, and the test that reads it back
 * from the cast is what says so.
 */
export const CANVAS_KEEP = 0.975

/** The longest step the gain is worked out over, as the post stack clamps. */
const MAX_STEP = 0.25

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/**
 * What the canvas lets go of over one real step, 0 to 1. At 60 frames a
 * second it is 0.025 and at 144 it is 0.0105, which is exactly why the gain
 * cannot be a fixed number per frame: the same knob would feed four times as
 * hard on a fast display as the canvas was losing.
 */
export function canvasLoss(dt: number): number {
  const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_STEP) : 1 / REFERENCE_FPS
  return 1 - Math.pow(CANVAS_KEEP, step * REFERENCE_FPS)
}

/**
 * How far out the annulus reaches for what it draws, as a fraction of the
 * outer radius, at the inner edge where the window is widest. It is large on
 * purpose: a big step is both a visible bend and a short chain, two or three
 * hops from the inner edge to the rim, so the settled annulus is `bend`
 * squared or cubed of the surround rather than `bend` to the twelfth.
 */
export const BEND_SHIFT = 0.45

/**
 * How far the annulus tints what it read toward the cooler of the study's two
 * hues. The picture is what is bending, so the tint is a wash and not a
 * recolour: enough that the lensed halo reads cool against the hot ring, not
 * enough to lose what is being bent.
 */
export const BEND_TINT = 0.35

/**
 * The hot hue in turns, at a key of 0 and no offset. Amber on the shader's
 * cosine wheel, which is the colour every photograph and render of one has:
 * the Event Horizon Telescope's ring, Gargantua's disc, an offline render of
 * gas at a few thousand kelvin. The cooler hue is a third of a turn on, which
 * lands in the blue-white the lensed sky behind it reads as.
 */
export const BLACKHOLE_CORE_HUE = 0.07

/** How far round the wheel the outer hue is from the core's, in turns. */
export const BLACKHOLE_HUE_GAP = 1 / 3

/**
 * What each knob may reach, inclusive. `blackHoleParams` clamps to these, and
 * the study's own rows are written so that nothing it can resolve reaches the
 * clamp: the range is the implementation's floor under a host's override and
 * not the study's working room.
 *
 * Every one of them is non-negative, including the two that could have been
 * signed. `hue` is turns and wraps at the cosine wheel rather than running
 * either way from the key, and `spin` is an angle a row integrates. That is
 * what lets the registry guard hold the whole ink to its own default range of
 * "nothing goes negative" with no table of its own to keep in step.
 */
export const BLACKHOLE_RANGES: Record<BlackHoleKnob, readonly [number, number]> = {
  // The dark middle's radius, a fraction of the short side. At 0 there is no
  // hole and the ring collapses onto the centre, so nothing is drawn.
  disc: [0, 0.13],
  // Half the burning ring's thickness, in the same units. It sits directly on
  // the disc's rim, so the ring runs from `disc` to `disc + 2 x width`.
  width: [0, 0.022],
  // How far the bending annulus reaches beyond the ring's outer edge.
  annulus: [0, 0.1],
  // How hard the ring burns, as a multiple of the intensity. The low end is
  // what drives it, which is what makes the bass the thing that is burning.
  heat: [0, 2],
  // How much brighter the approaching side of the ring is than the receding
  // one. At 0.9 the near side is nearly twice the mean and the far side a
  // tenth of it, which is about what an offline render shows.
  beam: [0, 0.9],
  // The share of what the canvas lets go of each frame that the annulus puts
  // back. Under 1, so the settled annulus is always dimmer than what it read.
  bend: [0, 0.8],
  // The ink's own light, and its gate: at 0 nothing is drawn at all, which is
  // what a silent packet resolves to.
  intensity: [0, 2],
  // Turns added to the key, for both hues together. It wraps, so the whole
  // range is a colour and none of it is a mistake.
  hue: [0, 1],
  // Where the beamed side of the ring is, in turns. Only an integrating row
  // can move it, since everything else here is a size or a level.
  spin: [0, 1],
}

export type BlackHoleParams = Record<BlackHoleKnob, number>

const KNOBS = Object.keys(BLACKHOLE_RANGES) as BlackHoleKnob[]

/**
 * What a knob a study did not resolve falls to. Everything that draws falls
 * to nothing, so an implementation handed an empty tuning draws an empty
 * frame rather than a picture nobody asked for.
 */
const FALLBACK: BlackHoleParams = {
  disc: 0,
  width: 0,
  annulus: 0,
  heat: 0,
  beam: 0,
  bend: 0,
  intensity: 0,
  hue: 0,
  spin: 0,
}

/** The knobs a study resolved, clamped; a missing or non-finite one takes its fallback. */
export function blackHoleParams(knobs: Readonly<Partial<Record<string, number>>>): BlackHoleParams {
  const out: BlackHoleParams = { ...FALLBACK }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = BLACKHOLE_RANGES[knob]
    out[knob] = clamp(
      value !== undefined && Number.isFinite(value) ? value : FALLBACK[knob],
      low,
      high,
    )
  }

  return out
}

/** The three radii and the quad's, all fractions of the short side. */
export type BlackHoleGeometry = {
  /** Where the dark middle ends and the ring begins. */
  disc: number
  /** The middle of the burning ring. */
  ring: number
  /** Half the ring's thickness; its light is exactly 0 this far from `ring`. */
  half: number
  /** Where the ring ends and the bending annulus begins. */
  bend0: number
  /** Where the annulus ends. The ink draws nothing at all past it. */
  outer: number
}

export function blackHoleGeometry(params: BlackHoleParams): BlackHoleGeometry {
  const half = params.width
  return {
    disc: params.disc,
    ring: params.disc + half,
    half,
    bend0: params.disc + 2 * half,
    outer: params.disc + 2 * half + params.annulus,
  }
}

/**
 * Whether anything is drawn this frame. No light or no outer radius means no
 * pass and no upload, and so does a ring with no heat under an annulus with
 * no bend, which is an ink that would draw an empty quad. The intensity is
 * what `energy` gates from 0, so a silent packet lands here.
 */
export function blackHoleLit(params: BlackHoleParams): boolean {
  const { outer, disc } = blackHoleGeometry(params)
  return params.intensity > 0 && outer > disc && (params.heat > 0 || params.bend > 0)
}

/**
 * The gain the annulus reads last frame's canvas at, per real frame. It is
 * the share `bend` of what the canvas lets go of over the same step, so the
 * loop is the same at any frame rate, and it is gated by the intensity so a
 * silent packet reads nothing at all. Never at or above 1 and, at the rates
 * anything runs at, two orders under it.
 */
export function bendGain(params: BlackHoleParams, dt: number): number {
  return params.bend * canvasLoss(dt) * Math.min(params.intensity, 1)
}

/**
 * The annulus's window, 1 at the ring's outer edge and 0 at the outer radius
 * with no slope, where `x` is a radius as a fraction of `outer`. The gain and
 * the displacement are BOTH this window times a constant, which is the whole
 * of rule 1 in the header: wherever the ink reads anything it reads something
 * strictly further out, so no radius can feed itself.
 */
export function bendWindow(x: number, geometry: BlackHoleGeometry): number {
  const { bend0, outer } = geometry
  if (!(outer > bend0)) return 0
  const u = clamp((outer - x * outer) / (outer - bend0), 0, 1)
  return u * u * (3 - 2 * u)
}

/** How far out the annulus reads at this radius, as a fraction of `outer`. */
export const bendShift = (x: number, geometry: BlackHoleGeometry): number =>
  BEND_SHIFT * bendWindow(x, geometry)

/**
 * The ring's light across itself, 0 to 1, where `x` is a radius as a fraction
 * of `outer`. Exactly 0 at and past `half` from the ring's middle, which is
 * what lets the annulus start there with no overlap and keeps the coverage
 * honest. The square at the end pulls the light into a narrow core with the
 * shoulders left to carry the colour, which is the visual bar's rule: white
 * only at the very centre, colour in the glow around it.
 */
export function ringLight(x: number, geometry: BlackHoleGeometry): number {
  const { ring, half, outer } = geometry
  if (!(outer > 0) || !(half > 0)) return 0
  const q = Math.abs(x * outer - ring) / half
  const t = clamp(1 - q, 0, 1)
  const smooth = t * t * (3 - 2 * t)
  return smooth * smooth
}

/**
 * The most light the ring's core adds on one frame, before the canvas carries
 * any of it: the intensity, the heat and the beamed side together. It rests
 * over 1 on purpose, so the bloom's threshold catches the core.
 */
export const ringPeak = (params: BlackHoleParams): number =>
  params.intensity * params.heat * (1 + params.beam)

/** A pixel counts as lit, for coverage, when it is over this share of the ring's peak. */
export const LIT_THRESHOLD = 0.05

/**
 * The share of the frame the ink can light on a canvas this shape: every
 * pixel between the disc's rim and the outer radius, since the annulus draws
 * whatever the picture under it is worth and the worst case is a picture that
 * is bright everywhere. It is the ink's own coverage and not the canvas's,
 * which the trails then smear.
 *
 * It is the area between two circles and could be arithmetic, but a circle
 * clipped by the frame's edges is not, and the whole point of the number is
 * the widest the mapping reaches on a canvas that may be square or tall. So
 * it is counted on a grid, as the halo's is.
 */
export function blackHoleCoverage(params: BlackHoleParams, aspect = 16 / 9, rows = 120): number {
  const geometry = blackHoleGeometry(params)
  if (!blackHoleLit(params)) return 0
  const columns = Math.max(Math.round(rows * aspect), 1)
  const short = Math.min(columns, rows)
  let lit = 0
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      const dx = column + 0.5 - columns / 2
      const dy = row + 0.5 - rows / 2
      const radius = Math.hypot(dx, dy) / short
      if (radius >= geometry.disc && radius <= geometry.outer) lit += 1
    }

  return lit / (columns * rows)
}

/**
 * The loop run forward on a radial profile, which is what says the annulus
 * cannot feed itself to white. One sample per step of radius from the middle
 * to the outer edge, and past it the surround, which is pinned at `seed`: a
 * picture that is bright everywhere, for ever, feeding the bend. Each frame
 * is exactly what the pass order does, the canvas keeping what it had and the
 * ink adding its gain times what it read a step further out.
 *
 * Returns the profile it settles to, in units of the surround. Nothing in it
 * may exceed 1: the bound the header argues for.
 */
export function blackHoleLoop(
  params: BlackHoleParams,
  dt: number,
  frames = 600,
  seed = 1,
  samples = 256,
): Float64Array {
  const geometry = blackHoleGeometry(params)
  const keep = 1 - canvasLoss(dt)
  const gain = bendGain(params, dt)
  let now = new Float64Array(samples).fill(seed)
  let next = new Float64Array(samples)
  const at = (profile: Float64Array, x: number): number => {
    // Past the outer edge is the surround, which the worst case holds bright.
    if (x >= 1) return seed
    const place = clamp(x, 0, 1) * (samples - 1)
    const low = Math.floor(place)
    const high = Math.min(low + 1, samples - 1)
    const mix = place - low
    return (profile[low] ?? 0) * (1 - mix) + (profile[high] ?? 0) * mix
  }

  for (let frame = 0; frame < frames; frame += 1) {
    for (let sample = 0; sample < samples; sample += 1) {
      const x = sample / (samples - 1)
      const window = bendWindow(x, geometry)
      next[sample] = keep * (now[sample] ?? 0) + gain * window * at(now, x + bendShift(x, geometry))
    }

    const swap = now
    now = next
    next = swap
  }

  return now
}

/**
 * The uniform the shader reads, in floats:
 *
 *   0 to 3    canvas width and height in pixels, the outer radius in pixels, a pad
 *   4 to 7    the disc, the ring and its half width, and where the annulus starts,
 *             each as a fraction of the outer radius
 *   8 to 11   the ring's light, how beamed it is, where the beamed side points
 *             in turns, a pad
 *   12 to 15  the annulus's gain, how far it reaches out, how far it tints, a pad
 *   16 to 19  the hot hue and the cooler one in turns, two pads
 *
 * The hues are the study's own and not the shared palette's, as the lasers'
 * and the grid's are: `vivid` in the shader turns a number of turns into a
 * fully saturated colour, and the key moves both of them together.
 */
export function writeBlackHoleUniform(
  params: BlackHoleParams,
  keyHue: number,
  dt: number,
  width: number,
  height: number,
  out: Float32Array,
): Float32Array {
  const geometry = blackHoleGeometry(params)
  const short = Math.min(width, height)
  const outer = Math.max(geometry.outer, 1e-6)
  out[0] = width
  out[1] = height
  out[2] = outer * short
  out[3] = 0

  out[4] = geometry.disc / outer
  out[5] = geometry.ring / outer
  out[6] = geometry.half / outer
  out[7] = geometry.bend0 / outer

  out[8] = params.intensity * params.heat
  out[9] = params.beam
  out[10] = params.spin
  out[11] = 0

  out[12] = bendGain(params, dt)
  out[13] = BEND_SHIFT
  out[14] = BEND_TINT
  out[15] = 0

  const core = keyHue + BLACKHOLE_CORE_HUE + params.hue
  out[16] = core
  out[17] = core + BLACKHOLE_HUE_GAP
  out[18] = 0
  out[19] = 0
  return out
}
