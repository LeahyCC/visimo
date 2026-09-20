/**
 * What the bench is set to, and how that lives in the URL hash so a tuned
 * setup can be sent to someone and opened as it was. Numbers and names only,
 * no React and no GPU.
 *
 * The slots are a cast's own: one flow, one to three inks, one look. Picking a
 * study to solo fills the slot it belongs in and hands the other two to the
 * plainest studies the registry has, since an ink on its own has no picture to
 * draw on and a flow on its own has nothing to show. The hash is read as
 * untrusted: it is a string somebody typed or pasted, so every part of it is
 * checked and a part that fails falls back to the default and never throws.
 */
import { MAX_INKS, parseCast, STUDIES } from '../../src/presets'
import type { Study, StudyKind } from '../../src/presets'
import { BENCH_ROWS, isBenchRow } from './packet'
import type { BenchRow, Held } from './packet'
import { BPM_RANGE } from './synthetic'

export type BenchState = {
  /** Null is a cast with no flow, which nothing carries the picture. */
  flow: string | null
  inks: readonly string[]
  look: string
  /** By study id, and only the ones that are not at 1. */
  presence: Readonly<Record<string, number>>
  synthetic: boolean
  bpm: number
  /** The level the synthetic packet plays at, written into `energy`. */
  level: number
  /** The controls a viewer is holding over the real packet, by name. */
  held: Held
}

export const DEFAULT_BPM = 128
export const DEFAULT_LEVEL = 0.7

const COST_ORDER = { cheap: 0, medium: 1, heavy: 2 } as const

/**
 * Studies that win a tie on cost and welcome. The ribbon and the halo are both
 * cheap and welcome everywhere, but only the ribbon draws across the frame, so
 * it is the ink that gives a flow something to carry when the bench opens or a
 * flow is soloed. A halo sits at the middle and would show a flow very little.
 */
const PREFERRED = ['ribbon']

/**
 * The studies of one kind, plainest first: cheapest, then the widest welcome,
 * which is the one with the least opinion about what song it is drawing. A
 * tie goes to a preferred study, then to the id, so the order never depends on
 * how the registry happens to be written.
 */
export function plainest(kind: StudyKind, studies: readonly Study[] = STUDIES): Study[] {
  const preferred = (study: Study) => (PREFERRED.includes(study.id) ? 0 : 1)
  return studies
    .filter((study) => study.kind === kind)
    .sort(
      (a, b) =>
        COST_ORDER[a.cost] - COST_ORDER[b.cost] ||
        b.reach - a.reach ||
        preferred(a) - preferred(b) ||
        (a.id < b.id ? -1 : 1),
    )
}

/**
 * Why a cast cannot be drawn, in the parser's own words, or null when it can.
 * The cast parser already knows every rule (a study that excludes another,
 * one that needs an implementation beside it, an ink named twice), so this
 * asks it and does not keep a second copy of them.
 */
export function castProblem(state: Pick<BenchState, 'flow' | 'inks' | 'look'>): string | null {
  try {
    parseCast(
      {
        id: 'bench',
        name: 'Bench',
        ...(state.flow ? { flow: state.flow } : {}),
        inks: state.inks,
        look: state.look,
      },
      'bench',
    )

    return null
  } catch (error: unknown) {
    return error instanceof Error ? error.message.replace(/^bench: /, '') : 'not a cast'
  }
}

type Slots = Pick<BenchState, 'flow' | 'inks' | 'look'>

/**
 * The slots for a cast built around one study. The other two kinds take their
 * plainest study that the parser accepts beside it, so soloing the dye ink
 * gets a fluid flow and not the first flow in the list. If nothing is
 * accepted the plainest of each is used anyway and the panel says why.
 */
export function slotsAround(study: Study, studies: readonly Study[] = STUDIES): Slots {
  const flows = plainest('flow', studies)
  const inks = plainest('ink', studies)
  const looks = plainest('look', studies)
  const flowsOn = study.kind === 'flow' ? [study] : flows
  const inksOn = study.kind === 'ink' ? [study] : inks
  const looksOn = study.kind === 'look' ? [study] : looks
  for (const flow of flowsOn)
    for (const ink of inksOn)
      for (const look of looksOn) {
        const slots = { flow: flow.id, inks: [ink.id], look: look.id }
        if (!castProblem(slots)) return slots
      }

  return {
    flow: flowsOn[0]?.id ?? null,
    inks: [inksOn[0]?.id ?? ''],
    look: looksOn[0]?.id ?? '',
  }
}

const DEFAULT_SIGNAL = {
  synthetic: false,
  bpm: DEFAULT_BPM,
  level: DEFAULT_LEVEL,
  held: {},
} as const

/** A study soloed: its own slot, the plainest around it, and every fade at 1. */
export const soloState = (study: Study, base?: BenchState): BenchState => ({
  ...(base ?? DEFAULT_SIGNAL),
  ...slotsAround(study),
  presence: {},
})

/** The bench as it opens: the plainest ink, alone. */
export const initialBench = (): BenchState => {
  const ink = plainest('ink')[0]
  if (!ink) throw new Error('bench: the registry has no ink')
  return soloState(ink)
}

/** The ids in the cast, flow first and look last, as `castStudyIds` lists a cast's. */
export const slotIds = (slots: Slots): readonly string[] =>
  slots.flow ? [slots.flow, ...slots.inks, slots.look] : [...slots.inks, slots.look]

/**
 * New slots on the same signal. A fade that belonged to a study no longer in
 * the cast is dropped, so it does not come back on its own if the study is
 * put in again later.
 */
export function withSlots(state: BenchState, slots: Slots): BenchState {
  const presence: Record<string, number> = {}
  for (const id of slotIds(slots)) {
    const value = state.presence[id]
    if (value !== undefined) presence[id] = value
  }

  return { ...state, ...slots, presence }
}

const finite = (raw: string | null, low: number, high: number, fallback: number): number => {
  if (raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback
}

const round = (value: number) => String(Number(value.toFixed(3)))

/** The state as the hash's text, without the `#`. */
export function encodeBench(state: BenchState): string {
  const params = new URLSearchParams()
  params.set('bench', '1')
  params.set('flow', state.flow ?? 'none')
  params.set('inks', state.inks.join(','))
  params.set('look', state.look)
  for (const id of slotIds(state)) {
    const presence = state.presence[id]
    if (presence !== undefined && presence !== 1) params.set(`p.${id}`, round(presence))
  }

  if (state.synthetic) params.set('syn', '1')
  params.set('bpm', round(state.bpm))
  params.set('level', round(state.level))
  for (const key of BENCH_ROWS) {
    const value = state.held[key]
    if (value !== undefined) params.set(key, round(value))
  }

  return params.toString()
}

const studyOf = (id: string, kind: StudyKind): Study | undefined =>
  STUDIES.find((study) => study.id === id && study.kind === kind)

/**
 * The state a hash describes, or null when it is not a bench's at all. A hash
 * that is one but names a study the registry does not have, or a number that
 * is not one, is read as far as it makes sense and the rest is the default.
 */
export function decodeBench(hash: string): BenchState | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  if (params.get('bench') !== '1') return null
  const base = initialBench()

  const flowName = params.get('flow')
  const flow =
    flowName === null
      ? base.flow
      : flowName === 'none'
        ? null
        : (studyOf(flowName, 'flow')?.id ?? base.flow)

  const inks: string[] = []
  for (const name of (params.get('inks') ?? '').split(',')) {
    const ink = studyOf(name, 'ink')
    if (ink && !inks.includes(ink.id) && inks.length < MAX_INKS) inks.push(ink.id)
  }

  const look = studyOf(params.get('look') ?? '', 'look')?.id ?? base.look
  const slots = { flow, inks: inks.length > 0 ? inks : base.inks, look }

  const presence: Record<string, number> = {}
  for (const id of slotIds(slots)) {
    const raw = params.get(`p.${id}`)
    if (raw !== null) presence[id] = finite(raw, 0, 1, 1)
  }

  const held: Partial<Record<BenchRow, number>> = {}
  for (const [key, raw] of params.entries()) {
    if (!isBenchRow(key)) continue
    const value = finite(raw, 0, 1, Number.NaN)
    if (!Number.isNaN(value)) held[key] = value
  }

  return {
    ...slots,
    presence,
    synthetic: params.get('syn') === '1',
    bpm: finite(params.get('bpm'), BPM_RANGE[0], BPM_RANGE[1], DEFAULT_BPM),
    level: finite(params.get('level'), 0, 1, DEFAULT_LEVEL),
    held,
  }
}
