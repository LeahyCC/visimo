/**
 * The two looks that tell the build-to-drop story. `squeeze` closes the frame
 * and drains the colour as tension climbs and opens on `impact`; `impact-flash`
 * lifts the exposure for a few frames on the drop. The blanket guards in
 * `registry.test.ts` hold both to the bar every study is held to; this is what
 * each of them is for, and, for the flash, the rule it is built to.
 */
import { describe, expect, it } from 'vitest'

import {
  F,
  IMPACT_DECAY_SECONDS,
  IMPACT_OFF,
  IMPACT_ON,
  PACKET_LENGTH,
  RELEASE_PHRASE_MIN_SECONDS,
} from '../audio/FeatureExtractor'
import { POST_UNIFORM_FLOATS, writePostUniform } from '../post/params'
import type { CastCanvas } from './cast'
import { findStudy } from './registry'
import { castFrame, resolveLive, resolveStudy } from './resolve'

const packet = (values: Partial<Record<keyof typeof F, number>> = {}) => {
  const out = new Float32Array(PACKET_LENGTH)
  for (const [name, value] of Object.entries(values)) out[F[name as keyof typeof F]] = value
  return out
}

const study = (id: string) => {
  const found = findStudy(id)
  if (!found) throw new Error(`Expected ${id} in the registry`)
  return found
}

const knobsAt = (id: string, features: Float32Array, tension: number) =>
  resolveStudy(study(id), undefined, features, tension, 1, {})

const STILL: CastCanvas = {
  enabled: false,
  knobs: {
    'feedback.amount': 0.22,
    'feedback.decay': 0.72,
    'feedback.zoom': 1.012,
    'feedback.rotate': 0.002,
    'feedback.carry': 0,
    'feedback.floor': 0,
    'feedback.ceiling': 16,
  },
  mapping: [],
}

/** The uniform the stack would write for this look alone at this packet. */
const uniformOf = (id: string, features: Float32Array, tension: number) => {
  const { post } = resolveLive([{ id, presence: 1 }], STILL, features, tension, castFrame())
  return writePostUniform(post, features, 1920, 1080, new Float32Array(POST_UNIFORM_FLOATS))
}

describe('squeeze', () => {
  // Nothing has been said, so nothing is closed or drained: this is a plain
  // clean look until the song winds up.
  it('rests as a plain look: no vignette, colour untouched', () => {
    const rest = knobsAt('squeeze', packet(), 0)
    expect(rest['grade.vignette']).toBe(0)
    expect(rest['grade.saturation']).toBe(1)
    expect(rest['tonemap.exposure']).toBe(1)
  })

  it('closes the frame, drains the colour and tightens the bloom as tension climbs', () => {
    const at = (tension: number) => knobsAt('squeeze', packet(), tension)
    let last = at(0)
    for (const tension of [0.25, 0.5, 0.75, 1]) {
      const now = at(tension)
      expect(now['grade.vignette'], `vignette at ${tension}`).toBeGreaterThan(
        last['grade.vignette'] ?? 0,
      )

      expect(now['grade.saturation'], `saturation at ${tension}`).toBeLessThan(
        last['grade.saturation'] ?? 0,
      )

      // Fewer things glow, and less of them.
      expect(now['bloom.threshold'], `threshold at ${tension}`).toBeGreaterThan(
        last['bloom.threshold'] ?? 0,
      )

      expect(now['bloom.intensity'], `bloom at ${tension}`).toBeLessThan(
        last['bloom.intensity'] ?? 0,
      )

      last = now
    }

    // At the top of a build the frame is closed a good way and the colour is
    // well down without being grey.
    expect(last['grade.vignette']).toBeCloseTo(0.6, 10)
    expect(last['grade.saturation']).toBeCloseTo(0.45, 10)
  })

  it('throws all of it open on impact, exactly undoing a full build', () => {
    const rest = knobsAt('squeeze', packet(), 0)
    const opened = knobsAt('squeeze', packet({ impact: 1 }), 1)
    for (const knob of [
      'grade.vignette',
      'grade.saturation',
      'bloom.threshold',
      'bloom.intensity',
    ]) {
      expect(opened[knob], knob).toBeCloseTo(rest[knob] ?? 0, 10)
    }
  })

  // The drop is when tension is already falling. The frame of the drop must be
  // wide open then and not at what is left of the build.
  it('is wide open on the frame of the drop while tension is still falling', () => {
    for (const tension of [0.9, 0.6, 0.3, 0]) {
      const opened = knobsAt('squeeze', packet({ impact: 1 }), tension)
      expect(opened['grade.vignette'], `vignette at tension ${tension}`).toBeLessThanOrEqual(1e-9)
      expect(opened['grade.saturation'], `saturation at tension ${tension}`).toBeGreaterThanOrEqual(
        1 - 1e-9,
      )

      // And the uniform, which is what the shader reads, is exactly open.
      const uniform = uniformOf('squeeze', packet({ impact: 1 }), tension)
      expect(uniform[44], `written vignette at tension ${tension}`).toBe(0)
      expect(uniform[45], `written saturation at tension ${tension}`).toBe(1)
    }
  })

  it('closes again as the impact falls away, if tension has not', () => {
    const at = (impact: number) => knobsAt('squeeze', packet({ impact }), 1)
    expect(at(0.5)['grade.vignette']).toBeCloseTo(0.3, 10)
    expect(at(0.5)['grade.saturation']).toBeCloseTo(0.725, 10)
    expect(at(0)['grade.vignette']).toBeCloseTo(0.6, 10)
  })

  it('switches the grade on, and writes a vignette the shader can use', () => {
    const closed = uniformOf('squeeze', packet(), 1)
    expect(closed[44]).toBeCloseTo(0.6, 6)
    expect(closed[45]).toBeCloseTo(0.45, 6)
    const { post } = resolveLive([{ id: 'squeeze', presence: 1 }], STILL, packet(), 0, castFrame())

    expect(post.grade.enabled).toBe(true)
    expect(post.bloom.enabled && post.tonemap.enabled).toBe(true)
    expect(post.grain.enabled || post.chromatic.enabled).toBe(false)
  })
})

describe('impact flash', () => {
  const flash = study('impact-flash')

  /** The exposure with only `impact` in the packet, so it is the flash and nothing else. */
  const exposure = (impact: number) =>
    knobsAt('impact-flash', packet({ impact }), 0)['tonemap.exposure']

  it('is gone at rest and lifts by a fixed step on the frame of the drop', () => {
    expect(exposure(0)).toBe(1)
    expect(exposure(1)).toBeCloseTo(1.2, 10)
    expect(exposure(0.5)).toBeCloseTo(1.1, 10)
  })

  // `impact` never goes above 1, so the gain is the cap.
  it('is capped: no impact lifts the exposure past a fifth, and no other row adds to it', () => {
    const lifts = flash.mapping.filter((row) => row.to === 'tonemap.exposure' && row.gain > 0)
    expect(lifts.map((row) => row.from)).toEqual(['impact'])
    for (let impact = 0; impact <= 1; impact += 0.05)
      expect(exposure(impact)).toBeLessThanOrEqual(1.2 + 1e-9)
  })

  it('does not flash on anything but an impact', () => {
    // A full packet with the impact taken out, and a build at its top.
    const full = packet()
    for (const name of Object.keys(F) as (keyof typeof F)[]) full[F[name]] = 1
    full[F.impact] = 0
    expect(knobsAt('impact-flash', full, 1)['tonemap.exposure']).toBeLessThanOrEqual(1)
  })

  /**
   * The soonest the extractor can fire `impact` twice. It fires on `release`
   * crossing up through `IMPACT_ON` and rearms only once `release` is under
   * `IMPACT_OFF`, and `release` falls with a time constant of half a phrase,
   * the shortest phrase being `RELEASE_PHRASE_MIN_SECONDS`. So the quickest a
   * fired one can fall clear is from just over the top: a time constant times
   * the log of the ratio. A louder drop starts higher and takes longer.
   */
  const MIN_GAP = (RELEASE_PHRASE_MIN_SECONDS / 2) * Math.log(IMPACT_ON / IMPACT_OFF)

  /**
   * The exposure through `seconds` of impacts fired as fast as that, at a
   * frame rate, as `[time, exposure]` pairs. `impact` is stepped the way the
   * extractor steps it: set to 1 on the frame it lands, and its own fall
   * otherwise.
   */
  function run(gap: number, fps: number, seconds: number) {
    const dt = 1 / fps
    const trace: [number, number][] = []
    let impact = 0
    let next = 0.5
    for (let frame = 0; frame * dt < seconds; frame += 1) {
      const time = frame * dt
      const lands = time >= next
      if (lands) next += gap
      impact = Math.max(lands ? 1 : 0, impact * Math.exp(-dt / IMPACT_DECAY_SECONDS))
      trace.push([
        time,
        knobsAt('impact-flash', packet({ impact, dt }), 0)['tonemap.exposure'] ?? 1,
      ])
    }

    return trace
  }

  /** Where the trace goes up through the level: each one is a flash beginning. */
  function risings(trace: readonly [number, number][], level: number) {
    const times: number[] = []
    for (let at = 1; at < trace.length; at += 1) {
      const [time, now] = trace[at] ?? [0, 0]
      if ((trace[at - 1]?.[1] ?? 0) <= level && now > level) times.push(time)
    }

    return times
  }

  /** The most crossings there are in any one second. */
  function busiestSecond(times: readonly number[]) {
    let most = 0
    for (const start of times)
      most = Math.max(most, times.filter((time) => time >= start && time < start + 1).length)
    return most
  }

  // Half the lift is where "lifted" starts to read: the exposure has covered
  // half of its way up and is on its way to nothing.
  const THRESHOLD = 1.1

  // WCAG 2.3.1: no more than three flashes in any one second over a large
  // area. The extractor's own rearm is what holds this, so the test is fed
  // impact at the quickest it could ever come.
  for (const fps of [30, 60, 144]) {
    it(`crosses its threshold fewer than three times in any second, at ${fps} frames a second`, () => {
      const crossings = risings(run(MIN_GAP, fps, 20), THRESHOLD)
      // Not vacuous: the flash is there, once per impact.
      expect(crossings.length).toBeGreaterThan(20 / MIN_GAP - 2)
      expect(busiestSecond(crossings)).toBeLessThan(3)
    })
  }

  it('would be caught by the same count if impacts came faster than the extractor can', () => {
    expect(busiestSecond(risings(run(0.25, 60, 8), THRESHOLD))).toBeGreaterThanOrEqual(3)
  })

  it('is a few frames, not a lingering glow', () => {
    const trace = run(MIN_GAP, 60, 6)
    const above = trace.filter(([, exposure]) => exposure > THRESHOLD).length
    const frames = above / risings(trace, THRESHOLD).length
    expect(frames).toBeGreaterThanOrEqual(3)
    expect(frames).toBeLessThanOrEqual(12)
    // And it is gone before the next: by the time the shortest gap is up the
    // impact has fallen to about a hundredth and the exposure is within half
    // a percent of rest.
    const left = Math.exp(-MIN_GAP / IMPACT_DECAY_SECONDS)
    expect(knobsAt('impact-flash', packet({ impact: left }), 0)['tonemap.exposure']).toBeLessThan(
      1.005,
    )
  })

  it('switches the tonemap on and leaves the grade off', () => {
    const { post } = resolveLive(
      [{ id: 'impact-flash', presence: 1 }],
      STILL,
      packet({ impact: 1 }),
      0,
      castFrame(),
    )

    expect(post.tonemap.enabled).toBe(true)
    expect(post.grade.enabled).toBe(false)
    expect(post.tonemap.exposure).toBeCloseTo(1.2, 6)
  })
})
