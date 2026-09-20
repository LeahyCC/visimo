// Bars standing on a circle about the middle of the canvas, added into the
// scene's target before the feedback pass adds the history, so what is drawn
// here is fresh light that the trails then carry outward and smear into petals.
//
// One instanced quad a bar, six vertices each, so the width is a real number
// of pixels on any canvas: a line list is one pixel wide on every GPU and would
// vanish on a 4K one. spectrum.params.ts has already worked out where each bar
// is, in pixels from the middle of the canvas along a unit direction, and what
// colour and light it has, so this shader does no placement of its own. The
// light already carries the intensity and the bar's level, and the blend
// constant carries the study's presence.
//
// The fade across the sides and the ends and the taper along the bar are
// spectrum.params.ts's EDGE_PIXELS and TIP_LIGHT; keep them in step.

struct Params {
  // The canvas in pixels.
  size: vec2<f32>,
  // The bar's width in pixels.
  width: f32,
  pad: f32,
}

struct Bar {
  // Unit direction x and y, then the distance of the bar's foot (nearest the
  // middle) and its tip, in pixels.
  line: vec4<f32>,
  // Light, already scaled, in rgb. The fourth float is padding.
  light: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> bars: array<Bar>;

// How much of its light a bar has left at its tip.
const TIP_LIGHT: f32 = 0.45;

struct Quad {
  @builtin(position) position: vec4<f32>,
  // Signed pixels from the middle of the bar across it, so the fragment can
  // fade the edge without knowing which vertex it came from.
  @location(0) across: f32,
  // Pixels from the foot along the bar. It runs one pixel either side of the
  // span, which is the room the ends fade into.
  @location(1) along: f32,
  @location(2) @interpolate(flat) span: f32,
  @location(3) @interpolate(flat) light: vec3<f32>,
}

@vertex
fn quad(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Quad {
  // x runs from the foot (0) to the tip (1), y from one side to the other.
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  let bar = bars[ii];
  let dir = bar.line.xy;
  let normal = vec2<f32>(-dir.y, dir.x);
  let corner = corners[vi];

  let foot = bar.line.z;
  let tip = bar.line.w;
  // One pixel past each end and each side is the room the fragment fades into.
  let along = mix(foot - 1.0, tip + 1.0, corner.x);
  let reach = params.width * 0.5 + 1.0;
  let pixel = params.size * 0.5 + dir * along + normal * (corner.y * reach);

  var out: Quad;
  // Pixels from the top left to clip space, where y runs up.
  out.position = vec4<f32>(
    pixel.x / params.size.x * 2.0 - 1.0,
    1.0 - pixel.y / params.size.y * 2.0,
    0.0,
    1.0,
  );
  out.across = corner.y * reach;
  out.along = along - foot;
  out.span = tip - foot;
  out.light = bar.light.rgb;
  return out;
}

@fragment
fn fs(in: Quad) -> @location(0) vec4<f32> {
  // Full inside the width, gone one pixel outside it, and half at the edge,
  // so the bar has a soft side without growing wider than it was asked to.
  let side = clamp(params.width * 0.5 + 0.5 - abs(in.across), 0.0, 1.0);
  // The same for the two ends.
  let ends = clamp(in.along + 1.0, 0.0, 1.0) * clamp(in.span - in.along + 1.0, 0.0, 1.0);
  // Brightest at the foot and thinning to the tip, so a bar reads as standing
  // up out of the ring and the trails carry a tapered petal and not a rod.
  let taper = mix(1.0, TIP_LIGHT, clamp(in.along / max(in.span, 1.0), 0.0, 1.0));
  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(in.light * (side * ends * taper), 1.0);
}
