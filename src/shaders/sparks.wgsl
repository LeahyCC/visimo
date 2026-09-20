// Sparks: tiny bright points with a short streak along their own velocity,
// drawn as light added to the scene's target before the feedback pass, so what
// is drawn here is fresh light that the trails then carry along the flow. The
// sparks never read the flow themselves: a point drawn where it is now is
// already smeared along the current once the canvas has kept it a few frames.
//
// One instance a spark and six vertices an instance, so the width is a real
// number of pixels on any canvas. impls/sparks.params.ts has already worked out
// where each spark is, which way it is going, how long its streak is and what
// colour and light it has, so this shader does no placement of its own: it
// stretches a quad along the direction it is handed and shapes the light across
// it. The light already carries the intensity, the spark's fade and its cooling
// from white toward the palette, and the blend constant carries the study's
// presence (INK_BLEND in scenes/Impl.ts).

// xy is the canvas in pixels; the other two are padding, since a uniform
// binding is a whole number of vec4s.
@group(0) @binding(0) var<uniform> canvas: vec4<f32>;

struct Spark {
  // The middle of the quad in pixels from the top left, then the unit direction
  // the spark is travelling in, on the same screen where y runs down.
  @location(0) place: vec4<f32>,
  // Half the quad's length along the direction and half its width across it,
  // in pixels.
  @location(1) reach: vec2<f32>,
  // The colour with the light already in it.
  @location(2) glow: vec3<f32>,
}

struct Quad {
  @builtin(position) position: vec4<f32>,
  // From -1 to 1 along the streak, the tail at -1 and the front at 1, and from
  // -1 to 1 across it, so the fragment needs to know nothing else about the
  // spark's size.
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) colour: vec3<f32>,
}

// Where along the quad the bright head sits. HEAD_AT in impls/sparks.params.ts
// is the same number, and puts the spark's own position here.
const HEAD_AT: f32 = 0.55;

@vertex
fn vs(@builtin(vertex_index) vi: u32, spark: Spark) -> Quad {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  let corner = corners[vi];
  let along = spark.place.zw;
  let across = vec2<f32>(-along.y, along.x);
  let pixel = spark.place.xy + along * (corner.x * spark.reach.x) + across * (corner.y * spark.reach.y);

  var out: Quad;
  // Pixels from the top left to clip space, where y runs up.
  out.position = vec4<f32>(
    pixel.x / canvas.x * 2.0 - 1.0,
    1.0 - pixel.y / canvas.y * 2.0,
    0.0,
    1.0,
  );
  out.local = corner;
  out.colour = spark.glow;
  return out;
}

@fragment
fn fs(in: Quad) -> @location(0) vec4<f32> {
  // Soft across, so a spark a couple of pixels wide is a point and not a line
  // of hard pixels, and nothing at either side of the quad.
  let side = 1.0 - in.local.y * in.local.y;
  // Rising from nothing at the tail to the head, and falling again to the
  // front so the end is round and no square shows. Both are zero at the ends
  // of the quad and one at the head.
  let tail = smoothstep(-1.0, HEAD_AT, in.local.x);
  let front = 1.0 - smoothstep(HEAD_AT, 1.0, in.local.x);
  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(in.colour * (side * side * tail * front), 1.0);
}
