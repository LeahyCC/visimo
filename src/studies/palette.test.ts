/**
 * Which palette the picture is coloured in, from the studies down: each look
 * names one, two looks cross-fade theirs by presence, and a pinned cast keeps
 * classic so it renders as it always did. The palettes' own numbers are
 * `palettes/palettes.test.ts`; this is the rule about who chooses.
 */
import { describe, expect, it } from 'vitest'

import { PALETTES } from '../palettes/defs'
import { bakePalette, isPaletteId, PALETTE_IDS } from '../palettes/palette'
import type { PaletteId } from '../palettes/palette'
import { parseCast, PINNED_PALETTE } from './cast'
import { CASTS } from './casts/index'
import plume from './casts/plume.json'
import { studiesOfKind } from './registry'
import { castFrame, liveCast, resolveCast, resolveLive } from './resolve'
import { isLook } from './types'

const FIRST = CASTS[0]
if (!FIRST) throw new Error('palette.test: no pinned casts were loaded')

/** The canvas is only read for its feedback, so any cast's will do. */
const CANVAS = FIRST.canvas
const PACKET = new Float32Array(64)

function resolveLooks(
  entries: readonly [string, number][],
  palette?: PaletteId,
): ReturnType<typeof castFrame>['palette'] {
  const out = castFrame()
  resolveLive(
    entries.map(([id, presence]) => ({ id, presence })),
    CANVAS,
    PACKET,
    0,
    out,
    palette,
  )

  return { ...out.palette }
}

describe('the looks own the palette', () => {
  const looks = studiesOfKind('look').filter(isLook)

  it('has a look for each of the six looks the catalogue ships', () => {
    expect(looks.map((look) => look.id).sort()).toEqual(
      ['clean-glass', 'film', 'hard-clean', 'impact-flash', 'squeeze', 'warm-soft'].sort(),
    )
  })

  it('names a palette that exists, for every look', () => {
    for (const look of looks) expect(isPaletteId(look.palette), look.id).toBe(true)
  })

  it('gives the six looks six different designed palettes, so the director’s choice of look is a choice of colour', () => {
    const names = looks.map((look) => look.palette)
    expect(new Set(names).size).toBe(looks.length)
    expect(names).not.toContain('classic')
  })

  it('pairs each look with a palette whose mood is stated for it', () => {
    // The mood line says what the palette is for; a look's palette is the one
    // whose line names the moment or feel the look is for.
    const of = (id: string) => looks.find((look) => look.id === id)?.palette
    expect(of('impact-flash')).toBe('ember')
    expect(of('squeeze')).toBe('abyss')
    expect(of('hard-clean')).toBe('neon')
    expect(of('warm-soft')).toBe('dusk')
    expect(of('film')).toBe('mono-gold')
    expect(of('clean-glass')).toBe('aurora')
  })

  it('follows the one look that is live, whole', () => {
    expect(resolveLooks([['warm-soft', 1]])).toEqual({ from: 'dusk', to: 'dusk', mix: 0 })
    expect(resolveLooks([['impact-flash', 0.4]])).toEqual({ from: 'ember', to: 'ember', mix: 0 })
  })

  it('is classic when no look is live at all', () => {
    expect(resolveLooks([])).toEqual({ from: PINNED_PALETTE, to: PINNED_PALETTE, mix: 0 })
    expect(resolveLooks([['warm-soft', 0]])).toEqual({
      from: PINNED_PALETTE,
      to: PINNED_PALETTE,
      mix: 0,
    })
  })
})

describe('two looks at once', () => {
  it('cross-fades by presence: a look at a quarter brings a quarter of its colour', () => {
    const choice = resolveLooks([
      ['squeeze', 0.75],
      ['impact-flash', 0.25],
    ])
    // Ember comes before abyss in the list, so it is `from` and the mix is how
    // much of abyss is in: squeeze's three quarters.
    expect(choice.from).toBe('ember')
    expect(choice.to).toBe('abyss')
    expect(choice.mix).toBeCloseTo(0.75, 9)
  })

  it('normalises the presences, as the looks are, so two at a half are halfway', () => {
    const choice = resolveLooks([
      ['squeeze', 0.3],
      ['impact-flash', 0.3],
    ])
    expect(choice.mix).toBeCloseTo(0.5, 9)
  })

  it('keeps the pair in list order, so the mix runs once, one way, and the ends never swap', () => {
    // Sweep impact flash (ember) in as squeeze (abyss) leaves. Whichever look
    // is ahead, the pair is ember then abyss, so the mix only ever falls: the
    // colour at the halfway point is one colour, not two depending on which
    // side arrived at it.
    let last = 2
    for (let step = 1; step <= 9; step++) {
      const share = step / 10
      const choice = resolveLooks([
        ['squeeze', 1 - share],
        ['impact-flash', share],
      ])
      expect(choice.from).toBe('ember')
      expect(choice.to).toBe('abyss')
      expect(choice.mix).toBeLessThan(last)
      last = choice.mix
    }
  })

  it('is one palette when the other look has gone, whichever look that is', () => {
    const start = resolveLooks([
      ['squeeze', 1],
      ['impact-flash', 0],
    ])
    expect(start).toEqual({ from: 'abyss', to: 'abyss', mix: 0 })
    const end = resolveLooks([
      ['squeeze', 0],
      ['impact-flash', 1],
    ])
    expect(end).toEqual({ from: 'ember', to: 'ember', mix: 0 })
  })

  it('bakes the fade’s two ends to each palette alone', () => {
    // The whole fade, through the resolver: at either end the table is the
    // palette of the look that is there, texel for texel.
    const bake = (entries: readonly [string, number][]) => {
      const { from, to, mix } = resolveLooks(entries)
      return bakePalette({ from: PALETTES[from], to: PALETTES[to], mix }, 0.3)
    }
    const alone = (id: PaletteId) =>
      bakePalette({ from: PALETTES[id], to: PALETTES[id], mix: 0 }, 0.3)
    expect(
      bake([
        ['squeeze', 1],
        ['impact-flash', 0],
      ]),
    ).toEqual(alone('abyss'))

    expect(
      bake([
        ['squeeze', 0],
        ['impact-flash', 1],
      ]),
    ).toEqual(alone('ember'))
  })

  it('treats two looks that name one palette as one palette, whatever their fades', () => {
    // No two shipped looks share a palette, so a hand-built one stands in.
    const out = castFrame()
    resolveLive(
      [
        { id: 'warm-soft', presence: 0.4 },
        { id: 'warm-soft', presence: 0.6 },
      ],
      CANVAS,
      PACKET,
      0,
      out,
    )
    expect(out.palette).toEqual({ from: 'dusk', to: 'dusk', mix: 0 })
  })

  it('drops the weakest when three are live, and keeps the two strongest', () => {
    const choice = resolveLooks([
      ['warm-soft', 0.1],
      ['squeeze', 0.5],
      ['impact-flash', 0.4],
    ])
    // Abyss (0.5) and ember (0.4) stay; dusk (0.1) goes. Ember is first in the list.
    expect(choice.from).toBe('ember')
    expect(choice.to).toBe('abyss')
    expect(choice.mix).toBeCloseTo(0.5 / 0.9, 9)
  })
})

describe('a pinned cast', () => {
  it('draws in classic, whichever look it is shown through', () => {
    for (const cast of CASTS) {
      expect(cast.palette, cast.id).toBe('classic')
      const out = castFrame()
      resolveCast(cast, PACKET, 0, out)
      expect(out.palette, cast.id).toEqual({ from: 'classic', to: 'classic', mix: 0 })
    }
  })

  it('does not take the palette its look names, since a pinned cast is a fixed picture', () => {
    const cast = CASTS.find((entry) => entry.look === 'warm-soft')
    expect(cast).toBeDefined()
    // Warm and soft names dusk; the cast holding it is drawn in classic all the same.
    expect(resolveLooks([['warm-soft', 1]]).from).toBe('dusk')
    const out = castFrame()
    if (cast) resolveCast(cast, PACKET, 0, out)
    expect(out.palette.from).toBe('classic')
  })

  it('goes into the live cast a host pins, so the renderer holds it over the looks', () => {
    for (const cast of CASTS) expect(liveCast(cast).palette).toBe('classic')
  })

  it('takes the palette its file names, when it names one', () => {
    const cast = parseCast({ ...plume, palette: 'ember' }, 'casts/plume.json')
    expect(cast.palette).toBe('ember')
    const out = castFrame()
    resolveCast(cast, PACKET, 0, out)
    expect(out.palette).toEqual({ from: 'ember', to: 'ember', mix: 0 })
    expect(liveCast(cast).palette).toBe('ember')
  })

  it('is classic when its file says nothing, so the three shipped files are untouched', () => {
    expect(parseCast(plume, 'casts/plume.json').palette).toBe('classic')
  })

  it('rejects a palette that is not one, saying which are', () => {
    expect(() => parseCast({ ...plume, palette: 'beige' }, 'casts/plume.json')).toThrow(
      /palette.*is not a palette; they are classic, ember/,
    )
    expect(() => parseCast({ ...plume, palette: 3 }, 'casts/plume.json')).toThrow(/palette/)
  })

  it('has every palette id a cast file can name', () => {
    for (const id of PALETTE_IDS)
      expect(parseCast({ ...plume, palette: id }, 'casts/plume.json').palette).toBe(id)
  })
})

describe('the director’s cast', () => {
  it('leaves the palette to the looks: a live cast with none set follows them', () => {
    const cast = { ...liveCast(FIRST), palette: undefined }
    const out = castFrame()
    resolveLive([{ id: 'hard-clean', presence: 1 }], cast.canvas, PACKET, 0, out, cast.palette)
    expect(out.palette).toEqual({ from: 'neon', to: 'neon', mix: 0 })
  })

  it('holds a palette over the looks when one is asked for', () => {
    expect(resolveLooks([['hard-clean', 1]], 'ember')).toEqual({
      from: 'ember',
      to: 'ember',
      mix: 0,
    })
  })

  it('is a set of numbers held between frames and never a new object', () => {
    const out = castFrame()
    const held = out.palette
    resolveLive([{ id: 'film', presence: 1 }], CANVAS, PACKET, 0, out)
    resolveLive([{ id: 'squeeze', presence: 1 }], CANVAS, PACKET, 0, out)
    expect(out.palette).toBe(held)
    expect(held.from).toBe('abyss')
  })
})
