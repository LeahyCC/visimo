// One rung of the ladder that measures how bright the canvas is. Each pass
// writes a target a quarter the width and height of its source, and each of
// its pixels is the plain mean of the sixteen source texels under it: four
// bilinear taps, each landing exactly between four texels, so the hardware
// does the inner 2 by 2 averages for nothing. Run from the last frame down to
// a single texel, the result is the mean of the whole frame.
//
// It exists because the feedback pass needs to know how much light has piled
// up before it decides how much of it to keep, and that number can never come
// back to the CPU: a read back would stall the frame. So it stays on the GPU,
// one texel wide, and the feedback pass samples it.
//
// No uniform: the source's own size is all it needs, and reading it here
// rather than from the stack means one pipeline covers every rung.

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var source: texture_2d<f32>;

@fragment
fn fs(in: Blit) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(source, 0));
  var sum = textureSample(source, samp, in.uv + vec2<f32>(-1.0, -1.0) * texel).rgb;
  sum += textureSample(source, samp, in.uv + vec2<f32>(1.0, -1.0) * texel).rgb;
  sum += textureSample(source, samp, in.uv + vec2<f32>(-1.0, 1.0) * texel).rgb;
  sum += textureSample(source, samp, in.uv + vec2<f32>(1.0, 1.0) * texel).rgb;
  return vec4<f32>(sum * 0.25, 1.0);
}
