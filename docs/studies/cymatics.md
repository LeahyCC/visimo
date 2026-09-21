# cymatics

Sand on a vibrating plate. Each pitch class rings one mode of a square plate, weighted by how strongly that note is sounding, and the ink draws the curves where the sum of the modes is still, which is where sand collects. One note is one figure. A chord is the figure of its modes added, and a chord change is the whole pattern reorganising, as a morph and not a cut.

This file is the plan and the record. It was written before the shader and updated as the picture changed.

## What it was built to look like

Four photographs from Wikimedia Commons, downloaded and looked at (not copied into the repo), before any shader.

- **A copper plate with sand on it** ("Chladni plate 18.jpg", CC BY-SA 4.0). A square plate on a black table, driven at the centre. The sand is a thin, ragged line of fine grain, and the lines are curved: they bulge into closed loops, pinch at the corners of the loops, and run out to the plate edge and stop there. Most of the plate is bare. The figure is small in line length and still fills the eye.
- **Coloured sand on a white plate** ("Chladni I", CC BY 2.0, and its sibling "Chladni III"). Here the sand is piled, not drawn: each line is fat in the middle and tapers to a point at both ends, like a horn, and the lines run in toward the drive point. The colour is only the sand's own, one hue per pile. What it taught is that a line should have weight where it is strongest and end sharply, and that the picture is mostly empty.
- **A cymatics pattern in light** ("Cymatic.jpg", CC BY-SA 4.0). This is the one that stops you. Thin, luminous lines on a deep dark ground, white at the centre of each line with the colour in the glow around it. Cells of black between the lines. A bright point wherever lines meet, and a fine symmetry that makes the whole thing read at once. Colour is one family of blues, and it is the light doing it.
- **A dish of water shaken at a frequency** ("Faraday Waves.jpg", CC BY-SA 4.0). A lattice of soft dimples, low contrast, no line anywhere. It is the honest counter-example: the same physics as the others, and nothing you would stop scrolling for. It is why this study draws the nodal set as lines and does not shade the displacement.

What that comes to, and what the shader does about it:

1. **Thin lines, and mostly nothing.** The plate is black except for the nodal set. Coverage is a few percent, which is the point, and it is what lets colour read.
2. **White at the centre, colour in the glow.** The core is pulled toward white and rests above 1, so the bloom finds it. The colour is in the light round it. Not one colour from the shared palette: each note has a saturated hue of its own.
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

Each note's hue is its place on the circle of fifths as a place on the wheel, turned by `keyHue`, so notes that sound well together are neighbours in colour and a modulation moves the whole wheel. The colour at a point of the plate is the notes' colours weighted by how much of the sum each of them is there (`amplitude x |mode|`), then pushed back out to a full hue, because averaging two colours a long way apart pulls toward grey. A chord is therefore a plate with a region of each note's colour in it, and the dominant note sets most of the colour. Two real tracks show it: Wilco's "One True Vine" draws in magentas and pinks, Emancipator's "Minor Cause" in blues and cyan, from `keyHue` alone.

### The plate settling

A line that sweeps across the plate at full light leaves a full light sheet behind it on a canvas that keeps 0.975 of itself a frame. So while the plate is catching up with a new chord the line is drawn dimmer, and the ghost of the last chord is faint. The measure is how far each mode is from its note's own row in the packet, summed over the twelve: 0 for a held chord, about 6 in the instant one chord gives way to another. The light is `0.3 + 0.7 / (1 + (gap / 2.5)^2)`. It never goes out, since the sweep is worth seeing, and it needs no state, so it is the same at any frame rate. On a chord change the plate dips to about 40 percent and is back to about 90 percent in a second and a half.

## Knobs

Every number the study owns, resting value first:

- `mode0` to `mode11` 0: how strongly each pitch class rings. Each is fed by its own packet row, `chroma0` to `chroma11`, through an envelope with a 120 ms attack and a 1400 ms release. The attack is slow enough to see and the release slower, so for a second and a half the plate is between two figures.
- `layer` 0.1: how far the partner modes have come up. `energy` adds 0.75 through a square root. `tension` takes 0.1 off.
- `sharp` 0.25: how thin and tight the line is drawn. `tension` adds 0.75, so a full build is 1.
- `width` 1: the core's half width in pixels. `energy` adds 0.6 through a square root.
- `glow` 2.5: the glow's width in pixels at 1080 high. `bassPulse` adds 3 through a 5 ms attack and a 300 ms release, `energy` adds 2 and `harmonicChange` 2.
- `strike` 0.45: how hard the plate has just been hit. Four spring rows (2.5 Hz, damping 0.35) from `beatPulse` 0.25, `lowMidPulse` 0.12, `harmonicChange` 0.16 and `impact` 0.12, and `energy` adds 0.15 directly. A hit makes the line fatter and the glow wider, and the spring lets it ring and settle.
- `intensity` 1.2: the light. `tension` takes 0.1 off. Nothing raises it.

Ranges for all of them are `CYMATICS_RANGES` in `src/impls/cymatics.params.ts`.

## What it does with the music

The hit rows are the beat, the mid-low hits and the level. A plucked string is a mid-low onset where a kick is not, so an acoustic track still strikes the plate. The chord change is a strike as well, through `harmonicChange`, which is what re-lays the sand in the new figure. `impact` strikes it hard, and it is one of four rows on `strike`, never the only way in. The study draws nothing from `tension`, `release` or `impact` alone, and a test says so: the real tracks rarely take those rows high, and the notes and the level are what draw it.

## What tension does

Tension sharpens. At full tension `sharp` is 1, so against rest the core is about 40 percent narrower and the glow more than half narrower, and the partner modes are set down. It is the same figure drawn as hairlines, which is what the catalogue asks for. The light is 0.1 lower and nothing else changes. The build moment is 0 in `moments`, so the director does not choose it for a build, and tension only shows when it is in a cast anyway.

## Sparse by construction, and flash safe

It is a line drawing and nothing is filled. Measured by `cymaticsCoverage`, counting the pixels whose fresh light is over 0.05 of the core, on a grid of real canvas points:

| notes and how loud                        | 16:9 | square, the worst shape |
| ----------------------------------------- | ---- | ----------------------- |
| a triad at rest                           | 0.7% | 1.3%                    |
| a triad at the top of every row that adds | 4.6% | 8.4%                    |
| a seven note scale at the top             | 5.2% | 9.0%                    |
| all twelve at once at the top, never read | 5.6% | 9.7%                    |

Those are at the loosest sharpness. At full tension every figure is under 3.5 percent. The plate is a square, so a wide or a tall canvas has less of it than a square one. Tests hold every one of these under a fifth, at sharpness 0, 0.25, 0.5, 0.75 and 1, on eight canvas shapes.

Flash safe, for WCAG 2.3.1, by construction. The light is a set of thin lines in a bounded square. No mode changes faster than its 120 ms attack and 1.4 s release, the spring rebounds once or twice at 2.5 Hz and moves a line's width and not its brightness, and nothing toggles a large area of luminance on or off. There is no strobe in it.

## Silence, presence and frame rate

A packet with no note in it has all twelve mode knobs at 0, and a plate with none ringing encodes no pass and uploads nothing. That is also what drums alone do, and what a passage with no key does, since the note rows read nothing there. Presence 0 does the same. A silent packet in the bench, on the real packet with nothing playing, is 99.5 percent under 0.02; the rest is the demo's own button in the corner.

There is no clock in the ink. The modes are knobs the study shapes per second, and the settling measure is read from the packet and the knobs, so the same song at 30, 60, 144 and 240 steps a second draws the same plate. A test resolves the study at all four and compares the uniform.

WebGL2 cannot draw this study and skips it, as it skips every ink but the fractal. The renderer never builds it on that path, so it does not throw.

## Cost

`cheap`: one fullscreen triangle, one 160 float uniform, no texture, no buffer and no compute. Per pixel it tabulates 18 cosines and sums at most 24 modes. On the RTX 5080 at 2560 by 1440 the demo's frame meter reads 5.6 ms with the study at presence 1 and 5.6 ms at presence 0, over four alternating runs, so it costs less than the 0.1 ms the meter can see. The meter is a frame interval and not a GPU timestamp.

## Where it belongs

Tonal music that is soft to mid in how it hits, acoustic and organic as much as electronic, which the library had nothing for. Its home is a drive of 0.5, a weight of 0.55, a tonality of 0.8, a steadiness of 0.5 and a hardness of 0.2, with a reach of 0.4. On the twenty tracks in `director/tracks.fixture.ts` that is a closeness of 0.68 to 0.99 for the acoustic, folk rock, pop, jam, ambient, downtempo, IDM and tonal house tracks, and 0.36 to 0.45 for the metal, metalcore, drum and bass and dubstep ones. Moments: intro 0.8, groove 1, rest 0.8, and 0 for the build, the drop and the outro.

It excludes `chord-petals`. Both are a figure in the middle of the frame made of the same twelve rows, and the two on top of each other read as neither. Over the 240 casts the fairness test builds, cymatics is in about 13 percent and chord petals in about 13, and they split the tonal tracks between them: petals take the ambient, downtempo and orchestral grooves, cymatics the acoustic, pop, jam and IDM ones. The fairness test passes without a move to the home or the moments.

Cymatics is also cast for the intro and the rest of the metal, drum and bass and dubstep tracks, where nothing else soft is at home and it has no notes to draw, so it draws nothing. That is the thin quiet end of the library the open leads already describe, not something this study causes, and it costs nothing when it draws nothing.

## What the canvas does to it, on a real adapter

Measured in headless Edge on the RTX 5080, at 1280 by 720, through the demo's preset dropdown (`solo:cymatics`, which puts Curl drift under it and Clean glass over it), with real tracks through the file input. The share of the frame over 0.3 means the brightest channel of a screenshot pixel, and the saturation is the mean of (max - min) / max over those pixels.

| track                    | seconds in | over 0.3 | over 0.8 | mean saturation of the lit | under 0.02 |
| ------------------------ | ---------- | -------- | -------- | -------------------------- | ---------- |
| Emancipator, Minor Cause | 60         | 24.4%    | 2.7%     | 0.67                       | 46.2%      |
| Emancipator, Minor Cause | 100        | 23.4%    | 2.7%     | 0.65                       | 50.8%      |
| a silent packet          | n/a        | 0.07%    | 0%       | 0                          | 99.5%      |

The console showed no WGSL message and no validation error at any of these. The one warning in it is the browser's note that `powerPreference` is ignored on Windows.

The frame is not as dark as the ink alone would leave it, and the reason is the canvas. It zooms its history outward a fraction of a percent every frame, and by more on the beat, and it carries the history along the flow. A line that holds still, which a held chord is, stays over the same pixels while the history behind it slides away, so each line collects a soft band on its outer side, and the band is longer the further the line is from the centre. With no flow and no drift (`setPost` with zoom 1) the same chord is a plain neon line drawing on black, 8 percent of the frame over 0.3. With the director's canvas and Curl drift it was 9 to 25 percent across the two tracks I played, the higher figure on the busier one.

I tried three things to make the trail thinner, on the real adapter. A lower resting light (0.5) barely moved the area, because a line that holds still saturates in place whatever it adds per frame. A hotter core (2.4) made the band fatter and paler. A smaller plate helped a little. What did help colour was a less white core: 0.6 white gave a saturation of 0.5 and 0.35 gave 0.66, so the core is `mix(hue, white, 0.35)` and the very centre of the line is still the brightest thing on screen. The rest is the canvas doing what it is for, and it is the reason the settling dim exists: without it the sheets a morph leaves were as bright as the lines.

## Not yet done

The note rows were tuned on synthetic chords and looked at on two real tracks, both with a flow under them. It has not been watched through a whole track, and the settling dim, the spring and the glow want a look at a chord change in a loud passage, where `harmonicChange` is drowned by the drums and only the chroma rows say the chord moved. Which flow suits it best is a director question: a still figure and a canvas that flows fight, and the calmer flows will show its lines better than Curl drift does.
