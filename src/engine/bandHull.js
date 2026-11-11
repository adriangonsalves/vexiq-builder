/**
 * The outer corners a band can bend round on a part (openspec rubber-bands, design decision 11): the
 * sharp edges of the convex hull of the part's mesh, in the part's own frame, cached per part. A
 * round part has none (its faces meet at small angles all the way round); a part with a post or
 * groove spot gives that circle instead. Gears give nothing: a band passes them through a tooth gap.
 */
import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { getPartRawGeometry } from './core.js';
import { partSpots } from '../utils/bandPath.js';

const SHARP_DEG = 15;
const MIN_EDGE_MM = 1;
const cache = new Map();
const hullCache = new Map();

/** The convex hull of a part's mesh in its own frame (three's ConvexHull), cached; null when it has none. */
export function partHull(part) {
  if (!part) return null;
  if (hullCache.has(part.id)) return hullCache.get(part.id);
  let hull = null;
  try {
    const a = getPartRawGeometry(part)?.attributes?.position?.array;
    if (a?.length) {
      const seen = new Set();
      const pts = [];
      for (let i = 0; i < a.length; i += 3) {
        const k = `${Math.round(a[i] * 100)},${Math.round(a[i + 1] * 100)},${Math.round(a[i + 2] * 100)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        pts.push(new THREE.Vector3(a[i], a[i + 1], a[i + 2]));
      }
      if (pts.length >= 4) hull = new ConvexHull().setFromPoints(pts);
    }
  } catch {
    hull = null;
  }
  hullCache.set(part.id, hull);
  return hull;
}

/**
 * [{ a: [x,y,z], b: [x,y,z], out: [x,y,z] }] for straight corners (`out`: the unit direction away
 * from the part, between the two faces' normals), and [{ circle: feature }] for a round spot.
 */
export function partWrapEdges(part) {
  if (!part) return [];
  if (cache.has(part.id)) return cache.get(part.id);
  const out = findEdges(part);
  cache.set(part.id, out);
  return out;
}

function findEdges(part) {
  if (part.gearSpecs?.teeth) return [];
  const round = partSpots(part).filter((s) => s.kind === 'post' || s.kind === 'groove').map((s) => ({ circle: s.feature }));
  const hull = partHull(part);
  if (!hull) return round;
  const cos = Math.cos(THREE.MathUtils.degToRad(SHARP_DEG));
  const edges = [];
  for (const f of hull.faces) {
    let e = f.edge;
    do {
      const tw = e.twin;
      if (tw && f.normal.dot(tw.face.normal) < cos) {
        const p = e.tail().point;
        const q = e.head().point;
        // Each edge once (its two half-edges)
        if (p.x < q.x || (p.x === q.x && (p.y < q.y || (p.y === q.y && p.z < q.z)))) {
          edges.push({ p: p.clone(), q: q.clone(), out: f.normal.clone().add(tw.face.normal).normalize() });
        }
      }
      e = e.next;
    } while (e !== f.edge);
  }
  // Join neighbours on one line (a long corner the hull splits at extra vertices)
  for (let joined = true; joined; ) {
    joined = false;
    outer: for (let i = 0; i < edges.length; i++) {
      for (let j = 0; j < edges.length; j++) {
        if (i === j) continue;
        const A = edges[i];
        const B = edges[j];
        const da = A.q.clone().sub(A.p).normalize();
        const db = B.q.clone().sub(B.p).normalize();
        if (Math.abs(da.dot(db)) < 0.9995) continue;
        let merged = null;
        if (A.q.distanceTo(B.p) < 0.05) merged = [A.p, B.q];
        else if (A.q.distanceTo(B.q) < 0.05) merged = [A.p, B.p];
        else if (A.p.distanceTo(B.p) < 0.05) merged = [A.q, B.q];
        else if (A.p.distanceTo(B.q) < 0.05) merged = [A.q, B.p];
        if (!merged) continue;
        edges[i] = { p: merged[0], q: merged[1], out: A.out.clone().add(B.out).normalize() };
        edges.splice(j, 1);
        joined = true;
        break outer;
      }
    }
  }
  const arr = (v) => [v.x, v.y, v.z].map((n) => Number(n.toFixed(3)) + 0);
  return [...edges.filter((e) => e.p.distanceTo(e.q) >= MIN_EDGE_MM).map((e) => ({ a: arr(e.p), b: arr(e.q), out: arr(e.out) })), ...round];
}
