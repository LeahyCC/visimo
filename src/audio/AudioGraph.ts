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
 * This module owns nothing React. It is a singleton so the graph survives any
 * remount of the components that read it.
 */

// 4096 rather than 2048: it halves the bin width to 11.7 Hz, which the low
// bands need, since at 2048 the whole 20 to 60 Hz sub band was two bins. The
// cost is an 85 ms window instead of 43, so transients smear a little.
export const FFT_SIZE = 4096

export type AudioGraph = {
  context: AudioContext
  analyser: AnalyserNode
  /** True once the library element is routed through the analyser. */
  attached: boolean
}

let graph: AudioGraph | null = null
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
  analyser.connect(context.destination)
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
  source.connect(graph.analyser)
  attachedTo = element
  graph.attached = true
  return graph
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
