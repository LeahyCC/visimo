// Sand on a vibrating plate, added into the scene's target before the feedback
// pass adds the history, so what is drawn here is fresh light that the trails
// then carry and smear.
//
// One fullscreen triangle. For each pixel the shader sums the plate's modes,
// `cos(n pi x) cos(m pi y) + sign cos(m pi x) cos(n pi y)` for up to twenty four
// pairs, and draws the line where that sum crosses zero, which is where the sand
// gathers. It is a transcription of `plateAt`, `lineProfile` and `cymaticsAt` in
// cymatics.params.ts. Keep the two in step, the tests measure the TypeScript.
//
// The distance to the line is the sum over its own gradient, and the gradient
// comes from the neighbouring pixels of the quad. That is what makes a line a
// pixel or two wide at any resolution: the width is in pixels because the
// distance is, and there is no edge of a coverage mask to alias. The length of
// the two derivatives is used and not `fwidth`, which is their sum: it would
// draw a line on the diagonal thinner than one along an axis by the square root
// of two. Both derivatives are taken before anything can leave early, and every
// branch before them is on the uniform, so the control flow is uniform.
//
// The core is a thin line pulled toward white, so it is hot at the centre and
// rests above 1 for the bloom to find, and the glow round it is colour. Where
// lines meet the gradient goes to nothing while the sum does too, so the ratio
// is small over a little patch and each node is a brighter point. Between the
// lines is black. The colour at a pixel is the notes' colours weighted by how
// much of the sum each of them is there, so a chord is a plate with a region of
// each note's colour in it.

struct Params {
  // The canvas in pixels, the plate's side in pixels.
  screen: vec4<f32>,
  // The core's half width in pixels, the glow's width in pixels, the glow's gain,
  // the intensity.
  line: vec4<f32>,
  // The fade, so a chord dying away goes out as a dimming.
  drive: vec4<f32>,
  // Spare, so the modes start on a 64 byte boundary.
  spare: vec4<f32>,
  // Per mode: n, m, amplitude, sign. Twelve notes, then their twelve partners.
  modes: array<vec4<f32>, 24>,
  // Per note: its colour. A partner takes its note's.
  tints: array<vec4<f32>, 12>,
}

@group(0) @binding(0) var<uniform> params: Params;

const MODES = 24u;
const NOTES = 12u;
// Cosines tabulated per axis: the modes number 1 to 8, and 0 is the table's first.
const TABLE = 9u;
const PI = 3.1415927;
// How far the middle of the line is pulled to white. The colour lives in the
// glow round it, and a core pulled all the way would be a white drawing.
const CORE_WHITE = 0.35;
// Under this the mode is not ringing and costs nothing.
const AMP_MIN = 0.001;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
}

fn smooth_step(low: f32, high: f32, value: f32) -> f32 {
  let at = clamp((value - low) / (high - low), 0.0, 1.0);
  return at * at * (3.0 - 2.0 * at);
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let side = params.screen.z;
  let rel = frag.xy - 0.5 * params.screen.xy;
  // The plate's own coordinates, 0 to 1 across it, y down.
  let plate = rel / side + vec2<f32>(0.5);
  let px = plate.x * PI;
  let py = plate.y * PI;

  var cx: array<f32, 9>;
  var cy: array<f32, 9>;
  for (var j = 0u; j < TABLE; j = j + 1u) {
    cx[j] = cos(f32(j) * px);
    cy[j] = cos(f32(j) * py);
  }

  var sum = 0.0;
  var weight = 0.0;
  var tint = vec3<f32>(0.0);
  for (var k = 0u; k < MODES; k = k + 1u) {
    let mode = params.modes[k];
    let amp = mode.z;
    if (amp <= AMP_MIN) {
      continue;
    }
    let n = u32(mode.x);
    let m = u32(mode.y);
    let shape = cx[n] * cy[m] + mode.w * cx[m] * cy[n];
    sum = sum + amp * shape;
    // How much of the sum this mode is here, for the colour. Its absolute
    // value, since a mode that is negative is as much of the picture as one
    // that is positive.
    let share = amp * abs(shape);
    tint = tint + params.tints[k % NOTES].rgb * share;
    weight = weight + share;
  }

  // Derivatives first and unconditionally, before the plate's edge or the
  // fade can leave: they need every pixel of the quad to have got here.
  let gradient = length(vec2<f32>(dpdx(sum), dpdy(sum)));
  let gap = abs(sum) / max(gradient, 1e-9);

  let half_width = params.line.x;
  let core = 1.0 - smooth_step(half_width - 0.5, half_width + 0.5, gap);
  let halo = params.line.z * exp(-gap / max(params.line.y, 0.5));

  // The mix of the notes' colours, pushed back out to a full hue: averaging
  // two hues a long way apart pulls toward grey, and the plate should read as
  // colour wherever it is lit.
  let mixed = tint / max(weight, 1e-6);
  let peak = max(max(mixed.r, mixed.g), max(mixed.b, 1e-4));
  let lean = mixed / peak;
  let saturated = lean * lean;
  let hue = saturated / max(max(saturated.r, saturated.g), max(saturated.b, 1e-4));

  // One pixel of feather at the plate's edge, so the lines stop at it cleanly.
  let inside = min(min(plate.x, 1.0 - plate.x), min(plate.y, 1.0 - plate.y)) * side;
  let edge = smooth_step(0.0, 1.0, inside);

  let colour = hue * halo + mix(hue, vec3<f32>(1.0), CORE_WHITE) * core;
  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(colour * params.line.w * params.drive.x * edge, 1.0);
}
