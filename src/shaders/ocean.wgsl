// A sea to the horizon, added into the scene's target before the feedback pass
// adds the history, so what is drawn here is fresh light the trails then carry.
// height.common.wgsl is prepended: it owns bindings 0 and 1 and gives the ring
// of what the low and the mid bands were a moment ago, the fog and the horizon
// glow. This owns binding 2 and everything about what water looks like.
//
// The water is black. What is drawn is the sky it mirrors. For each pixel the
// march finds the point of the surface the ray meets, the slope there says how
// that facet is tilted, and the reflected ray says which piece of the sky it
// shows: a glow along the horizon with a small hot light in it. Fresnel does
// the rest, since a view that grazes the water reflects nearly all of it and one
// that looks down into it nearly none, which is why the water is black under
// the camera and lit toward the horizon with no gradient painted on. The path of
// light is the facets whose reflection lands on the light. A glint is a facet
// whose reflection lands in a thin band about the glow's brightest line, so it
// is lit only where the slope is inside a narrow band and the band's width is
// how many there are.
//
// The surface is a few sine trains at different wavelengths and angles. The
// long ones are the swell, they carry the height the march looks for and they
// stand as tall as the low end was where the ring says it was; the short ones
// are the chop, which tilt the water and move it too little to march, and they
// stand as tall as the mids were. `height_march` cannot be reused because the
// kit's terrain is `height_profile` and a shader cannot override a function it
// is prepended to, so the march here is the kit's with the water's own height in
// it. The CPU mirror is `seaSurface`, `facetSky` and `seaLight` in
// ocean.params.ts; keep them in step, the tests measure the TypeScript.
//
// Nothing here takes a derivative: how much of a wave a pixel can resolve is
// worked out from the pixel's own footprint on the ground, which is exact for
// the flat sea and needs no neighbours, so a pixel that has nothing to draw may
// leave early.

struct Look {
  // Per train: 1 / wavelength, sin(angle) / wavelength, cos(angle) / wavelength,
  // and the phase in turns. The swell first, then the chop.
  train: array<vec4<f32>, 24>,
  // The trains' heights before the ring and the distance scale them.
  height: array<vec4<f32>, 6>,
  // The deep hue and the warm hue in turns, the intensity, and the glow's reach
  // above the line in half-heights.
  hues: vec4<f32>,
  // The swell's tallest, the path's sigma, the glints' half width and the
  // light's elevation, all of the sky in half-heights.
  sea: vec4<f32>,
  // The light's sigma, the fog's reach, the glint's elevation, and the deep
  // colour's share of the glow's light.
  sky: vec4<f32>,
  // The light of the sheen, the path, the glints and the parts that stand still.
  gain: vec4<f32>,
  // The height of a wave the ring's memory leaves at 0, where a wave is lost to
  // a pixel's footprint and where it is gone, and how much hotter a glint in the
  // path is.
  tune: vec4<f32>,
  // Fresnel at normal incidence, the light's own peak, and the two places
  // across the ring that read the low end and the mids.
  more: vec4<f32>,
  // How far the deep colour's glow reaches, in the glow's own reach, how bright
  // it is, how many trains there are and how many of them are swell.
  extra: vec4<f32>,
  // How far under the horizon the glints along its line come in, are all there,
  // start to fade and are gone.
  window: vec4<f32>,
  // How far under the horizon the glints on the light start to fade and are gone.
  window2: vec4<f32>,
}

@group(0) @binding(2) var<uniform> look: Look;

const TAU: f32 = 6.2831853;
const MAX_TRAINS: i32 = 24;
// How many even slices of height the march walks the ray through, then how
// many times it halves the slice the surface is in.
const SEA_MARCH_STEPS: i32 = 24;
const SEA_REFINE_STEPS: i32 = 4;

// A fully saturated hue, brightest channel at 1: three cosines a third of a
// turn apart. The grid's function and the lasers': the shared palette is one
// colour at a time and this is two.
fn vivid(turns: f32) -> vec3<f32> {
  let c = 0.5 + 0.5 * cos(TAU * (turns + vec3<f32>(0.0, 0.3333, 0.6667)));
  let sat = c * c;
  return sat / max(max(sat.r, sat.g), max(sat.b, 1e-4));
}

fn sea_train_height(i: i32) -> f32 {
  let block = look.height[i / 4];
  return block[i % 4];
}

// How far along the ground one pixel reaches at this distance. The ground is
// foreshortened, so it grows with the square of the distance.
fn sea_footprint(dz: f32) -> f32 {
  return dz * dz / (height_view.screen.w * height_view.camera.x) * (2.0 / height_view.screen.y);
}

// How much of a wave a pixel that spans `footprint` can still resolve.
fn sea_lod(inverse_wavelength: f32, footprint: f32) -> f32 {
  return 1.0 - smoothstep(look.tune.y, look.tune.z, footprint * inverse_wavelength);
}

// What the ring's memory of a band does to the height of the waves it drives.
fn sea_envelope(level: f32) -> f32 {
  return look.tune.x + (1.0 - look.tune.x) * clamp(level, 0.0, 1.0);
}

// The height of the water at a ground point: the swell alone, since that is what
// the march looks for.
fn sea_height(x: f32, dz: f32) -> f32 {
  let envelope = sea_envelope(height_level(look.more.z, dz));
  let footprint = sea_footprint(dz);
  var h = 0.0;
  let swell_trains = i32(look.extra.w);
  for (var i = 0; i < swell_trains; i = i + 1) {
    let t = look.train[i];
    let turns = t.y * x + t.z * dz + t.w;
    h = h + sea_train_height(i) * envelope * sea_lod(t.x, footprint) * sin(TAU * turns);
  }
  return h;
}

// How the water is tilted at a ground point, across and along, from all
// the trains: the chop barely lifts the water and is what the light finds.
fn sea_slope(x: f32, dz: f32) -> vec2<f32> {
  let low = sea_envelope(height_level(look.more.z, dz));
  let mid = sea_envelope(height_level(look.more.w, dz));
  let footprint = sea_footprint(dz);
  var slope = vec2<f32>(0.0);
  let trains = i32(look.extra.z);
  let swell_trains = i32(look.extra.w);
  for (var i = 0; i < trains; i = i + 1) {
    let t = look.train[i];
    let scale = sea_train_height(i) * select(mid, low, i < swell_trains) * sea_lod(t.x, footprint);
    let tilt = scale * TAU * cos(TAU * (t.y * x + t.z * dz + t.w));
    slope = slope + tilt * vec2<f32>(t.y, t.z);
  }
  return slope;
}

struct SeaHit {
  x: f32,
  dz: f32,
}

// Where a pixel's ray meets the water: the kit's march, with the swell for the
// terrain. Heights are even slices from the tallest the swell reaches down to
// the lowest, a ray at a height is a distance away by one divide, and four
// halvings turn the slice the surface is in into an edge.
fn sea_march(ndc: vec2<f32>) -> SeaHit {
  let focal = height_view.screen.w;
  let cam = height_view.camera.x;
  let down = max(height_view.screen.z - ndc.y, 1e-4);
  let bound = look.sea.x;

  var z_above = focal * (cam - bound) / down;
  var d_above = bound - sea_height(ndc.x * z_above / focal, z_above);
  var z_below = z_above;
  var d_below = d_above;
  var found = false;
  for (var i = 1; i <= SEA_MARCH_STEPS; i = i + 1) {
    let y = bound * (1.0 - 2.0 * f32(i) / f32(SEA_MARCH_STEPS));
    let z = focal * (cam - y) / down;
    let d = y - sea_height(ndc.x * z / focal, z);
    let under = d <= 0.0;
    let crossing = under && !found;
    z_below = select(z_below, z, crossing);
    d_below = select(d_below, d, crossing);
    let clear = !under && !found;
    z_above = select(z_above, z, clear);
    d_above = select(d_above, d, clear);
    found = found || under;
  }

  for (var j = 0; j < SEA_REFINE_STEPS; j = j + 1) {
    let z = 0.5 * (z_above + z_below);
    let y = cam - down * z / focal;
    let d = y - sea_height(ndc.x * z / focal, z);
    let is_above = d > 0.0;
    z_above = select(z_above, z, is_above);
    z_below = select(z, z_below, is_above);
    d_above = select(d_above, d, is_above);
    d_below = select(d, d_below, is_above);
  }

  let t = clamp(d_above / max(d_above - d_below, 1e-5), 0.0, 1.0);
  let z_hit = mix(z_above, z_below, t);
  return SeaHit(ndc.x * z_hit / focal, z_hit);
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let middle = 0.5 * height_view.screen.y;
  let ndc = vec2<f32>((frag.x - 0.5 * height_view.screen.x) / middle, (middle - frag.y) / middle);
  let horizon = height_view.screen.z;
  let focal = height_view.screen.w;
  let intensity = look.hues.z;
  let spread = look.hues.w;
  let warm = vivid(look.hues.y);
  let deep = vivid(look.hues.x);
  let white = vec3<f32>(1.0);

  // The water. Only for pixels below the horizon whose flat-sea distance is
  // inside the fog: past it the light is exactly nothing and there is no
  // march to do.
  var water = vec3<f32>(0.0);
  let down = horizon - ndc.y;
  let flat_z = focal * height_view.camera.x / max(down, 1e-4);
  if (down > 0.0 && flat_z < look.sky.y * 1.25) {
    let hit = sea_march(ndc);
    let slope = sea_slope(hit.x, hit.dz);
    let normal = normalize(vec3<f32>(-slope.x, 1.0, -slope.y));
    let view = normalize(vec3<f32>(ndc.x, ndc.y - horizon, focal));
    let facing = dot(view, normal);
    let mirrored = view - 2.0 * facing * normal;

    // Where the reflection points, in the frame's own units, and whether it
    // points at the sky at all: one that points down goes into the water.
    let forward = max(mirrored.z, 0.05);
    let e = focal * mirrored.y / forward;
    let az = focal * mirrored.x / forward;
    let is_sky = select(0.0, smoothstep(-0.015, 0.012, e), mirrored.z > 0.0);
    let grazing = 1.0 - clamp(-facing, 0.0, 1.0);
    let fres = look.more.x + (1.0 - look.more.x) * grazing * grazing * grazing * grazing * grazing;

    // The glow mirrored: warm at the line, the deep hue far above it.
    let above = max(e, 0.0);
    let glow = exp(-above / spread);
    let broad = look.sky.w * exp(-above / (look.extra.x * spread));
    let sheen_colour = mix(warm, deep, smoothstep(0.0, 2.5 * spread, above));
    let sheen = fres * (glow * sheen_colour * look.gain.x + broad * deep * look.extra.y);

    // The path: facets whose reflection lands on the light.
    let up = e - look.sea.w;
    let lobe = exp(-(up * up + az * az) / (2.0 * look.sea.y * look.sea.y));
    let path = fres * lobe * look.gain.y * mix(warm, white, 0.35);

    // A glint: a facet whose reflection is inside the thin band about the
    // glow's brightest line, or on the light itself, which is what breaks the
    // path into sparks. Outside both it is exactly nothing.
    let band_width = max(look.sea.z, 1e-4);
    let resolved = smoothstep(look.window.x, look.window.y, down);
    let along_line = 1.0 - smoothstep(look.window.z, look.window.w, down);
    let on_line =
      along_line * (1.0 - smoothstep(0.5 * band_width, band_width, abs(e - look.sky.z)));
    let along_light = 1.0 - smoothstep(look.window2.x, look.window2.y, down);
    let on_light = along_light
      * (1.0 - smoothstep(0.5 * band_width, band_width, length(vec2<f32>(up, az))));
    let band = select(0.0, resolved * max(on_line, on_light), look.sea.z > 0.0);
    let glint = fres * band * (1.0 + look.tune.w * lobe) * look.gain.z * mix(warm, white, 0.6);

    water = (sheen + path + glint) * is_sky * height_fog(hit.dz, look.sky.y) * intensity;
  }

  // What stands still: the horizon's hairline and glow, and the light. The
  // canvas sums a mark that does not move to about forty times what is drawn,
  // so they are drawn at a small share.
  let line_and_glow = height_horizon_glow(ndc.y, spread);
  let over = ndc.y - horizon;
  let far = smoothstep(0.0, 2.5 * spread, max(over, 0.0));
  let horizon_colour = mix(mix(warm, white, 0.5 * line_and_glow.x), deep, far);
  let to_sun = vec2<f32>(ndc.x, over - look.sea.w);
  let sun = look.more.y * exp(-dot(to_sun, to_sun) / (2.0 * look.sky.x * look.sky.x));
  let still =
    (horizon_colour * (line_and_glow.x * 0.9 + line_and_glow.y * 0.35) + mix(warm, white, 0.5) * sun)
    * look.gain.w
    * intensity;

  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(water + still, 1.0);
}
