/**
 * The studies themselves. TypeScript rather than JSON, unlike the presets and
 * the casts beside them: a study is vocabulary, not a file of numbers a
 * person tunes. Its knobs have to match its implementation's list and its
 * mapping has to speak that implementation's names, and the compiler can say
 * so at the point the mistake is made rather than at load. The casts are the
 * other way round and stay JSON.
 *
 * Every number below is ported from the five preset files, so nothing here is
 * invented. Where three presets drive one knob at three gains, the study
 * carries the smallest of them, which is what that study does wherever it is
 * cast, and each cast adds the rest. That way a cast's overrides only ever
 * push a study further in the direction it already goes, and no override has
 * to cancel a row out.
 *
 * `home` and `moments` come from the catalogue tables in
 * docs/studies-handoff.md, by its own convention: a capital letter is a
 * strong fit and reads 1, a lower case one about 0.5, and a letter that is
 * absent reads 0. An axis the catalogue says nothing about sits at 0.5, which
 * is no opinion rather than a weak one.
 */
import type { FlowStudy, InkStudy, LookStudy, Study } from './types'

/**
 * Today's solver at Plume's numbers: low vorticity, slow emitters, a smoky
 * drift. Tension slows it further and pulls the emitters in, so a build
 * gathers rather than spreads.
 */
const LAZY_FLUID: FlowStudy = {
  id: 'lazy-fluid',
  kind: 'flow',
  name: 'Lazy fluid',
  impl: 'fluid',
  home: { drive: 0.2, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.15 },
  reach: 0.6,
  moments: { intro: 1, groove: 1, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: {
    velocityDecay: 0.18,
    vorticity: 12,
    viscosity: 0.2,
    spread: 0.42,
    force: 0.45,
    hitForce: 0.3,
    radius: 0.012,
    orbitSpeed: 0.19,
    emitters: 5,
    voice: 0.85,
    events: 24,
    eventLife: 0.8,
    eventForce: 0.5,
    eventRadius: 0.011,
  },
  mapping: [
    { from: 'pace', to: 'vorticity', gain: 14, curve: 'linear' },
    { from: 'treble', to: 'vorticity', gain: 38, curve: 'linear' },
    { from: 'treble', to: 'viscosity', gain: -0.18, curve: 'linear' },
    { from: 'pace', to: 'orbitSpeed', gain: 0.25, curve: 'linear' },
    { from: 'energy', to: 'velocityDecay', gain: 0.15, curve: 'linear' },
    { from: 'energy', to: 'spread', gain: 0.38, curve: 'linear' },
    { from: 'swell', to: 'spread', gain: 0.2, curve: 'linear' },
    { from: 'energy', to: 'force', gain: 0.6, curve: 'linear' },
    { from: 'novelty', to: 'force', gain: 0.6, curve: 'linear' },
    { from: 'lowEnd', to: 'hitForce', gain: 1.1, curve: 'linear' },
    { from: 'lowEnd', to: 'radius', gain: 0.016, curve: 'linear' },
    { from: 'weight', to: 'radius', gain: 0.006, curve: 'linear' },
    { from: 'tension', to: 'orbitSpeed', gain: -0.08, curve: 'linear' },
    { from: 'tension', to: 'spread', gain: -0.1, curve: 'linear' },
  ],
  cost: 'medium',
}

/**
 * The same solver at Wash's numbers: thin viscosity, hard vorticity and a
 * wide slow orbit, which draws fine filaments instead of plumes. Tension
 * climbs the vorticity, so a build frays.
 */
const TURBULENT_FLUID: FlowStudy = {
  id: 'turbulent-fluid',
  kind: 'flow',
  name: 'Turbulent fluid',
  impl: 'fluid',
  home: { drive: 0.8, weight: 0.25, tonality: 0.5, steadiness: 0.5, hardness: 0.6 },
  reach: 0.5,
  moments: { intro: 0, groove: 1, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: {
    velocityDecay: 0.1,
    vorticity: 26,
    viscosity: 0.06,
    spread: 0.5,
    force: 0.8,
    hitForce: 0.25,
    radius: 0.02,
    orbitSpeed: 0.1,
    emitters: 3,
    voice: 0.7,
    events: 12,
    eventLife: 1.2,
    eventForce: 0.3,
    eventRadius: 0.014,
  },
  mapping: [
    { from: 'lowEnd', to: 'vorticity', gain: 24, curve: 'linear' },
    { from: 'lowEnd', to: 'viscosity', gain: -0.04, curve: 'linear' },
    { from: 'energy', to: 'velocityDecay', gain: 0.14, curve: 'linear' },
    { from: 'energy', to: 'spread', gain: 0.16, curve: 'linear' },
    { from: 'treble', to: 'hitForce', gain: 1.4, curve: 'linear' },
    { from: 'treble', to: 'radius', gain: -0.01, curve: 'linear' },
    { from: 'tension', to: 'vorticity', gain: 12, curve: 'linear' },
  ],
  cost: 'medium',
}

/**
 * The fluid's dye, one emitter per band. It has nothing to draw into unless a
 * fluid flow is stirring the field, hence `requires`, and it covers most of
 * the frame, so it does not share a cast with the fractal. Tension thins the
 * dye: a build drains colour and the drop puts it back.
 */
const DYE_PLUMES: InkStudy = {
  id: 'dye-plumes',
  kind: 'ink',
  name: 'Dye plumes',
  impl: 'dye',
  home: { drive: 0.4, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.25 },
  reach: 0.7,
  moments: { intro: 1, groove: 1, build: 0, drop: 0, rest: 1, outro: 0 },
  knobs: {
    dyeDecay: 0.22,
    intensity: 1.15,
    saturation: 0.65,
    dye: 1.6,
    hitDye: 1.1,
    colourShift: 0,
    colourDrift: 0,
    eventDye: 2.5,
  },
  mapping: [
    { from: 'keyHue', to: 'colourShift', gain: 1, curve: 'linear' },
    { from: 'energy', to: 'dyeDecay', gain: 0.3, curve: 'linear' },
    { from: 'energy', to: 'dye', gain: 0.7, curve: 'linear' },
    { from: 'beatPulse', to: 'intensity', gain: 0.3, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.14, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.09, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.09, curve: 'square' },
    { from: 'energy', to: 'saturation', gain: -0.1, curve: 'square' },
    { from: 'swell', to: 'saturation', gain: -0.08, curve: 'square' },
    { from: 'hardness', to: 'saturation', gain: -0.08, curve: 'square' },
    { from: 'tension', to: 'dye', gain: -0.3, curve: 'linear' },
  ],
  cost: 'cheap',
  requires: ['fluid'],
  excludes: ['fractal-glints'],
}

/**
 * The waveform as a line or a circle, drawn under the feedback so the trails
 * turn it into sheets. Any song has a waveform, so its home is the middle of
 * the space and its reach is the whole of it. Tension thins the line and
 * shrinks the circle.
 */
const RIBBON: InkStudy = {
  id: 'ribbon',
  kind: 'ink',
  name: 'Ribbon',
  impl: 'ribbon',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 0, groove: 1, build: 1, drop: 1, rest: 0, outro: 0 },
  knobs: {
    'ribbon.intensity': 0.15,
    'ribbon.width': 2.5,
    'ribbon.height': 0.2,
    'ribbon.shape': 0,
  },
  mapping: [
    { from: 'energy', to: 'ribbon.intensity', gain: 0.3, curve: 'linear' },
    { from: 'weight', to: 'ribbon.width', gain: 1.5, curve: 'linear' },
    { from: 'tension', to: 'ribbon.width', gain: -0.8, curve: 'linear' },
    { from: 'tension', to: 'ribbon.height', gain: -0.05, curve: 'linear' },
  ],
  cost: 'cheap',
}

/**
 * Prism's raymarched ridges. It is the expensive one and it covers the frame,
 * which is why Melt washes out on a drop; the handoff's fix is an ink
 * threshold of its own, and that needs a knob the implementation does not
 * have yet, so it is not in this card. Tension sweeps the zoom in.
 */
const FRACTAL_GLINTS: InkStudy = {
  id: 'fractal-glints',
  kind: 'ink',
  name: 'Fractal glints',
  impl: 'fractal',
  home: { drive: 0.6, weight: 0.5, tonality: 0.8, steadiness: 0.5, hardness: 0.8 },
  reach: 0.5,
  moments: { intro: 0, groove: 1, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: {
    symmetry: 6,
    zoom: 0.85,
    zoomAmount: 0.8,
    zoomSpeed: 0.22,
    bandReaction: 1,
    depth: 0.55,
    rotationSpeed: 0.025,
    travelSpeed: 0.035,
    morphSpeed: 0.055,
    complexity: 7,
    warp: 0.35,
    thickness: 0.42,
    bassLift: 0,
    sparkle: 0.1,
    intensity: 1,
    saturation: 1.1,
    colourShift: 0,
    colourDrift: 0.009,
  },
  mapping: [
    { from: 'keyHue', to: 'colourShift', gain: 1, curve: 'linear' },
    { from: 'pace', to: 'travelSpeed', gain: 0.035, curve: 'linear' },
    { from: 'swell', to: 'depth', gain: 0.15, curve: 'linear' },
    { from: 'harmonicChange', to: 'warp', gain: 0.2, curve: 'linear' },
    { from: 'energy', to: 'rotationSpeed', gain: 0.02, curve: 'linear' },
    { from: 'weight', to: 'thickness', gain: 0.08, curve: 'linear' },
    { from: 'energy', to: 'intensity', gain: -0.08, curve: 'square' },
    { from: 'swell', to: 'intensity', gain: -0.03, curve: 'square' },
    { from: 'hardness', to: 'intensity', gain: -0.04, curve: 'square' },
    { from: 'energy', to: 'saturation', gain: -0.08, curve: 'square' },
    { from: 'swell', to: 'saturation', gain: -0.06, curve: 'square' },
    { from: 'hardness', to: 'saturation', gain: -0.08, curve: 'square' },
    { from: 'tension', to: 'zoom', gain: -0.2, curve: 'linear' },
  ],
  cost: 'heavy',
  excludes: ['dye-plumes'],
}

/**
 * Low contrast, grain and a gentle bloom: what Plume, Wash and Drift are
 * shown through. A hard track splits more and is clean, a soft one splits
 * less and is grainy, which is the one row `hardness` owns here. Tension
 * pulls the glow back before the drop puts it out again.
 */
const WARM_SOFT: LookStudy = {
  id: 'warm-soft',
  kind: 'look',
  name: 'Warm and soft',
  impl: 'look',
  home: { drive: 0.25, weight: 0.6, tonality: 0.6, steadiness: 0.4, hardness: 0.15 },
  reach: 0.6,
  moments: { intro: 1, groove: 1, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: {
    'bloom.threshold': 0.85,
    'bloom.knee': 0.2,
    'bloom.intensity': 0.35,
    'chromatic.amount': 0.0002,
    'chromatic.beat': 0.003,
    'tonemap.exposure': 1,
    'tonemap.shoulder': 0.6,
    'grain.amount': 0.012,
  },
  mapping: [
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.1, curve: 'linear' },
    { from: 'treble', to: 'bloom.threshold', gain: -0.1, curve: 'linear' },
    { from: 'hardness', to: 'chromatic.amount', gain: 0.0006, curve: 'linear' },
    { from: 'hardness', to: 'grain.amount', gain: 0.008, curve: 'invert' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.04, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'tension', to: 'bloom.intensity', gain: -0.05, curve: 'linear' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'chromatic', 'tonemap', 'grain'],
}

/**
 * Bloom and the tonemap and nothing else: no grain and no split, so hard
 * edges stay hard. This is what Prism and Melt are shown through, and the
 * reason the fractal reads as glass rather than as film. Tension lifts the
 * threshold, so fewer things glow as it winds up.
 */
const CLEAN_GLASS: LookStudy = {
  id: 'clean-glass',
  kind: 'look',
  name: 'Clean glass',
  impl: 'look',
  home: { drive: 0.55, weight: 0.4, tonality: 0.8, steadiness: 0.55, hardness: 0.6 },
  reach: 0.55,
  moments: { intro: 0, groove: 1, build: 0.5, drop: 1, rest: 0, outro: 0 },
  knobs: {
    'bloom.threshold': 0.8,
    'bloom.knee': 0.2,
    'bloom.intensity': 0.15,
    'chromatic.amount': 0.0008,
    'chromatic.beat': 0.003,
    'tonemap.exposure': 1,
    'tonemap.shoulder': 0.6,
    'grain.amount': 0.02,
  },
  mapping: [
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.06, curve: 'linear' },
    { from: 'treble', to: 'bloom.threshold', gain: -0.08, curve: 'linear' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.04, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'tension', to: 'bloom.threshold', gain: 0.06, curve: 'linear' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'tonemap'],
}

/**
 * High contrast, no grain, and the beat pushing the split wide: the hard end
 * of the catalogue. Nothing pinned uses it yet; it is here for the director,
 * and its numbers are Warm and soft's with the light pulled harder and the
 * grain switched off.
 */
const HARD_CLEAN: LookStudy = {
  id: 'hard-clean',
  kind: 'look',
  name: 'Hard and clean',
  impl: 'look',
  home: { drive: 0.75, weight: 0.5, tonality: 0.5, steadiness: 0.7, hardness: 0.9 },
  reach: 0.5,
  moments: { intro: 0, groove: 1, build: 0.5, drop: 1, rest: 0, outro: 0 },
  knobs: {
    'bloom.threshold': 0.78,
    'bloom.knee': 0.15,
    'bloom.intensity': 0.45,
    'chromatic.amount': 0.0004,
    'chromatic.beat': 0.006,
    'tonemap.exposure': 1,
    'tonemap.shoulder': 0.5,
    'grain.amount': 0.02,
  },
  mapping: [
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.12, curve: 'linear' },
    { from: 'treble', to: 'bloom.threshold', gain: -0.1, curve: 'linear' },
    { from: 'hardness', to: 'chromatic.amount', gain: 0.001, curve: 'linear' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'tension', to: 'bloom.threshold', gain: 0.08, curve: 'linear' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'chromatic', 'tonemap'],
}

/** Every study there is, flows first, then inks, then looks. */
export const STUDIES: readonly Study[] = [
  LAZY_FLUID,
  TURBULENT_FLUID,
  DYE_PLUMES,
  RIBBON,
  FRACTAL_GLINTS,
  WARM_SOFT,
  CLEAN_GLASS,
  HARD_CLEAN,
]

// The resolver looks every live study up on every frame, and this list is
// headed for forty entries, so the lookup is by key and not a walk.
const BY_ID = new Map(STUDIES.map((study) => [study.id, study]))

export const findStudy = (id: string): Study | undefined => BY_ID.get(id)

export const studiesOfKind = (kind: Study['kind']): readonly Study[] =>
  STUDIES.filter((study) => study.kind === kind)
