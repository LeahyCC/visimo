# Lightning

The plan for the `lightning` study, written before the code. Update it in the
same push as any change of plan.

## What it draws

Branching bolts on the biggest hits. A bolt is a jagged main channel with two
to four levels of forked branches, drawn as thin additive line quads: near
white at the core, a saturated glow around it that turns with the key hue,
and true black on every side. A bolt lives about 80 ms and is gone; the
canvas's own long memory is what carries the afterglow, so the ink itself
never sums for longer than that.

A bolt starts at an edge or the centre, seeded per strike: a strike is built
on the CPU by midpoint displacement, and its every choice (which edge, which
direction, every midpoint offset, every branch point and angle) is a hash of
the section id and the strike count, never `Math.random`. The same song gives
the same bolts for as long as the ink lives.

## What the photographs teach

Three references stood out while picking the look:

- A night-sky shot of branching bolts over silhouetted trees (Unsplash,
  sCrqMG2f6qo): what makes it striking is the near-white core against a
  true-black sky, with the branches readable as structure, not glow.
- The storm photographers' consensus (Stu Short's guide): a successful bolt
  photo has a bright central channel with a colourful, vibrant aura, and the
  branches carry all manner of neighbouring hues, blues into violets. That is
  the fork hue step.
- The working advice repeated everywhere (Chris Bray, Gary Hart): it is all
  contrast. The darker the sky, the better the bolt stands out; cooler hues
  read better than warm ones; and the glow stays tight around the channel.

So: white core, one hard saturated colour that turns with the key, a small
step of hue per fork depth, zero light past the line's own reach, and a
palette of the ink's own rather than one borrowed from the ribbon.

## When it fires

Two ways in, and only two:

- `impact`, the one frame the drop lands, fires one bolt at full strength.
  Like the shards, a crossing with a hysteresis, and two impact bolts are at
  least half a second apart whatever fires `impact`.
- a strong hit in the low end or the mids (sub, bass, low mid, high mid) while
  `release` is still high fires one bolt at the hit's strength. A token bucket
  holds one strike and refills at the `rate` knob, capped at one and a half a
  second, so with the banked one no song can fire more than three bolts a
  second. That is the WCAG 2.3.1 line held by construction, the same way the
  shards hold it.

Nothing else fires. A groove, a build, an intro draw nothing at all: the pool
is empty, no buffer is uploaded, no pass is encoded. Silence is black because
there is nothing to fire and no standing light.

## Tension

Tension holds the study back so the drop lands. It takes the strike rate down,
the bolt length down a little, the life down a little and the intensity down
by 0.15, so through a build the bolts that do fire are fewer, shorter, briefer
and dimmer, and what they held back is released with the drop. It draws
nothing through a build on its own account: there is no standing light to wind
in. The rows are the whole of it; there is no tension shape change. Loudness
never moves the intensity either way.

## Knobs

All six live in the study definition (`src/studies/defs/lightning.ts`); the
params file (`src/impls/lightning.params.ts`) only clamps them to their safe
ranges. None of them is a per-frame number; all time is seconds.

| Knob        | Rest | Range       | Moves with                                  |
| ----------- | ---- | ----------- | ------------------------------------------- |
| `rate`      | 0.8  | 0 to 1.5    | `pace` up, `tension` down, `impact` up      |
| `forks`     | 2    | 2 to 4      | `energy` up (the biggest hits fork deepest) |
| `length`    | 0.45 | 0.1 to 1    | `energy` up, `tension` down, short sides    |
| `width`     | 2.2  | 0 to 8      | `energy` up, pixels at a 1080 high canvas   |
| `life`      | 0.08 | 0.05 to 0.5 | `tension` down, seconds                     |
| `intensity` | 1.05 | 0 to 2      | `tension` down, and nothing else            |

The saturation of the glow, the fork hue step, the roughness of the midpoint
displacement, the hot core width and the edge softness are shapes, not
levels: they live in the params file as constants, the way the other inks
keep their shapes.

## Coverage, the flash rule and the canvas sum

The worst the study's own mapping reaches is a loud, hard drop at full
release: length 0.7 short sides, width 3.2 px, forks 4, three bolts alive
inside a second. One bolt of that size is well under two percent of a 16:9
frame and three under five, counted as every segment at full light and none
overlapping (`lightningCoverage` in the params file overstates on purpose).
WCAG 2.3.1 counts a flash by a large area, ten percent of the frame at the
small end; a bolt is far under that, so the rate cap of three a second is a
second guard and not the only one.

A bolt stands still, unlike a ring, so its light does sum on the canvas while
it lives, and the canvas changed since this plan was first written: it keeps
0.975 of itself a frame (about a second and a half to a tenth and four and a
half to a thousandth, against the third of a second the old 0.93 gave), it
holds its own mean at 0.13 so the long memory cannot burn out, and a pixel is
capped at 1.8 as a backstop. Read against that:

- The afterglow outlives the bolt by far, and that is the canvas's design,
  not a fault: the bolt is the strike, the canvas is the glow. The life can
  be short, 80 ms, because nothing about the look depends on the ink holding
  light.
- At the resting intensity of 1.05 the middle of the line writes about 2.6 a
  frame (the colour body plus the white core lifted by 1.5), so the canvas
  settles the core at its 1.8 ceiling within two frames. That is the hot core
  the bloom stage catches, and resting above 1 is what lets it.
- The hold scales only the carried mean, so a single hot filament is left
  alone; only a frame that lights most of its pixels is pulled down.
- Past the line's reach the profile is exactly zero and nothing else stands
  lit, so the frame around a bolt stays true black while the trail decays.

The tension-only dimming is the wash-out guard now: at a full packet the
intensity resolves 1.05, at a full packet at full tension 0.90.

## Home and moments

Hard, heavy, high drive: metal, dubstep, drum and bass. The home is picked
against `src/director/tracks.fixture.ts`, nearest the metalcore, dubstep and
drum and bass readings (drive about 0.65, weight about 0.35, hardness about
0.7), reach 0.35. Moments: drop 1, groove 0.3, the rest 0. A groove fit of 0.3
is a nod, not an invitation: the director may edge it in under a busy groove,
but the study exists for the drop.

## Files

- `src/studies/defs/lightning.ts`, the study.
- `src/impls/lightning.params.ts`, the numbers, the bolt builder and the pool.
- `src/impls/LightningInk.ts`, the GPU side: one uniform, one storage buffer,
  one pass of six-vertex quads, one per segment.
- `src/shaders/lightning.wgsl`, the transcription of the line profile.
- Tests beside each: `lightning.params.test.ts`, `LightningInk.test.ts`,
  `src/studies/lightning.test.ts`. The generic bar is `registry.test.ts`.

## Doubts

The intensity is the number to trust least, as it was for the rings and the
halo before it: it was reasoned from the canvas arithmetic, not set from a
capture. If the bolts read faint beside the shards on the adapter, raise the
resting intensity before anything else; if the afterglow reads as a wash,
shorten the life before touching the intensity. Whether 80 ms is the right
life for the feel of a strike, and whether the edge-origin share should rise
above about half, are both for the screen, not the tests.

## After the first look on screen

The numbers reasoned from the canvas's arithmetic drew nothing at all on a real track, and then a thin brown scratch. Three things changed. A strong hit now fires while `release` is high or the passage is simply loud, because real tracks rarely read a release. The bolt is longer (0.7 of the frame), lives longer (0.18 s), rests at an intensity of 1.8, and has a glow in the air around the channel, sixteen line widths wide and a tenth as bright, which is what makes it read as light and not as a line. And the hue stays in the band from cyan through blue to violet, moved inside it by the key: following the key all the way round drew a red bolt in a red key. Its home also moved to the metal end of the measured tracks, since from its first home it took every hard drop and the shards were never cast.
