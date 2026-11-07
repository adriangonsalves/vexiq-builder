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
import { clearSpotAlongLine, insertFitsOpening, worldPartBox } from '../utils/pinHoleAlignment.js';
import { groupsOf } from '../utils/partGroups.js';
import { quaternionToEulerDeg } from '../utils/gearMeshing.js';

export const NEAR_ANGLE_DEG = 20; // axes this far apart can still be a pair
export const NEAR_LINE_MM = 4.5; // how far off its line a feature can be
export const NEAR_GAP_MM = 4; // how far apart along the line
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
function nearPairs(sideA, sideB) {
  const pairs = [];
  for (const a of sideA) {
    for (const b of sideB) {
      if (a.instanceId === b.instanceId) continue;
      const kind = pairKind(a, b);
      if (!kind) continue;
      const miss = missOf(a, b);
      if (miss.angle > NEAR_ANGLE_DEG || miss.line > NEAR_LINE_MM || miss.gap > NEAR_GAP_MM) continue;
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
 * { ok: true, pairs, movedParts } (the moving parts at their new poses) or { ok: false, reason, error }
 * with reason 'none' | 'disagree' | 'too-far' | 'done'.
 */
function fitMoving({ byId, catalogById, visible, moving, fixed, featuresOfSet, label }) {
  // 3. Every pair between the two sides near the selected part, moving feature first
  let pairs = nearPairs(featuresOfSet(moving), featuresOfSet(fixed)).map((p) => ({ m: p.a, f: p.b, kind: p.kind, done: p.done }));
  if (pairs.length === 0) {
    return { ok: false, reason: 'none', error: `No pins or holes near ${label} are nearly lined up with another part.` };
  }

  // 4. Line them all up: turn and move the moving side as one piece
  const movingInsts = [...moving].map((id) => byId.get(id));
  const centre = movingInsts.reduce((c, i) => c.add(new THREE.Vector3(...i.position)), new THREE.Vector3()).divideScalar(movingInsts.length);
  const keep = [[0, 0, 0], [60, 0, 0], [-60, 0, 0], [0, 60, 0], [0, -60, 0], [0, 0, 60], [0, 0, -60]].map((d) => centre.clone().add(new THREE.Vector3(...d)));
  // Pairs that disagree with the rest (a hole pattern nearly half a pitch off pairs both ways) are
  // dropped worst first until every pair is within OUTLIER_MM of its line
  let T = solveLines(pairs, keep);
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
    T = solveLines(pairs, keep);
  }
  T = squareUp(T, pairs, byId, centre) ?? T;
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
  const parallel = pairs.every((p) => Math.abs(p.f.axis.dot(axis)) >= PARALLEL_DOT);
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
  return { ok: true, pairs, movedParts: at(slide, axis) };

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
 * Lines up the selected part's block with the block it is nearly mated to (see file comment).
 * Returns { ok, state, record, stepLabel, message, moved: [ids], pairs } or { ok: false, error }.
 */
export function fixAssembly(state, { instanceId } = {}) {
  const { catalogById } = getCatalog();
  const instances = state.instances || [];
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const selected = byId.get(instanceId);
  if (!selected) return { ok: false, error: 'Select a part first.' };
  if (selected.visible === false) return { ok: false, error: `${selected.label} is hidden.` };
  const selectedPart = partOf(selected);
  if (!selectedPart) return { ok: false, error: `${selected.label} isn't in the part library.` };

  const graph = jointGraph(state);
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
  const firstPairs = nearPairs(featuresOfSet(ownIds), featuresOfSet(outside)).filter((p) => !p.done);
  if (firstPairs.length > 0) {
    const counts = new Map();
    for (const p of firstPairs) counts.set(blocks.get(p.b.instanceId), (counts.get(blocks.get(p.b.instanceId)) || 0) + 1);
    const partnerBlock = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    sideS = ownIds;
    sideP = new Set(blockIds(partnerBlock));
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

  // 2. Which side moves: the smaller, never one with a locked part
  const locked = (ids) => [...ids].some((id) => byId.get(id).locked);
  let moving = sideS.size <= sideP.size ? sideS : sideP;
  if (locked(moving)) moving = moving === sideS ? sideP : sideS;
  if (locked(moving)) return { ok: false, error: 'Both blocks have a locked part, so neither can be moved.' };
  let fixed = moving === sideS ? sideP : sideS;

  let fit = fitMoving({ byId, catalogById, visible, moving, fixed, featuresOfSet, label: selected.label });
  if (!fit.ok) return { ok: false, error: fit.error };

  // A fix that makes parts overlap that didn't before: try moving the other side (with the parts
  // joined to it) instead, and keep whichever side leaves fewer new overlaps
  let swapped = null; // { was: names of the side first tried, hits: its new overlaps }
  const hitsOf = (f) => newOverlaps(instances, byId, f.movedParts);
  const firstHits = hitsOf(fit);
  if (firstHits.size > 0) {
    // The other side's pieces: the parts held rigidly together with each part the pairs lined up with
    // (a claw, not the whole robot it hangs on), never one with a locked part. The piece that leaves
    // the fewest new overlaps wins, when that is fewer than moving the first side does.
    const bodies = buildBodyGraph(playInputs(state)).bodies;
    const tried = new Set();
    let best = null;
    for (const id of new Set(fit.pairs.map((p) => p.f.instanceId))) {
      const body = bodies.find((b) => b.parts.includes(id));
      const piece = new Set(body?.parts.filter((p) => fixed.has(p)));
      if (!body || tried.has(body.id) || piece.size === 0 || piece.size >= fixed.size || locked(piece)) continue;
      tried.add(body.id);
      const rest = new Set([...moving, ...[...fixed].filter((p) => !piece.has(p))]);
      const other = fitMoving({ byId, catalogById, visible, moving: piece, fixed: rest, featuresOfSet, label: selected.label });
      if (!other.ok) continue;
      const hits = hitsOf(other).size;
      if (hits < firstHits.size && (!best || hits < best.hits || (hits === best.hits && piece.size < best.piece.size))) best = { piece, rest, other, hits };
    }
    if (best) {
      swapped = { was: setName([...moving], byId, groupsOf(instances)), hits: [...firstHits] };
      [moving, fixed, fit] = [best.piece, best.rest, best.other];
    }
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
    (swapped ? ` (moving ${swapped.was} would have overlapped ${swapped.hits[0].split(' / ')[1]})` : '') +
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
