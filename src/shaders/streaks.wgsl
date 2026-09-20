// Thin lines converging on the middle of the canvas, added into the scene's
// target before the feedback pass adds the history, so what is drawn here is
// fresh light that the trails then carry and smear.
//
// One instanced quad a streak, six vertices each, so the width is a real
// number of pixels on any canvas: a line list is one pixel wide on every GPU
// and would vanish on a 4K one. streaks.params.ts has already worked out where
// each streak is, in pixels from the middle of the canvas along a unit
// direction, and what colour and light it has, so this shader does no
// placement of its own. The light already carries the intensity and the
// streak's fade, and the blend constant carries the study's presence.

struct Params {
  // The canvas in pixels.
  size: vec2<f32>,
  // The line's width in pixels.
  width: f32,
  pad: f32,
}

struct Streak {
  // Unit direction x and y, then the distance of the streak's inner end (the
  // head, nearest the middle) and its outer end (the tail), in pixels.
  line: vec4<f32>,
  // Light, already scaled, in rgb. The fourth float is padding.
  light: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> streaks: array<Streak>;

struct Quad {
  @builtin(position) position: vec4<f32>,
  // Signed pixels from the middle of the line across it, so the fragment can
  // fade the edge without knowing which vertex it came from.
  @location(0) across: f32,
  // Pixels from the head along the line. It runs one pixel either side of the
  // span, which is the room the ends fade into.
  @location(1) along: f32,
  @location(2) @interpolate(flat) span: f32,
  @location(3) @interpolate(flat) light: vec3<f32>,
}

@vertex
fn quad(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Quad {
  // x runs from the head (0) to the tail (1), y from one side to the other.
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  let streak = streaks[ii];
  let dir = streak.line.xy;
  let normal = vec2<f32>(-dir.y, dir.x);
  let corner = corners[vi];

  let head = streak.line.z;
  let tail = streak.line.w;
  // One pixel past each end and each side is the room the fragment fades into.
  let along = mix(head - 1.0, tail + 1.0, corner.x);
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
  out.along = along - head;
  out.span = tail - head;
  out.light = streak.light.rgb;
  return out;
}

@fragment
fn fs(in: Quad) -> @location(0) vec4<f32> {
  // Full inside the width, gone one pixel outside it, and half at the edge,
  // so the line has a soft side without growing wider than it was asked to.
  let side = clamp(params.width * 0.5 + 0.5 - abs(in.across), 0.0, 1.0);
  // The same for the two ends.
  let ends = clamp(in.along + 1.0, 0.0, 1.0) * clamp(in.span - in.along + 1.0, 0.0, 1.0);
  // Brightest at the head and thinning to the tail, so a streak reads as
  // moving in rather than as a rod.
  let taper = mix(1.0, 0.1, clamp(in.along / max(in.span, 1.0), 0.0, 1.0));
  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(in.light * (side * ends * taper), 1.0);
}
