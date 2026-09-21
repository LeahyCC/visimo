/**
 * A study's mapping applied, the same sum a preset's is:
 *
 *   value = knobs[to] + Σ gain × curve(field[from])
 *
 * The difference is what a field may be. A study reads the packet, and also
 * `tension` and `presence`, neither of which is in the packet the renderer
 * holds: tension is handed in by the caller, which is what lets this land
 * before the packet row exists, and presence is the director's fade.
 *
 * Presence is passed through rather than acted on. A flow or an ink is handed
 * it and its implementation decides what fading in means, because thinning a
 * fluid is not the same operation as thinning a line. The looks and the
 * ribbon are the two exceptions, and `blendLooks` and `writeRibbon` say why.
 *
 * Everything writes into an object the caller owns and keeps, because this
 * runs on every animation frame and there is nothing here worth allocating.
 */
import { PALETTE_IDS } from '../palettes/palette'
import type { PaletteChoice, PaletteId } from '../palettes/palette'
import {
  DEFAULT_POST_PARAMS,
  defaultPostParams,
  POST_KNOBS,
  POST_LANES,
  POST_STAGES,
} from '../post/params'
import type { PostParams } from '../post/params'
import { bend, feature } from '../presets/resolve'
import { CANVAS_KNOBS, castStudyIds, PINNED_PALETTE } from './cast'
import type { Cast, CastCanvas, CastOverride } from './cast'
import {
  COUNT_KNOBS,
  isLookStrength,
  LOOK_KNOBS,
  LOOK_NEUTRAL,
  LOOK_STAGES,
  RIBBON_KNOBS,
} from './impls'
import type { LookStage } from './impls'
import { findStudy } from './registry'
import { isLook } from './types'
import type { LookStudy, Study, StudyField, StudyMapping } from './types'

/** What a study's mapping reads. The two fields outside the packet come in as arguments. */
export function studyFeature(
  features: Float32Array,
  field: StudyField,
  tension: number,
  presence: number,
): number {
  if (field === 'tension') return tension
  if (field === 'presence') return presence
  return feature(features, field)
}

function applyRows(
  mapping: readonly StudyMapping[],
  features: Float32Array,
  tension: number,
  presence: number,
  out: Record<string, number>,
) {
  for (const row of mapping) {
    const current = out[row.to]
    // A row aimed at a knob this study does not have is ignored, the way the
    // preset resolver ignores a row aimed at the post stack. The parser has
    // already refused one in a file; this is what keeps the frame cheap.
    if (current === undefined) continue
    out[row.to] =
      current + row.gain * bend(studyFeature(features, row.from, tension, presence), row.curve)
  }
}

/**
 * One study's knobs for this frame, written into `out`: its resting values,
 * the cast's patch over them, then its own rows and the cast's rows on top.
 * The cast's rows come last so a cast can only ever add to what the study
 * already does.
 */
export function resolveStudy(
  study: Study,
  overrides: CastOverride | undefined,
  features: Float32Array,
  tension: number,
  presence: number,
  out: Record<string, number>,
): Readonly<Record<string, number>> {
  for (const key of Object.keys(out)) if (!(key in study.knobs)) delete out[key]
  for (const [key, value] of Object.entries(study.knobs)) out[key] = value
  if (overrides?.knobs)
    for (const [key, value] of Object.entries(overrides.knobs)) if (key in out) out[key] = value
  applyRows(study.mapping, features, tension, presence, out)
  if (overrides?.mapping) applyRows(overrides.mapping, features, tension, presence, out)
  return out
}

/** One study's resolved knobs and the fade it is at, for `blendKnobs`. */
export type KnobsAt = {
  knobs: Readonly<Record<string, number>>
  presence: number
}

/**
 * Two studies of one implementation as a single set of knobs, weighted by
 * presence. Lazy fluid and turbulent fluid are one solver at two sets of
 * numbers, so a fade between them is a fade of the numbers: one solver runs,
 * carrying the field it has already stirred, and the knobs walk from one
 * study's to the other's. Building a second solver instead would blend two
 * fields and throw away what the first had going.
 *
 * The presences are normalised, for the reason `FlowBlend` normalises its
 * weights: this is an average of two settings and not a sum of them, and two
 * studies at a half each should stir as hard as either alone. A knob one of
 * them does not carry counts as nothing, which cannot arise among studies of
 * one implementation because they carry the same list.
 *
 * `parts` is a buffer the caller keeps and `count` says how much of it is
 * live, the way `blendLooks` takes its looks, since this runs every frame.
 */
export function blendKnobs(
  parts: readonly KnobsAt[],
  count: number,
  out: Record<string, number>,
): Readonly<Record<string, number>> {
  for (const key of Object.keys(out)) delete out[key]
  let total = 0
  for (let at = 0; at < count; at += 1) total += parts[at]?.presence ?? 0
  if (total <= 0) return out
  for (let at = 0; at < count; at += 1) {
    const part = parts[at]
    if (!part) continue
    const share = part.presence / total
    for (const [key, value] of Object.entries(part.knobs))
      out[key] = (out[key] ?? 0) + share * value
  }

  // Half an emitter is not a thing the solver can place.
  for (const knob of COUNT_KNOBS) {
    const value = out[knob]
    if (value !== undefined) out[knob] = Math.round(value)
  }

  return out
}

/**
 * One study as it is live this frame. This is what the director hands over:
 * a list of these, which unlike a `Cast` may hold two flows or two looks at
 * once, because that is what the middle of a change looks like.
 */
export type LiveStudy = {
  id: string
  /** The director's fade, 0 to 1. At 0 the study is not resolved at all. */
  presence: number
  override?: CastOverride | undefined
}

/**
 * What is live this frame: the studies with their fades, the canvas they all
 * draw on, and how wound up the song is. This is what the renderer takes, and
 * what the director will build fresh each frame as it fades studies in and
 * out. A pinned cast is one of these with every presence at 1.
 */
export type LiveCast = {
  studies: readonly LiveStudy[]
  canvas: CastCanvas
  tension: number
  /**
   * A palette held over whatever the looks name. A pinned cast sets it, since
   * it is a fixed picture; the director leaves it out and the palette follows
   * the look it chose.
   */
  palette?: PaletteId | undefined
}

/**
 * A cast resolved: every drawing study's knobs by id, the whole post stack,
 * and the palettes the picture is coloured in.
 */
export type CastFrame = {
  knobs: Map<string, Record<string, number>>
  post: PostParams
  palette: PaletteChoice
}

export const castFrame = (): CastFrame => ({
  knobs: new Map(),
  post: defaultPostParams(),
  palette: { from: PINNED_PALETTE, to: PINNED_PALETTE, mix: 0 },
})

/**
 * The stack back at its own defaults, with every stage off. What runs is then
 * decided by what is live alone: the canvas switches the feedback on, a
 * ribbon ink switches the ribbon on, and the looks switch on the stages they
 * name.
 */
function restPost(out: PostParams) {
  out.enabled = true
  for (const stage of POST_STAGES) out[stage].enabled = false
  out.bloom.weights = [
    DEFAULT_POST_PARAMS.bloom.weights[0],
    DEFAULT_POST_PARAMS.bloom.weights[1],
    DEFAULT_POST_PARAMS.bloom.weights[2],
  ]
  for (const knob of POST_KNOBS)
    POST_LANES[knob].write(out, POST_LANES[knob].read(DEFAULT_POST_PARAMS))
}

/** The canvas: the feedback's resting numbers and the rows the cast puts on them. */
function resolveCanvas(
  canvas: CastCanvas,
  features: Float32Array,
  tension: number,
  out: PostParams,
) {
  out.feedback.enabled = canvas.enabled
  for (const knob of CANVAS_KNOBS) POST_LANES[knob].write(out, canvas.knobs[knob])
  for (const row of canvas.mapping) {
    const lane = POST_LANES[row.to]
    // The canvas is not a study and has no presence of its own: it is the
    // picture every study is drawing on.
    lane.write(
      out,
      lane.read(out) + row.gain * bend(studyFeature(features, row.from, tension, 1), row.curve),
    )
  }
}

/**
 * The ribbon ink's knobs are post lanes, so they go straight into the stack.
 * The post stack is the ribbon's implementation and it knows nothing of
 * presence, so this is the one ink whose fade has to happen here: its light
 * is scaled by presence, or it would arrive and leave at full strength while
 * every other ink glides.
 */
function writeRibbon(knobs: Record<string, number>, presence: number, out: PostParams) {
  out.ribbon.enabled = true
  for (const knob of RIBBON_KNOBS) {
    const value = knobs[knob]
    if (value !== undefined) POST_LANES[knob].write(out, value)
  }

  out.ribbon.intensity *= presence
}

// The looks live this frame, gathered by `resolveLive` and consumed by
// `blendLooks` before it returns, so these serve every frame and none
// allocates once the lists have grown to the most looks ever live at once.
const heldLooks: LookStudy[] = []
const heldShare: number[] = []
const heldKnobs: Record<string, number>[] = []
const stageShare: Record<LookStage, number> = {
  bloom: 0,
  chromatic: 0,
  grade: 0,
  tonemap: 0,
  grain: 0,
}

// Worked out once, since a prefix test per knob per frame builds strings.
const KNOB_STAGE = new Map(
  LOOK_KNOBS.map((knob) => [knob, LOOK_STAGES.find((stage) => knob.startsWith(`${stage}.`))]),
)

// The neutral of every strength knob, and nothing for the rest, so the blend
// tells the two apart with one lookup.
const KNOB_NEUTRAL = new Map(
  LOOK_KNOBS.map((knob) => [knob, isLookStrength(knob) ? LOOK_NEUTRAL[knob] : undefined]),
)

/**
 * The looks written into the stack, weighted by presence.
 *
 * Presences are normalised first, so a look on its own is wholly itself at
 * any presence: a look has nothing to fade against but another look, and a
 * half-applied tonemap is not a softer picture, only a wrong one. Two looks
 * at a half each land halfway between them, which is what lets the director
 * slide one into the other without either knowing.
 *
 * A stage only one of them has is the case that needs care. Its strength
 * knobs (`LOOK_STRENGTH_KNOBS`) are weighted against every look, the ones
 * without the stage standing at the knob's neutral (`LOOK_NEUTRAL`), so grain
 * that belongs to the look that is leaving thins to nothing as it goes and
 * the stage switching off at the end is not seen. The neutral is not always
 * 0: a saturation of 0 is grey, so a leaving look's drained colour heads
 * back to 1 and never below what the look had, where a fade to 0 would drain
 * it on the way out and snap it back at the end. Its other knobs, a
 * threshold or a knee, are averaged only among the looks that have the stage,
 * because the look without it has no opinion and its resting number would
 * drag the threshold about while the stage fades. The first cut of this faded
 * every knob toward the post stack's defaults instead, which made a leaving
 * look's grain and split grow toward the default strength and then snap off.
 *
 * The tonemap has no strength to fade by, so a change between a look with it
 * and one without is a step. Every look in the registry has it.
 */
function blendLooks(count: number, out: PostParams) {
  let total = 0
  for (let at = 0; at < count; at += 1) total += heldShare[at] ?? 0
  if (total <= 0) return
  for (const stage of LOOK_STAGES) {
    let share = 0
    for (let at = 0; at < count; at += 1)
      if (heldLooks[at]?.stages.includes(stage)) share += heldShare[at] ?? 0
    stageShare[stage] = share
    out[stage].enabled = share > 0
  }

  for (const knob of LOOK_KNOBS) {
    const lane = POST_LANES[knob]
    const rest = lane.read(DEFAULT_POST_PARAMS)
    const stage = KNOB_STAGE.get(knob)
    const held = stage ? stageShare[stage] : 0
    const neutral = KNOB_NEUTRAL.get(knob)
    let sum = 0
    for (let at = 0; at < count; at += 1) {
      const look = heldLooks[at]
      if (!look || (held > 0 && stage && !look.stages.includes(stage))) continue
      sum += (heldShare[at] ?? 0) * (heldKnobs[at]?.[knob] ?? rest)
    }

    // A strength knob counts the looks without the stage at its neutral. At 0
    // that adds nothing, which is what every one of them did before there was
    // a neutral to name.
    if (neutral !== undefined && held > 0) sum += Math.max(total - held, 0) * neutral

    // No look has the stage: it is off, and the number is kept only so a
    // pinned cast still reads back what its file says.
    const over = held > 0 && neutral === undefined ? held : total
    lane.write(out, sum / over)
  }
}

// The presence each palette has among the looks live this frame, by its place
// in `PALETTE_IDS`. Kept and zeroed rather than built, like the lists above.
const paletteShare = new Float64Array(PALETTE_IDS.length)

/**
 * The palettes the looks live this frame ask for, as one choice. Each look
 * names a palette and brings its presence with it, so a look fading in
 * brings its colour in at the same rate: the palettes cross-fade in OKLCH by
 * the same shares the looks are blended by.
 *
 * A choice is two palettes and a mix, so with three looks live the weakest
 * palette is dropped. The director never has more than two at once, and a
 * hand-built list that does is drawn by its two strongest rather than refused.
 * The pair is kept in the registry's order, `from` the earlier, so it does not
 * swap ends when one palette overtakes the other halfway through a fade: the
 * mix runs 0 to 1 once, and the colour at half is the same from either side.
 *
 * Two looks that name one palette are one palette, whatever their fades.
 */
function blendPalette(count: number, out: PaletteChoice) {
  paletteShare.fill(0)
  for (let at = 0; at < count; at += 1) {
    const id = heldLooks[at]?.palette
    const place = id ? PALETTE_IDS.indexOf(id) : -1
    if (place >= 0) paletteShare[place] = (paletteShare[place] ?? 0) + (heldShare[at] ?? 0)
  }

  let first = -1
  let second = -1
  for (let index = 0; index < paletteShare.length; index += 1) {
    const share = paletteShare[index] ?? 0
    if (share <= 0) continue
    if (first < 0 || share > (paletteShare[first] ?? 0)) {
      second = first
      first = index
    } else if (second < 0 || share > (paletteShare[second] ?? 0)) second = index
  }

  if (first < 0) return choosePalette(out, PINNED_PALETTE)
  if (second < 0) return choosePalette(out, PALETTE_IDS[first] ?? PINNED_PALETTE)
  const [low, high] = first < second ? [first, second] : [second, first]
  const lowShare = paletteShare[low] ?? 0
  const highShare = paletteShare[high] ?? 0
  out.from = PALETTE_IDS[low] ?? PINNED_PALETTE
  out.to = PALETTE_IDS[high] ?? PINNED_PALETTE
  out.mix = highShare / (lowShare + highShare)
}

function choosePalette(out: PaletteChoice, id: PaletteId) {
  out.from = id
  out.to = id
  out.mix = 0
}

/**
 * Whatever is live, resolved for this frame: each drawing study's knobs by
 * id, the whole post stack and the palette. This is the entry point the
 * director feeds. A study at presence 0 is not resolved and is not in the
 * output, so the renderer never touches it.
 *
 * `palette` is a pinned cast's own, held over the looks'. Without it the
 * palette is the one the looks name.
 */
export function resolveLive(
  live: readonly LiveStudy[],
  canvas: CastCanvas,
  features: Float32Array,
  tension: number,
  out: CastFrame,
  palette?: PaletteId,
): CastFrame {
  // Deleting from a Map while walking its keys is safe, and spares the copy.
  for (const id of out.knobs.keys()) {
    let kept = false
    for (const entry of live) if (entry.id === id && entry.presence > 0) kept = true
    if (!kept) out.knobs.delete(id)
  }

  restPost(out.post)
  resolveCanvas(canvas, features, tension, out.post)
  let looks = 0
  for (const entry of live) {
    if (entry.presence <= 0) continue
    // The parser and the director name registry entries; a list built by
    // hand may not, and a missing study draws nothing.
    const study = findStudy(entry.id)
    if (!study) continue
    if (isLook(study)) {
      const knobs = (heldKnobs[looks] ??= {})
      resolveStudy(study, entry.override, features, tension, entry.presence, knobs)
      heldLooks[looks] = study
      heldShare[looks] = entry.presence
      looks += 1
      continue
    }

    let knobs = out.knobs.get(entry.id)
    if (!knobs) {
      knobs = {}
      out.knobs.set(entry.id, knobs)
    }

    resolveStudy(study, entry.override, features, tension, entry.presence, knobs)
    if (study.impl === 'ribbon') writeRibbon(knobs, entry.presence, out.post)
  }

  blendLooks(looks, out.post)
  if (palette) choosePalette(out.palette, palette)
  else blendPalette(looks, out.palette)
  return out
}

// A cast's studies as a live list, built once per cast and kept, so resolving
// a pinned cast every frame allocates nothing. Keyed weakly so a cast a host
// parsed and dropped takes its list with it.
const pinned = new WeakMap<Cast, LiveStudy[]>()

/**
 * A whole cast for this frame, which is `resolveLive` over the cast's own
 * studies. `presences` is a fade per study id, 1 where it says nothing, which
 * is every study of a pinned cast.
 */
export function resolveCast(
  cast: Cast,
  features: Float32Array,
  tension: number,
  out: CastFrame,
  presences?: ReadonlyMap<string, number>,
): CastFrame {
  let live = pinned.get(cast)
  if (!live) {
    live = castStudyIds(cast).map((id) => ({ id, presence: 1, override: cast.overrides[id] }))
    pinned.set(cast, live)
  }

  for (const entry of live) entry.presence = presences?.get(entry.id) ?? 1
  return resolveLive(live, cast.canvas, features, tension, out, cast.palette ?? PINNED_PALETTE)
}

/**
 * A pinned cast as a live cast: every study wholly on, nothing wound up. It
 * builds a list of its own rather than sharing the one above, because the
 * renderer holds what it is given for as long as the cast is drawn.
 */
export const liveCast = (cast: Cast): LiveCast => ({
  studies: castStudyIds(cast).map((id) => ({ id, presence: 1, override: cast.overrides[id] })),
  canvas: cast.canvas,
  tension: 0,
  palette: cast.palette ?? PINNED_PALETTE,
})
