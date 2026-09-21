// The shared half of a raymarched ink: a camera, a sphere trace, the signed
// distance primitives and the operators over them, the three lighting terms
// that make a surface read as a solid, and the glint threshold. Prepended to
// an ink's own shader by `impls/RaymarchInk.ts`, the way `post.common.wgsl` is
// prepended to every post pass, so two raymarched inks cannot drift apart on
// the parts that are hard to get right and easy to copy wrong.
//
// **The one thing an ink must supply** is `sceneDistance(p: vec3<f32>) -> f32`,
// the distance from a point to its surface in world units. The march, the
// normal, the shadow and the occlusion below all call it. WGSL resolves
// module-scope names in any order, so calling a function the ink declares
// after this file ends is legal, which is what lets the shared half come
// first. The ink also owns its own uniform and its `fs` entry point; the
// fullscreen triangle is here, since every one of them wants the same one.
//
// Two things about the distance a new ink gets wrong first. A primitive below
// is a true distance only while nothing has scaled or displaced the space it
// is measured in: `opTwist`, `opBend` and any added surface detail all leave
// an estimate that is too long somewhere, and a march that steps by the whole
// of it then steps through the surface and the frame fills with holes. That is
// what `safety` in `rmMarch` is for, and an ink that displaces its surface
// passes something well under 1. And a distance that has been multiplied has
// to be divided back out, or every step after it is wrong by the same factor.

const RM_TAU = 6.28318530718;

// Rec. 709 luminance, the same weights the post stack and the fractal use, so
// a threshold here means the same thing as a threshold there.
const RM_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

// One oversized triangle covers the target; no vertex buffer, and the diagonal
// of a quad is never shaded twice. The ink reads `@builtin(position)` in its
// fragment entry point, so nothing is interpolated.
@vertex
fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let xy = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
  return vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
}

// The camera as three axes rather than a matrix: a ray marcher builds each ray
// from them directly and never needs a projection or its inverse. It mirrors
// `cameraBasis` in `gpu/math.ts` and `raymarchRay` in `impls/raymarch.params.ts`,
// which is the CPU copy the tests hold this to.
struct RmCamera {
  eye: vec3<f32>,
  forward: vec3<f32>,
  right: vec3<f32>,
  up: vec3<f32>,
  // The tangent of half the vertical field of view, and the width over the
  // height: the two numbers that turn a point on the target into a direction.
  lens: vec2<f32>,
}

fn rmCamera(eye: vec3<f32>, look: vec3<f32>, fov: f32, aspect: f32) -> RmCamera {
  let forward = normalize(look - eye);
  // Looking straight along the up axis leaves the cross product undefined, so
  // another axis is borrowed for that frame rather than handing back zeros.
  let steep = abs(forward.y) > 0.999;
  let reference = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(0.0, 0.0, 1.0), steep);
  let right = normalize(cross(forward, reference));
  var camera: RmCamera;
  camera.eye = eye;
  camera.forward = forward;
  camera.right = right;
  camera.up = cross(right, forward);
  camera.lens = vec2<f32>(tan(fov * 0.5), aspect);
  return camera;
}

// The direction through a point of the target, which runs -1 to 1 on both
// axes with y up.
//
// The field of view the camera names is the SHORT side's, and the long side
// opens past it by the aspect. So a wide canvas sees more of the scene either
// side and a tall one more above and below, rather than either seeing the same
// scene squashed, and a solid of a given size is the same size on any shape of
// canvas. It is the same rule the rest of the library sizes by: the short side
// is the one a share of the frame means anything against.
fn rmRay(camera: RmCamera, ndc: vec2<f32>) -> vec3<f32> {
  let aspect = max(camera.lens.y, 1.0e-4);
  let across = camera.right * ndc.x * camera.lens.x * max(aspect, 1.0);
  let along = camera.up * ndc.y * camera.lens.x * max(1.0 / aspect, 1.0);
  return normalize(camera.forward + across + along);
}

// Where a march stopped: how far it travelled, how many steps it spent, and
// whether it found anything. The step count is worth keeping because it is a
// free measure of how enclosed a point is, which `rmOcclusion` would otherwise
// pay four more distance samples for.
struct RmHit {
  travel: f32,
  steps: f32,
  hit: bool,
}

// The sphere trace. `epsilon` is the surface tolerance as a share of the
// distance travelled, so a far pixel is not marched to a precision no pixel
// could show; `safety` is the share of the reported distance one step takes,
// which is 1 for a true distance field and less for any that has been
// displaced. The early out on `far` is what makes a ray that misses cheap.
fn rmMarch(
  origin: vec3<f32>,
  direction: vec3<f32>,
  near: f32,
  far: f32,
  steps: i32,
  epsilon: f32,
  safety: f32,
) -> RmHit {
  var out: RmHit;
  out.travel = near;
  out.steps = 0.0;
  out.hit = false;
  for (var taken = 0; taken < steps; taken = taken + 1) {
    if (out.travel > far) {
      break;
    }
    let tolerance = epsilon * out.travel;
    let ahead = sceneDistance(origin + direction * out.travel);
    if (ahead < tolerance) {
      out.hit = true;
      break;
    }
    // Never a step of nothing: a grazing ray beside a surface would otherwise
    // spend the whole budget going nowhere.
    out.travel = out.travel + max(ahead * safety, tolerance);
    out.steps = out.steps + 1.0;
  }

  return out;
}

// The surface normal as a tetrahedral gradient: four distance samples rather
// than six, and isotropic, so a facet's normal is the same whichever way the
// solid is turned.
fn rmNormal(point: vec3<f32>, epsilon: f32) -> vec3<f32> {
  let a = vec3<f32>(1.0, -1.0, -1.0);
  let b = vec3<f32>(-1.0, -1.0, 1.0);
  let c = vec3<f32>(-1.0, 1.0, -1.0);
  let d = vec3<f32>(1.0, 1.0, 1.0);
  let gradient =
    a * sceneDistance(point + a * epsilon) + b * sceneDistance(point + b * epsilon) +
    c * sceneDistance(point + c * epsilon) + d * sceneDistance(point + d * epsilon);
  return gradient / max(length(gradient), 1.0e-6);
}

// A soft shadow along one ray, 0 in full shadow and 1 in full light. The
// penumbra comes free out of the distance field: the closest the ray passes to
// the surface, measured against how far it has gone, is how blurred the edge
// of the shadow is. `sharpness` is how hard that edge is, and a low number is
// a big soft light.
fn rmShadow(
  origin: vec3<f32>,
  direction: vec3<f32>,
  near: f32,
  far: f32,
  steps: i32,
  sharpness: f32,
) -> f32 {
  var shade = 1.0;
  var travel = near;
  for (var taken = 0; taken < steps; taken = taken + 1) {
    if (travel > far) {
      break;
    }
    let ahead = sceneDistance(origin + direction * travel);
    if (ahead < 1.0e-4) {
      return 0.0;
    }
    shade = min(shade, sharpness * ahead / travel);
    // Clamped, because an unbounded step walks past thin geometry and a step
    // of nothing spends the budget on the first millimetre.
    travel = travel + clamp(ahead, 0.02, 0.4);
  }

  return clamp(shade, 0.0, 1.0);
}

// Ambient occlusion the cheap way: walk a short distance along the normal and
// ask how much nearer the surface is than the walk. A crease answers that
// everything is near and darkens; an open face answers nothing and does not.
// Five taps, each worth less than the last.
fn rmOcclusion(point: vec3<f32>, normal: vec3<f32>, span: f32) -> f32 {
  var sum = 0.0;
  var weight = 1.0;
  for (var tap = 1; tap <= 5; tap = tap + 1) {
    let height = span * f32(tap);
    sum = sum + weight * (height - sceneDistance(point + normal * height));
    weight = weight * 0.62;
  }

  return clamp(1.0 - 1.6 * sum, 0.0, 1.0);
}

// How far round the edge of a solid a pixel is: 0 face on and 1 at the
// silhouette. It is what a rim light is multiplied by, and what makes a solid
// read as having an edge at all against a black frame.
fn rmFresnel(normal: vec3<f32>, ray: vec3<f32>, power: f32) -> f32 {
  return pow(1.0 - clamp(dot(normal, -ray), 0.0, 1.0), power);
}

// The threshold that keeps a full-frame ink out of the canvas's memory, which
// `docs/studies-handoff.md` sets out and the fractal was the first to carry.
// The canvas keeps most of itself every frame, so light that covers the frame
// is summed by the trail until the whole picture sits at the ceiling; an ink
// drops its own dim body here and adds only what clears the level.
//
// The level is worked out on the CPU against the brightest the ink can be this
// frame, because an absolute one would take a loud frame whole and a quiet one
// to black. `knee` is a share of the level rather than an absolute width, so
// the edge stays equally soft as the level moves with the music, and a soft
// edge is what stops the contour crawling as the surface turns through it.
//
// The whole colour is scaled by one number rather than each channel being
// limited, for the reason the post stack's ceiling gives: a per-channel limit
// pulls the three together and bleaches the light toward white.
fn rmGlint(light: vec3<f32>, level: f32, knee: f32) -> f32 {
  if (level <= 0.0) {
    return 1.0;
  }

  let soft = max(1.0e-5, level * knee);
  return smoothstep(level - soft, level + soft, dot(light, RM_LUMA));
}

// A turn of one plane, in radians. Every rotation a solid makes is two of
// these, so it is worth the four lines here rather than in each ink.
fn rmTurn(plane: vec2<f32>, angle: f32) -> vec2<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec2<f32>(c * plane.x - s * plane.y, s * plane.x + c * plane.y);
}

// The primitives, in Inigo Quilez's forms (iquilezles.org/articles/distfunctions).
// Each is an exact distance except the octahedron, which is the cheap bound,
// and each is centred on the origin so an ink places it by moving the point.

fn sdSphere(point: vec3<f32>, radius: f32) -> f32 {
  return length(point) - radius;
}

fn sdBox(point: vec3<f32>, bounds: vec3<f32>) -> f32 {
  let q = abs(point) - bounds;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn sdRoundBox(point: vec3<f32>, bounds: vec3<f32>, radius: f32) -> f32 {
  return sdBox(point, max(bounds - vec3<f32>(radius), vec3<f32>(0.0))) - radius;
}

fn sdTorus(point: vec3<f32>, ring: vec2<f32>) -> f32 {
  let q = vec2<f32>(length(point.xz) - ring.x, point.y);
  return length(q) - ring.y;
}

// The bound rather than the exact distance: it is never longer than the true
// one, which is all a march needs, and it is three adds and a multiply.
fn sdOctahedron(point: vec3<f32>, size: f32) -> f32 {
  let q = abs(point);
  return (q.x + q.y + q.z - size) * 0.57735027;
}

fn sdCapsule(point: vec3<f32>, a: vec3<f32>, b: vec3<f32>, radius: f32) -> f32 {
  let along = point - a;
  let axis = b - a;
  let at = clamp(dot(along, axis) / max(dot(axis, axis), 1.0e-6), 0.0, 1.0);
  return length(along - axis * at) - radius;
}

fn sdPlane(point: vec3<f32>, normal: vec3<f32>, height: f32) -> f32 {
  return dot(point, normal) + height;
}

// The operators. Union, subtraction and intersection are exact outside the
// shapes and conservative inside, which is the usual trade and is why a march
// from outside is safe.

fn opUnion(a: f32, b: f32) -> f32 {
  return min(a, b);
}

// What is left of `b` once `a` has been taken out of it.
fn opSubtract(a: f32, b: f32) -> f32 {
  return max(-a, b);
}

fn opIntersect(a: f32, b: f32) -> f32 {
  return max(a, b);
}

// Quilez's quadratic polynomial smooth minimum (iquilezles.org/articles/smin).
// `k` is the width of the blended band in world units, so a solid keeps its
// own shape everywhere but there. It is commutative and not associative, so a
// chain of three is not the same as any other order of the three, and it
// under-estimates the distance outside the band, which is one more reason a
// march over it takes less than a whole step.
fn smoothMin(a: f32, b: f32, k: f32) -> f32 {
  if (k <= 0.0) {
    return min(a, b);
  }

  let width = k * 4.0;
  let h = max(width - abs(a - b), 0.0) / width;
  return min(a, b) - h * h * width * 0.25;
}

fn opSmoothUnion(a: f32, b: f32, k: f32) -> f32 {
  return smoothMin(a, b, k);
}

// A twist about the y axis, `turns` of it over one unit of height. The space
// is sheared rather than scaled, so the distance that comes back is too long
// where the twist is tightest; march it with a safety under 1.
fn opTwist(point: vec3<f32>, turns: f32) -> vec3<f32> {
  let plane = rmTurn(point.xz, turns * point.y * RM_TAU);
  return vec3<f32>(plane.x, point.y, plane.y);
}

// A bend about the z axis, `k` radians over one unit along x. The same warning
// as the twist: the distance is an over-estimate where the bend is tightest.
fn opBend(point: vec3<f32>, k: f32) -> vec3<f32> {
  let plane = rmTurn(point.xy, k * point.x);
  return vec3<f32>(plane.x, plane.y, point.z);
}

// The same shape every `period` along each axis, which is one primitive drawn
// everywhere for the cost of one. A period of 0 on an axis leaves that axis
// alone, so a lattice, a row and a plane of shapes are all one call.
fn opRepeat(point: vec3<f32>, period: vec3<f32>) -> vec3<f32> {
  let safe = max(period, vec3<f32>(1.0e-4));
  let folded = point - safe * round(point / safe);
  return select(point, folded, period > vec3<f32>(0.0));
}
