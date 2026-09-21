import type { InkStudy } from '../types'

/**
 * The ink for the drop: flat sharp triangles thrown outward from the middle,
 * a burst on the frame the payoff lands and a few more on strong low-end and
 * mid hits while it is still sounding. It exists to make the release
 * unmistakable, so it is held back for it: nothing is born on any other
 * moment, the pool is empty through a build and a groove, and an empty pool
 * draws and uploads nothing.
 *
 * It lives in the hard, fast corner of the space and its reach is narrow, so a
 * lo-fi track never sees it and a hardstyle one does. It is the one study here
 * with no preset behind it, so its numbers are its own: the burst is sized so
 * it covers a few percent of the frame and no more, and each shard is hard and
 * flat, so the trails have something sharp to smear.
 *
 * Tension does nothing to a shard's shape, because the study is idle while
 * tension is high: nothing is thrown until the payoff, and tension is what has
 * to have wound up for a payoff to happen. What it does is the one thing it
 * can, which is hold intensity down by up to a quarter. The tension envelope
 * lets go over a couple of seconds after a drop, so the burst is thrown while
 * some of it is still draining and the shards brighten as it goes; and a shard
 * born by a hit while a build is still winding, the tail of one drop running
 * into the next build, is dimmer than one born in the clear.
 */
export const SHARDS: InkStudy = {
  id: 'shards',
  kind: 'ink',
  name: 'Shards',
  impl: 'shards',
  home: { drive: 0.7, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.8 },
  reach: 0.35,
  moments: { intro: 0, groove: 0, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: {
    burst: 48,
    hitRate: 1.2,
    speed: 1.2,
    size: 0.035,
    spin: 1.5,
    life: 1,
    intensity: 0.9,
  },
  mapping: [
    { from: 'energy', to: 'burst', gain: 32, curve: 'linear' },
    { from: 'pace', to: 'hitRate', gain: 0.75, curve: 'linear' },
    { from: 'hardness', to: 'speed', gain: 0.8, curve: 'linear' },
    { from: 'weight', to: 'size', gain: 0.02, curve: 'linear' },
    { from: 'pace', to: 'spin', gain: 3, curve: 'linear' },
    { from: 'weight', to: 'life', gain: 0.6, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.08, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.05, curve: 'square' },
    { from: 'tension', to: 'intensity', gain: -0.2, curve: 'linear' },
  ],
  cost: 'cheap',
}
