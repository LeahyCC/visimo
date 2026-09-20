/**
 * How the bench writes over the packet. The controls it owns are the five
 * character axes and the three moment levels, and each of them is a packet row
 * or two; an override says which row and what number, and this is the whole of
 * how it lands. Nothing else in the packet is touched, which is what lets a
 * live track keep playing under a bench that holds only the tension.
 *
 * The list is built when a control moves and this walks it every frame, so
 * there is nothing to allocate here and the packet comes back as the very
 * array it went in as.
 */
import { F, IMPACT_DECAY_SECONDS } from '../../src/audio/FeatureExtractor'
import { CHARACTER_AXES } from '../../src/presets'

/**
 * `set` replaces the row. `raise` only lifts it, which is how an event the
 * bench fires by hand sits beside one the music fires: a real impact landing
 * under a decaying fake one is still a 1.
 */
export type RowOverride = { row: number; value: number; mode: 'set' | 'raise' }

/** Write every override into `packet` in place, and hand the same packet back. */
export function overridePacket(
  packet: Float32Array,
  overrides: readonly RowOverride[],
): Float32Array {
  for (let at = 0; at < overrides.length; at += 1) {
    const entry = overrides[at]
    if (!entry || entry.row < 0 || entry.row >= packet.length) continue
    packet[entry.row] =
      entry.mode === 'raise' ? Math.max(packet[entry.row] ?? 0, entry.value) : entry.value
  }

  return packet
}

/** The eight levels a slider holds. `impact` is an event and has a button instead. */
export const BENCH_ROWS = [...CHARACTER_AXES, 'tension', 'release', 'rest'] as const
export type BenchRow = (typeof BENCH_ROWS)[number]

/**
 * Which packet rows a control owns. The character axes are read back out of
 * the packet by `director/character.ts`, so each of them writes the row that
 * reader takes it from: drive is the mean of `pace` and `tempo`, so it writes
 * both and the reader gets it back whole. That means the drive slider also
 * sets `tempo` for a study that reads it, and the BPM beside it only sets the
 * beat's rate.
 */
export const ROWS_OF: Readonly<Record<BenchRow, readonly number[]>> = {
  drive: [F.pace, F.tempo],
  weight: [F.weight],
  tonality: [F.keyClarity],
  steadiness: [F.tempoConfidence],
  hardness: [F.hardness],
  tension: [F.tension],
  release: [F.release],
  rest: [F.rest],
}

/** What a control reads when nothing holds it: no opinion on an axis, no moment. */
export const REST_LEVEL: Readonly<Record<BenchRow, number>> = {
  drive: 0.5,
  weight: 0.5,
  tonality: 0.5,
  steadiness: 0.5,
  hardness: 0.5,
  tension: 0,
  release: 0,
  rest: 0,
}

export type Held = Readonly<Partial<Record<BenchRow, number>>>

export const isBenchRow = (value: string): value is BenchRow =>
  (BENCH_ROWS as readonly string[]).includes(value)

const unit = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

/**
 * The overrides for a set of controls. Over a live track only the held ones
 * are written and the rest of the music passes through. Over a synthetic
 * packet there is no music to pass through, so every control is written, held
 * or not, at its resting level when nothing holds it.
 */
export function overridesFor(held: Held, everything: boolean): RowOverride[] {
  const out: RowOverride[] = []
  for (const key of BENCH_ROWS) {
    const value = held[key] ?? (everything ? REST_LEVEL[key] : undefined)
    if (value === undefined) continue
    for (const row of ROWS_OF[key]) out.push({ row, value: unit(value), mode: 'set' })
  }

  return out
}

/**
 * The impact row one frame on, the way the extractor writes it: 1 on the frame
 * it lands and its own fall after that. The same time constant, so a study
 * reads a fired one exactly as it reads a real one.
 */
export const stepImpact = (level: number, fired: boolean, dt: number): number =>
  fired ? 1 : level * Math.exp(-dt / IMPACT_DECAY_SECONDS)
