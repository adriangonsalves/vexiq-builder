import * as THREE from 'three';
import { angleAbout, wrapDeg } from './axisFrame.js';
import { findSeatedPairs } from './pinHoleAlignment.js';
import { quaternionToEulerDeg, turnQuaternion } from './gearMeshing.js';

/**
 * Square axles and square holes (openspec square-shaft-fit). Pure: world features (from
 * collectWorldFeatures, which carry `flatDir` for measured square features) in, turns out.
 */

const SQUARE_OPENINGS = new Set(['shaft_bore', 'shaft_socket']);

/** True for a feature with a measured square flat (a square shaft, bore or socket). */
export const isSquare = (feature) => Boolean(feature?.flatDir);

/**
 * A socket's flat direction with its hub turned `socketAngleDeg` about the socket axis (the Smart
 * Motor's turning hub); the feature's own flatDir is the hub at 0°.
 */
export function hubFlatDir(feature, socketAngleDeg = 0) {
  if (!feature?.flatDir) return null;
  if (!socketAngleDeg) return feature.flatDir.clone();
  return feature.flatDir.clone().applyAxisAngle(feature.axis, THREE.MathUtils.degToRad(socketAngleDeg));
}

/**
 * The smallest turn (degrees, right-hand about `moving.axis`, within ±45°) of the moving feature's
 * part that lines its square flats up with `fixed`'s, a multiple of 90° apart. 0 when either is round
 * or unmeasured. `fixedFlatDir` overrides fixed.flatDir (a turned motor hub).
 */
export function squareFitRoll(moving, fixed, fixedFlatDir = null) {
  const target = fixedFlatDir || fixed?.flatDir;
  if (!moving?.flatDir || !target) return 0;
  const deg = wrapDeg(angleAbout(moving.axis, target) - angleAbout(moving.axis, moving.flatDir), 90);
  return Math.round(deg * 100) / 100 + 0;
}

/**
 * The hub angle that lines a Smart Motor socket's flats up with a seated square shaft's, as the
 * smallest change from the current `socketAngleDeg` (degrees about the socket's own axis).
 */
export function hubAngleFor(socket, shaft, socketAngleDeg = 0) {
  if (!socket?.flatDir || !shaft?.flatDir) return socketAngleDeg;
  const current = hubFlatDir(socket, socketAngleDeg);
  const delta = wrapDeg(angleAbout(socket.axis, shaft.flatDir) - angleAbout(socket.axis, current), 90);
  return Math.round((socketAngleDeg + delta) * 100) / 100 + 0;
}

/**
 * Shaft groups: each square axle with every part whose square bore is seated on it, and the Smart
 * Motor hub whose socket holds it ({ instanceId, hub: true }). Round bores, pin holes and collars
 * are left out. Groups that share a member on the same line (a shaft coupler joining two axles)
 * are merged. `parts` is [{ instanceId, features, hasHub }] with world features of each instance.
 * Returns [{ axis, point, shaftIds, members: [{ instanceId, hub? }] }].
 */
export function shaftGroups(parts) {
  const groups = [];
  const allFeatures = parts.flatMap((p) => p.features);
  const hubParts = new Set(parts.filter((p) => p.hasHub).map((p) => p.instanceId));
  for (const p of parts) {
    for (const shaft of p.features) {
      if (shaft.kind !== 'shaft' || !isSquare(shaft)) continue;
      const others = allFeatures.filter((f) => f.instanceId !== p.instanceId && SQUARE_OPENINGS.has(f.kind) && isSquare(f));
      const members = new Map([[p.instanceId, { instanceId: p.instanceId }]]);
      for (const pair of findSeatedPairs([shaft], others)) {
        const id = pair.opening.instanceId;
        const hub = pair.opening.kind === 'shaft_socket' && hubParts.has(id);
        members.set(id, hub ? { instanceId: id, hub: true } : { instanceId: id });
      }
      groups.push({ axis: shaft.axis.clone(), point: shaft.origin.clone(), shaftIds: [p.instanceId], members });
    }
  }
  // Merge groups that share a (non-hub) member on the same line
  for (let i = 0; i < groups.length; i++) {
    for (let j = groups.length - 1; j > i; j--) {
      const a = groups[i];
      const b = groups[j];
      const shared = [...b.members.values()].some((m) => !m.hub && a.members.has(m.instanceId));
      const sameLine =
        Math.abs(a.axis.dot(b.axis)) > 0.999 &&
        new THREE.Vector3().subVectors(b.point, a.point).cross(a.axis).length() < 0.25;
      if (!shared || !sameLine) continue;
      for (const [id, m] of b.members) if (!a.members.has(id)) a.members.set(id, m);
      a.shaftIds.push(...b.shaftIds);
      groups.splice(j, 1);
    }
  }
  return groups.map((g) => ({ ...g, members: [...g.members.values()] }));
}

/** The group holding `instanceId` (as a non-hub member), or null. */
export const groupOf = (groups, instanceId) =>
  groups.find((g) => g.members.some((m) => m.instanceId === instanceId && !m.hub)) || null;

/**
 * Pose patches turning every member of `group` by `deg` about the group's axis line: rotations are
 * turned about the world axis and positions about the line. A hub member only changes its
 * `socketAngleDeg` (by ±deg, depending on which way its socket axis points; `hubAxisOf(instanceId)`
 * gives that world axis). `poseOf(instanceId)` gives { position, rotation, socketAngleDeg }.
 * Returns [{ instanceId, position, rotation } | { instanceId, socketAngleDeg }].
 */
export function turnGroup(group, deg, poseOf, hubAxisOf = () => null) {
  if (!deg) return [];
  const axis = group.axis.clone().normalize();
  const rad = THREE.MathUtils.degToRad(deg);
  const patches = [];
  for (const m of group.members) {
    const pose = poseOf(m.instanceId);
    if (!pose) continue;
    if (m.hub) {
      const hubAxis = hubAxisOf(m.instanceId);
      const sign = hubAxis ? Math.sign(hubAxis.dot(axis)) || 1 : 1;
      const angle = wrapDeg((pose.socketAngleDeg || 0) + sign * deg, 360);
      patches.push({ instanceId: m.instanceId, socketAngleDeg: Math.round(angle * 100) / 100 + 0 });
      continue;
    }
    const position = new THREE.Vector3(...pose.position).sub(group.point).applyAxisAngle(axis, rad).add(group.point);
    patches.push({
      instanceId: m.instanceId,
      position: position.toArray().map((v) => Math.round(v * 1000) / 1000 + 0),
      rotation: quaternionToEulerDeg(turnQuaternion(pose.rotation, axis, deg))
    });
  }
  return patches;
}
