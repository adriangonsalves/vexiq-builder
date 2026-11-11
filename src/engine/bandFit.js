/**
 * Whether a strung band overlaps a part (openspec rubber-bands, design decision 11): the one rule the
 * overlap check, the audit, place_band and the band-follow step share.
 *
 * The band's strip is sampled every 1 mm along its path, across its width at the middle of its
 * thickness (a band pressed on a part squashes flat). A part overlaps the band when a sample sits more than TIGHT_FIT_MM
 * inside that part's collision mesh. Left out: samples on the curve round a spot, against that spot's
 * own part (the spot's circle isn't the part's exact shape), and the first and last band width of a
 * run against the spot it leaves or reaches (the band twists there), and any gear the band passes a tooth gap
 * of (the band runs inside its outline there). Bands are not tested here (two bands on one spot lie side by side).
 */
import * as THREE from 'three';
import { TIGHT_FIT_MM, buildWorldMatrix, getPartCollisionBvh, partOf } from './core.js';
import { bandSpec, isBandPart } from '../utils/bandPath.js';
import { isRoutedBand, stringBand } from '../utils/bandRoute.js';

// Across the band's width at the middle of its thickness: rubber pressed on a part squashes flat, so
// its thickness isn't tested, only where its middle sheet lies
const SECTION = [[0, 0], [1, 0], [-1, 0], [0.5, 0], [-0.5, 0]];
const RAYS = [[1, 0.013, 0.007], [0.011, 1, 0.005], [0.009, 0.004, 1]].map((d) => new THREE.Vector3(...d).normalize());

const sampleCache = new WeakMap(); // band shape -> samples (the instances it was strung against are checked by key)

/**
 * The band's samples: [{ p: Vector3 (world), on: instanceId | null }], `on` the part whose spot the
 * sample curves round (or whose gap it passes by), against which it isn't tested.
 */
function bandSamples(band, instances) {
  const cached = sampleCache.get(band.shape);
  const poseKey = band.shape.route.map((s) => {
    const i = instances.find((x) => x.instanceId === s.instanceId);
    return i ? `${i.position}|${i.rotation}` : '-';
  }).join(';');
  if (cached && cached.key === poseKey) return cached.value;
  const part = partOf({ ...band, shape: undefined });
  const spec = bandSpec(part) || { widthMm: 3, thickMm: 1.5 };
  const strung = stringBand(band, band.shape.route, instances.filter((i) => i.instanceId !== band.instanceId), partOf);
  const samples = [];
  if (strung.error) return { samples, gears: new Set() };
  const off = v3(strung.position);
  const P = strung.shape.path.points.map((p) => v3(p).add(off));
  const U = strung.shape.path.ups.map(v3);
  const owners = strung.owners;
  const route = band.shape.route;
  const els = strung.elements;
  // Gap points, so samples near one are left out against its gear
  const gears = new Set(route.filter((_, k) => els[k]?.shape === 'slot').map((s) => s.instanceId));
  const n = P.length;
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[(i + 1) % n];
    const L = a.distanceTo(b);
    if (L < 1e-3) continue;
    // A curve round a spot: both ends on the same circle element
    const own = owners[i] === owners[(i + 1) % n] && els[owners[i]]?.shape === 'circle' ? route[owners[i]].instanceId : null;
    const t = b.clone().sub(a).normalize();
    const up = U[i].clone().addScaledVector(t, -U[i].dot(t));
    if (up.lengthSq() < 1e-9) up.copy(Math.abs(t.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).addScaledVector(t, -t.z);
    up.normalize();
    const across = new THREE.Vector3().crossVectors(t, up).normalize();
    const steps = Math.max(1, Math.ceil(L));
    for (let k = 0; k < steps; k++) {
      const q = a.clone().lerp(b, k / steps);
      // A run's first and last band width, against the spot it leaves or reaches: the strip twists
      // there as it turns off the spot, which a flat strip doesn't show
      const on = own || (q.distanceTo(a) < spec.widthMm ? route[owners[i]]?.instanceId : q.distanceTo(b) < spec.widthMm ? route[owners[(i + 1) % n]]?.instanceId : null) || null;
      for (const [x, y] of SECTION) samples.push({ p: q.clone().addScaledVector(up, x * (spec.widthMm / 2 - 0.05)).addScaledVector(across, y * (spec.thickMm / 2 - 0.05)), on });
    }
  }
  const value = { samples, gears };
  sampleCache.set(band.shape, { key: poseKey, value });
  return value;
}

/**
 * The parts among `instances` a routed band overlaps: [{ instanceId, label, depthMm }], deepest
 * first. `only`: test just these copies.
 */
export function bandOverlaps(band, instances, { only = null, report = null } = {}) {
  if (!isRoutedBand(band)) return [];
  const { samples, gears: skipGears } = bandSamples(band, instances);
  if (!samples.length) return [];
  const halfThick = (bandSpec(partOf({ ...band, shape: undefined }))?.thickMm || 1.5) / 2;
  const all = new THREE.Box3();
  for (const s of samples) all.expandByPoint(s.p);
  const out = [];
  const ray = new THREE.Ray();
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  for (const inst of instances) {
    if (inst.instanceId === band.instanceId || inst.visible === false || isRoutedBand(inst)) continue;
    if (only && !only.has(inst.instanceId)) continue;
    const part = partOf(inst);
    if (!part?.bbox || isBandPart(part)) continue;
    const m = buildWorldMatrix(inst.position, inst.rotation);
    const local = new THREE.Box3(v3(part.bbox.min), v3(part.bbox.max));
    if (!local.clone().applyMatrix4(m).intersectsBox(all)) continue;
    let pieces;
    try {
      const got = getPartCollisionBvh(part);
      pieces = (Array.isArray(got) ? got : got?.pieces || [got]).map((g) => g?.geo || g).filter((g) => g?.boundsTree);
    } catch {
      continue;
    }
    if (!pieces.length) continue;
    const inv = m.clone().invert();
    let depth = 0;
    let press = -Infinity; // how far the band's surface goes into the part (its thickness counted)
    const reach = local.clone().expandByScalar(halfThick);
    const lp = new THREE.Vector3();
    for (const s of samples) {
      if (s.on === inst.instanceId || skipGears.has(inst.instanceId)) continue;
      lp.copy(s.p).applyMatrix4(inv);
      if (!reach.containsPoint(lp)) continue;
      if (!local.containsPoint(lp)) {
        // Outside the part's box but within half the band's thickness of it: the surface may touch
        let dmin = Infinity;
        for (const g of pieces) {
          const r = g.boundsTree.closestPointToPoint(lp, hit);
          if (r) dmin = Math.min(dmin, r.distance);
        }
        press = Math.max(press, halfThick - dmin);
        continue;
      }
      let votes = 0;
      for (const d of RAYS) {
        ray.origin.copy(lp);
        ray.direction.copy(d);
        let c = 0;
        for (const g of pieces) c += g.boundsTree.raycast(ray, THREE.DoubleSide).length;
        if (c % 2) votes++;
      }
      let dmin = Infinity;
      for (const g of pieces) {
        const r = g.boundsTree.closestPointToPoint(lp, hit);
        if (r) dmin = Math.min(dmin, r.distance);
      }
      if (votes < 2) {
        press = Math.max(press, halfThick - dmin);
        continue;
      }
      press = Math.max(press, halfThick + dmin);
      if (dmin > depth) depth = dmin;
    }
    if (report) report[inst.label || inst.instanceId] = Number(press.toFixed(2));
    if (depth > TIGHT_FIT_MM) out.push({ instanceId: inst.instanceId, label: inst.label || part.name, depthMm: Number(depth.toFixed(2)) });
  }
  return out.sort((a, b) => b.depthMm - a.depthMm);
}

function v3(a) {
  return a?.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]);
}

/**
 * The instances with each routed band's `isIntersecting` set by the band rule (`ids`: only these
 * bands; default all). The same array when no flag changed.
 */
export function withBandFlags(instances, ids = null) {
  let out = instances;
  for (const band of instances) {
    if (!isRoutedBand(band) || (ids && !ids.includes(band.instanceId))) continue;
    const flag = bandOverlaps(band, instances).length > 0;
    if (Boolean(band.isIntersecting) === flag) continue;
    if (out === instances) out = [...instances];
    out = out.map((i) => (i.instanceId === band.instanceId ? { ...i, isIntersecting: flag } : i));
  }
  return out;
}
