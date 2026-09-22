# black-hole

The shot everyone knows: a dark middle, a thin ring of fire on its rim, and the rest of the picture bending round it. Two studies on one branch, because a study names one implementation and this needs two.

| Study             | Kind | Implementation                       | What it is                                              |
| ----------------- | ---- | ------------------------------------ | ------------------------------------------------------- |
| `black-hole`      | flow | `analytic`, the new `lens` term      | the pull, which is what keeps the middle empty          |
| `black-hole-ring` | ink  | `blackhole`, `impls/BlackHoleInk.ts` | the burning ring and the annulus that bends the picture |

The catalogue's row says `kind: flow`, and the pull really is a flow term. But a flow cannot draw a ring, and a study's `impl` is one implementation, so the ink is a second study rather than a second half of the first. The two carry the same home, the same reach and the same moments, so the director casts them together; each still stands on its own, because a lens with nothing lit in the middle is still a lens and a ring with no pull under it is still a ring.

This file is the plan and the record. It is written first and updated in the same push as any change of plan.

## What the references do

Looked at before the shader was written. What each one is, and what could actually be read of it this session:

- **The Event Horizon Telescope's 2019 image of M87\*** (eso.org/public/news/eso1907). Read. "A ring-like structure with a dark central region — the black hole's shadow", and the shadow is about two and a half times the size of the event horizon it is cast by. The ring is not evenly bright: one of the papers published with it is titled "Physical Origin of the Asymmetric Ring", though the press release gives no figure for how much brighter one side is. The release itself says nothing about colour, since the observation is at 1.3 mm and the published picture is a false-colour map; the version everybody has seen is amber on black.
- **Interstellar's Gargantua**, through Thorne, James, von Tunzelmann and Franklin, "Gravitational Lensing by Spinning Black Holes in Astrophysics, and in the Movie Interstellar" (arXiv 1502.03808). Only the abstract could be read; the PDF came back as binary. The abstract says the renderer traced ray **bundles** rather than rays, which is what got IMAX-quality smoothness with no flicker, and that the disc images in the film came out of the same code.
- **"Building Gargantua"** (cerncourier.com). Read. A flat, multicoloured ring standing for the disc, warped by the lensing so it arcs around the shadow, with Doppler shifts and gravitational redshift in the rendering code and in the colour grading.
- **Search summaries only, not the sources**: that the film's producers took the Doppler beaming out for the look, because with it in the approaching side would be blindingly bright and the receding side nearly invisible, and that the physically honest version went into the paper instead.
- **Luminet's 1979 computed image**, the first one there was: fetched and unreadable (the PDF came back as structure and fonts). Nothing here is taken from it.

What makes them striking, and what was built to it:

- **The dark is the subject.** In every one of them the middle is not dim, it is empty, and the ring only reads because there is nothing at all inside it. Built to: the ink returns exactly nothing inside the disc, and the `lens` flow keeps it that way by pushing gently outward there rather than pulling in. An ink can only add light, so this is the only way to have a dark disc until `subtract-blend` exists.
- **The ring is thin and it is hot.** A hairline of fire, not a band. Built to: the ring is `2 x width` across, 0.022 of the short side at rest, with a light that squares its own falloff so the core is a pixel or two and the shoulders carry the colour. The core rests over 1 so the bloom catches it.
- **One side is brighter.** It is the first thing the eye reads in the EHT image and the thing the film took out. Built to: `beam` brightens the approaching side and dims the other, 0.5 at rest, up to 0.9, and `spin` walks which side that is slowly round the ring.
- **The picture behind it wraps around the shadow.** Gargantua's disc arcs over the top and under the bottom because the light from behind is bent over the hole. Built to: the annulus reads last frame's canvas at a radius further out than the one it draws at, so whatever is outside appears drawn in and wrapped around the dark middle.
- **Amber, and cool light around it.** Gas at a few thousand kelvin is amber, the EHT's published map is amber, and the lensed sky behind Gargantua is blue-white. Built to: two hues of the study's own, `BLACKHOLE_CORE_HUE` at 0.07 turns and the cooler one exactly a third of a turn on, both moved together by `keyHue`. A ring that followed the key all the way round would draw a green black hole, which is the mistake the lightning already made once.
- **True black around all of it.** Built to: the ink draws nothing at all past the outer radius, so the sky stays black and the coverage stays honest.

## The pull: the `lens` term

A lens is a velocity you can write down, so it is a term on the analytic flow rather than anything simulated. `lensProfile` in `src/impls/analytic.params.ts` is the maths and `src/shaders/analytic.field.wgsl` is a line-for-line transcription of it. `t` is the distance from the middle as a fraction of the distance to the corner, `p` is the photon radius in the same units, and the profile is a multiple of `lens`:

```text
t >= p    inward     -(s^2 (1 - s)) / LENS_PEAK,   s = p / t     0 at p, peak -1 at t = 1.5p, ~ -p^2/t^2 far out
t <  p    outward     LENS_ESCAPE x 4u(1 - u),     u = t / p     0 at the centre, +0.25 at u = 0.5, 0 again at p
```

Three things it has to be, and each is a test in `src/impls/analytic.lens.test.ts`:

- **Zero at the exact centre.** The inside half is a parabola through the origin, so there is no point where the direction jumps.
- **Inward at the rim**, and falling off with the square of the distance. The `1 - s` factor is a near-field correction and goes to one far out; at a hundred photon radii, doubling the distance quarters the pull to within a percent.
- **Continuous across the photon radius.** Both halves are exactly zero at `p`, so the sign turns over with no step in the speed. The test takes the profile either side at four gaps and holds the difference to shrink in proportion to the gap, which a discontinuity would not.

`LENS_PEAK` is `4/27`, the most `s^2 (1 - s)` ever reaches, so `lens` always means the fastest the pull gets whatever `photon` is doing. `LENS_ESCAPE` is 0.25: the escape is not the effect, it is the guarantee. A pull that ran all the way to the middle would gather the picture into a bright dot there, and nothing looks less like a black hole. With the sign turned over, nothing draws toward the middle and what lands there is carried back out to the ring.

`photon` rests at 0.07 and reaches 0.115 on a loud build. On a 16:9 canvas one unit of `photon` is 1.02 of the short side, so the sign turns over at about 0.071 of the short side, just inside where the ink puts the rim of its disc, and the pull peaks at 0.107, just outside where the ring is burning. Light is swept off the middle and piles up where the fire is.

It has no clock, so the field is a function of this frame's knobs and nothing else; the test steps the curl's clock beside it at 30, 60, 144 and 240 frames a second and reads the same field at every one.

## The ring and the bend: the `blackhole` ink

One quad, square in pixels, no bigger than the outer radius, so the picture is round on any canvas. Three bands of radius, all fractions of the short side, and the ink returns nothing outside the middle two:

```text
0 -------- disc ======== ring ======== bend0 ---------------- outer ---->
  nothing      the burning ring          the bending annulus     nothing
  is drawn     2 x width across          reads last frame        is drawn
```

At rest: disc 0.08, ring 0.091, bend0 0.102, outer 0.177.

**The ring.** `ringLight` is a smoothstep across the ring's width, squared, so it is exactly zero at both edges (which is what lets the annulus start where the ring ends, with no overlap) and pulled into a narrow core. The colour is graded from the cooler hue at the edges through the hot one to white at the very centre, so the core blows out and the colour survives in the shoulders. `beam` multiplies by `1 + beam x cos(angle - spin)`, so the approaching side is up to 1.9 times the mean and the receding side a tenth of it.

**The bend.** For a pixel at radius `x` (as a fraction of `outer`), the ink samples last frame's canvas at `x + BEND_SHIFT x w(x)`, where `w` is 1 where the annulus starts and 0 at the outer radius with no slope. `BEND_SHIFT` is 0.45, which is large on purpose: a big step is both a visible bend and a short chain. What it read is washed 35 percent toward the cooler hue, so the lensed halo sits cool against the hot ring, and added at the gain below.

## The loop, and why it cannot run away

The annulus reads the picture the composite last wrote, which already holds everything this ink drew a frame ago. Two rules make it bounded, and both are load-bearing:

**1. The read always comes from further out.** The gain and the displacement are the same window `w` times a constant, so wherever the ink reads anything it reads a radius strictly further out. Light only ever marches inward, the chain leaves the annulus in two or three hops, and there is no radius that feeds itself. `blackhole.params.test.ts` walks the whole radius at three knob settings and holds `w > 0` to imply `shift > 0`.

**2. The gain is a share of what the canvas lets go of.** The director's canvas keeps 0.975 per reference frame, so a mark that stands still sums to about forty times what one frame adds. A fixed per-frame gain of even a tenth would therefore settle at four times what it read. Instead:

```text
gain(dt) = bend x (1 - keep ^ (dt x 60)) x min(intensity, 1)

settled:  H(x) (1 - keep) = gain x H(x + shift)
          H(x) = bend x H(x + shift),   bend < 1
```

So every hop inward is dimmer than the last, and the annulus can never be brighter than the picture it is bending. It is also the same loop at any frame rate, which a fixed gain would not be: the canvas's own loss is 0.025 a frame at 60 and 0.0105 at 144.

The texture gain that comes out of it is 0.0125 at rest at 60 frames a second and 0.005 at 144, two orders under one. Run forward from a picture that is white everywhere, for ever, the annulus settles at exactly `bend` of the surround at the disc's rim and about half that half way out, and nothing anywhere exceeds the surround. The test does that at 30, 60, 144 and 240 frames a second, with `bend` at rest and at the top of its range, and checks the profile goes to nothing once the picture it reads does.

| Reading, from `blackhole.params.test.ts` and the numbers behind it | Rest   | Widest its mapping reaches |
| ------------------------------------------------------------------ | ------ | -------------------------- |
| texture gain at 60 frames a second                                 | 0.0125 | 0.0200                     |
| settled annulus at the disc's rim, as a share of the surround      | 0.50   | 0.80                       |
| settled annulus half way out                                       | 0.25   | 0.41                       |
| the ring's core on one frame                                       | 1.47   | 4.37                       |

## Knobs

The flow's, resting value first. Every one is driven or is on the allow list in `registry.test.ts` with a reason.

- `lens` 0.14: field widths a second at the fastest the pull gets. `energy` (square root) adds 0.12, `lowEnd` 0.1 and `tension` 0.18, so a loud build pulls at 0.54.
- `photon` 0.07: where the sign turns over, as a fraction of the distance to the corner. `energy` adds 0.015 and `tension` 0.03. A shape, so presence leaves it alone.
- `swirl` 0.01: frame dragging, in turns a second, which a spinning hole really does to the light around it and which stops the bend being a straight zoom. `energy` adds 0.02 and `tension` 0.015.
- `radial`, `falloff`, `twist`, `curl`, `curlScale`, `curlRate`: the other terms, off.

The ink's. Every one is driven, so it needs no allow list at all.

- `disc` 0.08: where the empty middle ends, a fraction of the short side. `energy` (square root) adds 0.018, `lowEnd` 0.012 and `tension` 0.02, which is the catalogue's "disc grows".
- `width` 0.011: half the ring's thickness. `lowEnd` 0.005, a kick's `bassPulse` 0.004, `tension` 0.002.
- `annulus` 0.075: how far the bend reaches past the ring. `swell` 0.012, `tension` 0.013.
- `heat` 0.85: the fire, as a multiple of the intensity. `lowEnd` (square root) 0.55, `subPulse` 0.35, `impact` 0.25. This is where the bass burns.
- `beam` 0.5: how much brighter the approaching side is. `hardness` 0.25, `beatPulse` 0.15.
- `bend` 0.5: the share of the canvas's loss the annulus puts back. `energy` (square root) 0.2, `tension` 0.1.
- `intensity` 1.15: the ink's light and its gate. `energy` through an invert takes 1.15 off, so it is exactly 0 in silence and exactly its rest at a full packet. Nothing raises it.
- `hue` 0: turns added to the key, for both hues together. `harmonicChange` 0.1, `swell` 0.06.
- `spin` 0: where the beamed side points, in turns. `pace` through an `integrate` at 0.04 turns a second, wrapping at 1, so a groove walks it once round in a minute or so and silence holds it.

**Nothing brightens with the level.** The registry guard forbids raising `intensity` with the music, and lowering it is not the answer either. The punch is in the heat, the width, the disc, the bend and the pull, which is exactly the list the card asked for.

**It shows up on real music.** `lowEnd`, `energy`, `subPulse`, `bassPulse`, `beatPulse` and `pace` drive most of it. `tension` and `impact` are there because the catalogue asks for them, and nothing waits on `release`, `impact` or `tension` alone: real tracks rarely push those high, which is what made the lightning draw nothing for a whole song the first time.

## Where it belongs

Home `{ drive 0.52, weight 0.2, tonality 0.32, steadiness 0.56, hardness 0.74 }`, reach 0.35, for both studies.

The card asked for dubstep, bass and doom, "so high weight, hard, mid drive". The measurement disagrees about the weight and the measurement wins, which is the catalogue's own rule. `weight` reads high for a bass-led spectrum and dubstep is mostly treble: Subtronics reads 0.18, Pendulum 0.22 and the demo's own track 0.18, against Christian Loffler's ambient house at 0.99. So the home sits at a weight of 0.2, which is where the music the card named actually is, and which is also clear of the shards (0.5) and the lightning (0.35). Closeness at the three tracks is over 0.9, and under 0.3 at Wilco, Loffler, Daft Punk and Emancipator.

Moments: build 1, drop 0.85, groove 0.2, and nothing else.

The card asked for build 0.9 and drop 1. `fairness.test.ts` said no: the shards are a drop-only ink whose single seat in the whole library is the dubstep track's drop, and an ink at a fit of 1 sitting nearer that track than they do took it, leaving them cast nowhere. The rule is to move a home and not to loosen the test, and the honest move here was the moment rather than the home: the build is what this study is actually about, since tension grows the disc and strengthens the pull, and the drop is where the shards and the lightning already live. At 0.85 the ring still wins seven casts across the twenty tracks and the shards keep theirs. The small groove fit is what keeps it from being an ink only two moments in six can ever reach.

## Coverage, silence and flashes

The ink can only light the band between the disc's rim and the outer radius, since it returns nothing on either side of it, so the worst case is that band with a picture bright everywhere under it.

| Canvas | At rest | At the widest its mapping reaches |
| ------ | ------- | --------------------------------- |
| 16:9   | 4.4%    | 10.3%                             |
| square | 7.8%    | 18.2%                             |
| 9:16   | 4.6%    | 10.3%                             |

`blackhole.test.ts` holds it under 20 percent on eight canvas shapes and under 12 on a 16:9 one.

**Black in silence.** `intensity` is gated from 0 by `energy`, so a silent packet resolves to no light, `blackHoleLit` is false, no pass is encoded and nothing is uploaded. That holds at full tension too: the level is the gate, not the build.

**Presence 0 costs nothing.** The renderer does not call an implementation at 0, and this one uploads nothing in `update` either: the only thing it keeps between frames is the step and the key.

**WebGL2 skips it without throwing.** The fallback path has one program and draws the fractal alone, and `withoutCompute` swaps a director-chosen cast that holds no fractal for the stand-in, so nothing here is asked to run there.

**Flash safe by construction.** Nothing in it toggles. The ring's heat follows the low end's own envelope, `beam` follows the beat's pulse, and the one event row is `impact`, which the extractor cannot fire closer than 0.8 s apart. There is no row that takes a large area of the frame from dark to bright and back.

## What has not been checked

Nothing here has been seen on a GPU yet. The compile check in `test/wgsl.test.ts` says the shader is valid WGSL and nothing about what it draws, and every number above is arithmetic and unit tests. Two of them are the ones to look at first on a real adapter:

- **The ring's settled brightness.** The canvas sums a standing mark to about forty times what one frame adds, so a ring that stood still would sit at the canvas's ceiling and read as a flat white hoop. What is meant to stop that is that the disc's radius moves with the music and the beamed side walks round, so the ring smears rather than standing. If it still blows out, the resting `intensity` is the number to bring down, and after it `heat`.
- **Whether the bend reads at all.** The settled annulus is half the surround at the disc's rim, which is the arithmetic; whether that looks like light bending or like a smudge is a thing to see. If it is too faint, `bend` goes up before anything else, and it may go to 0.8 with the bound above still holding.
