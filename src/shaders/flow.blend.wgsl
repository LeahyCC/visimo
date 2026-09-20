// One velocity field copied into the blend target. The whole pass is this
// shader drawn once per live flow, each at its own weight through the blend
// constant, so the feedback pass is handed one field however many flows the
// director has running through a change. It is skipped altogether when one
// flow is live, which is every pinned cast.
//
// Sampled by uv rather than by texel, so two fields of different sizes still
// land on top of each other.

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var field: texture_2d<f32>;

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

@fragment
fn fs(in: Blit) -> @location(0) vec4<f32> {
  return textureSample(field, samp, in.uv);
}
