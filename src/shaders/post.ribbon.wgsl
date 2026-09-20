// The sound drawn as a line, added into the scene's target before the feedback
// pass adds the history, so what is drawn here is fresh light that the trails
// then carry and smear.
//
// One triangle strip, two vertices a point, one on each side of the line, so
// the width is a real number of pixels on any canvas: a line list is one pixel
// wide on every GPU. The points are a storage buffer sized once, and their
// count is however long that buffer is, so nothing here names 256. The strip
// has one point more than the buffer holds, which is how the circle closes;
// the line repeats its last point there and draws a segment of no length.
//
// Everything in post.ribbon is already in pixels (writePostUniform in
// post/params.ts), so this shader does no scaling of its own. Ends and corners
// are not mitred: at a few hundred points the turn between two of them is a
// hair, and a mitre would only add a join to get wrong at a sharp peak.

@group(0) @binding(0) var<uniform> post: PostParams;
@group(0) @binding(1) var<storage, read> wave: array<f32>;

struct Strip {
  @builtin(position) position: vec4<f32>,
  // Signed pixels from the middle of the line across it, so the fragment can
  // fade the edge without knowing which vertex it came from.
  @location(0) across: f32,
}

// Where point `k` sits, in pixels from the top left. `k` may run one past
// either end, which the direction below needs: the line holds at its ends and
// the circle wraps.
fn place(k: i32, count: i32) -> vec2<f32> {
  let circle = post.ribbon.w > 0.5;
  let held = clamp(k, 0, count - 1);
  let wrapped = ((k % count) + count) % count;
  let i = select(held, wrapped, circle);
  let level = clamp(wave[i], -1.0, 1.0);
  let size = post.resolution;

  // The line runs the width of the canvas, level 0 at the middle and a
  // positive sample up the screen, which is the way a waveform reads.
  let along = f32(i) / max(f32(count - 1), 1.0);
  let onLine = vec2<f32>(along * size.x, size.y * 0.5 - level * post.ribbon.z);

  // The circle starts at the top and runs clockwise. The waveform is not
  // periodic in its window, so its two ends disagree and the circle would
  // carry a step where they meet. The step is shared out along the whole
  // round instead, a slow tilt under the level, which leaves the shape of
  // the sound alone and joins the ends.
  let turn = f32(i) / f32(count);
  let ends = clamp(wave[count - 1], -1.0, 1.0) - clamp(wave[0], -1.0, 1.0);
  let radius = post.ribbonTint.w + (level - ends * turn) * post.ribbon.z;
  let angle = turn * 6.283185307 - 1.570796327;
  let onCircle = size * 0.5 + radius * vec2<f32>(cos(angle), sin(angle));

  return select(onLine, onCircle, circle);
}

@vertex
fn strip(@builtin(vertex_index) vi: u32) -> Strip {
  let count = i32(arrayLength(&wave));
  let k = i32(vi / 2u);
  let side = select(-1.0, 1.0, (vi & 1u) == 1u);

  // The direction of the line here, from the points either side, so the two
  // vertices of a pair sit square to it. A run of no length has no direction
  // and normalising it would be NaN, so the length is floored.
  let run = place(k + 1, count) - place(k - 1, count);
  let dir = run / max(length(run), 1e-4);
  let normal = vec2<f32>(-dir.y, dir.x);

  // One pixel past the edge is the room the fragment fades into.
  let reach = post.ribbon.y * 0.5 + 1.0;
  let pixel = place(k, count) + normal * (side * reach);
  let size = post.resolution;

  var out: Strip;
  // Pixels from the top left to clip space, where y runs up.
  out.position = vec4<f32>(pixel.x / size.x * 2.0 - 1.0, 1.0 - pixel.y / size.y * 2.0, 0.0, 1.0);
  out.across = side * reach;
  return out;
}

@fragment
fn fs(in: Strip) -> @location(0) vec4<f32> {
  // Full inside the width, gone one pixel outside it, and half at the edge,
  // so the line has a soft side without growing wider than it was asked to.
  let cover = clamp(post.ribbon.y * 0.5 + 0.5 - abs(in.across), 0.0, 1.0);
  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(post.ribbonTint.rgb * (post.ribbon.x * cover), 1.0);
}
