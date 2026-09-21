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
// The key is up, well to the left, and a little behind the plane the solid
// sits in (-0.88, 0.45, 0.15). The last of those three numbers is the one
// that matters: with the light in front of that plane every surface facing
// the camera is lit, which is most of what can be seen, and the study has no
// dark side to read against. Behind it, the terminator crosses the solid and
// about a third of the silhouette falls to nothing. The rim is
// two lights of one colour rather than one, at (0.85, 0.12, 0.5) and
// (-0.8, -0.25, 0.55): right and behind, left and below and behind. That is
// the studio setup the study was built to, a coloured key and a pair of rim
// strips at 45 degrees, and the pair is what draws the outline all the way
// round instead of down one side. A single light straight behind reaches
// nothing that can be seen at all, since every face that is drawn faces the
// camera. It is the two-gel studio setup:
// one light shapes the form, one draws its outline, and nothing fills in
// between, which is what keeps the dark faces black.
const KEY_DIR = vec3<f32>(-0.8892, 0.4547, 0.0505);
const RIM_RIGHT = vec3<f32>(0.8556, 0.1208, 0.5033);
const RIM_LEFT = vec3<f32>(-0.798, -0.2494, 0.5486);

// What the fresnel outline carries at a `rim` of 0. Over 1 on purpose: the
// outline is the brightest thing on the solid after the highlight, and the
// bloom has to catch it. Mirrors RIM_BASE in morph.params.ts.
const RIM_BASE = 1.8;
// How much of the outline reaches the side the key light owns. The rims stand
// behind the solid, so the far side gets all of it, but an outline that stops
// at the terminator is half an outline. Mirrors RIM_FRONT.
const RIM_FRONT = 0.45;
// The dimmest a lit face may be, as a share of one square to the key light.
// The lit side is lit whole: the gradient across it runs from here to 1 and
// the dark side is exactly nothing. Mirrors SHADE_FLOOR.
const SHADE_FLOOR = 0.5;
// How soft the terminator is, in cosine units. Small: a hard shadow edge is
// what puts the dark side at true black instead of a wash. Mirrors TERMINATOR.
const TERMINATOR = 0.035;
// How much of the body the outline takes at the silhouette. Mirrors EDGE_GIVE.
const EDGE_GIVE = 0.9;
// How far the specular is pulled to white. A highlight is the light, not the
// paint. Mirrors SPECULAR_WHITE.
const SPECULAR_WHITE = 0.65;
// The last multiply on the colour. Mirrors MORPH_LIGHT.
const MORPH_LIGHT = 2.0;
// The share of the reported distance one march step takes. Mirrors MARCH_SAFETY.
const MARCH_SAFETY = 0.55;
// How tight the highlight is. A hard, small highlight is what reads as a
// polished solid rather than as a lit cloud.
const GLOSS = 48.0;
// Where the outline's band starts, in the fresnel's own units, at the two
// ends of the rim knob.
//
// A power on the fresnel is the wrong shape for this: a high one is a two
// percent hairline the upscale loses, and a low one is not a band at all but
// a wash over the whole solid, which is what the second cut drew. A
// smoothstep from here to the silhouette is a band of a stated width. On a
// sphere the fraction `f` of the radius from the edge sits at a fresnel of
// `1 - sqrt(1 - (1 - f)^2)`, so 0.53 is the outer 12 percent and 0.43 the
// outer 18, which is the width the study was asked for.
const RIM_NARROW = 0.53;
const RIM_BROAD = 0.43;
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

// Whether the ripple is part of the field this call measures. The march, the
// shadow and the occlusion all want the displaced surface, which is the one
// that is really there; the shading normal does not, because a facet's normal
// has to be the face's for the planes to read as flat steps of brightness and
// a ripple crawling over a box turns every plane into a gradient. Module
// state rather than a parameter, because the kit's `rmNormal` calls
// `sceneDistance` with one argument and should not have to know.
var<private> rippled = true;

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
  if (!rippled) {
    return solid;
  }

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
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
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
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }

  let point = camera.eye + ray * hit.travel;
  // Off for the normal and on again for everything after it: see `rippled`.
  rippled = false;
  let normal = rmNormal(point, max(0.002, hit.travel * NORMAL_STEP));
  rippled = true;

  // The key light shapes the form, and it does it with a hard terminator: the
  // lit side is lit whole, from `SHADE_FLOOR` at the edge of the light to 1
  // square to it, and the dark side is exactly nothing. That split is what
  // makes a solid read as a solid, and it is also what keeps the ink sparse:
  // a third of the silhouette adds no light at all, so the canvas keeps its
  // blacks without a brightness threshold carving the modelling away, which
  // is what the first two cuts of this study did.
  let lambert = dot(normal, KEY_DIR);
  let side = smoothstep(-TERMINATOR, TERMINATOR, lambert);
  let shaped = SHADE_FLOOR + (1.0 - SHADE_FLOOR) * sqrt(max(lambert, 0.0));
  let shade = rmShadow(point + normal * 0.015, KEY_DIR, 0.02, 3.0, 24, 10.0);
  let occlusion = rmOcclusion(point, normal, params.form.w * 0.18);
  let diffuse = side * shaped * shade * occlusion;

  // The outline is the fresnel edge, in the second hue, and it is the
  // brightest thing on the solid after the highlight. It is what draws the
  // form against a black frame and what the canvas's memory keeps: a band
  // sweeping as the solid turns leaves a light trail where a filled body
  // leaves a smudge. The knob widens the band and strengthens it at once, so
  // a loud passage gets a broader, hotter edge without the light climbing.
  let inner = mix(RIM_NARROW, RIM_BROAD, clamp(params.light.x, 0.0, 1.0));
  let facing = smoothstep(inner, 1.0, rmFresnel(normal, ray, 1.0));
  // The two rims stand behind the solid, so the far side takes all of the
  // band and the near side `RIM_FRONT` of it. Wrapped rather than a plain dot
  // product, because a back light reaches round a curve.
  let right = max(0.0, dot(normal, RIM_RIGHT) * 0.5 + 0.5);
  let left = max(0.0, dot(normal, RIM_LEFT) * 0.5 + 0.5);
  let reached = max(right * right, left * left);
  let rimLight = (RIM_BASE + params.light.x) * facing * (RIM_FRONT + (1.0 - RIM_FRONT) * reached);

  // The body gives the edge up to the outline. A surface seen at a grazing
  // angle reflects rather than scatters, so dimming the diffuse where the
  // fresnel rises is what a real one does, and it is also what stops the two
  // hues mixing into one along the band: inside the solid the key's colour
  // owns the pixel, in the band the rim's does.

  // The specular passes 1 on purpose, so the bloom catches it. It is the one
  // term allowed near white.
  let gloss = pow(max(0.0, dot(reflect(ray, normal), KEY_DIR)), GLOSS);
  let hot = mix(params.key.rgb, vec3<f32>(1.0), SPECULAR_WHITE);

  // The two colours are added and never mixed, so neither hue is diluted by
  // the other: the lit side is the key's hue, the outline is the rim's, and
  // only the highlight is white.
  let grazing = 1.0 - EDGE_GIVE * facing;
  let colour =
    params.key.rgb * (diffuse * grazing) + params.rim.rgb * rimLight +
    hot * gloss * params.light.y;
  let light = colour * params.light.z * MORPH_LIGHT;

  // The threshold last, and it has little left to do: the dark side is
  // already nothing, so this only clears the fringe where the terminator and
  // the outline fall away.
  //
  // The alpha channel carries whether this pixel is inside the solid. The ink
  // blend adds the colour and leaves the target's alpha alone (`INK_BLEND` in
  // scenes/Impl.ts), so nothing downstream sees it, and a harness reading the
  // marched target back has the silhouette for free, which is what the
  // brightness measurements in docs/studies/shape-morph.md are counted over.
  return vec4<f32>(light * rmGlint(light, params.light.w, params.key.w), 1.0);
}
