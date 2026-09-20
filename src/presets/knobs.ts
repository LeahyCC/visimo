/**
 * The vocabulary a study is written in: which feature a mapping can read, how
 * it may bend it, and the named numbers each implementation exposes. Like
 * `scenes/catalog.ts` this imports nothing, so a host's picker and the cast
 * parser can read it without pulling the WebGPU tree into the main bundle,
 * and the parameter files can import it without a cycle.
 *
 * It is still under `presets/` because the entry point a host imports is
 * still `visimo/presets`. A knob is a plain identifier and a post target is
 * dotted, `bloom.intensity`, which is how a cast tells the two apart.
 */

/**
 * What a mapping may read. All but `lowEnd` come straight from the packet;
 * that one is the louder of sub and bass, which is what every scene wanted
 * from the low end before presets existed.
 *
 * The five `Pulse` rows are each band's own onset, decayed so it lasts longer
 * than the frame it fired on. The raw hits are not here for the same reason
 * `onset` is not: they are events rather than levels, and a scene reads an
 * event straight from the packet.
 *
 * `pace`, `swell`, `weight`, `tempo` and `hardness` are the song rather than
 * the frame, and they move over tens of seconds: `pace` is how busy the track
 * is, `swell` whether this passage is lifting or dropping, `weight` whether
 * it is bass-led or bright, `tempo` the BPM guess normalised, `hardness` how
 * abrupt and how saturated its hits are. They are what makes a ballad and a
 * drum and bass track look different without swapping the preset. Reach for
 * `pace` rather than `tempo` when what you mean is "fast": the BPM guess is
 * the weak part of the extractor and the README says by how much.
 *
 * `hardness` rests at 0.5 until a track has been heard, so a gain on it moves
 * a knob from the moment the preset loads; a row that should do nothing on an
 * unknown track wants the resting number set for the middle.
 *
 * Then the harmony. `keyHue` is where the key sits on the circle of fifths,
 * 0 to 1 and wrapping, so a song has a colour of its own and a modulation
 * moves it; `keyClarity` is how surely that key is heard, 0 on drums alone;
 * `harmonicChange` lifts for a couple of seconds when a chord moves.
 *
 * Then the structure. `recall` is how closely this passage matches one heard
 * earlier in the track, so a chorus coming back reads as a return;
 * `novelty` lifts for a few seconds when a new passage begins. The section
 * id itself is not here, for the reason the hits are not: a scene reads it
 * straight from the packet and chooses a layout with it.
 *
 * The last two are the beat as a clock. `beatPhase` runs from 0 on a beat to
 * 1 just before the next, predicted rather than reacted to, so with `invert`
 * it is a pulse that falls across the beat and lands on time.
 * `tempoConfidence` is how well the tracker's period fits; gate anything
 * built on the phase or the tempo with it, since a phase on a wrong tempo is
 * a steady rhythm in the wrong place.
 *
 * Last, the moment. Where the song is in its own shape rather than what kind
 * of song it is: `tension` is something winding up, `release` the payoff
 * happening, `rest` the floor having dropped away, and groove is what is
 * left when all three are low. All three move over seconds. `impact` is the
 * odd one out and is here anyway, because a level is what a mapping reads:
 * it is 1 on the frame the payoff lands and falls away in a fifth of a
 * second, so a row on it behaves like a row on `beatPulse` and fires once a
 * drop rather than once a beat. They are tuned on synthetic structure and
 * have not been tried on real tracks; the README says what that leaves.
 */
export const AUDIO_FIELDS = [
  'sub',
  'bass',
  'lowEnd',
  'lowMid',
  'highMid',
  'treble',
  'energy',
  'flux',
  'onsetStrength',
  'beatPulse',
  'subPulse',
  'bassPulse',
  'lowMidPulse',
  'highMidPulse',
  'treblePulse',
  'pace',
  'swell',
  'weight',
  'tempo',
  'hardness',
  'keyHue',
  'keyClarity',
  'harmonicChange',
  'recall',
  'novelty',
  'tempoConfidence',
  'beatPhase',
  'tension',
  'release',
  'rest',
  'impact',
] as const
export type AudioField = (typeof AUDIO_FIELDS)[number]

/**
 * How a feature is bent before the gain multiplies it. All four keep 0 at 0
 * and 1 at 1 except `invert`, which turns a feature into its absence.
 */
export const CURVES = ['linear', 'square', 'sqrt', 'invert'] as const
export type Curve = (typeof CURVES)[number]

/**
 * The fluid's numbers. `force` and `dye` are what the emitters trickle every
 * second; `hitForce` and `hitDye` are what one onset adds on top. `emitters`
 * is a count rather than a magnitude, and the scene rounds and clamps it.
 * `voice` is how far each emitter stands for one sound of its own rather than
 * for the whole mix; which sound that is, is the scene's, not the preset's.
 * `saturation` is how much of the dye's colour is kept, 0 for grey and 1 for
 * the palette as it is, so a passage with no key to speak of can be drawn
 * without one. `events` is how many short-lived emitters may be alive at
 * once, one spawned per band hit and placed by where the hit landed; 0 is
 * off. `eventLife` is how long one lasts in seconds, `eventForce` and
 * `eventDye` what a full-strength one adds over its life, and
 * `eventRadius` its size before the hit's width scales it.
 */
export const FLUID_KNOBS = [
  'velocityDecay',
  'dyeDecay',
  'vorticity',
  'viscosity',
  'intensity',
  'saturation',
  'spread',
  'force',
  'dye',
  'hitForce',
  'hitDye',
  'radius',
  'colourShift',
  'colourDrift',
  'orbitSpeed',
  'emitters',
  'voice',
  'events',
  'eventLife',
  'eventForce',
  'eventDye',
  'eventRadius',
] as const
export type FluidKnob = (typeof FLUID_KNOBS)[number]

/** Mirrored fractal geometry, motion in seconds, and the colour of its enamel. */
export const KALEIDOSCOPE_KNOBS = [
  'symmetry',
  'zoom',
  'zoomAmount',
  'zoomSpeed',
  'bandReaction',
  'depth',
  'rotationSpeed',
  'travelSpeed',
  'morphSpeed',
  'complexity',
  'warp',
  'thickness',
  'bassLift',
  'sparkle',
  'intensity',
  'saturation',
  'colourShift',
  'colourDrift',
] as const
export type KaleidoscopeKnob = (typeof KALEIDOSCOPE_KNOBS)[number]

export type SceneKnob = FluidKnob | KaleidoscopeKnob

/**
 * The resolved numbers an implementation reads each frame. The renderer fills
 * one of these from the studies that are live before calling `update`, and
 * each parameter file turns it into its own typed object, falling back to its
 * defaults for anything no live study named. Which knobs belong to which
 * implementation is `studies/impls.ts`, since a study may hold half a set:
 * a fluid flow brings the solver's and a dye ink the rest.
 */
export type Tuning = Readonly<Partial<Record<SceneKnob, number>>>
