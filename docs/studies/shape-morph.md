# shape-morph

One solid in the middle of the frame that turns and melts from form to form. A
sphere becomes an octahedron becomes a torus, a form for each section of the
song, lit by two coloured lights on a black frame, breathing with the bass and
rippling with the mids.

This file is the plan and the record. It is written first and updated in the
same push as any change of plan.

## What it is built to

Three references, and what each one gives the study.

**Studio rim lighting with colour gels** (Brian McNamara,
[Rim Lights & Color Gels](https://brian-mcnamara.com/studio-lighting-tutorial-rim-lights-color-gels)).
A black background, a gelled key that shapes the subject and a pair of gelled
strip lights at 45 degrees behind it that draw the edges. What makes it
striking is the restraint: nothing fills in the shadows, so most of the frame
is black and the subject reads entirely from one lit side and two coloured
edges. The photographer's own words are that he wanted "a black background and
plenty of shadows", and that for separating a subject from it "there's no
better way than with some rim light". That is the whole lighting model here: a
key in one palette hue, a pair of rims in another a third of a turn away, no
ambient at all, and a frame that stays black. It also settled a mistake the
first cut made, which was one rim light straight behind: a face pointing away
from the camera is never drawn, so a light directly behind reaches nothing that
can be seen, and the pair at 45 degrees is what draws an outline all the way
round a faceted form.

**Quilez on the smooth minimum**
([iquilezles.org/articles/smin](https://iquilezles.org/articles/smin)). The
quadratic polynomial `smin` blends two distance fields over a band of a stated
width and leaves them exactly alone outside it. What is striking about the look
it gives is that the joint reads as material: two shapes meeting are welded
with a fillet, not cross-faded, so the eye reads one object rather than two
pictures. It also states the price, which is the part worth respecting: it
under-estimates the distance outside the band, so a march over it has to step
short. The melt here is a mix of the two fields with a weld folded in across
the middle of it, for exactly that reason: a cross-fade of two solids is two
ghosts, and a weld is one solid growing out of another.

**Shadertoy's SDF morphs**, of which
[Morphing with SDF](https://www.shadertoy.com/view/3sSGDz) is the plainest:
the shapes are never modelled, only measured, so interpolating the measurement
turns one into the other for nothing. The striking part is how much character
survives the interpolation: at a quarter of the way the box is still a box with
a swollen middle. What those shaders do not have to deal with, and this does,
is a canvas that remembers: see the light budget below.

The form of the primitives themselves is Quilez's
[distance functions](https://iquilezles.org/articles/distfunctions) list, which
is what `shaders/raymarch.common.wgsl` transcribes.

## What it draws

The raymarch kit (`impls/RaymarchInk.ts`, `shaders/raymarch.common.wgsl`)
marches the frame at half size and scales the result up into the shared ink
target. What this study adds is the solid and the light on it.

```text
section id ──► a form          ┐
last form  ──► a form          ├─► mix the two distance fields, weld the middle
melt over 2.2 s, or a cut on impact ┘
                     │
      turn it (spin, tumble) ─► ripple its surface ─► march ─► light it ─► cut it
```

Six forms: sphere, rounded box, octahedron, torus, capsule, box. Every one is
written to the same bounding radius, so a melt does not change how much of the
frame is filled. Which form a section gets is a hash of the packet's `section`
id, so the same track draws the same run of solids every time it is played, and
a form is never the one already showing.

The melt is two things at once. Mixing the two distances walks one form into
the other and is exactly each of them at the ends; smooth-unioning them holds
both at once with a soft weld between. The weld's weight peaks in the middle of
the melt and falls to nothing at either end.

The one thing that is not a melt is the drop. `impact` cuts to the next form on
the frame it fires, with the same hysteresis the shards read it with, so one
drop is one cut however long the row takes to fall.

The light is a key up and to the left and two rims behind at 45 degrees either
side, and there is no fill: a face pointing at neither is black, which is what
makes a solid read as a solid.

Both colours are lights and not pigments. The hue is the palette's at the
song's key, so the picture still turns with the music and with the look's
palette, and everything else about the colour is the light's own: one
lightness, the chroma pushed to the edge of what the screen can show, and the
rims a third of the hue circle on from the key. The first cut read two places
on the palette's ring instead, which on a designed ring can be the same hue
again a little darker, and a solid lit by two of those reads as one washed-out
colour. Only the specular goes near white; the two colours are added and never
mixed, so neither hue is diluted by the other.

The light is split three ways on purpose, and the split is what the canvas
sees:

```text
body     diffuse x shade x occlusion, a twelfth of the edge   a faint haze
wrap     the rims reaching round the terminator               a coloured dark side
outline  a fresnel edge, the brightest but the highlight      a bright line
specular tight, passes 1                                      a flash the bloom takes
```

## Knobs

Every number the study owns, resting value first:

- `size` 0.55: the bounding radius in world units, which is about half the
  short side of the frame across. The bass swells it through a `spring` at
  3.2 Hz damped at 0.55 (+0.18), and tension shrinks it (-0.18).
- `ripple` 0.012: a displacement of the surface in world units. `highMid`
  raises it through an `envelope`, 40 ms up and 420 down (+0.035).
- `rippleScale` 9: waves of that ripple across a world unit. `pace` adds 2.
- `spin` 0: turns about the vertical axis, an `integrate` of `energy` at 0.22
  turns a second, wrapping at a turn, with tension adding another 0.25.
- `tumble` 0: turns about the horizontal axis, an `integrate` of `swell` at
  0.08 turns a second.
- `rim` 0.35: how much light the fresnel outline carries above `RIM_BASE`, and
  how wide the band it gathers in is. `energy` opens it (+0.25 through a square
  root) and `impact` throws it wide (+0.3).
- `specular` 1.4: the highlight's strength. `hardness` sharpens it (+0.6).
- `hue` 0: where on the palette the key light's hue is taken from, as an offset
  from the song's key, which `keyHue` moves with the music.
- `intensity` 0.06: the last multiply on the colour. See the light budget.
- `glint` 0.4: the share of the frame's own brightest that light must clear to
  be drawn at all. `energy` (+0.25) and `release` (+0.15) raise it.
- `glintKnee` 0.45: how soft that edge is, as a share of the level. A harder
  track gets a crisper cut (`hardness` through `invert`, -0.12).

## What tension does

The catalogue's entry is "the form shrinks and spins up", and that is what the
two tension rows do: 0.18 off the size, which is more than a third of it, and
another quarter turn a second on the spin. Nothing about the light moves with
tension, so a build is a smaller, faster solid and not a brighter one.

## The light budget, which is most of the tuning

A solid sits still in the middle of a canvas that keeps 0.975 of itself every
frame. A pixel it lights every frame settles at about forty times what one
frame adds, and that one fact decides nearly every number here.

The first cut got it wrong twice, in opposite directions, and the second was
the one that showed. Written at the intensity an ink with no canvas would use,
it pinned its whole silhouette at the ceiling inside a second and drew a white
blob. Pulling the light down fixed that and left a new problem: the threshold
had been raised to carve the body away, so what reached the canvas was a lit
cap about a sixth of the frame tall, soft edged and low in saturation, which is
what the lead saw and sent back.

What it is now:

- **The body is a twelfth of the edge** (`BODY` is 0.08 against a rim carrying
  0.82 to 1.5). A lit face covers a large part of the frame and barely moves
  while the solid turns, so it is the one term that can sum into a flat mass;
  the outline and the highlight are thin and sweep across the frame, so they
  streak instead. At a groove the body settles near 0.17 of the canvas's
  ceiling and the edge clips it, which is the long exposure of a lit wireframe
  the study is after.
- **`intensity` rests at 0.06**, and the gate row takes it to 0.036 in near
  silence.
- **`MORPH_CUT` is 0.015**, so the resting `glint` of 0.4 cuts at about a fifth
  of a lit face rather than through it. The whole lit side passes; what the
  threshold takes is the fringe and the near-black, which is all it needs to
  take, because a solid is already sparse by having a dark side.
- **It marches at the ink target's own size**, not the kit's half. A bilinear
  upscale of a thin bright outline is a soft one, and this study is read by its
  edges. It costs 0.2 ms rather than 0.09.

## How much of the frame it takes

Every form is written to one bounding radius and the camera does not move, so
the disc the solid subtends is arithmetic rather than a raster
(`morphCoverage`), with the ripple added to the radius because a crest is the
furthest the surface reaches.

| moment                          | size | across the short side | the disc, 16:9 |
| ------------------------------- | ---- | --------------------- | -------------- |
| a groove (every row at 0.3)     | 0.60 | 56%                   | 14.0%          |
| a full packet, nothing wound up | 0.73 | 69%                   | 20.8%          |
| a full packet at full tension   | 0.55 | 53%                   | 12.2%          |

The disc is a ceiling three times over. A form is not a disc, a torus is mostly
hole, and what fills the outline is the body term, which is a twelfth of what
the edge carries. Rendered against the canvas the director builds and measured
on the adapter, the share of the frame over a tenth of the ceiling's brightness
is about 9 percent at a groove.

There is no flash in the construction: nothing toggles a large area on or off,
the solid's light is continuous in the size, the turn and the level, and the
one event it reads, `impact`, changes which form is drawn and not how much
light there is.

## Silence, presence and frame rate

A silent packet draws nothing at all: under `SILENT_FLOOR` (an `energy` of
0.004) the ink writes no uniform and encodes no pass, and between there and
0.045 the light ramps in, so the first bar of a track brings the solid up
rather than switching it on. At presence 0 the renderer never calls it.

The melt is the only thing it adds up, and it is advanced by the real `dt` over
a span in seconds, so 30, 60 and 144 frames a second show the same solid at the
same moment of the song. The turning is not kept by the ink at all: it is two
`integrate` rows in the mapping, which the resolver steps. The melt is stepped
even on a frame that draws nothing, so a section that turned over during a
quiet bar has already landed when the music comes back.

## Cost

Measured through headless Edge on an RTX 5080, at 2560 by 1440, marched at the
same size:

- The ink's own two passes, timed over 120 frames with the queue drained
  against the same run without them: **about 0.2 ms a frame**. At half size it
  is 0.09 ms, which is what the kit's default would cost and is not worth the
  softer edges.
- In the demo, soloed under Clean glass with Curl drift beneath it, playing the
  reference track at 2560 by 1440 in full view, `data-frame-ms` reads 5.6 ms,
  which is what the same cast reads with the study switched off.

Most rays never hit anything. The solid is bounded, so the march has a far
plane of its own and a ray that misses leaves after a handful of steps; the
budget of 96 is what a ray grazing the silhouette spends. It is still declared
`heavy`, because a march is heavy on a weaker adapter and the director's budget
is not written for one GPU. It sets no `maxFps` for the same measurement: the
renderer takes the lowest cap among the live inks, and one here would hold a
whole cast to 60 for an ink that costs a fifth of a millisecond.

## Looked at

On the reference track (`Ecstasy Of Soul`), in the cast the lead used: Curl
drift under it, Clean glass over it, at 2560 by 1440 in full view, in headless
Edge on the real adapter, at a quiet passage (30 s) and through the loud one
after the first drop (108 s).

At the quiet passage the section's form is a capsule, about 60 percent of the
short side tall. It reads as a lit object: a magenta outline down both sides
where the rims gather at the silhouette, a blue body with the terminator
falling through it, two white specular flashes on the near shoulder, and black
everywhere outside it. The trail is a soft second copy of the outline, lifted
and bent by the flow, which is the long exposure the references describe.

At the loud passage the form is an octahedron, and the facets read: three
planes at three different values, magenta edges between them, a hot specular
crossing one plane, and a smoke trail drawn upward by the curl. The two hues
are clearly two hues rather than one family, which was the point of taking the
light's colour from the key's hue and turning the rim a third of the circle
rather than reading the palette's ring twice.

Against the references: the McNamara setup is there (a key that shapes, a pair
of rims that outline, nothing filling the shadows, a black frame), the weld
from the Quilez article shows through the middle of a melt, and the Shadertoy
morphs' point, that character survives the interpolation, holds because the mix
is welded rather than cross-faded. What those references do not have is the
canvas's memory, and that is still the thing this study is tuned around.

No WGSL message and no validation message appears in the console at either
passage.

The forms other than the two the track happened to draw were looked at through
a harness that renders the shader on the adapter and models the canvas's memory
on the CPU, because the bench's synthetic packet never changes `section` and so
never leaves the form the first hash gives it. That is worth fixing in the
bench one day; it is not this study's file to change.

One thing seen while looking, which is not this study's: with the study at
presence 0 and nothing else drawing, a single green texel sits at the exact
centre of the canvas, and the bloom and the split turn it into a coloured cross
once anything bright is on screen. It is there with the ink off, so it belongs
to the stack or the canvas rather than here.
