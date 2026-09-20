/**
 * The tuning bench. The stage fills the left, the panel on the right drives
 * the preset it draws with, and a dropped file plays through the same
 * `attachAudio` path a host app uses, so what is tuned here is the real thing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { attachAudio, resumeAudio } from '../src/audio'
import { DEFAULT_FLUID_SIZE } from '../src/catalog'
import { castOrDefault } from '../src/presets'
import type { PinnedCast } from '../src/presets'
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

const elapsed = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`

export default function App() {
  const [cast, setCast] = useState<PinnedCast>(() => castOrDefault('prism'))
  const [backend, setBackend] = useState<'webgpu' | 'webgl2'>('webgpu')
  const [fluidSize, setFluidSize] = useState(DEFAULT_FLUID_SIZE)
  const [hud, setHud] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [track, setTrack] = useState('Ecstasy Of Soul.m4a')
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioError, setAudioError] = useState('')
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
      if (event.key === 'f' || event.key === 'F') setExpanded((on) => !on)
      if (event.key === 'Escape') setExpanded(false)
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
    setAudioError('')
    void element
      .play()
      .catch(() => setAudioError('Could not play this file. Choose another track.'))
  }, [])

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (file) load(file)
  }

  return (
    <>
      <div
        style={expanded ? { ...stage, position: 'fixed', inset: 0, zIndex: 10 } : stage}
        onDrop={onDrop}
        onDragOver={(event) => event.preventDefault()}
      >
        {unsupported ? (
          <div style={{ padding: 24 }} role="status">
            <p>The browser couldn't start graphics.</p>
            <button type="button" onClick={() => setUnsupported(false)}>
              Retry graphics
            </button>
            {/* Prism is the one cast the WebGL2 path can draw. */}
            {cast.id !== 'prism' && (
              <button
                type="button"
                onClick={() => {
                  setCast(castOrDefault('prism'))
                  setUnsupported(false)
                }}
              >
                Open Prism
              </button>
            )}
          </div>
        ) : (
          <VisualizerStage
            hud={hud}
            preset={cast}
            fluidSize={fluidSize}
            onUnsupported={() => setUnsupported(true)}
            onBackend={setBackend}
          />
        )}
        <button
          type="button"
          style={{ position: 'absolute', right: 16, top: 16, padding: '6px 10px', opacity: 0.7 }}
          onClick={() => setExpanded((on) => !on)}
        >
          {expanded ? 'back to controls (Esc)' : 'full view (F)'}
        </button>
        <div style={{ ...dropzone, display: expanded ? 'none' : undefined }}>
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
            preload="metadata"
            onPlay={(event) => {
              setPlaying(true)
              setAudioError('')
              void attachAudio(event.currentTarget)
            }}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
            onDurationChange={(event) => {
              const length = event.currentTarget.duration
              setDuration(Number.isFinite(length) ? length : 0)
            }}
            onSeeked={() => void resumeAudio()}
            onError={() => setAudioError('Could not load a track. Drop one in or choose a file.')}
          >
            <source src="/audio/Ecstasy%20Of%20Soul.flac" type="audio/flac" />
            {/* The default track is Git-ignored, so a fresh checkout has none.
                The last source failing means nothing loaded, so stop naming it. */}
            <source
              src="/audio/Ecstasy%20Of%20Soul.m4a"
              type="audio/mp4"
              onError={() => setTrack('')}
            />
          </audio>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => {
                const element = audio.current
                if (!element) return
                if (element.paused)
                  void element.play().catch(() => setAudioError('Could not play this track.'))
                else element.pause()
              }}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <input
              type="range"
              aria-label="Track position"
              min={0}
              max={duration || 1}
              step={0.1}
              value={position}
              disabled={!duration}
              style={{ flex: 1, minWidth: 40 }}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (audio.current) audio.current.currentTime = next
                setPosition(next)
              }}
            />
            <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {elapsed(position)} / {elapsed(duration)}
            </span>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.01}
              defaultValue={1}
              style={{ width: 70 }}
              onChange={(event) => {
                if (audio.current) audio.current.volume = Number(event.target.value)
              }}
            />
          </div>
          {audioError && <p role="status">{audioError}</p>}
        </div>
      </div>
      {!expanded && (
        <Controls
          cast={cast}
          onCast={setCast}
          fluidSize={fluidSize}
          onFluidSize={setFluidSize}
          hud={hud}
          onHud={setHud}
          webGpuAvailable={backend !== 'webgl2'}
        />
      )}
    </>
  )
}
