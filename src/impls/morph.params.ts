/**
 * The shape morph's numbers: which solid is on screen, how far it has melted
 * into the next one, how big it breathes, how bright its two lights are and
 * where its brightness is cut. Pure TypeScript with no GPU objects, the way
 * `lasers.params.ts` is, so every decision about what the picture looks like
 * is unit tested and `MorphInk.ts` is left moving data into a buffer.
 *
 * **The forms are the song's structure.** A section is a form: the id in the
 * packet's `section` row is hashed into one of the six primitives the raymarch
 * kit offers, so the same track gives the same run of solids every time it is
 * played, and a run never draws the same form twice in a row. A section
 * boundary starts a melt from the form that was showing into the new one over
 * `MELT_SECONDS`, by mixing the two distance fields, which reads as one solid
 * flowing into another rather than as a dissolve between two pictures. The one
 * thing that is not a melt is `impact`: a drop cuts, on the frame, because
 * that is the moment the handoff says must not be smoothed away.
 *
 * **Nothing is added up per frame except the melt**, which is advanced by the
 * real `dt` over a span in seconds, so 60 and 144 frames a second show the
 * same solid at the same moment of the song. The turning is not kept here at
 * all: it is two `integrate` rows in the study's mapping, which the resolver
 * steps, so what this file is handed is already an angle.
 *
 * **The light is the study.** A solid drawn in one flat colour is a blob, so
 * there are two lights in two hues a third of a turn apart in the palette, a
 * fresnel edge that glows, a specular that passes 1 on purpose so the bloom
 * catches it, and nothing at all on a face that points away: the black is what
 * makes the form read. The numbers the shader lights with are here, because
 * the brightness threshold has to be measured against them.
 */
import { F } from '../audio/FeatureExtractor'
import { peakPaletteAt, RIBBON_TINT } from '../post/params'

/** Floats in the uniform; the shader's `Params` struct reads them in this order. */
export const MORPH_UNIFORM_FLOATS = 28

/** The forms a section may be given, in the order the shader's switch reads them. */
export const FORMS = ['sphere', 'rounded-box', 'octahedron', 'torus', 'capsule', 'box'] as const
export type Form = (typeof FORMS)[number]

/** How long a melt from one form into the next takes, in seconds. */
export const MELT_SECONDS = 2.2

/**
 * Where `impact` fires and rearms, the same two numbers the director and the
 * shards read it with, so one drop is one cut however long the row takes to
 * fall.
 */
const IMPACT_ON = 0.5
const IMPACT_OFF = 0.3

/**
 * The energy under which nothing is drawn at all, and where the light has
 * ramped fully in. A silent packet has to be black, and a hard edge at the
 * floor would pop the solid into existence on the first sound, so the ramp
 * between the two carries it in over a tenth of the scale.
 */
export const SILENT_FLOOR = 0.004
export const SILENT_FULL = 0.045

/**
 * The camera: where it stands, what it looks at, and how wide it sees. It does
 * not move, on purpose. The solid turns, melts and breathes, and a camera
 * moving as well is two motions fighting over the same frame; every raymarched
 * scene that reads as an object rather than as a texture keeps the object
 * turning and the camera still.
 */
export const EYE: readonly [number, number, number] = [0, 0, -3.8]
export const LOOK: readonly [number, number, number] = [0, 0, 0]
/**
 * The field of view in radians, across the short side of the canvas, which is
 * how the kit's camera reads it. A normal lens: 57 degrees.
 */
export const FOV = 1.0

/**
 * Half of what the camera sees across the short side, in world units, which is
 * what turns a size in world units into a share of the frame. The camera is
 * still, so it is a constant and the coverage below is arithmetic rather than
 * a raster.
 */
export const HALF_VIEW =
  Math.hypot(EYE[0] - LOOK[0], EYE[1] - LOOK[1], EYE[2] - LOOK[2]) * Math.tan(FOV * 0.5)

/**
 * The last multiply on the shader's colour, and the number the threshold is
 * measured against with it. Over 1 because the canvas is half float and the
 * bloom needs something above its own threshold to make a highlight glow.
 */
export const MORPH_LIGHT = 2.0

/** The rim's light at a `rim` of 0, so the edge never goes out entirely. */
export const RIM_BASE = 0.55

/**
 * How much of the rim light a surface square to the camera keeps, the rest
 * gathering at the silhouette. A pure fresnel rim is nothing at all on a
 * faceted form, because a facet's normal does not change across it, so the
 * floor is what draws the back planes of a box or an octahedron in the second
 * hue while a sphere still gets an edge that glows.
 */
export const RIM_FLOOR = 0.3

/** How far the specular is pulled to white. A highlight is the light, not the paint. */
export const SPECULAR_WHITE = 0.65

/**
 * How far round the palette the rim light sits from the key light. A third of
 * a turn is the gap a two-gel studio setup uses: far enough that the edge
 * reads as a second light and not as the same one, near enough that the two
 * still look like one scene. The palette is a ring, so this holds whatever
 * palette the look chose and wherever the key has turned it.
 */
export const RIM_TURN = 1 / 3

/**
 * Where a `glint` of 1 cuts, as a share of the brightest the ink can be this
 * frame (`morphPeak`).
 *
 * The peak counts the specular and both rim lights on top of a lit face, so a
 * face square to the key light sits near a quarter of it. That is the number
 * this is set against: at the study's resting `glint` of 0.4 the cut lands at
 * 0.14 of the peak, which is under a lit face and over the fill, so the
 * terminator survives as a gradient and the near-black half of the solid never
 * reaches the canvas; at the 0.8 a full packet resolves it lands at 0.28,
 * above a lit face, and what is left is the rim, the specular and the
 * brightest facets. The loudest moment is the one with the most black in it,
 * which is the whole point of a threshold on a canvas that remembers.
 *
 * It was set by looking, on the adapter, at the study soloed in the bench over
 * a quiet passage, a build and a drop. At a twentieth of this the lit half of
 * the solid summed into a flat white disc inside a second, which is Melt's
 * fault in miniature; at three times it there was nothing on screen but a
 * highlight.
 */
export const MORPH_CUT = 0.35

/**
 * Where the knob stops being a threshold, the same reasoning the fractal's
 * `GLINT_OFF` carries: a cast that takes the study's rows back off lands here
 * rather than exactly on zero, because two gains added and subtracted leave
 * the last bit behind.
 */
const GLINT_OFF = 1e-4

/**
 * How much displacement the march can still bound: the most the ripple's
 * amplitude times its frequency may be.
 *
 * A displaced field is no longer a distance. The ripple is a product of sines,
 * so its steepest slope is about its amplitude times its frequency times the
 * root of three, and a field with a slope of `g` is only Lipschitz at `1 + g`,
 * so a step of the whole reported distance walks through the surface and the
 * solid fills with holes that crawl as it turns. `MARCH_SAFETY` takes 0.55 of
 * each step, which covers a slope up to 0.82, and this ceiling keeps the slope
 * at 0.66 with the root of three in it. It is why the amplitude is held
 * against the frequency and not on its own: a fine ripple has to be shallow.
 */
export const RIPPLE_CEILING = 0.38

/** The share of the reported distance one march step takes; see `rmMarch`. */
export const MARCH_SAFETY = 0.55

/**
 * The most steps one ray may take, and what a software rasteriser is given
 * instead. The solid is small in the frame and bounded, so most rays leave
 * through the far plane after a handful; the budget is what a ray grazing the
 * silhouette spends, and that is the one that shows when it runs out.
 */
export const MARCH_STEPS = 96
export const SOFTWARE_STEPS = 40

/** The step budget for this adapter. */
export const morphSteps = (software: boolean) => (software ? SOFTWARE_STEPS : MARCH_STEPS)

export const MORPH_KNOB_LIST = [
  'size',
  'ripple',
  'rippleScale',
  'spin',
  'tumble',
  'rim',
  'specular',
  'hue',
  'intensity',
  'glint',
  'glintKnee',
] as const
export type MorphKnob = (typeof MORPH_KNOB_LIST)[number]
export type MorphParams = Record<MorphKnob, number>

/**
 * What each knob may reach, inclusive. The params clamp to them, so a cast
 * that adds rows of its own cannot march a solid bigger than the frame or ask
 * for a displacement the march cannot bound.
 */
export const MORPH_RANGES: Record<MorphKnob, readonly [number, number]> = {
  // The solid's bounding radius in world units. Every form is written to about
  // this radius, so a melt does not change how much of the frame is filled.
  size: [0.1, 0.9],
  // The ripple's amplitude in world units, before the ceiling above holds it.
  ripple: [0, 0.12],
  // Its spatial frequency: waves across a world unit.
  rippleScale: [2, 14],
  // Turns about the vertical and the horizontal axis. Two `integrate` rows
  // each wrap at 1, so the pair can reach 2 and the shader takes the fraction.
  spin: [0, 2],
  tumble: [0, 2],
  // The rim light's strength above `RIM_BASE`, and how wide the edge it lights
  // is: the two move together, so a loud passage gets a broader, stronger edge.
  rim: [0, 1.2],
  // The specular's strength. Past 1 deliberately: see `MORPH_LIGHT`.
  specular: [0, 3],
  // Palette turns added to the key, as every other ink's offset is.
  hue: [-1, 2],
  // The last multiply on the colour, before `MORPH_LIGHT`.
  intensity: [0, 2],
  // The share of the frame's own brightest that light must clear to be drawn.
  glint: [0, 1],
  // How soft that edge is, as a share of the level.
  glintKnee: [0.05, 1],
}

/**
 * What a knob a study did not resolve falls to. The light falls to nothing, so
 * an implementation handed no knobs at all draws nothing rather than a solid
 * nobody asked for.
 */
const FALLBACK: MorphParams = {
  size: 0.5,
  ripple: 0,
  rippleScale: 9,
  spin: 0,
  tumble: 0,
  rim: 0.35,
  specular: 1.4,
  hue: 0,
  intensity: 0,
  glint: 0.35,
  glintKnee: 0.45,
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/**
 * The knobs a study resolved, clamped to their ranges; a missing or non-finite
 * one takes its fallback. The ripple is held to what the march can bound, so
 * the two knobs that make it cannot be set to a pair that tears the surface.
 */
export function morphParams(knobs: Readonly<Partial<Record<string, number>>>): MorphParams {
  const out: MorphParams = { ...FALLBACK }
  for (const knob of MORPH_KNOB_LIST) {
    const value = knobs[knob]
    const [low, high] = MORPH_RANGES[knob]
    out[knob] = clamp(
      value !== undefined && Number.isFinite(value) ? value : FALLBACK[knob],
      low,
      high,
    )
  }

  out.ripple = Math.min(out.ripple, RIPPLE_CEILING / Math.max(out.rippleScale, 1e-3))
  return out
}

/** The energy the packet is carrying, which is the ink's gate. */
const energyOf = (features: Float32Array) => {
  const energy = features[F.energy] ?? 0
  return Number.isFinite(energy) ? energy : 0
}

/**
 * How far the light has ramped in, 0 to 1. Below the floor the ink encodes
 * nothing at all; between the floor and full it fades in, so the first bar of
 * a track brings the solid up rather than switching it on.
 */
export function morphGate(features: Float32Array): number {
  const energy = energyOf(features)
  if (energy <= SILENT_FLOOR) return 0
  const along = clamp((energy - SILENT_FLOOR) / (SILENT_FULL - SILENT_FLOOR), 0, 1)
  return along * along * (3 - 2 * along)
}

/**
 * Whether anything is drawn this frame. No light is no pass and no upload, and
 * the gate is what makes a silent packet cost nothing: a size of nothing is not
 * among the cases, because the range holds every solid to a size it can be seen
 * at and a study that wants none takes its light to 0 instead.
 */
export const morphLit = (params: MorphParams, features: Float32Array) =>
  params.intensity > 0 && morphGate(features) > 0

const mixBits = (value: number) => {
  let bits = value >>> 0
  bits ^= bits >>> 16
  bits = Math.imul(bits, 0x85ebca6b)
  bits ^= bits >>> 13
  bits = Math.imul(bits, 0xc2b2ae35)
  bits ^= bits >>> 16
  return bits >>> 0
}

/** A number in [0, 1) for one choice, from a seed. Never `Math.random`: the same song, the same solids. */
export const morphHash = (seed: number): number =>
  mixBits(Math.imul(Math.trunc(seed) + 1, 0x9e3779b1)) / 4294967296

/**
 * The form a seed picks, never the one already showing. The hash spends its
 * range over the other five rather than over all six and re-rolling, so every
 * form that is not the current one is equally likely and a section boundary
 * always changes what is on screen. A seed with nothing to avoid (`avoid`
 * under 0, which is the first section of a track) may pick any of them.
 */
export function nextForm(seed: number, avoid: number): number {
  const choices = avoid >= 0 && avoid < FORMS.length ? FORMS.length - 1 : FORMS.length
  const pick = Math.min(choices - 1, Math.floor(morphHash(seed) * choices))
  if (avoid < 0 || avoid >= FORMS.length) return pick
  return pick >= avoid ? pick + 1 : pick
}

/**
 * Which solid is showing and how far it has melted into the next. It is the
 * only state the ink keeps, and all of it is decided by the packet: the
 * section id picks the next form, `impact` cuts to one, and the melt is the
 * real `dt` over `MELT_SECONDS`.
 */
export class MorphShape {
  /** The form being left and the form being arrived at, as indices into `FORMS`. */
  leaving = 0
  arriving = 0
  /** 0 wholly on the form being left, 1 wholly arrived. */
  blend = 1
  /** The ripple's own clock, in seconds, which runs while the ink is drawn. */
  clock = 0
  /** The section this was last given, so a boundary is noticed once. */
  private section = -1
  /** How many cuts this track has had, so two drops in one section differ. */
  private cuts = 0
  private armed = true

  step(features: Float32Array, dt: number) {
    const span = Math.min(Math.max(dt, 0), 0.1)
    this.clock += span
    const section = Math.trunc(features[F.section] ?? 0)

    if (section !== this.section) {
      const first = this.section < 0
      this.section = section
      // Mid-melt the form being left is the one being arrived at, not the
      // shape as it stands: three fields blended at once is a different solid
      // again, and a section is far longer than a melt, so it is a case that
      // costs nothing to give up.
      this.leaving = first ? nextForm(section, -1) : this.arriving
      this.arriving = first ? this.leaving : nextForm(section, this.leaving)
      this.blend = first ? 1 : 0
    }

    // The one cut in the study. A crossing with a hysteresis, as the shards
    // read it, so one drop is one burst however long `impact` takes to fall.
    const impact = features[F.impact] ?? 0
    if (impact < IMPACT_OFF) this.armed = true
    else if (this.armed && impact >= IMPACT_ON) {
      this.armed = false
      this.cuts += 1
      this.leaving = nextForm(section * 997 + this.cuts, this.arriving)
      this.arriving = this.leaving
      this.blend = 1
    }

    if (this.blend < 1) this.blend = Math.min(1, this.blend + span / MELT_SECONDS)
  }

  /** What the overlay prints: the melt, or the one form when there is nothing to melt. */
  get detail(): string {
    const leaving = FORMS[this.leaving] ?? FORMS[0]
    const arriving = FORMS[this.arriving] ?? FORMS[0]
    if (this.blend >= 1 || leaving === arriving) return arriving
    return `${leaving} to ${arriving} ${Math.round(this.blend * 100)}%`
  }
}

/** Rec. 709 luminance, the weights the threshold in the shader compares against. */
export const luminance = (rgb: readonly [number, number, number]) =>
  0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]

/** The key light's colour: the palette showing, at the key, offset by `hue`. */
export const morphKeyColour = (
  features: Float32Array,
  params: MorphParams,
): [number, number, number] => ribbonHue(features, params.hue)

/** The rim light's: a third of a turn on round the same palette. */
export const morphRimColour = (
  features: Float32Array,
  params: MorphParams,
): [number, number, number] => ribbonHue(features, params.hue + RIM_TURN)

const ribbonHue = (features: Float32Array, offset: number): [number, number, number] => {
  const key = features[F.keyHue] ?? 0
  return peakPaletteAt((Number.isFinite(key) ? key : 0) + RIBBON_TINT + offset)
}

/**
 * The brightest luminance the ink can reach this frame, which is what the
 * threshold is a share of. It is the shader's own sum with every angle at its
 * best: a face square to the key light, the edge fully rimmed and the
 * highlight dead on. Shadow and occlusion only ever take light away, so this
 * is a true ceiling and not an estimate.
 *
 * It is worked out here rather than in the shader for the reason the fractal's
 * is: the shader would have to be handed the two palette colours' weights a
 * second time, and a copy of a curve is a copy that drifts.
 */
export function morphPeak(
  params: MorphParams,
  key: readonly [number, number, number],
  rim: readonly [number, number, number],
): number {
  const keyLuma = luminance(key)
  const specular = keyLuma * (1 - SPECULAR_WHITE) + SPECULAR_WHITE
  const rimLight = (RIM_BASE + params.rim) * luminance(rim)
  return params.intensity * MORPH_LIGHT * (keyLuma + rimLight + params.specular * specular)
}

/** The luminance the ink's own light is cut at this frame, 0 for no cut. */
export function morphGlintLevel(
  params: MorphParams,
  key: readonly [number, number, number],
  rim: readonly [number, number, number],
): number {
  if (params.glint <= GLINT_OFF) return 0
  return params.glint * MORPH_CUT * morphPeak(params, key, rim)
}

/**
 * The share of the frame the solid can cover, before the threshold takes its
 * dim half away. Every form is written to the same bounding radius and the
 * camera does not move, so this is the disc that radius subtends and not a
 * raster: the ripple is added to the radius, since a crest is the furthest the
 * surface reaches. A square canvas is the worst case, since the disc is sized
 * by the short side and a square is where the frame is smallest against it.
 *
 * It is a ceiling twice over. A solid is not a disc (a torus is mostly hole,
 * a capsule mostly air either side), and the glint threshold then drops
 * whatever is not brightly lit, which is most of a turning form.
 */
export function morphCoverage(params: MorphParams, width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0
  // The short side, because that is the side the camera's field of view is
  // across: a solid is the same size on a wide canvas and a tall one.
  const radius = ((params.size + params.ripple) / HALF_VIEW) * (Math.min(width, height) / 2)
  const area = Math.PI * radius * radius
  return Math.min(1, area / (width * height))
}

/**
 * The uniform the shader reads, in floats:
 *
 *   0 to 3    the marched target in pixels, its aspect, the ripple's clock
 *   4 to 7    the eye, and the vertical field of view in radians
 *   8 to 11   the form being left, the one being arrived at, the melt, the size
 *   12 to 15  the spin and tumble in turns, the ripple's amplitude and frequency
 *   16 to 19  the rim, the specular, the light, and the level it is cut at
 *   20 to 23  the key light's colour, and the threshold's knee
 *   24 to 27  the rim light's colour, and the march's step budget
 *
 * The width and height are the target actually marched and not the canvas's,
 * since the rays are built against them. The light already carries the gate,
 * so a packet fading in fades the solid in with it.
 */
export function writeMorphUniform(
  params: MorphParams,
  shape: MorphShape,
  features: Float32Array,
  width: number,
  height: number,
  steps: number,
  out: Float32Array,
): Float32Array {
  const key = morphKeyColour(features, params)
  const rim = morphRimColour(features, params)
  const gate = morphGate(features)
  const lit = { ...params, intensity: params.intensity * gate }
  out[0] = Math.max(1, width)
  out[1] = Math.max(1, height)
  out[2] = Math.max(1, width) / Math.max(1, height)
  out[3] = shape.clock
  out[4] = EYE[0]
  out[5] = EYE[1]
  out[6] = EYE[2]
  out[7] = FOV
  out[8] = shape.leaving
  out[9] = shape.arriving
  // Smoothstepped here rather than in the shader, so the melt the tests read
  // is the melt the surface is at.
  out[10] = shape.blend * shape.blend * (3 - 2 * shape.blend)
  out[11] = params.size
  out[12] = params.spin
  out[13] = params.tumble
  out[14] = params.ripple
  out[15] = params.rippleScale
  out[16] = params.rim
  out[17] = params.specular
  out[18] = lit.intensity
  out[19] = morphGlintLevel(lit, key, rim)
  out[20] = key[0]
  out[21] = key[1]
  out[22] = key[2]
  out[23] = params.glintKnee
  out[24] = rim[0]
  out[25] = rim[1]
  out[26] = rim[2]
  out[27] = Math.max(1, Math.round(steps))
  return out
}
