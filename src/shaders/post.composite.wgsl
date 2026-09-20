// The last pass: chromatic aberration on the way in, the three blurred bloom
// levels added, then the grade, the tonemap and the grain. This is the only
// pass that writes the swap chain, so it is the only one that has to end
// inside 0 to 1.

@group(0) @binding(0) var<uniform> post: PostParams;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
@group(0) @binding(3) var bloom0: texture_2d<f32>;
@group(0) @binding(4) var bloom1: texture_2d<f32>;
@group(0) @binding(5) var bloom2: texture_2d<f32>;

// Enough hash for grain: a different value per pixel, and a different one
// again each frame from the clock.
fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fs(in: Blit) -> @location(0) vec4<f32> {
  // The split grows with the distance from the middle, so the centre stays
  // sharp and the corners come apart on a beat.
  let centred = in.uv - vec2<f32>(0.5);
  let split = centred * post.chroma.x;
  let low = vec2<f32>(0.0);
  let high = vec2<f32>(1.0);
  var colour = vec3<f32>(
    textureSample(source, samp, clamp(in.uv - split, low, high)).r,
    textureSample(source, samp, in.uv).g,
    textureSample(source, samp, clamp(in.uv + split, low, high)).b,
  );

  // The levels are sampled whatever their weights, so the branch stays out of
  // the shader; a disabled bloom writes zero weights.
  var glow = textureSample(bloom0, samp, in.uv).rgb * post.weights.x;
  glow += textureSample(bloom1, samp, in.uv).rgb * post.weights.y;
  glow += textureSample(bloom2, samp, in.uv).rgb * post.weights.z;
  colour += glow * post.bloom.z;

  // The grade sits after the bloom, so the glow closes in with the frame, and
  // before the tonemap, so the tonemap still bends whatever the vignette
  // leaves over 1. The clear zone reaches the corner at a vignette of 0 and
  // the middle at 1; `vignetteLight` in post/params.ts is this shape, stated
  // so it can be tested. Distance is 1 at a corner. Neutral numbers make this
  // an exact copy: the smoothstep is 0 out to the corner and the mix takes
  // all of the colour.
  let across = length(centred) * 1.4142136;
  let inner = 1.0 - post.grade.x;
  colour *= 1.0 - smoothstep(inner, inner + post.grade.z, across);
  // Scaled about the pixel's own luminance and not clamped: a channel that
  // goes down goes down with the others, so the hue is thinned, not bent. It
  // cannot go below zero because the saturation is held to 0 to 1.
  let luma = dot(colour, vec3<f32>(0.2126, 0.7152, 0.0722));
  colour = mix(vec3<f32>(luma), colour, post.grade.y);

  // A shoulder rather than a curve over the whole range: under it nothing
  // changes, so the field keeps the brightness PR #56 tuned it to, and above
  // it a value bends toward 1 without ever reaching it, so nothing clips.
  //
  // Two ways to bend it, and the useful answer is both. Rolling the brightest
  // channel and letting the other two follow keeps the colour, which is right
  // for a merely bright pixel. Rolling each channel on its own bleaches toward
  // white, which is what a core that is far over the shoulder should do. The
  // mix runs from the first to the second across the first stop above the
  // shoulder, so the field keeps its colour and only true cores go white-hot.
  colour *= post.tone.x;
  let shoulder = post.tone.y;
  let headroom = max(1.0 - shoulder, 0.0001);
  let peak = max(colour.r, max(colour.g, colour.b));
  let over = max(peak - shoulder, 0.0);
  let rolled = min(peak, shoulder) + headroom * over / (over + headroom);
  let tinted = colour * rolled / max(peak, 0.0001);
  let each = max(colour - vec3<f32>(shoulder), vec3<f32>(0.0));
  let bleached = min(colour, vec3<f32>(shoulder)) + headroom * each / (each + headroom);
  let mapped = mix(tinted, bleached, clamp(over / headroom, 0.0, 1.0));
  colour = mix(colour, mapped, post.tone.z);

  colour += (hash(in.position.xy + vec2<f32>(post.grain.y * 137.0)) - 0.5) * post.grain.x;
  return vec4<f32>(max(colour, vec3<f32>(0.0)), 1.0);
}
