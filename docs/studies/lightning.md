# Lightning

The plan for the `lightning` study, written before the code. Update it in the
same push as any change of plan.

## What it draws

Branching bolts on the biggest hits. A bolt is a jagged main channel with two
to four levels of forked branches, drawn as thin additive line quads with a hot
core, near white and tinted by the key hue. A bolt lives about 120 ms and is
gone; the canvas trails carry the afterglow, so the ink itself never sums.

A bolt starts at an edge or the centre, seeded per strike: a strike is built on
the CPU by midpoint displacement, and its every choice (which edge, which
direction, every midpoint offset, every branch point and angle) is a hash of
the section id and the strike count, never `Math.random`. The same song gives
the same bolts for as long as the ink lives.

## When it fires

Two ways in, and only two:

- `impact`, the one frame the drop lands, fires one bolt at full strength.
  Like the shards, a crossing with a hysteresis, and two impact bolts are at
  least half a second apart whatever fires `impact`.
- a strong hit in the low end or the mids (sub, bass, low mid, high mid) while
  `release` is still high fires one bolt at the hit's strength. A token bucket
  holds one strike and refills at the `rate` knob, capped at two a second, so
  with the banked one no song can fire more than three bolts a second. That is
  the WCAG 2.3.1 line held by construction, the same way the shards hold it.

Nothing else fires. A groove, a build, an intro draw nothing at all: the pool
is empty, no buffer is uploaded, no pass is encoded. Silence is black because
there is nothing to fire and no standing light.

## Tension

Tension holds the study back so the drop lands. It takes the strike rate down,
the bolt length down a little, the life down a little and the intensity down by
up to a quarter, so through a build the bolts that do fire are fewer, shorter,
briefer and dimmer, and what they held back is released with the drop. It draws
nothing through a build on its own account: there is no standing light to wind
in. The rows are the whole of it; there is no tension shape change.

## Knobs

All six live in the study definition (`src/studies/defs/lightning.ts`); the
params file (`src/impls/lightning.params.ts`) only clamps them to their safe
ranges. None of them is a per-frame number; all time is seconds.

| Knob        | Rest  | Range    | Moves with                                      |
| ----------- | ----- | -------- | ----------------------------------------------- |
| `rate`      | 0.8   | 0 to 2   | `pace` up, `tension` down, `impact` up           |
| `forks`     | 2     | 2 to 4   | `energy` up (the biggest hits fork deepest)      |
| `length`    | 0.45  | 0.1 to 1 | `energy` up, `tension` down, short sides          |
| `width`     | 2.2   | 0 to 8   | `energy` up, pixels at a 1080 high canvas         |
| `life`      | 0.12  | 0.05 to 0.5 | `tension` down, seconds                        |
| `intensity` | 0.9   | 0 to 2   | `energy`, `swell`, `hardness`, `tension`, all down |

The tint toward the key hue, the roughness of the midpoint displacement, the
hot core width and the edge softness are shapes, not levels: they live in the
params file as constants, the way the other inks keep their shapes.

## Coverage and the flash rule

The worst the study's own mapping reaches is a loud, hard drop at full
release: length 0.7 short sides, width 3.2 px, forks 4, three bolts alive
inside a second. One bolt of that size is well under two percent of a 16:9
frame and three under five, counted as every segment at full light and none
overlapping (`lightningCoverage` in the params file overstates on purpose).
WCAG 2.3.1 counts a flash by a large area, ten percent of the frame at the
small end; a bolt is far under that, so the rate cap of three a second is a
second guard and not the only one.

A bolt stands still, unlike a ring, so its core does sum on the canvas while
it lives: the canvas keeps 0.93 of itself and takes its floor off, and a line
that does not move settles near `intensity / (1 - 0.93)`. That is why the core
is meant to saturate to white and why the intensity only falls with loudness,
never rises: the resting 0.9 is held to `boltPeak` settling under the canvas
ceiling away from the bolt, and the bolt itself is a thin white-hot filament
that the trails then smear. The dimming rows are the wash-out guard: a full
packet resolves 0.72, a full packet at full tension 0.57.

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
halo before it: it was reasoned from the canvas sum, not set from a capture.
If the bolts read faint beside the shards on the adapter, raise the resting
intensity first; if the afterglow reads as a wash, lower the life before the
intensity. Whether 120 ms is the right life for the feel of a strike, and
whether the edge-origin share should rise above about half, are both for the
screen, not the tests.
