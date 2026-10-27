import * as THREE from 'three';

/**
 * The Smart Motor's drive hub (openspec square-shaft-fit): the piece around the square drive socket
 * that turns. Its model is one mesh, so the hub's triangles are split off at load by where they lie
 * (inside the measured hub cylinder, between the hub's face and the socket floor), and drawn and
 * collided turned by the instance's `socketAngleDeg` about the socket axis. Shared by the viewport
 * (src/utils/geometryCache.js) and the MCP engine.
 */

const SPLIT_MARGIN_MM = 0.2;

/** The hub's local frame from part metadata, or null for parts without a hub. */
export function hubFrame(partMeta) {
  const hub = partMeta?.hubSpecs;
  const socket = (partMeta?.ports || []).find((p) => p.type === 'shaft_socket');
  if (!hub || !socket) return null;
  const axis = new THREE.Vector3(...socket.axis).normalize();
  return {
    origin: new THREE.Vector3(...socket.origin),
    axis,
    radiusMm: hub.radiusMm,
    faceT: hub.faceOffsetMm,
    floorT: hub.faceOffsetMm - hub.depthMm
  };
}

/**
 * Splits indexed triangles into hub and body: a triangle is the hub's when all its corners are
 * within the hub radius of the socket axis and between the socket floor and the hub's face (with
 * SPLIT_MARGIN_MM). `positions` is the flat xyz array; `index` the triangle index array (or null for
 * non-indexed). Returns { hub: Uint32Array, body: Uint32Array } of triangle corner indices.
 */
export function splitHubTriangles(positions, index, frame) {
  const count = index ? index.length : positions.length / 3;
  const isHub = (vi) => {
    const x = positions[vi * 3] - frame.origin.x;
    const y = positions[vi * 3 + 1] - frame.origin.y;
    const z = positions[vi * 3 + 2] - frame.origin.z;
    const t = x * frame.axis.x + y * frame.axis.y + z * frame.axis.z;
    if (t < frame.floorT - SPLIT_MARGIN_MM || t > frame.faceT + SPLIT_MARGIN_MM) return false;
    const r2 = x * x + y * y + z * z - t * t;
    return r2 <= (frame.radiusMm + SPLIT_MARGIN_MM) ** 2;
  };
  const hub = [];
  const body = [];
  for (let i = 0; i < count; i += 3) {
    const a = index ? index[i] : i;
    const b = index ? index[i + 1] : i + 1;
    const c = index ? index[i + 2] : i + 2;
    (isHub(a) && isHub(b) && isHub(c) ? hub : body).push(a, b, c);
  }
  return { hub: Uint32Array.from(hub), body: Uint32Array.from(body) };
}

/** The hub's local transform for a hub angle: a turn of `deg` about the socket axis line. */
export function hubMatrix(frame, deg = 0, target = new THREE.Matrix4()) {
  if (!frame || !deg) return target.identity();
  const rot = new THREE.Matrix4().makeRotationAxis(frame.axis, THREE.MathUtils.degToRad(deg));
  return target
    .makeTranslation(frame.origin.x, frame.origin.y, frame.origin.z)
    .multiply(rot)
    .multiply(new THREE.Matrix4().makeTranslation(-frame.origin.x, -frame.origin.y, -frame.origin.z));
}

/**
 * A BufferGeometry made of the given triangles of `source` (sharing its attributes), or null when
 * there are none.
 */
export function subGeometry(source, triangles) {
  if (!triangles.length) return null;
  const geo = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) geo.setAttribute(name, attr);
  geo.setIndex(new THREE.BufferAttribute(triangles, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
