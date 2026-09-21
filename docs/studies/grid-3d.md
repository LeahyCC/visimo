# grid-3d

The neon grid floor to the horizon, flown over. Lines only, on true black, drawn analytically so they are as sharp at 4K as at 720p, riding a floor the music writes: the bass ripples it and the mids and highs raise hills either side of a valley you fly down. Built on height-kit (`src/impls/height.params.ts`, `HeightField.ts`, `src/shaders/height.common.wgsl`), which ridgeline, ocean and city will reuse.

This file is the plan and the record. It is written first and updated in the same push as any change of plan.

## What the references do

Looked at before the shader was written. What each one is, and what could actually be read of it:

- **Evan Wallace's anti-aliased grid shader** (madebyevan.com/shaders/grid). Read. Line width and falloff come from the screen-space derivative of the grid coordinate (`fwidth`), so a line stays a fixed number of pixels wide near you and thins into the distance where a grid cell shrinks toward a pixel, and there is no moire. It is the technique the lines here are drawn with.
- **The Shadertoy "Synthwave grid"** (shadertoy.com/view/dt2SDt) and **Ben Golus, "The Best Darn Grid Shader (Yet)"**. Both returned 403 when fetched, so only the search summaries were seen and nothing here is taken from their code. Golus's article is the one that sets out fading a line to its average once it is under a pixel, which is what `line_detail` does here.
- **A WebGL "Neon Grid" scene** (xenaxio.com/scenes/neon-grid). Its listing only: a perspective grid to an infinite horizon with a sun on the line, a scrolling floor, glow that pulses on the beat, all one fragment shader for razor lines.
- **Outrun and synthwave grid art, and the light grids of Tron.** From memory of the art and the films, not from images fetched this session, so this is a description of what the look is and not a measurement.

What makes them striking, and what was built to it:

- **The dark does the work.** Black floor, black sky, and only the lines lit. The colour reads because the space between is empty. Built to: lines only, fogged to exactly zero, no fill. This is where the canvas fights it, see below.
- **Lines that are tubes of light and not strokes.** A white-hot spine down the middle and a saturated colour round it, so the eye reads brightness and glow at once, and it blooms. Built to: a core that is anti-aliased across one pixel, a spine pulled to white, a gaussian glow in the hue, and an intensity that rests over 1 so the bloom catches the cores.
- **Two colours and a gradient between them.** The classic pair is magenta and cyan, or pink and orange, a third of the wheel apart, warm or hot near you and cold at the horizon. Built to: `GRID_HUE_GAP` is exactly a third of a turn, magenta near and cyan far at a key of 0, graded along the distance, and the key turns both.
- **A horizon that glows.** A hairline at the line, a soft band round it, and the far grid dissolving into it. Built to: `height_horizon_glow`, in the far hue, reaching a little below the line where the fogged floor ends.
- **Perspective is the drama.** Lines converge on a vanishing point and the rows crowd toward the horizon. Built to: a real ray march of the pinhole camera down onto the ground, not a fake, so the terrain bends the rows and the lines lean with the hills.
- **Tron's other trick: light travels along the lines.** A pulse racing down a line is what tells you the line is a wire. Built to: `impact` sends a band from the horizon to the camera, which lights the lines it passes and flares the horizon as it leaves.
- **Thin at a distance.** Lines get thinner and dimmer with distance, they do not shimmer. Built to: thinning by distance, the derivative footprint and the fade to nothing when a pixel spans more than a line.

## What it draws

One fullscreen triangle. The scale is a cell one unit across seen from a camera two units up, so the cells look square on the ground and small: about thirty columns across the middle of the frame and a dozen a third of the way up from the bottom. For each pixel below the horizon the shader marches a ray from the camera down through the relief (28 even slices of height and four halvings, no early exit, so the derivative read after it is legal WGSL), and the ground point it finds is the whole of the drawing. Its coordinates in cells, and `fwidth` of them, give the distance to the nearest line in pixels, and the light is a function of that:

```text
core     the overlap of the line's width with the pixel: never more than its width
glow     0.28 x a gaussian in pixels, sigma = the glow knob (a third of that on a line that moves)
spine    1 at the middle of a line, to 0 a pixel out: pulls the colour to white
detail   1 while a pixel spans 0.16 cells or fewer, 0 at 0.48: lines too fine to resolve fade
         (the lines that run away fade at 0.04 to 0.16, since they pack toward the vanishing point)
motion   1 while a crossing line moves under 100 px a second, 0.02 by 420: fast lines leave copies
```

Everything is multiplied by the fog (exactly 0 at 45 units), the thinning of a line with distance, and `intensity`, and lifted by the ground: a line is up to 2.4 times as bright on tall, sounding ground and half as much again on a slope that faces you, 2.9 at most. The colour is `vivid(hue)`, the lasers' three cosines a third of a turn apart, and not the shared palette.

The ground is the kit's, and the grid changes none of it. The bands lie across the width with the sub on the centre line and the treble at the edge, mirrored so the two halves of a row are the same number for number. What is drawn is `height_profile`: a road that is nearly flat (the bass swells it by `HEIGHT_RIPPLE`, 7 percent of the hills' range) and hills that start at the valley's edge and stand at `HEIGHT_BASE` (45 percent) of the range when the music is quiet and at all of it when the band there is full. The hills follow the music over about a third of a second and the road over a sixteenth, so the sides swell as a landscape does and the road takes the kick. The valley's width and the relief are live knobs applied when the shader looks a height up, so tension narrows the valley for everything on screen at once, not only for the rows born after it.

## The kit, what it is and is not

A ring of `HEIGHT_ROWS` (32) rows of `HEIGHT_COLUMNS` (64) floats across 28 units, `HEIGHT_ROW_SPACING` (0.4) of world apart, a read-only storage buffer of 8 KB, so the field reaches 12.8 units ahead, six and a half camera heights. Each step of travel a row is written at the far end from the music and the rest scroll toward you, so the music arrives after `depth / speed` seconds: a bass hit is a swell that runs at you, which is the picture. At a groove's 2.7 units a second the far end is a little under five seconds from the camera and the ground three units out a little over three and a half, so a kick is a crest that starts at the horizon and runs at you. It was a field twice as deep first, and at that speed a hit took nine seconds to reach you; the field is short for that reason. Past the field the ground is the valley and the hills at their base, so the far half of the frame is a static landscape converging on the horizon and the music is in the near half. The row is born flat (the music fades to nothing over the last quarter of the depth) and follows the row before it over 60 ms of real time on the centre line and 350 ms at the outer edge, so it is smooth however fast the flight and the hills move slowly.

Travel is per second: `advance` takes a distance, so 1/30 s and 1/144 s covering the same ground write the same rows, the fraction of a row is handed to the shader so the ground moves between rows, and the travel is handed over wrapped to one lap of the ring so a float never loses precision after hours. Rows written while the study is dark cost the device nothing, and the whole ring goes up once the first lit frame. What the kit has to work with is the five band levels and their pulses; it does not go back to the analyser.

`README.md`, "Adding a study", says how to put another study on it.

## Knobs

Every number the study owns, resting value first. Every one is driven.

- `speed` 1.2: cells a second. `pace` adds up to 3, `tension` 3.5, and the beat a spring surge of 1 (`beatPulse` through a spring at 5 Hz and a damping of 0.5, so it overshoots by a sixth and rings back inside a beat).
- `height` 0.55: how tall the relief is. `energy` (square root) adds 0.35 and a kick's `bassPulse` 0.1.
- `valley` 0.5: how far out the floor runs before the hills start, as a share of the half width. `tension` takes 0.3 off; `swell` puts 0.12 back.
- `width` 0.55: a line's half width in pixels at 1080, scaled with the canvas: a core about a pixel across. `energy` adds 0.3 and `beatPulse` 0.35.
- `glow` 4: the glow's sigma in pixels, the wide coloured part of a line. `hardness` takes 1.5 off (hard music is sharper) and a kick's `bassPulse` adds 2.
- `intensity` 1.6: the light of one line at its core. Gates down with `energy` and is exactly the resting value at a full packet. Nothing raises it.
- `pulse` 0: `impact` takes it to 1, and the ink starts a pulse when it crosses a half.
- `hue` 0: turns added to the key. `harmonicChange` adds 0.12 and `swell` 0.08.
- `horizon` 0.08: how far the horizon's glow reaches above the line, in half-heights of the frame. `energy` adds 0.07 and a kick's `bassPulse` 0.03, so it swells with the music through its width, and the light of it is a fixed share of a line's.

Ranges are `GRID_RANGES` in `src/impls/grid.params.ts`.

## What tension does

It rushes the grid toward you and narrows the valley: 3.5 on the speed (a groove at half pace flies at 2.7, a full build at 6.2) and 0.3 off the valley's edge, so the hills close in from both sides. It leaves the light alone. On the drop `impact` starts the pulse, and `swell` opens the valley again.

## The pulse

`PULSE_SECONDS` (1.1) from the horizon to the camera. Its position is in `1 / distance`, which is proportional to height on screen, so it is a band of constant thickness (`PULSE_WIDTH`, about three percent of the frame) wherever it is, and it is squared on the way so it accelerates as it nears. It lights the lines it is over past the fog, so it is seen to come in from far off, and it flares the horizon as it leaves. It is the pulse's own clock, advanced by the real step, and one impact is one pulse however slowly `impact` decays.

## Sparse, and flash safe

State the worst case, which is on flat ground because that is where the lines lie closest on screen. `gridCoverage` (the shader's arithmetic in TypeScript, footprint taken from the neighbouring pixels the way `fwidth` does, the fade of fast lines included) counts the pixels lit above a tenth of one line's core:

```text
                       groove      build       widest its mapping reaches
                       (2.7/s)     (6.2/s)     (a full packet, a kick landing)
960 by 540              3.7 %       2.8 %        6.9 %
540 by 540              3.6 %       2.7 %        6.8 %
400 by 720              2.3 %       1.9 %        4.2 %
1920 by 1080            5.5 %       4.4 %        9.7 %
```

`grid3d.test.ts` holds the widest under 15 percent on a 16:9, a square and a tall canvas. The grid moves continuously, so no large area toggles. The one fast change of brightness is the pulse, a band about three percent of the frame tall; impacts cannot be closer than 0.8 s, so it is at most two thin bands a second, and nothing is a flash of the frame. Built to WCAG 2.3.1, not tuned to it.

## What the canvas does to it

Read this before tuning. The director's canvas keeps about two thirds of a second of what was drawn, and the fresh frame the ink draws is black between crisp lines (a capture with the feedback switched off shows it: `window.visimo.setPost({ feedback: { amount: 0 } })` in the dev build). With the memory on, five things happened, each a real capture on the adapter. The captures that matter are at 60 frames a second: headless Edge runs near 180 and hides the ghosting, so the harness caps the page's animation loop.

1. **Anything that stands still is summed to about forty times what is drawn.** The horizon glow at a tenth of a line's light was a slab of solid cyan a third of the sky high, and the lines that run into the distance, which do not move on screen over flat ground, were fat white bars. So the horizon's light is a few hundredths of a line's and those lines are drawn at 14 percent of a crossing line's (`STATIC_LINE`). The horizon reads through its width, which the music moves, and not through its light.
2. **A line that moves leaves copies of itself.** The canvas keeps what was drawn, so a line that moves `m` pixels a frame leaves a copy every `m` pixels. Under a pixel or two that is a blur along the way the line moves. Past a few it is a second line, which is the doubled near floor. Crossing lines are therefore drawn fainter the faster they cross the frame, from 100 pixels a second (under two a frame at 60) to 2 percent of their light at 420 (seven a frame), which takes the bottom fifth of the floor at a groove's speed and about the bottom third at a build's, which leaves the corridor of lines that run away and crossing lines only in the middle distance: it reads as a rush and it is less of a grid while it lasts. The speed on screen is the flight in cells a second over the cells one pixel spans along the ground, so it is worked out per pixel in the shader from the same `fwidth`.
3. **What a moving line leaves is in proportion to all of it, body included.** A moving line's glow is a third of a still line's, so its hot core carries it and the body it feeds the canvas is small. The lines that run away, which stand still, keep the wide coloured glow.
4. **The trail is the same number of gaps at every depth**, because the gap between two crossing lines shrinks with distance in step with their speed, so the floor between the lines fills a little with violet even at a slow speed. More light does not cure it: tripling the intensity was captured and the floor came out brighter and no crisper. Thinner lines would not either, by the arithmetic; that was reasoned and not captured. Crossing lines are drawn fainter as they pack together (`CROWD`), because past a spacing of about 40 of a line's widths the wash is louder than the line.
5. **The lines that run away meet at a point, and the canvas turns that into a bright dot with a dark wedge beside it and, under a build, a thin spike up the middle.** The canvas sharpens what it keeps, which rings at a bright static point, and its zoom drags a static vertical line upward. The lines that run away are faded sooner as they pack (a pixel spanning 0.04 to 0.16 cells across) and the fog ends at 45 units, so nothing bright is left at the vanishing point. The dark wedge is gone. The spike is much smaller and not gone.

So under the director the floor reads as a neon grid with hot crisp cores, and the space between the lines is dark to violet and not black. To get true black the canvas has to forget: a pinned cast, which is how `Prism` runs, can switch it off or shorten it, and that is the cast to make for Outrun (`grid-3d`, `ridgeline`, `starfield`, `crt` in the catalogue).

One thing would fix it from the ink's side and is not done, because it is a change to the contract and not the study's to make: an ink that writes negative light could take its own last frame's line back out of the canvas (each frame add the lines and subtract the previous frame's lines at the keep the canvas holds them at), which would leave no trail at all. The blend adds whatever the shader writes and a half float holds it, so it may already work; `subtract-blend` in the catalogue is the shared piece that would do it properly. Raised, not built.

## Silence, presence and frame rate

The intensity is the study's silence gate: `energy` through `invert` takes it to exactly 0 at a silent packet, so the ink encodes no pass and uploads nothing, and the frame is black (captured: level 0 in the bench is black). At presence 0 the renderer does not call the ink at all. The travel and the pulse's clock run while it is dark, which is CPU only, and the rows the music wrote meanwhile go up together on the first lit frame.

Everything is per second. Travel is speed times the real step, the surge is a spring solved in closed form, the pulse is its own clock, and the lines' phase is the same distance wrapped to one cell, so the same song at 30, 60 and 144 frames a second draws the same frame. `GridInk.test.ts` plays 2.5 s of it at three rates and reads the same phase, and the pulse in the air for the same time.

WebGL2 cannot draw this study and skips it, as it skips every ink but the fractal: the renderer never builds it on that path, so it does not throw.

## Cost

`cheap`: one fullscreen triangle, three buffers made once (a 64 byte view, the 8 KB ring and a 64 byte look), no texture, no compute. The fragment work is the march: 28 slices and four halvings of a bilinear read of the ring, only for pixels below the horizon, and three more reads for the slope and level at the hit. Measured on the development GPU (an NVIDIA Blackwell adapter in headless Edge, WebGPU, vsync off, through the bench's frame meter, which reads in whole tenths of a millisecond of the gap between drawn frames and is not a GPU timestamp): at 2570 by 1440 the frame reads 1.0 ms with the study on and at presence 0, so the cost is under the meter's resolution; at 3850 by 2160 it reads 1.0 ms off and 1.3 ms on, so about a quarter of a millisecond. Measured again after the review round, with the horizon and the fade of fast lines in the shader: the same. A slower GPU will pay more, and the march is the place to cut: fewer slices, or `maxPixels`.

## Looked at

Headless Edge, WebGPU, on the NVIDIA Blackwell adapter, the study bench on the grid alone under clean glass with the synthetic packet, the page capped to 60 frames a second: no WGSL or validation message in the console. Frames at a quiet passage (level 0.25), a groove (0.8), a build (tension 1), the frame after an impact, silence (level 0), and a 4K crop at native resolution.

Against the references in "What the references do", after the review round that asked for a grid and not stacked rows:

- **The grid.** Square cells and about thirty columns across the middle of the frame, so the lines that run away are as present as the ones that cross them and the perspective is doing the work. This was the biggest change: the first build had a cell as wide as the camera was high, and drew the lines that run away at a twelfth of the others' light.
- **Two colours and the gradient.** Magenta near and cyan at the horizon, graded through the middle. Matches the pair the references share.
- **A horizon that glows.** A wide dim cyan band that widens with the level, and the far lines fade into it. It is dimmer than the art it is built to, on purpose (see the canvas above), and at a quiet passage it is barely there because the canvas holds less.
- **Tubes of light and not strokes.** At native 4K the core is a thin white-hot line about a pixel across with the coloured glow round it. Sharp with `fwidth`, no shimmer seen. The glow is narrower than the references' neon, which is the trade for the copies.
- **The dark does the work.** True black in the sky and in silence, and black at the bottom of the frame. Between the lines the floor is a soft violet and not black, which the references have and this canvas does not allow (above).
- **Landscape.** A flat road, a valley wall and hills that stand at the sides and swell with the mids and highs, closing in under a build. This reads as terrain and not as wobble; the bass is a small swell in the road.
- **Light travelling on the lines.** The impact pulse crosses the floor as a bright band from the horizon.

What was not looked at: a real track, a real drop, or a display slower than 60 frames a second.
