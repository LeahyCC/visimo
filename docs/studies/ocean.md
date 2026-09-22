# ocean

A sea surface to the horizon, flown over. Nearly black, drawn entirely by what
it reflects: a light path from the horizon to the camera, a horizon glow, and
glints where a slope catches the light. Built on height-kit
(`src/impls/height.params.ts`, `HeightField.ts`, `src/shaders/height.common.wgsl`),
the second study on it after `grid-3d`, and needs no change to the kit: the
sea replaces the terrain the shader marches, and reads the ring's own five
bands as the height of two kinds of wave rather than as a valley.

This file is the plan and the record. It is written first and updated in the
same push as any change of plan.

## What the references do

Looked at before the shader was written, from memory of the kind of image
rather than a fetched photograph, since this session had no way to browse
one. Each is a familiar sight and not an invented one:

- **A moonlight or sunset path over open water.** The single most recognisable
  thing water does at night: a narrow, broken column of light running from
  the light on the horizon straight to the camera, made of nothing but many
  small facets of the surface happening to be tilted the right way to throw
  their reflection back at the eye. It is never a smooth beam; it shimmers and
  breaks with every wave that passes through it, wider where the water is
  rougher and narrower where it is calm. Built to: the path is a lobe in
  reflected-sky space (`pathLobe`), so only facets whose tilt sends the
  light's own point back to the camera light up, and the chop's roughness is
  what spreads the lobe across more of them.
- **Long-lens photography of open sea at distance**, the kind that compresses
  the swell into rows of long, low bands with a soft light along their crests
  and true black in the troughs, with no land, no foam and no detail up
  close: the camera is far enough that what is seen is the shape of the light
  on the water and nothing of the water itself. Built to: the water carries no
  colour of its own, only Fresnel's share of whatever sky a slope reflects, so
  a trough facing away from the light is close to black and a crest facing it
  catches the glow.
- **The ocean in a good offline render** (the kind of shot a look at Blender's
  ocean modifier or a still from a film with a night sea in it would show):
  what makes those convincing is that the water is never lit from the front
  the way a solid is. It is a mirror, and everything about its look, the
  colour, the brightness, the sparkle, comes from what it is angled to catch,
  which is why the horizon reads brighter than the water at the camera's feet
  even though nothing there emits light of its own. Built to: Fresnel
  (`fresnel`) makes a grazing view (near the horizon) reflect almost
  everything and a steep one (looking down into the water near the camera)
  reflect almost nothing, which is the one piece of physics that makes
  everything else read as water and not as a painted gradient.

What makes them striking, together: the water itself is never the subject.
The subject is the light, and the water is only ever a slope that either
catches it or does not. A study that painted the water a colour, however
pretty, would be showing a picture of water and not water.

## What it draws

One fullscreen triangle, the same shape as the grid. `height.common.wgsl` is
prepended for the ring, the fog and the horizon glow, but the terrain the kit
gives (`height_profile`, a valley and hills) is not what the sea uses:
`OceanInk` writes a flat profile into the kit's uniform and the shader's own
march (`sea_march`) walks the ray down through a bound the swell can reach,
using the sea's own height function instead of the kit's.

The surface is nine sine trains, summed: three long ones (the swell, 15, 9.5
and 6 world units crest to crest) at different angles, standing as tall as
the ring's low-end read says, and six short ones (the chop, from about 3.2
units down to 0.5, laid out by the golden ratio so no two run alike) standing
as tall as the ring's read of the mids. Only the swell is marched (the chop
moves the water too little to be worth the extra march steps); the chop and
the swell together decide the slope everywhere, which is what the light
reads. A pixel's own footprint on the ground (`sea_footprint`, `sea_lod`)
fades a wave out once a pixel can no longer resolve it, so the far water does
not alias into moiré.

At a ground point, the slope gives a facet's normal, and the camera ray
reflected off it (`facetSky` on the CPU, the shader's own inline version in
`fs`) says which piece of the sky the facet shows: a glow along the horizon
(warm at the line, the deep hue higher up), a small hot light a little above
the line, and true black above that. Three things are drawn from this:

- **The sheen**, the glow mirrored broadly across every wet facet. Small and
  even, since it is the base coat and not the picture.
- **The path**, a lobe centred on the light's own reflection point
  (`pathLobe`): facets that would send the light back to the camera light up,
  and the chop's roughness is what spreads it.
- **The glints**, a thin band of slopes about the glow's brightest line and
  about the light itself (`glintBand`), lit only where a facet's tilt is
  inside the band. Narrow the knob and fewer facets qualify at any moment;
  as the water moves under them a different, smaller set qualifies the next
  frame, which is the shimmer.

All three are scaled by Fresnel, which is why the water under the camera is
black and the water toward the horizon is not.

**Where a glint is allowed to show at all is itself distance-dependent, and
this is the one piece of the design that is not obvious from the reference
photographs and had to be found by looking at a capture.** Right under the
horizon a pixel spans many wavelengths of chop and cannot resolve a single
facet, so a naive glint band there is a wide, slow-moving stripe and not a
spark; the canvas's long memory then sums that stripe into a static slab
(`OCEAN_GLINT_WINDOW.from`/`.full` gate this in). And near the camera a real
glint crosses the frame fast enough that the canvas's memory turns it into a
comet rather than a point; the fix is not to slow the glint (that is not what
tension is for) but to fade glints out with depth from two different points,
since the ones along the horizon's line, which are strips that close into
rings on a rough enough surface, go first (`lineFade`/`lineGone`), and the
ones on the light itself, which are round and hold their shape further down,
go later (`lightFade`/`lightGone`). What is left is a scatter of sparks
concentrated in the upper-middle of the water, exactly where a real long-lens
shot of moonlight on the sea puts them.

## Knobs

Every number the study owns, resting value first. Every one is driven; see
`ALLOWED` in `registry.test.ts` for none, since this study has no static knob.

- `speed` 0.9: cells a second the camera flies, and through `waveRate` how
  fast the water's own clock runs. `pace` adds up to 2, `energy` (square
  root) up to 1.2, and tension takes it away (see below), with a floor so the
  water never fully stops.
- `swell` 0.25: how tall the long wave trains stand, 0 to 1 of
  `OCEAN_SWELL_HEIGHT`. `energy` (square root) and the packet's own `swell`
  row (a passage lifting) add to it.
- `chop` 0.22: how tall the short trains stand. `highMid`, `treble` and
  `energy` add to it, so the mids and the treble roughen the water.
- `path` 0.3: the width of the light path's lobe. `energy` widens it, and a
  bass hit (`bassPulse`, on an envelope) opens it briefly.
- `glints` 0.06: the width of the band of slopes that glint. `treble` and its
  pulse (on an envelope) drive it, so a hat becomes a scatter of sparks.
- `intensity` 2.2: the light of the glow before the parts scale it. Rests
  past 1 so the bloom catches the glints' cores, and gates to exactly 0 with
  `energy` inverted, which is the silence gate. Nothing raises it.
- `hue` 0: turns added to the key. `harmonicChange` and the packet's `swell`
  add to it.
- `horizon` 0.07: how far the horizon's glow reaches above the line, in
  half-heights. `energy` and a bass hit widen it.

Ranges are `OCEAN_RANGES` in `src/impls/ocean.params.ts`.

## What tension does

It drains and stills the sea, as the catalogue asks: speed, swell and chop
all lose a flat share and a further share scaled by how loud the passage is,
so a quiet build barely slows and a loud one flattens the water almost
completely, but never past zero (`speed`'s two tension rows are sized so the
worst real combination of energy and pace still leaves it at or above the kit
floor; `registry.test.ts`'s sweep and `ocean.test.ts` both hold this). The
packet's own `swell` row (a passage lifting) is what lets the water back in,
matching the catalogue's "build drains the water, drop lets it back."

## Sparse, and flash safe

`oceanCoverage` (the shader's arithmetic in TypeScript, sampled on a stride
across the frame) counts the pixels whose combined light, after Fresnel and
the fog, passes `OCEAN_LIT` (0.3). At the widest the mapping reaches (every
knob at its resolved maximum, no tension), on eight canvas shapes from
1920x1080 to 400x720, `ocean.params.test.ts` holds the share under a third
and `ocean.test.ts` holds the same for the study's own resolved knobs. At
rest the share is smaller again (also asserted). Nothing in the picture
toggles a large area from one frame to the next: every part is continuous
across the water's own motion, and the glint band is wide compared with a
frame's worth of travel, so there is nothing here for WCAG 2.3.1 to catch.

## Silence, presence and frame rate

`intensity` is the silence gate, exactly 0 at a silent packet
(`ocean.test.ts`); at presence 0 the renderer never calls the ink. The flight
and the water's own clock (`SeaClock`) both run while it is dark, CPU only,
and the ring's rows born in the meantime go up together on the first lit
frame, the same as the grid.

Everything is per second. `SeaClock.step` and `HeightRing.advance` both take
the real step and are proven the same at 30, 60, 144 and 240 steps a second
in `ocean.params.test.ts` (the surface at a point after the same seconds of
travel) and in `OceanInk.test.ts` (the GPU side, buffers and uploads).

## What the canvas does to it

The lesson from the grid holds here too, and shaped one design decision
directly (the glint distance windows above): the director's canvas keeps
about two thirds of a second of what was drawn, so anything that moves
leaves a trail in proportion to its own light and its own speed on screen. A
glint is deliberately a short, hard flash rather than a sustained light, so
its trail is a brief streak and reads as part of the shimmer rather than a
comet; a glint's total gain (`OCEAN_GAIN.glint`) is kept well under the
sheen's and the path's combined so the trails it leaves do not dominate the
frame between hats.

## Looked at

No GPU adapter was available to this session directly, so the study was
built and judged the way the catalogue allows a builder without one to: read
the canvas back in a headless browser (headless Edge, WebGPU, the NVIDIA
Blackwell adapter this repo has used before) and measure it, on real music
and not only synthetic packets.

Solo (`solo:ocean`) on Emancipator's "Baralku" (ambient/downtempo, the
study's home), quiet passage at 0:35 and louder passage at 1:20 and 2:05,
960x1380 crop of the canvas:

| passage      | share over 0.3 (luma) | share over 0.8 | mean saturation, lit pixels | share under 0.02 (near black) |
| ------------ | --------------------- | -------------- | --------------------------- | ----------------------------- |
| 0:35 (quiet) | 9.4%                  | 0.04%          | 0.42                        | 52.0%                         |
| 1:20 (build) | 7.6%                  | 0.04%          | 0.43                        | 57.9%                         |
| 2:05 (later) | 7.3%                  | 0.04%          | 0.45                        | 60.6%                         |

And on the demo's own loud dance track ("Ecstasy Of Soul", well outside the
study's home, to see it does not wash out on music it was never tuned for):
0:25 reads 4.3% over 0.3 and 63.6% near black; 1:45 (a louder passage) reads
8.5% over 0.3 and 57.6% near black. In every case the bright share stays a
small fraction of the frame and well under the catalogue's ceiling of a
third, black holds through the sky and above half the frame stays near it,
and the console showed no WGSL or validation message across all of these.
What was not looked at: a real GPU adapter reached directly from this
session (the headless-browser measurement stood in for it), a drop-shaped
passage on a track that has one, or a display slower than 60 frames a second.

Against the references in "What the references do": the light path breaks up
into a scatter rather than a solid beam, and is visibly wider on the louder,
choppier passages; the horizon reads as a glow with a small hot light in it
and the sky above is true black; the water under the camera stays close to
black while the water toward the horizon carries the colour, which is
Fresnel doing its job rather than a gradient painted on. What is weaker than
the references: at typical demo viewing distance the sparkle reads more as a
dense shimmer than as individually countable glints, which is the trade the
sparseness ceiling asks for; a wider glint band would make single sparks more
legible but push the lit share up.
