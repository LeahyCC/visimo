# Mirror fold

The plan for the `mirror-fold` study, written before the code. Update it in
the same push as any change of plan.

## What it draws

The whole canvas folded into a kaleidoscope, whatever else is drawing under
it. It is a flow, and what it folds is the feedback pass's own lookup into
last frame's history: the picture the inks just drew is repeated round the
frame in mirrored wedges, with a slow swirl and a touch of outward zoom
carrying the pattern so it reads as turning and not as a still transfer.

## What the references teach

Three things were held in mind while picking the look, none of them a picture
to copy but each a property to build to:

- **A real optical kaleidoscope**, the toy with two mirrors and loose coloured
  glass. What makes one striking is that the seam between wedges is invisible
  unless you look for it: the reflection is exact, so a shape that crosses a
  seam reads as one shape and not as two halves that fail to line up. The
  glass sits on true black felt, so the colour is what carries the eye and
  not a haze filling the gaps between fragments. This is the reason the fold
  turns the angle exactly (`foldAngle`, a mirror about each wedge boundary)
  rather than warping toward it: a partial turn is a visible seam, which a
  toy kaleidoscope never has.
- **MilkDrop presets built on a mirrored warp** (the family that traces back
  to Geiss's kaleidoscope mode and lives on in dozens of `martin` and `Flexi`
  presets). What separates the ones people still screenshot from the ones
  that read as noise is restraint in the sector count and in the turn speed:
  six to eight wedges holds a shape large enough to be seen inside one of
  them, and a slow drift round the circle reads as a mandala breathing rather
  than a wheel spinning. The failures in that same family are the ones that
  push the count into the twenties and spin fast, which is indistinguishable
  from static once the wedges are narrower than anything drawn in them, the
  exact failure `MAX_FOLD` and the swirl's rest value are picked to avoid.
- **The Winamp-era screenshots that still get posted** (AVS and MilkDrop
  kaleidoscope presets from the early 2000s, the ones with real symmetry
  rather than a plugin's default radial blur). The ones that hold up are the
  ones with a dark field between the lit shapes: a fold multiplies whatever
  is under it, so a busy or hazy source multiplies into a flat wash of
  average brightness, and the presets that still read as sharp are built over
  a source that keeps its blacks. That is why this study folds the canvas
  and touches no other number in the feedback pass: the decay, the floor, the
  fade and the hold are exactly what they would be without the fold, so
  whatever kept the picture's blacks before the fold still does.

## When it fires

`feedback.foldMix` is how far the fold is applied, and it comes up with the
level and the beat rather than with `tension` alone: `energy` and `swell`
bring it in over a passage, `beatPulse` gives it a lift on every hit. A track
that never winds up (most house, psych and disco never gets near a scored
`tension` of 1) is still folded through its groove, where a study driven only
by `tension`, `release` or `impact` would draw a plain swirl for the whole
song and never show what it is for.

`feedback.fold` is the sector count, and it is the one number here that does
answer tension and impact: it steps from 6 at rest to 8 through a build and to
10 on impact, 12 at the two together. The count is snapped to a whole even
number by the pass (`foldSectors`), so these are steps and not a slide, and
stepping it changes only where the history is read from and never how much
light there is (`mirrorFold.test.ts` holds that against the pass's own
reference), which is what keeps a count that steps on every hit inside the
flash rule.

## Home and moments

Home is the plain middle of every axis, reach 0.4: house, psych and disco,
the crowded cell the coverage map gives to `fractal-glints` alone. Moments
are the catalogue's, groove and drop, with half a build because a fold
tightening is worth watching a riser through. See the doc comment on
`MIRROR_FOLD` in `src/studies/defs/mirror-fold.ts` for the numbers against
`src/director/tracks.fixture.ts`.

## Files

- `src/studies/defs/mirror-fold.ts`, the study: the analytic flow's own swirl
  and radial terms, no new term, plus the canvas patch that folds.
- `src/post/params.ts`, the fold's arithmetic (`foldAngle`, `foldSectors`,
  `foldHold`, `foldWeight`) and where it rides in the uniform.
- `src/shaders/post.feedback.wgsl`, the transcription of that arithmetic in
  the pass.
- `src/studies/types.ts`, `StudyCanvas`, the shape of a flow's patch on the
  canvas.
- `src/studies/cast.ts`, `patchCanvas`, where a patch is merged over the
  canvas the cast is drawing on.
- Tests: `src/post/params.test.ts` holds the fold's geometry, the flash rule
  and that every canvas naming neither knob is untouched; `src/studies/
mirrorFold.test.ts` holds what the study asks for and the director's fade
  in and out of the patch. The generic bar is `registry.test.ts`.

## Doubts

The turn speed and the resting fold count are reasoned from a real
kaleidoscope's proportions and from the MilkDrop presets that still read
well, not captured off a screen. If the pattern reads as spinning rather than
breathing on a real track, the swirl's rest value is the number to lower
first; if six wedges read as too few to look like a kaleidoscope beside a
busy ink, the resting fold count is the one to raise, short of the point
where a wedge is narrower than the marks inside it.
