// Tall slow curtains of light, added into the scene's target before the
// feedback pass, so what is drawn here is fresh light that the canvas then
// sums and carries: a curtain that stands still settles at about forty times
// what one frame adds, and the CPU has already divided the intensity by that.
//
// One fullscreen triangle, and the fragment walks the curtains, nearest
// first. The light of one is a transcription of `curtainLight` in
// aurora.params.ts, which says what it is and why; keep the two in step, the
// tests measure the TypeScript. In short: nothing below the curtain's lower
// edge, a bright thin border on it, fine vertical rays above it that are
// sharp at the foot and dissolve upward, and exactly nothing at and above the
// curtain's own top, so the sky between and over the curtains is black and
// not dim. What only lives here is the colour: the foot's hue turning to the
// tip's along the height, the border a little white at its very middle, and
// the whole walk clamped to the arc from green through cyan to violet and
// magenta, so no packet, key or chord can draw a curtain of any other colour.

struct Params {
  // The canvas in pixels, the fresh light one frame adds at the foot, and how
  // many curtains are lit (a fraction fades the last one in).
  screen: vec4<f32>,
  // The height knob, the sway in frame heights, the ray sharpness knob and
  // the ray clock in lattice cells.
  shape: vec4<f32>,
  // The foot's hue and the tip's in turns, and the saturation.
  colour: vec4<f32>,
  // Per curtain: where the edge rests, how far it wanders, its height and its
  // rays across a frame height.
  foot: array<vec4<f32>, 4>,
  // Per curtain: its light, where its path starts, and how slowly it moves.
  light: array<vec4<f32>, 4>,
  // Per curtain: the path's three phases and the sway's, in cycles.
  path: array<vec4<f32>, 4>,
  // Per curtain: the two phases of how much of the frame it covers.
  span: array<vec4<f32>, 4>,
  // Eight ripples: the curtain (-1 for none), where along it, how wide and
  // how strong.
  ripples: array<vec4<f32>, 8>,
}

@group(0) @binding(0) var<uniform> params: Params;

const TAU = 6.28318530718;

// The arc: green at a third of the wheel to magenta at a bit over five sixths.
const ARC_LOW = 0.33;
const ARC_HIGH = 0.87;

const FOOT_HEIGHT = 0.009;
const FOOT_GAIN = 6.0;
const BODY_POWER = 1.6;
const REACH_LOW = 0.4;
const REACH_HIGH = 0.96;
const RAY_SOFTEN = 0.55;
const SWAY_FREQ = 0.9;
const SWAY_RATE = 0.6;
const RAY_PERIOD = 1023u;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
}

// Murmur3's finaliser, the same as the TypeScript's: neighbouring inputs come
// out unrelated. u32 multiplication wraps, which is what Math.imul does.
fn scramble(value: u32) -> u32 {
  var bits = value;
  bits = bits ^ (bits >> 16u);
  bits = bits * 0x85ebca6bu;
  bits = bits ^ (bits >> 13u);
  bits = bits * 0xc2b2ae35u;
  bits = bits ^ (bits >> 16u);
  return bits;
}

fn lattice(cell: i32, layer: i32) -> f32 {
  let a = bitcast<u32>(cell) * 0x9e3779b1u;
  let b = (bitcast<u32>(layer) & RAY_PERIOD) * 0x85ebca77u;
  return f32(scramble(a ^ b)) / 4294967296.0;
}

fn ease(value: f32) -> f32 {
  return value * value * (3.0 - 2.0 * value);
}

// A value noise across and through time, 0 to 1. `time` is in cells of a
// lattice that repeats every 1024, which is where the CPU wraps its clock.
fn ray_noise(x: f32, time: f32) -> f32 {
  let cell = floor(x);
  let layer = floor(time);
  let fx = ease(x - cell);
  let ft = ease(time - layer);
  let ci = i32(cell);
  let si = i32(layer);
  let a = mix(lattice(ci, si), lattice(ci + 1, si), fx);
  let b = mix(lattice(ci, si + 1), lattice(ci + 1, si + 1), fx);
  return mix(a, b, ft);
}

// HSV at full value: the hue as a colour of the given saturation.
fn vivid(hue: f32, saturation: f32) -> vec3<f32> {
  let wheel = clamp(
    abs(fract(hue + vec3<f32>(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0,
    vec3<f32>(0.0),
    vec3<f32>(1.0),
  );
  return mix(vec3<f32>(1.0), wheel, saturation);
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  // Frame heights from the middle across, and up from the bottom, so a
  // curtain is the same shape on a wide canvas and a tall one.
  let tall_px = params.screen.y;
  let u = (frag.x - 0.5 * params.screen.x) / tall_px;
  let v = 1.0 - frag.y / tall_px;
  let pixel = 1.0 / tall_px;

  var total = vec3<f32>(0.0);
  for (var k = 0u; k < 4u; k = k + 1u) {
    let weight = clamp(params.screen.w - f32(k), 0.0, 1.0);
    let place = params.foot[k];
    let own = params.light[k];
    let phase = params.path[k];
    let cover = params.span[k];
    let shift = own.y;

    // The lower edge: three sines that drift. Nothing is lit below it.
    var wander = 0.0;
    wander = wander + 0.5 * sin(TAU * (0.83 * (u + shift) + phase.x));
    wander = wander + 0.3 * sin(TAU * (1.97 * (u + shift) + phase.y));
    wander = wander + 0.2 * sin(TAU * (3.61 * (u + shift) + phase.z));
    let rise = v - (place.x + place.y * wander);

    // How much of the frame here carries this curtain: two slow sines through
    // a smoothstep, exactly 0 off the ends.
    let held = 0.5 + 0.5 * (
      0.62 * sin(TAU * (0.37 * (u + shift) + cover.x)) +
      0.38 * sin(TAU * (0.83 * (u + shift) + cover.y))
    );
    let presence = ease(clamp((held - 0.3) / 0.32, 0.0, 1.0));

    // A ripple lifts the light where it is and stretches the sheet there.
    var bump = 0.0;
    for (var r = 0u; r < 8u; r = r + 1u) {
      let ripple = params.ripples[r];
      if (ripple.x == f32(k)) {
        let away = (u - ripple.y) / max(ripple.z, 0.001);
        bump = bump + ripple.w * exp(-away * away);
      }
    }

    let top = max(place.z * params.shape.x * (1.0 + 0.3 * bump), 0.000001);
    let height = rise / top;
    // Everything that ends the light is decided before the rays are worked
    // out, so a pixel below the edge or above the top costs nothing more.
    if (weight <= 0.0 || rise <= 0.0 || presence <= 0.0 || height >= 1.0) { continue; }

    // The top of a ray leans and the foot does not.
    let lean = params.shape.y * height * sin(TAU * (SWAY_FREQ * (u + shift) + phase.w));
    let cells = (u + lean) * place.w;
    let flicker = params.shape.w * (1.0 + 0.4 * own.z) + shift * 31.0;
    let raw = 0.65 * ray_noise(cells, flicker) + 0.35 * ray_noise(cells * 2.7 + 13.0, flicker * 1.9 + 7.0);
    let sharp = (1.5 + 5.5 * params.shape.z) * (1.0 - RAY_SOFTEN * height);
    let ray = pow(raw, sharp);

    // Each ray's own top: the strong ones stand tallest.
    let reach = REACH_LOW + (REACH_HIGH - REACH_LOW) * raw;
    let fall = 1.0 - clamp(height / reach, 0.0, 1.0);
    let body = pow(fall, BODY_POWER);
    let border = FOOT_GAIN * exp(-rise / FOOT_HEIGHT);
    // One pixel of soft edge: a hard lower edge without aliasing.
    let cut = clamp(rise / pixel, 0.0, 1.0);
    let lit = weight * presence * own.x * cut * ray * (body + border * fall) * (1.0 + 1.4 * bump);

    // The hue goes from the foot's to the tip's in the upper part of the
    // curtain, in hue and not in rgb, so the middle is blue and not grey; a
    // little of it is each ray's own. The whole walk is held inside the arc.
    let along = clamp((height - 0.05) / 0.6, 0.0, 1.0);
    let hue = clamp(
      mix(params.colour.x, params.colour.y, ease(along)) + 0.02 * (raw - 0.5),
      ARC_LOW,
      ARC_HIGH,
    );
    // White only at the very middle of the border, the rest is colour.
    let core = 0.35 * exp(-rise / 0.0035);
    let tint = mix(vivid(hue, params.colour.z), vec3<f32>(1.0), core);
    total = total + tint * lit;
  }

  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(total * params.screen.z, 1.0);
}
