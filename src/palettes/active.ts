/**
 * The palette that is showing, held in one place so everything that reads the
 * shared palette reads the same one. The renderer sets it once a frame, after
 * the studies are resolved and before anything draws, and then the fluid's
 * lookup table, the ribbon and every ink that takes its colour from the
 * ribbon's palette follow without knowing a palette changed.
 *
 * It is module state, which is not how the rest of the renderer is built, and
 * the reason is the call sites: the inks ask `ribbonColour(features)` from a
 * dozen places that have no palette to hand, and threading one through each
 * would touch every ink's parameters for a value that is the same for all of
 * them. It is safe because a frame runs from start to finish with nothing
 * awaited in between: the palette set at the top of a frame is the one every
 * ink reads before the next frame sets its own.
 *
 * Baking the table costs a few hundred colour conversions, so it is redone
 * only when the choice or the key has moved by a step the eye could see, and
 * `paletteVersion` says when, so the GPU copy is written on a change and not
 * every frame.
 */
import type { Rgb } from '../colour/oklch'
import { PALETTES } from './defs'
import { bakePalette, lutBytes, readBaked } from './palette'
import type { PaletteChoice } from './palette'

/**
 * The finest step the key and the mix are held to. A key step of 1/512 turns
 * the hue of the most swinging palette by about a degree, under what shows,
 * and a mix step of 1/64 is a step of a colour's blend that a fade of a second
 * or more cannot show.
 */
const KEY_STEPS = 512
const MIX_STEPS = 64

type Held = PaletteChoice & { key: number }

function bakeInput({ from, to, mix }: PaletteChoice) {
  return { from: PALETTES[from], to: PALETTES[to], mix }
}

let held: Held = { from: 'classic', to: 'classic', mix: 0, key: 0 }
let baked = bakePalette(bakeInput(held), held.key)
let bytes = lutBytes(baked)
let version = 0

/**
 * Make this the palette showing. The key only matters to a palette that swings
 * with it, so a choice made of walking palettes ignores the key and never
 * rebakes for it.
 */
export function setPalette(choice: PaletteChoice, key: number) {
  const mix =
    choice.from === choice.to
      ? 0
      : Math.round(Math.min(1, Math.max(0, choice.mix)) * MIX_STEPS) / MIX_STEPS
  const to = mix > 0 ? choice.to : choice.from
  const swings = PALETTES[choice.from].key !== 'walk' || (mix > 0 && PALETTES[to].key !== 'walk')
  // A NaN from a packet that has no key yet falls to 0, and the ring is
  // periodic, so any whole number of turns is the same key.
  const turn = Number.isFinite(key) ? ((key % 1) + 1) % 1 : 0
  const next: Held = {
    from: choice.from,
    to,
    mix,
    key: swings ? Math.round(turn * KEY_STEPS) / KEY_STEPS : 0,
  }
  if (
    next.from === held.from &&
    next.to === held.to &&
    next.mix === held.mix &&
    next.key === held.key
  )
    return
  held = next
  baked = bakePalette(bakeInput(held), held.key)
  bytes = lutBytes(baked)
  version += 1
}

/** Back to the classic palette, as a fresh renderer starts. */
export const resetPalette = () => setPalette({ from: 'classic', to: 'classic', mix: 0 }, 0)

/**
 * The palette at one coordinate, as three floats from 0 to 1. The coordinate
 * wraps like everything else that names a place in the palette, so 1 is 0 and
 * a negative one counts back from the end. Anything that wants a colour of the
 * fluid's asks here rather than keeping a palette of its own.
 */
export const paletteAt = (coordinate: number): Rgb => readBaked(baked, coordinate)

/** The palette as one row of `rgba8unorm` texels, ready for `writeTexture`. */
export const paletteLut = (): Uint8Array => bytes

/** Changes whenever the row above does, so a copy on the GPU knows when to be rewritten. */
export const paletteVersion = () => version

/** What is showing now, for a test or an overlay. */
export const heldPalette = (): Readonly<Held> => held
