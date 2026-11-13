/**
 * Fix assembly (openspec easier-placing-and-fix-assembly): lines up two blocks of parts that are nearly
 * but not quite mated. Pins, pegs, shafts and holes of the selected part's block that are close to
 * matching features of another block (a few mm off their line, a few degrees tilted, or pressed in)
 * are paired, the smaller block is turned and moved as one piece so every pair shares a line, and then
 * slid along that line until it is seated without overlapping.
 */
import * as THREE from 'three';
import { buildWorldMatrix, checkCandidateCollision, getCatalog, jointGraph, partOf, playInputs, touchesAny, worldFeaturesFor } from './core.js';
import { buildBodyGraph } from '../sim/bodyGraph.js';
import { clearSpotAlongLine, findSeatedPairs, insertFitsOpening, worldPartBox } from '../utils/pinHoleAlignment.js';
import { groupsOf } from '../utils/partGroups.js';
import { quaternionToEulerDeg } from '../utils/gearMeshing.js';
import { layoutGearTrain, squareShaftInMotor } from '../utils/placementFit.js';

export const NEAR_ANGLE_DEG = 20; // axes this far apart can still be a pair
export const NEAR_LINE_MM = 4.5; // how far off its line a feature can be
export const NEAR_GAP_MM = 4; // how far apart along the line
const NEAR_LIMITS = { angle: NEAR_ANGLE_DEG, line: NEAR_LINE_MM, gap: NEAR_GAP_MM };
// After a pin goes in, holes this close are lined up too (openspec precise-placement)
export const AFTER_INSERT_LIMITS = { angle: 3, line: 1, gap: 4 };
const REGION_MM = 20; // pairs are looked for within the selected part's box grown by this much
const DONE_LINE_MM = 0.05; // a pair this close (and DONE_ANGLE_DEG) is already lined up
const DONE_ANGLE_DEG = 0.3;
const SAMPLE_MM = 3; // each pair's moving line is held by two points this far either side
const KEEP_WEIGHT = 1e-8; // weight of the points that keep what the pairs don't decide
const OUTLIER_MM = 0.2; // a pair left further off than this is dropped (the app counts 0.25 mm as lined up)
export const MAX_TURN_DEG = 25;
export const MAX_MOVE_MM = 10;
const CLEAR_REACH_MM = 4;
const SEAT_STEP_MM = 0.25;
const SEAT_MAX_MM = 15;
const ALREADY_TOUCHING_MM = 0.85; // the collision meshes are shrunk 0.38 mm each, so touching parts meet ~0.76 mm in
const PARALLEL_DOT = Math.cos(THREE.MathUtils.degToRad(2));

const isInsert = (kind) => kind === 'pin' || kind === 'shaft';

/** 'insert' (a pin/shaft and an opening it fits), 'hole' (two openings a shaft fits), or null. */
function pairKind(a, b) {
  if (isInsert(a.kind) && !isInsert(b.kind) && insertFitsOpening(a.kind, b.kind)) return 'insert';
  if (isInsert(b.kind) && !isInsert(a.kind) && insertFitsOpening(b.kind, a.kind)) return 'insert';
  if (!isInsert(a.kind) && !isInsert(b.kind) && insertFitsOpening('shaft', a.kind) && insertFitsOpening('shaft', b.kind)) return 'hole';
  return null;
}

const midOf = (f) => f.start.clone().add(f.end).multiplyScalar(0.5);
const span = (f, dir) => {
  const a = f.start.dot(dir);
  const b = f.end.dot(dir);
  return a <= b ? [a, b] : [b, a];
};
/** The point on the line (origin, axis) nearest `p`. */
const onLine = (p, origin, axis) => origin.clone().addScaledVector(axis, p.clone().sub(origin).dot(axis));

/** How far `a` is from lining up with `b`: { angle (deg), line (mm), gap (mm along b's axis) }. */
function missOf(a, b) {
  const angle = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(a.axis.dot(b.axis)))));
  const near = onLine(midOf(b), a.origin, a.axis);
  const line = near.distanceTo(onLine(near, b.origin, b.axis));
  const [aMin, aMax] = span(a, b.axis);
  const [bMin, bMax] = span(b, b.axis);
  return { angle, line, gap: Math.max(0, bMin - aMax, aMin - bMax) };
}

/** Every near pair between features `sideA` and `sideB` (lists of world features). */
function nearPairs(sideA, sideB, limits = NEAR_LIMITS) {
  const pairs = [];
  for (const a of sideA) {
    for (const b of sideB) {
      if (a.instanceId === b.instanceId) continue;
      const kind = pairKind(a, b);
      if (!kind) continue;
      const miss = missOf(a, b);
      if (miss.angle > limits.angle || miss.line > limits.line || miss.gap > limits.gap) continue;
      const done = miss.line <= DONE_LINE_MM && miss.angle <= DONE_ANGLE_DEG;
      pairs.push({ a, b, kind, done, cost: miss.line + miss.angle * 0.2 });
    }
  }
  // Each feature pairs once: pins and shafts in holes first, then the smallest miss
  pairs.sort((p, q) => (p.kind === q.kind ? p.cost - q.cost : p.kind === 'insert' ? -1 : 1));
  const used = new Set();
  const key = (f) => `${f.instanceId}:${f.featureId}`;
  return pairs.filter((p) => {
    if (used.has(key(p.a)) || used.has(key(p.b))) return false;
    used.add(key(p.a));
    used.add(key(p.b));
    return true;
  });
}

/** Blocks of parts: joined in the joint graph, or members of one group. Map<instanceId, blockIndex>. */
function blocksOf(state, graph) {
  const parent = new Map(graph.nodes.map((id) => [id, id]));
  const find = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  const join = (a, b) => {
    if (!parent.has(a) || !parent.has(b)) return;
    parent.set(find(a), find(b));
  };
  for (const [a, b] of graph.edges) join(a, b);
  for (const group of groupsOf(state.instances).values()) for (const id of group.ids.slice(1)) join(group.ids[0], id);
  const blocks = new Map();
  for (const id of graph.nodes) blocks.set(id, find(id));
  return blocks;
}

/** Ids reachable from `start` in the graph without passing through `without`. */
function reachable(graph, start, without, within) {
  const adj = new Map();
  for (const [a, b] of graph.edges) {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.pop();
    for (const next of adj.get(id) || []) {
      if (next === without || seen.has(next) || !within.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

// --- Rigid fit: Horn's quaternion method on weighted point pairs ---------------------------------

/** Eigenvector of the largest eigenvalue of a symmetric 4x4 matrix (cyclic Jacobi). */
function topEigenvector(m) {
  const a = m.map((row) => [...row]);
  const v = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-24) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [v[0][best], v[1][best], v[2][best], v[3][best]];
}

/** The turn and move (Matrix4) that best takes points `src` onto `dst`, weighted by `w`. */
function rigidFit(src, dst, w) {
  let total = 0;
  const cs = new THREE.Vector3();
  const cd = new THREE.Vector3();
  src.forEach((p, i) => {
    total += w[i];
    cs.addScaledVector(p, w[i]);
    cd.addScaledVector(dst[i], w[i]);
  });
  cs.divideScalar(total);
  cd.divideScalar(total);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  src.forEach((p, i) => {
    const a = p.clone().sub(cs).toArray();
    const b = dst[i].clone().sub(cd).toArray();
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += w[i] * a[r] * b[c];
  });
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz]
  ];
  const [qw, qx, qy, qz] = topEigenvector(N);
  const q = new THREE.Quaternion(qx, qy, qz, qw).normalize();
  const t = cd.clone().sub(cs.clone().applyQuaternion(q));
  return new THREE.Matrix4().compose(t, q, new THREE.Vector3(1, 1, 1));
}

/**
 * Point-to-line ICP: the turn and move (Matrix4) of the moving block that puts each pair's moving line
 * (`m`) on its fixed line (`f`), changing as little else as it can (`keep` points stay put).
 */
function solveLines(pairs, keep) {
  const samples = [];
  for (const { m, f } of pairs) {
    const c = onLine(midOf(f), m.origin, m.axis);
    samples.push({ p: c.clone().addScaledVector(m.axis, SAMPLE_MM), f });
    samples.push({ p: c.clone().addScaledVector(m.axis, -SAMPLE_MM), f });
  }
  const T = new THREE.Matrix4();
  const weights = [...samples.map(() => 1), ...keep.map(() => KEEP_WEIGHT)];
  for (let iter = 0; iter < 300; iter++) {
    const src = [];
    const dst = [];
    for (const s of samples) {
      const p = s.p.clone().applyMatrix4(T);
      src.push(p);
      dst.push(onLine(p, s.f.origin, s.f.axis));
    }
    for (const k of keep) {
      src.push(k.clone().applyMatrix4(T));
      dst.push(k);
    }
    const step = rigidFit(src, dst, weights);
    T.premultiply(step);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    step.decompose(pos, quat, new THREE.Vector3());
    if (pos.length() < 1e-7 && 2 * Math.acos(Math.min(1, Math.abs(quat.w))) < 1e-9) break;
  }
  return T;
}

/**
 * The slide along and turn about a fixed shaft line (`constraint`: { axis, point }, world) that best
 * puts each pair's moving line on its fixed line (openspec precise-placement): least squares in the
 * two numbers (slide mm, turn rad), relinearised a few times. Returns the Matrix4.
 */
function solveSlideTurn(pairs, constraint) {
  const a = constraint.axis.clone().normalize();
  const c = constraint.point.clone();
  const samples = [];
  for (const { m, f } of pairs) {
    const mid = onLine(midOf(f), m.origin, m.axis);
    samples.push({ p: mid.clone().addScaledVector(m.axis, SAMPLE_MM), f });
    samples.push({ p: mid.clone().addScaledVector(m.axis, -SAMPLE_MM), f });
  }
  const make = (s, theta) =>
    new THREE.Matrix4()
      .makeTranslation(-c.x, -c.y, -c.z)
      .premultiply(new THREE.Matrix4().makeRotationAxis(a, theta))
      .premultiply(new THREE.Matrix4().makeTranslation(c.x + a.x * s, c.y + a.y * s, c.z + a.z * s));
  const perp = (v, axis) => v.clone().sub(axis.clone().multiplyScalar(v.dot(axis)));
  let s = 0;
  let theta = 0;
  for (let iter = 0; iter < 20; iter++) {
    const T = make(s, theta);
    let jss = 1e-9;
    let jst = 0;
    let jtt = 1e-9;
    let rs = 0;
    let rt = 0;
    for (const { p, f } of samples) {
      const q = p.clone().applyMatrix4(T);
      const fa = f.axis.clone().normalize();
      const r = perp(q.clone().sub(f.origin), fa);
      const js = perp(a, fa);
      const jt = perp(a.clone().cross(q.clone().sub(c)), fa);
      jss += js.dot(js);
      jst += js.dot(jt);
      jtt += jt.dot(jt);
      rs += js.dot(r);
      rt += jt.dot(r);
    }
    const det = jss * jtt - jst * jst;
    const ds = -(jtt * rs - jst * rt) / det;
    const dt = -(jss * rt - jst * rs) / det;
    s += ds;
    theta += dt;
    if (Math.abs(ds) < 1e-7 && Math.abs(dt) < 1e-9) break;
  }
  return make(s, theta);
}

/** How far a pair's moving line is from its fixed line after `T` (mm, the worse of its two ends). */
function residual({ m, f }, T) {
  const c = onLine(midOf(f), m.origin, m.axis);
  return Math.max(
    ...[SAMPLE_MM, -SAMPLE_MM].map((d) => {
      const p = c.clone().addScaledVector(m.axis, d).applyMatrix4(T);
      return p.distanceTo(onLine(p, f.origin, f.axis));
    })
  );
}

const poseAfter = (inst, T) => {
  const matrix = buildWorldMatrix(inst.position, inst.rotation).premultiply(T);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  matrix.decompose(position, quaternion, new THREE.Vector3());
  return { position: position.toArray().map((v) => Number(v.toFixed(3)) + 0), rotation: quaternionToEulerDeg(quaternion) };
};

const moveFeature = (f, T) => {
  const origin = f.origin.clone().applyMatrix4(T);
  const start = f.start.clone().applyMatrix4(T);
  const end = f.end.clone().applyMatrix4(T);
  const axis = f.axis.clone().transformDirection(T);
  return { ...f, origin, start, end, axis };
};

const SQUARE_SNAP_DEG = 1.5; // a fit this close to square with its partner is made square
const SQUARE_FIT_MM = 0.1; // ... when every pair is still this close to its line,
const SQUARE_WORSE_MM = 0.06; // or no more than this further off than before

/** The 24 turns that keep a box's axes on axes. */
const SQUARE_TURNS = (() => {
  const turns = [];
  const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  for (const x of axes) {
    for (const sx of [1, -1]) {
      for (const y of axes) {
        if (y === x) continue;
        for (const sy of [1, -1]) {
          const X = x.clone().multiplyScalar(sx);
          const Y = y.clone().multiplyScalar(sy);
          const m = new THREE.Matrix4().makeBasis(X, Y, new THREE.Vector3().crossVectors(X, Y));
          turns.push(new THREE.Quaternion().setFromRotationMatrix(m));
        }
      }
    }
  }
  return turns;
})();

const quatOf = (inst) => new THREE.Quaternion().setFromRotationMatrix(buildWorldMatrix(inst.position, inst.rotation));

/**
 * CAD hole patterns are a little uneven, so a fit can come out a few hundredths of a degree off square
 * with the part it goes onto. When the moving part with the most pairs ends within SQUARE_SNAP_DEG of
 * square with the fixed part with the most pairs, and every pair still lines up within SQUARE_FIT_MM
 * (or SQUARE_WORSE_MM of how it lined up before) once it is made square and moved to fit, returns
 * that square fit. Otherwise null.
 */
function squareUp(T, pairs, byId, centre) {
  const most = (key) => {
    const counts = new Map();
    for (const p of pairs) counts.set(p[key].instanceId, (counts.get(p[key].instanceId) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  const qm = new THREE.Quaternion().setFromRotationMatrix(T).multiply(quatOf(byId.get(most('m'))));
  const qf = quatOf(byId.get(most('f')));
  const rel = qf.clone().invert().multiply(qm);
  const nearest = SQUARE_TURNS.reduce((best, q) => (q.angleTo(rel) < best.angleTo(rel) ? q : best));
  const off = THREE.MathUtils.radToDeg(nearest.angleTo(rel));
  if (off < 1e-6 || off > SQUARE_SNAP_DEG) return null;
  // The extra turn that makes it square, about the block's centre after T
  const fix = qf.clone().multiply(nearest).multiply(qm.clone().invert());
  const c = centre.clone().applyMatrix4(T);
  const turned = new THREE.Matrix4()
    .makeTranslation(-c.x, -c.y, -c.z)
    .premultiply(new THREE.Matrix4().makeRotationFromQuaternion(fix))
    .premultiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z))
    .multiply(T);
  // Then the move alone that best puts every pair's line on its line (least squares across the lines)
  const A = new THREE.Matrix3().set(1e-6, 0, 0, 0, 1e-6, 0, 0, 0, 1e-6);
  const b = new THREE.Vector3();
  for (const { m, f } of pairs) {
    const v = f.axis;
    const P = new THREE.Matrix3().set(1 - v.x * v.x, -v.x * v.y, -v.x * v.z, -v.y * v.x, 1 - v.y * v.y, -v.y * v.z, -v.z * v.x, -v.z * v.y, 1 - v.z * v.z);
    const p = onLine(midOf(f), m.origin, m.axis).applyMatrix4(turned);
    const d = onLine(p, f.origin, f.axis).sub(p);
    A.elements.forEach((_, i) => (A.elements[i] += P.elements[i]));
    b.add(d.applyMatrix3(P));
  }
  const t = b.applyMatrix3(A.clone().invert());
  const square = turned.clone().premultiply(new THREE.Matrix4().makeTranslation(t.x, t.y, t.z));
  return pairs.every((p) => residual(p, square) <= Math.max(SQUARE_FIT_MM, residual(p, T) + SQUARE_WORSE_MM)) ? square : null;
}

/** Name for a set of parts: its one part, its group, or its biggest part and how many more. */
function setName(ids, byId, groups) {
  if (ids.length === 1) return byId.get(ids[0]).label;
  const groupIds = new Set(ids.map((id) => byId.get(id).groupId));
  if (groupIds.size === 1 && groups.has([...groupIds][0])) {
    const group = groups.get([...groupIds][0]);
    if (group.ids.length === ids.length) return group.name;
  }
  const { catalogById } = getCatalog();
  const size = (id) => {
    const b = partOf(byId.get(id))?.bbox;
    return b ? (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]) : 0;
  };
  const biggest = [...ids].sort((a, b) => size(b) - size(a))[0];
  return `${byId.get(biggest).label} and ${ids.length - 1} more parts`;
}

/**
 * Lines up the `moving` side (a Set of ids) on the `fixed` side as one rigid piece and seats it (steps
 * 3-5 of fixAssembly). `featuresOfSet(ids)` gives the world features to pair (already limited to the
 * region looked at); `visible` the parts that can be overlapped. Saves nothing. Returns
 * { ok: true, pairs, movedParts, turnDeg } (the moving parts at their new poses) or { ok: false, reason,
 * error } with reason 'none' | 'disagree' | 'too-far' | 'done'. With `constraint` ({ axis, point }: a
 * shaft the moving side rides on), it only slides along and turns about that shaft.
 */
function fitMoving({ byId, catalogById, visible, moving, fixed, featuresOfSet, label, constraint = null, limits = NEAR_LIMITS, onlyPart = null }) {
  // 3. Every pair between the two sides near the selected part, moving feature first
  let pairs = nearPairs(featuresOfSet(moving), featuresOfSet(fixed), limits).map((p) => ({ m: p.a, f: p.b, kind: p.kind, done: p.done }));
  // Only pairs of `onlyPart` count as ones to line up (others already lined up still hold their place)
  if (onlyPart) pairs = pairs.filter((p) => p.done || p.m.instanceId === onlyPart || p.f.instanceId === onlyPart);
  if (pairs.length === 0 || (onlyPart && pairs.every((p) => p.done))) {
    return { ok: false, reason: 'none', error: `No pins or holes near ${label} are nearly lined up with another part.` };
  }

  // 4. Line them all up: turn and move the moving side as one piece
  const movingInsts = [...moving].map((id) => byId.get(id));
  const centre = movingInsts.reduce((c, i) => c.add(new THREE.Vector3(...i.position)), new THREE.Vector3()).divideScalar(movingInsts.length);
  const keep = [[0, 0, 0], [60, 0, 0], [-60, 0, 0], [0, 60, 0], [0, -60, 0], [0, 0, 60], [0, 0, -60]].map((d) => centre.clone().add(new THREE.Vector3(...d)));
  // Pairs that disagree with the rest (a hole pattern nearly half a pitch off pairs both ways) are
  // dropped worst first until every pair is within OUTLIER_MM of its line
  const solve = (list) => (constraint ? solveSlideTurn(list, constraint) : solveLines(list, keep));
  let T = solve(pairs);
  for (;;) {
    const worst = pairs.reduce((w, p) => {
      const r = residual(p, T);
      return r > w.r ? { p, r } : w;
    }, { p: null, r: OUTLIER_MM });
    if (!worst.p) break;
    pairs = pairs.filter((p) => p !== worst.p);
    if (pairs.length === 0) {
      return { ok: false, reason: 'disagree', error: `The pins and holes near ${label} don't agree on one way to line up. Move the parts closer first.` };
    }
    T = solve(pairs);
  }
  if (!constraint) T = squareUp(T, pairs, byId, centre) ?? T;
  const turnDeg = THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(new THREE.Quaternion().setFromRotationMatrix(T).w))));
  const moveMm = centre.clone().applyMatrix4(T).distanceTo(centre);
  if (turnDeg > MAX_TURN_DEG || moveMm > MAX_MOVE_MM) {
    return { ok: false, reason: 'too-far', error: `Lining these up would turn ${turnDeg.toFixed(0)}° and move ${moveMm.toFixed(1)} mm, too far for a fix. Move the parts closer first.` };
  }

  // 5. Seat it along the shared line: out of any overlap, or in until it touches
  const others = visible.filter((i) => !moving.has(i.instanceId));
  const posed = new Map(movingInsts.map((i) => [i.instanceId, poseAfter(i, T)]));
  const at = (d, axis) =>
    movingInsts.map((i) => {
      const p = posed.get(i.instanceId);
      return { ...i, position: p.position.map((v, k) => v + axis.getComponent(k) * d), rotation: p.rotation };
    });
  // Moving onto the pins stops at first contact, so tight fits count as touching here
  const isClearAt = (d, axis) => at(d, axis).every((c) => !touchesAny(c, others));
  const axis = pairs[0].f.axis.clone();
  // A side riding on a shaft only slides along that shaft
  const parallel = pairs.every((p) => Math.abs(p.f.axis.dot(axis)) >= PARALLEL_DOT) && (!constraint || Math.abs(constraint.axis.dot(axis)) >= PARALLEL_DOT);
  let slide = 0;
  if (parallel) {
    const moved = pairs.map((p) => ({ ...p, m: moveFeature(p.m, T) }));
    // Faces touching are only seen once the shrunk collision meshes meet (up to ~0.76 mm too deep):
    // from a contact at `d`, back off up to 0.95 mm to where a pair's faces sit a whole number of
    // quarter pitches apart, when that spot is clear (as inserting does)
    const QUARTER = 12.7 / 4;
    // The parts the moving side meets at `d`, as [movingId, otherId]. Pins and shafts only when nothing
    // else is met: a pin's collar often meets first, but its length isn't on the quarter-pitch steps
    const FASTENER_CATEGORIES = new Set(['Pins & Standoffs', 'Shafts, Spacers & Collars']);
    const touchingAt = (d) => {
      const met = at(d, axis).flatMap((c) => {
        const col = checkCandidateCollision(c, others);
        return [...col.collidingWith, ...col.tightFits].map((w) => [c.instanceId, w.instanceId]);
      });
      const isFastener = ([mId, fId]) => [mId, fId].some((id) => FASTENER_CATEGORIES.has(partOf(byId.get(id))?.category));
      const solid = met.filter((pair) => !isFastener(pair));
      return solid.length ? solid : met;
    };
    const onQuarter = (d, back, touching) => {
      const candidates = [];
      const boxSpan = (inst, matrix) => {
        const box = partOf(inst).bbox;
        let lo = Infinity;
        for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) lo = Math.min(lo, new THREE.Vector3(x, y, z).applyMatrix4(matrix).dot(axis));
        return lo;
      };
      // Part boxes of the parts that touch, not hole spans: a hole's measured face can sit recessed in
      // its part, and a pin's length isn't a whole number of quarter pitches
      for (const [mId, fId] of touching) {
        const mInst = byId.get(mId);
        const fInst = byId.get(fId);
        const pose = posed.get(mInst.instanceId);
        const rel = boxSpan(mInst, buildWorldMatrix(pose.position, pose.rotation)) - boxSpan(fInst, buildWorldMatrix(fInst.position, fInst.rotation)) + d;
        const r = ((rel % QUARTER) + QUARTER) % QUARTER;
        for (const shift of [-r, QUARTER - r]) if (shift * back >= -0.05 && shift * back <= 0.95) candidates.push(d + shift);
      }
      candidates.sort((a, b) => Math.abs(a - d) - Math.abs(b - d));
      return candidates.find((c) => isClearAt(c, axis)) ?? d;
    };
    if (!isClearAt(0, axis)) {
      const out = clearSpotAlongLine((d) => isClearAt(d, axis), CLEAR_REACH_MM);
      slide = out === null ? 0 : onQuarter(out, Math.sign(out) || 1, touchingAt(0));
    } else {
      // Toward the other side: where most pairs' fixed features lie
      let vote = 0;
      for (const p of moved) vote += Math.sign(midOf(p.f).sub(midOf(p.m)).dot(axis));
      const dir = axis.clone().multiplyScalar(vote < 0 ? -1 : 1);
      let travel = 0;
      let sweep = 0;
      for (const p of moved) {
        const [mMin, mMax] = span(p.m, dir);
        const [fMin, fMax] = span(p.f, dir);
        if (p.kind === 'hole') {
          travel = Math.max(travel, fMin - mMax);
          sweep = Math.max(sweep, fMin - mMax);
        } else if (isInsert(p.m.kind)) {
          travel = Math.max(travel, fMax - mMax);
          sweep = Math.max(sweep, fMax - mMin);
        } else {
          // The moving side holds the hole: the pin goes in the other way
          travel = Math.max(travel, -mMin + fMin);
          sweep = Math.max(sweep, -mMin + fMax);
        }
      }
      travel = Math.min(Math.max(travel, 0), SEAT_MAX_MM);
      sweep = Math.min(Math.max(sweep, travel), SEAT_MAX_MM);
      const sign = vote < 0 ? -1 : 1;
      let clear = 0;
      let blocked = null;
      for (let d = SEAT_STEP_MM; d <= sweep + 1e-6; d += SEAT_STEP_MM) {
        if (isClearAt(sign * d, axis)) clear = d;
        else {
          blocked = d;
          break;
        }
      }
      if (blocked !== null) {
        for (let i = 0; i < 5; i++) {
          const mid = (clear + blocked) / 2;
          if (isClearAt(sign * mid, axis)) clear = mid;
          else blocked = mid;
        }
        // Contact this soon is the shrunk meshes meeting: it was already touching
        slide = clear <= ALREADY_TOUCHING_MM ? 0 : onQuarter(sign * clear, -sign, touchingAt(sign * (blocked + 0.5)));
      } else {
        slide = sign * travel;
      }
    }
  }

  const unchanged = movingInsts.every((i) => {
    const p = posed.get(i.instanceId);
    return p.position.every((v, k) => Math.abs(v + axis.getComponent(k) * slide - i.position[k]) < 0.005) && p.rotation.every((r, k) => Math.abs(r - i.rotation[k]) < 0.01);
  });
  if (unchanged) return { ok: false, reason: 'done', error: `${label} is already lined up and seated.` };
  return { ok: true, pairs, movedParts: at(slide, axis), turnDeg };
}

/**
 * Gear meshes Play mode sees (openspec precise-placement): [{ gear, partner }] both ways round, from
 * the body graph's gear and rack links.
 */
function meshPairsOf(play) {
  const out = [];
  for (const l of play.links || []) {
    if ((l.kind !== 'gear' && l.kind !== 'rack') || !Array.isArray(l.gears) || l.gears.length !== 2) continue;
    out.push({ gear: l.gears[0], partner: l.gears[1] }, { gear: l.gears[1], partner: l.gears[0] });
  }
  return out;
}

/** The first mesh a set of parts would break by moving on its own: a gear in it meshed with one outside. */
const meshBrokenBy = (ids, meshes) => meshes.find((m) => ids.has(m.gear) && !ids.has(m.partner)) || null;

/**
 * Pieces of `side` (a Set of ids) that ride on a shaft through their round holes and can slide along
 * and turn about it without moving a meshed gear (openspec precise-placement): for each axle hinge
 * inside the side, the bodies on one side of it, when they hold no gear meshed with one outside them.
 * Returns [{ ids: Set, constraint: { axis, point }, hinge }].
 */
function slidePieces(play, side, meshes) {
  const bodyOf = new Map(play.bodies.map((b) => [b.id, b]));
  const inSide = (b) => b && b.parts.length > 0 && b.parts.every((p) => side.has(p));
  const hinges = play.hinges.filter((h) => inSide(bodyOf.get(h.a)) && inSide(bodyOf.get(h.b)));
  const pieces = [];
  const seen = new Set();
  for (const h of hinges) {
    if (h.kind !== 'axle') continue;
    for (const [from, other] of [[h.b, h.a], [h.a, h.b]]) {
      const reached = new Set([from]);
      const queue = [from];
      while (queue.length) {
        const cur = queue.pop();
        for (const g of hinges) {
          if (g === h) continue;
          const next = g.a === cur ? g.b : g.b === cur ? g.a : null;
          if (next && !reached.has(next)) {
            reached.add(next);
            queue.push(next);
          }
        }
      }
      if (reached.has(other)) continue; // joined round the hinge some other way: it can't slide
      const ids = new Set([...reached].flatMap((id) => bodyOf.get(id).parts));
      // Every part of the side that isn't in a body goes with neither piece; a piece with a meshed gear can't move
      if (ids.size === 0 || ids.size >= side.size || meshBrokenBy(ids, meshes)) continue;
      const key = [...ids].sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      pieces.push({ ids, hinge: h, constraint: { axis: new THREE.Vector3(...h.axis).normalize(), point: new THREE.Vector3(...h.point) } });
    }
  }
  return pieces;
}

/**
 * For a shaft or gear `instanceId` (openspec precise-placement): the gear train it belongs to laid out
 * again from its start (layoutGearTrain), gears moved onto holes and turned to mesh, beams and motors
 * never moved. Kept only when it changes something and makes no new overlap. Returns null or
 * { patches: [{ instanceId, position, rotation, isIntersecting, ... }], message, moved }.
 */
function trainLayout(state, instanceId) {
  const instances = (state.instances || []).filter((i) => i.visible !== false && partOf(i));
  const inst = instances.find((i) => i.instanceId === instanceId);
  if (!inst || !/gear|shaft/i.test(partOf(inst)?.category || '')) return null;
  const others = instances.filter((i) => i.instanceId !== instanceId);
  const touching = findSeatedPairs(worldFeaturesFor(inst), others.flatMap((i) => worldFeaturesFor(i))).map((p) => (p.insert.instanceId === instanceId ? p.opening.instanceId : p.insert.instanceId));
  const startIds = [instanceId, ...touching];
  const r = layoutGearTrain({ instances, startIds, partOf, featuresOf: worldFeaturesFor });
  if (!r.patches.length) return null;
  const byPatch = new Map(r.patches.map((p) => [p.instanceId, p]));
  const next = instances.map((i) => (byPatch.has(i.instanceId) ? { ...i, ...byPatch.get(i.instanceId) } : i));
  const patches = [];
  for (const p of r.patches) {
    const was = new Set(checkCandidateCollision(instances.find((i) => i.instanceId === p.instanceId), instances).collidingWith.map((w) => w.instanceId));
    const now = next.find((i) => i.instanceId === p.instanceId);
    const hits = checkCandidateCollision(now, next).collidingWith.filter((w) => !was.has(w.instanceId));
    if (hits.length) return null;
    const { isIntersecting } = checkCandidateCollision(now, next);
    patches.push({ ...p, isIntersecting, ...(isIntersecting ? {} : { lastValidPosition: [...p.position], lastValidRotation: [...p.rotation] }) });
  }
  return { patches, message: r.messages.join('. '), moved: r.moved };
}

/**
 * Every Smart Motor near `region` tilted off the shaft in its socket gets the shaft (and what's fixed
 * on it) turned square into it, the motor body staying (openspec precise-placement, squareShaftInMotor).
 * Returns { instances, squared: [{ motorId, shaftId, ids, message }], refused: [message] }.
 */
function squareMotors(instances, region) {
  const squared = [];
  const refused = [];
  let list = instances;
  for (const inst of instances) {
    if (inst.visible === false || !partOf(inst)?.hubSpecs) continue;
    const box = worldPartBox(partOf(inst), buildWorldMatrix(inst.position, inst.rotation));
    if (region && box && !box.intersectsBox(region)) continue;
    const visible = list.filter((i) => i.visible !== false && partOf(i));
    const r = squareShaftInMotor({ instances: visible, motorId: inst.instanceId, partOf, featuresOf: worldFeaturesFor });
    if (r?.refused) refused.push(r.refused);
    if (!r?.patches) continue;
    const byPatch = new Map(r.patches.map((p) => [p.instanceId, p]));
    list = list.map((i) => (byPatch.has(i.instanceId) ? { ...i, position: byPatch.get(i.instanceId).position, rotation: byPatch.get(i.instanceId).rotation } : i));
    squared.push({ motorId: inst.instanceId, shaftId: r.shaftId, ids: r.patches.map((p) => p.instanceId), message: r.message });
  }
  return { instances: list, squared, refused };
}


/**
 * The overlaps a move would make: `movedParts` (the moving side at its new poses) against everything
 * else, leaving out what they already overlapped before. A Set of "moved part / part it hits".
 */
function newOverlaps(instances, byId, movedParts) {
  const movedById = new Map(movedParts.map((c) => [c.instanceId, c]));
  const next = instances.map((i) => movedById.get(i.instanceId) || i);
  const hits = new Set();
  for (const c of movedParts) {
    const was = new Set(checkCandidateCollision(byId.get(c.instanceId), instances).collidingWith.map((w) => w.instanceId));
    for (const w of checkCandidateCollision(c, next).collidingWith) {
      if (!was.has(w.instanceId) && !movedById.has(w.instanceId)) hits.add(`${c.label} / ${w.label}`);
    }
  }
  return hits;
}

/**
 * Lines up the selected part's block with the block it is nearly mated to (see file comment). Smart
 * Motors near the part are squared on their shafts first (openspec precise-placement).
 * Returns { ok, state, record, stepLabel, message, moved: [ids], pairs } or { ok: false, error }.
 */
export function fixAssembly(state, { instanceId } = {}) {
  const result = fixWithMotors(state, { instanceId });
  if (result.ok) return result;
  // Nothing else could be fixed: a gear or shaft in a gear train has its train laid out again (gears
  // onto holes and meshed; beams and motors stay)
  const selected = (state.instances || []).find((i) => i.instanceId === instanceId);
  const laid = selected && selected.visible !== false && partOf(selected) ? trainLayout(state, instanceId) : null;
  if (!laid) return result;
  const byPatch = new Map(laid.patches.map((p) => [p.instanceId, p]));
  return {
    ok: true,
    record: true,
    stepLabel: `Fix assembly: laid out the gear train of ${selected.label}`,
    message: `${laid.message}.`,
    moved: laid.moved,
    pairs: 0,
    state: { ...state, instances: state.instances.map((i) => (byPatch.has(i.instanceId) ? { ...i, ...byPatch.get(i.instanceId) } : i)), updatedAt: new Date().toISOString() }
  };
}

function fixWithMotors(state, { instanceId } = {}) {
  const selected = (state.instances || []).find((i) => i.instanceId === instanceId);
  const part = selected && partOf(selected);
  if (!selected || selected.visible === false || !part) return fixBlocks(state, { instanceId });
  const region = worldPartBox(part, buildWorldMatrix(selected.position, selected.rotation)).expandByScalar(REGION_MM);
  const { instances, squared, refused } = squareMotors(state.instances, region);
  if (squared.length === 0) {
    const result = fixBlocks(state, { instanceId });
    // Say why a tilted motor's shaft was left as it is
    if (!refused.length) return result;
    return result.ok ? { ...result, message: `${result.message} ${refused.join('. ')}.` } : { ...result, error: `${result.error} ${refused.join('. ')}.` };
  }
  const squaredState = { ...state, instances };
  const squaredIds = new Set(squared.flatMap((s) => s.ids));
  const squaredText = squared.map((s) => s.message).join('. ');
  const result = fixBlocks(squaredState, { instanceId });
  if (result.ok) {
    return { ...result, message: `${squaredText}. ${result.message}`, moved: [...new Set([...squaredIds, ...result.moved])] };
  }
  const flagged = instances.map((i) => {
    if (!squaredIds.has(i.instanceId)) return i;
    const { isIntersecting } = checkCandidateCollision(i, instances);
    return { ...i, isIntersecting, ...(isIntersecting ? {} : { lastValidPosition: [...i.position], lastValidRotation: [...i.rotation] }) };
  });
  const quietReasons = new Set(['nothing', 'done']);
  return {
    ok: true,
    record: true,
    stepLabel: `Fix assembly: ${squaredText.charAt(0).toLowerCase()}${squaredText.slice(1)}`,
    message: `${squaredText}.${result.error && !quietReasons.has(result.reason) && !/no pins or holes/i.test(result.error) ? ` ${result.error}` : ''}`,
    moved: [...squaredIds],
    pairs: 0,
    state: { ...squaredState, instances: flagged, updatedAt: new Date().toISOString() }
  };
}

function fixBlocks(state, { instanceId, limits = NEAR_LIMITS, acrossOnly = false, onlyPart = null } = {}) {
  const { catalogById } = getCatalog();
  const instances = state.instances || [];
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const selected = byId.get(instanceId);
  if (!selected) return { ok: false, error: 'Select a part first.' };
  if (selected.visible === false) return { ok: false, error: `${selected.label} is hidden.` };
  const selectedPart = partOf(selected);
  if (!selectedPart) return { ok: false, error: `${selected.label} isn't in the part library.` };

  // Blocks are joined by pins, shafts and pegs in holes (and groups). Meshing gears and parts that only
  // touch don't join them (openspec precise-placement): a meshed gear never moves with the other side
  // anyway, and either would hide holes nearly lined up across a gear train or a part resting against another
  const play = buildBodyGraph(playInputs(state, { braceTolerance: false }));
  const meshes = meshPairsOf(play);
  const graph = jointGraph(state, { pinnedOnly: true });
  const blocks = blocksOf(state, graph);
  const visible = instances.filter((i) => i.visible !== false && blocks.has(i.instanceId));
  const region = worldPartBox(selectedPart, buildWorldMatrix(selected.position, selected.rotation)).expandByScalar(REGION_MM);
  const featureCache = new Map();
  const featuresOf = (id) => {
    if (!featureCache.has(id)) featureCache.set(id, worldFeaturesFor(byId.get(id)).filter((f) => region.containsPoint(midOf(f))));
    return featureCache.get(id);
  };
  const featuresOfSet = (ids) => [...ids].flatMap(featuresOf);
  const ownBlock = blocks.get(instanceId);
  const blockIds = (block) => visible.filter((i) => blocks.get(i.instanceId) === block).map((i) => i.instanceId);
  const nearby = visible.filter((i) => {
    const part = partOf(i);
    return part && worldPartBox(part, buildWorldMatrix(i.position, i.rotation))?.intersectsBox(region);
  });

  // 1. Another block nearly mated to the selected part's block
  let sideS = null;
  let sideP = null;
  const ownIds = new Set(blockIds(ownBlock));
  const outside = nearby.filter((i) => !ownIds.has(i.instanceId)).map((i) => i.instanceId);
  const firstPairs = nearPairs(onlyPart ? featuresOf(onlyPart) : featuresOfSet(ownIds), featuresOfSet(outside), limits).filter((p) => !p.done);
  if (firstPairs.length > 0) {
    const counts = new Map();
    for (const p of firstPairs) counts.set(blocks.get(p.b.instanceId), (counts.get(blocks.get(p.b.instanceId)) || 0) + 1);
    const partnerBlock = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    sideS = ownIds;
    sideP = new Set(blockIds(partnerBlock));
  } else if (acrossOnly) {
    return { ok: false, reason: 'nothing', error: `No other part's holes are nearly lined up with ${selected.label}.` };
  } else {
    // 2. Inside its own block: the selected part, and what hangs only off it, against the rest
    const others = [...ownIds].filter((id) => id !== instanceId);
    // Pairs already on their lines still say where the part may need seating along them
    const all = nearPairs(featuresOf(instanceId), featuresOfSet(others));
    const inner = all.some((p) => !p.done) ? all.filter((p) => !p.done) : all;
    if (inner.length === 0) {
      return { ok: false, error: `No pins or holes near ${selected.label} are nearly lined up with another part.` };
    }
    const counts = new Map();
    for (const p of inner) counts.set(p.b.instanceId, (counts.get(p.b.instanceId) || 0) + 1);
    const partner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // Group members stay together: a partner in the selected part's group can't be split off
    const groupOf = (id) => byId.get(id).groupId;
    if (groupOf(instanceId) && groupOf(instanceId) === groupOf(partner)) {
      return { ok: false, error: `${selected.label} and ${byId.get(partner).label} are in one group; ungroup them to fix how they fit.` };
    }
    sideP = reachable(graph, partner, instanceId, ownIds);
    sideS = new Set([...ownIds].filter((id) => !sideP.has(id)));
    if (sideS.size === 0 || [...sideS].some((id) => groupOf(id) && [...sideP].some((p) => groupOf(p) === groupOf(id)))) {
      return { ok: false, error: `${selected.label} can't be moved apart from ${byId.get(partner).label}: they are joined some other way too.` };
    }
  }

  // 2. Which side moves: the smaller, never one with a locked part. A side that would carry a gear out
  // of its mesh doesn't move as one piece (openspec precise-placement): the parts held rigidly with
  // what the pairs line up with on the other side, or parts riding on a shaft (sliding along it,
  // turning about it), move instead.
  const locked = (ids) => [...ids].some((id) => byId.get(id).locked);
  // A piece can't take part of a group with it
  const splitsGroup = (ids) => [...ids].some((id) => byId.get(id).groupId && instances.some((i) => i.groupId === byId.get(id).groupId && !ids.has(i.instanceId)));
  let moving = sideS.size <= sideP.size ? sideS : sideP;
  if (locked(moving)) moving = moving === sideS ? sideP : sideS;
  if (locked(moving)) return { ok: false, error: 'Both blocks have a locked part, so neither can be moved.' };
  let fixed = moving === sideS ? sideP : sideS;
  const hitsOf = (f) => newOverlaps(instances, byId, f.movedParts);
  // The other side's pieces: the parts held rigidly together with each part of `side` that `pairs` line
  // up with (a claw, not the whole robot it hangs on), never one with a locked part or a meshed gear
  const bodyPieces = (side, against, pairFeatures) => {
    const tried = new Set();
    const out = [];
    for (const id of new Set(pairFeatures.map((f) => f.instanceId))) {
      const body = play.bodies.find((b) => b.parts.includes(id));
      const piece = new Set(body?.parts.filter((p) => side.has(p)));
      if (!body || tried.has(body.id) || piece.size === 0 || piece.size >= side.size || locked(piece) || splitsGroup(piece) || meshBrokenBy(piece, meshes)) continue;
      tried.add(body.id);
      out.push({ ids: piece, rest: new Set([...against, ...[...side].filter((p) => !piece.has(p))]) });
    }
    return out;
  };
  // A piece split off a block keeps its joints to the rest: it may not change how deep any pin or peg in
  // them is seated (a connector pressed onto the beam it hangs on). A shaft through a round hole can
  // slide, so it doesn't count. True when `movedParts` (the piece `ids` at new poses) would.
  const SEAT_KEEP_MM = 0.1;
  const seatDepthChanged = (ids, movedParts) => {
    const movedById = new Map(movedParts.map((c) => [c.instanceId, c]));
    const pieceFeatures = [...ids].flatMap((id) => worldFeaturesFor(byId.get(id)));
    // Every part touching the piece, however far from the selected part (a motor's own shaft)
    const boxOf = (i) => worldPartBox(partOf(i), buildWorldMatrix(i.position, i.rotation));
    const pieceBoxes = [...ids].map((id) => boxOf(byId.get(id))?.expandByScalar(1)).filter(Boolean);
    const restFeatures = visible
      .filter((i) => !ids.has(i.instanceId) && partOf(i))
      .filter((i) => {
        const box = boxOf(i);
        return box && pieceBoxes.some((b) => b.intersectsBox(box));
      })
      .flatMap((i) => worldFeaturesFor(i));
    const movedFeatures = new Map();
    const movedFeature = (f) => {
      if (!movedFeatures.has(f.instanceId)) movedFeatures.set(f.instanceId, worldFeaturesFor(movedById.get(f.instanceId)));
      return movedFeatures.get(f.instanceId).find((g) => g.featureId === f.featureId);
    };
    for (const p of findSeatedPairs(pieceFeatures, restFeatures)) {
      const insertMoves = ids.has(p.insert.instanceId);
      if (!movedById.has((insertMoves ? p.insert : p.opening).instanceId)) continue;
      const ins = insertMoves ? movedFeature(p.insert) : p.insert;
      const op = insertMoves ? p.opening : movedFeature(p.opening);
      if (!ins || !op) continue;
      // Every kept joint stays on its line (a motor never leaves the shaft in its socket)
      if (findSeatedPairs([ins], [op]).length === 0) return true;
      if (p.insert.kind === 'shaft' && !p.opening.flatDir) continue;
      const before = p.insert.origin.clone().sub(p.opening.origin).dot(p.opening.axis);
      const after = ins.origin.clone().sub(op.origin).dot(op.axis);
      if (Math.abs(after - before) > SEAT_KEEP_MM) return true;
    }
    return false;
  };
  // Fewest new overlaps, then least turn, then fewest parts
  const better = (a, b) => !b || a.hits < b.hits || (a.hits === b.hits && (a.fit.turnDeg < b.fit.turnDeg - 0.01 || (Math.abs(a.fit.turnDeg - b.fit.turnDeg) <= 0.01 && a.ids.size < b.ids.size)));

  let fit = null;
  let swapped = null; // { was: name of the side first tried, why: what moving it would have done }
  const blockedBy = meshBrokenBy(moving, meshes);
  if (!blockedBy) {
    fit = fitMoving({ byId, catalogById, visible, moving, fixed, featuresOfSet, limits, onlyPart, label: selected.label });
    if (!fit.ok) return { ok: false, error: fit.error };
    // A fix that makes parts overlap that didn't before: try moving a piece of the other side instead,
    // and keep it when it leaves fewer new overlaps
    const firstHits = hitsOf(fit);
    if (firstHits.size > 0) {
      let best = null;
      for (const piece of bodyPieces(fixed, moving, fit.pairs.map((p) => p.f))) {
        const other = fitMoving({ byId, catalogById, visible, moving: piece.ids, fixed: piece.rest, featuresOfSet, limits, onlyPart, label: selected.label });
        if (!other.ok || seatDepthChanged(piece.ids, other.movedParts)) continue;
        const cand = { ...piece, fit: other, hits: hitsOf(other).size };
        if (cand.hits < firstHits.size && better(cand, best)) best = cand;
      }
      if (best) {
        swapped = { was: setName([...moving], byId, groupsOf(instances)), why: `would have overlapped ${[...firstHits][0].split(' / ')[1]}` };
        [moving, fixed, fit] = [best.ids, best.rest, best.fit];
      }
    }
  } else {
    const other = moving === sideS ? sideP : sideS;
    const near = nearPairs(featuresOfSet(moving), featuresOfSet(other), limits).filter((p) => !p.done && (!onlyPart || p.a.instanceId === onlyPart || p.b.instanceId === onlyPart));
    const candidates = [
      ...bodyPieces(other, moving, near.map((p) => p.b)),
      ...[moving, other].flatMap((side) =>
        slidePieces(play, side, meshes)
          .filter((p) => !locked(p.ids) && !splitsGroup(p.ids))
          .map((p) => ({ ids: p.ids, rest: side === moving ? other : moving, constraint: p.constraint }))
      )
    ];
    let best = null;
    let lastError = null;
    for (const c of candidates) {
      const f = fitMoving({ byId, catalogById, visible, moving: c.ids, fixed: c.rest, featuresOfSet, limits, onlyPart, label: selected.label, constraint: c.constraint || null });
      if (!f.ok) {
        if (f.reason !== 'none') lastError = f;
        continue;
      }
      if (seatDepthChanged(c.ids, f.movedParts)) continue;
      const cand = { ...c, fit: f, hits: hitsOf(f).size };
      if (better(cand, best)) best = cand;
    }
    if (!best) {
      if (lastError?.reason === 'done') return { ok: false, error: lastError.error };
      // Name what's out of line, by how much, and the gear that keeps it there
      const worst = near.map((p) => ({ p, miss: missOf(p.a, p.b) })).sort((x, y) => y.miss.line - x.miss.line)[0];
      const what = worst
        ? `${byId.get(worst.p.a.instanceId).label} is ${worst.miss.line.toFixed(2)} mm and ${worst.miss.angle.toFixed(1)}° out of line with ${byId.get(worst.p.b.instanceId).label}`
        : `${selected.label} is out of line`;
      return {
        ok: false,
        reason: 'meshed',
        error: `${what}. Nothing can move to line them up without taking ${byId.get(blockedBy.gear).label} out of mesh with ${byId.get(blockedBy.partner).label}.`
      };
    }
    swapped = { was: setName([...moving], byId, groupsOf(instances)), why: `would have taken ${byId.get(blockedBy.gear).label} out of mesh with ${byId.get(blockedBy.partner).label}` };
    [moving, fixed, fit] = [best.ids, best.rest, best.fit];
  }
  const { pairs } = fit;

  // 6. One step with the moved parts' overlap flags
  const movedParts = fit.movedParts.map((c) => ({ ...c, position: c.position.map((v) => Number(v.toFixed(3)) + 0) }));
  const movedById = new Map(movedParts.map((c) => [c.instanceId, c]));
  const nextInstances = instances.map((i) => movedById.get(i.instanceId) || i);
  const tight = new Set();
  for (const c of movedParts) {
    const { isIntersecting, tightFits } = checkCandidateCollision(c, nextInstances);
    for (const t of tightFits) tight.add(`${c.label} / ${t.label}`);
    c.isIntersecting = isIntersecting;
    if (!isIntersecting) {
      c.lastValidPosition = [...c.position];
      c.lastValidRotation = [...c.rotation];
    }
  }
  const finalInstances = instances.map((i) => movedById.get(i.instanceId) || i);
  const groups = groupsOf(instances);
  const movedName = setName([...moving], byId, groups);
  // The other side's part with the most pairs names it
  const fixedCounts = new Map();
  for (const p of pairs) fixedCounts.set(p.f.instanceId, (fixedCounts.get(p.f.instanceId) || 0) + 1);
  const ontoId = [...fixedCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const onto = byId.get(ontoId).label;
  const lined = pairs.length;
  const overlapping = movedParts.filter((c) => c.isIntersecting).map((c) => c.label);
  const message =
    `Lined up ${lined} pin${lined === 1 ? '' : 's'} and hole${lined === 1 ? '' : 's'}: moved ${movedName} onto ${onto}` +
    (swapped ? ` (moving ${swapped.was} ${swapped.why})` : '') +
    (overlapping.length ? ` (still overlapping: ${overlapping.join(', ')})` : '') +
    '.';
  return {
    ok: true,
    record: true,
    stepLabel: `Fix assembly: ${movedName} onto ${onto}`,
    message,
    isIntersecting: overlapping.length > 0,
    ...(tight.size ? { tightFits: [...tight] } : {}),
    moved: [...moving],
    pairs: lined,
    state: { ...state, instances: finalInstances, updatedAt: new Date().toISOString() }
  };
}

/**
 * After `instanceId` (a pin, peg, shaft or part carrying them) was put into a hole (openspec
 * precise-placement): when another block has a hole its pins, pegs or shafts nearly reach (within
 * AFTER_INSERT_LIMITS), lines the parts up by Fix assembly's rules (motors squared, meshed gears never
 * moved). The holes it just went into stay lined up, since its own block moves as one piece or stays.
 * Saves nothing. Returns null when there is nothing nearly lined up (or it already is), else
 * { patches: [{ instanceId, position, rotation, isIntersecting }], message, moved: [ids] } (no patches
 * and the reason when nothing may move).
 */
export function lineUpAfterInsert(state, { instanceId } = {}) {
  const instances = state.instances || [];
  const selected = instances.find((i) => i.instanceId === instanceId);
  const part = selected && partOf(selected);
  if (!selected || selected.visible === false || !part) return null;
  // A shaft or gear in a gear train: the train is laid out again, the beam never moving
  const laid = trainLayout(state, instanceId);
  if (laid) return laid;
  const opts = { instanceId, limits: AFTER_INSERT_LIMITS, acrossOnly: true, onlyPart: instanceId };
  // Is anything nearly lined up at all? (Motors are only squared when there is)
  const region = worldPartBox(part, buildWorldMatrix(selected.position, selected.rotation)).expandByScalar(REGION_MM);
  const { instances: squaredInstances, squared } = squareMotors(instances, region);
  const working = { ...state, instances: squaredInstances };
  const result = fixBlocks(working, opts);
  if (!result.ok && (result.reason === 'nothing' || !result.reason || /already lined up/.test(result.error || ''))) return null;
  if (!result.ok) return { patches: [], message: result.error, moved: [] };
  // Done by itself after an insert, it never leaves parts overlapping: nothing moves, and it says so
  if (result.isIntersecting) {
    const near = result.message.match(/onto (.+?)(?: \(|\.$)/)?.[1];
    return { patches: [], message: `${selected.label} is nearly lined up with ${near || 'another part'}, but lining them up would make parts overlap, so nothing else moved`, moved: [] };
  }
  const before = new Map(instances.map((i) => [i.instanceId, i]));
  const patches = [];
  for (const i of result.state.instances) {
    const was = before.get(i.instanceId);
    if (!was) continue;
    const same = i.position.every((v, k) => Math.abs(v - was.position[k]) < 1e-6) && i.rotation.every((v, k) => Math.abs(v - was.rotation[k]) < 1e-6);
    if (same) continue;
    const { isIntersecting } = checkCandidateCollision(i, result.state.instances);
    patches.push({ instanceId: i.instanceId, position: i.position, rotation: i.rotation, isIntersecting, ...(isIntersecting ? {} : { lastValidPosition: [...i.position], lastValidRotation: [...i.rotation] }) });
  }
  const squaredText = squared.map((s) => s.message.charAt(0).toLowerCase() + s.message.slice(1));
  const lined = result.message.replace(/^Lined up/, 'lined up').replace(/\.$/, '');
  return { patches, message: [...squaredText, lined].join(', '), moved: patches.map((p) => p.instanceId) };
}

/**
 * The release fit of a dragged set (openspec group-snapping): the set `ids`, at `poses` ({ [id]:
 * { position, rotation } }, where it was dropped, not saved yet), lined up and seated on the visible
 * parts outside it near it, with Fix assembly's rules. The set always moves, even when it is part of
 * a group. Saves nothing. Returns { ok: true, poses: { [id]: { position, rotation } }, pairs, onto }
 * or { ok: false, reason, error }.
 */
export function fitSet(state, { ids = [], poses = {} } = {}) {
  const { catalogById } = getCatalog();
  const instances = (state.instances || []).map((i) => (poses[i.instanceId] ? { ...i, ...poses[i.instanceId] } : i));
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const moving = new Set(ids.filter((id) => byId.has(id) && byId.get(id).visible !== false));
  if (moving.size === 0) return { ok: false, reason: 'none', error: 'Nothing to fit.' };
  const boxOf = (i) => {
    const part = partOf(i);
    return part ? worldPartBox(part, buildWorldMatrix(i.position, i.rotation)) : null;
  };
  const region = new THREE.Box3();
  for (const id of moving) {
    const box = boxOf(byId.get(id));
    if (box) region.union(box);
  }
  if (region.isEmpty()) return { ok: false, reason: 'none', error: 'Nothing to fit.' };
  region.expandByScalar(REGION_MM);
  const visible = instances.filter((i) => i.visible !== false && catalogById.has(i.partId));
  const fixed = new Set(visible.filter((i) => !moving.has(i.instanceId) && boxOf(i)?.intersectsBox(region)).map((i) => i.instanceId));
  if (fixed.size === 0) return { ok: false, reason: 'none', error: 'Nothing near to fit onto.' };
  const featureCache = new Map();
  const featuresOf = (id) => {
    if (!featureCache.has(id)) featureCache.set(id, worldFeaturesFor(byId.get(id)).filter((f) => region.containsPoint(midOf(f))));
    return featureCache.get(id);
  };
  const featuresOfSet = (set) => [...set].flatMap(featuresOf);
  const fit = fitMoving({ byId, catalogById, visible, moving, fixed, featuresOfSet, label: 'the set' });
  if (!fit.ok) return { ok: false, reason: fit.reason, error: fit.error };
  const fixedCounts = new Map();
  for (const p of fit.pairs) fixedCounts.set(p.f.instanceId, (fixedCounts.get(p.f.instanceId) || 0) + 1);
  const ontoId = [...fixedCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const out = {};
  for (const c of fit.movedParts) out[c.instanceId] = { position: c.position.map((v) => Number(v.toFixed(3)) + 0), rotation: c.rotation };
  return { ok: true, poses: out, pairs: fit.pairs.length, onto: byId.get(ontoId).label };
}
