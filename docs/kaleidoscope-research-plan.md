# Immersive kaleidoscope scene

## Implementation update

The current **Kaleidoscope / Prism** scene raymarches a 3D fractal made from mirrored box and sphere folds. It replaces the earlier ring and flat motif prototypes. Camera movement exposes nested surfaces, with normals, coloured materials and highlights providing depth.

The five music bands own successive recursion scales, from coarse sub structure to fine treble detail. Their material contributions use individual levels and hit envelopes; geometric changes act within one shared field and can interact. Silence renders black. Hit width has no visual effect. Zoom sweeps inward and outward through camera distance and field of view. Complexity 3–10 produces 5–12 fold iterations; software adapters cap this at 7. Marching is capped at 72 steps, or 44 on software adapters. Spatial sampling uses four samples below a 900-pixel shorter side, two from 900 to 1439 and one at 1440 or above, with software always using one. The WebGPU scene uses the shared bloom and tonemap. WebGL2 uses matching GLSL geometry and post-processing, with the same CPU features and motion. Its post targets use float HDR when available, otherwise RGBA8 with reduced highlight range. Its distance estimate is not a proven conservative bound for every warp.

Work started from refreshed `main` at `5ae7fca`. The 46-float feature packet includes tempo confidence and beat phase. Scene/preset selection, resolved knob isolation, once-only hit consumption, accumulated worker sampling time and feedback resets on scene switches are implemented. The demo defaults to Prism and loads a local, Git-ignored FLAC copy of Ecstasy Of Soul first, with the unchanged M4A as fallback. Custom Play/Pause, seek and volume controls replace the native media widget after repeated browser crashes during tests. Prism keeps feedback off.

Native validation passed for all five isolated bands, exact black silence, quieter versus full mixes and zoom values 0.4 and 1.9. Five shader-only GPU timing samples measured 6.09–6.68 ms at 1920×1080 and 12.39–13.57 ms at 3840×2160. These measurements exclude post-processing and browser overhead and cover one development GPU, not sustained playback. A 12-second preview of the real track at 45–57 seconds rendered 360 frames at 960×540, using the repository's FFT, feature extractor, motion, mappings and full post stack. GPU validation and complete audio/video decoding passed.

The external Chromium browser now renders through a real NVIDIA Blackwell WebGPU adapter at 1412×1020, with visible fractal detail and positive band readings. Diagnosis found a stopped development server, a stale hot-reload connection to 5173 and a feature-worker failure. Vite now requires port 5174 and runs in a persistent background process. Worker creation, loading, decoding or send failures fall back to the existing CPU extractor. A separate renderer bug left a fresh scene at 1×1 on an already-sized canvas; the renderer now always forwards dimensions. Live inspection confirmed the change from 1×1 to 1412×1020, also reported in `data-detail`. The brief HUD frame-rate reading is not a benchmark. All 197 tests, typecheck, lint, formatting and production build pass.

Earlier in-app browser checks were separate: software WebGL2 with the local FLAC track passed reload/playback, seek, zoom 0.4 and 3, reset, full-view round trip and pause fading to black. WebGPU remains preferred; the fallback supports Kaleidoscope, with Fluid/Plume/Wash disabled. Software rendering caps the scene at approximately 480×270 pixels in area and a maximum dimension of 960; the HUD stays at full display resolution. This has lower fidelity and performance than GPU rendering. After failed WebGPU recovery, the stage replaces its scene canvas once while retaining audio, allowing WebGL2 to acquire its own context.

Fresh-canvas recovery has regression coverage; device loss has not been tested end to end. Remaining visual work: fine-detail shimmer, whole-track tuning and Colin's comparison against the references. Section-specific layouts, track/seek history resets and time-based feedback remain deferred.

Everything below is the historical research baseline. Its 44-float packet references, proposed rendering approaches and planned extensions do not describe the final implementation.

## Original research

Start with a layered kaleidoscope that feels like travelling through patterned glass. Use a stable mirrored structure, overlapping depths and continuous motion. Let the music change the space and reveal detail within it.

This is a proposed direction, not a settled visual design. The first review should compare a flowing tunnel with a more enclosed glass mandala. Both can share the same rendering foundation.

The research supports coordinate folding, careful filtering and deliberate sound-to-image relationships. It does not establish which composition Colin will find immersive. That needs moving previews with real music.

## The plan at a glance

```text
Choose the visual character
          |
Prove clean mirrors and readable depth
          |
Make motion continuous at different frame rates
          |
Give bass, mids and treble distinct roles
          |
Connect scene selection, presets and effects
          |
Tune against whole tracks and measure performance
```

Recommended first release: one scene, one well-tuned immersive preset, plus a calmer variation if it earns its place. No new rendering framework, external image dependency or source-separation system is needed for the proposed first version.

## 1. What gives a kaleidoscope its identity

Physical kaleidoscopes offer two useful references. Two mirrors produce a central mandala; a third mirror produces a continuing reflected pattern. Liquid-filled object cells keep their contents moving after the cell stops turning. These suggest different compositions and a useful sense of momentum. They do not imply that a digital scene needs a physical optics simulation.[^1]

For this scene, the important qualities are recognisable reflection, an evolving source pattern, and enough separation between shapes to follow their movement. A static rosette that merely spins will probably become repetitive. That is a design judgment to test, not a research finding.

Review these two treatments before locking the art direction:

- **Flowing tunnel:** nested mirrored forms pass toward the viewer. Broad shapes establish the space; finer contours appear behind them. The centre remains legible while the edges carry more motion.
- **Glass mandala:** a more stable central composition, with overlapping translucent-looking fragments and slower internal drift. Depth comes from layers and occlusion rather than constant forward travel.

The proposed tunnel should retain clear mirrored motifs. Adding noise, glow and rotation without that structure risks producing a generic psychedelic background.

## 2. The rendering foundation

### Mirror one source region

The established shader technique converts a pixel's position into radius and angle, folds the angle into a repeated wedge, reflects the second half of that wedge, then evaluates the source pattern at the resulting coordinates. Ilett demonstrates this directly; Autodesk documents the same separation between coordinate remapping and the texture it transforms.[^2][^3]

**Design decision:** define symmetry as a count of rotational repeats, with a mirrored half inside each repeat. A six-repeat design therefore has twelve half-wedges. Label the control clearly so implementation terminology does not create a factor-of-two surprise.

Begin with a few fixed integer counts, such as four, six and eight repeats. These are proposed visual test values. Do not continuously modulate the integer count with bass: changing the topology every few frames would make the whole image rearrange abruptly.

Correct the canvas aspect ratio before folding. Define the centre explicitly, keep the angle wrap continuous, and handle the central pixel without a singularity. A source pattern should remain continuous along each mirror boundary. Continuous values alone do not guarantee smooth derivatives, so boundaries need visual checking during movement.

### Add depth without committing to full 3D

There are three practical routes:

- **One folded image:** the quickest proof of symmetry. Good for testing the pattern, but it offers limited control over depth.
- **Several procedural layers:** fold a small, fixed number of patterns at different scales and depths, with different motion and controlled overlap. This is the recommended first implementation.
- **Raymarched 3D geometry:** useful if the intended result needs solid chambers, changing viewpoints or real occlusion. Sphere tracing uses distance bounds to advance toward implicit surfaces; complex deformations require care to preserve those bounds.[^4] Its additional per-pixel evaluations make it a performance risk to measure, not an automatic upgrade.

For the layered route, start by comparing three layers with five. Give the near layer thicker forms and stronger movement; distant layers get smaller forms and reduced contrast. Fade recycled layers before their depth wraps so the travel does not visibly jump.

Treat logarithmic radial motion as an optional tunnel experiment. It compresses detail heavily near the centre, so clamp its domain and fade unresolved detail. Simple projected layers may already deliver the desired depth with fewer failure cases.

### Make the source pattern worth reflecting

Begin with broad curved ribbons, enclosed petal shapes and sparse smaller facets. Use a restrained shared palette. Separate the movement of the source pattern from the movement of the mirror frame, so the image can change internally while its overall orientation stays calm.

Warp within the folded coordinate domain where possible. Arbitrary distortion after mirroring can break the symmetry that defines the scene. Strong distortion also compresses features, increasing shimmer and making the music response harder to read.

The first image must work with all post effects disabled. Bloom should reveal luminous edges; it should not supply the missing structure.

## 3. Prevent shimmer before adding detail

Procedural patterns need filtering as their features become smaller than a pixel. PBRT describes estimating the texture sampling footprint and removing frequencies too fine for that footprint. Increasing sample count alone can be expensive and still leave aliasing.[^5]

For this scene, thin lines, the central convergence, mirror boundaries and distant layers are the likely problem areas. Use pixel-aware edge widths, remove tiny pattern detail with distance, and test slow motion as well as fast motion. Bloom does not repair unstable sampling.

WGSL provides screen derivatives, including `fwidth`, and explicit-gradient texture sampling. Derivative operations require appropriate uniform control flow. If a texture-based variation is later added, use mipmaps and deliberate gradients around coordinate wraps rather than assuming ordinary texture sampling will handle every discontinuity.[^6]

Acceptance checks:

- No visible spoke seams or centre sparkle while slowly rotating.
- Similar apparent line thickness in square, wide and portrait canvases.
- Detail fades cleanly as it recedes instead of crawling or flickering.
- Layer recycling and angle wrapping do not produce a jump.
- Fine detail survives a moving preview, not merely a still screenshot.

## 4. How the music should shape it

Research provides useful tendencies, not a universal visual language. Reymore and Lindsey's two experiments used 96 and 92 participants. Their results support relationships involving timbre, pitch register and colour lightness, while hue choices vary and some instrument effects weaken when pitch is controlled. These were constrained listening tasks, not tests of immersive visualizers.[^7]

**Design interpretation:** use distinct visual roles for different sounds, then judge the result against music. The project's musical-key colour mapping remains an artistic convention. It should not be presented as the scientifically correct colour of a key.

Proposed mapping, using the features already available:

- **Sub and bass:** broad expansion of the forms and a short depth impulse. Keep a slow underlying travel speed so a kick changes momentum without teleporting the viewer.
- **Low mids:** the body and thickness of ribbons or petals.
- **High mids and treble:** finer edge detail and small local highlights. Limit their share of total brightness so a busy passage does not wash out.
- **Energy and swell:** a bounded increase in openness and contrast across a passage.
- **Pace:** gradual changes in travel and pattern activity. Prefer it to the BPM estimate, whose limitations are already documented in the project.
- **Key hue and clarity:** a slowly moving palette anchor and a restrained saturation change.
- **Harmonic change:** a modest internal pattern change over seconds.
- **Section and recall:** let returning passages recover a recognisable composition. Change a small selection of continuous parameters first; keep symmetry fixed in the first preset.

Use resolved preset values for magnitudes, following the existing scene contract. Raw hits should create discrete accents only once per newly received audio frame. Their strength and spectral position can describe that accent; ordinary band levels should still go through the preset mapping.

Keep fast accents, continuous movement and section changes on different timescales. Initial tuning hypotheses are roughly 0.1 to 0.4 seconds for accents and 3 to 6 seconds for composition transitions. These are starting values for listening tests, not validated perceptual thresholds.

Changing speed must preserve position. Integrate travel and rotation over elapsed time rather than multiplying a changing speed by the total runtime. Otherwise a small speed adjustment late in a track can cause a large jump. Smooth circular values across their wrap, and interrupt transitions from the currently visible state.

MilkDrop's authoring model separates resting parameters from their changing values and includes zoom, rotation and image echo. That is useful precedent for exposing a small set of musical controls, but its specific frame-based behaviour should not be copied into this renderer.[^8]

## 5. Foundation work revealed by the current code

These findings come from source inspection at commit `be9f410`. They have not been reproduced in a running GPU session. They are planned work, not changes made by this document.

### Scene and preset selection must agree

The demo keeps `scene` and `preset` as independent state. Picking a preset only changes the preset; picking a scene only changes the scene. Controls derive their knobs from the preset. This happens to agree while every preset belongs to Fluid, but a second scene exposes the mismatch.

Plan: choosing a preset selects its scene. Choosing a scene selects a valid preset for that scene. Keep the public stage API compatible and make the demo handlers update both together. Show the fluid grid control only for Fluid. Check reset and exported JSON after switching in both directions.

Evidence: [preset selection](../demo/controls.tsx), [demo state](../demo/main.tsx), [stage effects](../src/Visualizer.tsx).

### Audio frames and drawn frames need separate identities

`FeatureClient` retains the latest packet until a worker reply replaces it. The renderer copies that packet every drawn frame. A nonzero hit can therefore be observed more than once when drawing is faster than worker replies. The existing event pool spawns whenever it sees a positive hit.

Plan: introduce an internal packet revision or freshness signal. Retain continuous levels between replies, but consume discrete hit events once. Do this at the shared boundary so each scene does not invent its own workaround. Prove the failure and correction with one hit held across several render ticks.

There is a related elapsed-time issue: `pump(dt)` returns while a spectrum buffer is away, and the next successful send carries only that render tick's `dt`. Accumulate elapsed sampling time across skipped sends. Test a delayed worker so envelopes and song-scale timing do not slow down under load.

Evidence: [client](../src/audio/FeatureClient.ts), [worker protocol](../src/audio/features.protocol.ts), [renderer](../src/gpu/Renderer.ts), [event pool](../src/scenes/fluid.params.ts).

### Keep resolved scene values isolated

The resolver writes into a reused object without removing keys absent from the next preset. With disjoint scene knobs, old values remain present even though most new scene code may ignore them.

Plan: clear or replace the resolved scene object when changing presets or scenes. Test a switch between presets with different knob sets and ensure only the current set survives. Evidence: [resolver](../src/presets/resolve.ts).

### Feedback is optional and needs its own review

The post stack's trail decay, zoom and rotation apply once per rendered frame. Their effect over one second therefore changes with frame rate. Its history also survives a scene switch at the same canvas size, so Fluid can bleed into a new scene when feedback is enabled.

Plan: launch the first kaleidoscope preset with feedback disabled. If trails materially improve it, first define time-based decay and motion, review how fresh-frame contribution affects brightness, and explicitly reset history on scene changes. Preserve the appearance of existing presets through a documented reference-rate conversion and visual regression checks. Simply scaling rotation is not sufficient.

Evidence: [post parameters](../src/post/params.ts), [feedback shader](../src/shaders/post.feedback.wgsl), [history ownership](../src/post/PostStack.ts).

### Document the actual audio contract

The README still describes uploading the feature packet as a 64-byte GPU uniform. The current packet contains 44 floats and is consumed on the CPU. The Fluid parameter code also reads per-band levels directly for its voice behaviour, despite the broad contract saying magnitudes are preset-resolved. Keep the new scene's mapping boundary explicit and reconcile these descriptions when implementation starts.

Track changes and seeks have no explicit reset message in the inspected worker protocol. Define whether a new track starts a new section history before relying on section recall for composition. A seek policy can differ from a new-track policy; this needs a deliberate choice and a lifecycle test.

## 6. Proposed implementation sequence

### Phase 1: Visual brief

Collect a few linked references for mirror structure, material and motion. Compare the tunnel and glass-mandala treatments. Choose the first composition, palette character and motion intensity. References illustrate direction; their code or artwork should not become an undeclared asset dependency.

**Exit:** a clear description of the desired moving image and the qualities that would make a preview miss the mark.

### Phase 2: Geometry and image quality

Implement a standalone `Kaleidoscope` scene using a fullscreen triangle and a small uniform buffer. Start with one folded motif, then add the minimum layers that establish depth. Add aspect correction, centre handling, continuous phases and filtering before fine ornament.

Keep pure geometry and parameter transforms in the scene's parameter module. Keep section policy and event lifecycle in scene state. Test reflection symmetry, angle wrapping and finite centre behaviour.

**Exit:** a convincing, smooth moving image with fixed inputs and all post effects off. If the layers still look flat, revisit depth or test a limited 3D approach here.

### Phase 3: Audio timing and musical behaviour

Reproduce and address packet freshness and skipped-sample elapsed time. Add the proposed audio mappings one at a time, beginning with bass expansion and treble detail. Use the existing pulses for the first pass; add a bounded accent pool only if separate sound events visibly improve the result.

Define silence, pause, resume, seek and new-track behaviour. A proposed default is a quiet visible idle, with accents fading and travel easing down when sound stops.

**Exit:** isolated low and high hits have visibly different effects; delayed worker replies do not multiply accents; the scene remains composed through quiet passages and dense drops.

### Phase 4: Integration and controls

Add the scene id and label, its knob list, typed preset shape, parser branch, preset JSON and renderer construction branch. Correct the paired scene/preset selection and stale tuning state. Preserve the existing lightweight catalog and presets entry points.

Start with controls for symmetry, depth, travel speed, rotation speed, pattern scale, warp, thickness, intensity and colour. Every parameter needs units or an understandable range. Keep quality limits separate from music mappings. Add further controls only when tuning reveals a distinct need.

Use the existing bloom and tonemap. Keep grain and chromatic splitting subtle or disabled until the geometry is readable. Review feedback separately as described above.

**Exit:** select, tune, copy, parse, reload, reset and switch back to Fluid all work. The canvas reports the correct scene, preset and workload.

### Phase 5: Whole-track tuning and performance

Use a fixed listening set: a sparse track, sustained harmonic music, a steady dance track, a dense drum-and-bass track, and transitions into silence. Compare identical passages with fixed motion, simple beat response and the fuller mappings. Keep the extra mappings only where their contribution is visible.

Check small embedded use, square, portrait, full-window and 4K output. Exercise resize, host remount/popout, tab hiding, device recovery and repeated scene switching. Run the repository's type, lint, format and unit checks, then inspect actual WGSL compilation and rendering in a headed WebGPU browser.

**Exit:** the visual direction works over complete tracks, controls behave consistently, and measurements support the intended display sizes on named hardware.

## 7. Performance and presentation targets

Set 60 fps at 1080p on the chosen baseline machine as the initial target, and measure 4K separately. These are proposed acceptance targets, not achieved results. A 60 Hz frame is about 16.7 ms; a 120 Hz frame is about 8.3 ms. Leave room for audio analysis, the host and the existing post stack.

At 4K, the current post stack already holds roughly 176 MB of textures according to the project documentation. Avoid adding another full-resolution history pair unless its visual value is clear. Reducing the number of procedural layers reduces shader work; it does not reduce the shared post stack's texture allocation. Lowering the entire render resolution would need a separate renderer decision.

Measure frame-time distributions and sustained throughput, not just the smoothed HUD average. Optional GPU timestamps can help diagnose a pass, but WebGPU Fundamentals shows why timing an isolated pass can disagree with whole-workload throughput. Record device, browser, resolution and enabled effects alongside results.[^9]

Keep brightness accents local and the centre stable. Offer a calm preset with low travel and rotation. Evaluate full-screen output for flash behaviour; WCAG's flash criterion depends on frequency, area and luminance, with a separate red-flash threshold. Restrained bloom alone does not establish that it passes.[^10] This is a presentation check, not a claim of certification.

## 8. Decisions still open

- Tunnel-led or glass-mandala-led composition. The current recommendation is tunnel-led.
- The baseline GPU and display used to accept performance.
- Whether true 3D adds enough after the layered preview to justify its cost.
- Whether feedback trails improve the scene enough to take on the shared timing changes.
- New-track and seek reset behaviour before enabling section-driven composition.

At the research stage, no application code or dependencies were changed and no performance result was claimed. See the implementation update above for subsequent work.

## Sources

Research checked on 13 September 2026. Optical and mathematical references are used for stable foundations. The current WGSL specification was checked rather than relying on older draft search results. Performance guidance is methodological, not a benchmark of this project.

[^1]: Brewster Kaleidoscope Society. [F.A.Q.](https://brewstersociety.com/f-a-q/), undated. Primary practitioner reference for two- and three-mirror arrangements and liquid-filled cells.

[^2]: Daniel Ilett. [Ultra Effects, Part 8: Crazy Kaleidoscopes](https://danielilett.com/2020-02-19-tut3-8-crazy-kaleidoscopes/), 19 February 2020. Author's shader walkthrough for polar remapping and angular reflection; the Unity-specific API is not an implementation dependency.

[^3]: Autodesk. [Kaleidoscope UV Remap](https://download.autodesk.com/global/docs/softimage2014/en_us/userguide/files/shaderpresets187.htm), Softimage 2014 documentation. Historical implementation reference for separating coordinate transforms from source texture generation.

[^4]: John C. Hart. [Sphere tracing: A geometric method for the antialiased ray tracing of implicit surfaces](https://experts.illinois.edu/en/publications/sphere-tracing-a-geometric-method-for-the-antialiased-ray-tracing/), The Visual Computer 12(10), 527-545, 1996. University publication record and abstract; full paper was not reviewed. Used only for the technique's distance-bound foundation.

[^5]: Matt Pharr, Wenzel Jakob and Greg Humphreys. [Texture Sampling and Antialiasing](https://www.pbr-book.org/4ed/Textures_and_Materials/Texture_Sampling_and_Antialiasing), Physically Based Rendering, fourth edition, 2023. Primary technical reference for footprint-based filtering and procedural texture aliasing.

[^6]: W3C. [WebGPU Shading Language](https://www.w3.org/TR/WGSL/), current specification, sections 17.6 and 17.7.12. Normative derivative and explicit-gradient sampling behaviour.

[^7]: Lindsey Reymore and Delwin T. Lindsey. [Color and tone color: audiovisual crossmodal correspondences with musical instrument timbre](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1520131/full), Frontiers in Psychology, published 7 January 2025 in volume 15 (2024). Original experiments; used with their stimulus and generalisation limits.

[^8]: MilkDrop.org. [Preset Authoring](https://milkdrop.org/resources/preset-authoring), undated documentation. Practitioner reference for animated parameters, image warping and echo.

[^9]: WebGPU Fundamentals. [WebGPU Timing Performance](https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html), current online lesson. Primary worked examples covering CPU/frame/GPU timing and limitations of timestamp-based comparisons.

[^10]: W3C WAI. [Understanding Success Criterion 2.3.1: Three Flashes or Below Threshold](https://www.w3.org/WAI/WCAG22/Understanding/three-flashes-or-below-threshold.html), WCAG 2.2 explanatory guidance. Presentation criterion for evaluating flash frequency, affected area and luminance.
