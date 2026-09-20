import { useEffect, useRef, useState } from 'react'

import { renderer } from './gpu/Renderer'
import type { Live, PlayheadSource } from './gpu/Renderer'
import type { Character } from './studies/types'

type Props = {
  hud: boolean
  /**
   * What to draw. A pinned cast is its studies, their numbers and the canvas
   * they draw on, and pinning one turns the choosing off; it is still called
   * `preset` because that is what these five are to a host. `"auto"` hands
   * the picture to the director and lets the song choose, which is the same
   * prop because the two are the same question: only one thing can be on
   * screen, and a second prop would let a host ask for both at once.
   */
  preset: Live
  fluidSize: number
  /**
   * Where the character reader opens, for a host that knows the track: a
   * genre tag, or the axes it saved from the last play of this one. Partial,
   * so a host that knows one thing about a track says only that. It moves
   * where the drift starts and not how long it takes, since the reading is a
   * guess until the music has been heard, and it is taken until the first
   * frame is drawn and ignored after that.
   */
  startCharacter?: Partial<Character>
  /**
   * Which track is playing: any value that changes when the track does, an id
   * or a url. Everything the director holds is about one song, so when this
   * changes it starts again, from `startCharacter` as it stands then. Without
   * it a session is read as one long track: the second song never opens on a
   * guess, and its sections are handed the casts the first song's had.
   */
  track?: string | number
  /**
   * Where the track is and how long it is, for a host that plays files: a ref
   * to anything with a `currentTime` and a `duration` in seconds, which is
   * what `useRef<HTMLAudioElement>` already is. It is read on every frame and
   * never changes as far as React is concerned, so it costs a host nothing to
   * keep current and re-renders nothing. With it the last stretch of a track
   * reads as an outro whatever the track is doing, and a short track has a
   * short intro. Without it the director reads an ending from the shape of
   * one, a long fall in loudness, and can see none in a track that ends loud.
   */
  playhead?: PlayheadSource
  /**
   * The character, once the reading has settled and rarely after that, so a
   * host can save it and hand it back as `startCharacter` next time. It fires
   * under a pinned cast as much as under the director, because the song is
   * read either way.
   */
  onCharacter?: (character: Character) => void
  /** The device could not be had, or was lost for good: show artwork instead. */
  onUnsupported: () => void
  onBackend?: (backend: 'webgpu' | 'webgl2') => void
  /** Goes on the scene canvas, for a host that wants to restyle it. */
  className?: string
  /** Goes on the HUD canvas. */
  hudClassName?: string
}

// Both canvases fill their parent, so the host has to give them a positioned
// one. The layout is inline because the package ships no stylesheet.
const FILL = { position: 'absolute', inset: 0, width: '100%', height: '100%' } as const
const SCENE = { ...FILL, display: 'block', background: '#020305' } as const
// No `display` here: Hud.ts hides the overlay with the `hidden` attribute, and
// an inline display would outrank it and pin the HUD on.
const HUD = { ...FILL, pointerEvents: 'none' } as const

// The whole visualizer tree is loaded on demand from here. React owns the
// canvas elements and nothing per frame; the renderer draws until unmount.
export default function VisualizerStage({
  hud,
  preset,
  fluidSize,
  startCharacter,
  track,
  playhead,
  onCharacter,
  onUnsupported,
  onBackend,
  className,
  hudClassName,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const [generation, setGeneration] = useState(0)
  const retried = useRef(false)
  const failed = useRef(onUnsupported)
  failed.current = onUnsupported
  const ready = useRef(onBackend)
  ready.current = onBackend

  useEffect(() => {
    const element = canvas.current
    const hudElement = overlay.current
    if (!element || !hudElement) return
    let active = true
    const fail = () => {
      if (!active) return
      // A canvas keeps its context type even after device loss. Replacing it
      // once lets recovery select WebGL when WebGPU stops offering an adapter.
      if (element.dataset.backend === 'webgpu' && !retried.current) {
        retried.current = true
        setGeneration((value) => value + 1)
      } else failed.current()
    }
    void renderer
      .attach(element, hudElement, fail)
      .then((result) => {
        if (result === 'unsupported') fail()
        if (active && result === 'ok')
          ready.current?.(element.dataset.backend === 'webgl2' ? 'webgl2' : 'webgpu')
      })
      .catch((error: unknown) => {
        console.error('Visualizer startup failed:', error)
        fail()
      })

    return () => {
      active = false
      renderer.detach(element)
    }
  }, [generation])

  useEffect(() => renderer.setHud(hud), [hud])
  // The starting character before the cast, so the first frame the director
  // steps is already the one a host that knows the track asked for.
  useEffect(() => renderer.setStartCharacter(startCharacter), [startCharacter])
  // After the starting character, so a new track opens on its own and not on
  // the last one's. The first run is the mount and not a change of track.
  const playing = useRef(track)
  useEffect(() => {
    if (playing.current === track) return
    playing.current = track
    renderer.newTrack()
  }, [track])

  useEffect(() => {
    renderer.setPlayhead(playhead ?? null)
    return () => renderer.setPlayhead(null)
  }, [playhead])
  useEffect(() => renderer.setPreset(preset), [preset])
  useEffect(() => renderer.setFluidSize(fluidSize), [fluidSize])
  useEffect(() => {
    renderer.setOnCharacter(onCharacter ?? null)
    return () => renderer.setOnCharacter(null)
  }, [onCharacter])

  return (
    <>
      <canvas
        key={generation}
        ref={canvas}
        className={className}
        style={SCENE}
        aria-hidden="true"
      />
      <canvas ref={overlay} className={hudClassName} style={HUD} hidden aria-hidden="true" />
    </>
  )
}
