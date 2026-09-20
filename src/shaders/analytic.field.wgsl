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
}

@group(0) @binding(0) var<uniform> field: Field;

const TWO_PI = 6.283185307179586;
const E = 2.718281828459045;

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

@fragment
fn fs(in: Blit) -> @location(0) vec4<f32> {
  let offset = in.uv - field.frame.xy;
  let r = length(offset);
  let t = r / max(field.frame.z, 1e-4);
  // Guarded rather than branched: at the centre the profile is zero and the
  // rotation is multiplied by a zero radius, so the direction is multiplied
  // away whatever it is.
  let unit = offset / max(r, 1e-5);

  let speed = field.radial.x * radial_profile(t, field.radial.y);
  // Solid-body swirl plus the part that is only near the middle. An angular
  // speed times the radius is a speed along the tangent, which is the perp of
  // the outward unit vector.
  let omega = TWO_PI * (field.rotate.x + field.rotate.y * max(1.0 - t, 0.0));
  let velocity = speed * unit + omega * r * vec2<f32>(-unit.y, unit.x);

  return vec4<f32>(velocity, 0.0, 1.0);
}
