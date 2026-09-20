/**
 * A debug overlay drawn on a 2D canvas above the scene: the band envelopes
 * with each band's own onsets, energy, the flux trace against its onset
 * threshold with the global onset marks, the tempo guess, the preset drawing,
 * and frame timing. Toggled with H; it ships in the build so a problem on
 * someone else's machine can be read off a screenshot.
 *
 * The band rows are the reason this exists now. Each emitter answers one
 * band's onsets, so the way to see whether that is working is to watch the
 * rows tick independently: the treble row with the hats, the sub row with the
 * kick. A row that never ticks is an emitter that will never fire.
 */
import { BAND_HIT, BAND_NAMES, BAND_PULSE, F, keyLabel } from '../audio/FeatureExtractor'

export type HudStats = {
  fps: number
  frameMs: number
  /** What the scene is doing, already summarised for the line. */
  scene: string
  adapter: string
  /** Which post stages are on, already summarised for the line. */
  post: string
  /** The preset drawing, by its name in the picker. */
  preset: string
}

const HISTORY = 240
/** One row per band, then energy; the geometry below is derived from this. */
const ROWS = BAND_NAMES.length + 1
const ROW_HEIGHT = 15
const BARS_TOP = 12
const TRACE_HEIGHT = 56
/** The eight lines of text under the trace, the last of which is the preset, then the beat bar. */
const FOOTER = 146

export class Hud {
  private readonly context: CanvasRenderingContext2D | null
  private readonly flux = new Float32Array(HISTORY)
  private readonly threshold = new Float32Array(HISTORY)
  private readonly onsets = new Uint8Array(HISTORY)
  /** One row of history per band, so a row can be ticked on its own. */
  private readonly hits = new Uint8Array(HISTORY * BAND_NAMES.length)
  private at = 0
  private scale = 1
  visible = false

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.context = canvas.getContext('2d')
    canvas.hidden = true
  }

  setVisible(visible: boolean) {
    this.visible = visible
    this.canvas.hidden = !visible
  }

  resize(width: number, height: number, scale: number) {
    this.canvas.width = Math.max(1, Math.round(width * scale))
    this.canvas.height = Math.max(1, Math.round(height * scale))
    this.scale = scale
  }

  /** Record this frame's flux so the trace keeps history even while hidden. */
  record(packet: Float32Array) {
    this.flux[this.at] = packet[F.flux] ?? 0
    this.threshold[this.at] = packet[F.fluxThreshold] ?? 0
    this.onsets[this.at] = packet[F.onset] ? 1 : 0
    for (let band = 0; band < BAND_NAMES.length; band++)
      this.hits[band * HISTORY + this.at] = (packet[BAND_HIT + band] ?? 0) > 0 ? 1 : 0
    this.at = (this.at + 1) % HISTORY
  }

  draw(packet: Float32Array, stats: HudStats) {
    const ctx = this.context
    if (!this.visible || !ctx) return
    const { canvas, scale } = this
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, canvas.width / scale, canvas.height / scale)
    ctx.font = '11px ui-monospace, Menlo, monospace'
    ctx.textBaseline = 'middle'
    const x = 10
    const y = 10
    const width = 310
    // Flux and its threshold share a scale so the crossing is visible.
    const top = y + BARS_TOP + ROWS * ROW_HEIGHT
    const height = TRACE_HEIGHT
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(x, y, width, top - y + height + FOOTER)

    // A band's row is its level as a bar, its pulse as a brighter overlay on
    // the same bar, and a tick on the right for each of the last few frames it
    // fired on. The ticks are what say the detectors are independent.
    const rows = [...BAND_NAMES, 'energy'] as const
    rows.forEach((name, index) => {
      const band = index < BAND_NAMES.length ? index : -1
      const value = (band < 0 ? packet[F.energy] : packet[band]) ?? 0
      const row = y + BARS_TOP + index * ROW_HEIGHT
      ctx.fillStyle = '#cfd8d3'
      ctx.fillText(name, x + 8, row)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
      ctx.fillRect(x + 68, row - 5, 170, 10)
      ctx.fillStyle = `hsl(${200 - index * 30} 80% 60%)`
      ctx.fillRect(x + 68, row - 5, 170 * value, 10)
      if (band >= 0) {
        const pulse = packet[BAND_PULSE + band] ?? 0
        ctx.fillStyle = 'rgba(255, 255, 255, 0.65)'
        ctx.fillRect(x + 68, row - 5, 170 * pulse, 3)
        // The last 24 frames of this band's onsets, newest on the right.
        ctx.fillStyle = 'rgba(255, 200, 80, 0.95)'
        for (let back = 0; back < 24; back++) {
          const at = (this.at - 1 - back + HISTORY * 2) % HISTORY
          if (!this.hits[band * HISTORY + at]) continue
          ctx.fillRect(x + 268 - back * 2, row - 5, 1, 10)
        }
      }
      ctx.fillStyle = '#cfd8d3'
      ctx.fillText(value.toFixed(2), x + 274, row)
    })

    let max = 1
    for (let i = 0; i < HISTORY; i++) {
      max = Math.max(max, this.flux[i] ?? 0, this.threshold[i] ?? 0)
    }
    const step = (width - 16) / HISTORY
    ctx.fillStyle = 'rgba(255, 255, 255, 0.06)'
    ctx.fillRect(x + 8, top, width - 16, height)
    const trace = (values: Float32Array, colour: string) => {
      ctx.strokeStyle = colour
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 0; i < HISTORY; i++) {
        const value = values[(this.at + i) % HISTORY] ?? 0
        const px = x + 8 + i * step
        const py = top + height - (Math.min(value, max) / max) * height
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(255, 200, 80, 0.9)'
    for (let i = 0; i < HISTORY; i++) {
      if (!this.onsets[(this.at + i) % HISTORY]) continue
      const px = x + 8 + i * step
      ctx.beginPath()
      ctx.moveTo(px, top)
      ctx.lineTo(px, top + height)
      ctx.stroke()
    }
    trace(this.threshold, 'rgba(255, 120, 120, 0.9)')
    trace(this.flux, 'rgba(120, 220, 255, 0.95)')

    ctx.fillStyle = '#cfd8d3'
    const tempo = packet[F.tempoBpm] ?? 0
    const beat = packet[F.beatPulse] ?? 0
    const slow = (at: number) => (packet[at] ?? 0).toFixed(2)
    // The tempo to a tenth, since the tracker is good to that, with its
    // confidence beside it.
    ctx.fillText(
      `flux ${slow(F.flux)}  thr ${slow(F.fluxThreshold)}  beat ${beat.toFixed(2)}  ${tempo ? `${tempo.toFixed(1)} bpm` : 'tempo ?'} (${slow(F.tempoConfidence)})`,
      x + 8,
      top + height + 12,
    )

    // The song rather than the frame. These move over tens of seconds, so the
    // way to tell whether one is worth mapping is to watch this line for a
    // while before wiring it to a knob.
    ctx.fillText(
      `pace ${slow(F.pace)}  swell ${slow(F.swell)}  weight ${slow(F.weight)}  tempo ${slow(F.tempo)}  hard ${slow(F.hardness)}`,
      x + 8,
      top + height + 26,
    )

    // The moment: where in the song's own shape we are. Groove is all four
    // of these being low, so an empty-looking line is a reading and not a
    // missing one.
    ctx.fillText(
      `tension ${slow(F.tension)}  release ${slow(F.release)}  rest ${slow(F.rest)}  impact ${slow(F.impact)}`,
      x + 8,
      top + height + 40,
    )

    // The harmony: the key the hue stands for, how surely, and whether a
    // chord just moved. A clarity near 0 means the hue is a memory.
    ctx.fillText(
      `key ${keyLabel(packet[F.keyHue] ?? 0)}  clarity ${slow(F.keyClarity)}  hue ${slow(F.keyHue)}  change ${slow(F.harmonicChange)}`,
      x + 8,
      top + height + 54,
    )

    // The structure: which section this is, whether it has been heard before
    // and whether it just began.
    ctx.fillText(
      `section ${Math.round(packet[F.section] ?? 0)}  recall ${slow(F.recall)}  novelty ${slow(F.novelty)}`,
      x + 8,
      top + height + 68,
    )

    ctx.fillText(
      `${stats.fps.toFixed(0)} fps  ${stats.frameMs.toFixed(1)} ms  ${stats.scene}`,
      x + 8,
      top + height + 82,
    )
    ctx.fillText(stats.adapter.slice(0, 44), x + 8, top + height + 96)
    ctx.fillText(`post ${stats.post}`, x + 8, top + height + 110)
    ctx.fillText(`preset ${stats.preset}`, x + 8, top + height + 124)

    // The beat phase as a bar that sweeps once a beat. If it lands as the
    // beat does, the tracker has the tempo; if it drifts against the music it
    // has a fraction of it. Grey while there is no tempo and it is coasting.
    const bar = top + height + 136
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)'
    ctx.fillRect(x + 8, bar - 3, width - 16, 6)
    ctx.fillStyle = tempo ? 'rgba(255, 200, 80, 0.95)' : 'rgba(255, 255, 255, 0.25)'
    ctx.fillRect(x + 8, bar - 3, (width - 16) * (packet[F.beatPhase] ?? 0), 6)
  }
}
