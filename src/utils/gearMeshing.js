import * as THREE from 'three';
import { angleAbout, directionAt, refAxes, wrapDeg } from './axisFrame.js';

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
 *
 * Gears at 90° (openspec right-angle-gears): bevel with bevel, crown with spur, worm with spur. At
 * the point P where the two touch, with T the direction their teeth move there, each part's tooth
 * pattern is read as u = the fraction of a tooth period from P to the next tooth center going along
 * +T. A tooth of one faces a gap of the other when u_A − u_B ≡ ½; rolling moves both u together.
 * For a turning gear with axis x, tooth angle φ and contact angle β about x, s = sign((x × r)·T):
 *   u = frac(−s·frac((β − φ)/p)).
 * A worm is read like a rack along its axis w (T = w): the crest at part angle θ sits at
 * z₀ − hand·lead·θ/360, so u = frac((z_crest − τ)/spacing) with τ the contact's place along w.
 */

export const MESH_PARALLEL_MIN_DOT = Math.cos(THREE.MathUtils.degToRad(2));
export const MESH_PERPENDICULAR_MAX_DOT = Math.sin(THREE.MathUtils.degToRad(2));
const RIGHT_ANGLE_KINDS = new Set(['bevel', 'crown', 'worm']);
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
/** A measured bevel, crown or worm gear (openspec right-angle-gears). */
export const isRightAngleGear = (partMeta) =>
  RIGHT_ANGLE_KINDS.has(partMeta?.gearSpecs?.gearType) && partMeta.gearSpecs.measured === true;
/** Any part that turns about its own axis to mesh when placed: a spur, bevel, crown or worm gear. */
export const canTurnToMesh = (partMeta) => isMeshingGear(partMeta) || isRightAngleGear(partMeta);

/**
 * Whether two parts can ever mesh at 90° (whatever their poses): bevel with bevel of the same tooth
 * count, crown or worm with a spur gear of their tooth size. Returns the pair's name or null.
 */
export function rightAnglePair(metaA, metaB) {
  const a = metaA?.gearSpecs;
  const b = metaB?.gearSpecs;
  if (!a?.measured || !b?.measured) return null;
  const sameModule = (x, y) => Math.abs(x.moduleMm - y.moduleMm) <= 0.01 * x.moduleMm;
  const kinds = [a.gearType, b.gearType].sort().join('+');
  if (kinds === 'bevel+bevel') return a.teeth === b.teeth ? 'bevel' : null;
  if (kinds === 'crown+spur') return sameModule(a, b) ? 'crown' : null;
  if (kinds === 'spur+worm') return sameModule(a, b) ? 'worm' : null;
  return null;
}

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
      faceSpan: [t0 + lo, t0 + hi],
      faceMid: origin.clone().addScaledVector(axis, (lo + hi) / 2),
      tipRadiusMm: g.tipRadiusMm
    };
  }
  if (isRightAngleGear(partMeta)) {
    const g = partMeta.gearSpecs;
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const base = { instanceId, name: partMeta.name, center: origin, axis };
    if (g.gearType === 'bevel') {
      return {
        ...base,
        kind: 'bevel',
        teeth: g.teeth,
        pitchRadiusMm: g.pitchRadiusMm,
        apex: origin.clone().addScaledVector(axis, g.conePointZ),
        toothDir: directionAt([0, 0, 1], g.toothPhaseDeg).applyQuaternion(q)
      };
    }
    if (g.gearType === 'crown') {
      return {
        ...base,
        kind: 'crown',
        teeth: g.teeth,
        moduleMm: g.moduleMm,
        pitchRadiusMm: g.pitchRadiusMm,
        toothFace: g.toothFace,
        pitchPlaneZ: g.pitchPlaneZ,
        ringRadii: g.ringRadiiMm,
        toothDir: directionAt([0, 0, 1], g.toothPhaseDeg).applyQuaternion(q)
      };
    }
    return {
      ...base,
      kind: 'worm',
      teeth: g.starts, // one turn moves the thread on by `starts` teeth
      moduleMm: g.moduleMm,
      pitchRadiusMm: g.pitchRadiusMm,
      threadSpacingMm: g.threadSpacingMm,
      leadMm: g.leadMm,
      hand: g.hand,
      tipRadiusMm: g.tipRadiusMm,
      threadSpan: g.threadSpanMm,
      threadPhaseMm: g.threadPhaseMm,
      // The world direction of the worm's part angle 0 (its "tooth direction" for meshTurn)
      toothDir: directionAt([0, 0, 1], 0).applyQuaternion(q)
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
  if (!gear || !other || gear === other) return null;
  if (other.instanceId != null && other.instanceId === gear.instanceId) return null;
  if (RIGHT_ANGLE_KINDS.has(gear.kind) || RIGHT_ANGLE_KINDS.has(other.kind)) return rightAngleRelation(gear, other);
  if (gear.kind !== 'gear') return null;
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

// --- Gears at 90° (openspec right-angle-gears, design §2) -------------------------------------------

const perpendicular = (a, b) => Math.abs(a.dot(b)) <= MESH_PERPENDICULAR_MAX_DOT;
const sameModule = (a, b) => Math.abs(a.moduleMm - b.moduleMm) <= 0.01 * a.moduleMm;
/** The part of `v` across `axis`. */
const across = (v, axis) => v.clone().addScaledVector(axis, -v.dot(axis));

/**
 * Where a bevel pair touches, or null when out of mesh range: same tooth count, axes at 90°, cone
 * points together. The teeth meet along the line from the shared cone point between the two gears.
 */
function bevelContact(a, b, tol = MESH_CENTER_TOLERANCE_MM) {
  if (a.teeth !== b.teeth || !perpendicular(a.axis, b.axis)) return null;
  const gap = a.apex.distanceTo(b.apex);
  if (gap > tol) return null;
  const apex = a.apex.clone().add(b.apex).multiplyScalar(0.5);
  const line = a.axis.clone().add(b.axis).negate().normalize();
  return { P: apex.addScaledVector(line, a.pitchRadiusMm * Math.SQRT2), distanceMm: gap };
}

/**
 * Where a spur gear stands on a crown gear's teeth, or null when out of mesh range: same tooth size,
 * axes at 90°, the spur's axis crossing the crown's, one spur pitch radius out from the crown's
 * pitch plane on its toothed side, with the spur's teeth over the crown's tooth ring.
 */
function crownContact(crown, spur, tol = MESH_CENTER_TOLERANCE_MM) {
  if (!sameModule(crown, spur) || !perpendicular(crown.axis, spur.axis)) return null;
  const c = crown.axis;
  const s = spur.axis;
  const w = spur.faceMid.clone().sub(crown.center);
  const n = new THREE.Vector3().crossVectors(c, s).normalize();
  const off = Math.abs(w.dot(n));
  if (off > tol) return null;
  const height = (w.dot(c) - crown.pitchPlaneZ) * crown.toothFace;
  if (Math.abs(height - spur.pitchRadiusMm) > tol) return null;
  // The spur's tooth face across the crown, measured from where its axis crosses the crown's
  const crossAt = -spur.center.clone().sub(crown.center).dot(s);
  const own = spur.center.dot(s);
  const ends = [spur.faceSpan[0] - own - crossAt, spur.faceSpan[1] - own - crossAt];
  const lo = Math.sign(ends[0]) === Math.sign(ends[1]) ? Math.min(...ends.map(Math.abs)) : 0;
  const hi = Math.max(...ends.map(Math.abs));
  if (Math.min(hi, crown.ringRadii[1]) - Math.max(lo, crown.ringRadii[0]) <= 0) return null;
  return {
    P: spur.faceMid.clone().addScaledVector(c, -crown.toothFace * spur.pitchRadiusMm),
    distanceMm: Math.max(off, Math.abs(height - spur.pitchRadiusMm))
  };
}

/**
 * Where a worm meets a spur gear, or null when out of mesh range: same tooth size, axes at 90°, the
 * worm's axis in the middle plane of the spur's teeth, the axes the two pitch radii apart, and the
 * point where they come closest on the worm's thread. Also gives τ, that point's place along the worm.
 */
function wormContact(worm, spur, tol = MESH_CENTER_TOLERANCE_MM) {
  if (!sameModule(worm, spur) || !perpendicular(worm.axis, spur.axis)) return null;
  const w = worm.axis;
  const s = spur.axis;
  const d = worm.center.clone().sub(spur.faceMid);
  const sideways = Math.abs(d.dot(s));
  if (sideways > tol) return null;
  const n = new THREE.Vector3().crossVectors(w, s).normalize();
  const apart = Math.abs(d.dot(n));
  if (Math.abs(apart - worm.pitchRadiusMm - spur.pitchRadiusMm) > tol) return null;
  const tau = -d.dot(w);
  // The thread must reach the spur's teeth: the spur's tip circle comes within the worm's tip radius
  // over this far either side of the point where the axes come closest
  const reach = Math.sqrt(Math.max(0, (spur.tipRadiusMm ?? spur.pitchRadiusMm) ** 2 - (apart - (worm.tipRadiusMm ?? worm.pitchRadiusMm)) ** 2));
  if (tau < worm.threadSpan[0] - reach || tau > worm.threadSpan[1] + reach) return null;
  const Q = worm.center.clone().addScaledVector(w, tau);
  const toSpur = across(across(spur.faceMid.clone().sub(Q), s), w).normalize();
  return { P: Q.addScaledVector(toSpur, worm.pitchRadiusMm), T: w.clone(), tau, distanceMm: Math.max(sideways, Math.abs(apart - worm.pitchRadiusMm - spur.pitchRadiusMm)) };
}

/** A turning gear's tooth pattern at P along T: u(φ) for tooth angle φ, and the φ that gives u. */
function angularPattern(part, axisPoint, P, T) {
  const r = across(P.clone().sub(axisPoint), part.axis);
  const s = Math.sign(new THREE.Vector3().crossVectors(part.axis, r).dot(T)) || 1;
  const beta = angleAbout(part.axis, r);
  const p = 360 / part.teeth;
  return {
    u: (phi) => frac(-s * frac((beta - phi) / p)),
    phiFor: (u) => beta - p * frac(-s * u)
  };
}

/** A worm's thread at the contact τ along T = its axis: u(ψ) for its turn ψ (angle of toothDir), and the ψ for u. */
function wormPattern(worm, P, tau) {
  const alpha = angleAbout(worm.axis, P.clone().sub(worm.center));
  const rate = (worm.hand * worm.leadMm) / 360 / worm.threadSpacingMm; // teeth per degree of turn
  const K = (worm.threadPhaseMm - (worm.hand * worm.leadMm * alpha) / 360 - tau) / worm.threadSpacingMm;
  return {
    u: (psi) => frac(K + rate * psi),
    phiFor: (u) => (u - K) / rate
  };
}

const patternOf = (part, contact) => {
  if (part.kind === 'worm') return wormPattern(part, contact.P, contact.tau);
  const axisPoint = part.kind === 'bevel' ? part.apex : part.center;
  return angularPattern(part, axisPoint, contact.P, contact.T);
};

/** The 90° kind of a pair of world toothed parts and where they touch, or null. */
function rightAngleContact(a, b, tol = MESH_CENTER_TOLERANCE_MM) {
  const pick = (kind) => (a.kind === kind ? [a, b] : [b, a]);
  const kinds = [a.kind, b.kind].sort().join('+');
  let contact = null;
  let pair = null;
  if (kinds === 'bevel+bevel') {
    contact = bevelContact(a, b, tol);
    pair = 'bevel';
  } else if (kinds === 'crown+gear') {
    contact = crownContact(...pick('crown'), tol);
    pair = 'crown';
  } else if (kinds === 'gear+worm') {
    contact = wormContact(...pick('worm'), tol);
    pair = 'worm';
  }
  if (!contact) return null;
  if (!contact.T) {
    // The direction the first part's teeth move at P when it turns forward
    const first = a.kind === 'bevel' ? a.apex : a.center;
    contact.T = new THREE.Vector3().crossVectors(a.axis, across(contact.P.clone().sub(first), a.axis)).normalize();
  }
  return { ...contact, pair };
}

function rightAngleRelation(gear, other) {
  const contact = rightAngleContact(gear, other);
  if (!contact) return null;
  const mine = patternOf(gear, contact);
  const theirs = patternOf(other, contact);
  const uOther = theirs.u(angleAbout(other.axis, other.toothDir));
  // u_mine ≡ u_other + ½
  const exactDeg = mine.phiFor(frac(uOther + 0.5));
  return {
    other,
    pair: contact.pair,
    contact: contact.P,
    distanceMm: contact.distanceMm,
    exactDeg,
    errorTeeth: (phiDeg) => wrapHalf(mine.u(phiDeg) - uOther - 0.5)
  };
}

export const NEAR_MESH_MM = 3;
/**
 * A 90° pair that is close to mesh range but outside it: { pair, offMm } when every distance is
 * within NEAR_MESH_MM but one is more than the mesh tolerance off, else null.
 */
export function rightAngleNearMiss(a, b) {
  if (!a || !b || !(RIGHT_ANGLE_KINDS.has(a.kind) || RIGHT_ANGLE_KINDS.has(b.kind))) return null;
  if (rightAngleContact(a, b)) return null;
  const loose = rightAngleContact(a, b, NEAR_MESH_MM);
  return loose ? { pair: loose.pair, offMm: Math.round(loose.distanceMm * 10) / 10 } : null;
}

// Slides that bring a 90° pair within this of exact are kept (openspec precise-placement)
export const SNAP_SLIDE_MAX_MM = 3;
const SNAP_DONE_MM = 0.15;
const SNAP_STEP_MM = 0.05;

/**
 * Slides along their own axes that put two 90° gears just out of mesh into mesh (openspec
 * precise-placement): `a` = { meta, pose: { position, rotation }, id }, likewise `b`. Tries `a` alone,
 * then both (when `slideB`), each within SNAP_SLIDE_MAX_MM. Returns { a: mm, b: mm, axisA, axisB }
 * (slides along the gears' world axes) or null when no such slides bring them within reach.
 */
export function meshSnapSlides(a, b, { slideB = true } = {}) {
  const ta = worldToothed(a.meta, a.pose.position, a.pose.rotation, a.id);
  const tb = worldToothed(b.meta, b.pose.position, b.pose.rotation, b.id);
  if (!rightAngleNearMiss(ta, tb)) return null;
  const axisA = ta.axis.clone().normalize();
  const axisB = tb.axis.clone().normalize();
  const shifted = (g, axis, s) => {
    const p = new THREE.Vector3(...g.pose.position).addScaledVector(axis, s);
    return worldToothed(g.meta, p.toArray(), g.pose.rotation, g.id);
  };
  const off = (sa, sb) => rightAngleContact(shifted(a, axisA, sa), shifted(b, axisB, sb), 2 * NEAR_MESH_MM)?.distanceMm ?? Infinity;
  // Coarse steps over the whole reach, then fine ones round the best
  const best1 = (f) => {
    let best = { s: 0, v: f(0) };
    const scan = (lo, hi, step) => {
      for (let s = lo; s <= hi + 1e-9; s += step) {
        if (Math.abs(s) > SNAP_SLIDE_MAX_MM + 1e-9) continue;
        const v = f(s);
        if (v < best.v - 1e-9 || (Math.abs(v - best.v) <= 1e-9 && Math.abs(s) < Math.abs(best.s))) best = { s, v };
      }
    };
    scan(-SNAP_SLIDE_MAX_MM, SNAP_SLIDE_MAX_MM, 2 * SNAP_STEP_MM);
    const mid = best.s;
    scan(mid - 2 * SNAP_STEP_MM, mid + 2 * SNAP_STEP_MM, SNAP_STEP_MM / 5);
    return best;
  };
  // The placed gear alone
  let sa = best1((s) => off(s, 0));
  if (sa.v <= SNAP_DONE_MM) return { a: round3(sa.s), b: 0, axisA, axisB };
  if (!slideB) return null;
  // Both, a few rounds each way
  let sA = sa.s;
  let sB = 0;
  let v = sa.v;
  for (let round = 0; round < 4 && v > SNAP_DONE_MM / 3; round++) {
    const nb = best1((s) => off(sA, s));
    sB = nb.s;
    const na = best1((s) => off(s, sB));
    sA = na.s;
    v = na.v;
  }
  return v <= SNAP_DONE_MM ? { a: round3(sA), b: round3(sB), axisA, axisB } : null;
}
const round3 = (n) => Math.round(n * 1000) / 1000 + 0;

/** The 90° pair kind ('bevel', 'crown', 'worm') of two world toothed parts in mesh range, or null. */
export function rightAngleMeshKind(a, b) {
  return a && b && (RIGHT_ANGLE_KINDS.has(a.kind) || RIGHT_ANGLE_KINDS.has(b.kind)) ? rightAngleContact(a, b)?.pair ?? null : null;
}

/**
 * Signed speed ratio of a meshed pair: how fast `b` turns about its own axis for each unit `a` turns
 * about its own, read from the meshing rule itself (turn `a` a little, see where `b` must go), so
 * placement and Play mode agree. Null when the pair isn't in mesh range.
 */
export function meshRatio(a, b) {
  const rel = meshRelation(b, a);
  if (!rel) return null;
  const delta = 0.5; // degrees: well inside half a tooth of every VEX IQ gear
  const turnedA = { ...a, toothDir: a.toothDir.clone().applyAxisAngle(a.axis, THREE.MathUtils.degToRad(delta)) };
  const rel2 = meshRelation(b, turnedA);
  if (!rel2) return null;
  const period = 360 / b.teeth;
  return wrapDeg(rel2.exactDeg - rel.exactDeg, period) / delta;
}

/** Unit world directions a quarter turn apart round `axis`: the world axes across it when it runs along one, else its own frame. */
function quarterDirections(axis) {
  const world = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, -1, 0),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 0, -1)
  ];
  const along = world.some((d) => d.dot(axis) >= MESH_PARALLEL_MIN_DOT);
  if (along) return world.filter((d) => Math.abs(d.dot(axis)) < 0.5).map((d) => across(d, axis).normalize());
  const [u, v] = refAxes(axis);
  return [u, v, u.clone().negate(), v.clone().negate()];
}

/**
 * The poses at which a gear (`partMeta`, now at `pose` { position, quaternion }) meshes with the
 * world toothed part `partner` at 90°, a quarter turn apart round the partner (openspec
 * right-angle-gears "Mesh spots"). Each: { index, position: Vector3, quaternion, axis, center
 * (the part's box center in world), turnDeg, mesh: meshTurn result }. Empty for a pair that can't
 * mesh at 90°. Callers drop spots that collide.
 */
export function meshSpots(partMeta, pose, partner, partnerMeta) {
  const pair = rightAnglePair(partMeta, partnerMeta);
  if (!pair || !partner) return [];
  const g = partMeta.gearSpecs;
  const q0 = toQuat(pose.quaternion ?? pose.rotation);
  const pos0 = toVec(pose.position);
  const curAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(q0);
  const facing = (dir) => (dir.dot(curAxis) < -1e-6 ? dir.clone().negate() : dir.clone());
  const faceMid = g.faceSpanMm ? (g.faceSpanMm[0] + g.faceSpanMm[1]) / 2 : 0;
  const p = partner.axis;
  const candidates = []; // { axis, position }
  for (const d of quarterDirections(p)) {
    if (pair === 'bevel') {
      // Cone points together, this gear's body out along d
      const axis = d.clone().negate();
      candidates.push({ axis, position: partner.apex.clone().addScaledVector(axis, -g.conePointZ) });
    } else if (g.gearType === 'spur' && pair === 'crown') {
      const axis = facing(d);
      const mid = partner.center
        .clone()
        .addScaledVector(p, partner.pitchPlaneZ + partner.toothFace * g.pitchRadiusMm)
        .addScaledVector(d, (partner.ringRadii[0] + partner.ringRadii[1]) / 2);
      candidates.push({ axis, position: mid.addScaledVector(axis, -faceMid) });
    } else if (g.gearType === 'crown') {
      // The crown's axis crosses the spur's at the middle of its tooth ring, the crown out along d
      const lift = g.pitchPlaneZ + g.toothFace * partner.pitchRadiusMm;
      const axis = d.clone().multiplyScalar(-Math.sign(lift) || 1);
      const ringMid = (g.ringRadiiMm[0] + g.ringRadiiMm[1]) / 2;
      for (const side of [1, -1]) {
        const cross = partner.faceMid.clone().addScaledVector(p, -side * ringMid);
        candidates.push({ axis, position: cross.addScaledVector(axis, -lift) });
      }
    } else if (g.gearType === 'worm') {
      const Q = partner.faceMid.clone().addScaledVector(d, partner.pitchRadiusMm + g.pitchRadiusMm);
      const axis = facing(new THREE.Vector3().crossVectors(p, d).normalize());
      const now = Q.clone().sub(pos0).dot(axis);
      const [t0, t1] = g.threadSpanMm;
      const tau = now >= t0 && now <= t1 ? now : (t0 + t1) / 2;
      candidates.push({ axis, position: Q.addScaledVector(axis, -tau) });
    } else {
      // A spur gear beside a worm, at d from its axis
      const now = pos0.clone().sub(partner.center).dot(p);
      const [t0, t1] = partner.threadSpan;
      const tau = now >= t0 && now <= t1 ? now : (t0 + t1) / 2;
      const axis = facing(new THREE.Vector3().crossVectors(p, d).normalize());
      const mid = partner.center
        .clone()
        .addScaledVector(p, tau)
        .addScaledVector(d, partner.pitchRadiusMm + g.pitchRadiusMm);
      candidates.push({ axis, position: mid.addScaledVector(axis, -faceMid) });
    }
  }
  const boxCenter = toVec(partMeta.bbox?.center ?? [0, 0, 0]);
  const spots = [];
  candidates.forEach(({ axis, position }) => {
    const q = new THREE.Quaternion().setFromUnitVectors(curAxis, axis).multiply(q0);
    const mesh = meshTurn(worldToothed(partMeta, position, q, '__spot'), [partner]);
    if (!mesh) return;
    const turned = turnQuaternion(q, mesh.axis, mesh.turnDeg);
    spots.push({
      index: spots.length + 1,
      position,
      quaternion: turned,
      axis,
      center: boxCenter.clone().applyQuaternion(turned).add(position),
      turnDeg: mesh.turnDeg,
      mesh
    });
  });
  return spots;
}

/**
 * The turn (degrees about the gear's own world axis, smallest of the possible turns, within half a
 * tooth) that meshes `gear` with the toothed parts in `neighbours` that are in mesh range. With
 * several, each neighbour's exact turn is a candidate and the one leaving the largest error smallest
 * wins (ties: the nearest neighbour). Returns null when no neighbour is in range, else
 * { turnDeg, axis, meshed: [{ other, errorTeeth }], conflicts: [{ other, errorTeeth }] }.
 */
export function meshTurn(gear, neighbours) {
  if (!gear || (gear.kind !== 'gear' && !RIGHT_ANGLE_KINDS.has(gear.kind))) return null;
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
