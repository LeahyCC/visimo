// The previous frame, dragged back along the scene's own flow, then zoomed
// and rotated a little about the middle, decayed, and added under the scene.
// The scene has already drawn into this pass's target, so the pass is
// additively blended rather than reading it back.
//
// The four numbers in post.feedback are what this one drawn frame does. The
// CPU has already converted them from "one frame at 60 frames a second" by the
// real step (feedbackStep in post/params.ts), so this shader never sees the
// frame rate and applies them as they come. amount and decay arrive as their
// own powers, and their product is the gain on the history.
//
// post.flow carries the rest: how far this frame's step moves the history
// along the flow, the ceiling on what may be carried back, and the canvas to
// grid scale. A scene that offers no field has a single zero texel bound and
// a carry of zero, so there is one pipeline here and no branch. post.floor is
// the light taken off the history, already scaled by the step.

@group(0) @binding(0) var<uniform> post: PostParams;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var history: texture_2d<f32>;
@group(0) @binding(3) var flow: texture_2d<f32>;

// Light taken off the carried history, so a constant a scene adds to every
// pixel cannot sum to a haze: under gain g and floor f a constant c settles
// at (c - f) / (1 - g) rather than c / (1 - g). It comes off the brightest
// channel and the other two are scaled by the same fraction, for the reason
// `held` gives. Being subtractive it takes faint light out sooner than
// bright, which is what keeps the blacks black.
fn lowered(colour: vec3<f32>, cut: f32) -> vec3<f32> {
  let peak = max(max(colour.r, max(colour.g, colour.b)), 0.0);
  let left = max(peak - cut, 0.0);
  return colour * (left / max(peak, 1e-5));
}

// A soft limit that keeps the colour. Below half the ceiling nothing changes;
// above it the brightest channel bends toward the ceiling and never reaches
// it, and the other two are scaled by the same fraction. Limiting each on its
// own would pull the three together and bleach a long trail toward white,
// which is the reason the tonemap rolls the peak as well.
fn held(colour: vec3<f32>, ceiling: f32) -> vec3<f32> {
  let knee = max(ceiling, 1e-4) * 0.5;
  // Floored at zero as well as topped: a preset may drive a scene's intensity
  // negative, and a negative peak under the division would invert the trail.
  let peak = max(max(colour.r, max(colour.g, colour.b)), 0.0);
  let over = max(peak - knee, 0.0);
  let rolled = min(peak, knee) + knee * over / (over + knee);
  return colour * (rolled / max(peak, 1e-5));
}

@fragment
fn fs(in: Blit) -> @location(0) vec4<f32> {
  // The flow first, so the zoom and the turn below act on where the current
  // has already carried this pixel from.
  let cover = post.flow.zw;
  let grid = (in.uv - vec2<f32>(0.5)) * cover + vec2<f32>(0.5);
  // Velocity is in grid widths per second and this pass works in canvas uv,
  // so it is divided by the same cover that took the pixel into the grid.
  let velocity = textureSample(flow, samp, grid).xy / cover;
  let carried = in.uv - velocity * post.flow.x;

  let zoom = max(post.feedback.z, 0.001);
  let angle = post.feedback.w;
  // Work in square coordinates so a rotation does not shear a wide stage.
  let aspect = vec2<f32>(post.resolution.x / max(post.resolution.y, 1.0), 1.0);
  let centred = (carried - vec2<f32>(0.5)) * aspect;
  let s = sin(angle);
  let c = cos(angle);
  let turned = vec2<f32>(centred.x * c - centred.y * s, centred.x * s + centred.y * c) / zoom;
  let uv = clamp(turned / aspect + vec2<f32>(0.5), vec2<f32>(0.0), vec2<f32>(1.0));
  let old = textureSample(history, samp, uv).rgb * post.feedback.x * post.feedback.y;
  // Floor first, then ceiling: one holds the bottom of the trail and the
  // other the top, and neither can undo the other.
  return vec4<f32>(held(lowered(old, post.floor.x), post.flow.y), 1.0);
}
