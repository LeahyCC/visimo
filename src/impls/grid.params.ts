/**
 * The grid's numbers: how fast the floor comes, how thick a line is, what
 * colour, where the pulse is, worked out on the CPU and handed to the shader
 * as a finished uniform. Pure TypeScript with no GPU objects, the way
 * `lasers.params.ts` is, so the parts that decide what the picture looks like
 * can be tested without a browser. The ground itself, its rows, its projection
 * and its height, are height-kit (`height.params.ts`); this is only what one
 * study does with them.
 *
 * The picture is the neon grid floor to the horizon, lines only, and the
 * lines are the whole of the light. Each is drawn analytically in the
 * fragment shader from the ground coordinate the pixel looks at, so the grid
 * is as sharp at 4K as it is at 720p and has no texture to shimmer: the
 * shader measures how many cells one pixel spans (`fwidth`) and turns that
 * into a distance in pixels from the nearest line. A line's pixel width is
 * the knob, the light across it is a hot white spine, a box-filtered core and
 * a tight saturated glow, and past the point where a cell is only a few
 * pixels wide the lines fade instead of aliasing. The colour is two hues a
 * third of a turn apart that turn with the key, the near lines one and the
 * horizon the other, graded along the distance between them.
 *
 * The music is in the ground, not in the lines. The bands are laid across the
 * field's width and scroll toward you (the kit), and a line is brighter where
 * the ground it lies on is high and where it faces you, so the terrain is
 * drawn as light running over it. Nothing here is louder when the music is:
 * the intensity is the light of one line at rest and only ever gates down, and
 * the punch is in the height, the speed, the width of a line and the pulse.
 *
 * Travel is world units a second, per second and not per frame. The floor's
 * scroll is the kit's; the lines' own phase is that same distance wrapped to
 * one cell, so the lines move with the ground under them. The pulse is a
 * clock of its own, advanced by the real step, so it takes the same time to
 * cross the frame at any frame rate.
 */
import { F } from '../audio/FeatureExtractor'
import type { GridKnob } from '../studies/impls'
import { groundPoint, HEIGHT_CAMERA, heightFog, pixelToNdc } from './height.params'

/** Floats in the uniform; the shader's `Look` struct reads them in this order. */
export const GRID_UNIFORM_FLOATS = 16

/** World units between two lines, across and along. One row spacing is 0.4, so a cell is two and a half rows. */
export const GRID_CELL = 1

/** The distance a line has faded to nothing at, and exactly nothing past. It is fog to true black. */
export const GRID_REACH = 45

/** The canvas height a `width` and `glow` are written against, the same the lasers' are. */
const REFERENCE_HEIGHT = 1080

/**
 * The near hue in turns, at a key of 0 and no offset. Magenta on the shader's
 * cosine wheel, which puts the far hue a third of a turn on at cyan: the two
 * ends of the synthwave grid, and the key moves both of them round the wheel.
 */
export const GRID_BASE_HUE = 1 / 6

/** How far round the wheel the horizon's hue is from the near lines', in turns. */
export const GRID_HUE_GAP = 1 / 3

/** Seconds the pulse takes from the horizon to the camera. */
export const PULSE_SECONDS = 1.1

/** How far off the pulse starts, in world units: past the fog, at the horizon. */
export const PULSE_FAR = 60

/** How near it ends, in world units, which is under the closest ground on screen. */
export const PULSE_NEAR = 0.8

/**
 * The pulse's width in `1 / distance`, which is proportional to screen height
 * (a ground point's height below the horizon is `focal * camera / distance`),
 * so one number is the same thickness of band on screen wherever it is: about
 * three percent of the frame.
 */
export const PULSE_WIDTH = 0.05

/**
 * The horizon's light at the line itself as a share of `intensity`. Small: the
 * band is still on the screen, so the canvas sums it to about forty times what
 * is drawn, and it is the width that carries the music (`horizon` below), not
 * how bright it is.
 */
export const HORIZON_GAIN = 0.02

/** The knob value an `impact` has to reach to start a pulse, and the one it has to fall under to be ready for another. */
export const PULSE_FIRE = 0.5
export const PULSE_REARM = 0.2

/**
 * What each knob may reach, inclusive. The params clamp to them, and the
 * registry guard holds every study to its own resolved values at silence and
 * at a full packet.
 */
export const GRID_RANGES: Record<GridKnob, readonly [number, number]> = {
  // World units a second the camera flies. A cell is one unit, so 3 is three
  // lines a second passing under you.
  speed: [0, 20],
  // How tall the relief is, 0 flat to 1 the full range the kit allows.
  height: [0, 1],
  // How far out the valley floor runs before the hills start, as a share of the field's half width.
  valley: [0.08, 0.9],
  // A line's half width in pixels on a 1080 high canvas, at the camera.
  width: [0.3, 3],
  // The sigma of the glow round a line, in pixels on a 1080 high canvas.
  glow: [0.5, 12],
  // The light of one line at its core, before the height lifts it. Past 1 on
  // purpose: the canvas is half float and the bloom needs something over its
  // threshold to make the glow a tube of neon has in a camera.
  intensity: [0, 3],
  // 1 on the frame of an impact and falling; a pulse starts when it crosses `PULSE_FIRE`.
  pulse: [0, 1],
  // Turns added to the key.
  hue: [-0.5, 0.5],
  // How far the horizon's glow reaches above the line, in half-heights of the
  // frame. It is the width and not the light that moves with the music.
  horizon: [0.02, 0.3],
}

export type GridParams = Record<GridKnob, number>

const KNOBS = Object.keys(GRID_RANGES) as GridKnob[]

/** What a knob a study did not resolve falls to. The light falls to nothing. */
const FALLBACK: GridParams = {
  speed: 0,
  height: 0,
  valley: 0.5,
  width: 0.8,
  glow: 3,
  intensity: 0,
  pulse: 0,
  hue: 0,
  horizon: 0.08,
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** The knobs a study resolved, clamped to their ranges; a missing or non-finite one takes its fallback. */
export function gridParams(knobs: Readonly<Partial<Record<string, number>>>): GridParams {
  const out: GridParams = { ...FALLBACK }
  for (const knob of KNOBS) {
    const value = knobs[knob]
    const [low, high] = GRID_RANGES[knob]
    out[knob] = clamp(
      value !== undefined && Number.isFinite(value) ? value : FALLBACK[knob],
      low,
      high,
    )
  }

  return out
}

/**
 * Whether anything is drawn this frame. The intensity carries the gate: the
 * study takes it to 0 with the level, so a silent packet is no light and so no
 * pass and no upload.
 */
export const gridLit = (params: GridParams) => params.intensity > 1e-3

/** A line's half width in pixels on this canvas, which is what makes it survive a 4K one. */
export const gridWidthPixels = (width: number, canvasWidth: number, canvasHeight: number) =>
  width * (Math.min(canvasWidth, canvasHeight) / REFERENCE_HEIGHT)

/** The glow's sigma in pixels on this canvas. */
export const gridGlowPixels = (glow: number, canvasWidth: number, canvasHeight: number) =>
  glow * (Math.min(canvasWidth, canvasHeight) / REFERENCE_HEIGHT)

/**
 * The pulse's clock. `age` is the seconds since it started, and a pulse is
 * over once it reaches `PULSE_SECONDS`; `armed` is whether the trigger has
 * fallen since the last one, so one impact is one pulse however slowly it
 * decays. One object kept by the ink and moved in place: nothing allocates.
 */
export type PulseState = { age: number; armed: boolean }

export const idlePulse = (): PulseState => ({ age: PULSE_SECONDS, armed: true })

/**
 * Steps the pulse by the real `dt` and starts one when `trigger` crosses
 * `PULSE_FIRE` upward. A trigger that stays up is not a second pulse, and one
 * that lands mid-flight restarts it, which is the drop landing on the back of
 * a build. The step is clamped like the renderer's, so a hidden tab does not
 * wake to a pulse already over.
 */
export function stepPulse(state: PulseState, trigger: number, dt: number): PulseState {
  state.age = Math.min(state.age + clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1), PULSE_SECONDS)
  if (trigger >= PULSE_FIRE && state.armed) {
    state.age = 0
    state.armed = false
  } else if (trigger < PULSE_REARM) {
    state.armed = true
  }

  return state
}

/**
 * Where the pulse is, as `1 / distance`, or 0 with the strength 0 when it is
 * not flying. It starts at the horizon and ends at the camera, and its
 * position in `1 / distance` is what moves at a steady speed on screen; it is
 * squared on the way so it accelerates as it nears, the way something coming
 * at you does.
 */
export function pulseAt(age: number): { position: number; strength: number } {
  if (!(age >= 0) || age >= PULSE_SECONDS) return { position: 0, strength: 0 }
  const far = 1 / PULSE_FAR
  const near = 1 / PULSE_NEAR
  const run = age / PULSE_SECONDS
  // It fades in over its first tenth and out over its last, so it is never a cut.
  const edge = Math.min(run / 0.1, (1 - run) / 0.1, 1)
  return { position: far + (near - far) * run * run, strength: clamp(edge, 0, 1) }
}

/** How far a pixel's own footprint has to reach, in cells, before a line is too fine to draw. The shader's `LOD_START` and `LOD_END`. */
export const GRID_LOD = { start: 0.16, end: 0.48 } as const

/** How much of a line's own light its glow has at the line's edge. The shader's `HALO_GAIN`. */
export const GRID_HALO = 0.28

/**
 * The lines that run into the distance are gone sooner than the ones that cross
 * them: a pixel that spans `start` cells across is all of one, `end` none of it.
 * They pack toward the vanishing point, and what is drawn there the canvas sums
 * to a bright point and sharpens into a dark wedge. The shader's `LOD_ACROSS_START`
 * and `LOD_ACROSS_END`.
 */
export const GRID_LOD_ACROSS = { start: 0.04, end: 0.16 } as const

/**
 * The moving lines' glow as a share of the still lines'. What a moving line
 * leaves in the canvas is in proportion to all of it, body included, so the body
 * is kept small and the hot core carries the line. The shader's `MOVING_GLOW`.
 */
export const GRID_MOVING_GLOW = 0.35

/**
 * The share of its light a line that runs into the distance is drawn at. It
 * stands still on the screen while the ground is flat, and the canvas sums a
 * still mark to about forty times what is drawn. The shader's `STATIC_LINE`.
 */
export const GRID_STATIC_LINE = 0.14

/**
 * The lines that cross the view are drawn fainter as they pack together, which
 * is where the canvas's memory turns them into a wash: a line leaves a trail
 * of its speed times that memory, the gap to the next one shrinks with
 * distance, and no brightness fixes a trail longer than the gap. None of the
 * light is lost while a pixel spans `start` cells or fewer, `amount` of it is
 * by `end`. The shader's `CROWD`, `CROWD_START` and `CROWD_END`.
 */
export const GRID_CROWD = { amount: 0.9, start: 0.03, end: 0.12 } as const

/**
 * The lines that cross the view are also drawn fainter the faster they move
 * across the frame, which is what puts a ghost of a line behind it: the canvas
 * keeps what was drawn, a line that moves `m` pixels a frame leaves a copy of
 * itself every `m` pixels, and past a few pixels those are separate lines and
 * not a blur. Full light while a line crosses fewer than `start` pixels a
 * second, `floor` of it by `end`, both on a 1080 high canvas and scaled with
 * the canvas. At 60 frames a second 100 is under two pixels a frame, which is a
 * blur along the way the line moves, and 420 is seven, which is a second line.
 * The speed of a line on screen is the flight's cells a second over the cells
 * one pixel spans along the ground. The shader's `MOTION_FLOOR` and the
 * uniform's start and end.
 */
export const GRID_MOTION = { floor: 0.02, start: 100, end: 420 } as const

/**
 * A line's light across it, in pixels from its centre: a core that is full
 * inside `halfPixels` and falls across one pixel to nothing, so it is
 * anti-aliased by construction, and a gaussian glow that starts where the core
 * ends. The shader's `line_light`, and what the coverage below measures.
 */
export function lineLight(distance: number, halfPixels: number, glowPixels: number) {
  // The overlap of the line's width with the pixel's: a line thinner than a
  // pixel is dimmer and never a full pixel wide.
  const core = clamp(Math.min(2 * halfPixels, halfPixels + 0.5 - distance), 0, 1)
  const beyond = Math.max(distance - halfPixels, 0)
  const glow = GRID_HALO * Math.exp(-(beyond * beyond) / (2 * glowPixels * glowPixels))
  return { core, glow }
}

const smoothstep = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Lines too fine to resolve fade out over this footprint, in cells per pixel. The shader's `line_detail`. */
export const lineDetail = (footprint: number): number =>
  1 - smoothstep(GRID_LOD.start, GRID_LOD.end, footprint)

/** The lines into the distance fade sooner. The shader's `detail.x`. */
export const acrossDetail = (footprint: number): number =>
  1 - smoothstep(GRID_LOD_ACROSS.start, GRID_LOD_ACROSS.end, footprint)

/** How thin a line is at a distance, as a share of its width at the camera. The shader's `thin`. */
export const lineThinning = (distance: number): number =>
  1 - 0.5 * smoothstep(4, GRID_REACH * 0.6, distance)

/** The share of light left to the crossing lines at this footprint. The shader's `sparse`. */
export const lineCrowding = (footprint: number): number =>
  1 - GRID_CROWD.amount * smoothstep(GRID_CROWD.start, GRID_CROWD.end, footprint)

/**
 * The share of light left to a crossing line that moves `pixelsPerSecond`
 * across a canvas this high. The shader's `motion`.
 */
export const lineMotion = (pixelsPerSecond: number, canvasHeight: number): number => {
  const scale = canvasHeight / REFERENCE_HEIGHT
  return (
    1 -
    (1 - GRID_MOTION.floor) *
      smoothstep(GRID_MOTION.start * scale, GRID_MOTION.end * scale, pixelsPerSecond)
  )
}

/** A pixel counts as lit, for coverage, when its light passes this share of one line's core at the intensity of 1. */
export const LIT_THRESHOLD = 0.1

/**
 * The share of a frame the grid lights, on flat ground with the camera at
 * rest: the pixels below the horizon whose light from the lines, at the
 * study's own intensity and after the fog, the fade of fast lines and the loss of
 * detail, passes `LIT_THRESHOLD`. Flat ground is where the lines are closest
 * together on screen, so it is the worst case: a hill spreads them out. The
 * horizon's own glow is not counted, it is a band a few percent of the frame
 * tall and it does not move, and neither is the heat that lifts a line on tall
 * ground, which is the music and is not part of the grid.
 *
 * It takes a footprint from the neighbouring pixels the way `fwidth` does, so
 * it sees what the shader's derivative sees.
 */
export function gridCoverage(
  params: GridParams,
  canvasWidth: number,
  canvasHeight: number,
  phase = 0.5,
): number {
  const half = gridWidthPixels(params.width, canvasWidth, canvasHeight)
  const glow = gridGlowPixels(params.glow, canvasWidth, canvasHeight)
  const at = (px: number, py: number) => {
    const ground = groundPoint(HEIGHT_CAMERA, pixelToNdc(px, py, canvasWidth, canvasHeight))
    return ground
      ? { across: ground.x / GRID_CELL, along: (phase + ground.z) / GRID_CELL, distance: ground.z }
      : null
  }

  let lit = 0
  for (let py = 0; py < canvasHeight; py += 1)
    for (let px = 0; px < canvasWidth; px += 1) {
      const here = at(px + 0.5, py + 0.5)
      const right = at(px + 1.5, py + 0.5)
      const below = at(px + 0.5, py + 1.5)
      if (!here || !right || !below) continue
      const footprint = {
        across: Math.max(
          Math.abs(right.across - here.across) + Math.abs(below.across - here.across),
          1e-5,
        ),
        along: Math.max(
          Math.abs(right.along - here.along) + Math.abs(below.along - here.along),
          1e-5,
        ),
      }
      const width = half * lineThinning(here.distance)
      const fromAcross = Math.abs(here.across - Math.round(here.across)) / footprint.across
      const fromAlong = Math.abs(here.along - Math.round(here.along)) / footprint.along
      const acrossLight = lineLight(fromAcross, width, glow)
      const alongLight = lineLight(fromAlong, width, glow * GRID_MOVING_GLOW)
      const motion = lineMotion(params.speed / GRID_CELL / footprint.along, canvasHeight)
      const light =
        (GRID_STATIC_LINE * (acrossLight.core + acrossLight.glow) * acrossDetail(footprint.across) +
          lineCrowding(footprint.along) *
            motion *
            (alongLight.core + alongLight.glow) *
            lineDetail(footprint.along)) *
        params.intensity *
        heightFog(here.distance, GRID_REACH)

      if (light > LIT_THRESHOLD) lit += 1
    }

  return lit / (canvasWidth * canvasHeight)
}

/**
 * The uniform the shader reads, in floats:
 *
 *   0 to 3    the near hue and the far hue in turns, the intensity, the glow's sigma in pixels
 *   4 to 7    a line's half width in pixels, the cell, the fog's reach, the horizon's glow
 *   8 to 11   the lines' phase, the pulse's place in 1 / distance, its width, its strength
 *   12 to 15  the horizon's reach, the speed a crossing line starts to fade at and is at its
 *             floor by (pixels a second on this canvas), and the flight in cells a second
 *
 * The key is read from the packet, not the knobs, because it is a colour the
 * tracker keeps, the way the lasers read it. `phase` is the kit's travel
 * wrapped to one cell, which is what makes the lines scroll with the ground.
 */
export function writeGridUniform(
  params: GridParams,
  features: Float32Array,
  width: number,
  height: number,
  phase: number,
  pulseAge: number,
  out: Float32Array,
): Float32Array {
  const near = (features[F.keyHue] ?? 0) + GRID_BASE_HUE + params.hue
  const pulse = pulseAt(pulseAge)
  out[0] = near
  out[1] = near + GRID_HUE_GAP
  out[2] = params.intensity
  out[3] = gridGlowPixels(params.glow, width, height)
  out[4] = gridWidthPixels(params.width, width, height)
  out[5] = GRID_CELL
  out[6] = GRID_REACH
  // The horizon is a share of a line's light, held fixed: it is the far hue's
  // glow and it does not answer the music, which is what keeps it a horizon.
  out[7] = HORIZON_GAIN
  out[8] = phase
  out[9] = pulse.position
  out[10] = PULSE_WIDTH
  out[11] = pulse.strength
  const scale = height / REFERENCE_HEIGHT
  out[12] = params.horizon
  out[13] = GRID_MOTION.start * scale
  out[14] = GRID_MOTION.end * scale
  out[15] = params.speed / GRID_CELL
  return out
}
