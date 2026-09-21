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

The light is a key up, well to the left and a little behind the plane the
solid sits in, and two rims behind it at 45 degrees either side. There is no
fill. That last number on the key is the one that decides whether this reads
as a solid at all: with the light in front of that plane every surface facing
the camera is lit, which is most of what can be seen, and the picture is flat.
Behind it, the terminator crosses the solid and about a third of the
silhouette falls to nothing.

Both colours are lights and not pigments. Each takes its hue from the palette
at the song's key, so the picture still turns with the music and with the
look's palette, and nothing else about the colour comes from the palette: the
dimmest channel goes to nothing and the brightest to 1, so what lands on the
solid is the hue at full saturation and full value. The rims sit a third of
the hue circle away from the key. The first cut read two places on the
palette's ring instead, which on a designed ring can be the same hue again a
little darker, and a solid lit by two of those reads as one washed-out colour.

The light is three terms, and each has one job:

```text
body      a hard terminator, then a gradient from half to full     the lit side
outline   a fresnel band over the outer 12 to 18 percent, over 1   the form's edge
specular  tight, passes 1                                          two white dots
```

The body gives the edge up to the outline: a surface seen at a grazing angle
reflects rather than scatters, so the diffuse is dimmed exactly where the
fresnel band rises. That is what stops the two hues mixing into one along the
edge, and it is what a real surface does.

A faceted form is shaded from the face's own normal. The ripple displaces the
surface, which moves the silhouette, but the shading normal is taken from the
solid without it, so a box shows three flat steps of brightness rather than
three gradients with a ripple crawling over them.

## Knobs

Every number the study owns, resting value first:

- `size` 0.55: the bounding radius in world units, which is about half the
  short side of the frame across. The bass swells it through a `spring` at
  3.2 Hz damped at 0.55 (+0.18), and tension shrinks it (-0.18).
- `ripple` 0.012: a displacement of the surface in world units. `highMid`
  raises it through an `envelope`, 40 ms up and 420 down (+0.035).
- `rippleScale` 9: waves of that ripple across a world unit. `pace` adds 2.
- `spin` 0: turns about the vertical axis, an `integrate` of `energy` at 0.04
  turns a second, wrapping at a turn, with tension adding another 0.06.
- `tumble` 0: turns about the horizontal axis, an `integrate` of `swell` at
  0.015 turns a second.
- `rim` 0.35: how much light the fresnel outline carries above `RIM_BASE`, and
  how wide the band is. `energy` opens it (+0.25 through a square root) and
  `impact` throws it wide (+0.3).
- `specular` 1.4: the highlight's strength. `hardness` sharpens it (+0.6).
- `hue` 0: where on the palette the key light's hue is taken from, as an offset
  from the song's key, which `keyHue` moves with the music.
- `intensity` 0.026: the last multiply on the colour. See the light budget.
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
frame adds, and that one fact decides nearly every number here. Three cuts of
this study got it wrong in three different ways, all of them measurable:

1. Written at the intensity an ink with no canvas would use, the whole
   silhouette pinned at the ceiling inside a second and drew a white blob.
2. Pulling the light down fixed that and left the threshold carving the body
   away, which drew a dark ball with a dim rim: on the adapter, under 3 percent
   of the silhouette was over 0.3.
3. Letting the diffuse through whole but holding it to a twelfth of the edge
   left the lit side invisible again.

What it is now:

- **The terminator does the work the threshold was doing.** The lit side is lit
  whole, from half value at the edge of the light to full square to it, and the
  dark side is exactly nothing. A lit solid is sparse by having a dark side.
- **The threshold cuts at a twentieth of a lit face** (`MORPH_CUT` is 0.02, so
  the resting `glint` of 0.4 lands there). It clears the fringe under the
  terminator and nothing else.
- **`intensity` rests at 0.026**, which puts the lit side across the middle of
  the range once the canvas has summed it rather than flat at the ceiling.
- **The spin is 0.032 turns a second at a loud passage.** The canvas remembers
  for seconds, so a solid that turns quickly lights its own dark side with what
  it lit a moment ago. Measured: at 0.176 turns a second the dark side of a
  faceted form is 1 percent of the silhouette, at 0.05 it is 6, at 0.032 it is
  19, and at 0.012 it is 36. The study takes 0.032 as the trade between a solid
  that turns and a solid with a dark side.
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

The disc is a ceiling twice over: a form is not a disc, and about a third of
what is inside it is the dark side, which adds no light at all. Rendered
against the canvas the director builds and measured on the adapter, the solid
itself covers 8 to 18 percent of the frame depending on the form, and 98 to 99
percent of everything outside it is under 0.02, trails included.

There is no flash in the construction: nothing toggles a large area on or off,
the solid's light is continuous in the size, the turn and the level, and the
one event it reads, `impact`, changes which form is drawn and not how much
light there is.

## Where it sits

A drive of 0.58, steady at 0.7, hard at 0.6, no opinion about tonality, and a
reach of 0.4. Of the twenty measured tracks that is nearest John Summit's tech
house, Pendulum and Subtronics, and a third of that or less on the folk, the
orchestral cue and the ambient pieces.

The reach was 0.35, which is what the card asked for, and at 0.35 the study
was never cast at all: it came third on its best track, behind the spectrum
ring and the beat rings, and by the time a heavy ink was considered for the
second slot the budget had gone on two cheap ones. 0.4 is the smallest number
that wins it a seat, and `director/fairness.test.ts` is what says so.

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

## Measured

Rendered on the adapter in headless Edge, at the numbers the study resolves at
a loud passage, with the canvas the director builds modelled as the post stack
applies it (0.975 kept a frame, the soft ceiling, the hold at 0.13) and the
composite's own tonemap over it. The silhouette is the alpha channel the
shader writes, which the ink blend discards, so the counts are over the solid
and not over a guess at where it is; each figure is the mean over thirteen
poses across ten seconds.

| target                               | sphere | rounded box | octahedron | torus | capsule |
| ------------------------------------ | ------ | ----------- | ---------- | ----- | ------- |
| over 0.3 inside, want 40%            | 57%    | 60%         | 61%        | 56%   | 68%     |
| over 0.8 inside, want 10%            | 12%    | 8%          | 11%        | 9%    | 11%     |
| dark inside, want about a third      | 39%    | 23%         | 19%        | 19%   | 23%     |
| dark outside, want 85%               | 99%    | 99%         | 98%        | 99%   | 99%     |
| hue gap lit to rim, want 90 degrees  | 120    | 115         | 113        | 121   | 119     |
| saturation of the lit side, want 0.7 | 0.92   | 0.92        | 0.82       | 0.90  | 0.93    |

Four of the five hold on every form. The dark side holds on a smooth one and
falls short on a faceted one, and the reason is the canvas rather than the
light: in the ink's own frame, before anything is carried, the dark side is 38
to 46 percent of the silhouette on every form. A facet swaps between lit and
dark as the solid turns, and the canvas keeps what it lit for about two and a
half seconds, so the dark side carries the last pose's light. Slowing the turn
recovers it (36 percent at 0.012 turns a second) at the cost of the motion;
0.032 is where this sits.

At a quiet passage the same sphere reads 56 percent over 0.3, 6 percent over
0.8, 40 percent dark, a hue gap of 120 degrees and a saturation of 0.93. It is
dimmer, which is what a quiet passage should be.

## Each form, from one frame

- **Sphere**: a cyan lit half, a hard terminator through the middle, a black
  dark half and a magenta rim right round. Recognisable.
- **Rounded box**: three faces at three values with softened corners, the rim
  running the near edges. Recognisable as a box with its corners taken off.
- **Octahedron**: a flat cyan facet, a black facet beside it, the rim drawing
  the diamond outline. Recognisable.
- **Torus**: the ring, the hole, the rim outlining both, the lit band across
  the upper right. Recognisable, and the most legible of the six.
- **Capsule**: two round ends and a straight body, cyan on the lit side and a
  magenta rim down the other. Recognisable.

## Looked at

On the reference track in the cast the lead used, Curl drift under it and
Clean glass over it, at 2560 by 1440 in full view, in headless Edge on the
real adapter, at a quiet passage (30 s) and through the loud one after the
first drop (108 s). No WGSL message and no validation message in the console
at either.

Against the references: the McNamara gel setup is what is on screen, a key
that shapes and rims that outline with nothing filling the shadows and a black
frame; the weld from the Quilez article shows through the middle of a melt;
and the Shadertoy morphs' point, that character survives the interpolation,
holds because the mix is welded rather than cross-faded. What none of those
references has is a canvas that remembers for seconds, and that is the thing
this study is tuned around.

The forms other than the two the track happened to draw were looked at through
the harness above, because the bench's synthetic packet never changes
`section` and so never leaves the form the first hash gives it. That is worth
fixing in the bench one day; it is not this study's file to change.

One thing seen while looking, which is not this study's: with the study at
presence 0 and nothing else drawing, a single green texel sits at the exact
centre of the canvas, and the bloom and the split turn it into a coloured
cross once anything bright is on screen. It is there with the ink off, so it
belongs to the stack or the canvas rather than here.
