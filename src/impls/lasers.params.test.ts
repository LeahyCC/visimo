/**
 * The lasers' numbers against the geometry they describe: that a fan's beams
 * fan out evenly and close to one line at a spread of 0, that the swing is
 * centred on the beat and runs backwards on even fans, that the falloff is
 * the rings' line shape, and that the worst frame the study can draw stays
 * under the sparse bar. Pure arithmetic, no GPU objects.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import {
  LASER_RANGES,
  LASER_UNIFORM_FLOATS,
  laserBeam,
  laserBeamLight,
  laserBeamReach,
  laserBeams,
  laserGlowPixels,
  laserParams,
  lasersAt,
  lasersCoverage,
  lasersLit,
  laserWidthPixels,
  LIT_THRESHOLD,
  writeLasersUniform,
} from './lasers.params'

const packet = new Float32Array(PACKET_LENGTH)

/** The resting numbers a quiet passage resolves near enough. */
const REST = {
  fans: 3,
  beams: 4,
  spread: 0.45,
  sweep: 0.25,
  width: 1.2,
  glow: 1.0,
  intensity: 0.8,
  flick: 0,
  hue: 0,
}

describe('laserParams', () => {
  it('clamps every knob to its range and falls back on a missing one', () => {
    const params = laserParams({
      fans: 99,
      beams: -2,
      spread: 9,
      sweep: Number.NaN,
      width: 0,
      glow: 99,
      intensity: 9,
      flick: -1,
      hue: 9,
    })
    expect(params.fans).toBe(LASER_RANGES.fans[1])
    expect(params.beams).toBe(LASER_RANGES.beams[0])
    expect(params.spread).toBe(LASER_RANGES.spread[1])
    expect(params.sweep).toBe(0)
    expect(params.width).toBe(LASER_RANGES.width[0])
    expect(params.glow).toBe(LASER_RANGES.glow[1])
    expect(params.intensity).toBe(LASER_RANGES.intensity[1])
    expect(params.flick).toBe(LASER_RANGES.flick[0])
    expect(params.hue).toBe(LASER_RANGES.hue[1])
  })

  it('draws nothing at no intensity, which is what the silence gate resolves to', () => {
    expect(lasersLit(laserParams({ ...REST, intensity: 0 }))).toBe(false)
    expect(lasersLit(laserParams(REST))).toBe(true)
  })
})

describe('the beam falloff', () => {
  const width = laserWidthPixels(1.2, 1920, 1080)
  const glow = laserGlowPixels(1.2, 1920, 1080)

  it('is full across the core, smooth at the edge and exactly zero past the glow', () => {
    expect(laserBeamLight(0, width, glow)).toBe(1)
    expect(laserBeamLight(width - glow, width, glow)).toBe(1)
    expect(laserBeamLight(width + glow, width, glow)).toBe(0)
    expect(laserBeamLight(width + glow + 10, width, glow)).toBe(0)
    const mid = laserBeamLight(width, width, glow)
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThan(0.6)
  })

  it('keeps a beam thinner than its glow at a peak of 1', () => {
    expect(laserBeamLight(0, 0.5, 2)).toBe(1)
    expect(laserBeamLight(0, 0.5, 2)).toBeGreaterThan(laserBeamLight(2, 0.5, 2))
  })

  it('reaches no further than the core plus the glow', () => {
    expect(laserBeamReach(1.2, 1.2)).toBeCloseTo(1.2 + 1.2, 9)
  })
})

describe('the fans', () => {
  const params = laserParams(REST)

  it('alternates the origins between just off the top edge and just off the bottom one', () => {
    const first = laserBeam(params, 0.5, 0, 0, 1920, 1080)
    const second = laserBeam(params, 0.5, 1, 0, 1920, 1080)
    expect(first.originY).toBeLessThan(0)
    expect(second.originY).toBeGreaterThan(1080)
    // Evenly along the x axis, so neighbours lean across each other.
    expect(first.originX).toBeCloseTo(1920 / 6, 9)
    expect(second.originX).toBeCloseTo(1920 / 2, 9)
  })

  it('points the beams into the frame, down from the top and up from the bottom', () => {
    for (let fan = 0; fan < 4; fan += 1) {
      const beam = laserBeam(params, 0.5, fan, 0, 1920, 1080)
      if (fan % 2 === 0) expect(beam.dirY, `fan ${fan}`).toBeGreaterThan(0)
      else expect(beam.dirY, `fan ${fan}`).toBeLessThan(0)
    }
  })

  it('closes a fan to one line at a spread of 0: every beam coincides', () => {
    const closed = laserParams({ ...REST, spread: 0 })
    const beams = laserBeams(closed, 0.5, 1920, 1080)
    for (let fan = 0; fan < 3; fan += 1) {
      const ofFan = beams.filter((_beam, at) => Math.floor(at / closed.beams) === fan)
      const first = ofFan[0]
      if (!first) throw new Error('Expected a beam')
      for (const beam of ofFan) {
        expect(beam.dirX).toBeCloseTo(first.dirX, 9)
        expect(beam.dirY).toBeCloseTo(first.dirY, 9)
        expect(beam.originX).toBeCloseTo(first.originX, 9)
        expect(beam.originY).toBeCloseTo(first.originY, 9)
      }
    }
  })

  it('fans the beams evenly across the spread, centred on the base direction', () => {
    const open = laserParams({ ...REST, spread: 1 })
    // On the beat the swing is 0, so the spread is all that leans a beam.
    const beams = laserBeams(open, 0, 1920, 1080).slice(0, open.beams)
    const first = beams[0]
    const last = beams[beams.length - 1]
    if (!first || !last) throw new Error('Expected beams')
    // The two ends lean opposite ways by the same amount, mirrored about the
    // fan's straight-in middle.
    expect(first.dirX).toBeLessThan(0)
    expect(last.dirX).toBeGreaterThan(0)
    expect(first.dirX).toBeCloseTo(-last.dirX, 9)
    expect(first.dirY).toBeCloseTo(last.dirY, 9)
  })

  it('centres the swing on the beat and runs even fans backwards', () => {
    // With the spread closed, the phase term is all there is: on the beat it
    // is 0 and every fan points straight in, and half way to the next beat
    // the swing is at its ends, opposite ways.
    const swung = laserParams({ ...REST, spread: 0, sweep: 0.5 })
    for (let fan = 0; fan < 4; fan += 1) {
      const beam = laserBeam(swung, 0, fan, 0, 1920, 1080)
      expect(Math.abs(beam.dirX), `fan ${fan} on the beat`).toBeLessThan(1e-9)
    }
    const even = laserBeam(swung, 0.5, 0, 0, 1920, 1080)
    const odd = laserBeam(swung, 0.5, 1, 0, 1920, 1080)
    expect(even.dirX).toBeLessThan(0)
    expect(odd.dirX).toBeCloseTo(-even.dirX, 9)
  })

  it('flicks exactly one beam of each fan', () => {
    const beams = laserBeams(params, 0.5, 1920, 1080)
    for (let fan = 0; fan < 3; fan += 1) {
      const ofFan = beams.filter((_beam, at) => Math.floor(at / params.beams) === fan)
      expect(ofFan.filter((beam) => beam.flicked)).toHaveLength(1)
    }
  })
})

describe('the light at a pixel', () => {
  it('lights a pixel on a beam and nothing behind the fan', () => {
    // One fan of two beams, so nothing else crosses the point.
    const one = laserParams({ ...REST, fans: 1, beams: 2, spread: 0.9, sweep: 0 })
    const beam = laserBeam(one, 0, 0, 0, 960, 1080)
    if (!beam) throw new Error('Expected a beam')
    const on = lasersAt(
      beam.originX + beam.dirX * 500,
      beam.originY + beam.dirY * 500,
      one,
      0,
      960,
      1080,
    )
    // Under 1 because a beam thins along its length (`REACH`); this pixel is part way down it.
    expect(on).toBeGreaterThan(0.7)
    const behind = lasersAt(
      beam.originX - beam.dirX * 50,
      beam.originY - beam.dirY * 50,
      one,
      0,
      960,
      1080,
    )
    expect(behind).toBe(0)
  })

  it('sums where beams cross: two beams crossing read brighter than one', () => {
    // Two fans of three beams swung off: fan 0's steepest beam and fan 1's
    // middle beam are not mirror pairs, so by the fans' symmetry they cross.
    // Solve the crossing from the beams themselves rather than trusting the
    // arithmetic to a hardcoded point.
    const two = laserParams({ ...REST, fans: 2, beams: 3, spread: 0.9, sweep: 0 })
    const beams = laserBeams(two, 0.25, 960, 1080)
    const steep = beams[2]
    const straight = beams[3 + 1]
    if (!steep || !straight) throw new Error('Expected beams')
    // steep: origin o1 + t d1; straight: origin o2 + s d2.
    const det = steep.dirX * -straight.dirY + straight.dirX * steep.dirY
    const ex = straight.originX - steep.originX
    const ey = straight.originY - steep.originY
    const t = (ex * -straight.dirY + straight.dirX * ey) / det
    const x = steep.originX + steep.dirX * t
    const y = steep.originY + steep.dirY * t
    const crossing = lasersAt(x, y, two, 0.25, 960, 1080)
    expect(crossing).toBeGreaterThan(1.35)
    // Well away from every beam a pixel reads nothing.
    expect(lasersAt(60, 1020, two, 0.25, 960, 1080)).toBeLessThan(LIT_THRESHOLD)
  })

  it('answers the treble with extra light on the flicked beam only', () => {
    // One fan of two beams on the beat: beam 0 is the flicked one. A point
    // on it reads three beams' worth with the flick up, one without.
    const one = laserParams({ ...REST, fans: 1, beams: 2, spread: 0.9, sweep: 0 })
    const beam = laserBeam(one, 0, 0, 0, 960, 1080)
    if (!beam) throw new Error('Expected a beam')
    const at = {
      x: beam.originX + beam.dirX * 500,
      y: beam.originY + beam.dirY * 500,
    }
    const quiet = lasersAt(at.x, at.y, one, 0, 960, 1080)
    const hit = lasersAt(
      at.x,
      at.y,
      laserParams({ ...REST, fans: 1, beams: 2, spread: 0.9, sweep: 0, flick: 1 }),
      0,
      960,
      1080,
    )
    expect(beam.flicked).toBe(true)
    expect(quiet).toBeGreaterThan(0.7)
    expect(hit - quiet).toBeGreaterThan(1.3)
  })
})

describe('how much of the frame it lights', () => {
  it('lights under 15 percent of a 16:9 frame at the worst a full packet draws', () => {
    // A full packet: six fans of six beams, full spread, and the soft beams
    // of a soft track, which is the widest the light gets.
    const worst = laserParams({
      ...REST,
      fans: 6,
      beams: 6,
      spread: 0.8,
      sweep: 0.55,
      width: 1.5,
      glow: 1.0,
    })
    expect(lasersCoverage(worst, 1920, 1080)).toBeLessThan(0.15)
    // And the hard-track worst is thinner still.
    const hard = laserParams({ ...worst, glow: 0.5 })
    expect(lasersCoverage(hard, 1920, 1080)).toBeLessThan(lasersCoverage(worst, 1920, 1080))
  })

  it('holds the same share on a square frame and a tall one', () => {
    const worst = laserParams({
      ...REST,
      fans: 6,
      beams: 6,
      spread: 0.8,
      sweep: 0.55,
      width: 1.5,
      glow: 1.0,
    })
    expect(lasersCoverage(worst, 1080, 1080)).toBeLessThan(0.15)
    expect(lasersCoverage(worst, 1080, 1920)).toBeLessThan(0.15)
  })

  it('lights almost nothing at rest on a quiet passage', () => {
    expect(lasersCoverage(laserParams(REST), 1920, 1080)).toBeLessThan(0.05)
  })

  it('lights nothing at all when the gate is closed', () => {
    const dark = laserParams({ ...REST, intensity: 0 })
    expect(lasersCoverage(dark, 1920, 1080)).toBe(0)
  })
})

describe('the uniform', () => {
  it('writes sixteen floats: the canvas and beat phase, the shape, the beam, the light', () => {
    const out = writeLasersUniform(
      laserParams(REST),
      packet,
      1920,
      1080,
      new Float32Array(LASER_UNIFORM_FLOATS),
    )
    expect(out).toHaveLength(LASER_UNIFORM_FLOATS)
    expect([out[0], out[1]]).toEqual([1920, 1080])
    expect(out[2]).toBe(0)
    expect([out[4], out[5]]).toEqual([3, 4])
    expect(out[6]).toBeCloseTo(0.45, 6)
    expect(out[7]).toBeCloseTo(0.25, 6)
    expect(out[8]).toBeCloseTo(1.2, 6)
    expect(out[9]).toBeCloseTo(1.0, 6)
    expect(out[10]).toBe(0)
    // The colour is the ribbon's palette at the key, scaled so its brightest
    // channel is the intensity and no channel passes it.
    expect(Math.max(out[12] ?? 0, out[13] ?? 0, out[14] ?? 0)).toBeCloseTo(0.8, 6)
    expect(out[15]).toBe(0)
  })

  it('reads the beat phase from the packet and scales the beam with the short side', () => {
    const features = new Float32Array(PACKET_LENGTH)
    features[F.beatPhase] = 0.7
    const out = writeLasersUniform(
      laserParams(REST),
      features,
      1080,
      1920,
      new Float32Array(LASER_UNIFORM_FLOATS),
    )
    expect(out[2]).toBeCloseTo(0.7, 6)
    expect(out[8]).toBeCloseTo(1.2, 6)
  })
})
