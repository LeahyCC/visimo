# cymatics

Sand on a vibrating plate. Each pitch class rings one mode of a square plate, weighted by how strongly that note is sounding, and the ink draws the curves where the sum of the modes is still, which is where sand collects. One note is one figure. A chord is the figure of its modes added, and a chord change is the whole pattern reorganising, as a morph and not a cut.

This file is the plan and the record. It was written before the shader and updated as the picture changed, most recently after a review on a real adapter found it washing out under the canvas.

## What it was built to look like

Four photographs from Wikimedia Commons, downloaded and looked at (not copied into the repo), before any shader.

- **A copper plate with sand on it** ("Chladni plate 18.jpg", CC BY-SA 4.0). A square plate on a black table, driven at the centre. The sand is a thin, ragged line of fine grain, and the lines are curved: they bulge into closed loops, pinch at the corners of the loops, and run out to the plate edge and stop there. Most of the plate is bare. The figure is small in line length and still fills the eye.
- **Coloured sand on a white plate** ("Chladni I", CC BY 2.0, and its sibling "Chladni III"). Here the sand is piled, not drawn: each line is fat in the middle and tapers to a point at both ends, like a horn, and the lines run in toward the drive point. The colour is only the sand's own, one hue per pile. What it taught is that a line should have weight where it is strongest and end sharply, and that the picture is mostly empty.
- **A cymatics pattern in light** ("Cymatic.jpg", CC BY-SA 4.0). This is the one that stops you. Thin, luminous lines on a deep dark ground, white at the centre of each line with the colour in the glow around it. Cells of black between the lines. A bright point wherever lines meet, and a fine symmetry that makes the whole thing read at once. Colour is one family of blues, and it is the light doing it.
- **A dish of water shaken at a frequency** ("Faraday Waves.jpg", CC BY-SA 4.0). A lattice of soft dimples, low contrast, no line anywhere. It is the honest counter-example: the same physics as the others, and nothing you would stop scrolling for. It is why this study draws the nodal set as lines and does not shade the displacement.

What that comes to, and what the shader does about it:

1. **Thin lines, and mostly nothing.** The plate is black except for the nodal set. Coverage is under half a percent even at the loudest, which is the point, and it is what lets colour read.
2. **White at the centre, colour in the glow.** The core is pulled toward white, and the glow round it is colour. Not one colour from the shared palette: each note has a saturated hue of its own. What "the bar for perfect" asks for here, a core resting above 1, turned out to be more light than the canvas could carry for a held chord; see "What a review on a real adapter found" below.
3. **The lines meet at nodes, and the nodes are brighter.** Where two lines cross, the sum and its gradient both go to zero, so the distance estimate stays small over a little patch and the crossing draws as a bright point. Nothing had to be added for this.
4. **The lines end at the plate's edge.** The modes are cosines, whose slope is zero at the edge, so every line meets the edge square on, as they do on the copper plate.
5. **A change of frequency reorganises everything at once.** A new chord is different modes, so nothing carries over except the notes the two chords share.

## The maths

A square plate rings in the modes `cos(n pi x) cos(m pi y)` and their transposes. The study gives each pitch class a pair `(n, m)` with `n < m`, taken in order of `n^2 + m^2` from `(1, 2)` up to `(4, 5)`, which is how a plate's resonances climb, so a higher note is a busier figure and a given note is always the same figure. A mode is `cos(n pi x) cos(m pi y) + s cos(m pi x) cos(n pi y)` with `s` of plus or minus one. If every mode had `s = -1` every figure would carry the diagonal as a nodal line, so the signs are mixed.

A second set of twelve finer modes, the partners (`n^2 + m^2` from 45 to 85, top mode 8), rings along in the share `layer` says. `layer` follows the level, so a loud passage is a plate with more modes in it, in the way a hard strike puts more overtones into a bell.

Only the relative weights decide where the lines go. A quiet chord and a loud one are the same lines. How loud shows in how wide and how bright they are drawn.

### The line

The distance from a pixel to the nodal set is `|f| / |grad f|`, exact on the line and a good estimate within a few pixels of it. The shader gets the gradient from the neighbouring pixels of the 2 by 2 quad. So the line is a pixel or two wide at any resolution and nothing shimmers at 4K: there is no coverage mask with an edge to alias, only a distance. The core is `1 - smoothstep(half - 0.5, half + 0.5, distance)`, a one pixel feather, so a line covers the fraction of a pixel it covers. The glow is `exp(-distance / g)`.

The shader uses `length(vec2(dpdx(f), dpdy(f)))` and not `fwidth`. `fwidth` is the sum of the two derivatives, which is the square root of two too large for a line on the diagonal, and it draws diagonal lines about 30 percent thinner than lines along an axis. Both derivatives are taken before anything can return, and every branch before them is on the uniform, so the control flow is uniform. `cymatics.params.test.ts` reads the shader for that.

The core width is in device pixels, not scaled with the canvas. The glow is a share of the picture and does scale with the canvas height.

### Colour

Each note's hue is its place on the circle of fifths as a place on the wheel, turned by `keyHue`, so notes that sound well together are neighbours in colour and a modulation moves the whole wheel. The colour at a point of the plate is the notes' colours weighted by how much of the sum each of them is there (`amplitude x |mode|`), then pushed back out to a full hue, because averaging two colours a long way apart pulls toward grey. A chord is therefore a plate with a region of each note's colour in it, and the dominant note sets most of the colour.

### The plate settling

A line that sweeps across the plate at full light leaves a full light sheet behind it on a canvas that keeps 0.975 of itself a frame. So while the plate is catching up with a new chord the line is drawn dimmer, and the ghost of the last chord is fainter. The measure is how far each mode is from its note's own row in the packet, summed over the twelve: 0 for a held chord, about 6 in the instant one chord gives way to another. The light is `0.65 + 0.35 / (1 + (gap / 2.5)^2)`.

The floor of that dip used to be much lower (0.3, so a full chord swap dipped to about 40 percent). A review on a real adapter asked specifically that a chord change not read as the darkest moment of the bar, since `harmonicChange` also strikes the plate at the same instant and a change should read as an event, not a fade to black. Now `GLOW_GAIN` (below) is what stops a held chord washing out, so the settling dip only has to take the edge off a moving figure and not carry the whole job, and it is gentle: a full swap dips to about 70 percent and is back within a second. It never goes out either way: the sweep is worth seeing.

## What a review on a real adapter found

The first cut of this study passed every test and looked right in isolation, at rest, with no canvas. Reviewed in the demo's own solo cast (`solo:cymatics`, which pairs any soloed ink with Curl drift and Clean glass) on a real adapter, a held chord in a real track washed into wide, soft, near-white ridges with only a faint colour fringe: a marbled plasma and not a line drawing. Switching the canvas off entirely (`window.visimo.setPost({feedback:{amount:0,carry:0}})`) showed the true, correct figure underneath: thin coloured curves, one or two pixels wide, on true black. The maths and the colour were right. The budget was not.

The cause is the canvas plus whatever flow carries it, and this study cannot change either. The canvas keeps 0.975 of itself a frame, which is roughly forty times what one frame adds for a source that never moves, and it clamps any pixel that reaches its ceiling (`feedback.ceiling`, resting at 1.8) rather than losing it: a glow whose peak once accumulated is a meaningful fraction of that ceiling saturates to white over the whole radius the glow reaches, which is what a soft colour turning into a wide near-white ridge actually is. Curl drift, the flow every solo ink is paired with, then drags what accumulates: a chord held for as long as a groove holds it sits still in screen space while the flow keeps advecting the light that piled up near it, so what should be a thin line becomes a comet's core with a long, wide tail. A study that draws a genuinely static figure for seconds at a time, which is what a held chord is, is close to the worst case this canvas and this flow can be given.

The fix is entirely in how little one frame contributes, since nothing else is this study's to change:

- **`GLOW_GAIN`** in `cymatics.params.ts`, the glow's own brightness, came down by about two orders of magnitude from the first cut (0.09) to keep its accumulated peak well under the canvas's ceiling, so it reads as a soft ring and not a second, dimmer core.
- **`width`, `glow` and `intensity`** rest much lower than the visual bar's "core above 1" would suggest (0.24, 0.3 and 0.42), and the rows that grow them with the level (`energy`, `bassPulse`, `harmonicChange`) were cut back by a similar factor, so a loud, busy passage does not re-inflate what the resting numbers bought.
- **The plate itself is smaller** (`PLATE`, 0.66 of the canvas's short side rather than 0.8), which shortens every line and so shortens every trail.
- **The settling dip is gentler** (see above), since `GLOW_GAIN` is now doing the job the dip used to carry alone.

### What this cost, and the trade-off it found

Tuned against the demo's own reference track (`Ecstasy Of Soul`), played from the start through the solo cast, in headless Edge on an RTX 5080 at 2560 by 1440, with the canvas as the director builds it (Curl drift under, Clean glass over). "A lit run" is a run of contiguous pixels over 0.3 brightness along a horizontal scan, measured across the middle 200 rows, which is a proxy for how wide a line reads on screen.

| second | over 0.3 | over 0.8 | under 0.02 | median lit run | 90th percentile run | mean saturation, lit pixels |
| ------ | -------- | -------- | ---------- | -------------- | ------------------- | --------------------------- |
| 30     | 0.6%     | 0.01%    | 89%        | 5 px           | 14 px               | 0.41                        |
| 60     | 0.2%     | 0%       | 97%        | 3 px           | 5 px                | 0.32                        |
| 105    | 0.1%     | 0%       | 94%        | 2 px           | 5 px                | 0.37                        |
| 120    | 0.1%     | 0%       | 92%        | 3 px           | 6 px                | 0.34                        |
| 140    | 0.4%     | 0%       | 90%        | 7 px           | 10 px               | 0.52                        |

The area and darkness numbers hold with a wide margin at every point checked: nowhere near the fraction of the frame that was blowing out, and the frame stays black almost everywhere. The line width target, a median under 5 pixels and a 90th percentile under 10, holds at three of the five points checked and sits a pixel or two over it at the two loudest instants sampled (30s and 140s), where the busiest, most overlapping chords sit.

The saturation of the lit pixels did not come back to where the first cut measured it (0.67, against a bar of 0.55 or more). This is the trade-off this tuning pass found and could not get past: a thinner, dimmer line has proportionally more of its "lit" pixels at the anti-aliased edge of the core, blended with whatever the canvas is carrying underneath, rather than solidly inside it, and that blend reads less saturated than a fatter, brighter core's own centre does. Pushing `intensity` and `width` back up to recover it reopens the wash this whole pass exists to close, by the same mechanism: the two numbers this canvas and this flow ask for are close to opposite. Every combination tried moved one at the expense of the other; none cleared both bars on this track at every point checked. The picture is still visibly colour (green, blue, violet, on true black, no washing), just not as saturated as the original, un-canvassed figure was.

### The flow this study actually wants

Curl drift is what any soloed ink is paired with, and it is the worst possible partner for a study whose whole subject is a figure that holds still: it is a flow, and its entire job is to keep something moving. A held chord under a flow that never rests is fighting its own premise. This is a director-level question, not something this study can decide for itself, and it is the next lead: try this study under a calmer or stationary flow (or none) before concluding the width and the saturation cannot both be had. It was not changed here because the flow a cast pairs an ink with belongs to the cast and the director, not the study.

## Knobs

Every number the study owns, resting value first:

- `mode0` to `mode11` 0: how strongly each pitch class rings. Each is fed by its own packet row, `chroma0` to `chroma11`, through an envelope with a 120 ms attack and a 1400 ms release. The attack is slow enough to see and the release slower, so for a second and a half the plate is between two figures.
- `layer` 0.1: how far the partner modes have come up. `energy` adds up to 0.08 through a square root. `tension` takes 0.1 off.
- `sharp` 0.3: how thin and tight the line is drawn. `tension` adds 0.7, so a full build is 1.
- `width` 0.24: the core's half width in device pixels. `energy` adds up to 0.02 through a square root, which is deliberately little: this is the number that most directly sets how wide a line reads, and the canvas's own drift adds width this knob never has to.
- `glow` 0.3: the glow's width in pixels at 1080 high. `bassPulse` adds up to 0.1 through a 5 ms attack and a 300 ms release, `energy` up to 0.08 and `harmonicChange` up to 0.08.
- `strike` 0.45: how hard the plate has just been hit. Four spring rows (2.5 Hz, damping 0.35) from `beatPulse` 0.25, `lowMidPulse` 0.12, `harmonicChange` 0.16 and `impact` 0.12, and `energy` adds 0.15 directly. A hit makes the line fatter and the glow wider, and the spring lets it ring and settle.
- `intensity` 0.42: the light. `tension` takes 0.1 off. Nothing raises it.

Ranges for all of them are `CYMATICS_RANGES` in `src/impls/cymatics.params.ts`.

## What it does with the music

The hit rows are the beat, the mid-low hits and the level. A plucked string is a mid-low onset where a kick is not, so an acoustic track still strikes the plate. The chord change is a strike as well, through `harmonicChange`, which is what re-lays the sand in the new figure. `impact` strikes it hard, and it is one of four rows on `strike`, never the only way in. The study draws nothing from `tension`, `release` or `impact` alone, and a test says so: the real tracks rarely take those rows high, and the notes and the level are what draw it.

## What tension does

Tension sharpens. At full tension `sharp` is 1, so the core is about 40 percent narrower and the glow more than half narrower than at rest, and the partner modes are set down. It is the same figure drawn as hairlines, which is what the catalogue asks for. The light is 0.1 lower and nothing else changes. The build moment is 0 in `moments`, so the director does not choose it for a build, and tension only shows when it is in a cast anyway.

## Sparse by construction, and flash safe

It is a line drawing and nothing is filled. Measured by `cymaticsCoverage`, counting the pixels whose fresh light is over 0.05 of the core, on a grid of real canvas points, at the numbers the study itself resolves to:

| notes and how loud                            | 16:9  | tall  | square |
| --------------------------------------------- | ----- | ----- | ------ |
| a triad at rest                               | 0.22% | 0.19% | 0.36%  |
| a triad at the loudest the study reaches      | 0.24% | 0.25% | 0.46%  |
| a seven note scale at the loudest             | 0.22% | 0.21% | 0.45%  |
| all twelve at once at the loudest, never read | 0.21% | 0.18% | 0.47%  |

All of these are well under a tenth of the fifth the tests hold every study to; the plate itself is now small and thin enough that the raw, uncanvassed ink was never really the risk. Tests hold the wider bound (under a fifth) at sharpness 0, 0.25, 0.5, 0.75 and 1, on eight canvas shapes, as a backstop rather than a live constraint.

Flash safe, for WCAG 2.3.1, by construction. The light is a set of thin lines in a bounded square. No mode changes faster than its 120 ms attack and 1.4 s release, the spring rings a couple of times a second and moves a line's width and not its brightness, and nothing toggles a large area of luminance on or off. There is no strobe in it.

## Silence, presence and frame rate

A packet with no note in it has all twelve mode knobs at 0, and a plate with none ringing encodes no pass and uploads nothing. That is also what drums alone do, and what a passage with no key does, since the note rows read nothing there. Presence 0 does the same. A silent packet in the bench, on the real packet with nothing playing, is 99.5 percent under 0.02; the rest is the demo's own button in the corner.

There is no clock in the ink. The modes are knobs the study shapes per second, and the settling measure is read from the packet and the knobs, so the same song at 30, 60, 144 and 240 steps a second draws the same plate. A test resolves the study at all four and compares the uniform.

WebGL2 cannot draw this study and skips it, as it skips every ink but the fractal. The renderer never builds it on that path, so it does not throw.

## Cost

`cheap`: one fullscreen triangle, one 160 float uniform, no texture, no buffer and no compute. Per pixel it tabulates 18 cosines and sums at most 24 modes. On the RTX 5080 at 2560 by 1440 the demo's frame meter reads 5.6 ms with the study at presence 1 and 5.6 ms at presence 0, over four alternating runs, so it costs less than the 0.1 ms the meter can see. The meter is a frame interval and not a GPU timestamp.

## Where it belongs

Tonal music that is soft to mid in how it hits, acoustic and organic as much as electronic, which the library had nothing for. Its home is a drive of 0.5, a weight of 0.55, a tonality of 0.8, a steadiness of 0.5 and a hardness of 0.2, with a reach of 0.4. On the twenty tracks in `director/tracks.fixture.ts` that is a closeness of 0.7 to 0.99 for the acoustic, folk rock, pop, jam, ambient, downtempo, IDM and tonal house tracks, and 0.36 to 0.45 for the metal, metalcore, drum and bass and dubstep ones. Moments: intro 0.8, groove 1, rest 0.8, and 0 for the build, the drop and the outro.

It excludes `chord-petals`. Both are a figure in the middle of the frame made of the same twelve rows, and the two on top of each other read as neither. Over the 240 casts the fairness test builds, cymatics is in about 13 percent and chord petals in about 13, and they split the tonal tracks between them: petals take the ambient, downtempo and orchestral grooves, cymatics the acoustic, pop, jam and IDM ones. The fairness test passes without a move to the home or the moments.

Cymatics is also cast for the intro and the rest of the metal, drum and bass and dubstep tracks, where nothing else soft is at home and it has no notes to draw, so it draws nothing. That is the thin quiet end of the library the open leads already describe, not something this study causes, and it costs nothing when it draws nothing.

## Not yet done

- **The flow.** As above: this study wants to be judged, and ideally cast, under something calmer than Curl drift, or no flow at all. That is a director question and is left open.
- **The saturation trade-off.** A version tuned for full saturation and one tuned for a thin line were both tried, and no single setting found on this track cleared both bars. Worth another look once the flow question above is settled, since a flow that does not keep dragging the figure sideways may let both come back together.
- **More tracks.** This pass tuned and measured against one track, the demo's own dance track, chosen because it was the one the review used. It has not been played end to end against an acoustic or classical track, which is this study's actual home; the numbers here are a stress test on a track this study is not for, and the loudest, busiest moments happen to be exactly where it is furthest from home. A quieter, more sparsely voiced tonal track is likely kinder to it and is worth checking before the flow question is settled.
