/**
 * Play mode's physics (openspec play-mode): the body graph as Rapier rigid bodies, so moving parts
 * stop when they run into each other and the motors driving them stall.
 *
 * - Every body starts at the world origin with its parts' collision shapes placed where the parts
 *   are, so a body's pose is its move from the start. Rapier works in metres; the build is in mm.
 * - Every part collides as a convex hull of its mesh (exact meshes are far too slow), so a hull
 *   fills a part's holes and hollows. Pins have no shape (they sit inside holes), chain links neither
 *   (they stay still), nor pieces loose from the robot. Parts that share a hinge's pin or shaft don't
 *   collide with each other, and two parts whose outlines already overlap at the start never do (tight
 *   fits, tires on hubs, a shaft in a filled-in hole), nor do meshing gears (their ratio turns them)
 *   or a sprocket and its track. Parts that only touch (beams side by side) do collide. Contacts have
 *   no friction: nothing drives along a floor yet, and parts turning against each other on a shaft
 *   shouldn't drag.
 * - Gears, racks and chains have no joint in Rapier: each substep their speeds are pulled to the
 *   tooth ratio, and the turn they've drifted apart is pulled back, so a jammed gear stops its train.
 * - A Smart Motor is a torque about its hinge, at most STALL_TORQUE, steering the shaft to the
 *   throttle's speed. It is stalled when it stays well under that speed.
 *
 * `shapes.points(instanceId)` gives a part's mesh points in its own frame (mm, Float32Array of xyz)
 * or null when it has none to hand.
 * Returns the same engine interface as src/sim/kinematic.js plus dispose().
 */
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { MOTOR_FREE_RAD_S } from './kinematic.js';

export const STALL_TORQUE = 0.4; // N·m, Smart Motor
const MM = 0.001;
const DENSITY = 1050; // kg/m³, ABS
const STEP = 1 / 240;
const MAX_STEPS = 8; // per frame
const LINK_PASSES = 8;
const DRIFT_GAIN = 0.2; // share of a link's drift taken back each substep
const MOTOR_RESPONSE = 0.02; // s: how fast a motor steers to its speed below the torque limit
const STALL_BELOW = 0.1; // of the throttle's speed ...
const STALL_AFTER = 0.3; // ... for this long (s)
const STALL_CLEAR = 0.25;
const SPEED_SMOOTHING = 0.15; // s
const BLOCK_DEPTH = 0.0008; // m: a motor stops when what it moves presses this far into something
const PUSH_RISE = 0.15; // s: how slowly the push builds, against what the motor turns
const MAX_HULL_POINTS = 400;
const START_OVERLAP = 0.0003; // m: parts whose outlines overlap deeper than this at the start never collide (a shaft in a hole); parts only touching do
const MIN_MASS = 0.005; // kg per moving body
const MIN_RADIUS = 0.01; // m: its extra mass spread this far round its centre

let ready = null;
/** Loads Rapier's WASM once. */
export const loadPhysics = () => (ready ||= RAPIER.init());

const vec = (v) => ({ x: v.x, y: v.y, z: v.z });
const toV3 = (v) => new THREE.Vector3(v.x, v.y, v.z);
const toV3q = (q) => new THREE.Quaternion(q.x, q.y, q.z, q.w);
const startPose = (inst) => ({
  position: new THREE.Vector3(...inst.position).multiplyScalar(MM),
  quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(...inst.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'))
});

/** At most `max` of the points, spread through the list, scaled to metres. */
function samplePoints(points, max) {
  const n = points.length / 3;
  const step = Math.max(1, Math.ceil(n / max));
  const out = new Float32Array(Math.ceil(n / step) * 3);
  for (let i = 0, j = 0; i < n; i += step, j += 3) {
    out[j] = points[i * 3] * MM;
    out[j + 1] = points[i * 3 + 1] * MM;
    out[j + 2] = points[i * 3 + 2] * MM;
  }
  return out;
}

let scratch = null; // a world for trying shapes out
/** The hull of the points comes out flat or broken: its inertia isn't a usable number. */
function hullIsBad(points) {
  scratch ||= new RAPIER.World({ x: 0, y: 0, z: 0 });
  const hull = RAPIER.ColliderDesc.convexHull(points);
  if (!hull) return true;
  const body = scratch.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
  scratch.createCollider(hull.setDensity(DENSITY), body);
  const i = body.principalInertia();
  scratch.removeRigidBody(body);
  return ![i.x, i.y, i.z].every((v) => Number.isFinite(v) && v > 0);
}

/** The corners of the box round the points, at least 1 mm thick, to stand in for a bad hull. */
function boxCorners(points) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < points.length; k++) {
    lo[k % 3] = Math.min(lo[k % 3], points[k]);
    hi[k % 3] = Math.max(hi[k % 3], points[k]);
  }
  const mid = hi.map((h, k) => (h + lo[k]) / 2);
  const half = hi.map((h, k) => Math.max((h - lo[k]) / 2, 0.0005));
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(mid[0] + sx * half[0], mid[1] + sy * half[1], mid[2] + sz * half[2]);
  return new Float32Array(corners);
}

/**
 * A body's moment of inertia (kg·m²) about a world axis, from its principal inertia; through `point`
 * (a world Vector3, m) when given, adding its mass times the square of its centre's distance off that line.
 */
function inertiaAbout(rb, axis, point = null) {
  if (!rb.isDynamic()) return Infinity;
  const frame = toV3q(rb.rotation()).multiply(toV3q(rb.principalInertiaLocalFrame()));
  const local = axis.clone().applyQuaternion(frame.invert());
  const i = rb.principalInertia();
  let about = i.x * local.x * local.x + i.y * local.y * local.y + i.z * local.z * local.z;
  if (point) {
    const off = toV3(rb.worldCom()).sub(point);
    off.addScaledVector(axis, -off.dot(axis));
    about += rb.mass() * off.lengthSq();
  }
  // A body with no usable inertia: take its mass 1 cm out
  return about > 1e-12 ? about : Math.max(rb.mass(), 1e-4) * 1e-4;
}

export async function createPhysics(graph, instances, shapes) {
  await loadPhysics();
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const fixed = new Set(graph.fixed);
  const sliders = new Set(graph.sliders || []);
  // Connector pins sit inside holes and have no shape; standoffs are solid posts and do. Chain and track
  // parts on a track riding a moving body join that body as shapes (they stay where they were on it,
  // though they run round on screen); those on a body that holds still have none. A piece loose from
  // the robot holds still and blocks nothing: it is usually part of the robot whose pins don't reach
  // (the Clawbot's right claw), and as a wall it would stop the arm it belongs to.
  const solidPins = new Set(graph.solidPins || []);
  const looseParts = graph.bodies.filter((b) => (graph.loose || []).includes(b.id)).flatMap((b) => b.parts);
  const carried = new Map(); // body id -> track part ids
  for (const t of graph.tracks || []) {
    if (!t.frame || (fixed.has(t.frame) && !sliders.has(t.frame))) continue;
    carried.set(t.frame, [...(carried.get(t.frame) || []), ...t.linkIds, ...t.grippers.map(([g]) => g)]);
  }
  const carriedIds = new Set([...carried.values()].flat());
  const noShape = new Set([...(graph.pins || []).filter((id) => !solidPins.has(id)), ...graph.still.filter((id) => !carriedIds.has(id)), ...looseParts]);
  // What each part's shape is made from, worked out once; a ColliderDesc can only be used once
  const makers = new Map(); // "id|fixed" -> () => ColliderDesc, or null
  const colliderFor = (id, isFixed) => {
    const key = `${id}|${isFixed}`;
    if (!makers.has(key)) {
      const inst = byId.get(id);
      let make = null;
      if (inst && !noShape.has(id)) {
        const pts = shapes.points(id);
        if (pts?.length >= 12) {
          const sampled = samplePoints(pts, MAX_HULL_POINTS);
          const box = hullIsBad(sampled) ? boxCorners(sampled) : null;
          make = () => RAPIER.ColliderDesc.convexHull(box || sampled);
        }
      }
      const pose = inst ? startPose(inst) : null;
      makers.set(
        key,
        make &&
          (() => {
            const cd = make();
            return cd && cd.setTranslation(pose.position.x, pose.position.y, pose.position.z).setRotation({ x: pose.quaternion.x, y: pose.quaternion.y, z: pose.quaternion.z, w: pose.quaternion.w }).setDensity(DENSITY).setFriction(0);
          })
      );
    }
    return makers.get(key)?.() || null;
  };

  /**
   * Bodies and their parts' shapes in a new world. `probe` is a world thrown away after one step,
   * which measures what touches at the start.
   */
  function buildWorld(probe) {
    const w = new RAPIER.World({ x: 0, y: 0, z: 0 });
    w.timestep = STEP;
    const bodies = new Map(); // body id -> RigidBody
    const partOfCollider = new Map(); // collider handle -> instance id
    const bodyColliders = new Map(); // body id -> [Collider]
    for (const b of graph.bodies) {
      const isFixed = fixed.has(b.id) && !sliders.has(b.id);
      const desc = isFixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
      desc.setAngularDamping(0.1).setLinearDamping(0.1);
      if (sliders.has(b.id)) desc.lockRotations();
      const body = w.createRigidBody(desc);
      bodies.set(b.id, body);
      let shaped = 0;
      bodyColliders.set(b.id, []);
      for (const id of [...b.parts, ...(carried.get(b.id) || [])]) {
        const cd = colliderFor(id, isFixed);
        if (!cd) continue;
        if (!probe) cd.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
        const collider = w.createCollider(cd, body);
        partOfCollider.set(collider.handle, id);
        bodyColliders.get(b.id).push(collider);
        shaped += 1;
      }
      // Rapier needs mass to move a body, and goes unsteady when a washer of a few hundredths of a gram
      // hangs on a frame: every moving body weighs at least MIN_MASS, spread round its centre
      if (!isFixed) {
        body.recomputeMassPropertiesFromColliders();
        if (body.mass() < MIN_MASS) {
          const at = b.parts.map((id) => byId.get(id)).filter(Boolean);
          const centre = shaped
            ? toV3(body.worldCom())
            : at.reduce((sum, i) => sum.add(new THREE.Vector3(...i.position)), new THREE.Vector3()).multiplyScalar(MM / Math.max(1, at.length));
          const extra = MIN_MASS - body.mass();
          const spread = extra * MIN_RADIUS * MIN_RADIUS;
          body.setAdditionalMassProperties(extra, vec(centre), { x: spread, y: spread, z: spread }, { x: 0, y: 0, z: 0, w: 1 }, true);
        }
      }
    }
    return { w, bodies, partOfCollider, bodyColliders };
  }

  // Parts already touching or overlapping at the start never collide
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const touchingParts = new Set();
  {
    const probe = buildWorld(true);
    probe.w.step();
    probe.w.forEachCollider((c) => {
      probe.w.contactPairsWith(c, (other) => {
        let touching = false;
        probe.w.contactPair(c, other, (manifold) => {
          for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactDist(i) < -START_OVERLAP) touching = true;
        });
        if (touching) touchingParts.add(pairKey(probe.partOfCollider.get(c.handle), probe.partOfCollider.get(other.handle)));
      });
    });
    probe.w.free();
  }
  // Meshing gears, chained sprockets, and parts sharing a hinge's pin or shaft never collide by their outlines
  for (const l of graph.links) if (l.gears) touchingParts.add(pairKey(l.gears[0], l.gears[1]));
  for (const [a, b] of graph.hingePairs || []) touchingParts.add(pairKey(a, b));
  const { w: world, bodies: rb, partOfCollider, bodyColliders } = buildWorld(false);
  const skip = new Set();
  for (const a of partOfCollider.keys()) {
    for (const b of partOfCollider.keys()) {
      if (a < b && touchingParts.has(pairKey(partOfCollider.get(a), partOfCollider.get(b)))) skip.add(pairKey(a, b));
    }
  }
  // Rapier only runs the hooks when given an event queue too
  const events = new RAPIER.EventQueue(true);
  const hooks = {
    filterContactPair: (c1, c2) => (skip.has(pairKey(c1, c2)) ? null : RAPIER.SolverFlags.COMPUTE_IMPULSE),
    filterIntersectionPair: () => true
  };

  // Hinges: only the parts on the hinge line are in skip, so the rest of two hinged bodies still collide
  const hingeAxis = new Map(); // hinge id -> { a, b, axis (Vector3, in a's start frame), point (m) }
  for (const h of graph.hinges) {
    const p = { x: h.point[0] * MM, y: h.point[1] * MM, z: h.point[2] * MM };
    const axis = new THREE.Vector3(...h.axis).normalize();
    world.createImpulseJoint(RAPIER.JointData.revolute(p, p, vec(axis)), rb.get(h.a), rb.get(h.b), true);
    hingeAxis.set(h.id, { a: h.a, b: h.b, axis, point: new THREE.Vector3(p.x, p.y, p.z) });
  }
  // A free rack slides along its teeth on the body its gear is held by
  for (const id of sliders) {
    const l = graph.links.find((x) => x.kind === 'rack' && x.b === id);
    const anchor = rb.get(graph.fixed.find((f) => !sliders.has(f)) || graph.fixed[0]);
    if (!l || !anchor || anchor === rb.get(id)) continue;
    const joint = world.createImpulseJoint(RAPIER.JointData.prismatic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, vec(new THREE.Vector3(...l.direction).normalize())), anchor, rb.get(id), true);
    joint.setContactsEnabled(false);
  }

  // Where each body's start axis points now
  const axisNow = (bodyId, axis) => axis.clone().applyQuaternion(rb.get(bodyId).rotation());
  const spin = (bodyId, axis) => toV3(rb.get(bodyId).angvel()).dot(axis);
  const drift = new Map(graph.links.map((l, i) => [i, 0])); // ratio · turn of a − turn of b

  /** Where part `partId` of body `bodyId` is now (m): its start position carried by the body's move. */
  const worldPointOf = (bodyId, partId) => {
    const body = rb.get(bodyId);
    return new THREE.Vector3(...byId.get(partId).position).multiplyScalar(MM).applyQuaternion(toV3q(body.rotation())).add(toV3(body.translation()));
  };
  /** Turns `body` about the world line `(point, axis)` by a torque impulse `tau` (N·m·s). */
  const turnAboutLine = (body, axis, point, tau) => {
    if (!body?.isDynamic()) return;
    const scale = inertiaAbout(body, axis) / inertiaAbout(body, axis, point);
    body.applyTorqueImpulse(vec(axis.clone().multiplyScalar(tau * scale)), true);
  };
  /** Pulls each link's speeds to its ratio; `catchUp` also takes back part of the turn drifted apart. */
  function holdLinks(dt, catchUp = true) {
    // Everything one link needs, worked out once for the sweep
    const active = [];
    graph.links.forEach((l, i) => {
      const A = rb.get(l.a);
      const B = rb.get(l.b);
      if (!A || !B || A === B || (!A.isDynamic() && !B.isDynamic())) return;
      const axisA = axisNow(l.a, new THREE.Vector3(...l.axisA).normalize());
      const k = l.kind === 'rack' ? l.mmPerRad * MM : l.sign * l.ratio;
      const axisB = l.kind === 'rack' ? axisNow(l.b, new THREE.Vector3(...l.direction).normalize()) : axisNow(l.b, new THREE.Vector3(...l.axisB).normalize());
      const pointA = worldPointOf(l.a, l.gears[0]);
      const pointB = l.kind === 'rack' ? null : worldPointOf(l.b, l.gears[1]);
      // Each gear's body turns about its gear's axis (its shaft), so weigh it about that line
      const invA = 1 / inertiaAbout(A, axisA, pointA);
      const invB = l.kind === 'rack' ? B.invMass() : 1 / inertiaAbout(B, axisB, pointB);
      const mass = k * k * invA + invB;
      if (mass > 0) active.push({ l, i, A, B, axisA, axisB, pointA, pointB, k, mass });
    });
    // Whole sweeps over every link, not each link to the end in turn: a train of gears of very
    // different weights (a light shaft into a heavy frame) only settles when they pass impulses along
    for (let pass = 0; pass < LINK_PASSES; pass++) {
      for (const { l, i, A, B, axisA, axisB, pointA, pointB, k, mass } of active) {
        const speedB = l.kind === 'rack' ? toV3(B.linvel()).dot(axisB) : spin(l.b, axisB);
        const error = k * spin(l.a, axisA) - speedB + (catchUp ? (DRIFT_GAIN * drift.get(i)) / dt : 0);
        const lambda = -error / mass;
        turnAboutLine(A, axisA, pointA, k * lambda);
        if (B.isDynamic()) {
          if (l.kind === 'rack') B.applyImpulse(vec(axisB.clone().multiplyScalar(-lambda)), true);
          else turnAboutLine(B, axisB, pointB, -lambda);
        }
      }
    }
  }
  function trackDrift(dt) {
    graph.links.forEach((l, i) => {
      if (!rb.get(l.a) || !rb.get(l.b) || l.a === l.b) return;
      const axisA = axisNow(l.a, new THREE.Vector3(...l.axisA).normalize());
      const k = l.kind === 'rack' ? l.mmPerRad * MM : l.sign * l.ratio;
      const sB =
        l.kind === 'rack'
          ? toV3(rb.get(l.b).linvel()).dot(axisNow(l.b, new THREE.Vector3(...l.direction).normalize()))
          : spin(l.b, axisNow(l.b, new THREE.Vector3(...l.axisB).normalize()));
      drift.set(i, drift.get(i) + (k * spin(l.a, axisA) - sB) * dt);
    });
  }

  // Motors: torque about the hinge, the motor body pushed back the other way. The torque steers to
  // the throttle's speed by what it turns (shaft and gear train): a part for how far off it is, and
  // a part that builds up while it stays off (for the friction, damping and linkages that weighs
  // nothing for); both within the motor's stall torque.
  const motorState = new Map(graph.motors.map((m) => [m.id, { rel: 0, smooth: 0, slowFor: 0, stalled: false, push: 0, blocked: 0, depth: 0 }]));
  // What else each motor turns through its gears and chains: [{ body, axis, gear, factor }], where
  // the body turns `factor` times as fast as the shaft, so it weighs factor² as much on the motor
  const trains = new Map(
    graph.motors.map((m) => {
      const start = hingeAxis.get(m.hinge).b;
      const factor = new Map([[start, 1]]);
      const out = [];
      for (let i = 0, queue = [start]; i < queue.length; i++) {
        const cur = queue[i];
        for (const l of graph.links) {
          if (l.kind === 'rack' || (l.a !== cur && l.b !== cur)) continue;
          const forward = l.a === cur;
          const next = forward ? l.b : l.a;
          if (factor.has(next) || !rb.get(next)?.isDynamic()) continue;
          const f = factor.get(cur) * Math.abs(forward ? l.ratio : 1 / l.ratio);
          factor.set(next, f);
          queue.push(next);
          out.push({ body: next, axis: new THREE.Vector3(...(forward ? l.axisB : l.axisA)).normalize(), gear: l.gears[forward ? 1 : 0], factor: f });
        }
      }
      return [m.id, out];
    })
  );
  // Everything each motor moves: its shaft's body, then whatever hangs on it through hinges and gear
  // or chain ties, never the body the motor sits on or a body that holds still
  const driven = new Map(
    graph.motors.map((m) => {
      const { a: holder, b: start } = hingeAxis.get(m.hinge);
      const seen = new Set([start]);
      for (let i = 0, queue = [start]; i < queue.length; i++) {
        const cur = queue[i];
        const next = [
          ...graph.hinges.filter((h) => h.a === cur || h.b === cur).map((h) => (h.a === cur ? h.b : h.a)),
          ...graph.links.filter((l) => l.a === cur || l.b === cur).map((l) => (l.a === cur ? l.b : l.a))
        ];
        for (const id of next) {
          if (id === holder || seen.has(id) || !rb.get(id)?.isDynamic()) continue;
          seen.add(id);
          queue.push(id);
        }
      }
      return [m.id, [...seen].filter((id) => rb.get(id)?.isDynamic())];
    })
  );
  /**
   * How deep what a motor moves presses into other parts (m): the deepest contact of its bodies'
   * shapes, leaving out pairs let off at the start (and any between two of its own bodies on a hinge,
   * which have no contacts).
   */
  function pressDepth(motorId) {
    let deepest = 0;
    for (const bodyId of driven.get(motorId)) {
      for (const c of bodyColliders.get(bodyId) || []) {
        world.contactPairsWith(c, (other) => {
          if (skip.has(pairKey(c.handle, other.handle))) return;
          world.contactPair(c, other, (manifold) => {
            for (let i = 0; i < manifold.numContacts(); i++) deepest = Math.max(deepest, -manifold.contactDist(i));
          });
        });
      }
    }
    return deepest;
  }
  function driveMotors(throttles, dt) {
    for (const m of graph.motors) {
      const h = hingeAxis.get(m.hinge);
      const st = motorState.get(m.id);
      const A = rb.get(h.a);
      const B = rb.get(h.b);
      const axis = axisNow(h.a, h.axis);
      const point = h.point.clone().applyQuaternion(toV3q(A.rotation())).add(toV3(A.translation()));
      st.rel = toV3(B.angvel()).sub(toV3(A.angvel())).dot(axis);
      // A blocked shaft jitters: the speed shown and the stall check use it smoothed
      st.smooth += (st.rel - st.smooth) * Math.min(1, dt / SPEED_SMOOTHING);
      const target = (throttles.get(m.id) || 0) * MOTOR_FREE_RAD_S;
      // Pressing into something stops the motor, and only the other way frees it
      if (st.blocked && Math.sign(target) !== st.blocked) {
        st.blocked = 0;
        st.stalled = false;
        st.slowFor = 0;
        st.depth = pressDepth(m.id); // deepening from here on, not from when it stopped, blocks it again
      }
      if (st.blocked) {
        for (const id of driven.get(m.id)) {
          rb.get(id).setAngvel({ x: 0, y: 0, z: 0 }, true);
          rb.get(id).setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
        st.smooth = 0;
        st.push = 0;
        st.stalled = true;
        continue;
      }
      let turned = inertiaAbout(B, axis, point);
      for (const t of trains.get(m.id)) turned += t.factor * t.factor * inertiaAbout(rb.get(t.body), axisNow(t.body, t.axis), worldPointOf(t.body, t.gear));
      const inertia = 1 / (1 / inertiaAbout(A, axis, point) + 1 / turned);
      const off = target - st.rel;
      const steer = (inertia * off) / MOTOR_RESPONSE;
      // The push only builds while the torque isn't already at the limit that way
      const atLimit = Math.abs(steer + st.push) >= STALL_TORQUE && Math.sign(steer + st.push) === Math.sign(off);
      if (!atLimit) st.push = THREE.MathUtils.clamp(st.push + (inertia * off * dt) / (MOTOR_RESPONSE * PUSH_RISE), -STALL_TORQUE, STALL_TORQUE);
      // Stopped, or asked the other way than it was pushing (reversed out of a stall): let go at once
      if (!target || Math.sign(st.push) === -Math.sign(target)) st.push = 0;
      const torque = THREE.MathUtils.clamp(steer + st.push, -STALL_TORQUE, STALL_TORQUE);
      turnAboutLine(B, axis, point, torque * dt);
      turnAboutLine(A, axis, point, -torque * dt);
      // Stalled: asked to turn but held well under that speed for a while
      const asked = Math.abs(target) > 0.05 * MOTOR_FREE_RAD_S;
      const share = asked ? (st.smooth * Math.sign(target)) / Math.abs(target) : 1;
      if (!asked) {
        st.slowFor = 0;
        st.stalled = false;
      } else if (share < STALL_BELOW) {
        st.slowFor += dt;
        if (st.slowFor >= STALL_AFTER) st.stalled = true;
      } else {
        st.slowFor = 0;
        if (share > STALL_CLEAR) st.stalled = false;
      }
    }
  }

  /** Stops each motor whose moving parts have run into something (see pressDepth). */
  function checkBlocked(throttles) {
    for (const m of graph.motors) {
      const st = motorState.get(m.id);
      const dir = Math.sign(throttles.get(m.id) || 0);
      if (!dir || st.blocked) continue;
      const depth = pressDepth(m.id);
      // Only when it is deep and still getting deeper, not while backing out of something
      if (depth > BLOCK_DEPTH && depth > st.depth + 0.00001) st.blocked = dir;
      st.depth = depth;
    }
  }

  let carry = 0;
  return {
    step(dt, throttles) {
      carry = Math.min(carry + dt, MAX_STEPS * STEP);
      while (carry >= STEP) {
        carry -= STEP;
        driveMotors(throttles, STEP);
        holdLinks(STEP);
        world.step(events, hooks);
        checkBlocked(throttles);
        trackDrift(STEP);
        // Contacts and hinges may have pulled the ratios apart within the step: put the speeds back
        holdLinks(STEP, false);
      }
    },
    deltas() {
      const out = new Map();
      for (const [id, body] of rb) {
        const t = body.translation();
        out.set(id, new THREE.Matrix4().compose(new THREE.Vector3(t.x / MM, t.y / MM, t.z / MM), toV3q(body.rotation()), new THREE.Vector3(1, 1, 1)));
      }
      return out;
    },
    status() {
      const motors = {};
      for (const m of graph.motors) {
        const st = motorState.get(m.id);
        motors[m.id] = { rpm: (st.smooth * 60) / (2 * Math.PI), stalled: st.stalled };
      }
      return motors;
    },
    spin: (bodyId, axis) => spin(bodyId, new THREE.Vector3(...axis).normalize()),
    /** Why a pair of parts does or doesn't collide: { shaped: [a?, b?], letOff } (a debugging aid). */
    describePair(partA, partB) {
      const handles = (id) => [...partOfCollider].filter(([, p]) => p === id).map(([h]) => h);
      const ha = handles(partA);
      const hb = handles(partB);
      return { shaped: [ha.length > 0, hb.length > 0], letOff: ha.some((a) => hb.some((b) => skip.has(pairKey(a, b)))) };
    },
    /** A body's mass (kg), Infinity when it holds still. */
    massOf: (bodyId) => (rb.get(bodyId)?.isDynamic() ? rb.get(bodyId).mass() : Infinity),
    /** Pairs of parts pressing on each other now: [[instanceId, instanceId, depth (mm), force impulse]] (with those let off, too). */
    contacts(includeSkipped = false) {
      const out = [];
      world.forEachCollider((c) => {
        world.contactPairsWith(c, (other) => {
          if (c.handle > other.handle || (!includeSkipped && skip.has(pairKey(c.handle, other.handle)))) return;
          let pressing = false;
          let depth = 0;
          let impulse = 0;
          world.contactPair(c, other, (manifold) => {
            for (let i = 0; i < manifold.numContacts(); i++) {
              if (manifold.contactImpulse(i) > 0) pressing = true;
              impulse = Math.max(impulse, manifold.contactImpulse(i));
              depth = Math.max(depth, -manifold.contactDist(i) / MM);
            }
          });
          if (pressing) out.push([partOfCollider.get(c.handle), partOfCollider.get(other.handle), depth, impulse]);
        });
      });
      return out;
    },
    dispose() {
      events.free();
      world.free();
    }
  };
}

