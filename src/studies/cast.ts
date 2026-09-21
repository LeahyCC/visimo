/**
 * A cast: the handful of studies live at once, and the canvas they draw on.
 * One flow, one to three inks, one look, and whatever each of them is patched
 * with. A pinned cast is a cast with an id and a name, which is what a host
 * that wants a fixed look asks for and what the five files beside this one
 * are; the director will build unpinned ones on the fly.
 *
 * `parseCast` turns an unknown value into one, or throws saying what is wrong
 * with it, in the style of `presets/parse.ts` and sharing its narrowing. The
 * cast files are compiled in rather than fetched, so a failure is a mistake
 * in the repository, and every message names the file and the path inside it.
 */
import { DEFAULT_POST_PARAMS } from '../post/params'
import type { PostKnob } from '../post/params'
import type { Curve } from '../presets/knobs'
import { CURVES } from '../presets/knobs'
import {
  describe,
  fail,
  isRecord,
  list,
  readBoolean,
  readNumber,
  readString,
} from '../presets/parse'
import { implKnobs, isImplKnob } from './impls'
import { findStudy } from './registry'
import { STUDY_FIELDS } from './types'
import type { Study, StudyField, StudyMapping } from './types'

/**
 * The feedback, which is the canvas itself and not a look. It is what carries
 * the picture from one frame to the next: how much of the last frame is kept,
 * how it decays, and how it is moved before it is added back. A look decides
 * how the canvas is shown and is swapped without touching what the canvas
 * holds, so putting these numbers in a look would throw the picture away
 * every time the look changed.
 */
export const CANVAS_KNOBS = [
  'feedback.amount',
  'feedback.decay',
  'feedback.zoom',
  'feedback.rotate',
  'feedback.carry',
  'feedback.floor',
  'feedback.fade',
  'feedback.hold',
  'feedback.hue',
  'feedback.cool',
  'feedback.sharpen',
  'feedback.ceiling',
] as const satisfies readonly PostKnob[]
export type CanvasKnob = (typeof CANVAS_KNOBS)[number]

export const isCanvasKnob = (value: string): value is CanvasKnob =>
  (CANVAS_KNOBS as readonly string[]).includes(value)

export type CanvasMapping = {
  from: StudyField
  to: CanvasKnob
  gain: number
  curve: Curve
}

export type CastCanvas = {
  /** Off leaves the picture with no history at all, as Prism has none. */
  enabled: boolean
  /** Every canvas knob, resolved over the stack's own feedback defaults. */
  knobs: Readonly<Record<CanvasKnob, number>>
  mapping: readonly CanvasMapping[]
}

/** What a cast changes about one study: its resting numbers, and rows on top. */
export type CastOverride = {
  knobs?: Readonly<Record<string, number>>
  mapping?: readonly StudyMapping[]
}

export type Cast = {
  /** The one flow. Absent is a picture that nothing carries, which is Prism. */
  flow?: string
  inks: readonly string[]
  look: string
  canvas: CastCanvas
  /** By study id, and only for studies this cast holds. */
  overrides: Readonly<Record<string, CastOverride>>
}

export type PinnedCast = Cast & { id: string; name: string }

/** Every study the cast holds, flow first and look last. */
export const castStudyIds = (cast: Cast): readonly string[] =>
  cast.flow ? [cast.flow, ...cast.inks, cast.look] : [...cast.inks, cast.look]

/**
 * The most inks one cast may hold. The frame budget is drawn up for three,
 * and past that the inks stop reading as separate things on the canvas.
 */
export const MAX_INKS = 3

const KEYS = ['id', 'name', 'flow', 'inks', 'look', 'canvas', 'overrides']
const CANVAS_KEYS = ['enabled', 'knobs', 'mapping']
const OVERRIDE_KEYS = ['knobs', 'mapping']

const defaultCanvasKnobs = (): Record<CanvasKnob, number> => ({
  'feedback.amount': DEFAULT_POST_PARAMS.feedback.amount,
  'feedback.decay': DEFAULT_POST_PARAMS.feedback.decay,
  'feedback.zoom': DEFAULT_POST_PARAMS.feedback.zoom,
  'feedback.rotate': DEFAULT_POST_PARAMS.feedback.rotate,
  'feedback.carry': DEFAULT_POST_PARAMS.feedback.carry,
  'feedback.floor': DEFAULT_POST_PARAMS.feedback.floor,
  'feedback.fade': DEFAULT_POST_PARAMS.feedback.fade,
  'feedback.hold': DEFAULT_POST_PARAMS.feedback.hold,
  'feedback.hue': DEFAULT_POST_PARAMS.feedback.hue,
  'feedback.cool': DEFAULT_POST_PARAMS.feedback.cool,
  'feedback.sharpen': DEFAULT_POST_PARAMS.feedback.sharpen,
  'feedback.ceiling': DEFAULT_POST_PARAMS.feedback.ceiling,
})

/**
 * The canvas a cast draws on when nothing says otherwise: the post stack's
 * own feedback numbers, switched on and undriven. A cast file that leaves
 * `canvas` out gets this. A cast the director builds does not: see
 * `carriedCanvas`.
 */
export const defaultCanvas = (): CastCanvas => ({
  enabled: true,
  knobs: defaultCanvasKnobs(),
  mapping: [],
})

/**
 * The canvas a chosen cast draws on, which has no file to read numbers from:
 * the one persistent picture of docs/canvas-plan.md. It keeps nearly all of
 * itself, reads the last frame back along whatever flow is live, holds its own
 * mean brightness so it can do that without burning out, and ages the light it
 * keeps.
 *
 * It used to be `defaultCanvas`, whose carry is 0, and under the director no
 * flow moved the picture at all: the fluid showed only through its dye, and
 * a flow that draws nothing, as implode and radial burst do, did nothing.
 *
 * It then kept 0.93 a frame with a subtractive floor of 0.018, which put a
 * mark out in about half a second: no flow had time to shape anything, and the
 * only reason the decay was that low was that nothing controlled the sum, so a
 * longer memory went white. Three rows took the ceiling down as the music got
 * loud, which made the loudest moments the dullest. `feedback.hold` is what
 * replaced all of it, and the numbers here are what a canvas with a gain
 * control can afford:
 *
 * - 0.975 a reference frame, which is a memory of about two thirds of a
 *   second to a tenth and two and a half seconds to a thousandth, against the
 *   0.36 of a second 0.93 gave. That is long enough for the carry to fold a
 *   mark into a shape rather than merely smearing it.
 * - a `fade` of 0.0005 in place of the 0.018 floor. The floor was the haze
 *   control as well as the tail's shape, and took a mark out in half a second
 *   doing it; the hold is the haze control now, so the knee only has to shape
 *   the tail. Well above it a pixel decays as the decay says; at it a pixel
 *   loses half its light a frame; under it the last of a trail collapses and
 *   is never clipped, so the trail ends rather than stopping.
 * - `hold` at 0.13, rising to 0.23 when the music is full: the mean the whole
 *   canvas settles at. A frame of constant white then settles near a quarter
 *   rather than at forty times what was drawn, and a thin fresh mark still
 *   lands at full brightness, because only the carried sum is scaled. The
 *   number was found by looking, on the reference track's second drop at 1:54
 *   on a real adapter: at 0.44 the middle of the frame was a pale mass with
 *   the ring lost in it, and at 0.22 the same moment has black in it, the
 *   fluid's filaments read, and the spectrum ring's bars stand out of the dye.
 * - the three negative ceiling rows are gone, and the ceiling rests at 1.8
 *   as a per-pixel backstop.
 * - the trail cools, turns its hue with the harmony and keeps a little of its
 *   own detail, all gently. Light that lasts two seconds has time to change,
 *   which is most of what a long memory is for.
 *
 * The rest are Drift's (a cast since folded into Plume), tuned by eye on real
 * tracks for a dye ink and the ribbon, the cast the director reaches for most.
 * The rows on the decay are much smaller than they were for one reason: near
 * 1 the decay is highly levered, and the 0.02 that moved 0.93 to 0.95 would
 * take 0.975 past 0.99 and the canvas would never let go of anything. They are
 * scaled by what they do to the memory's length instead, so tension still
 * shortens the trails by about a third through a build and the drop opens them
 * again.
 */
export const carriedCanvas = (): CastCanvas => ({
  enabled: true,
  knobs: {
    'feedback.amount': 1,
    'feedback.decay': 0.975,
    'feedback.zoom': 1.0015,
    'feedback.rotate': 0,
    'feedback.carry': 1,
    // The subtractive floor is off: the fade beside it does the same job
    // without a cliff at the bottom of a trail.
    'feedback.floor': 0,
    'feedback.fade': 0.0005,
    'feedback.hold': 0.13,
    'feedback.hue': 0.006,
    'feedback.cool': 0.004,
    'feedback.sharpen': 0.03,
    'feedback.ceiling': 1.8,
  },
  mapping: [
    { from: 'energy', to: 'feedback.decay', gain: 0.004, curve: 'linear' },
    { from: 'swell', to: 'feedback.decay', gain: 0.004, curve: 'linear' },
    { from: 'tension', to: 'feedback.decay', gain: -0.012, curve: 'linear' },
    { from: 'beatPhase', to: 'feedback.zoom', gain: 0.003, curve: 'invert' },
    { from: 'harmonicChange', to: 'feedback.rotate', gain: 0.0015, curve: 'linear' },
    { from: 'energy', to: 'feedback.carry', gain: 0.4, curve: 'linear' },
    // A loud passage may hold a brighter canvas, and a build a dimmer one, so
    // the hold is what the old ceiling rows were reaching for and could not
    // say: it eases the whole picture rather than clipping what is carried.
    { from: 'energy', to: 'feedback.hold', gain: 0.1, curve: 'linear' },
    { from: 'tension', to: 'feedback.hold', gain: -0.08, curve: 'linear' },
    // The trail thins toward black a little faster when the music is loud,
    // which is where the most light is landing in it.
    { from: 'energy', to: 'feedback.fade', gain: 0.0005, curve: 'linear' },
    // A chord change spins the hue of everything already on the canvas, so
    // the harmony is visible in light that was drawn seconds ago.
    { from: 'harmonicChange', to: 'feedback.hue', gain: 0.012, curve: 'linear' },
    // A build drains the warmth out of what is left and picks out its
    // filaments, so the picture tightens as well as shortening.
    { from: 'tension', to: 'feedback.cool', gain: 0.012, curve: 'linear' },
    { from: 'tension', to: 'feedback.sharpen', gain: 0.04, curve: 'linear' },
  ],
})

function readField(value: unknown, source: string, path: string): StudyField {
  const from = readString(value, source, path)
  if (!(STUDY_FIELDS as readonly string[]).includes(from))
    fail(source, path, `is not a field; they are ${list(STUDY_FIELDS)}`)
  return from as StudyField
}

function readCurve(value: unknown, source: string, path: string): Curve {
  const curve = value === undefined ? 'linear' : readString(value, source, path)
  if (!(CURVES as readonly string[]).includes(curve))
    fail(source, path, `is not a curve; they are ${list(CURVES)}`)
  return curve as Curve
}

const article = (kind: Study['kind']) => (kind === 'ink' ? 'an' : 'a')

/**
 * The study a name points at, checked for kind as well as existence. A cast
 * naming a look where an ink belongs is the same mistake as naming nothing.
 */
function readStudy(value: unknown, source: string, path: string, kind: Study['kind']): Study {
  const id = readString(value, source, path)
  const study = findStudy(id)
  if (!study) fail(source, path, `is not a study; ${id} is in no registry entry`)
  if (study.kind !== kind)
    fail(
      source,
      path,
      study.kind === 'flow' && kind === 'ink'
        ? `is a flow, and a cast has one flow, named by "flow"`
        : `is ${article(study.kind)} ${study.kind} where ${article(kind)} ${kind} belongs`,
    )
  return study
}

function readCanvas(value: unknown, source: string, path: string): CastCanvas {
  const knobs = defaultCanvasKnobs()
  if (value === undefined) return { enabled: true, knobs, mapping: [] }
  if (!isRecord(value)) fail(source, path, `expected an object, got ${describe(value)}`)
  for (const key of Object.keys(value))
    if (!CANVAS_KEYS.includes(key))
      fail(source, `${path}.${key}`, `is not part of a canvas; it has ${list(CANVAS_KEYS)}`)
  const enabled =
    value.enabled === undefined ? true : readBoolean(value.enabled, source, `${path}.enabled`)
  const patch = value.knobs
  if (patch !== undefined) {
    if (!isRecord(patch))
      fail(source, `${path}.knobs`, `expected an object, got ${describe(patch)}`)
    for (const [key, raw] of Object.entries(patch)) {
      if (!isCanvasKnob(key))
        fail(source, `${path}.knobs.${key}`, `is not a canvas knob; they are ${list(CANVAS_KNOBS)}`)
      knobs[key] = readNumber(raw, source, `${path}.knobs.${key}`)
    }
  }

  return { enabled, knobs, mapping: readCanvasMapping(value.mapping, source, `${path}.mapping`) }
}

function readCanvasMapping(value: unknown, source: string, path: string): CanvasMapping[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(source, path, `expected an array, got ${describe(value)}`)
  return value.map((row: unknown, index: number) => {
    const at = `${path}[${index}]`
    if (!isRecord(row)) fail(source, at, `expected an object, got ${describe(row)}`)
    const to = readString(row.to, source, `${at}.to`)
    if (!isCanvasKnob(to))
      fail(source, `${at}.to`, `is not a canvas knob; they are ${list(CANVAS_KNOBS)}`)
    return {
      from: readField(row.from, source, `${at}.from`),
      to,
      gain: readNumber(row.gain, source, `${at}.gain`),
      curve: readCurve(row.curve, source, `${at}.curve`),
    }
  })
}

/**
 * A patch over one study. Its knobs and its rows are checked against that
 * study's implementation, so a row aimed at a knob the implementation does
 * not have is an error here rather than a number nothing reads.
 */
function readOverride(study: Study, value: unknown, source: string, path: string): CastOverride {
  if (!isRecord(value)) fail(source, path, `expected an object, got ${describe(value)}`)
  for (const key of Object.keys(value))
    if (!OVERRIDE_KEYS.includes(key))
      fail(source, `${path}.${key}`, `is not part of an override; it has ${list(OVERRIDE_KEYS)}`)
  const out: CastOverride = {}
  const knobs = value.knobs
  if (knobs !== undefined) {
    if (!isRecord(knobs))
      fail(source, `${path}.knobs`, `expected an object, got ${describe(knobs)}`)
    const patch: Record<string, number> = {}
    for (const [key, raw] of Object.entries(knobs)) {
      if (!isImplKnob(study.impl, key))
        fail(
          source,
          `${path}.knobs.${key}`,
          `is not a knob of ${study.impl}; it has ${list(implKnobs(study.impl) as readonly string[])}`,
        )
      patch[key] = readNumber(raw, source, `${path}.knobs.${key}`)
    }
    out.knobs = patch
  }

  const mapping = value.mapping
  if (mapping !== undefined) {
    if (!Array.isArray(mapping))
      fail(source, `${path}.mapping`, `expected an array, got ${describe(mapping)}`)
    out.mapping = mapping.map((row: unknown, index: number) =>
      readRow(study, row, source, `${path}.mapping[${index}]`),
    )
  }

  return out
}

function readRow(study: Study, value: unknown, source: string, path: string): StudyMapping {
  if (!isRecord(value)) fail(source, path, `expected an object, got ${describe(value)}`)
  const to = readString(value.to, source, `${path}.to`)
  if (!isImplKnob(study.impl, to))
    fail(
      source,
      `${path}.to`,
      `is not a knob of ${study.impl}; it has ${list(implKnobs(study.impl) as readonly string[])}`,
    )
  return {
    from: readField(value.from, source, `${path}.from`),
    to,
    gain: readNumber(value.gain, source, `${path}.gain`),
    curve: readCurve(value.curve, source, `${path}.curve`),
  }
}

/**
 * What one cast may not hold: two studies that exclude each other, or a study
 * whose implementation needs another that is not there. Both are rules about
 * the picture rather than about the file, which is why they are checked here
 * and not left to the renderer to discover with an empty frame.
 */
function checkCompany(studies: readonly Study[], source: string) {
  for (const study of studies) {
    for (const other of study.excludes ?? [])
      if (studies.some((held) => held.id === other))
        fail(source, study.id, `may not share a cast with ${other}`)
    for (const impl of study.requires ?? [])
      if (!studies.some((held) => held.impl === impl))
        fail(source, study.id, `needs the ${impl} implementation live in the same cast`)
  }
}

/** `source` names the file, so a failure says which cast is wrong. */
export function parseCast(value: unknown, source: string): PinnedCast {
  if (!isRecord(value)) fail(source, 'the cast', `expected an object, got ${describe(value)}`)
  for (const key of Object.keys(value))
    if (!KEYS.includes(key)) fail(source, key, 'is not part of a cast')
  const id = readString(value.id, source, 'id')
  const name = readString(value.name, source, 'name')
  const flow = value.flow === undefined ? undefined : readStudy(value.flow, source, 'flow', 'flow')
  if (!Array.isArray(value.inks))
    fail(source, 'inks', `expected an array of study ids, got ${describe(value.inks)}`)
  if (value.inks.length === 0) fail(source, 'inks', 'is empty; a cast draws at least one ink')
  if (value.inks.length > MAX_INKS)
    fail(source, 'inks', `names ${value.inks.length} inks; a cast draws at most ${MAX_INKS}`)
  const inks = value.inks.map((entry: unknown, index: number) =>
    readStudy(entry, source, `inks[${index}]`, 'ink'),
  )
  for (const [index, ink] of inks.entries())
    if (inks.findIndex((other) => other.id === ink.id) !== index)
      fail(source, `inks[${index}]`, `names ${ink.id} twice`)
  if (value.look === undefined) fail(source, 'look', 'is missing; a cast needs a look')
  const look = readStudy(value.look, source, 'look', 'look')
  const held = flow ? [flow, ...inks, look] : [...inks, look]
  checkCompany(held, source)

  const overrides: Record<string, CastOverride> = {}
  if (value.overrides !== undefined) {
    if (!isRecord(value.overrides))
      fail(source, 'overrides', `expected an object, got ${describe(value.overrides)}`)
    for (const [key, raw] of Object.entries(value.overrides)) {
      const study = held.find((entry) => entry.id === key)
      if (!study)
        fail(
          source,
          `overrides.${key}`,
          `names a study this cast does not hold; it holds ${list(held.map((entry) => entry.id))}`,
        )
      overrides[key] = readOverride(study, raw, source, `overrides.${key}`)
    }
  }

  return {
    id,
    name,
    ...(flow ? { flow: flow.id } : {}),
    inks: inks.map((ink) => ink.id),
    look: look.id,
    canvas: readCanvas(value.canvas, source, 'canvas'),
    overrides,
  }
}
