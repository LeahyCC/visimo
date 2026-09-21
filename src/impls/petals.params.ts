/**
 * The petals' numbers: where each of twelve petals points, how long and how
 * lit it is, what colour, worked out on the CPU and handed to the shader as a
 * finished uniform. Pure TypeScript with no GPU objects, the way
 * `lasers.params.ts` is, so what decides the picture can be tested without a
 * browser.
 *
 * A flower of twelve petals round the middle, one per pitch class. They stand
 * in circle-of-fifths order, so notes that sound well together sit side by
 * side and a chord is a cluster of neighbours rather than three scattered
 * blades. The flower is turned so the key's own note is at the top: `keyHue`
 * is that note's place on the same circle, and the angle of every petal is
 * its own place less the key's. A key change is therefore the whole flower
 * turning to a new note at the top, over the seconds the key takes to move.
 * The colour is the note's place on the wheel with the key added, so the
 * petals keep their neighbours' colours and the wheel turns with the key.
 *
 * A petal's light is its note's knob, 0 to 1, and a study feeds each knob
 * from that note's packet row through an envelope. Nothing lit, nothing drawn:
 * a silent packet has every note at 0 and this draws no pass at all, which is
 * the study's silence gate. The rest of the numbers say what the light does
 * to the shape. `open` runs from a bud, petals short and standing close, to
 * full bloom; `layer` lifts a second, smaller whorl of twelve petals half a
 * step behind the first, so a loud passage doubles the number of petals a
 * lit note has; `size`, `width` and `glow` are the flower's radius, how fat a
 * petal is and how far its light spreads.
 *
 * There is no clock and no state. The angle is the `turn` knob, which the
 * study integrates with a shaped row, and everything else is the knobs and the
 * key, so the same song at any frame rate draws the same frame.
 */
import { F } from '../audio/FeatureExtractor'
import type { PetalKnob } from '../studies/impls'

/** Floats in the uniform; the shader's `Params` struct reads them in this order. */
export const PETAL_UNIFORM_FLOATS = 64

/** Petals in a whorl: one a pitch class. */
export const PETALS = 12

/** The canvas height a `glow` is written against, the same the lasers' is. */
const REFERENCE_HEIGHT = 1080

/** Where a pitch class stands round the flower, in twelfths: the circle of fifths. */
export const fifthsPlace = (note: number) => (note * 7) % PETALS

/** The hub the petals grow out of, as a share of the radius. Nothing but the ring is drawn in it. */
export const HUB = 0.14

/** The second whorl's petals against the first's, and how far it is turned: half a step. */
export const INNER_LENGTH = 0.55
export const INNER_TURN = Math.PI / PETALS

/**
 * How much of its length a petal keeps when the flower is shut, and how much
 * a lit note lengthens it. A petal is never shorter than these say, so a
 * faint note is a small petal and not a smear.
 */
export const BUD_LENGTH = 0.35
export const NOTE_LENGTH = 0.65

/**
 * How wide a petal may be as a share of the distance it stands from the
 * middle at its fullest: the tangent of half a step, which is where two
 * neighbours touch. At `width` 1 they do, and a petal is at its widest about
 * three fifths of the way to its tip.
 */
export const HALF_SECTOR = 0.27
export const WIDEST_AT = 0.6

/** The petal's outline: fullest at about 0.6 of its length, pointed at the tip. */
export const OUTLINE_SKEW = 1.4
export const OUTLINE_ROUND = 0.85

/**
 * The light of one petal, in the units the intensity multiplies. The body is
 * the dim translucent fill, the rim the bright line round its edge, and the
 * halo the soft light thrown outside it. The rim is where a backlit petal is
 * brightest and the only thing that reaches past 1, so the bloom finds the
 * outline and leaves the fill alone.
 *
 * The body and the halo are small on purpose, a tenth and a twentieth of the
 * rim. A petal that holds a chord holds still, and a still light settles on
 * the canvas at about forty times what one frame adds, so a body at half the
 * rim's strength did not read as a translucent fill: it built to a fog that
 * covered the frame and left no black between the petals. What is drawn is
 * thin, and the canvas is what fills it in.
 */
export const BODY = 0.1
export const RIM = 1.6
export const HALO = 0.06
/** The rim's width in pixels at the reference height. */
export const RIM_PIXELS = 1.8
/** How much brighter the rim is at the tip, where the light gathers. */
export const TIP_GAIN = 1.2

/** A note under this is not a petal, and a flower with none of them draws nothing. */
export const NOTE_MIN = 0.01

/** How far a petal's light reaches past its edge, in glow widths. Mirrors REACH_GLOWS in the shader. */
export const REACH_GLOWS = 6

/** What each knob may reach, inclusive. The params clamp to them. */
export const PETAL_RANGES: Record<PetalKnob, readonly [number, number]> = {
  note0: [0, 1],
  note1: [0, 1],
  note2: [0, 1],
  note3: [0, 1],
  note4: [0, 1],
  note5: [0, 1],
  note6: [0, 1],
  note7: [0, 1],
  note8: [0, 1],
  note9: [0, 1],
  note10: [0, 1],
  note11: [0, 1],
  // 0 is a bud and 1 full bloom.
  open: [0, 1],
  // The radius as a share of the short side. A radius over half the short
  // side runs the tips past the frame, which is the top of the range.
  size: [0.1, 0.55],
  // 1 is petals that touch their neighbours; the top is a little past.
  width: [0.2, 1.2],
  // How far the second whorl has come up, 0 to 1.
  layer: [0, 1],
  // The width of the light round a petal, in pixels at the reference height.
  glow: [2, 40],
  // Past 1 on purpose: the canvas is half float and the bloom needs something
  // over its threshold. Nothing loud raises it; that is the registry's rule.
  intensity: [0, 3],
  // The flower's angle in turns, wrapped and not clamped: see `petalParams`.
  turn: [0, 1],
}

export type PetalParams = Record<PetalKnob, number>

const KNOBS = Object.keys(PETAL_RANGES) as PetalKnob[]

/** What a knob a study did not resolve falls to: nothing lit, and a shape that draws nothing harmful. */
const FALLBACK: PetalParams = {
  note0: 0,
  note1: 0,
  note2: 0,
  note3: 0,
  note4: 0,
  note5: 0,
  note6: 0,
  note7: 0,
  note8: 0,
  note9: 0,
  note10: 0,
  note11: 0,
  open: 0.5,
  size: 0.3,
  width: 0.7,
  layer: 0,
  glow: 8,
  intensity: 0,
  turn: 0,
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** The knobs a study resolved, clamped to their ranges; a missing or non-finite one takes its fallback. */
export function petalParams(knobs: Readonly<Partial<Record<string, number>>>): PetalParams {
  const out: PetalParams = { ...FALLBACK }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = PETAL_RANGES[knob]
    out[knob] = clamp(
      value !== undefined && Number.isFinite(value) ? value : FALLBACK[knob],
      low,
      high,
    )
  }

  // The angle is a turn that comes round, not a level with an end. Two rows
  // may each wrap at 1 and their sum is past it, and clamping that would stop
  // the flower at the top of the range and then jump it back.
  const turn = knobs['turn']
  if (turn !== undefined && Number.isFinite(turn)) out.turn = ((turn % 1) + 1) % 1
  return out
}

/** How lit a pitch class is, 0 to 1. */
export const noteLight = (params: PetalParams, note: number): number =>
  params[`note${note}` as PetalKnob]

/**
 * Whether anything is drawn this frame: some light in the intensity and some
 * note lit. A silent packet has every note at 0, and that is the gate.
 */
export function petalsLit(params: PetalParams): boolean {
  if (!(params.intensity > 0)) return false
  for (let note = 0; note < PETALS; note += 1) if (noteLight(params, note) >= NOTE_MIN) return true
  return false
}

/** Pixels on this canvas for something written at the reference height. */
export const petalPixels = (value: number, width: number, height: number) =>
  value * (Math.min(width, height) / REFERENCE_HEIGHT)

/** The flower's radius in pixels, and the hub's. */
export const flowerRadius = (params: PetalParams, width: number, height: number) =>
  params.size * Math.min(width, height)
export const hubRadius = (radius: number) => HUB * radius

/**
 * How much of the flower's reach a shut flower keeps: from `BUD_LENGTH` when
 * `open` is 0 to the whole of it when it is 1.
 */
export const openness = (open: number) => BUD_LENGTH + (1 - BUD_LENGTH) * clamp(open, 0, 1)

/**
 * A petal's length in pixels, standing from `base` and reaching for `tip` when
 * the flower is wide open and the note full: shorter shut, shorter for a
 * quieter note.
 */
export function petalLength(params: PetalParams, lit: number, tip: number, base: number): number {
  return (tip - base) * openness(params.open) * (BUD_LENGTH + NOTE_LENGTH * clamp(lit, 0, 1))
}

/** A petal's half width at its fullest, in pixels, for a petal this long standing this far out. */
export const petalHalfWidth = (params: PetalParams, length: number, base: number) =>
  params.width * HALF_SECTOR * (base + WIDEST_AT * length)

/** One petal as the shader takes it. */
export type Petal = {
  /** The unit vector along the petal, in pixels, y down. */
  dirX: number
  dirY: number
  /** How lit, 0 to 1. */
  lit: number
  /** The colour's place on the wheel, in turns. */
  hue: number
}

/**
 * The twelve petals for this frame. The angle of a petal is its place on the
 * circle of fifths less the key's, plus the flower's own turn, so the key's
 * note stands at the top; the hue is the same place plus the key.
 */
export function petalsFor(params: PetalParams, keyHue: number): Petal[] {
  const out: Petal[] = []
  for (let note = 0; note < PETALS; note += 1) {
    const place = fifthsPlace(note) / PETALS
    const angle = 2 * Math.PI * (place - keyHue + params.turn)
    out.push({
      dirX: Math.sin(angle),
      dirY: -Math.cos(angle),
      lit: clamp(noteLight(params, note), 0, 1),
      hue: place + keyHue,
    })
  }

  return out
}

/**
 * One petal's light at a pixel before the colour and the intensity: the body,
 * the rim and the halo summed, times the note's own light. This is the
 * shader's `petal` function, and what the tests measure.
 *
 * The outline is `h(t) = halfWidth x sin(pi t^1.4)^0.85` along the petal, `t`
 * running 0 at the base to 1 at the tip. The distance to it is the height off
 * the outline at the nearest point along, lengthened by however far past an
 * end the pixel is, and shortened a fifth for the slope, which is close
 * enough for a rim and a glow and much cheaper than the true distance.
 */
export function petalLight(
  params: PetalParams,
  petal: Petal,
  inner: boolean,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  const lit = inner ? petal.lit * params.layer : petal.lit
  if (lit < NOTE_MIN) return 0
  const radius = flowerRadius(params, width, height)
  const base = hubRadius(radius)
  const length = petalLength(params, lit, radius * (inner ? INNER_LENGTH : 1), base)
  const half = petalHalfWidth(params, length, base)
  let dirX = petal.dirX
  let dirY = petal.dirY
  if (inner) {
    const cos = Math.cos(INNER_TURN)
    const sin = Math.sin(INNER_TURN)
    ;[dirX, dirY] = [dirX * cos - dirY * sin, dirX * sin + dirY * cos]
  }

  const relX = x - width / 2
  const relY = y - height / 2
  const along = relX * dirX + relY * dirY
  const across = relX * -dirY + relY * dirX
  const t = (along - base) / length
  const tc = clamp(t, 0, 1)
  const outline = half * Math.max(Math.sin(Math.PI * tc ** OUTLINE_SKEW), 0) ** OUTLINE_ROUND
  const over = Math.max(-t, t - 1, 0) * length
  const off = Math.abs(across) - outline
  const distance = (Math.hypot(over, Math.max(off, 0)) + Math.min(off, 0)) * 0.8

  const rim = petalPixels(RIM_PIXELS, width, height)
  const glow = petalPixels(params.glow, width, height)
  let light = 0
  if (distance < 0) {
    const depth = clamp(-distance / Math.max(half, 1e-3), 0, 1)
    light += BODY * (0.35 + 0.65 * tc ** 0.8) * (1 - 0.45 * depth)
  } else light += HALO * (0.5 + 0.5 * tc) * Math.exp(-distance / glow)
  light += RIM * (1 + TIP_GAIN * smooth(0.85, 1, tc)) * Math.exp(-((distance / rim) ** 2))
  return light * lit ** 0.7
}

const smooth = (low: number, high: number, value: number) => {
  const at = clamp((value - low) / (high - low), 0, 1)
  return at * at * (3 - 2 * at)
}

/** The light of every petal of both whorls at one pixel, summed. */
export function petalsAt(
  x: number,
  y: number,
  params: PetalParams,
  keyHue: number,
  width: number,
  height: number,
): number {
  if (!petalsLit(params)) return 0
  let light = 0
  for (const petal of petalsFor(params, keyHue)) {
    light += petalLight(params, petal, false, x, y, width, height)
    if (params.layer > 0) light += petalLight(params, petal, true, x, y, width, height)
  }

  return light
}

/** A pixel counts as lit, for coverage, when its light passes this share of a petal's body. */
export const LIT_THRESHOLD = 0.05

/**
 * The share of a frame the flower lights, on a canvas this shape: the pixels
 * brighter than `LIT_THRESHOLD` counted on a grid, each once however many
 * petals cross it.
 */
export function petalsCoverage(
  params: PetalParams,
  canvasWidth: number,
  canvasHeight: number,
  rows = 135,
): number {
  const columns = Math.round((rows * canvasWidth) / canvasHeight)
  let lit = 0
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1)
      if (petalsAt(column + 0.5, row + 0.5, params, 0, columns, rows) > LIT_THRESHOLD) lit += 1

  return lit / (columns * rows)
}

/**
 * The uniform the shader reads, in floats:
 *
 *   0 to 3    canvas width and height in pixels, the radius in pixels, the hub's
 *   4 to 7    the openness, the width, the layer, the rim in pixels
 *   8 to 11   the intensity, the glow in pixels, the heart, the key's colour
 *   12 to 15  a pad
 *   16 to 63  the twelve petals, four floats each: direction x and y, lit, hue
 *
 * The heart is the ring at the hub, which stands for the whole chord and so
 * brightens with how many notes are lit and not with any one of them.
 */
export function writePetalsUniform(
  params: PetalParams,
  features: Float32Array,
  width: number,
  height: number,
  out: Float32Array,
): Float32Array {
  const key = features[F.keyHue] ?? 0
  const radius = flowerRadius(params, width, height)
  out[0] = width
  out[1] = height
  out[2] = radius
  out[3] = hubRadius(radius)
  out[4] = openness(params.open)
  out[5] = params.width
  out[6] = params.layer
  out[7] = petalPixels(RIM_PIXELS, width, height)
  out[8] = params.intensity
  out[9] = petalPixels(params.glow, width, height)
  const petals = petalsFor(params, key)
  let total = 0
  for (const petal of petals) total += petal.lit
  out[10] = clamp(total / 3, 0, 1)
  out[11] = key
  out[12] = 0
  out[13] = 0
  out[14] = 0
  out[15] = 0
  petals.forEach((petal, at) => {
    const slot = 16 + 4 * at
    out[slot] = petal.dirX
    out[slot + 1] = petal.dirY
    out[slot + 2] = petal.lit
    out[slot + 3] = petal.hue
  })

  return out
}
