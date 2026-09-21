/**
 * height-kit, the CPU half: a scrolling heightfield that ridgeline, ocean, the
 * grid and the city are all built on. Pure TypeScript with no GPU objects, the
 * way `spectrum.params.ts` is, so what decides the picture can be tested
 * without a browser. `HeightField.ts` puts it on the GPU and
 * `shaders/height.common.wgsl` reads it back; the maths here is the shader's
 * twin, and the tests measure this copy.
 *
 * The world is one unit of camera height tall. The camera flies down +z at
 * the middle of the field, a little above the ground, looking at the horizon,
 * and the ground it flies over is a ring of rows. Each row is one strip across
 * the width, `HEIGHT_ROW_SPACING` of world apart, and holds the music at that
 * moment: the five bands laid across the width, sub on the centre line and
 * treble at the outer edge, mirrored so the two halves are the same and the
 * middle is a valley you fly down.
 *
 * ```text
 *   row born at the far end       rows scroll toward you      row passes the camera
 *   (the music now)         ──►   (the music a moment ago) ──► and is overwritten
 *   slot k mod ROWS
 * ```
 *
 * Travel is world units a second, never rows a frame. `advance` takes a
 * distance, so a frame of 1/144 s and one of 1/30 s that cover the same
 * distance write the same rows, and the fractional part of the travel is
 * handed to the shader so the ground scrolls smoothly between rows instead of
 * stepping. The music is sampled when a row is born, at the far end, so it
 * arrives at the camera after `HEIGHT_DEPTH / speed` seconds: that lag is the
 * picture, music drawn as light running toward you, and it is why the field is
 * short. At 2.7 units a second, a groove's speed in the grid, the far end is
 * under five seconds from the camera and the ground three units out a little
 * over three and a half; at 8 it is a little over a second and a half.
 *
 * The ring holds only what the music was, in 0 to 1. Everything a study wants
 * to change live (how tall, how wide the valley) is applied when the shader
 * looks a height up, so tension narrows the valley for the whole visible field
 * at once and not only for the rows born after it.
 *
 * What the kit has to work with is what the packet carries: the five band
 * levels and their pulses. It does not go back to the analyser for more, the
 * way the spectrum ring does not; the ring's memory of them is the history.
 */
import { F } from '../audio/FeatureExtractor'

/** Rows in the ring: the field is this many strips deep. */
export const HEIGHT_ROWS = 32

/** Columns across the width, mirrored about the centre line. Even, so the middle is between two. */
export const HEIGHT_COLUMNS = 64

/** World distance between two rows. */
export const HEIGHT_ROW_SPACING = 0.4

/** How far ahead the field reaches. The row at this distance is the row just born. */
export const HEIGHT_DEPTH = HEIGHT_ROWS * HEIGHT_ROW_SPACING

/** Where the columns end, either side of the centre line, in world units. Past it the outer column holds. */
export const HEIGHT_HALF_WIDTH = 8

/**
 * The tallest the ground reaches, as a share of the camera's height. Under 1
 * on purpose: the ground never rises to the camera, so a ray that comes down
 * from the horizon meets it exactly once and the shader's march can go
 * downward in even steps without a hill ever hiding behind a nearer one.
 */
export const HEIGHT_MAX_RELIEF = 0.85

/** Where the music fades to nothing on the way out, as a share of the depth, so a row is born flat. */
export const HEIGHT_TAPER = 0.75

/** How much of the outer hills stand when the music has none: the sides are hills and not a flat. */
export const HEIGHT_BASE = 0.35

/** How much the floor of the valley moves with the music, against the hills' whole range. */
export const HEIGHT_RIPPLE = 0.18

/** How far a band's pulse lengthens what its level says, so a kick is a crest and not only a swell. */
export const HEIGHT_KICK = 0.6

/**
 * The time constant, in seconds, a new row follows the target with. Rows are
 * written a distance apart, so this is per second and not per row: a fast
 * flight writes rows close in time and smooths them, and a slow one writes
 * them far apart and takes each as it is.
 */
export const HEIGHT_SMOOTHING = 0.06

/** The longest step `advance` will travel in one go, in seconds. The renderer clamps to the same. */
export const HEIGHT_MAX_STEP = 0.1

/** The bands, in the order across the width from the centre line out. */
export const HEIGHT_BANDS = [F.sub, F.bass, F.lowMid, F.highMid, F.treble] as const
export const HEIGHT_PULSES = [
  F.subPulse,
  F.bassPulse,
  F.lowMidPulse,
  F.highMidPulse,
  F.treblePulse,
] as const

/** Floats in the view uniform; `HeightView` in height.common.wgsl reads them in this order. */
export const HEIGHT_VIEW_FLOATS = 16

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

const smoothstep = (low: number, high: number, value: number) => {
  const t = clamp((value - low) / (high - low), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * The camera, in the units the shader uses. `height` is above the ground,
 * `horizon` is where the horizon sits on screen in half-heights above the
 * middle (screen y is up), and `focal` is the distance to the picture plane in
 * the same half-heights, so 1 is a ninety degree view top to bottom and a
 * bigger number is a longer lens. The camera looks along the ground, so the
 * horizon is a straight line at `horizon` whatever the terrain does.
 */
export type HeightCamera = {
  height: number
  horizon: number
  focal: number
}

/** A low camera looking down the road, the horizon a fifth of a screen above the middle. */
export const HEIGHT_CAMERA: HeightCamera = { height: 1, horizon: 0.22, focal: 1.15 }

/** A point on the screen in half-heights from the middle, x to the right and y up. */
export type Ndc = { x: number; y: number }

/** A pixel's place in the same units. */
export const pixelToNdc = (px: number, py: number, width: number, height: number): Ndc => ({
  x: (px - width / 2) / (height / 2),
  y: (height / 2 - py) / (height / 2),
})

/**
 * Where a point in the world lands on the screen, or null when it is not in
 * front of the camera. `x` is across, `y` is up from the ground and `z` is
 * how far ahead. This is the whole of the shader's projection run forwards:
 * the ray for a pixel is `(x, y - horizon, focal)`, so a point at `(x, y, z)`
 * is at `focal * x / z` across and `horizon + focal * (y - height) / z` up.
 */
export function projectPoint(camera: HeightCamera, x: number, y: number, z: number): Ndc | null {
  if (!(z > 0)) return null
  return {
    x: (camera.focal * x) / z,
    y: camera.horizon + (camera.focal * (y - camera.height)) / z,
  }
}

/**
 * The point on the ground at height `y` a pixel looks at, run backwards, or
 * null when the pixel is at or above the horizon and looks at no ground. This
 * is the shader's first guess at a hit, before it walks down through the
 * relief.
 */
export function groundPoint(
  camera: HeightCamera,
  ndc: Ndc,
  y = 0,
): { x: number; z: number } | null {
  const down = camera.horizon - ndc.y
  if (!(down > 0)) return null
  const z = (camera.focal * (camera.height - y)) / down
  return { x: (ndc.x * z) / camera.focal, z }
}

/**
 * How much of a line survives the distance: exactly 1 at the camera, falling
 * smoothly and squared, and exactly 0 at `reach` and beyond, which is what
 * makes it a fog to true black and not to a dark grey. Twice smoothed so it
 * has no slope at either end and no line is seen to arrive.
 */
export function heightFog(distance: number, reach: number): number {
  const t = clamp(distance / reach, 0, 1)
  const fade = 1 - t * t * (3 - 2 * t)
  return fade * fade
}

/**
 * A band's level at a place across the field, `across` 0 on the centre line
 * and 1 at the outer edge. The five bands are stops at every quarter and a
 * place between two takes a smoothstep of them, which has no slope at a stop,
 * so the mirror about the centre has no crease and the row has no seam. Each
 * band's pulse lengthens its level by a share of it, so a kick raises a crest
 * across the middle and a pulse can never draw a rise from a band that is
 * silent.
 */
export function bandLevelAt(features: Float32Array, across: number): number {
  const stops = HEIGHT_BANDS.length - 1
  const place = clamp(across, 0, 1) * stops
  const low = Math.min(Math.floor(place), stops - 1)
  const t = place - low
  const blend = t * t * (3 - 2 * t)
  return kicked(features, low) * (1 - blend) + kicked(features, low + 1) * blend
}

function kicked(features: Float32Array, band: number): number {
  const level = features[HEIGHT_BANDS[band] ?? 0] ?? 0
  const pulse = features[HEIGHT_PULSES[band] ?? 0] ?? 0
  const value = level * (1 + HEIGHT_KICK * pulse)
  // Not a number counts as silence, so nothing that is not finite reaches the GPU.
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0
}

/**
 * The ring of rows. `data` is `rows` strips of `columns` floats in slot order
 * and is what lives on the GPU; the rest is the bookkeeping that says which
 * slot is which row of the world.
 *
 * A row is a whole number `k` and sits at world `k * spacing`. Its slot is
 * `k mod rows`. At travel `T` the camera is in row `floor(T / spacing)`, the
 * rows from there to `rows - 1` further on are the ones in view, and the one
 * born as the camera crosses a row line is the newest at the far end. It
 * overwrites the slot of the row the camera has just passed.
 */
export class HeightRing {
  readonly data: Float32Array
  /** How far the camera has flown, in world units. Kept whole here and only ever handed on wrapped. */
  private travelled = 0
  /** The next row to be written, which is one past the newest. */
  private nextRow: number
  /** Rows written since the last flush, at most `rows`. */
  private pending = 0
  private newestSlot: number

  constructor(
    readonly rows = HEIGHT_ROWS,
    readonly columns = HEIGHT_COLUMNS,
    readonly spacing = HEIGHT_ROW_SPACING,
  ) {
    this.data = new Float32Array(rows * columns)
    // The field starts flat, rows 0 to rows - 1, so the first row to be born is `rows`.
    this.nextRow = rows
    this.newestSlot = rows - 1
  }

  /** How far the ring reaches ahead, in world units. */
  get depth() {
    return this.rows * this.spacing
  }

  /** The total distance flown. Only for a caller that wants to know; nothing on the GPU reads it. */
  get distance() {
    return this.travelled
  }

  /**
   * The travel wrapped into one lap of the ring, which is all the shader needs
   * to find a row (a row's slot repeats every lap) and what keeps the number
   * small enough for a 32 bit float after hours of flying.
   */
  get wrappedTravel() {
    return this.travelled % this.depth
  }

  /** The travel wrapped into any period, for whatever else scrolls with it: a grid's lines. */
  wrapTravel(period: number) {
    return this.travelled % period
  }

  /**
   * Fly `distance` further, and write a row from `features` for every row line
   * the camera has crossed. Returns how many rows it wrote, which is 0 on most
   * frames at a slow speed and never more than the ring holds: a jump longer
   * than the whole field writes only the rows that could still be seen.
   *
   * `dt` is the seconds the distance took, and only sets how much each row
   * follows the one before it (see `HEIGHT_SMOOTHING`), so several rows in one
   * frame are smoothed as the frame's time divided among them. Nothing here is
   * allocated.
   */
  advance(distance: number, dt: number, features: Float32Array): number {
    // Not a number, zero and backwards are all no travel at all.
    if (!(distance > 0) || !Number.isFinite(distance)) return 0
    this.travelled += distance
    const newest = Math.floor(this.travelled / this.spacing) + this.rows - 1
    const due = Math.min(newest - this.nextRow + 1, this.rows)
    if (due <= 0) return 0

    // Rows a jump skipped over were never in view, so they are not written.
    this.nextRow = newest - due + 1
    const seconds = dt > 0 ? dt / due : Number.POSITIVE_INFINITY
    const follow = 1 - Math.exp(-seconds / HEIGHT_SMOOTHING)
    for (let written = 0; written < due; written += 1) {
      const slot = this.nextRow % this.rows
      this.fillRow(slot, (slot + this.rows - 1) % this.rows, features, follow)
      this.newestSlot = slot
      this.nextRow += 1
    }

    this.pending = Math.min(this.pending + due, this.rows)
    return due
  }

  /**
   * Hands out the rows written since the last flush as up to two runs of
   * whole rows, `(first slot, count)`, and forgets them. Two because the ring
   * wraps. The caller uploads each run, and a ring that was not flushed for a
   * long time hands out all of itself once, which is what a study that has
   * been dark comes back to.
   */
  flush(write: (firstSlot: number, count: number) => void): void {
    if (this.pending === 0) return
    const first = (((this.newestSlot + 1 - this.pending) % this.rows) + this.rows) % this.rows
    const run = Math.min(this.pending, this.rows - first)
    write(first, run)
    if (run < this.pending) write(0, this.pending - run)
    this.pending = 0
  }

  /** Everything in the ring is out of date on the GPU, as at the start. */
  markAllPending(): void {
    this.pending = this.rows
  }

  /**
   * Writes one row: the music across the width, followed toward from the row
   * before, and mirrored so the two halves of the row are the same number for
   * number. Each column is `across` from 0 on the centre line to 1 at the
   * edge, and with an even count no column is on the line itself.
   */
  private fillRow(slot: number, before: number, features: Float32Array, follow: number) {
    const columns = this.columns
    const centre = (columns - 1) / 2
    const at = slot * columns
    const from = before * columns
    for (let column = 0; column < columns / 2; column += 1) {
      const target = bandLevelAt(features, (centre - column) / centre)
      const previous = this.data[from + column] ?? 0
      let value = previous + (target - previous) * follow
      // The tail of a fall is a number nothing can see and a float can hold for ever.
      if (value < 1e-4) value = 0
      this.data[at + column] = value
      this.data[at + columns - 1 - column] = value
    }
  }
}

/**
 * The two numbers a study changes live and the shader reads with every
 * height: how far out the valley's floor runs before the hills start, as a
 * share of the field's half width, and how tall the relief is, 0 to 1.
 */
export type HeightProfile = {
  valley: number
  relief: number
}

/** The valley's edge is held under 1 because a smoothstep with equal edges is undefined. */
const MAX_VALLEY = 0.95

/**
 * A height from the music's level at a place, `x` across in world units. The
 * middle, inside the valley, is a floor that ripples a little with the level.
 * Past the valley's edge the ground climbs to hills, which stand at
 * `HEIGHT_BASE` of the range when the music is quiet and at all of it when the
 * band there is full. The shader's `height_profile`, line for line. A study
 * that wants another terrain replaces this pair and keeps the ring.
 */
export function heightProfile(level: number, x: number, profile: HeightProfile): number {
  const across = clamp(Math.abs(x) / HEIGHT_HALF_WIDTH, 0, 1)
  const wall = smoothstep(clamp(profile.valley, 0, MAX_VALLEY), 1, across)
  const hills = wall * (HEIGHT_BASE + (1 - HEIGHT_BASE) * level)
  const floor = (1 - wall) * HEIGHT_RIPPLE * level
  return HEIGHT_MAX_RELIEF * clamp(profile.relief, 0, 1) * (hills + floor)
}

/**
 * The ring's music at a ground point, `x` across and `dz` ahead of the camera:
 * a bilinear read across the columns and along the rows, the rows wrapped
 * round the ring, faded to nothing over the far end so a row is born flat.
 * The shader's `height_level`.
 */
export function heightLevel(ring: HeightRing, x: number, dz: number): number {
  const columns = ring.columns
  const across = clamp((x / HEIGHT_HALF_WIDTH) * 0.5 + 0.5, 0, 1) * (columns - 1)
  const c0 = Math.floor(across)
  const c1 = Math.min(c0 + 1, columns - 1)
  const cf = across - c0
  const row = (ring.wrappedTravel + dz) / ring.spacing
  const r0 = Math.floor(row)
  const rf = row - r0
  const s0 = r0 % ring.rows
  const s1 = (r0 + 1) % ring.rows
  const read = (slot: number, column: number) => ring.data[slot * columns + column] ?? 0
  const near = read(s0, c0) * (1 - cf) + read(s0, c1) * cf
  const far = read(s1, c0) * (1 - cf) + read(s1, c1) * cf
  const depth = ring.depth
  const taper = 1 - smoothstep(HEIGHT_TAPER * depth, depth, dz)
  return (near * (1 - rf) + far * rf) * taper
}

/** The height of the ground at a point, in world units. The shader's `height_at`. */
export const heightAt = (ring: HeightRing, profile: HeightProfile, x: number, dz: number) =>
  heightProfile(heightLevel(ring, x, dz), x, profile)

/** The slope of the ground at a point, across and along, by central differences. The shader's `height_slope`. */
export function heightSlope(
  ring: HeightRing,
  profile: HeightProfile,
  x: number,
  dz: number,
): { across: number; along: number } {
  const e = 0.12
  return {
    across: (heightAt(ring, profile, x + e, dz) - heightAt(ring, profile, x - e, dz)) / (2 * e),
    along: (heightAt(ring, profile, x, dz + e) - heightAt(ring, profile, x, dz - e)) / (2 * e),
  }
}

/** The valley's edge as the shader reads it, so nothing a study resolves can divide by zero. */
export const heightValley = (valley: number) => clamp(valley, 0, MAX_VALLEY)

/**
 * The view uniform, in floats:
 *
 *   0 to 3    canvas width and height in pixels, the horizon (half-heights above the middle), the focal length
 *   4 to 7    the camera's height, the ring's travel wrapped to one lap, the row spacing, the rows
 *   8 to 11   the half width, the columns, the tallest the ground reaches, where the music starts to fade
 *   12 to 15  the valley's edge, the relief, the hills' base, the floor's ripple
 *
 * Every number that is a constant of the kit is written here rather than
 * declared twice, so the shader and this file cannot disagree about it.
 */
export function writeHeightView(
  out: Float32Array,
  ring: HeightRing,
  camera: HeightCamera,
  profile: HeightProfile,
  width: number,
  height: number,
): Float32Array {
  out[0] = width
  out[1] = height
  out[2] = camera.horizon
  out[3] = camera.focal
  out[4] = camera.height
  out[5] = ring.wrappedTravel
  out[6] = ring.spacing
  out[7] = ring.rows
  out[8] = HEIGHT_HALF_WIDTH
  out[9] = ring.columns
  out[10] = HEIGHT_MAX_RELIEF
  out[11] = HEIGHT_TAPER
  out[12] = heightValley(profile.valley)
  out[13] = clamp(profile.relief, 0, 1)
  out[14] = HEIGHT_BASE
  out[15] = HEIGHT_RIPPLE
  return out
}
