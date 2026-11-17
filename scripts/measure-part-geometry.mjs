import * as THREE from 'three';
import { getPartRawGeometry } from '../mcp/assembly-engine.mjs';
import { directionAt, refAxes, wrapDeg } from '../src/utils/axisFrame.js';

/**
 * Measurements of gear teeth, racks, square bores, square shafts and the Smart Motor hub, taken from
 * each part's real (unshrunk) mesh for scripts/index-part-metadata.mjs. Every angle is about an
 * axis in the frame of refAxes(axis) (src/utils/axisFrame.js), so the app and the MCP engine read
 * them the same way. Rays are cast every 0.25° and fitted with a Fourier phase, which is robust to
 * mesh noise: for a k-fold pattern r(θ) ≈ A·cos(k(θ − φ)), φ = atan2(Σ r·sin kθ, Σ r·cos kθ) / k.
 */

export const RAY_COUNT = 1440; // 0.25° steps
const VEX_PITCH_MM = 12.7;
// VEX IQ spur gears come in three tooth sizes: high strength (16 DP), standard (24 DP: 24 teeth on a
// 1-pitch diameter) and the 34 DP pair. A measured tooth size is snapped to the nearest of these.
export const DIAMETRAL_PITCHES = [16, 24, 34];
const DP_TOLERANCE = 0.1;
// VEX IQ chain: link pivots are a quarter pitch (6.35 mm) apart
export const CHAIN_PITCH_MM = 6.35;
// Toothed parts that are not meshing gears (ratchet teeth take pawls)
const NOT_MESHING_PATTERN = /ratchet|thrust washer|belt|pawl|cam|chain/i;
const MIN_TOOTH_AMPLITUDE = 0.08; // the k = teeth Fourier amplitude must be this share of tooth depth
const SQUARE_MIN_AMPLITUDE = 0.03; // 4-fold amplitude over the mean radius that makes a hole square

const round = (x, d = 3) => Number(x.toFixed(d));
const mod = (x, m) => ((x % m) + m) % m;

function makeRaycaster(part) {
  const geo = getPartRawGeometry(part);
  const ray = new THREE.Ray();
  return (origin, dir) => {
    ray.origin.copy(origin);
    ray.direction.copy(dir);
    return geo.boundsTree.raycastFirst(ray, THREE.DoubleSide)?.distance ?? null;
  };
}

/** Fourier phase (deg, at a maximum) and amplitude of the k-fold part of samples r over angles θ. */
export function fourierPhase(thetas, values, k) {
  let c = 0;
  let s = 0;
  let n = 0;
  thetas.forEach((th, i) => {
    const r = values[i];
    if (r == null || !Number.isFinite(r)) return;
    c += r * Math.cos(k * th);
    s += r * Math.sin(k * th);
    n++;
  });
  if (n === 0) return { phaseDeg: 0, amplitude: 0 };
  const phase = Math.atan2(s, c) / k;
  return { phaseDeg: mod(THREE.MathUtils.radToDeg(phase), 360 / k), amplitude: (2 * Math.hypot(c, s)) / n };
}

const median = (arr) => {
  const s = arr.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Distance r(θ) from `axis` (through `center`) to the surface met coming inward from `startR`,
 * at RAY_COUNT angles (or `count`). Misses are null.
 */
function inwardProfile(cast, center, axis, startR, count = RAY_COUNT) {
  const [u, v] = refAxes(axis);
  const thetas = [];
  const radii = [];
  const dir = new THREE.Vector3();
  const origin = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const th = (i / count) * Math.PI * 2;
    dir.copy(u).multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th));
    origin.copy(center).addScaledVector(dir, startR);
    const d = cast(origin, dir.clone().negate());
    thetas.push(th);
    radii.push(d == null || d > startR ? null : startR - d);
  }
  return { thetas, radii };
}

/** Distance d(θ) from `axis` (through `center`) out to the wall, at RAY_COUNT angles. Misses are null. */
function outwardProfile(cast, center, axis, count = RAY_COUNT) {
  const [u, v] = refAxes(axis);
  const thetas = [];
  const dists = [];
  const dir = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const th = (i / count) * Math.PI * 2;
    dir.copy(u).multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th));
    thetas.push(th);
    dists.push(cast(center, dir));
  }
  return { thetas, dists };
}

/** Tip and root radius of a toothed profile: medians of each tooth period's max and min (robust to arms). */
function tipAndRoot(thetas, radii, teeth) {
  const maxes = new Array(teeth).fill(-Infinity);
  const mins = new Array(teeth).fill(Infinity);
  const period = (Math.PI * 2) / teeth;
  thetas.forEach((th, i) => {
    const r = radii[i];
    if (r == null) return;
    const b = Math.min(teeth - 1, Math.floor(th / period));
    maxes[b] = Math.max(maxes[b], r);
    mins[b] = Math.min(mins[b], r);
  });
  return { tip: median(maxes), root: median(mins) };
}

/**
 * The tooth ring of a gear or sprocket about the part's local Z axis through the origin: the axial
 * band where the k = teeth pattern is strongest, its tip and root radius and the tooth phase (deg, at
 * a tooth's middle). Returns { measured: true, tip, root, phaseDeg, faceLo, faceHi } or
 * { measured: false, reason }.
 */
function measureToothRing(part, teeth) {
  const cast = makeRaycaster(part);
  const axis = new THREE.Vector3(0, 0, 1);
  const { min, max } = part.bbox;
  const startR = Math.max(...[min[0], min[1], max[0], max[1]].map(Math.abs)) * 1.5 + 2;

  // The tooth band: the axial position where the k = teeth pattern is strongest
  const scan = [];
  for (let z = min[2] + 0.3; z <= max[2] - 0.3 + 1e-6; z += 0.25) {
    const { thetas, radii } = inwardProfile(cast, new THREE.Vector3(0, 0, z), axis, startR, 720);
    const { tip, root } = tipAndRoot(thetas, radii, teeth);
    const clipped = radii.map((r) => (r == null ? null : Math.min(tip, Math.max(root, r))));
    const { amplitude } = fourierPhase(thetas, clipped, teeth);
    scan.push({ z, tip, root, amplitude });
  }
  const best = scan.reduce((a, b) => (b.amplitude > a.amplitude ? b : a), scan[0]);
  if (!best || !(best.tip - best.root > 0.3) || best.amplitude < MIN_TOOTH_AMPLITUDE * (best.tip - best.root)) {
    return { measured: false, reason: 'no tooth pattern found' };
  }
  const band = scan.filter((s) => s.amplitude >= best.amplitude * 0.6 && Math.abs(s.tip - best.tip) < 0.3);
  const faceLo = Math.min(...band.map((s) => s.z)) - 0.3;
  const faceHi = Math.max(...band.map((s) => s.z)) + 0.3;
  const zMid = (faceLo + faceHi) / 2;

  const { thetas, radii } = inwardProfile(cast, new THREE.Vector3(0, 0, zMid), axis, startR);
  const { tip, root } = tipAndRoot(thetas, radii, teeth);
  const clipped = radii.map((r) => (r == null ? null : Math.min(tip, Math.max(root, r))));
  const { phaseDeg, amplitude } = fourierPhase(thetas, clipped, teeth);
  if (amplitude < MIN_TOOTH_AMPLITUDE * (tip - root)) return { measured: false, reason: 'no tooth pattern found' };
  return { measured: true, tip, root, phaseDeg, faceLo, faceHi };
}

/**
 * Spur gear teeth about the part's local Z axis through the origin (every VEX IQ spur gear's bore).
 * Returns the new gearSpecs fields, or { measured: false, reason }.
 */
export function measureSpurGear(part, teeth) {
  if (!teeth || teeth < 6) return { measured: false, reason: 'no tooth count' };
  if (NOT_MESHING_PATTERN.test(part.name)) return { measured: false, reason: 'not a meshing gear' };
  const ring = measureToothRing(part, teeth);
  if (!ring.measured) return ring;
  const { tip, root, phaseDeg, faceLo, faceHi } = ring;

  // Standard involute tip = (teeth + 2)·m / 2; snapped to the nearest VEX IQ tooth size
  const rawModule = (2 * tip) / (teeth + 2);
  const rawDp = 25.4 / rawModule;
  const dp = DIAMETRAL_PITCHES.reduce((a, b) => (Math.abs(b - rawDp) < Math.abs(a - rawDp) ? b : a));
  if (Math.abs(dp - rawDp) / dp > DP_TOLERANCE) {
    return { measured: false, reason: `tooth size ${rawDp.toFixed(1)} DP is not a VEX IQ gear size` };
  }
  const moduleMm = 25.4 / dp;
  return {
    measured: true,
    diametralPitch: dp,
    tipRadiusMm: round(tip),
    rootRadiusMm: round(root),
    moduleMm: round(moduleMm, 4),
    pitchRadiusMm: round(dp === 34 ? (teeth * moduleMm) / 2 : tip - moduleMm),
    toothSpacingMm: round(Math.PI * moduleMm),
    toothPhaseDeg: round(phaseDeg, 2),
    faceSpanMm: [round(faceLo, 2), round(faceHi, 2)]
  };
}

/**
 * Sprocket teeth for VEX IQ chain (CHAIN_PITCH_MM between link pivots). The pitch radius, where the
 * pivots sit, follows from the pitch: a link is a chord spanning one tooth, r = p / (2·sin(180°/N)).
 * The tooth phase is measured like a spur gear's; a chain pivot sits in the gap half a tooth on.
 */
export function measureSprocket(part, teeth) {
  if (!teeth || teeth < 6) return { measured: false, reason: 'no tooth count' };
  const ring = measureToothRing(part, teeth);
  if (!ring.measured) return ring;
  const { tip, root, phaseDeg, faceLo, faceHi } = ring;
  const pitchRadius = CHAIN_PITCH_MM / (2 * Math.sin(Math.PI / teeth));
  if (!(tip > pitchRadius)) return { measured: false, reason: `tip ${tip.toFixed(2)} mm is inside the chain pitch circle` };
  return {
    measured: true,
    chainPitchMm: CHAIN_PITCH_MM,
    tipRadiusMm: round(tip),
    rootRadiusMm: round(root),
    pitchRadiusMm: round(pitchRadius),
    toothPhaseDeg: round(phaseDeg, 2),
    gapPhaseDeg: round(mod(phaseDeg + 180 / teeth, 360 / teeth), 2),
    faceSpanMm: [round(faceLo, 2), round(faceHi, 2)]
  };
}

// Ratchets and pawls (openspec ratchet-and-pawl, design §1)
export const RATCHET_PATTERN = /\bratchet\b/i;
export const PAWL_PATTERN = /\bpawl\b/i;
export const RATCHET_PROFILE_SAMPLES = 48; // outline samples across one tooth, radius against angle
const STEEP_RATIO = 3; // a tooth side this many times steeper than the other makes the teeth lean
const STEEP_STEP_SHARE = 0.2; // one ray step rising this share of the tooth depth is a steep side

/**
 * Ratchet teeth about the part's local Z axis (the bore). Angles are in the frame of
 * refAxes(+Z). Returns { measured: true, kind: 'ratchet', teeth, tipRadiusMm, rootRadiusMm,
 * toothPhaseDeg, faceSpanMm, lean, profileMm } or { measured: false, reason }:
 * - lean: the turning direction about +Z that a pawl stops (+1 anticlockwise, −1 clockwise), or 0
 *   when both sides of a tooth are alike. A pawl's tip, fixed while the ratchet turns, climbs the
 *   sloped side and drops off the steep one in the free direction; the other way the steep side
 *   runs into it.
 * - toothPhaseDeg: the angle of one tooth's steep side (of one tooth's middle when lean is 0).
 * - profileMm: the outline's radius at RATCHET_PROFILE_SAMPLES bin centres across one tooth,
 *   starting at the steep side and running along the sloped side (sample i at
 *   toothPhaseDeg − lean·(i + 0.5)/N·(360/teeth)°; +θ when lean is 0), each the median over all teeth.
 */
export function measureRatchet(part, teeth) {
  if (!teeth || teeth < 6) return { measured: false, reason: 'no tooth count' };
  const ring = measureToothRing(part, teeth);
  if (!ring.measured) return ring;
  const { faceLo, faceHi } = ring;
  const cast = makeRaycaster(part);
  const axis = new THREE.Vector3(0, 0, 1);
  const { min, max } = part.bbox;
  const startR = Math.max(...[min[0], min[1], max[0], max[1]].map(Math.abs)) * 1.5 + 2;
  const perTooth = 96;
  const count = teeth * perTooth;
  const { thetas, radii } = inwardProfile(cast, new THREE.Vector3(0, 0, (faceLo + faceHi) / 2), axis, startR, count);
  if (radii.some((r) => r == null)) return { measured: false, reason: 'tooth outline has gaps' };
  const { tip, root } = tipAndRoot(thetas, radii, teeth);
  const depth = tip - root;
  const step = (i) => radii[(i + 1) % count] - radii[i];

  // Steepest rise and fall in each tooth (per ray step, +θ), then the median over teeth
  const rises = [];
  const falls = [];
  for (let t = 0; t < teeth; t++) {
    let rise = 0;
    let fall = 0;
    for (let i = t * perTooth; i < (t + 1) * perTooth; i++) {
      rise = Math.max(rise, step(i));
      fall = Math.max(fall, -step(i));
    }
    rises.push(rise);
    falls.push(fall);
  }
  const rise = median(rises);
  const fall = median(falls);
  // Rising steeply in +θ: turning clockwise carries the steep side into a fixed tip
  const lean = rise > STEEP_RATIO * fall ? -1 : fall > STEEP_RATIO * rise ? 1 : 0;
  const period = 360 / teeth;
  const dTheta = 360 / count;
  let phaseDeg;
  if (lean === 0) {
    const clipped = radii.map((r) => Math.min(tip, Math.max(root, r)));
    phaseDeg = fourierPhase(thetas, clipped, teeth).phaseDeg;
  } else {
    // Each steep side: a run of ray steps climbing fast (in the climbing direction), placed at its steepest step
    const climb = (i) => (lean < 0 ? step(i) : -step(i));
    const steep = (i) => climb(i) > STEEP_STEP_SHARE * depth;
    let first = 0;
    while (steep(first) && first < count) first++; // start outside a run
    const edges = [];
    for (let k = 0; k < count; k++) {
      const i = (first + k) % count;
      if (!steep(i)) continue;
      let best = i;
      while (k + 1 < count && steep((first + k + 1) % count)) {
        k++;
        const j = (first + k) % count;
        if (climb(j) > climb(best)) best = j;
      }
      edges.push((best + 0.5) * dTheta);
    }
    if (edges.length !== teeth) {
      return { measured: false, reason: `found ${edges.length} steep tooth sides, expected ${teeth}` };
    }
    // Circular mean of the edges folded into one tooth
    const k = (Math.PI * 2) / period; // radians per degree of turn, one cycle per tooth
    let c = 0;
    let s = 0;
    for (const e of edges) {
      c += Math.cos(k * e);
      s += Math.sin(k * e);
    }
    phaseDeg = mod(Math.atan2(s, c) / k, period);
  }

  // The tooth band's ends, found to 0.01 mm on a ray at the crest of one tooth
  const crestDeg = phaseDeg + (lean === 0 ? 0 : -lean * period * 0.1);
  const crestDir = directionAt(axis, crestDeg);
  const toothAt = (z) => {
    const d = cast(new THREE.Vector3(0, 0, z).addScaledVector(crestDir, startR), crestDir.clone().negate());
    return d != null && startR - d > (tip + root) / 2;
  };
  const edgeOfBand = (inZ, outZ) => {
    if (!toothAt(inZ) || toothAt(outZ)) return outZ;
    for (let n = 0; n < 20; n++) {
      const m = (inZ + outZ) / 2;
      if (toothAt(m)) inZ = m;
      else outZ = m;
    }
    return (inZ + outZ) / 2;
  };
  const zMid = (faceLo + faceHi) / 2;
  const bandLo = edgeOfBand(zMid, min[2] - 0.01);
  const bandHi = edgeOfBand(zMid, max[2] + 0.01);

  // The outline across one tooth, from the steep side along the slope, median over every tooth
  const radiusAt = (deg) => {
    const x = mod(deg, 360) / dTheta;
    const i = Math.floor(x);
    const f = x - i;
    return radii[i % count] * (1 - f) + radii[(i + 1) % count] * f;
  };
  const along = lean === 0 ? 1 : -lean;
  const profileMm = [];
  for (let i = 0; i < RATCHET_PROFILE_SAMPLES; i++) {
    const off = ((i + 0.5) / RATCHET_PROFILE_SAMPLES) * period * along;
    const values = [];
    for (let t = 0; t < teeth; t++) values.push(radiusAt(phaseDeg + t * period + off));
    profileMm.push(round(median(values)));
  }
  return {
    measured: true,
    kind: 'ratchet',
    teeth,
    tipRadiusMm: round(tip),
    rootRadiusMm: round(root),
    toothPhaseDeg: round(phaseDeg, 2),
    faceSpanMm: [round(bandLo, 2), round(bandHi, 2)],
    lean,
    profileMm
  };
}

const PAWL_FACE_NEAR_MM = [0.5, 2.5]; // the catching face is read this far from the tip

/**
 * A pawl's tip, in the part's frame (design §1). The pawl's outline is the exact section of its
 * mesh through the middle of its holes; the tip is the outline point farthest from the middle of
 * the hole row, and the catching face is the side of the tip facing away from the holes (its
 * outward normal is tipNormal). `holes` is the pawl's pin_hole ports (origin, axis). Returns { measured: true,
 * kind: 'pawl', tipPoint, tipNormal, thicknessMm, outline } or { measured: false, reason }.
 */
export function measurePawl(part, holes) {
  if (!holes.length) return { measured: false, reason: 'no pin holes' };
  const axis = new THREE.Vector3(...holes[0].axis).normalize();
  if (holes.some((h) => Math.abs(new THREE.Vector3(...h.axis).normalize().dot(axis)) < 0.999)) {
    return { measured: false, reason: 'pin holes are not parallel' };
  }
  if (Math.abs(axis.z) < 0.999) return { measured: false, reason: 'pin holes do not run along Z' };
  const mid = holes.reduce((a, h) => a.add(new THREE.Vector3(...h.origin)), new THREE.Vector3()).divideScalar(holes.length);
  const planeZ = mid.z + 0.0123; // off any vertex row

  // Section of the mesh through planeZ: segments with the outward normal of the face they cut
  const geo = getPartRawGeometry(part);
  const pos = geo.attributes.position.array;
  const idx = geo.index.array;
  const segs = [];
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const pc = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const vs = [pa, pb, pc].map((p, j) => p.fromArray(pos, idx[t + j] * 3));
    const ds = vs.map((p) => p.z - planeZ);
    const cut = [];
    for (let j = 0; j < 3; j++) {
      const a = vs[j];
      const b = vs[(j + 1) % 3];
      const da = ds[j];
      const db = ds[(j + 1) % 3];
      if (da < 0 !== db < 0) {
        const f = da / (da - db);
        cut.push(new THREE.Vector2(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f));
      }
    }
    if (cut.length !== 2) continue;
    const n3 = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa));
    const n = new THREE.Vector2(n3.x, n3.y);
    if (n.length() < 1e-9) continue;
    segs.push({ a: cut[0], b: cut[1], n: n.normalize(), len: cut[0].distanceTo(cut[1]) });
  }
  if (!segs.length) return { measured: false, reason: 'no outline through the holes' };

  const mid2 = new THREE.Vector2(mid.x, mid.y);
  let tip = null;
  for (const s of segs) for (const p of [s.a, s.b]) if (!tip || p.distanceTo(mid2) > tip.distanceTo(mid2)) tip = p.clone();
  const toMid = mid2.clone().sub(tip).normalize();

  // The catching face: outline near the tip whose outward normal points away from the holes
  const normal = new THREE.Vector2();
  for (const s of segs) {
    const m = s.a.clone().add(s.b).multiplyScalar(0.5);
    const d = m.distanceTo(tip);
    if (d < PAWL_FACE_NEAR_MM[0] || d > PAWL_FACE_NEAR_MM[1]) continue;
    if (s.n.dot(toMid) > -0.5) continue;
    normal.addScaledVector(s.n, s.len);
  }
  if (normal.length() < 1e-6) return { measured: false, reason: 'no catching face at the tip' };
  normal.normalize();

  // Thickness just inside the tip
  const cast = makeRaycaster(part);
  const inside = tip.clone().addScaledVector(toMid, 1);
  const span = part.bbox.size[2] + 10;
  const down = cast(new THREE.Vector3(inside.x, inside.y, mid.z + span), new THREE.Vector3(0, 0, -1));
  const up = cast(new THREE.Vector3(inside.x, inside.y, mid.z - span), new THREE.Vector3(0, 0, 1));
  if (down == null || up == null) return { measured: false, reason: 'no thickness at the tip' };
  const top = mid.z + span - down;
  const bottom = mid.z - span + up;
  const outline = outerLoop(segs, tip);
  if (!outline) return { measured: false, reason: 'outline does not close' };
  return {
    measured: true,
    kind: 'pawl',
    tipPoint: [round(tip.x), round(tip.y), round((top + bottom) / 2)],
    tipNormal: [round(normal.x, 4), round(normal.y, 4), 0],
    thicknessMm: round(top - bottom),
    outline
  };
}

const PAWL_OUTLINE_MAX_POINTS = 200;

/**
 * The section's outer loop (the one through the tip), starting at the tip; a loop of more than
 * PAWL_OUTLINE_MAX_POINTS points is simplified (Douglas–Peucker, the tip kept as a corner), anticlockwise about +Z, as
 * [[x, y]] rounded to 0.001 mm. Null when the segments don't close into a loop through the tip.
 */
function outerLoop(segs, tip) {
  const key = (p) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
  const byKey = new Map();
  segs.forEach((s, i) => {
    for (const p of [s.a, s.b]) {
      const k = key(p);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(i);
    }
  });
  const used = new Set();
  const loops = [];
  segs.forEach((s0, i0) => {
    if (used.has(i0)) return;
    used.add(i0);
    const loop = [s0.a.clone(), s0.b.clone()];
    let end = s0.b;
    for (;;) {
      const next = (byKey.get(key(end)) || []).find((i) => !used.has(i));
      if (next === undefined) break;
      used.add(next);
      const s = segs[next];
      end = key(s.a) === key(end) ? s.b : s.a;
      if (key(end) === key(loop[0])) break;
      loop.push(end.clone());
    }
    if (loop.length >= 3) loops.push(loop);
  });
  const area = (l) => l.reduce((a, p, i) => a + p.x * l[(i + 1) % l.length].y - l[(i + 1) % l.length].x * p.y, 0) / 2;
  const withTip = loops.filter((l) => l.some((p) => p.distanceTo(tip) < 1e-3));
  if (!withTip.length) return null;
  let loop = withTip.reduce((a, b) => (Math.abs(area(b)) > Math.abs(area(a)) ? b : a));
  if (area(loop) < 0) loop = loop.reverse();
  // Drop repeated points, start at the tip
  loop = loop.filter((p, i) => p.distanceTo(loop[(i + 1) % loop.length]) > 1e-4);
  const t = loop.findIndex((p) => p.distanceTo(tip) < 1e-3);
  loop = [...loop.slice(t), ...loop.slice(0, t)];
  const simplify = (pts, tol) => {
    // Open polyline from the tip round to the tip again
    const keep = new Array(pts.length).fill(false);
    keep[0] = keep[pts.length - 1] = true;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const ab = pts[b].clone().sub(pts[a]);
      const len = ab.length() || 1e-9;
      let far = -1;
      let worst = tol;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs(ab.x * (pts[i].y - pts[a].y) - ab.y * (pts[i].x - pts[a].x)) / len;
        if (d > worst) [worst, far] = [d, i];
      }
      if (far >= 0) {
        keep[far] = true;
        stack.push([a, far], [far, b]);
      }
    }
    return pts.filter((_, i) => keep[i]).slice(0, -1);
  };
  // A closed loop is simplified as two halves, split at the point farthest from the tip
  const far = loop.reduce((b, p, i) => (p.distanceTo(loop[0]) > loop[b].distanceTo(loop[0]) ? i : b), 0);
  const halves = (tol) => [...simplify([...loop.slice(0, far + 1)], tol), ...simplify([...loop.slice(far), loop[0]], tol)];
  let tol = 0.005;
  let out = loop;
  while (out.length > PAWL_OUTLINE_MAX_POINTS) out = halves((tol *= 1.25));
  return out.map((p) => [round(p.x), round(p.y)]);
}

/**
 * Linear motion rack teeth. The rack runs along its bbox's longest axis; the toothed face and tooth
 * size are whichever side and VEX IQ tooth size show the strongest periodic height pattern.
 * Returns { measured: true, direction, normal, axis, toothSpacingMm, toothOffsetMm, pitchLineOffset,
 * lengthSpanMm, faceSpanMm } in part-local axes and mm, or { measured: false, reason }.
 */
export function measureRack(part) {
  const cast = makeRaycaster(part);
  const { min, max, size } = part.bbox;
  const li = [0, 1, 2].reduce((a, b) => (size[b] > size[a] ? b : a));
  const others = [0, 1, 2].filter((i) => i !== li);
  const unit = (i, sign = 1) => {
    const v = new THREE.Vector3();
    v.setComponent(i, sign);
    return v;
  };
  const direction = unit(li);
  const step = 0.05;
  let best = null;
  for (const ni of others) {
    const ai = others.find((i) => i !== ni);
    for (const sign of [1, -1]) {
      const normal = unit(ni, sign);
      const startN = (sign > 0 ? max[ni] : -min[ni]) + 2; // height along normal of the ray starts
      for (let f = 0.2; f <= 0.8 + 1e-6; f += 0.15) {
        const a = min[ai] + size[ai] * f;
        const ss = [];
        const hs = [];
        for (let s = min[li] + 0.5; s <= max[li] - 0.5; s += step) {
          const origin = new THREE.Vector3();
          origin.setComponent(li, s);
          origin.setComponent(ai, a);
          origin.setComponent(ni, sign * startN);
          const d = cast(origin, normal.clone().negate());
          ss.push(s);
          hs.push(d == null ? null : startN - d);
        }
        for (const dp of DIAMETRAL_PITCHES) {
          const spacing = (Math.PI * 25.4) / dp;
          const thetas = ss.map((s) => (2 * Math.PI * s) / spacing);
          const valid = hs.filter((h) => h != null);
          if (valid.length < ss.length * 0.8) continue;
          // Medians of each tooth period's highest and lowest point (robust to holes and end blocks)
          const periods = new Map();
          ss.forEach((s, i) => {
            if (hs[i] == null) return;
            const b = Math.floor(s / spacing);
            const p = periods.get(b) || { hi: -Infinity, lo: Infinity };
            p.hi = Math.max(p.hi, hs[i]);
            p.lo = Math.min(p.lo, hs[i]);
            periods.set(b, p);
          });
          const tip = median([...periods.values()].map((p) => p.hi));
          // Periods over a hole in the rack dip far below the tooth roots and are left out
          const deepest = tip - 3.5 * (25.4 / dp);
          const root = median([...periods.values()].map((p) => p.lo).filter((lo) => lo > deepest));
          const clipped = hs.map((h) => (h == null ? null : Math.min(tip, Math.max(root, h))));
          const { phaseDeg, amplitude } = fourierPhase(thetas, clipped, 1);
          const score = amplitude / (tip - root || 1);
          // Only a face whose tooth depth fits the tooth size (2.25 modules) counts
          const depthFits = Math.abs(tip - root - 2.25 * (25.4 / dp)) <= 0.35 * 2.25 * (25.4 / dp);
          if (depthFits && score >= MIN_TOOTH_AMPLITUDE && (!best || amplitude > best.amplitude)) {
            best = { ni, ai, sign, a, dp, spacing, tip, root, phaseDeg, amplitude, score, normal };
          }
        }
      }
    }
  }
  if (!best) return { measured: false, reason: 'no tooth pattern found' };
  const moduleMm = 25.4 / best.dp;
  // Teeth span across the rack (along `axis`): where the face reaches the tip height
  const faceTs = [];
  for (let a = min[best.ai] + 0.1; a <= max[best.ai] - 0.1 + 1e-6; a += 0.1) {
    let tipHits = 0;
    for (let k = 0; k < 8; k++) {
      const s = min[li] + size[li] * (0.3 + 0.05 * k);
      const origin = new THREE.Vector3();
      origin.setComponent(li, s);
      origin.setComponent(best.ai, a);
      const startN = (best.sign > 0 ? max[best.ni] : -min[best.ni]) + 2;
      origin.setComponent(best.ni, best.sign * startN);
      const d = cast(origin, best.normal.clone().negate());
      if (d != null && startN - d > best.tip - 2.25 * moduleMm - 0.2) tipHits++;
    }
    if (tipHits >= 6) faceTs.push(a);
  }
  const vec = (v) => v.toArray().map((x) => round(x + 0, 4));
  return {
    measured: true,
    diametralPitch: best.dp,
    moduleMm: round(moduleMm, 4),
    direction: vec(direction),
    normal: vec(best.normal),
    axis: vec(unit(best.ai)),
    toothSpacingMm: round(best.spacing),
    toothOffsetMm: round(wrapDeg(best.phaseDeg) / 360 * best.spacing),
    tipLineOffset: round(best.tip),
    pitchLineOffset: round(best.tip - moduleMm),
    lengthSpanMm: [round(min[li], 2), round(max[li], 2)],
    faceSpanMm: faceTs.length
      ? [round(Math.min(...faceTs) - 0.1, 2), round(Math.max(...faceTs) + 0.1, 2)]
      : [round(min[best.ai], 2), round(max[best.ai], 2)]
  };
}

/** Least-squares line y = a + b·x through points [[x, y]]. */
function fitLine(points) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

/**
 * The nearest VEX IQ tooth size to a measured module, or null when none is within DP_TOLERANCE.
 * Returns { dp, moduleMm }.
 */
function snapModule(rawModule) {
  const rawDp = 25.4 / rawModule;
  const dp = DIAMETRAL_PITCHES.reduce((a, b) => (Math.abs(b - rawDp) < Math.abs(a - rawDp) ? b : a));
  if (Math.abs(dp - rawDp) / dp > DP_TOLERANCE) return null;
  return { dp, moduleMm: 25.4 / dp };
}

const BEVEL_CONE_AGREE_MM = 0.5; // the root line's and the tip line's cone points must agree this well

/**
 * Straight bevel gear teeth about the part's local Z axis (openspec right-angle-gears, design §1).
 * Slices across the tooth band give each height's tip and root radius; straight lines through the
 * root radii and through the tip radii (on the side of the band where the teeth narrow toward the
 * apex) reach radius 0 at the cone point. Returns { measured: true, teeth, conePointZ, coneAngleDeg,
 * pitchRadiusMm, toothPhaseDeg, faceSpanMm } or { measured: false, reason }.
 */
export function measureBevelGear(part, teeth) {
  if (!teeth || teeth < 6) return { measured: false, reason: 'no tooth count' };
  const cast = makeRaycaster(part);
  const axis = new THREE.Vector3(0, 0, 1);
  const { min, max } = part.bbox;
  const startR = Math.max(...[min[0], min[1], max[0], max[1]].map(Math.abs)) * 1.5 + 2;
  const slices = [];
  for (let z = min[2] + 0.2; z <= max[2] - 0.2 + 1e-6; z += 0.2) {
    const { thetas, radii } = inwardProfile(cast, new THREE.Vector3(0, 0, z), axis, startR, 720);
    const { tip, root } = tipAndRoot(thetas, radii, teeth);
    if (!(tip - root > 0.4)) continue;
    const clipped = radii.map((r) => (r == null ? null : Math.min(tip, Math.max(root, r))));
    const { amplitude } = fourierPhase(thetas, clipped, teeth);
    if (amplitude >= MIN_TOOTH_AMPLITUDE * (tip - root)) slices.push({ z, tip, root });
  }
  if (slices.length < 3) return { measured: false, reason: 'no tooth pattern found' };
  // The teeth narrow toward the apex: keep the band from the widest tip onward in that direction
  const widest = slices.reduce((a, b) => (b.tip > a.tip ? b : a));
  const rootFit = fitLine(slices.map((s) => [s.z, s.root]));
  const towardApex = Math.sign(-rootFit.b) || 1; // +1 when radii shrink as z grows
  const narrowing = slices.filter((s) => (s.z - widest.z) * towardApex >= -1e-6);
  if (narrowing.length < 3) return { measured: false, reason: 'tooth band too short to find the cone point' };
  // A stray slice (a hole through the web) is dropped from the root line after a first fit
  const firstRoot = fitLine(narrowing.map((s) => [s.z, s.root]));
  const rootPoints = narrowing.filter((s) => Math.abs(firstRoot.a + firstRoot.b * s.z - s.root) <= 0.3);
  // High strength teeth are cut flat by the outer cylinder near the heel: only slices below it count
  const tipPoints = narrowing.filter((s) => s.tip < widest.tip - 0.05);
  if (rootPoints.length < 3 || tipPoints.length < 2) return { measured: false, reason: 'tooth band too short to find the cone point' };
  const rootLine = fitLine(rootPoints.map((s) => [s.z, s.root]));
  const tipLine = fitLine(tipPoints.map((s) => [s.z, s.tip]));
  const apexRoot = -rootLine.a / rootLine.b;
  const apexTip = -tipLine.a / tipLine.b;
  if (!Number.isFinite(apexRoot) || !Number.isFinite(apexTip)) return { measured: false, reason: 'no cone point' };
  if (Math.abs(apexRoot - apexTip) > BEVEL_CONE_AGREE_MM) {
    return { measured: false, reason: `root and tip lines meet the axis ${Math.abs(apexRoot - apexTip).toFixed(2)} mm apart` };
  }
  // VEX parts are drawn on the pitch grid: a cone point within 0.4 mm of an eighth-pitch step is
  // taken to be on it (the fits drift a few tenths on these small tooth bands)
  const rawApex = (apexRoot + apexTip) / 2;
  const gridApex = Math.round(rawApex / (VEX_PITCH_MM / 8)) * (VEX_PITCH_MM / 8);
  const conePointZ = Math.abs(rawApex - gridApex) <= 0.4 ? gridApex : rawApex;
  const coneAngleDeg = THREE.MathUtils.radToDeg(Math.atan((Math.abs(rootLine.b) + Math.abs(tipLine.b)) / 2));
  const faceLo = Math.min(...slices.map((s) => s.z)) - 0.2;
  const faceHi = Math.max(...slices.map((s) => s.z)) + 0.2;
  const mid = narrowing[Math.floor(narrowing.length / 2)];
  const { thetas, radii } = inwardProfile(cast, new THREE.Vector3(0, 0, mid.z), axis, startR);
  const clipped = radii.map((r) => (r == null ? null : Math.min(mid.tip, Math.max(mid.root, r))));
  const { phaseDeg } = fourierPhase(thetas, clipped, teeth);
  return {
    measured: true,
    teeth,
    conePointZ: round(conePointZ),
    coneAngleDeg: round(coneAngleDeg, 2),
    pitchRadiusMm: round((widest.tip + widest.root) / 2),
    toothPhaseDeg: round(phaseDeg, 2),
    faceSpanMm: [round(faceLo, 2), round(faceHi, 2)]
  };
}

/**
 * Crown gear teeth on one face, about the part's local Z axis (design §1): rays come down the axis
 * onto rings of several radii from each face; the face whose heights show a `teeth`-fold pattern
 * carries the teeth. Returns { measured: true, teeth, diametralPitch, moduleMm, toothFace (±1 along
 * Z), tipPlaneZ, pitchPlaneZ, ringRadiiMm, pitchRadiusMm, toothSpacingMm, toothPhaseDeg } or
 * { measured: false, reason }.
 */
export function measureCrownGear(part, teeth) {
  if (!teeth || teeth < 6) return { measured: false, reason: 'no tooth count' };
  const cast = makeRaycaster(part);
  const axis = new THREE.Vector3(0, 0, 1);
  const [u, v] = refAxes(axis);
  const { min, max } = part.bbox;
  const outer = Math.min(...[min[0], min[1], max[0], max[1]].map(Math.abs));
  const ringAt = (face, r, count = 720) => {
    const start = face > 0 ? max[2] + 2 : min[2] - 2;
    const thetas = [];
    const heights = []; // how far out toward `face` the surface is
    for (let i = 0; i < count; i++) {
      const th = (i / count) * Math.PI * 2;
      const origin = u.clone().multiplyScalar(r * Math.cos(th)).addScaledVector(v, r * Math.sin(th)).setZ(start);
      const d = cast(origin, new THREE.Vector3(0, 0, -face));
      thetas.push(th);
      heights.push(d == null ? null : face * (start - face * d));
    }
    return { thetas, heights };
  };
  let best = null;
  for (const face of [1, -1]) {
    const rings = [];
    for (let r = outer * 0.3; r <= outer - 0.15 + 1e-6; r += 0.25) {
      const { thetas, heights } = ringAt(face, r);
      const { tip, root } = tipAndRoot(thetas, heights, teeth);
      if (!(tip - root > 0.5)) continue;
      const clipped = heights.map((h) => (h == null ? null : Math.min(tip, Math.max(root, h))));
      const { amplitude } = fourierPhase(thetas, clipped, teeth);
      if (amplitude >= MIN_TOOTH_AMPLITUDE * (tip - root)) rings.push({ r, tip, root, amplitude });
    }
    if (rings.length >= 3 && (!best || rings.length > best.rings.length)) best = { face, rings };
  }
  if (!best) return { measured: false, reason: 'no face tooth pattern found' };
  // Rings at the edges of the tooth ring only catch part of each tooth
  const deepest = Math.max(...best.rings.map((g) => g.tip - g.root));
  const face = best.face;
  const rings = best.rings.filter((g) => g.tip - g.root >= 0.7 * deepest);
  const tip = median(rings.map((g) => g.tip));
  const root = median(rings.map((g) => g.root));
  const snapped = snapModule((tip - root) / 2.25);
  if (!snapped) return { measured: false, reason: `tooth depth ${(tip - root).toFixed(2)} mm is not a VEX IQ gear size` };
  const inner = Math.min(...rings.map((g) => g.r)) - 0.125;
  const outerR = Math.max(...rings.map((g) => g.r)) + 0.125;
  const midR = (inner + outerR) / 2;
  const { thetas, heights } = ringAt(face, midR, RAY_COUNT);
  const clipped = heights.map((h) => (h == null ? null : Math.min(tip, Math.max(root, h))));
  const { phaseDeg } = fourierPhase(thetas, clipped, teeth);
  // Heights are measured outward along `face`; back to Z
  const tipPlaneZ = face * tip;
  return {
    measured: true,
    teeth,
    diametralPitch: snapped.dp,
    moduleMm: round(snapped.moduleMm, 4),
    toothFace: face,
    tipPlaneZ: round(tipPlaneZ),
    pitchPlaneZ: round(tipPlaneZ - face * snapped.moduleMm),
    ringRadiiMm: [round(inner, 2), round(outerR, 2)],
    pitchRadiusMm: round(midR),
    toothSpacingMm: round(Math.PI * snapped.moduleMm),
    toothPhaseDeg: round(phaseDeg, 2)
  };
}

const WORM_SPACING_AGREE_MM = 0.05; // the thread spacing found at each angle must agree this well

/**
 * Worm thread about the part's local Z axis (design §1). At angles round the axis (refAxes frame),
 * inward rays along the length give radius against position: a wave whose period is the thread
 * spacing, and whose crest moves along the axis from one angle to the next by the lead.
 * `hand` is +1 when turning the worm by +θ about +Z moves a crest (seen at a fixed direction) by
 * +lead·θ/360 along Z. Returns { measured: true, diametralPitch, moduleMm, threadSpacingMm, leadMm,
 * starts, hand, tipRadiusMm, rootRadiusMm, pitchRadiusMm, threadSpanMm, threadPhaseMm } or
 * { measured: false, reason }.
 */
export function measureWormGear(part) {
  const cast = makeRaycaster(part);
  const axis = new THREE.Vector3(0, 0, 1);
  const [u, v] = refAxes(axis);
  const { min, max } = part.bbox;
  const startR = Math.max(...[min[0], min[1], max[0], max[1]].map(Math.abs)) + 3;
  const STEP = 0.02;
  const ANGLES = 12;
  const profiles = [];
  for (let j = 0; j < ANGLES; j++) {
    const th = (j / ANGLES) * Math.PI * 2;
    const dir = u.clone().multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th));
    const zs = [];
    const rs = [];
    for (let z = min[2] + 0.1; z <= max[2] - 0.1 + 1e-6; z += STEP) {
      const d = cast(dir.clone().multiplyScalar(startR).setZ(z), dir.clone().negate());
      zs.push(z);
      rs.push(d == null || d > startR ? null : startR - d);
    }
    profiles.push({ th, zs, rs });
  }
  const all = profiles.flatMap((p) => p.rs).filter((r) => r != null);
  const tip = Math.max(...all);
  const root = Math.min(...all);
  if (!(tip - root > 0.5)) return { measured: false, reason: 'no thread found' };
  const clip = (rs) => rs.map((r) => (r == null ? null : Math.min(tip, Math.max(root, r))));
  // The period with the strongest wave, scanned round each VEX IQ tooth spacing
  const strength = (period) =>
    profiles.reduce((s, p) => s + fourierPhase(p.zs.map((z) => (2 * Math.PI * z) / period), clip(p.rs), 1).amplitude, 0);
  let bestPeriod = null;
  for (const dp of DIAMETRAL_PITCHES) {
    const spacing = (Math.PI * 25.4) / dp;
    for (let f = 0.9; f <= 1.1 + 1e-9; f += 0.0025) {
      const s = strength(spacing * f);
      if (!bestPeriod || s > bestPeriod.s) bestPeriod = { period: spacing * f, s };
    }
  }
  const period = bestPeriod.period;
  const snapped = snapModule(period / Math.PI);
  if (!snapped || Math.abs(period - Math.PI * snapped.moduleMm) / (Math.PI * snapped.moduleMm) > 0.02) {
    return { measured: false, reason: `thread spacing ${period.toFixed(3)} mm is not a VEX IQ tooth spacing` };
  }
  // Each angle's crests (the middle of each run at the tip): their spacing must agree round the
  // worm (a clean, regular thread), and where the first one sits gives the lead
  const crestLevel = tip - 0.15 * (tip - root);
  const found = profiles
    .map((p) => {
      const centers = [];
      let start = null;
      p.rs.forEach((r, i) => {
        const high = r != null && r >= crestLevel;
        if (high && start == null) start = i;
        if ((!high || i === p.rs.length - 1) && start != null) {
          const end = high ? i : i - 1;
          // Runs cut off by the worm's ends don't show the crest's middle
          if (start > 0 && end < p.rs.length - 1) centers.push((p.zs[start] + p.zs[end]) / 2);
          start = null;
        }
      });
      if (centers.length < 3) return null;
      const fit = fitLine(centers.map((c) => [Math.round((c - centers[0]) / period), c]));
      return { th: p.th, spacing: fit.b, crest: fit.a };
    })
    .filter(Boolean);
  if (found.length < profiles.length / 2) return { measured: false, reason: 'too few thread crests found' };
  const own = found.map((f) => f.spacing);
  if (Math.max(...own) - Math.min(...own) > WORM_SPACING_AGREE_MM) {
    return { measured: false, reason: `thread spacing differs round the worm by ${(Math.max(...own) - Math.min(...own)).toFixed(3)} mm` };
  }
  const meanSpacing = own.reduce((x, y) => x + y, 0) / own.length;
  if (Math.abs(meanSpacing - Math.PI * snapped.moduleMm) / (Math.PI * snapped.moduleMm) > 0.02) {
    return { measured: false, reason: `thread spacing ${meanSpacing.toFixed(3)} mm is not a VEX IQ tooth spacing` };
  }
  // Crest position along Z at each angle, brought into one period and unwrapped round the turn
  const crests = found.map((f) => mod(f.crest, meanSpacing));
  const unwrapped = [crests[0]];
  for (let j = 1; j < crests.length; j++) {
    let c = crests[j];
    while (c - unwrapped[j - 1] > meanSpacing / 2) c -= meanSpacing;
    while (c - unwrapped[j - 1] < -meanSpacing / 2) c += meanSpacing;
    unwrapped.push(c);
  }
  const line = fitLine(found.map((f, j) => [THREE.MathUtils.radToDeg(f.th), unwrapped[j]]));
  // Crest at part angle θ sits at z0 + c·θ; turning the part by +δ brings part angle θ−δ to a fixed
  // direction, so the crest seen there moves by −c·δ
  const leadMm = Math.abs(line.b) * 360;
  const starts = Math.max(1, Math.round(leadMm / meanSpacing));
  if (Math.abs(leadMm - starts * meanSpacing) > 0.1 * meanSpacing) {
    return { measured: false, reason: `lead ${leadMm.toFixed(2)} mm is not a whole number of thread spacings` };
  }
  const hand = -Math.sign(line.b) || 1;
  // The threaded length: where some angle reaches near the tip
  const reach = tip - 0.3 * (tip - root);
  const threaded = profiles[0].zs.filter((z, i) => profiles.some((p) => p.rs[i] != null && p.rs[i] >= reach));
  const spacing = Math.PI * snapped.moduleMm;
  // Pitch radius: tip minus one module (6.23 mm on the VEX IQ worm) is within 0.2 mm of an
  // eighth-pitch step, and the worm meshes free of contact at that step too (25.4 mm from a 36 Tooth
  // Gear, checked 2026-11-12), so it is taken to be drawn on the grid: shafts then land in holes.
  const rawPitch = tip - snapped.moduleMm;
  const gridPitch = Math.round(rawPitch / (VEX_PITCH_MM / 8)) * (VEX_PITCH_MM / 8);
  const pitchRadiusMm = Math.abs(rawPitch - gridPitch) <= 0.2 ? gridPitch : rawPitch;
  return {
    measured: true,
    diametralPitch: snapped.dp,
    moduleMm: round(snapped.moduleMm, 4),
    threadSpacingMm: round(spacing),
    leadMm: round(starts * spacing),
    starts,
    hand,
    tipRadiusMm: round(tip),
    rootRadiusMm: round(root),
    pitchRadiusMm: round(pitchRadiusMm),
    threadSpanMm: [round(Math.min(...threaded), 2), round(Math.max(...threaded), 2)],
    threadPhaseMm: round(mod(line.a, spacing), 3)
  };
}

/**
 * Shape of a shaft bore or socket feature (from getLocalFeatures): rays go out from its axis at
 * several depths; the depth with the strongest 4-fold pattern decides. Square when that pattern's
 * amplitude is over SQUARE_MIN_AMPLITUDE of the mean wall distance; the flat angle is the direction
 * of a flat's normal (a minimum of the wall distance), 0–90°.
 * Returns { shape: 'square', squarePhaseDeg, halfWidthMm } or { shape: 'round' } (also when unmeasurable).
 */
export function measureOpeningShape(part, feature) {
  const cast = makeRaycaster(part);
  const axis = new THREE.Vector3(...feature.axis);
  const t0 = feature.origin[0] * axis.x + feature.origin[1] * axis.y + feature.origin[2] * axis.z;
  const lo = Number.isFinite(feature.tMin) ? feature.tMin : t0 - 3;
  const hi = Number.isFinite(feature.tMax) ? feature.tMax : t0 + 3;
  let best = null;
  for (let i = 1; i <= 9; i++) {
    const t = lo + ((hi - lo) * i) / 10;
    const center = new THREE.Vector3(...feature.origin).addScaledVector(axis, t - t0);
    const { thetas, dists } = outwardProfile(cast, center, axis, 360);
    const clipped = dists.map((d) => (d == null || d >= 6 ? null : d));
    const valid = clipped.filter((d) => d != null);
    if (valid.length < 300) continue;
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const { amplitude } = fourierPhase(thetas, clipped, 4);
    if (!best || amplitude / mean > best.score) best = { center, score: amplitude / mean };
  }
  if (!best || best.score < SQUARE_MIN_AMPLITUDE) return { shape: 'round' };
  const { thetas, dists } = outwardProfile(cast, best.center, axis);
  const neg = dists.map((d) => (d == null || d >= 6 ? null : -d));
  const { phaseDeg } = fourierPhase(thetas, neg, 4);
  const half = Math.min(...dists.filter((d) => d != null));
  return { shape: 'square', squarePhaseDeg: round(phaseDeg, 2), halfWidthMm: round(half) };
}

/**
 * Flat angle of a square shaft along local Z through the origin: rays come in toward the axis at
 * several points along `tRange`; the flats are the minima of the radius. The 4-fold vectors of the
 * sections are summed so round sections (caps, collars) count little. Returns { squarePhaseDeg,
 * halfWidthMm }, or null when the shaft is not square.
 */
export function measureShaftFlat(part, tRange) {
  const cast = makeRaycaster(part);
  const axis = new THREE.Vector3(0, 0, 1);
  const [lo, hi] = tRange;
  let c = 0;
  let s = 0;
  let amp = 0;
  let meanSum = 0;
  let n = 0;
  let half = Infinity;
  for (let i = 1; i <= 9; i++) {
    const t = lo + ((hi - lo) * i) / 10;
    const { thetas, radii } = inwardProfile(cast, new THREE.Vector3(0, 0, t), axis, 6, 360);
    const valid = radii.filter((r) => r != null);
    if (valid.length < 300) continue;
    const f = fourierPhase(thetas, radii.map((r) => (r == null ? null : -r)), 4);
    const ph = THREE.MathUtils.degToRad(f.phaseDeg) * 4;
    c += f.amplitude * Math.cos(ph);
    s += f.amplitude * Math.sin(ph);
    amp += f.amplitude;
    meanSum += valid.reduce((a, b) => a + b, 0) / valid.length;
    half = Math.min(half, ...valid);
    n++;
  }
  if (n === 0 || amp / meanSum < SQUARE_MIN_AMPLITUDE) return null;
  const phaseDeg = mod(THREE.MathUtils.radToDeg(Math.atan2(s, c)) / 4, 90);
  return { squarePhaseDeg: round(phaseDeg, 2), halfWidthMm: round(half) };
}

/**
 * The Smart Motor's turning hub around its drive socket: the smallest STEP cylinder coaxial with
 * the socket that is wider than the socket's square corners; it runs from the hub's face down to
 * the socket's floor. `cylinders` are the part's STEP cylinders (part-local mm). Offsets are along
 * the socket axis from the socket's origin.
 */
export function measureMotorHub(part, socketFeature, socketShape, cylinders) {
  const cast = makeRaycaster(part);
  const axis = new THREE.Vector3(...socketFeature.axis);
  const origin = new THREE.Vector3(...socketFeature.origin);
  const diag = (socketShape.halfWidthMm || 1.6) * Math.SQRT2;
  const radii = cylinders
    .filter((c) => {
      const ca = new THREE.Vector3(...c.axis).normalize();
      if (Math.abs(ca.dot(axis)) < 0.999) return false;
      const off = new THREE.Vector3(...c.origin).sub(origin);
      const lateral = off.clone().addScaledVector(axis, -off.dot(axis)).length();
      return lateral < 0.05 && c.radius > diag + 0.2;
    })
    .map((c) => c.radius)
    .sort((a, b) => a - b);
  if (!radii.length) return null;
  const radiusMm = radii[0];
  const [u] = refAxes(axis);
  const above = 20;
  const heightAt = (r) => {
    const o = origin.clone().addScaledVector(u, r).addScaledVector(axis, above);
    const d = cast(o, axis.clone().negate());
    return d == null ? null : above - d;
  };
  const face = heightAt((diag + radiusMm) / 2);
  const floor = heightAt(0);
  if (face == null || floor == null) return null;
  return { radiusMm: round(radiusMm), faceOffsetMm: round(face), depthMm: round(face - floor) };
}

// Spools (openspec rope-and-spool, design §4)
export const SPOOL_PATTERN = /\bSpool\b/i;

/**
 * A spool about its local Z axis, from rays cast across it every 0.1 mm along Z: the drum's core
 * radius and span, the flange radius, the square bore (at one end) and the round pocket at the
 * other end with the slot the rope leaves it by. Returns { measured: true, axis, coreRadiusMm,
 * flangeRadiusMm, drumSpanMm, bore: { spanMm, halfWidthMm, squarePhaseDeg }, pocket: { center,
 * radiusMm, spanMm, slotDeg } } or { measured: false, reason }.
 */
export function measureSpool(part) {
  const cast = makeRaycaster(part);
  const { min, max } = part.bbox;
  const R0 = Math.max(...[min[0], min[1], max[0], max[1]].map(Math.abs)) + 10;
  const ANGLES = 36;
  const rows = [];
  for (let z = min[2] + 0.05; z < max[2]; z += 0.1) {
    const outer = [];
    const inner = [];
    for (let k = 0; k < ANGLES; k++) {
      const t = (k / ANGLES) * Math.PI * 2;
      const d = new THREE.Vector3(Math.cos(t), Math.sin(t), 0);
      const o = cast(new THREE.Vector3(R0 * d.x, R0 * d.y, z), d.clone().negate());
      outer.push(o == null ? null : R0 - o);
      inner.push(cast(new THREE.Vector3(0, 0, z), d));
    }
    rows.push({ z, outer, inner });
  }
  const med = (a) => median(a.filter((x) => x != null));
  // The drum: the most common outer radius over the middle half
  const mid = rows.filter((r) => Math.abs(r.z - (min[2] + max[2]) / 2) < (max[2] - min[2]) / 4);
  const core = median(mid.map((r) => med(r.outer)));
  if (!Number.isFinite(core) || core < 3) return { measured: false, reason: 'drum not found' };
  const onDrum = rows.filter((r) => Math.abs(med(r.outer) - core) < 0.1);
  const drumSpanMm = [round(Math.min(...onDrum.map((r) => r.z)) - 0.05, 2), round(Math.max(...onDrum.map((r) => r.z)) + 0.05, 2)];
  const flange = Math.max(...rows.map((r) => Math.max(...r.outer.filter((x) => x != null))));
  // The pocket: rows whose inner radius is a round 3.5..5 mm with a slot (rays that miss) one way
  const pocketRows = rows.filter((r) => {
    const m = med(r.inner);
    return m > 3.5 && m < 5 && r.inner.some((x) => x == null);
  });
  if (!pocketRows.length) return { measured: false, reason: 'pocket not found' };
  const pz = pocketRows.map((r) => r.z);
  const pocketSpan = [Math.min(...pz) - 0.05, Math.max(...pz) + 0.05];
  // The pocket's mouth widens into the flange; it runs to the spool's end on its side
  const pocketEnd = Math.abs(pocketSpan[1] - max[2]) < Math.abs(pocketSpan[0] - min[2]) ? max[2] : min[2];
  const span = pocketEnd === max[2] ? [pocketSpan[0], max[2]] : [min[2], pocketSpan[1]];
  const pocketRadius = median(pocketRows.map((r) => med(r.inner)));
  // The slot: the middle of the rays that miss
  let sx = 0;
  let sy = 0;
  for (const r of pocketRows)
    r.inner.forEach((x, k) => {
      if (x != null) return;
      const t = (k / ANGLES) * Math.PI * 2;
      sx += Math.cos(t);
      sy += Math.sin(t);
    });
  const slotDeg = round(mod(THREE.MathUtils.radToDeg(Math.atan2(sy, sx)), 360), 1);
  // The square bore: the rows at the other end whose inner radius is under 2.5 mm
  const boreRows = rows.filter((r) => (pocketEnd === max[2] ? r.z < 0 : r.z > 0) && med(r.inner) < 2.4);
  if (!boreRows.length) return { measured: false, reason: 'bore not found' };
  const bz = boreRows.map((r) => r.z);
  const boreSpan = [round(Math.min(...bz) - 0.05, 2), round(Math.max(...bz) + 0.05, 2)];
  const shape = measureOpeningShape(part, { origin: [0, 0, (boreSpan[0] + boreSpan[1]) / 2], axis: [0, 0, 1], tMin: boreSpan[0], tMax: boreSpan[1] });
  if (shape.shape !== 'square') return { measured: false, reason: 'bore is not square' };
  return {
    measured: true,
    axis: [0, 0, 1],
    coreRadiusMm: round(core, 2),
    flangeRadiusMm: round(flange, 2),
    drumSpanMm,
    bore: { spanMm: boreSpan, halfWidthMm: shape.halfWidthMm, squarePhaseDeg: shape.squarePhaseDeg },
    pocket: { center: [0, 0, round((span[0] + span[1]) / 2, 2)], radiusMm: round(pocketRadius, 2), spanMm: span.map((z) => round(z, 2)), slotDeg }
  };
}

/**
 * A pulley's groove about its local Z axis (openspec rope-and-spool, task 1.4): the radius at the
 * groove's bottom and the span along Z where the groove is below the rim. Returns
 * { grooveRadiusMm, grooveSpanMm } or null.
 */
export function measurePulleyGroove(part) {
  const cast = makeRaycaster(part);
  const { min, max } = part.bbox;
  const R0 = Math.max(...[min[0], min[1], max[0], max[1]].map(Math.abs)) + 10;
  const rows = [];
  for (let z = min[2] + 0.05; z < max[2]; z += 0.05) {
    const radii = [];
    for (let k = 0; k < 12; k++) {
      const t = ((k + 0.37) / 12) * Math.PI * 2;
      const d = cast(new THREE.Vector3(R0 * Math.cos(t), R0 * Math.sin(t), z), new THREE.Vector3(-Math.cos(t), -Math.sin(t), 0));
      if (d != null) radii.push(R0 - d);
    }
    if (radii.length) rows.push({ z, r: median(radii) });
  }
  if (!rows.length) return null;
  const rim = Math.max(...rows.map((r) => r.r));
  // The groove: rows between the two rim flanges
  const rimRows = rows.filter((r) => r.r > rim - 0.1).map((r) => r.z);
  const lo = Math.min(...rimRows.filter((z) => z < (min[2] + max[2]) / 2));
  const hi = Math.max(...rimRows.filter((z) => z > (min[2] + max[2]) / 2));
  const inGroove = rows.filter((r) => r.z > lo && r.z < hi && r.r < rim - 0.3);
  if (!inGroove.length) return null;
  const bottom = Math.min(...inGroove.map((r) => r.r));
  const flat = inGroove.filter((r) => r.r < bottom + 0.1).map((r) => r.z);
  return { grooveRadiusMm: round(bottom, 2), grooveSpanMm: [round(Math.min(...flat), 2), round(Math.max(...flat), 2)] };
}

// Linear motion and idler pins (openspec linear-motion-and-idler-pins, design §1 and §6)
export const CONTINUOUS_RACK_PATTERN = /Continuous Linear Motion Rack/i;
export const LINEAR_BRACKET_PATTERN = /Linear Motion Bracket/i;
// The idler pins the spec names; which of their ends a gear turns on is measured (measureIdlerPin)
export const IDLER_PIN_PATTERN = /\bIdler Pin\b/i;

const axisVec = (a) => new THREE.Vector3(...a);
const signedUnit = (i, sign = 1) => new THREE.Vector3().setComponent(i, sign);
/** The part's bbox range along a local unit axis. */
function bboxAlong(part, axis) {
  const { min, max } = part.bbox;
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
    const t = x * axis.x + y * axis.y + z * axis.z;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return [lo, hi];
}

/**
 * The continuous rack's clip seat (design §1): the flat underside that lies on a beam's face (on the
 * side away from the teeth), the clip legs that go through the beam's holes, and the rail (the
 * rack's widest band) that slides in a linear motion bracket's slot. Rays are cast from the beam
 * side every 0.25 mm and across the rack every 0.1 mm of height. All in part-local mm, heights
 * along `rackSpecs.normal` (the way the teeth face): { measured: true, direction, seatNormal (from
 * the rack into the beam), seatHeightMm, legs: [{ at (the leg's centre on the seat face), depthMm }],
 * lengthSpanMm, centerAcrossMm, rail: { heightSpanMm, halfWidthMm } } or { measured: false, reason }.
 */
export function measureClipSeat(part, rackSpecs) {
  if (!rackSpecs?.measured) return { measured: false, reason: 'rack teeth not measured' };
  const cast = makeRaycaster(part);
  const dir = axisVec(rackSpecs.direction);
  const nrm = axisVec(rackSpecs.normal);
  const acr = axisVec(rackSpecs.axis);
  const [sLo, sHi] = bboxAlong(part, dir);
  const [hLo, hHi] = bboxAlong(part, nrm);
  const [aLo, aHi] = bboxAlong(part, acr);
  const at = (s, h, a) => dir.clone().multiplyScalar(s).addScaledVector(nrm, h).addScaledVector(acr, a);
  // Up from under the seat side: the first height each ray meets
  const hits = [];
  for (let s = sLo + 0.125; s < sHi; s += 0.25) {
    for (let a = aLo + 0.125; a < aHi; a += 0.25) {
      const d = cast(at(s, hLo - 2, a), nrm);
      if (d != null) hits.push({ s, a, h: hLo - 2 + d });
    }
  }
  if (!hits.length) return { measured: false, reason: 'no underside found' };
  // The seat: the most common first height (the flat face), to 0.05 mm
  const counts = new Map();
  for (const x of hits) {
    const k = Math.round(x.h * 20);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const mode = [...counts.entries()].sort((p, q) => q[1] - p[1])[0][0] / 20;
  const flat = hits.filter((x) => Math.abs(x.h - mode) < 0.15);
  const seat = Math.min(...flat.map((x) => x.h));
  // Legs: what reaches more than 1 mm past the seat, grouped along the rack
  const below = hits.filter((x) => x.h < seat - 1).sort((p, q) => p.s - q.s);
  const groups = [];
  for (const x of below) {
    const g = groups[groups.length - 1];
    if (g && x.s - g[g.length - 1].s <= 1) g.push(x);
    else groups.push([x]);
  }
  const legs = groups
    .filter((g) => g.length >= 4)
    .map((g) => {
      const s = (Math.min(...g.map((x) => x.s)) + Math.max(...g.map((x) => x.s))) / 2;
      const a = (Math.min(...g.map((x) => x.a)) + Math.max(...g.map((x) => x.a))) / 2;
      return { at: at(s, seat, a).toArray().map((v) => round(v + 0, 3)), depthMm: round(seat - Math.min(...g.map((x) => x.h)), 2) };
    });
  if (!legs.length) return { measured: false, reason: 'no clip legs found' };
  // Width at each height, from both sides, between the legs
  const sSamples = [];
  for (let k = 0; k < 24; k++) {
    const s = sLo + (sHi - sLo) * (0.1 + (0.8 * k) / 23);
    if (legs.every((l) => Math.abs(axisVec(l.at).dot(dir) - s) > 4)) sSamples.push(s);
  }
  const rows = [];
  for (let h = seat + 0.05; h < hHi; h += 0.1) {
    const his = [];
    const los = [];
    for (const s of sSamples) {
      const dp = cast(at(s, h, aHi + 2), acr.clone().negate());
      const dm = cast(at(s, h, aLo - 2), acr);
      if (dp != null) his.push(aHi + 2 - dp);
      if (dm != null) los.push(aLo - 2 + dm);
    }
    if (his.length >= sSamples.length / 2 && los.length >= sSamples.length / 2) rows.push({ h, hi: median(his), lo: median(los) });
  }
  const widest = Math.max(...rows.map((r) => r.hi - r.lo));
  const railRows = rows.filter((r) => r.hi - r.lo > widest - 0.2);
  if (!railRows.length) return { measured: false, reason: 'rail not found' };
  // One band: the run of widest rows nearest the seat's far side (the teeth sit above it)
  const band = [railRows[0]];
  for (const r of railRows.slice(1)) if (r.h - band[band.length - 1].h < 0.25) band.push(r);
  const centre = median(band.map((r) => (r.hi + r.lo) / 2));
  return {
    measured: true,
    direction: dir.toArray(),
    seatNormal: nrm.clone().negate().toArray().map((v) => v + 0),
    seatHeightMm: round(seat, 2),
    legs,
    lengthSpanMm: [round(sLo, 2), round(sHi, 2)],
    centerAcrossMm: round(centre, 2),
    rail: {
      heightSpanMm: [round(band[0].h - 0.05, 2), round(band[band.length - 1].h + 0.05, 2)],
      halfWidthMm: round(median(band.map((r) => (r.hi - r.lo) / 2)), 2)
    }
  };
}

/**
 * A linear motion bracket's channel (design §1): the T-shaped slot a rack's rail slides in. For each
 * local axis as the channel's direction and each side as its open face, rays are cast along the
 * direction through the whole part every 0.1 mm; where none hits, the channel is open there. Going
 * in from the open face, a channel is a mouth (between the lips) narrower than the slot under it.
 * Returns { measured: true, direction, open (out of the mouth), across, centerAcrossMm, faceMm (the
 * outer face the beam lies on), mouth: { spanMm, halfWidthMm }, slot: { spanMm, halfWidthMm },
 * spanMm (along the direction) } in part-local mm, heights along `open`, or { measured: false, reason }.
 */
export function measureChannel(part) {
  const cast = makeRaycaster(part);
  const STEP = 0.1;
  let best = null;
  for (let k = 0; k < 3; k++) {
    const dir = signedUnit(k);
    const [dLo, dHi] = bboxAlong(part, dir);
    for (const ni of [0, 1, 2].filter((i) => i !== k)) {
      const wi = 3 - k - ni;
      const across = signedUnit(wi);
      const [wLo, wHi] = bboxAlong(part, across);
      const w0 = (wLo + wHi) / 2;
      for (const sign of [1, -1]) {
        const open = signedUnit(ni, sign);
        const [uLo, uHi] = bboxAlong(part, open);
        const freeAt = (u, w) => {
          const o = dir.clone().multiplyScalar(dLo - 1).addScaledVector(open, u).addScaledVector(across, w);
          const d = cast(o, dir);
          return d == null || d > dHi - dLo + 2;
        };
        // The open half-width round the middle at each height, from the face inwards (null: open to the side)
        const rows = [];
        for (let u = uHi - STEP / 2; u > uLo; u -= STEP) {
          if (!freeAt(u, w0)) break;
          let a = 0;
          while (w0 + a + STEP <= wHi + 0.5 && freeAt(u, w0 + a + STEP)) a += STEP;
          let b = 0;
          while (w0 - b - STEP >= wLo - 0.5 && freeAt(u, w0 - b - STEP)) b += STEP;
          const bounded = w0 + a + STEP <= wHi + 0.5 && w0 - b - STEP >= wLo - 0.5;
          rows.push({ u, half: bounded ? Math.min(a, b) + STEP / 2 : null });
        }
        const inside = rows.filter((r) => r.half !== null);
        if (inside.length < 10) continue;
        // Runs of one width (within 0.15 mm)
        const runs = [];
        for (const r of inside) {
          const last = runs[runs.length - 1];
          if (last && Math.abs(r.half - last.half) <= 0.15 && last.lo - r.u < STEP * 1.5) {
            last.lo = r.u;
            last.halves.push(r.half);
          } else runs.push({ hi: r.u, lo: r.u, half: r.half, halves: [r.half] });
        }
        for (const run of runs) run.half = median(run.halves);
        const long = runs.filter((r) => r.hi - r.lo >= 0.7);
        if (long.length < 2) continue;
        const [mouth, slot] = long;
        if (!(slot.half > mouth.half + 0.4)) continue;
        const face = rows.find((r) => r.half !== null).u + STEP / 2;
        const score = (slot.hi - slot.lo) + (mouth.hi - mouth.lo);
        if (!best || score > best.score) {
          best = {
            score,
            measured: true,
            direction: dir.toArray(),
            open: open.toArray(),
            across: across.toArray(),
            centerAcrossMm: round(w0, 2),
            faceMm: round(face, 2),
            mouth: { spanMm: [round(mouth.lo - STEP / 2, 2), round(mouth.hi + STEP / 2, 2)], halfWidthMm: round(mouth.half, 2) },
            slot: { spanMm: [round(slot.lo - STEP / 2, 2), round(slot.hi + STEP / 2, 2)], halfWidthMm: round(slot.half, 2) },
            spanMm: [round(dLo, 2), round(dHi, 2)]
          };
        }
      }
    }
  }
  if (!best) return { measured: false, reason: 'no T-shaped channel found' };
  const { score, ...specs } = best;
  return specs;
}

/**
 * Which ends of an idler pin a gear turns on (design §6): along the pin's local Z, the end runs whose
 * cross-section has flats (1.7 to 2.4 mm out at its widest, at least 0.3 mm less across its flats;
 * a snap ridge on a smooth end keeps its flats), at least 2 mm long and reaching the pin's tip. A connector pin's snap ends are round.
 * Returns { measured: true, axis: [0, 0, 1], smoothSpansMm: [[lo, hi]] } or { measured: false, reason }.
 */
export function measureIdlerPin(part) {
  const cast = makeRaycaster(part);
  const { min, max } = part.bbox;
  const R0 = 10;
  const rows = [];
  for (let z = min[2] + 0.05; z < max[2]; z += 0.1) {
    const radii = [];
    for (let k = 0; k < 36; k++) {
      const t = (k / 36) * Math.PI * 2;
      const d = cast(new THREE.Vector3(R0 * Math.cos(t), R0 * Math.sin(t), z), new THREE.Vector3(-Math.cos(t), -Math.sin(t), 0));
      if (d != null) radii.push(R0 - d);
    }
    if (!radii.length) continue;
    const hi = Math.max(...radii);
    const lo = Math.min(...radii);
    rows.push({ z, smooth: hi < 2.4 && hi > 1.7 && hi - lo >= 0.3 });
  }
  const runs = [];
  for (const r of rows) {
    const last = runs[runs.length - 1];
    if (last && last.smooth === r.smooth) last.hi = r.z;
    else runs.push({ smooth: r.smooth, lo: r.z, hi: r.z });
  }
  const spans = runs
    .filter((r) => r.smooth && r.hi - r.lo >= 2 && (r.lo - min[2] < 0.5 || max[2] - r.hi < 0.5))
    .map((r) => [round(r.lo - min[2] < 0.5 ? min[2] : r.lo - 0.05, 2), round(max[2] - r.hi < 0.5 ? max[2] : r.hi + 0.05, 2)]);
  if (!spans.length) return { measured: false, reason: 'no smooth end found' };
  return { measured: true, axis: [0, 0, 1], smoothSpansMm: spans };
}
