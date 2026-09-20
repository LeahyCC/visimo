# Studies: handoff

For whoever picks this up with a fresh context. Read `docs/canvas-plan.md` first; this continues it. Written 2026-09-19.

The job: build a large library of studies, and the machinery that lets the song choose which of them are on screen, moment by moment. MilkDrop is the bar. It has thousands of presets and picks between them at random on a timer. We will have fewer, better pieces, and the music will do the picking.

## Where things stand

Batch 1 of the canvas plan is merged. Two cards may still be open when you start; check the board and `gh pr list` before anything else.

| Piece                                            | State                         |
| ------------------------------------------------ | ----------------------------- |
| Feedback per second, brightness rate-proof       | merged, PR 8                  |
| A scene's flow carries the feedback, Drift       | merged, PR 10                 |
| `hardness` in the packet (row 46)                | merged, PR 9                  |
| Emitters kept off the walls                      | merged, PR 11                 |
| Fluid as a flow under Kaleidoscope, Melt         | merged, PR 12                 |
| Waveform ribbon, line and circle, auto-levelled  | merged, PR 13                 |
| Every post stage moves with the music (card F)   | running when this was written |
| `pace` reads the same at any frame rate (card G) | running when this was written |

Colin has watched Drift and Melt on real tracks. His words: it looks great, a bit oversaturated on intense songs, and it needs a bunch of studies rolling in and out. The oversaturation note is inside card F. The rest is this document.

What exists today is still presets, each naming one scene: Plume, Wash, Drift (Fluid), Prism, Melt (Kaleidoscope). There is one persistent picture now (the feedback history, carried by a flow, with floor and ceiling), a ribbon drawn into it, and an optional fluid flow under any scene. There is no study registry, no notion of a moment, and nothing that chooses. Those are what to build.

## What Colin is getting at

He asked for studies to carry tags, "buildup study, drop study", so the song can call for them. Underneath that is one idea: **the picture should tell the same story the song tells.** A track is not a flat stream of loudness. It sets something up, winds it tight, pays it off, and lets it rest. A visualizer that reacts only to the last few milliseconds cannot show that, and MilkDrop never could.

So there are two separate questions, and a study answers both:

```text
WHAT KIND OF SONG IS THIS?             WHERE IN THE SONG ARE WE?
slow, tens of seconds                  per section, seconds
------------------------------         ------------------------------
character space (canvas-plan.md)       the moment
drive, weight, tonality,               intro, groove, build,
steadiness, hardness                   drop, break, outro

picks the FAMILY of studies            picks WHICH of the family is on now
lo-fi never gets shards                a build gets the tunnel, the drop
hardstyle never gets dust              gets the burst
```

A tag is the second question. Keep his word for it in the UI and the docs, but make it a number under the hood, for three reasons:

1. Real songs are not clean. A build bleeds into a drop. Hard labels flicker at the edges; weights blend.
2. It matches how the character space already works: no classifier, no list to maintain.
3. It lets one study serve two moments at different strengths without being written twice.

The part that beats MilkDrop outright: **a build is a prediction.** It is the one place in a song where what happens next is nearly certain. So a study is not only chosen by the moment, it is handed the tension as an input and can wind up with it: tighten, pull in, drain colour, shorten its trails, speed its travel. Then the drop lands and everything it held back is released at once. Anticipation and payoff. Every study must say what it does with tension, even if the answer is "a little".

## The moment

Nothing in the extractor knows a build from a drop today. It knows `swell` (lifting or dropping against the last half minute), `novelty`, `section`, `recall`, `energy`, `pace`, `weight` and the band levels. That is nearly enough. Add a small estimator that turns those into slow levels, appended to the END of the packet (the indices in `F` are public API and Musimo pins a tag):

| Row       | Means                                          | Reads from                                                                                                                                        |
| --------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tension` | something is winding up                        | energy or brightness rising over 4 to 16 s, onset density rising (rolls), low end dropping out, a riser: treble and flux climbing with no new key |
| `release` | the payoff is happening                        | jumps when the low end comes back hard after tension with a novelty spike, then decays over a phrase                                              |
| `rest`    | the floor has dropped away                     | energy well under the track's own norm, pace low, low end thin                                                                                    |
| `impact`  | an event, not a level: the instant of the drop | the frame `release` jumps. Scenes read it from the packet the way they read a hit                                                                 |

`groove` needs no row: it is what is left when the other three are low. `intro` and `outro` are `rest` plus position in the track (nothing recalled yet, or energy falling with no tension).

Rules for it:

- Frame-rate and loudness independent, like everything else in the file. Card G fixed a bug of exactly this kind in `pace`; read what it found.
- Slow on purpose, except `impact`.
- `tension` must fall back on its own when a build fizzles. Not every riser ends in a drop.
- Test it on synthesised structure. `src/audio/synthetic.ts` renders patterns to samples and already has a breakdown and a drop. It needs a build: a snare roll that doubles, a rising noise sweep, the kick dropping out for the last bar. Required: tension climbs through the build and not before, impact lands within a beat of the drop, rest reads high in the breakdown, a track with no structure (steady house) sits in groove throughout.
- Expect to tune on real tracks. Synthetic passing is the start.

## What a study is

One small piece that does one job on the shared canvas. Three kinds, as in the plan:

- **Flow**: how the picture moves. Produces or modifies the velocity the feedback pass reads back along.
- **Ink**: what is drawn into the picture this frame. Fresh light, sparse. An ink that fills the frame every frame washes the canvas out; Melt's first cut did exactly that.
- **Look**: how the picture is shown. Bloom, tonemap, grain, split, vignette.

Every study declares, as data and not code:

```ts
type Study = {
  id: string
  kind: 'flow' | 'ink' | 'look'
  name: string
  /** Where it belongs in the character space, 0 to 1 per axis, and how wide its welcome is. */
  home: { drive: number; weight: number; tonality: number; steadiness: number; hardness: number }
  reach: number
  /** How well it suits each moment, 0 to 1. These are Colin's tags. */
  moments: {
    intro: number
    groove: number
    build: number
    drop: number
    rest: number
    outro: number
  }
  /** Its own knobs, resting values, and the mapping rows that make it move. */
  knobs: Record<string, number>
  mapping: Mapping[]
  /** What it costs, so the director can keep a cast inside the frame budget. */
  cost: 'cheap' | 'medium' | 'heavy'
  /** Studies it must not share a cast with (two full-frame inks, two flows that fight). */
  excludes?: string[]
}
```

Every study also receives, every frame: the packet, its own resolved knobs, and its **presence**, 0 to 1, which the director fades. At presence 0 it draws nothing and costs nothing. A study never decides for itself whether it is on.

This replaces the per-scene preset union in `src/presets/types.ts`. A preset becomes a pinned cast: a list of studies with overrides, for a host that wants a fixed look. Plume, Wash, Prism, Drift and Melt must survive as pinned casts that look as they do now. This is the breaking release the plan warned about; Musimo consumes visimo at a tag, so cut a new tag and do not move the old one.

## The director

The thing that chooses. It is domain logic, so it lives beside the presets (`src/presets/` or a new `src/director/`), pure and fully unit tested, with no GPU in it.

```text
every frame:   character (slow)  ─┐
               moment (medium)   ─┼─►  score = closeness to home × moment fit
               section, recall   ─┘

at a section boundary, or on impact:
   pick a cast  =  1 flow  +  1 to 3 inks  +  1 look
                   inside the cost budget, honouring excludes
   a section that comes back gets the cast it had

between boundaries:
   presences glide (seconds), nothing pops
   a challenger needs a clear margin to unseat a member, so close scores do not flicker
   tension is passed to every live study
```

Things to get right:

- **Changes land on the music.** Swap on `section` change or `impact`, never on a timer. The extractor confirms a section about six seconds late (the README says why); `novelty` and `impact` are the fast signals, so start the fade on those and let the confirmed section settle the cast.
- **The drop is a cut, not a fade.** Everything else glides. On `impact` the new cast may arrive in a few frames. This is the single biggest moment in most tracks; do not smooth it away.
- **Determinism.** Same song, same picture. Seed any choice from the section id and the track's character, not from `Math.random`.
- **The first thirty seconds.** Character needs 10 to 30 s to settle, so open on a neutral cast and drift. Add an optional host prop for a starting character (a genre tag, or the values saved from the last play of this track).
- **Variety without randomness.** With a big library, several studies will score close. Rotate among the top few by section rank, so the second verse is a cousin of the first and not a copy, while a returning section still recalls its own cast.

## The catalogue

A starting list, deliberately long. It is a menu, not a contract: build the ones that earn their place and cut the ones that do not. Moment letters: I intro, G groove, B build, D drop, R rest, O outro. Capital means strong fit.

### Flows

| Study           | What it does                                                  | Moments | Character      | Tension does                      |
| --------------- | ------------------------------------------------------------- | ------- | -------------- | --------------------------------- |
| lazy fluid      | today's solver, low vorticity, slow emitters                  | I G R O | soft, slow     | slows further, pulls emitters in  |
| turbulent fluid | high vorticity, fast emitters, fine filaments                 | G D     | fast, bright   | vorticity climbs                  |
| beat pump       | zoom pulse that lands on the predicted beat (`beatPhase`)     | G D     | steady, hard   | pulse depth grows                 |
| tunnel          | steady inward travel                                          | G B     | steady         | accelerates toward the drop       |
| implode         | everything pulled to the centre                               | B       | any            | pull strength is the tension      |
| radial burst    | outward push from the centre on hits                          | D       | hard           | none; fires on impact             |
| vortex          | one big swirl about the middle                                | B R     | tonal          | spins up                          |
| mirror fold     | kaleidoscope symmetry applied to the canvas itself            | G D     | tonal, steady  | symmetry count steps up on impact |
| shear bands     | horizontal bands sliding against each other                   | G       | steady, techno | band count rises                  |
| polar twist     | rotation that varies with radius                              | G R     | tonal          | twist tightens                    |
| ripple          | rings of displacement from where hits land                    | G R     | soft           | rings come faster                 |
| gravity wells   | a few orbiting attractors bending the picture                 | R I     | slow, tonal    | wells close in                    |
| lattice warp    | the classic MilkDrop sine grid wobble                         | G       | any            | amplitude grows                   |
| drip            | slow downward melt                                            | R O     | soft, heavy    | stops; releases on drop           |
| curl drift      | analytic curl noise, no solver. Also the WebGL2 fallback flow | I R O   | any            | speeds up                         |

### Inks

| Study          | What it draws                                              | Moments | Character      | Tension does                        |
| -------------- | ---------------------------------------------------------- | ------- | -------------- | ----------------------------------- |
| dye plumes     | today's Plume emitters, one per band                       | I G R   | soft to mid    | dye thins                           |
| ribbon         | the waveform, line or circle (built)                       | G B D   | any            | circle shrinks, line thins          |
| fractal glints | Prism's raymarched ridges, bright parts only, half size    | G D     | hard, tonal    | zoom sweeps in                      |
| shards         | flat sharp polygons thrown on hits                         | D       | hard           | none; held back, released on impact |
| sparks         | particles off treble hits that ride the flow               | G D     | bright, fast   | rate climbs                         |
| beat rings     | rings expanding from the centre on predicted beats         | G B     | steady         | spacing halves, like a roll         |
| riser streaks  | radial lines converging on the centre, lengthening         | B       | any            | is the tension, drawn               |
| spectrum ring  | the bands as bars around a circle                          | G       | any            | ring contracts                      |
| chord petals   | twelve petals from the chroma, lit by the notes sounding   | I G R   | tonal          | petals close                        |
| ink drops      | big soft blooms on sub hits                                | G R     | lo-fi, heavy   | fewer, larger                       |
| dust           | slow specks adrift in the flow                             | I R O   | soft, slow     | specks gather                       |
| starfield      | points streaming in depth                                  | G B     | steady, bright | warp speed                          |
| lightning      | branching bolts on the biggest hits                        | D       | hard           | none; impact only                   |
| strobe bars    | hard vertical bars on the beat (mind the flash rule below) | D       | hard, steady   | bars narrow                         |
| glyph grid     | a grid of cells lit by band and beat                       | G       | techno, steady | grid subdivides                     |
| terrain        | the spectrum as a scrolling landscape                      | G R     | mid            | scroll speeds                       |
| caustics       | soft moving light, like a pool floor                       | I R O   | soft, tonal    | dims                                |
| halo           | one central glow that breathes with energy                 | any     | any            | tightens to a point                 |
| constellation  | points joined by lines, laid out from the chroma           | I R     | tonal, slow    | lines shorten                       |
| bubbles        | rising soft circles, popped by treble hits                 | G R     | soft, bright   | rise faster                         |

### Looks

| Study        | What it does                                                        | Moments | Character    |
| ------------ | ------------------------------------------------------------------- | ------- | ------------ |
| warm soft    | low contrast, grain, gentle bloom                                   | I G R O | lo-fi, soft  |
| hard clean   | high contrast, no grain, split on the beat                          | G D     | hard         |
| neon         | high bloom, saturated ridges on black                               | G D     | bright, fast |
| mono         | colour drained toward one hue                                       | B R     | low tonality |
| film         | grain, vignette, slight weave                                       | I R O   | soft, slow   |
| squeeze      | vignette closes and colour drains as tension rises, opens on impact | B       | any          |
| impact flash | a few frames of lifted exposure on `impact`, within the flash rule  | D       | any          |

## The bar for "perfect"

A study is done when all of this is true. Put it in every study card's acceptance.

- **Nothing static.** Every knob it enables has a mapping row. Card F adds a guard test over presets; extend it over studies.
- **Black in silence.** A silent packet draws nothing. Prism's tests rely on this already.
- **Does not wash out.** At a full packet, saturation and intensity are at or under their resting values. An ink is sparse: state its worst-case coverage of the frame.
- **Says what tension does to it**, and a test shows the knob move.
- **Same at any frame rate.** Per second, never per frame. PR 8 is the worked example, including the trap: decay per second is not enough, the fresh frame's weight has to match too.
- **Inside budget.** State its GPU cost at 2560 by 1440 on the development GPU. A cast must hold 60 frames a second.
- **Plays well with others.** Looked at solo and in a cast of three.
- **Presence 0 costs nothing.** No passes encoded, no buffers uploaded.
- **WebGL2 does not throw.** It may skip the study.
- **Flash safe.** WCAG 2.3.1: no more than three flashes a second over a large area. Strobe bars, lightning and impact flash must be built to this, not tuned to it afterwards.
- **Documented.** A row in the README's study table, and its header comment says why, not what.

Agents on the board cannot see a GPU. Every study that comes back gets looked at by whoever is managing the run, on the real adapter with a real track, at three moments: a quiet passage, a build, and a drop. Most of batch 1 needed a fix that only showed up on screen (a blue haze, a washed-out Melt, a flat ribbon). Budget for it.

## Order of work

```text
1. Land F and G if they are still open. Re-read the presets afterwards; F rewrites their mappings.

2. The moment estimator.            audio only, no conflicts, can start at once
3. The study contract and registry. replaces the preset union; pinned casts keep the five looks
   + a study bench in the demo: solo any study, with sliders for character,
     moment, tension and an impact button, so a study can be judged without
     hunting for the right bar of the right song
4. The director.                    pure, tested, behind the contract
     2 can run alongside 3. 4 needs both.

5. Port what exists into studies: lazy fluid, turbulent fluid, dye plumes,
   ribbon, fractal glints, mirror fold, warm soft, hard clean.

6. New studies, in waves of four or five cards in parallel. Each wave should
   cover a gap, not pile onto one moment. Suggested first wave, because it
   completes the build-to-drop story end to end:
     riser streaks + implode + squeeze   (the build)
     radial burst + shards + impact flash (the drop)
   Second wave, the quiet end: dust, caustics, curl drift, film, chord petals.
   Third wave, the groove: beat pump, tunnel, beat rings, spectrum ring, sparks.
   Then whatever the library lacks. Watch whole tracks of different genres
   and write down the moments where the picture is wrong; those are the cards.

7. Curl drift doubles as the WebGL2 fallback flow. Then performance.
```

The study bench in step 3 is worth more than it looks. Without it, tuning a drop study means replaying the same eight bars for an hour.

## Running the board

This run used Colin's Kungfu Kanban board at `http://localhost:4747`. Load the `kungfu-todo` skill for the card format and read `Rules/kungfu.md` in the notes vault. What this run learned on top of those:

- Before dropping cards: Sensei to `suggest`, and `prWatchAutoFix` and `prWatchAutoFixCi` off, so nothing else spawns or merges. Both were set for this run; check they still are.
- The board's default permission mode here is `acceptEdits`, under which headless git stalls. Cards carry `permissions: bypassPermissions` in the file's frontmatter.
- Write `Repository:` in prompts, never `Repo:`. The importer reads `Repo:` as a working directory.
- Cards start with nothing. Paths, decisions, the rules of the repo and the five checks all go in the prompt. The batch 1 card file is the model to copy.
- `after:` only resolves titles inside one file. For a dependency across files, import the card, then `PATCH /api/tasks/:id` with `{"deps": ["<id>"]}` and `POST /api/tasks/:id/run`.
- After merging a card's PR: `PATCH` the card to `{"status":"done"}`, then `POST /api/prwatch/sweep`, or its dependents wait up to ten minutes for the next sweep. Then unlock and remove the worktree (the board locks them), and delete the branch locally and on origin.
- Three of five cards left a Vite server running in their worktree, which makes the folder undeletable on Windows. Find the `node.exe` whose command line names the worktree, stop it, then delete. New cards are told to stop their servers before finishing; check anyway.
- Review by sending a follow-up to the card that owns the branch (`POST /api/tasks/:id/followup` with `{"message": ...}`) when the fix needs the card's context or measurements. Make small fixes yourself on the PR branch from a detached checkout and push to the branch name.
- The board opens PRs with the raw prompt as the body. Rewrite every body before merging, in plain prose, with no template headings.
- Route frugally. Batch 1 used opus at high effort for the three hard cards and sonnet for the rest, and that split held up. A single study is a sonnet card. The contract and the director are opus cards.
- Verify every claimed check yourself on the PR head: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npx vite build`.

## Looking at it

- `npm run dev` serves the demo on `http://127.0.0.1:5174` with `strictPort`. A `.claude/launch.json` entry named `visimo-demo` exists in this worktree (git-ignored) for the Browser pane.
- The demo's default track is git-ignored. A copy lives at `C:\Users\cclea\.codex\worktrees\3ba7\visimo\demo\public\audio\Ecstasy Of Soul.flac`; copy it into `demo/public/audio/` of whichever checkout you serve. Drops are near 1:35.
- **The analyser hears the element after its volume control.** Setting the volume near zero to keep the room quiet silences the features and Prism goes black, which looks like a bug and is not. Use about 0.05 to 0.1.
- `window.visimo.setPost({...})` in the dev build changes post numbers live. It is how Melt was tuned.
- `data-scene`, `data-detail`, `data-post` and `data-preset` on the canvas are public API that Musimo's tests assert on. Extend them; do not change what they print for existing presets.

## Repo rules that bit or nearly did

- No `any`. `unknown`, then narrow.
- Domain rules live in the params and preset layer. Pure helpers stay generic.
- Comments say why. Match the density of the file, which in the extractor is high.
- No em dashes, anywhere, including commits and PR bodies.
- Prettier does the formatting; run it.
- Commits and PRs go out under Colin's name. No mention of AI or tools, no co-author trailer, branch names like `feature/...` and never a tool's name. Run the humanizer skill over anything a person will read.
- Code is the truth and docs drift. Update the README in the same piece of work as the code, and check what it claims before relying on it.

## Open questions for Colin

Worth asking early, since the answers change the cards:

1. Should a host be able to turn the director off and pin a cast? (Assumed yes.)
2. How much should the same song look the same twice? (Assumed: identical. Deterministic from the track.)
3. Is a hard cut on the drop wanted, or does he prefer everything to glide? (Assumed: cut.)
4. Which three tracks are the reference set? One lo-fi, one hardstyle, one in between. Tuning against his own ears beats any synthetic test.
