// Club laser fans sweeping through haze, added into the scene's target before
// the feedback pass adds the history, so what is drawn here is fresh light
// that the trails then carry and smear.
//
// One fullscreen triangle. Every beam is analytic: for each pixel the loop
// walks the fans and their beams, measures the distance to each beam's line
// and sums a falloff, which is a transcription of `laserBeamLight` in
// lasers.params.ts. Keep the two in step, the tests measure the TypeScript.
// Beams sum, so crossings are brighter, which is what a haze full of lasers
// looks like.
//
// A fan's origin sits just off the top or bottom edge and alternates between
// them, and its base direction points straight into the frame. The swing is
// `sweep x (|beatPhase - 0.5| - 0.5)`, read from the packet, so a fan is
// centred on the predicted beat, sweeps to one side and back inside the beat,
// and even fans run backwards, crossing their neighbours on the way. The
// spread lays the fan's beams evenly across `spread` radians, so at 0 every
// beam coincides and the fan is one beam.
//
// The CPU has already put the intensity into the colours, worked out the core
// and glow in pixels and picked the flicked beam's weight, so this does no
// sizing of its own and the presence is the blend constant.

struct Params {
  // The canvas in pixels, then the beat phase. The fourth float is padding.
  screen: vec4<f32>,
  // The fans, the beams, the spread in radians, the swing in radians.
  shape: vec4<f32>,
  // The core half width in pixels, the glow in pixels, the flick. The fourth
  // float is padding.
  beam: vec4<f32>,
  // Light in rgb, already scaled by the intensity. The fourth float is
  // padding.
  light: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;

const MAX_FANS = 6u;
const MAX_BEAMS = 8u;
const ORIGIN_MARGIN = 0.02;
const FLICK_GAIN = 2.0;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  let fans = u32(params.shape.x + 0.5);
  let beams = u32(params.shape.y + 0.5);
  let margin = ORIGIN_MARGIN * min(params.screen.x, params.screen.y);
  var light = 0.0;

  for (var f = 0u; f < MAX_FANS; f = f + 1u) {
    if (f >= fans) {
      break;
    }
    let top = f % 2u == 0u;
    let origin = vec2<f32>(
      (f32(f) + 0.5) / params.shape.x * params.screen.x,
      select(params.screen.y + margin, -margin, top),
    );
    // The swing is centred on the beat and even fans run it backwards: the
    // triangle of |phase - 0.5| lands every fan at 0 on the beat and at the
    // far side of its travel half way to the next one.
    let swing =
      params.shape.w * (abs(params.screen.z - 0.5) - 0.5) * select(-1.0, 1.0, top);
    // The beam the treble answers this beat, a different one of each fan.
    let flick_at = (f + u32(params.screen.z * params.shape.y)) % max(beams, 1u);

    for (var b = 0u; b < MAX_BEAMS; b = b + 1u) {
      if (b >= beams) {
        break;
      }
      // The beam's place in the spread: evenly laid across it, and the one
      // beam of a closed fan stands at its middle, so the division below runs
      // only when there is a spread to divide.
      var taper = 0.5;
      if (params.shape.y > 1.5) {
        taper = f32(b) / (params.shape.y - 1.0);
      }
      let angle = swing + (taper - 0.5) * params.shape.z;
      let dir = vec2<f32>(sin(angle), cos(angle) * select(-1.0, 1.0, top));
      let along = dot(frag.xy - origin, dir);
      // A pixel behind the fan's origin is not on the beam at all.
      if (along < 0.0) {
        continue;
      }
      let across = abs((frag.x - origin.x) * dir.y - (frag.y - origin.y) * dir.x);
      // The rings' line shape: full across the core, a smoothstep down across
      // the glow, exactly zero past it.
      let inner = max(params.beam.x - params.beam.y, 0.0);
      let outer = params.beam.x + params.beam.y;
      let at = clamp((across - inner) / (outer - inner), 0.0, 1.0);
      var add = 1.0 - at * at * (3.0 - 2.0 * at);
      if (b == flick_at) {
        add = add * (1.0 + params.beam.z * FLICK_GAIN);
      }
      light = light + add;
    }
  }

  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(params.light.rgb * light, 1.0);
}
