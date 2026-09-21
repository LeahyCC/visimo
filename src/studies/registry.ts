/**
 * The list of studies, each of which is a file of its own under `defs/`, named
 * for its id, with anything several of them share in `defs/shared.ts`. A new
 * study adds its file and one import and one row here.
 *
 * They are TypeScript rather than JSON, unlike the presets and
 * the casts beside them: a study is vocabulary, not a file of numbers a
 * person tunes. Its knobs have to match its implementation's list and its
 * mapping has to speak that implementation's names, and the compiler can say
 * so at the point the mistake is made rather than at load. The casts are the
 * other way round and stay JSON.
 *
 * Every number in `defs/` is ported from the five preset files, so nothing
 * there is invented, except for the studies that have no preset behind them, which say
 * so in their own comment. Where three presets drive one knob at three gains,
 * the study carries the smallest of them, which is what that study does
 * wherever it is cast, and each cast adds the rest. That way a cast's
 * overrides only ever push a study further in the direction it already goes,
 * and no override has to cancel a row out.
 *
 * `home` and `moments` come from the catalogue tables in
 * docs/studies-handoff.md, by its own convention: a capital letter is a
 * strong fit and reads 1, a lower case one about 0.5, and a letter that is
 * absent reads 0. An axis the catalogue says nothing about sits at 0.5, which
 * is no opinion rather than a weak one.
 *
 * Where the catalogue says "hard" or "fast", the number under it was a guess
 * at a space nothing had been measured in, and several of them sat past the
 * end of it: the hardest of twenty real tracks reads 0.79 and three homes
 * were at 0.85 or over, so the studies that wanted a hard track were the
 * studies no track could reach. `director/tracks.fixture.ts` is what those
 * twenty tracks read as, `scripts/character-table.mjs` is how to measure
 * more, and `director.test.ts` holds every study to winning a seat for at
 * least one of them. A home moved on that evidence says so where it is.
 */
import { BEAT_PUMP } from './defs/beat-pump'
import { BEAT_RINGS } from './defs/beat-rings'
import { CAUSTICS } from './defs/caustics'
import { CLEAN_GLASS } from './defs/clean-glass'
import { CURL_DRIFT } from './defs/curl-drift'
import { DUST } from './defs/dust'
import { DYE_PLUMES } from './defs/dye-plumes'
import { FILM } from './defs/film'
import { FRACTAL_GLINTS } from './defs/fractal-glints'
import { HALO } from './defs/halo'
import { HARD_CLEAN } from './defs/hard-clean'
import { IMPACT_FLASH } from './defs/impact-flash'
import { IMPLODE } from './defs/implode'
import { LASERS } from './defs/lasers'
import { LAZY_FLUID } from './defs/lazy-fluid'
import { LIGHTNING } from './defs/lightning'
import { RADIAL_BURST } from './defs/radial-burst'
import { RIBBON } from './defs/ribbon'
import { RISER_STREAKS } from './defs/riser-streaks'
import { SHARDS } from './defs/shards'
import { SPARKS } from './defs/sparks'
import { SPECTRUM_RING } from './defs/spectrum-ring'
import { SQUEEZE } from './defs/squeeze'
import { TUNNEL } from './defs/tunnel'
import { TURBULENT_FLUID } from './defs/turbulent-fluid'
import { WARM_SOFT } from './defs/warm-soft'
import { IMPL_SCENES } from './impls'
import type { Study } from './types'

/** Every study there is, flows first, then inks, then looks. */
export const STUDIES: readonly Study[] = [
  LAZY_FLUID,
  TURBULENT_FLUID,
  IMPLODE,
  RADIAL_BURST,
  CURL_DRIFT,
  BEAT_PUMP,
  TUNNEL,
  DYE_PLUMES,
  RIBBON,
  FRACTAL_GLINTS,
  RISER_STREAKS,
  SHARDS,
  DUST,
  CAUSTICS,
  HALO,
  BEAT_RINGS,
  SPECTRUM_RING,
  SPARKS,
  LASERS,
  LIGHTNING,
  WARM_SOFT,
  CLEAN_GLASS,
  HARD_CLEAN,
  SQUEEZE,
  IMPACT_FLASH,
  FILM,
]

// The resolver looks every live study up on every frame, and this list is
// headed for forty entries, so the lookup is by key and not a walk.
const BY_ID = new Map(STUDIES.map((study) => [study.id, study]))

export const findStudy = (id: string): Study | undefined => BY_ID.get(id)

export const studiesOfKind = (kind: Study['kind']): readonly Study[] =>
  STUDIES.filter((study) => study.kind === kind)

/**
 * What the canvas's `data-scene` prints for a set of live inks. A cast has no
 * single scene, so it is the first of them whose implementation was one,
 * which keeps the five pinned casts printing exactly what their presets did:
 * the dye is `fluid` and the fractal is `kaleidoscope`. A cast whose inks were
 * never scenes, a ribbon on its own, prints that ink's implementation instead,
 * so the line still says what is drawing.
 */
export function sceneOf(ids: readonly string[]): string {
  let first = ''
  for (const id of ids) {
    const study = findStudy(id)
    if (!study || study.kind !== 'ink') continue
    const scene = IMPL_SCENES[study.impl]
    if (scene) return scene
    if (!first) first = study.impl
  }

  return first
}
