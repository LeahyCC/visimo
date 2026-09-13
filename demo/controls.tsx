/**
 * Every control here is generated from the lists the package already keeps:
 * the scene's knobs from `SCENE_KNOBS`, the post knobs from `POST_LANES`, the
 * mapping vocabulary from `AUDIO_FIELDS` and `CURVES`. A knob added to the
 * package shows up in this panel with no change here.
 */
import { FLUID_SIZES, SCENE_IDS, SCENE_LABELS } from '../src/catalog'
import type { SceneId } from '../src/catalog'
import { mergePostParams, POST_KNOBS, POST_LANES } from '../src/post/params'
import type { PostParams, PostStage } from '../src/post/params'
import { findPreset, PRESETS } from '../src/presets/index'
import { AUDIO_FIELDS, CURVES, SCENE_KNOBS } from '../src/presets/knobs'
import type { AudioField, Curve } from '../src/presets/knobs'
import type { Mapping, Preset } from '../src/presets/types'

type Target = Preset['audioMapping'][number]['to']

type Props = {
  preset: Preset
  onPreset: (preset: Preset) => void
  scene: SceneId
  onScene: (scene: SceneId) => void
  fluidSize: number
  onFluidSize: (size: number) => void
  hud: boolean
  onHud: (on: boolean) => void
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
  'spread': [0, 1],
  'force': [0, 3],
  'dye': [0, 8],
  'hitForce': [0, 3],
  'hitDye': [0, 6],
  'radius': [0.001, 0.08],
  'colourShift': [0, 1],
  'colourDrift': [0, 0.5],
  'orbitSpeed': [0, 2],
  // Whole emitters, up to the slots the shader's splat array holds.
  'emitters': [1, 8],
  'feedback.amount': [0, 1],
  'feedback.decay': [0, 1],
  'feedback.zoom': [0.9, 1.1],
  'feedback.rotate': [-0.1, 0.1],
  'bloom.threshold': [0, 4],
  'bloom.knee': [0, 2],
  'bloom.intensity': [0, 3],
  'chromatic.amount': [0, 0.05],
  'chromatic.beat': [0, 0.05],
  'tonemap.exposure': [0, 4],
  'tonemap.shoulder': [0, 2],
  'grain.amount': [0, 0.5],
}

/** Knobs the slider must step in whole numbers, whatever the range implies. */
const WHOLE = new Set(['emitters'])

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
 * off its own grid, so the numbers a preset ends up holding would be 39.96
 * rather than 40.
 */
function stepOf(span: number): number {
  const rough = span / 500
  const power = 10 ** Math.floor(Math.log10(rough))
  const times = rough / power
  return (times > 5 ? 10 : times > 2 ? 5 : times > 1 ? 2 : 1) * power
}

const panel = {
  overflowY: 'auto',
  padding: 16,
  borderLeft: '1px solid #ffffff1a',
  background: '#0c0e13',
} as const

const heading = { margin: '20px 0 8px', fontSize: 11, letterSpacing: 1, opacity: 0.6 } as const
const small = { fontSize: 11, padding: '3px 6px', width: '100%' } as const
const row = { display: 'grid', gridTemplateColumns: '110px 1fr 56px', gap: 8, alignItems: 'center' }
const cell = { width: '100%', minWidth: 0 } as const

function Slider({
  name,
  value,
  onChange,
}: {
  name: string
  value: number
  onChange: (value: number) => void
}) {
  const [min, max] = spanOf(name, value)

  return (
    <label style={{ ...row, margin: '2px 0' }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={WHOLE.has(name) ? 1 : stepOf(max - min)}
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

/** The stages the post knobs belong to, in the order the lanes list them. */
const POST_STAGES = [...new Set(POST_KNOBS.map((knob) => knob.split('.')[0] as PostStage))]

export function Controls({
  preset,
  onPreset,
  scene,
  onScene,
  fluidSize,
  onFluidSize,
  hud,
  onHud,
}: Props) {
  const knobs = SCENE_KNOBS[preset.scene]
  // Every edit below builds a new preset object, and an untouched one is still
  // the very entry `PRESETS` holds, so identity is the whole check. It also
  // answers the question worth asking mid-tune: have I drifted from the file?
  const shipped = findPreset(preset.id)
  const edited = shipped !== undefined && shipped !== preset

  const setKnob = (knob: string, value: number) =>
    onPreset({ ...preset, sceneParams: { ...preset.sceneParams, [knob]: value } })

  // The stack is nested, so it is cloned through `mergePostParams` and the
  // lane writes into the copy; the preset the renderer holds is never mutated.
  const editPost = (change: (params: PostParams) => void) => {
    const params = mergePostParams(preset.postParams, {})
    change(params)
    onPreset({ ...preset, postParams: params })
  }

  const setMapping = (rows: readonly Mapping<string>[]) =>
    onPreset({ ...preset, audioMapping: rows as Preset['audioMapping'] })

  const editRow = (index: number, patch: Partial<Mapping<string>>) =>
    setMapping(
      preset.audioMapping.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
    )

  const copy = () => {
    const json = JSON.stringify(preset, null, 2)
    void navigator.clipboard?.writeText(json).catch(() => console.log(json))
  }

  return (
    <div style={panel}>
      <label style={row}>
        <span>preset</span>
        <select
          style={cell}
          value={preset.id}
          onChange={(event) => {
            const found = PRESETS.find((entry) => entry.id === event.target.value)
            if (found) onPreset(found)
          }}
        >
          {PRESETS.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          style={small}
          disabled={!edited}
          title={
            edited
              ? `Put ${preset.name} back to the numbers in src/presets/`
              : `${preset.name} is as it ships`
          }
          onClick={() => shipped && onPreset(shipped)}
        >
          reset
        </button>
      </label>

      <label style={row}>
        <span>scene</span>
        <select
          style={cell}
          value={scene}
          onChange={(event) => onScene(event.target.value as SceneId)}
        >
          {SCENE_IDS.map((id) => (
            <option key={id} value={id}>
              {SCENE_LABELS[id]}
            </option>
          ))}
        </select>
        <span />
      </label>

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

      <label style={row}>
        <span>hud (H)</span>
        <input type="checkbox" checked={hud} onChange={(event) => onHud(event.target.checked)} />
        <span />
      </label>

      <h2 style={heading}>SCENE</h2>
      {knobs.map((knob) => (
        <Slider
          key={knob}
          name={knob}
          value={preset.sceneParams[knob]}
          onChange={(value) => setKnob(knob, value)}
        />
      ))}

      <h2 style={heading}>POST</h2>
      <label style={{ ...row, margin: '2px 0' }}>
        <span>stack</span>
        <input
          type="checkbox"
          checked={preset.postParams.enabled}
          onChange={(event) => {
            const on = event.target.checked
            editPost((params) => {
              params.enabled = on
            })
          }}
        />
        <span />
      </label>
      {POST_STAGES.map((stage) => (
        <div key={stage}>
          <label style={{ ...row, margin: '8px 0 2px' }}>
            <span style={{ opacity: 0.6 }}>{stage}</span>
            <input
              type="checkbox"
              checked={preset.postParams[stage].enabled}
              onChange={(event) => {
                const on = event.target.checked
                editPost((params) => {
                  params[stage].enabled = on
                })
              }}
            />
            <span />
          </label>
          {POST_KNOBS.filter((knob) => knob.startsWith(stage + '.')).map((knob) => (
            <Slider
              key={knob}
              name={knob}
              value={POST_LANES[knob].read(preset.postParams)}
              onChange={(value) =>
                editPost((params) => {
                  POST_LANES[knob].write(params, value)
                })
              }
            />
          ))}
        </div>
      ))}

      <h2 style={heading}>MAPPING</h2>
      {preset.audioMapping.map((entry, index) => (
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
            onChange={(event) => editRow(index, { from: event.target.value as AudioField })}
          >
            {AUDIO_FIELDS.map((field) => (
              <option key={field} value={field}>
                {field}
              </option>
            ))}
          </select>
          <select
            style={cell}
            value={entry.to}
            onChange={(event) => editRow(index, { to: event.target.value as Target })}
          >
            {[...knobs, ...POST_KNOBS].map((knob) => (
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
            onChange={(event) => editRow(index, { curve: event.target.value as Curve })}
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
            onClick={() => setMapping(preset.audioMapping.filter((_, at) => at !== index))}
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
          setMapping([
            ...preset.audioMapping,
            { from: 'energy', to: first, gain: 1, curve: 'linear' },
          ])
        }}
      >
        + row
      </button>

      <h2 style={heading}>OUT</h2>
      <button type="button" onClick={copy}>
        copy preset
      </button>
      <p style={{ opacity: 0.5, lineHeight: 1.5 }}>
        Drops straight into <code>src/presets/</code>; give it a new id and name, then add it to the
        list in <code>src/presets/index.ts</code>.
      </p>
    </div>
  )
}
