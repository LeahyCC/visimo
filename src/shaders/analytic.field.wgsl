// The analytic flow's velocity field, written in one fragment pass. Every
// line below is a transcription of `analyticVelocity` in
// `impls/analytic.params.ts`, which is where the reasoning lives and which is
// what the tests hold; if the two ever disagree, that file is right.
//
// The output is velocity in field widths per second, in x and y, in exactly
// the units and the `cover` mapping the fluid's field uses, so
// `post.feedback.wgsl` reads the last frame back along it with no change of
// its own. Field uv is y down, as a texture is, so a positive swirl or twist
// turns the picture clockwise on screen.
//
// One vec4 per term family. A term added later appends a vec4 to the struct
// and a few lines to `fs`, and moves nothing that is already here.

struct Field {
  // x speed at the peak, y falloff, zw spare
  radial: vec4<f32>,
  // x swirl, y twist, zw spare
  rotate: vec4<f32>,
  // xy the canvas centre in field uv, z the radius of the canvas corner, w spare
  frame: vec4<f32>,
  // x speed, y cells across the field, z the clock in turns, w spare
  curl: vec4<f32>,
  // x the pull at its fastest, y the photon radius, zw spare
  lens: vec4<f32>,
}

@group(0) @binding(0) var<uniform> field: Field;

const PI = 3.141592653589793;
const TWO_PI = 6.283185307179586;
const E = 2.718281828459045;
// `LENS_PEAK` and `LENS_ESCAPE` in impls/analytic.params.ts.
const LENS_PEAK = 0.14814814814814814;
const LENS_ESCAPE = 0.25;

struct Blit {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> Blit {
  var corners = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0),
  );
  let p = corners[vi];
  var out: Blit;
  out.position = vec4<f32>(p, 0.0, 1.0);
  // Clip space is y up, texture coordinates are y down.
  out.uv = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return out;
}

// The radial shape, divided by the most it reaches inside the canvas so the
// coefficient beside it always means the speed at the peak. `falloff` is
// clamped to zero on the CPU, so the max below only guards the division.
fn radial_profile(t: f32, falloff: f32) -> f32 {
  let peak = select(exp(-falloff), 1.0 / (max(falloff, 1.0) * E), falloff > 1.0);
  return (max(t, 0.0) * exp(-falloff * max(t, 0.0))) / peak;
}

// The lens shape, signed, as a multiple of `lens`: inward outside the photon
// radius and falling off with the square of the distance, gently outward
// inside it, and exactly zero at the centre and at the photon radius, so the
// two halves join with no step. `lensProfile` in impls/analytic.params.ts is
// where the reasoning lives. Both halves are evaluated and one is selected,
// so nothing branches on a per-texel value; the `max` calls are what keep the
// unused half finite rather than a division by zero.
fn lens_profile(t: f32, photon: f32) -> f32 {
  let p = max(photon, 1e-4);
  let at = max(t, 0.0);
  let u = at / p;
  let inside = LENS_ESCAPE * 4.0 * u * (1.0 - u);
  let s = p / max(at, 1e-5);
  let outside = -(s * s * (1.0 - s)) / LENS_PEAK;
  return select(outside, inside, at < p);
}

// One octave of the curl term, before `curl` scales it: the curl of
// `w/k sin(u) sin(v)`, which is two plane waves pushing perpendicular to
// themselves and so cannot gather or thin anything. `axis` is the octave's
// own (cos - sin, cos + sin), `scale` its wavenumber over the base one,
// `offset` and `turns` are the phase of each wave and how fast it turns, and
// `clock` is in turns. The clock's share of the phase is taken with `fract`,
// so it stays inside one turn however long the clock has been running.
fn curl_octave(
  p: vec2<f32>,
  k: f32,
  axis: vec2<f32>,
  weight: f32,
  offset: vec2<f32>,
  turns: vec2<f32>,
  clock: f32,
) -> vec2<f32> {
  let a = k * (axis.x * p.x + axis.y * p.y) + offset.x + TWO_PI * fract(turns.x * clock);
  let b = k * (axis.y * p.x - axis.x * p.y) + offset.y + TWO_PI * fract(turns.y * clock);
  let sin_a = sin(a);
  let sin_b = sin(b);
  return 0.5 * weight * vec2<f32>(
    sin_a * axis.y + sin_b * axis.x,
    -sin_a * axis.x + sin_b * axis.y,
  );
}

@fragment
fn fs(in: Blit) -> @location(0) vec4<f32> {
  let offset = in.uv - field.frame.xy;
  let r = length(offset);
  let t = r / max(field.frame.z, 1e-4);
  // Guarded rather than branched: at the centre the profile is zero and the
  // rotation is multiplied by a zero radius, so the direction is multiplied
  // away whatever it is.
  let unit = offset / max(r, 1e-5);

  // Both radial terms are a speed along the same ray, so they add. The lens
  // carries its own sign: the profile turns over at the photon radius.
  let speed = field.radial.x * radial_profile(t, field.radial.y)
    + field.lens.x * lens_profile(t, field.lens.y);
  // Solid-body swirl plus the part that is only near the middle. An angular
  // speed times the radius is a speed along the tangent, which is the perp of
  // the outward unit vector.
  let omega = TWO_PI * (field.rotate.x + field.rotate.y * max(1.0 - t, 0.0));
  var velocity = speed * unit + omega * r * vec2<f32>(-unit.y, unit.x);

  // The noise. The branch is on a uniform, so a flow whose curl is 0 pays for
  // no sines at all. The three octaves are `CURL_OCTAVES` in the params file,
  // in the same order and with the same numbers, unrolled so that nothing has
  // to index an array by a runtime value.
  if (field.curl.x != 0.0) {
    let k = PI * field.curl.y;
    let clock = field.curl.z;
    var noise = curl_octave(
      in.uv, k, vec2<f32>(1.0, 1.0), 0.55,
      vec2<f32>(1.3, 4.1), vec2<f32>(1.0, -1.3125), clock,
    );
    noise += curl_octave(
      in.uv, k * 2.0, vec2<f32>(-0.3660254037844386, 1.3660254037844386), 0.3,
      vec2<f32>(2.7, 0.4), vec2<f32>(-1.8125, 2.3125), clock,
    );
    noise += curl_octave(
      in.uv, k * 4.0, vec2<f32>(-1.3660254037844386, 0.3660254037844386), 0.15,
      vec2<f32>(5.2, 3.3), vec2<f32>(2.8125, -3.25), clock,
    );
    velocity += field.curl.x * noise;
  }

  return vec4<f32>(velocity, 0.0, 1.0);
}
