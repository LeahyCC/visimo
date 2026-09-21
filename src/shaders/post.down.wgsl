// One step down the bloom chain: the level above at half the size, through the
// 13-tap dual filter from the "Next generation post processing in Call of Duty:
// Advanced Warfare" talk. Thirteen bilinear taps on a grid two source texels
// wide, weighted as five overlapping boxes: the middle one counts for half and
// the four corner ones for an eighth each. The weights sum to 1, so a level
// holds the same light as the one above it, and the footprint is wide enough
// that a texel is never skipped, which is what a plain bilinear halving does
// and what makes a small bright mark shimmer as it moves.
//
// The step is the source's own texel, read from the texture, so one pipeline
// serves every level. Nothing here reads binding 0: the group's layout is named
// in PostStack.ts and shared with the bright and up passes.

@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;

const CENTRE: f32 = 0.125;
const CORNER: f32 = 0.03125;

@fragment
fn fs(in: Blit) -> @location(0) vec4<f32> {
  let t = 1.0 / vec2<f32>(textureDimensions(source));
  let a = textureSample(source, samp, in.uv + t * vec2<f32>(-2.0, -2.0)).rgb;
  let b = textureSample(source, samp, in.uv + t * vec2<f32>(0.0, -2.0)).rgb;
  let c = textureSample(source, samp, in.uv + t * vec2<f32>(2.0, -2.0)).rgb;
  let d = textureSample(source, samp, in.uv + t * vec2<f32>(-1.0, -1.0)).rgb;
  let e = textureSample(source, samp, in.uv + t * vec2<f32>(1.0, -1.0)).rgb;
  let f = textureSample(source, samp, in.uv + t * vec2<f32>(-2.0, 0.0)).rgb;
  let g = textureSample(source, samp, in.uv).rgb;
  let h = textureSample(source, samp, in.uv + t * vec2<f32>(2.0, 0.0)).rgb;
  let i = textureSample(source, samp, in.uv + t * vec2<f32>(-1.0, 1.0)).rgb;
  let j = textureSample(source, samp, in.uv + t * vec2<f32>(1.0, 1.0)).rgb;
  let k = textureSample(source, samp, in.uv + t * vec2<f32>(-2.0, 2.0)).rgb;
  let l = textureSample(source, samp, in.uv + t * vec2<f32>(0.0, 2.0)).rgb;
  let m = textureSample(source, samp, in.uv + t * vec2<f32>(2.0, 2.0)).rgb;
  let sum = (d + e + i + j) * CENTRE +
            (a + b + f + g) * CORNER +
            (b + c + g + h) * CORNER +
            (f + g + k + l) * CORNER +
            (g + h + l + m) * CORNER;
  return vec4<f32>(sum, 1.0);
}
