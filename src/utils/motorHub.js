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

// A shaft on the drive socket's line, no deeper than the socket: the socket of VEX's current Smart
// Motor model is 8.6 mm deep, deeper than the library's mesh (about 6 mm), so a shaft pushed home
// meets solid plastic in the library model that isn't there on the real motor
const SOCKET_LINE_MM = 0.3;
const SOCKET_AXIS_DOT = Math.cos(THREE.MathUtils.degToRad(1));
const SOCKET_DEPTH_SLACK_MM = 0.15;
const _sockOrigin = new THREE.Vector3();
const _sockAxis = new THREE.Vector3();
const _end = new THREE.Vector3();

/** True when one part is a Smart Motor and the other a shaft in its drive socket (world matrices given). */
export function isShaftInMotorSocket(partA, matrixA, partB, matrixB) {
  const socketOf = (p) => (p?.ports || []).find((q) => q.type === 'shaft_socket');
  const shaftOf = (p) => (p?.ports || []).find((q) => q.type === 'shaft');
  let motor, motorMatrix, shaft, shaftMatrix;
  if (socketOf(partA) && shaftOf(partB)) [motor, motorMatrix, shaft, shaftMatrix] = [partA, matrixA, partB, matrixB];
  else if (socketOf(partB) && shaftOf(partA)) [motor, motorMatrix, shaft, shaftMatrix] = [partB, matrixB, partA, matrixA];
  else return false;
  const socket = socketOf(motor);
  const shaftPort = shaftOf(shaft);
  _sockOrigin.set(...socket.origin).applyMatrix4(motorMatrix);
  _sockAxis.set(...socket.axis).transformDirection(motorMatrix);
  const shaftAxis = new THREE.Vector3(...shaftPort.axis).transformDirection(shaftMatrix);
  if (Math.abs(shaftAxis.dot(_sockAxis)) < SOCKET_AXIS_DOT) return false;
  // The shaft's end inside the motor: the one deeper along the socket (-axis is into the motor)
  const ts = shaftPort.ends.map((e) => {
    _end.set(...e).applyMatrix4(shaftMatrix).sub(_sockOrigin);
    const t = _end.dot(_sockAxis);
    return { t, across: _end.addScaledVector(_sockAxis, -t).length() };
  });
  const deep = ts[0].t < ts[1].t ? ts[0] : ts[1];
  return deep.across <= SOCKET_LINE_MM && deep.t < 0 && deep.t >= -(socket.maxDepthMm ?? 0) - SOCKET_DEPTH_SLACK_MM;
}
