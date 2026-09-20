/**
 * The tuning bench. The stage fills the left, the panel on the right drives
 * what it draws with, and a dropped file plays through the same `attachAudio`
 * path a host app uses, so what is tuned here is the real thing.
 *
 * The panel has two modes. Presets is the picker and the cast's knobs; Bench
 * solos a study, or a small cast, under sliders and a synthetic packet, and
 * keeps its whole setup in the URL hash so a tuned one can be sent on. The
 * bench is held here and not in its panel so the full view, which hides the
 * panel, still shows what it is drawing.
 *
 * The picker's first entry is Auto, which pins nothing and lets the director
 * choose from the song; the five below it pin a cast. The panel shows what
 * the director is doing either way, since it reads the song under a pinned
 * cast too, and `onCharacter` is what a host would save for the next play.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { attachAudio, resumeAudio } from '../src/audio'
import { DEFAULT_FLUID_SIZE } from '../src/catalog'
import { castOrDefault } from '../src/presets'
import type { Character, PinnedCast } from '../src/presets'
import VisualizerStage from '../src/Visualizer'
import { BenchPanel } from './bench/BenchPanel'
import { decodeBench, encodeBench, initialBench } from './bench/state'
import type { BenchState } from './bench/state'
import { useBench } from './bench/useBench'
import { Controls } from './controls'
import type { Mode } from './controls'

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

/**
 * Keep the bench in the address, a moment after the last change so a slider
 * drag is one entry and not a hundred, and take the bench back out of it when
 * the mode is left. `replaceState` and never a push: the back button should
 * leave the page and not walk through every slider position.
 */
function useBenchHash(mode: Mode, bench: BenchState, onBench: (bench: BenchState) => void) {
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const { pathname, search, hash } = window.location
        if (mode === 'presets' && decodeBench(hash) === null) return
        const next = mode === 'bench' ? `#${encodeBench(bench)}` : ''
        window.history.replaceState(null, '', `${pathname}${search}${next}`)
      } catch {
        // A sandboxed frame may refuse to touch the address. The bench still
        // works; it just cannot be shared.
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [mode, bench])

  // Someone pasting a bench link into the tab they already have open.
  useEffect(() => {
    const onHash = () => {
      const next = decodeBench(window.location.hash)
      if (next) onBench(next)
    }

    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [onBench])
}

export default function App() {
  const [mode, setMode] = useState<Mode>(() =>
    decodeBench(window.location.hash) ? 'bench' : 'presets',
  )
  const [bench, setBench] = useState<BenchState>(
    () => decodeBench(window.location.hash) ?? initialBench(),
  )
  const session = useBench(bench, mode === 'bench')
  const openBench = useCallback((next: BenchState) => {
    setBench(next)
    setMode('bench')
  }, [])
  useBenchHash(mode, bench, openBench)
  const [cast, setCast] = useState<PinnedCast | 'auto'>(() => castOrDefault('prism'))
  // What a host would write down against this track and hand back as
  // `startCharacter` the next time it played.
  const [saved, setSaved] = useState<Character | null>(null)
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
            {cast !== 'auto' && cast.id !== 'prism' && (
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
            track={track}
            playhead={audio}
            onCharacter={setSaved}
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
      {!expanded &&
        (mode === 'bench' ? (
          <BenchPanel
            state={bench}
            onState={setBench}
            session={session}
            mode={mode}
            onMode={setMode}
            webGpuAvailable={backend !== 'webgl2'}
          />
        ) : (
          <Controls
            mode={mode}
            onMode={setMode}
            cast={cast}
            onCast={setCast}
            saved={saved}
            fluidSize={fluidSize}
            onFluidSize={setFluidSize}
            hud={hud}
            onHud={setHud}
            webGpuAvailable={backend !== 'webgl2'}
          />
        ))}
    </>
  )
}
