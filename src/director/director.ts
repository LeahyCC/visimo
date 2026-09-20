/**
 * The thing that chooses. Once a frame it is handed the packet and the real
 * `dt`, and it hands back whatever is live and what each of them is faded to:
 *
 *   every frame:   character (slow)  -+
 *                  moment (medium)   -+- score = closeness to home x moment fit
 *                  section, recall   -+
 *
 *   at a section boundary, or on impact:
 *      pick a cast  =  1 flow + 1 to 3 inks + 1 look
 *                      inside the cost budget, honouring excludes and requires
 *      a section that comes back gets the cast it had
 *
 *   between boundaries:
 *      presences glide over seconds, nothing pops
 *      a challenger needs a clear margin to unseat a member
 *      tension is passed on for every live study to read
 *
 * Nothing here touches the GPU or the DOM, and nothing here reads the clock.
 * Every time is a span of `dt` and every trigger is a level in the packet, so
 * the same track picks the same casts at the same moments on any machine at
 * any frame rate. Determinism is the point: a song should look the way it
 * looked last time.
 *
 * Changes land on the music and never on a timer. The extractor confirms a
 * section about six seconds after it began, so `novelty` and `impact` are the
 * fast signals: a novelty spike starts a fade toward a challenger and the
 * confirmed section settles it. A drop is the exception to the gliding, and
 * arrives as a cut, because it is the biggest moment in most tracks and a
 * two-second crossfade throws it away.
 *
 * The output is the `LiveCast` of `studies/resolve.ts`, which is what the
 * renderer draws and what a pinned cast is turned into: unlike a cast it may
 * hold two flows or two looks at once, which is what the middle of a change
 * looks like. A study at presence 0 is not in it at all, so the renderer
 * never touches one that is not on screen. The cast, its list and its entries
 * are the same objects every frame.
 */
import { F } from '../audio/FeatureExtractor'
import { defaultCanvas, MAX_INKS } from '../studies/cast'
import type { Cast, CastOverride } from '../studies/cast'
import { STUDIES } from '../studies/registry'
import type { LiveCast, LiveStudy } from '../studies/resolve'
import { CHARACTER_AXES } from '../studies/types'
import type { Character, Cost, Study } from '../studies/types'
import { CharacterReader } from './character'
import { MomentReader } from './moment'
import type { MomentWeights } from './moment'
import { place, scoreStudy } from './score'

/** What each cost is worth against the budget. */
export const COST_OF: Readonly<Record<Cost, number>> = { cheap: 1, medium: 2, heavy: 4 }

/**
 * What a cast may spend. Eight buys a fluid flow, three cheap inks and a
 * look, or a fluid flow, the heavy fractal, one cheap ink and a look.
 */
export const DEFAULT_BUDGET = 8

/** How far a challenger has to be ahead of a sitting member to unseat it. */
export const DEFAULT_MARGIN = 0.06

/** How long a change takes when it is not a drop, and when it is. */
export const DEFAULT_GLIDE_SECONDS = 3
export const DEFAULT_CUT_SECONDS = 0.08

/** How many of the top scorers a section may rotate among. */
export const DEFAULT_VARIETY = 3

/**
 * An ink has to score this much of what the best ink scored to be worth a
 * slot. Without it a cast fills to `MAX_INKS` whenever the budget allows,
 * and the third ink is whatever was left rather than anything the song asked
 * for.
 */
const INK_SHARE = 0.4

/**
 * `impact` is 1 on the frame the payoff lands and falls to 1/e in 180 ms.
 * The trigger sits at a half and not near the top, because the packet that
 * holds the 1 can be the one a janky frame never reads: one packet late at
 * 30 frames a second already reads 0.83. Nothing but a fresh impact climbs
 * through a half, and the rearm below it is what makes one drop one cut, so
 * the low trigger costs nothing.
 */
const IMPACT_ON = 0.5
const IMPACT_OFF = 0.3

/**
 * How settled the character has to be before a section's cast is worth
 * remembering. Below it the pick is the neutral opening guess, and a track
 * that opens straight into its main groove would have that guess handed back
 * every time the groove returned.
 */
const MEMORY_SETTLED = 0.5

/** What the extractor itself calls a candidate boundary, and where it rearms. */
const NOVELTY_ON = 0.4
const NOVELTY_OFF = 0.25

/** A moment no study is written for still needs a picture. See `valueOf`. */
const LAST_RESORT = 1e-4

/** What the director builds: a cast without a file, so without overrides. */
export type PickedCast = {
  flow?: string
  inks: readonly string[]
  look: string
}

export type PickOptions = {
  /** Anything that is a `Study`. The registry when nothing says otherwise. */
  studies?: readonly Study[]
  character: Character
  weights: MomentWeights
  settled?: number
  /** Who is on screen now. They keep their seats unless beaten by the margin. */
  sitting?: PickedCast
  margin?: number
  budget?: number
  variety?: number
  /**
   * Which of the top few to take, so two sections that score the same get
   * cousins rather than copies. 0 is the best scorer, which is what a pick
   * that is not a section boundary uses.
   */
  rotation?: number
}

type Scored = { study: Study; value: number }

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

const holds = (cast: PickedCast | undefined, id: string): boolean =>
  cast !== undefined && (cast.flow === id || cast.look === id || cast.inks.includes(id))

/**
 * A study's worth to this pick: its score, a sitting member's margin on top,
 * and a floor under it all. The floor is what answers a moment no study in
 * the registry claims: every score is then 0, and the order falls back to who
 * is nearest home rather than to whichever id sorted first.
 */
function valueOf(study: Study, options: PickOptions, settled: number): number {
  const score = scoreStudy(study, options.character, options.weights, settled)
  const margin = holds(options.sitting, study.id) ? (options.margin ?? DEFAULT_MARGIN) : 0
  return Math.max(score, LAST_RESORT * place(study, options.character, settled)) + margin
}

/** Best first, and by id where two are worth exactly the same, so it is stable. */
function byValue(a: Scored, b: Scored): number {
  if (a.value !== b.value) return b.value - a.value
  return a.study.id < b.study.id ? -1 : 1
}

/**
 * One of the candidates: the best, or a rotation among those within the
 * margin of the best. The margin does both jobs here. A pick that is not a
 * boundary passes rotation 0 and takes the best, so a sitting member carrying
 * its margin keeps its seat and a hair's difference changes nothing. A
 * confirmed boundary passes a rotation, and the music having changed is the
 * licence to move within the group.
 */
function choose(scored: Scored[], rotation: number, margin: number, variety: number): Study {
  const best = scored[0]
  if (!best) throw new Error('director: nothing to choose from')
  if (rotation === 0) return best.study
  let group = 1
  while (
    group < scored.length &&
    group < variety &&
    (scored[group]?.value ?? 0) >= best.value - margin
  )
    group += 1
  return (scored[((rotation % group) + group) % group] ?? best).study
}

/** Two studies may not share a cast if either one says so. */
const agrees = (study: Study, held: readonly Study[]): boolean =>
  !held.some(
    (other) =>
      (study.excludes ?? []).includes(other.id) || (other.excludes ?? []).includes(study.id),
  )

/** Everything a study needs beside it has to be in the cast already. */
const supplied = (study: Study, held: readonly Study[]): boolean =>
  (study.requires ?? []).every((impl) => held.some((other) => other.impl === impl))

/**
 * A cast for this character and this moment, or undefined when the studies
 * handed in cannot make one (no look, or no ink that will sit with the rest).
 *
 * Pure: everything it reads is an argument, and it reads a study through the
 * `Study` type alone, so a study added to the registry tomorrow is picked
 * here without a line changing. The flow and the look go first because a cast
 * cannot be drawn without them, and the inks then fill what is left of the
 * budget. The first ink is taken whatever it costs, since a cast with no ink
 * draws nothing at all, and a budget too small for it is a budget that was
 * always going to be overspent.
 */
export function pickCast(options: PickOptions): PickedCast | undefined {
  const studies = options.studies ?? STUDIES
  const settled = clamp01(options.settled ?? 1)
  const margin = options.margin ?? DEFAULT_MARGIN
  const variety = Math.max(1, options.variety ?? DEFAULT_VARIETY)
  const budget = options.budget ?? DEFAULT_BUDGET
  const rotation = options.rotation ?? 0

  const rank = (kind: Study['kind']): Scored[] =>
    studies
      .filter((study) => study.kind === kind)
      .map((study) => ({ study, value: valueOf(study, options, settled) }))
      .sort(byValue)

  const looks = rank('look')
  if (looks.length === 0) return undefined
  const look = choose(looks, rotation, margin, variety)
  const flows = rank('flow')
  const flow = flows.length > 0 ? choose(flows, rotation, margin, variety) : undefined

  const held: Study[] = flow ? [flow, look] : [look]
  let spent = held.reduce((sum, study) => sum + COST_OF[study.cost], 0)
  const inks: string[] = []
  const pool = rank('ink')
  const floor = (pool[0]?.value ?? 0) * INK_SHARE
  while (inks.length < MAX_INKS) {
    const room = inks.length === 0 ? Infinity : budget - spent
    const fits = pool.filter(
      (entry) =>
        !inks.includes(entry.study.id) &&
        entry.value >= floor &&
        COST_OF[entry.study.cost] <= room &&
        agrees(entry.study, held) &&
        supplied(entry.study, held),
    )
    if (fits.length === 0) break
    // The rotation walks on per slot, so two sections that want the same
    // three inks are handed them in different combinations rather than the
    // same one twice over.
    const taken = choose(fits, rotation === 0 ? 0 : rotation + inks.length, margin, variety)
    inks.push(taken.id)
    held.push(taken)
    spent += COST_OF[taken.cost]
  }

  if (inks.length === 0) return undefined
  return flow ? { flow: flow.id, inks, look: look.id } : { inks, look: look.id }
}

/**
 * A small integer from the track's character, so that two tracks do not
 * rotate through the same cousins in the same order. It is read once, when
 * the character has settled, and kept for the track: see `trackSeed`. The
 * character is rounded to quarters, which is coarse enough that a track sits
 * well inside a cell on most axes and fine enough that lo-fi and hardstyle
 * land in different ones. Never the clock and never `Math.random`.
 */
function characterSeed(character: Character): number {
  let hash = 0
  for (const axis of CHARACTER_AXES)
    hash = (hash ^ (Math.round(character[axis] * 4) * 2246822519)) >>> 0
  return hash % 1009
}

/** Where a section starts counting its rotation from. */
const seedOf = (section: number, trackSeed: number): number =>
  ((Math.round(section) * 2654435761 + trackSeed) >>> 0) % 1009

export type DirectorOptions = {
  studies?: readonly Study[]
  /** What a host that knows the track hands in, as `CharacterReader` takes it. */
  start?: Partial<Character>
  budget?: number
  margin?: number
  glideSeconds?: number
  cutSeconds?: number
  variety?: number
  /**
   * A fixed cast, which turns the director off: it returns that cast at
   * presence 1 and nothing else, and still passes tension through.
   */
  pinned?: Cast
}

export class Director {
  private readonly studies: readonly Study[]
  private readonly budget: number
  private readonly margin: number
  private readonly variety: number
  private readonly glideSeconds: number
  private readonly cutSeconds: number
  private readonly pinned: Cast | undefined

  private readonly reader: CharacterReader
  private readonly moment = new MomentReader()

  // Presence by study id, in the order each first arrived, and one `LiveStudy`
  // per id kept beside it. Both are written in place from frame to frame; the
  // only allocation is the first time a study is ever cast.
  private readonly presence = new Map<string, number>()
  private readonly entries = new Map<string, LiveStudy>()
  private readonly live: LiveStudy[] = []
  private readonly frame: LiveCast

  /** The cast a section had, so a section that comes back comes back to it. */
  private readonly memory = new Map<number, PickedCast>()

  private current: PickedCast | undefined
  private section = 0
  private rank = 0
  /**
   * The character's share of the rotation seed, read once when the character
   * has settled and then kept. The first cut hashed the character afresh at
   * every boundary, to sixteenths, and that undid the determinism it was
   * there for: real analyser packets differ a little from one play to the
   * next, some axis was within that little of a rounding edge at most
   * boundaries, and the same song then rotated to different cousins. Read
   * once, there is one such chance in a track and not one per section.
   * Undefined until then, and the seed is the section's alone.
   */
  private trackSeed: number | undefined
  private ramp = DEFAULT_GLIDE_SECONDS
  private impactHeld = false
  private noveltyHeld = false

  constructor(options: DirectorOptions = {}) {
    this.studies = options.studies ?? STUDIES
    this.budget = options.budget ?? DEFAULT_BUDGET
    this.margin = options.margin ?? DEFAULT_MARGIN
    this.variety = Math.max(1, options.variety ?? DEFAULT_VARIETY)
    this.glideSeconds = Math.max(0, options.glideSeconds ?? DEFAULT_GLIDE_SECONDS)
    this.cutSeconds = Math.max(0, options.cutSeconds ?? DEFAULT_CUT_SECONDS)
    this.pinned = options.pinned
    this.reader = new CharacterReader({ start: options.start })
    this.ramp = this.glideSeconds
    this.frame = {
      studies: this.live,
      canvas: this.pinned?.canvas ?? defaultCanvas(),
      tension: 0,
    }

    if (this.pinned) this.holdPinned(this.pinned)
  }

  /** Where the song sits, and how far that is to be believed. */
  get character(): Character {
    return this.reader.character
  }

  get settled(): number {
    return this.reader.settled
  }

  get weights(): MomentWeights {
    return this.moment.weights
  }

  /** What is meant to be on screen, before the fades. Undefined until the first pick. */
  get cast(): PickedCast | undefined {
    return this.current
  }

  step(features: Float32Array, dt: number): LiveCast {
    this.frame.tension = features[F.tension] ?? 0
    // Read even when a cast is pinned and nothing will be chosen by them: a
    // host saves the character for the next play of the track, and the
    // overlay shows both, under a pinned preset as much as under none.
    const character = this.reader.step(features, dt)
    const weights = this.moment.step(features, dt)
    if (this.pinned) return this.frame
    const settled = this.reader.settled
    if (this.trackSeed === undefined && settled >= 1) this.trackSeed = characterSeed(character)
    const section = features[F.section] ?? 0
    const impact = this.fired(features[F.impact] ?? 0)
    const novelty = this.spiked(features[F.novelty] ?? 0)
    const boundary = section > 0 && section !== this.section
    if (boundary) {
      this.section = section
      this.rank += 1
    }

    if (boundary || !this.current) this.settle(section, character, weights, settled, impact)
    else if (impact) this.challenge(character, weights, settled, this.cutSeconds)
    else if (novelty) this.challenge(character, weights, settled, this.glideSeconds)

    this.fade(dt)
    return this.frame
  }

  /**
   * A confirmed section. It either comes back to the cast it had, which is
   * what `recall` and a section id are for, or it picks a fresh one and
   * remembers it under that id.
   */
  private settle(
    section: number,
    character: Character,
    weights: MomentWeights,
    settled: number,
    cut: boolean,
  ) {
    const remembered = section > 0 ? this.memory.get(section) : undefined
    if (remembered) {
      this.take(remembered, cut ? this.cutSeconds : this.glideSeconds)
      return
    }

    // Nothing has been confirmed yet, so there is nothing to rotate against:
    // the opening cast is the plain best, which while the character is still
    // a guess is the neutral one.
    const rotation = section > 0 ? this.rank + seedOf(section, this.trackSeed ?? 0) : 0
    const picked = this.pick(character, weights, settled, rotation)
    if (!picked) return
    if (section > 0 && settled >= MEMORY_SETTLED) this.memory.set(section, picked)
    this.take(picked, cut ? this.cutSeconds : this.glideSeconds)
  }

  /**
   * A fast signal between boundaries: a novelty spike, which may be a
   * boundary the extractor has not confirmed yet, or an impact. Neither is
   * remembered, because neither is a section; the confirmed section that
   * follows settles what the cast really is. Rotation is 0, so a sitting
   * member keeps its seat unless the music has genuinely moved on.
   */
  private challenge(character: Character, weights: MomentWeights, settled: number, ramp: number) {
    const picked = this.pick(character, weights, settled, 0)
    if (picked) this.take(picked, ramp)
  }

  private pick(
    character: Character,
    weights: MomentWeights,
    settled: number,
    rotation: number,
  ): PickedCast | undefined {
    return pickCast({
      studies: this.studies,
      character,
      weights,
      settled,
      sitting: this.current,
      margin: this.margin,
      budget: this.budget,
      variety: this.variety,
      rotation,
    })
  }

  private take(cast: PickedCast, ramp: number) {
    this.current = cast
    this.ramp = ramp
    for (const id of cast.flow ? [cast.flow, ...cast.inks, cast.look] : [...cast.inks, cast.look])
      if (!this.presence.has(id)) this.presence.set(id, 0)
  }

  /**
   * One frame of the fades, and the live list rebuilt from them. Linear in
   * `dt` rather than exponential: a fade that is a fixed share of what is
   * left never arrives, and the drop needs its cast to be whole within a few
   * frames and not asymptotically close to it.
   */
  private fade(dt: number) {
    const step = this.ramp > 0 ? dt / this.ramp : 1
    this.live.length = 0
    for (const [id, presence] of this.presence) {
      const wanted = holds(this.current, id) ? 1 : 0
      const moved = presence + (wanted > presence ? step : -step)
      const next = wanted > presence ? Math.min(wanted, moved) : Math.max(wanted, moved)
      if (next <= 0) {
        this.presence.delete(id)
        continue
      }

      this.presence.set(id, next)
      let entry = this.entries.get(id)
      if (!entry) {
        entry = { id, presence: next, override: undefined }
        this.entries.set(id, entry)
      }

      entry.presence = next
      this.live.push(entry)
    }
  }

  /** A pinned cast is built once and never changes; only tension moves. */
  private holdPinned(cast: Cast) {
    const ids = cast.flow ? [cast.flow, ...cast.inks, cast.look] : [...cast.inks, cast.look]
    for (const id of ids) {
      const override: CastOverride | undefined = cast.overrides[id]
      const entry: LiveStudy = { id, presence: 1, override }
      this.entries.set(id, entry)
      this.live.push(entry)
    }
  }

  /** `impact` read the way a scene reads a hit, with a rearm so one drop is one cut. */
  private fired(impact: number): boolean {
    if (!this.impactHeld && impact >= IMPACT_ON) {
      this.impactHeld = true
      return true
    }

    if (impact < IMPACT_OFF) this.impactHeld = false
    return false
  }

  /** The same for `novelty`, which lifts a second or two before a section is confirmed. */
  private spiked(novelty: number): boolean {
    if (!this.noveltyHeld && novelty >= NOVELTY_ON) {
      this.noveltyHeld = true
      return true
    }

    if (novelty < NOVELTY_OFF) this.noveltyHeld = false
    return false
  }
}
