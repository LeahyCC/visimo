// Branching bolts fired on the drop's hits, added into the scene's target
// before the feedback pass, so what is drawn here is fresh light that the
// trails then carry as the afterglow. The bolt itself is gone in about a
// tenth of a second.
//
// One instance a segment and six corners an instance: the two ends of the
// segment arrive from lightning.params.ts already built, in frame heights
// from the middle with y up, and this widens each into a quad a real number
// of pixels across, on any canvas. Only the band of the line is shaded. The
// light in w is the ink's intensity times the strike's fade and flicker,
// worked out on the CPU as a function of the strike's age, and the blend
// constant carries the study's presence, so nothing here knows either.
//
// The light across the line is a transcription of `boltLight` in
// lightning.params.ts, which says what it is and why; keep the two in step,
// the tests measure the TypeScript. What that sum is made of differs a
// little: here the body carries the segment's colour and the core adds
// white, so the two read independently on screen.

struct View {
  // The canvas width over its height, and its height in pixels.
  aspect: f32,
  height: f32,
  // The line's width at half brightness, in pixels.
  width: f32,
  // The soft edge on each side, in pixels.
  edge: f32,
  // How much the hot core of the line lifts over its body. The binding is
  // padded to two vec4s, which is what LIGHTNING_UNIFORM_FLOATS allocates.
  core: f32,
}

@group(0) @binding(0) var<uniform> view: View;
// Two vec4s a segment: the two ends in xy, then the colour, then the light.
@group(0) @binding(1) var<storage, read> segments: array<vec4<f32>>;

struct Quad {
  @builtin(position) position: vec4<f32>,
  // Signed pixels from the segment's middle line across it, so the fragment
  // can shape the edge without knowing which corner it came from.
  @location(0) across: f32,
  @location(1) @interpolate(flat) colour: vec3<f32>,
  @location(2) @interpolate(flat) light: f32,
}

// The six corners of a segment's quad as (which end, which side): two
// triangles, (p1 low, p1 high, p2 low) and (p1 high, p2 high, p2 low).
var<private> corners = array<vec2<f32>, 6>(
  vec2<f32>(0.0, -1.0),
  vec2<f32>(0.0, 1.0),
  vec2<f32>(1.0, -1.0),
  vec2<f32>(0.0, 1.0),
  vec2<f32>(1.0, 1.0),
  vec2<f32>(1.0, -1.0),
);

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Quad {
  let ends = segments[ii * 2u];
  let tint = segments[ii * 2u + 1u];
  let p1 = ends.xy;
  let p2 = ends.zw;
  let along = p2 - p1;
  let length = max(length(along), 0.000001);
  let perp = vec2<f32>(-along.y, along.x) / length;
  let corner = corners[vi];
  let side = corner.y;
  // The quad reaches as far as the light does, and no further. The segment's
  // ends are in frame heights and the widths are in pixels, so the offset is
  // scaled by the canvas height; the across distance crosses to the fragment
  // still in pixels, which is the unit the light profile works in.
  let reach_px = view.width * 0.5 + view.edge;
  let place = mix(p1, p2, corner.x) + perp * side * reach_px / view.height;
  var out: Quad;
  out.position = vec4<f32>(place.x * 2.0 / view.aspect, place.y * 2.0, 0.0, 1.0);
  out.across = side * reach_px;
  out.colour = tint.rgb;
  out.light = tint.w;
  return out;
}

@fragment
fn fs(in: Quad) -> @location(0) vec4<f32> {
  let half_width = view.width * 0.5;
  // The body: full inside the width, a smoothstep across the soft edge and
  // exactly zero at the quad's own edge, so the frame around the bolt stays
  // true black. A line thinner than its edge starts falling at the middle
  // line, so its peak stays 1.
  let ramp_start = max(half_width - view.edge, 0.0);
  let ramp_end = half_width + view.edge;
  let body = 1.0 - smoothstep(ramp_start, ramp_end, abs(in.across));
  // The hot core: the same profile at a narrower width, lifted by `core` and
  // white whatever the body carries, which is what makes the middle of the
  // line read white hot the way a real strike does.
  let core_half = half_width * 0.45;
  let core = 1.0 - smoothstep(max(core_half - view.edge, 0.0), core_half + view.edge, abs(in.across));
  // The body carries the bolt's colour, the core adds white on top, and the
  // light the strike's own age worked out. Additive, and the blend leaves
  // alpha alone, so this is light and nothing else.
  let glow = in.colour * body + vec3<f32>(1.0) * (view.core * core);
  return vec4<f32>(glow * in.light, 1.0);
}
