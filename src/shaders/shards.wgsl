// Shards: flat sharp triangles thrown outward from the middle, drawn as light
// added to the scene's target before the feedback pass, so what is drawn here
// is fresh light that the trails then carry and smear into streaks.
//
// One instance a shard and three vertices an instance, with nothing else: the
// place, the turn, the size and the light of each are worked out on the CPU
// by the pool in impls/shards.params.ts and arrive as one 32-byte row, which
// is what lets a shard's motion be a function of its age and not of how many
// frames it has been drawn for. There is no edge fade and no gradient, since a
// shard is meant to be hard, and the colour is the same at all three corners,
// so it is flat.
//
// Positions are in frame heights from the middle with y up, so a shard is the
// same shape on any canvas and only the last step, into clip space, knows the
// aspect. The presence is the blend constant the ink is drawn with
// (INK_BLEND in scenes/Impl.ts), so nothing here knows it.

// x is the canvas width over its height; the other three are padding, since a
// uniform binding is a whole number of vec4s.
@group(0) @binding(0) var<uniform> view: vec4<f32>;

struct Shard {
  // The middle of the triangle, in frame heights.
  @location(0) centre: vec2<f32>,
  // x is the way it points, in radians, and y its size: the distance from the
  // middle to the tip, in frame heights.
  @location(1) turn: vec2<f32>,
  // The colour at full strength, and in w how much of it there is: the ink's
  // intensity times the shard's fade, both worked out on the CPU.
  @location(2) light: vec4<f32>,
}

struct Out {
  @builtin(position) position: vec4<f32>,
  @location(0) colour: vec3<f32>,
}

// The triangle in units of its own size, tip along +x. Its corners sum to
// nothing on either axis, so the middle of the triangle is its origin and it
// tumbles about that. SHARD_CORNERS in impls/shards.params.ts holds the same
// three and a test keeps them together.
var<private> corners = array<vec2<f32>, 3>(
  vec2<f32>(1.0, 0.0),
  vec2<f32>(-0.5, 0.34),
  vec2<f32>(-0.5, -0.34),
);

@vertex
fn vs(@builtin(vertex_index) vi: u32, shard: Shard) -> Out {
  let along = vec2<f32>(cos(shard.turn.x), sin(shard.turn.x));
  let local = corners[vi] * shard.turn.y;
  let turned = vec2<f32>(local.x * along.x - local.y * along.y, local.x * along.y + local.y * along.x);
  let place = shard.centre + turned;

  var out: Out;
  // The frame is one unit tall and `aspect` wide, and clip space is two across
  // on both axes.
  out.position = vec4<f32>(place.x * 2.0 / view.x, place.y * 2.0, 0.0, 1.0);
  out.colour = shard.light.rgb * shard.light.w;
  return out;
}

@fragment
fn fs(in: Out) -> @location(0) vec4<f32> {
  return vec4<f32>(in.colour, 1.0);
}
