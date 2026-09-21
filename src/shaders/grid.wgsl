// The neon grid floor to the horizon, added into the scene's target before the
// feedback pass adds the history, so what is drawn here is fresh light the
// trails then carry. height.common.wgsl is prepended: it owns bindings 0 and 1
// and gives the ground each pixel looks at, its height and slope, and the fog.
// This owns binding 2 and everything about what a line looks like.
//
// One fullscreen triangle. Lines are analytic. For each pixel the march finds
// the ground point it looks at, that point's coordinates in cells are the
// whole of the drawing, and `fwidth` says how many cells one pixel spans, so
// the distance to the nearest line is a number of pixels and the line's light
// is a function of it: a core that is anti-aliased by falling across one
// pixel, a hot white spine down its middle and a tight glow in the colour
// round it. Nothing is a texture, so nothing shimmers at 4K, and a line that
// a pixel spans too much of fades out (`line_detail`) instead of aliasing.
// The CPU mirror is `lineLight`, `lineDetail` and `lineThinning` in
// grid.params.ts; keep them in step, the tests measure the TypeScript.
//
// The light is fogged to exactly nothing at `reach`, so between the lines and
// past them is true black. The horizon is drawn apart from the lines, since
// the lines have faded before they get there: a hairline and a glow band in
// the far hue.
//
// Uniformity: `fwidth` needs every pixel of a quad to reach it together, so the
// march has no early exit and nothing between it and the derivative returns.

struct Look {
  // The near hue and the far hue in turns, the intensity, and the glow's sigma
  // in pixels.
  light: vec4<f32>,
  // A line's half width in pixels at the camera, the cell, the fog's reach, and
  // the horizon's light as a share of the intensity.
  line: vec4<f32>,
  // The lines' phase in cells' worth of travel, the pulse's place in
  // 1 / distance, its width in the same, and its strength.
  motion: vec4<f32>,
  // How far the horizon's glow reaches above the line in half-heights, the
  // speed a crossing line starts to fade at and is at its floor by (pixels a
  // second), and the flight in cells a second.
  sky: vec4<f32>,
}

@group(0) @binding(2) var<uniform> look: Look;

// How much of a line's own light its glow has at the line's edge.
const HALO_GAIN: f32 = 0.28;
// A pixel that spans this many cells has lines too fine to resolve: they are
// whole at the start and gone at the end.
const LOD_START: f32 = 0.16;
const LOD_END: f32 = 0.48;
// The lines that run into the distance pack together toward the vanishing
// point, and are gone sooner: a pixel that spans this many cells across.
const LOD_ACROSS_START: f32 = 0.04;
const LOD_ACROSS_END: f32 = 0.16;
// The moving lines' glow is this share of the still lines'. What a moving
// line leaves in the canvas is in proportion to all of it, the body
// included, so the body is kept small and the hot core carries the line.
const MOVING_GLOW: f32 = 0.35;
// How much brighter a line is on the tallest, hottest ground, and how much a
// slope facing the camera adds.
const HEAT_LIFT: f32 = 1.4;
const FACING_LIFT: f32 = 0.5;
// A crossing line that moves across the frame faster than `sky.y` pixels a
// second is drawn fainter and at `sky.z` is at this share of its light, since
// the canvas keeps what was drawn and a fast line leaves a second line behind
// it and not a blur.
const MOTION_FLOOR: f32 = 0.02;

// The lines that run into the distance stand still on the screen while the
// ground is flat, and the canvas sums a still mark to about forty times what
// is drawn, so they are drawn at this share of the lines that cross them.
const STATIC_LINE: f32 = 0.14;

// How much of the crossing lines' light is taken away as they pack together:
// none while a pixel spans `CROWD_START` cells or fewer, `CROWD` of it by
// `CROWD_END`.
const CROWD: f32 = 0.9;
const CROWD_START: f32 = 0.03;
const CROWD_END: f32 = 0.12;

// A fully saturated hue, brightest channel at 1: three cosines a third of a
// turn apart. At 1/6 it is magenta and at 1/2 cyan, which is the two ends of
// the grid. The shared palette is one colour at a time and this is two.
fn vivid(turns: f32) -> vec3<f32> {
  let c = 0.5 + 0.5 * cos(6.2831853 * (turns + vec3<f32>(0.0, 0.3333, 0.6667)));
  let sat = c * c;
  return sat / max(max(sat.r, sat.g), max(sat.b, 1e-4));
}

// A line's light at `to_line` pixels from its centre: (core, glow). The core
// is full inside the half width and falls across one pixel to nothing.
fn line_light(to_line: f32, half_px: f32, glow_px: f32) -> vec2<f32> {
  // The overlap of the line's width with the pixel's, so a line thinner than a
  // pixel is dimmer and not a full pixel wide: never more than its own width.
  let core = clamp(min(2.0 * half_px, half_px + 0.5 - to_line), 0.0, 1.0);
  let beyond = max(to_line - half_px, 0.0);
  let glow = HALO_GAIN * exp(-(beyond * beyond) / (2.0 * glow_px * glow_px));
  return vec2<f32>(core, glow);
}

fn line_detail(footprint: f32) -> f32 {
  return 1.0 - smoothstep(LOD_START, LOD_END, footprint);
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
  let reach = look.line.z;

  // Pixels at or above the horizon look at no ground. What they get is the
  // horizon's glow and nothing else.
  var ground = HeightHit(0.0, 1.0, 0.0, 0.0);
  if (height_view.screen.z - ndc.y > 0.0) {
    ground = height_march(ndc);
  }

  // The ground point in cells, and how many cells a pixel spans each way.
  let cell = look.line.y;
  let g = vec2<f32>(ground.x / cell, (look.motion.x + ground.dz) / cell);
  let footprint = max(fwidth(g), vec2<f32>(1e-5));
  let to_line = abs(fract(g + 0.5) - 0.5) / footprint;

  // Lines thin as they recede, and the pixel-wide floor of the core is what
  // keeps a far line a faint one rather than a gap.
  let thin = mix(1.0, 0.5, smoothstep(4.0, reach * 0.6, ground.dz));
  let half_px = look.line.x * thin;
  let across = line_light(to_line.x, half_px, look.light.w);
  let along = line_light(to_line.y, half_px, look.light.w * MOVING_GLOW);
  let detail = vec2<f32>(
    1.0 - smoothstep(LOD_ACROSS_START, LOD_ACROSS_END, footprint.x),
    line_detail(footprint.y),
  );
  // A line that moves leaves a trail as long as its speed times the canvas's
  // memory, which is about a cell a second's worth of cells, wherever it is,
  // while the gap between two of them shrinks with distance. So the further
  // the crossing lines are packed, the fainter they are drawn.
  let crowd = 1.0 - CROWD * smoothstep(CROWD_START, CROWD_END, footprint.y);
  // How fast a crossing line moves on screen: the flight in cells a second over
  // the cells a pixel spans along the ground.
  let across_speed = look.sky.w / footprint.y;
  let motion = 1.0 - (1.0 - MOTION_FLOOR) * smoothstep(look.sky.y, look.sky.z, across_speed);
  let sparse = crowd * motion;
  let core = STATIC_LINE * across.x * detail.x + sparse * along.x * detail.y;
  let halo = STATIC_LINE * across.y * detail.x + sparse * along.y * detail.y;
  // How close to the middle of a line this pixel is, for the white-hot spine.
  let spine = max(
    clamp(1.0 - to_line.x / (half_px + 0.5), 0.0, 1.0) * detail.x,
    clamp(1.0 - to_line.y / (half_px + 0.5), 0.0, 1.0) * detail.y,
  );

  // The music in the ground: how much of it is here, how tall the ground is
  // here as a share of the most it can be, and whether the slope faces us.
  var heat = 0.0;
  var facing = 0.0;
  if (ground.hit > 0.0) {
    let level = height_level(ground.x, ground.dz);
    let slope = height_slope(ground.x, ground.dz);
    let tall = clamp(ground.h / max(height_view.field.z * height_view.shape.y, 1e-3), 0.0, 1.0);
    heat = clamp(level * 0.9 + tall * 0.5, 0.0, 1.0);
    facing = clamp(slope.y * 2.0, 0.0, 1.0);
  }

  // The pulse is a band in 1 / distance, which is a band of steady thickness on
  // screen. It lights the lines it is over, past the fog, so it is seen to come
  // in from the horizon.
  let inverse_dz = 1.0 / max(ground.dz, 0.05);
  let band = (inverse_dz - look.motion.y) / look.motion.z;
  let flare = look.motion.w * exp(-band * band) * ground.hit;

  // Colour is graded along the distance from the near hue to the far one, and
  // the hot middle of a line, the hot ground and the pulse all pull it to white.
  let tint = mix(vivid(look.light.x), vivid(look.light.y), smoothstep(6.0, 30.0, ground.dz));
  let white = clamp(spine * spine * 0.9 + heat * 0.25 + flare * 0.7, 0.0, 1.0);
  let core_colour = mix(tint, vec3<f32>(1.0), white);

  let fog = mix(height_fog(ground.dz, reach), 1.0, clamp(flare, 0.0, 1.0) * 0.85);
  let lift = 1.0 + HEAT_LIFT * heat + FACING_LIFT * facing + 3.0 * flare;
  let lines = (core_colour * core + tint * halo) * look.light.z * fog * lift * ground.hit;

  // The horizon: a hairline exactly at it and a glow band round it, the far
  // hue with a white heart. It flares as the pulse sets off from it.
  let glow = height_horizon_glow(ndc.y, look.sky.x);
  let launch = look.motion.w * exp(-max(look.motion.y - 0.017, 0.0) * 50.0);
  let horizon = mix(vivid(look.light.y), vec3<f32>(1.0), 0.5 * glow.x)
    * (glow.x * 0.9 + glow.y * 0.35)
    * look.light.z
    * look.line.w
    * (1.0 + 1.5 * launch);

  // Additive, and the blend leaves alpha alone, so this is light and nothing else.
  return vec4<f32>(lines + horizon, 1.0);
}
