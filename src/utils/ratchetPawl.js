import * as THREE from 'three';
import { angleAbout, refAxes } from './axisFrame.js';
import { findSeatedPairs } from './pinHoleAlignment.js';

/**
 * Ratchets and pawls (openspec ratchet-and-pawl, design §2–3). Pure: part metadata + world poses in,
 * relations and poses out, so placing, the audit, the assistant's tool and Play mode share one rule.
 *
 * A ratchet's measured teeth (`ratchetSpecs`, scripts/measure-part-geometry.mjs) lean one way: about
 * the ratchet's own +Z axis (its bore), `lean` is the turning direction a pawl stops. Its outline is
 * stored as radius against angle across one tooth (`profileMm`), from the steep side (at
 * `toothPhaseDeg` in the frame of refAxes) along the sloped side. A pawl's `tipPoint` is the point
 * that rests in the teeth; its holes run along its +Z.
 *
 * Contact is outline against outline in the ratchet's plane: the ratchet's outline is a closed shape
 * built from `profileMm` round all its teeth, with each steep side a real edge from the root point to
 * the crest point at the measured edge angle; the pawl's is its measured section (`outline`).
 *
 * A pawl holds a ratchet when its holes are parallel to the ratchet's shaft (within 2°), it overlaps
 * the tooth band along the shaft by at least 1 mm, and its tip sits between the root and tip circles
 * (within 0.5 mm). The ratchet turning the stopped way pushes the tip along A × r; the pawl catches
 * when that push points at the pawl's pin within 35° (the pawl is squeezed between tooth and pin).
 * Otherwise the push swings the pawl out: it faces the wrong way and holds nothing.
 */

export const PAWL_PARALLEL_MIN_DOT = Math.cos(THREE.MathUtils.degToRad(2));
export const PAWL_MIN_OVERLAP_MM = 1;
export const PAWL_RADIUS_GIVE_MM = 0.5;
export const PAWL_CATCH_MAX_DEG = 35;
// Pawl spots: the pawl may sit this far along the shaft from the middle of the tooth band
export const PAWL_SPOT_OFFSET_MAX_MM = 1.6;
const SWING_STEP_DEG = 0.2;
const SWING_BACK_STEP_DEG = 1; // backing out only needs to find a clear start
const TIP_CONTACT_MM = 1;
const SWING_BACK_MAX_DEG = 30; // how far back the swing may start to have the pawl clear // a first touch this close to the pawl's tip is the tip touching

const toVec = (v) => (v?.isVector3 ? v.clone() : new THREE.Vector3(...v));
const toQuat = (r) => {
  if (r?.isQuaternion) return r.clone();
  const e = new THREE.Euler(...r.map((d) => THREE.MathUtils.degToRad(d || 0)), 'XYZ');
  return new THREE.Quaternion().setFromEuler(e);
};
const mod = (x, m) => ((x % m) + m) % m;
const REF = refAxes(new THREE.Vector3(0, 0, 1)); // the angle frame about a part's +Z
const flat = (v, axis) => v.clone().addScaledVector(axis, -v.dot(axis));
const round3 = (x) => Math.round(x * 1000) / 1000 + 0;

export const isRatchet = (meta) => meta?.ratchetSpecs?.kind === 'ratchet';
export const isPawl = (meta) => meta?.ratchetSpecs?.kind === 'pawl';

/**
 * A ratchet in world space, or null. { kind: 'ratchet', instanceId, center, axis (its +Z), band:
 * [lo, hi] (along axis), teeth, tipRadius, rootRadius, lean, edgeDir (world direction of one steep
 * side), profile }.
 */
export function worldRatchet(meta, position, rotation, instanceId = null) {
  if (!isRatchet(meta)) return null;
  const s = meta.ratchetSpecs;
  const q = toQuat(rotation);
  const center = toVec(position);
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const [u, v] = refAxes(new THREE.Vector3(0, 0, 1));
  const r = THREE.MathUtils.degToRad(s.toothPhaseDeg);
  const edgeDir = u.multiplyScalar(Math.cos(r)).addScaledVector(v, Math.sin(r)).applyQuaternion(q);
  const t0 = center.dot(axis);
  return {
    kind: 'ratchet',
    instanceId,
    center,
    axis,
    quaternion: q,
    band: [t0 + s.faceSpanMm[0], t0 + s.faceSpanMm[1]],
    teeth: s.teeth,
    tipRadius: s.tipRadiusMm,
    rootRadius: s.rootRadiusMm,
    lean: s.lean,
    edgeDir,
    profile: s.profileMm,
    outline: ratchetOutline(s),
    inverse: q.clone().invert()
  };
}

const outlineCache = new WeakMap(); // ratchetSpecs -> closed outline in the part's XY plane

/**
 * A ratchet's outline as a closed shape in its own XY plane, anticlockwise about +Z: { xs, ys, angs
 * (deg, [0, 360), increasing) }. Star-shaped from the centre, so a ray from it meets one edge.
 */
export function ratchetOutline(specs) {
  if (outlineCache.has(specs)) return outlineCache.get(specs);
  const { teeth, toothPhaseDeg, lean, profileMm } = specs;
  const period = 360 / teeth;
  const n = profileMm.length;
  const along = lean === 0 ? 1 : -lean;
  const pts = [];
  for (let t = 0; t < teeth; t++) {
    const edge = toothPhaseDeg + t * period;
    for (let i = 0; i < n; i++) pts.push({ ang: edge + along * ((i + 0.5) / n) * period, r: profileMm[i] });
    if (lean !== 0) {
      // The steep side: the root just before the edge, the crest just after it
      pts.push({ ang: edge - along * 1e-4, r: profileMm[n - 1] });
      pts.push({ ang: edge + along * 1e-4, r: profileMm[0] });
    }
  }
  const [u, v] = refAxes(new THREE.Vector3(0, 0, 1));
  const sorted = pts.map((p) => ({ ...p, ang: mod(p.ang, 360) })).sort((a, b) => a.ang - b.ang);
  const out = { xs: [], ys: [], angs: [] };
  for (const p of sorted) {
    const r = THREE.MathUtils.degToRad(p.ang);
    out.xs.push(p.r * (Math.cos(r) * u.x + Math.sin(r) * v.x));
    out.ys.push(p.r * (Math.cos(r) * u.y + Math.sin(r) * v.y));
    out.angs.push(p.ang);
  }
  outlineCache.set(specs, out);
  return out;
}

/** Where a ray from the centre at `angDeg` (refAxes(+Z) frame) leaves the closed outline: its radius. */
function outlineRadius(o, angDeg) {
  const a = mod(angDeg, 360);
  const n = o.angs.length;
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (o.angs[m] <= a) lo = m + 1;
    else hi = m;
  }
  const i = (lo - 1 + n) % n;
  const j = (i + 1) % n;
  const [u, v] = REF;
  const r = THREE.MathUtils.degToRad(a);
  const dx = Math.cos(r) * u.x + Math.sin(r) * v.x;
  const dy = Math.cos(r) * u.y + Math.sin(r) * v.y;
  // The ray t·d meets the edge p_i + s·(p_j − p_i)
  const ex = o.xs[j] - o.xs[i];
  const ey = o.ys[j] - o.ys[i];
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return Math.hypot(o.xs[i], o.ys[i]);
  return (o.xs[i] * ey - o.ys[i] * ex) / den;
}

/** Angle (deg, refAxes(+Z) frame) of a point in the part's XY plane. */
const angleOfXY = (x, y) => THREE.MathUtils.radToDeg(Math.atan2(x * REF[1].x + y * REF[1].y, x * REF[0].x + y * REF[0].y));
/** Whether (x, y) in the ratchet's plane is inside its outline. */
const insideRatchet = (o, x, y) => Math.sqrt(x * x + y * y) < outlineRadius(o, angleOfXY(x, y));
/** A world point in the ratchet's own XY plane (z dropped). */
const toRatchetXY = (ratchet, p) => {
  const l = toVec(p).sub(ratchet.center).applyQuaternion(ratchet.inverse);
  return [l.x, l.y];
};

/**
 * A pawl in world space, or null. { kind: 'pawl', instanceId, position, quaternion, axis (its +Z,
 * along its holes), tip, tipNormal, thickness, span: [lo, hi] (along axis, about the tip's plane),
 * holes: [{ id, point }] (nearest the tip first) }.
 */
export function worldPawl(meta, position, rotation, instanceId = null) {
  if (!isPawl(meta)) return null;
  const s = meta.ratchetSpecs;
  const q = toQuat(rotation);
  const origin = toVec(position);
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const tip = toVec(s.tipPoint).applyQuaternion(q).add(origin);
  const portById = new Map((meta.ports || []).map((p) => [p.portId, p]));
  const holes = (s.holes || [])
    .map((id) => portById.get(id))
    .filter(Boolean)
    .map((p) => ({ id: p.portId, point: toVec(p.origin).applyQuaternion(q).add(origin) }));
  const t = tip.dot(axis);
  return {
    kind: 'pawl',
    instanceId,
    position: origin,
    quaternion: q,
    axis,
    tip,
    tipNormal: toVec(s.tipNormal).applyQuaternion(q),
    thickness: s.thicknessMm,
    span: [t - s.thicknessMm / 2, t + s.thicknessMm / 2],
    holes,
    outline: (s.outline || []).map(([x, y]) => new THREE.Vector3(x, y, s.tipPoint[2]))
  };
}

/** Signed angle (deg) from a to b about axis (both in the plane across it). */

/**
 * The ratchet's outline radius (mm) in world direction `dir` from its center (dir's part along the
 * axis ignored), on its closed outline.
 */
export function ratchetRadiusAt(ratchet, dir) {
  const d = toVec(dir).applyQuaternion(ratchet.inverse);
  if (Math.hypot(d.x, d.y) < 1e-9) return ratchet.rootRadius;
  return outlineRadius(ratchet.outline, angleOfXY(d.x, d.y));
}

/** The pawl's overlap (mm) with the ratchet's tooth band along the ratchet's axis. */
function bandOverlap(ratchet, pawl) {
  const t = pawl.tip.dot(ratchet.axis);
  const lo = t - pawl.thickness / 2;
  const hi = t + pawl.thickness / 2;
  return Math.min(hi, ratchet.band[1]) - Math.max(lo, ratchet.band[0]);
}

/**
 * How a pawl sits on a ratchet, or null when it isn't in the teeth (not parallel, not overlapping
 * the tooth band by 1 mm, or its tip outside [root − 0.5, tip + 0.5]). `pivots`: the lines the pawl
 * hangs on ([{ point, axis }], world), from the pins that join it to other parts; the push is
 * measured toward the single pivot, or toward the middle of the pawl's holes when there is none or
 * more than one. Returns { holds, freeSign, axis, wrongWay, tipDepthMm, gapMm, radiusMm, catchDeg,
 * pivot }: freeSign is the free turning direction about `axis` (the ratchet's +Z, right-hand rule),
 * 0 when it holds nothing; tipDepthMm how far inside the tip circle the tip is; gapMm the tip's
 * clearance above the outline (negative: pressed into a tooth).
 */
export function pawlRelation(ratchet, pawl, { pivots = [] } = {}) {
  if (!ratchet || !pawl) return null;
  const A = ratchet.axis;
  if (Math.abs(A.dot(pawl.axis)) < PAWL_PARALLEL_MIN_DOT) return null;
  if (bandOverlap(ratchet, pawl) < PAWL_MIN_OVERLAP_MM) return null;
  const r = flat(pawl.tip.clone().sub(ratchet.center), A);
  const R = r.length();
  if (R < ratchet.rootRadius - PAWL_RADIUS_GIVE_MM || R > ratchet.tipRadius + PAWL_RADIUS_GIVE_MM) return null;
  const pivot = pivots.length === 1 ? pivots[0] : null;
  const ref = pivot
    ? toVec(pivot.point)
    : pawl.holes.reduce((s, h) => s.add(h.point), new THREE.Vector3()).divideScalar(Math.max(1, pawl.holes.length));
  const toward = flat(ref.sub(pawl.tip), A).normalize();
  const tangent = new THREE.Vector3().crossVectors(A, r).normalize(); // a point at the tip moving anticlockwise about A
  let stopped = 0;
  let catchDeg = null;
  for (const s of ratchet.lean !== 0 ? [ratchet.lean] : [1, -1]) {
    const deg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(tangent.clone().multiplyScalar(s).dot(toward), -1, 1)));
    if (catchDeg === null || deg < catchDeg) catchDeg = deg;
    if (deg <= PAWL_CATCH_MAX_DEG) {
      stopped = s;
      catchDeg = deg;
      break;
    }
  }
  const holds = stopped !== 0;
  return {
    holds,
    freeSign: holds ? -stopped : 0,
    axis: A.clone(),
    wrongWay: !holds,
    tipDepthMm: round3(ratchet.tipRadius - R),
    gapMm: round3(R - ratchetRadiusAt(ratchet, r)),
    radiusMm: round3(R),
    catchDeg: Math.round(catchDeg * 10) / 10,
    pivot
  };
}

/** The pawl turned by `deg` about the world line through `point` along `axis`. */
export function turnPawl(pawl, axis, point, deg) {
  const a = axis.clone().normalize();
  const rad = THREE.MathUtils.degToRad(deg);
  const turn = (p) => p.clone().sub(point).applyAxisAngle(a, rad).add(point);
  return {
    ...pawl,
    position: turn(pawl.position),
    quaternion: new THREE.Quaternion().setFromAxisAngle(a, rad).multiply(pawl.quaternion),
    axis: pawl.axis.clone().applyAxisAngle(a, rad),
    tip: turn(pawl.tip),
    tipNormal: pawl.tipNormal.clone().applyAxisAngle(a, rad),
    holes: pawl.holes.map((h) => ({ ...h, point: turn(h.point) }))
  };
}

/**
 * The turn (deg, about the ratchet's axis through `pivot.point`) that swings the pawl's outline onto
 * the ratchet's outline, the tip touching first and the pawl holding; null when the tip can't reach
 * the teeth, the pawl's body reaches them first, or the pawl isn't parallel and in the tooth band.
 * The tip swings on a circle round the pivot; from each end of the arc where it is inside the tip
 * circle, the pawl is swung in until the two outlines first touch, and the nearer of the rests that
 * hold wins. The ratchet never turns. Returns { turnDeg, axis, point, relation }.
 */
export function pawlRestTurn(ratchet, pawl, pivot, { tipReachMm = TIP_CONTACT_MM } = {}) {
  if (!ratchet || !pawl || !pivot || !pawl.outline?.length) return null;
  const A = ratchet.axis;
  if (Math.abs(A.dot(pawl.axis)) < PAWL_PARALLEL_MIN_DOT) return null;
  if (bandOverlap(ratchet, pawl) < PAWL_MIN_OVERLAP_MM) return null;
  const o = ratchet.outline;
  const Rt = ratchet.tipRadius;
  // Everything in the ratchet's own plane, where turning about A is turning about +Z
  const [px, py] = toRatchetXY(ratchet, pivot.point);
  const local = pawl.outline.map((q) => toRatchetXY(ratchet, q.clone().applyQuaternion(pawl.quaternion).add(pawl.position)));
  const [tx, ty] = toRatchetXY(ratchet, pawl.tip);
  const D = Math.hypot(px, py);
  const L = Math.hypot(tx - px, ty - py);
  if (L < 1e-6 || D <= Rt) return null;
  const k = (Rt * Rt - D * D - L * L) / (2 * L * D);
  if (k < -1 || k > 1) return null;
  const gamma = THREE.MathUtils.radToDeg(Math.acos(k));
  // α: the tip's angle about the pivot from the pivot's own direction (away from the centre)
  const ccw = THREE.MathUtils.radToDeg(Math.atan2(px * (ty - py) - py * (tx - px), px * (tx - px) + py * (ty - py)));
  // The pawl's outline turned about the pivot, as flat coordinate arrays (reused: this runs thousands of times)
  const nP = local.length;
  const PX = new Float64Array(nP);
  const PY = new Float64Array(nP);
  const turnPts = (deg) => {
    const c = Math.cos(THREE.MathUtils.degToRad(deg));
    const sn = Math.sin(THREE.MathUtils.degToRad(deg));
    for (let i = 0; i < nP; i++) {
      const x = local[i][0] - px;
      const y = local[i][1] - py;
      PX[i] = px + x * c - y * sn;
      PY[i] = py + x * sn + y * c;
    }
  };
  const insidePawl = (x, y) => {
    let inside = false;
    for (let i = 0, j = nP - 1; i < nP; j = i++) {
      const yi = PY[i];
      const yj = PY[j];
      if (yi > y !== yj > y && x < ((PX[j] - PX[i]) * (y - yi)) / (yj - yi) + PX[i]) inside = !inside;
    }
    return inside;
  };
  // The ratchet's outline points the swinging pawl can ever cover: those within its reach of the pivot
  const swingReach = Math.max(...local.map(([x, y]) => Math.hypot(x - px, y - py))) + 0.01;
  const reachable = [];
  for (let i = 0; i < o.xs.length; i++) if (Math.hypot(o.xs[i] - px, o.ys[i] - py) <= swingReach) reachable.push(i);
  const Rt2 = Rt * Rt;
  /**
   * Where the outlines overlap at turn `deg`: the overlapping points (pawl's and ratchet's); with
   * `any`, stops at the first one.
   */
  const overlapAt = (deg, any = false) => {
    turnPts(deg);
    const hits = [];
    // No edge of the pawl comes inside the tip circle: no overlap
    let near = Infinity;
    for (let i = 0, j = nP - 1; i < nP; j = i++) {
      const ax = PX[j];
      const ay = PY[j];
      const ex = PX[i] - ax;
      const ey = PY[i] - ay;
      const t = Math.min(1, Math.max(0, -(ax * ex + ay * ey) / (ex * ex + ey * ey || 1)));
      const d = (ax + t * ex) ** 2 + (ay + t * ey) ** 2;
      if (d < near) near = d;
    }
    if (near > Rt2) return hits;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < nP; i++) {
      const x = PX[i];
      const y = PY[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x * x + y * y < Rt2 && insideRatchet(o, x, y)) {
        hits.push([x, y]);
        if (any) return hits;
      }
    }
    for (const i of reachable) {
      const x = o.xs[i];
      const y = o.ys[i];
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      if (insidePawl(x, y)) {
        hits.push([x, y]);
        if (any) return hits;
      }
    }
    return hits;
  };
  const tipAt = (deg) => {
    const c = Math.cos(THREE.MathUtils.degToRad(deg));
    const sn = Math.sin(THREE.MathUtils.degToRad(deg));
    return [px + (tx - px) * c - (ty - py) * sn, py + (tx - px) * sn + (ty - py) * c];
  };
  /** Swinging from tip angle `from` toward `to`: the last clear turn before first touch, if the tip touches first. */
  const rest = (from, to) => {
    const dir = Math.sign(to - from);
    // Start with the whole pawl clear of the ratchet, the tip swung back out past the tip circle
    let clear = from - ccw;
    let backed = 0;
    while (overlapAt(clear, true).length) {
      if ((backed += SWING_BACK_STEP_DEG) > SWING_BACK_MAX_DEG) return null; // the pawl lies across the teeth
      clear -= dir * SWING_BACK_STEP_DEG;
    }
    const end = to - ccw;
    let hit = null;
    for (let d = clear + dir * SWING_STEP_DEG; dir > 0 ? d <= end : d >= end; d += dir * SWING_STEP_DEG) {
      if (overlapAt(d, true).length) {
        hit = d;
        break;
      }
      clear = d;
    }
    if (hit === null) return null;
    for (let i = 0; i < 40; i++) {
      const m = (clear + hit) / 2;
      if (overlapAt(m, true).length) hit = m;
      else clear = m;
    }
    const [hx, hy] = tipAt(hit);
    const atTip = overlapAt(hit).every(([x, y]) => Math.hypot(x - hx, y - hy) <= tipReachMm);
    return atTip ? clear : null;
  };
  let best = null;
  for (const turnDeg of [rest(gamma, 360 - gamma), rest(360 - gamma, gamma)]) {
    if (turnDeg === null) continue;
    const t = ((turnDeg % 360) + 540) % 360 - 180;
    const relation = pawlRelation(ratchet, turnPawl(pawl, A, toVec(pivot.point), t), { pivots: [{ point: toVec(pivot.point), axis: A }] });
    if (!relation?.holds) continue;
    if (!best || Math.abs(t) < Math.abs(best.turnDeg)) best = { turnDeg: t, axis: A.clone(), point: toVec(pivot.point), relation };
  }
  return best;
}

/**
 * Where a pawl's hole could go beside a ratchet (design §3): world lines parallel to the ratchet's
 * axis, within the pawl's reach, from `neighbours` ([{ instanceId, label, features }], world features
 * of the other parts, the ratchet and the pawl itself left out):
 * - a pin hole with nothing in it, the pawl lying flat against the face of its part;
 * - a pin standing in a hole of another part, the pawl on the free part of its leg, as near the
 *   middle of the tooth band as it goes.
 * Either way the pawl's middle plane must be within PAWL_SPOT_OFFSET_MAX_MM of the band's middle.
 * Each: { point (on the pawl's middle plane), axis, instanceId, label, feature, kind: 'hole' | 'pin' }.
 */
export function pawlCandidates(ratchet, pawlMeta, neighbours) {
  if (!ratchet || !isPawl(pawlMeta)) return [];
  const A = ratchet.axis;
  const s = pawlMeta.ratchetSpecs;
  const T = s.thicknessMm;
  const bandMid = (ratchet.band[0] + ratchet.band[1]) / 2;
  const reach = Math.max(...pawlMeta.ports.filter((p) => s.holes.includes(p.portId)).map((p) => Math.hypot(s.tipPoint[0] - p.origin[0], s.tipPoint[1] - p.origin[1]))) + ratchet.tipRadius;
  const inReach = (f) => {
    if (Math.abs(f.axis.dot(A)) < PAWL_PARALLEL_MIN_DOT) return false;
    const d = flat(f.origin.clone().sub(ratchet.center), A).length();
    return d > ratchet.tipRadius && d <= reach;
  };
  const near = neighbours.map((n) => ({ ...n, features: n.features.filter(inReach) }));
  const all = near.flatMap((n) => n.features.map((f) => ({ f, n })));
  const pairs = [];
  for (const { f: a } of all) {
    for (const { f: b } of all) {
      if (a === b || a.instanceId === b.instanceId) continue;
      if (a.kind !== 'pin' || b.kind !== 'pin_hole') continue;
      const seated = findSeatedPairs([a], [b]);
      if (seated.length) pairs.push({ pin: a, hole: b });
    }
  }
  const range = (f) => {
    const a = f.start.dot(A);
    const b = f.end.dot(A);
    return [Math.min(a, b), Math.max(a, b)];
  };
  const pointAt = (f, t) => f.origin.clone().addScaledVector(A, t - f.origin.dot(A));
  const out = [];
  for (const { f, n } of all) {
    if (f.kind === 'pin_hole') {
      if (pairs.some((p) => p.hole === f)) continue; // a pin stands in it: the pin is the candidate
      const [lo, hi] = range(f);
      for (const mid of [hi + T / 2, lo - T / 2]) {
        if (Math.abs(mid - bandMid) > PAWL_SPOT_OFFSET_MAX_MM) continue;
        out.push({ point: pointAt(f, mid), axis: A.clone(), instanceId: n.instanceId, label: n.label, feature: f.featureId, kind: 'hole' });
      }
    } else if (f.kind === 'pin') {
      const holes = pairs.filter((p) => p.pin === f).map((p) => p.hole);
      if (!holes.length) continue; // not standing in another part's hole
      const [lo, hi] = range(f);
      // The free stretches of the leg, between the parts it is in
      const covered = holes.map(range).sort((x, y) => x[0] - y[0]);
      const free = [];
      let at = lo;
      for (const [a, b] of covered) {
        if (a > at) free.push([at, Math.min(a, hi)]);
        at = Math.max(at, b);
      }
      if (at < hi) free.push([at, hi]);
      for (const [a, b] of free) {
        if (b - a < T - 0.05) continue;
        const mid = THREE.MathUtils.clamp(bandMid, a + T / 2, Math.max(a + T / 2, b - T / 2));
        if (Math.abs(mid - bandMid) > PAWL_SPOT_OFFSET_MAX_MM) continue;
        out.push({ point: pointAt(f, mid), axis: A.clone(), instanceId: n.instanceId, label: n.label, feature: f.featureId, kind: 'pin' });
      }
    }
  }
  return out;
}

/**
 * The poses at which a pawl (`pawlMeta`) rests in the ratchet's teeth and holds, pinned at one of
 * the candidate lines beside it (pawlCandidates over `neighbours`). For each candidate, each of the
 * pawl's holes and both ways up, the pawl is put with that hole on the line and swung onto the teeth
 * (pawlRestTurn); poses that don't rest cleanly drop out. `blockedBy(position, quaternion)` gives the
 * labels of other parts a pose overlaps (the engine's overlap check). Spots are ordered by the angle
 * of the pawl's tip round the ratchet (anticlockwise about its axis, refAxes frame). Each: { index,
 * position: Vector3, quaternion, hole, flipped, candidate, relation, angleDeg, blocked, blockedBy }.
 */
export function pawlSpots(ratchet, pawlMeta, neighbours, { blockedBy = null } = {}) {
  if (!ratchet || !isPawl(pawlMeta)) return [];
  const A = ratchet.axis;
  const s = pawlMeta.ratchetSpecs;
  const portById = new Map((pawlMeta.ports || []).map((p) => [p.portId, p]));
  const found = [];
  for (const cand of pawlCandidates(ratchet, pawlMeta, neighbours)) {
    const P = toVec(cand.point);
    for (const holeId of s.holes || []) {
      const port = portById.get(holeId);
      if (!port) continue;
      const lever = Math.hypot(s.tipPoint[0] - port.origin[0], s.tipPoint[1] - port.origin[1]);
      const D = flat(P.clone().sub(ratchet.center), A).length();
      if (D > lever + ratchet.tipRadius) continue;
      for (const flipped of [false, true]) {
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), flipped ? A.clone().negate() : A.clone());
        // The hole's middle on the line: the pawl's middle plane on the candidate's
        const holeMid = toVec(port.origin).setZ(s.tipPoint[2]).applyQuaternion(q);
        const pawl = worldPawl(pawlMeta, P.clone().sub(holeMid), q);
        const rest = pawlRestTurn(ratchet, pawl, { point: P, axis: A });
        if (!rest) continue;
        const posed = turnPawl(pawl, A, P, rest.turnDeg);
        found.push({ position: posed.position, quaternion: posed.quaternion, hole: holeId, flipped, candidate: cand, relation: rest.relation, tip: posed.tip });
      }
    }
  }
  // The same pose reached twice is one spot
  const spots = [];
  for (const f of found) {
    if (spots.some((o) => o.position.distanceTo(f.position) < 0.05 && Math.abs(o.quaternion.dot(f.quaternion)) > 0.99999)) continue;
    spots.push(f);
  }
  for (const sp of spots) {
    sp.angleDeg = mod(angleAbout(A, sp.tip.clone().sub(ratchet.center)), 360);
    const by = blockedBy ? blockedBy(sp.position, sp.quaternion) : [];
    sp.blocked = by.length > 0;
    sp.blockedBy = by;
  }
  spots.sort((a, b) => a.angleDeg - b.angleDeg);
  return spots.map(({ tip, ...sp }, i) => ({ index: i + 1, ...sp, angleDeg: Math.round(sp.angleDeg * 100) / 100 }));
}

/**
 * The lines a pawl hangs on (openspec ratchet-and-pawl, design §2): a pin or peg seated in one of
 * its holes that joins it to another part (a pin seated in the pawl alone, such as a band post, holds
 * it to nothing); with none, a hole of another part lined up with one of the pawl's holes, face to
 * face. `instances` the visible parts at their poses; `partOf(inst)` → metadata; `featuresOf(inst)`
 * → world features. Returns [{ point, axis }], one per distinct line.
 */
export function pawlPivots({ pawlId, instances, partOf, featuresOf }) {
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const pawlInst = byId.get(pawlId);
  if (!pawlInst) return [];
  const cache = new Map();
  const featuresAt = (id) => {
    if (!cache.has(id)) cache.set(id, featuresOf(byId.get(id)) || []);
    return cache.get(id);
  };
  const otherIds = instances.filter((i) => i.instanceId !== pawlId && i.visible !== false).map((i) => i.instanceId);
  const own = featuresAt(pawlId);
  const others = otherIds.flatMap(featuresAt);
  const lines = [];
  const addLine = (f) => {
    if (!lines.some((l) => f.origin.clone().sub(l.point).cross(l.axis).length() < 0.5)) lines.push({ point: f.origin.clone(), axis: f.axis.clone() });
  };
  const joinsOther = new Map();
  const pinJoinsOther = (id) => {
    if (!joinsOther.has(id)) {
      const rest = otherIds.filter((o) => o !== id).flatMap(featuresAt);
      joinsOther.set(id, findSeatedPairs(featuresAt(id), rest).length > 0);
    }
    return joinsOther.get(id);
  };
  for (const p of findSeatedPairs(own, others)) {
    const pawlIsOpening = p.opening.instanceId === pawlId;
    const other = pawlIsOpening ? p.insert : p.opening;
    if (pawlIsOpening && partOf(byId.get(other.instanceId))?.category === 'Pins & Standoffs' && !pinJoinsOther(other.instanceId)) continue;
    addLine(pawlIsOpening ? p.opening : p.insert);
  }
  if (lines.length) return lines;
  const range = (f, axis) => [Math.min(f.start.dot(axis), f.end.dot(axis)), Math.max(f.start.dot(axis), f.end.dot(axis))];
  for (const f of own.filter((x) => x.kind === 'pin_hole')) {
    for (const g of others.filter((x) => x.kind === 'pin_hole' && Math.abs(x.axis.dot(f.axis)) > 0.9994)) {
      if (g.origin.clone().sub(f.origin).cross(f.axis).length() > 0.25) continue;
      const [a0, a1] = range(f, f.axis);
      const [b0, b1] = range(g, f.axis);
      if (Math.max(a0, b0) - Math.min(a1, b1) <= 0.5) addLine(f);
    }
  }
  return lines;
}

// A loose pawl this close to a ratchet (its box centre to the ratchet's centre) is in reach of Set pawl
export const SET_PAWL_REACH_MM = 60;

/**
 * What Set pawl would act on (Tools menu, the Join button, openspec ratchet-and-pawl "Set pawl"):
 * one pawl selected, and the ratchet selected with it or the only ratchet within SET_PAWL_REACH_MM.
 * `selectedIds`, `instances` (all parts), `partOf(inst)`. Returns { pawlId, ratchetId } or { reason }
 * (the greyed-out item's tip).
 */
export function setPawlTarget({ selectedIds, instances, partOf }) {
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const selected = selectedIds.map((id) => byId.get(id)).filter(Boolean);
  const pawls = selected.filter((i) => isPawl(partOf(i)));
  if (pawls.length !== 1) return { reason: pawls.length ? 'Select only one pawl.' : 'Select a pawl (the Short Low-Profile Pawl) first.' };
  const pawl = pawls[0];
  if (pawl.locked) return { reason: `${pawl.label} is locked.` };
  const ratchets = selected.filter((i) => isRatchet(partOf(i)));
  if (selected.length - 1 > ratchets.length) return { reason: 'Select just the pawl, or the pawl and its ratchet.' };
  if (ratchets.length > 1) return { reason: 'Select only one ratchet with the pawl.' };
  if (ratchets.length === 1) return { pawlId: pawl.instanceId, ratchetId: ratchets[0].instanceId };
  const meta = partOf(pawl);
  const q = toQuat(pawl.rotation);
  const centre = toVec(meta?.bbox?.center ?? [0, 0, 0]).applyQuaternion(q).add(toVec(pawl.position));
  const near = instances.filter((i) => i.visible !== false && i.instanceId !== pawl.instanceId && isRatchet(partOf(i)) && toVec(i.position).distanceTo(centre) <= SET_PAWL_REACH_MM);
  if (near.length === 1) return { pawlId: pawl.instanceId, ratchetId: near[0].instanceId };
  return { reason: near.length ? `${near.length} ratchets are near the pawl: select the one to set it on too.` : 'Move the pawl near a ratchet, or select the ratchet too.' };
}

/**
 * The ratchets a selected part shows an arrow on (openspec ratchet-and-pawl "Direction arrow"): for
 * a selected pawl, the ratchet it holds; for a selected ratchet, itself when a pawl holds it. Returns
 * [{ ratchetId, center, axis, radius, freeSign }] (world; freeSign about axis, right-hand rule).
 */
export function ratchetArrows({ selectedId, instances, partOf, featuresOf }) {
  const visible = instances.filter((i) => i.visible !== false);
  const sel = visible.find((i) => i.instanceId === selectedId);
  if (!sel) return [];
  const selMeta = partOf(sel);
  if (!isPawl(selMeta) && !isRatchet(selMeta)) return [];
  const pawls = isPawl(selMeta) ? [sel] : visible.filter((i) => isPawl(partOf(i)));
  const ratchets = isRatchet(selMeta) ? [sel] : visible.filter((i) => isRatchet(partOf(i)));
  const out = [];
  for (const r of ratchets) {
    const ratchet = worldRatchet(partOf(r), r.position, r.rotation, r.instanceId);
    for (const p of pawls) {
      const pawl = worldPawl(partOf(p), p.position, p.rotation, p.instanceId);
      // Cheap first: the tip must be in the teeth before the joins are worked out
      if (!pawlRelation(ratchet, pawl)) continue;
      const pivots = pawlPivots({ pawlId: p.instanceId, instances: visible, partOf, featuresOf });
      const rel = pawlRelation(ratchet, pawl, { pivots });
      if (!rel?.holds || pivots.length >= 2) continue;
      out.push({ ratchetId: r.instanceId, center: ratchet.center.clone(), axis: ratchet.axis.clone(), radius: ratchet.tipRadius, freeSign: rel.freeSign });
      break;
    }
  }
  return out;
}

/**
 * Whether the pawl `pawlId`, at its pose in `instances`, sits in a ratchet's teeth and holds it, hanging
 * on one pin: in the tooth band, its tip between the circles, facing the way that catches (openspec
 * ratchet-and-pawl, "A placed pawl swings onto its ratchet"). A pawl turned to rest while being pushed
 * on keeps that turn only where it lands like this. `partOf(inst)`, `featuresOf(inst)` as in pawlPivots.
 */
export function pawlHoldsAt({ pawlId, instances, partOf, featuresOf }) {
  const visible = instances.filter((i) => i.visible !== false);
  const p = visible.find((i) => i.instanceId === pawlId);
  if (!p || !isPawl(partOf(p))) return false;
  const pivots = pawlPivots({ pawlId, instances: visible, partOf, featuresOf });
  if (pivots.length !== 1) return false;
  const pawl = worldPawl(partOf(p), p.position, p.rotation, pawlId);
  return visible.some((r) => {
    const ratchet = worldRatchet(partOf(r), r.position, r.rotation, r.instanceId);
    return ratchet && pawlRelation(ratchet, pawl, { pivots })?.holds === true;
  });
}
