// One soft glow about the middle of the canvas, added into the scene's target
// before the feedback pass adds the history, so what is drawn here is fresh
// light that the trails then carry and smear.
//
// One quad, six vertices, sized to the glow and not to the frame. The quad is
// square in pixels and the light is a function of the distance from its middle,
// so the glow is round on a wide canvas and on a tall one. The falloff is a
// transcription of `haloLight` in halo.params.ts, which says what it is and why;
// keep the two in step, the tests measure the TypeScript. It is exactly zero at
// the quad's edge and beyond, so the quad's corners and its sides draw nothing.
//
// The CPU has already put the intensity into the colour, worked out the radius
// in pixels, the peak's place, the dip at the middle and the exponent, so this
// does no sizing of its own and the presence is the blend constant.

struct Params {
  // The canvas in pixels, then the radius in pixels. The fourth float is padding.
  screen: vec4<f32>,
  // Where the peak sits as a fraction of the radius, how far the middle is
  // dimmed, and the exponent softness sets. The fourth float is padding.
  shape: vec4<f32>,
  // Light in rgb, already scaled by the intensity. The fourth float is padding.
  light: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;

struct Quad {
  @builtin(position) position: vec4<f32>,
  // From -1 to 1 across the quad, so 1 is the radius in every direction.
  @location(0) local: vec2<f32>,
}

@vertex
fn quad(@builtin(vertex_index) vi: u32) -> Quad {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  let corner = corners[vi];
  // Pixels from the top left, the middle of the canvas plus a radius each way.
  let pixel = 0.5 * params.screen.xy + corner * params.screen.z;

  var out: Quad;
  // Pixels from the top left to clip space, where y runs up.
  out.position = vec4<f32>(
    pixel.x / params.screen.x * 2.0 - 1.0,
    1.0 - pixel.y / params.screen.y * 2.0,
    0.0,
    1.0,
  );
  out.local = corner;
  return out;
}

@fragment
fn fs(in: Quad) -> @location(0) vec4<f32> {
  let d = length(in.local);
  let peak = params.shape.x;
  var u: f32;
  if (d < peak) {
    // Inside the peak the light rises from the dimmed middle to 1. This branch
    // is taken only when the peak is over 0, so the division is safe.
    u = 1.0 - params.shape.y * (1.0 - d / peak);
  } else {
    u = (1.0 - d) / (1.0 - peak);
  }

  u = clamp(u, 0.0, 1.0);
  let smooth_u = u * u * (3.0 - 2.0 * u);
  // Exactly 0 at the edge and beyond, and not left to what pow makes of a base of 0.
  let light = select(0.0, pow(smooth_u, params.shape.z), smooth_u > 0.0);

  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(params.light.rgb * light, 1.0);
}
