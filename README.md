# visimo

A WebGPU music visualizer, as a package. Give it an `<audio>` element and a canvas gets a fluid simulation driven by what the music is doing: bands, onsets, the key, the shape of the song, resolved through a JSON preset onto the scene's own numbers and a post stack.

WebGPU only. Where there is no adapter it says so and the host shows whatever it showed before.

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

`onUnsupported` fires when the device cannot be had at all, or is lost and cannot be recovered. Check `hasWebGpu()` up front if you want to avoid loading the chunk on a machine that cannot use it, and copy the check rather than importing it, or the capability test pulls the WebGPU chunk into your main bundle.

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

They exist for tests and screenshots and Musimo's e2e suite asserts on all six. Breaking one breaks a consumer silently, so treat them as the interface they are.

## The demo

```sh
npm install
npm run dev
```

Drop a track on the left, tune on the right. The file becomes an object URL on an `<audio>` element and goes through `attachAudio`, the same path a host uses, so what you are tuning is the real thing rather than a mock.

Vite does not pin the port, so a dev server left running from an earlier session keeps 5173 and the next one moves to 5174 without saying much. Read the URL it prints rather than assuming.

Every control is generated from the lists the package keeps: the scene knobs from `SCENE_KNOBS`, the post knobs from `POST_LANES`, the mapping vocabulary from `AUDIO_FIELDS` and `CURVES`. Add a knob to the package and it appears here with nothing to change, though a knob whose range is not obvious wants a row in `RANGES` in `demo/controls.tsx`. **copy preset** puts the whole thing on the clipboard as JSON that `parsePreset` accepts; drop it into `src/presets/` and add it to the list in `src/presets/index.ts`. **reset** puts every number back to what the preset file holds, and is greyed out until something is touched, so it also answers whether the panel has drifted from the file. H toggles the HUD.

What updates without a reload, measured by editing each file while the demo ran:

| Edit                         | Live                                      |
| ---------------------------- | ----------------------------------------- |
| `demo/*.tsx`                 | yes, React Fast Refresh                   |
| `src/shaders/*.wgsl`         | yes, the pipelines recompile              |
| `src/scenes/fluid.params.ts` | yes, the next frame reads the new numbers |
| `src/presets/*.json`         | only through a full page reload           |

The shader row was checked rather than assumed: a hot update that recompiled nothing would look the same as one that did, so the sim shader was fed WGSL that cannot parse and the GPU raised the error straight away. The preset row is React Fast Refresh giving up, because a JSON change reaches `demo/main.tsx`, which is an entry rather than a component. A reload costs the dye already on screen, which is why the sliders rather than the file are the way to tune.

## How it works

### Audio graph

One `AudioContext` and one `AnalyserNode` (`fftSize` 4096, no smoothing; the extractor smooths per band), in `src/audio/AudioGraph.ts`. 4096 rather than 2048 because the low bands need it: at 2048 a bin is 23.4 Hz and the whole 20 to 60 Hz sub band was two bins wide. The cost is an 85 ms window instead of 43, so transients smear a little and the per-band onsets fire slightly softer; that is the trade, and it is one constant to put back. It is a module singleton, so it survives any remount.

The source is attached only once the context is running. A context built outside a user gesture starts suspended and a source on a suspended context is silent, so `attachAudio` resumes first and checks `state === 'running'` before creating the source. If the browser refuses, the track still plays on its own and the next `play` tries again.

### Feature extraction

`src/audio/FeatureExtractor.ts` turns each analyser frame (dB per bin, plus the seconds since the last one) into a 34-float packet. It is pure TypeScript, and it runs in a worker (`features.worker.ts`, protocol in `features.protocol.ts`) so neither the renderer nor the analysis can stall the other. The spectrum buffer is transferred to the worker and handed back with each packet, so nothing is allocated per frame on the main thread.

In order:

- dB to linear magnitude, then five log-spaced bands: sub 20 to 60 Hz, bass 60 to 250, lowMid 250 to 1k, highMid 1k to 4k, treble 4k to 16k. Each band is the root mean square of its bins, then an envelope with its own attack and release (sub 20 and 250 ms, treble 5 and 90 ms), then scaled by the loudest that band has been in the last few seconds, so a quiet track fills the same 0 to 1 as a loud one.
- A bin is centred on its own frequency and covers half a bin either side, and `bandFilter` weights it by how much of that span falls inside the band. Rounding each edge to the nearest whole bin instead put the 20 to 60 Hz sub band at 23 to 70 Hz, which is a tenth of the bass band sitting inside the sub one, so a bass note read as a kick. Weighted edges make a band cover the Hz it asks for at any FFT size, and the one bin two neighbours straddle is split between them rather than claimed by both or rounded away. What it cannot fix is the analyser's own window, whose main lobe is about three bins wide, so a pure tone always spreads into its neighbours; that is why a band can still hear a fraction of a hit just over its edge.
- The level is the root mean square rather than the mean of the magnitudes, which is what the energy in a band is and what `energy` already used over the whole spectrum. A mean divides one bright partial by the whole band: the same power gathered into a single bin read about the square root of the bin count lower, a factor of over twenty in a 512-bin treble band.
- Each band also detects its own onsets, in the same pass. The rise of each bin over the last 30 ms is already being read there, so a band's own half-wave rectified flux costs a subtract per bin and no second sweep; it is divided by the band's width like the level is, so a wide band and a narrow one reach their detectors on the same scale. Every band then gets its own copy of the detector below, with its own rolling window. That is the whole point: a band that is always busy settles on a high threshold and a quiet one on a low threshold, so the hats keep firing through a passage the kick is sitting out, and one emitter can answer the kick while another answers the hats. Each band publishes the frame it fired on, carrying that hit's strength, and a pulse that decays from it.
- `energy`: RMS from 20 Hz to 16 kHz, smoothed and scaled the same way.
- `flux`: half-wave rectified spectral flux, measured on log magnitude rather than raw. `log1p(1000 x magnitude)` per bin, the gain being that large because the magnitudes are small and `log1p` of 0.01 is 0.00995, which compresses nothing. On raw magnitude the same musical hit produced about ten times the rise in a loud passage as in a quiet one, so each detector's sensitivity drifted with the mix instead of staying fixed on the music. The rise is measured against the frame from 30 ms ago rather than the last one, whatever the frame rate: two analyser reads a frame apart overlap by 45% at 60 frames a second and by 92% at 144, so a per-frame rise shrank as the display got faster, and on a 144 Hz display the detectors were firing two or three times a second on the jitter between reads, through a sustained pad, at a rate that halved when the frame rate did. The onset threshold is the mean plus 2.5 standard deviations over a 1.5 second window, a span of time and not a count of frames, measured before the current frame joins it. An onset is flux rising through that threshold and at least 0.2 above the window's mean, at most one per 80 ms. The floor is the part that keeps a quiet passage quiet: the threshold is relative, and mean plus a few deviations of nearly nothing is a bar anything clears. On a real track the jitter of a pad reached 0.19 in every band, a hat spread across the treble band 0.3 to 0.6 and a kick in the sub band 1 to 3, so 0.2 sits in the gap; a band under four bins wide gets it raised by `sqrt(4 / bins)`, since it averages nothing out. `onsetStrength` grades the hit against the loudest recent one, since flux over its own mean is 1 on average and would hide hits in sustained music. `beatPulse` jumps to 1 on an onset and falls to 1/e in 180 ms.
- `tempo`: once a second, the autocorrelation of the last 5 seconds of flux, resampled at 100 Hz so the lags mean the same tempos at any frame rate, over the lags that mean 60 to 200 BPM. The flux is first compressed with `log1p(3 × flux / mean)`, because a few big hits otherwise own the correlation and the beats between them do not register. Correlations are normalised by overlap, each lag is scored with half its double lag and a quarter of its quadruple added in, the score is weighted toward 120 BPM by a log-Gaussian 0.9 octaves wide, and when the half lag correlates at least 0.6 as well it wins; all of it because a bar correlates as well as a beat and a naive pick reads half-time. The winning lag is refined between samples with a parabola through its neighbours, since one sample is 2% of a tempo. The reported value is the median of the last five readings, and it stays 0 until one lag clearly wins.

The layout is at the top of the file, 34 floats read by name through `F` and never by a literal index: 0 to 4 the five band levels, 5 to 9 each band's own hit, 10 to 14 each band's pulse, then 15 energy, 16 and 17 flux and its threshold, 18 to 20 the global onset, its strength and the beat pulse, 21 the tempo guess in BPM, 22 and 23 time and the frame step, 24 to 27 the four that describe the song rather than the frame, 28 to 30 the harmony and 31 to 33 the structure.

The global rows are the same detector run over the whole spectrum. They stay because the post stack reads `beatPulse`, presets map `flux` and `onsetStrength`, and the overlay draws the flux trace.

Nothing on the GPU reads any of this. Every consumer takes the `Float32Array` on the CPU, so there is no vec4 alignment to keep and the packet grows freely. The renderer used to upload it as a uniform buffer no shader bound; that buffer is gone.

`F` and `PACKET_LENGTH` are exported from the package, so this layout is public API. Musimo pins visimo at a tag and nothing here reaches it until a new one is cut.

### The song rather than the frame

Everything above answers what the music is doing in the last few milliseconds. Four more answer what kind of track it is and where in it we are, so a ballad and a drum and bass track can look different without a preset being swapped. They are levels in 0 to 1 like any other and a preset reads them through the same mapping table, which is why this needed no new machinery: `value = resting + Σ gain x curve(feature)` was already the right arithmetic and had only ever been given fast features.

All four are slow on purpose. The point is a number that has made up its mind, not another thing that flickers.

- `pace`: onsets a second in any band, each hit decaying away over half a minute, scaled so 12 a second is full. A pad with a pulse runs about 2, a full kit with hats about 6 and drum and bass past 12. It counts a hit in any band rather than the global detector's, because a kick that lives in three sub bins barely moves the flux of the whole spectrum. It is a decayed count rather than a rate measured between hits, so it needs no memory of when the last one was and cannot spike on one close pair. **This is the one to reach for when what you mean is "fast".**
- `swell`: loudness now against loudness over the last half minute, centred so a steady passage sits at 0.5, a drop goes up and a breakdown goes down. Centred rather than starting at zero so one row can lift a knob in a drop and another thin it in a breakdown, from the same feature with opposite gains. It reads the raw RMS and deliberately not `energy`, which is divided by its own recent peak and therefore sits near 1 through any steady passage however loud; a feature built on that one could never see a chorus coming. The long arm is held to the short one until it has seen a full window, because a cold envelope climbs from zero while the short one is already there, and without that every track's first half minute reads as a permanent drop.
- `weight`: low against high over about ten seconds, 1 for a bass-led track and 0 for a bright sparse one. It reads the normalised band levels, so what it really measures is which parts of the spectrum are occupied rather than the balance between them; two bands that both have content both normalise towards 1. Meant for colour and plume size rather than for activity.
- `tempo`: the BPM guess across 60 to 200, smoothed over five seconds. **Read the tempo caveat below before mapping it.** The raw guess steps when the autocorrelation changes its mind, and the ramp is the only reason the normalised one is worth having: the scene drifts rather than lurching. A guess of 0, meaning nothing has settled, holds the ramp where it is rather than dragging the scene to nothing.

A slow feature and a fast one pointing at the same knob add, so `pace → vorticity` on top of `treble → vorticity` can push a knob past what either was tuned for. The gains are the control and zero is off.

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
- `section`: which section this is, 1 for the first. Novelty at 0.4 or more, once a section has run six seconds, is a candidate; a level rather than a rising edge, because a riser running straight into a drop keeps the novelty up across both and an edge missed the drop. Five seconds on, the mean of the new passage (from a second and a half after the candidate) is set against the mean of the section it would end (from four seconds after that began, and only from moments when the novelty was low, so a riser running into a drop cannot fold the drop into its own section), and if the two are at least 0.965 similar the candidate was a fill and is dropped. A confirmed boundary rejoins an older section when the recall to it, judged with the present at that moment, reaches 0.7, and otherwise starts a new one. On Blossom that put all three drops in one section, the two risers before the second and third in another and the quiet passages mostly together, called the first drop about eight seconds late, and found a boundary or two more than a listener would count. It is an id rather than a level, so it is not in the mapping vocabulary; a scene reads it straight from the packet, the way it reads an onset, and chooses a layout with it. That is what lets a chorus that comes back come back to the same look.

Nothing is remembered until the vector has had four seconds to settle, and once the notes have faded the chroma reads as flat rather than as the last note held for ever, or a memory of the cold start would read as a boundary against everything.

### The renderer

`src/gpu/Device.ts` asks for a high-performance adapter and a device once, keeps them as a module singleton, logs `uncapturederror`, and clears the singleton when the browser reports the device lost so the next request starts fresh. An adapter whose info names SwiftShader or another software rasteriser is flagged and the scene scales itself down: the small grid, fewer sweeps.

`src/gpu/Renderer.ts` is the one renderer. A stage hands it a canvas on mount and takes it back on unmount, which matters because a host may portal the stage into another document (Musimo's popout does) and the subtree then remounts on every move:

```
module singleton, survives remounts        per mount, made again each time
----------------------------------        -------------------------------
GPUDevice, feature uniform buffer         canvas elements (scene + HUD)
pipelines, the fluid's field textures      GPUCanvasContext, configure()
the post stack and its parameters          ResizeObserver, visibility hook
the preset and its resolved numbers        requestAnimationFrame handle
the feature worker and its client
frame clock, HUD history
```

The post stack's offscreen textures belong to neither column: the singleton owns them and rebuilds them whenever the canvas size changes, which a move always does.

`attach` configures the context, sizes the canvas to its CSS box times `devicePixelRatio`, and starts a loop on the canvas's own window, so a popped-out window keeps drawing while the tab behind it is hidden. On device loss the renderer drops the scene, the stack and their buffers and tries once to come back on the same canvas; if that fails it calls `onUnsupported`.

Each frame: read the analyser through the feature client, stamp time and dt into the packet, upload it as one 64-byte uniform, resolve the preset's mapping into the scene's numbers and the stack's, run the scene's compute and render passes into the stack's texture, run the stack onto the canvas, then draw the HUD if it is on. Nothing per frame touches React.

### Scenes

One for now, behind the `Scene` interface in `src/scenes/Scene.ts`: `init`, `resize`, `update`, `render`, `dispose`, and a `detail` line naming what it is doing. Switching disposes the old scene and builds the new one on the same device; the device, the feature buffer and the post stack carry on.

No scene decides what drives what. `update` takes the packet and a set of already resolved numbers, and every magnitude comes from the second of those; the packet is read only for the clock and for events such as an onset.

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

Seventeen numbers are what a preset moves: the two decays, vorticity and viscosity, the emitters' count, spread and orbit, what they trickle, what one onset adds on top, where the dye sits in the palette and how much of its colour is kept, and how far each emitter stands for a band of its own. The emitters ride a figure, evenly spaced around it, and push along the tangent of their own path; which figure is the section's, below. `emitters` is a count rather than a magnitude, so the scene rounds it and clamps it between one and the five slots the shader's splat array holds, one per band; the uniform is always sized for all five and carries how many of them this frame filled, which is why the count can move on a slider with no pipeline rebuilt. The trickle is scaled by the step so it does not depend on the frame rate, because a track with long quiet passages otherwise settles into a still frame.

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

A song moves the numbers above all the time. The one thing that changes the composition is the layout: which figure the emitters ride, how far out, how fast, how the figure is turned and how bunched the emitters are along it. There are six, in `fluid.params.ts`: the Lissajous figure the scene has always had, a ring, a figure of eight, a three-lobed sweep, a tall eight and a low wide ellipse. Which one is drawn is the song's section's: the scene reads `section` straight from the packet, keeps the ids in the order it first saw them, and gives the first distinct section the first layout, the second the second, and a section that comes back the layout it had. A change glides over four seconds, an ease in and out between where the emitters were on the old figure and where they are on the new, so nothing jumps; the offset is held inside the visible band whatever the spread and the layout add up to. The rest of the section's arrival is the preset's: `novelty` is a feature like any other, and the shipped preset turns it into a surge of force and dye.

The two sizes are not just detail levels. 512 fills the frame with bold, soft-edged plumes; 1024 draws finer, wispier ones, because the same emitter radius is a smaller fraction of the larger grid.

### Post stack

`src/post/PostStack.ts` sits between the scene and the swap chain. The scene never draws on the canvas: it draws into one of two `rgba16float` history textures, and the composite pass is the only thing that writes the canvas.

```
scene ──► history[current] ──► bright ──► blur x3 ──► composite ──► canvas
                ▲ add                                     ▲
                └── history[other], zoomed, turned, decayed
```

Half floats because a scene's brightest cores run well past 1, and in `bgra8unorm` everything above 1 was lost, which is why loud passages used to clip to a flat white blob. They are also filterable, which the warp and the blur both need.

- **Feedback.** The other history texture, scaled a little about the middle, turned a fraction of a degree and decayed, added under the new frame. The scene has already drawn into this pass's target, so the pass is additively blended rather than reading its own output. On a still image the gain is `1 / (1 - amount × decay)`, about 1.19 at the defaults; more than that and the field turns into a milky haze.
- **Bloom.** A bright pass with a soft knee at half resolution, then three levels, each a horizontal blur reading the level above (so it downsamples) and a vertical blur inside its own level. Five taps land between texels, so hardware filtering makes each a nine-tap Gaussian for the price of five.
- **Chromatic aberration.** Red and blue are read either side of green, by an offset growing with the distance from the middle. The split is `amount + beat × beatPulse`, so it opens on every onset and closes again.
- **Tonemap.** A shoulder rather than a curve over the whole range: below it nothing changes, above it a value bends toward 1 and never reaches it. Rolling the brightest channel and letting the other two follow keeps a pixel's colour; rolling each on its own bleaches it toward white. An extended Reinhard over the whole range was tried first and made every track flat and muddy.
- **Grain.** A hash of the pixel and a clock, added at the end.

Each stage has an `enabled` flag and the stack has its own; a stage runs only when both are on. `post/params.ts` holds the defaults and `writePostUniform`, which resolves every toggle on the CPU and writes the 112-byte uniform each pass reads, so the shaders have no branches. With every stage off the composite is a straight copy.

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

`from` is one of twenty-four packet fields, plus `lowEnd` for the louder of sub and bass. Four of them are the song-scale ones above, which move over tens of seconds rather than per frame, three are the harmony and two the structure. Five are the per-band pulses, `subPulse` through `treblePulse`. The raw per-band hits are not among them, for the reason `onset` is not: they are events rather than levels, and a scene reads an event straight from the packet. `to` is one of the scene's own knobs, or a dotted post target such as `bloom.intensity`; that is how the parser tells the two apart. `curve` is `linear`, `square`, `sqrt` or `invert`, all of which keep 0 at 0 and 1 at 1 except the last. `gain` may be negative, which is how a feature thins a number rather than raising it: `treble → viscosity` at −0.18 is the fluid keeping its detail when the music is busy. Several rows may name the same knob and they add.

All of it is resolved on the CPU, once a frame, in `presets/resolve.ts`, and nowhere else. That is why a preset can send treble to a knob that used to take bass without a line of WGSL changing. Both resolvers write into an object the renderer owns and keeps, since this runs every animation frame.

| Preset | Scene | What it does differently                                                                                                                                                                                                                                      |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plume  | Fluid | The default, and the one the language below describes. Five emitters well split by voice, the key colouring all of them, bass deciding what an onset is worth and treble the vorticity, and the song's own pace, swell and weight moving the resting numbers. |
| Wash   | Fluid | The opposite way round, with thinner viscosity, wider spread, a slower orbit and the voices half blended, so the plumes stay separate instead of growing into each other. It takes the key's colour and nothing else of the song's shape.                     |

### What means what

Plume is written so that each thing the extractor knows about the song moves one thing a viewer can see, and only that. This is the language; a preset is free to speak another.

| The song                      | Feature          | Moves                                         | What you see                                                                                           |
| ----------------------------- | ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Its key                       | `keyHue`         | `colourShift` +1                              | The colour of everything. C is deep blue, and each fifth up the circle is a twelfth of the palette on. |
| How surely the key is heard   | `keyClarity`     | `saturation` +0.6 over a rest of 0.5          | A held chord is full colour; drums alone drift toward grey.                                            |
| A chord moving                | `harmonicChange` | `dye` +1.5                                    | A puff of dye at each change, for a couple of seconds.                                                 |
| A new section beginning       | `novelty`        | `force` +0.6, `hitDye` +1                     | A surge as the passage changes.                                                                        |
| Which section it is           | `section`        | the layout                                    | The figure the emitters ride. A drop that comes back comes back to its own figure.                     |
| A passage lifting or dropping | `swell`          | `spread` +0.2, `dyeDecay` −0.18               | A drop fills the frame and its dye lingers; a breakdown pulls in and thins.                            |
| How busy the track is         | `pace`           | `vorticity` +14, `orbitSpeed` +0.12           | Busy music has more turbulence and the emitters travel faster.                                         |
| Bass-led or bright            | `weight`         | `radius` +0.006                               | A heavy track has fatter plumes.                                                                       |
| Loud now                      | `energy`         | the decays, `spread`, `force`, `dye`          | The frame fills and clears with the level.                                                             |
| Bright now                    | `treble`         | `vorticity` +38, `viscosity` −0.18            | Busy highs draw fine filaments.                                                                        |
| The low end                   | `lowEnd`         | `hitForce` +1.1, `hitDye` +1, `radius` +0.016 | A kick hits harder and fatter.                                                                         |
| Each band playing             | its level        | that emitter's trickle, through `voice`       | The sub plume feeds while the sub plays and starves when it stops.                                     |
| Each band's onset             | its hit          | that emitter's hit, through `voice`           | The kick pushes the sub plume and the hat flicks the treble one.                                       |
| The beat                      | `beatPulse`      | `intensity` +0.5, `chromatic.beat`            | A flash and a split on the beat.                                                                       |
| The tempo                     | `tempo`          | nothing                                       | Deliberately unmapped; see the tempo note under Measured.                                              |

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

`src/gpu/math.ts` is a camera basis that nothing calls, left from a raymarched scene that has gone. It is kept and still tested, for the next scene that wants a camera.

## Checks

```sh
npm run typecheck
npm run lint
npm run format:check
npm test
```

The unit tests are pure TypeScript and run in Node: the feature extractor against synthetic spectra (band collapse at both FFT sizes, envelope timing, every click in a click train detected with none between and the tempo found, jitter not read as onsets, the packet's three band blocks in the same order, each band's weights summing to the width in bins it asked for and neighbours splitting the bin they straddle, a tone across an edge landing in both bands and one well inside landing in neither neighbour, a band reading the same level whether its power is spread or gathered into one bin, the same hits found twenty dB apart, pace settling near how busy the music is and barely moving on one hit, swell holding the middle through a steady passage and lifting over a loud one, weight reading high on a bass-led spectrum and low on a bright one, tempo ramping rather than stepping when the guess changes, and for the per-band detectors: only the band that was struck firing, two patterns at different rates counted separately with neither reading the other, a quiet band still firing while another is saturated, no band firing on silence, and a band's pulse holding up after its hit and then falling), the worker protocol handing buffers back, the camera maths, the post stack's parameters (a patch leaving its input alone, the stack's switch overriding the stages under it, each stage that is off writing values that make its term vanish, the bloom level sizes, nothing the shaders divide by reaching zero), the fluid's parameters (the grid chosen and capped on a rasteriser, the visible extent for a canvas of any shape including one with no area, every emitter inside the band at the loudest spread, the emitter count rounded, clamped at both ends and leaving no dye in the slots past it, every band covered exactly once at every emitter count and the voice knob at zero leaving the splats exactly as they were, a hit reaching only the emitter whose band fired and still reaching it after that band has merged with a neighbour, nothing driving an emitter backwards on a negative reading, an onset injecting several times the trickle, the trickle halving when the step halves, the palette wrapping with no seam), the parser against every way a preset can be wrong, and the resolver against every curve, sign and collision in the mapping table.

Anything that needs a GPU is checked by hand in the demo. A headless browser has no WebGPU adapter and a WebGPU canvas screenshots black, so there is nothing to automate there.

### Measured

On a Mac (Apple M5 Pro, macOS 26.6) in headed Chromium 153 against a real library, four tracks: Aphex Twin's Donkey Rhubarb (about 140 BPM), an Above & Beyond track (about 130), and two drum and bass tracks at 174. The display runs at 120 Hz, so 8.3 ms means the GPU is not the limit.

| Stage size          | Fluid 512             | Fluid 1024            |
| ------------------- | --------------------- | --------------------- |
| 320 by 320, ratio 1 | 8.3, 8.2, 8.3, 8.4 ms | 8.4, 8.3, 8.3, 8.3 ms |
| 3840 by 2160        | 8.2, 8.3, 8.4, 8.4 ms | 8.3, 8.7, 8.2, 8.4 ms |

No cell left the cap on any track, at either grid, with either preset, and the whole post stack cost nothing measurable against a straight copy: both sat at 8.2 to 8.4 ms. A preset resolving a dozen numbers a frame on the CPU costs nothing measurable either.

The white-out the stack was built for is gone. Without it, one of the drum and bass tracks drove a third of the frame to a flat white mass with no structure in it; with it the same moment is a warm core fading into the colour of the scene.

Tempo is the weak part. Replaying those recordings through the extractor exactly as it runs, Donkey Rhubarb reads 140 for 59% of readings, Above & Beyond 129 for 62%, and both drum and bass tracks read 111 to 115, two thirds of the truth, because the dotted-quarter pattern of their drums correlates more than the beat. A 3:2 rule that fixed one broke the other and was not kept. Nothing drives off tempo yet; anything that comes to needs a better method than flux autocorrelation.

Not checked: a mid-range desktop GPU, and the fluid on a software rasteriser, which the reduced grid and sweep counts are written for but no machine here can run.

## License

MIT. See [LICENSE](LICENSE).
