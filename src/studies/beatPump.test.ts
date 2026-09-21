/**
 * The beat pump as a study: which way it pushes, that a beat nets to nothing,
 * what a silent packet and a missing beat leave of it, what tension does to it,
 * and where the director puts it. The maths of the field is
 * `impls/analytic.params.test.ts` and the generic bar every study meets is
 * `registry.test.ts`; this is what is particular to this one.
 */
import { describe, expect, it } from 'vitest'

import { F, PACKET_LENGTH } from '../audio/FeatureExtractor'
import { Director, pickCast } from '../director/director'
import type { MomentWeights } from '../director/moment'
import { HARDSTYLE, HOUSE, LOFI, playSong } from '../director/song.fixture'
import { analyticField, analyticVelocity, fieldMoves } from '../impls/analytic.params'
import { visibleExtent } from '../scenes/fluid.params'
import { carriedCanvas } from './cast'
import { findStudy, STUDIES } from './registry'
import { resolveStudy } from './resolve'
import type { RowState } from './resolve'
import type { Character } from './types'

const study = findStudy('beat-pump')
if (!study) throw new Error('Expected the beat pump study')
const curlDrift = findStudy('curl-drift')
if (!curlDrift) throw new Error('Expected the curl drift study')

const WIDE = visibleExtent(2560, 1440)
const silent = () => new Float32Array(PACKET_LENGTH)

const heard = (values: Partial<Record<keyof typeof F, number>>) => {
  const packet = silent()
  for (const [name, value] of Object.entries(values)) packet[F[name as keyof typeof F]] = value
  return packet
}

/** A steady beat: the phase we are at and how sure the tracker is of it. */
const beat = (phase: number, confidence = 1, more: Partial<Record<keyof typeof F, number>> = {}) =>
  heard({ beatPhase: phase, tempoConfidence: confidence, ...more })

const at = (packet = silent(), tension = 0, presence = 1) =>
  resolveStudy(study, undefined, packet, tension, presence, {})

/** A point on the right of the canvas, level with the centre. */
const RIGHT: readonly [number, number] = [0.9, 0.5]

type Frame = { phase: number; knobs: Record<string, number> }

type Played = {
  cycle: readonly Frame[]
  dt: number
  /** Seconds a beat lasts, so a phase can be read as a time. */
  period: number
}

/**
 * The study through a steady beat, frame by frame, the way the renderer
 * resolves it. The phase row carries a spring now, so it is where the seconds
 * before it put it and a single reading at one phase means nothing: what
 * comes back is the whole of the cycle the pump has settled into, after
 * `settle` beats that are played and thrown away.
 *
 * The phase is sampled at the middle of each frame's slice of the beat. That
 * is the one sampling that can compare frame rates: it makes the sampled mean
 * of the sawtooth exactly a half at every one of them, so a difference
 * between two rates is the spring's and not the grid's.
 */
type PlayOptions = {
  bpm?: number
  fps?: number
  confidence?: number
  tension?: number
  presence?: number
  settle?: number
  /** A phase held still, for a track whose tempo was never found. */
  phase?: number
  more?: Partial<Record<keyof typeof F, number>>
}

const play = (options: PlayOptions = {}): Played => {
  const bpm = options.bpm ?? 128
  const fps = options.fps ?? 60
  const period = 60 / bpm
  const frames = Math.round(period * fps)
  const dt = 1 / fps
  const settle = options.settle ?? 24
  const packet = beat(0, options.confidence ?? 1, options.more ?? {})
  const out: Record<string, number> = {}
  const states: RowState[] = []
  const cycle: Frame[] = []
  for (let frame = 0; frame < (settle + 1) * frames; frame += 1) {
    const phase = options.phase ?? ((frame % frames) + 0.5) / frames
    packet[F.beatPhase] = phase
    resolveStudy(
      study,
      undefined,
      packet,
      options.tension ?? 0,
      options.presence ?? 1,
      out,
      dt,
      states,
    )

    if (frame >= settle * frames) cycle.push({ phase, knobs: { ...out } })
  }

  return { cycle, dt, period }
}

const radials = (played: Played) => played.cycle.map((frame) => frame.knobs.radial ?? 0)

/** The mean of a reading over the settled beat, which is what nets to nothing. */
const meanOver = (played: Played, read: (frame: Frame) => number) => {
  let sum = 0
  for (const frame of played.cycle) sum += read(frame)
  return sum / played.cycle.length
}

const velocityOf = (frame: Frame, point = RIGHT) =>
  analyticVelocity(analyticField(frame.knobs, 1, WIDE), point)[0] ?? 0

/** How far the picture moves across the beat, peak to trough, in reference radii. */
const swingOf = (played: Played) => {
  const reference = analyticField(played.cycle[0]?.knobs ?? {}, 1, WIDE).reference
  let position = 0
  let low = 0
  let high = 0
  for (const value of radials(played)) {
    position += value * played.dt
    low = Math.min(low, position)
    high = Math.max(high, position)
  }

  return (high - low) / reference
}

/** The frame of the settled beat where the pump pushes hardest outward. */
const kickOf = (played: Played) =>
  played.cycle.reduce((best, frame) =>
    (frame.knobs.radial ?? 0) > (best.knobs.radial ?? 0) ? frame : best,
  )

/** The mean speed over a grid of the canvas at one phase, and the speed at the corner. */
const frameSpeed = (tension: number, phase = 0) => {
  const field = analyticField(at(beat(phase), tension), 1, WIDE)
  let sum = 0
  let count = 0
  for (let column = 0; column < 64; column += 1)
    for (let row = 0; row < 36; row += 1) {
      const point: [number, number] = [
        (column + 0.5) / 64,
        0.5 + ((row + 0.5) / 36 - 0.5) * 2 * WIDE.y,
      ]
      sum += Math.hypot(...analyticVelocity(field, point))
      count += 1
    }
  const corner = Math.hypot(...analyticVelocity(field, [0.5 + WIDE.x, 0.5 + WIDE.y]))
  return { mean: sum / count, corner }
}

describe('the beat pump study', () => {
  it('is a cheap flow on the analytic implementation, for the groove and the drop', () => {
    expect(study.kind).toBe('flow')
    expect(study.impl).toBe('analytic')
    expect(study.moments).toEqual({ intro: 0, groove: 1, build: 0, drop: 1, rest: 0, outro: 0 })
    expect(study.cost).toBe('cheap')
  })

  // Steady and hard as real tracks read them: the steadiest of the twenty
  // measured is 0.92 and the hardest 0.79, so a home past those is a home
  // nothing reaches.
  it('lives where a beat is steady and hard, with a moderate reach', () => {
    expect(study.home.steadiness).toBeGreaterThanOrEqual(0.85)
    expect(study.home.hardness).toBeGreaterThanOrEqual(0.7)
    expect(study.reach).toBeGreaterThanOrEqual(0.4)
    expect(study.reach).toBeLessThanOrEqual(0.6)
  })

  it('uses the radial term alone', () => {
    for (const phase of [0, 0.3, 0.9])
      for (const tension of [0, 1]) {
        const knobs = at(beat(phase), tension)
        expect([knobs.swirl, knobs.twist]).toEqual([0, 0])
      }
  })

  // A crossfade between two analytic studies blends their knobs, so the shape
  // of a term one of them has switched off must not differ between them.
  it('rests the curl term where curl drift does, so a crossfade does not slide it', () => {
    const rest = at()
    expect(rest.curl).toBe(0)
    expect(rest.curlScale).toBe(curlDrift.knobs.curlScale)
    expect(rest.curlRate).toBe(curlDrift.knobs.curlRate)
    for (const tension of [0, 1])
      for (const packet of [silent(), beat(0.4, 0.9, { energy: 1, swell: 1 })]) {
        const knobs = at(packet, tension)
        expect([knobs.curl, knobs.curlScale, knobs.curlRate]).toEqual([
          0,
          curlDrift.knobs.curlScale,
          curlDrift.knobs.curlRate,
        ])
      }
  })

  it('is in the registry once', () => {
    expect(STUDIES.filter((entry) => entry.id === 'beat-pump')).toHaveLength(1)
  })
})

// The sign and the curve, worked out and then held: positive is outward on
// screen, the feedback pass moves the history with the velocity, and the phase
// is 0 on the beat and rises to 1.
describe('the shape of one beat', () => {
  it('kicks outward just after the beat and is inward again before the next', () => {
    const played = play()
    const kick = kickOf(played)
    expect(velocityOf(kick)).toBeGreaterThan(0)
    expect(velocityOf(played.cycle[played.cycle.length - 1] ?? kick)).toBeLessThan(0)
    // A point left of the centre is pushed the other way, which is outward too.
    expect(analyticVelocity(analyticField(kick.knobs, 1, WIDE), [0.1, 0.5])[0]).toBeLessThan(0)
    // And one above the centre goes up, which is a texture's negative y.
    expect(analyticVelocity(analyticField(kick.knobs, 1, WIDE), [0.5, 0.3])[1]).toBeLessThan(0)
  })

  // The spring's own period sets this and not the beat's, so it is the same
  // number of milliseconds at any tempo: 26 at 8 hertz and a damping of 0.5.
  // A hit the extractor reacts to arrives 65 to 100 late, which is what the
  // predicted phase is for, so the reversal has to stay well inside that.
  it('turns the picture around within 30 milliseconds of the tracker’s beat', () => {
    for (const bpm of [90, 128, 175]) {
      const played = play({ bpm })
      const inward = radials(played)
      let crossed = -1
      for (let frame = 1; frame < inward.length; frame += 1)
        if ((inward[frame - 1] ?? 0) < 0 && (inward[frame] ?? 0) >= 0 && crossed < 0)
          crossed = frame
      expect(crossed, `${bpm} BPM`).toBeGreaterThanOrEqual(0)
      const seconds = (played.cycle[crossed]?.phase ?? 1) * played.period
      expect(seconds, `${bpm} BPM`).toBeLessThan(0.03)
    }
  })

  it('overshoots the sawtooth’s own top on the beat, then rings back onto the slide', () => {
    const played = play()
    const kick = kickOf(played)
    // Deeper than the 0.12 the straight line reached, and by the overshoot a
    // damping of 0.5 gives: 0.134 at 128 BPM.
    expect(kick.knobs.radial ?? 0).toBeGreaterThan(0.12)
    expect(kick.knobs.radial ?? 0).toBeCloseTo(0.134, 2)
    expect(kick.phase).toBeLessThan(0.25)
    // Settled, it is the same straight line a little behind itself: a spring
    // tracking a ramp sits 2 z / w seconds back, 20 milliseconds here, which
    // is 0.01 of radial at this tempo.
    for (const frame of played.cycle) {
      if (frame.phase < 0.5) continue
      const line = 0.12 - 0.24 * frame.phase
      expect(Math.abs((frame.knobs.radial ?? 0) - line), `phase ${frame.phase}`).toBeLessThan(0.015)
    }
  })

  // The net over a beat is what makes it a pump and not a march: the picture
  // is pushed out as far as it is pulled back, so it breathes about where it
  // was and does not walk off the edge. A spring has a gain of 1 at nothing
  // per second, so putting one on the row cannot change this.
  it('nets to nothing over a beat', () => {
    const played = play()
    expect(meanOver(played, (frame) => frame.knobs.radial ?? 0)).toBeCloseTo(0, 6)
    // At the point of the frame too, not only in the coefficient.
    expect(meanOver(played, (frame) => velocityOf(frame))).toBeCloseTo(0, 6)
  })

  it('nets to nothing over a beat at any falloff tension gives it', () => {
    for (const tension of [0, 0.4, 1]) {
      const played = play({ tension })
      for (const point of [RIGHT, [0.7, 0.62], [0.55, 0.5]] as const)
        expect(
          meanOver(
            played,
            (frame) => analyticVelocity(analyticField(frame.knobs, 1, WIDE), point)[0],
          ),
          `tension ${tension}`,
        ).toBeCloseTo(0, 6)
    }
  })

  it('swings the picture by about 2.4 percent at the rim at 128 BPM, and not more than 4 at 90', () => {
    // The position is the running sum of the velocity; the rim is one
    // reference radius from the centre, so the scale change is the distance
    // moved over that radius. The spring reshapes the velocity and adds none,
    // so this is within a few percent of the straight line's 2.45.
    expect(swingOf(play({ bpm: 128, fps: 480 }))).toBeGreaterThan(0.022)
    expect(swingOf(play({ bpm: 128, fps: 480 }))).toBeLessThan(0.027)
    expect(swingOf(play({ bpm: 175, fps: 480 }))).toBeLessThan(
      swingOf(play({ bpm: 128, fps: 480 })),
    )
    expect(swingOf(play({ bpm: 90, fps: 480 }))).toBeLessThan(0.04)
  })
})

// The bar: the same at any frame rate. The velocity is per second, and the
// one thing the resolver now holds between frames is the spring, which is
// stepped in closed form over the real step, so the same beat moves the
// picture the same distance at 30, 60 and 144 a second. 120 BPM is a whole
// number of frames at each.
describe('at any frame rate', () => {
  it('moves the picture the same distance in a beat and returns it', () => {
    const rates = [30, 60, 144].map((fps) => ({ fps, played: play({ bpm: 120, fps }) }))
    const first = rates[0]
    if (!first) throw new Error('Expected a frame rate')
    const reference = {
      swing: swingOf(first.played),
      peak: Math.max(...radials(first.played)),
      trough: Math.min(...radials(first.played)),
    }

    for (const { fps, played } of rates) {
      expect(
        meanOver(played, (frame) => frame.knobs.radial ?? 0),
        `${fps} fps`,
      ).toBeCloseTo(0, 6)
      const near = (value: number, want: number) => Math.abs(value - want) / Math.abs(want)
      expect(near(swingOf(played), reference.swing), `${fps} fps swing`).toBeLessThan(0.01)
      expect(near(Math.max(...radials(played)), reference.peak), `${fps} fps peak`).toBeLessThan(
        0.01,
      )

      expect(
        near(Math.min(...radials(played)), reference.trough),
        `${fps} fps trough`,
      ).toBeLessThan(0.01)
    }
  })
})

// A row could scale the pulse by the confidence and deliberately does not:
// the tracker keeps the phase running through a bar of doubt. What the
// confidence row takes out is the constant, which is the part that would
// march the picture.
describe('with no steady beat', () => {
  it('draws nothing at a silent packet, and the flow encodes no pass', () => {
    const knobs = at(silent(), 0)
    expect(knobs.radial).toBe(0)
    expect(knobs.falloff).toBe(0)
    expect(fieldMoves(analyticField(knobs, 1, WIDE))).toBe(false)
  })

  it('stays still before any tempo has been found, however loud the music is', () => {
    // The phase is stuck at 0 and the confidence at 0 until the tracker has
    // locked, and 0 is the top of the sawtooth: an offset in the resting value
    // would leave the picture pushed outward for the whole of that time. The
    // spring rests exactly on its signal, so a phase that never moves leaves
    // it at nothing however long it is held there.
    for (const energy of [0, 0.5, 1]) {
      const held = play({ phase: 0, confidence: 0, more: { energy, swell: 1, beatPulse: 1 } })
      for (const frame of held.cycle) {
        expect(frame.knobs.radial, `energy ${energy}`).toBe(0)
        expect(fieldMoves(analyticField(frame.knobs, 1, WIDE))).toBe(false)
      }
    }
  })

  it('takes the constant out, and only the constant, as the beat comes in', () => {
    const top = (confidence: number) => Math.max(...radials(play({ confidence })))
    // With no offset at all the top of the cycle is not quite 0: the spring
    // passes the sawtooth's bottom on the way down, which is an outward tick
    // of a twentieth of the swing. What matters is that the constant is gone.
    expect(top(0)).toBeLessThan(0.24 / 10)
    expect(top(0.05)).toBeGreaterThan(top(0))
    for (let confidence = 0.05; confidence < 1; confidence += 0.05)
      expect(top(confidence + 0.05)).toBeGreaterThan(top(confidence))
    // The swing does not fade, by design: the tracker keeps the phase running
    // through a bar of doubt. So the pulse is as deep as ever...
    const swing = (confidence: number) => {
      const read = radials(play({ confidence }))
      return Math.max(...read) - Math.min(...read)
    }

    const reference = swing(1)
    expect(reference).toBeGreaterThan(0.24)
    for (const confidence of [0, 0.2, 0.45, 0.85, 1])
      expect(swing(confidence), `confidence ${confidence}`).toBeCloseTo(reference, 9)
  })

  it('is nearly level on a two-step and level on four to the floor', () => {
    const mean = (confidence: number) =>
      meanOver(play({ confidence }), (frame) => frame.knobs.radial ?? 0)
    // ...and what is left is a slow drift inward, at worst half a swing.
    expect(mean(0)).toBeCloseTo(-0.12, 6)
    expect(Math.abs(mean(0.45))).toBeLessThan(0.24 / 5)
    expect(Math.abs(mean(0.85))).toBeLessThan(0.24 / 20)
    expect(mean(1)).toBeCloseTo(0, 6)
    for (const confidence of [0, 0.2, 0.45, 0.85, 1])
      expect(mean(confidence)).toBeLessThanOrEqual(1e-6)
  })

  it('costs nothing at presence 0, and scales the whole swing with presence', () => {
    expect(fieldMoves(analyticField(at(beat(0), 1, 0), 0, WIDE))).toBe(false)
    const half = play({ presence: 0.5 })
    const whole = play()
    // Presence scales the field and not the knobs, so a half fade is half the
    // speed everywhere and the mean is still nothing.
    expect(
      meanOver(half, (frame) => analyticField(frame.knobs, 0.5, WIDE).radial),
      'mean at half presence',
    ).toBeCloseTo(0, 6)

    expect(
      Math.max(...half.cycle.map((frame) => analyticField(frame.knobs, 0.5, WIDE).radial)),
    ).toBeCloseTo(
      Math.max(...whole.cycle.map((frame) => analyticField(frame.knobs, 1, WIDE).radial)) / 2,
      9,
    )
  })
})

// The bar: a test shows tension moving a knob. It widens the pulse rather than
// deepening it, and the def says why a scale on the row is the worse answer.
describe('what tension does to it', () => {
  it('widens the pulse from the rim toward the whole frame, and leaves the swing alone', () => {
    const calm = at(beat(0), 0)
    const wound = at(beat(0), 1)
    expect(calm.falloff).toBe(0)
    expect(wound.falloff).toBeCloseTo(1.5, 12)
    expect(wound.radial).toBe(calm.radial)
  })

  it('takes the mean speed over the frame up by two thirds and the rim down by a tenth', () => {
    const calm = frameSpeed(0)
    const wound = frameSpeed(1)
    expect(wound.mean / calm.mean).toBeGreaterThan(1.5)
    expect(wound.mean / calm.mean).toBeLessThan(1.8)
    expect(wound.corner / calm.corner).toBeGreaterThan(0.85)
    expect(wound.corner / calm.corner).toBeLessThan(0.95)
  })

  it('deepens it smoothly over the whole of a build', () => {
    let last = frameSpeed(0).mean
    for (let tension = 0.05; tension <= 1.0001; tension += 0.05) {
      const now = frameSpeed(tension).mean
      expect(now).toBeGreaterThan(last)
      expect(now / last).toBeLessThan(1.05)
      last = now
    }
  })

  // The spring passes the sawtooth's own top on the beat, and how far depends
  // on the tempo: the slowest beat the tracker reports leaves the longest
  // ramp for it to fall off, and reaches 0.147.
  it('stays inside the range the analytic flow may reach at a full packet', () => {
    for (const bpm of [60, 128, 200])
      for (const tension of [0, 1]) {
        const played = play({ bpm, tension, more: { energy: 1, swell: 1 } })
        for (const frame of played.cycle) {
          expect(Math.abs(frame.knobs.radial ?? 0), `${bpm} BPM`).toBeLessThanOrEqual(0.15)
          expect(frame.knobs.falloff, `${bpm} BPM`).toBeLessThanOrEqual(1.5 + 1e-12)
        }
      }
  })
})

// The pump sits on top of the canvas's own beat zoom, which is one-sided: it
// only ever zooms out, faster on the beat. That is why the pump has to be a
// net-zero term of its own and cannot lean on the canvas to bring it back.
describe('beside the canvas', () => {
  it('rides a canvas whose own beat zoom only ever goes outward', () => {
    const canvas = carriedCanvas()
    expect(canvas.knobs['feedback.zoom']).toBeGreaterThan(1)
    const row = canvas.mapping.find((entry) => entry.from === 'beatPhase')
    expect(row?.to).toBe('feedback.zoom')
    expect(row?.gain).toBeGreaterThan(0)
  })
})

describe('in the director', () => {
  const weights = (values: Partial<MomentWeights>): MomentWeights => ({
    intro: 0,
    groove: 0,
    build: 0,
    drop: 0,
    rest: 0,
    outro: 0,
    ...values,
  })

  const characters: Record<string, Character> = {
    'lo-fi': LOFI,
    'house': HOUSE,
    'hardstyle': HARDSTYLE,
  }

  it('is the flow of a hardstyle groove and of its drop', () => {
    for (const moment of ['groove', 'drop'] as const)
      expect(pickCast({ character: HARDSTYLE, weights: weights({ [moment]: 1 }) })?.flow).toBe(
        'beat-pump',
      )
  })

  it('is never the flow of a lo-fi groove or drop, or of any quiet moment or a build', () => {
    for (const moment of ['groove', 'drop', 'build', 'intro', 'rest', 'outro'] as const)
      expect(
        pickCast({ character: LOFI, weights: weights({ [moment]: 1 }), settled: 1 })?.flow,
        moment,
      ).not.toBe('beat-pump')
  })

  // Before the character is known every study is placed alike, so a pure
  // groove or drop is a tie between the flows written for it and the id breaks
  // it. Nothing has been heard of the beat then, and an opening does not read
  // as all groove: the intro is still in the weights, and the moment reads half
  // groove and half intro at the first frame. The song below is the realistic
  // version.
  it('is not the flow of a quiet moment or a build even before the track is known', () => {
    for (const moment of ['build', 'intro', 'rest', 'outro'] as const)
      expect(
        pickCast({ character: LOFI, weights: weights({ [moment]: 1 }), settled: 0 })?.flow,
        moment,
      ).not.toBe('beat-pump')
  })

  it('has no moment of its own outside the groove and the drop', () => {
    for (const [name, character] of Object.entries(characters))
      for (const moment of ['build', 'intro', 'rest', 'outro'] as const)
        expect(
          pickCast({ character, weights: weights({ [moment]: 1 }) })?.flow,
          `${name} ${moment}`,
        ).not.toBe('beat-pump')
  })

  // The whole scripted song, so it is the director's own smoothing and margins
  // that decide and not a single pick.
  it('is cast through a hardstyle song and never through a lo-fi one', () => {
    for (const [name, character] of Object.entries(characters)) {
      const director = new Director()
      let frames = 0
      for (const { dt, features } of playSong(30, character)) {
        director.step(features, dt)
        if (director.cast?.flow === 'beat-pump') frames += 1
      }

      if (name === 'lo-fi') expect(frames, name).toBe(0)
      if (name === 'hardstyle') expect(frames, name).toBeGreaterThan(30 * 60)
    }
  })

  it('leaves an ink beside it, since the dye needs a fluid and there is none', () => {
    const cast = pickCast({ character: HARDSTYLE, weights: weights({ groove: 1 }) })
    expect(cast?.inks.length).toBeGreaterThan(0)
    expect(cast?.inks).not.toContain('dye-plumes')
  })
})
