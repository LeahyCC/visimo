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

The light is a key light up and to the left, and two rim lights behind at 45
degrees either side. The key's colour is the palette showing at the song's key,
as every other ink takes it; the rims' is a third of a turn on round the same
palette. The key shapes the form and casts a soft self-shadow, the rims draw
the outline, a fresnel term gathers them at the silhouette, and a tight
specular passes 1 on purpose so the bloom catches it. There is no ambient
light: a face that points at nothing is black, and that is what makes a solid
read as a solid.

## Knobs

Every number the study owns, resting value first:

- `size` 0.5: the bounding radius in world units. The bass swells it through a
  `spring` at 3.2 Hz damped at 0.55 (+0.18), and tension shrinks it (-0.18).
- `ripple` 0.012: a displacement of the surface in world units. `highMid`
  raises it through an `envelope`, 40 ms up and 420 down (+0.035).
- `rippleScale` 9: waves of that ripple across a world unit. `pace` adds 2.
- `spin` 0: turns about the vertical axis, an `integrate` of `energy` at 0.22
  turns a second, wrapping at a turn, with tension adding another 0.25.
- `tumble` 0: turns about the horizontal axis, an `integrate` of `swell` at
  0.08 turns a second.
- `rim` 0.35: how much light the two rims carry above their base, and how wide
  the band they gather in is. `energy` opens it (+0.25 through a square root)
  and `impact` throws it wide (+0.3).
- `specular` 1.4: the highlight's strength. `hardness` sharpens it (+0.6).
- `hue` 0: where on the palette the key light sits, as an offset from the
  song's key, which `keyHue` moves with the music.
- `intensity` 0.05: the last multiply on the colour. See the light budget.
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
frame adds, so the first version of this study, written at the intensity an ink
with no canvas would use, pinned its whole silhouette at the canvas's ceiling
inside a second: a white blob with a magenta halo and no modelling left in it.
That is Melt's fault at a twentieth of the size, and the measurements are in
the bench.

Two numbers fix it, and they were found by looking at the study soloed over a
synthetic groove at 2560 by 1440:

- **`intensity` rests at 0.05**, not the 0.9 an uncarried ink would want. The
  lit half then settles near a third of the ceiling, the terminator survives as
  a gradient rather than clipping flat, and the specular still passes it, so
  the highlight is the thing that blooms.
- **`MORPH_CUT` is 0.35** (`impls/morph.params.ts`), so the resting `glint` of
  0.4 cuts at 0.14 of the brightest the ink can be. The peak counts the
  specular and both rims on top of a lit face, so a lit face is about a quarter
  of it: the cut lands under one and over the near-black fill. At the 0.8 a
  full packet resolves, the cut lands at 0.28, over a lit face, and what
  survives is the rim, the specular and the brightest facets. The loudest
  moment is the one with the most black in it.

The third number is the spin. At a tenth of the rate it now runs at, the canvas
is handed the same silhouette every frame and sums it into a flat disc; at 0.22
turns a second a facet sweeps out of its own trail and the memory reads as a
sculpted smear behind a turning solid. A sphere is the one form with nothing to
sweep, and it is the one form this looks weakest on.

## Sparse by construction

Every form is written to one bounding radius and the camera does not move, so
the share of the frame the solid can cover is arithmetic rather than a raster
(`morphCoverage`): the disc that radius subtends, with the ripple added to it
because a crest is the furthest the surface reaches. It is a ceiling twice
over, since a torus is mostly hole and the threshold then drops whatever is not
brightly lit.

| moment                          | size | 16:9 | square |
| ------------------------------- | ---- | ---- | ------ |
| a groove (every row at 0.3)     | 0.55 | 3.4% | 6.1%   |
| a full packet, nothing wound up | 0.68 | 5.2% | 9.3%   |
| a full packet at full tension   | 0.50 | 2.9% | 5.2%   |

A square canvas is the worst shape, because the camera's field of view is
across the short side, so the same solid is a larger share of a frame that is
not wide. `studies/shapeMorph.test.ts` holds it under a tenth on eight shapes
of canvas including a square and a tall one.

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

Measured through headless Edge on an RTX 5080, at 2560 by 1440 with the march
at half of it (1280 by 720):

- The ink's own two passes, timed over 120 frames with the queue drained
  against the same run without them: **about 0.1 ms a frame**. At full size
  rather than half it is about 0.2 ms.
- In the demo's bench, soloed at 2240 by 1440 with the feedback, the bloom, the
  split and the tonemap live, the frame time does not move when the study is
  switched on: 5.6 ms either way, which is the rest of the loop.

Most rays never hit anything. The solid is bounded, so the march has a far
plane of its own and a ray that misses leaves after a handful of steps; the
budget of 96 is what a ray grazing the silhouette spends. It is still declared
`heavy`, because a march is heavy on a weaker adapter and the director's budget
is not written for one GPU.

No WGSL message and no validation message appears in the console, at any of the
four moments looked at.

## Looked at

In the bench, soloed under Hard clean, at 2240 by 1440, over a synthetic beat:
a quiet passage (level 0.18), a groove (0.6), a build (0.6 with tension at 0.9)
and a drop (0.95 with release at 0.9). The quiet and the groove read as a lit
solid with a clean terminator falling to black, a coloured rim on two edges and
a specular; the build is visibly smaller and turning faster; the drop keeps
only the lit cap, the rim and the highlight, and the rest of the frame is
black.

The forms other than the sphere were looked at through a harness that renders
the shader on the adapter and models the canvas's memory on the CPU, because
the bench's synthetic packet never changes `section` and so never leaves the
form the first hash gives it. That is worth fixing in the bench one day; it is
not this study's file to change.

One thing seen while looking, which is not this study's: with the study at
presence 0 and nothing else drawing, a single green texel sits at the exact
centre of the canvas, and the bloom and the split turn it into a coloured cross
once anything bright is on screen. It is there with the ink off, so it belongs
to the stack or the canvas rather than here.
