# lasers

Club laser fans sweeping through haze, locked to the beat. Three to six fans,
each a handful of thin beams, thrown from a point just off the top or bottom
edge of the frame. A bright core, a soft falloff, and the beams sum where they
cross, which is what a haze full of lasers looks like.

This file is the plan and the record. It is written first and updated in the
same push as any change of plan.

## What it draws

One full-frame pass adds every beam analytically. For each pixel the shader
walks the fans and their beams, measures the distance to each beam's line, and
sums a falloff: full light inside the core, a smoothstep down across the glow,
exactly zero past the glow. Beams are not geometry; nothing is meshed. The pass
is one fullscreen triangle, the way caustics draws its pattern.

A fan is a point origin and a spread of beams about a base direction. Origins
alternate between just off the top edge and just off the bottom edge, spread
evenly along the x axis, so even and odd fans lean across each other. The base
direction points straight into the frame, and the whole fan swings with the
beat: the swing angle is `sweep x (|beatPhase - 0.5| - 0.5)`, so every fan
is centred on the predicted beat, sweeps to one side and back inside the
beat, and neighbouring fans sweep opposite ways so they cross each other on
the way. `beatPhase` is read
straight from the packet, the way the rings read it, so the sweep lands where
the tracker expects the beat and nowhere else; the tempo confidence gates the
light, as it gates the rings, because a sweep on a wrong tempo is a steady
rhythm in the wrong place.

Where the beams of one fan land is the spread. The beams of a fan fan out
evenly across `spread` radians about the base direction, so at a spread of 0
every beam of the fan coincides and the fan is a single beam. That is the whole
of what tension does: it takes the spread to 0 and every fan closes to one
beam. On the drop, `impact` throws the spread wide open for its frame.

One beam per fan at a time answers the treble. `flick` rests at 0 and the
treble pulse lifts it; while it is up, one beam of each fan, the beam the beat
clock selects, carries extra light, so a hit reads as a single beam flashing
and not as the whole fan brightening.

The colour is the ribbon's palette at the key, as every ink takes it, with a
small offset the mapping nudges when the chord moves.

## Knobs

Every number the study owns, resting value first:

- `fans` 3: how many fans stand on the edges. `energy` brings 3 to 6 through a
  square root, so the first sound puts several fans up and a full packet puts
  the row of them along both edges.
- `beams` 4: how many beams a fan carries. `treble` takes it to 6, so a bright
  track gets a fuller fan.
- `spread` 0.45: the fan's opening in radians. `energy` opens it to 0.8,
  `tension` closes it to 0 (every fan down to one beam), and `impact` throws
  it to the top of its range on the drop's frame.
- `sweep` 0.25: the swing amplitude in radians. `energy` lifts it to 0.55, so
  a loud passage sweeps wider. The beat clock drives the position, not a
  knob: the shader reads `beatPhase` from the packet, so the fan is centred
  on the predicted beat and the sweep is a prediction, not a reaction.
- `width` 1.2: the beam core's half width in pixels at 1080 high, scaled with
  the short side. `energy` thickens it to 1.5. Always thin.
- `glow` 1.0: the soft edge on each side of the core, in pixels at 1080 high.
  `hardness` takes it down to 0.5 on a hard track, so hard music gets sharper
  beams and soft music hazier ones.
- `intensity` 0.8: the light one beam adds at its core. The tempo confidence
  gates it (`tempoConfidence` through `invert`), so a track with no steady
  beat dims the fans out rather than sweeping them wrongly, and a silent
  packet takes it to 0. `energy`, `swell` and `hardness` pull it back as the
  frame fills, the way the halo's does, and `beatPulse` lifts it a little on
  the beat.
- `flick` 0: how much one beam answers the treble. `treblePulse` lifts it to
  near 1 on a hit, and it decays as the packet's own pulse does, which is per
  second and not per frame.
- `hue` 0: the offset from the ribbon's colour at the key. `harmonicChange`
  nudges it, so a moving chord shifts the palette slightly.

Ranges for all of them are `LASER_RANGES` in `src/impls/lasers.params.ts`, and
the params file is where the falloff and the coverage arithmetic live.

## What tension does

Tension closes every fan to one beam: `tension` takes `spread` from 0.45 to 0
at a gain of -0.45, so a full build is a row of single sweeping beams and the
drop's `impact` throws them wide open again. It lifts the intensity a little
(0.02, so a build is not darker, only narrower) and leaves the count, the
width and the colour alone.

## Sparse by construction, and flash safe

The worst frame there is: a full packet, six fans of six beams, full spread,
soft beams (a soft track at full energy). Each beam lights a band about
5 pixels wide across at most the frame's diagonal, and the beams cross in
small groups, so the lit share of a 16:9 frame stays around 8 percent,
measured by `lasersCoverage` on a grid, with the count of every lit pixel
taken once however many beams cross it. A test holds it under 15 percent at a
full packet on a 16:9, a square and a tall canvas.

That is also the flash statement for WCAG 2.3.1. The lit area is a small
share of the frame, the beams move continuously with the beat, and nothing in
the study toggles a large area of luminance on or off: there is no strobe in
the construction, so there is nothing to count flashes of.

## Silence, presence and frame rate

A silent packet resolves the intensity to 0 through the tempo confidence gate,
so the ink encodes no pass and uploads nothing; presence 0 does the same.
There is no clock and no state: what is drawn is the knobs, the key and the
packet's beat phase, so the same song at 60 and at 144 frames a second draws
the same frame. `flick` rides the packet's own treble pulse, which decays per
second, so nothing here integrates per frame.

WebGL2 cannot draw this study and skips it, as it skips every ink but the
fractal; the study must not throw there, and it does not: the renderer never
builds it on that path.

## Cost

`cheap`: one fullscreen triangle, one 16 float uniform made once, and a
bounded double loop in the fragment stage over at most 6 fans of at most 8
beams. There is no texture, no buffer and no compute.

## Colour and light, after the first look on screen

The first build drew every beam in the ribbon's one colour and dimmed them when the music got loud, and on screen it was thin dull yellow lines. It was reworked against photographs of club rigs: each fan has its own saturated hue (`rainbow` is the step between neighbours, starting from the key), only the middle of a core goes white, `haze` adds a little wide light in the air, and a beam thins along its length. The intensity rests at 1.05 and nothing loud raises it; the beat fattens the beams through `width` and the bass thickens the `haze`. Fans go from 4 to 8 with energy and beams from 5 to 11 with treble. Black between the fans matters more than any of it: at a haze of 0.07 the frame was a pastel wash.
