// The last pass: chromatic aberration on the way in, the bloom chain's result
// added, then the grade, the tonemap, the grain and the dither. The gate weave
// moves where the picture is read from, so it comes before all of them. This is
// the only pass that writes the swap chain, so it is the only one that has to
// end inside 0 to 1.

@group(0) @binding(0) var<uniform> post: PostParams;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var source: texture_2d<f32>;
// Level 0 of the bloom chain after the upsample has added every wider level
// into it, each already scaled by what it is worth, so this is one read.
@group(0) @binding(3) var bloom: texture_2d<f32>;

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

  // Gate weave. The picture, the split and the glow are all read from `framed`,
  // which is the frame's own uv narrowed about the middle by the weave's reach
  // and then moved by the weave, so the frame drifts as one and the read never
  // leaves the texture: there is no clamped edge to streak. The vignette, the
  // split's centre and the grain stay on `in.uv`, because they belong to the
  // lens and the screen and not to the film. Both terms are 0 with the weave
  // off, so `framed` is `in.uv` exactly.
  let framed = in.uv - centred * post.weave.zw + post.weave.xy;
  var colour = vec3<f32>(
    textureSample(source, samp, clamp(framed - split, low, high)).r,
    textureSample(source, samp, framed).g,
    textureSample(source, samp, clamp(framed + split, low, high)).b,
  );

  // The glow is sampled whatever the bloom's state, so the branch stays out of
  // the shader; a disabled bloom writes zero for the intensity and the tint.
  // The tint leans the glow toward the key's colour and keeps the glow's own
  // brightest channel, so it changes what colour the halo is and never how
  // much light it carries: a full frame does not get brighter for having it.
  var glow = textureSample(bloom, samp, framed).rgb;
  let lit = max(glow.r, max(glow.g, glow.b));
  glow = mix(glow, post.glow.yzw * lit, post.glow.x);
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

  // The dither, always on and not the grain: interleaved gradient noise held to
  // half a code value either way, so a black pixel stays black (anything under
  // half a step rounds back to 0 and the floor below clips the rest) while the
  // steps in a slow ramp, which is all a wide glow is, stop lining up into
  // contours. `ditherOffset` in post/dither.ts is this shape, stated so it can
  // be tested. The clock shifts the pattern by a golden-ratio step each
  // sixtieth of a second so a still picture is dithered differently every frame.
  let gradient = fract(52.9829189 * fract(dot(in.position.xy, vec2<f32>(0.06711056, 0.00583715))));
  let noise = fract(gradient + 0.6180339887 * post.grain.y * 60.0);
  colour += vec3<f32>((noise - 0.5) / 255.0);
  return vec4<f32>(max(colour, vec3<f32>(0.0)), 1.0);
}
