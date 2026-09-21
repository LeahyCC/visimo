# Open leads

Things known to be wrong or unfinished that nobody is working on. Each was checked against the code on the date beside it, which matters more than where it came from: a lead that has gone stale should be deleted, not argued with.

Most of the first section comes from a full review of the repo on 2026-09-13. That review was written against a much older tree (a packet of 44 floats, presets and no studies), and more than half of it has since been done: the beat phase is predicted, mapped knobs are clamped by the registry's range guards, `recall` drives the director's memory, and a pump that is skipped keeps its `dt`. What is below is what was still true on 2026-09-20.

## From the 2026-09-13 review, still open

**Hits land late, and most of it is the FFT window.** One `AnalyserNode` at `fftSize` 4096 feeds everything (`src/audio/AudioGraph.ts`). That size is right for the sub band, where a bin is 11.7 Hz, and wrong for onsets: the window is 85 ms and its weight peaks in the middle, so a transient is about 42 ms old before it shows. With the flux lag (30 ms) and a frame for the worker's reply, a hit reaches the screen 65 to 100 ms after it sounded. The review's fix is a second analyser at `fftSize` 512, about an 11 ms window, feeding only the flux and the onset detectors, with the 4096 one kept for levels, chroma and tempo. It is the largest single thing left for how tight the picture feels. The beat phase hides it on steady music, since a predicted beat has no latency, and does nothing for a fill or a track with no steady beat.

**The analyser's dB range is the browser's default.** `minDecibels` and `maxDecibels` are never set, so the range is -100 to -30 dB, and the review's point was that full-scale music pins its loudest bins at the top exactly when the music is busiest, which flattens the flux in a drop. The extractor reads `getFloatFrequencyData`, which is not clipped to that range the way the byte data is, so this needs measuring before anyone believes it: play a loud drop, and look at whether the raw bins ever sit on a ceiling.

**Every band has the same 80 ms refractory.** At 174 BPM sixteenth-note hats are 86 ms apart, so one refractory swallows every other hat. The threshold is also a mean and a deviation over a window that contains the hits themselves, so a busy passage raises its own bar. A refractory per band (long for the sub, 40 to 50 ms for the treble) and a threshold the hits cannot move (a median and a median deviation) would let a fast hat line through. The sparks ink is the study that would show it.

**The sub band has the slowest attack.** `attackMs` is 20 for the sub and 5 for the treble (`DEFAULT_BANDS`). With the window's smear and a 250 ms release, a kick rises late and hangs. One constant, 8 to 12 ms, and a look at the dye on a four-to-the-floor track.

**`fftSize` does not follow the sample rate.** At 96 kHz the sub band is back to two bins. `sampleRate > 60000 ? 8192 : 4096`, and the extractor already reads the size from the analyser.

**No render scale on the WebGPU path.** The canvas is `clientWidth x devicePixelRatio` (`Renderer.resize`), and the whole post chain and the feedback history run at that size in `rgba16float`. The WebGL2 path has a pixel budget; the WebGPU one has none. The review measured about 300 MB a frame of offscreen bandwidth at 4K and a ratio of 2, and put a two to four times saving on a render scale plus a half-size history, which the blur in the trails would hide. This is the performance pass the studies handoff lists as its last step, and nothing has measured the library's 24 studies at 4K.

**Tempo on fast music.** The review found a 174 BPM track reading 111, because the rescue that halves a lag could never fire and the prior at 120 BPM favoured the wrong answer. The tracker has been rewritten since (`src/audio/TempoTracker.ts`), so that exact fault is gone, but nobody has checked a 170 to 180 BPM track against it, and the character calibration on 2026-09-20 saw the tempo double on some downtempo tracks. Measure both ends before touching it: `scripts/character-table.mjs` prints the row per track.

**Loudness that means loud.** Band levels and `energy` are scaled by their own recent peak, so they say how full a band is and not how big the passage is; a quiet breakdown reads as active within a couple of seconds. `swell`, `rest` and the moment rows were built for this and the quiet inks dim on them, but no row says how loud the track is against the whole of itself. Worth a look the next time a breakdown looks too busy, and not before.

## Found on 2026-09-20, on real tracks

**The reading moves with the display's refresh rate.** Two places. `pace` reads about 10 percent higher at 144 frames a second than at 60 on real music (0.52 against 0.58 on a metal track), and the drive axis is now a remap of a narrow span of it, which stretches the gap to about 0.1 of the axis. And the structure vector counts a band's hits per frame, so where a boundary lands differs too: one metal track finds five boundaries at 60 and seven at 144. Both are the fault `pace` was fixed for once, a count taken per frame where it should be per second. The README's "What this does not fix" has the second one.

**`pace` counts anything struck.** A strummed acoustic guitar reads busier than a metal track, so a folk singer had the highest drive of twenty tracks. Drive wants to be how hard the track pushes and not how many notes it plays; weighting a hit by its band, or by its strength against the level under it, is the first thing to try.

**The quiet end of the library is thin.** In a groove there is one soft flow, one soft ink and one soft look, so seven quiet tracks of the twenty measured share a cast. The character now tells them apart and there is nothing to hand them. The next wave of studies should be soft ones.

**A seek is only seen when the host gives a playhead.** The structure's two scales are the most the track has done so far, and a seek reads as the widest change it ever made. The renderer watches the `playhead` ref for a jump and tells the extractor; a host that passes none loses a dense track's sections after the first drag, until `track` changes.

**A muted element is silence to the analyser.** The graph undoes the element's volume before the analyser, down to a volume of 0.01, and can do nothing about `muted` or a volume of nothing, where the source is exact silence. A host that wants the picture with the sound off has to mute after the graph, and the graph offers no way to do that yet.

## Found on 2026-09-20, with the long-memory canvas

**Four inks are budgeted against a canvas that no longer exists.** The caustics, the halo, the beat rings and the spectrum ring each size their `intensity` from a sum on paper: the canvas keeps `FEEDBACK_KEEP`, 0.93, of itself a frame and subtracts `CANVAS_FLOOR`, 0.018, from every pixel, so a still glow settles at `SETTLE x (intensity - CANVAS_FLOOR)`, about fourteen times what one frame adds. Both constants live in `src/impls/caustics.params.ts` and `src/impls/halo.params.ts` and the other two import them. `carriedCanvas` now keeps 0.975 and fades rather than subtracting, so the same glow sums several times higher, and the halo's `HALO_INTENSITY_MAX` (the top of its range, derived from the old sum) is no longer the bound it claims to be. Nothing washes out, because `feedback.hold` bounds the frame's mean and `feedback.ceiling` bounds each pixel, but the four inks will read brighter and flatter at their cores than they were tuned to. Re-budgeting them wants a real adapter and a real track, and it wants their intensity rows opened up rather than merely clamped, which is why it was not done in the same pass. The old numbers are pinned by a test in each study's file so the drift cannot be forgotten.

**The three new canvas knobs have not been judged by eye at length.** `feedback.hue` (0.006 a frame, rising to 0.018 with `harmonicChange`), `feedback.cool` (0.004, to 0.016 with tension) and `feedback.sharpen` (0.03, to 0.07 with tension) were set to be gentle and checked on two passages of one track. They compound over a memory that now lasts seconds, so they are the numbers to look at first on a long quiet passage and on a track that changes key often.

**The WebGL2 fallback has no canvas hold.** It wants a ladder of passes reducing the frame to one texel, and that path is a fallback rather than a second implementation, so it is skipped the way `feedback.carry` is. Everything else about the canvas applies there. Nothing shipped reaches it with a long memory today, because the fallback's cast has the canvas switched off, but a cast that did would have only `feedback.ceiling` holding it: forced on by hand at 0.975, the fractal filled the frame to the ceiling in about a second. `curl-drift` as the fallback flow (below) would be the point at which this matters.

## Found on 2026-09-21, building from the effects catalogue

**The moment rows are too quiet to build a study on.** The lightning first fired only on `impact` or a high `release` and drew nothing for a whole song, the fault the README already records for the radial burst. The lightning now also fires on strong hits in a loud passage. The radial burst still waits for a reading real tracks do not give, and so will any new study that leans on `tension`, `release` or `impact` alone. Either the estimator wants recalibrating on the measured tracks so those rows reach their range, or the radial burst wants a second way in.

**New inks crowd the old ones at the hard end.** Adding the lightning took every drop from the shards until its home was moved. The fairness test caught it, which is what it is for, but the hard, high-drive corner is getting full while the soft end is still thin. The next studies should be soft ones.

## Left from the studies handoff

A flow for the WebGL2 path, where curl drift is the obvious one since it needs no compute. The performance pass, above.
