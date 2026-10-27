import * as THREE from 'three';

/**
 * The common angle frame about an axis, shared by the indexer, the viewport and the MCP engine so
 * measured tooth and flat angles mean the same thing everywhere. Angles about `axis` are measured
 * counter-clockwise (right-hand rule) from `u`, with `v = axis × u`.
 */
export function refAxes(axis) {
  const a = axis.isVector3 ? axis : new THREE.Vector3(...axis);
  const u = new THREE.Vector3()
    .crossVectors(a, Math.abs(a.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
    .normalize();
  return [u, new THREE.Vector3().crossVectors(a, u)];
}

/** Angle in degrees of `dir` about `axis`, in the frame of refAxes(axis) (dir's axial part ignored). */
export function angleAbout(axis, dir) {
  const [u, v] = refAxes(axis);
  const d = dir.isVector3 ? dir : new THREE.Vector3(...dir);
  return THREE.MathUtils.radToDeg(Math.atan2(d.dot(v), d.dot(u)));
}

/** Unit direction at `deg` about `axis`, in the frame of refAxes(axis). */
export function directionAt(axis, deg) {
  const [u, v] = refAxes(axis);
  const r = THREE.MathUtils.degToRad(deg);
  return u.multiplyScalar(Math.cos(r)).addScaledVector(v, Math.sin(r));
}

/** `deg` wrapped into (-period/2, period/2]. */
export function wrapDeg(deg, period = 360) {
  let w = deg % period;
  if (w <= -period / 2) w += period;
  if (w > period / 2) w -= period;
  return w;
}
