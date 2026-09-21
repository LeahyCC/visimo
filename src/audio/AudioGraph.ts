/**
 * The Web Audio side of playback: one AudioContext and one AnalyserNode fed by
 * a single <audio> or <video> element, for the visualizer to read.
 *
 * Attach one element and one only. A MediaElementSource can be created just
 * once per element, and on media served without CORS headers the browser
 * silences it permanently. So the host must pick the element it knows is
 * same-origin and never offer another; `attachAudio` refuses a second.
 *
 * Why lazily: an AudioContext made outside a user gesture starts suspended, and
 * a MediaElementSource on a suspended context produces silence. The graph is
 * built from a `play` event, after the element itself was allowed to start,
 * and the source is only wired up once the context is actually running. If it
 * is not, the element keeps playing on its own and the next play tries again.
 *
 * The analyser hears the music and not the volume control. A media element's
 * source comes out of it after the element's own volume, so a listener who
 * turns the player down hands the analyser a quieter song, and the extractor is
 * not blind to that: its flux is measured on a compressed magnitude with an
 * absolute floor under it, and the top two bands, which are the quietest in any
 * mix, fall under that floor first. Measured on the same ten seconds of a drop,
 * the treble band read 13 hits and a level of 0.77 at full volume, and no hits
 * and 0.16 at a volume of 0.08, so every row the hats feed went dead for anyone
 * listening quietly. So the volume is taken back off before the analyser and
 * put back on after it (`volumeGains`): what is heard is what the element
 * asked for, and what is analysed is the track.
 *
 * A muted element is past helping, and so is one at a volume of nothing: the
 * source is exact silence and no gain brings it back. The picture carries on
 * down to `MIN_VOLUME`, which is quieter than anyone listens.
 *
 * This module owns nothing React. It is a singleton so the graph survives any
 * remount of the components that read it.
 */

// 4096 rather than 2048: it halves the bin width to 11.7 Hz, which the low
// bands need, since at 2048 the whole 20 to 60 Hz sub band was two bins. The
// cost is an 85 ms window instead of 43, so transients smear a little.
export const FFT_SIZE = 4096

/** How long a change of volume takes to reach the gains. */
const VOLUME_EASE_SECONDS = 0.01

/**
 * The quietest volume that is undone in full. Under it the gain before the
 * analyser stops growing, since a hundredfold is already 40 dB and whatever is
 * left of the signal below that is not worth lifting.
 */
export const MIN_VOLUME = 0.01

/**
 * The gain before the analyser, which undoes the element's volume, and the one
 * after it, which puts it back. Their product is 1 at any volume, so the
 * listener hears exactly what the element's volume asked for.
 */
export function volumeGains(volume: number): { trim: number; level: number } {
  const held = Number.isFinite(volume) ? Math.min(Math.max(volume, MIN_VOLUME), 1) : 1
  return { trim: 1 / held, level: held }
}

export type AudioGraph = {
  context: AudioContext
  analyser: AnalyserNode
  /** True once the library element is routed through the analyser. */
  attached: boolean
}

/** The two gains either side of the analyser; see `volumeGains`. */
type Gains = { trim: GainNode; level: GainNode }

let graph: AudioGraph | null = null
let gains: Gains | null = null
let attachedTo: HTMLMediaElement | null = null

/** The graph once something has played; null before that, or without Web Audio. */
export function audioGraph(): AudioGraph | null {
  return graph
}

function create(): AudioGraph | null {
  if (typeof AudioContext === 'undefined') return null
  const context = new AudioContext()
  const analyser = context.createAnalyser()
  analyser.fftSize = FFT_SIZE
  // The feature extractor does its own smoothing per band, with separate
  // attack and release; the analyser's single constant would blur onsets.
  analyser.smoothingTimeConstant = 0
  const trim = context.createGain()
  const level = context.createGain()
  trim.connect(analyser)
  analyser.connect(level)
  level.connect(context.destination)
  gains = { trim, level }
  return { context, analyser, attached: false }
}

/**
 * Call from the element's `play` event. Builds the context on first use,
 * resumes it, and routes the element through the analyser once the context is
 * running. Safe to call on every play.
 */
export async function attachAudio(element: HTMLMediaElement): Promise<AudioGraph | null> {
  graph ??= create()
  if (!graph) return null
  if (attachedTo && attachedTo !== element) {
    // A second element can never be attached; the first source is permanent.
    return graph
  }
  await resumeAudio()
  if (graph.context.state !== 'running' || attachedTo) return graph
  const source = graph.context.createMediaElementSource(element)
  source.connect(gains?.trim ?? graph.analyser)
  const follow = () => followVolume(element)
  element.addEventListener('volumechange', follow)
  follow()
  attachedTo = element
  graph.attached = true
  return graph
}

/**
 * Set both gains from the element's volume. Eased over a few milliseconds and
 * not stepped, so dragging a volume slider does not click, and both move
 * together so their product stays at 1 on the way.
 */
function followVolume(element: HTMLMediaElement) {
  if (!graph || !gains) return
  const { trim, level } = volumeGains(element.volume)
  const now = graph.context.currentTime
  gains.trim.gain.setTargetAtTime(trim, now, VOLUME_EASE_SECONDS)
  gains.level.gain.setTargetAtTime(level, now, VOLUME_EASE_SECONDS)
}

/**
 * Browsers suspend the context when a tab is hidden for a while or, on iOS,
 * when another app takes the output. Call this on the next play or when the
 * page becomes visible again; it is a no-op while the context already runs.
 */
export async function resumeAudio(): Promise<void> {
  if (!graph || graph.context.state === 'running') return
  try {
    await graph.context.resume()
  } catch {
    // Still suspended: the element plays on its own and the next play retries.
  }
}
