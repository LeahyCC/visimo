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
 * fluid is not the same operation as thinning a line. A look is the one
 * exception, and `resolveLook` says why.
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
import { CANVAS_KNOBS, castStudyIds } from './cast'
import type { Cast, CastOverride } from './cast'
import { LOOK_KNOBS, RIBBON_KNOBS } from './impls'
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

/**
 * Consumed before the next call, so one of these serves every look in a
 * frame and no frame allocates.
 */
const lookKnobs: Record<string, number> = {}

/**
 * A look written into a stack the caller has already put at the post stack's
 * defaults. Unlike a flow or an ink, a look acts on presence here: at
 * presence p it contributes p of its distance from those defaults, and it
 * adds rather than overwrites. Two looks at a half then land halfway between
 * them, which is what lets the director cross-fade one into another without
 * either of them knowing about the other.
 *
 * A stage is switched on by any look that is present at all. A look at
 * presence 0 contributes nothing and leaves its stages alone.
 */
export function resolveLook(
  look: LookStudy,
  overrides: CastOverride | undefined,
  features: Float32Array,
  tension: number,
  presence: number,
  out: PostParams,
): PostParams {
  if (presence <= 0) return out
  resolveStudy(look, overrides, features, tension, presence, lookKnobs)
  for (const stage of look.stages) out[stage].enabled = true
  for (const knob of LOOK_KNOBS) {
    const lane = POST_LANES[knob]
    const rest = lane.read(DEFAULT_POST_PARAMS)
    lane.write(out, lane.read(out) + presence * ((lookKnobs[knob] ?? rest) - rest))
  }

  return out
}

/** A cast resolved: every study's knobs by id, and the whole post stack. */
export type CastFrame = {
  knobs: Map<string, Record<string, number>>
  post: PostParams
}

export const castFrame = (): CastFrame => ({ knobs: new Map(), post: defaultPostParams() })

/**
 * The stack back at its own defaults, with every stage off. What runs is then
 * decided by the cast alone: the canvas switches the feedback on, a ribbon
 * ink switches the ribbon on, and the look switches on the stages it names.
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
function resolveCanvas(cast: Cast, features: Float32Array, tension: number, out: PostParams) {
  out.feedback.enabled = cast.canvas.enabled
  for (const knob of CANVAS_KNOBS) POST_LANES[knob].write(out, cast.canvas.knobs[knob])
  for (const row of cast.canvas.mapping) {
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
 * A whole cast for this frame. The renderer does not draw one of these yet;
 * what it is for today is the proof that a pinned cast resolves to the same
 * numbers its preset does.
 *
 * `presences` is the director's fade per study id, 1 where it says nothing,
 * which is every study of a pinned cast.
 */
export function resolveCast(
  cast: Cast,
  features: Float32Array,
  tension: number,
  out: CastFrame,
  presences?: ReadonlyMap<string, number>,
): CastFrame {
  const presenceOf = (id: string) => presences?.get(id) ?? 1
  const drawing = castStudyIds(cast).filter((id) => id !== cast.look)
  for (const id of [...out.knobs.keys()]) if (!drawing.includes(id)) out.knobs.delete(id)
  restPost(out.post)
  resolveCanvas(cast, features, tension, out.post)
  for (const id of drawing) {
    // A cast from the parser or the director names registry entries; one
    // built by hand may not, and a missing study draws nothing.
    const study = findStudy(id)
    if (!study) continue
    let knobs = out.knobs.get(id)
    if (!knobs) {
      knobs = {}
      out.knobs.set(id, knobs)
    }

    const presence = presenceOf(id)
    resolveStudy(study, cast.overrides[id], features, tension, presence, knobs)
    if (study.impl === 'ribbon') writeRibbon(knobs, presence, out.post)
  }

  const look = findStudy(cast.look)
  if (look && isLook(look))
    resolveLook(look, cast.overrides[cast.look], features, tension, presenceOf(cast.look), out.post)
  return out
}

/** The ribbon ink's knobs are post lanes, so they go straight into the stack. */
function writeRibbon(knobs: Record<string, number>, presence: number, out: PostParams) {
  out.ribbon.enabled = presence > 0
  for (const knob of RIBBON_KNOBS) {
    const value = knobs[knob]
    if (value !== undefined) POST_LANES[knob].write(out, value)
  }
}
