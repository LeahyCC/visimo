import { describe, expect, it } from 'vitest'

import { BAND_HIT, F, PACKET_LENGTH } from '../../src/audio/FeatureExtractor'
import { SyntheticBeat } from './synthetic'

const KICK = BAND_HIT + 1
const SNARE = BAND_HIT + 2
const HAT = BAND_HIT + 4

/** Every frame's packet over `seconds` at `fps`, copied since one array is rewritten. */
function play(seconds: number, fps: number, bpm = 120, level = 0.8) {
  const beat = new SyntheticBeat()
  const packet = new Float32Array(PACKET_LENGTH)
  const frames: Float32Array[] = []
  for (let frame = 0; frame < Math.round(seconds * fps); frame += 1) {
    packet[F.time] = frame / fps
    beat.write(packet, 1 / fps, { bpm, level })
    frames.push(packet.slice())
  }

  return frames
}

const count = (frames: Float32Array[], row: number) =>
  frames.filter((frame) => (frame[row] ?? 0) > 0).length

describe('SyntheticBeat', () => {
  // Stopped short of the bar line at 4 s so a float that lands a hair over a
  // boundary cannot count a ninth kick.
  it.each([30, 60, 144])('lands one kick a beat at %i frames a second', (fps) => {
    const frames = play(3.9, fps)
    expect(count(frames, KICK)).toBe(8)
  })

  it.each([30, 60, 144])('plays the snare on two and four at %i frames a second', (fps) => {
    expect(count(play(3.9, fps), SNARE)).toBe(4)
  })

  it('puts a hat on every eighth between the beats', () => {
    expect(count(play(3.9, 60), HAT)).toBe(8)
  })

  it('runs its clock on the real dt, so a faster tempo is more beats in the same time', () => {
    expect(count(play(3.9, 60, 60), KICK)).toBe(4)
    expect(count(play(3.9, 60, 240), KICK)).toBe(16)
  })

  it('has the phase on the beat when a kick lands and sweeping the whole beat between', () => {
    const frames = play(3.9, 144)
    const step = 120 / 60 / 144
    for (const frame of frames) {
      expect(frame[F.beatPhase]).toBeGreaterThanOrEqual(0)
      expect(frame[F.beatPhase]).toBeLessThan(1)
      if ((frame[KICK] ?? 0) > 0) expect(frame[F.beatPhase]).toBeLessThan(step * 1.01)
    }

    const late = frames.filter((frame) => (frame[F.beatPhase] ?? 0) > 0.9)
    expect(late.length).toBeGreaterThan(0)
  })

  it('writes the pulse as 1 on the hit and then falling, and the hit as its strength', () => {
    const frames = play(1, 60)
    const first = frames[0]
    expect(first?.[KICK]).toBe(1)
    expect(first?.[F.subPulse]).toBe(1)
    expect(frames[2]?.[F.subPulse]).toBeLessThan(first?.[F.subPulse] ?? 0)
    expect(frames[2]?.[KICK]).toBe(0)
  })

  it('reports the tempo it was given and clamps one it cannot keep', () => {
    expect(play(0.1, 60, 128)[0]?.[F.tempoBpm]).toBe(128)
    expect(play(0.1, 60, 5000)[0]?.[F.tempoBpm]).toBe(240)
  })

  it('is audible at a level and silent at none', () => {
    expect(play(0.5, 60, 120, 0.8)[10]?.[F.energy]).toBeCloseTo(0.8)
    const silent = play(0.5, 60, 120, 0)
    for (const frame of silent) {
      expect(frame[F.energy]).toBe(0)
      for (let band = 0; band < 5; band += 1) expect(frame[band]).toBe(0)
    }
  })

  it('leaves time and dt to the renderer and clears everything the analyser wrote', () => {
    const beat = new SyntheticBeat()
    const packet = new Float32Array(PACKET_LENGTH).fill(0.9)
    packet[F.time] = 12.5
    beat.write(packet, 1 / 60, { bpm: 120, level: 0.5 })
    expect(packet[F.time]).toBe(12.5)
    expect(packet[F.dt]).toBeCloseTo(1 / 60)
    // Rows the beat has no opinion on are back to nothing, not left as the music had them.
    expect(packet[F.novelty]).toBe(0)
    expect(packet[F.section]).toBe(0)
    expect(packet[F.recall]).toBe(0)
  })

  it('never writes a value the rest of the package could not read', () => {
    for (const frame of play(3, 60))
      for (const value of frame) expect(Number.isFinite(value)).toBe(true)
  })

  it('plays the same bar every time', () => {
    expect(play(2, 60)).toEqual(play(2, 60))
  })

  it('starts the bar again on reset', () => {
    const beat = new SyntheticBeat()
    const packet = new Float32Array(PACKET_LENGTH)
    for (let frame = 0; frame < 45; frame += 1) beat.write(packet, 1 / 60, { bpm: 120, level: 1 })
    beat.reset()
    beat.write(packet, 1 / 60, { bpm: 120, level: 1 })
    expect(packet[KICK]).toBe(1)
  })
})

describe('SyntheticBeat.waveform', () => {
  it('is the same buffer every call, finite, and silent at no level', () => {
    const beat = new SyntheticBeat()
    const packet = new Float32Array(PACKET_LENGTH)
    beat.write(packet, 1 / 60, { bpm: 120, level: 1 })
    const loud = beat.waveform(1)
    expect(loud.some((sample) => Math.abs(sample) > 0.05)).toBe(true)
    for (const sample of loud) expect(Number.isFinite(sample)).toBe(true)
    const quiet = beat.waveform(0)
    expect(quiet).toBe(loud)
    for (const sample of quiet) expect(Math.abs(sample)).toBe(0)
  })

  it('swells on the kick', () => {
    const beat = new SyntheticBeat()
    const packet = new Float32Array(PACKET_LENGTH)
    beat.write(packet, 1 / 60, { bpm: 120, level: 1 })
    const peak = (wave: Float32Array) =>
      wave.reduce((most, sample) => Math.max(most, Math.abs(sample)), 0)
    const onHit = peak(beat.waveform(1))
    for (let frame = 0; frame < 8; frame += 1) beat.write(packet, 1 / 60, { bpm: 120, level: 1 })
    expect(peak(beat.waveform(1))).toBeLessThan(onHit)
  })
})
