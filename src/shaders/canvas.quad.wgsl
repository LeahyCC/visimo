// A quad textured with last frame's canvas, which is the whole of what the
// canvas sampler is for: an ink that draws the picture back into the picture,
// MilkDrop's oldest trick. Nothing in the library draws this; it exists so the
// sampler has something to test against.
//
// The one thing to understand about reading the canvas is that it is a loop.
// What comes back is the frame the composite last wrote, which already holds
// everything this ink drew a frame ago, so an ink that covers much of the
// frame at a gain near one feeds itself and runs away. Keep the gain under one
// and the quad small, which is what the knobs below do.

struct Params {
  // Where the quad is and how big, in canvas uv: centre then half extent.
  quad: vec4<f32>,
  // Where in the canvas it reads from: centre then half extent, again in uv.
  source: vec4<f32>,
  // How much of what it read is added back, and three spare floats.
  gain: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var canvas: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

struct Quad {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn quad(@builtin(vertex_index) vi: u32) -> Quad {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  let corner = corners[vi];
  let at = params.quad.xy + corner * params.quad.zw;
  var out: Quad;
  out.position = vec4<f32>(at.x * 2.0 - 1.0, 1.0 - at.y * 2.0, 0.0, 1.0);
  out.uv = params.source.xy + corner * params.source.zw;
  return out;
}

@fragment
fn fs(in: Quad) -> @location(0) vec4<f32> {
  let picture = textureSampleLevel(canvas, samp, clamp(in.uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(picture.rgb * params.gain.x, 1.0);
}
