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
import { solveBandPath } from '../utils/bandPath.js';
import { bandPullN } from './bandStrength.js';
import { ROPE_PULL } from './ropeStrength.js';
import { leaveAngle, ropeElementsNow, ropeGiven, ropePathMm, solveRopeNow } from './ropeSim.js';
import { turnsThatFit } from '../utils/ropePath.js';
import { sameLine } from './bodyGraph.js';
import { meshTurn } from '../utils/gearMeshing.js';
import { MOTOR_FREE_RAD_S } from './kinematic.js';
import { allMeasured, partMassKg } from './fastenerStrength.js';
import { buildImpactModel, landingQuaternion, solveImpact } from './impact.js';

export const STALL_TORQUE = 0.414; // N·m, Smart Motor stall torque
export const MAX_POWER_W = 1.4; // W, Smart Motor peak mechanical output power
const GRAVITY = 9.81; // m/s², for load torque calculation
const DRIVE_ROLL_LOAD = 0.62; // effective rolling + drivetrain load share of robot weight on ground wheels
const MM = 0.001;
const DENSITY = 1050; // kg/m³, ABS
const STEP = 1 / 240;
const MAX_STEPS = 8; // per frame
const DROP_STEP = 1 / 1000; // s: a drop is stepped finer, so nothing passes through the floor or another part
const MAX_DROP_STEPS = 40; // per frame; a drop runs slower than real time rather than skip
const SPLIT_SPEED_SHARE = 0.5; // a piece breaks off no faster than this share of the landing speed
const MAX_SPIN = 25; // rad/s: ... and spins no faster
const DROP_SOLVER_PASSES = 12;
const RELEASE_GAP = 0.0005; // m: pieces let off from colliding where they were joined collide again once this far apart
const LINK_PASSES = 8;
const DRIFT_GAIN = 0.2; // share of a link's drift taken back each substep
const MOTOR_RESPONSE = 0.02; // s: how fast a motor steers to its speed below the torque limit
const STALL_BELOW = 0.1; // of the throttle's speed ...
const STALL_AFTER = 0.3; // ... for this long (s)
const STALL_CLEAR = 0.25;
const COAST_DRAG = 0.1; // a coasting motor's own gears drag at this share of a braking one's (assumed)
const HOLD_RETURN = 0.3; // s: a held shaft turned away goes back over about this long (assumed)
const BACK_OUT_TURN = THREE.MathUtils.degToRad(15); // rad: backing out ends once the shaft has turned this far back
const BACK_OUT_PRESS = 0.1; // s: backing out, a deeper press must last this long to block it again
const BACK_OUT_CLEAR = 0.25; // s: backing out of a block lasts until what it pressed into stays clear this long
const SPEED_SMOOTHING = 0.15; // s
const BLOCK_DEPTH = 0.0008; // m: a motor stops when what it moves presses this far into something
const WOBBLE_TIME = 0.35; // s: damped rebound wobble after a heavy assembly hits a hard stop
const WOBBLE_DECAY = 11; // 1/s: how fast the impact wobble dies out
const WOBBLE_FREQ = 52; // rad/s: base oscillation frequency of the shaft/gear rebound
const WOBBLE_REF_INERTIA = 0.015; // kg·m²: reference rotational inertia (an arm carrying a motor)
const WOBBLE_MAX_RAD = 0.038; // rad (~2.2°): reference bounce angle at the load for WOBBLE_REF_INERTIA
const PUSH_RISE = 0.15; // s: how slowly the push builds, against what the motor turns
const MAX_HULL_POINTS = 400;
const START_OVERLAP = 0.0003; // m: parts whose outlines overlap deeper than this at the start never collide (a shaft in a hole); parts only touching do
const MIN_MASS = 0.005; // kg per moving body
const MIN_RADIUS = 0.01; // m: its extra mass spread this far round its centre
// Ratchets (openspec ratchet-and-pawl, design §7)
const PAWL_DRAG = 0.02 * 0.414; // N·m: the pawl dragging on teeth turning the free way (2% of stall torque)
const PAWL_PRESS_SPEED = 30; // rad/s: how fast a band (or its weight) brings a pawl back down onto the teeth
const PAWL_PRESS_TORQUE = 0.02; // N·m: the most a band (or its weight) presses a pawl on with
const PAWL_PIN_FRICTION = 0.002; // N·m: what holds a lifted pawl where it is left
const MESH_ENGAGE_MM = 1; // gears this near mesh distance on parts that move apart drive each other ...
const MESH_RELEASE_MM = 1.5; // ... until this far off it
const PAWL_LIFTED_MM = 0.5; // a pawl's tip this far above the teeth has been lifted off them
const PAWL_DOWN_MM = 0.05; // ... and is in the teeth while this far under their tips

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

export async function createPhysics(graph, instances, shapes, options = {}) {
  await loadPhysics();
  let limitSpeedByLoad = Boolean(options.limitSpeedByLoad);
  let simulateGravity = Boolean(options.simulateGravity);
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const fixed = new Set(graph.fixed);
  const looseSet = new Set(graph.loose || []);
  // Bodies hanging on ropes (openspec rope-and-spool): always moving, gravity only when it's on
  const ropedSet = new Set(graph.roped || []);
  const sliders = new Set(graph.sliders || []);
  // Connector pins sit inside holes and have no shape; standoffs are solid posts and do. Chain and track
  // parts on a track riding a moving body join that body as shapes (they stay where they were on it,
  // though they run round on screen); those on a body that holds still have none. Loose parts keep their
  // shapes so they can fall when gravity is simulated, but are let off from collisions when gravity is off.
  const solidPins = new Set(graph.solidPins || []);
  const looseParts = new Set(graph.bodies.filter((b) => looseSet.has(b.id)).flatMap((b) => b.parts));
  const carried = new Map(); // body id -> track part ids
  for (const t of graph.tracks || []) {
    if (!t.frame || (fixed.has(t.frame) && !sliders.has(t.frame) && !looseSet.has(t.frame))) continue;
    carried.set(t.frame, [...(carried.get(t.frame) || []), ...t.linkIds, ...t.grippers.map(([g]) => g)]);
  }
  const carriedIds = new Set([...carried.values()].flat());
  const noShape = new Set([
    ...(graph.pins || []).filter((id) => !solidPins.has(id) && !looseParts.has(id)),
    ...graph.still.filter((id) => !carriedIds.has(id) && !looseParts.has(id))
  ]);
  // What each part's shape is made from, worked out once; a ColliderDesc can only be used once
  const makers = new Map(); // "id|fixed" -> () => ColliderDesc, or null
  const partMinY = new Map(); // instanceId -> lowest world y (m)
  const pinSet = new Set(graph.pins || []);
  const stillSet = new Set(graph.still || []);
  // Each part weighs what the drop test's table says (src/sim/fastenerStrength.js), so the fall and the impact agree
  const massOfPart = (id) => {
    const info = graph.partInfo?.[id];
    const size = info?.box ? [0, 1, 2].map((k) => info.box.max[k] - info.box.min[k]) : null;
    return partMassKg({ name: info?.name || byId.get(id)?.label || '', partNumber: info?.partNumber || '', size, pin: pinSet.has(id) });
  };
  const colliderFor = (id, isFixed) => {
    const key = `${id}|${isFixed}`;
    if (!makers.has(key)) {
      const inst = byId.get(id);
      const pose = inst ? startPose(inst) : null;
      let make = null;
      if (inst && !noShape.has(id)) {
        const pts = shapes.points(id);
        if (pts?.length >= 12) {
          const sampled = samplePoints(pts, MAX_HULL_POINTS);
          const corners = boxCorners(sampled);
          const box = hullIsBad(sampled) ? corners : null;
          make = () => RAPIER.ColliderDesc.convexHull(box || sampled);
          if (!partMinY.has(id)) {
            let minY = Infinity;
            const v = new THREE.Vector3();
            for (let i = 0; i < corners.length; i += 3) {
              v.set(corners[i], corners[i + 1], corners[i + 2]).applyQuaternion(pose.quaternion).add(pose.position);
              if (v.y < minY) minY = v.y;
            }
            partMinY.set(id, minY);
          }
        }
      }
      makers.set(
        key,
        make &&
          (() => {
            const cd = make();
            return cd && cd.setTranslation(pose.position.x, pose.position.y, pose.position.z).setRotation({ x: pose.quaternion.x, y: pose.quaternion.y, z: pose.quaternion.z, w: pose.quaternion.w }).setMass(massOfPart(id)).setFriction(0);
          })
      );
    }
    return makers.get(key)?.() || null;
  };

  // Free-turning hardware (openspec rope-and-spool, design decision 15): a dynamic body made only
  // of passive hardware (shafts, collars, spacers, standoffs, pins, washers, bushings — and no
  // gear/sprocket/pulley/wheel/hub/ratchet/pawl/spool/rack/tread/link) that no link, mesh, ratchet,
  // rope, band, motor, slider or loose/roped list uses, and whose hinges all lie on one line, is
  // held still to one body it is hinged to (a fixed one if any, else the one with the most parts).
  // When held to a fixed body, it is made a fixed rigid body directly so heavy arms hinged through
  // a light pivot axle (e.g. a 5 g shaft between chassis and arm) don't stretch the joint under load.
  const HARDWARE_RE = /\b(shaft|collar|spacer|standoff|pin|washer|bushing)\b/i;
  const WORKING_RE = /\b(gear|sprocket|pulley|wheel|hub|ratchet|pawl|spool|rack|tread|link)\b/i;
  const heldHardware = (() => {
    const baseFixed = (id) => fixed.has(id) && !sliders.has(id) && !looseSet.has(id) && !ropedSet.has(id);
    const used = new Set([...looseSet, ...ropedSet, ...sliders]);
    for (const l of graph.links || []) used.add(l.a).add(l.b);
    for (const m of graph.maybeMeshes || []) {
      used.add(m.a).add(m.b);
      for (const h of m.holders || []) if (h) used.add(h);
    }
    for (const r of graph.ratchets || []) used.add(r.ratchetBody).add(r.holderBody).add(r.pawlBody);
    for (const b of graph.bands || []) for (const id of b.bodies || []) if (id) used.add(id);
    for (const r of graph.ropes || []) {
      for (const id of r.bodies || []) if (id) used.add(id);
      if (r.spool?.body) used.add(r.spool.body);
    }
    for (const j of graph.slideJoints || []) used.add(j.a).add(j.b);
    for (const m of graph.motors || []) {
      const h = graph.hinges.find((x) => x.id === m.hinge);
      if (h) used.add(h.a).add(h.b);
    }
    const bodySize = new Map(graph.bodies.map((b) => [b.id, b.parts.length]));
    const isHardwareOnly = (b) =>
      b.parts.length > 0 &&
      b.parts.every((id) => {
        const name = graph.partInfo?.[id]?.name || byId.get(id)?.label || '';
        return HARDWARE_RE.test(name) && !WORKING_RE.test(name);
      });
    const rotating = new Set();
    for (const l of graph.links || []) rotating.add(l.a).add(l.b);
    for (const m of graph.maybeMeshes || []) rotating.add(m.a).add(m.b);
    for (const r of graph.ratchets || []) rotating.add(r.ratchetBody);
    for (const m of graph.motors || []) {
      const h = graph.hinges.find((x) => x.id === m.hinge);
      if (h) rotating.add(h.b);
    }
    const fixedBodies = new Set();
    const fixedHinges = new Set();
    for (const b of graph.bodies) {
      if (baseFixed(b.id) || used.has(b.id) || !isHardwareOnly(b)) continue;
      const hs = graph.hinges.filter((h) => h.a === b.id || h.b === b.id);
      if (!hs.length || !hs.every((h) => sameLine(hs[0], h))) continue;
      let best = null;
      let bestFixed = false;
      let bestSize = -1;
      for (const h of hs) {
        const other = h.a === b.id ? h.b : h.a;
        const otherFixed = baseFixed(other);
        if (!otherFixed && rotating.has(other)) continue;
        const sz = bodySize.get(other) || 0;
        if (!best || (otherFixed && !bestFixed) || (otherFixed === bestFixed && sz > bestSize)) {
          best = h;
          bestFixed = otherFixed;
          bestSize = sz;
        }
      }
      if (best) {
        fixedHinges.add(best.id);
        if (bestFixed && hs.some((h) => !baseFixed(h.a === b.id ? h.b : h.a))) fixedBodies.add(b.id);
      }
    }
    return { fixedBodies, fixedHinges };
  })();

  /**
   * Bodies and their parts' shapes in a new world. `probe` is a world thrown away after one step,
   * which measures what touches at the start.
   */
  function buildWorld(probe) {
    const w = new RAPIER.World({ x: 0, y: probe ? 0 : -GRAVITY, z: 0 });
    if (!probe) w.integrationParameters.switchToSmallStepsPgsSolverWithoutWarmstart();
    w.timestep = STEP;
    const bodies = new Map(); // body id -> RigidBody
    const partOfCollider = new Map(); // collider handle -> instance id
    const bodyColliders = new Map(); // body id -> [Collider]
    // A spool holding a rope turns on its shaft with some friction (decision 9, Swish): without it a
    // light spool the rope has spun keeps spinning, pays the rope right out and winds it back
    const spoolBodies = new Set((graph.ropes || []).map((r) => r.spool?.body).filter(Boolean));
    for (const b of graph.bodies) {
      const isLoose = looseSet.has(b.id) || ropedSet.has(b.id);
      const isFixed = fixed.has(b.id) && !sliders.has(b.id) && !isLoose;
      const desc = isFixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic().setGravityScale(0);
      desc.setAngularDamping(spoolBodies.has(b.id) ? ROPE_PULL.spoolDamping : 0.3).setLinearDamping(0.3);
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
      // hangs on a frame: every moving body weighs at least MIN_MASS, spread round its centre.
      // A hardware body held to the fixed frame (e.g. a pivot axle) carries heavy moving arms, so
      // give it structural mass (0.2 kg) so its fixed joint doesn't stretch under high mass ratios.
      if (!isFixed) {
        body.recomputeMassPropertiesFromColliders();
        const minM = heldHardware.fixedBodies.has(b.id) ? 0.2 : MIN_MASS;
        if (body.mass() < minM) {
          const at = b.parts.map((id) => byId.get(id)).filter(Boolean);
          const centre = shaped
            ? toV3(body.worldCom())
            : at.reduce((sum, i) => sum.add(new THREE.Vector3(...i.position)), new THREE.Vector3()).multiplyScalar(MM / Math.max(1, at.length));
          const extra = minM - body.mass();
          const spread = extra * MIN_RADIUS * MIN_RADIUS;
          body.setAdditionalMassProperties(extra, vec(centre), { x: spread, y: spread, z: spread }, { x: 0, y: 0, z: 0, w: 1 }, true);
        }
        if (looseSet.has(b.id) && (probe || !simulateGravity)) {
          body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
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
  // Gears just out of mesh don't drive each other, so their smooth shells mustn't rub either
  for (const [a, b] of graph.nearGears || []) touchingParts.add(pairKey(a, b));
  for (const [a, b] of graph.hingePairs || []) touchingParts.add(pairKey(a, b));
  // A pawl rides its ratchet's teeth by rule (holdRatchets), never by its outline
  for (const r of graph.ratchets || []) touchingParts.add(pairKey(r.ratchet, r.pawl));
  // Gears that may swing into mesh: their smooth hulls would meet at the tip circles, 2 mm early
  for (const m of graph.maybeMeshes || []) touchingParts.add(pairKey(m.gears[0], m.gears[1]));
  const { w: world, bodies: rb, partOfCollider, bodyColliders } = buildWorld(false);
  const skip = new Set();
  for (const a of partOfCollider.keys()) {
    for (const b of partOfCollider.keys()) {
      if (a < b && touchingParts.has(pairKey(partOfCollider.get(a), partOfCollider.get(b)))) skip.add(pairKey(a, b));
    }
  }
  const looseColliderHandles = new Set();
  for (const bId of looseSet) {
    for (const c of bodyColliders.get(bId) || []) looseColliderHandles.add(c.handle);
  }
  let floorHandle = -1;
  let floorCol = null;
  const floorSkip = new Set();
  const dropState = { active: false, heightM: 0.5, landing: 'flat', impacted: false, peakFallSpeed: 0, detached: [], swinging: [] };
  // Rapier only runs the hooks when given an event queue too
  const events = new RAPIER.EventQueue(true);
  const hooks = {
    filterContactPair: (c1, c2) => {
      const pk = pairKey(c1, c2);
      if (skip.has(pk) && !(dropState.active && floorSkip.has(pk))) return null;
      if (!simulateGravity && !dropState.active && (c1 === floorHandle || c2 === floorHandle || looseColliderHandles.has(c1) || looseColliderHandles.has(c2))) return null;
      return RAPIER.SolverFlags.COMPUTE_IMPULSE;
    },
    filterIntersectionPair: () => true
  };

  // Hinges: only the parts on the hinge line are in skip, so the rest of two hinged bodies still collide
  const hingeAxis = new Map(); // hinge id -> { a, b, axis (Vector3, in a's start frame), point (m) }
  const hingeJoints = new Map(); // hinge id -> ImpulseJoint
  const ID_Q = { x: 0, y: 0, z: 0, w: 1 };
  for (const h of graph.hinges) {
    const p = { x: h.point[0] * MM, y: h.point[1] * MM, z: h.point[2] * MM };
    const axis = new THREE.Vector3(...h.axis).normalize();
    const data = heldHardware.fixedHinges.has(h.id) ? RAPIER.JointData.fixed(p, ID_Q, p, ID_Q) : RAPIER.JointData.revolute(p, p, vec(axis));
    const joint = world.createImpulseJoint(data, rb.get(h.a), rb.get(h.b), true);
    hingeJoints.set(h.id, joint);
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
  // Slides between bodies (openspec linear-motion-and-idler-pins, design §4): a prismatic joint along the
  // slide, stopping at the travel the engine found each way (Rapier's limits, in metres along the axis,
  // of b's move relative to a). Contacts between the two bodies are off, as on a free rack's slider: the
  // limits are what stop it
  const slideJoints = new Map(); // slide joint id -> ImpulseJoint
  for (const j of graph.slideJoints || []) {
    const A = rb.get(j.a);
    const B = rb.get(j.b);
    if (!A || !B || A === B) continue;
    const p = { x: j.point[0] * MM, y: j.point[1] * MM, z: j.point[2] * MM };
    const data = RAPIER.JointData.prismatic(p, p, vec(new THREE.Vector3(...j.direction).normalize()));
    data.limitsEnabled = true;
    data.limits = [j.limits[0] * MM, j.limits[1] * MM];
    const joint = world.createImpulseJoint(data, A, B, true);
    joint.setContactsEnabled(false);
    slideJoints.set(j.id, joint);
  }
  // A body on a slide: where it is along it (m from where it started) and its ends
  const slideOfBody = new Map(
    (graph.slideJoints || []).map((j) => [j.b, { a: j.a, axis: new THREE.Vector3(...j.direction).normalize(), lo: j.limits[0] * MM, hi: j.limits[1] * MM }])
  );
  const slideAt = (bodyId) => {
    const sl = slideOfBody.get(bodyId);
    const A = rb.get(sl.a);
    const axis = sl.axis.clone().applyQuaternion(toV3q(A.rotation()));
    return { ...sl, axis, s: toV3(rb.get(bodyId).translation()).sub(toV3(A.translation())).dot(axis) };
  };
  const SLIDE_END = 0.0002; // m: a body this near the end of its slide is at that end
  const endPush = new Map(); // rack link index -> m its gear has turned on past the end of the slide

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
  const turnAboutLine = (body, axis, point, tau, known = null) => {
    if (!body?.isDynamic()) return;
    const scale = known ?? inertiaAbout(body, axis) / inertiaAbout(body, axis, point);
    body.applyTorqueImpulse(vec(axis.clone().multiplyScalar(tau * scale)), true);
  };
  /** Whether a motor is driving the gear on body `id` (throttle on, not stopped by a press). */
  const gearFirm = (id) =>
    graph.motors.some((m) => {
      if (hingeAxis.get(m.hinge).b !== id && !trains.get(m.id).some((t) => !t.rack && t.body === id)) return false;
      return Boolean(lastThrottles.get(m.id)) && !motorState.get(m.id).blocked;
    });
  /** Pulls each link's speeds to its ratio; `catchUp` also takes back part of the turn drifted apart. */
  function holdLinks(dt, catchUp = true) {
    for (const c of clusters) solveCluster(c, dt, catchUp);
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
      // A worm (side a) is never pushed back by its gear: the whole correction goes to the gear, so
      // the gear follows the worm and a load on the gear can't turn either (openspec right-angle-gears)
      const mass = l.oneWay ? invB : k * k * invA + invB;
      // A rack on a body at the end of its slide can't go further that way: there the gear meets a rack
      // that holds still, so the gear and its train stop, and the motor stalls (openspec
      // linear-motion-and-idler-pins)
      const end = l.kind === 'rack' && slideOfBody.has(l.b) ? slideAt(l.b) : null;
      if (end && end.s > end.lo + SLIDE_END && end.s < end.hi - SLIDE_END) endPush.delete(i);
      // A gear its motor is driving keeps its speed: the motor gives what torque it takes, so the sliding
      // body on its rack takes the whole correction (else the light gear does, the motor drives it on
      // again, and a load on the stage leaves it behind its gear). A stopped motor holds through the
      // ordinary coupling, by its stopping mode
      const firm = end && gearFirm(l.a);
      // How a torque about each gear's line turns its body (the poses don't change over the sweep)
      const scaleA = A.isDynamic() ? inertiaAbout(A, axisA) * invA : 0;
      const scaleB = l.kind !== 'rack' && B.isDynamic() ? inertiaAbout(B, axisB) * invB : 0;
      if (mass > 0) active.push({ l, i, A, B, axisA, axisB, pointA, pointB, k, mass: firm && invB > 0 ? invB : mass, end, invA, firm: firm && invB > 0, scaleA, scaleB });
    });
    // Whole sweeps over every link, not each link to the end in turn: a train of gears of very
    // different weights (a light shaft into a heavy frame) only settles when they pass impulses along
    for (let pass = 0; pass < LINK_PASSES; pass++) {
      if (ratchetState.length) holdRatchets(dt, catchUp);
      for (const { l, i, A, B, axisA, axisB, pointA, pointB, k, mass, end, invA, firm, scaleA, scaleB } of active) {
        const speedB = l.kind === 'rack' ? toV3(B.linvel()).dot(axisB) : spin(l.b, axisB);
        const error = k * spin(l.a, axisA) - speedB + (catchUp ? (DRIFT_GAIN * drift.get(i)) / dt : 0);
        if (end) {
          // How the gear asks the rack to move along the slide: past an end, the rack holds still
          const along = (k * spin(l.a, axisA)) * axisB.dot(end.axis);
          if ((end.s <= end.lo + SLIDE_END && along < 0) || (end.s >= end.hi - SLIDE_END && along > 0)) {
            // ...and what had drifted apart is gone: the gear simply stops against it
            if (rackOnSlide.has(i)) rackOnSlide.get(i).offset += drift.get(i);
            // How far the gear has pushed past the end: the motor stalls on it as on a press (checkBlocked)
            endPush.set(i, (endPush.get(i) || 0) + Math.abs(drift.get(i)));
            drift.set(i, 0);
            if (k * k * invA > 0) turnAboutLine(A, axisA, pointA, k * (-(k * spin(l.a, axisA)) / (k * k * invA)), scaleA);
            continue;
          }
          if (Math.abs(along) > 1e-6) endPush.delete(i); // driven back off the end
        }
        const lambda = -error / mass;
        if (!l.oneWay && !firm) turnAboutLine(A, axisA, pointA, k * lambda, scaleA);
        if (B.isDynamic()) {
          if (l.kind === 'rack') B.applyImpulse(vec(axisB.clone().multiplyScalar(-lambda)), true);
          else turnAboutLine(B, axisB, pointB, -lambda, scaleB);
        }
      }
    }
  }
  // A rack on a slide (openspec linear-motion-and-idler-pins): its drift from its gear is measured from
  // where they are, not summed from speeds, since Rapier's slide joint moves the body a little more than
  // its speed says (it corrects its error by position) and a summed drift then never closes
  const rackOnSlide = new Map(); // link index -> { turn (rad the gear has turned), last, offset (m) }
  const turnAbout = (bodyId, axis) => {
    const q = rb.get(bodyId).rotation();
    return 2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w);
  };
  graph.links.forEach((l, i) => {
    if (l.kind === 'rack' && slideOfBody.has(l.b) && rb.get(l.a) && rb.get(l.b) && l.a !== l.b) {
      rackOnSlide.set(i, { turn: 0, last: turnAbout(l.a, new THREE.Vector3(...l.axisA).normalize()), offset: 0 });
    }
  });
  const rackDriftNow = (l, i) => {
    const st = rackOnSlide.get(i);
    const axis = new THREE.Vector3(...l.axisA).normalize();
    const now = turnAbout(l.a, axis);
    st.turn += wrapAngle(now - st.last);
    st.last = now;
    return l.mmPerRad * MM * st.turn - toV3(rb.get(l.b).translation()).dot(axisNow(l.b, new THREE.Vector3(...l.direction).normalize())) - st.offset;
  };
  function trackDrift(dt) {
    graph.links.forEach((l, i) => {
      if (!rb.get(l.a) || !rb.get(l.b) || l.a === l.b) return;
      if (rackOnSlide.has(i)) {
        drift.set(i, rackDriftNow(l, i));
        return;
      }
      const axisA = axisNow(l.a, new THREE.Vector3(...l.axisA).normalize());
      const k = l.kind === 'rack' ? l.mmPerRad * MM : l.sign * l.ratio;
      const sB =
        l.kind === 'rack'
          ? toV3(rb.get(l.b).linvel()).dot(axisNow(l.b, new THREE.Vector3(...l.direction).normalize()))
          : spin(l.b, axisNow(l.b, new THREE.Vector3(...l.axisB).normalize()));
      drift.set(i, drift.get(i) + (k * spin(l.a, axisA) - sB) * dt);
    });
  }

  // --- Ratchets (openspec ratchet-and-pawl, design §7) --------------------------------------------
  // Each ratchet keeps where the pawl's tip is round the tooth under it: `s` (degrees from the steep
  // side the free turn last brought past it, along the sloped side). Turning the free way runs s down
  // to 0, where the tip drops off the crest into the next gap (a click) and s starts again at a whole
  // tooth; turning the held way runs s up to a whole tooth, where the steep side meets the tip and,
  // with the pawl down, stops it. The pawl's angle on its pin follows the tooth outline under the tip.
  const ratchetState = (graph.ratchets || []).map((r) => {
    const period = 360 / r.teeth;
    const n = r.profileMm.length;
    const radiusAt = (deg) => {
      const x = THREE.MathUtils.clamp((deg / period) * n - 0.5, 0, n - 1);
      const i = Math.min(n - 2, Math.floor(x));
      return r.profileMm[i] + (r.profileMm[i + 1] - r.profileMm[i]) * (x - i);
    };
    const lever = Math.abs(r.leverMm) >= 1 ? r.leverMm : 0; // mm of tip radius per radian about the pivot
    return {
      r,
      period,
      radiusAt,
      r0: radiusAt(r.phaseDeg),
      lever,
      axis0: new THREE.Vector3(...r.axis).normalize().multiplyScalar(r.freeSign || 1),
      center0: new THREE.Vector3(...r.point).multiplyScalar(MM),
      pivotAxis0: r.pivot ? new THREE.Vector3(...r.pivot.axis).normalize() : null,
      pivotPoint0: r.pivot ? new THREE.Vector3(...r.pivot.point).multiplyScalar(MM) : null,
      tip0: r.tip ? new THREE.Vector3(...r.tip).multiplyScalar(MM) : null,
      s: r.phaseDeg,
      clicks: 0,
      locked: Boolean(r.locked),
      turn: 0, // the ratchet's turn the free way against its holder since the start (rad)
      down: true
    };
  });
  /** The ratchet's turn the free way against the body holding its pawl (rad, in (−π, π]), from their poses. */
  const ratchetTurn = (st) => {
    const q = toV3q(rb.get(st.r.holderBody).rotation()).invert().multiply(toV3q(rb.get(st.r.ratchetBody).rotation()));
    return 2 * Math.atan2(q.x * st.axis0.x + q.y * st.axis0.y + q.z * st.axis0.z, q.w);
  };
  /** A start-frame point carried by body `bodyId`'s move (m). */
  const carried0 = (bodyId, p0) => {
    const body = rb.get(bodyId);
    return p0.clone().applyQuaternion(toV3q(body.rotation())).add(toV3(body.translation()));
  };
  /** The pawl's turn on its pin against the body holding it (rad, about the pivot axis), from the start. */
  const pawlTurn = (st) => {
    const { r } = st;
    const q = toV3q(rb.get(r.holderBody).rotation()).invert().multiply(toV3q(rb.get(r.pawlBody).rotation()));
    return 2 * Math.atan2(q.x * st.pivotAxis0.x + q.y * st.pivotAxis0.y + q.z * st.pivotAxis0.z, q.w);
  };
  /** How far the pawl has turned outward (rad: its tip moving away from the ratchet's centre), and where the tooth outline puts it. */
  const pawlLift = (st) => {
    const out = pawlTurn(st) * Math.sign(st.lever);
    const surface = (st.radiusAt(THREE.MathUtils.clamp(st.s, 0, st.period)) - st.r0) / Math.abs(st.lever);
    return { out, surface, tipMm: st.r0 + out * Math.abs(st.lever) };
  };
  /** The free-turn speed of a ratchet against the body holding its pawl, and what that turn needs. */
  const ratchetFrame = (st) => {
    const { r } = st;
    const R = rb.get(r.ratchetBody);
    const H = rb.get(r.holderBody);
    if (!R || !H || R === H || (!R.isDynamic() && !H.isDynamic())) return null;
    const axis = axisNow(r.ratchetBody, st.axis0);
    const center = carried0(r.ratchetBody, st.center0);
    const w = toV3(R.angvel()).sub(toV3(H.angvel())).dot(axis);
    const inv = (R.isDynamic() ? 1 / inertiaAbout(R, axis, center) : 0) + (H.isDynamic() ? 1 / inertiaAbout(H, axis, center) : 0);
    return { R, H, axis, center, w, inv };
  };
  /**
   * Changes how fast `body` turns about the world line (point, axis) by `dw` (rad/s), moving its centre
   * of mass with the turn: exact for a body that turns on that line (a ratchet on its shaft), where a
   * pure torque on an arm whose weight sits off the line would mostly go into its hinge.
   */
  const spinAboutLine = (body, axis, point, dw) => {
    if (!body?.isDynamic()) return;
    const dW = axis.clone().multiplyScalar(dw);
    body.setAngvel(vec(toV3(body.angvel()).add(dW)), true);
    body.setLinvel(vec(toV3(body.linvel()).add(dW.cross(toV3(body.worldCom()).sub(point)))), true);
  };
  /** Equal and opposite turns (angular impulse `tau`) on the ratchet and the pawl's holder about the ratchet's axis. */
  const turnRatchetPair = (f, tau) => {
    if (f.R.isDynamic()) spinAboutLine(f.R, f.axis, f.center, tau / inertiaAbout(f.R, f.axis, f.center));
    turnAboutLine(f.H, f.axis, f.center, -tau);
  };
  /** One pass of the ratchet stops: a down pawl at the steep side takes away the held-way turn (a locked pawl, both ways). */
  function holdRatchets(dt, catchUp = true) {
    for (const st of ratchetState) {
      if (inCluster.has(st.r.ratchetBody) || inCluster.has(st.r.holderBody)) continue; // solved with its cluster
      const f = ratchetFrame(st);
      if (!f || f.inv <= 0) continue;
      let target = null;
      if (st.locked) {
        target = catchUp ? -(DRIFT_GAIN * st.turn) / dt : 0;
      } else if (st.down) {
        // How much more held-way turn there is before the steep side meets the tip (rad)
        const room = THREE.MathUtils.degToRad(st.period - st.s);
        if (room + f.w * dt < 0) target = room >= 0 ? -room / dt : catchUp ? -(DRIFT_GAIN * room) / dt : 0;
        if (target !== null && f.w >= target) target = null;
      }
      if (target === null) {
        // The pawl's drag: friction taking out the free turn against its holder, never reversing it
        if (st.dragLeft > 0 && f.w > 0) {
          const take = Math.min(st.dragLeft, f.w / f.inv);
          st.dragLeft -= take;
          turnRatchetPair(f, -take);
        }
        continue;
      }
      turnRatchetPair(f, (target - f.w) / f.inv);
    }
  }
  /** Before each step: the pawl's drag on teeth turning the free way, and the pawl kept on (or let off) the teeth. */
  function rideRatchets(dt) {
    for (const st of ratchetState) {
      const f = ratchetFrame(st);
      if (!f) continue;
      // The pawl drags on teeth turning the free way: friction between the ratchet and the body holding
      // the pawl, up to PAWL_DRAG × dt this substep (taken in holdRatchets, with the stop)
      st.dragLeft = !st.locked && st.down ? PAWL_DRAG * dt : 0;
      if (st.locked || !st.lever || !st.pivotAxis0) continue;
      const P = rb.get(st.r.pawlBody);
      const H = f.H;
      if (!P?.isDynamic()) continue;
      const { out, surface, tipMm } = pawlLift(st);
      const axis = axisNow(st.r.holderBody, st.pivotAxis0).multiplyScalar(Math.sign(st.lever));
      const point = carried0(st.r.holderBody, st.pivotPoint0);
      const wOut = toV3(P.angvel()).sub(toV3(H.angvel())).dot(axis);
      // The teeth push the pawl out to the outline under its tip at once (design §7). A band or its
      // weight presses it back on with at most PAWL_PRESS_TORQUE, so another part can lift it clear;
      // with neither it follows the teeth until lifted clear of their tips, and then stays where it is
      // left (its pin's friction holds it).
      // Lifted clear by something else, not by the teeth themselves (a quick tooth can fling it up a moment)
      if (tipMm < st.r.tipRadiusMm + PAWL_LIFTED_MM) st.liftedClear = false;
      else if (!st.pushedOut) st.liftedClear = true;
      const following = st.r.pressed || simulateGravity || !st.liftedClear;
      st.pushedOut = out < surface;
      const inertia = inertiaAbout(P, axis, point);
      let dw = 0;
      if (out < surface) dw = Math.max(0, (surface - out) / dt - wOut);
      else if (following) dw = Math.max(-PAWL_PRESS_SPEED - wOut, (surface - out) / dt - wOut);
      else dw = -wOut;
      const cap = ((out < surface ? Infinity : following ? PAWL_PRESS_TORQUE : PAWL_PIN_FRICTION) * dt) / inertia;
      dw = THREE.MathUtils.clamp(dw, -cap, cap);
      if (Math.abs(dw) > 1e-9) {
        spinAboutLine(P, axis, point, dw);
        // The teeth pushing the pawl out push back on the ratchet's shaft (straight out from its centre at
        // the tip, so they don't turn it: the pawl's drag does that), and the pin on what holds the pawl
        if (out < surface && st.tip0) {
          const tip = carried0(st.r.pawlBody, st.tip0);
          const u = axis.clone().cross(tip.clone().sub(point));
          const reach = u.length();
          const radial = tip.clone().sub(f.center);
          radial.addScaledVector(f.axis, -radial.dot(f.axis));
          if (reach > 1e-6 && radial.lengthSq() > 1e-12) {
            radial.normalize();
            const along = u.divideScalar(reach).dot(radial);
            if (Math.abs(along) > 0.05) {
              const J = radial.multiplyScalar((inertia * dw) / reach / along);
              if (f.R.isDynamic()) f.R.applyImpulseAtPoint(vec(J.clone().negate()), vec(f.center), true);
              const pawlMomentum = axis.clone().multiplyScalar(dw).cross(toV3(P.worldCom()).sub(point)).multiplyScalar(P.mass());
              if (H.isDynamic()) H.applyImpulseAtPoint(vec(pawlMomentum.sub(J).negate()), vec(point), true);
            }
          }
        }
      }
    }
  }
  /** After each step: where each pawl's tip now is round its tooth, clicks, and whether it is down. */
  function trackRatchets(dt) {
    for (const st of ratchetState) {
      const f = ratchetFrame(st);
      if (!f) continue;
      // Measured from the poses, not summed from speeds: contacts and hinges move bodies within a step
      const now = ratchetTurn(st);
      const prev = st.turn - Math.round(st.turn / (2 * Math.PI)) * 2 * Math.PI;
      let step = now - prev;
      step -= Math.round(step / (2 * Math.PI)) * 2 * Math.PI;
      st.turn += step;
      if (st.locked) continue;
      st.s -= THREE.MathUtils.radToDeg(step);
      const lift = st.lever && st.pivotAxis0 ? pawlLift(st) : null;
      // Down while its tip is under the teeth's tips (a pawl that can't rock is always down)
      st.down = !lift || lift.tipMm < st.r.tipRadiusMm - PAWL_DOWN_MM;
      while (st.s < 0) {
        st.s += st.period;
        st.clicks += 1;
      }
      // Lifted clear, the teeth pass under it the held way too
      while (!st.down && st.s > st.period) st.s -= st.period;
    }
  }

  // --- Gears that swing into and out of mesh (openspec ratchet-and-pawl, design §8–9) ---------------
  // A pair on parts that move apart never collides by hull; it is stopped from coming closer than mesh
  // distance, and while within MESH_ENGAGE_MM of it (until MESH_RELEASE_MM) the teeth are held together
  // where they meet: the two gears' speeds at the pitch point, from each body's whole motion (so an arm
  // swinging is counted), are pulled equal along the teeth by a push at that point, which the hinges
  // pass on to the arm.
  const meshState = (graph.maybeMeshes || []).map((m) => ({
    m,
    distance: (m.radii[0] + m.radii[1]) * MM,
    center0: m.centers.map((c) => new THREE.Vector3(...c).multiplyScalar(MM)),
    axis0: m.axes.map((a) => new THREE.Vector3(...a).normalize()),
    tooth0: m.toothDirs.map((t) => new THREE.Vector3(...t).normalize()),
    engaged: false,
    slip: 0 // m: how far the teeth have slipped past each other along the pitch circle while engaged
  }));
  const velocityAt = (body, p) => toV3(body.linvel()).add(toV3(body.angvel()).cross(p.clone().sub(toV3(body.worldCom()))));
  /** A free body's give at `p` along `u` (1/kg): how much a unit push there changes its speed there. */
  const giveAt = (body, p, u) => {
    if (!body?.isDynamic()) return 0;
    const rxu = p.clone().sub(toV3(body.worldCom())).cross(u);
    const l = rxu.length();
    return body.invMass() + (l > 1e-12 ? (l * l) / inertiaAbout(body, rxu.clone().divideScalar(l)) : 0);
  };
  const meshFrame = (st) => {
    const { m } = st;
    const A = rb.get(m.a);
    const B = rb.get(m.b);
    if (!A || !B || A === B || (!A.isDynamic() && !B.isDynamic())) return null;
    const cA = carried0(m.a, st.center0[0]);
    const cB = carried0(m.b, st.center0[1]);
    const axis = axisNow(m.a, st.axis0[0]);
    const d = cB.clone().sub(cA);
    d.addScaledVector(axis, -d.dot(axis));
    const apart = d.length();
    if (apart < 1e-9) return null;
    const n = d.divideScalar(apart);
    const P = cA.clone().addScaledVector(n, (m.radii[0] / (m.radii[0] + m.radii[1])) * apart);
    const t = axis.clone().cross(n);
    return { A, B, HA: rb.get(m.holders[0]) || A, HB: rb.get(m.holders[1]) || B, cA, cB, axis, n, apart, P, t };
  };
  /** One pass: gears kept from coming closer than mesh distance, and engaged pairs held together at their teeth. */
  function holdMeshes(dt, catchUp = true) {
    for (const st of meshState) {
      const f = meshFrame(st);
      if (!f) continue;
      // Not closer than mesh distance: take away the closing speed (and the depth, a little each step)
      const depth = st.distance - f.apart;
      const closing = velocityAt(f.B, f.cB).sub(velocityAt(f.A, f.cA)).dot(f.n);
      // Inside mesh distance: back out a little each step; outside it: close at most the gap in this step
      const wanted = depth > 0 ? (catchUp ? (DRIFT_GAIN * depth) / dt : 0) : depth / dt;
      if (closing < wanted) {
        // The push goes to what carries each gear's shaft (an arm), at the gear's centre
        const [HA, HB] = [f.HA, f.HB];
        const give = giveAt(HA, f.cA, f.n) + giveAt(HB, f.cB, f.n);
        if (give > 0) {
          const J = (wanted - closing) / give;
          if (HB.isDynamic()) HB.applyImpulseAtPoint(vec(f.n.clone().multiplyScalar(J)), vec(f.cB), true);
          if (HA.isDynamic()) HA.applyImpulseAtPoint(vec(f.n.clone().multiplyScalar(-J)), vec(f.cA), true);
        }
      }
      if (!st.engaged) continue;
      // The teeth move together where they meet: a push along the teeth at the pitch point. A gear whose
      // shaft is held by a body that holds still only turns about that shaft; one carried by a moving
      // body (an arm) takes the push as a free body, and its hinge passes it on to the arm.
      const error = velocityAt(f.A, f.P).sub(velocityAt(f.B, f.P)).dot(f.t) + (catchUp ? (DRIFT_GAIN * st.slip) / dt : 0);
      const sides = [
        { G: f.A, H: f.HA, c: f.cA, axis: f.axis, sign: 1 },
        { G: f.B, H: f.HB, c: f.cB, axis: axisNow(st.m.b, st.axis0[1]), sign: -1 }
      ];
      let give = 0;
      for (const sd of sides) {
        if (!sd.G.isDynamic()) continue;
        sd.onShaft = sd.H !== sd.G && !sd.H.isDynamic() && !motorTurned.has(sd.G);
        if (sd.onShaft) {
          sd.lever = f.P.clone().sub(sd.c).cross(f.t).dot(sd.axis);
          sd.inertia = inertiaAbout(sd.G, sd.axis, sd.c);
          give += (sd.lever * sd.lever) / sd.inertia;
        } else give += giveAt(sd.G, f.P, f.t);
      }
      if (give <= 0) continue;
      const J = -error / give;
      for (const sd of sides) {
        if (!sd.G.isDynamic()) continue;
        if (sd.onShaft) spinAboutLine(sd.G, sd.axis, sd.c, (sd.sign * J * sd.lever) / sd.inertia);
        else sd.G.applyImpulseAtPoint(vec(f.t.clone().multiplyScalar(sd.sign * J)), vec(f.P), true);
      }
    }
  }
  /** The gear `k` of a pair as the meshing rule sees it now (for the tooth misfit when it engages). */
  const toothedNow = (st, k, f) => {
    const { m } = st;
    const body = k === 0 ? m.a : m.b;
    const center = (k === 0 ? f.cA : f.cB).clone().divideScalar(MM);
    const axis = axisNow(body, st.axis0[k]);
    const t0 = center.dot(axis);
    return { kind: 'gear', instanceId: m.gears[k], teeth: m.teeth[k], pitchRadiusMm: m.radii[k], center, axis, toothDir: axisNow(body, st.tooth0[k]), faceSpan: [t0 + m.faceSpans[k][0], t0 + m.faceSpans[k][1]], faceMid: center.clone().addScaledVector(axis, (m.faceSpans[k][0] + m.faceSpans[k][1]) / 2) };
  };
  /** A body's turn about `axis` since the start (rad, in (−π, π]), from its pose. */
  const bodyTurn = (bodyId, axis) => {
    const q = toV3q(rb.get(bodyId).rotation());
    return 2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w);
  };
  /** Adds the step from `prev` (unwrapped) to `now` (in (−π, π]), unwrapped. */
  const unwrap = (prev, now) => {
    let step = now - (prev - Math.round(prev / (2 * Math.PI)) * 2 * Math.PI);
    step -= Math.round(step / (2 * Math.PI)) * 2 * Math.PI;
    return prev + step;
  };
  /**
   * How far the teeth have rolled against each other (m), from the poses: each gear's turn about A's
   * axis less the turn of the line between their centres, through its pitch radius. Steady while the
   * teeth roll together; its change since the pair engaged is the slip taken back.
   */
  const meshRoll = (st, f) => {
    st.turnA = unwrap(st.turnA ?? 0, bodyTurn(st.m.a, st.axis0[0]));
    st.turnB = unwrap(st.turnB ?? 0, bodyTurn(st.m.b, st.axis0[0]));
    const line = Math.atan2(st.n0.clone().cross(f.n).dot(f.axis), st.n0.dot(f.n));
    st.line = unwrap(st.line ?? 0, line);
    return (st.m.radii[0] * (st.turnA - st.line) + st.m.radii[1] * (st.turnB - st.line)) * MM;
  };
  /** After each step: which pairs are in mesh now, and how far engaged teeth have slipped. */
  function trackMeshes() {
    for (const st of meshState) {
      const f = meshFrame(st);
      if (!f) continue;
      st.n0 ||= f.n.clone();
      const roll = meshRoll(st, f);
      const off = Math.abs(f.apart - st.distance) / MM;
      if (st.engaged && off > MESH_RELEASE_MM) st.engaged = false;
      else if (!st.engaged && off <= MESH_ENGAGE_MM) {
        st.engaged = true;
        // Coming together, one gear slips (at most half a tooth) so the teeth fit instead of jumping
        // Two pairs of gears on the same two bodies (a doubled gear train) slip together, by the first one's misfit
        const twin = meshState.find((o) => o !== st && o.engaged && new Set([o.m.a, o.m.b, st.m.a, st.m.b]).size === 2);
        const turn = twin || (st.m.meshedOnEntry && !st.started) ? null : meshTurn(toothedNow(st, 1, f), [toothedNow(st, 0, f)]);
        st.rollAtEngage = twin ? roll - twin.slip : roll + (turn ? THREE.MathUtils.degToRad(turn.turnDeg) * st.m.radii[1] * MM : 0);
      }
      st.started = true;
      if (st.engaged) st.slip = roll - st.rollAtEngage;
    }
  }

  // --- Clusters: gears on parts that move apart, solved together (openspec ratchet-and-pawl, design §8–9) ---
  // Bodies tied by gears that may swing into or out of mesh, and ratchets whose pawl rides a moving body,
  // are solved together each substep in hinge coordinates: one turn speed per body about its own hinge
  // (relative to the body it hangs on). Their inertia matrix in those coordinates is exact, so a light
  // gear's speed from a load carries no more momentum than it has. Rows (all at once, projected
  // Gauss–Seidel): teeth moving together at the pitch point (two-sided), the mesh-distance stop and the
  // ratchet's stop (one-sided), and the pawl's drag (bounded). Rapier's hinges keep positions together.
  // Gear links where no shaft's holder can move stay on the old path (holdLinks).
  const CLUSTER_PASSES = 40;
  const clusters = (() => {
    const fixedNow = (id) => !rb.get(id)?.isDynamic();
    const members = new Set();
    for (const m of graph.maybeMeshes || []) for (const id of [m.a, m.b, ...m.holders]) if (id && !fixedNow(id)) members.add(id);
    for (const r of graph.ratchets || []) if (!fixedNow(r.holderBody) && !fixedNow(r.ratchetBody)) members.add(r.ratchetBody).add(r.holderBody);
    if (!members.size) return [];
    // Each member hangs on the body it was reached from, walking out from bodies that hold still (or
    // from members hinged to bodies outside the cluster)
    const parent = new Map();
    const hingeOf = new Map();
    const reached = new Set();
    const queue = [];
    for (const id of members) {
      const out = graph.hinges.find((h) => (h.a === id || h.b === id) && !members.has(h.a === id ? h.b : h.a) && (fixedNow(h.a === id ? h.b : h.a) || graph.fixed.includes(h.a === id ? h.b : h.a)));
      if (out) {
        parent.set(id, out.a === id ? out.b : out.a);
        hingeOf.set(id, out);
        reached.add(id);
        queue.push(id);
      }
    }
    while (queue.length) {
      const cur = queue.shift();
      for (const h of graph.hinges) {
        const next = h.a === cur ? h.b : h.b === cur ? h.a : null;
        if (!next || !members.has(next) || reached.has(next)) continue;
        parent.set(next, cur);
        hingeOf.set(next, h);
        reached.add(next);
        queue.push(next);
      }
    }
    const list = [...members].filter((id) => reached.has(id));
    return list.length ? [{ bodies: list, parent, hinge: (id) => hingeOf.get(id) }] : [];
  })();
  const inCluster = new Set(clusters.flatMap((c) => c.bodies));
  // The hinge line a cluster body turns on (start frame: carried by the body it hangs on)
  for (const c of clusters) {
    c.line = new Map(c.bodies.map((id) => {
      const h = c.hinge(id);
      const ha = hingeAxis.get(h.id);
      // hingeAxis stores the line in body a's start frame; carried by a's move
      return [id, { a: h.a, axis0: ha.axis.clone(), point0: ha.point.clone() }];
    }));
  }
  const worldInertia = (body) => {
    const R = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(toV3q(body.rotation()).multiply(toV3q(body.principalInertiaLocalFrame()))));
    const i = body.principalInertia();
    const D = new THREE.Matrix3().set(i.x, 0, 0, 0, i.y, 0, 0, 0, i.z);
    return R.clone().multiply(D).multiply(R.clone().transpose());
  };
  /** Solves cluster `c` for this substep (see above). */
  function solveCluster(c, dt, catchUp) {
    const ids = c.bodies;
    const n = ids.length;
    const index = new Map(ids.map((id, k) => [id, k]));
    // Each coordinate's hinge line now, and each body's ancestors in the cluster
    const lines = ids.map((id) => {
      const L = c.line.get(id);
      return { axis: axisNow(L.a, L.axis0), point: carried0(L.a, L.point0) };
    });
    const chain = ids.map((id) => {
      const out = [];
      for (let cur = id; index.has(cur); cur = c.parent.get(cur)) out.push(index.get(cur));
      return out;
    });
    const root = ids.map((id) => {
      let cur = id;
      while (index.has(cur)) cur = c.parent.get(cur);
      return rb.get(cur);
    });
    const bodies = ids.map((id) => rb.get(id));
    const com = bodies.map((b) => toV3(b.worldCom()));
    // Each body's twist from one unit of coordinate k: [w, v at its centre of mass]
    const unit = ids.map((_, b) => ids.map((__, k) => {
      if (!chain[b].includes(k)) return null;
      const { axis, point } = lines[k];
      return { w: axis.clone(), v: axis.clone().cross(com[b].clone().sub(point)) };
    }));
    // The part of each body's motion that comes from outside the cluster (the root it hangs from)
    const ext = ids.map((_, b) => {
      const R = root[b];
      if (!R) return { w: new THREE.Vector3(), v: new THREE.Vector3() };
      const w = toV3(R.angvel());
      return { w, v: toV3(R.linvel()).add(w.clone().cross(com[b].clone().sub(toV3(R.worldCom())))) };
    });
    // Coordinates now: each body's turn speed about its hinge against the body it hangs on
    const u = ids.map((id, b) => {
      const pid = c.parent.get(id);
      const pw = index.has(pid) ? toV3(bodies[index.get(pid)].angvel()) : root[b] ? toV3(root[b].angvel()) : new THREE.Vector3();
      return toV3(bodies[b].angvel()).sub(pw).dot(lines[b].axis);
    });
    // Inertia matrix in these coordinates
    const M = ids.map(() => new Array(n).fill(0));
    for (let b = 0; b < n; b++) {
      if (!bodies[b].isDynamic()) continue;
      const m = bodies[b].mass();
      const I = worldInertia(bodies[b]);
      for (let k = 0; k < n; k++) {
        const uk = unit[b][k];
        if (!uk) continue;
        for (let l = 0; l < n; l++) {
          const ul = unit[b][l];
          if (!ul) continue;
          M[k][l] += m * uk.v.dot(ul.v) + uk.w.dot(ul.w.clone().applyMatrix3(I));
        }
      }
    }
    // Invert (tiny: Gauss–Jordan)
    const W = ids.map((_, i) => ids.map((__, j) => (i === j ? 1 : 0)));
    const A = M.map((row) => [...row]);
    for (let i = 0; i < n; i++) {
      let piv = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
      [A[i], A[piv]] = [A[piv], A[i]];
      [W[i], W[piv]] = [W[piv], W[i]];
      const d = A[i][i] || 1e-12;
      for (let j = 0; j < n; j++) {
        A[i][j] /= d;
        W[i][j] /= d;
      }
      for (let r = 0; r < n; r++) {
        if (r === i || !A[r][i]) continue;
        const f = A[r][i];
        for (let j = 0; j < n; j++) {
          A[r][j] -= f * A[i][j];
          W[r][j] -= f * W[i][j];
        }
      }
    }
    // A row is a linear function of the bodies' motion: (twist of body b) -> number. As a function of u:
    // value = g·u + e. `terms`: [{ body, w, v, at }] meaning w·ω_b + v·(velocity of b at point `at`)
    const rowOf = (terms, velAt = velocityAt) => {
      const g = new Array(n).fill(0);
      let e = 0;
      for (const t of terms) {
        const b = index.get(t.body);
        const value = (tw) => (t.w ? t.w.dot(tw.w) : 0) + (t.v ? t.v.dot(tw.v.clone().add(tw.w.clone().cross(t.at.clone().sub(com[b])))) : 0);
        if (b === undefined) {
          // a body outside the cluster: its motion now is a constant
          const B = rb.get(t.body);
          if (!B) continue;
          const w = toV3(B.angvel());
          e += (t.w ? t.w.dot(w) : 0) + (t.v ? t.v.dot(velAt(B, t.at)) : 0);
          continue;
        }
        e += value(ext[b]);
        for (let k = 0; k < n; k++) if (unit[b][k]) g[k] += value(unit[b][k]);
      }
      return { g, e };
    };
    const rows = [];
    // Gears: engaged pairs hold their teeth together (a doubled pair on the same bodies is one row); every
    // pair keeps from coming closer than mesh distance
    const pairsDone = new Set();
    for (const st of meshState) {
      const f = meshFrame(st);
      if (!f) continue;
      const depth = st.distance - f.apart;
      const stop = rowOf([
        { body: st.m.b, v: f.n.clone(), at: f.cB },
        { body: st.m.a, v: f.n.clone().negate(), at: f.cA }
      ]);
      rows.push({ ...stop, kind: 'stop', target: depth > 0 ? (catchUp ? (DRIFT_GAIN * depth) / dt : 0) : depth / dt, lo: 0, hi: Infinity });
      if (!st.engaged) continue;
      const key = [st.m.a, st.m.b].sort().join('|');
      if (pairsDone.has(key)) continue;
      pairsDone.add(key);
      const halfTooth = (Math.PI * st.m.radii[0] * MM) / st.m.teeth[0];
      const slip = THREE.MathUtils.clamp(st.slip, -halfTooth, halfTooth);
      const slipTarget = catchUp ? -(DRIFT_GAIN * slip) / dt : 0;
      // Two one-sided tooth flanks: kinematic speed matching is purely tangential (g), while the
      // applied tooth impulse (gf) is tilted by the pressure angle so load pushes the gears apart
      const tanA = Math.tan(THREE.MathUtils.degToRad(28));
      const tRow = rowOf([
        { body: st.m.a, v: f.t.clone(), at: f.P },
        { body: st.m.b, v: f.t.clone().negate(), at: f.P }
      ]);
      const f1 = f.t.clone().addScaledVector(f.n, -tanA);
      const f2 = f.t.clone().negate().addScaledVector(f.n, -tanA);
      const gf1 = rowOf([
        { body: st.m.a, v: f1, at: f.P },
        { body: st.m.b, v: f1.clone().negate(), at: f.P }
      ]).g;
      const gf2 = rowOf([
        { body: st.m.a, v: f2, at: f.P },
        { body: st.m.b, v: f2.clone().negate(), at: f.P }
      ]).g;
      rows.push({ g: tRow.g, gf: gf1, e: tRow.e, kind: 'teeth', target: slipTarget, lo: 0, hi: Infinity });
      rows.push({ g: tRow.g.map((x) => -x), gf: gf2, e: -tRow.e, kind: 'teeth', target: -slipTarget, lo: 0, hi: Infinity });
    }
    // Ratchets whose ratchet or holder is in this cluster
    for (const st of ratchetState) {
      if (!index.has(st.r.ratchetBody) && !index.has(st.r.holderBody)) continue;
      const axis = axisNow(st.r.ratchetBody, st.axis0);
      const w = rowOf([
        { body: st.r.ratchetBody, w: axis.clone() },
        { body: st.r.holderBody, w: axis.clone().negate() }
      ]);
      if (st.locked) rows.push({ ...w, kind: 'ratchet', target: catchUp ? -(DRIFT_GAIN * st.turn) / dt : 0, lo: -Infinity, hi: Infinity });
      else if (st.down) {
        const room = THREE.MathUtils.degToRad(st.period - st.s);
        rows.push({ ...w, kind: 'ratchet', target: room >= 0 ? -room / dt : catchUp ? -(DRIFT_GAIN * room) / dt : 0, lo: 0, hi: Infinity });
        if (st.dragLeft > 0) rows.push({ ...w, kind: 'drag', st, target: 0, lo: -st.dragLeft, hi: 0 });
      }
    }
    // Ropes touching this cluster (openspec rope-and-spool, design decision 14): solved with the
    // gears and ratchet in one PGS pass, with outside bodies participating through their give `now.w`
    if (catchUp && pullingRopes.length) {
      ropeStepH = dt;
      const held = heldByMotors();
      for (const rope of pullingRopes) {
        if (clusterRopesDone.has(rope.id) || !rope.bodies.some((id) => index.has(id))) continue;
        clusterRopesDone.add(rope.id);
        const rst = ropeState.get(rope.id);
        const now = ropeNow(rope, rst, { skipBodies: index });
        if (!now) continue;
        const terms = [];
        for (let i = 0; i < now.pts.length; i++) {
          const id = rope.bodies[i];
          const body = id ? rb.get(id) : null;
          if (!body || !body.isDynamic() || held.has(id)) continue;
          if (i > 0) terms.push({ body: id, v: now.runs[i - 1].clone().negate(), at: now.pts[i].a });
          if (i < now.pts.length - 1) terms.push({ body: id, v: now.runs[i].clone(), at: now.pts[i].b });
        }
        const row = rowOf(terms, ropeVelocityAt);
        const stretch0 = -(row.g.reduce((sum, x, j) => sum + x * u[j], 0) + row.e);
        if (now.C + Math.max(0, stretch0 + rst.bias) * dt < -ROPE_PULL.slackMm * MM) {
          rst.T = 0;
          rst.bias = 0;
          rst.expectC = null;
          continue;
        }
        if (rst.expectC !== null) {
          const push = ropeContactPush(now);
          const prevPush = rst.push;
          const nextPush = push === null ? null : prevPush === null ? push : prevPush + 0.2 * (push - prevPush);
          const pressed = push !== null && !(prevPush !== null && nextPush < prevPush * 0.9995);
          rst.push = nextPush;
          if (pressed) rst.bias *= 0.5;
          else rst.bias += ROPE_PULL.biasGain * ((now.C - rst.expectC) / dt - rst.bias);
        }
        rows.push({
          ...row,
          kind: 'rope',
          rope,
          rst,
          now,
          wOut: now.w,
          target: rst.bias + (now.C > 0 ? ROPE_PULL.beta * now.C : now.C) / dt,
          lo: 0,
          hi: ROPE_PULL.maxN * dt
        });
      }
    }
    if (!rows.length) return;
    // Projected Gauss–Seidel on the reduced system
    const Wg = (g) => W.map((row) => row.reduce((sum, x, j) => sum + x * g[j], 0));
    for (const r of rows) {
      r.Wg = Wg(r.gf || r.g);
      r.K = r.g.reduce((sum, x, j) => sum + x * r.Wg[j], 0) + (r.wOut || 0);
      r.lambda = 0;
    }
    for (let pass = 0; pass < CLUSTER_PASSES; pass++) {
      for (const r of rows) {
        if (!(r.K > 1e-12)) continue;
        const value = r.g.reduce((sum, x, j) => sum + x * u[j], 0) + r.e + (r.wOut || 0) * r.lambda;
        let next = r.lambda + (r.target - value) / r.K;
        next = Math.min(r.hi, Math.max(r.lo, next));
        const d = next - r.lambda;
        if (!d) continue;
        r.lambda = next;
        for (let j = 0; j < n; j++) u[j] += r.Wg[j] * d;
      }
    }
    for (const r of rows) {
      if (r.kind === 'drag') r.st.dragLeft = Math.max(0, r.st.dragLeft + r.lambda);
      else if (r.kind === 'rope') {
        r.rst.T = r.lambda / dt;
        pullImpulse(r.now, r.lambda);
        const shortenFinal = r.g.reduce((sum, x, j) => sum + x * u[j], 0) + r.e + (r.wOut || 0) * r.lambda;
        r.rst.expectC = r.now.C - shortenFinal * dt;
        clusterRopesLive.push([r.rope, r.rst, r.now]);
      }
    }
    // Write the bodies' motion back from the solved coordinates
    for (let b = 0; b < n; b++) {
      if (!bodies[b].isDynamic()) continue;
      const w = ext[b].w.clone();
      const v = ext[b].v.clone();
      for (const k of chain[b]) {
        w.addScaledVector(unit[b][k].w, u[k]);
        v.addScaledVector(unit[b][k].v, u[k]);
      }
      bodies[b].setAngvel(vec(w), true);
      bodies[b].setLinvel(vec(v), true);
    }
  }

  // Which pairs are in mesh at the start
  for (const st of meshState) {
    const f = meshFrame(st);
    st.engaged = Boolean(f && Math.abs(f.apart - st.distance) / MM <= MESH_ENGAGE_MM);
    if (f) {
      st.n0 = f.n.clone();
      st.rollAtEngage = meshRoll(st, f);
      st.started = true;
    }
  }

  // Motors: torque about the hinge, the motor body pushed back the other way. The torque steers to
  // the throttle's speed by what it turns (shaft and gear train): a part for how far off it is, and
  // a part that builds up while it stays off (for the friction, damping and linkages that weighs
  // nothing for); both within the motor's stall torque.
  const motorState = new Map(
    graph.motors.map((m) => [m.id, { rel: 0, smooth: 0, slowFor: 0, stalled: false, push: 0, lastDir: 0, relAfter: null, holdLoad: 0, holdAngle: 0, holdRef: null, mode: m.stopping || 'brake', blocked: 0, depth: 0, wobbleTime: 0, wobbleAmp: 0, wobbleFreq: WOBBLE_FREQ }])
  );
  // What else each motor turns through its gears and chains: [{ body, axis, gear, factor }], where
  // the body turns `factor` times as fast as the shaft, so it weighs factor² as much on the motor
  // (gears in mesh on entry on parts that can move apart count too, for how much the motor turns)
  const trainLinks = [
    ...graph.links,
    ...(graph.maybeMeshes || []).filter((m) => m.meshedOnEntry).map((m) => ({ kind: 'gear', a: m.a, b: m.b, ratio: m.teeth[0] / m.teeth[1], axisA: m.axes[0], axisB: m.axes[1], gears: m.gears }))
  ];
  const trains = new Map(
    graph.motors.map((m) => {
      const start = hingeAxis.get(m.hinge).b;
      const factor = new Map([[start, 1]]);
      const out = [];
      for (let i = 0, queue = [start]; i < queue.length; i++) {
        const cur = queue[i];
        for (const l of trainLinks) {
          // A body on a slide driven through a rack weighs on the motor as its mass at the gear's pitch
          // radius (openspec linear-motion-and-idler-pins); it hangs on no further train
          if (l.kind === 'rack' && l.a === cur && slideOfBody.has(l.b) && !factor.has(l.b) && rb.get(l.b)?.isDynamic()) {
            factor.set(l.b, factor.get(cur));
            out.push({ body: l.b, rack: Math.abs(l.mmPerRad) * MM, factor: factor.get(cur) });
            continue;
          }
          if (l.kind === 'rack' || (l.a !== cur && l.b !== cur)) continue;
          if (l.oneWay && l.a !== cur) continue; // a gear doesn't turn its worm
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
  /** How much a train body weighs on its motor's shaft, before its factor²: about its gear's axis, or a slide's mass at the gear. */
  const trainInertia = (t) => (t.rack ? rb.get(t.body).mass() * t.rack * t.rack : inertiaAbout(rb.get(t.body), axisNow(t.body, t.axis), worldPointOf(t.body, t.gear)));
  // Bodies a motor turns through its shaft and gears (as rigid bodies), for the gears that may swing into mesh
  const motorTurned = new Set(graph.motors.flatMap((m) => [hingeAxis.get(m.hinge).b, ...trains.get(m.id).map((t) => t.body)]).map((id) => rb.get(id)).filter(Boolean));
  // Bodies turned directly by each motor (its shaft body and any gears or sprockets linked to it)
  const directDriven = new Map(
    graph.motors.map((m) => [
      m.id,
      new Set([hingeAxis.get(m.hinge).b, ...trains.get(m.id).map((t) => t.body)])
    ])
  );
  // Everything each motor moves: its shaft's body, then whatever hangs on it through hinges and gear
  // or chain ties, never another motor's shaft/train, the body the motor sits on, or a fixed body
  const driven = new Map(
    graph.motors.map((m) => {
      const { a: holder, b: start } = hingeAxis.get(m.hinge);
      const otherMotorBodies = new Set();
      for (const [id, bodies] of directDriven) {
        if (id !== m.id) for (const b of bodies) otherMotorBodies.add(b);
      }
      const seen = new Set([start]);
      for (let i = 0, queue = [start]; i < queue.length; i++) {
        const cur = queue[i];
        const next = [
          ...graph.hinges.filter((h) => (!h.motor || h.motor === m.id) && (h.a === cur || h.b === cur)).map((h) => (h.a === cur ? h.b : h.a)),
          ...graph.links.filter((l) => l.a === cur || l.b === cur).map((l) => (l.a === cur ? l.b : l.a))
        ];
        for (const id of next) {
          if (id === holder || seen.has(id) || otherMotorBodies.has(id) || !rb.get(id)?.isDynamic()) continue;
          seen.add(id);
          queue.push(id);
        }
      }
      return [m.id, [...seen].filter((id) => rb.get(id)?.isDynamic())];
    })
  );
  // Everything each motor carries (including child assemblies riding on its arm), mapped to its base
  // pivot on the motor's holder and speed ratio factor so we can weigh its gravitational & bearing load
  const loadBranches = new Map(
    graph.motors.map((m) => {
      const { a: holder, b: start, axis: startAxis, point: startPoint } = hingeAxis.get(m.hinge);
      const entries = new Map([[start, { body: start, holderBody: holder, pivot: startPoint, axis: startAxis, factor: 1, sign: 1, stages: 0 }]]);
      // First seed the direct gear/chain train from the motor shaft
      const trainQueue = [start];
      for (let i = 0; i < trainQueue.length; i++) {
        const cur = trainQueue[i];
        const curEntry = entries.get(cur);
        for (const l of graph.links) {
          if (l.kind === 'rack' || (l.a !== cur && l.b !== cur)) continue;
          if (l.oneWay && l.a !== cur) continue; // a gear doesn't turn its worm
          const forward = l.a === cur;
          const next = forward ? l.b : l.a;
          if (next === holder || entries.has(next) || !rb.get(next)?.isDynamic()) continue;
          const ratio = Math.abs(forward ? l.ratio : 1 / l.ratio);
          const factor = curEntry.factor * ratio;
          const gearAxis = new THREE.Vector3(...(forward ? l.axisB : l.axisA)).normalize();
          const curAxis = new THREE.Vector3(...(forward ? l.axisA : l.axisB)).normalize();
          const sign = curEntry.sign * l.sign * (Math.sign(curEntry.axis.dot(curAxis)) || 1);
          const ownHinge = graph.hinges.find((h) => (h.a === holder && h.b === next) || (h.b === holder && h.a === next));
          let pivot = curEntry.pivot;
          const axis = gearAxis;
          if (ownHinge) {
            pivot = hingeAxis.get(ownHinge.id).point;
          } else {
            const gearInst = byId.get(l.gears[forward ? 1 : 0]);
            if (gearInst) pivot = new THREE.Vector3(...gearInst.position).multiplyScalar(MM);
          }
          entries.set(next, { body: next, holderBody: holder, pivot, axis, factor, sign, stages: curEntry.stages + 1 });
          trainQueue.push(next);
        }
      }
      // Then walk hinged bodies hanging off the geared stages (preferring the furthest geared stage over the raw motor shaft)
      const hingeQueue = [...entries.keys()].sort((a, b) => entries.get(b).stages - entries.get(a).stages);
      for (let i = 0; i < hingeQueue.length; i++) {
        const cur = hingeQueue[i];
        const curEntry = entries.get(cur);
        for (const h of graph.hinges) {
          if (h.a !== cur && h.b !== cur) continue;
          const next = h.a === cur ? h.b : h.a;
          if (next === holder || entries.has(next) || !rb.get(next)?.isDynamic()) continue;
          entries.set(next, { ...curEntry, body: next });
          hingeQueue.push(next);
        }
      }
      return [m.id, [...entries.values()]];
    })
  );
  // Ground-contacting drive wheels: a motor mounted on the fixed chassis whose shaft/train turns a
  // wheel at the bottom of the robot carries its share of the whole robot's weight
  const bodyMinY = new Map(
    graph.bodies.map((b) => [
      b.id,
      Math.min(...b.parts.map((id) => (partMinY.has(id) ? partMinY.get(id) : Infinity)))
    ])
  );
  const nonLooseMinY = [...bodyMinY.entries()].filter(([id]) => !looseSet.has(id)).map(([, y]) => y);
  const robotMinY = Math.min(...(nonLooseMinY.length ? nonLooseMinY : bodyMinY.values()));
  // Floor plane at the base of the robot so unanchored parts fall onto the floor when gravity is simulated
  // and the whole robot lands on it during a drop test
  const mainFixedId = graph.fixed.find((f) => !sliders.has(f) && !looseSet.has(f)) || graph.fixed[0];
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  if (Number.isFinite(robotMinY)) {
    const floorDesc = RAPIER.ColliderDesc.cuboid(4.0, 0.5, 4.0)
      .setTranslation(0, robotMinY - 0.5, 0)
      .setFriction(0.55)
      .setRestitution(0.28)
      .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    floorCol = world.createCollider(floorDesc, groundBody);
    floorHandle = floorCol.handle;
    for (const [bId, cols] of bodyColliders) {
      if (looseSet.has(bId)) continue;
      if ((bodyMinY.get(bId) ?? Infinity) <= robotMinY + 0.004) {
        for (const c of cols) {
          const pk = pairKey(c.handle, floorHandle);
          floorSkip.add(pk);
          skip.add(pk);
        }
      }
    }
  }
  // Parts on a single pin (free hinge) not held by any motor's train droop under gravity when enabled
  const motorHeldBodies = new Set();
  for (const branches of loadBranches.values()) {
    for (const b of branches) motorHeldBodies.add(b.body);
  }
  // A body on a slide falls along it when gravity is on (openspec linear-motion-and-idler-pins); what
  // drives it through a rack feels its weight there
  const slidingBodies = new Set((graph.slideJoints || []).map((j) => j.b).filter((id) => rb.get(id)?.isDynamic()));
  const unheldGravityBodies = new Set();
  for (const b of graph.bodies) {
    if (looseSet.has(b.id) || motorHeldBodies.has(b.id) || slidingBodies.has(b.id) || !rb.get(b.id)?.isDynamic()) continue;
    if ((bodyMinY.get(b.id) ?? Infinity) <= robotMinY + 0.005) continue; // passive ground wheel
    const h = graph.hinges.find((x) => x.a === b.id || x.b === b.id);
    if (!h) continue;
    const ha = hingeAxis.get(h.id);
    const r = toV3(rb.get(b.id).worldCom()).sub(ha.point);
    r.addScaledVector(ha.axis, -r.dot(ha.axis));
    if (r.length() > 0.006) unheldGravityBodies.add(b.id);
  }
  function applyGravityMode() {
    for (const bId of slidingBodies) {
      rb.get(bId).setGravityScale(simulateGravity ? 1 : 0, true);
      rb.get(bId).wakeUp();
    }
    for (const bId of ropedSet) {
      const body = rb.get(bId);
      if (!body) continue;
      body.setGravityScale(simulateGravity ? 1 : 0, true);
      body.wakeUp();
    }
    for (const bId of looseSet) {
      const body = rb.get(bId);
      if (!body) continue;
      if (simulateGravity) {
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        body.setGravityScale(1, true);
        body.wakeUp();
      } else {
        body.setTranslation({ x: 0, y: 0, z: 0 }, true);
        body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        body.setGravityScale(0, true);
        body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
      }
    }
    for (const bId of unheldGravityBodies) {
      const body = rb.get(bId);
      if (!body) continue;
      if (simulateGravity) {
        body.setGravityScale(1, true);
        body.wakeUp();
      } else {
        body.setTranslation({ x: 0, y: 0, z: 0 }, true);
        body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        body.setGravityScale(0, true);
      }
    }
  }
  applyGravityMode();
  let totalRobotWeight = 0;
  world.forEachCollider((c) => {
    if (c.handle !== floorHandle) totalRobotWeight += c.mass() * GRAVITY;
  });
  const driveWheelRadius = new Map();
  for (const m of graph.motors) {
    const holder = hingeAxis.get(m.hinge).a;
    if (!fixed.has(holder)) continue;
    const direct = directDriven.get(m.id);
    let maxRadius = 0;
    for (const b of loadBranches.get(m.id) || []) {
      if (!direct.has(b.body)) continue;
      const minY = bodyMinY.get(b.body) ?? Infinity;
      if (minY <= robotMinY + 0.005 && b.pivot.y - minY > 0.01) {
        maxRadius = Math.max(maxRadius, b.pivot.y - minY);
      }
    }
    if (maxRadius > 0) driveWheelRadius.set(m.id, maxRadius);
  }
  const driveMotorCount = Math.max(1, driveWheelRadius.size);
  const driveBaseLoad = new Map(
    [...driveWheelRadius.entries()].map(([id, radius]) => [
      id,
      DRIVE_ROLL_LOAD * (totalRobotWeight / driveMotorCount) * radius
    ])
  );
  /** Signed gravitational torque (N·m) opposing a +1 turn of `motorId`'s shaft. */
  function calcGravityTorque(motorId) {
    let tau = 0;
    for (const b of loadBranches.get(motorId) || []) {
      const body = rb.get(b.body);
      const holder = rb.get(b.holderBody);
      if (!body?.isDynamic() || !holder) continue;
      const p = b.pivot.clone().applyQuaternion(toV3q(holder.rotation())).add(toV3(holder.translation()));
      const u = axisNow(b.holderBody, b.axis);
      const r = toV3(body.worldCom()).sub(p);
      const tangentPlus = u.clone().multiplyScalar(b.sign).cross(r);
      if (tangentPlus.length() < 0.02) continue;
      tau += b.factor * body.mass() * GRAVITY * tangentPlus.y;
    }
    return tau;
  }
  /** Gravitational + bearing + drivetrain robot-weight load torque (N·m) on motor `motorId`'s shaft when turning in `dir` (±1). */
  function calcLoadTorque(motorId, dir) {
    if (!dir) return 0;
    const gravBoost = simulateGravity ? 1.25 : 1;
    let tau = (driveBaseLoad.get(motorId) || 0) * (simulateGravity ? 1.15 : 1);
    for (const b of loadBranches.get(motorId) || []) {
      const body = rb.get(b.body);
      const holder = rb.get(b.holderBody);
      if (!body?.isDynamic() || !holder) continue;
      const p = b.pivot.clone().applyQuaternion(toV3q(holder.rotation())).add(toV3(holder.translation()));
      const u = axisNow(b.holderBody, b.axis);
      const r = toV3(body.worldCom()).sub(p);
      // Tangent vector d(worldCom)/d(theta_branch) for turning in direction `dir * b.sign`
      const tangent = u.clone().multiplyScalar(dir * b.sign).cross(r);
      const rPerp = tangent.length();
      if (rPerp < 0.02) continue; // wheel, gear, or collar centered on its own axle
      const weight = body.mass() * GRAVITY * gravBoost;
      // Lifting against gravity (tangent.y > 0) opposes the motor; lowering with gravity (tangent.y < 0) assists it
      tau += b.factor * weight * Math.max(0, tangent.y + 0.2 * rPerp);
    }
    return tau;
  }
  /**
   * How deep what a motor moves presses into other parts (m): the deepest contact of its bodies'
   * shapes, leaving out pairs let off at the start (and any between two of its own bodies on a hinge,
   * which have no contacts).
   */
  /** Rapier handles of the parts hanging on ropes wound on spools this motor turns. */
  const ropeLoads = new Map();
  function ropeLoadsOf(motorId) {
    if (!ropeLoads.has(motorId)) {
      const turned = new Set(driven.get(motorId) || []);
      const out = new Set();
      for (const r of graph.ropes || []) {
        if (!r.spool || !turned.has(r.spool.body)) continue;
        for (const id of [...r.bodies, ...(graph.roped || [])]) if (id && !turned.has(id) && (graph.roped || []).includes(id) && rb.get(id)) out.add(rb.get(id).handle);
      }
      ropeLoads.set(motorId, out);
    }
    return ropeLoads.get(motorId);
  }
  function pressDepth(motorId, ignore = null) {
    let deepest = 0;
    for (const bodyId of driven.get(motorId)) {
      for (const c of bodyColliders.get(bodyId) || []) {
        world.contactPairsWith(c, (other) => {
          if (skip.has(pairKey(c.handle, other.handle))) return;
          // A part not joined to the robot (fallen off with gravity on) doesn't stop a motor
          if (looseColliderHandles.has(other.handle)) return;
          if (ignore && ignore.has(other.parent()?.handle)) return;
          world.contactPair(c, other, (manifold) => {
            for (let i = 0; i < manifold.numContacts(); i++) deepest = Math.max(deepest, -manifold.contactDist(i));
          });
        });
      }
    }
    return deepest;
  }
  function driveMotors(throttles, dt) {
    // Every motor's speed is read before any of them pushes: two motors on one shaft each see the
    // shaft's speed, not the speed the other has just given it
    const relNow = new Map(graph.motors.map((m) => {
      const h = hingeAxis.get(m.hinge);
      return [m.id, toV3(rb.get(h.b).angvel()).sub(toV3(rb.get(h.a).angvel())).dot(axisNow(h.a, h.axis))];
    }));
    for (const m of graph.motors) {
      const h = hingeAxis.get(m.hinge);
      const st = motorState.get(m.id);
      const A = rb.get(h.a);
      const B = rb.get(h.b);
      const axis = axisNow(h.a, h.axis);
      const point = h.point.clone().applyQuaternion(toV3q(A.rotation())).add(toV3(A.translation()));
      st.rel = relNow.get(m.id);
      const qRel = toV3q(A.rotation()).invert().multiply(toV3q(B.rotation()));
      const angle = 2 * Math.atan2(new THREE.Vector3(qRel.x, qRel.y, qRel.z).dot(h.axis.clone().normalize()), qRel.w);
      const moved = st.prevAngle !== undefined ? wrapAngle(angle - st.prevAngle) / dt : st.rel;
      st.prevAngle = angle;
      // A blocked shaft jitters: the speed shown and the stall check use it smoothed
      st.smooth += (moved - st.smooth) * Math.min(1, dt / SPEED_SMOOTHING);
      const throttle = throttles.get(m.id) || 0;
      const dir = Math.sign(throttle);
      const tauGrav = simulateGravity ? calcGravityTorque(m.id) : 0;
      const loadTorque = limitSpeedByLoad ? calcLoadTorque(m.id, dir) : simulateGravity ? Math.max(0, tauGrav * dir) : 0;
      st.loadTorque = loadTorque;
      // Above 1.4 W shaft power (loadTorque > 1.4 / 12.566 ≈ 0.1114 N·m), max speed drops as (1.4 / loadTorque) rad/s
      // (which in rpm is (1.4 / loadTorque) * 9.55), tapering to 0 at STALL_TORQUE (0.414 N·m)
      let maxSpeed = MOTOR_FREE_RAD_S;
      if (limitSpeedByLoad && loadTorque > MAX_POWER_W / MOTOR_FREE_RAD_S) {
        if (loadTorque >= STALL_TORQUE) {
          maxSpeed = 0;
        } else {
          const powerCap = MAX_POWER_W / loadTorque;
          const stallTaper = MOTOR_FREE_RAD_S * ((STALL_TORQUE - loadTorque) / (STALL_TORQUE - MAX_POWER_W / MOTOR_FREE_RAD_S));
          maxSpeed = Math.min(MOTOR_FREE_RAD_S, powerCap, stallTaper);
        }
      } else if (simulateGravity && dir !== 0) {
        const gravLoad = tauGrav * dir;
        if (gravLoad >= STALL_TORQUE) {
          maxSpeed = 0;
        } else if (gravLoad > 0) {
          maxSpeed = MOTOR_FREE_RAD_S * (1 - 0.5 * (gravLoad / STALL_TORQUE));
        } else if (gravLoad < 0) {
          maxSpeed = MOTOR_FREE_RAD_S * Math.min(1.2, 1 + 0.25 * (-gravLoad / STALL_TORQUE));
        }
      }
      const target = throttle * maxSpeed;
      // Pressing into something stops the motor, and only turning the other way (or letting go, when it
      // brakes instead) frees it
      if (st.blocked && dir !== st.blocked) {
        // Let go, it may still back out the other way without blocking at once
        st.clearingDir = dir || -st.blocked;
        st.clearFor = 0;
        st.backTurn = 0;
        st.blocked = 0;
        st.stalled = false;
        st.slowFor = 0;
        st.wobbleTime = 0;
        st.wobbleAmp = 0;
        st.depth = Math.max(st.depth, pressDepth(m.id)); // pressing deeper than it was while stopped blocks it again
      }
      let turned = inertiaAbout(B, axis, point);
      for (const t of trains.get(m.id)) turned += t.factor * t.factor * trainInertia(t);
      const inertia = 1 / (1 / inertiaAbout(A, axis, point) + 1 / turned);
      if (st.blocked) {
        if (st.wobbleAmp > 1e-4 && st.wobbleTime < WOBBLE_TIME) {
          const t = st.wobbleTime;
          st.wobbleTime += dt;
          const env = Math.exp(-WOBBLE_DECAY * t);
          const w = st.wobbleFreq;
          const wobbleSpeed = -st.blocked * st.wobbleAmp * env * (w * Math.cos(w * t) - 0.9 * WOBBLE_DECAY * Math.sin(w * t));
          const impulse = inertia * (wobbleSpeed - st.rel);
          turnAboutLine(B, axis, point, impulse);
          turnAboutLine(A, axis, point, -impulse);
        } else {
          for (const id of driven.get(m.id)) {
            rb.get(id).setAngvel({ x: 0, y: 0, z: 0 }, true);
            rb.get(id).setLinvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
        st.smooth = 0;
        st.push = 0;
        st.stalled = dir === st.blocked;
        continue;
      }
      if (!dir) {
        // Stopped: its stopping mode acts later in the step (stopMotors), after outside pushes, so it
        // feels them in the same step
        st.idle = true;
        st.push = 0;
        st.slowFor = 0;
        st.stalled = false;
        continue;
      }
      st.idle = false;
      st.relAfter = null;
      st.holdLoad = 0;
      st.holdSat = false;
      st.ropeTorque = 0;
      const off = target - st.rel;
      const offMoved = target - moved;
      const steer = (inertia * off) / MOTOR_RESPONSE;
      // The push only builds while the torque isn't already at the limit that way
      const atLimit = Math.abs(steer + st.push) >= STALL_TORQUE && Math.sign(steer + st.push) === Math.sign(offMoved);
      // It builds at least as fast as it would reach stall torque in PUSH_RISE at a whole free speed off:
      // scaled by inertia alone, a very light shaft (a ratchet with its pawl dragging) took seconds to find
      // the torque for a small steady load. Each step it grows by no more than would close the gap in that
      // step, so a light shaft starting up doesn't overshoot
      st.stuckFor = Math.abs(moved) < 0.1 * Math.abs(target) ? (st.stuckFor || 0) + dt : 0;
      const stuck = st.stuckFor >= 0.05;
      const speedScale = stuck ? Math.max(Math.abs(target), 0.05 * MOTOR_FREE_RAD_S) : MOTOR_FREE_RAD_S;
      const pushRate = Math.max(inertia / MOTOR_RESPONSE, STALL_TORQUE / speedScale) / PUSH_RISE;
      const stepCap = stuck ? Infinity : (inertia * Math.abs(offMoved)) / dt;
      const grow = Math.sign(offMoved) * Math.min(pushRate * Math.abs(offMoved) * dt, stepCap);
      if (!atLimit) st.push = THREE.MathUtils.clamp(st.push + grow, -STALL_TORQUE, STALL_TORQUE);
      // The push starts again from nothing when the throttle changes way (started, reversed). Otherwise
      // it builds either way to keep the shaft at its speed, up to stall torque, so it brakes a load
      // that runs ahead of it (idle, the hold below takes over)
      if (dir !== st.lastDir) st.push = 0;
      st.lastDir = dir;
      // When gravity is simulated and exceeds the motor's stall torque, the excess pulls the shaft back
      const gravPull =
        simulateGravity && Math.abs(tauGrav) > STALL_TORQUE
          ? -Math.sign(tauGrav) * Math.min((inertia * MOTOR_FREE_RAD_S) / MOTOR_RESPONSE, Math.abs(tauGrav) - STALL_TORQUE)
          : 0;
      const torque = THREE.MathUtils.clamp(steer + st.push, -STALL_TORQUE, STALL_TORQUE) + gravPull;
      turnAboutLine(B, axis, point, torque * dt);
      turnAboutLine(A, axis, point, -torque * dt);
      // Stalled: asked to turn but held well under that speed for a while (or loadTorque >= STALL_TORQUE)
      const asked = Math.abs(throttle) > 0.05;
      if (asked && ((limitSpeedByLoad && loadTorque >= STALL_TORQUE) || (simulateGravity && tauGrav * dir >= STALL_TORQUE))) {
        st.stalled = true;
        continue;
      }
      const share = asked && Math.abs(target) > 1e-4 ? (st.smooth * Math.sign(target)) / Math.abs(target) : 1;
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

  /** How far the gears a motor turns have pushed racks past the ends of their slides (m). */
  function slideEndPush(motorId) {
    if (!endPush.size) return 0;
    const turned = new Set(driven.get(motorId));
    let most = 0;
    for (const [i, mm] of endPush) if (turned.has(graph.links[i].a)) most = Math.max(most, mm);
    return most;
  }
  /** Stops each motor whose moving parts have run into something (see pressDepth). */
  function checkBlocked(throttles, h) {
    for (const m of graph.motors) {
      const st = motorState.get(m.id);
      const dir = Math.sign(throttles.get(m.id) || 0);
      // Stopped by a part hanging on its own rope (a weight wound up to its spool), run the other way it
      // pays the rope out and can't pull that part any deeper: its knocks don't block it, until it winds
      // that way again
      if (dir && dir === st.loadBlockDir && !st.blocked) st.loadBlockDir = 0;
      const loads = ropeLoadsOf(m.id);
      // Only a motor driving its rack past the end presses on it: idle, a load resting on the stop doesn't
      if (!dir && endPush.size) for (const i of [...endPush.keys()]) if (driven.get(m.id).includes(graph.links[i].a)) endPush.delete(i);
      // Idle and free, nothing here needs how deep its parts press: that is read when it next runs (as
      // where it starts from), which saves going through every contact of every part it moves each step
      if (!dir && !st.blocked && !st.clearingDir) {
        st.depthStale = true;
        continue;
      }
      const pressed = st.loadBlockDir && dir === -st.loadBlockDir ? pressDepth(m.id, loads) : pressDepth(m.id);
      // A gear driving its rack past the end of a slide presses as hard as it has turned on past it
      const depth = Math.max(pressed, slideEndPush(m.id));
      // Backing out ends once nothing has pressed for a while: a load pulled up against what turns it
      // (a weight wound up to its spool) bounces on and off it, and one clear step isn't out
      // (counted while it runs: held idle against what it pressed, it hasn't backed out yet)
      if (dir) st.clearFor = depth < BLOCK_DEPTH * 0.5 ? (st.clearFor || 0) + h : 0;
      if (st.clearFor >= BACK_OUT_CLEAR) st.clearingDir = 0;
      if (!dir || st.blocked) {
        st.depth = st.blocked || st.clearingDir ? Math.max(st.depth, depth) : depth;
        continue;
      }
      if (st.depthStale) {
        st.depth = depth;
        st.depthStale = false;
      }
      // While backing out, only pressing deeper than it ever was, for a while, blocks it again (starting
      // back, the turning part may knock into what it was against before that gets out of its way)
      // ...and it has backed out once the shaft has turned clearly back the other way
      if (st.clearingDir === dir) {
        st.backTurn = (st.backTurn || 0) + Math.max(0, st.rel * dir) * h;
        if (st.backTurn >= BACK_OUT_TURN) st.clearingDir = 0;
      }
      if (st.clearingDir === dir) {
        const deeper = depth > st.depth + BLOCK_DEPTH && st.rel * dir >= -0.05;
        st.deeperFor = deeper ? (st.deeperFor || 0) + h : 0;
        if (st.deeperFor >= BACK_OUT_PRESS) {
          st.clearingDir = 0;
          st.deeperFor = 0;
        } else {
          if (!deeper) st.depth = Math.max(st.depth, depth);
          continue;
        }
      }
      const growMargin = st.clearingDir === dir ? BLOCK_DEPTH : 0.00001;
      // Only when it is deep and still getting deeper, not while backing out of something
      if (depth > BLOCK_DEPTH && depth > st.depth + growMargin && st.rel * dir >= -0.05) {
        st.loadBlockDir = loads.size && pressDepth(m.id, loads) <= BLOCK_DEPTH ? dir : 0;
        st.blocked = dir;
        st.clearingDir = 0;
        st.wobbleTime = 0;
        for (const id of driven.get(m.id)) {
          rb.get(id).setAngvel({ x: 0, y: 0, z: 0 }, true);
          rb.get(id).setLinvel({ x: 0, y: 0, z: 0 }, true);
        }
        const h = hingeAxis.get(m.hinge);
        const A = rb.get(h.a);
        const axis = axisNow(h.a, h.axis);
        const point = h.point.clone().applyQuaternion(toV3q(A.rotation())).add(toV3(A.translation()));
        let loadInertia = inertiaAbout(rb.get(h.b), axis, point);
        let loadFactor = 1;
        let maxStageInertia = loadInertia;
        for (const t of trains.get(m.id)) {
          const stageI = trainInertia(t);
          loadInertia += stageI;
          if (stageI > maxStageInertia) {
            maxStageInertia = stageI;
            loadFactor = t.factor;
          }
        }
        const weightFactor = THREE.MathUtils.clamp(Math.sqrt(loadInertia / WOBBLE_REF_INERTIA), 0, 1.4);
        const speedShare = THREE.MathUtils.clamp(Math.abs(st.smooth) / (0.35 * MOTOR_FREE_RAD_S), 0, 1);
        st.wobbleAmp = (WOBBLE_MAX_RAD * weightFactor * speedShare) / Math.max(loadFactor, 0.05);
        st.wobbleFreq = WOBBLE_FREQ / Math.sqrt(0.6 + 0.4 * weightFactor);
      }
      st.depth = depth;
    }
  }

  // --- Drop test (openspec drop-load-network) ------------------------------------------------------
  // Rapier drops the robot; at its first floor contact src/sim/impact.js works out which joints let go,
  // and the parts they held split off here as their own bodies (or swing on the one pin line left).
  const HOLDS = new Set(['pin', 'peg', 'square', 'socket', 'tire', 'bay', 'collar', 'bearing']);
  const ONE_HOLDS = new Set(['square', 'socket', 'tire', 'bay', 'collar']); // one of these holds a part fast
  const jointsList = graph.joints || [];
  const brokenJoints = new Set();
  const splitBodies = new Map(); // drop body id -> RigidBody
  const partBodyOverride = new Map(); // part -> drop body id
  const tempJoints = [];
  const brokenHingeIds = new Set();
  const bodyOfPart = new Map(graph.bodies.flatMap((b) => b.parts.map((p) => [p, b.id])));
  const partsOfBody = new Map(graph.bodies.map((b) => [b.id, new Set(b.parts)]));
  const labelOf = (id) => byId.get(id)?.label || graph.partInfo?.[id]?.label || id;
  const jointLabel = (j) => {
    const pin = j.pinIds?.length ? `${labelOf(j.pinIds[0])}: ` : '';
    return `${pin}${labelOf(j.a)} ↔ ${labelOf(j.b)}`;
  };
  let splitSeq = 0;
  let impact = null; // the impact solve's result
  // Pairs of shapes let off from colliding only while they still touch where they were joined: once a gap
  // of RELEASE_GAP opens between them they collide like any other (a Brain broken loose hits the plates)
  // ... or once they press RELEASE_GAP deeper into each other than they were when let off (pushed into
  // each other, they'd never open a gap and would pass right through)
  const heldApart = new Map(); // pair key -> [handle, handle, overlap when let off (m)]
  let letOffsChanged = false; // Reset rebuilds the let-offs when a drop changed them
  const holdApart = (h1, h2) => {
    letOffsChanged = true;
    const key = pairKey(h1, h2);
    skip.add(key);
    if (heldApart.has(key)) return;
    const c1 = world.getCollider(h1);
    const c2 = world.getCollider(h2);
    const hit = c1 && c2 ? c1.contactCollider(c2, 0) : null;
    heldApart.set(key, [h1, h2, hit ? Math.max(0, -hit.distance) : 0]);
  };
  let releaseTick = 0;
  function releaseSeparated() {
    if (!heldApart.size || ++releaseTick % 5) return;
    for (const [key, [h1, h2, held]] of heldApart) {
      const c1 = world.getCollider(h1);
      const c2 = world.getCollider(h2);
      if (!c1 || !c2) {
        heldApart.delete(key);
        continue;
      }
      const gap = c1.contactCollider(c2, 2 * RELEASE_GAP);
      if (!gap || gap.distance > RELEASE_GAP || -gap.distance > held + RELEASE_GAP) {
        skip.delete(key);
        heldApart.delete(key);
      }
    }
  }
  const sampledPoints = new Map(); // part -> local points (m), a few dozen for finding the lowest
  const lowPoints = (id) => {
    if (!sampledPoints.has(id)) {
      const pts = noShape.has(id) ? null : shapes.points(id);
      sampledPoints.set(id, pts?.length >= 3 ? samplePoints(pts, 60) : null);
    }
    return sampledPoints.get(id);
  };

  function ensureMinMass(body, partIds, shapedCount) {
    body.recomputeMassPropertiesFromColliders();
    if (body.mass() < MIN_MASS) {
      const at = partIds.map((id) => byId.get(id)).filter(Boolean);
      const centre = shapedCount
        ? toV3(body.worldCom())
        : at.reduce((sum, i) => sum.add(new THREE.Vector3(...i.position)), new THREE.Vector3()).multiplyScalar(MM / Math.max(1, at.length));
      const extra = MIN_MASS - body.mass();
      const spread = extra * MIN_RADIUS * MIN_RADIUS;
      body.setAdditionalMassProperties(extra, vec(centre), { x: spread, y: spread, z: spread }, { x: 0, y: 0, z: 0, w: 1 }, true);
    }
  }

  /** Puts the robot back together where it was built: broken joints mended, split pieces rejoined. */
  function resetDrop() {
    dropState.active = false;
    dropState.impacted = false;
    dropState.peakFallSpeed = 0;
    impact = null;
    robotMotion = null;
    heldApart.clear();
    brokenJoints.clear();
    for (const j of tempJoints) world.removeImpulseJoint(j, true);
    tempJoints.length = 0;
    if (splitBodies.size > 0 || partBodyOverride.size > 0) {
      const affected = new Set([...partBodyOverride.keys()].map((p) => bodyOfPart.get(p)).filter(Boolean));
      for (const sb of splitBodies.values()) world.removeRigidBody(sb);
      splitBodies.clear();
      partBodyOverride.clear();
      for (const bId of affected) {
        const b = graph.bodies.find((x) => x.id === bId);
        const body = rb.get(bId);
        for (const c of bodyColliders.get(bId) || []) {
          partOfCollider.delete(c.handle);
          world.removeCollider(c, false);
        }
        bodyColliders.set(bId, []);
        const isFixed = fixed.has(b.id) && !sliders.has(b.id) && !looseSet.has(b.id) && !ropedSet.has(b.id);
        let shaped = 0;
        for (const id of [...b.parts, ...(carried.get(b.id) || [])]) {
          const cd = colliderFor(id, isFixed);
          if (!cd) continue;
          cd.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
          const col = world.createCollider(cd, body);
          partOfCollider.set(col.handle, id);
          bodyColliders.get(bId).push(col);
          shaped += 1;
        }
        if (!isFixed) ensureMinMass(body, b.parts, shaped);
      }
    }
    // The let-offs again, for the shapes made anew and any let go during the drop
    if (letOffsChanged) {
      letOffsChanged = false;
      skip.clear();
      floorSkip.clear();
      for (const a of partOfCollider.keys()) {
        for (const b of partOfCollider.keys()) {
          if (a < b && touchingParts.has(pairKey(partOfCollider.get(a), partOfCollider.get(b)))) skip.add(pairKey(a, b));
        }
      }
      if (floorHandle >= 0) {
        for (const [bId, cols] of bodyColliders) {
          if (looseSet.has(bId) || (bodyMinY.get(bId) ?? Infinity) > robotMinY + 0.004) continue;
          for (const c of cols) {
            const pk = pairKey(c.handle, floorHandle);
            floorSkip.add(pk);
            skip.add(pk);
          }
        }
      }
    }
    for (const hId of brokenHingeIds) {
      const h = graph.hinges.find((x) => x.id === hId);
      const p = { x: h.point[0] * MM, y: h.point[1] * MM, z: h.point[2] * MM };
      hingeJoints.set(h.id, world.createImpulseJoint(RAPIER.JointData.revolute(p, p, vec(new THREE.Vector3(...h.axis).normalize())), rb.get(h.a), rb.get(h.b), true));
    }
    brokenHingeIds.clear();
    for (const b of graph.bodies) {
      const body = rb.get(b.id);
      const isFixed = fixed.has(b.id) && !sliders.has(b.id) && !looseSet.has(b.id) && !ropedSet.has(b.id);
      for (const c of bodyColliders.get(b.id) || []) {
        c.setRestitution(0);
        c.setFriction(0);
      }
      body.setTranslation({ x: 0, y: 0, z: 0 }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.setGravityScale(0, true);
      body.enableCcd(false);
      body.setBodyType(isFixed ? RAPIER.RigidBodyType.Fixed : RAPIER.RigidBodyType.Dynamic, true);
    }
    world.timestep = STEP;
    applyGravityMode();
  }

  /** The speed and spin (world, m/s and rad/s) the impact left a group of parts with, by their mass. */
  function pieceMotion(parts, robot = null) {
    let m = 0;
    const v = new THREE.Vector3();
    const w = new THREE.Vector3();
    for (const id of parts) {
      const pv = impact?.partVelocity?.[id];
      if (!pv) continue;
      const mi = massOfPart(id);
      m += mi;
      v.addScaledVector(new THREE.Vector3(...pv.v), mi);
      w.addScaledVector(new THREE.Vector3(...pv.w), mi);
    }
    if (!(m > 0)) return null;
    v.multiplyScalar(1 / m);
    w.multiplyScalar(1 / m);
    // Light parts are still ringing when the impact ends: a piece leaves the robot no faster than half
    // the landing speed and spins no faster than MAX_SPIN
    if (robot) {
      const rel = v.clone().sub(robot.v);
      const most = SPLIT_SPEED_SHARE * Math.sqrt(2 * GRAVITY * dropState.heightM);
      if (rel.length() > most) v.copy(robot.v).addScaledVector(rel.normalize(), most);
    }
    if (w.length() > MAX_SPIN) w.setLength(MAX_SPIN);
    return { v, w };
  }
  let robotMotion = null; // the whole robot's speed after the impact, by mass

  /**
   * After the impact: inside each body, the parts still held together (two or more pin or shaft lines, or one
   * square fit, socket, tire, bay or collar) stay with its heaviest piece; any other piece becomes its own
   * body, swinging on the one pin line left if there is one. A hinge whose joints all broke lets go too.
   */
  function splitAfterImpact() {
    const live = (j) => HOLDS.has(j.kind) && !brokenJoints.has(j.id);
    for (const b of graph.bodies) {
      const inB = partsOfBody.get(b.id);
      const structParts = b.parts.filter((id) => !pinSet.has(id) && !stillSet.has(id));
      if (structParts.length < 2) continue;
      const parent = new Map(b.parts.map((id) => [id, id]));
      const find = (x) => {
        while (parent.get(x) !== x) x = parent.get(x);
        return x;
      };
      const union = (x, y) => {
        const [rx, ry] = [find(x), find(y)];
        if (rx === ry) return false;
        parent.set(ry, rx);
        return true;
      };
      const inside = jointsList.filter((j) => inB.has(j.a) && inB.has(j.b) && live(j));
      for (const j of inside) if (ONE_HOLDS.has(j.kind)) union(j.a, j.b);
      // A shaft through a round hole is a line as much as a pin is (the part can't leave it sideways)
      const pinLines = inside.filter((j) => j.kind === 'pin' || j.kind === 'peg' || j.kind === 'bearing');
      for (let changed = true; changed; ) {
        changed = false;
        const lines = new Map();
        for (const j of pinLines) {
          const [ra, rb2] = [find(j.a), find(j.b)];
          if (ra === rb2) continue;
          const key = ra < rb2 ? `${ra}|${rb2}` : `${rb2}|${ra}`;
          if (!lines.has(key)) lines.set(key, []);
          const list = lines.get(key);
          if (!list.some((l) => sameLine(l, j))) list.push(j);
        }
        for (const [key, list] of lines) if (list.length >= 2 && union(...key.split('|'))) changed = true;
      }
      // Each pin goes with a part it still holds, or one it held
      for (const pid of b.parts) {
        if (!pinSet.has(pid)) continue;
        const held = inside.find((j) => j.pinIds?.includes(pid)) || jointsList.find((j) => j.pinIds?.includes(pid));
        const partner = held?.a && parent.has(held.a) ? held.a : structParts[0];
        union(partner, pid);
      }
      const comps = new Map();
      for (const id of b.parts) {
        const r = find(id);
        if (!comps.has(r)) comps.set(r, []);
        comps.get(r).push(id);
      }
      if (comps.size <= 1) continue;
      const weight = (c) => c.reduce((s, id) => s + massOfPart(id), 0);
      const pieces = [...comps.values()].sort((x, y) => weight(y) - weight(x) || y.length - x.length);
      const core = new Set(pieces[0]);
      const parentRb = rb.get(b.id);
      for (const piece of pieces.slice(1)) {
        const set = new Set(piece);
        const id = `drop_${++splitSeq}`;
        const t = parentRb.translation();
        const newRb = world.createRigidBody(
          RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, t.y, t.z).setRotation(parentRb.rotation()).setGravityScale(1).setLinearDamping(0.15).setAngularDamping(0.15).setCcdEnabled(true)
        );
        splitBodies.set(id, newRb);
        const kept = [];
        for (const col of bodyColliders.get(b.id) || []) {
          if (set.has(partOfCollider.get(col.handle))) {
            partOfCollider.delete(col.handle);
            world.removeCollider(col, false);
          } else kept.push(col);
        }
        bodyColliders.set(b.id, kept);
        const made = [];
        for (const pid of piece) {
          partBodyOverride.set(pid, id);
          const cd = colliderFor(pid, false);
          if (!cd) continue;
          cd.setRestitution(0.28).setFriction(0.45).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
          const col = world.createCollider(cd, newRb);
          partOfCollider.set(col.handle, pid);
          made.push(col);
        }
        // Let the piece leave its parent (and the parts it touched when built) without springing apart
        // from their overlap, but only until a gap opens between them: then they collide again
        const madeSet = new Set(made.map((c) => c.handle));
        const keptSet = new Set(kept.map((c) => c.handle));
        for (const a of made) {
          const pa = partOfCollider.get(a.handle);
          for (const [h, part] of partOfCollider) {
            if (madeSet.has(h)) continue;
            if (keptSet.has(h) || touchingParts.has(pairKey(pa, part))) holdApart(a.handle, h);
          }
        }
        ensureMinMass(newRb, piece, made.length);
        ensureMinMass(parentRb, pieces[0], kept.length);
        const motion = pieceMotion(piece, robotMotion);
        const lv = parentRb.linvel();
        newRb.setLinvel(motion ? vec(motion.v) : lv, true);
        newRb.setAngvel(motion ? vec(motion.w) : parentRb.angvel(), true);
        const swing = inside.find((j) => (j.kind === 'pin' || j.kind === 'peg' || j.kind === 'bearing') && !brokenJoints.has(j.id) && ((set.has(j.a) && core.has(j.b)) || (set.has(j.b) && core.has(j.a))));
        if (swing) {
          const p = { x: swing.point[0] * MM, y: swing.point[1] * MM, z: swing.point[2] * MM };
          tempJoints.push(world.createImpulseJoint(RAPIER.JointData.revolute(p, p, vec(new THREE.Vector3(...swing.axis).normalize())), parentRb, newRb, true));
          for (const pid of piece) if (!pinSet.has(pid) && !dropState.swinging.includes(pid)) dropState.swinging.push(pid);
        } else {
          for (const pid of piece) if (!pinSet.has(pid) && !dropState.detached.includes(pid)) dropState.detached.push(pid);
        }
      }
    }
    // Hinges whose every joint broke let their smaller side go
    for (const h of graph.hinges) {
      if (brokenHingeIds.has(h.id)) continue;
      const [pa, pb] = [partsOfBody.get(h.a), partsOfBody.get(h.b)];
      const across = jointsList.filter((j) => HOLDS.has(j.kind) && ((pa.has(j.a) && pb.has(j.b)) || (pa.has(j.b) && pb.has(j.a))));
      if (!across.length || across.some((j) => !brokenJoints.has(j.id))) continue;
      brokenHingeIds.add(h.id);
      const joint = hingeJoints.get(h.id);
      if (joint) world.removeImpulseJoint(joint, true);
      const freeId = fixed.has(h.a) ? h.b : fixed.has(h.b) ? h.a : pa.size <= pb.size ? h.a : h.b;
      const freeParts = [...partsOfBody.get(freeId)];
      // Its parts collide again with the parts they were let off from, once a gap opens
      for (const c of bodyColliders.get(freeId) || []) {
        for (const [hh, part] of partOfCollider) {
          if (hh !== c.handle && skip.has(pairKey(c.handle, hh)) && !partsOfBody.get(freeId)?.has(part)) holdApart(c.handle, hh);
        }
      }
      for (const pid of freeParts) if (!pinSet.has(pid) && !partBodyOverride.has(pid) && !dropState.detached.includes(pid)) dropState.detached.push(pid);
      const body = rb.get(freeId);
      const motion = pieceMotion(freeParts, robotMotion);
      if (body?.isDynamic() && motion) {
        body.setLinvel(vec(motion.v), true);
        body.setAngvel(vec(motion.w), true);
      }
    }
  }

  /** The impact at first floor contact: which joints let go, then the pieces they held split off. */
  function evaluateImpact() {
    const deltaOf = (partId) => {
      const body = rb.get(bodyOfPart.get(partId));
      if (!body) return new THREE.Matrix4();
      const t = body.translation();
      return new THREE.Matrix4().compose(new THREE.Vector3(t.x / MM, t.y / MM, t.z / MM), toV3q(body.rotation()), new THREE.Vector3(1, 1, 1));
    };
    const model = buildImpactModel({ graph, instances, deltaOf, pointsOf: (id) => (noShape.has(id) ? null : shapes.points(id)) });
    impact = solveImpact(model, { speed: Math.sqrt(2 * GRAVITY * dropState.heightM) });
    for (const b of impact.broken) brokenJoints.add(b.jointId);
    robotMotion = pieceMotion(graph.bodies.flatMap((b) => b.parts));
    // The robot leaves the floor as the impact left it: its bounce, the way it rocks, an arm swinging on
    for (const b of graph.bodies) {
      const body = rb.get(b.id);
      if (!body?.isDynamic()) continue;
      const motion = pieceMotion(b.parts, robotMotion);
      if (!motion) continue;
      body.setLinvel(vec(motion.v), true);
      body.setAngvel(vec(motion.w), true);
    }
    if (impact.broken.length) splitAfterImpact();
  }

  function stepDrop(dt) {
    releaseSeparated();
    if (!dropState.active || dropState.impacted || floorHandle < 0 || !floorCol) return;
    const vy = rb.get(mainFixedId)?.linvel().y ?? 0;
    if (vy < 0) dropState.peakFallSpeed = Math.max(dropState.peakFallSpeed, -vy);
    if (dropState.peakFallSpeed < 0.25) return;
    let hit = false;
    world.contactPairsWith(floorCol, (other) => {
      world.contactPair(floorCol, other, (manifold) => {
        for (let i = 0; i < manifold.numContacts(); i++) if (manifold.contactDist(i) <= 0.002) hit = true;
      });
    });
    if (!hit) return;
    dropState.impacted = true;
    evaluateImpact();
  }

  /** Turns the whole robot about its centre of mass so `landing` faces down, its lowest point `height` (m) above the floor. */
  function poseForDrop(height, landing) {
    const q = landingQuaternion(landing);
    let mass = 0;
    const com = new THREE.Vector3();
    for (const [bId, body] of rb) {
      for (const c of bodyColliders.get(bId) || []) {
        const m = c.mass();
        const t = c.translation();
        com.addScaledVector(new THREE.Vector3(t.x, t.y, t.z), m);
        mass += m;
      }
    }
    if (mass > 0) com.multiplyScalar(1 / mass);
    const poses = new Map();
    for (const [bId, body] of rb) {
      const t = toV3(body.translation());
      poses.set(bId, { t: t.sub(com).applyQuaternion(q).add(com), q: q.clone().multiply(toV3q(body.rotation())) });
    }
    // Lift it so its lowest point is `height` above the floor
    let lowest = Infinity;
    const p = new THREE.Vector3();
    for (const b of graph.bodies) {
      const pose = poses.get(b.id);
      for (const id of b.parts) {
        const pts = lowPoints(id);
        const inst = byId.get(id);
        if (!pts || !inst) continue;
        const start = startPose(inst);
        for (let i = 0; i < pts.length; i += 3) {
          p.set(pts[i], pts[i + 1], pts[i + 2]).applyQuaternion(start.quaternion).add(start.position).applyQuaternion(pose.q).add(pose.t);
          if (p.y < lowest) lowest = p.y;
        }
      }
    }
    const lift = Number.isFinite(lowest) && Number.isFinite(robotMinY) ? robotMinY + height - lowest : height;
    for (const pose of poses.values()) pose.t.y += lift;
    return poses;
  }

  // Bands (openspec rubber-bands): each pulls the bodies holding its spots along its path, harder the
  // more it stretches (an assumed stiffness), with viscoelastic damping proportional to stretch rate.
  // A band whose spots are all on one body pulls on nothing.
  const pullingBands = (graph.bands || []).filter((b) => b.pulls);
  function pullBands(h) {
    for (const b of pullingBands) {
      const els = b.elements.map((e, i) => {
        const body = rb.get(b.bodies[i]);
        const q = body ? toV3q(body.rotation()) : new THREE.Quaternion();
        const t = body ? toV3(body.translation()).multiplyScalar(1 / MM) : new THREE.Vector3();
        const out = { ...e, center: new THREE.Vector3(...e.center).applyQuaternion(q).add(t), axis: new THREE.Vector3(...e.axis).applyQuaternion(q) };
        if (e.radial) out.radial = new THREE.Vector3(...e.radial).applyQuaternion(q);
        if (e.wrapDir) out.wrapDir = new THREE.Vector3(...e.wrapDir).applyQuaternion(q);
        return out;
      });
      const path = solveBandPath(els, { thickMm: b.thickMm, widthMm: b.widthMm, maxRounds: 40, tolMm: 0.02 });
      if (!path) continue;
      const c = path.contacts.map((x) => ({ a: new THREE.Vector3(...x.a), b: new THREE.Vector3(...x.b) }));
      const n = c.length;
      const pullsOn = [];
      let rateMPerS = 0;
      for (let i = 0; i < n; i++) {
        const body = rb.get(b.bodies[i]);
        if (!body?.isDynamic()) continue;
        const toPrev = c[(i - 1 + n) % n].b.clone().sub(c[i].a);
        const toNext = c[(i + 1) % n].a.clone().sub(c[i].b);
        const f = new THREE.Vector3();
        if (toPrev.lengthSq() > 1e-9) f.add(toPrev.normalize());
        if (toNext.lengthSq() > 1e-9) f.add(toNext.normalize());
        if (f.lengthSq() < 1e-12) continue;
        const at = c[i].a.clone().add(c[i].b).multiplyScalar(0.5 * MM);
        const vAt = toV3(body.linvel()).add(toV3(body.angvel()).cross(at.clone().sub(toV3(body.worldCom()))));
        rateMPerS -= vAt.dot(f);
        pullsOn.push({ body, f, at });
      }
      const T = bandPullN(b.partNumber, b.freeMm, path.lengthMm, rateMPerS / MM);
      if (T <= 0) continue;
      for (const { body, f, at } of pullsOn) {
        body.applyImpulseAtPoint(vec(f.multiplyScalar(T * h)), { x: at.x, y: at.y, z: at.z }, true);
      }
    }
  }

  // Ropes (openspec rope-and-spool, design decisions 8 and 9): weightless, frictionless and unable to
  // stretch, so a tight rope has one pull T along its whole length; T is carried from step to step and
  // corrected by what the bodies' masses say stops the path growing. Every body holding an end or a
  // spot feels T along both runs leaving it, at the points they leave it. A spool winds the rope as
  // it turns, and the pull turns it back.
  const pullingRopes = (graph.ropes || []).filter((r) => r.pulls);
  const clusterRopesDone = new Set();
  const clusterRopesLive = [];
  const ropeState = new Map(
    (graph.ropes || []).map((r) => [r.id, { T: 0, bias: 0, expectC: null, anchor: null, push: null, turns: r.spool?.turns ?? 0, winding: r.spool?.winding ?? 1, phi: null, slackMm: 0, pathMm: 0, overFull: false, turnsArr: [...r.turns] }])
  );
  const poseOfBody = (id) => {
    const body = id ? rb.get(id) : null;
    if (!body) return null;
    return { q: toV3q(body.rotation()), t: toV3(body.translation()).multiplyScalar(1 / MM) };
  };
  /** The world velocity (m/s) of a body at a point (m); zero for a fixed body. */
  // The step the rope's pull is found for: gravity acts within it, so a body's velocity is taken with
  // the step's gravity already added (else gravity stretches the rope a little every step and the
  // correction kicks the body back up)
  let ropeStepH = STEP;
  const ropeVelocityAt = (body, p) => {
    if (!body || body.isFixed()) return new THREE.Vector3();
    const com = toV3(body.worldCom());
    const v = toV3(body.linvel()).add(toV3(body.angvel()).cross(p.clone().sub(com)));
    if (body.gravityScale() > 0 && world.gravity) v.y += world.gravity.y * body.gravityScale() * ropeStepH;
    return v;
  };
  /** I⁻¹ τ in the world for a dynamic body. */
  const invInertia = (body, tau) => {
    const frame = toV3q(body.rotation()).multiply(toV3q(body.principalInertiaLocalFrame()));
    const local = tau.clone().applyQuaternion(frame.clone().invert());
    const i = body.principalInertia();
    local.set(i.x > 1e-12 ? local.x / i.x : 0, i.y > 1e-12 ? local.y / i.y : 0, i.z > 1e-12 ? local.z / i.z : 0);
    return local.applyQuaternion(frame);
  };
  /** One rope's situation now: its path, how far over its length it is (m), and per body what a 1 N pull does. */
  /** A point carried by the spool's body, in world mm, and back to the body's start frame. */
  const spoolToWorld = (r, p) => {
    const pose = poseOfBody(r.spool.body);
    const out = new THREE.Vector3(...p);
    return pose ? out.applyQuaternion(pose.q).add(pose.t) : out;
  };
  const spoolToStart = (r, p) => {
    const pose = poseOfBody(r.spool.body);
    const out = new THREE.Vector3(...p);
    return (pose ? out.sub(pose.t).applyQuaternion(pose.q.clone().invert()) : out).toArray();
  };
  /** The rope's path now, with its drum wound `winding` way, or from its tie point while unwound. */
  function ropePathNow(r, st) {
    if (r.spool) st.turnsArr[r.spool.element] = r.spool.element === 0 ? -st.winding : st.winding;
    const els = ropeElementsNow(r, poseOfBody, st.turns, st.anchor ? spoolToWorld(r, st.anchor).toArray() : null);
    return { els, path: solveRopeNow({ ...r, turns: st.turnsArr }, els) };
  }
  /**
   * Bodies a motor turns through gears that swing into mesh, while engaged (Swish's winch), and what
   * those turn by gear links: for the ropes, these move as the motor and gears drive or hold them.
   * The motor's own shaft and its fixed gear train aren't here: the motor's push already carries a
   * rope on them as a free body.
   */
  function gearedToMotors() {
    const reach = new Set();
    for (const m of graph.motors) for (const id of directDriven.get(m.id) || []) reach.add(id);
    const out = new Set();
    const engaged = meshState.filter((st) => st.engaged).map((st) => [st.m.a, st.m.b]);
    const add = (id) => {
      if (reach.has(id) || !rb.get(id)?.isDynamic()) return false;
      out.add(id);
      reach.add(id);
      return true;
    };
    for (let grew = true; grew; ) {
      grew = false;
      // Across a swinging mesh from anything the motor turns; then on by gear links from those
      for (const [a, b] of engaged) grew = (reach.has(a) && add(b)) || (reach.has(b) && add(a)) || grew;
      for (const l of graph.links) grew = (out.has(l.a) && add(l.b)) || (out.has(l.b) && add(l.a)) || grew;
    }
    return out;
  }
  function ropeNow(r, st, { skipBodies = null } = {}) {
    let { els, path } = ropePathNow(r, st);
    if (!path) return null;
    // Winding (decision 9): the leaving point's angle in the spool's own frame
    if (r.spool) {
      const k = r.spool.element;
      const c = path.contacts[k];
      if (st.anchor) {
        // Unwound: the rope runs straight from where it's tied on the drum, which turns with the spool.
        // Once that point has turned far enough that the rope would cut into the drum, it wraps on
        // again, the way the drum now meets it (starting where it touches, so nothing jumps)
        const d = r.elements[k];
        const axis = new THREE.Vector3(...d.axis).applyQuaternion(poseOfBody(r.spool.body)?.q || new THREE.Quaternion()).normalize();
        const centre = spoolToWorld(r, d.center);
        const tie = spoolToWorld(r, st.anchor);
        const next = new THREE.Vector3(...(k === 0 ? path.contacts[1].a : path.contacts[path.contacts.length - 2].b));
        const flat = (v) => v.clone().sub(axis.clone().multiplyScalar(v.dot(axis)));
        const out = flat(tie.clone().sub(centre)).normalize();
        const run = flat(next.clone().sub(tie)).normalize();
        if (out.dot(run) < -0.02) {
          // The way that puts the leaving point nearest the tie point
          let best = null;
          for (const w of [1, -1]) {
            const trial = { ...st, anchor: null, turns: 0, winding: w, turnsArr: [...st.turnsArr] };
            const got = ropePathNow(r, trial);
            if (!got.path) continue;
            const cc = got.path.contacts[k];
            const gap = new THREE.Vector3(...(k === 0 ? cc.b : cc.a)).distanceTo(tie);
            if (!best || gap < best.gap) best = { w, gap, got };
          }
          if (best) {
            st.anchor = null;
            st.turns = 0;
            st.winding = best.w;
            ({ els, path } = best.got);
            st.phi = leaveAngle(r, els, k === 0 ? path.contacts[k].b : path.contacts[k].a, poseOfBody(r.spool.body));
          }
        }
      } else {
        const phi = leaveAngle(r, els, k === 0 ? c.b : c.a, poseOfBody(r.spool.body));
        if (st.phi !== null) {
          let dphi = phi - st.phi;
          dphi = ((dphi + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          st.turns += (-st.winding * dphi) / (2 * Math.PI);
          st.overFull = st.turns > turnsThatFit(r.spool.spec, r.cordMm);
        }
        st.phi = phi;
        if (st.turns <= 0) {
          // Paid right out (or never wound): tied on where it leaves the drum now
          st.turns = 0;
          st.anchor = spoolToStart(r, k === 0 ? c.b : c.a);
          st.phi = null;
        }
      }
    }
    const pathMm = ropePathMm(r, path);
    const C = (pathMm - ropeGiven(r, st.turns)) * MM;
    st.pathMm = pathMm;
    st.slackMm = Math.max(0, -C / MM);
    const pts = path.contacts.map((x) => ({ a: new THREE.Vector3(...x.a).multiplyScalar(MM), b: new THREE.Vector3(...x.b).multiplyScalar(MM) }));
    const n = pts.length;
    const runs = [];
    for (let i = 0; i < n - 1; i++) {
      const d = pts[i + 1].a.clone().sub(pts[i].b);
      runs.push(d.lengthSq() > 1e-14 ? d.normalize() : new THREE.Vector3());
    }
    // Per body: the forces of a 1 N pull and where they act (a body a stalled motor holds counts as
    // fixed: the motor carries the pull, up to its stall torque, which the stall already means)
    const held = heldByMotors();
    // A spool a motor turns through gears swung into mesh moves as the motor and gears let it, not as
    // a free light part: the pull is found as if it won't give (else each pass speeds the light spool
    // up, the pull is taken back, and the rope winds on unseen until it snaps tight), then put on it
    // once the pull is known, so the motor feels the load and slows or stalls under it
    const geared = gearedToMotors();
    const per = new Map();
    const onHeld = [];
    const onGeared = [];
    for (let i = 0; i < n; i++) {
      const id = r.bodies[i];
      const body = id ? rb.get(id) : null;
      if (body && held.has(id)) {
        if (i > 0) onHeld.push([id, runs[i - 1].clone().negate(), pts[i].a]);
        if (i < n - 1) onHeld.push([id, runs[i].clone(), pts[i].b]);
      }
      if (!body || !body.isDynamic() || held.has(id)) continue;
      if (skipBodies?.has(id)) continue;
      if (geared.has(id)) {
        if (i > 0) onGeared.push([body, runs[i - 1].clone().negate(), pts[i].a]);
        if (i < n - 1) onGeared.push([body, runs[i].clone(), pts[i].b]);
        continue;
      }
      const e = per.get(id) || { body, forces: [], f: new THREE.Vector3(), tau: new THREE.Vector3(), riders: new Set() };
      // A pulley spinning on this body's pin moves with it: it takes its share of the pull
      const rider = r.riders?.[i] ? rb.get(r.riders[i]) : null;
      if (rider?.isDynamic()) e.riders.add(rider);
      if (i > 0) e.forces.push([runs[i - 1].clone().negate(), pts[i].a]);
      if (i < n - 1) e.forces.push([runs[i].clone(), pts[i].b]);
      per.set(id, e);
    }
    let w = 0;
    for (const e of per.values()) {
      const com = toV3(e.body.worldCom());
      for (const [f, at] of e.forces) {
        e.f.add(f);
        e.tau.add(at.clone().sub(com).cross(f));
      }
      const m = e.body.mass();
      const M = m + [...e.riders].reduce((sum, b) => sum + b.mass(), 0);
      e.share = M > 0 ? m / M : 1;
      e.M = Math.max(M, 1e-9);
      w += e.f.lengthSq() / Math.max(M, 1e-9) + e.share * e.share * e.tau.dot(invInertia(e.body, e.tau));
    }
    const bodyFor = (id) => (id && !held.has(id) ? rb.get(id) : null);
    const stretchRate = () => {
      let rate = 0;
      for (let i = 0; i < n - 1; i++) {
        const vb = ropeVelocityAt(bodyFor(r.bodies[i]), pts[i].b);
        const va = ropeVelocityAt(bodyFor(r.bodies[i + 1]), pts[i + 1].a);
        rate += runs[i].dot(va.sub(vb));
      }
      return rate;
    };
    return { path, C, per, w, stretchRate, onHeld, onGeared, pts, runs };
  }
  /** The motor's hinge now: its two bodies, axis, a point on it, the shaft's speed against the motor's
   * body, and the inertia a turn about it moves (gear trains included). */
  function hingeNow(m) {
    const h = hingeAxis.get(m.hinge);
    const A = rb.get(h.a);
    const B = rb.get(h.b);
    const axis = axisNow(h.a, h.axis);
    const point = h.point.clone().applyQuaternion(toV3q(A.rotation())).add(toV3(A.translation()));
    const rel = toV3(B.angvel()).sub(toV3(A.angvel())).dot(axis);
    let turned = inertiaAbout(B, axis, point);
    for (const t of trains.get(m.id)) turned += t.factor * t.factor * trainInertia(t);
    const inertia = 1 / (1 / inertiaAbout(A, axis, point) + 1 / turned);
    // How far the shaft is turned against the motor's body, about the axis (rad, −π to π)
    const q = toV3q(A.rotation()).invert().multiply(toV3q(B.rotation()));
    const angle = 2 * Math.atan2(new THREE.Vector3(q.x, q.y, q.z).dot(h.axis.clone().normalize()), q.w);
    return { A, B, axis, point, rel, inertia, angle };
  }
  const wrapAngle = (a) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  /**
   * Stopped motors, by stopping mode (openspec motor-stopping), just before the gear links and the step.
   * Each sets the speed the shaft should have at the end of the step, given the turning it felt over
   * the last step (`holdLoad`: a hanging load, a belt, gravity), up to stall torque:
   * - Brake, a shorted motor: resisted in proportion to speed (c·ω, stall torque at top speed, nothing
   *   when still), so a steady load τ turns it at τ / c; Coast only turns the motor's own gears, a
   *   tenth of that. Solved for the end of the step, since a light shaft pushed by c·ω would overshoot.
   * - Hold: still, and turned back toward where it stopped over HOLD_RETURN; a load past stall turns it.
   */
  function stopMotors(dt) {
    for (const m of graph.motors) {
      const st = motorState.get(m.id);
      if (!st.idle || st.blocked) {
        st.relAfter = null;
        continue;
      }
      const { A, B, axis, point, rel, inertia, angle } = hingeNow(m);
      if (st.relAfter === null || st.holdRef === null) {
        st.holdRef = angle;
        if (st.relAfter === null) st.holdLoad = 0;
      }
      st.holdAngle = wrapAngle(angle - st.holdRef);
      st.inertiaNow = inertia;
      const fromLoad = (st.holdLoad * dt) / inertia;
      let atEnd = 0;
      st.holdSat = true; // only Hold keeps its shaft still for the ropes
      if (st.mode === 'hold') {
        atEnd = -st.holdAngle / HOLD_RETURN;
        // A rope pulling on the held shaft counts against the stall torque too: past it, the shaft is let
        // go next step and the rope turns it against the hold
        const want = (inertia * (atEnd - fromLoad - rel)) / dt;
        st.holdSat = Math.abs(want - (st.ropeTorque || 0)) >= STALL_TORQUE;
      } else {
        const c = ((st.mode === 'brake' ? 1 : COAST_DRAG) * STALL_TORQUE) / MOTOR_FREE_RAD_S;
        atEnd = (rel + fromLoad) / (1 + (c * dt) / inertia);
      }
      const torque = THREE.MathUtils.clamp((inertia * (atEnd - fromLoad - rel)) / dt, -STALL_TORQUE, STALL_TORQUE);
      turnAboutLine(B, axis, point, torque * dt);
      turnAboutLine(A, axis, point, -torque * dt);
      st.relAfter = rel + (torque * dt) / inertia;
    }
  }
  /** After the step: what turned each stopped shaft during it, and how far it has turned since it stopped. */
  function feltOverStep(dt) {
    for (const m of graph.motors) {
      const st = motorState.get(m.id);
      if (!st.idle || st.relAfter === null) continue;
      const { rel } = hingeNow(m);
      st.holdLoad += 0.5 * ((st.inertiaNow * (rel - st.relAfter)) / dt - st.holdLoad);
    }
  }
  /** Bodies turned by a motor that is stopped against something and still asked to push that way. */
  let lastThrottles = new Map();
  function heldByMotors() {
    const out = new Set();
    for (const m of graph.motors) {
      const st = motorState.get(m.id);
      const dir = Math.sign(lastThrottles.get(m.id) || 0);
      if (st?.blocked && dir === st.blocked) for (const id of driven.get(m.id) || []) out.add(id);
      // Idle with torque to spare, a motor holds its own shaft still: a rope on a spool there pulls
      // on the motor (its budget below), not on the shaft
      else if (!dir && st && st.relAfter !== null && !st.holdSat) out.add(hingeAxis.get(m.hinge).b);
    }
    return out;
  }
  /** Per idle motor: the turning the ropes put on its held shaft this step (N·m, about its axis). */
  function ropeTorqueOnMotors(live) {
    for (const m of graph.motors) {
      const st = motorState.get(m.id);
      st.ropeTorque = 0;
      const h = hingeAxis.get(m.hinge);
      const A = rb.get(h.a);
      const axis = axisNow(h.a, h.axis);
      const point = h.point.clone().applyQuaternion(toV3q(A.rotation())).add(toV3(A.translation()));
      for (const [, rst, now] of live) {
        for (const [id, f, at] of now.onHeld || []) if (id === h.b) st.ropeTorque += rst.T * at.clone().sub(point).cross(f).dot(axis);
      }
    }
  }
  /**
   * How hard the bodies on a rope are pushed by what they touch, deeper than a hair (the sum of the
   * contacts' push this step, N·s), or null when nothing touches them. A contact that pushes harder as
   * the rope pulls harder is one the rope drives a body into; one whose push eases as the pull grows
   * is one the rope draws the body away from (an arm pulled off the stop its bands press it onto).
   */
  const ropeContactPush = (now) => {
    let sum = 0;
    let any = false;
    for (const id of now.per.keys()) {
      for (const c of bodyColliders.get(id) || []) {
        world.contactPairsWith(c, (other) => {
          if (skip.has(pairKey(c.handle, other.handle))) return;
          world.contactPair(c, other, (manifold) => {
            for (let i = 0; i < manifold.numContacts(); i++) {
              if (manifold.contactDist(i) >= -0.00005) continue;
              any = true;
              sum += manifold.contactImpulse(i);
            }
          });
        });
      }
    }
    return any ? sum : null;
  };
  const pullImpulse = (now, J) => {
    if (Math.abs(J) < 1e-12) return;
    for (const e of now.per.values()) {
      for (const [f, at] of e.forces) {
        const imp = f.clone().multiplyScalar(J);
        e.body.applyImpulseAtPoint(vec(imp.clone().multiplyScalar(e.share ?? 1)), vec(at), true);
        for (const b of e.riders) b.applyImpulse(vec(imp.clone().multiplyScalar(b.mass() / e.M)), true);
      }
    }
  };
  function pullRopes(h) {
    ropeStepH = h;
    const live = [];
    for (const r of pullingRopes) {
      if (clusterRopesDone.has(r.id)) continue;
      const st = ropeState.get(r.id);
      const now = ropeNow(r, st);
      if (!now) continue;
      // Clearly slack, even at the end of this step: no pull
      if (now.w <= 0 || now.C + Math.max(0, now.stretchRate() + st.bias) * h < -ROPE_PULL.slackMm * MM) {
        st.T = 0;
        st.bias = 0;
        st.expectC = null;
        continue;
      }
      // What the last step stretched it that the sums didn't see (a part hanging on a pin under the one
      // the rope holds pulls through its joint within the step): carried into this step's aim, smoothed.
      // Not while a part on the rope presses into something: what holds it there pushes back however
      // hard the rope pulls, and the pull would only grow until the part went through
      if (st.expectC !== null) {
        // Paused while what the rope's bodies touch pushes back as hard or harder than last step (the
        // rope drives them into it); not while that push eases (the rope draws them off it)
        const push = ropeContactPush(now);
        const pressed = push !== null && !(st.push !== null && push < st.push * (1 - ROPE_PULL.easingShare));
        st.push = push;
        if (pressed) st.bias *= 0.5;
        else st.bias += ROPE_PULL.biasGain * ((now.C - st.expectC) / h - st.bias);
      }
      pullImpulse(now, st.T * h);
      live.push([r, st, now]);
    }
    for (let pass = 0; pass < ROPE_PULL.passes; pass++) {
      for (const [, st, now] of live) {
        // How far over its length the rope would be at the end of the step: a slack rope may close
        // its gap (up to exactly taut), a rope already over is drawn back by a share β each step
        const rate = now.stretchRate();
        const err = rate + st.bias + (now.C > 0 ? ROPE_PULL.beta * now.C : now.C) / h;
        const T = THREE.MathUtils.clamp(st.T + (ROPE_PULL.gamma * err) / (now.w * h), 0, ROPE_PULL.maxN);
        pullImpulse(now, (T - st.T) * h);
        st.T = T;
      }
    }
    // Where each rope should be at the end of the step, by the sums
    for (const [, st, now] of live) st.expectC = now.C + now.stretchRate() * h;
    // The pull on spools turned through gears, once it is known
    for (const [, st, now] of live) for (const [body, f, at] of now.onGeared) body.applyImpulseAtPoint(vec(f.clone().multiplyScalar(st.T * h)), vec(at), true);
    ropeTorqueOnMotors([...live, ...clusterRopesLive]);
  }
  /** Ropes that don't pull (a free end, all on one body) still wind as their spool turns. */
  function windIdleRopes() {
    for (const r of graph.ropes || []) {
      if (r.pulls || !r.spool) continue;
      ropeNow(r, ropeState.get(r.id));
    }
  }

  // Outside pushes (a debugging aid for the checks, standing in for a part pushing): body -> { axis, point (m), speed (rad/s) }
  const pushes = new Map();
  const pulls = new Map();
  let carry = 0;
  let dropTimeScale = 1;
  return {
    step(dt, throttles) {
      // A drop is stepped finer, and can be played slower than real time
      const h = dropState.active ? DROP_STEP : STEP;
      if (world.timestep !== h) world.timestep = h;
      // A robot coming apart is a pile of jointed pieces pressing on each other: more solver passes keep
      // them from sinking into one another
      const passes = dropState.active ? DROP_SOLVER_PASSES : 4;
      if (world.numSolverIterations !== passes) world.numSolverIterations = passes;
      carry = Math.min(carry + dt * (dropState.active ? dropTimeScale : 1), (dropState.active ? MAX_DROP_STEPS : MAX_STEPS) * h);
      while (carry >= h) {
        carry -= h;
        lastThrottles = throttles;
        driveMotors(throttles, h);
        if (ratchetState.length) rideRatchets(h);
        for (const [bodyId, pull] of pulls) {
          const body = rb.get(bodyId);
          // A torque about a line through the body's centre of mass turns it; about another line, a push pair
          turnAboutLine(body, pull.axis, pull.point, pull.torque * h);
        }
        for (const [bodyId, push] of pushes) {
          const body = rb.get(bodyId);
          const w = toV3(body.angvel()).dot(push.axis);
          if (w < push.speed) spinAboutLine(body, push.axis, push.point, push.speed - w);
        }
        stopMotors(h);
        clusterRopesDone.clear();
        clusterRopesLive.length = 0;
        holdLinks(h);
        if (pullingBands.length) pullBands(h);
        if (pullingRopes.length) pullRopes(h);
        world.step(events, hooks);
        feltOverStep(h);
        stepDrop(h);
        checkBlocked(throttles, h);
        trackDrift(h);
        if (ratchetState.length) trackRatchets(h);
        if (meshState.length) trackMeshes();
        // Contacts and hinges may have pulled the ratios apart within the step: put the speeds back
        holdLinks(h, false);
      }
      if ((graph.ropes || []).length) windIdleRopes();
    },
    /** A body's mass (kg) and speed (m/s) now (a debugging aid for the checks). */
    massOf: (bodyId) => rb.get(bodyId)?.mass() ?? 0,
    speedOf: (bodyId) => {
      const b = rb.get(bodyId);
      return b ? toV3(b.linvel()).length() : 0;
    },
    /** Each rope's pull (N), slack (mm), turns on its spool and path length (mm) now. */
    ropeStates() {
      return (graph.ropes || []).map((r) => {
        const st = ropeState.get(r.id);
        return { id: r.id, tensionN: st.T, slackMm: st.slackMm, turns: st.turns, winding: st.winding, anchor: st.anchor ? spoolToWorld(r, st.anchor).toArray() : null, pathMm: st.pathMm, overFull: st.overFull, pulls: r.pulls };
      });
    },
    /** How fast a drop plays: 1 real time, 0.25 a quarter speed. */
    setDropTimeScale(scale) {
      dropTimeScale = THREE.MathUtils.clamp(Number(scale) || 1, 0.05, 1);
    },
    deltas() {
      const out = new Map();
      for (const [id, body] of rb) {
        const t = body.translation();
        out.set(id, new THREE.Matrix4().compose(new THREE.Vector3(t.x / MM, t.y / MM, t.z / MM), toV3q(body.rotation()), new THREE.Vector3(1, 1, 1)));
      }
      return out;
    },
    /** Parts that split off their body in a drop, moving on their own: part -> Matrix4. */
    partDeltas() {
      if (partBodyOverride.size === 0) return null;
      const out = new Map();
      for (const [partId, dropId] of partBodyOverride) {
        const body = splitBodies.get(dropId);
        if (!body) continue;
        const t = body.translation();
        out.set(partId, new THREE.Matrix4().compose(new THREE.Vector3(t.x / MM, t.y / MM, t.z / MM), toV3q(body.rotation()), new THREE.Vector3(1, 1, 1)));
      }
      return out;
    },
    drop(heightMeters = 0.5, landing = 'flat') {
      resetDrop();
      const h = THREE.MathUtils.clamp(Number(heightMeters) || 0.5, 0.05, 3.0);
      Object.assign(dropState, { active: true, heightM: h, landing, detached: [], swinging: [] });
      const poses = poseForDrop(h, landing);
      for (const b of graph.bodies) {
        const body = rb.get(b.id);
        const pose = poses.get(b.id);
        for (const c of bodyColliders.get(b.id) || []) {
          c.setRestitution(0.25);
          c.setFriction(0.45);
        }
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        body.setGravityScale(1, true);
        body.enableCcd(true);
        body.setTranslation(vec(pose.t), true);
        body.setRotation({ x: pose.q.x, y: pose.q.y, z: pose.q.z, w: pose.q.w }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        body.wakeUp();
      }
      return this.dropReport();
    },
    resetDrop,
    /**
     * What the last drop did: `{ active, impacted, heightM, landing, peakG, maxForceN, brokenPins: [{ id, label,
     * failure, forceN, strengthN, unit, partA, partB }], detachedParts: [{ id, label }], swingingParts (left hanging by one pin line): [{ id, label }], weakSpots: [{ id, label,
     * use, slidMm, travelMm, partA, partB }], estimates }` (slidMm: how far it slid part way out without letting go) (estimates: the strengths used are still assumed, not measured).
     */
    dropReport() {
      const jointOf = new Map(jointsList.map((j) => [j.id, j]));
      const round = (x) => Math.round(x * 10) / 10;
      const brokenPins = (impact?.broken || []).map((b) => {
        const j = jointOf.get(b.jointId);
        return { id: b.jointId, label: jointLabel(j), kind: j.kind, failure: b.failure, forceN: round(b.force), strengthN: round(b.strength), unit: b.unit, partA: j.a, partB: j.b, timeMs: b.timeMs };
      });
      // Joints that held but came close, or slid part way out (a pin loosened, a collar pushed along)
      const slid = impact?.slidMm || {};
      const weakSpots = Object.entries(impact?.peakUse || {})
        .filter(([id, use]) => (use >= 0.7 || slid[id]) && !brokenJoints.has(id))
        .sort((x, y) => y[1] - x[1])
        .map(([id, use]) => {
          const j = jointOf.get(id);
          // Rounded down, so a joint that held never reads as 100%
          return { id, label: jointLabel(j), use: Math.min(0.99, Math.floor(use * 100) / 100), slidMm: slid[id] || 0, travelMm: j.travelM ? Math.round(j.travelM * 1e4) / 10 : 0, partA: j.a, partB: j.b };
        });
      return {
        active: dropState.active,
        impacted: dropState.impacted,
        heightM: dropState.heightM,
        landing: dropState.landing,
        peakG: impact ? round(impact.peakG) : 0,
        maxForceN: impact ? round(impact.peakLoadN || 0) : 0,
        brokenPins,
        detachedParts: dropState.detached.map((id) => ({ id, label: labelOf(id) })),
        swingingParts: dropState.swinging.filter((id) => !dropState.detached.includes(id)).map((id) => ({ id, label: labelOf(id) })),
        weakSpots,
        estimates: !allMeasured()
      };
    },
    /** Changes a motor's stopping mode at once (openspec motor-stopping). Switched to Hold while
     * stopped, it holds from where the shaft is now. */
    setStopping(motorId, mode) {
      const st = motorState.get(motorId);
      if (!st || !['coast', 'brake', 'hold'].includes(mode) || st.mode === mode) return;
      st.mode = mode;
      st.holdRef = null;
      st.holdLoad = 0;
      st.holdSat = mode !== 'hold';
    },
    status() {
      const motors = {};
      for (const m of graph.motors) {
        const st = motorState.get(m.id);
        motors[m.id] = { rpm: (st.smooth * 60) / (2 * Math.PI), stalled: st.stalled, loadTorque: st.loadTorque || 0 };
      }
      return motors;
    },
    /** Gears that may swing into mesh: [{ id, gears, engaged, offMm (from mesh distance) }]. */
    meshes() {
      return meshState.map((st) => {
        const f = meshFrame(st);
        return { id: st.m.id, gears: st.m.gears, engaged: st.engaged, offMm: f ? (f.apart - st.distance) / MM : null };
      });
    },
    /** Turns body `bodyId` round the world line through `point` (mm) along `axis` with `torque` N·m every step until called with 0 (a debugging aid: stands in for a load or a hand). */
    pull(bodyId, axis, point, torque) {
      if (!torque) pulls.delete(bodyId);
      else if (rb.get(bodyId)?.isDynamic()) pulls.set(bodyId, { axis: new THREE.Vector3(...axis).normalize(), point: new THREE.Vector3(...point).multiplyScalar(MM), torque });
    },
    /**
     * Pushes body `bodyId` round the world line through `point` (mm) along `axis`, turning it at least
     * `speed` rad/s that way every step (0: holds it from turning back), as another part pressing on it
     * would; `speed` null lets go (a debugging aid for the checks, standing in for a part pushing).
     */
    push(bodyId, axis, point, speed) {
      if (speed === null || speed === undefined) pushes.delete(bodyId);
      else if (rb.get(bodyId)?.isDynamic()) pushes.set(bodyId, { axis: new THREE.Vector3(...axis).normalize(), point: new THREE.Vector3(...point).multiplyScalar(MM), speed });
    },
    /** Each ratchet: { id, ratchet, pawl, clicks (teeth passed under the pawl the free way), down, locked, phaseDeg, liftMm (the pawl's tip above the teeth's tips) }. */
    ratchets() {
      return ratchetState.map((st) => ({ id: st.r.id, ratchet: st.r.ratchet, pawl: st.r.pawl, clicks: st.clicks, down: st.down, locked: st.locked, phaseDeg: st.s, liftMm: st.lever && st.pivotAxis0 ? pawlLift(st).tipMm - st.r.tipRadiusMm : null }));
    },
    setLimitSpeedByLoad(on) {
      limitSpeedByLoad = Boolean(on);
    },
    setSimulateGravity(on) {
      simulateGravity = Boolean(on);
      applyGravityMode();
    },
    spin: (bodyId, axis) => spin(bodyId, new THREE.Vector3(...axis).normalize()),
    /** Why a pair of parts does or doesn't collide: { shaped: [a?, b?], letOff } (a debugging aid). */
    describePair(partA, partB) {
      const handles = (id) => [...partOfCollider].filter(([, p]) => p === id).map(([h]) => h);
      const ha = handles(partA);
      const hb = handles(partB);
      return { shaped: [ha.length > 0, hb.length > 0], letOff: ha.some((a) => hb.some((b) => skip.has(pairKey(a, b)))) };
    },
    /**
     * Pairs of parts on different bodies whose shapes overlap deeper than `depthMm` now:
     * [[instanceId, instanceId, depth (mm), letOff]] (a debugging aid: parts passing through each other).
     */
    overlaps(depthMm = 2) {
      const out = [];
      const cols = [];
      world.forEachCollider((c) => {
        if (c.handle !== floorHandle && partOfCollider.has(c.handle)) cols.push(c);
      });
      for (let i = 0; i < cols.length; i++) {
        for (let k = i + 1; k < cols.length; k++) {
          const [a, b] = [cols[i], cols[k]];
          if (a.parent()?.handle === b.parent()?.handle) continue;
          const hit = a.contactCollider(b, 0);
          if (hit && -hit.distance * 1000 > depthMm) out.push([partOfCollider.get(a.handle), partOfCollider.get(b.handle), -hit.distance * 1000, skip.has(pairKey(a.handle, b.handle))]);
        }
      }
      return out;
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

