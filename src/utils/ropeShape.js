/**
 * The `rope` shape kind (openspec rope-and-spool, design decision 1): a rope copy run along a route.
 *
 *   shape = { kind: 'rope', ends: [end, end | null], via: [entry], spool: { end, turns, winding } | null,
 *             path: { points: [[x,y,z]...], radiusMm }, tabs: [{ position, quaternion } | null, ...],
 *             lengthMm, usedMm, slackMm, hangMm, short? }
 *
 * `path.points` is the cord's middle line (coils, runs, sag and a free end included) in the rope
 * copy's own frame, solved by src/utils/ropeRoute.js and saved with it, so drawing a rope needs
 * nothing but the rope itself. The mesh is a round cord swept along the path, with the rope part's
 * own moulded end tab (cut from its catalog mesh) at each held end.
 */
import * as THREE from 'three';
import { ROPE_KIND, isRopePart, ropeSpec } from './ropePath.js';

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const SIDES = 8;
const TAB_CUT_MM = 7.6; // the tab reaches this far from its hole toward the cord

function checkRope(shape) {
  if (!Array.isArray(shape.ends) || !shape.ends[0]) return 'A rope needs at least one held end.';
  if (!Array.isArray(shape.path?.points) || shape.path.points.length < 2) return 'A rope needs its path.';
  return null;
}

/** A round tube of radius r along the points (open ends). */
function tube(points, r) {
  const P = points.map(v3);
  const n = P.length;
  const pos = new Float32Array(n * SIDES * 3);
  const norm = new Float32Array(n * SIDES * 3);
  const idx = new Uint32Array(Math.max(0, n - 1) * SIDES * 6);
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const t = (i < n - 1 ? P[i + 1].clone().sub(P[i]) : P[i].clone().sub(P[i - 1])).normalize();
    if (i > 0 && i < n - 1) t.add(P[i].clone().sub(P[i - 1]).normalize()).normalize();
    // Carry the section's frame along the path so it doesn't twist
    let nn = prevN ? prevN.clone().addScaledVector(t, -prevN.dot(t)) : new THREE.Vector3().crossVectors(t, Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
    if (nn.lengthSq() < 1e-9) nn = new THREE.Vector3().crossVectors(t, new THREE.Vector3(1, 0, 0));
    nn.normalize();
    prevN = nn;
    const bb = new THREE.Vector3().crossVectors(t, nn);
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2;
      const d = nn.clone().multiplyScalar(Math.cos(a)).addScaledVector(bb, Math.sin(a));
      const o = (i * SIDES + k) * 3;
      pos[o] = P[i].x + d.x * r;
      pos[o + 1] = P[i].y + d.y * r;
      pos[o + 2] = P[i].z + d.z * r;
      norm[o] = d.x;
      norm[o + 1] = d.y;
      norm[o + 2] = d.z;
    }
  }
  let m = 0;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < SIDES; k++) {
      const a = i * SIDES + k;
      const b = i * SIDES + ((k + 1) % SIDES);
      const c = a + SIDES;
      const d = b + SIDES;
      idx[m++] = a;
      idx[m++] = c;
      idx[m++] = b;
      idx[m++] = b;
      idx[m++] = c;
      idx[m++] = d;
    }
  }
  return { pos, norm, idx };
}

/**
 * The triangles of one end tab, cut from the rope's catalog mesh, in the tab's frame: its hole at the
 * origin, its axis +z, its tip toward +x.
 */
function tabTriangles(pos, norm, idx, part, end) {
  const spec = ropeSpec(part);
  const H = v3(spec.holes[end]);
  const other = v3(spec.holes[1 - end]);
  const x = H.clone().sub(other).normalize();
  const z = new THREE.Vector3(0, 0, 1);
  const y = new THREE.Vector3().crossVectors(z, x);
  const toTab = new THREE.Matrix4().makeBasis(x, y, z).setPosition(H).invert();
  const rot = new THREE.Matrix3().setFromMatrix4(toTab);
  const tri = [];
  const p = new THREE.Vector3();
  const count = idx ? idx.length : pos.length / 3;
  for (let t = 0; t < count; t += 3) {
    const ids = idx ? [idx[t], idx[t + 1], idx[t + 2]] : [t, t + 1, t + 2];
    if (!ids.every((i) => (p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).sub(H).dot(x) >= -TAB_CUT_MM))) continue;
    for (const i of ids) {
      const a = new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).applyMatrix4(toTab);
      const nn = norm ? new THREE.Vector3(norm[i * 3], norm[i * 3 + 1], norm[i * 3 + 2]).applyMatrix3(rot).normalize() : new THREE.Vector3(0, 0, 1);
      tri.push([a, nn]);
    }
  }
  return tri;
}

/** The rope's mesh: the cord along its path and a tab at each held end. */
function ropeMesh(pos, norm, idx, shape, part) {
  const spec = ropeSpec(part) || { cordMm: 1.2 };
  const cord = tube(shape.path.points, shape.path.radiusMm || spec.cordMm / 2);
  const parts = [cord];
  (shape.tabs || []).forEach((t, end) => {
    if (!t || !pos?.length || !isRopePart(part)) return;
    const tri = tabTriangles(pos, norm, idx, part, end);
    if (!tri.length) return;
    const m = new THREE.Matrix4().compose(v3(t.position), new THREE.Quaternion(...t.quaternion), new THREE.Vector3(1, 1, 1));
    const rot = new THREE.Matrix3().setFromMatrix4(m);
    const P = new Float32Array(tri.length * 3);
    const N = new Float32Array(tri.length * 3);
    const I = new Uint32Array(tri.length);
    tri.forEach(([a, nn], k) => {
      const w = a.clone().applyMatrix4(m);
      const wn = nn.clone().applyMatrix3(rot).normalize();
      P.set([w.x, w.y, w.z], k * 3);
      N.set([wn.x, wn.y, wn.z], k * 3);
      I[k] = k;
    });
    parts.push({ pos: P, norm: N, idx: I });
  });
  return joinMeshes(parts);
}

/** Several { pos, norm, idx } meshes as one. */
function joinMeshes(parts) {
  const total = parts.reduce((s, q) => s + q.pos.length, 0);
  const totalI = parts.reduce((s, q) => s + q.idx.length, 0);
  const outP = new Float32Array(total);
  const outN = new Float32Array(total);
  const outI = new Uint32Array(totalI);
  let po = 0;
  let io = 0;
  for (const q of parts) {
    const base = po / 3;
    outP.set(q.pos, po);
    outN.set(q.norm, po);
    for (let k = 0; k < q.idx.length; k++) outI[io + k] = q.idx[k] + base;
    po += q.pos.length;
    io += q.idx.length;
  }
  return { pos: outP, norm: outN, idx: outI };
}

/**
 * The tab triangles of a drawn rope mesh (Play mode's redraw, which has no catalog mesh to cut tabs
 * from): triangles near one of `shape`'s tabs with a corner off the cord's line. Returns
 * [{ tab, P: [x,y,z × 3], N: [x,y,z × 3] }] in the rope's frame.
 */
export function ropeTabTriangles(pos, norm, idx, shape) {
  const tabs = (shape.tabs || []).map((t, k) => (t ? { k, at: v3(t.position) } : null)).filter(Boolean);
  if (!pos || !tabs.length) return [];
  const pts = shape.path.points.map(v3);
  const r = (shape.path.radiusMm || 0.6) + 0.25;
  const seg = new THREE.Line3();
  const tmp = new THREE.Vector3();
  const offCord = (p) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      seg.set(pts[i], pts[i + 1]);
      if (seg.closestPointToPoint(p, true, tmp).distanceTo(p) <= r) return false;
    }
    return true;
  };
  const out = [];
  const count = idx ? idx.length : pos.length / 3;
  const a = new THREE.Vector3();
  for (let t = 0; t + 2 < count; t += 3) {
    const ids = idx ? [idx[t], idx[t + 1], idx[t + 2]] : [t, t + 1, t + 2];
    const vs = ids.map((i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
    const c = vs.reduce((sum, v) => sum.add(v), a.set(0, 0, 0)).clone().divideScalar(3);
    const near = tabs.reduce((best, x) => (!best || x.at.distanceTo(c) < best.at.distanceTo(c) ? x : best), null);
    if (near.at.distanceTo(c) > 13 || !vs.some(offCord)) continue;
    out.push({ tab: near.k, P: vs.flatMap((v) => [v.x, v.y, v.z]), N: ids.flatMap((i) => (norm ? [norm[i * 3], norm[i * 3 + 1], norm[i * 3 + 2]] : [0, 0, 1])) });
  }
  return out;
}

/** A rope's mesh for a new path and tab poses: a new cord and `tabTris` (ropeTabTriangles of `oldShape`) moved to the new tabs. */
export function remeshRope(tabTris, oldShape, newShape) {
  const parts = [tube(newShape.path.points, newShape.path.radiusMm || 0.6)];
  const pose = (t) => new THREE.Matrix4().compose(v3(t.position), new THREE.Quaternion(...t.quaternion), new THREE.Vector3(1, 1, 1));
  const moves = (oldShape.tabs || []).map((t, k) => (t && newShape.tabs?.[k] ? pose(newShape.tabs[k]).multiply(pose(t).invert()) : null));
  const P = [];
  const N = [];
  const a = new THREE.Vector3();
  for (const tri of tabTris) {
    const m = moves[tri.tab];
    if (!m) continue;
    const rot = new THREE.Matrix3().setFromMatrix4(m);
    for (let k = 0; k < 3; k++) {
      a.set(tri.P[k * 3], tri.P[k * 3 + 1], tri.P[k * 3 + 2]).applyMatrix4(m);
      P.push(a.x, a.y, a.z);
      a.set(tri.N[k * 3], tri.N[k * 3 + 1], tri.N[k * 3 + 2]).applyMatrix3(rot).normalize();
      N.push(a.x, a.y, a.z);
    }
  }
  if (P.length) parts.push({ pos: new Float32Array(P), norm: new Float32Array(N), idx: Uint32Array.from({ length: P.length / 3 }, (_, k) => k) });
  return joinMeshes(parts);
}

function ropeBox(part, shape) {
  const box = new THREE.Box3();
  for (const p of shape.path.points) box.expandByPoint(v3(p));
  for (const t of shape.tabs || []) if (t) box.expandByPoint(v3(t.position).addScalar(6)).expandByPoint(v3(t.position).addScalar(-6));
  box.expandByScalar(shape.path.radiusMm || 0.6);
  const r = (n) => Number(n.toFixed(3)) + 0;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return { min: box.min.toArray().map(r), max: box.max.toArray().map(r), size: size.toArray().map(r), center: center.toArray().map(r) };
}

/** Mirrored across the rope's own plane perpendicular to `localAxis`. */
function mirrorRope(shape, localAxis) {
  const k = typeof localAxis === 'string' ? 'xyz'.indexOf(localAxis) : [0, 1, 2].reduce((best, i) => (Math.abs(localAxis[i]) > Math.abs(localAxis[best]) ? i : best), 0);
  const flip = (p) => p.map((c, i) => (i === k ? -c : c));
  const tabs = (shape.tabs || []).map((t) => {
    if (!t) return null;
    const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(...t.quaternion));
    const [x, y, z] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    m.extractBasis(x, y, z);
    const f = (v) => v3(flip(v.toArray()));
    // A tab is the same either side of its long middle: the mirrored y is turned back to keep a rotation
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f(x), f(y).negate(), f(z)));
    return { position: flip(t.position), quaternion: [q.x, q.y, q.z, q.w] };
  });
  return { ...shape, path: { ...shape.path, points: shape.path.points.map(flip) }, tabs, ...(shape.spool ? { spool: { ...shape.spool, winding: -shape.spool.winding } } : {}) };
}

function describeRope(shape) {
  const n = (shape.via || []).filter((s) => !s.auto).length;
  const used = shape.usedMm ? `${Math.round(shape.usedMm)} mm used` : '';
  const spare = shape.spool?.turns ? `${shape.spool.turns} turns on the spool` : shape.slackMm > 0.5 ? `${Math.round(shape.slackMm)} mm slack` : '';
  return [`${shape.ends[1] ? 'between two ends' : 'one end free'}${n ? `, over ${n} spot${n === 1 ? '' : 's'}` : ''}`, used, spare, shape.short ? `too short by ${Math.round(shape.short)} mm` : ''].filter(Boolean).join(', ');
}

export const ropeKind = {
  verb: 'Route',
  accepts: isRopePart,
  check: checkRope,
  shapeMesh: ropeMesh,
  shapePorts: () => [],
  shapeBox: ropeBox,
  mirror: mirrorRope,
  describe: describeRope
};

export { ROPE_KIND };
