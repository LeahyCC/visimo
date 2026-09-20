/**
 * The bench as it is handed to the renderer, kept for as long as the bench
 * mode is on and not for as long as its panel is on screen: the full view
 * hides the panel, and the picture it is there to show must not go with it.
 *
 * The renderer holds the cast it is given and reads its presences every
 * frame, so the cast is rebuilt only when the slots change and a presence
 * slider writes into it in place. Everything else the frame needs comes in
 * through a ref, so the hook the renderer holds is the same object from one
 * render to the next and a slider drag does not look like a new bench.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { F } from '../../src/audio/FeatureExtractor'
import { renderer } from '../../src/gpu/Renderer'
import type { Bench } from '../../src/gpu/Renderer'
import { carriedCanvas } from '../../src/studies/cast'
import type { LiveCast } from '../../src/studies/resolve'
import { FrameMeter } from './meter'
import { overridePacket, overridesFor, stepImpact } from './packet'
import type { RowOverride } from './packet'
import { slotIds } from './state'
import type { BenchState } from './state'
import { SyntheticBeat } from './synthetic'

export type BenchSession = {
  meter: FrameMeter
  /** Fire an impact on the next frame, the way the extractor would. */
  fire: () => void
}

export function useBench(state: BenchState, active: boolean): BenchSession {
  const [meter] = useState(() => new FrameMeter())
  const [beat] = useState(() => new SyntheticBeat())
  const [impact] = useState(() => {
    const row: RowOverride = { row: F.impact, value: 0, mode: 'raise' }
    return { fired: false, level: 0, row, rows: [row] }
  })

  const key = slotIds(state).join('|')
  const live = useMemo<LiveCast>(
    () => ({
      studies: slotIds(state).map((id) => ({ id, presence: state.presence[id] ?? 1 })),
      canvas: carriedCanvas(),
      tension: 0,
    }),
    // The slots are the whole of what rebuilds it; a presence is written in
    // place below, and the rest of the state is not the cast's.
    [key],
  )

  const overrides = useMemo(
    () => overridesFor(state.held, state.synthetic),
    [state.held, state.synthetic],
  )
  const now = useRef({ synthetic: state.synthetic, bpm: state.bpm, level: state.level, overrides })
  now.current = { synthetic: state.synthetic, bpm: state.bpm, level: state.level, overrides }

  useEffect(() => {
    for (const entry of live.studies) entry.presence = state.presence[entry.id] ?? 1
  }, [live, state.presence])

  // A synthetic bar starts on its first beat whenever it is switched on.
  useEffect(() => beat.reset(), [beat, state.synthetic])

  const hook = useMemo<Bench>(
    () => ({
      live,
      frame: (packet, dt) => {
        meter.push(dt * 1000)
        const settings = now.current
        if (settings.synthetic) beat.write(packet, dt, settings)
        overridePacket(packet, settings.overrides)
        impact.level = stepImpact(impact.level, impact.fired, dt)
        impact.fired = false
        impact.row.value = impact.level
        overridePacket(packet, impact.rows)
      },
      waveform: () => (now.current.synthetic ? beat.waveform(now.current.level) : null),
    }),
    [live, meter, beat, impact],
  )

  useEffect(() => {
    if (!active) return
    meter.reset()
    renderer.setBench(hook)
    return () => renderer.setBench(null)
  }, [active, hook, meter])

  return useMemo(
    () => ({
      meter,
      fire: () => {
        impact.fired = true
      },
    }),
    [meter, impact],
  )
}
