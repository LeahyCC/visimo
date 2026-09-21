// A flower of twelve petals, one a pitch class, added into the scene's target
// before the feedback pass adds the history, so what is drawn here is fresh
// light that the trails then carry and smear.
//
// One fullscreen triangle. For each pixel the loop walks the petals of two
// whorls, finds the distance to each petal's outline and sums its light, which
// is a transcription of `petalLight` in petals.params.ts. Keep the two in
// step, the tests measure the TypeScript.
//
// A petal is lit like a real one with the sun behind it: a dim translucent
// body that is a little dimmer in the middle than near the edge, a bright rim
// round its outline that is brightest at the tip, and a soft halo outside. The
// rim is the only light that reaches past 1, so the bloom finds the outline of
// each petal and leaves its body alone. Each petal has a fully saturated hue
// of its own and only the very middle of the rim goes toward white, so the
// colour lives in the body and the halo. Petals sum, so where two overlap the
// light is brighter, and between them the frame stays black.
//
// The CPU has already put the angle, the hue and the light of each petal into
// the uniform and worked the hub, the radius, the rim and the glow out in
// pixels, so this does no sizing of its own. It multiplies the sum by the
// intensity, and the presence is the blend constant.

struct Params {
  // The canvas in pixels, the flower's radius in pixels, the hub's.
  screen: vec4<f32>,
  // The openness (how much of its reach a petal keeps), the width, the second
  // whorl's layer, the rim's width in pixels.
  shape: vec4<f32>,
  // The intensity, the glow's width in pixels, the heart, the key's hue.
  light: vec4<f32>,
  // Spare, so the petals start on a 64 byte boundary.
  spare: vec4<f32>,
  // Per petal: the direction x and y in pixels with y down, how lit, the hue
  // in turns.
  petals: array<vec4<f32>, 12>,
}

@group(0) @binding(0) var<uniform> params: Params;

const PETALS = 12u;
const PI = 3.1415927;
const HUB_RING = 0.85;
// The second whorl: shorter, and turned half a step, which is 15 degrees.
const INNER_LENGTH = 0.55;
const INNER_COS = 0.9659258;
const INNER_SIN = 0.2588190;
const BUD_LENGTH = 0.35;
const NOTE_LENGTH = 0.65;
const HALF_SECTOR = 0.27;
const WIDEST_AT = 0.6;
const OUTLINE_SKEW = 1.4;
const OUTLINE_ROUND = 0.85;
const BODY = 0.1;
const RIM = 1.6;
const HALO = 0.06;
const TIP_GAIN = 1.2;
const NOTE_MIN = 0.01;
// How far a petal's light reaches past its edge, in glow widths.
const REACH_GLOWS = 6.0;
// How far the middle of the rim is pulled to white. The colour lives in the
// body and the halo round it, and a rim pulled all the way would be pastel.
const RIM_WHITE = 0.4;

// A fully saturated hue, brightest channel at 1: three cosines a third of a
// turn apart. The shared palette is one colour at a time and a flower is not.
fn vivid(turns: f32) -> vec3<f32> {
  let c = 0.5 + 0.5 * cos(6.2831853 * (turns + vec3<f32>(0.0, 0.3333, 0.6667)));
  let sat = c * c;
  return sat / max(max(sat.r, sat.g), max(sat.b, 1e-4));
}

fn smooth_step(low: f32, high: f32, value: f32) -> f32 {
  let at = clamp((value - low) / (high - low), 0.0, 1.0);
  return at * at * (3.0 - 2.0 * at);
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
}

// One petal of one whorl at the pixel `rel` from the middle: the light in x
// and the rim's share of it in y, so the colour can treat the two differently.
fn petal(rel: vec2<f32>, dir_in: vec2<f32>, lit_in: f32, inner: bool, glow: f32) -> vec2<f32> {
  var lit = lit_in;
  var dir = dir_in;
  var tip = params.screen.z;
  if (inner) {
    lit = lit * params.shape.z;
    tip = tip * INNER_LENGTH;
    dir = vec2<f32>(
      dir_in.x * INNER_COS - dir_in.y * INNER_SIN,
      dir_in.x * INNER_SIN + dir_in.y * INNER_COS,
    );
  }
  if (lit < NOTE_MIN) {
    return vec2<f32>(0.0);
  }

  let base = params.screen.w;
  let span = (tip - base) * params.shape.x * (BUD_LENGTH + NOTE_LENGTH * min(lit, 1.0));
  let half_width = params.shape.y * HALF_SECTOR * (base + WIDEST_AT * span);

  let along = dot(rel, dir);
  let across = dot(rel, vec2<f32>(-dir.y, dir.x));
  let t = (along - base) / span;
  let tc = clamp(t, 0.0, 1.0);
  // The outline is fullest a little past the middle and pointed at the tip. The
  // sine dips a hair under zero at the tip, and a power of that is undefined.
  let outline = half_width * pow(max(sin(PI * pow(tc, OUTLINE_SKEW)), 0.0), OUTLINE_ROUND);
  let over = max(max(-t, t - 1.0), 0.0) * span;
  let off = abs(across) - outline;
  // The height off the outline, lengthened by however far past an end the
  // pixel is and shortened a fifth for the slope: close enough for a rim.
  let dist = (length(vec2<f32>(over, max(off, 0.0))) + min(off, 0.0)) * 0.8;

  var body_light = 0.0;
  var halo_light = 0.0;
  if (dist < 0.0) {
    let depth = clamp(-dist / max(half_width, 0.001), 0.0, 1.0);
    body_light = BODY * (0.35 + 0.65 * pow(tc, 0.8)) * (1.0 - 0.45 * depth);
  } else {
    halo_light = HALO * (0.5 + 0.5 * tc) * exp(-dist / glow);
  }
  let edge = dist / params.shape.w;
  let rim_light = RIM * (1.0 + TIP_GAIN * smooth_step(0.85, 1.0, tc)) * exp(-edge * edge);
  let gain = pow(min(lit, 1.0), 0.7);
  return vec2<f32>((body_light + halo_light + rim_light) * gain, rim_light * gain);
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let rel = frag.xy - 0.5 * params.screen.xy;
  let radius = length(rel);
  let glow = max(params.light.y, 0.5);
  // Nothing of the flower is out past its radius and a few glow widths, and
  // most of the frame is, so most pixels stop here.
  if (radius > params.screen.z + REACH_GLOWS * glow) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  var colour = vec3<f32>(0.0);
  for (var k = 0u; k < PETALS; k = k + 1u) {
    let p = params.petals[k];
    if (p.z < NOTE_MIN) {
      continue;
    }
    let tint = vivid(p.w);
    let outer = petal(rel, p.xy, p.z, false, glow);
    var seen = outer;
    if (params.shape.z > 0.0) {
      seen = seen + petal(rel, p.xy, p.z, true, glow);
    }
    // The body and the halo in the note's colour, the rim pulled a little to
    // white so it reads as the hot edge of the petal.
    colour = colour + tint * (seen.x - seen.y) + mix(tint, vec3<f32>(1.0), RIM_WHITE) * seen.y;
  }

  // The heart: a thin ring at the hub in the key's own colour, brighter the
  // more of the chord is sounding. The hub inside it is left dark, the way the
  // centre of a backlit daisy is, which is what makes the petals read as
  // light coming through.
  let ring = (radius - params.screen.w * HUB_RING) / max(params.shape.w * 1.5, 0.5);
  colour = colour + mix(vivid(params.light.w), vec3<f32>(1.0), 0.5) * (params.light.z * exp(-ring * ring));

  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(colour * params.light.x, 1.0);
}
