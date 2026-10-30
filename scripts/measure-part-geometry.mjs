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
    pitchRadiusMm: round((teeth * moduleMm) / 2),
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
