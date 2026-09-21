/**
 * The particle field's numbers, with no GPU in them: what a knob may reach,
 * what one frame's spawns are worth, how a particle moves, and what it costs
 * the frame. Pure TypeScript the way `caustics.params.ts` is, so every choice
 * here is unit tested and `ParticleField.ts` is left moving data into buffers.
 *
 * The state lives on the GPU and never comes back, so this file cannot hold a
 * pool. What it holds instead is the decisions either side of the pool:
 *
 * - the knob vocabulary and the range each one may reach, which the registry
 *   guard holds every study to and which `particleParams` clamps to;
 * - how many particles one frame spawns, from the continuous rate and from
 *   whatever hits the packet carries, and where in the ring buffer they land;
 * - `stepParticle`, a CPU mirror of the shader's integration, so the one thing
 *   no test here can see on the GPU (that the same forces put a particle in
 *   the same place at 60 and at 144 steps a second) is checked all the same;
 * - the uniform the shader reads, laid out once so the two halves agree.
 *
 * Everything is in short sides of the canvas with the origin at the middle and
 * y running up, the way the sparks' pool was, so a particle flies the same
 * distance on a wide canvas and a tall one. A size is a number of pixels
 * against a 1080 high canvas and is scaled by the short side, so it survives a
 * 4K canvas.
 */
import { DEFAULT_BANDS, F } from '../audio/FeatureExtractor'
import { peakPaletteAt, RIBBON_TINT } from '../post/params'
import { PARTICLE_KNOBS } from '../studies/impls'
import type { DustKnob, ParticleKnob, SparksKnob } from '../studies/impls'
import { hash01 } from './streaks.params'

const TAU = Math.PI * 2

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** Linear blend from `low` to `high`; generic, so it says nothing about particles. */
const mix = (low: number, high: number, amount: number) => low + (high - low) * amount

/**
 * The most slots any field holds. A field's buffers are sized to its own
 * profile rather than to this, so a dust field does not carry a sparks field's
 * memory; this is the ceiling of the ceilings and what the knob's range says.
 * Eight floats a particle makes half a million cost 16 MB.
 */
export const MAX_PARTICLES = 500_000

/** Floats one particle takes: place, velocity, age, life, seed, hue. */
export const PARTICLE_FLOATS = 8

/** Where a particle's fields sit in its eight floats; the shader reads the same order. */
export const PARTICLE_AT = {
  x: 0,
  y: 1,
  vx: 2,
  vy: 3,
  age: 4,
  life: 5,
  seed: 6,
  hue: 7,
} as const

/** Particles one compute invocation handles, and so what a dispatch counts in. */
export const PARTICLE_WORKGROUP = 64

/** Cells a side of the uniform grid the boids read. Square and fixed, so nothing resizes. */
export const GRID_SIDE = 64

/** Particle indices one cell of the grid keeps. Past this a cell drops the rest. */
export const GRID_SLOTS = 8

/** Cells the grid holds, which is what the binning passes clear and fill. */
export const GRID_CELLS = GRID_SIDE * GRID_SIDE

/** Spawn groups one frame may carry: the continuous rate, and a hit. */
export const MAX_SPAWN_GROUPS = 4

/** Floats one spawn group takes in the uniform: three vec4s. */
export const SPAWN_FLOATS = 12

/** Floats in the uniform before the spawn groups: twelve vec4s. */
export const PARTICLE_UNIFORM_HEAD = 48

/** Floats in the whole uniform. */
export const PARTICLE_UNIFORM_FLOATS = PARTICLE_UNIFORM_HEAD + MAX_SPAWN_GROUPS * SPAWN_FLOATS

/** The canvas height a `size` is written against, the same the dust's and the sparks' was. */
export const REFERENCE_HEIGHT = 1080

/** The thinnest a particle is drawn, in device pixels, whatever the canvas. */
export const MIN_WIDTH_PX = 1

/**
 * How much of its life a particle spends fading in. A field spawning thousands
 * a second would otherwise pop one in at full light on the frame it was born,
 * which reads as a flicker rather than as an arrival; a twentieth of a life is
 * a frame or two for a spark and a fifth of a second for a speck.
 */
export const FADE_IN = 0.05

/**
 * What each knob may reach, inclusive, over every field there is. A profile
 * narrows these for its own study (`DUST_RANGES`, `SPARK_RANGES`), the
 * registry guard holds every study to the narrowed set at silence and at a
 * full packet, and `particleParams` clamps to it, so a mapping that overshoots
 * cannot ask for something the buffers cannot hold.
 */
export const PARTICLE_RANGES: Readonly<Record<ParticleKnob, readonly [number, number]>> = {
  // Slots the field simulates and draws.
  count: [0, MAX_PARTICLES],
  // Particles a second, spawned whether or not anything was struck.
  rate: [0, 40_000],
  // Particles one hit throws, at the hit's full strength.
  burst: [0, 20_000],
  // Seconds a particle lives, before its own spread.
  life: [0.05, 30],
  // Short sides a second at birth.
  speed: [0, 2],
  // How far round the spawn ring a burst fans, in turns. 1 is the whole ring.
  spread: [0, 1],
  // A particle's widest across at birth, in pixels on a 1080 high canvas.
  size: [0, 16],
  // Its size at death over its size at birth. 1 holds; under 1 shrinks to a point.
  grow: [0, 4],
  // Seconds of its own travel the quad stretches along, so a fast particle
  // reads as a streak and a stopped one as a round point.
  streak: [0, 0.2],
  // Light added on one frame at the head of one particle. A field is thousands
  // of them at once, so this is far smaller than the old pools' numbers were.
  intensity: [0, 4],
  // The power the life remaining is raised to. 0 holds the light flat to the
  // end, 1 is linear, higher is bright and then gone.
  fade: [0, 4],
  // Palette units either side of the ribbon's colour at the key.
  hueSpread: [0, 0.5],
  // How far toward white a particle is at birth.
  heat: [0, 1],
  // How far toward white it is at death. With `heat` it is a colour over life,
  // and on its own it is a tint, which is what makes dust pale rather than hot.
  pale: [0, 1],
  // How far a particle dims at the bottom of its own slow flicker.
  twinkle: [0, 1],
  // Velocity lost to the air, in 1/e a second.
  drag: [0, 8],
  // Short sides a second squared, along `gravityAngle`.
  gravity: [0, 2],
  // Radians from straight down, so 0 is a fall and PI is a rise.
  gravityAngle: [0, TAU],
  // How much of the live flow's velocity a particle takes. 1 rides it exactly.
  flow: [0, 2],
  // Curl noise strength, in short sides a second.
  curl: [0, 1],
  // Cells of the noise across the short side. Low is one broad swirl.
  curlScale: [0.25, 16],
  // Pull toward the attractor, per second, as a rate on the distance to it.
  // A velocity rather than a force, so it draws a particle in along an
  // exponential and never swings it past the point.
  gather: [0, 4],
  // The attractor in canvas uv, so the middle of any canvas is (0.5, 0.5).
  attractX: [0, 1],
  attractY: [0, 1],
  // The three boids terms, each an acceleration in short sides a second
  // squared at the full strength of its own neighbourhood average.
  separation: [0, 8],
  alignment: [0, 8],
  cohesion: [0, 8],
  // How far a particle looks for its neighbours, in short sides. It is also
  // the grid's cell, so raising it costs nothing but reach.
  neighbourhood: [0, 0.5],
}

export type ParticleParams = Record<ParticleKnob, number>

export type ParticleRanges = Readonly<Record<ParticleKnob, readonly [number, number]>>

/**
 * Where a burst of particles is laid. `field` scatters them over the whole
 * canvas, which is what a continuous haze wants; `ring` lays them round a
 * circle about the attractor and throws them outward, which is what a hit
 * wants. It belongs to the profile rather than to a knob, because no mapping
 * row should be able to turn one into the other halfway through a bar.
 */
export const SPAWN_SHAPES = ['field', 'ring'] as const
export type SpawnShape = (typeof SPAWN_SHAPES)[number]

export const SHAPE_CODE: Readonly<Record<SpawnShape, number>> = { field: 0, ring: 1 }

/** One band's rows: how loud it is, whether it was struck, and where the strike sat. */
export type HitBand = {
  readonly hit: number
  readonly level: number
  readonly centre: number
  readonly width: number
}

/**
 * One field's fixed character: what it is called, how many slots its buffers
 * hold, where a burst is laid, which bands' hits throw one, what every knob
 * rests at and how far each may be taken.
 *
 * This is what "sparks and dust are knob sets on one implementation" means in
 * code. Neither has an implementation of its own any more; each is a profile,
 * and a study's own knobs are laid over it.
 */
export type ParticleProfile = {
  readonly label: string
  /**
   * What the overlay calls one particle, or empty for a field with nothing of
   * its own to say. `data-detail` is public API a consumer's tests assert on,
   * so a field that printed nothing before still prints nothing.
   */
  readonly detail: string
  readonly capacity: number
  readonly shape: SpawnShape
  /** Short sides from the attractor that a `ring` burst is laid on. */
  readonly ringRadius: number
  /** Radians either side of straight out that a `ring` burst is thrown within. */
  readonly cone: number
  /** The bands whose hits throw a burst, strongest first so the first one wins a tie. */
  readonly bands: readonly HitBand[]
  /** Every knob's resting value, which a study's own knobs are laid over. */
  readonly defaults: Readonly<Record<ParticleKnob, number>>
  /** What each knob may reach here, which is the registry guard's range. */
  readonly ranges: ParticleRanges
}

/**
 * The most of a band's level under which a hit is not heard. The extractor
 * never fires one there, but the bench's synthetic packet writes hits whatever
 * its level, and a silent packet has to draw nothing.
 */
const SILENT_BAND = 0.01

/**
 * The two bands the sparks answer to, the treble first so it wins a tie: a hat
 * and a crack of a snare on one frame is one struck sound, and the hat is the
 * particle's.
 */
export const TREBLE_BANDS: readonly HitBand[] = [
  { hit: F.trebleHit, level: F.treble, centre: F.trebleHitCentre, width: F.trebleHitWidth },
  { hit: F.highMidHit, level: F.highMid, centre: F.highMidHitCentre, width: F.highMidHitWidth },
]

/**
 * Places in the packet's own units, fractions of the octaves from the lowest
 * band edge to the highest. The two treble bands cover from where highMid
 * starts to where treble ends, and that stretch is what is laid round the ring.
 */
const SPAN_OCTAVES = Math.log2(
  (DEFAULT_BANDS[DEFAULT_BANDS.length - 1]?.high ?? 16000) / (DEFAULT_BANDS[0]?.low ?? 20),
)
const placeOf = (hz: number) => Math.log2(hz / (DEFAULT_BANDS[0]?.low ?? 20)) / SPAN_OCTAVES
const PLACE_LOW = placeOf(DEFAULT_BANDS[3]?.low ?? 1000)
const PLACE_HIGH = placeOf(DEFAULT_BANDS[4]?.high ?? 16000)

/** A hit a field answers to: how hard, and where it landed in the packet's own units. */
export type ParticleHit = { strength: number; centre: number; width: number }

/**
 * The hit this frame throws a burst for, or null. The strongest of the
 * profile's bands, and only from a band that is sounding, so a silent packet
 * throws nothing however long it runs.
 */
export function particleHit(features: Float32Array, bands: readonly HitBand[]): ParticleHit | null {
  let best: ParticleHit | null = null
  for (const band of bands) {
    const strength = features[band.hit] ?? 0
    if (!(strength > 0) || !((features[band.level] ?? 0) > SILENT_BAND)) continue
    if (best && strength <= best.strength) continue
    best = {
      strength: clamp(strength, 0, 1),
      centre: features[band.centre] ?? 0,
      width: features[band.width] ?? 0,
    }
  }

  return best
}

/**
 * How far round the ring a hit lands, 0 at the bottom pole and 1 at the top,
 * as the hit's centre laid between the two bands' edges. The arithmetic the
 * sparks' pool used, kept so a hat still lands high on the ring and a snare's
 * crack lower.
 */
export function ringPosition(centre: number): number {
  const span = PLACE_HIGH - PLACE_LOW
  const at = (Number.isFinite(centre) ? centre : PLACE_LOW) - PLACE_LOW
  return clamp(at / span, 0, 1)
}

/**
 * How far round the ring a hit fans its burst, in turns, as the hit's own
 * width over the stretch the ring covers, capped by the study's `spread`. A
 * wide hit scatters across more of the ring than a narrow one, and the knob is
 * the ceiling rather than the value, so a study can hold a fan narrow whatever
 * the packet says.
 */
export function ringSpread(width: number, ceiling: number): number {
  const span = PLACE_HIGH - PLACE_LOW
  const scatter = Number.isFinite(width) ? Math.max(0, width) : 0
  return clamp(scatter / span, 0, 1) * ceiling
}

/**
 * The knobs a study resolved, laid over the profile's own resting values and
 * clamped to the profile's ranges. A knob the study does not name, or names as
 * something that is not a number, is the profile's. `count`, `rate` and
 * `burst` are whole, since a fraction of a particle is not a thing the buffer
 * can hold, and the count is held to the slots the buffers actually have.
 */
export function particleParams(
  knobs: Readonly<Partial<Record<string, number>>>,
  profile: ParticleProfile,
): ParticleParams {
  const out = {} as ParticleParams
  for (const knob of PARTICLE_KNOBS) {
    const given = knobs[knob]
    const value = given !== undefined && Number.isFinite(given) ? given : profile.defaults[knob]
    const [low, high] = profile.ranges[knob]
    out[knob] = clamp(value, low, high)
  }

  out.count = Math.min(profile.capacity, Math.round(out.count))
  out.rate = Math.round(out.rate)
  out.burst = Math.round(out.burst)
  return out
}

/** One frame's spawn: where in the ring it lands, how many, and what they are born with. */
export type SpawnGroup = {
  /** The first slot of the run, and how many slots it takes. */
  first: number
  count: number
  /**
   * Where the burst is centred. A `ring` burst reads `x` as how far round the
   * ring the hit sat, 0 at the bottom pole and 1 at the top; a `field` burst
   * ignores both and scatters over the canvas.
   */
  x: number
  y: number
  /** How far round the ring it fans, in turns. */
  spread: number
  speed: number
  life: number
  shape: SpawnShape
  /** Short sides from the attractor a ring burst is laid on. */
  radius: number
  /** Radians either side of straight out a ring burst is thrown within. */
  cone: number
  /** The hit's own strength, which scales a particle's speed. */
  strength: number
}

/** What `planSpawns` carries between frames: where the ring is and the rate's remainder. */
export type SpawnState = { cursor: number; carry: number }

export const spawnState = (): SpawnState => ({ cursor: 0, carry: 0 })

export const emptySpawnGroup = (): SpawnGroup => ({
  first: 0,
  count: 0,
  x: 0,
  y: 0,
  spread: 0,
  speed: 0,
  life: 0,
  shape: 'field',
  radius: 0,
  cone: 0,
  strength: 1,
})

/**
 * The spawns of one frame, and the ring cursor after them. Nothing is
 * allocated once the caller's array has been filled in for the first time:
 * this writes into it and says how many of its entries are live.
 *
 * The ring cursor is the whole of the allocation strategy. A slot is taken by
 * where the cursor is and not by looking for a dead one, so no pass has to
 * scan the pool and nothing ever comes back from the GPU; a particle still
 * alive when the cursor comes round again is overwritten, which is what makes
 * the pool a budget rather than a queue. `count` is the size of the ring, so a
 * knob that shrinks the pool shrinks the ring with it.
 *
 * The continuous rate carries its remainder between frames, so four tenths of
 * a particle a frame is two particles every five frames rather than none at
 * all, and the rate is the same number a second at any frame rate.
 */
export function planSpawns(
  params: ParticleParams,
  profile: ParticleProfile,
  features: Float32Array,
  dt: number,
  state: SpawnState,
  out: SpawnGroup[],
): number {
  if (params.count <= 0 || !(dt > 0)) {
    state.carry = 0
    return 0
  }

  let groups = 0
  const continuous = params.rate * dt + state.carry
  const whole = Math.min(params.count, Math.floor(continuous))
  state.carry = continuous - Math.floor(continuous)
  if (whole > 0) {
    const group = (out[groups] ??= emptySpawnGroup())
    group.first = state.cursor
    group.count = whole
    group.x = 0
    group.y = 0
    // The continuous rate is a haze rather than a throw, so it is laid over
    // the whole field whatever shape the profile's bursts take.
    group.spread = 1
    group.speed = params.speed
    group.life = params.life
    group.shape = 'field'
    group.radius = profile.ringRadius
    group.cone = Math.PI
    group.strength = 1
    state.cursor = (state.cursor + whole) % params.count
    groups += 1
  }

  const hit = params.burst > 0 ? particleHit(features, profile.bands) : null
  if (hit && groups < MAX_SPAWN_GROUPS) {
    const thrown = Math.min(params.count, Math.round(params.burst * hit.strength))
    if (thrown > 0) {
      const group = (out[groups] ??= emptySpawnGroup())
      group.first = state.cursor
      group.count = thrown
      group.x = ringPosition(hit.centre)
      group.y = 0
      group.spread = ringSpread(hit.width, params.spread)
      group.speed = params.speed
      group.life = params.life
      group.shape = profile.shape
      group.radius = profile.ringRadius
      group.cone = profile.cone
      group.strength = hit.strength
      state.cursor = (state.cursor + thrown) % params.count
      groups += 1
    }
  }

  return groups
}

/** One particle as the CPU mirror sees it: the same eight numbers the buffer holds. */
export type ParticleState = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  seed: number
  hue: number
}

/** The field a particle rides, sampled in short sides a second at a place. */
export type FlowSample = (x: number, y: number) => readonly [number, number]

const NO_FLOW: FlowSample = () => [0, 0]

/** The attractor in short sides from the middle, which is what the shader steers toward. */
export const attractorX = (params: ParticleParams) => params.attractX - 0.5
export const attractorY = (params: ParticleParams) => 0.5 - params.attractY

/**
 * One integration step, exactly as `particles.wgsl` does it and for the same
 * reason the fluid's parameters are here rather than in its scene: the GPU is
 * where this actually runs and no test in this suite has one, so the step
 * lives here as well and the two are held to each other by the uniform they
 * share and by eye.
 *
 * Drag is the one term with a closed form, and it has one because it is the
 * term that decides whether the field looks the same at 60 and at 144 frames a
 * second. `exp(-drag * dt)` is exact at any step, where `1 - drag * dt` drifts
 * apart between rates and goes unstable over a drag of about two. Everything
 * else is symplectic Euler, velocity first and then place, which is the
 * cheapest scheme that does not gain energy; it is close but not exact across
 * frame rates, which is why the test comparing two rates states a tolerance
 * rather than an equality.
 *
 * The boids terms are not here. They are a property of the whole pool rather
 * than of one particle, and a CPU mirror of them would be a second simulation
 * to keep in step; what this holds is the part a lone particle's trajectory
 * depends on, which is the part frame-rate independence is about.
 */
export function stepParticle(
  particle: ParticleState,
  params: ParticleParams,
  dt: number,
  time: number,
  flow: FlowSample = NO_FLOW,
): void {
  if (particle.life <= 0) return
  const [flowX, flowY] = flow(particle.x, particle.y)
  const [curlX, curlY] = curlNoise(
    particle.x * params.curlScale,
    particle.y * params.curlScale,
    time,
  )
  const gravityX = Math.sin(params.gravityAngle) * params.gravity
  // 0 is straight down, and y runs up.
  const gravityY = -Math.cos(params.gravityAngle) * params.gravity
  const pushX = flowX * params.flow + curlX * params.curl + gravityX
  const pushY = flowY * params.flow + curlY * params.curl + gravityY
  const kept = Math.exp(-params.drag * dt)
  const vx = (particle.vx + pushX * dt) * kept
  const vy = (particle.vy + pushY * dt) * kept
  particle.vx = vx
  particle.vy = vy
  // The gather is a velocity and not an acceleration, so a particle draws in
  // toward the attractor along an exponential and never swings past it. As a
  // force it would need a drag over twice the square root of it to stay
  // overdamped, and a study moving one of the two would set the other
  // oscillating without meaning to.
  const pullX = (attractorX(params) - particle.x) * params.gather
  const pullY = (attractorY(params) - particle.y) * params.gather
  particle.x += (vx + pullX) * dt
  particle.y += (vy + pullY) * dt
  particle.age += dt
  if (particle.age >= particle.life) particle.life = 0
}

/**
 * Value noise at a point, in 0 to 1: four hashed corners smoothed. Not a
 * gradient noise, because it is a cell cheaper than Perlin and, once a curl
 * has been taken of it, indistinguishable at the scales a field uses.
 */
export function valueNoise(x: number, y: number): number {
  const cellX = Math.floor(x)
  const cellY = Math.floor(y)
  const fx = x - cellX
  const fy = y - cellY
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash01(cellX, cellY, NOISE_SALT)
  const b = hash01(cellX + 1, cellY, NOISE_SALT)
  const c = hash01(cellX, cellY + 1, NOISE_SALT)
  const d = hash01(cellX + 1, cellY + 1, NOISE_SALT)
  return mix(mix(a, b, sx), mix(c, d, sx), sy)
}

/** The hash's salt for the noise, so it never moves with a particle's own hashes. */
const NOISE_SALT = 11

/** How far apart the finite differences are taken, in noise cells. */
const EPSILON = 0.01

/**
 * The curl of the value noise, which is a velocity field with no divergence in
 * it: a particle riding it is stirred and never piles into a sink. The
 * derivatives are finite differences, since the noise has no closed-form
 * gradient. The clock walks the field rather than scaling it, so the swirl
 * drifts at a steady pace instead of breathing.
 */
export function curlNoise(x: number, y: number, time: number): readonly [number, number] {
  const at = y + time * CURL_DRIFT
  const dx = (valueNoise(x, at + EPSILON) - valueNoise(x, at - EPSILON)) / (2 * EPSILON)
  const dy = (valueNoise(x + EPSILON, at) - valueNoise(x - EPSILON, at)) / (2 * EPSILON)
  return [dx, -dy]
}

/** Noise cells the field walks a second, which is what makes the swirl move. */
export const CURL_DRIFT = 0.1

/** A particle's widest across in pixels on this canvas, which is what makes it survive 4K. */
export const particleDiameter = (size: number, width: number, height: number) =>
  Math.max(MIN_WIDTH_PX, size * (Math.min(width, height) / REFERENCE_HEIGHT))

/**
 * Device pixels a particle is given at the very least. It is what keeps a
 * field sparse on a small canvas, where a size in pixels has a floor of one
 * and a count written for a 1080 high frame would cover a fifth of a 320 by
 * 320 one. A field never puts more than one particle in a five by five block
 * of pixels, which no cast can override: the knob asks and the canvas decides.
 */
export const PIXELS_PER_PARTICLE = 24

/** The most particles this canvas is worth, whatever the count says. */
export const canvasCeiling = (width: number, height: number): number =>
  Math.max(1, Math.floor((Math.max(1, width) * Math.max(1, height)) / PIXELS_PER_PARTICLE))

/**
 * How often a band can fire in a second at the very most. The extractor counts
 * one struck sound once however its onsets fall across frames, and a run of
 * sixteenth notes at 200 beats a minute is about thirteen a second; eight is
 * what a busy groove actually reaches and what the coverage bounds are quoted
 * against.
 */
export const HITS_A_SECOND = 8

/**
 * Particles alive at once, at worst: everything the continuous rate keeps in
 * the air over one life, plus everything the hits can throw over the same
 * stretch, held to the pool.
 */
export const particlesAlive = (params: ParticleParams, hitsPerSecond = HITS_A_SECOND): number =>
  Math.min(
    params.count,
    Math.ceil(params.rate * params.life + params.burst * hitsPerSecond * params.life),
  )

/**
 * The most of the frame a field can cover, as a fraction of its area: every
 * live particle as a square of its widest across, over the canvas. An upper
 * bound, since the shader draws a soft disc inside that square, since a
 * particle past the peak of its life is smaller than `size`, and since nothing
 * stops two of them landing on one another. It is the number a study's comment
 * quotes and a test holds.
 */
export function particleCoverage(
  params: ParticleParams,
  width: number,
  height: number,
  hitsPerSecond = HITS_A_SECOND,
): number {
  const alive = Math.min(particlesAlive(params, hitsPerSecond), canvasCeiling(width, height))
  const side = particleDiameter(params.size, width, height)
  return (alive * side * side) / (width * height)
}

/**
 * The three palette stops the shader runs a particle's hue along: the ribbon's
 * colour at the key, and the same palette a half spread either side of it. The
 * shader mixes between them by the particle's own hue coordinate, which saves
 * it carrying a palette texture for the sake of one lookup a particle.
 */
export function particleColours(features: Float32Array, spread: number, out: Float32Array): void {
  const key = (features[F.keyHue] ?? 0) + RIBBON_TINT
  out.set(peakPaletteAt(key - spread / 2), 0)
  out.set(peakPaletteAt(key), 3)
  out.set(peakPaletteAt(key + spread / 2), 6)
}

/** Whether the two binning passes are worth encoding at all. */
export const boidsRun = (params: ParticleParams): boolean =>
  params.neighbourhood > 0 && (params.separation > 0 || params.alignment > 0 || params.cohesion > 0)

/**
 * Whether the field has anything to simulate or draw this frame. At presence 0
 * the renderer does not call the ink at all, and this is the second half of
 * the same promise: a count, a light or a size of nothing dispatches nothing
 * and encodes nothing.
 */
export const fieldRuns = (params: ParticleParams, presence: number): boolean =>
  presence > 0 && params.count > 0 && params.intensity > 0 && params.size > 0

/**
 * The grid's cell in short sides. A cell is at least the neighbourhood, so the
 * nine cells a particle reads always cover everything within reach of it, and
 * at least the canvas over `GRID_SIDE`, so the fixed grid always reaches the
 * corners. With no neighbourhood the grid is never encoded at all, and the
 * cell is the whole canvas so the arithmetic stays finite.
 */
export function cellSize(params: ParticleParams, width: number, height: number): number {
  const short = Math.max(1, Math.min(width, height))
  const extent = Math.max(width, height) / short
  if (!(params.neighbourhood > 0)) return extent
  return Math.max(params.neighbourhood, extent / GRID_SIDE)
}

/** Everything `writeParticleUniform` needs that is not a knob. */
export type UniformFrame = {
  width: number
  height: number
  dt: number
  time: number
  /** Nine floats: three palette stops in rgb, from `particleColours`. */
  colours: Float32Array
  groups: readonly SpawnGroup[]
  groupCount: number
  /** The live flow's canvas-uv cover, or null when no flow is carrying the picture. */
  flowCover: readonly [number, number] | null
  /** Whether a particle leaving one edge comes in at the other. */
  wrap: boolean
}

/**
 * The uniform the compute and the render halves share, written into a buffer
 * the caller keeps. The order is the shader's `Params` struct, and the two are
 * held to each other by `particles.params.test.ts` and by the ink's own test.
 *
 * Everything about the canvas is in the first vec4, because both halves read
 * it: the compute half keeps a particle in short sides from the middle, and
 * the render half turns those into pixels.
 */
export function writeParticleUniform(
  params: ParticleParams,
  frame: UniformFrame,
  out: Float32Array,
): Float32Array {
  const { width, height, dt, time, colours, groups, groupCount, flowCover, wrap } = frame
  const short = Math.max(1, Math.min(width, height))
  out.fill(0)
  // The canvas in pixels, its short side, and what one unit of `size` is worth
  // in pixels on it.
  out[0] = width
  out[1] = height
  out[2] = short
  out[3] = particleDiameter(1, width, height)
  // The step, the clock, the slots in play, and the grid's cell.
  out[4] = dt
  out[5] = time
  out[6] = params.count
  out[7] = cellSize(params, width, height)
  // Drag, gravity as a vector, and how much of the flow is taken.
  out[8] = params.drag
  out[9] = Math.sin(params.gravityAngle) * params.gravity
  out[10] = -Math.cos(params.gravityAngle) * params.gravity
  out[11] = params.flow
  // The curl, the pull toward the attractor and how far a particle looks.
  out[12] = params.curl
  out[13] = params.curlScale
  out[14] = params.gather
  out[15] = params.neighbourhood
  // The three boids weights and how long a streak is.
  out[16] = params.separation
  out[17] = params.alignment
  out[18] = params.cohesion
  out[19] = params.streak
  // The attractor in short sides from the middle, and the size over life.
  out[20] = attractorX(params)
  out[21] = attractorY(params)
  out[22] = params.size
  out[23] = params.size * params.grow
  // The light over life.
  out[24] = params.intensity
  out[25] = params.fade
  out[26] = params.twinkle
  out[27] = params.hueSpread
  // The flow's cover, whether there is a flow at all, and the grid's side.
  out[28] = flowCover?.[0] ?? 1
  out[29] = flowCover?.[1] ?? 1
  out[30] = flowCover ? 1 : 0
  out[31] = GRID_SIDE
  // The three palette stops, with the colour over life in their fourth slots.
  out[32] = colours[0] ?? 1
  out[33] = colours[1] ?? 1
  out[34] = colours[2] ?? 1
  out[35] = params.heat
  out[36] = colours[3] ?? 1
  out[37] = colours[4] ?? 1
  out[38] = colours[5] ?? 1
  out[39] = params.pale
  out[40] = colours[6] ?? 1
  out[41] = colours[7] ?? 1
  out[42] = colours[8] ?? 1
  out[43] = FADE_IN
  out[44] = groupCount
  out[45] = wrap ? 1 : 0
  for (let group = 0; group < MAX_SPAWN_GROUPS; group += 1) {
    const at = PARTICLE_UNIFORM_HEAD + group * SPAWN_FLOATS
    const spawn = group < groupCount ? groups[group] : undefined
    if (!spawn || spawn.count <= 0) continue
    out[at + 0] = spawn.first
    out[at + 1] = spawn.count
    out[at + 2] = spawn.x
    out[at + 3] = spawn.y
    out[at + 4] = spawn.spread
    out[at + 5] = spawn.speed
    out[at + 6] = spawn.life
    out[at + 7] = 0
    out[at + 8] = SHAPE_CODE[spawn.shape]
    out[at + 9] = spawn.radius
    out[at + 10] = spawn.cone
    out[at + 11] = spawn.strength
  }

  return out
}

/**
 * How far a knob's range is narrowed for one field, over the full vocabulary.
 * Written as a partial so a profile says only what it changes and everything
 * else stays at what the implementation allows.
 */
const narrow = (
  patch: Partial<Record<ParticleKnob, readonly [number, number]>>,
): ParticleRanges => {
  const out = {} as Record<ParticleKnob, readonly [number, number]>
  for (const knob of PARTICLE_KNOBS) out[knob] = patch[knob] ?? PARTICLE_RANGES[knob]
  return out
}

/**
 * The dust's ranges. Its count is the pool, its size is the pixels one speck
 * is across, and the two together are what keep the ink sparse: at the most
 * its own mapping reaches it covers under a twentieth of the frame on every
 * canvas shape, which `studies/dust.test.ts` holds.
 */
export const DUST_RANGES: Readonly<Record<DustKnob, readonly [number, number]>> = {
  count: [0, 40_000],
  size: [0, 4],
  curl: [0, 0.2],
  curlScale: [0.25, 8],
  twinkle: [0, 1],
  intensity: [0, 0.4],
  hueSpread: [0, 0.3],
  gather: [0, 4],
}

/**
 * The sparks' ranges. `rate` is the shimmer between hits and `burst` is what
 * one hit throws; the pool is what the two together may keep in the air.
 */
export const SPARK_RANGES: Readonly<Record<SparksKnob, readonly [number, number]>> = {
  count: [0, 60_000],
  rate: [0, 4_000],
  burst: [0, 4_000],
  speed: [0, 1.2],
  life: [0.1, 0.8],
  size: [0, 6],
  intensity: [0, 0.5],
  hueSpread: [0, 0.3],
}

/**
 * Slow specks adrift on their own curl, which is what the `dust` study is now:
 * no bursts, a continuous rate that keeps the pool full, almost no speed, a
 * long life, a flat fade and a pale tint. It reads a little of the live flow,
 * which the CPU pool could not: the old speck drifted on a closed-form curve
 * and the canvas smeared it along the current, and now the speck itself rides
 * the current and the canvas smears the result.
 */
export const DUST_PROFILE: ParticleProfile = {
  label: 'dust',
  // Nothing of its own worth a line in the overlay, which is what its ink said
  // before and what the shipped casts still have to print.
  detail: '',
  capacity: 40_000,
  shape: 'field',
  ringRadius: 0,
  cone: Math.PI,
  bands: [],
  ranges: narrow(DUST_RANGES),
  defaults: {
    count: 0,
    // The pool is refilled over about a life, so a change of count is a drift
    // in and not a jump.
    rate: 6_000,
    burst: 0,
    life: 7,
    speed: 0.004,
    spread: 1,
    size: 1.5,
    grow: 1,
    streak: 0,
    intensity: 0.08,
    // Flat to the end, with only the fade in and the fade out at the wrap.
    fade: 0.4,
    hueSpread: 0.12,
    heat: 0.45,
    pale: 0.45,
    twinkle: 0.45,
    drag: 0.6,
    gravity: 0,
    gravityAngle: 0,
    flow: 0.35,
    curl: 0.02,
    curlScale: 1.5,
    gather: 0,
    attractX: 0.5,
    attractY: 0.5,
    separation: 0,
    alignment: 0,
    cohesion: 0,
    neighbourhood: 0,
  },
}

/**
 * Points of light thrown off the treble and upper-mid hits, which is what the
 * `sparks` study is now: a burst a hit, laid round the ring where the hit sat,
 * thrown outward through a little drag and a little gravity, bright at birth
 * and gone under a second later. The one thing the CPU pool could not do is
 * the one thing that shows most: a spark now rides the live flow, so a burst
 * bends along whatever is stirring the canvas.
 */
export const SPARKS_PROFILE: ParticleProfile = {
  label: 'sparks',
  detail: 'sparks',
  capacity: 60_000,
  shape: 'ring',
  // Short sides from the middle, the same circle the pool threw from.
  ringRadius: 0.2,
  // Radians either side of straight out.
  cone: 0.4,
  bands: TREBLE_BANDS,
  ranges: narrow(SPARK_RANGES),
  defaults: {
    count: 0,
    rate: 0,
    burst: 0,
    life: 0.55,
    speed: 0.5,
    spread: 1,
    size: 1.2,
    // Down to a point, which is what makes a spark read as a spark.
    grow: 0.2,
    streak: 0.03,
    intensity: 0.03,
    fade: 1.5,
    hueSpread: 0.12,
    heat: 0.7,
    pale: 0,
    twinkle: 0,
    // 1/e a second: a spark at rest in half a second.
    drag: 2,
    // Short sides a second squared: over its longest life a spark sinks about
    // 7 percent of the short side.
    gravity: 0.25,
    gravityAngle: 0,
    flow: 0.6,
    curl: 0,
    curlScale: 2,
    gather: 0,
    attractX: 0.5,
    attractY: 0.5,
    separation: 0,
    alignment: 0,
    cohesion: 0,
    neighbourhood: 0,
  },
}
