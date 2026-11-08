/**
 * The drop test's impact (openspec drop-load-network): the robot as small motions of a network of
 * parts and springs, stepped finely through the ~40 ms it takes to land, to find which joints let go.
 *
 * - Every structural part is a node (moves and turns). Beams, plates and shafts flex: they become a
 *   node at each of their joints (closer than MERGE_MM merged) joined by bending springs worked out from
 *   their length, width, thickness and material. A beam is a line of nodes, a plate a grid.
 * - Every joint in the body graph (`graph.joints`) is a spring at its point: along its axis, sideways,
 *   rocking and twisting, as stiff as fastenerStrength.js says. Meshed gears and chains tie their gears'
 *   turns by ratio. Pins and chain links aren't nodes: their mass rides on the nearest node.
 * - The floor pushes (never pulls) on the parts that reach it. Everything starts falling at the given speed.
 * - Each step, each joint's pull (tension only), sideways load and rocking are set against its strengths;
 *   at a total of 1 it lets go at once and carries nothing more, so its load passes to the rest.
 *
 * Positions are taken relative to the robot's lowest point, so where the build sits makes no difference.
 * Pure (three.js maths only), so the node checks run it without Rapier.
 */
import * as THREE from 'three';
import { S, partMassKg } from './fastenerStrength.js';

const MM = 0.001;
const GRAVITY = 9.81;
const MERGE_MM = 12.7; // flexing parts' nodes this close or closer are one
const EPS = 1e-6; // m: parts sit on exact pitch spacings, so every cut-off takes this much slack (rounding never decides)
const CONTACT_REACH_MM = 15; // parts this close to the floor at first touch may reach it
const CONTACT_POINTS = 4; // floor points per part
const CONTACT_BAND_MM = 2; // a part's floor points come from this close to its own lowest point
const FACE_PAD_MM = 6.35; // nodes of two parts pinned face to face this close across press on each other
const CLUSTER_MM = 8; // a connector's pegs and holes this close together are one group
const FACE_BAND_MM = 3.5; // mesh points this close to a joint's plane make up a part's face there
const FACE_REACH_MM = 20; // a shared face's pads reach at most this far past its pins
const SLIDE_STEP = 2e-4; // m
const RUNAWAY_SPEED = 100; // m/s: no part of a dropped robot moves this fast; a solve that gets there has run away
const STEP_MARGIN = 0.5; // a node's fastest swing (its stiffness over its mass) times the step stays under this
const PLAY_SOFT = 0.05; // share of a joint's stiffness within its play
const MAX_DT = 4e-5; // s
const MIN_DT = 1.2e-5; // s: lighter, stiffer nodes than this allows are made heavier (reported)
const MIN_TIME = 0.025; // s
const MAX_TIME = 0.2; // s
const SETTLED_TIME = 0.01; // s with no joint's load still rising before the impact is over
const QUIET_TIME = 0.005; // s off the floor before the impact is over
const CORNERS = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z])));

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** The landings the drop test offers, in the build's own directions (+Y up, +X front, so +Z is right). */
export const LANDINGS = [
  { id: 'flat', label: 'Flat' },
  { id: 'front', label: 'Front' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left side' },
  { id: 'right', label: 'Right side' },
  { id: 'corner', label: 'Corner' }
];
const FACE_DOWN = { flat: [0, -1, 0], front: [1, 0, 0], back: [-1, 0, 0], left: [0, 0, -1], right: [0, 0, 1], corner: [1, -1, -1] };

/** The turn that puts `landing`'s face (or the front-left-bottom corner) straight down. */
export function landingQuaternion(landing = 'flat') {
  const face = new THREE.Vector3(...(FACE_DOWN[landing] || FACE_DOWN.flat)).normalize();
  return new THREE.Quaternion().setFromUnitVectors(face, new THREE.Vector3(0, -1, 0));
}

/** Two unit vectors square to `n` and each other. */
function frameOf(n) {
  const helper = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Vector3().crossVectors(n, helper).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
  return [e1, e2];
}

/** The 3x3 inertia (kg·m², world) of a solid box of mass `m`, sides `size` (m) along the columns of `R`. */
function boxInertia(m, size, R) {
  const [a, b, c] = size;
  const local = new THREE.Matrix3().set((m * (b * b + c * c)) / 12, 0, 0, 0, (m * (a * a + c * c)) / 12, 0, 0, 0, (m * (a * a + b * b)) / 12);
  const Rt = R.clone().transpose();
  return R.clone().multiply(local).multiply(Rt);
}

const isTire = (info) => info?.category === 'Wheels & Treads' && !/Hub|Flywheel/i.test(info?.name || '');
const isShaftPart = (info) => /Shaft/i.test(info?.name || '') && info?.category === 'Shafts, Spacers & Collars' && !/Collar|Bushing|Spacer/i.test(info?.name || '');
const isFlexPart = (info) => info?.category === 'Beams & Plates' || isShaftPart(info);

/**
 * The network for one impact. `graph` is the body graph; `instances` the parts as placed; `deltaOf(partId)`
 * the move (Matrix4, mm) of each part's body from where it was built to where it is at first touch;
 * `pointsOf(partId)` its mesh points in its own frame (mm, flat xyz) or null.
 */
export function buildImpactModel({ graph, instances, deltaOf, pointsOf, flex: allowFlex = true }) {
  const info = graph.partInfo || {};
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const pins = new Set(graph.pins || []);
  const still = new Set(graph.still || []);
  const looseParts = new Set(graph.bodies.filter((b) => (graph.loose || []).includes(b.id)).flatMap((b) => b.parts));
  const bodyOfPart = new Map(graph.bodies.flatMap((b) => b.parts.map((p) => [p, b.id])));
  const identity = new THREE.Matrix4();
  const delta = (id) => deltaOf?.(id) || identity;

  // Where each part is now: its start pose carried by its body's move
  const poseOf = new Map();
  const startMatrix = (inst) =>
    new THREE.Matrix4().compose(
      new THREE.Vector3(...inst.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...inst.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ')),
      new THREE.Vector3(1, 1, 1)
    );
  const matrixOf = (id) => {
    if (!poseOf.has(id)) {
      const inst = byId.get(id);
      poseOf.set(id, inst ? delta(id).clone().multiply(startMatrix(inst)) : null);
    }
    return poseOf.get(id);
  };
  const worldPoint = (partId, pointMm) => v3(pointMm).applyMatrix4(delta(partId)).multiplyScalar(MM);
  const worldDir = (partId, dir) => v3(dir).transformDirection(delta(partId)).normalize();

  const structural = graph.bodies
    .flatMap((b) => b.parts)
    .filter((id) => !pins.has(id) && !still.has(id) && !looseParts.has(id) && byId.has(id) && info[id]?.box);
  const structSet = new Set(structural);
  const jointsOf = new Map(structural.map((id) => [id, []]));
  for (const j of graph.joints || []) {
    if (structSet.has(j.a) && structSet.has(j.b)) {
      jointsOf.get(j.a).push(j);
      jointsOf.get(j.b).push(j);
    }
  }

  const nodes = []; // { part, pos (Vector3 m), m, I (Matrix3) }
  const nodesOf = new Map(); // part -> [node index]
  const conns = []; // bending springs and joints
  const partFrame = new Map(); // part -> { center, R, size (m, local axes), axes }

  const addConn = (c) => {
    conns.push({ broken: false, peak: 0, slipAxial: 0, slipTwist: 0, ...c });
    return conns[conns.length - 1];
  };
  /** A straight-beam spring between nodes a and b (ends of a segment `len` m long), section w × t. */
  const addBeam = (a, b, n, eW, eT, w, t, E, factor) => {
    const len = nodes[a].pos.distanceTo(nodes[b].pos);
    if (len < 1e-5) return;
    const G = E * S('shearOverE');
    const A = factor * w * t;
    const Iw = (factor * t * w ** 3) / 12; // against bending along eW (edgewise)
    const It = (factor * w * t ** 3) / 12; // against bending along eT (flat)
    const J = (factor * Math.max(w, t) * Math.min(w, t) ** 3) / 3;
    const mid = nodes[a].pos.clone().add(nodes[b].pos).multiplyScalar(0.5);
    addConn({
      kind: 'beam',
      a,
      b,
      rA: mid.clone().sub(nodes[a].pos),
      rB: mid.clone().sub(nodes[b].pos),
      n: n.clone(),
      e1: eW.clone(),
      e2: eT.clone(),
      // [along, eW, eT] and turning [about n, about eW, about eT]: deflection along eW is bending about eT.
      // Stretch and edgewise stiffness far above any pin's are capped (they change no loads)
      k: [(E * A) / len, (12 * E * Iw) / len ** 3, (12 * E * It) / len ** 3, (G * J) / len, (E * It) / len, (E * Iw) / len].map((k, i) =>
        Math.min(k, S(i < 3 ? 'beamMaxK' : 'beamMaxRotK'))
      )
    });
  };

  for (const id of structural) {
    const inst = byId.get(id);
    const box = info[id].box;
    const M = matrixOf(id);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    M.decompose(pos, quat, new THREE.Vector3());
    const R = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(quat));
    const centerLocal = v3(box.min).add(v3(box.max)).multiplyScalar(0.5);
    const center = centerLocal.clone().applyMatrix4(M).multiplyScalar(MM);
    const size = [0, 1, 2].map((k) => (box.max[k] - box.min[k]) * MM);
    const axes = [0, 1, 2].map((k) => new THREE.Vector3().setFromMatrix3Column(R, k).normalize());
    partFrame.set(id, { center, R, size, axes });
    const mass = partMassKg({ name: info[id].name, partNumber: info[id].partNumber, size: size.map((s) => s / MM) });
    const list = [];
    nodesOf.set(id, list);
    const order = [0, 1, 2].sort((x, y) => size[y] - size[x]);
    const [iL, iW, iT] = order;
    const L = size[iL];
    const W = size[iW];
    const T = size[iT];
    const flex = allowFlex && isFlexPart(info[id]) && L > 2 * MERGE_MM * MM + EPS;
    // The joint points along the part, measured from its centre
    const jointPoints = jointsOf
      .get(id)
      .filter((j) => j.point)
      .map((j) => worldPoint(id, j.point));
    const asBeam = flex && (isShaftPart(info[id]) || L >= 2.5 * W);
    if (flex && asBeam) {
      const tAll = [0, ...jointPoints.map((p) => THREE.MathUtils.clamp(p.clone().sub(center).dot(axes[iL]), -L / 2, L / 2))].sort((x, y) => x - y);
      const ts = [];
      for (const t of tAll) {
        const last = ts[ts.length - 1];
        if (last && t - last.hi < MERGE_MM * MM + EPS) {
          last.sum += t;
          last.n += 1;
          last.hi = t;
        } else ts.push({ sum: t, n: 1, hi: t });
      }
      const at = ts.map((x) => x.sum / x.n);
      if (at.length >= 2) {
        const shaft = isShaftPart(info[id]);
        const E = shaft ? S(/Plastic/i.test(info[id].name) ? 'plasticShaftE' : 'metalShaftE') : S('absE');
        const factor = shaft ? 1 : S('sectionFactor');
        at.forEach((t, i) => {
          const lo = i === 0 ? -L / 2 : (at[i - 1] + t) / 2;
          const hi = i === at.length - 1 ? L / 2 : (t + at[i + 1]) / 2;
          const share = Math.max(hi - lo, 1e-4) / L;
          const m = mass * share;
          const segSize = [0, 0, 0];
          segSize[iL] = hi - lo;
          segSize[iW] = W;
          segSize[iT] = T;
          list.push(nodes.length);
          nodes.push({ part: id, pos: center.clone().addScaledVector(axes[iL], (lo + hi) / 2), m, I: boxInertia(m, segSize, R) });
        });
        // Nodes sit at the middle of their stretch; joints attach at their offsets
        for (let i = 0; i + 1 < list.length; i++) addBeam(list[i], list[i + 1], axes[iL], axes[iW], axes[iT], W, T, E, factor);
        continue;
      }
    } else if (flex) {
      // A plate: a grid of nodes at its joints, each tied to its nearest neighbour along both sides
      const uv = (p) => [p.clone().sub(center).dot(axes[iL]), p.clone().sub(center).dot(axes[iW])];
      const pts = [[0, 0], ...jointPoints.map(uv)].map(([u, v]) => [THREE.MathUtils.clamp(u, -L / 2, L / 2), THREE.MathUtils.clamp(v, -W / 2, W / 2)]);
      const merged = [];
      for (const [u, v] of pts) {
        const near = merged.find((q) => Math.hypot(q.u / q.n - u, q.v / q.n - v) < MERGE_MM * MM + EPS);
        if (near) {
          near.u += u;
          near.v += v;
          near.n += 1;
        } else merged.push({ u, v, n: 1 });
      }
      const at = merged.map((q) => [q.u / q.n, q.v / q.n]);
      if (at.length >= 2) {
        const m = mass / at.length;
        const cell = [0, 0, 0];
        cell[iL] = L / Math.sqrt(at.length);
        cell[iW] = W / Math.sqrt(at.length);
        cell[iT] = T;
        for (const [u, v] of at) {
          list.push(nodes.length);
          nodes.push({ part: id, pos: center.clone().addScaledVector(axes[iL], u).addScaledVector(axes[iW], v), m, I: boxInertia(m, cell, R) });
        }
        const rows = (k) => new Set(at.map((p) => Math.round(p[k] / (6 * MM)))).size;
        const edges = new Set();
        for (let i = 0; i < at.length; i++) {
          for (const [dir, k] of [[0, 0], [1, 1]]) {
            let best = -1;
            let bestD = Infinity;
            for (let j = 0; j < at.length; j++) {
              if (j === i) continue;
              const d = [at[j][0] - at[i][0], at[j][1] - at[i][1]];
              const dist = Math.hypot(d[0], d[1]);
              if (dist < 1e-6 || d[dir] <= 0 || d[dir] < Math.cos(THREE.MathUtils.degToRad(40)) * dist) continue;
              if (dist < bestD) [best, bestD] = [j, dist];
            }
            if (best >= 0) edges.add(i < best ? `${i}|${best}|${k}` : `${best}|${i}|${k}`);
          }
        }
        for (const e of edges) {
          const [i, j, k] = e.split('|').map(Number);
          const a = list[i];
          const b = list[j];
          const n = nodes[b].pos.clone().sub(nodes[a].pos).normalize();
          const eT = axes[iT];
          const eW = new THREE.Vector3().crossVectors(eT, n).normalize();
          // Each edge carries the plate's width across it shared between the rows of nodes beside it
          const across = k === 0 ? W : L;
          const width = THREE.MathUtils.clamp(across / Math.max(1, rows(k === 0 ? 1 : 0)), 6.35 * MM, across);
          addBeam(a, b, n, eW, eT, width, T, S('absE'), S('sectionFactor'));
        }
        continue;
      }
    }
    // A connector or bracket: a node at each group of its pegs and holes, each joined to its middle by a
    // flexing wall, so it bends between the parts it joins instead of levering them apart
    if (allowFlex && info[id]?.category === 'Connectors & Brackets' && jointPoints.length >= 2) {
      const clusters = [];
      const jointList = jointsOf.get(id).filter((j) => j.point);
      jointList.forEach((j, i) => {
        const p = jointPoints[i];
        const axis = worldDir(id, j.axis);
        const near = clusters.find((c) => c.sum.clone().multiplyScalar(1 / c.n).distanceTo(p) < CLUSTER_MM * MM + EPS);
        if (near) {
          near.sum.add(p);
          near.n += 1;
          near.axis.add(axis.multiplyScalar(Math.sign(axis.dot(near.axis)) || 1));
        } else clusters.push({ sum: p.clone(), n: 1, axis });
      });
      if (clusters.length >= 2) {
        const hub = nodes.length;
        list.push(hub);
        const solidHub = [0, 0, 0];
        order.forEach((k) => (solidHub[k] = size[k]));
        nodes.push({ part: id, pos: center.clone(), m: mass * 0.4, I: boxInertia(mass * 0.4, solidHub, R) });
        const wall = S('connectorWallMm') * MM;
        const width = 12.7 * MM;
        for (const c of clusters) {
          const at = c.sum.clone().multiplyScalar(1 / c.n);
          const m = (mass * 0.6) / clusters.length;
          const k = nodes.length;
          list.push(k);
          nodes.push({ part: id, pos: at, m, I: boxInertia(m, [width, width, wall], new THREE.Matrix3()) });
          const n = at.clone().sub(center);
          if (n.lengthSq() < 1e-8) continue;
          n.normalize();
          // The wall bends most across its face, the way its pegs point
          let eT = c.axis.clone().addScaledVector(n, -c.axis.dot(n));
          if (eT.lengthSq() < 1e-6) eT = frameOf(n)[0];
          eT.normalize();
          const eW = new THREE.Vector3().crossVectors(n, eT).normalize();
          addBeam(hub, k, n, eW, eT, width, wall, S('absE'), 1);
        }
        continue;
      }
    }
    // A rigid part: one node at its centre
    const solid = [0, 0, 0];
    order.forEach((k) => (solid[k] = size[k]));
    list.push(nodes.length);
    nodes.push({ part: id, pos: center.clone(), m: mass, I: boxInertia(mass, solid, R) });
  }

  const nearestNode = (partId, p) => {
    const list = nodesOf.get(partId);
    if (!list?.length) return -1;
    let best = list[0];
    let bestD = Infinity;
    for (const i of list) {
      const d = nodes[i].pos.distanceToSquared(p);
      if (d < bestD) [best, bestD] = [i, d];
    }
    return best;
  };

  // Pins and chain links ride on the nearest node
  const allNodePos = nodes.map((n) => n.pos);
  for (const id of [...pins, ...still]) {
    if (looseParts.has(id) || !byId.has(id)) continue;
    const inst = byId.get(id);
    const p = v3(inst.position).applyMatrix4(delta(id)).multiplyScalar(MM);
    const holder = (graph.joints || []).find((j) => j.pinIds?.includes(id));
    let target = holder ? nearestNode(holder.a, p) : -1;
    if (target < 0) {
      let bestD = Infinity;
      allNodePos.forEach((q, i) => {
        const d = q.distanceToSquared(p);
        if (d < bestD) [target, bestD] = [i, d];
      });
    }
    if (target < 0) continue;
    const m = partMassKg({ name: info[id]?.name, partNumber: info[id]?.partNumber, size: info[id]?.box ? [0, 1, 2].map((k) => info[id].box.max[k] - info[id].box.min[k]) : null, pin: pins.has(id) });
    const off = p.clone().sub(nodes[target].pos);
    nodes[target].m += m;
    // Its mass off the node's centre adds to how hard the node is to turn
    const r2 = off.lengthSq();
    const add = new THREE.Matrix3().set(m * (r2 - off.x * off.x), -m * off.x * off.y, -m * off.x * off.z, -m * off.y * off.x, m * (r2 - off.y * off.y), -m * off.y * off.z, -m * off.z * off.x, -m * off.z * off.y, m * (r2 - off.z * off.z));
    for (let k = 0; k < 9; k++) nodes[target].I.elements[k] += add.elements[k];
  }

  // Joints as springs between the nodes nearest their points
  for (const j of graph.joints || []) {
    if (!structSet.has(j.a) || !structSet.has(j.b)) continue;
    let point;
    let axis;
    if (j.kind === 'bay' || j.kind === 'tire') {
      point = partFrame.get(j.a).center.clone();
      axis = partFrame.get(j.b).axes[1].clone();
    } else {
      point = worldPoint(j.a, j.point);
      axis = worldDir(j.a, j.axis);
    }
    const a = nearestNode(j.a, point);
    const b = nearestNode(j.b, point);
    if (a < 0 || b < 0 || a === b) continue;
    // Its axis points from part a to part b, so moving apart along it is a pull
    if (j.orient === 'centres' && partFrame.get(j.b).center.clone().sub(partFrame.get(j.a).center).dot(axis) < 0) axis.negate();
    const [e1, e2] = frameOf(axis);
    const k = [j.k.axial, j.k.shear, j.k.shear, j.k.twist, j.k.rock, j.k.rock];
    addConn({
      kind: j.kind,
      joint: j,
      a,
      b,
      rA: point.clone().sub(nodes[a].pos),
      rB: point.clone().sub(nodes[b].pos),
      n: axis,
      e1,
      e2,
      k
    });
  }

  // Parts pinned face to face bear on each other across the face they share: pads at the corners of where
  // their faces overlap (their mesh points near the joint's plane), so a part tipped on its pins pivots
  // on the far edge of that face, as a real one does, and prying pulls its pins over that lever. Without
  // mesh points, a ring round each pin.
  const worldCloud = new Map();
  const cloudOf = (id) => {
    if (!worldCloud.has(id)) {
      const M = matrixOf(id);
      const raw = pointsOf?.(id);
      const local = [];
      if (raw?.length >= 3) {
        const n = raw.length / 3;
        const step = Math.max(1, Math.floor(n / 800));
        for (let i = 0; i < n; i += step) local.push([raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]]);
      } else {
        const box = info[id].box;
        for (const c of CORNERS) local.push(c.map((s, k) => (s < 0 ? box.min[k] : box.max[k])));
      }
      worldCloud.set(id, local.map((p) => v3(p).applyMatrix4(M).multiplyScalar(MM)));
    }
    return worldCloud.get(id);
  };
  const faceGroups = new Map();
  for (const c of conns) {
    if (c.kind !== 'pin' && c.kind !== 'peg') continue;
    const key = `${nodes[c.a].part}|${nodes[c.b].part}|${c.n.toArray().map((x) => Math.round(x * 20)).join(',')}`;
    if (!faceGroups.has(key)) faceGroups.set(key, []);
    faceGroups.get(key).push(c);
  }
  const lever = S('pinLeverMm') * MM;
  const pad = (pa, pb, p, c, k) => {
    const a = nearestNode(pa, p);
    const b = nearestNode(pb, p);
    if (a < 0 || b < 0 || a === b) return;
    addConn({ kind: 'push', friction: true, anchor: [0, 0], a, b, rA: p.clone().sub(nodes[a].pos), rB: p.clone().sub(nodes[b].pos), n: c.n.clone(), e1: c.e1.clone(), e2: c.e2.clone(), k: [k, k, k, 0, 0, 0] });
  };
  for (const group of faceGroups.values()) {
    const c0 = group[0];
    const pa = nodes[c0.a].part;
    const pb = nodes[c0.b].part;
    const pins = group.map((c) => c.rA.clone().add(nodes[c.a].pos));
    const origin = pins.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / pins.length);
    const uv = (p) => {
      const d = p.clone().sub(origin);
      return [d.dot(c0.e1), d.dot(c0.e2), d.dot(c0.n)];
    };
    const footprint = (id) => {
      const f = [Infinity, -Infinity, Infinity, -Infinity];
      for (const p of cloudOf(id)) {
        const [u, v, w] = uv(p);
        if (Math.abs(w) > FACE_BAND_MM * MM + EPS) continue;
        f[0] = Math.min(f[0], u);
        f[1] = Math.max(f[1], u);
        f[2] = Math.min(f[2], v);
        f[3] = Math.max(f[3], v);
      }
      return f;
    };
    const fa = footprint(pa);
    const fb = footprint(pb);
    const pinUv = pins.map(uv);
    const reach = FACE_REACH_MM * MM;
    const lo = (k) => Math.min(...pinUv.map((q) => q[k]));
    const hi = (k) => Math.max(...pinUv.map((q) => q[k]));
    // The shared face, never smaller than the pins it holds nor reaching far past them
    const u0 = Math.max(Math.min(Math.max(fa[0], fb[0]), lo(0) - lever), lo(0) - reach);
    const u1 = Math.min(Math.max(Math.min(fa[1], fb[1]), hi(0) + lever), hi(0) + reach);
    const w0 = Math.max(Math.min(Math.max(fa[2], fb[2]), lo(1) - lever), lo(1) - reach);
    const w1 = Math.min(Math.max(Math.min(fa[3], fb[3]), hi(1) + lever), hi(1) + reach);
    const k = S('pushK') / 4;
    for (const [u, w] of [[u0, w0], [u0, w1], [u1, w0], [u1, w1]]) {
      pad(pa, pb, origin.clone().addScaledVector(c0.e1, u).addScaledVector(c0.e2, w), c0, k);
    }
  }
  // ... and wherever their nodes sit across from one another, not only at the pins (two stacked beams bend together)
  const padded = new Set();
  for (const c of [...conns]) {
    if (c.kind !== 'pin' && c.kind !== 'peg') continue;
    const pa = nodes[c.a].part;
    const pb = nodes[c.b].part;
    const key = `${pa}|${pb}`;
    if (padded.has(key)) continue;
    padded.add(key);
    for (const na of nodesOf.get(pa)) {
      let best = -1;
      let bestD = Infinity;
      for (const nb of nodesOf.get(pb)) {
        const d = nodes[nb].pos.clone().sub(nodes[na].pos);
        const along = d.dot(c.n);
        const lateral = Math.sqrt(Math.max(0, d.lengthSq() - along * along));
        if (lateral > FACE_PAD_MM * MM + EPS || Math.abs(along) > 2 * FACE_PAD_MM * MM + EPS) continue;
        if (lateral < bestD) [best, bestD] = [nb, lateral];
      }
      if (best < 0) continue;
      const mid = nodes[na].pos.clone().add(nodes[best].pos).multiplyScalar(0.5);
      addConn({ kind: 'push', a: na, b: best, rA: mid.clone().sub(nodes[na].pos), rB: mid.clone().sub(nodes[best].pos), n: c.n.clone(), e1: c.e1.clone(), e2: c.e2.clone(), k: [S('pushK'), 0, 0, 0, 0, 0] });
    }
  }

  // Meshed gears and chains: their turns held to the ratio
  const gears = [];
  for (const l of graph.links || []) {
    if (l.kind !== 'gear' && l.kind !== 'chain') continue;
    const [ga, gb] = l.gears;
    if (!structSet.has(ga) || !structSet.has(gb)) continue;
    const a = nearestNode(ga, partFrame.get(ga).center);
    const b = nearestNode(gb, partFrame.get(gb).center);
    if (a < 0 || b < 0 || a === b) continue;
    gears.push({ a, b, axisA: worldDir(ga, l.axisA), axisB: worldDir(gb, l.axisB), ratio: l.sign * l.ratio, k: S('gearMeshK') });
  }

  // Floor contact points: each part's lowest mesh points (or box corners) within reach of the lowest of all
  const candidates = [];
  let lowest = Infinity;
  for (const id of structural) {
    const M = matrixOf(id);
    const raw = pointsOf?.(id);
    const local = [];
    if (raw?.length >= 3) {
      const n = raw.length / 3;
      const step = Math.max(1, Math.floor(n / 300));
      for (let i = 0; i < n; i += step) local.push([raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]]);
    } else {
      const box = info[id].box;
      for (const c of CORNERS) local.push(c.map((s, k) => (s < 0 ? box.min[k] : box.max[k])));
    }
    const world = local.map((p) => v3(p).applyMatrix4(M).multiplyScalar(MM));
    for (const p of world) lowest = Math.min(lowest, p.y);
    candidates.push({ id, world });
  }
  const contacts = [];
  for (const { id, world } of candidates) {
    // A part within reach of the floor touches with its own lowest face (a tire with its bottom), so
    // its stiffness is shared only by points that reach the floor together
    const own = Math.min(...world.map((p) => p.y));
    if (own > lowest + CONTACT_REACH_MM * MM + EPS) continue;
    const near = world.filter((p) => p.y <= own + CONTACT_BAND_MM * MM + EPS).sort((p, q) => p.y - q.y);
    if (!near.length) continue;
    const chosen = [near[0]];
    while (chosen.length < CONTACT_POINTS && chosen.length < near.length) {
      let best = null;
      let bestD = -1;
      for (const p of near) {
        const d = Math.min(...chosen.map((c) => Math.hypot(c.x - p.x, c.z - p.z)));
        if (d > bestD) [best, bestD] = [p, d];
      }
      if (bestD < 2 * MM) break;
      chosen.push(best);
    }
    const k = S(isTire(info[id]) ? 'tireContactK' : 'hardContactK') / chosen.length;
    for (const p of chosen) {
      const node = nearestNode(id, p);
      contacts.push({ part: id, node, r: p.clone().sub(nodes[node].pos), k, y0: p.y });
    }
  }

  return { nodes, nodesOf, conns, gears, contacts, floorY: lowest, partFrame, bodyOfPart };
}

/**
 * Steps the impact. `speed` (m/s) is how fast the robot is falling when it first touches. Returns
 * `{ broken: [{ jointId, kind, failure, force, strength, unit, timeMs }], peakUse: { jointId: share of
 * strength }, peakG, partVelocity: { partId: { v: [m/s], w: [rad/s] } }, partFlex: { partId: m },
 * durationMs, steps, dt, addedMassKg }`.
 */
export function solveImpact(model, options) {
  // A very light piece among stiff springs can still swing faster than the step allows: if anything
  // runs away, start again with half the step (twice at most)
  let result = null;
  for (const dt of options.dt ? [options.dt] : [MIN_DT, MIN_DT / 2, MIN_DT / 4]) {
    result = solveWithStep(model, options, dt);
    if (!result.unsteady) return result;
  }
  return result;
}

function solveWithStep(model, { speed, minTime = MIN_TIME, maxTime = MAX_TIME, trace = null, gravity = GRAVITY }, dt) {
  const { nodes, conns, gears, contacts } = model;
  const N = nodes.length;
  const m = new Float64Array(N);
  const Iinv = new Float64Array(N * 9);
  const u = new Float64Array(N * 3); // move from the start (m)
  const th = new Float64Array(N * 3); // turn from the start (rad, small)
  const v = new Float64Array(N * 3);
  const w = new Float64Array(N * 3);
  const F = new Float64Array(N * 3);
  const T = new Float64Array(N * 3);
  const flex = new Float64Array(N);

  // How stiff each node is held, for the time step: translation and turning
  const kLin = new Float64Array(N);
  const kRot = new Float64Array(N);
  for (const c of conns) {
    const kl = c.k[0] + c.k[1] + c.k[2];
    const kr = c.k[3] + c.k[4] + c.k[5];
    kLin[c.a] += kl;
    kLin[c.b] += kl;
    kRot[c.a] += kr + kl * c.rA.lengthSq();
    kRot[c.b] += kr + kl * c.rB.lengthSq();
  }
  for (const ct of contacts) {
    kLin[ct.node] += ct.k;
    kRot[ct.node] += ct.k * ct.r.lengthSq();
  }
  for (const g of gears) {
    kRot[g.a] += g.k * g.ratio * g.ratio;
    kRot[g.b] += g.k;
  }
  let addedMassKg = 0;
  const inv = new THREE.Matrix3();
  for (let i = 0; i < N; i++) {
    // Lighter or stiffer nodes than the step allows are made heavier (only ever small pieces)
    const need = kLin[i] * (dt / STEP_MARGIN) ** 2;
    m[i] = Math.max(nodes[i].m, need);
    addedMassKg += m[i] - nodes[i].m;
    const I = nodes[i].I.clone();
    const needI = Math.max(kRot[i] * (dt / STEP_MARGIN) ** 2, 1e-9);
    // The least it turns about any axis is at least its diagonal less what lies off it (a part tilted off
    // the world's axes has its weakest axis between them); lift that floor to what the step needs
    const e = I.elements;
    const floor = Math.min(e[0] - Math.abs(e[3]) - Math.abs(e[6]), e[4] - Math.abs(e[1]) - Math.abs(e[7]), e[8] - Math.abs(e[2]) - Math.abs(e[5]));
    if (floor < needI) for (const k of [0, 4, 8]) e[k] += needI - floor;
    inv.copy(I).invert();
    for (let k = 0; k < 9; k++) Iinv[i * 9 + k] = inv.elements[k];
  }
  const scalarI = (i) => {
    const e = nodes[i].I.elements;
    return Math.max((e[0] + e[4] + e[8]) / 3, 1e-9);
  };
  // Every spring packed into flat arrays for the stepping loop (it runs thousands of times)
  const zeta = S('jointDamping');
  const SC = conns.length;
  const cAB = new Int32Array(SC * 2); // a × 3, b × 3
  const cR = new Float64Array(SC * 6); // rA, rB
  const cF = new Float64Array(SC * 9); // n, e1, e2
  const cK = new Float64Array(SC * 6);
  const cC = new Float64Array(SC * 6); // damping: a share of critical for the two nodes it ties
  const cType = new Uint8Array(SC); // 0 holds both ways, 1 only pushes, 2 pushes and grips by friction
  const cPlay = new Float64Array(SC);
  const cMode = new Uint8Array(SC); // 0 never breaks, 1 slides at slipN, 2 breaks on pull and sideways load
  const cPull = new Float64Array(SC);
  const cShear = new Float64Array(SC);
  const cSlip = new Float64Array(SC);
  const cLever = new Float64Array(SC);
  const cHold = new Float64Array(SC).fill(Infinity);
  const cState = new Float64Array(SC * 3); // friction anchor (2), motor slip (1)
  const cTravel = new Float64Array(SC); // how far it must slide to come off (m)
  const cSlide = new Float64Array(SC); // how far it has slid (m)
  const cSlideMark = new Float64Array(SC); // where it had slid to when that last counted as its load still rising
  const cBroken = new Uint8Array(SC);
  const cUse = new Float64Array(SC);
  conns.forEach((c, s) => {
    const mEff = (m[c.a] * m[c.b]) / (m[c.a] + m[c.b]);
    const iEff = (scalarI(c.a) * scalarI(c.b)) / (scalarI(c.a) + scalarI(c.b));
    cAB[s * 2] = c.a * 3;
    cAB[s * 2 + 1] = c.b * 3;
    cR.set([c.rA.x, c.rA.y, c.rA.z, c.rB.x, c.rB.y, c.rB.z], s * 6);
    cF.set([c.n.x, c.n.y, c.n.z, c.e1.x, c.e1.y, c.e1.z, c.e2.x, c.e2.y, c.e2.z], s * 9);
    for (let r = 0; r < 6; r++) {
      cK[s * 6 + r] = c.k[r];
      cC[s * 6 + r] = 2 * zeta * Math.sqrt(c.k[r] * (r < 3 ? mEff : iEff));
    }
    cType[s] = c.kind === 'push' ? (c.friction ? 2 : 1) : 0;
    const j = c.joint;
    if (!j) return;
    cPlay[s] = j.playM || 0;
    cTravel[s] = j.travelM || 0;
    // A joint that can't break has an infinite strength, which arrives as null when the body graph comes
    // from the server as JSON: missing or null means it never lets go that way
    const strength = (x) => (typeof x === 'number' && x > 0 ? x : Infinity);
    if (typeof j.twistHoldNm === 'number') cHold[s] = strength(j.twistHoldNm);
    if (typeof j.slipN === 'number') {
      cMode[s] = 1;
      cSlip[s] = strength(j.slipN);
    } else if (strength(j.pullN) !== Infinity || strength(j.shearN) !== Infinity) {
      cMode[s] = 2;
      cPull[s] = strength(j.pullN);
      cShear[s] = strength(j.shearN);
      cLever[s] = j.leverM || 0;
    }
  });
  // Each floor point damps its share of its node's mass, so a part's bounce doesn't depend on its point count
  const pointsOnNode = new Map();
  for (const ct of contacts) pointsOnNode.set(ct.node, (pointsOnNode.get(ct.node) || 0) + 1);
  for (const ct of contacts) {
    ct.peak = 0;
    ct.c = 2 * S('contactDamping') * Math.sqrt((ct.k * m[ct.node]) / pointsOnNode.get(ct.node));
    ct.rx = ct.r.x; ct.ry = ct.r.y; ct.rz = ct.r.z;
  }
  for (let i = 0; i < N; i++) v[i * 3 + 1] = -speed;

  const totalMass = nodes.reduce((s, n) => s + n.m, 0);
  const friction = S('faceFriction');
  const broken = [];
  let peakG = 0;
  let peakLoadN = 0;
  let lastRise = 0;
  let t = 0;
  let steps = 0;
  let lastContact = 0;
  const traced = trace ? conns.map((c) => (c.joint && trace.has(c.joint.id) ? c.joint.id : null)) : null;

  const fail = (s, failure, force, strength, unit, detail) => {
    cBroken[s] = 1;
    lastRise = t;
    broken.push({ jointId: conns[s].joint.id, kind: conns[s].kind, failure, force, strength, unit, timeMs: Math.round(t * 1e4) / 10, detail });
  };
  // Sliding counts as its load still rising once it has gone another SLIDE_STEP
  const noteSlide = (s) => {
    if (Math.abs(cSlide[s] - cSlideMark[s]) > SLIDE_STEP) {
      cSlideMark[s] = cSlide[s];
      lastRise = t;
    }
  };
  const noteUse = (s, use) => {
    if (use > cUse[s]) {
      if (use > cUse[s] + 0.01) lastRise = t;
      cUse[s] = use;
    }
  };

  while (t < maxTime) {
    F.fill(0);
    T.fill(0);
    for (let i = 0; i < N; i++) F[i * 3 + 1] = -m[i] * gravity;
    // Springs: move at the point on each side, split into the spring's own frame [n, e1, e2]
    for (let s = 0; s < SC; s++) {
      if (cBroken[s]) continue;
      const a3 = cAB[s * 2];
      const b3 = cAB[s * 2 + 1];
      const r6 = s * 6;
      const rAx = cR[r6], rAy = cR[r6 + 1], rAz = cR[r6 + 2], rBx = cR[r6 + 3], rBy = cR[r6 + 4], rBz = cR[r6 + 5];
      // d = (uB + thB × rB) − (uA + thA × rA), and its rate
      const dx = u[b3] + th[b3 + 1] * rBz - th[b3 + 2] * rBy - (u[a3] + th[a3 + 1] * rAz - th[a3 + 2] * rAy);
      const dy = u[b3 + 1] + th[b3 + 2] * rBx - th[b3] * rBz - (u[a3 + 1] + th[a3 + 2] * rAx - th[a3] * rAz);
      const dz = u[b3 + 2] + th[b3] * rBy - th[b3 + 1] * rBx - (u[a3 + 2] + th[a3] * rAy - th[a3 + 1] * rAx);
      const vx = v[b3] + w[b3 + 1] * rBz - w[b3 + 2] * rBy - (v[a3] + w[a3 + 1] * rAz - w[a3 + 2] * rAy);
      const vy = v[b3 + 1] + w[b3 + 2] * rBx - w[b3] * rBz - (v[a3 + 1] + w[a3 + 2] * rAx - w[a3] * rAz);
      const vz = v[b3 + 2] + w[b3] * rBy - w[b3 + 1] * rBx - (v[a3 + 2] + w[a3] * rAy - w[a3 + 1] * rAx);
      const px = th[b3] - th[a3], py = th[b3 + 1] - th[a3 + 1], pz = th[b3 + 2] - th[a3 + 2];
      const qx = w[b3] - w[a3], qy = w[b3 + 1] - w[a3 + 1], qz = w[b3 + 2] - w[a3 + 2];
      const f9 = s * 9;
      const n0 = cF[f9], n1 = cF[f9 + 1], n2 = cF[f9 + 2];
      const e10 = cF[f9 + 3], e11 = cF[f9 + 4], e12 = cF[f9 + 5];
      const e20 = cF[f9 + 6], e21 = cF[f9 + 7], e22 = cF[f9 + 8];
      const l0 = dx * n0 + dy * n1 + dz * n2;
      const l1 = dx * e10 + dy * e11 + dz * e12;
      const l2 = dx * e20 + dy * e21 + dz * e22;
      const l3 = px * n0 + py * n1 + pz * n2;
      const l4 = px * e10 + py * e11 + pz * e12;
      const l5 = px * e20 + py * e21 + pz * e22;
      const k0 = cK[r6], k1 = cK[r6 + 1], k2 = cK[r6 + 2], k3 = cK[r6 + 3], k4 = cK[r6 + 4], k5 = cK[r6 + 5];
      // Spring forces (what pulls b back towards a)
      // A pin or collar that has slid part way out holds from where it now is
      const a0 = l0 - cSlide[s];
      let o0 = k0 * a0, o1 = k1 * l1, o2 = k2 * l2, o3 = k3 * l3;
      const o4 = k4 * l4, o5 = k5 * l5;
      // A pin or shaft rattles loosely through its play, then bears stiffly
      const play = cPlay[s];
      if (play > 0) {
        const ax0 = Math.abs(a0), ax1 = Math.abs(l1), ax2 = Math.abs(l2);
        o0 = ax0 <= play ? PLAY_SOFT * o0 : Math.sign(a0) * k0 * (PLAY_SOFT * play + ax0 - play);
        o1 = ax1 <= play ? PLAY_SOFT * o1 : Math.sign(l1) * k1 * (PLAY_SOFT * play + ax1 - play);
        o2 = ax2 <= play ? PLAY_SOFT * o2 : Math.sign(l2) * k2 * (PLAY_SOFT * play + ax2 - play);
      }
      const type = cType[s];
      let pushing = true;
      let gripping = false;
      if (type) {
        // Only pressing together pushes back
        if (l0 >= 0) {
          o0 = 0;
          pushing = false;
        }
        if (type === 2) {
          // Faces pressed together grip by friction up to μ × how hard they press, then slide
          const st = s * 3;
          if (!pushing || o0 >= 0) {
            o1 = 0;
            o2 = 0;
            cState[st] = l1;
            cState[st + 1] = l2;
          } else {
            gripping = true;
            o1 = k1 * (l1 - cState[st]);
            o2 = k2 * (l2 - cState[st + 1]);
            const limit = -friction * o0;
            const mag = Math.sqrt(o1 * o1 + o2 * o2);
            if (mag > limit) {
              o1 *= limit / mag;
              o2 *= limit / mag;
              cState[st] = l1 - o1 / k1;
              cState[st + 1] = l2 - o2 / k2;
            }
          }
        }
      }
      // A motor lets its shaft turn past what it holds
      const hold = cHold[s];
      if (hold !== Infinity) {
        o3 -= k3 * cState[s * 3 + 2];
        if (Math.abs(o3) > hold) {
          const sg = Math.sign(o3);
          cState[s * 3 + 2] = l3 - (sg * hold) / k3;
          o3 = sg * hold;
        }
      }
      const mode = cMode[s];
      if (mode || traced) {
        const side = Math.sqrt(o1 * o1 + o2 * o2);
        if (traced?.[s]) trace.set(traced[s], { axial: o0, slideMm: cSlide[s] * 1000, side, rock: Math.sqrt(o4 * o4 + o5 * o5), loc: [l0, l1, l2, l3, l4, l5] });
        if (mode === 1) {
          // A collar slides once pushed harder than it grips, still gripping, and comes off only after
          // sliding the rest of its shaft
          const slip = cSlip[s];
          if (Math.abs(o0) > slip) {
            const sg = Math.sign(o0);
            cSlide[s] += (o0 - sg * slip) / k0;
            o0 = sg * slip;
            noteSlide(s);
          }
          const load = Math.abs(o0);
          if (load > peakLoadN) peakLoadN = load;
          noteUse(s, Math.max(load / slip, Math.abs(cSlide[s]) / cTravel[s]));
          if (Math.abs(cSlide[s]) >= cTravel[s]) {
            fail(s, 'slid off', slip, slip, 'N', { slidMm: Math.abs(cSlide[s]) * 1000 });
            continue;
          }
        } else if (mode === 2) {
          // Pulled harder than it grips, a pin starts to come out, gripping less the further it has slid;
          // it lets go only once it has slid out its whole seated depth, so a brief pull just loosens it.
          // Prying reaches a pin as pull through the face pads round it (the part pivots on its face edge
          // and stretches the pin); it counts as pried out when most of the pull comes from that tipping
          let pull = o0 > 0 ? o0 : 0;
          if (cPull[s] !== Infinity) {
            const hold = cPull[s] * Math.max(0, 1 - cSlide[s] / cTravel[s]);
            if (pull > hold) {
              cSlide[s] += (pull - hold) / k0;
              o0 = hold;
              pull = hold;
              noteSlide(s);
            }
          }
          const load = pull > side ? pull : side;
          if (load > peakLoadN) peakLoadN = load;
          const tPull = cPull[s] === Infinity ? 0 : pull / cPull[s];
          const tSide = cShear[s] === Infinity ? 0 : (side / cShear[s]) ** 2;
          noteUse(s, Math.max(tPull + tSide, cTravel[s] ? cSlide[s] / cTravel[s] : 0));
          const out = cTravel[s] && cSlide[s] >= cTravel[s];
          if (out || tSide >= 1) {
            const tipping = cLever[s] ? Math.sqrt(l4 * l4 + l5 * l5) * cLever[s] * k0 : 0;
            const detail = { pull, side, rock: Math.sqrt(o4 * o4 + o5 * o5), tipping, slidMm: cSlide[s] * 1000 };
            if (out) fail(s, tipping > 0.5 * cPull[s] ? 'pried out' : 'pulled out', cPull[s], cPull[s], 'N', detail);
            else fail(s, 'sheared', side, cShear[s], 'N', detail);
            continue;
          }
        }
      }
      // Damping, where the spring acts
      const lv0 = vx * n0 + vy * n1 + vz * n2;
      const lv1 = vx * e10 + vy * e11 + vz * e12;
      const lv2 = vx * e20 + vy * e21 + vz * e22;
      if (pushing) o0 += cC[r6] * lv0;
      if (type !== 2 || gripping) {
        o1 += cC[r6 + 1] * lv1;
        o2 += cC[r6 + 2] * lv2;
      }
      let m3 = o3, m4 = o4, m5 = o5;
      if (k3 || k4 || k5) {
        m3 += cC[r6 + 3] * (qx * n0 + qy * n1 + qz * n2);
        m4 += cC[r6 + 4] * (qx * e10 + qy * e11 + qz * e12);
        m5 += cC[r6 + 5] * (qx * e20 + qy * e21 + qz * e22);
      }
      // Back to world: force on b is −F, on a +F; turning likewise
      const Fx = o0 * n0 + o1 * e10 + o2 * e20;
      const Fy = o0 * n1 + o1 * e11 + o2 * e21;
      const Fz = o0 * n2 + o1 * e12 + o2 * e22;
      const Mx = m3 * n0 + m4 * e10 + m5 * e20;
      const My = m3 * n1 + m4 * e11 + m5 * e21;
      const Mz = m3 * n2 + m4 * e12 + m5 * e22;
      F[a3] += Fx; F[a3 + 1] += Fy; F[a3 + 2] += Fz;
      F[b3] -= Fx; F[b3 + 1] -= Fy; F[b3 + 2] -= Fz;
      T[a3] += rAy * Fz - rAz * Fy + Mx;
      T[a3 + 1] += rAz * Fx - rAx * Fz + My;
      T[a3 + 2] += rAx * Fy - rAy * Fx + Mz;
      T[b3] -= rBy * Fz - rBz * Fy + Mx;
      T[b3 + 1] -= rBz * Fx - rBx * Fz + My;
      T[b3 + 2] -= rBx * Fy - rBy * Fx + Mz;
    }
    // Gears: e = ratio · turn of a − turn of b, about their own axes
    for (const g of gears) {
      const a3 = g.a * 3;
      const b3 = g.b * 3;
      const pa = th[a3] * g.axisA.x + th[a3 + 1] * g.axisA.y + th[a3 + 2] * g.axisA.z;
      const pb = th[b3] * g.axisB.x + th[b3 + 1] * g.axisB.y + th[b3 + 2] * g.axisB.z;
      const e = g.ratio * pa - pb;
      const tb = g.k * e;
      const ta = -g.ratio * g.k * e;
      T[a3] += ta * g.axisA.x; T[a3 + 1] += ta * g.axisA.y; T[a3 + 2] += ta * g.axisA.z;
      T[b3] += tb * g.axisB.x; T[b3 + 1] += tb * g.axisB.y; T[b3 + 2] += tb * g.axisB.z;
    }
    // Floor: pushes up where a point is below it, never pulls
    let floorForce = 0;
    for (const ct of contacts) {
      const n3 = ct.node * 3;
      const y = ct.y0 + u[n3 + 1] + th[n3 + 2] * ct.rx - th[n3] * ct.rz;
      const pen = model.floorY - y;
      if (pen <= 0) continue;
      const vy = v[n3 + 1] + w[n3 + 2] * ct.rx - w[n3] * ct.rz;
      const fy = Math.max(0, ct.k * pen - ct.c * vy);
      if (fy <= 0) continue;
      floorForce += fy;
      ct.peak = Math.max(ct.peak || 0, fy);
      F[n3 + 1] += fy;
      T[n3] += -ct.rz * fy;
      T[n3 + 2] += ct.rx * fy;
    }
    if (floorForce > 0) lastContact = t;
    peakG = Math.max(peakG, floorForce / totalMass / GRAVITY);
    // Speeds first, then positions
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      const i9 = i * 9;
      v[i3] += (F[i3] / m[i]) * dt;
      v[i3 + 1] += (F[i3 + 1] / m[i]) * dt;
      v[i3 + 2] += (F[i3 + 2] / m[i]) * dt;
      // Matrix3 elements are column-major
      w[i3] += (Iinv[i9] * T[i3] + Iinv[i9 + 3] * T[i3 + 1] + Iinv[i9 + 6] * T[i3 + 2]) * dt;
      w[i3 + 1] += (Iinv[i9 + 1] * T[i3] + Iinv[i9 + 4] * T[i3 + 1] + Iinv[i9 + 7] * T[i3 + 2]) * dt;
      w[i3 + 2] += (Iinv[i9 + 2] * T[i3] + Iinv[i9 + 5] * T[i3 + 1] + Iinv[i9 + 8] * T[i3 + 2]) * dt;
      u[i3] += v[i3] * dt;
      u[i3 + 1] += v[i3 + 1] * dt;
      u[i3 + 2] += v[i3 + 2] * dt;
      th[i3] += w[i3] * dt;
      th[i3 + 1] += w[i3 + 1] * dt;
      th[i3 + 2] += w[i3 + 2] * dt;
    }
    t += dt;
    steps += 1;
    if (steps % 50 === 0) {
      let fastest = 0;
      for (let i = 0; i < v.length; i++) {
        const x = Math.abs(v[i]);
        if (!(x <= fastest)) fastest = x;
      }
      if (!(fastest < RUNAWAY_SPEED)) {
        const node = [...v].findIndex((x) => !(Math.abs(x) < RUNAWAY_SPEED));
        return { unsteady: true, steps, dt, t, node: Math.floor(node / 3), broken: [], peakUse: {}, slidMm: {}, peakG: 0, peakLoadN: 0, partVelocity: {}, partFlex: {}, floorPeak: {} };
      }
    }
    // How far each node has moved against the robot as a whole, at its most
    if (steps % 20 === 0) {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < N; i++) {
        cx += u[i * 3] * nodes[i].m;
        cy += u[i * 3 + 1] * nodes[i].m;
        cz += u[i * 3 + 2] * nodes[i].m;
      }
      cx /= totalMass; cy /= totalMass; cz /= totalMass;
      for (let i = 0; i < N; i++) flex[i] = Math.max(flex[i], Math.hypot(u[i * 3] - cx, u[i * 3 + 1] - cy, u[i * 3 + 2] - cz));
    }
    // Over once no joint's load has risen for a while (a long arm swings down well after the hit) and the
    // robot has left the floor, or stopped falling with the floor pressing at under twice its weight
    if (t >= minTime && t - lastRise >= SETTLED_TIME && steps % 20 === 0) {
      if (t - lastContact >= QUIET_TIME) break;
      let vy = 0;
      for (let i = 0; i < N; i++) vy += v[i * 3 + 1] * nodes[i].m;
      vy /= totalMass;
      if (vy > -0.05 * Math.max(speed, 0.1) && floorForce < 2 * totalMass * gravity) break;
    }
  }

  const peakUse = {};
  const slidMm = {}; // joints that slid part way out without letting go
  conns.forEach((c, s) => {
    if (c.joint && cUse[s] > 0) peakUse[c.joint.id] = Math.max(peakUse[c.joint.id] || 0, cUse[s]);
    if (c.joint && !cBroken[s] && Math.abs(cSlide[s]) > 1e-4) slidMm[c.joint.id] = Math.round(Math.abs(cSlide[s]) * 1e4) / 10;
  });
  const partVelocity = {};
  const partFlex = {};
  const sums = new Map();
  for (let i = 0; i < N; i++) {
    const p = nodes[i].part;
    const s = sums.get(p) || { m: 0, v: [0, 0, 0], w: [0, 0, 0], flex: 0 };
    const mi = nodes[i].m;
    s.m += mi;
    for (let k = 0; k < 3; k++) {
      s.v[k] += v[i * 3 + k] * mi;
      s.w[k] += w[i * 3 + k] * mi;
    }
    s.flex = Math.max(s.flex, flex[i]);
    sums.set(p, s);
  }
  for (const [p, s] of sums) {
    partVelocity[p] = { v: s.v.map((x) => x / s.m), w: s.w.map((x) => x / s.m) };
    partFlex[p] = s.flex;
  }
  // The hardest each part pressed on the floor (N)
  const floorPeak = {};
  for (const ct of contacts) if (ct.peak) floorPeak[ct.part] = (floorPeak[ct.part] || 0) + ct.peak;
  return { broken, peakUse, slidMm, peakG, peakLoadN, partVelocity, partFlex, floorPeak, durationMs: t * 1000, steps, dt, addedMassKg, totalMassKg: totalMass, nodeCount: N, springCount: conns.length };
}
