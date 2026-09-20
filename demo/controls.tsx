/**
 * Every control here is generated from the lists the package already keeps:
 * a cast's studies from the registry, each study's knobs from `IMPL_KNOBS`,
 * the canvas's from `CANVAS_KNOBS`, and the mapping vocabulary from
 * `STUDY_FIELDS` and `CURVES`. A knob or a study added to the package shows
 * up in this panel with no change here.
 *
 * It tunes a pinned cast, which is what the five presets are now. Under Auto
 * there is no cast to tune, since the song is choosing one, so the knobs give
 * way to what the director is doing. The study bench, where one study is
 * soloed against sliders for character and moment, is the other mode of this
 * panel and lives in `bench/`; the styles and the two small components below
 * are shared with it, which is why they are exported.
 */
import { useEffect, useState } from 'react'

import { renderer } from '../src'
import { FLUID_SIZES } from '../src/catalog'
import { CANVAS_KNOBS, castStudyIds, MAX_INKS } from '../src/presets'
import type {
  CanvasKnob,
  Cast,
  Character,
  CharacterAxis,
  ImplId,
  Moment,
  PinnedCast,
  Study,
  StudyField,
  StudyMapping,
} from '../src/presets'
import {
  CASTS,
  CHARACTER_AXES,
  CURVES,
  findCast,
  findStudy,
  implKnobs,
  MOMENTS,
  parseCast,
  STUDY_FIELDS,
} from '../src/presets'
import { KALEIDOSCOPE_RANGES } from '../src/scenes/kaleidoscope.params'

export type Mode = 'presets' | 'bench'

type Props = {
  mode: Mode
  onMode: (mode: Mode) => void
  cast: PinnedCast | 'auto'
  onCast: (cast: PinnedCast | 'auto') => void
  /** The last character `onCharacter` handed the page, which a host would save. */
  saved: Character | null
  fluidSize: number
  onFluidSize: (size: number) => void
  hud: boolean
  onHud: (on: boolean) => void
  webGpuAvailable?: boolean
}

/**
 * Where a slider runs, for the knobs whose useful range is not obvious from
 * their resting value. Anything missing falls back to `spanOf`, so a new knob
 * still gets a slider; give it a row here once its range is known.
 */
const RANGES: Partial<Record<string, readonly [number, number]>> = {
  'velocityDecay': [0, 3],
  'dyeDecay': [0, 3],
  'vorticity': [0, 60],
  'viscosity': [0, 2],
  'intensity': [0, 4],
  'saturation': [0, 1.5],
  'spread': [0, 1],
  'force': [0, 3],
  'dye': [0, 8],
  'hitForce': [0, 3],
  'hitDye': [0, 6],
  'radius': [0.001, 0.08],
  'colourShift': [0, 1],
  'colourDrift': [0, 0.5],
  'orbitSpeed': [0, 2],
  // One emitter per band, and there are five bands.
  'emitters': [1, 5],
  'voice': [0, 1],
  'events': [0, 32],
  'eventLife': [0.1, 4],
  'eventForce': [0, 3],
  'eventDye': [0, 6],
  'eventRadius': [0.001, 0.05],
  'ribbon.intensity': [0, 3],
  'ribbon.width': [0.5, 24],
  'ribbon.height': [0, 0.5],
  // 0 is the line and 1 the circle; the lane rounds anything between.
  'ribbon.shape': [0, 1],
  // The shards. `size` is in frame heights and `speed` in frame heights a
  // second; `intensity` above has the one range for every implementation.
  'burst': [0, 160],
  'hitRate': [0, 2],
  'speed': [0, 4],
  'size': [0, 0.12],
  'spin': [0, 12],
  'life': [0.2, 3],
  'feedback.amount': [0, 1],
  'feedback.decay': [0, 1],
  'feedback.zoom': [0.9, 1.1],
  'feedback.rotate': [-0.1, 0.1],
  'feedback.carry': [0, 2],
  'feedback.floor': [0, 0.1],
  'feedback.ceiling': [0.05, 24],
  'bloom.threshold': [0, 4],
  'bloom.knee': [0, 2],
  'bloom.intensity': [0, 3],
  'chromatic.amount': [0, 0.05],
  'chromatic.beat': [0, 0.05],
  'tonemap.exposure': [0, 4],
  'tonemap.shoulder': [0, 2],
  'grain.amount': [0, 0.5],
}

/**
 * A study's own table. The fractal's knobs share four names with the dye's
 * and do not share their ranges, so the table is picked by implementation
 * rather than merged.
 */
const rangesOf = (impl: ImplId): Partial<Record<string, readonly [number, number]>> =>
  impl === 'fractal' ? KALEIDOSCOPE_RANGES : RANGES

/** Knobs the slider must step in whole numbers, whatever the range implies. */
const WHOLE = new Set(['emitters', 'events', 'symmetry', 'complexity', 'ribbon.shape', 'burst'])

/** Four times the resting value, or 0 to 1 when it rests at zero. */
function spanOf(name: string, value: number): readonly [number, number] {
  const known = RANGES[name]
  if (known) return known
  const reach = Math.abs(value) * 4 || 1
  return value < 0 ? [-reach, reach] : [0, reach]
}

/**
 * A round step near a five-hundredth of the range: 1, 2 or 5 times a power of
 * ten. A plain division gives steps like 0.12, and a slider refuses any value
 * off its own grid, so the numbers a cast ends up holding would be 39.96
 * rather than 40.
 */
function stepOf(span: number): number {
  const rough = span / 500
  const power = 10 ** Math.floor(Math.log10(rough))
  const times = rough / power
  return (times > 5 ? 10 : times > 2 ? 5 : times > 1 ? 2 : 1) * power
}

export const panel = {
  overflowY: 'auto',
  padding: 16,
  borderLeft: '1px solid #ffffff1a',
  background: '#0c0e13',
} as const

export const heading = {
  margin: '20px 0 8px',
  fontSize: 11,
  letterSpacing: 1,
  opacity: 0.6,
} as const
export const small = { fontSize: 11, padding: '3px 6px', width: '100%' } as const
export const row = {
  display: 'grid',
  gridTemplateColumns: '110px 1fr 56px',
  gap: 8,
  alignItems: 'center',
}
export const cell = { width: '100%', minWidth: 0 } as const

function Slider({
  name,
  value,
  onChange,
  ranges = RANGES,
}: {
  name: string
  value: number
  onChange: (value: number) => void
  ranges?: Partial<Record<string, readonly [number, number]>>
}) {
  const [min, max] = ranges[name] ?? spanOf(name, value)

  return (
    <label style={{ ...row, margin: '2px 0' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={WHOLE.has(name) ? 1 : name.endsWith('Speed') ? 0.001 : stepOf(max - min)}
        value={value}
        style={cell}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
        {Number(value.toPrecision(3))}
      </span>
    </label>
  )
}

/** A cast as the file it came from, so an edit round trips through `parseCast`. */
const asFile = (cast: PinnedCast) => ({
  id: cast.id,
  name: cast.name,
  ...(cast.flow ? { flow: cast.flow } : {}),
  inks: cast.inks,
  look: cast.look,
  canvas: cast.canvas,
  overrides: cast.overrides,
})

/**
 * Whether a cast draws at all without compute. The fractal is the one ink the
 * WebGL2 path has, and a cast holding it draws with that alone; everything
 * else in it is skipped, which is how Melt shows there as Prism with a still
 * trail. A cast with no fractal in it has nothing left to draw.
 */
const FALLBACK_INK: ImplId = 'fractal'

const castNeedsGpu = (cast: Cast) => !cast.inks.some((id) => findStudy(id)?.impl === FALLBACK_INK)

/**
 * The two modes of the panel, presets and the study bench. It is the first
 * thing in either, so the choice sits above the preset picker and is in the
 * same place whichever one is showing.
 */
export function ModeSwitch({ mode, onMode }: { mode: Mode; onMode: (mode: Mode) => void }) {
  return (
    <div role="group" aria-label="Panel mode" style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
      {(['presets', 'bench'] as const).map((entry) => (
        <button
          key={entry}
          type="button"
          aria-pressed={mode === entry}
          style={{
            ...small,
            padding: '5px 6px',
            textTransform: 'capitalize',
            background: mode === entry ? '#26303d' : undefined,
          }}
          onClick={() => onMode(entry)}
        >
          {entry}
        </button>
      ))}
    </div>
  )
}

export function Controls({
  mode,
  onMode,
  cast,
  onCast,
  saved,
  fluidSize,
  onFluidSize,
  hud,
  onHud,
  webGpuAvailable = true,
}: Props) {
  // Under Auto there is no pinned cast, so there is nothing here to tune.
  const pinned = cast === 'auto' ? null : cast
  // Every edit below builds a new cast object, and an untouched one is still
  // the very entry `CASTS` holds, so identity is the whole check. It also
  // answers the question worth asking mid-tune: have I drifted from the file?
  const shipped = pinned ? findCast(pinned.id) : undefined
  const edited = shipped !== undefined && shipped !== pinned
  const studies = (pinned ? castStudyIds(pinned) : [])
    .map((id) => findStudy(id))
    .filter((study): study is Study => study !== undefined)
  const holdsFluid = studies.some((study) => study.impl === 'fluid')

  const edit = (change: (file: ReturnType<typeof asFile>) => void) => {
    if (!pinned) return
    const file = asFile(pinned)
    change(file)
    onCast(parseCast(file, 'demo'))
  }

  /** A study's resting value for one knob: the cast's patch, or the study's own. */
  const restOf = (study: Study, knob: string) =>
    pinned?.overrides[study.id]?.knobs?.[knob] ?? study.knobs[knob] ?? 0

  const setKnob = (study: Study, knob: string, value: number) =>
    edit((file) => {
      const held = file.overrides[study.id] ?? {}
      file.overrides = {
        ...file.overrides,
        [study.id]: { ...held, knobs: { ...held.knobs, [knob]: value } },
      }
    })

  const setRows = (study: Study, rows: readonly StudyMapping[]) =>
    edit((file) => {
      const held = file.overrides[study.id] ?? {}
      file.overrides = { ...file.overrides, [study.id]: { ...held, mapping: rows } }
    })

  const setCanvasKnob = (knob: CanvasKnob, value: number) =>
    edit((file) => {
      file.canvas = { ...file.canvas, knobs: { ...file.canvas.knobs, [knob]: value } }
    })

  const copy = () => {
    if (!pinned) return
    const json = JSON.stringify(asFile(pinned), null, 2)
    void navigator.clipboard?.writeText(json).catch(() => console.log(json))
  }

  return (
    <div style={panel}>
      <ModeSwitch mode={mode} onMode={onMode} />
      <label style={row}>
        <span>preset</span>
        <select
          style={cell}
          value={pinned?.id ?? 'auto'}
          onChange={(event) => {
            if (event.target.value === 'auto') {
              onCast('auto')
              return
            }

            const found = findCast(event.target.value)
            if (found) onCast(found)
          }}
        >
          {/* Auto pins nothing: the director picks from the song. */}
          <option value="auto" title="No pinned cast: the song chooses one">
            Auto
          </option>
          {CASTS.map((entry) => (
            <option
              key={entry.id}
              value={entry.id}
              disabled={!webGpuAvailable && castNeedsGpu(entry)}
            >
              {entry.name}
              {!webGpuAvailable && castNeedsGpu(entry) ? ' (requires WebGPU)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={small}
          disabled={!edited}
          title={
            pinned
              ? edited
                ? `Put ${pinned.name} back to the numbers in src/studies/casts/`
                : `${pinned.name} is as it ships`
              : 'The song is choosing, so there is nothing here to reset'
          }
          onClick={() => shipped && onCast(shipped)}
        >
          reset
        </button>
      </label>

      <Direction saved={saved} />

      {/* The grid is the fluid's, whichever study in the cast is using it. */}
      {holdsFluid && (
        <label style={row}>
          <span>grid</span>
          <select
            style={cell}
            value={fluidSize}
            onChange={(event) => onFluidSize(Number(event.target.value))}
          >
            {FLUID_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span />
        </label>
      )}

      <label style={row}>
        <span>hud (H)</span>
        <input type="checkbox" checked={hud} onChange={(event) => onHud(event.target.checked)} />
        <span />
      </label>

      {pinned && (
        <>
          <h2 style={heading}>CANVAS</h2>
          {CANVAS_KNOBS.map((knob) => (
            <Slider
              key={knob}
              name={knob}
              value={pinned.canvas.knobs[knob]}
              onChange={(value) => setCanvasKnob(knob, value)}
            />
          ))}

          {studies.map((study) => (
            <div key={study.id}>
              <h2 style={heading}>
                {study.kind.toUpperCase()} · {study.name}
              </h2>
              {implKnobs(study.impl).map((knob) => (
                <Slider
                  key={knob}
                  name={knob}
                  ranges={rangesOf(study.impl)}
                  value={restOf(study, knob)}
                  onChange={(value) => setKnob(study, knob, value)}
                />
              ))}
              <Rows
                study={study}
                rows={pinned.overrides[study.id]?.mapping ?? []}
                onRows={setRows}
              />
            </div>
          ))}

          <h2 style={heading}>OUT</h2>
          <button type="button" onClick={copy}>
            copy cast
          </button>
          <p style={{ opacity: 0.5, lineHeight: 1.5 }}>
            Drops straight into <code>src/studies/casts/</code>; give it a new id and name, then add
            it to the list in <code>src/studies/casts/index.ts</code>. A cast holds one flow, up to{' '}
            {MAX_INKS} inks and one look, and the studies it names are edited above.
          </p>
        </>
      )}
    </div>
  )
}

/** A number as a bar and a figure, which is every line of the panel below. */
export function Level({ name, value, span = 1 }: { name: string; value: number; span?: number }) {
  return (
    <div style={{ ...row, margin: '2px 0' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      <span style={{ display: 'block', height: 6, background: '#ffffff14', borderRadius: 3 }}>
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${Math.round(Math.min(1, Math.max(0, value / span)) * 100)}%`,
            background: '#7fd1ff',
            borderRadius: 3,
          }}
        />
      </span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', opacity: 0.7 }}>
        {value.toFixed(2)}
      </span>
    </div>
  )
}

type Reading = {
  studies: readonly { id: string; presence: number }[]
  character: Character
  settled: number
  moments: Readonly<Record<Moment, number>>
  preset: string
}

const read = (): Reading => ({
  studies: renderer.liveCast.studies.map((entry) => ({ id: entry.id, presence: entry.presence })),
  character: { ...renderer.character },
  settled: renderer.settled,
  moments: { ...renderer.moments },
  preset: renderer.presetId,
})

/**
 * What the director is doing: what is on screen and what each of them is
 * faded to, where in the song it thinks we are, and where the song sits. It
 * reads the renderer ten times a second rather than being pushed to, because
 * the panel is React and the renderer is a frame loop, and a re-render per
 * frame would cost more than the picture does. It is shown under a pinned
 * cast too, where the fades sit at 1 and the reading is what a host would be
 * saving.
 */
function Direction({ saved }: { saved: Character | null }) {
  const [now, setNow] = useState(read)

  useEffect(() => {
    const timer = setInterval(() => setNow(read()), 100)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      <h2 style={heading}>CAST · {now.preset}</h2>
      {now.studies.length === 0 && <p style={{ opacity: 0.5 }}>nothing live yet</p>}
      {now.studies.map((entry) => (
        <Level key={entry.id} name={entry.id} value={entry.presence} />
      ))}

      <h2 style={heading}>MOMENT</h2>
      {MOMENTS.map((moment) => (
        <Level key={moment} name={moment} value={now.moments[moment]} />
      ))}

      <h2 style={heading}>CHARACTER · settled {now.settled.toFixed(2)}</h2>
      {CHARACTER_AXES.map((axis: CharacterAxis) => (
        <Level key={axis} name={axis} value={now.character[axis]} />
      ))}
      <p style={{ opacity: 0.5, lineHeight: 1.5 }}>
        {saved
          ? `onCharacter last said ${CHARACTER_AXES.map((axis) => `${axis} ${saved[axis].toFixed(2)}`).join(', ')}. A host saves that against the track and hands it back as startCharacter next time.`
          : 'onCharacter fires once the reading has settled, which takes a half minute of sound, and rarely after that.'}
      </p>
    </>
  )
}

/** The rows a cast adds on top of a study's own, which is what it may edit. */
function Rows({
  study,
  rows,
  onRows,
}: {
  study: Study
  rows: readonly StudyMapping[]
  onRows: (study: Study, rows: readonly StudyMapping[]) => void
}) {
  const knobs = implKnobs(study.impl)
  const editRow = (index: number, patch: Partial<StudyMapping>) =>
    onRows(
      study,
      rows.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
    )

  return (
    <>
      {rows.map((entry, index) => (
        <div
          key={index}
          style={{
            display: 'grid',
            gridTemplateColumns: '0.9fr 1.3fr 52px 0.9fr 22px',
            gap: 4,
            margin: '3px 0',
          }}
        >
          <select
            style={cell}
            value={entry.from}
            onChange={(event) => editRow(index, { from: event.target.value as StudyField })}
          >
            {STUDY_FIELDS.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
          <select
            style={cell}
            value={entry.to}
            onChange={(event) => editRow(index, { to: event.target.value as StudyMapping['to'] })}
          >
            {knobs.map((knob) => (
              <option key={knob} value={knob}>
                {knob}
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            style={cell}
            value={entry.gain}
            onChange={(event) => editRow(index, { gain: Number(event.target.value) })}
          />
          <select
            style={cell}
            value={entry.curve}
            onChange={(event) =>
              editRow(index, { curve: event.target.value as StudyMapping['curve'] })
            }
          >
            {CURVES.map((curve) => (
              <option key={curve} value={curve}>
                {curve}
              </option>
            ))}
          </select>
          <button
            type="button"
            title="remove"
            onClick={() =>
              onRows(
                study,
                rows.filter((_, at) => at !== index),
              )
            }
          >
            x
          </button>
        </div>
      ))}
      <button
        type="button"
        style={{ marginTop: 6 }}
        onClick={() => {
          const first = knobs[0]
          if (!first) return
          onRows(study, [...rows, { from: 'energy', to: first, gain: 1, curve: 'linear' }])
        }}
      >
        + row
      </button>
    </>
  )
}
