// Small soft round points, added into the scene's target before the feedback
// pass adds the history, so what is drawn here is fresh light that the trails
// then carry along the flow. The dust never reads the flow itself: a speck that
// barely moves is already adrift once the canvas smears it.
//
// One instanced quad a speck, six vertices each, so the size is a real number
// of pixels on any canvas. dust.params.ts has already worked out where each
// speck is, in pixels from the top left of the canvas, how big it is, and what
// colour and light it has, so this shader does no placement of its own. The
// light already carries the intensity, the twinkle and the fade at the wrap,
// and the blend constant carries the study's presence.

struct Params {
  // The canvas in pixels.
  size: vec2<f32>,
  pad: vec2<f32>,
}

struct Speck {
  // The centre in pixels from the top left, then the radius in pixels, which
  // is where the falloff reaches nothing. The fourth float is padding.
  spot: vec4<f32>,
  // Light, already scaled, in rgb. The fourth float is padding.
  light: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> specks: array<Speck>;

struct Quad {
  @builtin(position) position: vec4<f32>,
  // From -1 to 1 across the quad, so 1 is the radius wherever the speck is and
  // however big, and the fragment needs to know nothing else about it.
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) light: vec3<f32>,
}

@vertex
fn quad(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Quad {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  let speck = specks[ii];
  let corner = corners[vi];
  let pixel = speck.spot.xy + corner * speck.spot.z;

  var out: Quad;
  // Pixels from the top left to clip space, where y runs up.
  out.position = vec4<f32>(
    pixel.x / params.size.x * 2.0 - 1.0,
    1.0 - pixel.y / params.size.y * 2.0,
    0.0,
    1.0,
  );
  out.local = corner;
  out.light = speck.light.rgb;
  return out;
}

@fragment
fn fs(in: Quad) -> @location(0) vec4<f32> {
  // One at the centre and nothing at the radius, flat where it leaves and
  // where it arrives, so there is no ring at the edge of the quad and no
  // visible square. The square of the square is what softens it.
  let inside = clamp(1.0 - dot(in.local, in.local), 0.0, 1.0);
  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(in.light * (inside * inside), 1.0);
}
