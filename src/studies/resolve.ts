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
 * A row may also carry a `shape`, a stage with a memory between its signal
 * and its gain, and that memory lives here: one small object per study and
 * row, made the first time the row is stepped and dropped when the study's
 * presence returns to 0. It is here rather than on the study because a study
 * is data that two casts may hold at once, and it is keyed by study id rather
 * than by where the study sat in this frame's list because the list changes
 * order as the director fades one thing into another.
 *
 * Everything writes into an object the caller owns and keeps, because this
 * runs on every animation frame and there is nothing here worth allocating.
 */
import {
  DEFAULT_POST_PARAMS,
  defaultPostParams,
  POST_KNOBS,
  POST_LANES,
  POST_STAGES,
} from '../post/params'
import type { PostParams } from '../post/params'
import { bend, feature } from '../presets/resolve'
import { follow, integrate, stepSpring, wrapped } from '../presets/shapes'
import { CANVAS_KNOBS, castStudyIds } from './cast'
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

/**
 * What one shaped row remembers between frames. One object serves all four
 * shapes rather than one type each, because a row's shape never changes and
 * four small objects of one shape are cheaper for the engine to hold than
 * four shapes of one size.
 *
 * `value` is the shape's own output: the follower's level, the spring's
 * position, the running total, or the number a `hold` last sampled.
 * `velocity` is the spring's alone, and `phase` is the beat or bar phase a
 * `hold` last saw, so the wrap that is a boundary can be told from the
 * tracker nudging its phase back.
 */
export type RowState = {
  value: number
  velocity: number
  phase: number
}

const restRow = (state: RowState) => {
  state.value = 0
  state.velocity = 0
  state.phase = 0
  return state
}

const newRow = (): RowState => ({ value: 0, velocity: 0, phase: 0 })

// For a caller that keeps no state of its own: a row shaped against this is
// a row at rest, which is what a single stateless reading of a study means.
// One object, reset each time, so the no-state path allocates nothing either.
const loose = newRow()

/**
 * The row's signal through its shape, and the state moved on. Nothing here
 * reads a knob or a study: the signal is already bent and scaled, and what
 * comes back is what the gain multiplies.
 *
 * A `hold` is the one that reads the packet again, for the phase it steps on.
 * It samples nothing until it has seen a boundary, so a row on the bar draws
 * its resting value until the first downbeat rather than a number taken from
 * whatever frame the study happened to arrive on, and a track with no beat to
 * speak of leaves it there: `beatPhase` sits at 0 until a tempo is found and
 * never wraps, which is the tracker's own way of saying it does not know.
 */
function stepShape(
  row: StudyMapping,
  signal: number,
  features: Float32Array,
  dt: number,
  state: RowState,
): number {
  const shape = row.shape
  if (!shape) return signal
  if (shape.kind === 'envelope') {
    state.value = follow(state.value, signal, shape.attackMs, shape.releaseMs, dt)
    return state.value
  }

  if (shape.kind === 'spring') {
    stepSpring(state, signal, shape.frequency, shape.damping, dt)
    return state.value
  }

  if (shape.kind === 'integrate') {
    state.value = integrate(state.value, signal, shape.rate, shape.wrap ?? 0, dt)
    return state.value
  }

  const phase = feature(features, shape.per === 'bar' ? 'barPhase' : 'beatPhase')
  if (wrapped(state.phase, phase)) state.value = signal
  state.phase = phase
  return state.value
}

/**
 * The rows applied. `states` is the study's own list, indexed by the row's
 * place in the mapping it came from; `offset` is where that mapping starts in
 * the list, which is 0 for the study's own rows and past them for the cast's,
 * so the two cannot share a spring.
 */
function applyRows(
  mapping: readonly StudyMapping[],
  features: Float32Array,
  tension: number,
  presence: number,
  out: Record<string, number>,
  dt: number,
  states: RowState[] | undefined,
  offset: number,
) {
  for (let index = 0; index < mapping.length; index += 1) {
    const row = mapping[index]
    if (!row) continue
    const current = out[row.to]
    // A row aimed at a knob this study does not have is ignored, the way the
    // preset resolver ignores a row aimed at the post stack. The parser has
    // already refused one in a file; this is what keeps the frame cheap.
    if (current === undefined) continue
    // A row with no scale and no shape is the row it always was, by the same
    // arithmetic in the same order, so nothing that existed before this
    // moves by a bit.
    if (!row.scale && !row.shape) {
      out[row.to] =
        current + row.gain * bend(studyFeature(features, row.from, tension, presence), row.curve)
      continue
    }

    let signal = bend(studyFeature(features, row.from, tension, presence), row.curve)
    if (row.scale)
      signal *= bend(studyFeature(features, row.scale.from, tension, presence), row.scale.curve)
    if (row.shape) {
      const at = offset + index
      const state = states ? (states[at] ??= newRow()) : restRow(loose)
      signal = stepShape(row, signal, features, dt, state)
    }

    out[row.to] = current + row.gain * signal
  }
}

/**
 * One study's knobs for this frame, written into `out`: its resting values,
 * the cast's patch over them, then its own rows and the cast's rows on top.
 * The cast's rows come last so a cast can only ever add to what the study
 * already does.
 *
 * `dt` is the real seconds since the last call and `states` what this study's
 * shaped rows remember. Both are optional and a study with no shaped row
 * reads the same without them; a caller that leaves them out and resolves a
 * study that has one reads it with every shape at rest, which is one
 * stateless reading of it and not a step of anything. `resolveLive` is what
 * keeps the state across frames, and the renderer is what hands it the step.
 */
export function resolveStudy(
  study: Study,
  overrides: CastOverride | undefined,
  features: Float32Array,
  tension: number,
  presence: number,
  out: Record<string, number>,
  dt = 0,
  states?: RowState[],
): Readonly<Record<string, number>> {
  for (const key of Object.keys(out)) if (!(key in study.knobs)) delete out[key]
  for (const [key, value] of Object.entries(study.knobs)) out[key] = value
  if (overrides?.knobs)
    for (const [key, value] of Object.entries(overrides.knobs)) if (key in out) out[key] = value
  applyRows(study.mapping, features, tension, presence, out, dt, states, 0)
  // The cast's rows are indexed past the study's own, so a cast that shapes a
  // row does not step the state the study's row of the same number is using.
  if (overrides?.mapping)
    applyRows(overrides.mapping, features, tension, presence, out, dt, states, study.mapping.length)
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
}

/**
 * A cast resolved: every live study's knobs by id, and the whole post stack.
 * The looks are in `knobs` as well as blended into `post`, so that anything
 * wanting the numbers a study was drawn with this frame finds them by its id:
 * the bench's readout does, and the shape state below is keyed the same way.
 * Nothing draws from this map, so a look sitting in it draws nothing.
 *
 * `shapes` is what the shaped rows remember, by study id. It is on the frame
 * and not in a module of its own so that two renderers, or a test and a
 * renderer, do not step each other's springs.
 */
export type CastFrame = {
  knobs: Map<string, Record<string, number>>
  post: PostParams
  shapes: Map<string, RowState[]>
}

export const castFrame = (): CastFrame => ({
  knobs: new Map(),
  post: defaultPostParams(),
  shapes: new Map(),
})

/**
 * Every shaped row back at rest, which is what a new track or a seek means:
 * a spring mid-ring and a total that has been climbing for three minutes are
 * both about the piece of music that has just stopped being played. The
 * canvas is deliberately not reset with them, for the reason `newTrack` gives
 * in the renderer: one track running into the next should morph.
 */
export const forgetShapes = (out: CastFrame) => out.shapes.clear()

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
// References into the frame's own records rather than buffers of their own,
// since a look's numbers are kept by id there for the bench to read.
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

/** One study's own record in the frame, made the first time it is live. */
function knobsFor(out: CastFrame, id: string): Record<string, number> {
  let knobs = out.knobs.get(id)
  if (!knobs) {
    knobs = {}
    out.knobs.set(id, knobs)
  }

  return knobs
}

/**
 * One study's shaped-row memory, made the first time it is live. An empty
 * list costs one object per live study and is never grown for a study with no
 * shaped row, so a cast of plain studies allocates nothing past its first
 * frame.
 */
function statesFor(out: CastFrame, id: string): RowState[] {
  let states = out.shapes.get(id)
  if (!states) {
    states = []
    out.shapes.set(id, states)
  }

  return states
}

/**
 * Whatever is live, resolved for this frame: each live study's knobs by id,
 * and the whole post stack. This is the entry point the director feeds. A
 * study at presence 0 is not resolved and is not in the output, so the
 * renderer never touches it and whatever its shapes remembered goes with it:
 * a study that comes back arrives at rest rather than where it left off half
 * a song ago.
 *
 * `dt` is the real seconds since the last call, and only the shaped rows read
 * it. A caller that passes none holds every shape where it is, which is what
 * a single reading of a frame wants.
 */
export function resolveLive(
  live: readonly LiveStudy[],
  canvas: CastCanvas,
  features: Float32Array,
  tension: number,
  out: CastFrame,
  dt = 0,
): CastFrame {
  // Deleting from a Map while walking its keys is safe, and spares the copy.
  for (const id of out.knobs.keys()) {
    let kept = false
    for (const entry of live) if (entry.id === id && entry.presence > 0) kept = true
    if (!kept) {
      out.knobs.delete(id)
      out.shapes.delete(id)
    }
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
    const knobs = knobsFor(out, entry.id)
    resolveStudy(
      study,
      entry.override,
      features,
      tension,
      entry.presence,
      knobs,
      dt,
      statesFor(out, entry.id),
    )

    if (isLook(study)) {
      heldLooks[looks] = study
      heldShare[looks] = entry.presence
      heldKnobs[looks] = knobs
      looks += 1
      continue
    }

    if (study.impl === 'ribbon') writeRibbon(knobs, entry.presence, out.post)
  }

  blendLooks(looks, out.post)
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
  dt = 0,
): CastFrame {
  let live = pinned.get(cast)
  if (!live) {
    live = castStudyIds(cast).map((id) => ({ id, presence: 1, override: cast.overrides[id] }))
    pinned.set(cast, live)
  }

  for (const entry of live) entry.presence = presences?.get(entry.id) ?? 1
  return resolveLive(live, cast.canvas, features, tension, out, dt)
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
})
