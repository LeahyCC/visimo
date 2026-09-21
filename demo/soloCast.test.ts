import { describe, expect, it } from 'vitest'

import { castStudyIds, findStudy, parseCast, STUDIES } from '../src/presets'
import type { Study } from '../src/presets'
import { findSolo, soloCast } from './soloCast'

const study = (id: string): Study => {
  const found = findStudy(id)
  if (!found) throw new Error(`${id} is not a study`)
  return found
}

const held = (ids: readonly string[]): Study[] => ids.map(study)

describe('soloCast', () => {
  it('has studies to cover', () => {
    expect(STUDIES.length).toBeGreaterThan(0)
  })

  describe.each(STUDIES.map((entry) => [entry.id, entry] as const))('%s', (_id, subject) => {
    const cast = soloCast(subject)
    const studies = held(castStudyIds(cast))

    it('is named for the study and holds it', () => {
      expect(cast.id).toBe(`solo:${subject.id}`)
      expect(cast.name).toBe(subject.name)
      expect(castStudyIds(cast)).toContain(subject.id)
    })

    it('passes the validation a pinned cast goes through, and survives being copied as JSON', () => {
      expect(() => parseCast(cast, 'test')).not.toThrow()
      expect(parseCast(JSON.parse(JSON.stringify(cast)), 'test')).toEqual(cast)
    })

    it('has every implementation its studies require', () => {
      for (const one of studies)
        for (const impl of one.requires ?? [])
          expect(
            studies.some((other) => other.impl === impl),
            `${one.id} requires ${impl}`,
          ).toBe(true)
    })

    it('holds no two studies that exclude each other', () => {
      for (const one of studies)
        for (const other of one.excludes ?? [])
          expect(
            studies.some((entry) => entry.id === other),
            `${one.id} excludes ${other}`,
          ).toBe(false)
    })
  })

  it('gives the shape each kind is asked for', () => {
    const lazy = soloCast(study('lazy-fluid'))
    expect(castStudyIds(lazy)).toEqual(['lazy-fluid', 'dye-plumes', 'clean-glass'])
    const curl = soloCast(study('curl-drift'))
    expect(castStudyIds(curl)).toEqual(['curl-drift', 'ribbon', 'clean-glass'])
    const dye = soloCast(study('dye-plumes'))
    expect(findStudy(dye.flow ?? '')?.impl).toBe('fluid')
    const fractal = soloCast(study('fractal-glints'))
    expect(castStudyIds(fractal)).toEqual(['curl-drift', 'fractal-glints', 'clean-glass'])
    const warm = soloCast(study('warm-soft'))
    expect(castStudyIds(warm)).toEqual(['lazy-fluid', 'dye-plumes', 'warm-soft'])
  })

  it('hands back the same cast each time, so an edit can be told from the original', () => {
    const first = study('lazy-fluid')
    expect(soloCast(first)).toBe(soloCast(first))
    expect(findSolo('solo:lazy-fluid')).toBe(soloCast(first))
  })

  it('finds nothing for an id that is not a solo', () => {
    expect(findSolo('not-a-solo')).toBeUndefined()
    expect(findSolo('solo:nothing-like-this')).toBeUndefined()
  })
})
