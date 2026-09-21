/**
 * The bench's panel: one study, or a small cast, judged under conditions set
 * by hand. It is drawn in place of the preset panel and the stage keeps
 * drawing beside it, so a slider is watched working.
 *
 * Nothing here drives the picture directly. The panel edits a `BenchState`,
 * `useBench` hands that to the renderer, and what the panel reads back is the
 * packet the renderer is actually using, so a number on screen is a number a
 * study saw.
 */
import { useEffect, useState } from 'react'

import { F, PITCH_NAMES } from '../../src/audio/FeatureExtractor'
import { renderer } from '../../src/gpu/Renderer'
import { MAX_INKS, resolveStudy, STUDIES, studiesOfKind } from '../../src/presets'
import type { CharacterAxis, Study } from '../../src/presets'
import { CHARACTER_AXES, MOMENTS } from '../../src/presets'
import { heading, Level, ModeSwitch, panel, row, small } from '../controls'
import type { Mode } from '../controls'
import { BENCH_ROWS, isNoteRow, NOTE_ROWS } from './packet'
import type { BenchRow } from './packet'
import { readingOf } from './reading'
import type { Reading } from './reading'
import { castProblem, initialBench, slotIds, soloState, withSlots } from './state'
import type { BenchState } from './state'
import { BPM_RANGE } from './synthetic'
import type { BenchSession } from './useBench'

type Props = {
  state: BenchState
  onState: (next: BenchState) => void
  session: BenchSession
  mode: Mode
  onMode: (mode: Mode) => void
  webGpuAvailable: boolean
}

type KnobLine = { knob: string; rest: number; now: number }
type Snapshot = {
  reading: Reading
  packet: Readonly<Record<'energy' | 'tension' | 'release' | 'rest' | 'impact', number>>
  knobs: readonly { study: Study; lines: readonly KnobLine[] }[]
  average: number
  worst: number
}

/** Frame budget at 60 frames a second, which is what a cast has to hold. */
const BUDGET_MS = 1000 / 60

const byId = new Map(STUDIES.map((study) => [study.id, study]))

/**
 * Everything the panel shows that changes on its own, read once.
 *
 * The knobs come from the renderer, which resolved them for the frame it is
 * drawing. They used to be resolved here instead, on the packet the renderer
 * had written, which gave the same numbers and kept the renderer's own
 * resolved frame private. A row may now carry a shape, which remembers where
 * it was: a second resolver stepping the same rows five times a second would
 * be reading a different study from the one on screen, and one handed no step
 * at all would show every shaped row at rest. A study the renderer is not
 * drawing has nothing to read, and is resolved here at rest, which is what it
 * looks like the instant before it arrives.
 */
function snapshot(state: BenchState, session: BenchSession): Snapshot {
  const packet = renderer.features
  const tension = packet[F.tension] ?? 0
  const knobs: { study: Study; lines: KnobLine[] }[] = []
  for (const id of slotIds(state)) {
    const study = byId.get(id)
    const presence = state.presence[id] ?? 1
    if (!study || presence <= 0) continue
    const now =
      renderer.resolvedKnobs(id) ?? resolveStudy(study, undefined, packet, tension, presence, {})
    const lines = Object.entries(study.knobs).map(([knob, rest]) => ({
      knob,
      rest,
      now: now[knob] ?? rest,
    }))
    knobs.push({ study, lines })
  }

  return {
    reading: readingOf(packet),
    packet: {
      energy: packet[F.energy] ?? 0,
      tension,
      release: packet[F.release] ?? 0,
      rest: packet[F.rest] ?? 0,
      impact: packet[F.impact] ?? 0,
    },
    knobs,
    average: session.meter.average,
    worst: session.meter.worst,
  }
}

const figure = (value: number) => Number(value.toPrecision(3))

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      aria-label={label}
      value={value}
      style={{ width: '100%', minWidth: 0 }}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  )
}

/** One 0 to 1 slider with its value, and its own checkbox when it can be held. */
function Dial({
  name,
  label,
  value,
  onChange,
  held,
  onHold,
  locked,
}: {
  name: string
  /** What is printed beside the slider, where the name is a row's and not a word. */
  label?: string
  value: number
  onChange: (value: number) => void
  /** Undefined means there is no checkbox: the slider is always what is used. */
  held?: boolean
  onHold?: (held: boolean) => void
  /** Ticked and not changeable: a synthetic packet has nothing to pass through. */
  locked?: boolean
}) {
  const off = held === false
  return (
    <div style={{ ...row, gridTemplateColumns: '18px 84px 1fr 40px', margin: '2px 0' }}>
      {held === undefined ? (
        <span />
      ) : (
        <input
          type="checkbox"
          aria-label={`hold ${name}`}
          title={`Hold ${name} over the packet. Unheld, the real packet is used.`}
          checked={held}
          disabled={locked}
          onChange={(event) => onHold?.(event.target.checked)}
        />
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', opacity: off ? 0.5 : 1 }}>
        {label ?? name}
      </span>
      <input
        type="range"
        aria-label={name}
        min={0}
        max={1}
        step={0.01}
        value={value}
        style={{ width: '100%', minWidth: 0, opacity: off ? 0.5 : 1 }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
        {figure(value)}
      </span>
    </div>
  )
}

export function BenchPanel({ state, onState, session, mode, onMode, webGpuAvailable }: Props) {
  const [now, setNow] = useState(() => snapshot(state, session))
  // The panel is React and the renderer is a frame loop, so it reads the
  // renderer a few times a second and is not pushed to: a render per frame
  // would cost more than the picture does.
  useEffect(() => {
    const timer = setInterval(() => setNow(snapshot(state, session)), 200)
    return () => clearInterval(timer)
  }, [state, session])

  const set = (patch: Partial<BenchState>) => onState({ ...state, ...patch })
  const hold = (key: BenchRow, value: number | undefined) => {
    const held = { ...state.held }
    if (value === undefined) delete held[key]
    else held[key] = value
    set({ held })
  }

  const presence = (id: string) => state.presence[id] ?? 1
  const setPresence = (id: string, value: number) =>
    set({ presence: { ...state.presence, [id]: value } })
  const slots = { flow: state.flow, inks: state.inks, look: state.look }
  const problem = castProblem(slots)
  const flows = studiesOfKind('flow')
  const inks = studiesOfKind('ink')
  const looks = studiesOfKind('look')
  const setInk = (at: number, id: string) =>
    onState(
      withSlots(state, {
        ...slots,
        inks:
          id === ''
            ? state.inks.filter((_, index) => index !== at)
            : state.inks.map((entry, index) => (index === at ? id : entry)),
      }),
    )

  const slider = (key: BenchRow, fallback: number, label?: string) => (
    <Dial
      key={key}
      name={key}
      {...(label === undefined ? {} : { label })}
      value={state.held[key] ?? fallback}
      held={state.synthetic || key in state.held}
      locked={state.synthetic}
      onChange={(value) => hold(key, value)}
      onHold={(on) => hold(key, on ? (state.held[key] ?? fallback) : undefined)}
    />
  )

  const slot = (
    label: string,
    id: string,
    options: React.ReactNode,
    onPick: (id: string) => void,
  ) => (
    <div key={label} style={{ margin: '6px 0 10px' }}>
      <div style={{ ...row, gridTemplateColumns: '44px 1fr' }}>
        <span style={{ opacity: 0.6 }}>{label}</span>
        <Select label={label} value={id} onChange={onPick}>
          {options}
        </Select>
      </div>
      {id !== '' && (
        <Dial name="presence" value={presence(id)} onChange={(value) => setPresence(id, value)} />
      )}
    </div>
  )

  const { reading } = now
  const cast = reading.cast
  const named = (id: string | undefined) => (id ? (byId.get(id)?.name ?? id) : 'nothing')
  const moments = MOMENTS.filter((moment) => reading.weights[moment] > 0.005)
    .map((moment) => `${moment} ${reading.weights[moment].toFixed(2)}`)
    .join(', ')

  return (
    <div style={panel}>
      <ModeSwitch mode={mode} onMode={onMode} />

      {!webGpuAvailable && (
        <p role="status" style={{ opacity: 0.7, lineHeight: 1.5 }}>
          The bench needs WebGPU. WebGL2 draws only the fractal, so most studies show nothing here.
        </p>
      )}

      <label style={{ ...row, gridTemplateColumns: '44px 1fr' }}>
        <span style={{ opacity: 0.6 }}>solo</span>
        <Select
          label="Solo a study"
          value=""
          onChange={(id) => {
            const study = byId.get(id)
            if (study) onState(soloState(study, state))
          }}
        >
          <option value="">choose a study</option>
          {(['flow', 'ink', 'look'] as const).map((kind) => (
            <optgroup key={kind} label={kind}>
              {studiesOfKind(kind).map((study) => (
                <option key={study.id} value={study.id}>
                  {study.name}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </label>
      <p style={{ opacity: 0.5, lineHeight: 1.5, margin: '6px 0 0' }}>
        Puts a study alone on the plainest of the other two kinds. Each slot below can be changed.
      </p>

      <h2 style={heading}>CAST</h2>
      {slot(
        'flow',
        state.flow ?? '',
        <>
          <option value="">none</option>
          {flows.map((study) => (
            <option key={study.id} value={study.id}>
              {study.name}
            </option>
          ))}
        </>,
        (id) => onState(withSlots(state, { ...slots, flow: id === '' ? null : id })),
      )}
      {state.inks.map((ink, at) =>
        slot(
          at === 0 ? 'ink' : `ink ${at + 1}`,
          ink,
          <>
            {at > 0 && <option value="">remove</option>}
            {inks.map((study) => (
              <option
                key={study.id}
                value={study.id}
                disabled={state.inks.some((held, index) => held === study.id && index !== at)}
              >
                {study.name}
              </option>
            ))}
          </>,
          (id) => setInk(at, id),
        ),
      )}
      {state.inks.length < MAX_INKS && (
        <button
          type="button"
          style={{ ...small, width: 'auto', marginBottom: 10 }}
          onClick={() => {
            const spare = inks.find((study) => !state.inks.includes(study.id))
            if (spare) onState(withSlots(state, { ...slots, inks: [...state.inks, spare.id] }))
          }}
        >
          + ink
        </button>
      )}
      {slot(
        'look',
        state.look,
        looks.map((study) => (
          <option key={study.id} value={study.id}>
            {study.name}
          </option>
        )),
        (id) => onState(withSlots(state, { ...slots, look: id })),
      )}
      {problem && (
        <p role="alert" style={{ color: '#ffb36b', lineHeight: 1.5 }}>
          {problem}
        </p>
      )}

      <h2 style={heading}>SIGNAL</h2>
      <label style={{ ...row, gridTemplateColumns: '18px 1fr' }}>
        <input
          type="checkbox"
          checked={state.synthetic}
          onChange={(event) => set({ synthetic: event.target.checked })}
        />
        <span>synthetic packet</span>
      </label>
      <p style={{ opacity: 0.5, lineHeight: 1.5, margin: '4px 0 8px' }}>
        {state.synthetic
          ? 'Nothing is heard. The bench writes the packet: a beat at the tempo below, and every slider is in force.'
          : 'The real packet is used, so play a track. A slider only takes over its own rows once its box is ticked, and dragging it ticks it.'}
      </p>
      {state.synthetic && (
        <>
          <div style={{ ...row, gridTemplateColumns: '18px 84px 1fr 40px', margin: '2px 0' }}>
            <span />
            <span>bpm</span>
            <input
              type="range"
              aria-label="bpm"
              min={BPM_RANGE[0]}
              max={BPM_RANGE[1]}
              step={1}
              value={state.bpm}
              style={{ width: '100%', minWidth: 0 }}
              onChange={(event) => set({ bpm: Number(event.target.value) })}
            />
            <span style={{ textAlign: 'right', opacity: 0.7 }}>{state.bpm}</span>
          </div>
          <Dial name="level" value={state.level} onChange={(level) => set({ level })} />
        </>
      )}

      <h2 style={heading}>CHARACTER</h2>
      {CHARACTER_AXES.map((axis: CharacterAxis) => slider(axis, 0.5))}

      <h2 style={heading}>MOMENT</h2>
      {BENCH_ROWS.filter(
        (key) => !(CHARACTER_AXES as readonly string[]).includes(key) && !isNoteRow(key),
      ).map((key) => slider(key, 0))}
      <button
        type="button"
        style={{ ...small, width: 'auto', marginTop: 6 }}
        onClick={session.fire}
      >
        impact
      </button>

      <h2 style={heading}>NOTES</h2>
      <p style={{ opacity: 0.5, lineHeight: 1.5, margin: '4px 0 8px' }}>
        {state.synthetic
          ? 'The synthetic packet plays C, G, A minor and F, a chord a bar. Tick a note to hold it instead.'
          : 'The twelve note rows the music writes. Tick one to hold it at the slider.'}
      </p>
      {NOTE_ROWS.map((key, note) => slider(key, 0, PITCH_NAMES[note]))}

      <h2 style={heading}>PACKET</h2>
      {(['energy', 'tension', 'release', 'rest', 'impact'] as const).map((key) => (
        <Level key={key} name={key} value={now.packet[key]} />
      ))}

      <h2 style={heading}>FRAME TIME · LAST 2 S</h2>
      <p
        style={{ margin: '4px 0', fontVariantNumeric: 'tabular-nums' }}
        title="Milliseconds between drawn frames. A display at 60 Hz reads 16.7 even when the cast costs nothing."
      >
        avg {now.average.toFixed(1)} ms ({now.average > 0 ? Math.round(1000 / now.average) : 0} fps)
        <br />
        <span style={{ color: now.worst > BUDGET_MS * 1.5 ? '#ffb36b' : undefined }}>
          worst {now.worst.toFixed(1)} ms
        </span>
      </p>

      <h2 style={heading}>DIRECTOR WOULD CAST</h2>
      <p style={{ margin: '4px 0', lineHeight: 1.5 }}>
        {cast
          ? `${named(cast.flow)} · ${cast.inks.map(named).join(', ')} · ${named(cast.look)}`
          : 'nothing'}
      </p>
      <p style={{ margin: '4px 0', opacity: 0.6, lineHeight: 1.5 }}>
        moment: {moments || 'none'}
        <br />
        character:{' '}
        {CHARACTER_AXES.map((axis) => `${axis} ${reading.character[axis].toFixed(2)}`).join(', ')}
      </p>

      <h2 style={heading}>KNOBS · REST → NOW</h2>
      {now.knobs.map(({ study, lines }) => (
        <div key={study.id}>
          <div style={{ margin: '10px 0 4px', opacity: 0.8 }}>
            {study.kind} · {study.name}
          </div>
          {lines.map((line) => {
            const moved = Math.abs(line.now - line.rest) > 1e-9
            return (
              <div
                key={line.knob}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 64px 64px',
                  gap: 6,
                  fontVariantNumeric: 'tabular-nums',
                  color: moved ? '#7fd1ff' : undefined,
                  opacity: moved ? 1 : 0.55,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{line.knob}</span>
                <span style={{ textAlign: 'right' }}>{figure(line.rest)}</span>
                <span style={{ textAlign: 'right' }}>{figure(line.now)}</span>
              </div>
            )
          })}
        </div>
      ))}

      <h2 style={heading}>SHARE</h2>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          style={small}
          title="Copy the address, which carries the whole bench in its hash"
          onClick={() => void navigator.clipboard?.writeText(window.location.href).catch(() => {})}
        >
          copy link
        </button>
        <button type="button" style={small} onClick={() => onState(initialBench())}>
          reset bench
        </button>
      </div>
    </div>
  )
}
