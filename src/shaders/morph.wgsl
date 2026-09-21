// One solid in the middle of the frame that turns and melts from form to
// form, which is the `morph` ink. It is built on the raymarch kit: the camera,
// the sphere trace, the primitives, the normal, the shadow, the occlusion, the
// fresnel and the brightness threshold are all `raymarch.common.wgsl`, which
// `impls/RaymarchInk.ts` prepends to this file. What is here is the solid
// itself and the light on it.
//
// The CPU has already chosen the two forms, stepped the melt, turned the
// palette into two light colours and worked out the level the light is cut at,
// in `impls/morph.params.ts`, which is where the reasoning is and what the
// tests measure. Keep the two in step.
//
// Everything is marched into a target half the size of the ink target and
// scaled back up, so what `screen` says is that target and not the canvas.

struct Params {
  // The marched target in pixels, its width over its height, and the ripple's
  // clock in seconds.
  screen: vec4<f32>,
  // Where the eye stands, and the vertical field of view in radians. It looks
  // at the origin and does not move: the solid is what turns.
  camera: vec4<f32>,
  // The form being left, the form being arrived at, how far between them, and
  // the solid's bounding radius in world units.
  form: vec4<f32>,
  // The spin and the tumble in turns, then the ripple's amplitude in world
  // units and its frequency in waves across one.
  motion: vec4<f32>,
  // The rim light above its base, the specular, the light, and the luminance
  // the light is cut at.
  light: vec4<f32>,
  // The key light's colour, and the threshold's knee as a share of the level.
  key: vec4<f32>,
  // The rim light's colour, and the march's step budget.
  rim: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;

// The two lights, as directions from the surface toward each light. Written
// out already normalised, since a module constant may not call a function.
// The key is up, left and toward the camera (-0.55, 0.78, -0.62). The rim is
// two lights of one colour rather than one, at (0.85, 0.12, 0.5) and
// (-0.8, -0.25, 0.55): right and behind, left and below and behind. That is
// the studio setup the study was built to, a coloured key and a pair of rim
// strips at 45 degrees, and the pair is what draws the outline all the way
// round instead of down one side. A single light straight behind reaches
// nothing that can be seen at all, since every face that is drawn faces the
// camera. It is the two-gel studio setup:
// one light shapes the form, one draws its outline, and nothing fills in
// between, which is what keeps the dark faces black.
const KEY_DIR = vec3<f32>(-0.4832, 0.6853, -0.5447);
const RIM_RIGHT = vec3<f32>(0.8556, 0.1208, 0.5033);
const RIM_LEFT = vec3<f32>(-0.798, -0.2494, 0.5486);

// What the fresnel outline carries at a `rim` of 0, so the edge never goes
// out. Mirrors RIM_BASE in morph.params.ts.
const RIM_BASE = 0.6;
// What the far side of the terminator keeps of the rims' colour. Mirrors
// RIM_WRAP.
const RIM_WRAP = 0.22;
// How much of the light a face square to the key light carries, against the
// edge and the highlight. Mirrors BODY.
const BODY = 0.08;
// How far the specular is pulled to white. Mirrors SPECULAR_WHITE.
const SPECULAR_WHITE = 0.65;
// The last multiply on the colour. Mirrors MORPH_LIGHT.
const MORPH_LIGHT = 2.0;
// The share of the reported distance one march step takes. Mirrors MARCH_SAFETY.
const MARCH_SAFETY = 0.55;
// How tight the highlight is. A hard, small highlight is what reads as a
// polished solid rather than as a lit cloud.
const GLOSS = 48.0;
// The fresnel powers the rim knob runs between: a hairline edge and a broad
// wrapped one.
const RIM_TIGHT = 10.0;
const RIM_WIDE = 3.0;
// The surface tolerance and the normal's sample spacing, both as a share of
// how far the ray has gone, so a far pixel is not marched to a precision it
// could not show.
const SURFACE = 0.0012;
const NORMAL_STEP = 0.0016;

// The six forms, to the same bounding radius so a melt does not change how
// much of the frame is filled. The order is `FORMS` in morph.params.ts.
fn formDistance(form: i32, point: vec3<f32>, size: f32) -> f32 {
  switch (form) {
    case 1: {
      return sdRoundBox(point, vec3<f32>(size * 0.58), size * 0.22);
    }
    case 2: {
      return sdOctahedron(point, size);
    }
    case 3: {
      return sdTorus(point, vec2<f32>(size * 0.7, size * 0.3));
    }
    case 4: {
      let reach = size * 0.6;
      return sdCapsule(
        point,
        vec3<f32>(0.0, -reach, 0.0),
        vec3<f32>(0.0, reach, 0.0),
        size * 0.4,
      );
    }
    case 5: {
      return sdBox(point, vec3<f32>(size * 0.58));
    }
    default: {
      return sdSphere(point, size);
    }
  }
}

// The one function the kit's march, normal, shadow and occlusion all call.
fn sceneDistance(point: vec3<f32>) -> f32 {
  // Into the solid's own frame. The camera is still and the solid turns, so
  // the rotation is applied to the point and never to the ray.
  let turned = rmTurn(point.xz, fract(params.motion.x) * RM_TAU);
  let tipped = rmTurn(vec2<f32>(point.y, turned.y), fract(params.motion.y) * RM_TAU);
  let q = vec3<f32>(turned.x, tipped.x, tipped.y);

  let leaving = formDistance(i32(params.form.x + 0.5), q, params.form.w);
  let arriving = formDistance(i32(params.form.y + 0.5), q, params.form.w);
  let melt = params.form.z;

  // The melt is two things at once. Mixing the two distances walks one form
  // into the other and is exactly each of them at the ends; smooth-unioning
  // them holds both at once with a soft weld between. The weld is folded in
  // only in the middle of the melt, where its weight peaks at 1 and falls to
  // nothing at either end, so what is seen is one solid growing out of
  // another rather than one picture cross-fading into a second.
  let walked = mix(leaving, arriving, melt);
  let welded = smoothMin(leaving, arriving, params.form.w * 0.22);
  let bulge = 4.0 * melt * (1.0 - melt);
  let solid = mix(walked, welded, bulge);

  // The ripple: three sines travelling over the surface, their product, so the
  // crests are islands rather than stripes. Its amplitude is held against its
  // frequency on the CPU, so the displaced field is still something the march
  // can step over.
  let k = params.motion.w;
  let clock = params.screen.w;
  let wave =
    sin(q.x * k + clock * 1.7) * sin(q.y * k * 1.13 - clock * 1.3) *
    sin(q.z * k * 0.87 + clock * 1.1);
  return solid - params.motion.z * wave;
}

@fragment
fn fs(@builtin(position) frag: vec4<f32>) -> @location(0) vec4<f32> {
  // No light is no solid. The gate is already in the intensity, so a packet
  // fading in fades the solid in with it and silence draws nothing.
  if (params.light.z <= 0.0) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let size = params.screen.xy;
  // -1 to 1 on both axes with y up; the framebuffer counts y down.
  let ndc = vec2<f32>((frag.x * 2.0 - size.x) / size.x, (size.y - frag.y * 2.0) / size.y);
  let camera = rmCamera(params.camera.xyz, vec3<f32>(0.0), params.camera.w, params.screen.z);
  let ray = rmRay(camera, ndc);

  // The solid is bounded, so the march has a far plane of its own: past the
  // eye's distance plus the solid's reach there is nothing left to hit, and a
  // ray that misses stops there rather than spending the step budget.
  let reach = params.form.w + params.motion.z;
  let far = length(params.camera.xyz) + reach + 0.2;
  let hit = rmMarch(camera.eye, ray, 0.1, far, i32(params.rim.w + 0.5), SURFACE, MARCH_SAFETY);
  if (!hit.hit) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let point = camera.eye + ray * hit.travel;
  let normal = rmNormal(point, max(0.002, hit.travel * NORMAL_STEP));

  // The key light shapes the form: a face square to it is lit, a face turned
  // away is black, and the solid shadows itself, which is what makes a torus
  // read as a ring and not as a disc.
  let diffuse = max(0.0, dot(normal, KEY_DIR));
  let shade = rmShadow(point + normal * 0.015, KEY_DIR, 0.02, 3.0, 24, 10.0);
  let occlusion = rmOcclusion(point, normal, params.form.w * 0.18);

  // The rim lights do two separate jobs, and the study needs both.
  //
  // The wrap is the far side of the terminator taking the rims' colour: a
  // back light reaches round a curve, so the dark half is not black but a
  // deep wash of the second hue. It is small, because it is a wash.
  let right = max(0.0, dot(normal, RIM_RIGHT) * 0.5 + 0.5);
  let left = max(0.0, dot(normal, RIM_LEFT) * 0.5 + 0.5);
  // The stronger of the two rather than their sum, so the pair cannot add up
  // past what one light is worth and the peak the threshold is measured
  // against stays a true ceiling.
  let reached = max(right * right, left * left);
  //
  // The outline is the fresnel edge, and it is the brightest thing on the
  // solid after the highlight. It is what draws the form on a black frame,
  // and it is what the canvas's memory is meant to keep: a thin hot edge
  // sweeping as the solid turns leaves a light trail, where a filled body
  // leaves a smudge. The knob widens the band and strengthens it at once, so
  // a loud passage gets a broader, hotter edge without the light climbing.
  let width = mix(RIM_TIGHT, RIM_WIDE, clamp(params.light.x, 0.0, 1.0));
  let outline = rmFresnel(normal, ray, width) * reached;
  let rimLight = RIM_WRAP * reached + (RIM_BASE + params.light.x) * outline;

  // The specular passes 1 on purpose, so the bloom catches it.
  let gloss = pow(max(0.0, dot(reflect(ray, normal), KEY_DIR)), GLOSS);
  let hot = mix(params.key.rgb, vec3<f32>(1.0), SPECULAR_WHITE);

  // The body is held well under the edges. A lit face covers a large part of
  // the frame and sits still while the solid turns, so on a canvas that keeps
  // most of itself every frame it is the one term that can sum into a flat
  // mass; the edge and the highlight move across the frame and streak. The
  // two colours are added rather than mixed, and only the highlight goes near
  // white, so neither hue is diluted by the other.
  let colour =
    params.key.rgb * (diffuse * shade * occlusion * BODY) + params.rim.rgb * rimLight +
    hot * gloss * params.light.y;
  let light = colour * params.light.z * MORPH_LIGHT;

  // The threshold last, so what enters the canvas is the lit part of the
  // solid and the frame keeps its blacks however long the trails hold.
  return vec4<f32>(light * rmGlint(light, params.light.w, params.key.w), 1.0);
}
