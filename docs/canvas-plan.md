# One canvas

A plan, not a description of the code. Nothing here is built yet. MilkDrop is the bar to clear; the aim is to go past it.

## Why MilkDrop still looks better

MilkDrop builds each frame out of the last one. It bends the previous picture, keeps nearly all of it, and draws a little new material on top. One drum hit is then smeared and folded for seconds.

```text
MilkDrop                          visimo today
--------                          ------------
last frame                        blank
   | bend it (warp mesh)            |
   | keep about 98%                 | draw the scene fresh
   v                                v
+ a little new material           + about 16% echo of the last frame
   |                                |
   v                                v
next frame, looping forever       next frame, echo gone in 3 frames
```

Measured against the code:

- Feedback keeps `amount x decay`, 0.22 x 0.72 by default, and Prism turns it off altogether.
- The echo is one zoom and one turn about the middle. MilkDrop bends every part of the screen differently.
- Nothing draws the sound itself. The analyser is only ever read for its spectrum, never the waveform.
- Fluid and Kaleidoscope are separate programs. Switching one for the other throws the picture away.
- Feedback runs per drawn frame, so a trail behaves differently at 60 Hz and 144 Hz.

## The shape

One picture that persists, and three kinds of thing acting on it.

```text
                     the music
                         |
      +------------------+------------------+
      v                  v                  v
    FLOW               INK                LOOK
    how the picture    what is drawn      how it is shown
    moves              into it
      |                  |                  |
    fluid velocity     dye emitters       bloom
    mirror fold        waveform ribbon    tonemap
    zoom and turn      fractal glints     grain, split
      |                  |                  |
      +-------->   ONE CANVAS   <-----------+
                keeps most of itself,
                carried along by FLOW,
                per second and not per frame
```

Plume stops being a scene: its solver becomes the flow under everything. Kaleidoscope stops being a scene: its mirror fold becomes a flow setting and its fractal becomes one kind of ink. Plume, Wash and Prism become three presets of the same engine, so moving between them is a blend and not a cut.

## Studies

A study is one small piece that does one job: one flow, one ink, or one look. The picture at any moment is a handful of studies running together on the one canvas.

| Kind | Study           | Reads as                    |
| ---- | --------------- | --------------------------- |
| Flow | lazy fluid      | slow, smoky drift           |
| Flow | turbulent fluid | fine, fast filaments        |
| Flow | beat pump       | zoom that lands on the beat |
| Flow | mirror fold     | kaleidoscope symmetry       |
| Flow | tunnel          | steady travel inward        |
| Ink  | dye plumes      | soft colour (today's Plume) |
| Ink  | waveform ribbon | the sound drawn as a line   |
| Ink  | fractal glints  | hard 3D detail (Prism)      |
| Ink  | shards          | sharp flat geometry on hits |
| Ink  | dust            | slow drifting specks        |
| Look | warm and soft   | low contrast, grain         |
| Look | hard and clean  | high contrast, split on hit |

The first three rows of ink and the two fluid flows are mostly code that exists. The rest is new and each is small.

One rule for every study, and for every preset built from them: nothing on screen is static. The scene, the feedback, the bloom, the chromatic split, the tonemap, the grain and the ribbon all move with the music. A study ships with its own mapping rows, and a test walks every preset and fails when an enabled stage has nothing driving it.

## The song picks the studies

A lo-fi track and a hardstyle track should not get the same studies. The extractor already knows most of what is needed, in the slow features that move over tens of seconds.

Describe the song as a point in a small space, with no genre labels:

| Axis       | From                               | Low end         | High end           |
| ---------- | ---------------------------------- | --------------- | ------------------ |
| drive      | `pace`, `tempo`                    | sparse, slow    | dense, fast        |
| weight     | `weight`                           | bright          | bass-led           |
| tonality   | `keyClarity`, averaged slowly      | drums and noise | chords and melody  |
| steadiness | `tempoConfidence`, averaged slowly | loose, rubato   | four to the floor  |
| hardness   | **new**: how sharp the onsets are  | soft, rounded   | clipped, distorted |

Each study says where in that space it belongs. Its strength is how close the song sits to it.

```text
                 hardness
                    ^
     shards  o      |      o  beat pump
  fractal glints o  |  o  mirror fold
                    |
  ------------------+------------------>  drive
                    |
        dust  o     |     o  turbulent fluid
   lazy fluid  o    |
     warm look o    |
```

So lo-fi (low drive, low hardness, high tonality) lands on lazy fluid, dye plumes, dust and the warm look. Hardstyle (high drive, high hardness, high steadiness) lands on beat pump, mirror fold, shards, the ribbon and the hard look. Everything between gets a mix, which is the point: no classifier, no list of genres to maintain, and a track that is half one thing gets half of each.

Rules that keep it from looking random:

- At most three or four studies live at once. The rest are at zero and cost nothing.
- Studies change only at a section boundary. `novelty` and `section` already mark those, so a change lands where the music changes.
- A section that comes back gets the studies it had. `recall` and the section id already carry that, the way Fluid's layouts do today.
- A study fades over seconds and needs a clear margin to displace another, so two close scores do not flicker.

Two honest limits:

- The slow features need 10 to 30 seconds to settle. A track opens on a neutral set and drifts to its own. A host that knows the genre or has played the track before can pass a starting point, as an optional prop.
- `hardness` does not exist. Onset strength is graded against the loudest recent hit, so it says how big a hit was for this track and nothing about how sharp hits are in general. A new row at the end of the packet is needed, and it has to be tuned against real tracks.

## Where this goes past MilkDrop

|         | MilkDrop                            | visimo                                            |
| ------- | ----------------------------------- | ------------------------------------------------- |
| Flow    | coarse grid, hand-written equations | a real fluid at every pixel, pushed by the music  |
| Hearing | bass, mid, treble, waveform         | beat predicted ahead, key, sections, recall       |
| Choice  | random preset on a timer            | the song chooses, and changes on its own sections |
| Colour  | 8-bit, burns to white               | half-float with a tonemap, already in place       |
| Trails  | blurred a little every frame        | sharper advection, so filaments survive           |
| Changes | crossfade between two presets       | one engine, so everything morphs                  |
| Depth   | flat                                | a raymarched fractal as one ink                   |
| Timing  | per frame                           | per second                                        |

## What changes in the code

1. Feedback leaves `post/PostStack.ts` and becomes the canvas stage, with decay and motion per second.
2. `scenes/Fluid.ts` shares its velocity texture, which is private today, so the canvas can be carried by it.
3. `scenes/Scene.ts` splits into a flow interface and an ink interface.
4. The audio client reads the waveform as well as the spectrum, for the ribbon.
5. `presets/types.ts` becomes one preset shape with one knob list, and the per-scene union goes.
6. The extractor gains `hardness`, and something new owns the song's place in the space and the study weights. That is domain logic, so it lives beside the presets and not in a pure helper.

## Risks

- Feedback near 1 in half-float can run away to white. It needs a cap on total energy.
- The WebGL2 fallback has no compute, so no fluid. It needs a flow made from plain maths.
- The fractal is expensive. As an ink it can draw at half size, since the canvas smears it anyway.
- `F` and `PACKET_LENGTH` are public and Musimo pins a tag. New rows go at the end, and the preset shape change is a breaking release.

## Order

```text
1. Spike: fluid velocity carries the feedback at high decay    a day, proves the look
2. Canvas stage, per second, with the mirror fold
3. Waveform ribbon
4. One preset shape; port Plume, Wash and Prism
5. The song's place in the space, and study weights from it
6. New studies, one at a time, each judged against real tracks
7. Fallback flow and performance
```

Step 1 comes first and is looked at before anything else is committed to. If it is not clearly better than today, the plan is wrong.

## Work plan

Two batches. The first is everything that can be built without changing the preset shape, so it can be looked at on real tracks before the breaking work starts.

### Batch 1: prove the look

```text
A  feedback per second
|
B  a scene's flow carries the feedback      E  hardness in the packet
|                                              (audio only, runs alongside)
C  the fluid runs as a flow under Kaleidoscope
|
D  waveform ribbon
|
F  everything moves with the music
```

| Card | What it does                                                                                            | Done when                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A    | Decay, zoom and turn are defined at 60 frames a second and converted by the real step                   | A trail lasts the same time at 60 and 144 Hz, and Wash looks as it did at 60                |
| B    | A scene may offer a velocity field; the feedback pass reads the last frame back along it, with a cap    | New preset Drift: Fluid with long trails that swirl with the dye, never white               |
| C    | The solver can run without drawing, under another scene                                                 | New preset Melt: the fractal smeared along a fluid the music pushes                         |
| D    | The analyser's waveform is drawn as a line into the scene's target, under the feedback                  | A ribbon that the trails turn into sheets, off by default                                   |
| E    | One new packet row, `hardness`, slow, loudness and frame rate independent                               | Clipped kicks read high and soft pads low in the synthetic tests                            |
| F    | Every post stage in every preset gets mapping rows, with a guard test and a range test over all presets | No enabled stage is left static, and no knob leaves its safe range at silence or full level |

Existing presets must not change in batch 1. Every new behaviour is off by default and switched on by a new preset.

The stop after batch 1 is deliberate: Melt and Drift are looked at against real tracks, next to MilkDrop. If they do not clearly beat today's Prism and Plume, batch 2 is rethought.

### Batch 2: one engine

1. One preset shape: a flow list, an ink list, a look, one mapping table. Port Plume, Wash, Prism, Drift and Melt. Breaking release.
2. The song's place in the space (drive, weight, tonality, steadiness, hardness), smoothed, with an optional starting hint from the host.
3. Study weights from that place, changing only on section boundaries, with a returning section recalling its set.
4. New studies one at a time: beat pump, tunnel, shards, dust, the two looks.
5. A flow made from plain maths for the WebGL2 fallback, then performance.

## Sources

- [MilkDrop preset authoring guide](https://www.geisswerks.com/milkdrop/milkdrop_preset_authoring.html), for the frame order, the warp mesh and the limits.
- [Butterchurn](https://github.com/jberg/butterchurn), MilkDrop in WebGL 2, MIT licensed.
- [WebGL fluid advection notes](https://ostefani.dev/tech-notes/webgl-fluid-advection), for MacCormack advection keeping thin filaments.
