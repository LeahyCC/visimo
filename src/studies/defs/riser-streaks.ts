import type { InkStudy } from '../types'

/**
 * The tension, drawn: thin lines on rays from the centre, travelling in, that
 * lengthen and multiply as a build winds up and are gone when it is over. At
 * tension 0 its count and intensity rest at 0, so it draws nothing at all, no
 * pass and no upload; every knob that makes it visible is climbed by tension
 * and nothing else, which is why the registry guard lets its intensity rise
 * with a build while holding it at rest for a loud song with no build in it.
 *
 * It is sparse on purpose. At full tension and a full packet there are 48
 * streaks, each at most 0.48 of the short side long and 1.5 px wide at 1080
 * high, so they cover at most 3.2% of a square frame and 1.8% of a 16:9 one
 * (`streakCoverage` says the same, and a test holds it under a tenth). The
 * width thins as the count climbs, which is the lever that keeps it there.
 * The colour is the ribbon's palette at the key, scattered by `hueSpread`, so
 * it sits with the ribbon rather than beside it. One fast row, the onset flux
 * on the length, makes the streaks flick within a build; the rest is slow.
 */
export const RISER_STREAKS: InkStudy = {
  id: 'riser-streaks',
  kind: 'ink',
  name: 'Riser streaks',
  impl: 'streaks',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 0, groove: 0, build: 1, drop: 0, rest: 0, outro: 0 },
  knobs: {
    count: 0,
    length: 0.08,
    speed: 0.25,
    width: 2.2,
    intensity: 0,
    hueSpread: 0.25,
  },
  mapping: [
    { from: 'tension', to: 'count', gain: 48, curve: 'linear' },
    { from: 'tension', to: 'length', gain: 0.3, curve: 'linear' },
    { from: 'tension', to: 'speed', gain: 1, curve: 'linear' },
    { from: 'tension', to: 'width', gain: -0.7, curve: 'linear' },
    { from: 'tension', to: 'intensity', gain: 0.7, curve: 'linear' },
    { from: 'flux', to: 'length', gain: 0.1, curve: 'linear' },
  ],
  cost: 'cheap',
}
