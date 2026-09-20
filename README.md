# visimo

A music visualizer package with fluid and kaleidoscope scenes. Give it an `<audio>` element; bands, onsets, key and song structure drive scene parameters and a post stack through JSON presets.

WebGPU is preferred. Kaleidoscope also runs through WebGL2 when no WebGPU device is available. Fluid and its Plume/Wash presets require WebGPU. If neither available backend supports the chosen scene, the host receives `onUnsupported`.

It was built inside [Musimo](https://github.com/LeahyCC/musimo) and pulled out so scenes and presets could be worked on against a bench rather than a music library. Musimo consumes it as a git dependency and is still the main user.

## Install

```sh
npm install github:LeahyCC/visimo#v0.1.0
```

`react` is a peer dependency. Git is needed to install it, which matters in a container: `node:*-slim` images have no git.

### It ships TypeScript, not a build

There is no `dist`, no declaration emit and no build step. The four `exports` point straight at `.ts` and your bundler compiles them. That is not a shortcut, it is the only shape that works: the feature worker is constructed as

```ts
new Worker(new URL('./features.worker.ts', import.meta.url), { type: 'module' })
```

and a library build either swallows that pattern into its own assets, where the consumer never finds it, or leaves a URL nothing emits a worker for, which 404s at runtime. Shipping source hands the pattern to the consumer's bundler, which is the one that knows where the worker should land.

Two consequences for a host on Vite:

```ts
// vite.config.ts
export default defineConfig({
  optimizeDeps: { exclude: ['visimo'] },
})
```

Without it the dev server dies during dependency optimization: the pre-bundler cannot load a `?raw` import out of `node_modules`, and the shaders are all `?raw`. The same exclusion keeps the worker's asset URL intact in a build.

And the package is compiled by your toolchain, so it wants a TypeScript at least as new as the one it was written against (7.0), with `resolveJsonModule` on for the preset files.

## Use

Four entry points, deliberately. A single barrel would drag the whole WebGPU tree into your main bundle.

| Entry            | What is in it                                                                      | Where it lands                |
| ---------------- | ---------------------------------------------------------------------------------- | ----------------------------- |
| `visimo`         | `VisualizerStage`, `renderer`, `hasWebGpu`, `FeatureClient`, `F`, `PACKET_LENGTH`  | import it lazily, about 38 KB |
| `visimo/audio`   | `attachAudio`, `resumeAudio`, `audioGraph`, `FFT_SIZE`                             | lazily, about 550 B           |
| `visimo/presets` | `PRESETS`, `parsePreset`, `presetOrDefault`, `stepPreset`, `POST_LANES`, the types | your main chunk               |
| `visimo/catalog` | `SCENE_IDS`, `SCENE_LABELS`, `FLUID_SIZES`, `isSceneId`                            | your main chunk               |

`presets` and `catalog` touch no GPU and no WGSL, so a preset picker can be drawn without loading the visualizer at all. That split is the whole reason there are four of them.

Audio first, from the element's `play` event:

```ts
element.addEventListener('play', async () => {
  const { attachAudio } = await import('visimo/audio')
  await attachAudio(element)
})
```

`attachAudio` takes one element and one only. A `MediaElementSource` can be built just once per element, and on media served without CORS headers the browser silences it permanently, so the host has to pick the element it knows is same-origin. A second element is refused rather than broken. Call `resumeAudio()` when the page becomes visible again; browsers suspend the context behind a hidden tab.

Then the stage:

```tsx
const Stage = lazy(() => import('visimo').then((m) => ({ default: m.VisualizerStage })))

<div style={{ position: 'relative' }}>
  <Stage
    hud={hud}
    preset={presetOrDefault(chosen)}
    scene={scene}
    fluidSize={512}
    onUnsupported={() => setFallback(true)}
  />
</div>
```

Both canvases are `position: absolute; inset: 0`, so **give them a positioned parent**. They carry no stylesheet; `className` and `hudClassName` are there if you want to restyle them.

`onUnsupported` fires when the chosen scene cannot start or recover on an available backend. `hasWebGpu()` only checks whether the WebGPU API exists; it neither guarantees an adapter nor detects the WebGL2 fallback. Do not use it to block loading Kaleidoscope. The optional `onBackend` callback reports `webgpu` or `webgl2` after attachment.

### The `data-*` attributes are public API

The scene canvas carries, on attach and then throttled to 500 ms:

| Attribute       | What it says                                  |
| --------------- | --------------------------------------------- |
| `data-adapter`  | the adapter, as its info describes it         |
| `data-frame-ms` | the frame time                                |
| `data-scene`    | the scene id drawing                          |
| `data-detail`   | what that scene is doing, such as `512 fluid` |
| `data-post`     | the post stages running, or `off`             |
| `data-preset`   | the preset id                                 |

They exist for tests and screenshots and Musimo's e2e suite asserts on all six. Breaking one breaks a consumer silently, so treat them as the interface they are. Kaleidoscope's `data-detail` includes its internal render dimensions, allowing a canvas/scene size mismatch to be diagnosed.

## The demo

```sh
npm install
npm run dev
```

The demo opens Prism. Drop a track on the left and tune on the right. Files become object URLs on the same `<audio>` element and use `attachAudio`, as they do in a host app. Play/Pause buttons and labelled seek/volume controls replace the native media widget after repeated in-app browser crashes during testing. Fluid, Plume and Wash choices are disabled when WebGL2 is active.

Vite is pinned to `http://127.0.0.1:5174/` with `strictPort: true`; it fails if that port is occupied instead of silently moving. Keep the server process running. A cached page can remain open after the server exits while its feature worker and hot-reload connection fail. During diagnosis, port 5174 had no listener and the stale page was trying a hot-reload connection on 5173. A persistent background Vite process restored the correct endpoint.

If graphics cannot start, **Retry graphics** mounts a fresh stage while retaining the audio element and its track. After failed WebGPU recovery, the stage replaces its scene canvas once so WebGL2 can acquire a fresh context. A canvas previously used for WebGPU cannot switch context type in place. The console logs unavailable APIs and initialization failures.

Every control is generated from the lists the package keeps: the scene knobs from `SCENE_KNOBS`, the post knobs from `POST_LANES`, the mapping vocabulary from `AUDIO_FIELDS` and `CURVES`. Add a knob to the package and it appears here with nothing to change, though a knob whose range is not obvious wants a row in `RANGES` in `demo/controls.tsx`. **copy preset** puts the whole thing on the clipboard as JSON that `parsePreset` accepts; drop it into `src/presets/` and add it to the list in `src/presets/index.ts`. **reset** puts every number back to what the preset file holds, and is greyed out until something is touched, so it also answers whether the panel has drifted from the file. H toggles the HUD. F opens full view and Esc returns. Choosing a preset selects its scene; choosing a scene selects its first preset. The grid control appears only for Fluid.

What updates without a reload, measured by editing each file while the demo ran:

| Edit                         | Live                                      |
| ---------------------------- | ----------------------------------------- |
| `demo/*.tsx`                 | yes, React Fast Refresh                   |
| `src/shaders/*.wgsl`         | yes, the pipelines recompile              |
| `src/scenes/fluid.params.ts` | yes, the next frame reads the new numbers |
| `src/presets/*.json`         | only through a full page reload           |

The shader row was checked rather than assumed: a hot update that recompiled nothing would look the same as one that did, so the sim shader was fed WGSL that cannot parse and the GPU raised the error straight away. The demo now keeps its component in `demo/App.tsx` and creates the React root only in `demo/main.tsx`. This avoids duplicate roots when a dependency changes. Hot replacement disposes the old renderer, releases its scene, post stack and audio worker, removes its GPU-loss listener and cancels pending attachment. Ordinary stage unmounts still retain scene state. GPU module changes can restart scene resources, so use the sliders for uninterrupted tuning and reload when changing preset files.

## How it works

### Audio graph

One `AudioContext` and one `AnalyserNode` (`fftSize` 4096, no smoothing; the extractor smooths per band), in `src/audio/AudioGraph.ts`. 4096 rather than 2048 because the low bands need it: at 2048 a bin is 23.4 Hz and the whole 20 to 60 Hz sub band was two bins wide. The cost is an 85 ms window instead of 43, so transients smear a little and the per-band onsets fire slightly softer; that is the trade, and it is one constant to put back. It is a module singleton, so it survives any remount.

The source is attached only once the context is running. A context built outside a user gesture starts suspended and a source on a suspended context is silent, so `attachAudio` resumes first and checks `state === 'running'` before creating the source. If the browser refuses, the track still plays on its own and the next `play` tries again.

### Feature extraction

`src/audio/FeatureExtractor.ts` turns each analyser frame (dB per bin, plus the seconds since the last one) into a 47-float packet. It is pure TypeScript and normally runs in a worker (`features.worker.ts`, protocol in `features.protocol.ts`). If worker creation, loading, message decoding or sending fails, `FeatureClient` switches to the same extractor on the main thread, rebuilding the transferred spectrum buffer and ignoring stale replies. Analysis continues, with its CPU cost now on the rendering thread. The spectrum buffer is transferred to the worker and handed back with each packet. The client accumulates the time of render ticks skipped while the worker is busy. The renderer retains continuous levels between replies but consumes each packet's hit events only once, so slower replies cannot duplicate splats.

In order:

- dB to linear magnitude, then five log-spaced bands: sub 20 to 60 Hz, bass 60 to 250, lowMid 250 to 1k, highMid 1k to 4k, treble 4k to 16k. Each band is the root mean square of its bins, then an envelope with its own attack and release (sub 20 and 250 ms, treble 5 and 90 ms), then scaled by the loudest that band has been in the last few seconds, so a quiet track fills the same 0 to 1 as a loud one.
- A bin is centred on its own frequency and covers half a bin either side, and `bandFilter` weights it by how much of that span falls inside the band. Rounding each edge to the nearest whole bin instead put the 20 to 60 Hz sub band at 23 to 70 Hz, which is a tenth of the bass band sitting inside the sub one, so a bass note read as a kick. Weighted edges make a band cover the Hz it asks for at any FFT size, and the one bin two neighbours straddle is split between them rather than claimed by both or rounded away. What it cannot fix is the analyser's own window, whose main lobe is about three bins wide, so a pure tone always spreads into its neighbours; that is why a band can still hear a fraction of a hit just over its edge.
- The level is the root mean square rather than the mean of the magnitudes, which is what the energy in a band is and what `energy` already used over the whole spectrum. A mean divides one bright partial by the whole band: the same power gathered into a single bin read about the square root of the bin count lower, a factor of over twenty in a 512-bin treble band.
- Each band also detects its own onsets, in the same pass. The rise of each bin over the last 30 ms is already being read there, so a band's own half-wave rectified flux costs a subtract per bin and no second sweep; it is divided by the band's width like the level is, so a wide band and a narrow one reach their detectors on the same scale. Every band then gets its own copy of the detector below, with its own rolling window. That is the whole point: a band that is always busy settles on a high threshold and a quiet one on a low threshold, so the hats keep firing through a passage the kick is sitting out, and one emitter can answer the kick while another answers the hats. Each band publishes the frame it fired on, carrying that hit's strength, and a pulse that decays from it. In the same pass each band also measures where its rise sat across the spectrum and how wide it was: the rise-weighted mean and spread of the bins' places in octaves from 20 Hz to 16 kHz, as fractions of that span. They are written every frame and mean something on the frame the band's hit fires, which is what lets a scene give a sound a place of its own.
- `energy`: RMS from 20 Hz to 16 kHz, smoothed and scaled the same way.
- `flux`: half-wave rectified spectral flux, measured on log magnitude rather than raw. `log1p(1000 x magnitude)` per bin, the gain being that large because the magnitudes are small and `log1p` of 0.01 is 0.00995, which compresses nothing. On raw magnitude the same musical hit produced about ten times the rise in a loud passage as in a quiet one, so each detector's sensitivity drifted with the mix instead of staying fixed on the music. The rise is measured against the frame from 30 ms ago rather than the last one, whatever the frame rate: two analyser reads a frame apart overlap by 45% at 60 frames a second and by 92% at 144, so a per-frame rise shrank as the display got faster, and on a 144 Hz display the detectors were firing two or three times a second on the jitter between reads, through a sustained pad, at a rate that halved when the frame rate did. The onset threshold is the mean plus 2.5 standard deviations over a 1.5 second window, a span of time and not a count of frames, measured before the current frame joins it. An onset is flux rising through that threshold and at least 0.2 above the window's mean, at most one per 80 ms. The floor is the part that keeps a quiet passage quiet: the threshold is relative, and mean plus a few deviations of nearly nothing is a bar anything clears. On a real track the jitter of a pad reached 0.19 in every band, a hat spread across the treble band 0.3 to 0.6 and a kick in the sub band 1 to 3, so 0.2 sits in the gap; a band under four bins wide gets it raised by `sqrt(4 / bins)`, since it averages nothing out. `onsetStrength` grades the hit against the loudest recent one, since flux over its own mean is 1 on average and would hide hits in sustained music. `beatPulse` jumps to 1 on an onset and falls to 1/e in 180 ms.
- `tempo`: in `src/audio/TempoTracker.ts`, twice a second, the autocorrelation of the last 8 seconds of the bands' own flux, over the lags that mean 60 to 200 BPM. Each band's rise is resampled to 100 Hz (each 10 ms sample the average of the frames that overlap it, since the rise is a level that holds for the 30 ms it is measured over), put over its own mean and compressed with `log1p(3 × flux / mean)`, because a few big hits otherwise own the correlation and the beats between them do not register. The five are then summed, each weighted by how periodic it is on its own, and the sum is what is correlated. That is the part that matters: the whole spectrum's flux was really the treble's, since a thousand of its bins are treble and four are sub, so a kick barely registered and what it measured was the snare and the hats; and the beat in most music is not in any one band but is the kick and the snare taking turns, which only the sum sees as one pulse. Correlations are normalised by overlap and measured out to four times the slowest lag, so each lag can be scored with half its double and a quarter of its quadruple added in; before, the correlations stopped at the 60 BPM lag, so nothing under 120 BPM had a harmonic to its name and a dotted figure could outscore the beat with nothing to say it was no level of the metre. The score is weighted toward 120 BPM by a log-Gaussian 0.9 octaves wide, when the half lag correlates at least 0.6 as well it wins, and a period an octave from the one already reported has to outscore it by 15% to take over, so the beat and its half-bar, which often score within a few percent of each other, cannot flip every few seconds. The winning lag is refined between samples with a parabola through its neighbours, since one sample is 2% of a tempo. The first reading comes at four seconds from the part of the window that has filled; the reported value is the median of the last five, and it stays 0 until one lag clearly wins. Alongside it come a confidence, the correlation at the chosen lag averaged over those readings, and the beat phase: a pulse train at the period is laid over the last four seconds of the summed envelope and slid to where the onsets are, and the phase then runs forward on its own between estimates, nudged a third of the way toward each new measurement, so a scene can anticipate the next beat rather than react to the last one.

The layout is at the top of the file, 47 floats read by name through `F` and never by a literal index: 0 to 4 the five band levels, 5 to 9 each band's own hit, 10 to 14 each band's pulse, then 15 energy, 16 and 17 flux and its threshold, 18 to 20 the global onset, its strength and the beat pulse, 21 the tempo guess in BPM, 22 and 23 time and the frame step, 24 to 27 four of the five that describe the song rather than the frame, 28 to 30 the harmony, 31 to 33 the structure, 34 to 43 where each band's hit landed and how wide it was, 44 and 45 the tempo's confidence and the beat phase, and 46 `hardness`, which belongs with 24 to 27 and sits at the end because that is the only place a row may go. Rows are only ever added at the end, because the indices are public.

The global rows are the same detector run over the whole spectrum. They stay because the post stack reads `beatPulse`, presets map `flux` and `onsetStrength`, and the overlay draws the flux trace.

Nothing on the GPU reads any of this. Every consumer takes the `Float32Array` on the CPU, so there is no vec4 alignment to keep and the packet grows freely. The renderer used to upload it as a uniform buffer no shader bound; that buffer is gone.

`F` and `PACKET_LENGTH` are exported from the package, so this layout is public API. Musimo pins visimo at a tag and nothing here reaches it until a new one is cut.

### The song rather than the frame

Everything above answers what the music is doing in the last few milliseconds. Five more answer what kind of track it is and where in it we are, so a ballad and a drum and bass track can look different without a preset being swapped. They are levels in 0 to 1 like any other and a preset reads them through the same mapping table, which is why this needed no new machinery: `value = resting + Σ gain x curve(feature)` was already the right arithmetic and had only ever been given fast features.

All five are slow on purpose. The point is a number that has made up its mind, not another thing that flickers.

- `pace`: onsets a second in any band, each hit decaying away over half a minute, scaled so 12 a second is full. A pad with a pulse runs about 2, a full kit with hats about 6 and drum and bass past 12. It counts a hit in any band rather than the global detector's, because a kick that lives in three sub bins barely moves the flux of the whole spectrum. It is a decayed count rather than a rate measured between hits, so it needs no memory of when the last one was and cannot spike on one close pair. **This is the one to reach for when what you mean is "fast".**
- `swell`: loudness now against loudness over the last half minute, in dB, centred so a steady passage sits at 0.5, six dB up is 1 and six dB down is 0. In dB rather than as a ratio so the two directions are the same distance from steady: as a ratio, half the loudness was already the floor and one and a half times the ceiling, so a preset could thin a knob in a breakdown far more easily than lift it in a drop. Centred rather than starting at zero so one row can lift a knob in a drop and another thin it in a breakdown, from the same feature with opposite gains. It reads the raw RMS and deliberately not `energy`, which is divided by its own recent peak and therefore sits near 1 through any steady passage however loud; a feature built on that one could never see a chorus coming. The long arm is held to the short one until it has seen a full window, because a cold envelope climbs from zero while the short one is already there, and without that every track's first half minute reads as a permanent drop.
- `weight`: where the spectral centroid sits, over about ten seconds, 1 for a track that is all sub and bass and 0 for one that is all highMid and treble. The centroid is the power-weighted mean of log frequency across the span, mapped between where it would sit for a flat spectrum filling the low group and one filling the high group, so it measures the balance of the spectrum and not which bands are occupied; the measure it replaces read the normalised band levels, and two bands that both had content both normalised towards 1, so anything with a kick and a hat in it sat at 0.5. Equal power per octave reads about 0.6, since the low group is fewer octaves wide than the high one, and white noise, most of whose power is above 4 kHz, reads bright. Silence holds the last reading rather than reading noise. Meant for colour and plume size rather than for activity.
- `hardness`: how abrupt and how saturated this track's hits are, as a running mean over the hits of roughly the last twenty seconds. `onsetStrength` cannot stand in for it: that grades a hit against the loudest recent hit, so it says how big this one was for this track and nothing about whether its hits are sharp or soft in general. Everything is measured against the bed the hit arrives over rather than against the mix: a level that falls to the RMS at once and creeps back over 300 ms settles between hits on whatever sustains under them, and the hit's window is the rise above that. Two numbers per hit. How much of the hundred milliseconds after it that rise holds near its own peak, as the mean of the rise over its peak, which is what a clipper and a limiter between them do to a sound; and how much of the spectrum the hit's power is spread across, the mean magnitude squared over the mean square, 1 for a flat spectrum and one over the bin count for a single partial, which is what distortion does to a sine. They are combined as a geometric mean, so a hit has to do both, and a hit that barely lifts the mix over its bed is scored as soft rather than on the shape of a rise that is mostly noise. Each hit's score goes into a decayed sum over a decayed count. On three synthetic tracks in `synthetic.ts` that differ only in the voice on the beat, the hats and the pad, all held to the same RMS: hardstyle (a clipped kick at 150, loud hats, no pad) reads 0.93, house (a plain kick at 124, loud hats, a light pad) 0.62 to 0.65, and lo-fi (a soft pulse at 80, quiet hats, a heavy pad) 0.05. Isolated clipped kicks read 0.87 to 0.89 and isolated soft pulses 0.06 to 0.09; a pad with nothing struck in it reads 0.11. It starts at a neutral 0.5, carried as a prior worth four hits rather than as a value held until a threshold, so it leaves the middle as fast as the evidence arrives and never steps; a track that has not been heard yet is not a soft track. Silence steps neither half of the ratio, so it holds where the last sound left it, the way `weight` holds its centroid. **Nothing reads it yet**; it is there for the study picker in `docs/canvas-plan.md`.

- `tempo`: the BPM guess across 60 to 200, smoothed over five seconds. The raw guess steps when the tracker changes its mind, and the ramp is the only reason the normalised one is worth having: the scene drifts rather than lurching. A guess of 0, meaning nothing has settled, holds the ramp where it is rather than dragging the scene to nothing. **Gate anything built on it with `tempoConfidence`**, below.

What `hardness` cannot tell apart is anything faster than the analyser's window. At `fftSize` 4096 a frame is 85 ms of sound, so a hit that reaches full in 5 ms and one that takes 40 look the same going up: both fill the window inside one frame. What separates the synthetic pair is that the soft one takes 120 ms, which is longer than the window. Anything under about a tenth of a second of attack is one sound to this measure, and what still separates two such hits is the second half of it, the spread. Both halves need the hit to be audible over what is under it: a kick under a pad six times its own size lifts the mix by a hundredth, and such a hit is scored as soft because the shape of a rise that small is noise, not because it was heard to be soft. It is frame-rate independent to within 0.035 between 60 and 144 frames a second, measured across all three tracks above and the isolated pair. A 20 dB level change moves it by under 0.03 as long as the mix stays clear of the -60 dB floor the rest of the file uses, and the lo-fi track is the exception that shows where that floor is: it is mostly pad, so 20 dB down it straddles the floor and reads 0.35 rather than 0.05. Under the floor nothing is heard at all and the value holds rather than reading.

A slow feature and a fast one pointing at the same knob add, so `pace → vorticity` on top of `treble → vorticity` can push a knob past what either was tuned for. The gains are the control and zero is off.

### The beat as a clock

Everything above reacts. `beatPulse` jumps when an onset has already happened, and the fastest a scene can answer is a frame late. Two more rows let it anticipate.

- `beatPhase`: where in the beat we are, 0 on a beat and rising to 1 just before the next, predicted from the tracker's period and phase rather than read off an onset. Through `invert` it is a pulse that falls across the beat and lands on time; through `square` it is a ramp that gathers toward the beat. It runs on through a passage where the tempo drops to 0, at the last tempo that won, because a ramp that carries on through a bar of doubt is less jarring than one that stalls; it is 0 only before any tempo has ever been found.
- `tempoConfidence`: how well the chosen period correlates, 0 to 1. A click train reads about 0.9, four to the floor about 0.85, a two-step about 0.45, a breakdown with no drums under 0.2, and noise or silence 0. A phase on a wrong tempo is a steady rhythm in the wrong place, so a preset that maps the phase wants a second row that thins the same knob as the confidence falls, or gains that do nothing at 0.

The phase runs about a thirtieth of a beat behind the signal, since a hit has to get some way into the analyser's window before its rise shows. It is the same on every beat, so it reads as a fixed offset and not as drift.

### The harmony

Band energy knows a band is loud and nothing else. Three more rows know which notes are playing, so a song can have a colour of its own and a chord change can be seen.

A chroma is read each frame from the peaks of the log spectrum between 100 Hz and 5 kHz: a bin louder than both neighbours and above about -60 dB, its frequency refined between bins with a parabola through the neighbours (a bin is wider than a semitone below 200 Hz), folded onto its nearest of the twelve pitch classes and weighted by its log magnitude. Peaks rather than every bin because drums fill every bin: on a real track a magnitude chroma wavered between a key and its relatives while the peak-picked one held the right key throughout.

Three copies of that chroma are kept, smoothed over 0.3 s, 2 s and 8 s.

- `keyHue`: the key the 8 s chroma fits best, by correlation with the Krumhansl and Kessler profiles for the twenty-four keys, placed on the circle of fifths as a fraction of the way round: C at 0, G a twelfth on, F a twelfth back. Neighbours on the circle share most of their notes, so a modulation to the dominant is a small step of colour and a jump to a distant key a large one. A minor key sits where its relative major does, since the two are the same notes; that also keeps the profiles' habit of flipping between relatives every few bars from moving the colour. The hue is ramped over 3 s as a unit vector, so a key a full turn away is still the short way round. `keyLabel` turns it back into a name for the overlay.
- `keyClarity`: how surely that key is heard, from how well the profile fits (0.4 reads as none, 0.9 as certain) times whether anything tonal is sounding now at all, so it falls the moment the notes stop while the slow chroma still remembers them. On drums alone it sits low.
- `harmonicChange`: the cosine distance between the 0.3 s chroma and the 2 s one, times three. A chord that moves pulls the two apart for as long as the slower one takes to catch up, and then it settles, so it is a pulse of a couple of seconds with no event logic behind it. It is about which notes are sounding and not how loudly.

On Blossom (Au5, 140 BPM, F# minor) the hue read A / F#m for the whole track, the clarity 0.6 to 0.9 in the pad and breakdown passages and 0.1 to 0.5 in the drops, and the change lifted where the chords moved in the sparse passages and was drowned by the drums in the loud ones. That is the honest limit of a chroma read from an FFT: it holds the key, and it sees chords move only when the mix is thin.

### The structure

A song is a shape over minutes, and nothing above remembers more than half a minute of it. Three more rows do.

Every two seconds a snapshot is kept of what the last couple of seconds sounded like: the five band levels and energy, a hit rate per band, and the shape of the 2 s chroma (each bin less a flat twelfth, so a passage with no notes contributes nothing), 23 floats. Swell is deliberately not in it: it is loudness against the last half minute, so the same quiet passage reads differently after a drop and after silence, and with it in the vector a returning passage failed to recall itself. Every section that has ended is also kept as one mean vector. Twice a second the present is compared, by cosine, with those section means.

- `recall`: the best of those matches, mapped so a similarity of 0.94 reads 0 and 0.99 reads 1. The section going on is not among the memories, so a steady passage does not recall its own start and a returning one recalls the whole of its first time round. Whole sections rather than the two-second snapshots, because a single snapshot of the intro's last bar matched the first drop well enough to call the drop a return of the intro. On Blossom the three drops matched one another at 1.00 and a verse its own return at 0.98 to 0.99, while a drop against the intro sat at 0.96 and against a verse at 0.94, which is why the map is that steep and sits just above those.
- `novelty`: how far the present has moved from the snapshot ten seconds ago, times five. It lifts for a few seconds after a passage changes and then settles. It lifts on a fill too, which is right for a level and wrong for a boundary, so a boundary takes two steps.
- `section`: which section this is, 1 for the first. Novelty at 0.4 or more, once a section has run six seconds, is a candidate; a level rather than a rising edge, because a riser running straight into a drop keeps the novelty up across both and an edge missed the drop. Six seconds on, the mean of the new passage (from a second and a half after the candidate) is set against the mean of the section it would end (from four seconds after that began, and only from moments when the novelty was low, so a riser running into a drop cannot fold the drop into its own section), and if the two are at least 0.965 similar the candidate was a fill and is dropped. A confirmed boundary rejoins an older section when the recall to it, judged with the closest the present has come to it while the candidate was open, reaches 0.6, and otherwise starts a new one. On Blossom that put all three drops in one section, the two risers before the second and third in another and the quiet passages mostly together, called the first drop about ten seconds late, and found a boundary or two more than a listener would count. The lateness is the price of confirming: a change is only a section once six seconds of it have been heard, and a change that follows another within six seconds waits its turn, so a riser that runs straight into a drop can put the drop's layout ten seconds behind the drop. The novelty level lifts within a second or two either way, and that is what the preset turns into the surge; the layout is the slower confirmation. It is an id rather than a level, so it is not in the mapping vocabulary; a scene reads it straight from the packet, the way it reads an onset, and chooses a layout with it. That is what lets a chorus that comes back come back to the same look.

Nothing is remembered until the vector has had four seconds to settle, and once the notes have faded the chroma reads as flat rather than as the last note held for ever, or a memory of the cold start would read as a boundary against everything.

### The renderer

`src/gpu/Device.ts` shares one device and any pending acquisition across callers. Acquisition makes up to three attempts: first with the high-performance preference, then with the browser default after waits of 300 ms and 600 ms. Request exceptions and uncaptured GPU errors are logged. Device loss clears the singleton so recovery can request another device. Recognised software adapters use reduced scene budgets.

`src/gpu/Renderer.ts` is the one renderer. A stage hands it a canvas on mount and takes it back on unmount, which matters because a host may portal the stage into another document (Musimo's popout does) and the subtree then remounts on every move:

```
module singleton, survives remounts        per mount, made again each time
----------------------------------        -------------------------------
GPUDevice, CPU feature packet             canvas elements (scene + HUD)
pipelines, the fluid's field textures      GPUCanvasContext, configure()
the post stack and its parameters          ResizeObserver, visibility hook
the preset and its resolved numbers        requestAnimationFrame handle
the feature worker and its client
frame clock, HUD history
```

The post stack's offscreen textures belong to neither column: the singleton owns them and rebuilds them whenever the canvas size changes. The renderer always forwards the current dimensions to its scene, even if the canvas size is unchanged. This matters when a fresh scene mounts on an existing canvas; otherwise its internal dimensions can remain 1×1.

`attach` configures the context, sizes the canvas to its CSS box times `devicePixelRatio`, and starts a loop on the canvas's own window, so a popped-out window keeps drawing while the tab behind it is hidden. On device loss the renderer drops the scene, post stack and feature client, then reattaches the same canvas through the bounded acquisition retries. Startup, recovery and frame errors are logged and reach the fallback. A failed frame cancels the next animation callback instead of submitting repeatedly. `VisualizerStage` ignores inactive callbacks and replaces its scene canvas once after failed recovery, allowing a different graphics backend. If graphics remain unavailable, Retry graphics retains audio playback.

Each frame: read the analyser through the feature client, stamp time and dt into the CPU packet, resolve the preset's mapping into the scene's numbers and the stack's, run the scene's passes into the stack's texture, run the stack onto the canvas, then draw the HUD if it is on. Each scene uploads its own resolved parameters. Nothing per frame touches React.

### Scenes

Fluid and Kaleidoscope share the `Scene` interface in `src/scenes/Scene.ts`: `init`, `resize`, `update`, `render`, `dispose`, and a `detail` line naming what it is doing. Switching disposes the old scene, discards its feedback history and builds the new one on the same device. The audio worker and post stack carry on.

A scene may also offer a `flow`: the velocity field it is solving, as a texture view plus the `cover` that maps canvas uv to that field's own uv. The feedback pass reads the last frame back along it, which is `feedback.carry` under Post stack below. Fluid offers its velocity field and Kaleidoscope offers nothing, so the property is optional and the stack binds one zero texel in its place. It is read after `render` and never held, because the field a scene names is whichever half of a ping-pong pair that frame wrote.

No scene decides what drives what. `update` takes the packet and a set of already resolved numbers, and every magnitude comes from the second of those; the packet is read for the clock and for events such as an onset. Per-band levels and hits are the exception. Fluid's voices and Kaleidoscope's band envelopes read them straight from the packet, so a preset scales them with a knob such as `bandReaction` and cannot remap them.

#### Kaleidoscope

The demo defaults to **Prism / Kaleidoscope**. **full view (F)** fills the browser while music continues. **Esc** returns to controls; **H** toggles the HUD. The default track is Ecstasy Of Soul. A local, Git-ignored `demo/public/audio/Ecstasy Of Soul.flac` is tried first, with `Ecstasy Of Soul.m4a` as fallback. The original M4A is unchanged. Both files are Git-ignored, so a fresh checkout or worktree has neither; the demo then asks for a track and stays black until one is dropped in. FLAC playback avoided the media crashes seen during testing. To create that local copy, run `ffmpeg -i "Ecstasy Of Soul.m4a" "Ecstasy Of Soul.flac"` in the audio directory, or choose another track.

`src/scenes/Kaleidoscope.ts` draws the 3D fractal in `src/shaders/kaleidoscope.wgsl`. The WebGL2 path uses `KaleidoscopeWebGL.ts` and the matching `kaleidoscope.glsl`, with the same CPU band processing, mappings and motion. Rays march through mirrored box and sphere folds. Surface normals, coloured materials and highlights give the nested forms depth. The distance estimate uses reduced steps and a fixed budget; it is not a proven conservative bound for every warped configuration.

The same five band envelopes and individual hits used by Plume control successive recursion scales, from coarse sub and bass structure to finer mid and treble detail. Each band controls its material contribution and influences its assigned folds. Those folds share one field, so their geometric effects can interact. Low-band hit envelopes linger longer; treble accents release faster. Hit width is not used. Silent bands contribute no material, and a silent packet renders black. `bandReaction` sets overall response strength; slower preset mappings handle key, pace and harmony.

`zoom` sets base magnification. `zoomAmount` and `zoomSpeed` control the continuous inward/outward sweep, which changes camera distance and field of view. Setting amount to zero removes the sweep; zero speed holds its current phase. `symmetry` sets rotational repeats with mirrored half-wedges. `complexity` ranges from 3 to 10 and produces `complexity + 2` fold iterations. Software adapters cap complexity at 5, giving at most 7 iterations. The march stops after at most 72 steps, or 44 on software adapters. The scene sets `maxFps` to 60, so the renderer skips display frames it does not need: a 176 Hz display draws at 59 and a 144 Hz one at 72. It also sets `maxPixels` to 2560×1440. On a larger canvas the scene and the post stack run at that budget and the composite scales the result up, which works because every post stage samples by uv. `data-detail` reports the size actually drawn. Fluid sets neither.

`depth` changes the twist through the volume; `warp`, `thickness` and `bassLift` adjust fold geometry. `bassLift` only widens the coarsest folds, by under one percent at full value. Prism leaves it at zero and maps nothing to it, so it does nothing there. `sparkle` adjusts treble highlights. Rotation, travel and morph speeds preserve their phase when changed. Intensity and palette controls apply after material shading. Parameter limits also apply after audio mapping.

Material detail is filtered against an estimated pixel footprint. Surface normals get the same treatment. The march uses every fold, because the surface is defined by them. The normal is taken from a copy of the distance field in which folds with creases smaller than a pixel fade out (`LOD_LOW` and `LOD_HIGH` in the shader). Left in, those folds gave each pixel a near-random normal that flipped between frames, which was the fine-detail shimmer. The pixel size used for this and for the hit test follows the zoom sweep's field of view. Hardware rendering takes four spatial samples below 900 pixels on the shorter side, two from there up to 3.6 million pixels, and one above that. Software rendering takes one sample. Both paths upload the same 160-byte uniform block. Prism uses bloom and tonemapping; feedback, grain and chromatic splitting are off. WebGL post-processing uses float HDR targets where supported, otherwise RGBA8, which clips bright values before tonemapping. Software WebGL limits the scene to approximately 480×270 pixels in area and a maximum dimension of 960, while the HUD stays at display resolution. This keeps CPU rendering usable at lower fidelity and performance than GPU rendering.

Native GPU checks rendered all five isolated bands, exact black silence, a quieter mix and both tested zoom values (0.4 and 1.9). Five shader-only timing samples measured 6.09–6.68 ms at 1920×1080 and 12.39–13.57 ms at 3840×2160 on the development GPU. These exclude the post stack and browser, and do not establish sustained frame rates or performance on other GPUs. A 12-second, 960×540, 30 fps preview of the track's 45–57 second segment reused the repository's FFT, feature extractor, motion, mappings and full post stack. Native GPU validation and complete video decoding passed.

The external Chromium browser was verified using a real NVIDIA Blackwell WebGPU adapter at 1412×1020, with a visible fractal and positive music-band readings. All 197 tests, typecheck, lint, formatting and production build pass. Its scene initially reported 1×1 despite a full-size canvas; forwarding dimensions to every new scene corrected that mismatch. A brief HUD reading is not a sustained performance benchmark. Separately, the in-app browser's software WebGL2 path passed reload/playback, seek, zoom 0.4 and 3, reset, full-view round trip and pause-to-black checks. Fresh-canvas recovery has regression coverage, but device loss was not exercised end to end. Against a 16-sample reference at 1037×947, the normal fix cut disagreeing pixels from about 14% to 5% in a lighting-only view, and the full picture measured about 0.5 to 1.3%. On an RTX 5080 at 176 Hz, the frame cap took GPU use from 55–99% to 23–39% and power from about 200 W to 110 W. One sample per pixel was tried and kept at two, since edge error rose from 1.3% to 3.5%. A 4380×2160 canvas pinned the same GPU at 99%; the pixel budget, with one sample per pixel at that size, brought it to about 60% at a steady 60 frames a second. Whole-track tuning and Colin's acceptance against the references remain open. See [the research and plan](docs/kaleidoscope-research-plan.md).

#### Fluid

`src/scenes/Fluid.ts` with `shaders/fluid.*.wgsl` and the numbers in `scenes/fluid.params.ts`. Stam's stable fluids on a square grid of compute textures, one entry point per step, all dispatched inside a single compute pass because dispatches in one pass are ordered and see each other's writes:

```
advect velocity ─► diffuse xN ─► curl ─► vorticity and injection ─► divergence
                                                                       │
      draw ◄─ advect dye ◄─ subtract gradient ◄─ pressure xN ◄─ relax ◄─┘
```

Velocity is kept in grid widths per second, so a semi-Lagrangian backtrace is `uv - velocity * dt` with nothing scaling in between. The pressure solve is 24 Jacobi sweeps warm-started from last frame's solution faded to 0.8, which converges far better in that many sweeps than starting from nothing. The viscosity solve is two sweeps with the alpha set directly rather than derived from a physical viscosity, because what is wanted is a knob. Walls are free slip. Vorticity confinement pushes each eddy back toward its own centre, which keeps small detail alive against the smearing advection adds.

Every field is `rgba16float`, including the three carrying one number. `r32float` would halve the memory but is not filterable, so each would need its own bind group layout; one format means one explicit layout and any three fields can go to any step. Curl is read before divergence is written, so both live in one scratch field. Seven textures in all: velocity, dye and pressure ping-ponging, and the scratch. 14 MB at 512, 56 MB at 1024.

The grid is fixed at 512 or 1024, so nothing is rebuilt on a resize. It covers the canvas and the overflow is cropped, which keeps the scale the same on both axes so a round splat stays round; `visibleExtent` reports the band the canvas shows and the emitters are placed inside it. A software rasteriser gets 512 whatever was chosen, with 8 pressure sweeps and one viscosity sweep.

Twenty-two numbers are what a preset moves: the two decays, vorticity and viscosity, the emitters' count, spread and orbit, what they trickle, what one onset adds on top, where the dye sits in the palette and how much of its colour is kept, how far each emitter stands for a band of its own, and the five that shape the event pool below. The emitters ride a figure, evenly spaced around it, and push along the tangent of their own path; which figure is the section's, below. `emitters` is a count rather than a magnitude, so the scene rounds it and clamps it between one and the five slots the shader's splat array holds, one per band; the uniform is always sized for all five and carries how many of them this frame filled, which is why the count can move on a slider with no pipeline rebuilt. The trickle is scaled by the step so it does not depend on the frame rate, because a track with long quiet passages otherwise settles into a still frame.

Colour comes from a 256-texel lookup table built on the CPU: deep blue through teal and green into warm orange and magenta and back to the first colour, so the coordinate wraps with no seam. The dye carries its place in that table as a unit vector rather than a number, so two plumes that meet average their colours the short way round instead of sweeping the whole palette between them. The pass that draws it turns the angle back with `fract` rather than by adding half a turn: the half turn had put every colour half a palette from where the scene asked for it, which nothing noticed while the palette drifted and everything would now that a colour means something. Saturation pulls the tint toward its own grey before it is scaled, so a passage with no key to speak of can be drawn with less colour than one that has. Density is bent through `1 - exp(-d)` before it is coloured, so a thick plume reads as its own colour rather than a flat white mass.

The numbers were set by eye at 3840 by 2160 against real tracks, and the first cut was wrong in a way worth keeping. The viscosity alpha started between 0.4 and 2.0, which at 120 frames a second is a box blur of the neighbours every frame: 4K showed enormous soft blobs with no structure in them. Dropping it to between 0.02 and 0.2, halving the splat radius and roughly doubling the vorticity turned the same passage into plumes with filaments down to a texel. Emitter spread then went the other way twice: wide enough to reach the corners left three separate plumes with black between them, so it settled between the two.

Each emitter stands for one band, as far as the `voice` knob asks it to. There are five bands and so at most five emitters; which bands an emitter covers is the scene's own shape rather than the preset's, and it comes from a table indexed by the emitter count. Every band is heard at any count, once and only once, so the knob is safe to drag:

| Emitters | What each one covers               |
| -------- | ---------------------------------- |
| 5        | sub, bass, lowMid, highMid, treble |
| 4        | sub, bass, lowMid, highMid+treble  |
| 3        | sub+bass, lowMid, highMid+treble   |
| 2        | sub+bass+lowMid, highMid+treble    |
| 1        | the whole spectrum                 |

The low bands merge first, because the ear separates the top of the spectrum more finely than the bottom and the treble is the part worth keeping on its own. A group's level and hit are the loudest of its members, not the mean: a group stands for "is any of this playing", and a mean would let one busy band be hidden by its quiet neighbours.

That band's level scales what its emitter trickles, and that band's own onset is what makes it hit. This is the part that needed the per-band detectors: with one global onset a kick and a hat were the same event arriving at two volumes, and the best the scene could do was scale it by each band's level. Now the sub emitter fires on the kick and the treble emitter does not, because they are different events.

The group's place in the spectrum also sets the emitter's colour, how fat it is and how fast it rides the orbit: the start of the tint span, fat and slow for the sub; its end, small and quick for the treble. The tints span under half the palette on purpose. The song's key moves the whole set through `colourShift`, and that is the colour a viewer sees, with the bands as shades within it; spread over the whole palette the bands cancelled the key and every song showed every colour. `voice` at 0 puts every emitter back on the global onset and the shared numbers, which is what the scene did before any of this and what a preset written then still gets; at 1 each one is only its own band.

#### Layouts

A song moves the numbers above all the time. The one thing that changes the composition is the layout: which figure the emitters ride, how far out, how fast, how the figure is turned and how bunched the emitters are along it. There are six, in `fluid.params.ts`: the Lissajous figure the scene has always had, a ring, a figure of eight, a three-lobed sweep, a tall eight and a low wide ellipse. Which one is drawn is the song's section's: the scene reads `section` straight from the packet, keeps the ids in the order it first saw them, and gives the first distinct section the first layout, the second the second, and a section that comes back the layout it had. A change glides over four seconds, an ease in and out between where the emitters were on the old figure and where they are on the new, so nothing jumps; the offset is bent toward a reach of 0.78 of the way to the edge, whatever the spread and the layout add up to, so a loud passage opens the figure out and no emitter ever sits on the wall. It used to be clamped at the edge itself, and since the shipped presets reach a spread of 1 in a drop, every emitter ended up pinned there with its dye piling along the wall. The rest of the section's arrival is the preset's: `novelty` is a feature like any other, and the shipped preset turns it into a surge of force and dye.

#### Events

Five emitters can say which part of the spectrum is playing; they cannot single out a sound. Behind the bed sits a pool of thirty-two short-lived emitters, one spawned for every band hit, so a kick, a hat and a note each get a splat of their own. Where one lands is under its band's emitter, at the height its pitch puts it: the hit's place across the spectrum, low sounds at the bottom of the frame and high ones at the top. How fat it is comes from its band and from how wide the hit was, so a kick is a fat low puff and a hat a small high flick. Each lives for `eventLife` seconds and fades on a curve that is steep at the start and gone at the end, so a hit reads as a hit and not a glow; `eventForce` and `eventDye` are what a full-strength one adds over its whole life, whatever the life and the frame rate, so the knobs mean the same at 60 frames a second as at 144. `events` is how many may be alive at once, up to the pool, and 0 is off; when the pool is full a new hit takes the slot of the one nearest its end, so a busy passage keeps the newest sounds on screen. The splat array in the shader holds the bed and the whole pool, thirty-seven slots, and the uniform is always sized for all of them; the frame time did not move when they were added.

What this cannot do is tell a vocal from a lead synth in the same range. Two sounds that share a band and a pitch get one splat between them; that is source separation, a different order of problem.

The two sizes are not just detail levels. 512 fills the frame with bold, soft-edged plumes; 1024 draws finer, wispier ones, because the same emitter radius is a smaller fraction of the larger grid.

### Post stack

`src/post/PostStack.ts` sits between the scene and the swap chain. The scene never draws on the canvas: it draws into one of two `rgba16float` history textures, and the composite pass is the only thing that writes the canvas.

```
scene ──► history[current] ──► bright ──► blur x3 ──► composite ──► canvas
                ▲ add                                     ▲
                └── history[other], carried along the scene's flow, then
                    zoomed, turned, decayed, floored and held under a ceiling
                         ▲
                         └── the scene's velocity field, or one zero texel
```

Half floats because a scene's brightest cores run well past 1, and in `bgra8unorm` everything above 1 was lost, which is why loud passages used to clip to a flat white blob. They are also filterable, which the warp and the blur both need.

- **Feedback.** The other history texture, carried back along the scene's flow, then scaled a little about the middle, turned a fraction of a degree and decayed, added under the new frame. The scene has already drawn into this pass's target, so the pass is additively blended rather than reading its own output. On a still image the gain is `1 / (1 - amount × decay)`, about 1.19 at the defaults; more than that and the field turns into a milky haze. The `amount`, `decay`, `zoom` and `rotate` are written as what one frame does at 60 frames a second, and `feedbackStep` in `post/params.ts` converts them by the real frame step (`(amount × decay) ^ (dt × 60)`, `zoom ^ (dt × 60)`, `rotate × dt × 60`), so a trail lasts and travels the same number of seconds at 60 Hz and 144 Hz and presets look as they always did at 60. The new frame is weighted to match, through the pass's blend constant: it is added once per drawn frame, so without that a faster display piled up more of them and the same still image settled at 1.87 at 144 Hz against 1.19 at 60. A missing step reads as one 60 Hz frame, and the step is held between 1/480 s and 0.1 s. [The canvas plan](docs/canvas-plan.md) replaces this stage.
  - **Carry** is the flow part, and 0 turns it off, which is what every preset but Drift asks for. At 1 the history under a pixel is read from where the scene's own velocity field says that light was one step ago, so every part of the screen bends its own way rather than the whole picture turning about the middle; that is the one thing MilkDrop has always done and this stack did not. The velocity arrives in the field's own units, grid widths per second, and the pass divides by the same `cover` it multiplied by to find the grid point, so a wide stage and a tall one carry the same distance. The carry reaches the shader as the canvas uv one unit of velocity moves in this frame, worked out on the CPU, so the shader never sees the frame rate here either. A scene that solves no field has a single zero texel bound in place of one, so there is one pipeline and no branch.
  - **Floor** is what keeps the blacks black. A scene that adds a constant to every pixel, as the fluid's background colour does, has that constant summed by the trail: under a gain `g` it settles at `base / (1 - g)`, which at Drift's 0.94 is seventeen times the base and reads as an even blue haze over the whole frame. The floor is light taken off the carried history, clamped at zero, so the same constant settles at `(base - floor) / (1 - g)` instead; a floor a little under the base's brightest channel times the gain holds it near black. It comes off the brightest channel and the other two are scaled by the same fraction, for the reason under Ceiling. It is written as what one frame does at 60 frames a second and scaled by the real step, the way the rotation is, so it takes the same light off per second at any rate; the decay compounds rather than scales, so the two only agree exactly as the gain approaches 1, and at 0.94 a 144 Hz display settles a code value or two higher. Being subtractive it takes faint light out sooner than bright light, so a trail lasts roughly its own brightness divided by the floor, in frames, once the decay is near 1. That is the point: MilkDrop's trails read as well as they do because what is left of them sits on black.
  - **Ceiling** is what stops a long trail running away. A gain near 1 sums a still pixel toward `1 / (1 - gain)` and half floats hold 65504, so nothing else would. Below half the ceiling nothing changes; above it the brightest channel bends toward the ceiling and never reaches it, and the other two are scaled by the same fraction, for the reason the Tonemap bullet gives: limiting each channel on its own pulls the three together and bleaches the trail toward white. It applies to the history sample alone, after the decay, so it caps what is carried back rather than what the scene has just drawn. The default is 16, far above anything a scene draws, so the shipped presets never meet it.
- **Bloom.** A bright pass with a soft knee at half resolution, then three levels, each a horizontal blur reading the level above (so it downsamples) and a vertical blur inside its own level. Five taps land between texels, so hardware filtering makes each a nine-tap Gaussian for the price of five.
- **Chromatic aberration.** Red and blue are read either side of green, by an offset growing with the distance from the middle. The split is `amount + beat × beatPulse`, so it opens on every onset and closes again.
- **Tonemap.** A shoulder rather than a curve over the whole range: below it nothing changes, above it a value bends toward 1 and never reaches it. Rolling the brightest channel and letting the other two follow keeps a pixel's colour; rolling each on its own bleaches it toward white. An extended Reinhard over the whole range was tried first and made every track flat and muddy.
- **Grain.** A hash of the pixel and a clock, added at the end.

Each stage has an `enabled` flag and the stack has its own; a stage runs only when both are on. `post/params.ts` holds the defaults and `writePostUniform`, which resolves every toggle on the CPU and writes the 144-byte uniform each pass reads, so the shaders have no branches. The last thirty-two of those bytes are the flow block and the floor; a scene's `cover` reaches the first of them through `writePostUniform`'s one optional argument. With every stage off the composite is a straight copy.

It also holds `POST_LANES`, one read and one write per number a preset may name, so a mapping onto `bloom.intensity` writes that one lane each frame rather than rebuilding the object. `bloom.weights` is deliberately not a lane: it is three numbers, a preset can still set it outright, and nothing wants a feature riding on it.

At 3840 by 2160 the stack holds about 176 MB: two full-resolution history textures and six smaller ones.

### Presets

One JSON file under `src/presets/`, and it is the whole of what the stage draws with:

```json
{
  "id": "wash",
  "name": "Wash",
  "scene": "fluid",
  "sceneParams": { "vorticity": 26, "viscosity": 0.06, "...": 0 },
  "postParams": { "bloom": { "threshold": 0.9, "intensity": 0.28 } },
  "audioMapping": [{ "from": "treble", "to": "hitForce", "gain": 1.4, "curve": "linear" }]
}
```

`sceneParams` gives every knob that scene offers a resting value; all of them are required, because a preset is a whole state and not a patch over whatever the last one left. `postParams` is a patch over the stack's defaults, so a preset that only moves the bloom says only that. `audioMapping` is what makes it move:

```
value = sceneParams[to] + Σ gain × curve(feature[from])
```

`from` is one of twenty-six packet fields, plus `lowEnd` for the louder of sub and bass. Five of them are the song-scale ones above, which move over tens of seconds rather than per frame, three are the harmony, two the structure and two the beat as a clock. Five are the per-band pulses, `subPulse` through `treblePulse`. The raw per-band hits are not among them, for the reason `onset` is not: they are events rather than levels, and a scene reads an event straight from the packet. `to` is one of the scene's own knobs, or a dotted post target such as `bloom.intensity`; that is how the parser tells the two apart. `curve` is `linear`, `square`, `sqrt` or `invert`, all of which keep 0 at 0 and 1 at 1 except the last. `gain` may be negative, which is how a feature thins a number rather than raising it: `treble → viscosity` at −0.18 is the fluid keeping its detail when the music is busy. Several rows may name the same knob and they add.

All of it is resolved on the CPU, once a frame, in `presets/resolve.ts`, and nowhere else. That is why a preset can send treble to a knob that used to take bass without a line of WGSL changing. Both resolvers write into an object the renderer owns and keeps, since this runs every animation frame.

| Preset | Scene        | What it does differently                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plume  | Fluid        | The default, and the one the language below describes. Five emitters well split by voice, the key colouring all of them, bass deciding what an onset is worth and treble the vorticity, and the song's own pace, swell and weight moving the resting numbers.                                                                                                                                                                                                                     |
| Wash   | Fluid        | The opposite way round, with thinner viscosity, wider spread, a slower orbit and the voices half blended, so the plumes stay separate instead of growing into each other. It takes the key's colour and nothing else of the song's shape, and it went almost black through the loudest drop until energy fed the dye as well as its decay.                                                                                                                                        |
| Drift  | Fluid        | Plume with the trail turned up and carried by the fluid itself: the last frame is read back along the velocity field, so the echo swirls with the dye rather than zooming out of the middle. The zoom and the turn are off, the dye and the intensity are pulled down against the longer sum, energy lengthens the trail through `feedback.decay`, a floor of 0.018 holds the background near black against the fluid's own base colour, and a ceiling of 1.8 keeps it off white. |
| Prism  | Kaleidoscope | The raymarched fractal, and what the demo opens on. Each band owns a recursion scale, the key moves the palette, and pace, swell and harmony move the slower numbers. Bloom and tonemap only; feedback, grain and chromatic splitting are off.                                                                                                                                                                                                                                    |

### What means what

Plume is written so that each thing the extractor knows about the song moves one thing a viewer can see, and only that. This is the language; a preset is free to speak another.

| The song                      | Feature             | Moves                                         | What you see                                                                                                                                  |
| ----------------------------- | ------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Its key                       | `keyHue`            | `colourShift` +1                              | The colour of everything. C is deep blue, and each fifth up the circle is a twelfth of the palette on.                                        |
| How surely the key is heard   | `keyClarity`        | `saturation` +0.6 over a rest of 0.5          | A held chord is full colour; drums alone drift toward grey.                                                                                   |
| A chord moving                | `harmonicChange`    | `dye` +2                                      | A puff of dye at each change, for a couple of seconds.                                                                                        |
| A new section beginning       | `novelty`           | `force` +0.6, `hitDye` +1                     | A surge as the passage changes.                                                                                                               |
| Which section it is           | `section`           | the layout                                    | The figure the emitters ride. A drop that comes back comes back to its own figure.                                                            |
| A passage lifting or dropping | `swell`             | `spread` +0.2, `dyeDecay` −0.18               | A drop fills the frame and its dye lingers; a breakdown pulls in and thins.                                                                   |
| How busy the track is         | `pace`              | `vorticity` +14, `orbitSpeed` +0.25           | Busy music has more turbulence and the emitters travel faster.                                                                                |
| Bass-led or bright            | `weight`            | `radius` +0.006                               | A heavy track has fatter plumes.                                                                                                              |
| Loud now                      | `energy`            | the decays, `spread`, `force`, `dye`          | The frame fills and clears with the level.                                                                                                    |
| Bright now                    | `treble`            | `vorticity` +38, `viscosity` −0.18            | Busy highs draw fine filaments.                                                                                                               |
| The low end                   | `lowEnd`            | `hitForce` +1.1, `hitDye` +1, `radius` +0.016 | A kick hits harder and fatter.                                                                                                                |
| Each band playing             | its level           | that emitter's trickle, through `voice`       | The sub plume feeds while the sub plays and starves when it stops.                                                                            |
| Each band's onset             | its hit             | that emitter's hit, through `voice`           | The kick pushes the sub plume and the hat flicks the treble one.                                                                              |
| Each hit, on its own          | its place and width | a splat from the event pool                   | A puff under the band's plume at the height of its pitch, fat for a kick, small for a hat, gone in under a second.                            |
| The beat                      | `beatPulse`         | `intensity` +0.5, `chromatic.beat`            | A flash and a split on the beat.                                                                                                              |
| The tempo                     | `tempo`             | nothing                                       | Deliberately unmapped; see the tempo note under Measured. `beatPhase` and `tempoConfidence` are there for the next preset that wants a clock. |

Where a plume sits in the palette is the key plus the band's tint: the sub plume shows the key's colour itself and the treble sits just under half a palette on from it. In F# minor, whose relative major A is three fifths up from C, that is teal for the sub through green and gold to red for the treble.

Preset files are compiled in rather than fetched, so `presets/parse.ts` throws at load rather than falling back. Everything arrives as `unknown` and is narrowed on the way through, and every message names the file and the path inside it, because a preset is a wall of numbers and "expected a number" on its own is no help:

```
presets/broken.json: sceneParams.viscosity is missing
presets/broken.json: audioMapping[0].to is neither a knob of this scene (velocityDecay, …) nor a post target (feedback.amount, …)
```

`presets/knobs.ts` holds the vocabulary and imports nothing, for the same reason `scenes/catalog.ts` does: a host's picker reads them without pulling the WebGPU tree into its main bundle.

### HUD

`src/hud/Hud.ts`, a 2D canvas over the scene: the five band envelopes and energy as bars, the flux trace against its threshold with onset marks, beat, tempo, frame time, what the scene is doing, the adapter and which post stages run. It ships in the build, so a report from another machine can carry a screenshot. The host owns the key that toggles it; both the demo and Musimo use H.

## Adding a scene

1. An id in `SCENE_IDS` and a label in `SCENE_LABELS` (`src/scenes/catalog.ts`).
2. Its knobs in `src/presets/knobs.ts`, added to `SCENE_KNOBS`.
3. A `Scene` implementation; `src/scenes/Scene.ts` is the interface.
4. Shaders under `src/shaders/`.
5. A `*.params.ts` holding the pure numbers, with a `*.params.test.ts` beside it. Keep the GPU objects out of it, the way `fluid.params.ts` and `post/params.ts` do; that file is where the scene's decisions are testable.
6. A preset JSON, and a line in `src/presets/index.ts`.
7. A branch in `Renderer.build()`.
8. Widen the `Preset` union in `src/presets/types.ts` and the branch in `src/presets/parse.ts`.

The demo picks up the knobs on its own. Two things to know before you start:

**Name a bind group layout rather than deriving one wherever two pipelines share a bind group.** `layout: 'auto'` derives a layout holding only the bindings a shader happens to read. In the particle scene that was here before, taking the feature packet out of the render shader dropped binding 0 from that layout and every bind group built for both halves became invalid: the scene drew nothing and the console filled with validation errors. Any scene with a compute half and a render half has the same trap waiting.

`src/gpu/math.ts` is a camera basis that nothing calls, left from an earlier raymarched scene. Kaleidoscope builds its ray in the shader and does not use it. It is kept and still tested, for the next scene that wants a camera.

## Checks

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
```

The unit tests are pure TypeScript and run in Node: the feature extractor against synthetic spectra (band collapse at both FFT sizes, envelope timing, every click in a click train detected with none between and the tempo found, jitter not read as onsets, the packet's three band blocks in the same order, each band's weights summing to the width in bins it asked for and neighbours splitting the bin they straddle, a tone across an edge landing in both bands and one well inside landing in neither neighbour, a band reading the same level whether its power is spread or gathered into one bin, the same hits found twenty dB apart, pace settling near how busy the music is and barely moving on one hit, swell holding the middle through a steady passage and lifting over a loud one, weight reading high on a bass-led spectrum and low on a bright one, tempo ramping rather than stepping when the guess changes, and for the per-band detectors: only the band that was struck firing, two patterns at different rates counted separately with neither reading the other, a quiet band still firing while another is saturated, no band firing on silence, and a band's pulse holding up after its hit and then falling), the worker protocol handing buffers back, the camera maths, the post stack's parameters (a patch leaving its input alone, the stack's switch overriding the stages under it, each stage that is off writing values that make its term vanish, the bloom level sizes, nothing the shaders divide by reaching zero, the flow block landing past every float the uniform already had, a carry of zero or no flow at all leaving the warp as it was, the cover a square, a wide and a tall canvas give, a floor of zero by default and off with the stage, one that halves when the step halves and never adds light, and the background a constant settles at under a floor at four frame rates), the fluid's parameters (the grid chosen and capped on a rasteriser, the visible extent for a canvas of any shape including one with no area, every emitter inside the band at the loudest spread, the emitter count rounded, clamped at both ends and leaving no dye in the slots past it, every band covered exactly once at every emitter count and the voice knob at zero leaving the splats exactly as they were, a hit reaching only the emitter whose band fired and still reaching it after that band has merged with a neighbour, nothing driving an emitter backwards on a negative reading, an onset injecting several times the trickle, the trickle halving when the step halves, the palette wrapping with no seam), the parser against every way a preset can be wrong, and the resolver against every curve, sign and collision in the mapping table. The tempo tracker has its own file of tests on bare envelopes (a click train read to within half a beat per minute at a tempo no whole number of frames means, the same tempo at 60, 144 and a jittering frame rate, a first reading inside five seconds, a kick and snare in different bands read at the beat rather than the bar, the phase landing on the hit and sweeping the whole beat between, the phase carrying on through silence, and nothing called on noise), and `synthetic.test.ts` renders drum patterns to samples and reads them back through a stand-in for the analyser: four to the floor read to within a beat at two frame rates, the phase landing on the kick, a two-step read at a level of its metre and never the dotted figure, and over a drop, a breakdown and the drop's return, novelty at both boundaries, swell lifting, and the tempo's confidence collapsing and recovering.

Rendering needs backend-specific checks. Native GPU tests cover the WGSL scene; live browser checks cover integration and WebGL2 fallback. Neither establishes that every browser exposes a WebGPU adapter. The native timing figures below exclude browser overhead.

### Measured

On a Mac (Apple M5 Pro, macOS 26.6) in headed Chromium 153 against a real library, four tracks: Aphex Twin's Donkey Rhubarb (about 140 BPM), an Above & Beyond track (about 130), and two drum and bass tracks at 174. The display runs at 120 Hz, so 8.3 ms means the GPU is not the limit.

| Stage size          | Fluid 512             | Fluid 1024            |
| ------------------- | --------------------- | --------------------- |
| 320 by 320, ratio 1 | 8.3, 8.2, 8.3, 8.4 ms | 8.4, 8.3, 8.3, 8.3 ms |
| 3840 by 2160        | 8.2, 8.3, 8.4, 8.4 ms | 8.3, 8.7, 8.2, 8.4 ms |

No cell left the cap on any track, at either grid, with either preset, and the whole post stack cost nothing measurable against a straight copy: both sat at 8.2 to 8.4 ms. A preset resolving a dozen numbers a frame on the CPU costs nothing measurable either.

The white-out the stack was built for is gone. Without it, one of the drum and bass tracks drove a third of the frame to a flat white mass with no structure in it; with it the same moment is a warm core fading into the colour of the scene.

Tempo was the weak part. Replaying those recordings through the extractor as it then ran, Donkey Rhubarb read 140 for 59% of readings, Above & Beyond 129 for 62%, and both drum and bass tracks read 111 to 115, two thirds of the truth, because the dotted-quarter pattern of their drums correlated more than the beat. A 3:2 rule that fixed one broke the other and was not kept. The tracker has since been rewritten (the `tempo` bullet above says how) and the real-track figures have not been re-measured; what has been measured is synthetic drums, rendered to samples and read back through a stand-in for the analyser (`src/audio/synthetic.ts`), which is what the numbers below are.

| Pattern                    | Truth | Reads | Confidence | Before                   |
| -------------------------- | ----- | ----- | ---------- | ------------------------ |
| Four to the floor, 60 fps  | 128   | 127.9 | 0.85       | 128.6, the nearest frame |
| Four to the floor, 144 fps | 128   | 127.9 | 0.86       |                          |
| Two-step, 60 fps           | 174   | 173.6 | 0.4        | 87.8                     |
| Two-step, 120 fps          | 174   | 173.7 | 0.4        | 87.8                     |
| Two-step, 30 fps           | 174   | 86.9  | 0.45       |                          |
| Breakdown, no drums        | none  | 0     | under 0.1  | held the last reading    |

The two-step is the hard case because nothing in it plays on every beat: the kicks are a dotted quarter apart and the snares a half bar, and every band on its own is periodic at the half-bar or the bar. It reads 174 because the summed envelope has an event on every beat, kick or snare or hat, and reads 87 when it does not; the half-bar is a level of the metre and reading it is a choice of octave, where the 116 the old tracker read on real tracks was no level at all and gave a phase that drifted against the music. On a 30 Hz frame the 30 ms flux lag is a single frame and the choice is marginal: without the octave hysteresis it flipped between the two every few seconds, and with it the half-bar, which the first full window chose, is held. The hysteresis only counts once the window has filled, because the first readings come from a window too short to reach the bar and lean to the half-bar at every frame rate; locked in from there, the two-step read 87 at 60 and 120 frames a second as well. Nothing drives off the tempo in the shipped presets yet; the phase and the confidence are there for the preset that will.

Not checked: a mid-range desktop GPU, and the fluid on a software rasteriser, which the reduced grid and sweep counts are written for but no machine here can run.

## License

MIT. See [LICENSE](LICENSE).
