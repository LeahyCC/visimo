# chord-petals

A flower of twelve petals round the middle, one per note, in circle-of-fifths
order. The notes sounding are the petals lit: a chord is a cluster of light, a
chord change is one cluster easing out as the next blooms, and a key change
turns the whole flower to a new note at the top.

This file is the plan and the record. It is written first and updated in the
same push as any change of plan.

## What it was built to look like

The first study built from this catalogue drew one palette colour and dimmed
when the music got loud, and had to be redone. So before any shader there were
three photographs, and what struck about each is what this is built to. All
three are on Wikimedia Commons; they were looked at and not copied.

- **A daisy lit from behind** ("Flower, backlit", CC BY 2.0). A hard dark
  silhouette against a glowing sky, and every petal is bright where the light
  comes through it and darkest where it is thickest, with a bright edge along
  the outline. Petals overlap at the base and the light adds where they do.
  The dark disc in the middle is what makes the ring of petals read as light.
- **A dandelion clock** ("Transparent Flower", CC BY-SA 3.0). Everything is fine
  radial spokes ending in a point of light, and the whole flower is empty space
  held together by a hub. It is striking because there is so little of it: the
  black between the spokes is most of the picture.
- **The rose window of a cathedral** (National Cathedral, Washington, CC BY-SA
  2.0). Twelve-fold petals and rings of them, each cell its own saturated
  jewel colour, black leading between, and the whole thing glowing against a
  dark wall. The colour lives only in the light that comes through; nothing is
  painted.

What that comes to, and what the shader does about it:

1. **Light through, not paint on.** A petal is a dim translucent body with a
   bright rim round its outline and a point of light gathered at its tip. The
   rim is the only light past 1, so the bloom finds the outline and leaves the
   fill alone. Not a flat filled polygon.
2. **A colour of its own for each petal.** Twelve notes are twelve saturated
   hues, the note's place on the circle of fifths as a place on the colour
   wheel, so neighbours that sound well together are neighbours in colour, and
   a chord is three distinct colours. The whole wheel turns with `keyHue`. The
   shared palette is not used.
3. **Black between.** Petals are separate shapes with gaps at the default
   width, and nothing is drawn for a note that is not sounding. The first cut
   at a translucent body filled the frame with a red and blue fog and lost
   this; see "What the first look on screen changed".
4. **A dark hub with a bright ring**, the way the daisy's disc anchors it.
5. **Overlap adds.** Two petals crossing are brighter where they cross, the way
   the daisy's petals are where their bases overlap.

## What it draws

One fullscreen pass. For each pixel the shader stops at once if it is outside
the flower's radius and a few glow widths, and otherwise walks the twelve petals
of two whorls: the notes, and a second smaller whorl half a step behind that
comes up with the level. Each petal is an outline `h(t) = halfWidth x
sin(pi t^1.4)^0.85` along its length, fullest about three fifths of the way to
the tip and pointed at it. The light is the body inside the outline, the rim
along it, brightest at the tip, and a halo outside. Petals sum. The arithmetic
is `petalLight` in `src/impls/petals.params.ts`, the shader is a transcription
of it and the tests measure the TypeScript.

The twelve petals stand in circle-of-fifths order, so C is next to G and F, and
the notes of a chord sit together. The flower is turned so the key's own note is
at the top: a petal's angle is its place on the circle less `keyHue`, so a
modulation is the whole flower turning to the new note over the seconds the key
takes to move, and the same chord in any key is the same shape at the top.

## Knobs

Every number the study owns, resting value first:

- `note0` to `note11` 0: how lit each petal is. Each is fed by its own packet
  row, `chroma0` to `chroma11`, through an `envelope` shape with a 40 ms attack
  and a 900 ms release, so a chord blooms in a blink and is 30 percent of itself
  a second after it stops and nearly gone after three. Longer than the
  extractor's own release on purpose: one chord is still fading when the next is
  up, and the two are seen at once. A lit note is a longer petal and a brighter
  one.
- `open` 0.5: from a bud to full bloom. `release` adds 0.3 and `impact` adds
  0.35 through a 25 ms attack and a 900 ms release, so the drop throws it open
  and it settles over a second; `tension` takes 0.5 off, so a full build is 0.
- `size` 0.36: the radius as a share of the short side. `beatPulse` adds 0.05
  through a 10 ms attack and a 250 ms release, so the flower swells on the beat.
- `width` 0.75: how fat a petal is. `lowEnd` adds 0.15 and `harmonicChange` 0.1.
  At 1 neighbours touch.
- `layer` 0.1: how far the second whorl has come up. `energy` adds 0.8 through
  a square root, so a loud passage doubles the number of petals a lit note has;
  `tension` takes it back to 0.
- `glow` 10: the halo's width in pixels at 1080 high. `bassPulse` adds 12
  through a 5 ms attack and a 300 ms release and `energy` 8, so a kick opens the
  light round every petal; `tension` takes 3 off.
- `intensity` 1.3: the light. `tension` takes 0.12 off. Nothing raises it.
- `turn` 0: the flower's angle in turns, moved by two `integrate` rows that wrap
  at a turn. `energy` at 0.02 turns a second and `bassPulse` at 0.03, so a loud
  passage turns it once in about half a minute, a quiet one in a couple of
  minutes, and the bass nudges it on the beat. Silence holds it where it is. The
  ink wraps the sum, since two rows can add to more than a turn.

Ranges for all of them are `PETAL_RANGES` in `src/impls/petals.params.ts`.

## What tension does

Tension closes the flower to a bud. At full tension `open` is 0, so every petal
is 35 percent of its length and stands close to the hub, `layer` is 0, so the
second whorl is gone, the halo is 3 px tighter and the light is 0.12 down: a
build is a flower holding its breath and not a brighter one. A test shows each
knob move and a longer-petal-versus-bud coverage comparison. The drop lets it
go: `release` and `impact` open it wider than it rests.

## Sparse by construction, and flash safe

Measured by `petalsCoverage` on a grid, counting every pixel above 5 percent of
a petal's body once, at the top of every row that adds to the shape (`open` 1,
`size` 0.41, `width` 1, `layer` 0.9, `glow` 30):

| notes lit                  | 16:9 | square | tall |
| -------------------------- | ---- | ------ | ---- |
| a triad, at rest           | 2%   | 3%     | 2%   |
| a triad, loud              | 7%   | 12%    | 7%   |
| seven notes, a scale, loud | 15%  | 27%    | 15%  |
| all twelve at once, loud   | 25%  | 44%    | 25%  |

All twelve at once is a ceiling and not a case: the extractor's note rows are
gated on how far the strongest note stands out of the rest, so a flat chroma
lights none of them. A square frame is the same flower over less frame. Tests
hold each of these.

That is also the flash statement for WCAG 2.3.1. The light is a bounded shape at
the middle of the frame, a petal cannot change faster than its 40 ms attack and
900 ms release, the flower grows and eases over a second and never blinks, and
nothing toggles a large area of luminance on or off, so there is no strobe in
the construction.

## Silence, presence and frame rate

A packet with no note in it has all twelve note knobs at 0, and a flower with no
note lit encodes no pass and uploads nothing: that is the silence gate. It is
also what drums alone do, since the extractor reads no chord in them, which is
right for a study that is about harmony. Presence 0 does the same.

There is no clock. The angle is a knob the study integrates per second, and the
envelopes are the shapes' own, so the same song at 30, 60 and 144 frames a
second gives the same flower; a test resolves the study at all three.

WebGL2 cannot draw this study and skips it, as it skips every ink but the
fractal; the renderer never builds it on that path, so it does not throw.

## Cost

`cheap`: one fullscreen triangle, one 64 float uniform made once, and a bounded
loop in the fragment stage over at most twelve petals of two whorls. Pixels
outside the flower's disc return at once. There is no texture, no buffer and no
compute. On the RTX 5080 at 2560 by 1440 with all twelve notes held, the
bench's frame meter reads 1.09 ms against 1.00 for the same frame with nothing
lit, and 1.22 for lasers and for the halo. The meter has 0.1 ms of resolution
and is a frame interval and not a GPU timestamp, so all that can be said is that
the cost is below what it can see; a real number wants timestamp queries.

## Where it belongs

Tonal music that is soft to mid in how it hits: jazz, classical, soul, pop. Its
home is a tonality of 0.85 and a hardness of 0.1 with the middle of the other
three axes, and a reach of 0.4, so any drive and any steadiness is welcome. On
the twenty tracks in `director/tracks.fixture.ts` that is a closeness of 0.7 to
0.96 for the ambient, downtempo, acoustic, folk rock, pop, jam and IDM tracks,
and 0.28 to 0.38 for the metal, metalcore, drum and bass, dubstep and house
ones, where it is out-ranked. Moments: intro 0.8, groove 1, rest 0.8, build 0.4,
drop 0 and outro 0.

## What the first look on screen changed

Checked on the adapter with the bench's synthetic packet, which plays C, G, A
minor and F a bar each, and by hand with a chord held.

The first build gave the body half the rim's light and the halo almost as much,
and on screen it was an outline in a fog: a red and blue haze the size of the
flower with no black left between the petals. The cause is the canvas. It keeps
0.975 of itself a frame, so a petal that holds a chord holds still, and a still
light settles at about forty times what one frame adds. A body at half the rim
does not read as a fill, it builds to a cloud. The body and the halo are now a
tenth and a twentieth of the rim (`BODY` 0.1, `HALO` 0.06, `RIM` 1.6), the fresh
light is thin, and the canvas is what fills it in: on screen each petal has its
own saturated colour, a bright pale rim, and black between.

Two things in the frames that are not this study's. A small green mark at the
exact centre of the flower shows with the halo ink as well, so it is the
canvas's zoom point and not the petals. And with a flow in the cast the
light is carried up and out of the flower in a flame-like trail, which is the
canvas doing what it is for.

## Not yet done

The note rows were tuned on synthetic chords, and this has not been played over
a real recording: a voice with vibrato or a distorted guitar will read
differently, and the intensity, the envelope times and the size want a look at a
quiet passage, a build and a drop of a real tonal track, on the adapter.
