# Effects catalogue

The working list of studies to build, one card each. It continues `docs/studies-handoff.md`: that file's catalogue was the first draft, and anything from it that is not built yet has been carried over here. Read the handoff first for what a study is, the director, and the bar for "perfect". Written 2026-09-20.

The aim: whatever the song is, something in this list was made for it. A study is picked by the song's character and the moment, so every row below says which music it is for and what it does with tension.

## How to use this file

One row is one card is one branch is one PR. Nobody builds a row that is not theirs.

```text
1. git fetch. Read this file on origin/main and run `gh pr list`. A row is free only if its
   status is `open` AND no open PR is named for it.
2. BEFORE any code: branch `feature/study-<id>` off origin/main, change the row's status to
   `claimed: feature/study-<id>`, commit only that, push, and open a DRAFT PR titled
   "Add the <id> study". The draft PR is the lock, and everyone can see it.
3. Build on that branch. Touch only your own files (below).
4. Keep the docs current as you go, not at the end: your row here, docs/studies/<id>.md, and
   the README row. If the plan for the study changes, the row changes in the same push.
5. Mark the PR ready. The lead reviews it in the bench at a quiet passage, a build and a drop.
6. The last commit on the branch sets status to `built`, so it lands with the merge.
```

Several builders work from this list at once, board cards and hand-started runs alike. They all follow the same steps, so the draft PR list is the one place to see what is taken.

If a row is wrong (bad idea, wrong kind, should merge with another), say so in the PR or to the lead. Do not quietly build something else.

## Staying out of each other's way

A study owns these files and nothing else:

| File                                | Who writes it                         |
| ----------------------------------- | ------------------------------------- |
| `src/studies/defs/<id>.ts`          | the study's card                      |
| `src/impls/<Id>.ts`                 | the study's card                      |
| `src/shaders/<id>.*.wgsl`           | the study's card                      |
| `src/impls/<Id>.test.ts`            | the study's card                      |
| `docs/studies/<id>.md`              | the study's card                      |
| `src/studies/registry.ts`           | ONE appended import line and list row |
| `README.md` study table             | ONE appended row                      |
| director, score, post stack, packet | nobody. Ask the lead                  |

Two things make this hold:

- **The registry is split.** Each study is its own file, `src/studies/defs/<id>.ts`, and `src/studies/registry.ts` is a list of imports. A new study adds one import and one row, and one-line appends merge cleanly. Anything several studies share goes in `src/studies/defs/shared.ts`.
- **Shared helpers first.** Several rows need the same building block (see "Shared pieces" below). Each is built once, by its own card, before the studies that use it. A study card never writes a shared helper on the side.

If a study needs something the contract cannot do (a new packet row, a new blend mode, a new input texture), it stops and raises it. It does not add it.

## Tiers

- **S**: build these. Each one either shows something about the music that nothing else can, or is a look people will screenshot.
- **A**: strong. Build after the S tier, or sooner if it fills a gap in the coverage map.
- **B**: fine, not urgent. Several are cheap and make good filler cards.
- **cast**: not a new study. A pinned recipe made from other rows.

Moment letters are the handoff's: I intro, G groove, B build, D drop, R rest, O outro. Capital means strong fit.

A note on literal things (animals, spacecraft, Buddha, the devil): a shader drawing of a recognisable figure nearly always looks cheap, and it stops meaning anything after ten seconds. Every theme Colin named is in here, but as the feeling of the thing and not a picture of it. "Evil" is light being eaten. "God" is light pouring down. "Animals" is a flock that moves like one creature. Where a literal version could work it says so.

## Shared pieces

Built once, before the rows that need them. Six pieces, three of them built.

| Piece            | What it is                                                                                                                  | Needed by                                                                                 | Status |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| `raymarch-kit`   | WGSL camera, SDF ops, soft shadow, half-res render and upscale, the glint threshold                                         | wormhole, shape-morph, liquid-chrome, nebula, city                                        | built  |
| `canvas-sampler` | lets an ink or look read last frame's canvas as a texture (MilkDrop's textured shapes)                                      | echo-shapes, liquid-chrome, wormhole, black-hole                                          | built  |
| `swarm-kit`      | one GPU boids pool with steering rules as knobs, drawn as points, quads or short trails                                     | murmuration, school, fireflies                                                            | built  |
| `subtract-blend` | a second ink blend that darkens. Today inks only add light, so nothing can be dark on light                                 | void-tendrils, eclipse, ink-wash                                                          | open   |
| `chroma-rows`    | the twelve note strengths appended to the END of the packet (`docs/open-leads.md` has this as the blocker for chord petals) | chord-petals, cymatics, mandala, stained-glass, harmonograph, sacred-lines, constellation | open   |
| `height-kit`     | a scrolling heightfield from the spectrum with horizon, fog and parallax layers                                             | ridgeline, ocean, grid-3d, city                                                           | open   |

**`raymarch-kit` is `impls/RaymarchInk.ts`**, a base an ink in three dimensions extends, and `shaders/raymarch.common.wgsl`, which is prepended to its shader. The shared WGSL is the camera, the sphere trace, the normal, the soft shadow, the occlusion, the fresnel, the primitives and their operators, and the glint threshold; the TypeScript marches a target at half the ink target and scales it back up, additively at the study's presence. An ink on it writes `sceneDistance` and a fragment entry point and nothing else. `impls/MorphInk.ts` is the worked example. See "The raymarch kit" in the README.

**`swarm-kit` is `impls/ParticleField.ts`**, one compute-simulated pool from ten thousand to half a million, with drag, gravity, curl noise, attraction to a point and the three boids terms on a uniform grid, all as knobs, drawn as velocity-aligned streaks that shrink to round points. A study on it is a `ParticleProfile` in `impls/particles.params.ts` and a knob subset in `studies/impls.ts`; the dust and the sparks are the first two, and murmuration, school and fireflies need nothing new built. See "The particle field" in the README.

**`canvas-sampler` is `SceneContext.canvas()`**, which hands an ink the half of the post stack's history the inks are not drawing into. Two things go with it: it is one frame behind, and it is a loop, so an ink reading it has to stay sparse or keep its gain under one. `impls/CanvasQuadInk.ts` is the worked example and is not a study. See "Implementations" in the README.

## Space and time

| id           | kind | what you see                                                                                        | how                                                       | music                    | moments | tension does                      | cost   | tier | status |
| ------------ | ---- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------ | ------- | --------------------------------- | ------ | ---- | ------ |
| `wormhole`   | flow | a tube you fall through, walls made of the picture itself, streaks stretching at speed. Time travel | raymarched tube, canvas as wall texture, outward feedback | trance, techno, prog     | G B D   | speed climbs, tube narrows        | heavy  | S    | open   |
| `black-hole` | flow | the whole picture bends round a dark disc with a burning ring. Bass feeds the ring                  | lens warp of the canvas plus one ring ink                 | dubstep, bass, doom      | B D     | disc grows, pull strengthens      | medium | S    | open   |
| `nebula`     | ink  | slow coloured gas clouds with stars inside, hue from the key                                        | raymarched 3D noise, half res, glint threshold            | ambient, downtempo, prog | I R O   | clouds thin and darken            | heavy  | S    | open   |
| `starfield`  | ink  | points streaming past in depth                                                                      | instanced points, depth sorted by speed                   | trance, synthwave, house | G B     | warp speed, points become streaks | cheap  | A    | open   |
| `orbits`     | ink  | a few bodies circling on rings, one per band, leaving arcs                                          | analytic orbits, period locked to the beat                | minimal, IDM, classical  | I G R   | orbits tighten toward the centre  | cheap  | A    | open   |
| `signal`     | ink  | a scanning radio sweep with pulses of unknown glyphs. The alien one                                 | polar sweep line plus glyph atlas lit by onsets           | IDM, electro, glitch     | I B     | sweep quickens, glyphs multiply   | cheap  | B    | open   |
| `beam`       | ink  | a cone of light from above with motes rising up through it. Abduction                               | cone mask, motes ride the flow upward                     | psybient, dub            | B R     | cone narrows, motes accelerate    | cheap  | B    | open   |
| `fleet`      | ink  | small craft in formation crossing the frame, engines flaring on hits. The one literal space idea    | swarm-kit in formation mode, quad sprites with glow       | synthwave, game music    | G       | formation closes up               | medium | B    | open   |

## Earth, water, weather

| id          | kind | what you see                                                                               | how                                                        | music                        | moments | tension does                          | cost   | tier | status |
| ----------- | ---- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------- | ------- | ------------------------------------- | ------ | ---- | ------ |
| `ridgeline` | ink  | mountain ranges in layers, their outline is the spectrum, scrolling past with mist between | height-kit, 4 parallax layers, ridge lines only (sparse)   | rock, folk, post-rock, indie | I G R   | scroll speeds, peaks sharpen          | medium | S    | open   |
| `ocean`     | ink  | a sea surface to the horizon, swell height is the energy, light glints on treble           | height-kit waves, glints only above threshold              | ambient, downtempo, reggae   | I G R O | sea flattens and goes still           | medium | S    | open   |
| `lightning` | ink  | branching bolts on the biggest hits, afterglow hangs in the canvas                         | recursive midpoint branches on CPU, line quads, flash safe | metal, dubstep, DnB          | D       | none. Held back, fires on impact      | cheap  | S    | open   |
| `aurora`    | ink  | tall slow curtains of light that sway, colour from the chord                               | layered noise ribbons, vertical falloff                    | ambient, classical, acoustic | I R O   | curtains lower and dim                | medium | S    | open   |
| `rain`      | ink  | streaks falling, a ring where each one lands                                               | particle streaks, spawns ripple events                     | lo-fi, jazz, trip hop        | I G R   | rain thins to single drops            | cheap  | A    | open   |
| `ripple`    | flow | rings of displacement spreading from where hits land                                       | analytic ring sum, 8 live rings                            | lo-fi, dub, downtempo        | G R     | rings come faster                     | cheap  | A    | open   |
| `waterfall` | flow | the picture pours downward and breaks into mist at the bottom                              | drip flow plus a mist ink at the base                      | downtempo, liquid DnB        | G R O   | the fall stops. Released on the drop  | medium | A    | open   |
| `wind`      | flow | gusts crossing the frame, carrying whatever is drawn with them                             | directional curl noise, gust envelope from swell           | folk, indie, acoustic        | I G R   | the gust holds its breath, then blows | cheap  | A    | open   |
| `embers`    | ink  | sparks lifting off a bed of fire at the bottom edge                                        | flame noise strip plus particles that ride the flow        | metal, rock, dark DnB        | G D     | bed glows hotter, fewer sparks        | medium | A    | open   |
| `snowfall`  | ink  | slow flakes at three depths                                                                | dust pool with depth layers and sway                       | classical, ambient           | I R O   | flakes hang in the air                | cheap  | B    | open   |
| `clouds`    | ink  | a sky in time lapse                                                                        | 2D noise with wind advection, rim light                    | post-rock, ambient           | I R O   | clouds race                           | medium | B    | open   |

## Living things

| id             | kind | what you see                                                                   | how                                                     | music                      | moments | tension does                          | cost   | tier | status |
| -------------- | ---- | ------------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------- | ------- | ------------------------------------- | ------ | ---- | ------ |
| `murmuration`  | ink  | thousands of birds moving as one body, folding and splitting on the beat       | swarm-kit, points, scatter on hits                      | DnB, IDM, orchestral       | G B D   | the flock balls up tight, then bursts | medium | S    | open   |
| `chord-petals` | ink  | a flower of twelve petals, one per note. The notes sounding are the petals lit | chroma to 12 petal quads, opens on release              | jazz, classical, soul, pop | I G R   | petals close to a bud                 | cheap  | S    | open   |
| `reaction`     | ink  | living coral and cell patterns that grow, split and heal                       | Gray-Scott compute, feed and kill rates from the packet | minimal, IDM, techno       | G R     | pattern tightens into fine spots      | medium | S    | open   |
| `jellyfish`    | ink  | a few soft bells that pulse on the beat and trail tendrils                     | SDF bells, tendrils as verlet ribbons                   | downtempo, chillout, dub   | G R     | they sink and slow                    | medium | A    | open   |
| `growth`       | ink  | branches that grow a segment per beat and fork on each new phrase              | L-system on CPU, line quads, seeded by section          | folk, indie, post-rock     | I G B   | growth races                          | cheap  | A    | open   |
| `fireflies`    | ink  | warm points that blink in slowly syncing waves                                 | swarm-kit, blink phase coupled to beatPhase             | acoustic, lo-fi, country   | I R O   | blinking falls into step              | cheap  | A    | open   |
| `school`       | ink  | fish turning together, flashing silver as they turn                            | swarm-kit, quads, brightness from turn rate             | house, funk, disco         | G       | the school tightens                   | medium | B    | open   |
| `eye`          | ink  | one huge iris. The fibres are the spectrum, the pupil opens on bass            | polar spectrum texture, pupil radius from lowEnd        | trip hop, dark ambient     | I B R   | pupil shrinks to a pinhole            | cheap  | A    | open   |

## Shape and machine

| id              | kind | what you see                                                                                       | how                                                       | music                     | moments | tension does                     | cost   | tier | status |
| --------------- | ---- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------- | ------- | -------------------------------- | ------ | ---- | ------ |
| `cymatics`      | ink  | sand on a vibrating plate. The pattern is set by the notes actually playing. You see the sound     | Chladni modes summed from the top spectral peaks          | any tonal music           | I G R   | pattern sharpens to thin lines   | cheap  | S    | open   |
| `shape-morph`   | ink  | one solid in the middle that turns and melts from form to form, a new form each section            | raymarch-kit, SDF blend between solids, faceted rim light | electro, prog, IDM        | G B D   | the form shrinks and spins up    | heavy  | S    | built  |
| `grid-3d`       | ink  | a neon grid floor to the horizon that ripples with the bass                                        | height-kit as grid lines only                             | synthwave, house, electro | G B     | grid rushes toward you           | cheap  | S    | open   |
| `liquid-chrome` | ink  | a blob of liquid metal that wobbles with the bass and reflects the rest of the picture. 3D texture | raymarch-kit metaballs, canvas-sampler as the reflection  | dubstep, trap, bass       | G D     | blob pulls into a sphere         | heavy  | S    | open   |
| `echo-shapes`   | ink  | shapes filled with the picture itself, so it repeats inward. Hall of mirrors                       | instanced n-gons textured by canvas-sampler               | electro, funk, disco      | G D     | shapes shrink and multiply       | medium | S    | open   |
| `lasers`        | ink  | club laser fans sweeping through haze, on the beat                                                 | analytic beams with soft falloff, angle from beatPhase    | house, trance, techno     | G D     | fans close to a single beam      | cheap  | S    | built  |
| `city`          | ink  | flying over a skyline at night. Tower heights are the spectrum, windows light on treble            | height-kit as boxes, window mask texture                  | hip hop, synthwave, trap  | G B     | flight speeds up, towers rise    | heavy  | A    | open   |
| `matrix-rain`   | ink  | falling columns of glyphs, speed from the pace, brightness from the bands                          | glyph atlas, per column state in a buffer                 | techno, industrial, IDM   | G B     | columns speed up, glyphs flicker | cheap  | A    | open   |
| `scope`         | ink  | left channel against right as one glowing knot. Ribbon's cousin                                    | XY plot of the stereo waveform, same path as ribbon       | any with wide stereo      | G B D   | knot shrinks                     | cheap  | A    | open   |
| `harmonograph`  | ink  | a pen drawing slow looping curves, the ratios are the intervals in the chord                       | parametric curve from chroma peaks, drawn over a phrase   | jazz, classical, ambient  | I R O   | pen speeds up, curve tightens    | cheap  | A    | open   |
| `stained-glass` | ink  | panes of coloured glass, each lit by a note, leading between them                                  | voronoi cells, only edges and lit cells drawn             | choral, gospel, classical | I G R   | panes dim toward the middle      | cheap  | A    | open   |
| `moire`         | ink  | two fine ring patterns sliding over each other, throwing big slow interference shapes              | two analytic gratings, offset by beat and swell           | techno, minimal           | G       | gratings converge                | cheap  | A    | open   |
| `glyph-grid`    | ink  | a grid of cells lit by band and beat                                                               | instanced quads                                           | techno, electro           | G       | grid subdivides                  | cheap  | B    | open   |
| `strobe-bars`   | ink  | hard vertical bars on the beat, built inside the flash rule                                        | analytic bars, rate limited in the def                    | hardstyle, techno         | D       | bars narrow                      | cheap  | B    | open   |
| `tessellate`    | ink  | tiles that morph from one interlocking shape to another                                            | SDF tile blend on a wallpaper group                       | IDM, math rock            | G       | tiles shrink                     | medium | B    | open   |

## Trippy

| id              | kind | what you see                                                                         | how                                                         | music                     | moments | tension does                  | cost   | tier | status |
| --------------- | ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------- | ------- | ----------------------------- | ------ | ---- | ------ |
| `mirror-fold`   | flow | the whole canvas folded into a kaleidoscope, whatever else is drawing                | fold the feedback lookup by angle. Works over every ink     | house, psych, disco       | G D     | fold count steps up on impact | cheap  | S    | open   |
| `oil-slick`     | ink  | slow marbled liquid with rainbow sheen sliding over it                               | domain warped noise, thin film colour, edges only           | psych, downtempo, soul    | I G R   | marbling tightens             | medium | S    | open   |
| `mandala`       | ink  | a breathing mandala built ring by ring, inner ring the beat, outer rings the harmony | polar SDF layers from chroma and beatPhase                  | psytrance, world, ambient | I G R   | rings draw inward             | cheap  | S    | open   |
| `polar-twist`   | flow | rotation that changes with distance from the centre. The tie-dye spiral              | analytic field                                              | psych, jam, funk          | G R     | twist tightens                | cheap  | A    | open   |
| `vortex`        | flow | one big swirl about the middle                                                       | analytic field                                              | any tonal                 | B R     | spins up                      | cheap  | A    | open   |
| `julia`         | ink  | a fractal coastline that reshapes as the key moves                                   | Julia set, constant from keyHue and swell, edges only, half | prog, psytrance           | G B     | zooms in                      | heavy  | A    | open   |
| `lattice-warp`  | flow | the classic MilkDrop sine grid wobble                                                | analytic field                                              | any                       | G       | amplitude grows               | cheap  | A    | open   |
| `shear-bands`   | flow | horizontal bands sliding against each other                                          | analytic field                                              | techno, electro           | G       | band count rises              | cheap  | B    | open   |
| `gravity-wells` | flow | a few orbiting attractors bending the picture                                        | analytic field                                              | ambient, IDM              | R I     | wells close in                | cheap  | B    | open   |
| `drip`          | flow | slow downward melt                                                                   | analytic field                                              | doom, lo-fi, trip hop     | R O     | stops. Releases on the drop   | cheap  | B    | open   |
| `ink-drops`     | ink  | big soft blooms on sub hits                                                          | dye emitter variant                                         | lo-fi, dub                | G R     | fewer, larger                 | cheap  | B    | open   |
| `bubbles`       | ink  | rising soft circles, popped by treble hits                                           | particle quads with rim only                                | pop, disco                | G R     | rise faster                   | cheap  | B    | open   |
| `constellation` | ink  | points joined by lines, laid out from the chroma                                     | 12 points, lines between sounding notes                     | ambient, classical        | I R     | lines shorten                 | cheap  | B    | open   |

## Light and dark

The moods Colin named: good, evil, god, devil, Buddha. Built as light behaving a certain way.

| id              | kind | what you see                                                                          | how                                                     | music                       | moments | tension does                     | cost   | tier | status |
| --------------- | ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------- | ------- | -------------------------------- | ------ | ---- | ------ |
| `god-rays`      | look | shafts of light pouring from above through everything else on screen                  | radial blur of the bright pass from a moving source     | gospel, choral, uplifting   | B D R   | source rises, shafts narrow      | medium | S    | open   |
| `void-tendrils` | ink  | black smoke that creeps in from the edges and eats the light. Evil                    | subtract-blend, noise tendrils, recoil on hits          | metal, dark DnB, industrial | B R     | tendrils close toward the centre | medium | S    | open   |
| `eclipse`       | ink  | a black disc with a thin burning corona, flares on hits                               | subtract-blend disc plus corona ring ink                | doom, dark ambient, dubstep | I B     | corona thins to a hairline       | cheap  | A    | open   |
| `enso`          | ink  | one brush circle painted slowly over a phrase, then it fades and the next begins. Zen | polar brush stroke with dry-brush noise, one per phrase | ambient, meditation, world  | I R O   | the stroke pauses                | cheap  | A    | open   |
| `sacred-lines`  | ink  | flower of life and nested solids in thin lines, segments lighting with the chord      | precomputed line set, lit by chroma                     | psybient, new age, choral   | I G R   | lines fade from the outside in   | cheap  | A    | open   |
| `heat-shimmer`  | look | the air wobbles like over a fire                                                      | small noise offset on the composite lookup              | metal, stoner rock          | G D     | shimmer grows                    | cheap  | B    | open   |

Casts for these moods: **Heaven** (god-rays, aurora, stained-glass, clean-glass), **Hell** (embers, void-tendrils, heat-shimmer, lightning), **Zen** (enso, mandala, ripple, film).

## Looks

| id               | kind | what it does                                                              | music                 | moments | tier | status |
| ---------------- | ---- | ------------------------------------------------------------------------- | --------------------- | ------- | ---- | ------ |
| `neon`           | look | high bloom, saturated ridges on black                                     | EDM, synthwave        | G D     | S    | open   |
| `spectral-split` | look | light breaks into rainbow fringes at bright edges, wider on hits. Rainbow | psych, pop, disco     | G D     | S    | open   |
| `mono`           | look | colour drained toward one hue                                             | minimal, dark, builds | B R     | A    | open   |
| `crt`            | look | scanlines, slight curve, phosphor trails                                  | synthwave, chiptune   | G       | A    | open   |
| `datamosh`       | look | blocks of the picture smear and stick on hits                             | glitch, dubstep, trap | D       | A    | open   |
| `thermal`        | look | the picture remapped to a heat camera palette                             | industrial, techno    | G D     | B    | open   |
| `ink-wash`       | look | inverted: dark ink on warm paper. Needs subtract-blend end to end         | jazz, classical, folk | I G R   | B    | open   |

## Casts worth pinning

Recipes, not new code. Each becomes a JSON in `src/studies/casts/` once its parts are built.

| cast       | made of                                        | for                 |
| ---------- | ---------------------------------------------- | ------------------- |
| Plume      | the merged fluid cast (see phase 1)            | anything soft       |
| Tie-dye    | polar-twist, dye-plumes, spectral-split        | psych, jam, funk    |
| Outrun     | grid-3d, ridgeline, starfield, crt             | synthwave           |
| Deep Space | nebula, orbits, curl-drift, film               | ambient             |
| Storm      | rain, wind, lightning, clouds, mono            | rock, metal         |
| Reef       | ocean, jellyfish, caustics, school             | downtempo, reggae   |
| Club       | lasers, beat-pump, strobe-bars, neon           | house, techno       |
| Heaven     | god-rays, aurora, stained-glass, clean-glass   | choral, uplifting   |
| Hell       | embers, void-tendrils, heat-shimmer, lightning | metal, dark DnB     |
| Zen        | enso, mandala, ripple, film                    | meditation, ambient |

## Coverage map

The check that the library fits all music. Every cell needs at least two studies that are at home there, or Auto will repeat itself. "Now" is what is built today.

| song feels like         | now                           | after the S tier                               |
| ----------------------- | ----------------------------- | ---------------------------------------------- |
| soft, slow, tonal       | lazy-fluid, dust, caustics    | + aurora, nebula, ocean, chord-petals          |
| soft, slow, dark        | thin                          | + void-tendrils, reaction                      |
| mid, groovy, tonal      | fractal-glints takes it all   | + mirror-fold, oil-slick, mandala, echo-shapes |
| mid, steady, electronic | beat-pump, tunnel, beat-rings | + grid-3d, lasers, wormhole                    |
| acoustic, organic       | nothing made for it           | + ridgeline, cymatics, chord-petals            |
| fast, hard, bright      | turbulent-fluid, sparks       | + murmuration, shape-morph, lightning          |
| heavy, hard, dark       | shards, hard-clean            | + black-hole, liquid-chrome, void-tendrils     |
| big build               | implode, riser-streaks        | + wormhole, black-hole, god-rays               |
| big drop                | radial-burst (never reached)  | + lightning, liquid-chrome, lasers             |

The "mid, groovy, tonal" row is why so much music lands in the kaleidoscope: `fractal-glints` is the only ink at home there that fits groove. It needs rivals more than it needs retuning.

## Build order

```text
Wave 0   the six shared pieces                                 (no study starts before these)
Wave 1   S tier, cheap:   cymatics, chord-petals, mirror-fold, grid-3d, lasers, lightning, mandala
Wave 2   S tier, medium:  murmuration, reaction, ridgeline, ocean, aurora, oil-slick, echo-shapes, god-rays, void-tendrils, black-hole
Wave 3   S tier, heavy:   wormhole, nebula, shape-morph, liquid-chrome      + looks: neon, spectral-split
Wave 4   A tier by coverage gap, then the casts
B tier   only when a gap calls for it
```

Four or five cards in flight at a time. Each wave mixes moods so Auto gets broader every merge, and no two cards in a wave share a shared piece that is still moving.

## Test music

Colin's library is at `M:\Media\Music` (read only, never delete). It is deep in DnB, dubstep, house, trance, techno, metalcore and downtempo. For the coverage test it is thin or empty in: classical and orchestral, jazz, hip hop, R&B and soul, country and folk, latin, reggae and dub, gospel and choral, pop, ambient and drone. A few tracks of each are needed before the "fits all music" claim can be tested.
