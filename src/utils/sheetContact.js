import * as THREE from 'three';

/**
 * Where plastic sheets meet other parts (openspec shaped-parts-and-sheet-bending). A sheet flexes, so
 * pressing a little into a part is a tight fit, not an overlap; and two sheets pinned through the same
 * holes (stacked) press together. Shared by the engine and the viewport, on any geometry with a
 * three-mesh-bvh `boundsTree` and an index.
 */

/**
 * How far a sheet would have to flex to clear another part: the sheet's mesh is sampled about every
 * millimetre; for each sample inside the other part (behind its nearest face, by its outward winding, so
 * open meshes work, and more than 0.1 mm in, so touching faces don't count), the distance along the
 * sheet's normal, either way, to the far side of everything the part has on that line. Returns the
 * largest, or Infinity as soon as one passes `limit`. Only the two parts' shared box is sampled.
 */
export function sheetFlexDepth(sheetGeo, sheetMatrix, otherGeo, otherMatrix, limit) {
  const toOther = otherMatrix.clone().invert().multiply(sheetMatrix);
  if (!otherGeo.boundingBox) otherGeo.computeBoundingBox();
  const box = otherGeo.boundingBox.clone().expandByScalar(0.01);
  const pos = sheetGeo.attributes.position.array;
  const idx = sheetGeo.index ? sheetGeo.index.array : null;
  const count = idx ? idx.length : pos.length / 3;
  const vertexAt = (k) => (idx ? idx[k] : k);
  const oPos = otherGeo.attributes.position.array;
  const oIdx = otherGeo.index ? otherGeo.index.array : null;
  const oVertex = (k) => (oIdx ? oIdx[k] : k);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const ta = new THREE.Vector3();
  const tb = new THREE.Vector3();
  const tc = new THREE.Vector3();
  const faceN = new THREE.Vector3();
  const ray = new THREE.Ray();
  const hit = {};
  const inside = (q) => {
    otherGeo.boundsTree.closestPointToPoint(q, hit);
    if (hit.distance < 0.1) return false; // touching, not inside
    const f = hit.faceIndex * 3;
    ta.fromArray(oPos, oVertex(f) * 3);
    tb.fromArray(oPos, oVertex(f + 1) * 3);
    tc.fromArray(oPos, oVertex(f + 2) * 3);
    faceN.subVectors(tc, tb).cross(ta.clone().sub(tb)).normalize();
    return q.clone().sub(hit.point).dot(faceN) < 0;
  };
  // Distance along `dir` to the last surface of the part on that line
  const exitAlong = (q, dir) => {
    ray.set(q, dir);
    const hits = otherGeo.boundsTree.raycast(ray, THREE.DoubleSide);
    return hits.length ? Math.max(...hits.map((h) => h.distance)) : 0;
  };
  let deepest = 0;
  const triBox = new THREE.Box3();
  for (let t = 0; t < count; t += 3) {
    a.fromArray(pos, vertexAt(t) * 3).applyMatrix4(toOther);
    b.fromArray(pos, vertexAt(t + 1) * 3).applyMatrix4(toOther);
    c.fromArray(pos, vertexAt(t + 2) * 3).applyMatrix4(toOther);
    triBox.makeEmpty().expandByPoint(a).expandByPoint(b).expandByPoint(c);
    if (!triBox.intersectsBox(box)) continue;
    n.subVectors(b, a).cross(c.clone().sub(a));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a))));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps;
        const v = j / steps;
        p.copy(a).multiplyScalar(1 - u - v).addScaledVector(b, u).addScaledVector(c, v);
        if (!box.containsPoint(p) || !inside(p)) continue;
        deepest = Math.max(deepest, Math.min(exitAlong(p, n), exitAlong(p, n.clone().negate())));
        if (deepest > limit) return Infinity;
      }
    }
  }
  return deepest;
}

/** Two sheets' world holes ([{ type, worldOrigin, worldAxis }]): a hole each on one line, under 1.5 mm apart along it. */
export function sheetsStacked(portsA, portsB) {
  const holesB = portsB.filter((q) => q.type === 'pin_hole');
  return portsA.some((p) => {
    if (p.type !== 'pin_hole') return false;
    const ax = new THREE.Vector3(...p.worldAxis);
    return holesB.some((q) => {
      if (Math.abs(ax.dot(new THREE.Vector3(...q.worldAxis))) < 0.995) return false;
      const d = new THREE.Vector3(...q.worldOrigin).sub(new THREE.Vector3(...p.worldOrigin));
      const along = d.dot(ax);
      return Math.abs(along) < 1.5 && d.addScaledVector(ax, -along).length() < 0.5;
    });
  });
}
