import * as THREE from 'three';
import { getPartRawGeometry } from '../mcp/assembly-engine.mjs';
import { refAxes, wrapDeg } from '../src/utils/axisFrame.js';

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
