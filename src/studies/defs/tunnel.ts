import type { FlowStudy } from '../types'
import { NO_CURL, NO_LENS } from './shared'

/**
 * Steady travel, the picture always streaming out of the middle and off the
 * edge, for the groove and the build of a steady track. It is `radial` at a
 * small constant with `falloff` 0, so the speed is proportional to the radius:
 * a plain zoom, which is what makes it read as moving through something and not
 * as a burst.
 *
 * Which way is forward. The catalogue says inward, and this goes outward, for
 * four reasons that come from the canvas keeping its history. The light is
 * drawn near the middle (the ribbon, the halo, the streaks' eye) and the
 * history is what moves, so outward is light leaving where it was drawn and
 * rushing past, which is what flying forward looks like; inward is light
 * shrinking away from where it was drawn, which is what backing off looks like.
 * Every cast the director builds already zooms outward at about 9 percent a
 * second (`carriedCanvas` holds a `feedback.zoom` of 1.0015 a frame), so an
 * inward tunnel would first cancel that, sit still at about -0.05 and only
 * then start to recede, where an outward one adds to it. Outward flow leaves
 * through the rim, and inward flow piles the history up in the middle, where the
 * halo already piles light. And a build that speeds up outward runs straight
 * into the radial burst, which is outward, where implode already is the inward
 * build. The direction is one sign on the radial rows if it looks wrong.
 *
 * It rests at 0.04 field widths a second at the rim, 100 px a second at 2560
 * wide and 7 percent a second of zoom, and it is not still at a silent packet:
 * a flow draws nothing, so what it does there is carry what is left of the
 * picture at that speed, as curl drift does. Loudness adds 0.04, so a full
 * groove is 0.08. Tension is the study: it adds 0.15, so at the top of a build
 * the rim moves at 0.23 field widths a second, 590 px a second, which is under
 * half of implode's pull of 0.49 at the same point. `carriedCanvas` shortens
 * the trails by 0.04 of decay at full tension, so the streaks do not lengthen
 * as fast as the speed does.
 *
 * A small swirl, so it is not a dead straight zoom: 0.002 turns a second at
 * rest, which bends the streaks by about 10 degrees at the rim, or 5 in a full
 * groove, and a chord change turns it further (`harmonicChange` at 0.012, so a
 * full change is 0.014 and about 30 degrees in a groove for the couple of
 * seconds it lasts). Tension winds it a little more, 0.008, so a build is a
 * slight corkscrew and not a flat rush. A track whose chords the drums drown
 * out has nothing on the harmonic row and keeps the resting turn.
 *
 * Its home is steady and nothing else, the catalogue's own word, and its reach
 * is moderate.
 */
export const TUNNEL: FlowStudy = {
  id: 'tunnel',
  kind: 'flow',
  name: 'Tunnel',
  impl: 'analytic',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.75, hardness: 0.5 },
  reach: 0.5,
  moments: { intro: 0, groove: 1, build: 1, drop: 0, rest: 0, outro: 0 },
  knobs: { ...NO_CURL, ...NO_LENS, radial: 0.04, falloff: 0, swirl: 0.002, twist: 0 },
  mapping: [
    { from: 'energy', to: 'radial', gain: 0.04, curve: 'linear' },
    { from: 'tension', to: 'radial', gain: 0.15, curve: 'linear' },
    { from: 'harmonicChange', to: 'swirl', gain: 0.012, curve: 'linear' },
    { from: 'tension', to: 'swirl', gain: 0.008, curve: 'linear' },
  ],
  cost: 'cheap',
}
