/**
 * The studies themselves. TypeScript rather than JSON, unlike the presets and
 * the casts beside them: a study is vocabulary, not a file of numbers a
 * person tunes. Its knobs have to match its implementation's list and its
 * mapping has to speak that implementation's names, and the compiler can say
 * so at the point the mistake is made rather than at load. The casts are the
 * other way round and stay JSON.
 *
 * Every number below is ported from the five preset files, so nothing here is
 * invented, except for the studies that have no preset behind them, which say
 * so in their own comment. Where three presets drive one knob at three gains,
 * the study carries the smallest of them, which is what that study does
 * wherever it is cast, and each cast adds the rest. That way a cast's
 * overrides only ever push a study further in the direction it already goes,
 * and no override has to cancel a row out.
 *
 * `home` and `moments` come from the catalogue tables in
 * docs/studies-handoff.md, by its own convention: a capital letter is a
 * strong fit and reads 1, a lower case one about 0.5, and a letter that is
 * absent reads 0. An axis the catalogue says nothing about sits at 0.5, which
 * is no opinion rather than a weak one.
 */
import { IMPL_SCENES } from './impls'
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
 * What a study on the analytic flow that has no use for the curl term carries
 * for it. The speed is 0, which is off and encodes nothing on its own. The two
 * shape numbers sit at the resting values curl drift carries, and that is on
 * purpose: two flows on one implementation are blended by their knobs while a
 * change is running, and a shape that jumped between the two studies would
 * slide the pattern's cells and clock across the crossfade for a term that is
 * off in one of them.
 */
const NO_CURL = { curl: 0, curlScale: 3.5, curlRate: 0.05 }

/**
 * Everything drawn to the middle, as a build winds up. The pull IS the
 * tension: at 0 the radial coefficient is a hundredth of a field width a
 * second, which shrinks the picture by under two percent over a whole second
 * and reads as nothing, and at 1 it is half a field width and the frame is
 * gathered firmly into its own centre. Its tension row is the study; the
 * `energy` row beside it only lets a loud build pull a little harder than a
 * quiet one.
 *
 * `falloff` stays at 0, which makes the pull grow with the radius: a plain
 * zoom about the middle, everything converging at one rate. A pull that was
 * strongest near the centre would read as a hole in the picture rather than
 * as the picture gathering, which is the opposite of what a build wants.
 *
 * Its home is the middle of the character space with the widest reach there
 * is, because the catalogue gives it no character at all: any song that winds
 * up can implode.
 */
const IMPLODE: FlowStudy = {
  id: 'implode',
  kind: 'flow',
  name: 'Implode',
  impl: 'analytic',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 0, groove: 0, build: 1, drop: 0, rest: 0, outro: 0 },
  knobs: { ...NO_CURL, radial: -0.01, falloff: 0, swirl: 0, twist: 0 },
  mapping: [
    { from: 'tension', to: 'radial', gain: -0.4, curve: 'linear' },
    { from: 'energy', to: 'radial', gain: -0.08, curve: 'linear' },
  ],
  cost: 'cheap',
}

/**
 * The drop, thrown outward from the middle. It fires on `impact`, which is 1
 * on the frame the payoff lands and is down to a third of that within a fifth
 * of a second, so the push is a punch and not a level; `release` carries a
 * quarter of it for the phrase that follows, so the payoff keeps opening long
 * after the hit itself is gone.
 *
 * `falloff` is what makes it read as a burst rather than as a zoom out. At
 * rest it is 2, which puts the fastest ring halfway to the corner; `impact`
 * takes it to 4 on the frame of the drop, which pulls that ring in to a
 * quarter of the way out and leaves the rim standing. As the hit decays the
 * ring travels back outward, so the push sweeps out of the middle.
 *
 * It has no real use for tension, and the one row it has says so honestly
 * rather than inventing a job: the slow outward drift it carries at rest is
 * taken away exactly as tension reaches 1, so through a build the frame is
 * held still and nothing is opening when the drop arrives. The catalogue's
 * entry is "none; fires on impact", and that is what this is.
 */
const RADIAL_BURST: FlowStudy = {
  id: 'radial-burst',
  kind: 'flow',
  name: 'Radial burst',
  impl: 'analytic',
  home: { drive: 0.75, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.85 },
  reach: 0.55,
  moments: { intro: 0, groove: 0, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: { ...NO_CURL, radial: 0.05, falloff: 2, swirl: 0, twist: 0 },
  mapping: [
    { from: 'impact', to: 'radial', gain: 1.1, curve: 'linear' },
    { from: 'release', to: 'radial', gain: 0.3, curve: 'linear' },
    { from: 'tension', to: 'radial', gain: -0.05, curve: 'linear' },
    { from: 'impact', to: 'falloff', gain: 2, curve: 'linear' },
  ],
  cost: 'cheap',
}

/**
 * Slow noise that folds the picture over on itself, for the passages where
 * nothing else is moving it: an intro, a rest, an outro. It is the curl of a
 * smooth potential, so it drifts and stretches what is on the canvas without
 * gathering it in one place or thinning it in another, and it needs no solver,
 * which is also why it is the flow the WebGL2 path will use.
 *
 * It rests at 0.02 field widths a second at the fastest, about 50 pixels a
 * second across a 2560 wide canvas, which is a drift you see over half a
 * minute and not a motion you see over a second. That is on purpose: it sits
 * under dye plumes in a quiet passage and must not fight them. It is also not
 * silent at silence, since a flow is not asked to draw anything: at a silent
 * packet it still carries what is left of the picture at that resting speed,
 * so an outro that is fading to black keeps turning as it goes.
 *
 * Nothing sits still. Loudness and a lifting passage speed the drift, `pace`
 * and `weight` set the size of the cells (a busy track finer, a bass-led one
 * larger) and `pace` also hurries the pattern's own evolution. Tension speeds
 * both the drift and the evolution: a riser in an intro reads as the picture
 * beginning to churn. At tension 1 and a full packet the speed is 0.15, which
 * is still about 385 pixels a second at the fastest point and well short of a
 * flow that would smear a plume into a band.
 *
 * Its home is the middle of the space with the widest reach there is, because
 * the catalogue gives it no character at all. The catalogue gives it the quiet
 * moments and only those, so it is never the flow of a groove or a drop.
 */
const CURL_DRIFT: FlowStudy = {
  id: 'curl-drift',
  kind: 'flow',
  name: 'Curl drift',
  impl: 'analytic',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 1, groove: 0, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: { radial: 0, falloff: 0, swirl: 0, twist: 0, curl: 0.02, curlScale: 3.5, curlRate: 0.05 },
  mapping: [
    { from: 'energy', to: 'curl', gain: 0.05, curve: 'linear' },
    { from: 'swell', to: 'curl', gain: 0.02, curve: 'linear' },
    { from: 'tension', to: 'curl', gain: 0.06, curve: 'linear' },
    { from: 'pace', to: 'curlScale', gain: 2, curve: 'linear' },
    { from: 'weight', to: 'curlScale', gain: -1, curve: 'linear' },
    { from: 'pace', to: 'curlRate', gain: 0.05, curve: 'linear' },
    { from: 'tension', to: 'curlRate', gain: 0.05, curve: 'linear' },
  ],
  cost: 'cheap',
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
 * Prism's raymarched ridges, bright parts only. The fractal is a full-frame
 * image and a full-frame ink fills a canvas that carries to its ceiling
 * inside a second, which is why Melt washed out on a drop. `glint` is the
 * threshold that makes it a glint: the ink drops its own dim body and adds
 * only what reaches a share of the brightest the frame can be this instant,
 * worked out in `scenes/kaleidoscope.params.ts`.
 *
 * It rests at 0.3 and rises with the two things that fill the frame. `energy`
 * is the plain one: every band loud drives every fold and a lit pixel reaches
 * the full enamel, so loud is when the ink must give the most back.
 * `release` is the drop itself, which is louder still and lands on a canvas
 * whose trails have just been let out again. Together they reach 0.85 at a
 * full packet, where the ink lights 22.8 percent of the worst frame there is
 * against 83.6 percent with the threshold off, measured on the adapter. They
 * stop short of 1, which would be an ink that draws nothing at all.
 *
 * Its resting `intensity` is 0.5 rather than Prism's 1, because 1 was tuned
 * for a canvas with no feedback and everything the director builds carries.
 * Prism's cast puts it back, the way Melt's cast already pulled it down.
 *
 * Tension sweeps the zoom in, which is the catalogue's own entry for it: a
 * build travels into the fold rather than changing what is drawn, and the
 * threshold is left alone through a build because a build is the quiet part
 * and the drive it is measured against has already fallen with the music.
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
    intensity: 0.5,
    saturation: 1.1,
    colourShift: 0,
    colourDrift: 0.009,
    glint: 0.3,
    glintKnee: 0.35,
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
    { from: 'energy', to: 'glint', gain: 0.3, curve: 'linear' },
    { from: 'release', to: 'glint', gain: 0.25, curve: 'linear' },
  ],
  cost: 'heavy',
  excludes: ['dye-plumes'],
}

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
const RISER_STREAKS: InkStudy = {
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
const SHARDS: InkStudy = {
  id: 'shards',
  kind: 'ink',
  name: 'Shards',
  impl: 'shards',
  home: { drive: 0.85, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.9 },
  reach: 0.3,
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
    'grade.vignette': 0,
    'grade.saturation': 1,
    'grade.weave': 0,
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
    'grade.vignette': 0,
    'grade.saturation': 1,
    'grade.weave': 0,
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
    'grade.vignette': 0,
    'grade.saturation': 1,
    'grade.weave': 0,
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

/**
 * The build as a picture: the frame closes in and the colour drains as
 * tension climbs, and the drop throws it all open at once. It rests as a plain
 * clean look, Clean glass's numbers, so it can sit under a whole build without
 * having said anything until the song does.
 *
 * Every tension row has an `impact` row of the same size the other way, which
 * is what "opens" means here: at tension 1 they cancel exactly, and at less
 * they overshoot, which is the point. The drop is when tension is already
 * falling, and the frame of the drop has to be wide open then and not at what
 * is left of the build, so a vignette below 0 reads as none and a saturation
 * above 1 as untouched, and `writePostUniform` holds both there. The bloom is
 * left to overshoot, briefly, since the glow opening is part of the payoff.
 * Vignette and colour are where it lives; the bloom only follows them, its
 * threshold rising and its glow thinning so the picture tightens all over.
 *
 * Its home is the middle of the space with the widest reach, because any
 * song that winds up can be squeezed. It is a build look and has no use for
 * anything else, so it says nothing at the other moments.
 */
const SQUEEZE: LookStudy = {
  id: 'squeeze',
  kind: 'look',
  name: 'Squeeze',
  impl: 'look',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 0, groove: 0, build: 1, drop: 0, rest: 0, outro: 0 },
  knobs: {
    'bloom.threshold': 0.8,
    'bloom.knee': 0.2,
    'bloom.intensity': 0.15,
    'chromatic.amount': 0.0008,
    'chromatic.beat': 0.003,
    'grade.vignette': 0,
    'grade.saturation': 1,
    'grade.weave': 0,
    'tonemap.exposure': 1,
    'tonemap.shoulder': 0.6,
    'grain.amount': 0.02,
  },
  mapping: [
    { from: 'tension', to: 'grade.vignette', gain: 0.6, curve: 'linear' },
    { from: 'impact', to: 'grade.vignette', gain: -0.6, curve: 'linear' },
    { from: 'tension', to: 'grade.saturation', gain: -0.55, curve: 'linear' },
    { from: 'impact', to: 'grade.saturation', gain: 0.55, curve: 'linear' },
    { from: 'tension', to: 'bloom.threshold', gain: 0.1, curve: 'linear' },
    { from: 'impact', to: 'bloom.threshold', gain: -0.1, curve: 'linear' },
    { from: 'tension', to: 'bloom.intensity', gain: -0.08, curve: 'linear' },
    { from: 'impact', to: 'bloom.intensity', gain: 0.08, curve: 'linear' },
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.06, curve: 'linear' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.04, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'tonemap', 'grade'],
}

/**
 * A few frames of lifted exposure on the drop, and then gone. It is built to
 * the flash rule (WCAG 2.3.1: no more than three flashes in any second over a
 * large area, a flash being a large change in relative luminance) and not
 * tuned to it afterwards, in two ways.
 *
 * The rate is the extractor's, not this file's. `impact` fires on `release`
 * crossing up through 0.35 and rearms only once `release` has fallen back
 * under 0.12, and `release` falls with a time constant of half a phrase, at
 * shortest 0.75 s. So two drops are at least 0.8 s apart however hard the
 * music is played, which is at most two flashes in any second, and in a real
 * track they are a section apart. The look adds no trigger of its own: the one
 * row is on `impact`, which is 1 for a frame and a third of that in 0.18 s.
 *
 * The size is capped. `impact` never goes above 1, so the gain is the lift:
 * 0.2, an exposure of 1.2 on the frame of the drop, which the tonemap's
 * shoulder then bends, so the brightest parts barely move and it is the
 * middle of the picture that lifts. `registry.test.ts` holds that cap and
 * the rate; a cast's own rows could add to it, which is why the cap is
 * stated as a number a test reads rather than left as a habit.
 *
 * That lift is also the one place a full packet is allowed to end brighter
 * than rest, since a full packet has `impact` in it. The guard in the test
 * takes `impact` out and checks the rest of the packet still leaves the light
 * under rest, and then that the lift is all that is left over.
 *
 * It rests as Clean glass does, and says nothing at the other moments.
 */
const IMPACT_FLASH: LookStudy = {
  id: 'impact-flash',
  kind: 'look',
  name: 'Impact flash',
  impl: 'look',
  home: { drive: 0.5, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.5 },
  reach: 1,
  moments: { intro: 0, groove: 0, build: 0, drop: 1, rest: 0, outro: 0 },
  knobs: {
    'bloom.threshold': 0.8,
    'bloom.knee': 0.2,
    'bloom.intensity': 0.15,
    'chromatic.amount': 0.0008,
    'chromatic.beat': 0.003,
    'grade.vignette': 0,
    'grade.saturation': 1,
    'grade.weave': 0,
    'tonemap.exposure': 1,
    'tonemap.shoulder': 0.6,
    'grain.amount': 0.02,
  },
  mapping: [
    { from: 'impact', to: 'tonemap.exposure', gain: 0.2, curve: 'linear' },
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.06, curve: 'linear' },
    { from: 'treble', to: 'bloom.threshold', gain: -0.08, curve: 'linear' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.04, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'tonemap'],
}

/**
 * The quiet end of a song: heavy grain, a resting vignette and a slight weave,
 * for the intro, the rest and the outro of a soft, slow track, where the other
 * looks have nothing to say. It is film stock and a projector gate, so it costs
 * what a look costs, which is nothing beyond the composite: no pass of its own,
 * the weave being a shifted read of the picture the composite already samples.
 *
 * More film in the quiet is the whole idea, so grain and weave both rest at a
 * little and take `energy` inverted, which is the most of each when the music
 * is barely there and the least when it is loud (the grain never below its
 * resting 0.026, still twice Warm and soft's). The vignette rests gently and
 * breathes with `swell`: a passage lifting opens the frame and one falling
 * away draws it in. The bloom is softer than Warm and soft's, a wider knee and
 * less of it, and the exposure sits a shade under 1, like stock held back so
 * the blacks are dark. The colour rests a little under 1 for the same reason,
 * a faded stock and not a bright one.
 *
 * Tension tightens even this: the vignette closes a little, the colour drains a
 * little and the weave stills, so a build settles the frame down before it
 * winds it up. The weave is a wander of at most a pixel or two at 1080 high and
 * is meant to be felt and not seen; the rows keep it there, and at tension 1 in
 * a loud passage it is gone.
 *
 * Its home is the soft, slow corner and its reach is narrow, so a hard fast
 * track never sees it. It says nothing at the other moments.
 */
const FILM: LookStudy = {
  id: 'film',
  kind: 'look',
  name: 'Film',
  impl: 'look',
  home: { drive: 0.15, weight: 0.5, tonality: 0.5, steadiness: 0.5, hardness: 0.1 },
  reach: 0.55,
  moments: { intro: 1, groove: 0, build: 0, drop: 0, rest: 1, outro: 1 },
  knobs: {
    'bloom.threshold': 0.85,
    'bloom.knee': 0.3,
    'bloom.intensity': 0.28,
    'chromatic.amount': 0.0002,
    'chromatic.beat': 0.003,
    'grade.vignette': 0.32,
    'grade.saturation': 0.92,
    'grade.weave': 0.6,
    'tonemap.exposure': 0.96,
    'tonemap.shoulder': 0.6,
    'grain.amount': 0.026,
  },
  mapping: [
    { from: 'beatPulse', to: 'bloom.intensity', gain: 0.06, curve: 'linear' },
    { from: 'treble', to: 'bloom.threshold', gain: -0.08, curve: 'linear' },
    { from: 'tension', to: 'bloom.intensity', gain: -0.05, curve: 'linear' },
    { from: 'swell', to: 'grade.vignette', gain: -0.2, curve: 'linear' },
    { from: 'tension', to: 'grade.vignette', gain: 0.15, curve: 'linear' },
    { from: 'energy', to: 'grade.saturation', gain: -0.06, curve: 'square' },
    { from: 'tension', to: 'grade.saturation', gain: -0.1, curve: 'linear' },
    { from: 'energy', to: 'grade.weave', gain: 0.6, curve: 'invert' },
    { from: 'tension', to: 'grade.weave', gain: -1, curve: 'linear' },
    { from: 'energy', to: 'tonemap.exposure', gain: -0.04, curve: 'square' },
    { from: 'swell', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'hardness', to: 'tonemap.exposure', gain: -0.05, curve: 'square' },
    { from: 'energy', to: 'grain.amount', gain: 0.014, curve: 'invert' },
  ],
  cost: 'cheap',
  stages: ['bloom', 'tonemap', 'grain', 'grade'],
}

/** Every study there is, flows first, then inks, then looks. */
export const STUDIES: readonly Study[] = [
  LAZY_FLUID,
  TURBULENT_FLUID,
  IMPLODE,
  RADIAL_BURST,
  CURL_DRIFT,
  DYE_PLUMES,
  RIBBON,
  FRACTAL_GLINTS,
  RISER_STREAKS,
  SHARDS,
  WARM_SOFT,
  CLEAN_GLASS,
  HARD_CLEAN,
  SQUEEZE,
  IMPACT_FLASH,
  FILM,
]

// The resolver looks every live study up on every frame, and this list is
// headed for forty entries, so the lookup is by key and not a walk.
const BY_ID = new Map(STUDIES.map((study) => [study.id, study]))

export const findStudy = (id: string): Study | undefined => BY_ID.get(id)

export const studiesOfKind = (kind: Study['kind']): readonly Study[] =>
  STUDIES.filter((study) => study.kind === kind)

/**
 * What the canvas's `data-scene` prints for a set of live inks. A cast has no
 * single scene, so it is the first of them whose implementation was one,
 * which keeps the five pinned casts printing exactly what their presets did:
 * the dye is `fluid` and the fractal is `kaleidoscope`. A cast whose inks were
 * never scenes, a ribbon on its own, prints that ink's implementation instead,
 * so the line still says what is drawing.
 */
export function sceneOf(ids: readonly string[]): string {
  let first = ''
  for (const id of ids) {
    const study = findStudy(id)
    if (!study || study.kind !== 'ink') continue
    const scene = IMPL_SCENES[study.impl]
    if (scene) return scene
    if (!first) first = study.impl
  }

  return first
}
