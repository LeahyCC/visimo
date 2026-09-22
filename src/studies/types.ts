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
 * each of them accepts; `defs/` holds the studies themselves and `registry.ts` lists them.
 */
import type { PaletteId } from '../palettes/palette'
import { AUDIO_FIELDS } from '../presets/knobs'
import type { AudioField, Curve, Shape } from '../presets/knobs'
// Types only, so nothing runs in a circle: `cast.ts` reads values from here
// and this file reads only the shape of a canvas knob and a canvas row back.
import type { CanvasKnob, CanvasMapping } from './cast'
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
 * A second field that multiplies a row's signal, with a curve of its own. It
 * is what lets one row say "this much, and more of it when the track is
 * loud": a pulse scaled by `energy` is a pulse whose depth grows with the
 * level, where two rows can only ever add a pulse and a level together.
 *
 * It multiplies the signal and not the finished contribution, so the scale
 * sits inside whatever `Shape` the row carries. The level at the moment a hit
 * lands is then what sets the height of the swell an envelope makes of it,
 * and a quiet passage a second later does not shrink a swell already
 * ringing; the other way round, a shape's output modulated after the fact,
 * is what two rows and a multiply would have to be.
 */
export type StudyScale = {
  from: StudyField
  curve: Curve
}

/**
 * One row of a study's mapping, read exactly as a preset's is:
 *
 *   value = knobs[to] + gain × shape(curve(field[from]) × scale)
 *
 * `to` is a knob of the study's own implementation and nothing else, so two
 * studies in one cast cannot fight over the same number by accident.
 *
 * `scale` and `shape` are both optional and a row with neither is the row it
 * always was, `gain × curve(field[from])`, evaluated by the same arithmetic.
 * `scale` is a second field multiplying the signal and `shape` a stage with a
 * memory over it, stepped by the real `dt`; `presets/knobs.ts` says what each
 * shape does and `presets/shapes.ts` how. The state a shape remembers is the
 * resolver's, one per study and row, so a row is still data and two casts
 * holding the same study do not share a spring.
 */
export type StudyMapping = {
  from: StudyField
  to: ImplKnob
  gain: number
  curve: Curve
  scale?: StudyScale
  shape?: Shape
}

/** What a study costs, so a director can keep a cast inside the frame budget. */
export const COSTS = ['cheap', 'medium', 'heavy'] as const
export type Cost = (typeof COSTS)[number]

/**
 * What every study says, whatever kind it is. Named for the piece rather than
 * for its shape, because a mapping row's `Shape` is the word's other use in
 * this layer: a stage with a memory over a row's signal.
 */
type Piece = {
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

/**
 * What a flow changes about the canvas for as long as it is live: resting
 * numbers of its own over the ones the canvas already has, and rows of its
 * own on top of the canvas's.
 *
 * The canvas is the cast's and not a study's, which is what keeps a look
 * swap from throwing the picture away, so this is the one way anything in a
 * cast can speak to it. The director merges it over `carriedCanvas()` while
 * the study is live and lerps each knob from the canvas's own value by the
 * study's presence, so a fold arrives and leaves with the flow that asked for
 * it rather than snapping on. A pinned cast's canvas file still wins: a
 * pinned cast is one fixed picture and nothing in it moves.
 *
 * Only a flow may carry one. A cast has exactly one flow, so there is exactly
 * one patch; two inks patching the same canvas would fight over the same
 * numbers with no rule for who wins.
 *
 * It takes no `scale` and no `shape`, for the reason `CanvasMapping` gives:
 * the canvas keeps no memory of its own.
 */
export type StudyCanvas = {
  knobs?: Readonly<Partial<Record<CanvasKnob, number>>>
  mapping?: readonly CanvasMapping[]
}

export type FlowStudy = Piece & { kind: 'flow'; canvas?: StudyCanvas }
export type InkStudy = Piece & { kind: 'ink' }

/**
 * A look is the post stack: its knobs are post knobs, and it also says which
 * stages it switches on. Feedback and the ribbon are deliberately not among
 * them. The feedback is the canvas itself and belongs to the cast, and the
 * ribbon is an ink that happens to be drawn by the post stack.
 *
 * It also names the palette the picture is coloured in. The director already
 * chooses the look by the song's character and the moment, so the colour comes
 * with it: a look owns how the picture is shown, and colour is part of that.
 * When two looks are live the palettes cross-fade by presence, as the looks do.
 */
export type LookStudy = Piece & {
  kind: 'look'
  stages: readonly LookStage[]
  palette: PaletteId
}

export type Study = FlowStudy | InkStudy | LookStudy

export const isLook = (study: Study): study is LookStudy => study.kind === 'look'
