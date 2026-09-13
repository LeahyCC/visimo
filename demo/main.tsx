/**
 * The tuning bench. The stage fills the left, the panel on the right drives
 * the preset it draws with, and a dropped file plays through the same
 * `attachAudio` path a host app uses, so what is tuned here is the real thing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { createRoot } from 'react-dom/client'

import { attachAudio, resumeAudio } from '../src/audio'
import { DEFAULT_FLUID_SIZE, DEFAULT_SCENE } from '../src/catalog'
import type { SceneId } from '../src/catalog'
import { DEFAULT_PRESET_ID, presetOrDefault } from '../src/presets'
import type { Preset } from '../src/presets'
import VisualizerStage from '../src/Visualizer'
import { Controls } from './controls'

const stage = {
  position: 'relative',
  overflow: 'hidden',
  background: '#020305',
} as const

const dropzone = {
  position: 'absolute',
  left: 16,
  right: 16,
  bottom: 16,
  padding: '14px 16px',
  border: '1px dashed #ffffff40',
  borderRadius: 8,
  background: '#00000080',
  backdropFilter: 'blur(6px)',
} as const

const choose = {
  padding: '4px 10px',
  border: '1px solid #ffffff40',
  borderRadius: 6,
  cursor: 'pointer',
} as const

function App() {
  const [preset, setPreset] = useState<Preset>(() => presetOrDefault(DEFAULT_PRESET_ID))
  const [scene, setScene] = useState<SceneId>(DEFAULT_SCENE)
  const [fluidSize, setFluidSize] = useState(DEFAULT_FLUID_SIZE)
  const [hud, setHud] = useState(false)
  const [track, setTrack] = useState('')
  const [unsupported, setUnsupported] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  // Revoked on the next drop rather than on unmount: the element keeps
  // playing from it for as long as it is the loaded track.
  const objectUrl = useRef('')

  // H matches Musimo, so the overlay is reached the same way in both.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      if (event.key === 'h' || event.key === 'H') setHud((on) => !on)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const load = useCallback((file: File) => {
    const element = audio.current
    if (!element) return
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
    objectUrl.current = URL.createObjectURL(file)
    element.src = objectUrl.current
    setTrack(file.name)
    void element.play()
  }, [])

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) load(file)
  }

  return (
    <>
      <div style={stage} onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
        {unsupported ? (
          <p style={{ padding: 24 }}>No WebGPU adapter here, so there is nothing to draw with.</p>
        ) : (
          <VisualizerStage
            hud={hud}
            preset={preset}
            scene={scene}
            fluidSize={fluidSize}
            onUnsupported={() => setUnsupported(true)}
          />
        )}
        <div style={dropzone}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>{track || 'Drop a track here'}</span>
            {/* The input's own button repeats the file name next to it, so it
                is hidden and the label is the button. */}
            <label style={choose}>
              choose a file
              <input
                type="file"
                accept="audio/*,video/*"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) load(file)
                }}
              />
            </label>
          </div>
          <audio
            ref={audio}
            controls
            style={{ width: '100%', marginTop: 10 }}
            onPlay={() => void attachAudio(audio.current as HTMLMediaElement)}
            onSeeked={() => void resumeAudio()}
          />
        </div>
      </div>
      <Controls
        preset={preset}
        onPreset={setPreset}
        scene={scene}
        onScene={setScene}
        fluidSize={fluidSize}
        onFluidSize={setFluidSize}
        hud={hud}
        onHud={setHud}
      />
    </>
  )
}

const host = document.getElementById('root')
if (!host) throw new Error('demo: #root is missing')
createRoot(host).render(<App />)
