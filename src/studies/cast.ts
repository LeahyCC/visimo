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
  'feedback.ceiling': DEFAULT_POST_PARAMS.feedback.ceiling,
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
