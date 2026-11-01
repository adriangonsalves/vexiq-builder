import * as THREE from 'three';

/**
 * How chain and track parts sit (openspec chain-track-builder), from world matrices and part
 * metadata (`chainSpecs`, sprocket `gearSpecs`). Shared by the viewport and the MCP engine so
 * neither reports a fitted chain as a collision, and by the audit's joints.
 *
 * A link (Chain Link or Tank Tread Attachment Link) has its roller pivot at its origin, the next
 * pivot 6.35 mm along local −Z and its pivot axis along X. Neighbouring links share a pivot. A link
 * sits on a sprocket when a pivot lies on the sprocket's pitch circle, in its tooth plane, with the
 * pivot axis along the axle. A Traction Link sits on the tread link it plugs into.
 */

const AXIS_DOT_MIN = 0.999;
const PIVOT_TOL_MM = 0.5;
const PLANE_TOL_MM = 1.0;
const SPROCKET_TEETH = [8, 16, 24, 32, 40];
const LINK_PLATE_HALF_MM = 2.2; // a link's plates reach this far either side of its pivots

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();

export const isLink = (part) => part?.chainSpecs?.role === 'chain_link' || part?.chainSpecs?.role === 'tread_link';
// A Traction Link or an Intake Flap: plugged into a tread link's two holes
export const isGripper = (part) => part?.chainSpecs?.role === 'gripper' || part?.chainSpecs?.role === 'attachment';
export const isChainPart = (part) => isLink(part) || isGripper(part);
const isSprocket = (part) => part?.gearSpecs?.gearType === 'sprocket' && part.gearSpecs.measured === true;
const isStandoff = (part) => part?.fastenerSpecs?.fastenerType === 'standoff' && (part.fastenerSpecs.bodyLengthMm ?? 0) > 0;

function standoffGuideRadius(standoffPart, linkPart) {
  const onZ = (standoffPart.cylinders || []).filter(
    (c) => Math.abs(Math.abs(c.axis?.[2] ?? 0) - 1) < 1e-3 && Math.hypot(c.origin?.[0] ?? 0, c.origin?.[1] ?? 0) < 0.05
  );
  const body = onZ.length ? Math.max(...onZ.map((c) => c.radius)) : standoffPart.bbox ? Math.min(standoffPart.bbox.size[0], standoffPart.bbox.size[1]) / 2 : 3.175;
  const half = linkPart?.bbox ? Math.abs(linkPart.bbox.min[1]) : LINK_PLATE_HALF_MM;
  return body + half;
}

const axisOf = (matrix, local, out) => out.set(...local).transformDirection(matrix);
/** A link's two pivots in world space. */
export function linkPivots(part, matrix) {
  return part.chainSpecs.pivots.map((p) => new THREE.Vector3(...p).applyMatrix4(matrix));
}

/** True when two links share a pivot with parallel pivot axes (neighbours in a chain). */
export function areChainNeighbours(partA, matrixA, partB, matrixB) {
  if (!isLink(partA) || !isLink(partB)) return false;
  if (Math.abs(axisOf(matrixA, partA.chainSpecs.pivotAxis, _a).dot(axisOf(matrixB, partB.chainSpecs.pivotAxis, _b))) < AXIS_DOT_MIN) {
    return false;
  }
  const pa = linkPivots(partA, matrixA);
  const pb = linkPivots(partB, matrixB);
  return pa.some((p) => pb.some((q) => p.distanceTo(q) < PIVOT_TOL_MM));
}

/**
 * True when a link has a pivot on the sprocket's pitch circle, in its tooth plane. With `leaving`,
 * also a link of a run leaving or reaching the sprocket: a pivot lifted out of a tooth gap, up to a
 * plate's height past the tooth tips (its plates rub the next teeth, as a real chain's do).
 */
export function isLinkOnSprocket(linkPart, linkMatrix, sprocketPart, sprocketMatrix, { leaving = false } = {}) {
  if (!isLink(linkPart) || !isSprocket(sprocketPart)) return false;
  const g = sprocketPart.gearSpecs;
  const axle = axisOf(sprocketMatrix, [0, 0, 1], _a);
  if (Math.abs(axisOf(linkMatrix, linkPart.chainSpecs.pivotAxis, _b).dot(axle)) < AXIS_DOT_MIN) return false;
  const faceMid = g.faceSpanMm ? (g.faceSpanMm[0] + g.faceSpanMm[1]) / 2 : 0;
  const center = _c.set(0, 0, faceMid).applyMatrix4(sprocketMatrix);
  return linkPivots(linkPart, linkMatrix).some((p) => {
    const d = p.clone().sub(center);
    const along = d.dot(axle);
    if (Math.abs(along) > PLANE_TOL_MM) return false;
    const radial = Math.sqrt(Math.max(0, d.lengthSq() - along * along));
    if (leaving) return radial > g.pitchRadiusMm - PIVOT_TOL_MM && radial < (g.tipRadiusMm ?? g.pitchRadiusMm) + LINK_PLATE_HALF_MM;
    return Math.abs(radial - g.pitchRadiusMm) < PIVOT_TOL_MM;
  });
}

/**
 * True when a link rests on a standoff guide: pivot axis parallel to the standoff's, pivots inside
 * the standoff's body span, and the link's pivot-to-pivot segment within 0.5 mm of the guide circle
 * (with `leaving`, up to a plate half-height outside it as the run leaves the standoff).
 */
export function isLinkOnStandoff(linkPart, linkMatrix, standoffPart, standoffMatrix, { leaving = false } = {}) {
  if (!isLink(linkPart) || !isStandoff(standoffPart)) return false;
  const f = standoffPart.fastenerSpecs;
  const axle = axisOf(standoffMatrix, [0, 0, 1], _a);
  if (Math.abs(axisOf(linkMatrix, linkPart.chainSpecs.pivotAxis, _b).dot(axle)) < AXIS_DOT_MIN) return false;
  const origin = _c.set(0, 0, 0).applyMatrix4(standoffMatrix);
  const lo = Math.min(f.shoulderNegZ, f.shoulderPosZ) - PLANE_TOL_MM;
  const hi = Math.max(f.shoulderNegZ, f.shoulderPosZ) + PLANE_TOL_MM;
  const pivots = linkPivots(linkPart, linkMatrix);
  const radials = [];
  for (const p of pivots) {
    const d = p.clone().sub(origin);
    const along = d.dot(axle);
    if (along < lo || along > hi) return false;
    radials.push(d.addScaledVector(axle, -along));
  }
  const guideRadius = standoffGuideRadius(standoffPart, linkPart);
  if (radials.every((r) => Math.abs(r.length() - guideRadius) < PIVOT_TOL_MM)) return true;
  const [r0, r1] = radials;
  const ab = r1.clone().sub(r0);
  const t = Math.max(0, Math.min(1, -r0.dot(ab) / (ab.lengthSq() || 1)));
  const segRadial = r0.clone().addScaledVector(ab, t).length();
  const maxR = guideRadius + (leaving ? LINK_PLATE_HALF_MM : PIVOT_TOL_MM);
  return segRadial >= guideRadius - PIVOT_TOL_MM && segRadial <= maxR;
}

/** Where the tread link a gripper plugs into has its roller pivot, and its turn (world). */
function gripperLinkPose(gripperPart, gripperMatrix) {
  const pos = new THREE.Vector3();
  const q = new THREE.Quaternion();
  gripperMatrix.decompose(pos, q, new THREE.Vector3());
  const seat = new THREE.Vector3(...gripperPart.chainSpecs.seatInLink).applyQuaternion(q);
  return { pivot: pos.sub(seat), quaternion: q };
}

/** True when the gripper is plugged into this tread link (seat and turn match). */
export function isGripperOnLink(gripperPart, gripperMatrix, linkPart, linkMatrix) {
  if (!isGripper(gripperPart) || linkPart?.chainSpecs?.role !== 'tread_link') return false;
  const { pivot, quaternion } = gripperLinkPose(gripperPart, gripperMatrix);
  const linkPos = new THREE.Vector3().setFromMatrixPosition(linkMatrix);
  _q.setFromRotationMatrix(linkMatrix);
  return pivot.distanceTo(linkPos) < PIVOT_TOL_MM && Math.abs(quaternion.dot(_q)) > 0.9999;
}

/**
 * True when two parts touch by design in a chain or track: neighbouring links, a link on a
 * sprocket or standoff, a gripper in its tread link or next to it (the link before or after, or
 * the next gripper). Order of the two parts doesn't matter.
 */
export function isChainFit(partA, matrixA, partB, matrixB) {
  if (!isChainPart(partA) && !isChainPart(partB)) return false;
  if (areChainNeighbours(partA, matrixA, partB, matrixB)) return true;
  const leaving = { leaving: true };
  if (isLinkOnSprocket(partA, matrixA, partB, matrixB, leaving) || isLinkOnSprocket(partB, matrixB, partA, matrixA, leaving)) return true;
  if (isLinkOnStandoff(partA, matrixA, partB, matrixB, leaving) || isLinkOnStandoff(partB, matrixB, partA, matrixA, leaving)) return true;
  for (const [g, gm, o, om] of [
    [partA, matrixA, partB, matrixB],
    [partB, matrixB, partA, matrixA]
  ]) {
    if (!isGripper(g)) continue;
    if (isGripperOnLink(g, gm, o, om)) return true;
    // Next to its own link: the gripper's link would be a neighbour of this link or gripper
    const { pivot } = gripperLinkPose(g, gm);
    if (isLink(o)) return linkPivots(o, om).some((p) => p.distanceTo(pivot) < 6.35 + PIVOT_TOL_MM);
    if (isGripper(o)) return gripperLinkPose(o, om).pivot.distanceTo(pivot) < 6.35 + PIVOT_TOL_MM;
  }
  return false;
}

/**
 * Pivots where a chain bends away from any sprocket or standoff guide: for each pair of
 * neighbouring links, the shared pivot when the chain turns there as it would round a sprocket (one
 * tooth's angle, or a kink sharper than the smallest sprocket's) and no sprocket or standoff in
 * `sprockets` ([{ part, matrix }]) holds either link at that pivot. `links`: [{ id, part, matrix }].
 * Returns Set of link ids at such bends (a chain left in the air after a sprocket moved).
 */
export function unsupportedBends(links, sprockets) {
  const out = new Set();
  const dirOf = (l) => new THREE.Vector3(0, 0, -1).transformDirection(l.matrix);
  const pivotsOf = new Map(links.map((l) => [l.id, linkPivots(l.part, l.matrix)]));
  const onSprocket = (l, pivot) =>
    sprockets.some((s) => {
      if (isLinkOnSprocket(l.part, l.matrix, s.part, s.matrix)) {
        const g = s.part.gearSpecs;
        const faceMid = g.faceSpanMm ? (g.faceSpanMm[0] + g.faceSpanMm[1]) / 2 : 0;
        const center = new THREE.Vector3(0, 0, faceMid).applyMatrix4(s.matrix);
        const axle = new THREE.Vector3(0, 0, 1).transformDirection(s.matrix);
        const d = pivot.clone().sub(center);
        const along = d.dot(axle);
        return Math.abs(Math.sqrt(Math.max(0, d.lengthSq() - along * along)) - g.pitchRadiusMm) < PIVOT_TOL_MM;
      }
      if (isLinkOnStandoff(l.part, l.matrix, s.part, s.matrix)) {
        const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(s.matrix);
        const axle = new THREE.Vector3(0, 0, 1).transformDirection(s.matrix);
        const d = pivot.clone().sub(origin);
        const along = d.dot(axle);
        const guideRadius = standoffGuideRadius(s.part, l.part);
        return Math.abs(Math.sqrt(Math.max(0, d.lengthSq() - along * along)) - guideRadius) < PIVOT_TOL_MM;
      }
      return false;
    });
  for (const a of links) {
    const far = pivotsOf.get(a.id)[1];
    const b = links.find((l) => l !== a && pivotsOf.get(l.id)[0].distanceTo(far) < PIVOT_TOL_MM);
    if (!b) continue;
    // A chain bends one tooth's angle per link round a sprocket; a slack run's gentle sag doesn't
    // match one (nor a kink sharper than the smallest sprocket's)
    const bendDeg = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, dirOf(a).dot(dirOf(b)))));
    const wraps = SPROCKET_TEETH.some((n) => Math.abs(bendDeg - 360 / n) < 0.3) || bendDeg > 360 / 8 + 0.3;
    if (!wraps) continue;
    if (onSprocket(a, far) || onSprocket(b, far)) continue;
    out.add(a.id);
    out.add(b.id);
  }
  return out;
}
