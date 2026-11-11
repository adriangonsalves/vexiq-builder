/**
 * Rubber bands and belts (openspec rubber-bands): the band parts and their sizes, the spots a band can
 * go on, and the path a stretched band takes round a route. Pure (three.js maths only), so the app,
 * the MCP engine, Play mode and the node checks share it.
 *
 * A **spot** is one feature of one part, in that part's own frame:
 *   { feature, kind: 'post'|'groove'|'rim'|'gap'|'gaphook'|'edge'|'hook', label,
 *     shape: 'circle' | 'slot', center, axis, radius?, span: [lo, hi] along axis from center,
 *     radial? (slot: unit direction out from the part's axis) }
 * A circle is something round a band wraps (a standoff body, pin, shaft end, pulley groove, gear rim,
 * rounded beam end, a straight edge as a thin circle along it). A slot is a tooth gap the band passes
 * through (or is hooked in): a point that may slide along the part's axis across the face.
 * Spots the part data can't give come from src/utils/bandSpotTable.js (the Rubber Band Anchor's hook).
 *
 * A **route** is [{ instanceId, feature, side: 'out'|'in', wraps: 1..3, height?, cross? }] in loop
 * order; `cross` on a spot makes the run to the next spot cross over (a figure-8). The path is the
 * shortest loop that meets the route: straight runs between spots, curving round each circle on the
 * chosen side, through each slot, each post at the height along it that shortens the loop most.
 */
import * as THREE from 'three';
import { directionAt } from './axisFrame.js';
import { BAND_SPOT_TABLE } from './bandSpotTable.js';

export const BAND_KIND = 'band';

/**
 * Band and belt sizes measured from each part's own model (scripts/check-bands.mjs checks them):
 * free length round the middle of the unstretched ring, width along the post, thickness across.
 */
export const BAND_SPECS = {
  '228-2500-468': { freeMm: 184.1, widthMm: 3.15, thickMm: 2.0, name: '#32' },
  '228-2500-474': { freeMm: 181.0, widthMm: 6.3, thickMm: 1.0, name: 'Thin #64' },
  '228-2500-475': { freeMm: 184.1, widthMm: 6.3, thickMm: 2.0, name: '#64' },
  '228-2500-470': { freeMm: 354.4, widthMm: 6.3, thickMm: 1.5, name: '#117B' },
  '228-2500-1225': { freeMm: 94.2, widthMm: 2.0, thickMm: 2.0, name: '2x30 mm Square Silicone Belt' },
  '228-2500-221': { freeMm: 94.2, widthMm: 2.0, thickMm: 2.0, name: '2x30 mm Rubber Belt' },
  '228-2500-222': { freeMm: 125.7, widthMm: 2.0, thickMm: 2.0, name: '2x40 mm Rubber Belt' },
  '228-2500-223': { freeMm: 157.1, widthMm: 2.0, thickMm: 2.0, name: '2x50 mm Rubber Belt' },
  '228-2500-224': { freeMm: 188.5, widthMm: 2.0, thickMm: 2.0, name: '2x60 mm Rubber Belt' }
};

export const isBandPart = (part) => Boolean(part && BAND_SPECS[part.partNumber]);
export const bandSpec = (part) => (part ? BAND_SPECS[part.partNumber] || null : null);

/** Hand entries for spots the part data can't give (src/utils/bandSpotTable.js); setBandSpotTable replaces them. */
let extraSpots = BAND_SPOT_TABLE;
export function setBandSpotTable(table) {
  extraSpots = table?.parts || table || {};
  spotCache.clear();
}

const PITCH = 12.7;
const PIN_LEG_RADIUS = 2.1; // a pin's leg, where a band sits on it (catalog `cylinders`)
const v3 = (a) => (a?.isVector3 ? a.clone() : new THREE.Vector3(...a));
const arr = (v) => [v.x, v.y, v.z].map((n) => Number(n.toFixed(4)) + 0);

// ---------------------------------------------------------------------------------------------
// Spots on a part (its own frame)

const spotCache = new Map();

/** Every spot on a catalog part, in its own frame (cached per part id). */
export function partSpots(part) {
  if (!part) return [];
  if (spotCache.has(part.id)) return spotCache.get(part.id);
  const spots = findSpots(part);
  spotCache.set(part.id, spots);
  return spots;
}

/** A spot on a part by its feature id, or null. */
export function spotByFeature(part, feature) {
  return partSpots(part).find((s) => s.feature === feature) || null;
}

function findSpots(part) {
  if (isBandPart(part)) return [];
  const out = [];
  const f = part.fastenerSpecs;
  const g = part.gearSpecs;
  const halfXY = part.bbox ? Math.min(part.bbox.size[0], part.bbox.size[1]) / 2 : 3;

  if (f?.fastenerType === 'standoff') {
    // The round body between its shoulders
    const lo = Math.min(f.shoulderNegZ, f.shoulderPosZ);
    const hi = Math.max(f.shoulderNegZ, f.shoulderPosZ);
    if (hi - lo > 1) out.push(circle('post:body', 'post', 'standoff', [0, 0, 0], f.axis, halfXY, [lo, hi]));
  } else if (f?.fastenerType === 'connector_pin' || f?.fastenerType === 'pin' || f?.fastenerType === 'capped_pin') {
    const [lo, hi] = f.tipsZ || [-6, 6];
    out.push(circle('post:pin', 'post', 'pin', [0, 0, 0], f.axis, PIN_LEG_RADIUS, [lo, hi]));
  } else if (f && /shaft/.test(f.fastenerType || '')) {
    const [lo, hi] = f.usableSpanZ || [-(f.totalLengthMm || 10) / 2, (f.totalLengthMm || 10) / 2];
    out.push(circle('post:shaft', 'post', 'shaft end', [0, 0, 0], f.axis, Math.max(halfXY, 1.6), [lo, hi]));
  }

  if (g?.gearType === 'pulley' && g.pitchRadiusMm) {
    out.push(circle('groove', 'groove', 'groove', [0, 0, 0], g.boreAxis || [0, 0, 1], g.pitchRadiusMm, [-0.5, 0.5]));
  } else if (g?.teeth && g.tipRadiusMm && g.rootRadiusMm) {
    const axis = v3(g.boreAxis || [0, 0, 1]);
    const span = g.faceSpanMm || [-2.5, 2.5];
    out.push(circle('rim', 'rim', 'rim', [0, 0, 0], arr(axis), g.tipRadiusMm, span));
    const step = 360 / g.teeth;
    for (let k = 0; k < g.teeth; k++) {
      const dir = directionAt(axis, (g.gapPhaseDeg ?? step / 2) + k * step);
      const base = { center: [0, 0, 0], axis: arr(axis), radial: arr(dir), rootMm: g.rootRadiusMm, tipMm: g.tipRadiusMm, span, gap: k, shape: 'slot' };
      out.push({ feature: `gap:${k}`, kind: 'gap', label: `gap ${k}`, ...base });
      out.push({ feature: `gaphook:${k}`, kind: 'gaphook', label: `gap ${k} (hooked)`, ...base });
    }
  }

  if (!f && !g) out.push(...edgeSpots(part), ...boxEdgeSpots(part));
  for (const e of extraSpots[part.partNumber] || []) out.push({ shape: 'circle', span: [-1, 1], ...e });
  return out;
}

function circle(feature, kind, label, center, axis, radius, span) {
  return { feature, kind, label, shape: 'circle', center, axis: [...axis], radius, span: [...span] };
}

/**
 * Rounded ends and outer corners of beams, plates and brackets (a hole with neighbouring holes one
 * pitch away in at most one direction, or in two at right angles), and the two long edges of a
 * one-wide beam.
 */
function edgeSpots(part) {
  const holes = (part.ports || []).filter((p) => p.type === 'pin_hole' && p.axis && p.origin);
  if (!holes.length) return [];
  const out = [];
  const box = part.bbox;
  for (const h of holes) {
    const a = v3(h.axis).normalize();
    const o = v3(h.origin);
    const dirs = [];
    for (const n of holes) {
      if (n === h || Math.abs(v3(n.axis).normalize().dot(a)) < 0.999) continue;
      const d = v3(n.origin).sub(o);
      const along = d.dot(a);
      if (Math.abs(along) > 1) continue;
      d.addScaledVector(a, -along);
      if (Math.abs(d.length() - PITCH) > 0.6) continue;
      d.normalize();
      if (!dirs.some((x) => x.dot(d) > 0.9)) dirs.push(d);
    }
    const corner = dirs.length === 2 && Math.abs(dirs[0].dot(dirs[1])) < 0.2;
    if (!(dirs.length <= 1 || corner)) continue;
    if (dirs.length === 0 && holes.length > 1) continue; // a lone hole on a part with others (a boss): not an edge
    const thick = box ? Math.abs(box.size[0] * a.x) + Math.abs(box.size[1] * a.y) + Math.abs(box.size[2] * a.z) : 6.1;
    const mid = box ? v3(box.center).dot(a) - o.dot(a) : 0;
    out.push(circle(`edge:${h.portId}`, 'edge', corner ? 'corner' : 'end', arr(o), arr(a), 6.2, [mid - thick / 2, mid + thick / 2]));
  }
  // A straight beam or plate: a band can hook over its ends and long sides (round its whole
  // thickness: a circle of half its thickness along each outer edge)
  if (box && /\b(Beam|Plate)\b/.test(part.name || '') && !/Angle|Round|Curved|Offset|Corner|Bent|Convex|Concave/.test(part.name || '')) {
    const a = v3(holes[0].axis).normalize();
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const thickAxis = axes.reduce((best, x) => (Math.abs(x.dot(a)) > Math.abs(best.dot(a)) ? x : best));
    const others = axes.filter((x) => x !== thickAxis);
    const size = (x) => Math.abs(box.size[0] * x.x) + Math.abs(box.size[1] * x.y) + Math.abs(box.size[2] * x.z);
    const [longAxis, wideAxis] = size(others[0]) >= size(others[1]) ? others : [others[1], others[0]];
    const thick = size(thickAxis);
    const centre = v3(box.center);
    const L = size(longAxis);
    const W = size(wideAxis);
    for (const [dir, along, half, length, name] of [
      [wideAxis, longAxis, W / 2, L, 'side'],
      [longAxis, wideAxis, L / 2, W, 'end']
    ]) {
      for (const sgn of [1, -1]) {
        const c = centre.clone().addScaledVector(dir, sgn * (half - thick / 2));
        out.push(circle(`edge:${name}${sgn > 0 ? '+' : '-'}`, 'edge', name === 'side' ? 'long edge' : 'end edge', arr(c), arr(along), thick / 2, [-length / 2, length / 2]));
      }
    }
  }
  return out;
}

/**
 * The twelve edges of a part's box, as thin circles along them: a band going round a part with no
 * better spot (a corner connector's block) wraps these. `hidden`: used when the Band builder routes a
 * band round a part in its way, never offered for picking.
 */
function boxEdgeSpots(part) {
  const box = part.bbox;
  if (!box) return [];
  const out = [];
  const lo = box.min;
  const hi = box.max;
  for (let ax = 0; ax < 3; ax++) {
    const [u, w] = [0, 1, 2].filter((i) => i !== ax);
    const axis = [0, 0, 0];
    axis[ax] = 1;
    const half = (hi[ax] - lo[ax]) / 2;
    for (const su of [lo, hi]) {
      for (const sw of [lo, hi]) {
        const c = [0, 0, 0];
        c[ax] = (lo[ax] + hi[ax]) / 2;
        c[u] = su[u];
        c[w] = sw[w];
        out.push({ feature: `box:${'xyz'[ax]}${su === lo ? '-' : '+'}${sw === lo ? '-' : '+'}`, kind: 'edge', label: 'box edge', shape: 'circle', center: c, axis, radius: 0.5, span: [-half, half], hidden: true });
      }
    }
  }
  return out;
}

/** A spot in world space from its part's pose (`matrix`: THREE.Matrix4). */
export function worldSpot(spot, matrix) {
  const q = new THREE.Quaternion().setFromRotationMatrix(matrix);
  const out = { ...spot, center: v3(spot.center).applyMatrix4(matrix), axis: v3(spot.axis).applyQuaternion(q).normalize() };
  if (spot.radial) out.radial = v3(spot.radial).applyQuaternion(q).normalize();
  return out;
}

// ---------------------------------------------------------------------------------------------
// The path round a route

const TWO_PI = Math.PI * 2;
const modTwoPi = (x) => ((x % TWO_PI) + TWO_PI) % TWO_PI;

/** A unit vector perpendicular to `a`, and the third axis. */
function planeAxes(a) {
  const u = new THREE.Vector3().crossVectors(a, Math.abs(a.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
  return [u, new THREE.Vector3().crossVectors(a, u)];
}

/**
 * The shortest loop through `elements` (world spots in route order, each with side, wraps, cross and
 * optionally `spanLimit`: the free stretch of the post the band may slide along, `key`: what makes
 * two elements the same spot, `layer`: band thicknesses already on it), for a band
 * `thickMm` thick and `widthMm` wide. Returns { points, ups, lengthMm, contacts, rounds } where
 * `points` is the band's middle line (closed: the last point joins the first), `ups` the width
 * direction at each point, and `contacts` per element { a, b, height, wrapRad }.
 */
export function solveBandPath(elements, opts = {}) {
  let first = solveOnce(elements, opts);
  if (!first) return first;
  // A band there and back between two hooks (its spots A, m1..mk, B, mk..m1) may go round each hook
  // either way; one pairing crosses its two strands over each other, which is longer. Keep the way
  // round the hooks that leaves the band shortest (uncrossed).
  const hooks = foldHooks(first.keys, elements);
  if (hooks) {
    for (const i of hooks) {
      const e = elements[i];
      if (e.shape === 'slot' || e.wrapDir || e.cross) continue;
      const turns = first.turns.slice();
      turns[i] = -turns[i];
      const other = solveOnce(elements, { ...opts, turns });
      if (other && other.lengthMm < first.lengthMm - 0.01) first = other;
    }
  }
  // A spot the band passes twice at one height (out and back): the later pass lies on the first,
  // one band thickness further out
  const widthMm = opts.widthMm ?? 3;
  const passes = new Map();
  const layered = elements.map((e, i) => {
    const key = first.keys[i];
    const before = (passes.get(key) || []).filter((h) => Math.abs(h - first.contacts[i].height) < widthMm).length;
    passes.set(key, [...(passes.get(key) || []), first.contacts[i].height]);
    return before ? { ...e, layer: (e.layer || 0) + before } : e;
  });
  return layered.some((e, i) => e !== elements[i]) ? solveOnce(layered, { ...opts, turns: first.turns }) : first;
}

/**
 * For a band there and back: the indices of its two hooks (the only posts, grooves or hooks on its
 * route, each once; the rest are edges and corners it bends round), else null.
 */
function foldHooks(keys, elements) {
  const hooks = [];
  elements.forEach((e, i) => {
    if (e.kind === 'post' || e.kind === 'groove' || e.kind === 'hook') hooks.push(i);
  });
  if (hooks.length !== 2 || keys[hooks[0]] === keys[hooks[1]]) return null;
  return hooks;
}

function solveOnce(elements, opts = {}) {
  const { thickMm = 1.5, widthMm = 3, maxRounds = 200, tolMm = 0.005, arcStepDeg = 4 } = opts;
  const n = elements.length;
  if (n < 2) return null;
  const els = elements.map((e) => {
    const axis = v3(e.axis).normalize();
    const [u, v] = planeAxes(axis);
    const span = e.spanLimit || e.span || [0, 0];
    const base = { ...e, axis, u, v, c: v3(e.center), lo: Math.min(...span), hi: Math.max(...span), wraps: Math.max(1, Math.min(3, Math.round(e.wraps || 1))) };
    if (e.shape === 'slot') {
      const radial = v3(e.radial).normalize();
      base.R = (e.rootMm ?? 0) + thickMm / 2;
      base.radialDir = radial;
    } else {
      base.R = (e.radius || 0) + thickMm / 2;
    }
    base.key = e.key ?? `${arr(v3(e.center))}|${arr(v3(e.axis))}|${e.feature ?? ''}`;
    base.h = Math.min(base.hi, Math.max(base.lo, 0));
    return base;
  });

  for (const e of els) if (e.layer) e.R += e.layer * thickMm;

  // Starting contacts: each element's middle
  const pointOf = (e, h, theta) => e.c.clone().addScaledVector(e.axis, h).addScaledVector(e.u, e.R * Math.cos(theta)).addScaledVector(e.v, e.R * Math.sin(theta));
  const slotPoint = (e, h) => e.c.clone().addScaledVector(e.axis, h).addScaledVector(e.radialDir, e.R);
  const contacts = els.map((e) => {
    const p = e.shape === 'slot' ? slotPoint(e, e.h) : e.c.clone().addScaledVector(e.axis, e.h);
    return { a: p.clone(), b: p.clone(), thetaA: 0, thetaB: 0, s: 1 };
  });

  // Which way round each circle: from the loop's middle (the centroid of the spots)
  const centroid = els.reduce((s, e) => s.add(e.shape === 'slot' ? slotPoint(e, e.h) : e.c.clone().addScaledVector(e.axis, e.h)), new THREE.Vector3()).divideScalar(n);
  for (let i = 0; i < n; i++) {
    const e = els[i];
    if (e.shape === 'slot') continue;
    const prev = contacts[(i - 1 + n) % n].b;
    const next = contacts[(i + 1) % n].a;
    const ang = (p) => {
      const d = p.clone().sub(e.c);
      return Math.atan2(d.dot(e.v), d.dot(e.u));
    };
    const toMid = centroid.clone().sub(e.c);
    toMid.addScaledVector(e.axis, -toMid.dot(e.axis));
    let target = toMid.lengthSq() < 1e-6 ? ang(prev) + Math.PI / 2 : Math.atan2(toMid.dot(e.v), toMid.dot(e.u));
    const outside = (e.side || 'out') !== 'in';
    if (outside) target += Math.PI; // the far side from the loop's middle
    // A side read from a real band (CAD import): the direction it touches the spot from
    if (e.wrapDir) {
      const w = v3(e.wrapDir);
      target = Math.atan2(w.dot(e.v), w.dot(e.u));
    }
    e.target = target;
    e.s = chooseTurn(e, prev, next, target);
  }
  // Turns asked for (solveBandPath trying the other way round a hook)
  if (Array.isArray(opts.turns)) els.forEach((e, i) => {
    if (e.shape !== 'slot' && (opts.turns[i] === 1 || opts.turns[i] === -1)) e.s = opts.turns[i];
  });
  // A crossed run (a figure-8): the next circle turns the other way
  for (let i = 0; i < n; i++) {
    const e = els[i];
    const f = els[(i + 1) % n];
    if (!e.cross || e.shape === 'slot' || f.shape === 'slot') continue;
    f.s = -e.s * Math.sign(e.axis.dot(f.axis) || 1);
  }

  let rounds = 0;
  for (; rounds < maxRounds; rounds++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const e = els[i];
      const P = contacts[(i - 1 + n) % n].b;
      const Q = contacts[(i + 1) % n].a;
      const c = contacts[i];
      if (e.shape === 'slot') {
        e.h = bestHeight(e, (h) => slotPoint(e, h), P, Q);
        const p = slotPoint(e, e.h);
        moved = Math.max(moved, p.distanceTo(c.a));
        c.a.copy(p);
        c.b.copy(p);
        continue;
      }
      e.h = bestHeight(e, (h) => e.c.clone().addScaledVector(e.axis, h), P, Q);
      const { thetaA, thetaB } = tangentAngles(e, P, Q, e.s);
      const A = pointOf(e, e.h, thetaA);
      const B = pointOf(e, e.h, thetaB);
      moved = Math.max(moved, A.distanceTo(c.a), B.distanceTo(c.b));
      Object.assign(c, { thetaA, thetaB, s: e.s });
      c.a.copy(A);
      c.b.copy(B);
    }
    if (moved < tolMm) break;
  }

  // Length and the drawn middle line
  const points = [];
  const ups = [];
  const owners = []; // the element each point lies on (its curve, or its gap)
  let lengthMm = 0;
  for (let i = 0; i < n; i++) {
    const e = els[i];
    const c = contacts[i];
    if (e.shape === 'slot') {
      points.push(c.a.clone());
      ups.push(e.axis.clone());
      owners.push(i);
    } else {
      const sweep = modTwoPi(e.s * (c.thetaB - c.thetaA)) + TWO_PI * (e.wraps - 1);
      c.wrapRad = sweep;
      lengthMm += e.R * sweep;
      const steps = Math.max(1, Math.ceil(THREE.MathUtils.radToDeg(sweep) / arcStepDeg));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        // Extra wraps lie side by side along the post, one band width apart
        const h = e.h + (e.wraps > 1 ? (t * (e.wraps - 1) - (e.wraps - 1) / 2) * widthMm : 0);
        points.push(pointOf(e, h, c.thetaA + e.s * sweep * t));
        ups.push(e.axis.clone());
        owners.push(i);
      }
    }
    lengthMm += c.b.distanceTo(contacts[(i + 1) % n].a);
    c.height = e.h;
  }
  return {
    points,
    ups,
    owners,
    lengthMm,
    rounds,
    keys: els.map((e) => e.key),
    turns: els.map((e) => e.s ?? 0),
    contacts: contacts.map((c, i) => ({ a: arr(c.a), b: arr(c.b), axis: arr(els[i].axis), height: Number(els[i].h.toFixed(3)), wrapDeg: c.wrapRad ? Number(THREE.MathUtils.radToDeg(c.wrapRad).toFixed(1)) : 0, turn: els[i].s ?? 0 }))
  };
}

/** The height along a post or slot (within its span) that makes |P-x|+|x-Q| least (golden section). */
function bestHeight(e, at, P, Q) {
  let lo = e.lo;
  let hi = e.hi;
  if (hi - lo < 1e-6) return lo;
  const f = (h) => at(h).distanceTo(P) + at(h).distanceTo(Q);
  const g = 0.6180339887;
  let x1 = hi - g * (hi - lo);
  let x2 = lo + g * (hi - lo);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let k = 0; k < 40 && hi - lo > 1e-4; k++) {
    if (f1 < f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - g * (hi - lo);
      f1 = f(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + g * (hi - lo);
      f2 = f(x2);
    }
  }
  return (lo + hi) / 2;
}

/**
 * Where a band coming from P and going to Q touches a circle turning `s` (+1 counter-clockwise
 * about its axis): arriving at φP + s·α and leaving at φQ − s·α, α the tangent angle.
 */
function tangentAngles(e, P, Q, s) {
  const local = (p) => {
    const d = p.clone().sub(e.c);
    const x = d.dot(e.u);
    const y = d.dot(e.v);
    const r = Math.hypot(x, y);
    return { phi: Math.atan2(y, x), alpha: r > e.R ? Math.acos(e.R / r) : 0 };
  };
  const p = local(P);
  const q = local(Q);
  return { thetaA: p.phi + s * p.alpha, thetaB: q.phi - s * q.alpha };
}

/** The turning direction whose wrap passes the target angle (the side the band goes round). */
function chooseTurn(e, P, Q, target) {
  let best = 1;
  let bestMiss = Infinity;
  let bestSweep = Infinity;
  for (const s of [1, -1]) {
    const { thetaA, thetaB } = tangentAngles(e, P, Q, s);
    const sweep = modTwoPi(s * (thetaB - thetaA));
    const reach = modTwoPi(s * (target - thetaA));
    // Within 30° of the target counts as passing it; of two that pass, the shorter wrap
    const miss = Math.max(0, (reach <= sweep ? 0 : Math.min(reach - sweep, TWO_PI - reach)) - Math.PI / 6);
    if (miss < bestMiss - 1e-9 || (Math.abs(miss - bestMiss) <= 1e-9 && sweep < bestSweep)) {
      bestMiss = miss;
      bestSweep = sweep;
      best = s;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// A route from a band's shape (VEX CAD import)

/**
 * The route a stretched band's points (world, mm; its mesh, or its middle line) follow round
 * `candidates` ([{ ref, spot (world) }]): the spots it wraps, in order round the loop, with the side
 * of each. A circle is wrapped when band points hug it (within `toleranceMm` of its surface plus half
 * the band's thickness, inside its span) and none sit deep inside it; a slot (tooth gap) when band
 * points pass through it. Where a gap of a gear is wrapped, its rim isn't listed; of two posts on one
 * line the one with more points stays. Returns [{ ref, spot, side, hits }].
 */
export function routeFromPoints(points, candidates, { thickMm = 1.5, toleranceMm = 1.2, minHits = 6, touchMm = 0.6 } = {}) {
  const pts = points.map(v3);
  const centroid = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length || 1);
  const found = [];
  for (const cand of candidates) {
    const s = cand.spot;
    const axis = v3(s.axis).normalize();
    const c = v3(s.center);
    const [lo, hi] = [Math.min(...s.span), Math.max(...s.span)];
    const hits = [];
    let deep = 0;
    let closest = Infinity;
    for (const p of pts) {
      const d = p.clone().sub(c);
      const t = d.dot(axis);
      if (t < lo - toleranceMm || t > hi + toleranceMm) continue;
      const radial = d.clone().addScaledVector(axis, -t);
      if (s.shape === 'slot') {
        const rr = radial.dot(v3(s.radial));
        const sideways = radial.clone().addScaledVector(v3(s.radial), -rr).length();
        if (t >= lo - 0.5 && t <= hi + 0.5 && rr >= s.rootMm - toleranceMm && rr <= s.tipMm && sideways <= thickMm / 2 + toleranceMm) hits.push(p);
        continue;
      }
      const r = radial.length();
      if (r < s.radius - 1) deep++;
      else if (r <= s.radius + thickMm + toleranceMm) {
        hits.push(p);
        if (t >= lo - 0.5 && t <= hi + 0.5) closest = Math.min(closest, Math.abs(r - s.radius));
      }
    }
    if (hits.length < minHits || deep > Math.max(2, hits.length * 0.1)) continue;
    // A band on a circle lies against it; one a millimetre or more off only passes by
    if (s.shape === 'circle' && closest > touchMm) continue;
    const at = hits.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(hits.length);
    found.push({ ...cand, hits: hits.length, at, wrapDir: s.shape === 'circle' ? wrappedSide(hits, c, axis) : null });
  }
  // A wrapped gap stands for its gear's rim; two posts on one line are one post
  const kept = found.filter((f) => {
    if (f.spot.kind === 'rim' && found.some((g) => g.ref.instanceId === f.ref.instanceId && g.spot.shape === 'slot')) return false;
    if (f.spot.shape !== 'circle' || f.spot.kind === 'rim') return true;
    return !found.some((g) => {
      if (g === f || g.spot.shape !== 'circle' || g.spot.kind === 'rim') return false;
      const a = v3(f.spot.axis).normalize();
      if (Math.abs(a.dot(v3(g.spot.axis).normalize())) < 0.999) return false;
      const d = v3(g.spot.center).sub(v3(f.spot.center));
      const along = d.dot(a);
      if (d.addScaledVector(a, -along).length() > 1) return false;
      // ...and overlapping along it (two standoffs at opposite ends of a robot can share a line)
      const reach = (Math.max(...f.spot.span) - Math.min(...f.spot.span) + Math.max(...g.spot.span) - Math.min(...g.spot.span)) / 2 + 2;
      if (Math.abs(along) > reach) return false;
      return g.hits > f.hits || (g.hits === f.hits && candidates.indexOf(g) < candidates.indexOf(f));
    });
  });
  if (kept.length < 2) return kept.map((k) => ({ ref: k.ref, spot: k.spot, side: 'out', hits: k.hits }));
  // Order along the band itself: two spots are neighbours when the band runs straight between them.
  // The loop is the shortest cycle through every spot; a thin loop folded round corners (Swish's arm
  // bands and latch belts) has no such cycle, and goes out along the shortest path through them and
  // back the same way.
  const tolMm = Math.max(thickMm + 1.5, 6);
  const keyOf = (k) => `${k.ref.instanceId}|${k.ref.feature}`;
  // A spot the band runs straight past (it bends less than 8° there) isn't part of the route,
  // unless the band turns back at it
  const dropPassing = (list) => {
    let route = list;
    for (let changed = true; changed && route.length > 2; ) {
      changed = false;
      for (let i = 0; i < route.length; i++) {
        const prev = route[(i - 1 + route.length) % route.length];
        const next = route[(i + 1) % route.length];
        if (prev === next) continue;
        const a = route[i].at.clone().sub(prev.at).normalize();
        const b = next.at.clone().sub(route[i].at).normalize();
        if (a.dot(b) > Math.cos(THREE.MathUtils.degToRad(8))) {
          const gone = route[i];
          route = route.filter((k) => k !== gone);
          changed = true;
          break;
        }
      }
    }
    return route;
  };
  // How far the band's points lie from the path a route gives (mean, mm)
  const sample = pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / 400)) === 0);
  const score = (route) => {
    const path = solveBandPath(route.map((k) => ({ ...k.spot, wrapDir: k.wrapDir, key: keyOf(k) })), { thickMm });
    if (!path) return Infinity;
    const P = path.points;
    let sum = 0;
    for (const p of sample) {
      let best = Infinity;
      for (let i = 0; i < P.length; i++) {
        const a = P[i];
        const ab = P[(i + 1) % P.length].clone().sub(a);
        const t = ab.lengthSq() ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())) : 0;
        best = Math.min(best, a.clone().addScaledVector(ab, t).distanceTo(p));
      }
      sum += best;
    }
    return sum / sample.length;
  };
  // Candidate routes: every spot, or only those touched from outside (and where the band turns
  // back), each as a closed cycle or folded out and back; the one whose path fits the band best
  const first = loopOrder(kept, pts, { tolMm });
  if (!first) return kept.map((k) => ({ ref: k.ref, spot: k.spot, side: 'out', hits: k.hits }));
  const firstRoute = first.map((i) => kept[i]);
  const sided = withSides(firstRoute);
  const ends = new Set(firstRoute.filter((k) => firstRoute.indexOf(k) === firstRoute.lastIndexOf(k) && firstRoute.length > new Set(firstRoute).size));
  const inside = new Set(firstRoute.filter((k, i) => sided[i].side === 'in' && !ends.has(k)));
  const subsets = [kept, ...(inside.size ? [kept.filter((k) => !inside.has(k))] : [])].filter((l) => l.length >= 2);
  let best = null;
  for (const list of subsets) {
    for (const mode of ['cycle', 'fold']) {
      const order = loopOrder(list, pts, { tolMm, mode });
      if (!order) continue;
      const route = dropPassing(order.map((i) => list[i]));
      // A little against each extra spot, so a spot the band only brushes doesn't win on a hair
      const sc = score(route) + 0.15 * new Set(route).size;
      if (globalThis.process?.env?.BAND_DEBUG) console.log('   candidate', mode, list.length, sc.toFixed(2), route.map((k) => `${k.ref.label?.split(': ').pop()} ${k.ref.feature}`).join(' > '));
      if (!best || sc < best.score - 0.05) best = { route, score: sc };
    }
  }
  const route = best ? best.route : dropPassing(firstRoute);
  return withSides(route).map(({ ref, spot, side, hits, wrapDir }) => ({ ref, spot, side, hits, ...(wrapDir ? { wrapDir: arr(wrapDir) } : {}) }));

  function withSides(route) {
  // Side: whether the band wraps the far side from the loop's middle, as solveBandPath reads it
  const mid = route
    .reduce((sum, k) => {
      const sp = k.spot;
      const h = Math.min(Math.max(0, Math.min(...sp.span)), Math.max(...sp.span));
      const p = v3(sp.center).addScaledVector(v3(sp.axis).normalize(), h);
      if (sp.shape === 'slot') p.addScaledVector(v3(sp.radial), sp.rootMm + thickMm / 2);
      return sum.add(p);
    }, new THREE.Vector3())
    .divideScalar(route.length);
  return route.map((k) => {
    let side = 'out';
    if (k.spot.shape === 'circle' && k.wrapDir) {
      const axis = v3(k.spot.axis).normalize();
      const toMid = mid.clone().sub(v3(k.spot.center));
      toMid.addScaledVector(axis, -toMid.dot(axis));
      if (toMid.lengthSq() > 1e-6 && k.wrapDir.dot(toMid) > 0) side = 'in';
    }
    return { ...k, side };
  });
  }
}

/**
 * Indices of `spots` (each with `at`, where the band touches it, and `hits`) in loop order, from
 * which straight runs between them the band points cover: the shortest closed cycle through all of
 * them, or else the shortest open path out and back (the far end visited once, the rest twice).
 * Spots with the fewest hits are dropped (at most two) when no order fits all. Null when none fits.
 */
export function loopOrder(spots, pts, { tolMm, mode = 'any' }) {
  // The band covers a run when most of its middle (away from the two spots, where the band is
  // anyway) has band points near it
  const covered = (a, b) => {
    const len = a.distanceTo(b);
    if (len < 16) return true;
    const steps = Math.max(4, Math.ceil(len / 3));
    let near = 0;
    let tried = 0;
    for (let i = 1; i < steps; i++) {
      const q = a.clone().lerp(b, i / steps);
      if (q.distanceTo(a) < 8 || q.distanceTo(b) < 8) continue;
      tried++;
      if (pts.some((p) => p.distanceTo(q) <= tolMm)) near++;
    }
    return tried ? near / tried : 1;
  };
  const tryOrder = (idx) => {
    const n = idx.length;
    const at = idx.map((i) => spots[i].at);
    // Runs the band covers; a run costs its length, more the less of it the band covers
    const frac = at.map((a, i) => at.map((b, j) => (i === j ? 0 : covered(a, b))));
    const adj = frac.map((row) => row.map((f) => f >= 0.35));
    const dist = at.map((a, i) => at.map((b, j) => a.distanceTo(b) * (1.1 - frac[i][j])));
    let best = null;
    let bestLen = Infinity;
    // Closed cycles from spot 0
    const seq = [0];
    const used = new Array(n).fill(false);
    used[0] = true;
    const cycle = (len) => {
      if (len >= bestLen) return;
      const last = seq[seq.length - 1];
      if (seq.length === n) {
        if (adj[last][0] && len + dist[last][0] < bestLen) {
          bestLen = len + dist[last][0];
          best = [...seq];
        }
        return;
      }
      for (let j = 1; j < n; j++) {
        if (used[j] || !adj[last][j]) continue;
        used[j] = true;
        seq.push(j);
        cycle(len + dist[last][j]);
        seq.pop();
        used[j] = false;
      }
    };
    if (n >= 3 && mode !== 'fold') cycle(0);
    if (best) return best.map((k) => idx[k]);
    if (mode === 'cycle') return null;
    // Open paths, out and back
    bestLen = Infinity;
    const path = (len) => {
      if (len >= bestLen) return;
      const last = seq[seq.length - 1];
      if (seq.length === n) {
        bestLen = len;
        best = [...seq];
        return;
      }
      for (let j = 0; j < n; j++) {
        if (used[j] || !adj[last][j]) continue;
        used[j] = true;
        seq.push(j);
        path(len + dist[last][j]);
        seq.pop();
        used[j] = false;
      }
    };
    for (let s0 = 0; s0 < n; s0++) {
      seq.length = 0;
      seq.push(s0);
      used.fill(false);
      used[s0] = true;
      path(0);
    }
    if (!best) return null;
    const there = best.map((k) => idx[k]);
    return [...there, ...there.slice(1, -1).reverse()];
  };
  const all = spots.map((_, i) => i);
  if (all.length < 2) return all;
  if (all.length === 2) return all;
  const byHits = [...all].sort((a, b) => spots[a].hits - spots[b].hits);
  for (let drop = 0; drop <= Math.min(2, all.length - 2); drop++) {
    const keep = all.filter((i) => !byHits.slice(0, drop).includes(i));
    const order = tryOrder(keep);
    if (order) return order;
  }
  return null;
}

/** Whether a closed path cuts into a circle spot's solid (its axis line within its radius, inside its span). */
export function pathPassesThrough(points, spot) {
  const axis = v3(spot.axis).normalize();
  const c = v3(spot.center);
  const [lo, hi] = [Math.min(...spot.span), Math.max(...spot.span)];
  for (let i = 0; i < points.length; i++) {
    const a = v3(points[i]);
    const b = v3(points[(i + 1) % points.length]);
    for (let k = 0; k <= 20; k++) {
      const p = a.clone().lerp(b, k / 20);
      const d = p.sub(c);
      const t = d.dot(axis);
      if (t < lo || t > hi) continue;
      if (d.addScaledVector(axis, -t).length() < (spot.radius ?? 0) - 0.3) return true;
    }
  }
  return false;
}

/**
 * The side of a circle a band wraps, from the band points hugging it: opposite the widest angle with
 * no points (where its runs leave). A unit vector across the axis.
 */
function wrappedSide(hits, c, axis) {
  const [u, v] = planeAxes(axis);
  const angles = hits
    .map((p) => {
      const d = p.clone().sub(c);
      return Math.atan2(d.dot(v), d.dot(u));
    })
    .sort((a, b) => a - b);
  let gapAt = 0;
  let widest = -1;
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    const b = i + 1 < angles.length ? angles[i + 1] : angles[0] + TWO_PI;
    if (b - a > widest) {
      widest = b - a;
      gapAt = (a + b) / 2;
    }
  }
  const side = gapAt + Math.PI;
  return u.clone().multiplyScalar(Math.cos(side)).addScaledVector(v, Math.sin(side));
}

/** The direction the points spread least along (the normal of their best-fit plane). */
function leastVarianceAxis(pts, centroid) {
  const m = new THREE.Matrix3();
  const e = m.elements;
  for (const p of pts) {
    const d = p.clone().sub(centroid);
    const a = [d.x, d.y, d.z];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) e[i * 3 + j] += a[i] * a[j];
  }
  // Inverse power iteration on the covariance (shifted to stay invertible)
  const trace = e[0] + e[4] + e[8];
  for (let i = 0; i < 3; i++) e[i * 4] += 1e-6 * trace + 1e-9;
  const inv = m.clone().invert();
  let x = new THREE.Vector3(0.3, 0.5, 0.8).normalize();
  for (let k = 0; k < 50; k++) x = x.applyMatrix3(inv).normalize();
  return x;
}

// ---------------------------------------------------------------------------------------------
// Stretch

/** Stretch of a band round a path: length / free length. */
export const stretchOf = (spec, lengthMm) => (spec?.freeMm ? lengthMm / spec.freeMm : 0);

/**
 * The library band or belt whose stretch on a path of `lengthMm` is closest to `best` (1.5×), as
 * [partNumber, spec, stretch]. `available`: part numbers in the library (default: all sizes).
 */
export function suggestBand(lengthMm, best = 1.5, available = Object.keys(BAND_SPECS)) {
  let out = null;
  for (const pn of available) {
    const spec = BAND_SPECS[pn];
    if (!spec || pn === '228-2500-474') continue; // "Thin #64 (Use 468)": VEX says use the #32
    const s = lengthMm / spec.freeMm;
    if (!out || Math.abs(s - best) < Math.abs(out[2] - best)) out = [pn, spec, s];
  }
  return out;
}
