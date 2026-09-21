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
// the light taken off the history, already scaled by the step, and the knee
// of the multiplicative floor beside it.
//
// post.hold and post.age are what a long memory needs and a short one never
// did: the mean brightness the canvas is held at, and what happens to light
// as it ages. Every one of them is exactly off at zero, so a cast that names
// none of them draws what it drew before any of this existed.

@group(0) @binding(0) var<uniform> post: PostParams;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var history: texture_2d<f32>;
@group(0) @binding(3) var flow: texture_2d<f32>;
// One texel holding the mean of the last frame, measured by post.reduce.wgsl.
// With the hold off it is a zeroed texel that nothing reads.
@group(0) @binding(4) var measured: texture_2d<f32>;

// How far off a pixel the unsharp reads, in texels. One texel either side is
// the finest cross there is, which is what a filament wants: a wider one puts
// a halo round a whole trail instead of an edge back into it.
const SHARPEN_REACH: f32 = 1.0;

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

// The multiplicative floor, which is the same job done without a cliff. The
// gate is peak / (peak + knee), raised to the step so it takes the same light
// out per second at any frame rate. Far above the knee it is 1 and the pixel
// decays as it always did; at the knee it is a half; under it the pixel
// collapses faster the dimmer it gets and is never clipped, so a trail ends
// rather than stopping. A knee of 0 is 1 everywhere, black pixel included.
fn faded(colour: vec3<f32>, knee: f32, frames: f32) -> vec3<f32> {
  if (knee <= 0.0) { return colour; }
  let peak = max(max(colour.r, max(colour.g, colour.b)), 0.0);
  return colour * pow(peak / (peak + knee), frames);
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

// The hue of what survives, turned about the grey axis. Rodrigues about
// (1,1,1) normalised, so a colour's distance from grey is untouched and only
// where it sits round the wheel moves. At an angle of 0 the sine is 0 and the
// cosine 1, so this is the identity to the last bit and a canvas that turns
// no hue is the canvas it was.
fn turned(colour: vec3<f32>, angle: f32) -> vec3<f32> {
  if (angle == 0.0) { return colour; }
  let axis = vec3<f32>(0.5773502692);
  let c = cos(angle);
  return colour * c + cross(axis, colour) * sin(angle) + axis * dot(axis, colour) * (1.0 - c);
}

// How much of the history this frame keeps, once the canvas hold has had its
// say. `canvasKeep` in post/params.ts is this arithmetic and says why it is
// this and not base x gain: the fresh frame's weight is normalised against
// the keep the CPU knows, so the gain has to be turned into the step that
// settles in the same place rather than simply multiplied in. At a gain of 1
// the second term is exactly zero and the keep is the one the pass always had.
fn keeping(base: f32, gain: f32) -> f32 {
  return clamp(base - (1.0 - base) * post.hold.y * (1.0 - gain), 0.0, 1.0);
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
  let spun = vec2<f32>(centred.x * c - centred.y * s, centred.x * s + centred.y * c) / zoom;
  let wanted = spun / aspect + vec2<f32>(0.5);
  let uv = clamp(wanted, vec2<f32>(0.0), vec2<f32>(1.0));
  // Off the edge of the last frame there is nothing to carry. Clamping alone
  // repeats the border pixel for as far as the warp reaches, which drew long
  // radial streaks round the rim whenever a zoom under 1 or the flow pulled
  // the picture inward.
  let off = max(abs(wanted - vec2<f32>(0.5)) - vec2<f32>(0.5), vec2<f32>(0.0));
  let inside = select(0.0, 1.0, off.x + off.y <= 0.0);
  var taken = textureSample(history, samp, uv).rgb;

  // The unsharp, on the history as it is read and before anything scales it,
  // so the four taps and the middle are all the same light. Every frame loses
  // a little detail to the sampler between the warp and the filter, and over a
  // second of memory that is the difference between filaments and mush. The
  // result is floored at zero: the overshoot on the dark side of an edge is
  // the same size as the boost on the bright side, and light cannot go
  // negative. A sharpen of 0 skips the four taps outright.
  let crisp = post.age.z;
  if (crisp > 0.0) {
    let reach = post.texel * SHARPEN_REACH;
    var around = textureSample(history, samp, clamp(uv + vec2<f32>(reach.x, 0.0), vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
    around += textureSample(history, samp, clamp(uv - vec2<f32>(reach.x, 0.0), vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
    around += textureSample(history, samp, clamp(uv + vec2<f32>(0.0, reach.y), vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
    around += textureSample(history, samp, clamp(uv - vec2<f32>(0.0, reach.y), vec2<f32>(0.0), vec2<f32>(1.0))).rgb;
    taken = max(taken + (taken - around * 0.25) * crisp, vec3<f32>(0.0));
  }

  // The canvas hold. The mean of the last frame is one texel the ladder in
  // post.reduce.wgsl left; over the hold, what survives is scaled by their
  // ratio, and under it nothing happens at all. It only ever takes light out,
  // so an empty canvas stays empty and silence is exact black.
  let mean = dot(textureSample(measured, samp, vec2<f32>(0.5)).rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  // `pinned` and not `target`, which WGSL reserves and only the browser says
  // so; `post.common.wgsl` is compiled on the adapter and nowhere else.
  let pinned = post.hold.z;
  var gain = 1.0;
  if (pinned > 0.0 && mean > pinned) {
    gain = clamp(pinned / max(mean, 1e-5), post.hold.w, 1.0);
  }

  // The decay, per channel. `cool` holds one of the outer channels back and
  // leaves green where it is, so what is left of a trail drifts blue as it
  // ages, or red the other way; at 0 both powers are of 1 and the three
  // channels decay together exactly as they always did.
  let keep = keeping(post.feedback.x * post.feedback.y, gain);
  let cool = post.age.y;
  let parted = vec3<f32>(1.0 - max(cool, 0.0), 1.0, 1.0 - max(-cool, 0.0));
  let old = taken * keep * pow(parted, vec3<f32>(post.hold.x)) * inside;
  // Floor first, then the fade, then the ceiling: the first two hold the
  // bottom of the trail and the last its top, and none of them can undo
  // another. The hue turns last, on what is actually carried back.
  let left = held(faded(lowered(old, post.floor.x), post.floor.y, post.hold.x), post.flow.y);
  return vec4<f32>(max(turned(left, post.age.x), vec3<f32>(0.0)), 1.0);
}
