# Aurora

The plan for the `aurora` study, written before most of the tuning and kept
current with it. Update it in the same push as any change of plan.

## What it draws

Three or four tall curtains of light, swaying slowly, coloured green at the
foot and violet to magenta at the top. A curtain is a folded sheet seen edge
on: its lower edge is a smooth curve across the frame that drifts, and above
that edge the light is made of fine vertical rays, sharp and bright at the
foot and dissolving to nothing well before the curtain's own top. The far
curtains are dimmer, slower, thinner and stand nearer the middle of the frame.
A hit in the bass or the mids sends a ripple travelling along one curtain,
a local swell rather than a flash of the whole sheet.

## What the references teach

Three sources shaped the look:

- [Light Stalking's aurora photography guide](https://www.lightstalking.com/aurora-photography-guide/)
  and the aurora-colour explainers it links: green comes from oxygen at
  90 to 150 km, and the lower border of an active curtain often reads as a
  purple or magenta fringe where the green mixes with the blue-violet of
  nitrogen underneath it. That fringe, not a uniform glow, is what a real
  curtain's edge looks like.
- Wikipedia's [aurora](https://en.wikipedia.org/wiki/Aurora) article: red sits
  highest (630 nm, the rarest and highest colour), green dominates the middle
  altitudes (557.7 nm), and blue to violet comes from molecular nitrogen lower
  still. It also gives the reason for the hard lower edge: "the rapid decrease
  in concentration of atomic oxygen below about 100 km is responsible for the
  abrupt-looking end of the lower edges of the curtains" and that "no auroras"
  form "below 70 km." The edge is hard because the light stops existing, not
  because it fades out.
- The same article on structure: "rays are light and dark stripes across arcs,
  reaching upwards by various amounts." A curtain's rays are not a filled
  glow; they are individual bright and dark columns of different heights.

So the build keeps to: a hard lower edge with nothing at all below it, fine
vertical rays each with a height of its own, green low down going to violet
and magenta higher up, and a sheet that reads as fabric rather than a haze
(the far curtains thinner and dimmer than the near one, never all the same
weight).

## The colour, held to the arc

An aurora's colour is a fact and not a taste, so it is never taken from the
shared palette. Every curtain has two hues, the foot's and the tip's, each
confined to its own band inside the wider arc from green through cyan and
blue to violet and magenta (`AURORA_ARC`, `BASE_BAND`, `TIP_BAND` in
`aurora.params.ts`). `keyHue` places both bands' centre by a sine of the key
in turns, so the last key and the first, which are neighbours on the circle
of fifths, sit at neighbouring colours. `harmonicChange` integrates into a
`hue` knob (turns the chord has added), which nudges both hues together
inside their bands and never past them: the same rule the lightning study
uses for its own band from cyan to violet, so following the key all the way
round never draws a colour the real thing does not have. The two hues never
merge into one: the walk from foot to tip happens in hue space over the top
three quarters of a curtain's height, so the middle of a tall curtain is a
fully saturated blue and not a wash toward grey.

## When it draws, and what moves it

Two rows gate the light, both `invert`: `energy` and `keyClarity`. Both are
subtracted from the resting intensity, so a silent packet (both rows at their
minimum) resolves the two subtractions to exactly the resting value, cancelled
to nothing, and a passage of drums with no key resolves the `keyClarity` row
alone, drawing a dimmer curtain rather than none. Nothing about the light ever
rises above its resting value: the two gates only ever take light away, so a
loud tonal passage is at rest and a quiet or atonal one is dimmer, never the
reverse. Real music practically never reaches `tension`, `release` or
`impact` for long, so none of the three drives anything into being: the study
is driven entirely by the level, the mids, the treble and the chroma, the
rows the catalogue asked for.

The punch the catalogue wants when the music is loud goes into curtain count,
height, ray sharpness, sway and the ripple's strength, never into `intensity`:
`energy` lifts `curtains` from about 1.4 toward 4 and `height` from 0.55
toward 0.85, `treble` and `energy` sharpen the rays, `lowMid` and `highMid`
widen the sway, and `energy` and `highMidPulse` deepen the ripple a hit sends.

## Tension

Tension lowers and dims the curtains, as the catalogue asks: it takes
`curtains`, `height`, `sway`, `drift` and `ripple` all down, and takes
`intensity` down through a `scale` on `energy`, so a silent build cannot pull
the light under nothing (the scale is zero when there is nothing to scale).
No row raises anything with tension. The study draws nothing of its own
through a build beyond what the level already gives it: there is no standing
light of its own to wind in, since a curtain redraws itself from the packet
every frame rather than accumulating.

## The canvas, and why the numbers look the way they do

The canvas keeps 0.975 of itself a reference frame, so a mark that stood
perfectly still would sum to about forty times what one frame draws. Nothing
here stands still: the flow, the zoom and each curtain's own sway carry the
light along, so what any one pixel holds is a smear of several frames rather
than the full sum. `FRESH` (0.1) is the fraction of that full sum one frame is
allowed to add at the foot, set by eye on the adapter against a quiet ambient
passage; `SETTLE` (`FRESH / (1 - 0.975)`, 4) is what a curtain would settle at
if it somehow stood still, and it is what the coverage tests are measured
against, since that is the ceiling a slowly drifting curtain approaches.

The sway and the drift are kept slow on purpose: `MAX_RAY_SPEED` and
`MAX_EDGE_SPEED` bound how fast the top of a ray may lean and how fast the
lower edge may rise or fall, in frame heights a second, at the top of every
knob's range. Past a few pixels a frame on the reference canvas a moving
edge leaves a glow under it that the canvas then sums into a second, ghost
edge; the tests hold both bounds directly and by measuring the real curve a
second apart.

## Coverage, the visual bar and the flash rule

`sampleAurora` in `aurora.params.ts` samples the settled light (the light a
still curtain would sum to) on a grid over a canvas of a given shape, at a
spread of times, and reports the share over 0.3 (`LIT_LEVEL`) and over 0.8
(`BRIGHT_LEVEL`) of the frame. At the worst the mapping reaches (a full,
tonal, loud packet: about four curtains, the tallest they go, the sharpest
rays) the settled share over 0.3 is under 0.12 on every canvas shape tested,
and over 0.8 under 0.05, both well inside the catalogue's "well under a
third." `registry.test.ts` and `aurora.params.test.ts` hold this on eight
canvas shapes: 1920x1080, 1080x1920, 1080x1080, 2520x1080, 1440x1080,
3840x1080, 1280x1024 and 800x1200.

Nothing in the study is an event that could flash: every knob moves with a
level or drifts on a clock, so there is no large-area brightness change
faster than the slowest sway. The ripple is bounded to a slot at least
`RIPPLE_GAP_SECONDS` (0.45 s) apart and a width of a tenth of a frame height,
far under the large-area threshold WCAG 2.3.1 counts a flash by, and it lifts
light locally rather than switching a curtain on or off.

## Home and moments

Ambient, classical and acoustic: low drive, weight in the low to middle,
high tonality, low hardness. The home and reach were picked against
`src/director/tracks.fixture.ts` (`director/fairness.test.ts` holds the
library's balance across all twenty measured tracks and every one of its
studies): `{ drive: 0.25, weight: 0.6, tonality: 0.8, steadiness: 0.35,
hardness: 0.06 }`, reach 0.33, close to Christian Löffler's ambient house and
Jon Hopkins's ambient reading and far from the metal end. Moments: intro 1,
rest 1, outro 1, groove 0.3, build and drop 0. Adding the study did not move
any other study's home; the fairness test passed without touching it.

## Files

- `src/studies/defs/aurora.ts`, the study.
- `src/impls/aurora.params.ts`, the curtain maths, the colour arc, the ripple
  pool and the uniform writer.
- `src/impls/AuroraInk.ts`, the GPU side: one uniform, one pass of a
  fullscreen triangle.
- `src/shaders/aurora.wgsl`, the transcription of the curtain's light.
- Tests: `src/impls/aurora.params.test.ts` (the maths, the frame-rate proof,
  the coverage, the colour arc, the ripples) and `src/studies/aurora.test.ts`
  (the study: home, moments, what draws it, what tension does).

## Looked at

Headless Edge, WebGPU, on the NVIDIA Blackwell adapter, driving the renderer
directly with the same cast `soloCast` builds for an ink (`curl-drift`,
`aurora`, `clean-glass`, the director's carried canvas), a synthetic packet
standing in for the audio graph, capped to 60 frames a second. No WGSL or
validation message in the console at any point (the one console entry seen
was an unrelated 404 from the harness page's missing favicon).

- **Black sky.** True black above and between the curtains at every packet
  tried, including a full silent one, where the study also uploads nothing
  and encodes no pass.
- **The hard edge and the rays.** The lower border reads as a bright line and
  the body above it as individual vertical rays of different heights and
  brightness, thinning to nothing well short of the curtain's own top, not a
  filled wedge.
- **The colour walk.** Green at the foot climbing through cyan and blue to
  violet and magenta at the top, at every key tried; a moving chord nudges
  both ends without ever producing red, orange or yellow.
- **Tension.** A wound passage visibly loses curtains, height and light
  against the same passage at tension 0, and gains nothing.
- **The ripple.** A hit sends a local brightening that travels along a
  curtain rather than lighting the whole sheet.

Measured over the loudest, most tonal packet the mapping reaches, averaged
over ten frames a couple of seconds apart on a 1280x720 capture (so the
canvas's own long memory has settled): the share of the frame over 0.3
brightness read about 7 percent, well under the third the catalogue allows,
and the mean saturation of pixels brighter than 0.1 read about 0.90 to 0.95,
which is the near-fully-saturated look the reference photographs have. The
sky and the space between curtains stayed under 0.02 brightness for the
large majority of the frame at every packet tried.

What was not looked at: a real track, or a display slower than 60 frames a
second.
