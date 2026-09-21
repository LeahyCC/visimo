# murmuration

Thousands of birds moving as one body, folding and splitting on the beat. It is
a profile over the particle field (`MURMURATION_PROFILE` in
`src/impls/particles.params.ts`) and the first study to switch the field's
boids grid on. The study is `src/studies/defs/murmuration.ts`, and its header
comment is the long version of this file.

## References

Three things were built to. None of them was open beside the work; what follows
is what makes each one striking, written down so the study can be judged
against it and not only against its tests.

**Starling murmuration photography, the dusk shots over a reed bed or a pier.**
The flock is one shape, not a scatter of birds. It has a boundary you could
trace with a finger, a dense core that goes near black where the birds overlap,
and a thin edge where single birds are still legible as marks. It is never
still and never round: it is stretched into a tube, pinched, poured over itself
and drawn out into a sheet. And the brightness moves. Where the sheet turns,
the birds present their bodies to the camera and the patch darkens or lightens
in a single sweep, a wave you can follow across the flock. That wave is the
picture. The study makes it as light and colour where a bird is turning hard.

**Long exposure murmuration work, where the flock is a smoke.** A few seconds of
exposure turns each bird into a stroke and the flock into a brushed shape with
a hot body and soft trailing edges. It is the reason the canvas's memory is
welcome here: the wake behind the body is the same look for free, provided the
strokes are thin and the count is honest. Too many birds and it is fog. The
study is kept to a few thousand thin points for that reason.

**Sardine bait ball footage.** The other animal that moves as one body, and the
one that shows what a hit does to it. A predator goes through and the ball
opens in a ring, the birds' equivalent of a kick, and closes again in about a
second. Under threat it balls up tight before it bursts. That is the whole of
what the catalogue asks tension and the drop to do: a build draws the flock in
and the impact throws it open. The silver flash that crosses the ball as it
turns is the same wave as in the starlings.

## What it draws

Up to 7,000 birds, each a point about two pixels across with a short streak
along its own velocity. A bird has no brightness of its own beyond how hard it
is turning. The birds are steered by three rules over a grid (separation,
alignment, cohesion), by a pull toward a moving attractor, by a broad curl
noise that stirs the body from inside, and by a slowly turning gravity that is
the heading. The particle field's README section has the machinery; the study's
comment says why each piece is there. Four findings worth having in one place:

- Local cohesion cannot hold a flock. With the gather off the birds spread over
  the whole frame as a flow. The gather (a pull toward the attractor that grows
  with distance) is what makes a body with a soft edge.
- The steering's separation had to become a sum and not an average, or a pile of
  birds felt nothing pushing back and collapsed to a point.
- The grid keeps eight birds a cell, so the reach has to be small (0.02 of the
  short side) or a dense flock is steered by eight remembered birds and draws a
  lattice. The grid is also moved by a fraction of a cell each frame and the
  eight are a fresh random sample each frame, which took the last of it away.
- Without the curl the flock relaxes into a small round pile between kicks. With
  it, it stretches into a sheet that bends, and the light and colour gather at
  the bend.

Its colours are its own. The resting hue is a blue with some cyan in it at a
key of 0 and the leading hue is a spread of 0.36 of a turn down the wheel from
it, a hot red. A bird turning hard is carried from one toward the other, so a
fold is a wave of red across a blue body, and both turn with the key. On the
real track it was played over, the key moved the flock from orange over
yellow-green through green and magenta to blue as the song modulated.

## What the music does

The size of the flock, the light, the stroke, the heading speed and how well the
birds keep in step all read the level, `pace` and the band pulses. None waits
for `tension`, `release` or `impact`. The bass pulse opens the body, through an
envelope 6 ms up and 300 down, and the drop's impact opens it wider. A build
(tension) draws the flock in tighter and pushes less, so it balls up, and the
drop's impact throws it open. The light rests at 0.5 and only ever falls with
energy, swell and hardness, to 0.32 at a full packet.

## What it costs and how much it covers

Medium. On an RTX 5080 the particle field's own compute and draw is about a
tenth of a millisecond for a pool this size, from the field's measurements
in the README; the whole frame was not timed. At the most its own mapping
reaches it covers 1.6 percent of a 1080p frame, 3.2 percent of a square one
and 4.2 percent at 320 by 320 (`particleCoverage`, an upper bound, held under a
twentieth on eight canvas shapes by `studies/murmuration.test.ts`).

## Measured

Headless Edge on an NVIDIA Blackwell adapter, the demo's bench solo of the
study over the clean glass look, and the real track Pendulum, The Terminal,
played through it in full view at 1280 by 720. No WGSL or validation message
over any run. The track's own loudness was measured with ffmpeg in five second
windows: it sits near minus 9.4 dB RMS from 2:05 to 3:30 and from 3:55 to 5:20,
and falls to between minus 23 and minus 25 dB from about 1:15 to 1:25. Shares are of the whole frame, taken on
the displayed frame after the tonemap, with the largest colour channel as the
value.

| Frame                                                                 | over 0.3 | over 0.8 | mean saturation of lit | under 0.02 |
| --------------------------------------------------------------------- | -------- | -------- | ---------------------- | ---------- |
| loud, 2:36 (about minus 9.4 dB), final numbers                        | 7.8%     | 2.9%     | 0.93                   | 88.5%      |
| loud, 4:36 (about minus 9.5 dB), final numbers                        | 3.0%     | 1.1%     | 0.73                   | 94.6%      |
| loud, 4:40 (about minus 10 dB), before the change                     | 3.6%     | 0.9%     | 0.93                   | 93.2%      |
| quiet, 1:25, after a stretch at minus 23 to 25 dB, before that change | 1.2%     | 0.5%     | 0.84                   | 97.9%      |
| silence, from the bench                                               | none     | none     | none                   | all        |

Twenty frames across the whole song before that change ranged over 0.3 from 1.2
to 3.6 percent, over 0.8 from 0.4 to 1.2, saturation 0.52 to 0.93 and black 93
to 98. The frame after the change to 7,000 birds was sampled at five points and
ranged 3.0 to 7.8, 0.7 to 2.9, 0.73 to 0.93 and 88 to 95. A bench build (tension
held at 1) draws a tight ball, and a silent packet draws nothing.

## Not done, and worth a look

- It has been watched on one track. The attractor steps on the bar from the mid
  bands, and how it wanders on a track with a different bar has not been seen.
- The canvas's zoom has a fixed point at the middle, and a flock that crosses
  the middle leaves a few pixels of light there for a while. Any moving ink
  does, and this one moves through it more than most.
- The turn brightness is a wave of light in a body that is mostly one colour on
  a steady passage. It shows most on a fold and on a kick. It is worth a look
  at a build and a drop on a track with a clear one.
