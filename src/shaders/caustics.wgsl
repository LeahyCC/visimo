// The bright network of lines a rippled surface throws on a pool floor, added
// into the scene's target before the feedback pass adds the history, so what is
// drawn here is fresh light that the trails then carry and smear.
//
// One fullscreen triangle. The pattern is a transcription of `causticLine` in
// caustics.params.ts, which says what it is and why; keep the two in step, the
// tests measure the TypeScript. The determinant of the map from where a ray
// left the surface to where it lands is a closed form of four sines, and light
// piles up where it is zero. Brightness is a bump round zero, exactly 0 beyond
// the band, raised to a power: the lines carry all of the light and everything
// between them is black. That is the point of it. A dim haze here is what a
// canvas that keeps 93 percent of itself sums into a flat sheet.
//
// The CPU has already put the intensity into the three colours, worked out
// every wave's offset in doubles and wrapped it to a cycle, and multiplied the
// scale into each wave's frequency, so this does no placement of its own and
// the presence is the blend constant.

struct Params {
  // The canvas in pixels, then the sharpness. The fourth float is padding.
  screen: vec4<f32>,
  // Each wave's offset in cycles, wrapped to 0 up to 1.
  phase: vec4<f32>,
  // The colour gradient in cycles across x and across y of a short side, then
  // its phase. The fourth float is padding.
  tint: vec4<f32>,
  // The band in units of the determinant, the least width of a line in
  // pixels, and the cut that takes the faint shoulder off a line.
  shape: vec4<f32>,
  // Per wave: unit direction, cycles across the short side, focus.
  waves: array<vec4<f32>, 4>,
  // Light in rgb, already scaled by the intensity: one end of the colour
  // gradient, the middle and the other end. The fourth float is padding.
  low: vec4<f32>,
  mid: vec4<f32>,
  high: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;

const TAU = 6.28318530718;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  // Short sides from the middle of the canvas, y down, so the pattern is the
  // same shape on a wide canvas and a tall one and scales about the middle.
  let short = min(params.screen.x, params.screen.y);
  let at = (frag.xy - 0.5 * params.screen.xy) / short;

  // A local copy, so the loop below indexes an array and not a uniform vector.
  var offsets = array<f32, 4>(params.phase.x, params.phase.y, params.phase.z, params.phase.w);
  // Each wave's weighted sine and its slope across x and y, per short side.
  var g: array<f32, 4>;
  var dx: array<f32, 4>;
  var dy: array<f32, 4>;
  var det = 1.0;
  var ddx = 0.0;
  var ddy = 0.0;
  for (var i = 0u; i < 4u; i = i + 1u) {
    let wave = params.waves[i];
    let angle = TAU * (wave.z * dot(wave.xy, at) + offsets[i]);
    let weighted = wave.w * sin(angle);
    let slope = wave.w * cos(angle) * TAU * wave.z;
    g[i] = weighted;
    dx[i] = slope * wave.x;
    dy[i] = slope * wave.y;
    det = det - weighted;
    ddx = ddx - dx[i];
    ddy = ddy - dy[i];
  }

  // The pair terms: two waves at a right angle squeeze the plane the most and
  // two side by side not at all, which is the squared cross product of their
  // directions.
  for (var a = 0u; a < 4u; a = a + 1u) {
    for (var b = a + 1u; b < 4u; b = b + 1u) {
      let da = params.waves[a].xy;
      let db = params.waves[b].xy;
      let turn = da.x * db.y - da.y * db.x;
      let weight = turn * turn;
      det = det + g[a] * g[b] * weight;
      ddx = ddx + (dx[a] * g[b] + g[a] * dx[b]) * weight;
      ddy = ddy + (dy[a] * g[b] + g[a] * dy[b]) * weight;
    }
  }

  // The band is measured against the determinant's own slope, so a fold that
  // is thinner than a pixel is widened to the least width and dimmed by the
  // same ratio, and does not dash and crawl as it moves.
  let pixel = 1.0 / short;
  let band = max(params.shape.x, params.shape.y * pixel * length(vec2<f32>(ddx, ddy)));
  let ratio = det / band;
  let bump = max(1.0 - ratio * ratio, 0.0);
  // Exactly 0 outside the band, and not left to what pow makes of a base of 0.
  let raised = select(0.0, pow(bump, params.screen.z) * (params.shape.x / band), bump > 0.0);
  // The faint shoulder of a line is cut off and the rest stretched to fill 0 to
  // 1: the canvas sums a shoulder to fourteen times itself, a halo round the line.
  let line = max(raised - params.shape.z, 0.0) / (1.0 - params.shape.z);

  // Colour shifts slowly across the frame and drifts on the real clock: a
  // sine along a heading picks a point on the way from one end of the spread
  // to the other.
  let across = 0.5 + 0.5 * sin(TAU * (params.tint.x * at.x + params.tint.y * at.y + params.tint.z));
  let colour = mix(
    mix(params.low.rgb, params.mid.rgb, clamp(across * 2.0, 0.0, 1.0)),
    params.high.rgb,
    clamp(across * 2.0 - 1.0, 0.0, 1.0),
  );

  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(colour * line, 1.0);
}
