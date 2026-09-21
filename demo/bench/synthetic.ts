/**
 * A packet written by hand, so a study can be judged with nothing playing: a
 * four on the floor beat at a chosen tempo with a snare on two and four and a
 * hat between, laid into the rows the extractor would have written for it.
 *
 * It rewrites the whole packet, not some rows of it. A live packet under a
 * synthetic beat would mix the room's sound in with the fake one, and the
 * point is that nothing is playing. What it leaves alone is `time` and `dt`,
 * which belong to the renderer, and the eight rows the sliders own, which the
 * overrides write afterwards.
 *
 * The clock is a count of beats advanced by the real `dt`, and a hit fires on
 * the frame an eighth note is crossed, so a beat lands once per beat at 30, 60
 * or 144 frames a second.
 */
import {
  BAND_COUNT,
  BAND_HIT,
  BAND_HIT_CENTRE,
  BAND_HIT_WIDTH,
  BAND_PULSE,
  CHROMA_ROW,
  DEFAULT_BANDS,
  F,
  IMPACT_DECAY_SECONDS,
} from '../../src/audio/FeatureExtractor'
import { follow } from '../../src/presets/shapes'

export const BPM_RANGE = [40, 240] as const

/** Eighth notes in a bar of four. */
const SLOTS = 8

/**
 * Each band's pulse falls the way `beatPulse` does. The extractor's own
 * `impact` is documented as falling at the same rate, so its constant is the
 * one to share.
 */
const PULSE_SECONDS = IMPACT_DECAY_SECONDS

/**
 * How much of a band's level is there between hits: a bass note is mostly a
 * held tone and a hat is mostly the hit, so the low bands rest higher.
 */
const BED = [0.5, 0.5, 0.35, 0.3, 0.3] as const

// Kick on every beat and snare on two and four, both in the bands they would
// light, and a hat on the eighths between. A slot is half a beat.
const KICK_BANDS = [0, 1] as const
const SNARE_BANDS = [2, 3] as const
const HAT_BANDS = [4] as const
const HIT = { kick: 1, snare: 0.8, hat: 0.6 } as const

/**
 * One chord a bar, round and round: C, G, A minor, F, as pitch classes. The
 * commonest four in pop, and a key change is not needed to see the flower move.
 */
const PROGRESSION = [
  [0, 4, 7],
  [7, 11, 2],
  [9, 0, 4],
  [5, 9, 0],
] as const

/** The note rows rise and fall as the extractor's do, so a study sees the same shape. */
const NOTE_ATTACK_MS = 50
const NOTE_RELEASE_MS = 450

/** The last phase below a whole beat that a Float32 still holds as itself. */
const PHASE_MAX = 0.999999

const SAMPLE_RATE = 48000
/** As many samples as the analyser's buffer holds, which is what the ribbon resamples. */
const WAVE_SAMPLES = 2048
/** Three tones, one per region a hit lands in. */
const TONES = [
  { hz: 55, band: 1, gain: 0.55 },
  { hz: 330, band: 2, gain: 0.25 },
  { hz: 2400, band: 4, gain: 0.15 },
] as const

const SPAN_OCTAVES = Math.log2(
  (DEFAULT_BANDS[BAND_COUNT - 1]?.high ?? 16000) / (DEFAULT_BANDS[0]?.low ?? 20),
)

const clamp = (value: number, low: number, high: number) =>
  value < low ? low : value > high ? high : value

export type SyntheticSettings = { bpm: number; level: number }

export class SyntheticBeat {
  private beats = 0
  private slot = -1
  private samples = 0
  private readonly pulse = new Float32Array(BAND_COUNT)
  private readonly notes = new Float32Array(12)
  private readonly wave = new Float32Array(WAVE_SAMPLES)

  /** Start the bar again, for a bench that has just been switched on. */
  reset() {
    this.beats = 0
    this.slot = -1
    this.samples = 0
    this.pulse.fill(0)
    this.notes.fill(0)
  }

  /**
   * Rewrite `packet` for a frame of `dt` seconds. Every row is cleared first,
   * so nothing the analyser wrote survives, and `time` and `dt` are put back.
   */
  write(packet: Float32Array, dt: number, settings: SyntheticSettings): Float32Array {
    const time = packet[F.time] ?? 0
    packet.fill(0)
    packet[F.time] = time
    packet[F.dt] = dt

    const bpm = clamp(settings.bpm, BPM_RANGE[0], BPM_RANGE[1])
    const level = clamp(settings.level, 0, 1)
    this.beats += (dt * bpm) / 60
    this.samples += dt * SAMPLE_RATE

    const keep = Math.exp(-dt / PULSE_SECONDS)
    for (let band = 0; band < BAND_COUNT; band += 1)
      this.pulse[band] = (this.pulse[band] ?? 0) * keep

    // One hit per frame at most, however many eighths a long frame crossed:
    // the analyser cannot see two onsets in one frame either.
    const slot = Math.floor(this.beats * 2)
    let strength = 0
    if (slot !== this.slot) {
      this.slot = slot
      strength = this.fire(packet, ((slot % SLOTS) + SLOTS) % SLOTS)
    }

    let loudest = 0
    for (let band = 0; band < BAND_COUNT; band += 1) {
      const pulse = this.pulse[band] ?? 0
      const bed = BED[band] ?? 0.3
      packet[band] = level * (bed + (1 - bed) * pulse)
      packet[BAND_PULSE + band] = pulse
      loudest = Math.max(loudest, pulse)
      const low = DEFAULT_BANDS[band]?.low ?? 20
      const high = DEFAULT_BANDS[band]?.high ?? 16000
      // Between hits the extractor holds the band's own middle, so this is it.
      packet[BAND_HIT_CENTRE + band] = Math.log2(Math.sqrt(low * high) / 20) / SPAN_OCTAVES
      packet[BAND_HIT_WIDTH + band] = Math.log2(high / low) / SPAN_OCTAVES
    }

    packet[F.energy] = level
    packet[F.flux] = 1 + 2 * loudest
    packet[F.fluxThreshold] = 2
    packet[F.onset] = strength > 0 ? 1 : 0
    packet[F.onsetStrength] = strength
    packet[F.beatPulse] = loudest
    packet[F.tempoBpm] = bpm
    // A Float32 rounds a phase a hair under 1 up to 1, which is the next beat
    // and not the end of this one.
    packet[F.beatPhase] = Math.min(this.beats - Math.floor(this.beats), PHASE_MAX)
    // The bar the slots are laid out in, which is the eight eighths of `fire`.
    const bars = this.beats / (SLOTS / 2)
    packet[F.barPhase] = Math.min(bars - Math.floor(bars), PHASE_MAX)
    packet[F.swell] = 0.5
    this.writeNotes(packet, dt, bars)
    return packet
  }

  /** The chord this bar plays, with the rows easing to it and off the last one. */
  private writeNotes(packet: Float32Array, dt: number, bars: number) {
    const chord: readonly number[] = PROGRESSION[Math.floor(bars) % PROGRESSION.length] ?? []
    for (let note = 0; note < 12; note += 1) {
      const target = chord.includes(note) ? 1 : 0
      const value = follow(this.notes[note] ?? 0, target, NOTE_ATTACK_MS, NOTE_RELEASE_MS, dt)
      this.notes[note] = value
      packet[CHROMA_ROW + note] = value
    }
  }

  /** The hits this slot of the bar plays, written into the packet. Returns the loudest. */
  private fire(packet: Float32Array, slot: number): number {
    const beat = slot % 2 === 0
    const snare = slot === 2 || slot === 6
    let strength = 0
    const hit = (bands: readonly number[], amount: number) => {
      for (const band of bands) {
        packet[BAND_HIT + band] = amount
        this.pulse[band] = 1
      }

      strength = Math.max(strength, amount)
    }

    if (beat) hit(KICK_BANDS, HIT.kick)
    if (snare) hit(SNARE_BANDS, HIT.snare)
    if (!beat) hit(HAT_BANDS, HIT.hat)
    return strength
  }

  /**
   * The samples the ribbon draws while nothing plays: a bass tone that swells
   * on the kick, and two above it that swell on the snare and the hat. The
   * ribbon levels itself against its own peak, so the height carries no
   * information and only the shape is worth having. The same array every call.
   */
  waveform(level: number): Float32Array {
    const gain = clamp(level, 0, 1)
    for (let at = 0; at < WAVE_SAMPLES; at += 1) {
      const time = (this.samples + at) / SAMPLE_RATE
      let sum = 0
      for (const tone of TONES) {
        const swell = 0.3 + 0.7 * (this.pulse[tone.band] ?? 0)
        sum += tone.gain * swell * Math.sin(2 * Math.PI * tone.hz * time)
      }

      this.wave[at] = gain * sum
    }

    return this.wave
  }
}
