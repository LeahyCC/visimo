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
import { ANALYTIC_KNOBS, KALEIDOSCOPE_KNOBS, SHARD_KNOBS } from '../presets/knobs'
import type { AnalyticKnob, FluidKnob, KaleidoscopeKnob, ShardKnob } from '../presets/knobs'
import type { SceneId } from '../scenes/catalog'

export const IMPL_IDS = [
  'fluid',
  'analytic',
  'dye',
  'fractal',
  'ribbon',
  'streaks',
  'shards',
  'dust',
  'caustics',
  'halo',
  'rings',
  'spectrum',
  'sparks',
  'lasers',
  'look',
] as const
export type ImplId = (typeof IMPL_IDS)[number]

/**
 * The scene an implementation used to be, for `data-scene`. That attribute is
 * public API a consumer's tests assert on and a cast has no single scene, so
 * the two implementations that were scenes keep their names: the dye is the
 * fluid and the fractal is the kaleidoscope. `sceneOf` in `registry.ts` is
 * what reads this.
 */
export const IMPL_SCENES: Readonly<Partial<Record<ImplId, SceneId>>> = {
  dye: 'fluid',
  fractal: 'kaleidoscope',
}

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
 * The streaks' numbers. Their ranges and what each one means in pixels are in
 * `impls/streaks.params.ts`; this is only the vocabulary a study may name.
 */
export const STREAKS_KNOBS = [
  'count',
  'length',
  'speed',
  'width',
  'intensity',
  'hueSpread',
] as const
export type StreaksKnob = (typeof STREAKS_KNOBS)[number]

/**
 * The dust's numbers. Their ranges and units are in `impls/dust.params.ts`.
 * `gather` is the one that is not a property of a speck: it pulls every
 * speck's place toward the middle of the canvas, which is what tension does.
 */
export const DUST_KNOBS = [
  'count',
  'size',
  'drift',
  'twinkle',
  'intensity',
  'hueSpread',
  'gather',
] as const
export type DustKnob = (typeof DUST_KNOBS)[number]

/**
 * The caustics' numbers. Their ranges and units are in
 * `impls/caustics.params.ts`. `sharpness` is the one that keeps the ink
 * sparse: it raises the pattern to a power, so a higher one leaves thinner
 * lines and more black between them.
 */
export const CAUSTICS_KNOBS = ['intensity', 'scale', 'speed', 'sharpness', 'hueSpread'] as const
export type CausticsKnob = (typeof CAUSTICS_KNOBS)[number]

/**
 * The halo's numbers. Their ranges and units are in `impls/halo.params.ts`.
 * `hollow` moves the peak of the falloff out from the middle, so the glow can
 * open into a ring, and `hue` is an offset from the ribbon's colour at the key.
 */
export const HALO_KNOBS = ['radius', 'hollow', 'softness', 'intensity', 'hue'] as const
export type HaloKnob = (typeof HALO_KNOBS)[number]

/**
 * The rings' numbers. Their ranges and units are in `impls/rings.params.ts`.
 * `rate` is rings a beat and is snapped to 1, 2 or 4 there, so a build's roll
 * is the tempo's own subdivisions; `speed` is in frame heights a second and
 * `life` in seconds.
 */
export const RINGS_KNOBS = ['rate', 'speed', 'thickness', 'intensity', 'life', 'hueSpread'] as const
export type RingsKnob = (typeof RINGS_KNOBS)[number]

/**
 * The spectrum ring's numbers. Their ranges and units are in
 * `impls/spectrum.params.ts`. `radius` is where the bars' feet stand and
 * `length` how far a bar at full level reaches from them, both fractions of
 * the short side; `spin` is in turns a second, and `hueSpread` is the palette
 * run from the sub's pole of the ring to the treble's.
 */
export const SPECTRUM_KNOBS = [
  'bars',
  'radius',
  'length',
  'width',
  'intensity',
  'hueSpread',
  'spin',
] as const
export type SpectrumKnob = (typeof SPECTRUM_KNOBS)[number]

/**
 * The sparks' numbers. Their ranges and units are in `impls/sparks.params.ts`.
 * `rate` is sparks a second at most and is what the bucket refills at, `count`
 * is how many one hit throws, `speed` is short sides a second at birth and
 * `life` is seconds.
 */
export const SPARKS_KNOBS = [
  'rate',
  'count',
  'speed',
  'life',
  'size',
  'intensity',
  'hueSpread',
] as const
export type SparksKnob = (typeof SPARKS_KNOBS)[number]

/**
 * The lasers' numbers. Their ranges and units are in `impls/lasers.params.ts`.
 * `fans` is how many beams' origins stand along the edges and `beams` how many
 * beams one fan carries, both counts; `spread` is the fan's opening in radians
 * and `sweep` the swing amplitude, the beat clock driving the position; `flick`
 * is how much one beam answers the treble.
 */
export const LASER_KNOBS = [
  'fans',
  'beams',
  'spread',
  'sweep',
  'width',
  'glow',
  'intensity',
  'flick',
  'hue',
] as const
export type LaserKnob = (typeof LASER_KNOBS)[number]

/**
 * The stages a look may switch on. The ribbon is an ink and the feedback is
 * the canvas, so neither is a look's to enable.
 */
export const LOOK_STAGES = ['bloom', 'chromatic', 'grade', 'tonemap', 'grain'] as const
export type LookStage = (typeof LOOK_STAGES)[number]

const lookStages: readonly PostStage[] = LOOK_STAGES

/** Every post knob belonging to a stage a look owns. */
export const LOOK_KNOBS: readonly PostKnob[] = POST_KNOBS.filter((knob) =>
  lookStages.some((stage) => knob.startsWith(`${stage}.`)),
)

/**
 * The knobs that say how much of a stage there is, as opposed to how it is
 * shaped: at their neutral value the stage does nothing. When one look has a
 * stage and the look it is fading against does not, these are what carry the
 * fade, so the stage thins to nothing before it is switched off. The tonemap
 * has none; it has no amount, only a curve.
 */
export const LOOK_STRENGTH_KNOBS = [
  'bloom.intensity',
  'chromatic.amount',
  'chromatic.beat',
  'grade.vignette',
  'grade.saturation',
  'grade.weave',
  'grain.amount',
] as const satisfies readonly PostKnob[]

export type LookStrengthKnob = (typeof LOOK_STRENGTH_KNOBS)[number]

/**
 * What each strength knob is at when its stage does nothing, which is the
 * value a fade toward "the look that has no such stage" has to head for. It is
 * 0 for every knob that adds something, and it is not for the saturation,
 * which rests at 1: 0 there is grey, so a look leaving with a drained colour
 * would drain toward grey on the way out if the fade went to 0, and the frame
 * would then snap back to full colour when the stage switched off. Record
 * typed on the list above, so a strength knob cannot be added without saying
 * what its neutral is.
 */
export const LOOK_NEUTRAL: Readonly<Record<LookStrengthKnob, number>> = {
  'bloom.intensity': 0,
  'chromatic.amount': 0,
  'chromatic.beat': 0,
  'grade.vignette': 0,
  'grade.saturation': 1,
  'grade.weave': 0,
  'grain.amount': 0,
}

export const isLookStrength = (knob: string): knob is LookStrengthKnob =>
  (LOOK_STRENGTH_KNOBS as readonly string[]).includes(knob)

/**
 * Knobs that count something rather than measure it. Two studies of one
 * implementation are stepped as one, with their knobs blended by presence,
 * and half an emitter is not a thing the solver can draw. These two are the
 * counts among the solver's knobs, which are the only ones anything blends
 * today; a new one belongs here as soon as it exists.
 */
export const COUNT_KNOBS = ['emitters', 'events'] as const satisfies readonly FluidKnob[]

export const isCountKnob = (knob: string): boolean =>
  (COUNT_KNOBS as readonly string[]).includes(knob)

export type ImplKnob =
  | FluidKnob
  | AnalyticKnob
  | KaleidoscopeKnob
  | ShardKnob
  | PostKnob
  | StreaksKnob
  | DustKnob
  | CausticsKnob
  | HaloKnob
  | RingsKnob
  | SpectrumKnob
  | SparksKnob
  | LaserKnob

/** What each implementation accepts. A study's knobs are exactly one of these lists. */
export const IMPL_KNOBS: Readonly<Record<ImplId, readonly ImplKnob[]>> = {
  fluid: FLUID_SOLVER_KNOBS,
  analytic: ANALYTIC_KNOBS,
  dye: FLUID_DYE_KNOBS,
  fractal: KALEIDOSCOPE_KNOBS,
  ribbon: RIBBON_KNOBS,
  streaks: STREAKS_KNOBS,
  shards: SHARD_KNOBS,
  dust: DUST_KNOBS,
  caustics: CAUSTICS_KNOBS,
  halo: HALO_KNOBS,
  rings: RINGS_KNOBS,
  spectrum: SPECTRUM_KNOBS,
  sparks: SPARKS_KNOBS,
  lasers: LASER_KNOBS,
  look: LOOK_KNOBS,
}

export const implKnobs = (impl: ImplId): readonly ImplKnob[] => IMPL_KNOBS[impl]

export const isImplKnob = (impl: ImplId, value: string): value is ImplKnob =>
  (IMPL_KNOBS[impl] as readonly string[]).includes(value)
