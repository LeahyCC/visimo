// Thin circles about the middle of the canvas, added into the scene's target
// before the feedback pass adds the history, so what is drawn here is fresh
// light that the trails then carry and smear.
//
// One instanced strip a ring: 257 corners round it, two a corner (the inner
// edge and the outer), so the width is a real number of pixels on any canvas
// and only the band of the ring is shaded, not the square round it. rings.params.ts
// has already worked out each ring's radius in pixels and its light, so this
// shader places nothing of its own. The light already carries the intensity and
// the ring's fade, and the blend constant carries the study's presence.
//
// The light across a ring is a transcription of `ringLight` in
// rings.params.ts, which says what it is and why; keep the two in step, the
// tests measure the TypeScript.

struct Params {
  // The canvas in pixels.
  size: vec2<f32>,
  // The ring's thickness (its width at half brightness) and its soft edge on
  // each side, in pixels.
  thickness: f32,
  edge: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
// Light in rgb, already scaled, and the radius in pixels in w.
@group(0) @binding(1) var<storage, read> rings: array<vec4<f32>>;

// Corners round a ring: rings.params.ts's RING_SEGMENTS.
const SEGMENTS: u32 = 256u;
const TAU: f32 = 6.283185307179586;

struct Strip {
  @builtin(position) position: vec4<f32>,
  // Signed pixels from the ring's middle line across it, so the fragment can
  // shape the edge without knowing which vertex it came from.
  @location(0) across: f32,
  @location(1) @interpolate(flat) light: vec3<f32>,
}

@vertex
fn strip(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Strip {
  let ring = rings[ii];
  let radius = ring.w;
  let reach = params.thickness * 0.5 + params.edge;
  // Even corners are the inner edge and odd ones the outer. The last corner
  // repeats the first, which is what closes the strip.
  let angle = f32(vi / 2u) * (TAU / f32(SEGMENTS));
  let side = f32(vi % 2u) * 2.0 - 1.0;
  // A ring smaller than its own reach has no inner edge to speak of: it stops
  // at the middle rather than crossing it.
  let edge_radius = max(radius + side * reach, 0.0);
  let pixel = params.size * 0.5 + vec2<f32>(cos(angle), sin(angle)) * edge_radius;

  var out: Strip;
  // Pixels from the top left to clip space, where y runs up.
  out.position = vec4<f32>(
    pixel.x / params.size.x * 2.0 - 1.0,
    1.0 - pixel.y / params.size.y * 2.0,
    0.0,
    1.0,
  );
  out.across = edge_radius - radius;
  out.light = ring.rgb;
  return out;
}

@fragment
fn fs(in: Strip) -> @location(0) vec4<f32> {
  let half_width = params.thickness * 0.5;
  // Full inside the thickness, a smoothstep across the soft edge and exactly
  // zero at the strip's own edge. A ring thinner than its edge starts falling
  // at the middle line, so its peak stays 1.
  let ramp_start = max(half_width - params.edge, 0.0);
  let ramp_end = half_width + params.edge;
  let light = 1.0 - smoothstep(ramp_start, ramp_end, abs(in.across));
  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(in.light * light, 1.0);
}
