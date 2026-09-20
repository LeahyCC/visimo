/**
 * The implementations a study may be drawn by, and the knobs each of them
 * accepts. This is vocabulary rather than machinery, like `presets/knobs.ts`:
 * it names what exists and nothing here draws anything.
 *
 * A study says which implementation draws it, so two studies can share one.
 * Lazy fluid and turbulent fluid are the same solver at different numbers,
 * and the director may hold that solver across a swap rather than throwing
 * the field away.
 *
 * Adding an implementation is its id in `IMPL_IDS` and its knob list in
 * `IMPL_KNOBS`. Nothing else in this layer needs to know about it; the
 * renderer card that draws it is where the work is.
 */
import { POST_KNOBS } from '../post/params'
import type { PostKnob, PostStage } from '../post/params'
import { KALEIDOSCOPE_KNOBS } from '../presets/knobs'
import type { FluidKnob, KaleidoscopeKnob } from '../presets/knobs'

export const IMPL_IDS = ['fluid', 'dye', 'fractal', 'ribbon', 'look'] as const
export type ImplId = (typeof IMPL_IDS)[number]

export const isImplId = (value: string): value is ImplId =>
  (IMPL_IDS as readonly string[]).includes(value)

/**
 * The solver's half of the fluid's knobs: everything that decides how the
 * field moves and where the emitters are, and nothing about how the dye
 * looks. It is exactly the set Melt already names in `flowParams`, which is
 * the same split made by hand when the fluid first ran under another scene.
 *
 * Three of them were hard to place, because one splat carries both an impulse
 * and a puff of dye:
 *
 * - `radius` and `eventRadius` size that splat, so they shape the dye as much
 *   as the push. They are here because the splat's geometry belongs with the
 *   thing that decides where the splat is.
 * - `spread`, `orbitSpeed`, `emitters` and `voice` place the emitters, which
 *   is the same argument.
 * - `dyeDecay` is a field decay and looks like a sibling of `velocityDecay`,
 *   but it decays the dye, which is the picture and not the motion, so it
 *   sits with the ink.
 */
export const FLUID_SOLVER_KNOBS = [
  'velocityDecay',
  'vorticity',
  'viscosity',
  'spread',
  'force',
  'hitForce',
  'radius',
  'orbitSpeed',
  'emitters',
  'voice',
  'events',
  'eventLife',
  'eventForce',
  'eventRadius',
] as const satisfies readonly FluidKnob[]

/** The dye's half: what is drawn into the field the solver is stirring. */
export const FLUID_DYE_KNOBS = [
  'dyeDecay',
  'intensity',
  'saturation',
  'dye',
  'hitDye',
  'colourShift',
  'colourDrift',
  'eventDye',
] as const satisfies readonly FluidKnob[]

/** The ribbon's numbers, which are post knobs today because that is where it draws. */
export const RIBBON_KNOBS = [
  'ribbon.intensity',
  'ribbon.width',
  'ribbon.height',
  'ribbon.shape',
] as const satisfies readonly PostKnob[]

/**
 * The stages a look may switch on. The ribbon is an ink and the feedback is
 * the canvas, so neither is a look's to enable.
 */
export const LOOK_STAGES = ['bloom', 'chromatic', 'tonemap', 'grain'] as const
export type LookStage = (typeof LOOK_STAGES)[number]

const lookStages: readonly PostStage[] = LOOK_STAGES

/** Every post knob belonging to a stage a look owns. */
export const LOOK_KNOBS: readonly PostKnob[] = POST_KNOBS.filter((knob) =>
  lookStages.some((stage) => knob.startsWith(`${stage}.`)),
)

/**
 * The knobs that say how much of a stage there is, as opposed to how it is
 * shaped: at zero the stage draws nothing. When one look has a stage and the
 * look it is fading against does not, these are what carry the fade, so the
 * stage thins to nothing before it is switched off. The tonemap has none; it
 * has no amount, only a curve.
 */
export const LOOK_STRENGTH_KNOBS = [
  'bloom.intensity',
  'chromatic.amount',
  'chromatic.beat',
  'grain.amount',
] as const satisfies readonly PostKnob[]

export const isLookStrength = (knob: string): boolean =>
  (LOOK_STRENGTH_KNOBS as readonly string[]).includes(knob)

export type ImplKnob = FluidKnob | KaleidoscopeKnob | PostKnob

/** What each implementation accepts. A study's knobs are exactly one of these lists. */
export const IMPL_KNOBS: Readonly<Record<ImplId, readonly ImplKnob[]>> = {
  fluid: FLUID_SOLVER_KNOBS,
  dye: FLUID_DYE_KNOBS,
  fractal: KALEIDOSCOPE_KNOBS,
  ribbon: RIBBON_KNOBS,
  look: LOOK_KNOBS,
}

export const implKnobs = (impl: ImplId): readonly ImplKnob[] => IMPL_KNOBS[impl]

export const isImplKnob = (impl: ImplId, value: string): value is ImplKnob =>
  (IMPL_KNOBS[impl] as readonly string[]).includes(value)
