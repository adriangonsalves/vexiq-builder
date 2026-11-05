import * as THREE from 'three';

/**
 * A selected part the chain bends round (openspec chain-routing-around-parts): the outline of its
 * solid where it crosses the chain's plane, across the width of a link. Pure three code on a part's
 * own geometry (with a three-mesh-bvh boundsTree), so the app's engine worker and Node agree.
 */

export const OBSTACLE_MAX_CORNERS = 12;

const cache = new Map(); // part id + band in the part's own frame -> outline in that frame

/** 2D convex hull (counter-clockwise) of [x, y] points, without collinear points. */
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of pts.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * A convex outline cut down to `max` corners, never inside the original: each step drops the corner
 * whose two neighbouring sides, extended to meet, add the least area, and puts that meeting point in
 * place of the two corners beside it.
 */
export function simplifyOutline(hull, max = OBSTACLE_MAX_CORNERS) {
  let poly = hull.map((p) => [...p]);
  const meet = (a, b, c, d) => {
    const r = [b[0] - a[0], b[1] - a[1]];
    const s = [d[0] - c[0], d[1] - c[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-12) return null;
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
    return t > 1 ? [a[0] + r[0] * t, a[1] + r[1] * t] : null;
  };
  const area = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  while (poly.length > max) {
    const n = poly.length;
    let best = null;
    // Side i (poly[i] -> poly[i + 1]) removed: its neighbours' lines meet past its ends
    for (let i = 0; i < n; i++) {
      const p0 = poly[(i - 1 + n) % n];
      const p1 = poly[i];
      const p2 = poly[(i + 1) % n];
      const p3 = poly[(i + 2) % n];
      const m = meet(p0, p1, p3, p2);
      if (!m) continue;
      const added = area(p1, m, p2);
      if (!best || added < best.added) best = { i, m, added };
    }
    if (!best) break;
    const next = [];
    for (let j = 0; j < n; j++) {
      if (j === best.i) next.push(best.m);
      else if (j !== (best.i + 1) % n) next.push(poly[j]);
    }
    poly = next;
  }
  return poly;
}

/**
 * The outline of `geometry` (a part's own mesh, posed at `position` / `rotation` in degrees) where it
 * crosses the band `t0 ± halfWidth` along the unit `normal`: its convex hull in the plane, in the
 * in-plane axes `u`, `v` ([x, y] = [p·u, p·v]), at most OBSTACLE_MAX_CORNERS corners. [] when no
 * solid crosses the band. `cacheKey` names the part's model.
 */
export function sliceOutline(geometry, { position, rotation, normal, u, v, t0, halfWidth, cacheKey = null }) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map((d) => THREE.MathUtils.degToRad(d || 0)), 'XYZ'));
  const qi = q.clone().invert();
  const p0 = new THREE.Vector3(...position);
  // The band and the plane's axes in the part's own frame
  const n = normal.clone().applyQuaternion(qi);
  const lu = u.clone().applyQuaternion(qi);
  const lv = v.clone().applyQuaternion(qi);
  const off = p0.dot(normal); // t of the part's origin
  const lo = t0 - halfWidth - off;
  const hi = t0 + halfWidth - off;
  const round = (x) => Math.round(x * 100) / 100;
  const key = cacheKey && [cacheKey, ...n.toArray(), ...lu.toArray(), lo, hi].map((x) => (typeof x === 'number' ? round(x) : x)).join('|');
  let local = key ? cache.get(key) : null;
  if (!local) {
    const pts = [];
    const box = new THREE.Box3();
    const corner = new THREE.Vector3();
    const tri = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    geometry.boundsTree.shapecast({
      intersectsBounds: (b) => {
        box.copy(b);
        let mn = Infinity;
        let mx = -Infinity;
        for (let i = 0; i < 8; i++) {
          corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
          const t = corner.dot(n);
          mn = Math.min(mn, t);
          mx = Math.max(mx, t);
        }
        return mx >= lo && mn <= hi;
      },
      intersectsTriangle: (t) => {
        tri[0].copy(t.a);
        tri[1].copy(t.b);
        tri[2].copy(t.c);
        // The triangle clipped to the band: its corners inside, and where its sides cross the band's faces
        const ts = tri.map((p) => p.dot(n));
        for (let i = 0; i < 3; i++) {
          const a = tri[i];
          const b = tri[(i + 1) % 3];
          const ta = ts[i];
          const tb = ts[(i + 1) % 3];
          if (ta >= lo && ta <= hi) pts.push([a.dot(lu), a.dot(lv)]);
          for (const face of [lo, hi]) {
            if ((ta - face) * (tb - face) < 0) {
              const p = a.clone().lerp(b, (face - ta) / (tb - ta));
              pts.push([p.dot(lu), p.dot(lv)]);
            }
          }
        }
        return false;
      }
    });
    local = pts.length >= 3 ? simplifyOutline(convexHull(pts)) : [];
    if (key) cache.set(key, local);
  }
  // Back to the plane's own frame: the part's origin projected in
  const ox = p0.dot(u);
  const oy = p0.dot(v);
  return local.map(([x, y]) => [x + ox, y + oy]);
}
