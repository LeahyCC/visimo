// The pool drawn: one instanced quad a particle, six vertices each, stretched
// along its own velocity so a fast particle reads as a short streak and a
// stopped one as a round point. Nothing is placed here that the simulation
// already decided; this turns short sides into pixels and reads the size, the
// light and the colour off the particle's own age.
//
// A dead slot collapses to a point at the middle of the canvas with no size at
// all, so its two triangles cover no pixel and cost nothing past the vertex
// work. That is what lets the pool be a budget: a field at a count of half a
// million with a tenth of it alive pays for the tenth.
//
// It is added through the shared ink blend, with the study's presence in the
// blend constant, so the field is light over whatever is already on the canvas
// and never covers it.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> pool: array<Particle>;

struct Quad {
  @builtin(position) position: vec4<f32>,
  // From -1 to 1 across the quad, x along the streak and y across it.
  @location(0) local: vec2<f32>,
  @location(1) @interpolate(flat) light: vec3<f32>,
  // How far the quad was stretched, so the fragment can taper a streak toward
  // its tail and leave a round point alone.
  @location(2) @interpolate(flat) stretch: f32,
}

/**
 * The palette run: the particle's hue coordinate walks from the stop below the
 * key, through the key, to the stop above it, which is the whole of the spread
 * without a palette texture. Then the colour over life, toward white by `heat`
 * at birth and by `pale` for ever.
 */
fn colourOf(hue: f32, spent: f32) -> vec3<f32> {
  let at = clamp(hue * 2.0, -1.0, 1.0);
  let palette = select(
    mix(params.mid.rgb, params.high.rgb, at),
    mix(params.mid.rgb, params.low.rgb, -at),
    at < 0.0,
  );
  let left = 1.0 - spent;
  let white = clamp(params.low.w * left * left + params.mid.w, 0.0, 1.0);
  return mix(palette, vec3<f32>(1.0, 1.0, 1.0), white);
}

/**
 * How far a particle is from the edge of a wrapping field, 1 well inside and 0
 * at the seam. A speck that leaves one side comes in at the other, and its
 * light is gone before it gets there and back after, so nothing pops.
 */
fn edgeFade(place: vec2<f32>) -> f32 {
  if (params.spawns.y < 0.5) { return 1.0; }
  let half = halfExtent(params);
  let margin = 0.06;
  let x = smoothstep(0.0, margin, half.x - abs(place.x));
  let y = smoothstep(0.0, margin, half.y - abs(place.y));
  return x * y;
}

@vertex
fn quad(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Quad {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
    vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
  );
  let corner = corners[vi];
  let particle = pool[ii];
  var out: Quad;
  out.local = corner;
  out.light = vec3<f32>(0.0, 0.0, 0.0);
  out.stretch = 0.0;
  if (particle.span.y <= 0.0) {
    // A dead slot: no size, so its triangles cover nothing.
    out.position = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    return out;
  }

  let spent = clamp(particle.span.x / particle.span.y, 0.0, 1.0);
  let across = max(mix(params.attract.z, params.attract.w, spent) * params.canvas.w, 1.0);
  let speed = length(particle.place.zw);
  // The streak is seconds of the particle's own travel, in short sides, and
  // then in pixels; a stopped particle has none and is a disc.
  let tail = params.boids.w * speed * params.canvas.z;
  let halfLength = across * 0.5 + tail * 0.5;
  let halfWidth = across * 0.5;
  let axis = select(vec2<f32>(1.0, 0.0), particle.place.zw / max(speed, 1e-6), speed > 1e-6);
  let side = vec2<f32>(-axis.y, axis.x);

  let pixel = placeToUv(params, particle.place.xy) * params.canvas.xy
    + axis * (corner.x * halfLength) * vec2<f32>(1.0, -1.0)
    + side * (corner.y * halfWidth) * vec2<f32>(1.0, -1.0);
  out.position = vec4<f32>(
    pixel.x / params.canvas.x * 2.0 - 1.0,
    1.0 - pixel.y / params.canvas.y * 2.0,
    0.0,
    1.0,
  );

  // Bright and then gone, with a short ramp in so a field spawning thousands a
  // second does not pop one in at full light on the frame it was born.
  let fade = pow(1.0 - spent, params.light.y) * smoothstep(0.0, params.high.w, spent + 1e-6);
  let rate = mix(0.1, 0.4, particle.span.z);
  let wave = 0.5 + 0.5 * sin(TAU * (rate * params.step.y + particle.span.z));
  let twinkle = 1.0 - params.light.z * (1.0 - wave);
  let amount = params.light.x * fade * twinkle * edgeFade(particle.place.xy);
  out.light = colourOf(particle.span.w, spent) * amount;
  out.stretch = tail / max(across, 1e-6);
  return out;
}

@fragment
fn fs(in: Quad) -> @location(0) vec4<f32> {
  // One at the centre and nothing at the edge, flat where it leaves and where
  // it arrives, so there is no ring at the edge of the quad and no square.
  let inside = clamp(1.0 - dot(in.local, in.local), 0.0, 1.0);
  // A streak is brightest at its head and tapers to its tail; a round point
  // has no stretch and is left alone.
  let taper = mix(1.0, 0.25 + 0.75 * (0.5 + 0.5 * in.local.x), clamp(in.stretch, 0.0, 1.0));
  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(in.light * (inside * inside) * taper, 1.0);
}
