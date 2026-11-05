/**
 * VEX CAD (Cadasio / instructions.online) poses to app poses (openspec cad-import-readiness,
 * cad-import). Browser-safe: no Node imports.
 *
 * A CAD pose is a 4x4 matrix in row-vector form (point · M), in CAD units: mm times the project's
 * scaleFactor. CAD is Y up with the robot's front along +Z; the app is Y up with the front along +X,
 * so app = C · cad with C taking CAD +Z to app +X, +Y to +Y and +X to -Z.
 *
 * Each library part relates to VEX's model of it by p_lib = Q · p_cad + o, where Q comes from the
 * frame entry's `turn` and o is the library part's box centre (rule 'centre') or the entry's
 * `offsetMm` (rule 'origin'). The table lives in public/cad-frames.json.
 */
import * as THREE from 'three';

const C = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);

/** The frame entry for a CAD part number, or the box-centre rule marked unchecked. */
export function frameEntryFor(frames, cadPartNumber) {
  return frames?.[cadPartNumber] || { rule: 'centre', source: 'default' };
}

/** The turn Q of a frame entry (p_lib = Q · p_cad + o) as a Matrix4. */
export function frameTurn(entry) {
  const [x, y, z] = (entry.turn || [0, 0, 0]).map((d) => THREE.MathUtils.degToRad(d));
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
}

/** The offset o of a frame entry for a library part (its box centre, or the entry's offset). */
export function frameOffset(entry, libPart) {
  if (entry.rule === 'origin') return new THREE.Vector3(...(entry.offsetMm || [0, 0, 0]));
  return new THREE.Vector3(...libPart.bbox.center);
}

/**
 * App pose { position, rotation } (mm, XYZ degrees) of a library part from its CAD pose.
 * `cadMatrix`: 16 numbers or 4 rows of 4, row-vector form. Options: `scaleFactor` (CAD units per
 * mm), `liftMm` (added to app Y).
 */
export function cadPoseToApp(cadMatrix, libPart, entry, { scaleFactor = 1, liftMm = 0 } = {}) {
  const v = cadMatrix.flat();
  // Row-vector M: rotation rows are the CAD axes; column form is its transpose
  const R = new THREE.Matrix4().set(v[0], v[4], v[8], 0, v[1], v[5], v[9], 0, v[2], v[6], v[10], 0, 0, 0, 0, 1);
  const t = new THREE.Vector3(v[12], v[13], v[14]).divideScalar(scaleFactor);
  // A library point p sits in CAD space at R · Qᵀ · (p - o) + t; the app's pose is C times that
  const Qt = frameTurn(entry).transpose();
  const rot = new THREE.Matrix4().multiplyMatrices(C, R).multiply(Qt);
  const o = frameOffset(entry, libPart);
  const position = t.clone().sub(o.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(R, Qt))).applyMatrix4(C);
  position.y += liftMm;
  const e = new THREE.Euler().setFromRotationMatrix(rot, 'XYZ');
  const round = (n, d) => Number(n.toFixed(d)) + 0;
  return {
    position: position.toArray().map((n) => round(n, 3)),
    rotation: [e.x, e.y, e.z].map((a) => round(THREE.MathUtils.radToDeg(a), 3))
  };
}
