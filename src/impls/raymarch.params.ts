/**
 * The raymarch kit's pure half: how big a marched ink draws, and the CPU
 * copies of the two pieces of shader maths that are easy to get subtly wrong
 * and impossible to see wrong on screen. Pure TypeScript with no GPU objects,
 * the way `halo.params.ts` is, so the decisions are testable in Node and
 * `RaymarchInk.ts` is left moving data into a buffer.
 *
 * A raymarched ink costs a march per pixel, which is one or two orders more
 * than any analytic ink in the library, so it marches a smaller target and
 * the kit scales that back up into the shared ink target. That is not the
 * same lever as the fractal's `maxPixels`, which takes the whole frame down,
 * post stack and other inks with it: this takes only the expensive ink down
 * and leaves everything drawn beside it at the canvas's own size.
 *
 * `raymarchRay` and `smoothMin` below are line-for-line what
 * `shaders/raymarch.common.wgsl` does, kept here so the tests can hold the
 * shader's arithmetic to something. Change one and change the other.
 */

/** The share of the ink target a raymarched ink marches at, by default. */
export const HALF_SIZE = 0.5

/**
 * What a scale may be. The floor is a quarter, which is a sixteenth of the
 * pixels and the point past which the upscale is mush however good the
 * filter; the ceiling is the ink target itself, which is what an ink cheap
 * enough to march whole asks for.
 */
export const MIN_SCALE = 0.25
export const MAX_SCALE = 1

/**
 * The steps a scale is held to, so a knob-driven one cannot thrash. Changing
 * the marched size means new textures and a new bind group, which is the one
 * allocation in this kit, and a scale sliding with a level would make one
 * every frame. An eighth is a step of the size nothing on screen notices
 * between one section and the next.
 */
export const SCALE_STEP = 1 / 8

/** A scale clamped to its range and snapped to the step above. */
export function raymarchScale(scale: number): number {
  const held = Number.isFinite(scale) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) : HALF_SIZE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(held / SCALE_STEP) * SCALE_STEP))
}

/**
 * The target a march at this scale is drawn into, in pixels. At least one
 * texel each way, since a canvas can be one pixel wide while the stage is
 * laying out, and never larger than what it is scaled up into.
 */
export function raymarchSize(
  width: number,
  height: number,
  scale: number,
): readonly [number, number] {
  const held = raymarchScale(scale)
  const full = (side: number) => Math.max(1, Math.floor(Number.isFinite(side) ? side : 1))
  const marched = (side: number) => Math.min(full(side), Math.max(1, Math.round(full(side) * held)))
  return [marched(width), marched(height)]
}

/** A point in the world, or a direction in it. */
export type Vector = readonly [number, number, number]

const normalise = (v: Vector): Vector => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

const cross = (a: Vector, b: Vector): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/**
 * The camera the shader builds: a position, what it looks at, the field of
 * view in radians across the short side, and the width over the height. It is
 * the same four numbers the uniform carries, which is why they are grouped
 * here.
 */
export type RaymarchCamera = {
  eye: Vector
  look: Vector
  fov: number
  aspect: number
}

/**
 * The direction of the ray through one point of the target, where `ndc` runs
 * -1 to 1 on both axes with y up. This is `rmRay` in the shared WGSL.
 *
 * The field of view the camera names is the short side's, and the long side
 * opens past it by the aspect, so a wide canvas sees more of the scene either
 * side and a tall one more above and below. That is what keeps a solid of a
 * given size the same size on any shape of canvas, and it is the rule the rest
 * of the library sizes by.
 *
 * Looking straight along the up axis leaves the cross product undefined, so
 * another axis is borrowed for that frame, exactly as `cameraBasis` in
 * `gpu/math.ts` and the shader both do.
 */
export function raymarchRay(camera: RaymarchCamera, ndc: readonly [number, number]): Vector {
  const forward = normalise([
    camera.look[0] - camera.eye[0],
    camera.look[1] - camera.eye[1],
    camera.look[2] - camera.eye[2],
  ])

  const reference: Vector = Math.abs(forward[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0]
  const right = normalise(cross(forward, reference))
  const up = cross(right, forward)
  const tangent = Math.tan(camera.fov * 0.5)
  const aspect = Math.max(camera.aspect, 1e-4)
  const across = ndc[0] * tangent * Math.max(aspect, 1)
  const along = ndc[1] * tangent * Math.max(1 / aspect, 1)
  return normalise([
    forward[0] + right[0] * across + up[0] * along,
    forward[1] + right[1] * across + up[1] * along,
    forward[2] + right[2] * across + up[2] * along,
  ])
}

/**
 * Quilez's quadratic polynomial smooth minimum, which is `smoothMin` in the
 * shared WGSL. `k` is the width of the blended band in world units: outside
 * it the answer is the plain minimum and the shapes keep their own distance,
 * inside it the two are melted together. It is commutative and not
 * associative, and it under-estimates the distance outside the band, which is
 * why a march over it takes less than a whole step.
 */
export function smoothMin(a: number, b: number, k: number): number {
  if (!(k > 0)) return Math.min(a, b)
  const width = k * 4
  const h = Math.max(width - Math.abs(a - b), 0) / width
  return Math.min(a, b) - h * h * width * 0.25
}
