/**
 * What a study is. One small piece that does one job on the shared canvas:
 * a flow says how the picture moves, an ink says what is drawn into it this
 * frame, a look says how it is shown. A cast is the handful of them live at
 * once, and `cast.ts` is that.
 *
 * All of it is data rather than code, for the same reason a preset is: the
 * director that picks studies and the renderer that draws them both build
 * against this, and neither should have to read an implementation to know
 * where a study belongs, what it costs or what the music does to it. Nothing
 * here touches the GPU. `impls.ts` names the implementations and the knobs
 * each of them accepts; `registry.ts` holds the studies themselves.
 */
import { AUDIO_FIELDS } from '../presets/knobs'
import type { AudioField, Curve } from '../presets/knobs'
import type { ImplId, ImplKnob, LookStage } from './impls'

export const STUDY_KINDS = ['flow', 'ink', 'look'] as const
export type StudyKind = (typeof STUDY_KINDS)[number]

/**
 * Where in a song a study belongs. `groove` needs no estimator of its own: it
 * is what is left when the others are low. These names are Colin's tags and
 * the numbers under them are how well the study suits each moment, so a build
 * that bleeds into a drop blends rather than flickering between two labels.
 */
export const MOMENTS = ['intro', 'groove', 'build', 'drop', 'rest', 'outro'] as const
export type Moment = (typeof MOMENTS)[number]
export type Moments = Readonly<Record<Moment, number>>

/**
 * The character space from docs/canvas-plan.md: where a song sits, with no
 * genre labels. `weight` is high for bass-led and low for bright, and
 * `hardness` is how abrupt and how saturated the hits are.
 */
export const CHARACTER_AXES = ['drive', 'weight', 'tonality', 'steadiness', 'hardness'] as const
export type CharacterAxis = (typeof CHARACTER_AXES)[number]
export type Character = Readonly<Record<CharacterAxis, number>>

/**
 * What a study's mapping may read: every packet field a preset may read, and
 * one more that is not the frame's own.
 *
 * `tension` is the song winding up, and is a packet row like the rest, so it
 * is already among the audio fields. The resolver still takes its value as an
 * argument rather than reading the row, so a caller can hand in something
 * other than the packet's: the study bench winds it by hand, and the director
 * passes on the one it chose by. Every flow and ink must say what tension
 * does to it, which `registry.test.ts` holds them to.
 *
 * `presence` is what the director fades a study in and out by, 0 to 1. A
 * study may read it like any other field when it wants to thin itself as it
 * arrives; what presence means beyond that is the implementation's business
 * and not the resolver's.
 */
export const STUDY_FIELDS = [...AUDIO_FIELDS, 'presence'] as const
export type StudyField = AudioField | 'presence'

/**
 * One row of a study's mapping, read exactly as a preset's is:
 *
 *   value = knobs[to] + gain × curve(field[from])
 *
 * `to` is a knob of the study's own implementation and nothing else, so two
 * studies in one cast cannot fight over the same number by accident.
 */
export type StudyMapping = {
  from: StudyField
  to: ImplKnob
  gain: number
  curve: Curve
}

/** What a study costs, so a director can keep a cast inside the frame budget. */
export const COSTS = ['cheap', 'medium', 'heavy'] as const
export type Cost = (typeof COSTS)[number]

type Shape = {
  /** Stable and kebab-case; a cast names studies by it. */
  id: string
  /** What a picker and the debug overlay show. */
  name: string
  /**
   * Which implementation draws it. Two studies may share one: lazy fluid and
   * turbulent fluid are one solver tuned two ways, so the director can hold
   * that solver while swapping which of them is live.
   */
  impl: ImplId
  /** Where it belongs in the character space, and how wide its welcome is. */
  home: Character
  reach: number
  moments: Moments
  /** Its resting values: every knob its implementation offers, and no others. */
  knobs: Readonly<Record<string, number>>
  /** What makes it move. Nothing it enables may sit still. */
  mapping: readonly StudyMapping[]
  cost: Cost
  /** Studies it must not share a cast with: two full-frame inks, two flows that fight. */
  excludes?: readonly string[]
  /**
   * Implementations that must be live in the same cast. The dye ink draws the
   * fluid's dye, so it has nothing to draw unless a fluid flow is stirring it;
   * a cast that asks for one without the other is rejected rather than drawn
   * as an empty frame.
   */
  requires?: readonly ImplId[]
}

export type FlowStudy = Shape & { kind: 'flow' }
export type InkStudy = Shape & { kind: 'ink' }

/**
 * A look is the post stack: its knobs are post knobs, and it also says which
 * stages it switches on. Feedback and the ribbon are deliberately not among
 * them. The feedback is the canvas itself and belongs to the cast, and the
 * ribbon is an ink that happens to be drawn by the post stack.
 */
export type LookStudy = Shape & { kind: 'look'; stages: readonly LookStage[] }

export type Study = FlowStudy | InkStudy | LookStudy

export const isLook = (study: Study): study is LookStudy => study.kind === 'look'
