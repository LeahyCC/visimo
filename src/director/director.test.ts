import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { MAX_INKS } from '../studies/cast'
import { CASTS } from '../studies/casts'
import { findStudy, STUDIES } from '../studies/registry'
import { castFrame, resolveLive } from '../studies/resolve'
import type { LiveStudy } from '../studies/resolve'
import { CHARACTER_AXES, MOMENTS } from '../studies/types'
import type { Character, FlowStudy, InkStudy, LookStudy, Moments, Study } from '../studies/types'
import { rowsForAxis } from './character'
import { COST_OF, Director, pickCast } from './director'
import type { PickedCast } from './director'
import type { MomentWeights } from './moment'
import { DROP_AT, HARDSTYLE, HOUSE, LOFI, PARTS, playSong } from './song.fixture'
import { TRACKS } from './tracks.fixture'

const NOTHING: MomentWeights = { intro: 0, groove: 0, build: 0, drop: 0, rest: 0, outro: 0 }

const weights = (values: Partial<MomentWeights>): MomentWeights => ({ ...NOTHING, ...values })

const moments = (values: Partial<Moments>): Moments => ({ ...NOTHING, ...values })

const NEUTRAL: Character = {
  drive: 0.5,
  weight: 0.5,
  tonality: 0.5,
  steadiness: 0.5,
  hardness: 0.5,
}

type Made = { home?: Character; reach?: number; cost?: Study['cost'] }

const flow = (id: string, fit: Moments, made: Made = {}): FlowStudy => ({
  id,
  kind: 'flow',
  name: id,
  impl: 'fluid',
  home: made.home ?? NEUTRAL,
  reach: made.reach ?? 1,
  moments: fit,
  knobs: {},
  mapping: [],
  cost: made.cost ?? 'medium',
})

const ink = (
  id: string,
  fit: Moments,
  made: Made & { requires?: InkStudy['requires']; excludes?: string[] } = {},
): InkStudy => ({
  id,
  kind: 'ink',
  name: id,
  impl: 'dye',
  home: made.home ?? NEUTRAL,
  reach: made.reach ?? 1,
  moments: fit,
  knobs: {},
  mapping: [],
  cost: made.cost ?? 'cheap',
  ...(made.requires ? { requires: made.requires } : {}),
  ...(made.excludes ? { excludes: made.excludes } : {}),
})

const look = (id: string, fit: Moments, made: Made = {}): LookStudy => ({
  id,
  kind: 'look',
  name: id,
  impl: 'look',
  home: made.home ?? NEUTRAL,
  reach: made.reach ?? 1,
  moments: fit,
  knobs: {},
  mapping: [],
  cost: made.cost ?? 'cheap',
  stages: ['tonemap'],
  palette: 'classic',
})

/**
 * A small library with one clear answer for each moment, so a test can say
 * what the cast should be rather than what it should not be. Every home is
 * neutral and every reach is 1 unless a test says otherwise, which leaves the
 * moment as the only thing deciding.
 */
const GROOVE_FLOW = flow('groove-flow', moments({ groove: 1 }))
const DROP_FLOW = flow('drop-flow', moments({ groove: 0.9, drop: 1 }))
const GROOVE_INK = ink('groove-ink', moments({ groove: 1 }))
const BUILD_INK = ink('build-ink', moments({ build: 1 }))
const QUIET_INK = ink('quiet-ink', moments({ intro: 1, rest: 1, outro: 1 }))
const ONE_LOOK = look(
  'one-look',
  moments({ intro: 1, groove: 1, build: 1, drop: 1, rest: 1, outro: 1 }),
)

const BENCH: readonly Study[] = [GROOVE_FLOW, DROP_FLOW, GROOVE_INK, BUILD_INK, QUIET_INK, ONE_LOOK]

const name = (cast: PickedCast | undefined): string =>
  cast ? [cast.flow ?? '-', ...cast.inks, cast.look].join('+') : '-'

const presenceOf = (live: readonly LiveStudy[], id: string): number =>
  live.find((entry) => entry.id === id)?.presence ?? 0

// A track that is already under way: something has come back, so the first
// seconds of the test are not read as the opening of a track, which is an
// intro whatever it sounds like. What these tests are about is the choosing.
const packet = (values: Partial<Record<keyof typeof F, number>>) => {
  const out = new Float32Array(PACKET_LENGTH)
  out[F.energy] = 0.8
  out[F.swell] = 0.5
  out[F.recall] = 0.9
  for (const [name_, value] of Object.entries(values)) out[F[name_ as keyof typeof F]] = value
  return out
}

/** The rows a character is read back from, written into a packet. */
const sounding = (out: Float32Array, character: Character) => {
  for (const axis of CHARACTER_AXES)
    for (const { row, value } of rowsForAxis(axis, character[axis])) out[row] = value
  return out
}

const run = (director: Director, features: Float32Array, seconds: number, fps = 60) => {
  const dt = 1 / fps
  let frame = director.step(features, dt)
  for (let at = 1; at < Math.round(seconds * fps); at += 1) frame = director.step(features, dt)
  return frame
}

/** Every cast the song passes through, and the second each one arrived. */
const cue = (director: Director, fps: number, character: Character, seconds?: number) => {
  const cues: { time: number; cast: string }[] = []
  let held = ''
  for (const { time, dt, features } of playSong(fps, character, seconds)) {
    director.step(features, dt)
    const now = name(director.cast)
    if (now !== held) {
      cues.push({ time, cast: now })
      held = now
    }
  }

  return cues
}

describe('pickCast', () => {
  it('is one flow, one to three inks and one look', () => {
    const cast = pickCast({ studies: BENCH, character: NEUTRAL, weights: weights({ groove: 1 }) })
    expect(cast?.flow).toBe('groove-flow')
    expect(cast?.look).toBe('one-look')
    expect(cast?.inks.length).toBeGreaterThanOrEqual(1)
    expect(cast?.inks.length).toBeLessThanOrEqual(MAX_INKS)
  })

  it('stays inside the cost budget', () => {
    const heavy = ink('heavy-ink', moments({ groove: 1 }), { cost: 'heavy' })
    const cast = pickCast({
      studies: [...BENCH, heavy],
      character: NEUTRAL,
      weights: weights({ groove: 1 }),
      budget: 5,
    })
    expect(cast).toBeDefined()
    const spent = [cast?.flow, ...(cast?.inks ?? []), cast?.look]
      .filter((id): id is string => id !== undefined)
      .reduce((sum, id) => sum + COST_OF[[...BENCH, heavy].find((s) => s.id === id)!.cost], 0)
    expect(spent).toBeLessThanOrEqual(5)
  })

  it('never casts two studies that exclude one another', () => {
    const one = ink('one-ink', moments({ groove: 1 }), { excludes: ['other-ink'] })
    const other = ink('other-ink', moments({ groove: 1 }))
    const cast = pickCast({
      studies: [GROOVE_FLOW, ONE_LOOK, one, other],
      character: NEUTRAL,
      weights: weights({ groove: 1 }),
    })
    expect(cast?.inks).toHaveLength(1)
  })

  it('never casts a study whose implementation is not there beside it', () => {
    const needs = ink('needs-fractal', moments({ groove: 1 }), { requires: ['fractal'] })
    const cast = pickCast({
      studies: [GROOVE_FLOW, ONE_LOOK, GROOVE_INK, needs],
      character: NEUTRAL,
      weights: weights({ groove: 1 }),
    })
    expect(cast?.inks).toEqual(['groove-ink'])
  })

  // The flow is chosen first, and the dye needs a fluid under it. A better
  // scoring flow of another implementation used to leave the cast with no ink
  // at all, which the director reads as "keep what is on screen": a black
  // canvas at the start of a track.
  it('passes over a flow that leaves every ink nothing to sit on', () => {
    const other: FlowStudy = { ...flow('other-flow', moments({ intro: 1 })), impl: 'analytic' }
    const fluid = flow('fluid-flow', moments({ intro: 0.6 }))
    const needs = ink('needs-fluid', moments({ intro: 1 }), { requires: ['fluid'] })
    const studies = [other, fluid, needs, ONE_LOOK]
    const cast = pickCast({ studies, character: NEUTRAL, weights: weights({ intro: 1 }) })
    expect(cast).toEqual({ flow: 'fluid-flow', inks: ['needs-fluid'], look: 'one-look' })
    // With an ink that asks for nothing the better flow keeps its seat.
    const free = ink('free-ink', moments({ intro: 1 }))
    expect(
      pickCast({ studies: [...studies, free], character: NEUTRAL, weights: weights({ intro: 1 }) })
        ?.flow,
    ).toBe('other-flow')
  })

  it('makes no cast when no flow leaves an ink', () => {
    const other: FlowStudy = { ...flow('other-flow', moments({ intro: 1 })), impl: 'analytic' }
    const needs = ink('needs-fluid', moments({ intro: 1 }), { requires: ['fluid'] })
    expect(
      pickCast({
        studies: [other, needs, ONE_LOOK],
        character: NEUTRAL,
        weights: weights({ intro: 1 }),
      }),
    ).toBeUndefined()
  })

  // The margin is what keeps two near-equal scores from swapping seats every
  // time the music is looked at.
  it('leaves a sitting member alone unless a challenger clears the margin', () => {
    const sitting = flow('sitting', moments({ groove: 0.98 }))
    const challenger = flow('challenger', moments({ groove: 1 }))
    const near = { studies: [sitting, challenger, GROOVE_INK, ONE_LOOK], character: NEUTRAL }
    expect(pickCast({ ...near, weights: weights({ groove: 1 }) })?.flow).toBe('challenger')
    expect(
      pickCast({
        ...near,
        weights: weights({ groove: 1 }),
        sitting: { flow: 'sitting', inks: ['groove-ink'], look: 'one-look' },
      })?.flow,
    ).toBe('sitting')
  })

  it('unseats a sitting member that is clearly beaten', () => {
    const sitting = flow('sitting', moments({ groove: 0.5 }))
    const challenger = flow('challenger', moments({ groove: 1 }))
    expect(
      pickCast({
        studies: [sitting, challenger, GROOVE_INK, ONE_LOOK],
        character: NEUTRAL,
        weights: weights({ groove: 1 }),
        sitting: { flow: 'sitting', inks: ['groove-ink'], look: 'one-look' },
      })?.flow,
    ).toBe('challenger')
  })

  // Variety without randomness: the rotation is a number a section hands in,
  // and the same number always picks the same cousin.
  it('rotates among the studies that score within the margin of each other', () => {
    const studies = [
      flow('flow-a', moments({ groove: 1 })),
      flow('flow-b', moments({ groove: 0.99 })),
      flow('flow-c', moments({ groove: 0.98 })),
      GROOVE_INK,
      ONE_LOOK,
    ]
    const at = { studies, character: NEUTRAL, weights: weights({ groove: 1 }) }
    const picked = [0, 1, 2].map((rotation) => pickCast({ ...at, rotation })?.flow)
    expect(picked).toEqual(['flow-a', 'flow-b', 'flow-c'])
    expect(pickCast({ ...at, rotation: 1 })?.flow).toBe('flow-b')
  })

  it('does not rotate past studies that are not close', () => {
    const studies = [
      flow('flow-a', moments({ groove: 1 })),
      flow('flow-b', moments({ groove: 0.2 })),
      GROOVE_INK,
      ONE_LOOK,
    ]
    const at = { studies, character: NEUTRAL, weights: weights({ groove: 1 }) }
    for (const rotation of [0, 1, 2, 3]) expect(pickCast({ ...at, rotation })?.flow).toBe('flow-a')
  })

  it('reads a study through the Study type alone, so the registry picks too', () => {
    const cast = pickCast({ character: HARDSTYLE, weights: weights({ groove: 1 }) })
    expect(cast).toBeDefined()
    expect(findStudy(cast?.look ?? '')?.kind).toBe('look')
    for (const id of cast?.inks ?? []) expect(findStudy(id)?.kind).toBe('ink')
  })
})

describe('Director', () => {
  it('passes the packet’s tension on for every live study to read', () => {
    const director = new Director({ studies: BENCH })
    const frame = director.step(packet({ section: 1, tension: 0.42 }), 1 / 60)
    expect(frame.tension).toBeCloseTo(0.42)
  })

  it('leaves a study at presence 0 out of the frame entirely', () => {
    const director = new Director({ studies: BENCH })
    const groove = packet({ section: 1 })
    run(director, groove, 6)
    expect(director.cast?.inks).toContain('groove-ink')
    expect(presenceOf(director.step(groove, 1 / 60).studies, 'build-ink')).toBe(0)
    expect(director.step(groove, 1 / 60).studies.some((entry) => entry.id === 'build-ink')).toBe(
      false,
    )
    for (const entry of director.step(groove, 1 / 60).studies)
      expect(entry.presence).toBeGreaterThan(0)
  })

  it('hands back the same list and the same entries every frame', () => {
    const director = new Director({ studies: BENCH })
    const groove = packet({ section: 1 })
    const first = director.step(groove, 1 / 60)
    const entry = first.studies[0]
    const second = director.step(groove, 1 / 60)
    expect(second.studies).toBe(first.studies)
    expect(second.studies[0]).toBe(entry)
  })

  // Changes land on the music. Nothing in here counts seconds toward a swap.
  it('never changes the cast on a timer', () => {
    const director = new Director({ studies: BENCH })
    const groove = packet({ section: 1 })
    run(director, groove, 2)
    const held = name(director.cast)
    run(director, groove, 120)
    expect(name(director.cast)).toBe(held)
  })

  it('changes the cast on a confirmed section', () => {
    const director = new Director({ studies: BENCH })
    run(director, packet({ section: 1, rest: 0.9 }), 10)
    expect(director.cast?.inks).toContain('quiet-ink')
    run(director, packet({ section: 2 }), 10)
    expect(director.cast?.inks).toContain('groove-ink')
  })

  // The extractor is about six seconds late with a section, so the spike is
  // what starts the fade and the confirmation is what settles it.
  it('starts toward a challenger on a novelty spike, before the section is confirmed', () => {
    const director = new Director({ studies: BENCH })
    run(director, packet({ section: 1, rest: 0.9 }), 10)
    expect(director.cast?.inks).toContain('quiet-ink')
    // The music has changed; the section id has not caught up.
    run(director, packet({ section: 1, novelty: 0.6 }), 1)
    expect(director.cast?.inks).toContain('groove-ink')
  })

  // The groove comes back as the section it was, and gets what it had. Read
  // well inside each passage, since the return is confirmed six seconds late.
  it('comes back to the cast a section had when the section comes back', () => {
    const director = new Director({ studies: STUDIES })
    let groove = ''
    let again = ''
    for (const { time, dt, features } of playSong(60, HOUSE)) {
      director.step(features, dt)
      if (time > PARTS[1]!.at + 20 && groove === '') groove = name(director.cast)
      if (time > PARTS[5]!.at + 20 && again === '') again = name(director.cast)
    }

    expect(groove).not.toBe('-')
    expect(again).toBe(groove)
  })

  it('plays the same song the same way twice', () => {
    const one = cue(new Director({ studies: STUDIES }), 60, HARDSTYLE)
    const two = cue(new Director({ studies: STUDIES }), 60, HARDSTYLE)
    expect(two).toEqual(one)
    expect(one.length).toBeGreaterThan(3)
  })

  // Until the character is known the moment alone ranks the studies. The stray
  // ink fits the groove best and is a poor match for the track once it is
  // known; the own ink has the better welcome (it used to win the opening on
  // that) and is the track's own.
  it('opens on the best fit for the moment and drifts into the track’s own', () => {
    const track: Character = { ...NEUTRAL, hardness: 0.95, drive: 0.9 }
    const elsewhere: Character = { ...NEUTRAL, hardness: 0.05, drive: 0.1 }
    const stray = ink('stray-ink', moments({ groove: 1 }), { reach: 0.2, home: elsewhere })
    const own = ink('own-ink', moments({ groove: 0.9 }), { reach: 0.5, home: track })
    const studies = [GROOVE_FLOW, ONE_LOOK, stray, own]
    const director = new Director({ studies, budget: 4 })
    const early = sounding(packet({ section: 1 }), track)
    run(director, early, 4)
    expect(director.cast?.inks).toEqual(['stray-ink'])
    run(director, early, 60)
    // Settled, and a boundary to act on it.
    run(director, sounding(packet({ section: 2 }), track), 2)
    expect(director.cast?.inks).toEqual(['own-ink'])
  })

  // The same two studies with the ids the other way round. Nothing but the
  // moment and the tie-break may decide the opening, and a reach is neither.
  it('does not open on a study for having the widest reach', () => {
    const track: Character = { ...NEUTRAL, hardness: 0.95, drive: 0.9 }
    const elsewhere: Character = { ...NEUTRAL, hardness: 0.05, drive: 0.1 }
    for (const [narrow, wide] of [
      ['a-narrow', 'z-wide'],
      ['z-narrow', 'a-wide'],
    ] as const) {
      const studies = [
        GROOVE_FLOW,
        ONE_LOOK,
        ink(narrow, moments({ groove: 1 }), { reach: 0.2, home: elsewhere }),
        ink(wide, moments({ groove: 1 }), { reach: 1, home: track }),
      ]
      const director = new Director({ studies, budget: 4 })
      run(director, sounding(packet({ section: 1 }), track), 4)
      // Alike in everything, so the id decides, whichever way round it falls.
      expect(director.cast?.inks).toEqual([[narrow, wide].sort()[0]])
    }
  })

  // Heard on a real metal track: one section, no impact and no novelty spike
  // in two minutes, so nothing ever asked again and the whole of it played on
  // the neutral cast picked in its first fraction of a second.
  it('asks again when the character is first known, with no boundary to prompt it', () => {
    const track: Character = { ...NEUTRAL, hardness: 0.95, drive: 0.9 }
    const elsewhere: Character = { ...NEUTRAL, hardness: 0.05, drive: 0.1 }
    const stray = ink('stray-ink', moments({ groove: 1 }), { reach: 0.2, home: elsewhere })
    const own = ink('own-ink', moments({ groove: 0.9 }), { reach: 0.5, home: track })
    const director = new Director({ studies: [GROOVE_FLOW, ONE_LOOK, stray, own], budget: 4 })
    const steady = sounding(packet({ section: 1, recall: 0.9 }), track)
    run(director, steady, 4)
    expect(director.cast?.inks).toEqual(['stray-ink'])
    run(director, steady, 60)
    expect(director.cast?.inks).toEqual(['own-ink'])
  })

  it('does not ask again when it was handed the character to begin with', () => {
    const director = new Director({ studies: BENCH, budget: 4, start: NEUTRAL })
    const steady = packet({ section: 1, recall: 0.9 })
    run(director, steady, 1)
    const opening = name(director.cast)
    run(director, steady, 60)
    expect(name(director.cast)).toBe(opening)
  })
})

describe('how a change lands', () => {
  const settle = (director: Director, features: Float32Array, seconds: number) =>
    run(director, features, seconds)

  it('glides over seconds on a section change', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1, rest: 0.9 }), 10)
    expect(
      presenceOf(director.step(packet({ section: 1, rest: 0.9 }), 1 / 60).studies, 'quiet-ink'),
    ).toBe(1)
    const frame = run(director, packet({ section: 2 }), 0.25)
    expect(presenceOf(frame.studies, 'groove-ink')).toBeGreaterThan(0)
    expect(presenceOf(frame.studies, 'groove-ink')).toBeLessThan(0.3)
    expect(presenceOf(frame.studies, 'quiet-ink')).toBeGreaterThan(0.6)
  })

  // The drop is the biggest moment in most tracks, so it is a cut and not a
  // crossfade. Everything else glides.
  it('cuts on impact, whole inside a tenth of a second', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1 }), 10)
    expect(director.cast?.flow).toBe('groove-flow')
    const drop = packet({ section: 1, release: 0.5, impact: 1 })
    director.step(drop, 1 / 60)
    expect(director.cast?.flow).toBe('drop-flow')
    const frame = run(director, packet({ section: 1, release: 0.5 }), 0.1)
    expect(presenceOf(frame.studies, 'drop-flow')).toBe(1)
    expect(presenceOf(frame.studies, 'groove-flow')).toBe(0)
  })

  it('fires one cut per drop, however long the payoff sits at the top', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1 }), 10)
    let cuts = 0
    let held = name(director.cast)
    for (let frame = 0; frame < 120; frame += 1) {
      director.step(packet({ section: 1, release: 0.5, impact: 1 }), 1 / 60)
      if (name(director.cast) !== held) {
        cuts += 1
        held = name(director.cast)
      }
    }

    expect(cuts).toBe(1)
  })

  // The packet that holds impact at 1 is one frame long, and a janky frame
  // can miss it. One packet late at 30 frames a second it reads 0.83.
  it('still cuts when the frame that held the impact was never read', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1 }), 10)
    const late = Math.exp(-(1 / 30) / 0.18)
    expect(late).toBeLessThan(0.9)
    director.step(packet({ section: 1, release: 0.5, impact: late }), 1 / 30)
    expect(director.cast?.flow).toBe('drop-flow')
    const frame = run(director, packet({ section: 1, release: 0.5 }), 0.1)
    expect(presenceOf(frame.studies, 'drop-flow')).toBe(1)
  })

  // Seen on a real track: the drop cut to its cast at 1:46, the section it
  // opened was confirmed eight seconds later with `release` long gone, the
  // pick read that as groove and glided back, and the groove's cast was what
  // got remembered as the drop's.
  it('keeps the cast a drop cut to when its section is confirmed late', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1 }), 40)
    expect(director.settled).toBe(1)
    director.step(packet({ section: 1, release: 0.5, impact: 1 }), 1 / 60)
    expect(director.cast?.flow).toBe('drop-flow')
    // The payoff fades over a phrase, and then the extractor catches up.
    settle(director, packet({ section: 1 }), 6)
    settle(director, packet({ section: 2 }), 2)
    expect(director.cast?.flow).toBe('drop-flow')
    const dropped = name(director.cast)
    // An impact opens one section. The next boundary is still inside the span
    // and must pick for itself: a quiet passage gets the quiet ink, which an
    // adopted cast would not hold.
    settle(director, packet({ section: 3, rest: 1 }), 1)
    expect(director.cast?.inks).toContain('quiet-ink')
    // And the drop's section comes back as the drop's, not as a groove's.
    settle(director, packet({ section: 2 }), 1)
    expect(name(director.cast)).toBe(dropped)
  })

  it('picks afresh for a section confirmed long after any drop', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1 }), 40)
    director.step(packet({ section: 1, release: 0.5, impact: 1 }), 1 / 60)
    settle(director, packet({ section: 1 }), 20)
    settle(director, packet({ section: 2 }), 2)
    expect(director.cast?.flow).toBe('groove-flow')
  })

  // What undid the drop on a real track. Eight seconds in something new
  // entered, novelty spiked, and with `release` already gone the pick read
  // plain groove. `release` lasts a phrase and a drop section lasts many.
  it('holds the cast a drop cut to against a novelty spike inside the drop', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1 }), 40)
    director.step(packet({ section: 1, release: 0.5, impact: 1 }), 1 / 60)
    settle(director, packet({ section: 1 }), 8)
    director.step(packet({ section: 1, novelty: 0.9 }), 1 / 60)
    settle(director, packet({ section: 1 }), 3)
    expect(director.cast?.flow).toBe('drop-flow')
    // The spike was a boundary, and six seconds on it is confirmed: a section
    // that began after the drop, so the choosing is open again.
    settle(director, packet({ section: 2 }), 3)
    expect(director.cast?.flow).toBe('groove-flow')
    director.step(packet({ section: 2, rest: 1, novelty: 0 }), 1 / 60)
    director.step(packet({ section: 2, rest: 1, novelty: 0.9 }), 1 / 60)
    expect(director.cast?.inks).toContain('quiet-ink')
  })

  // The build is confirmed a couple of seconds after the drop it led to,
  // because it began six seconds before that. Remembered by the drop's cast,
  // the next build in the track would open on the drop's picture.
  it('does not remember the build by the cast its drop cut to', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1 }), 40)
    director.step(packet({ section: 1, release: 0.5, impact: 1 }), 1 / 60)
    const dropped = name(director.cast)
    // Section 2 is the build: confirmed two seconds after the impact.
    settle(director, packet({ section: 1 }), 2)
    settle(director, packet({ section: 2 }), 1)
    expect(name(director.cast)).toBe(dropped)
    settle(director, packet({ section: 3, rest: 1 }), 20)
    // The build again, as a build. It picks for itself and gets the build ink.
    settle(director, packet({ section: 2, tension: 1 }), 1)
    expect(name(director.cast)).not.toBe(dropped)
    expect(director.cast?.inks).toContain('build-ink')
  })
})

describe('a build beginning', () => {
  const settle = (director: Director, features: Float32Array, seconds: number) =>
    run(director, features, seconds)

  // A build has no boundary of its own until it is six seconds old, and a
  // riser creeps in with no novelty spike. On a real track the build's own
  // section was confirmed after the drop it led to.
  it('casts for the build as tension rises, with no boundary and no novelty', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1 }), 40)
    expect(director.cast?.inks).not.toContain('build-ink')
    settle(director, packet({ section: 1, tension: 0.2 }), 1)
    expect(director.cast?.inks).not.toContain('build-ink')
    director.step(packet({ section: 1, tension: 0.7 }), 1 / 60)
    expect(director.cast?.inks).toContain('build-ink')
  })

  it('is one signal per build, however the tension wavers on the way up', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1 }), 40)
    let changes = 0
    let held = name(director.cast)
    for (const tension of [0.7, 0.56, 0.8, 0.52, 0.9, 0.6, 1]) {
      settle(director, packet({ section: 1, tension }), 0.5)
      if (name(director.cast) !== held) {
        changes += 1
        held = name(director.cast)
      }
    }

    expect(changes).toBe(1)
  })

  it('cuts away from the build’s cast on the drop, with tension still high', () => {
    // The shared library has no ink written for a drop, and with nothing to
    // beat it the build's ink would keep its seat on its margin.
    const studies = [...BENCH, ink('drop-ink', moments({ drop: 1 }))]
    const director = new Director({ studies, budget: 4 })
    settle(director, packet({ section: 1 }), 40)
    settle(director, packet({ section: 1, tension: 0.9 }), 4)
    expect(director.cast?.inks).toContain('build-ink')
    director.step(packet({ section: 1, tension: 0.82, release: 0.93, impact: 1 }), 1 / 60)
    expect(director.cast?.flow).toBe('drop-flow')
    expect(director.cast?.inks).not.toContain('build-ink')
  })

  // Not every riser ends in a drop. Left alone, the build's cast stayed on
  // screen with nothing to wind up to until some other signal came along.
  it('lets the build’s cast go when the build fizzles', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1 }), 40)
    settle(director, packet({ section: 1, tension: 0.9 }), 4)
    expect(director.cast?.inks).toContain('build-ink')
    settle(director, packet({ section: 1, tension: 0.4 }), 1)
    expect(director.cast?.inks).toContain('build-ink')
    settle(director, packet({ section: 1, tension: 0.1 }), 1)
    expect(director.cast?.inks).not.toContain('build-ink')
    expect(director.cast?.inks).toContain('groove-ink')
  })

  // A build starting is the drop's section over, whatever has been confirmed.
  it('is heard even while a drop’s cast is being held', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1 }), 40)
    director.step(packet({ section: 1, release: 0.5, impact: 1 }), 1 / 60)
    settle(director, packet({ section: 1 }), 8)
    expect(director.cast?.flow).toBe('drop-flow')
    director.step(packet({ section: 1, tension: 0.8 }), 1 / 60)
    expect(director.cast?.inks).toContain('build-ink')
  })
})

describe('the canvas a chosen cast draws on', () => {
  // With the post stack's own defaults the carry was 0, and under the
  // director no flow moved the picture at all. The floor is a knee now rather
  // than an amount taken off, and what stops a long memory running away is
  // the hold: see `carriedCanvas`.
  it('carries the picture along the flow, holds its mean, and fades to black', () => {
    const director = new Director({ studies: STUDIES })
    const { canvas } = director.step(packet({ section: 1 }), 1 / 60)
    expect(canvas.enabled).toBe(true)
    expect(canvas.knobs['feedback.carry']).toBe(1)
    expect(canvas.knobs['feedback.amount'] * canvas.knobs['feedback.decay']).toBeGreaterThan(0.97)
    expect(canvas.knobs['feedback.hold']).toBeGreaterThan(0)
    expect(canvas.knobs['feedback.fade']).toBeGreaterThan(0)
    expect(canvas.knobs['feedback.ceiling']).toBeLessThan(4)
  })

  it('stays inside a safe range at silence, at a full packet and wound right up', () => {
    const director = new Director({ studies: STUDIES })
    const { canvas } = director.step(packet({ section: 1 }), 1 / 60)
    for (const level of [0, 1]) {
      const features = new Float32Array(PACKET_LENGTH).fill(level)
      const frame = resolveLive([], canvas, features, level, castFrame())
      const { feedback } = frame.post
      // Kept per frame stays under 1, or a still picture sums without limit.
      expect(feedback.amount * feedback.decay).toBeLessThan(1)
      expect(feedback.amount * feedback.decay).toBeGreaterThan(0.8)
      expect(feedback.ceiling).toBeGreaterThan(feedback.floor + 0.5)
      expect(feedback.floor).toBeGreaterThanOrEqual(0)
      // The hold is the thing that lets the decay run this long, so it is
      // never allowed to resolve away at either end of the music.
      expect(feedback.hold).toBeGreaterThan(0)
    }
  })

  it('leaves a pinned cast its own canvas', () => {
    const pinned = CASTS[0]!
    const director = new Director({ pinned })
    expect(director.step(packet({ section: 1 }), 1 / 60).canvas).toBe(pinned.canvas)
  })
})

describe('what a section is remembered by', () => {
  // A track that opens straight into a section is given the neutral guess
  // for it, since nothing is known yet. Remembered, that guess would be what
  // the section got every time it came back.
  it('does not remember a cast it picked before it knew the track', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    run(director, packet({ section: 1 }), 5)
    expect(director.settled).toBe(0)
    expect(director.cast?.inks).toContain('groove-ink')
    run(director, packet({ section: 2 }), 40)
    // Section 1 again, and this time it is a quiet passage. Recalled, it
    // would be handed the groove cast it opened with.
    run(director, packet({ section: 1, rest: 1 }), 1)
    expect(director.cast?.inks).toContain('quiet-ink')
    expect(director.cast?.inks).not.toContain('groove-ink')
  })

  it('remembers one it picked once the track was known', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    run(director, packet({ section: 1 }), 40)
    expect(director.settled).toBe(1)
    run(director, packet({ section: 2, rest: 1 }), 10)
    const quiet = name(director.cast)
    run(director, packet({ section: 3 }), 10)
    expect(name(director.cast)).not.toBe(quiet)
    // Section 2 comes back as a groove, and still gets the cast it had.
    run(director, packet({ section: 2 }), 1)
    expect(name(director.cast)).toBe(quiet)
  })

  // Real packets differ a little from one play of a track to the next. The
  // seed is read from the character once and coarsely, so that little cannot
  // send the same song to different cousins.
  it('plays the same song the same way when the character reads a hair differently', () => {
    const edge: Character = { ...HOUSE, tonality: 0.531, hardness: 0.469 }
    const hair: Character = { ...HOUSE, tonality: 0.532, hardness: 0.468 }
    const one = cue(new Director({ studies: STUDIES }), 60, edge)
    const two = cue(new Director({ studies: STUDIES }), 60, hair)
    expect(two).toEqual(one)
  })
})

describe('a pinned cast', () => {
  const pinned = CASTS[0]!

  it('turns the director off and hands that cast back whole', () => {
    const director = new Director({ pinned })
    const frame = director.step(
      packet({ section: 1, tension: 0.3, impact: 1, novelty: 0.9 }),
      1 / 60,
    )
    const ids = frame.studies.map((entry) => entry.id)
    expect(ids).toEqual([pinned.flow, ...pinned.inks, pinned.look].filter(Boolean))
    for (const entry of frame.studies) expect(entry.presence).toBe(1)
    expect(frame.canvas).toBe(pinned.canvas)
    expect(frame.tension).toBeCloseTo(0.3)
  })

  it('never changes, whatever the song does', () => {
    const director = new Director({ pinned })
    const before = director.step(packet({ section: 1 }), 1 / 60).studies.map((entry) => entry.id)
    for (const { dt, features } of playSong(60, HARDSTYLE, 120)) director.step(features, dt)
    expect(director.step(packet({ section: 9 }), 1 / 60).studies.map((entry) => entry.id)).toEqual(
      before,
    )
    expect(director.cast).toBeUndefined()
  })

  // Nothing is chosen by them under a pinned cast, but a host saves the
  // character for the next play and the overlay shows both.
  it('still reads the character and the moment', () => {
    const director = new Director({ pinned })
    for (const { dt, features } of playSong(60, HARDSTYLE, 120)) director.step(features, dt)
    expect(director.settled).toBe(1)
    expect(director.character.hardness).toBeGreaterThan(0.8)
    expect(director.character.steadiness).toBeGreaterThan(0.7)
    director.step(packet({ section: 1, tension: 0.2 }), 1 / 60)
    expect(director.weights.build).toBeCloseTo(0.2)
  })
})

describe('the whole song', () => {
  it('holds the shape of a cast at every frame of it', () => {
    const director = new Director()
    for (const { dt, features } of playSong(60, LOFI)) {
      director.step(features, dt)
      const cast = director.cast
      if (!cast) continue
      expect(findStudy(cast.flow ?? '')?.kind).toBe('flow')
      expect(findStudy(cast.look)?.kind).toBe('look')
      expect(cast.inks.length).toBeGreaterThanOrEqual(1)
      expect(cast.inks.length).toBeLessThanOrEqual(MAX_INKS)
      const held = [cast.flow, ...cast.inks, cast.look]
        .filter((id): id is string => id !== undefined)
        .map((id) => findStudy(id)!)
      expect(held.reduce((sum, study) => sum + COST_OF[study.cost], 0)).toBeLessThanOrEqual(8)
      for (const study of held) {
        for (const other of study.excludes ?? [])
          expect(held.some((entry) => entry.id === other)).toBe(false)
        for (const impl of study.requires ?? [])
          expect(held.some((entry) => entry.impl === impl)).toBe(true)
      }
    }
  })

  it('never leaves the picture empty once it has started', () => {
    const director = new Director()
    let started = false
    for (const { dt, features } of playSong(60, HOUSE)) {
      const frame = director.step(features, dt)
      if (frame.studies.length > 0) started = true
      if (started) expect(frame.studies.length).toBeGreaterThan(0)
    }

    expect(started).toBe(true)
  })

  // Frame rate independence, end to end: the same ninety seconds sampled twice.
  it('makes the same changes at the same times at 60 and at 144 frames a second', () => {
    const slow = cue(new Director(), 60, HARDSTYLE, 90)
    const fast = cue(new Director(), 144, HARDSTYLE, 90)
    expect(fast.map((at) => at.cast)).toEqual(slow.map((at) => at.cast))
    for (const [index, at] of slow.entries())
      expect(Math.abs((fast[index]?.time ?? 0) - at.time)).toBeLessThanOrEqual(1 / 60 + 1e-9)
  })

  it('cuts to a new cast on the drop and reaches it within a few frames', () => {
    const director = new Director()
    let before = ''
    let after = ''
    let presence = 0
    for (const { time, dt, features } of playSong(60, HARDSTYLE, 120)) {
      if (time <= DROP_AT - 1 / 60) before = name(director.cast)
      const frame = director.step(features, dt)
      if (time >= DROP_AT && after === '') after = name(director.cast)
      if (Math.abs(time - (DROP_AT + 0.1)) < 1 / 120)
        presence = Math.min(
          ...(director.cast?.inks ?? []).map((id) => presenceOf(frame.studies, id)),
        )
    }

    expect(after).not.toBe(before)
    expect(presence).toBe(1)
  })
})

/**
 * The library against the music people actually put on. Everything else in
 * this file asks whether the director chooses well given a character; these
 * ask whether the twenty characters in `tracks.fixture.ts`, which are
 * measured and not invented, reach the whole library and pull it apart.
 */
describe('the library over twenty real tracks', () => {
  const ROTATIONS = [0, 1, 2]

  /** Every cast the twenty tracks can be given, over every moment. */
  const everyCast = (): PickedCast[] => {
    const out: PickedCast[] = []
    for (const { character } of TRACKS)
      for (const moment of MOMENTS)
        for (const rotation of ROTATIONS) {
          const cast = pickCast({ character, weights: moments({ [moment]: 1 }), rotation })
          if (cast) out.push(cast)
        }

    return out
  }

  // A study nothing can reach is a study nobody will ever see, whatever its
  // home says. This is the test that holds a home honest: move one too far
  // into a corner of the space and it drops out here.
  it('gives every study a seat for some track at some moment', () => {
    const seated = new Set<string>()
    for (const cast of everyCast()) {
      if (cast.flow) seated.add(cast.flow)
      seated.add(cast.look)
      for (const ink of cast.inks) seated.add(ink)
    }

    const missing = STUDIES.filter((study) => !seated.has(study.id)).map((study) => study.id)
    expect(missing).toEqual([])
  })

  // The complaint this was all built to answer: heavy metal looked like
  // everything else. In a groove, with nothing but the character to go on,
  // the twenty tracks have to be told apart.
  it('casts a groove differently for different kinds of track', () => {
    const groove = TRACKS.map(({ name: track, character }) => ({
      track,
      cast: name(pickCast({ character, weights: moments({ groove: 1 }) })),
    }))
    expect(new Set(groove.map((at) => at.cast)).size).toBeGreaterThanOrEqual(8)

    const castOf = (track: string) => groove.find((at) => at.track.startsWith(track))?.cast
    // A wall of guitars and a piano over a pad are the two ends of the axis
    // that was wrong, so they are the two that must not meet in the middle.
    expect(castOf('August Burns Red')).not.toBe(castOf('Christian Loffler'))
    expect(castOf('Bring Me The Horizon')).not.toBe(castOf('Wilco'))
    expect(castOf('Pendulum')).not.toBe(castOf('Daft Punk'))
  })
})
