import { describe, expect, it } from 'vitest'

import { MAX_INKS, STUDIES } from '../../src/presets'
import { BENCH_ROWS } from './packet'
import {
  castProblem,
  decodeBench,
  encodeBench,
  initialBench,
  plainest,
  slotIds,
  slotsAround,
  soloState,
  withSlots,
} from './state'
import type { BenchState } from './state'

const tuned = (): BenchState => ({
  flow: 'turbulent-fluid',
  inks: ['dye-plumes', 'ribbon'],
  look: 'hard-clean',
  presence: { 'dye-plumes': 0.4, 'ribbon': 0.75 },
  synthetic: true,
  bpm: 174,
  level: 0.55,
  held: { drive: 0.9, tension: 0.6, release: 0.1 },
})

describe('plainest', () => {
  it('lists the cheapest first, then the widest welcome', () => {
    const inks = plainest('ink')
    expect(inks.at(-1)?.cost).toBe('heavy')
    expect(inks[0]?.id).toBe('ribbon')
  })

  it('does not depend on the order the studies were listed in', () => {
    const backwards = [...STUDIES].reverse()
    expect(plainest('look', backwards).map((study) => study.id)).toEqual(
      plainest('look').map((study) => study.id),
    )
  })

  it('lists only the kind it was asked for', () => {
    for (const kind of ['flow', 'ink', 'look'] as const)
      for (const study of plainest(kind)) expect(study.kind).toBe(kind)
  })
})

describe('soloing a study', () => {
  it('can be drawn for every study in the registry', () => {
    for (const study of STUDIES) {
      const slots = slotsAround(study)
      expect(castProblem(slots)).toBeNull()
      expect(slotIds(slots)).toContain(study.id)
    }
  })

  it('puts the study in its own slot and the plainest around it', () => {
    const fractal = STUDIES.find((study) => study.id === 'fractal-glints')
    if (!fractal) throw new Error('fractal-glints is gone')
    const slots = slotsAround(fractal)
    expect(slots.inks).toEqual(['fractal-glints'])
    expect(slots.flow).toBe(plainest('flow')[0]?.id)
    expect(slots.look).toBe(plainest('look')[0]?.id)
  })

  it('gives an ink that needs a fluid a fluid to draw on', () => {
    const dye = STUDIES.find((study) => study.id === 'dye-plumes')
    if (!dye) throw new Error('dye-plumes is gone')
    expect(castProblem(slotsAround(dye))).toBeNull()
  })

  it('keeps the signal and resets the slots and the fades', () => {
    const fluid = STUDIES.find((study) => study.kind === 'flow')
    if (!fluid) throw new Error('no flow')
    const next = soloState(fluid, tuned())
    expect(next.flow).toBe(fluid.id)
    expect(next.presence).toEqual({})
    expect(next.synthetic).toBe(true)
    expect(next.bpm).toBe(174)
    expect(next.held).toEqual(tuned().held)
  })

  it('opens on a cast that can be drawn', () => {
    expect(castProblem(initialBench())).toBeNull()
  })
})

describe('castProblem', () => {
  it('says why in the parser words when a cast cannot be drawn', () => {
    expect(castProblem({ flow: null, inks: ['dye-plumes'], look: 'warm-soft' })).toMatch(/fluid/)
    expect(
      castProblem({
        flow: 'lazy-fluid',
        inks: ['dye-plumes', 'fractal-glints'],
        look: 'warm-soft',
      }),
    ).toMatch(/may not share/)
  })
})

describe('withSlots', () => {
  it('drops the fade of a study that has left the cast', () => {
    const next = withSlots(tuned(), {
      flow: 'turbulent-fluid',
      inks: ['ribbon'],
      look: 'hard-clean',
    })
    expect(next.presence).toEqual({ ribbon: 0.75 })
    expect(next.held).toEqual(tuned().held)
  })
})

describe('the hash', () => {
  it('reads back what it wrote', () => {
    expect(decodeBench(encodeBench(tuned()))).toEqual(tuned())
    expect(decodeBench(`#${encodeBench(tuned())}`)).toEqual(tuned())
  })

  it('reads back the opening bench and one with no flow', () => {
    expect(decodeBench(encodeBench(initialBench()))).toEqual(initialBench())
    const bare = { ...initialBench(), flow: null }
    expect(decodeBench(encodeBench(bare))).toEqual(bare)
  })

  it('leaves a fade at 1 out, and a control nobody holds', () => {
    const text = encodeBench({ ...tuned(), presence: { ribbon: 1 }, held: {} })
    expect(text).not.toContain('p.')
    for (const key of BENCH_ROWS) expect(text).not.toContain(`${key}=`)
  })

  it('is not a bench when it does not say so', () => {
    expect(decodeBench('')).toBeNull()
    expect(decodeBench('#')).toBeNull()
    expect(decodeBench('#section=2')).toBeNull()
    expect(decodeBench('#bench=0&flow=lazy-fluid')).toBeNull()
  })

  it('takes what is good in a hash and defaults the rest', () => {
    const state = decodeBench(
      '#bench=1&inks=nope,ribbon&look=missing&flow=ribbon&bpm=abc&level=&tension=x',
    )
    expect(state?.inks).toEqual(['ribbon'])
    expect(state?.look).toBe(initialBench().look)
    // A study of the wrong kind is no study for that slot.
    expect(state?.flow).toBe(initialBench().flow)
    expect(state?.bpm).toBe(initialBench().bpm)
    expect(state?.level).toBe(initialBench().level)
    expect(state?.held).toEqual({})
  })

  it('clamps numbers to what the controls can hold', () => {
    const state = decodeBench('#bench=1&bpm=9999&level=4&tension=-2&drive=7&p.ribbon=3')
    expect(state?.bpm).toBe(240)
    expect(state?.level).toBe(1)
    expect(state?.held).toEqual({ tension: 0, drive: 1 })
    expect(state?.presence.ribbon).toBe(1)
  })

  it('holds at most as many inks as a cast draws, each once', () => {
    const state = decodeBench('#bench=1&inks=ribbon,ribbon,dye-plumes,fractal-glints,ribbon')
    expect(state?.inks).toEqual(['ribbon', 'dye-plumes', 'fractal-glints'].slice(0, MAX_INKS))
  })

  it('falls back to an ink when none is named', () => {
    expect(decodeBench('#bench=1&inks=')?.inks).toEqual(initialBench().inks)
  })

  it('does not throw on garbage', () => {
    for (const hash of [
      '#bench=1&%E0%A4%A',
      '#bench=1&&&=&=',
      '#bench=1&inks=%00',
      'bench=1&flow=',
    ]) {
      expect(() => decodeBench(hash)).not.toThrow()
    }
  })
})
