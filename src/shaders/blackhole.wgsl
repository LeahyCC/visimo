// The black hole: a thin burning ring on the rim of an empty middle, and an
// annulus around it that reads last frame's canvas through a radial
// displacement, so the picture outside appears to bend round the hole.
//
// One quad, six vertices, square in pixels and no bigger than the outer
// radius, so the picture is round on a wide canvas and a tall one and nothing
// is drawn that the falloffs have not already zeroed. Three bands of radius,
// and the ink returns exactly nothing outside the middle two:
//
//   0 ---- disc ==== ring ==== bend0 ------------- outer ---->
//   nothing   the burning ring   the bending annulus   nothing
//
// The middle is empty rather than black, because an ink can only add light.
// What makes it read as dark is that nothing draws there and the analytic
// flow's `lens` term carries away what lands. `blackhole.params.ts` is where
// the reasoning and the numbers live and is what the tests hold; every
// falloff below is a transcription of it.
//
// The annulus is a loop, so two things are load-bearing. The gain is worked
// out on the CPU as a share of what the canvas lets go of each frame, so it
// is two orders under 1 whatever the frame rate. And the displacement and the
// gain share one window, so wherever this reads anything it reads a radius
// strictly further out and no pixel can feed itself.

struct Params {
  // xy the canvas in pixels, z the outer radius in pixels, w padding.
  screen: vec4<f32>,
  // The disc, the ring, half the ring's width and where the annulus starts,
  // each as a fraction of the outer radius.
  shape: vec4<f32>,
  // x the ring's light, y how beamed it is, z where the beamed side points in
  // turns, w padding.
  ring: vec4<f32>,
  // x the annulus's gain, y how far it reaches out, z how far it tints, w padding.
  warp: vec4<f32>,
  // x the hot hue in turns, y the cooler one, zw padding.
  hue: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var canvas: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const TAU = 6.283185307179586;

struct Quad {
  @builtin(position) position: vec4<f32>,
  // From -1 to 1 across the quad, so 1 is the outer radius in every direction.
  @location(0) local: vec2<f32>,
}

@vertex
fn quad(@builtin(vertex_index) vi: u32) -> Quad {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  let corner = corners[vi];
  // Pixels from the top left: the middle of the canvas, an outer radius each way.
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

// A fully saturated colour at a place on the cosine wheel, the same function
// the lasers and the grid use. The study's two hues are its own rather than
// the shared palette's, for the reason the README's colour section gives.
fn vivid(turns: f32) -> vec3<f32> {
  let c = 0.5 + 0.5 * cos(TAU * (turns + vec3<f32>(0.0, 0.3333, 0.6667)));
  let sat = c * c;
  return sat / max(max(sat.r, sat.g), max(sat.b, 1e-4));
}

// `ringLight` in blackhole.params.ts: 1 at the middle of the ring and exactly
// 0 at and past half its width either side. The square pulls the light into a
// narrow core and leaves the shoulders to carry the colour.
fn ring_light(x: f32) -> f32 {
  let q = abs(x - params.shape.y) / max(params.shape.z, 1e-6);
  let t = clamp(1.0 - q, 0.0, 1.0);
  let smooth_t = t * t * (3.0 - 2.0 * t);
  return smooth_t * smooth_t;
}

// `bendWindow` in blackhole.params.ts: 1 where the annulus starts and 0 at the
// outer radius with no slope. The gain and the displacement are both this
// times a constant, which is what makes the read always come from further out.
fn bend_window(x: f32) -> f32 {
  let span = max(1.0 - params.shape.w, 1e-6);
  let u = clamp((1.0 - x) / span, 0.0, 1.0);
  return u * u * (3.0 - 2.0 * u);
}

@fragment
fn fs(in: Quad) -> @location(0) vec4<f32> {
  let x = length(in.local);
  // The empty middle and everything past the annulus. Two thirds of the quad's
  // corners land in the second of these, which is why the coverage is the
  // annulus and not the quad.
  if (x < params.shape.x || x > 1.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let core = vivid(params.hue.x);
  let cool = vivid(params.hue.y);

  // The ring. Its light is graded from the cooler hue at the edges through
  // the hot one to white at the very centre, so the core blows out and the
  // colour survives in the shoulders rather than the other way about.
  let along = ring_light(x);
  // Where this pixel stands round the ring, against where the beamed side
  // points. The approaching side is brighter, which is what every render of
  // one shows and what makes the ring read as turning.
  let angle = atan2(in.local.y, in.local.x);
  let side = 1.0 + params.ring.y * cos(angle - TAU * params.ring.z);
  let tint = mix(cool, mix(core, vec3<f32>(1.0), along * along), along);
  var light = tint * (params.ring.x * along * side);

  // The annulus. It reads a radius further out, so the picture outside
  // appears drawn in around the hole, and washes what it read toward the
  // cooler hue so the lensed halo sits against the ring rather than in it.
  let window = bend_window(x);
  if (params.warp.x > 0.0 && window > 0.0) {
    let unit = in.local / max(x, 1e-5);
    let source = x + params.warp.y * window;
    // The quad is square in pixels and the canvas is not, so the step back to
    // canvas uv is one outer radius in pixels over each side of the frame.
    let reach = params.screen.z / params.screen.xy;
    let uv = vec2<f32>(0.5, 0.5) + unit * source * reach;
    let picture = textureSampleLevel(
      canvas, samp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0,
    ).rgb;
    let grey = dot(picture, vec3<f32>(0.2126, 0.7152, 0.0722));
    let washed = mix(picture, cool * grey, params.warp.z);
    light += washed * (params.warp.x * window);
  }

  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(light, 1.0);
}
