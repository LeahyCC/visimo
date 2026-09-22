// The pool itself: one invocation a particle, spawning it if this frame's ring
// window reached its slot and otherwise moving it. Nothing here comes back to
// the CPU and nothing is allocated per frame; the only thing the CPU decides is
// what goes in the uniform.
//
//   clear_grid ──► bin ──► step
//
// The two binning passes are only encoded when the boids terms are live, since
// they are the only thing that reads the grid. `step` runs on every frame the
// field is drawn at all.
//
// The integration is the one in particles.params.ts, term for term: drag in
// closed form because that is the term that decides whether two frame rates
// agree, and symplectic Euler for everything else.

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read_write> pool: array<Particle>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> slots: array<u32>;
@group(0) @binding(4) var flow: texture_2d<f32>;
@group(0) @binding(5) var samp: sampler;

const GRID_SLOTS: u32 = 8u;

// A turn is measured as radians a second and scaled to 0 to 1 by this, and the
// reading is smoothed over the second constant, so a fold is a wave of light
// that lasts a moment and not a flicker of one frame. 3.5 radians a second is
// a bird turning through a right angle in about 0.45 s, which a fold reaches and
// a flock cruising does not.
const TURN_FULL: f32 = 3.5;
const TURN_SETTLE: f32 = 0.15;

// How many living birds a flock birth looks for before it gives up and lands
// on the attractor. A pool that is mostly alive finds one at the first try.
const KIN_TRIES: i32 = 8;

// Neighbours at touching that make a separation of one, see `steer`.
const CROWD: f32 = 4.0;

/**
 * Where the grid sits this frame, as a fraction of one cell in each direction.
 * Every bird in a cell reads the same nine cells, so with a fixed grid a dense
 * flock moves in cell-sized blocks and draws a lattice. Moving the grid by a
 * different fraction each frame makes the blocks a different shape every
 * frame, and the eye takes the average of them. Both passes that read the grid
 * ask this and get the same answer, since it depends on the clock alone.
 */
fn gridShift() -> vec2<f32> {
  let frame = i32(params.step.y * 60.0);
  return vec2<f32>(
    f32(hash_u(frame, 0, 41)) / 4294967296.0,
    f32(hash_u(frame, 0, 42)) / 4294967296.0,
  );
}

/** Which cell of the uniform grid a place falls in, clamped at the edge. */
fn cellOf(place: vec2<f32>) -> vec2<i32> {
  let side = params.cover.w;
  let cell = max(params.step.w, 1e-4);
  // The grid is centred on the canvas and its cell is the neighbourhood, so
  // the nine cells a particle reads always cover everything within reach.
  let at = floor((place / cell) + side * 0.5 + gridShift());
  return clamp(vec2<i32>(at), vec2<i32>(0, 0), vec2<i32>(i32(side) - 1, i32(side) - 1));
}

fn cellIndex(cell: vec2<i32>) -> u32 {
  return u32(cell.y) * u32(params.cover.w) + u32(cell.x);
}

@compute @workgroup_size(64)
fn clear_grid(@builtin(global_invocation_id) gid: vec3<u32>) {
  let side = u32(params.cover.w);
  if (gid.x >= side * side) { return; }
  atomicStore(&counts[gid.x], 0u);
}

@compute @workgroup_size(64)
fn bin(@builtin(global_invocation_id) gid: vec3<u32>) {
  let live = u32(params.step.z);
  if (gid.x >= live) { return; }
  let particle = pool[gid.x];
  if (particle.span.y <= 0.0) { return; }
  let cell = cellIndex(cellOf(particle.place.xy));
  let slot = atomicAdd(&counts[cell], 1u);
  // A crowded cell drops what it cannot hold rather than growing. The three
  // steering terms are averages, so a sample of eight neighbours says nearly
  // what all of them would; an unbounded cell would need a prefix sum and a
  // second dispatch to say the same thing.
  if (slot < GRID_SLOTS) {
    slots[cell * GRID_SLOTS + slot] = gid.x;
  } else {
    // Which eight are kept has to change every frame. The first eight in
    // would be the same eight every time, and everything near a crowded cell
    // would then steer toward those birds and not toward the crowd, which
    // draws a lattice of anchors across a dense flock. This is reservoir
    // sampling: the bird that is slot n takes a random one of the eight with
    // the chance 8 / (n + 1), so every bird in a cell is as likely as any other
    // to be one of the eight, and a fresh seed each frame moves them on.
    let pick = hash_u(i32(gid.x), i32(params.step.y * 60.0), 40) % (slot + 1u);
    if (pick < GRID_SLOTS) { slots[cell * GRID_SLOTS + pick] = gid.x; }
  }
}

/** Value noise at a point, the same four smoothed corners the CPU mirror takes. */
fn valueNoise(p: vec2<f32>) -> f32 {
  let cell = floor(p);
  let f = p - cell;
  let s = f * f * (3.0 - 2.0 * f);
  let x = i32(cell.x);
  let y = i32(cell.y);
  let a = hash01(x, y, 11);
  let b = hash01(x + 1, y, 11);
  let c = hash01(x, y + 1, 11);
  let d = hash01(x + 1, y + 1, 11);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

/**
 * The curl of that noise, which is a velocity field with nothing flowing into
 * or out of any point, so a particle riding it is stirred rather than gathered
 * into a sink. The clock walks the field instead of scaling it, so the swirl
 * drifts at a steady pace rather than breathing.
 */
fn curlNoise(p: vec2<f32>, time: f32) -> vec2<f32> {
  let e = 0.01;
  let at = vec2<f32>(p.x, p.y + time * 0.1);
  let dx = (valueNoise(vec2<f32>(at.x, at.y + e)) - valueNoise(vec2<f32>(at.x, at.y - e))) / (2.0 * e);
  let dy = (valueNoise(vec2<f32>(at.x + e, at.y)) - valueNoise(vec2<f32>(at.x - e, at.y))) / (2.0 * e);
  return vec2<f32>(dx, -dy);
}

/**
 * The live flow's velocity under a place, in short sides a second. The field is
 * square and covers the canvas with the overflow cropped, which is what
 * `cover` undoes, and its velocity is in field widths a second, which the same
 * two numbers turn back into canvas uv a second.
 */
fn flowAt(place: vec2<f32>) -> vec2<f32> {
  if (params.cover.z < 0.5) { return vec2<f32>(0.0, 0.0); }
  let uv = placeToUv(params, place);
  let field = (uv - vec2<f32>(0.5, 0.5)) * params.cover.xy + vec2<f32>(0.5, 0.5);
  let velocity = textureSampleLevel(flow, samp, field, 0.0).xy / params.cover.xy;
  // Canvas uv a second to short sides a second, with y flipped back up.
  let half = halfExtent(params);
  return vec2<f32>(velocity.x * 2.0 * half.x, -velocity.y * 2.0 * half.y);
}

/** The steering one particle takes from the neighbours the grid put near it. */
fn steer(index: u32, particle: Particle) -> vec2<f32> {
  let reach = params.noise.w;
  if (reach <= 0.0) { return vec2<f32>(0.0, 0.0); }
  let weights = params.boids.xyz;
  if (weights.x <= 0.0 && weights.y <= 0.0 && weights.z <= 0.0) {
    return vec2<f32>(0.0, 0.0);
  }

  let home = cellOf(particle.place.xy);
  let side = i32(params.cover.w);
  var away = vec2<f32>(0.0, 0.0);
  var heading = vec2<f32>(0.0, 0.0);
  var middle = vec2<f32>(0.0, 0.0);
  var seen = 0.0;
  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let cell = home + vec2<i32>(dx, dy);
      if (cell.x < 0 || cell.y < 0 || cell.x >= side || cell.y >= side) { continue; }
      let at = cellIndex(cell);
      let held = min(atomicLoad(&counts[at]), GRID_SLOTS);
      for (var slot = 0u; slot < held; slot = slot + 1u) {
        let other = slots[at * GRID_SLOTS + slot];
        if (other == index) { continue; }
        let mate = pool[other];
        if (mate.span.y <= 0.0) { continue; }
        let gap = mate.place.xy - particle.place.xy;
        let distance = length(gap);
        if (distance > reach) { continue; }
        seen = seen + 1.0;
        heading = heading + mate.place.zw;
        middle = middle + mate.place.xy;
        // Hardest at touching and nothing at the edge of the neighbourhood,
        // which is what stops a flock collapsing onto one point.
        away = away - gap * ((reach - distance) / max(distance, 1e-4)) / reach;
      }
    }
  }

  if (seen <= 0.0) { return vec2<f32>(0.0, 0.0); }
  // Separation is a sum and not an average: an average is the same push in a
  // crowd of four and a crowd of sixty, so a pile of birds feels nothing that
  // stops it packing tighter, and the gather collapses a flock to a point. A
  // sum grows with the crowd, and four birds at touching is the full push.
  var separation = away / CROWD;
  if (length(separation) > 2.0) { separation = normalize(separation) * 2.0; }
  let alignment = heading / seen - particle.place.zw;
  let cohesion = middle / seen - particle.place.xy;
  return separation * weights.x + alignment * weights.y + cohesion * weights.z;
}

/** A particle as this frame's spawn window says it should be born. */
fn born(index: u32, group: u32) -> Particle {
  let a = params.groups[group * 3u + 0u];
  let b = params.groups[group * 3u + 1u];
  let c = params.groups[group * 3u + 2u];
  let seed = i32(index);
  let batch = i32(a.x);
  var out: Particle;
  let spread = b.x;
  let speed = b.y * mix(0.6, 1.25, hash01(seed, batch, 4)) * mix(0.6, 1.0, c.w);
  var place = vec2<f32>(0.0, 0.0);
  var velocity = vec2<f32>(0.0, 0.0);
  if (c.x > 1.5) {
    // A flock birth: beside a bird that is already alive, going the way it is
    // going, so a body that replenishes itself stays where it is. The CPU
    // never reads the pool back and could not say where the body has got to.
    // A slot is picked at random and a dead one is tried past, and a pool with
    // nothing alive (which is how a flock starts) is seeded on a disc about
    // the attractor, four times as wide as a newborn's distance from a host.
    let live = u32(params.step.z);
    var landed = false;
    for (var attempt = 0; attempt < KIN_TRIES; attempt = attempt + 1) {
      let pick = u32(hash01(seed, batch, 20 + attempt) * f32(live)) % live;
      let host = pool[pick];
      if (host.span.y <= 0.0 || pick == u32(seed)) { continue; }
      let angle = TAU * hash01(seed, batch, 30);
      let reach = c.y * sqrt(hash01(seed, batch, 31));
      place = host.place.xy + vec2<f32>(cos(angle), sin(angle)) * reach;
      let drift = TAU * hash01(seed, batch, 32);
      velocity = host.place.zw + vec2<f32>(cos(drift), sin(drift)) * speed;
      landed = true;
      break;
    }

    if (!landed) {
      let angle = TAU * hash01(seed, batch, 30);
      let reach = 4.0 * c.y * sqrt(hash01(seed, batch, 31));
      place = params.attract.xy + vec2<f32>(cos(angle), sin(angle)) * reach;
      let drift = TAU * hash01(seed, batch, 32);
      velocity = vec2<f32>(cos(drift), sin(drift)) * speed;
    }
  } else if (c.x > 0.5) {
    // A ring burst: laid round a circle about the attractor at the place in
    // the spectrum the hit sat, the two halves mirrors of one another, and
    // thrown outward within the profile's cone.
    let coin = select(-1.0, 1.0, hash01(seed, batch, 5) > 0.5);
    let around = clamp(a.z + (hash01(seed, batch, 6) - 0.5) * spread, 0.0, 1.0);
    let angle = 3.14159265 * around;
    let unit = vec2<f32>(coin * sin(angle), -cos(angle));
    place = params.attract.xy + unit * c.y;
    let turn = (hash01(seed, batch, 7) - 0.5) * 2.0 * c.z;
    velocity = vec2<f32>(
      unit.x * cos(turn) - unit.y * sin(turn),
      unit.x * sin(turn) + unit.y * cos(turn),
    ) * speed;
  } else {
    // A field burst: laid over the whole canvas, drifting in its own direction.
    let half = halfExtent(params);
    place = vec2<f32>(
      (hash01(seed, batch, 8) - 0.5) * 2.0 * half.x,
      (hash01(seed, batch, 9) - 0.5) * 2.0 * half.y,
    );
    let angle = TAU * hash01(seed, batch, 10);
    velocity = vec2<f32>(cos(angle), sin(angle)) * speed;
  }

  out.place = vec4<f32>(place, velocity);
  out.span = vec4<f32>(
    0.0,
    max(b.z * mix(0.6, 1.2, hash01(seed, batch, 11)), 1e-3),
    hash01(seed, batch, 1),
    hash01(seed, batch, 2) - 0.5,
  );
  out.motion = vec4<f32>(0.0, 0.0, 0.0, 0.0);
  return out;
}

@compute @workgroup_size(64)
fn step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let live = u32(params.step.z);
  let index = gid.x;
  if (index >= live) { return; }
  var particle = pool[index];

  // The ring window. A slot is taken by where the cursor is and not by looking
  // for a dead one, so nothing scans the pool and nothing comes back: a
  // particle still alive when the cursor comes round is overwritten, which is
  // what makes the pool a budget rather than a queue.
  let groups = u32(params.spawns.x);
  var spawned = false;
  for (var group = 0u; group < groups; group = group + 1u) {
    let a = params.groups[group * 3u + 0u];
    let wanted = u32(a.y);
    if (wanted == 0u) { continue; }
    let first = u32(a.x);
    let ahead = (index + live - first) % live;
    if (ahead < wanted) {
      particle = born(index, group);
      spawned = true;
      break;
    }
  }

  if (!spawned && particle.span.y <= 0.0) {
    pool[index] = particle;
    return;
  }

  let dt = params.step.x;
  let curl = curlNoise(particle.place.xy * params.noise.y, params.step.y) * params.noise.x;
  let carried = flowAt(particle.place.xy) * params.forces.w;
  let push = curl + carried + params.forces.yz + steer(index, particle);
  // Exact at any step, where a linear `1 - drag * dt` drifts between frame
  // rates and goes unstable over a drag of about two.
  let kept = exp(-params.forces.x * dt);
  let velocity = (particle.place.zw + push * dt) * kept;
  // How hard the bird turned this step: the sine of the angle between the
  // velocity it had and the one it has, over the step, as a share of a full
  // turn's rate. A bird at rest has no direction to turn from. Drag scales a
  // velocity and cannot turn it, so the angle is the push's alone.
  let was = length(particle.place.zw);
  let now = length(velocity);
  var turned = 0.0;
  if (was > 1e-4 && now > 1e-4) {
    let sine = (particle.place.z * velocity.y - particle.place.w * velocity.x) / (was * now);
    turned = clamp(abs(sine) / max(dt, 1e-4) / TURN_FULL, 0.0, 1.0);
  }
  let turn = mix(particle.motion.x, turned, 1.0 - exp(-dt / TURN_SETTLE));
  // The gather is a velocity and not an acceleration, so a particle draws in
  // along an exponential and never swings past the attractor.
  let pull = (params.attract.xy - particle.place.xy) * params.noise.z;
  var place = particle.place.xy + (velocity + pull) * dt;
  if (params.spawns.y > 0.5) {
    // A field that wraps: a particle leaving one edge comes in at the other,
    // and the draw fades it out before it gets there and back in after, so
    // nothing pops.
    let half = halfExtent(params);
    place = place - 2.0 * half * floor((place + half) / (2.0 * half));
  }

  let age = particle.span.x + dt;
  let life = select(particle.span.y, 0.0, age >= particle.span.y);
  pool[index] = Particle(
    vec4<f32>(place, velocity),
    vec4<f32>(age, life, particle.span.z, particle.span.w),
    vec4<f32>(turn, 0.0, 0.0, 0.0),
  );
}
