import * as THREE from 'three';
import { angleAbout, directionAt, wrapDeg } from './axisFrame.js';

/**
 * Spur gear and rack meshing (openspec gear-meshing). Pure: part metadata + world poses in, turns
 * out, so the viewport and the MCP engine mesh identically and Node checks can run it.
 *
 * A gear's teeth are at `toothPhaseDeg + k·360/teeth` about its local Z axis (its bore), in the
 * frame of refAxes (src/utils/axisFrame.js). A gear being placed (B) meshes with a placed gear (A)
 * when, at the line between their centers, a tooth of one faces a gap of the other. With all angles
 * about B's axis g, β the direction A→B, and t the fraction of a tooth period from a tooth center
 * to the contact line:
 *   t_A = frac((β − φ_A)/p_A),  t_B = frac((β + 180 − φ_B)/p_B),  mesh ⇔ t_A + t_B ≡ ½ (mod 1)
 * For a rack (contact at s along its length, t_R = frac((s − s₀)/spacing), n out of its teeth):
 *   t_G + sign((g × n)·d)·t_R ≡ ½
 */

export const MESH_PARALLEL_MIN_DOT = Math.cos(THREE.MathUtils.degToRad(2));
export const MESH_CENTER_TOLERANCE_MM = 1.0;
export const MESH_CONFLICT_TEETH = 0.25; // a neighbour left further off than this is reported

const frac = (x) => x - Math.floor(x);
const wrapHalf = (x) => x - Math.round(x); // into [-½, ½]
const _v = new THREE.Vector3();

const toVec = (v) => (v?.isVector3 ? v.clone() : new THREE.Vector3(...v));
const toQuat = (r) => {
  if (r?.isQuaternion) return r.clone();
  const e = new THREE.Euler(...r.map((d) => THREE.MathUtils.degToRad(d || 0)), 'XYZ');
  return new THREE.Quaternion().setFromEuler(e);
};

export const isMeshingGear = (partMeta) =>
  partMeta?.gearSpecs?.gearType === 'spur' && partMeta.gearSpecs.measured === true;
export const isMeshingRack = (partMeta) => partMeta?.rackSpecs?.measured === true;

/**
 * A toothed part in world space, or null when it has no measured teeth. `rotation` is Euler XYZ
 * degrees or a Quaternion; `position` an array or Vector3.
 */
export function worldToothed(partMeta, position, rotation, instanceId = null) {
  const q = toQuat(rotation);
  const origin = toVec(position);
  if (isMeshingGear(partMeta)) {
    const g = partMeta.gearSpecs;
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const [lo, hi] = g.faceSpanMm;
    const t0 = origin.dot(axis);
    return {
      kind: 'gear',
      instanceId,
      name: partMeta.name,
      teeth: g.teeth,
      moduleMm: g.moduleMm,
      pitchRadiusMm: g.pitchRadiusMm,
      center: origin,
      axis,
      // A tooth center's direction in world space
      toothDir: directionAt([0, 0, 1], g.toothPhaseDeg).applyQuaternion(q),
      faceSpan: [t0 + lo, t0 + hi]
    };
  }
  if (isMeshingRack(partMeta)) {
    const r = partMeta.rackSpecs;
    const axis = toVec(r.axis).applyQuaternion(q);
    const t0 = origin.dot(axis);
    return {
      kind: 'rack',
      instanceId,
      name: partMeta.name,
      moduleMm: r.moduleMm,
      origin,
      direction: toVec(r.direction).applyQuaternion(q),
      normal: toVec(r.normal).applyQuaternion(q),
      axis,
      toothSpacingMm: r.toothSpacingMm,
      toothOffsetMm: r.toothOffsetMm,
      pitchLineOffset: r.pitchLineOffset,
      lengthSpan: r.lengthSpanMm,
      faceSpan: [t0 + r.faceSpanMm[0], t0 + r.faceSpanMm[1]]
    };
  }
  return null;
}

/** Overlap length of two [lo, hi] ranges along an axis (negative when apart). */
const overlap = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]);

/** A gear's face span along `axis` (its own span flips when its axis points the other way). */
const spanAlong = (gear, axis) => {
  const t = gear.center.dot(axis);
  const own = gear.center.dot(gear.axis);
  const ends = [gear.faceSpan[0] - own, gear.faceSpan[1] - own].map((d) => t + d * gear.axis.dot(axis));
  return [Math.min(...ends), Math.max(...ends)];
};

/**
 * How `gear` sits against `other` (a gear or rack): null when out of mesh range, else
 * { distanceMm, target(φ) → the fraction-of-a-tooth error for the gear's tooth phase φ about its
 * own axis, exactDeg: the gear's tooth phase that meshes exactly }.
 */
export function meshRelation(gear, other) {
  if (!gear || !other || gear === other || gear.kind !== 'gear') return null;
  if (other.instanceId != null && other.instanceId === gear.instanceId) return null;
  if (Math.abs(gear.moduleMm - other.moduleMm) > 0.01 * gear.moduleMm) return null;
  const g = gear.axis;
  const pG = 360 / gear.teeth;
  if (Math.abs(g.dot(other.axis)) < MESH_PARALLEL_MIN_DOT) return null;
  if (overlap(spanAlong(gear, g), other.kind === 'gear' ? spanAlong(other, g) : rackSpanAlong(other, g)) <= 0) {
    return null;
  }

  if (other.kind === 'gear') {
    _v.subVectors(gear.center, other.center);
    const lateral = _v.clone().addScaledVector(g, -_v.dot(g));
    const dist = lateral.length();
    if (Math.abs(dist - (gear.pitchRadiusMm + other.pitchRadiusMm)) > MESH_CENTER_TOLERANCE_MM) return null;
    const beta = angleAbout(g, lateral); // direction A→B
    const pA = 360 / other.teeth;
    const tA = frac((beta - angleAbout(g, other.toothDir)) / pA);
    // t_B* = ½ − t_A  ⇒  φ_B* = β + 180 − p_B(½ − t_A)
    const exactDeg = beta + 180 - pG * (0.5 - tA);
    return {
      other,
      distanceMm: dist,
      exactDeg,
      errorTeeth: (phiDeg) => wrapHalf(tA + frac((beta + 180 - phiDeg) / pG) - 0.5)
    };
  }

  // Rack: the gear's center must be one pitch radius out from the pitch line, over the teeth
  _v.subVectors(gear.center, other.origin);
  const height = _v.dot(other.normal) - other.pitchLineOffset;
  if (Math.abs(height - gear.pitchRadiusMm) > MESH_CENTER_TOLERANCE_MM) return null;
  const s = _v.dot(other.direction);
  if (s < other.lengthSpan[0] || s > other.lengthSpan[1]) return null;
  const tR = frac((s - other.toothOffsetMm) / other.toothSpacingMm);
  const sign = Math.sign(new THREE.Vector3().crossVectors(g, other.normal).dot(other.direction)) || 1;
  const beta = angleAbout(g, other.normal.clone().negate()); // gear → rack
  // t_G* = ½ − sign·t_R  ⇒  φ_G* = β − p_G(½ − sign·t_R)
  const exactDeg = beta - pG * (0.5 - sign * tR);
  return {
    other,
    distanceMm: Math.abs(height),
    exactDeg,
    errorTeeth: (phiDeg) => wrapHalf(frac((beta - phiDeg) / pG) + sign * tR - 0.5)
  };
}

const rackSpanAlong = (rack, axis) => {
  const sgn = Math.sign(rack.axis.dot(axis)) || 1;
  const t = rack.origin.dot(axis);
  const own = rack.origin.dot(rack.axis);
  const ends = [rack.faceSpan[0] - own, rack.faceSpan[1] - own].map((d) => t + d * sgn);
  return [Math.min(...ends), Math.max(...ends)];
};

/**
 * The turn (degrees about the gear's own world axis, smallest of the possible turns, within half a
 * tooth) that meshes `gear` with the toothed parts in `neighbours` that are in mesh range. With
 * several, each neighbour's exact turn is a candidate and the one leaving the largest error smallest
 * wins (ties: the nearest neighbour). Returns null when no neighbour is in range, else
 * { turnDeg, axis, meshed: [{ other, errorTeeth }], conflicts: [{ other, errorTeeth }] }.
 */
export function meshTurn(gear, neighbours) {
  if (!gear || gear.kind !== 'gear') return null;
  const relations = neighbours.map((n) => meshRelation(gear, n)).filter(Boolean);
  if (!relations.length) return null;
  const pG = 360 / gear.teeth;
  const phi = angleAbout(gear.axis, gear.toothDir);
  let best = null;
  for (const rel of relations) {
    const turnDeg = wrapDeg(rel.exactDeg - phi, pG);
    const errors = relations.map((r) => ({ other: r.other, errorTeeth: r.errorTeeth(phi + turnDeg), distanceMm: r.distanceMm }));
    const worst = Math.max(...errors.map((e) => Math.abs(e.errorTeeth)));
    const key = [Math.round(worst * 1000), rel.distanceMm];
    if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) {
      best = { key, turnDeg, errors };
    }
  }
  const round = (x) => Math.round(x * 1000) / 1000;
  return {
    turnDeg: round(best.turnDeg) + 0,
    axis: gear.axis.clone(),
    meshed: best.errors.filter((e) => Math.abs(e.errorTeeth) <= MESH_CONFLICT_TEETH),
    conflicts: best.errors.filter((e) => Math.abs(e.errorTeeth) > MESH_CONFLICT_TEETH)
  };
}

/** `quaternion` turned by `deg` about the world `axis` (pre-multiplied). */
export function turnQuaternion(quaternion, axis, deg) {
  const r = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), THREE.MathUtils.degToRad(deg));
  return r.multiply(toQuat(quaternion));
}

/** Euler XYZ degrees (rounded to 0.01°) of a quaternion, as stored on instances. */
export function quaternionToEulerDeg(q) {
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z].map((r) => Math.round(THREE.MathUtils.radToDeg(r) * 100) / 100 + 0);
}

/** Message text for a mesh, e.g. "Meshed 24 Tooth Gear #1 with 48 Tooth Gear #1 (turned 7.5°)". */
export function meshMessage(gearLabel, result, labelOf = (o) => o.name) {
  if (!result) return '';
  const parts = [];
  if (result.meshed.length) {
    const turned = Math.abs(result.turnDeg) >= 0.01 ? ` (turned ${Math.round(result.turnDeg * 100) / 100}°)` : '';
    parts.push(`Meshed ${gearLabel} with ${result.meshed.map((m) => labelOf(m.other)).join(' and ')}${turned}`);
  }
  for (const c of result.conflicts) parts.push(`Couldn't mesh with ${labelOf(c.other)} as well`);
  return parts.join('. ');
}
