# visimo

A WebGPU music visualizer, as a package. Give it an `<audio>` element and a canvas gets a fluid simulation driven by what the music is doing: bands, onsets, flux and a tempo guess, resolved through a JSON preset onto the scene's own numbers and a post stack.

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

Every control is generated from the lists the package keeps: the scene knobs from `SCENE_KNOBS`, the post knobs from `POST_LANES`, the mapping vocabulary from `AUDIO_FIELDS` and `CURVES`. Add a knob to the package and it appears here with nothing to change, though a knob whose range is not obvious wants a row in `RANGES` in `demo/controls.tsx`. **copy preset** puts the whole thing on the clipboard as JSON that `parsePreset` accepts; drop it into `src/presets/` and add it to the list in `src/presets/index.ts`. H toggles the HUD.

## How it works

### Audio graph

One `AudioContext` and one `AnalyserNode` (`fftSize` 2048, no smoothing; the extractor smooths per band), in `src/audio/AudioGraph.ts`. It is a module singleton, so it survives any remount.

The source is attached only once the context is running. A context built outside a user gesture starts suspended and a source on a suspended context is silent, so `attachAudio` resumes first and checks `state === 'running'` before creating the source. If the browser refuses, the track still plays on its own and the next `play` tries again.

### Feature extraction

`src/audio/FeatureExtractor.ts` turns each analyser frame (dB per bin, plus the seconds since the last one) into a 16-float packet. It is pure TypeScript, and it runs in a worker (`features.worker.ts`, protocol in `features.protocol.ts`) so neither the renderer nor the analysis can stall the other. The spectrum buffer is transferred to the worker and handed back with each packet, so nothing is allocated per frame on the main thread.

In order:

- dB to linear magnitude, then five log-spaced bands: sub 20 to 60 Hz, bass 60 to 250, lowMid 250 to 1k, highMid 1k to 4k, treble 4k to 16k. Each band is the mean magnitude of its bins, then an envelope with its own attack and release (sub 20 and 250 ms, treble 5 and 90 ms), then scaled by the loudest that band has been in the last few seconds, so a quiet track fills the same 0 to 1 as a loud one.
- `energy`: RMS from 20 Hz to 16 kHz, smoothed and scaled the same way.
- `flux`: half-wave rectified spectral flux. The onset threshold is the mean plus 2.5 standard deviations over a 1.5 second window, measured before the current frame joins it. An onset is flux rising through that threshold, at most one per 80 ms. `onsetStrength` grades the hit against the loudest recent one, since flux over its own mean is 1 on average and would hide hits in sustained music. `beatPulse` jumps to 1 on an onset and falls to 1/e in 180 ms.
- `tempo`: once a second, the autocorrelation of the last 480 frames of flux over the lags that mean 60 to 200 BPM. The flux is first compressed with `log1p(3 × flux / mean)`, because a few big hits otherwise own the correlation and the beats between them do not register. Correlations are normalised by overlap, each lag is scored with half its double lag and a quarter of its quadruple added in, the score is weighted toward 120 BPM by a log-Gaussian 0.9 octaves wide, and when the half lag correlates at least 0.6 as well it wins; all of it because a bar correlates as well as a beat and a naive pick reads half-time. The reported value is the median of the last five readings, and it stays 0 until one lag clearly wins.

The layout is at the top of the file and the WGSL structs match it exactly: 0 to 3 the first four bands, 4 to 7 treble, energy, flux and the threshold, 8 to 11 onset, strength, pulse and tempo, 12 and 13 time and the frame step, 14 and 15 reserved.

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

Fourteen numbers are what a preset moves: the two decays, vorticity and viscosity, the emitters' spread and orbit, what they trickle, what one onset adds on top, and where the dye sits in the palette. Three emitters ride a Lissajous orbit and push along the tangent of their own path. The trickle is scaled by the step so it does not depend on the frame rate, because a track with long quiet passages otherwise settles into a still frame.

Colour comes from a 256-texel lookup table built on the CPU: deep blue through teal and green into warm orange and magenta and back to the first colour, so the coordinate wraps with no seam. The dye carries its place in that table as a unit vector rather than a number, so two plumes that meet average their colours the short way round instead of sweeping the whole palette between them. Density is bent through `1 - exp(-d)` before it is coloured, so a thick plume reads as its own colour rather than a flat white mass.

The numbers were set by eye at 3840 by 2160 against real tracks, and the first cut was wrong in a way worth keeping. The viscosity alpha started between 0.4 and 2.0, which at 120 frames a second is a box blur of the neighbours every frame: 4K showed enormous soft blobs with no structure in them. Dropping it to between 0.02 and 0.2, halving the splat radius and roughly doubling the vorticity turned the same passage into plumes with filaments down to a texel. Emitter spread then went the other way twice: wide enough to reach the corners left three separate plumes with black between them, so it settled between the two.

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

`from` is one of ten packet fields, plus `lowEnd` for the louder of sub and bass. `to` is one of the scene's own knobs, or a dotted post target such as `bloom.intensity`; that is how the parser tells the two apart. `curve` is `linear`, `square`, `sqrt` or `invert`, all of which keep 0 at 0 and 1 at 1 except the last. `gain` may be negative, which is how a feature thins a number rather than raising it: `treble → viscosity` at −0.18 is the fluid keeping its detail when the music is busy. Several rows may name the same knob and they add.

All of it is resolved on the CPU, once a frame, in `presets/resolve.ts`, and nowhere else. That is why a preset can send treble to a knob that used to take bass without a line of WGSL changing. Both resolvers write into an object the renderer owns and keeps, since this runs every animation frame.

| Preset | Scene | What it does differently                                                                                                                         |
| ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plume  | Fluid | The default. Bass decides what an onset is worth, treble the vorticity.                                                                          |
| Wash   | Fluid | The opposite way round, with thinner viscosity, wider spread and a slower orbit, so the plumes stay separate instead of growing into each other. |

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

The unit tests are pure TypeScript and run in Node: the feature extractor against synthetic spectra (band collapse at both FFT sizes, envelope timing, every click in a click train detected with none between and the tempo found, jitter not read as onsets), the worker protocol handing buffers back, the camera maths, the post stack's parameters (a patch leaving its input alone, the stack's switch overriding the stages under it, each stage that is off writing values that make its term vanish, the bloom level sizes, nothing the shaders divide by reaching zero), the fluid's parameters (the grid chosen and capped on a rasteriser, the visible extent for a canvas of any shape including one with no area, every emitter inside the band at the loudest spread, an onset injecting several times the trickle, the trickle halving when the step halves, the palette wrapping with no seam), the parser against every way a preset can be wrong, and the resolver against every curve, sign and collision in the mapping table.

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
