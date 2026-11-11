/**
 * The `band` shape kind (openspec rubber-bands): a rubber band or belt copy strung round a route.
 *
 *   shape = { kind: 'band', route: [{ instanceId, feature, side, wraps, height?, cross?, wrap? }],
 *             path: { points: [[x,y,z]...], ups: [[x,y,z]...], lengthMm } }
 *
 * `path` is the band's middle line (closed) in the band copy's own frame, solved by
 * src/utils/bandRoute.js from the route and the parts it names, and saved with it, so drawing a band
 * needs nothing but the band itself (thumbnails, the MCP server, history). `ups` is the band's width
 * direction at each point. The mesh is a flat rectangular section the band's width and thickness swept
 * along the path, with square edges; the catalog's flat ring is not used.
 */
import * as THREE from 'three';
import { BAND_KIND, bandSpec, isBandPart } from './bandPath.js';

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

function checkBand(shape) {
  if (!Array.isArray(shape.route) || shape.route.length < 2) return 'A band needs two or more spots.';
  if (!Array.isArray(shape.path?.points) || shape.path.points.length < 3) return 'A band needs its path.';
  return null;
}

const SECTION_STEP_MM = 2; // a section at least this often along the band, so a twist is gradual
const MAX_SECTIONS = 4000;

/**
 * The strip's sections along the path: per section, the middle, its width and thickness directions.
 * A flat band is the same either way up, so the width direction never turns more than a quarter
 * turn from one section to the next (no half-turn flips), and runs get a section every 2 mm with the
 * width direction turning evenly between their ends.
 */
function frames(shape, spec) {
  const pts = shape.path.points.map(v3);
  const ups = (shape.path.ups || []).map(v3);
  // Drop points on top of each other (where an arc meets a run)
  const keep = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = keep.length ? pts[keep[keep.length - 1]] : pts[pts.length - 1];
    if (prev.distanceTo(pts[i]) > 1e-3) keep.push(i);
  }
  const P0 = keep.map((i) => pts[i]);
  const U0 = keep.map((i) => (ups[i] ? ups[i].clone() : new THREE.Vector3(0, 0, 1)));
  const n0 = P0.length;
  let total = 0;
  for (let i = 0; i < n0; i++) total += P0[i].distanceTo(P0[(i + 1) % n0]);
  const step = Math.max(SECTION_STEP_MM, total / MAX_SECTIONS);
  // Along each piece of the path (a run, or a short step of a curve) the band's direction is fixed:
  // the width direction at each end is taken across that direction, and turns evenly round it from
  // one end to the other, by the smaller way (a flat band is the same either way up). An end whose
  // width direction lies along the band (a corner the band runs nearly along) takes the other end's.
  const across0 = (u, t) => u.clone().addScaledVector(t, -u.dot(t));
  const P = [];
  const T = [];
  const W = [];
  let prevEnd = null;
  for (let i = 0; i < n0; i++) {
    const a = P0[i];
    const b = P0[(i + 1) % n0];
    const t = b.clone().sub(a).normalize();
    let wa = across0(U0[i], t);
    let wb = across0(U0[(i + 1) % n0], t);
    const fallback = prevEnd ? across0(prevEnd, t) : across0(Math.abs(t.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), t);
    if (wa.length() < 0.3) wa = wb.length() >= 0.3 ? wb.clone() : fallback;
    if (wb.length() < 0.3) wb = wa.clone();
    wa.normalize();
    wb.normalize();
    // The same way up as the piece before, and the end the same way up as the start
    if (prevEnd && wa.dot(prevEnd) < 0) wa.negate();
    if (wb.dot(wa) < 0) wb.negate();
    const angle = Math.atan2(new THREE.Vector3().crossVectors(wa, wb).dot(t), wa.dot(wb));
    const k = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let s = 0; s < k; s++) {
      const f = s / k;
      P.push(a.clone().lerp(b, f));
      T.push(t);
      W.push(wa.clone().applyAxisAngle(t, angle * f));
    }
    prevEnd = wb;
  }
  const n = P.length;
  const out = [];
  let prevUp = null;
  for (let i = 0; i < n; i++) {
    // At a joint between pieces, the direction halfway between them
    const t = T[i].clone().add(T[(i - 1 + n) % n]).normalize();
    if (t.lengthSq() < 1e-6) t.copy(T[i]);
    const up = across0(W[i], t);
    if (up.lengthSq() < 1e-6) up.copy(prevUp || W[i]);
    up.normalize();
    if (prevUp && up.dot(prevUp) < 0) up.negate();
    prevUp = up.clone();
    const across = new THREE.Vector3().crossVectors(t, up).normalize();
    out.push({ p: P[i], up: up.multiplyScalar(spec.widthMm / 2), across: across.multiplyScalar(spec.thickMm / 2) });
  }
  return out;
}

// The band's section: a flat rectangle, its width across the post and its thickness out from it,
// with square edges (a moulded band is flat with sharp corners). Each of the four faces has its own
// vertices so the edges stay crisp; along the band the faces are smooth.
const FACES = [
  // [corner u, corner a] at the face's two edges, and its outward direction (u: width, a: thickness)
  { from: [1, 1], to: [-1, 1], normal: [0, 1] }, // outside face (away from the post)
  { from: [-1, -1], to: [1, -1], normal: [0, -1] }, // inside face (against the post)
  { from: [1, -1], to: [1, 1], normal: [1, 0] }, // one edge face
  { from: [-1, 1], to: [-1, -1], normal: [-1, 0] } // the other edge face
];

/** The band's strip mesh: a flat rectangular section swept along the closed path. */
function bandMesh(_pos, _norm, _idx, shape, part) {
  const spec = bandSpec(part) || { widthMm: 3, thickMm: 1.5 };
  const F = frames(shape, spec);
  const n = F.length;
  const pos = new Float32Array(n * FACES.length * 2 * 3);
  const norm = new Float32Array(n * FACES.length * 2 * 3);
  const idx = new Uint32Array(n * FACES.length * 6);
  const nrm = new THREE.Vector3();
  let m = 0;
  FACES.forEach((face, fi) => {
    const base = fi * n * 2;
    for (let i = 0; i < n; i++) {
      const f = F[i];
      nrm.copy(f.up).normalize().multiplyScalar(face.normal[0]).addScaledVector(f.across.clone().normalize(), face.normal[1]).normalize();
      [face.from, face.to].forEach(([u, a], e) => {
        const o = (base + i * 2 + e) * 3;
        pos[o] = f.p.x + f.up.x * u + f.across.x * a;
        pos[o + 1] = f.p.y + f.up.y * u + f.across.y * a;
        pos[o + 2] = f.p.z + f.up.z * u + f.across.z * a;
        norm[o] = nrm.x;
        norm[o + 1] = nrm.y;
        norm[o + 2] = nrm.z;
      });
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = base + i * 2;
      const b = a + 1;
      const c = base + j * 2;
      const d = c + 1;
      // Wound so the face looks outward (its two edges run from the width side round to the thickness
      // side, and the path runs forward)
      idx[m++] = a;
      idx[m++] = b;
      idx[m++] = c;
      idx[m++] = b;
      idx[m++] = d;
      idx[m++] = c;
    }
  });
  return { pos, norm, idx };
}

function bandBox(part, shape) {
  const spec = bandSpec(part) || { widthMm: 3, thickMm: 1.5 };
  const pad = Math.max(spec.widthMm, spec.thickMm) / 2;
  const box = new THREE.Box3();
  for (const p of shape.path.points) box.expandByPoint(v3(p));
  box.expandByScalar(pad);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const r = (n) => Number(n.toFixed(3)) + 0;
  return { min: box.min.toArray().map(r), max: box.max.toArray().map(r), size: size.toArray().map(r), center: center.toArray().map(r) };
}

/** Mirrored across the band's own plane perpendicular to `localAxis` ('x' | 'y' | 'z' or a vector). */
function mirrorBand(shape, localAxis) {
  const k = typeof localAxis === 'string' ? 'xyz'.indexOf(localAxis) : [0, 1, 2].reduce((best, i) => (Math.abs(localAxis[i]) > Math.abs(localAxis[best]) ? i : best), 0);
  const flip = (p) => p.map((c, i) => (i === k ? -c : c));
  // A mirror turns the loop's direction round: reverse the order so the band still runs the same way
  const points = shape.path.points.map(flip).reverse();
  const ups = (shape.path.ups || []).map(flip).reverse();
  return { ...shape, path: { ...shape.path, points, ups } };
}

function describeBand(shape) {
  const n = new Set((shape.route || []).map((s) => `${s.instanceId}|${s.feature}`)).size;
  const len = shape.path?.lengthMm;
  return `round ${n} spot${n === 1 ? '' : 's'}${len ? `, ${Math.round(len)} mm` : ''}`;
}

export const bandKind = {
  verb: 'String',
  accepts: isBandPart,
  check: checkBand,
  shapeMesh: bandMesh,
  shapePorts: () => [],
  shapeBox: bandBox,
  mirror: mirrorBand,
  describe: describeBand
};

export { BAND_KIND };
