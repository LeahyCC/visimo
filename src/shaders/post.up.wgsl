// One step up the bloom chain: the level below, at half the size, read through
// a 3 by 3 tent and added into this one by the blend (see PostStack.ts for the
// constant that says how much of what is already there is kept). The nine taps
// are bilinear, spaced one of the source's texels apart, and the weights are the
// tent's 1 2 1 / 2 4 2 / 1 2 1 over 16, so they sum to 1: a level's light goes up
// unchanged and only spreads. A tent rather than a box because a box's edges
// show as blocks once a wide level is stretched over the frame.
//
// Nothing here reads binding 0; see post.down.wgsl.

@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;

const MIDDLE: f32 = 0.25;
const SIDE: f32 = 0.125;
const EDGE: f32 = 0.0625;

@fragment
fn fs(in: Blit) -> @location(0) vec4<f32> {
  let t = 1.0 / vec2<f32>(textureDimensions(source));
  let middle = textureSample(source, samp, in.uv).rgb;
  let side = textureSample(source, samp, in.uv + t * vec2<f32>(-1.0, 0.0)).rgb +
             textureSample(source, samp, in.uv + t * vec2<f32>(1.0, 0.0)).rgb +
             textureSample(source, samp, in.uv + t * vec2<f32>(0.0, -1.0)).rgb +
             textureSample(source, samp, in.uv + t * vec2<f32>(0.0, 1.0)).rgb;
  let edge = textureSample(source, samp, in.uv + t * vec2<f32>(-1.0, -1.0)).rgb +
             textureSample(source, samp, in.uv + t * vec2<f32>(1.0, -1.0)).rgb +
             textureSample(source, samp, in.uv + t * vec2<f32>(-1.0, 1.0)).rgb +
             textureSample(source, samp, in.uv + t * vec2<f32>(1.0, 1.0)).rgb;
  return vec4<f32>(middle * MIDDLE + side * SIDE + edge * EDGE, 1.0);
}
