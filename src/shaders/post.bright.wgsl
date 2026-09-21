// Bright pass and the first downsample in one: what is left of the frame above
// the bloom threshold, at half resolution, through the same 13 taps the rest of
// the chain uses (see post.down.wgsl for the shape). The threshold is applied to
// each tap before they are averaged, not to the average, so a thin bright mark
// is kept at its own brightness instead of being cut down with the dark pixels
// around it. The knee is a soft ramp either side of the threshold, so a note
// rising into bloom fades in instead of snapping on.

@group(0) @binding(0) var<uniform> post: PostParams;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;

const CENTRE: f32 = 0.125;
const CORNER: f32 = 0.03125;

// What survives the threshold. It only ever scales a colour down: the ratio is
// held to 0 to 1, and black is black at any threshold.
fn bright(colour: vec3<f32>) -> vec3<f32> {
  let luma = dot(colour, vec3<f32>(0.2126, 0.7152, 0.0722));
  let threshold = post.bloom.x;
  let knee = post.bloom.y;
  let soft = clamp(luma - threshold + knee, 0.0, 2.0 * knee);
  let curve = soft * soft / (4.0 * knee);
  let keep = max(curve, luma - threshold) / max(luma, 0.0001);
  return colour * clamp(keep, 0.0, 1.0);
}

fn tap(uv: vec2<f32>) -> vec3<f32> {
  return bright(textureSample(source, samp, uv).rgb);
}

@fragment
fn fs(in: Blit) -> @location(0) vec4<f32> {
  let t = 1.0 / vec2<f32>(textureDimensions(source));
  let a = tap(in.uv + t * vec2<f32>(-2.0, -2.0));
  let b = tap(in.uv + t * vec2<f32>(0.0, -2.0));
  let c = tap(in.uv + t * vec2<f32>(2.0, -2.0));
  let d = tap(in.uv + t * vec2<f32>(-1.0, -1.0));
  let e = tap(in.uv + t * vec2<f32>(1.0, -1.0));
  let f = tap(in.uv + t * vec2<f32>(-2.0, 0.0));
  let g = tap(in.uv);
  let h = tap(in.uv + t * vec2<f32>(2.0, 0.0));
  let i = tap(in.uv + t * vec2<f32>(-1.0, 1.0));
  let j = tap(in.uv + t * vec2<f32>(1.0, 1.0));
  let k = tap(in.uv + t * vec2<f32>(-2.0, 2.0));
  let l = tap(in.uv + t * vec2<f32>(0.0, 2.0));
  let m = tap(in.uv + t * vec2<f32>(2.0, 2.0));
  let sum = (d + e + i + j) * CENTRE +
            (a + b + f + g) * CORNER +
            (b + c + g + h) * CORNER +
            (f + g + k + l) * CORNER +
            (g + h + l + m) * CORNER;
  return vec4<f32>(sum, 1.0);
}
