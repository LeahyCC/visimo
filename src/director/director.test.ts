import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { MAX_INKS } from '../studies/cast'
import { CASTS } from '../studies/casts'
import { findStudy, STUDIES } from '../studies/registry'
import type { LiveStudy } from '../studies/resolve'
import type { Character, FlowStudy, InkStudy, LookStudy, Moments, Study } from '../studies/types'
import { COST_OF, Director, pickCast } from './director'
import type { PickedCast } from './director'
import type { MomentWeights } from './moment'
import { DROP_AT, HARDSTYLE, HOUSE, LOFI, PARTS, playSong } from './song.fixture'

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

const packet = (values: Partial<Record<keyof typeof F, number>>) => {
  const out = new Float32Array(PACKET_LENGTH)
  out[F.energy] = 0.8
  out[F.swell] = 0.5
  for (const [name_, value] of Object.entries(values)) out[F[name_ as keyof typeof F]] = value
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
    expect(presenceOf(director.step(groove, 1 / 60).live, 'build-ink')).toBe(0)
    expect(director.step(groove, 1 / 60).live.some((entry) => entry.id === 'build-ink')).toBe(false)
    for (const entry of director.step(groove, 1 / 60).live)
      expect(entry.presence).toBeGreaterThan(0)
  })

  it('hands back the same list and the same entries every frame', () => {
    const director = new Director({ studies: BENCH })
    const groove = packet({ section: 1 })
    const first = director.step(groove, 1 / 60)
    const entry = first.live[0]
    const second = director.step(groove, 1 / 60)
    expect(second.live).toBe(first.live)
    expect(second.live[0]).toBe(entry)
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

  it('opens on the widest welcome and drifts into the track’s own', () => {
    const track: Character = { ...NEUTRAL, hardness: 0.95, drive: 0.9 }
    const elsewhere: Character = { ...NEUTRAL, hardness: 0.05, drive: 0.1 }
    const wide = ink('wide-ink', moments({ groove: 1 }), { reach: 1, home: elsewhere })
    const near = ink('near-ink', moments({ groove: 1 }), { reach: 0.2, home: track })
    const studies = [GROOVE_FLOW, ONE_LOOK, wide, near]
    const director = new Director({ studies, budget: 4 })
    const early = packet({
      section: 1,
      pace: 0.9,
      tempo: 0.9,
      hardness: 0.95,
      weight: 0.5,
      keyClarity: 0.5,
      tempoConfidence: 0.5,
    })
    run(director, early, 4)
    expect(director.cast?.inks).toEqual(['wide-ink'])
    run(director, early, 60)
    // Settled, and a boundary to act on it.
    run(
      director,
      packet({
        section: 2,
        pace: 0.9,
        tempo: 0.9,
        hardness: 0.95,
        weight: 0.5,
        keyClarity: 0.5,
        tempoConfidence: 0.5,
      }),
      2,
    )
    expect(director.cast?.inks).toEqual(['near-ink'])
  })
})

describe('how a change lands', () => {
  const settle = (director: Director, features: Float32Array, seconds: number) =>
    run(director, features, seconds)

  it('glides over seconds on a section change', () => {
    const director = new Director({ studies: BENCH, budget: 4 })
    settle(director, packet({ section: 1, rest: 0.9 }), 10)
    expect(
      presenceOf(director.step(packet({ section: 1, rest: 0.9 }), 1 / 60).live, 'quiet-ink'),
    ).toBe(1)
    const frame = run(director, packet({ section: 2 }), 0.25)
    expect(presenceOf(frame.live, 'groove-ink')).toBeGreaterThan(0)
    expect(presenceOf(frame.live, 'groove-ink')).toBeLessThan(0.3)
    expect(presenceOf(frame.live, 'quiet-ink')).toBeGreaterThan(0.6)
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
    expect(presenceOf(frame.live, 'drop-flow')).toBe(1)
    expect(presenceOf(frame.live, 'groove-flow')).toBe(0)
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
})

describe('a pinned cast', () => {
  const pinned = CASTS[0]!

  it('turns the director off and hands that cast back whole', () => {
    const director = new Director({ pinned })
    const frame = director.step(
      packet({ section: 1, tension: 0.3, impact: 1, novelty: 0.9 }),
      1 / 60,
    )
    const ids = frame.live.map((entry) => entry.id)
    expect(ids).toEqual([pinned.flow, ...pinned.inks, pinned.look].filter(Boolean))
    for (const entry of frame.live) expect(entry.presence).toBe(1)
    expect(frame.canvas).toBe(pinned.canvas)
    expect(frame.tension).toBeCloseTo(0.3)
  })

  it('never changes, whatever the song does', () => {
    const director = new Director({ pinned })
    const before = director.step(packet({ section: 1 }), 1 / 60).live.map((entry) => entry.id)
    for (const { dt, features } of playSong(60, HARDSTYLE, 120)) director.step(features, dt)
    expect(director.step(packet({ section: 9 }), 1 / 60).live.map((entry) => entry.id)).toEqual(
      before,
    )
    expect(director.cast).toBeUndefined()
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
      if (frame.live.length > 0) started = true
      if (started) expect(frame.live.length).toBeGreaterThan(0)
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
        presence = Math.min(...(director.cast?.inks ?? []).map((id) => presenceOf(frame.live, id)))
    }

    expect(after).not.toBe(before)
    expect(presence).toBe(1)
  })
})
