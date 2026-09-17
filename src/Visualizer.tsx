import { useEffect, useRef, useState } from 'react'

import { renderer } from './gpu/Renderer'
import type { Preset } from './presets/types'
import type { SceneId } from './scenes/catalog'

type Props = {
  hud: boolean
  /** Its numbers and its stack; the scene below is its own. */
  preset: Preset
  scene: SceneId
  fluidSize: number
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
  scene,
  fluidSize,
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
  // The preset first, so the scene it names is the one that gets built.
  useEffect(() => renderer.setPreset(preset), [preset])
  useEffect(() => renderer.setScene(scene), [scene])
  useEffect(() => renderer.setFluidSize(fluidSize), [fluidSize])

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
