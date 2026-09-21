// height-kit: what every study that flies over a scrolling heightfield shares.
// It is prepended to the study's own shader, the way fluid.common.wgsl is, and
// declares the two bindings the kit owns (0 and 1); the study's own uniform
// starts at 2. Everything here is a transcription of height.params.ts, which
// is what the tests measure. Keep the two in step.
//
// The camera is `camera.x` units up (two, in the kit's own numbers). It flies down +z at the
// middle of the field looking along the ground, so the horizon is a straight
// line and a pixel's ray is (x, y - horizon, focal) in half-heights. The
// ground is a ring of rows, one strip across the width each, that the CPU
// writes as the camera flies and this only reads.
//
// What a study gets from here:
//   height_march        the ground point a pixel looks at, down through the relief
//   height_at           the height there, and height_level the music's share of it
//   height_slope        how steep it is, across and along
//   height_fog          how much of a line survives the distance, to exactly 0
//   height_horizon_glow the horizon line and the glow either side of it
// A study that wants another terrain replaces height_profile and keeps the rest.

struct HeightView {
  // Canvas width and height in pixels, the horizon in half-heights above the
  // middle, and the focal length in half-heights.
  screen: vec4<f32>,
  // The camera's height, the ring's travel wrapped to one lap, the row spacing
  // and the number of rows.
  camera: vec4<f32>,
  // The half width the columns cover, the columns, the tallest the ground
  // reaches, and the share of the depth where the music starts to fade.
  field: vec4<f32>,
  // The valley's edge as a share of the half width, the relief 0 to 1, the
  // hills' base and the floor's ripple.
  shape: vec4<f32>,
}

@group(0) @binding(0) var<uniform> height_view: HeightView;
@group(0) @binding(1) var<storage, read> field_rows: array<f32>;

// How many even slices of height the march walks the ray through, then how
// many times it halves the slice the ground is in. The ground never rises to
// the camera, so the ray meets it once and stepping down in height is enough;
// the halving is what turns the slice into an edge instead of a stair.
const HEIGHT_MARCH_STEPS: i32 = 28;
const HEIGHT_REFINE_STEPS: i32 = 4;

// Where a pixel's ray meets the ground: across, how far ahead, how high, and
// whether it meets any (0 above the horizon).
struct HeightHit {
  x: f32,
  dz: f32,
  h: f32,
  hit: f32,
}

fn height_row_at(slot: u32, column: u32) -> f32 {
  return field_rows[slot * u32(height_view.field.y) + column];
}

// The music at a ground point: a bilinear read across the columns and along
// the rows, the rows wrapped round the ring, faded to nothing over the far end
// so a row is born flat and arrives as a swell.
fn height_level(x: f32, dz: f32) -> f32 {
  let columns = height_view.field.y;
  let rows = height_view.camera.w;
  let across = clamp((x / height_view.field.x) * 0.5 + 0.5, 0.0, 1.0) * (columns - 1.0);
  let c0 = floor(across);
  let cf = across - c0;
  let first = u32(c0);
  let second = min(first + 1u, u32(columns) - 1u);
  let row = (height_view.camera.y + dz) / height_view.camera.z;
  let r0 = floor(row);
  let rf = row - r0;
  let s0 = u32(r0 % rows);
  let s1 = u32((r0 + 1.0) % rows);
  let near = mix(height_row_at(s0, first), height_row_at(s0, second), cf);
  let far = mix(height_row_at(s1, first), height_row_at(s1, second), cf);
  let depth = rows * height_view.camera.z;
  let taper = 1.0 - smoothstep(height_view.field.w * depth, depth, dz);
  return mix(near, far, rf) * taper;
}

// The terrain from the music's level at a place: a valley floor that ripples
// a little, and hills past the valley's edge that stand at the base when the
// music is quiet and at the whole range when it is full.
fn height_profile(x: f32, level: f32) -> f32 {
  let across = clamp(abs(x) / height_view.field.x, 0.0, 1.0);
  let wall = smoothstep(height_view.shape.x, 1.0, across);
  let hills = wall * (height_view.shape.z + (1.0 - height_view.shape.z) * level);
  let floor_wave = (1.0 - wall) * height_view.shape.w * level;
  return height_view.field.z * height_view.shape.y * (hills + floor_wave);
}

fn height_at(x: f32, dz: f32) -> f32 {
  return height_profile(x, height_level(x, dz));
}

// Across and along, by central differences over a step a little wider than a row.
fn height_slope(x: f32, dz: f32) -> vec2<f32> {
  let e = 0.12;
  return vec2<f32>(
    (height_at(x + e, dz) - height_at(x - e, dz)) / (2.0 * e),
    (height_at(x, dz + e) - height_at(x, dz - e)) / (2.0 * e),
  );
}

// The ground point a pixel looks at. `ndc` is the pixel in half-heights from
// the middle with y up. A ray at height y is `focal * (camera - y) / down` away
// where `down` is how far the pixel is below the horizon, so the march picks
// heights and gets distances, which is one divide a step and no direction to
// normalise. It runs a fixed number of steps with no early exit on purpose: a
// pixel that stopped early would make what follows it, the study's derivative
// reads, non-uniform, which WGSL refuses to compile.
fn height_march(ndc: vec2<f32>) -> HeightHit {
  let focal = height_view.screen.w;
  let cam = height_view.camera.x;
  let down = max(height_view.screen.z - ndc.y, 1e-4);
  // Nothing rises above this, so the ray is in the clear until it comes down to it.
  let top = min(height_view.field.z * height_view.shape.y, cam);

  var z_above = focal * (cam - top) / down;
  var d_above = top - height_at(ndc.x * z_above / focal, z_above);
  var z_below = z_above;
  var d_below = d_above;
  var found = false;
  for (var i = 1; i <= HEIGHT_MARCH_STEPS; i = i + 1) {
    let y = top * (1.0 - f32(i) / f32(HEIGHT_MARCH_STEPS));
    let z = focal * (cam - y) / down;
    let d = y - height_at(ndc.x * z / focal, z);
    let under = d <= 0.0;
    let crossing = under && !found;
    z_below = select(z_below, z, crossing);
    d_below = select(d_below, d, crossing);
    let clear = !under && !found;
    z_above = select(z_above, z, clear);
    d_above = select(d_above, d, clear);
    found = found || under;
  }

  for (var j = 0; j < HEIGHT_REFINE_STEPS; j = j + 1) {
    let z = 0.5 * (z_above + z_below);
    let y = cam - down * z / focal;
    let d = y - height_at(ndc.x * z / focal, z);
    let is_above = d > 0.0;
    z_above = select(z_above, z, is_above);
    z_below = select(z, z_below, is_above);
    d_above = select(d_above, d, is_above);
    d_below = select(d, d_below, is_above);
  }

  let t = clamp(d_above / max(d_above - d_below, 1e-5), 0.0, 1.0);
  let z_hit = mix(z_above, z_below, t);
  var result: HeightHit;
  result.dz = z_hit;
  result.x = ndc.x * z_hit / focal;
  result.h = cam - down * z_hit / focal;
  result.hit = 1.0;
  return result;
}

// How much of a line survives the distance: 1 at the camera, exactly 0 at
// `reach` and past it, twice smoothed so no line is seen to arrive. To true
// black and not to grey.
fn height_fog(along: f32, reach: f32) -> f32 {
  let t = clamp(along / reach, 0.0, 1.0);
  let fade = 1.0 - t * t * (3.0 - 2.0 * t);
  return fade * fade;
}

// The horizon as two amounts, a hairline at exactly the horizon and the glow
// round it. `spread` is how far the glow reaches above it in half-heights; it
// reaches nearly as far below, where the far ground has already dissolved in
// fog and the glow is what joins it to the horizon.
fn height_horizon_glow(ndc_y: f32, spread: f32) -> vec2<f32> {
  let e = ndc_y - height_view.screen.z;
  let pixel = 2.0 / height_view.screen.y;
  let line = exp(-(e * e) / (2.8 * pixel * pixel));
  let side = select(0.9, 1.0, e > 0.0);
  let band = exp(-abs(e) / (spread * side));
  return vec2<f32>(line, band);
}
