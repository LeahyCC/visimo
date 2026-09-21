// The second half of a raymarched ink: the small target it marched, scaled up
// into the shared ink target. One oversized triangle and one filtered sample,
// added through INK_BLEND with the study's presence in the blend constant, so
// this is the one place the ink's light reaches the canvas.
//
// Plain bilinear, and deliberately. The interesting alternative is a joint
// bilateral upsample, which keeps an edge crisp by weighting the four texels
// by how much they agree, and it wants a full-resolution guide to compare
// against: a depth or a normal buffer this ink does not draw and would have to
// march a second time to get. What is being scaled here is light on a solid
// after a brightness threshold, which is smooth almost everywhere and already
// cut to its bright parts, so the bilateral's edge would be an edge in the
// glint contour and not in the picture. Bilinear costs one sample.

@group(0) @binding(0) var marched: texture_2d<f32>;
@group(0) @binding(1) var bilinear: sampler;

struct Blit {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs(@builtin(vertex_index) index: u32) -> Blit {
  var corners = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0),
  );
  let p = corners[index];
  var out: Blit;
  out.position = vec4<f32>(p, 0.0, 1.0);
  // Clip space is y up, texture coordinates are y down.
  out.uv = vec2<f32>((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
  return out;
}

@fragment
fn fs(in: Blit) -> @location(0) vec4<f32> {
  // The alpha is left where the target's clear put it: an ink is light and
  // nothing else, and the blend adds the colour alone.
  let light = textureSample(marched, bilinear, in.uv).rgb;
  return vec4<f32>(max(light, vec3<f32>(0.0)), 1.0);
}
