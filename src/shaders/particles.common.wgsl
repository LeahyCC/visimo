// What both halves of the particle field agree about: the uniform, one
// particle, and the small pieces of arithmetic each half needs. It is
// prepended to the simulation and to the draw, the way fluid.common.wgsl is,
// because the two are separate modules: the compute half wants the pool as
// read_write storage and the vertex half wants it read-only, and one module
// cannot declare a binding twice.
//
// Everything in the simulation is in short sides of the canvas with the origin
// at the middle and y running up, so a particle flies the same distance on a
// wide canvas and a tall one. Only the draw turns that into pixels.

const TAU: f32 = 6.28318530718;

struct Params {
  // Width and height in pixels, the short side, and what one unit of `size` is
  // worth in pixels on this canvas.
  canvas: vec4<f32>,
  // The step in seconds, the clock in seconds, the slots in play, and the
  // grid's cell in short sides.
  step: vec4<f32>,
  // Drag in 1/e a second, gravity as a vector, and how much flow is taken.
  forces: vec4<f32>,
  // Curl strength and scale, the pull toward the attractor, and how far a
  // particle looks for its neighbours.
  noise: vec4<f32>,
  // Separation, alignment, cohesion, and the seconds of travel a streak is.
  boids: vec4<f32>,
  // The attractor in short sides from the middle, then the size at birth and
  // the size at death, both in units of `size`.
  attract: vec4<f32>,
  // Intensity, the fade's power, the twinkle's depth and the hue's spread.
  light: vec4<f32>,
  // The flow's canvas-uv cover, whether there is a flow at all, and the grid's side.
  cover: vec4<f32>,
  // Three palette stops in rgb, with the colour over life in their w: how far
  // toward white at birth, how far at death, and how much of a life is spent
  // fading in.
  low: vec4<f32>,
  mid: vec4<f32>,
  high: vec4<f32>,
  // How many spawn groups are live, and whether the field wraps at the edges.
  spawns: vec4<f32>,
  // Four groups of three vec4s: (first, count, x, y), (spread, speed, life,
  // pad), (shape, radius, cone, strength).
  groups: array<vec4<f32>, 12>,
}

struct Particle {
  // Place in short sides from the middle with y up, then velocity in short
  // sides a second.
  place: vec4<f32>,
  // Age and life in seconds, the particle's own seed, and its hue coordinate
  // in -0.5 to 0.5 before the spread is applied.
  span: vec4<f32>,
}

// The same mix the CPU mirror in particles.params.ts uses, written out so the
// two agree bit for bit on which corner of the noise is which.
fn hash_u(a: i32, b: i32, salt: i32) -> u32 {
  var h: u32 = (u32(a) * 0x9e3779b1u) ^ (u32(b) * 0x85ebca6bu) ^ (u32(salt) * 0xc2b2ae35u);
  h = h ^ (h >> 16u);
  h = h * 0x7feb352du;
  h = h ^ (h >> 15u);
  h = h * 0x846ca68bu;
  h = h ^ (h >> 16u);
  return h;
}

fn hash01(a: i32, b: i32, salt: i32) -> f32 {
  return f32(hash_u(a, b, salt)) / 4294967296.0;
}

/** Half the canvas in short sides, which is where the field wraps and where the grid ends. */
fn halfExtent(params: Params) -> vec2<f32> {
  return params.canvas.xy / params.canvas.z * 0.5;
}

/** A place in short sides from the middle as canvas uv, 0 to 1 with y down. */
fn placeToUv(params: Params, place: vec2<f32>) -> vec2<f32> {
  let half = halfExtent(params);
  return vec2<f32>(0.5 + place.x / (2.0 * half.x), 0.5 - place.y / (2.0 * half.y));
}
