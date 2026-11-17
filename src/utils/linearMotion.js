/**
 * Linear motion parts (openspec linear-motion-and-idler-pins): a Continuous Linear Motion Rack Gear
 * clipped onto a beam, and a beam sliding in a linear motion bracket by the rack on it. Pure rules on
 * parts as placed: each part's measured sizes (`clipSpecs`, `channelSpecs`, from
 * scripts/measure-part-geometry.mjs), its world matrix and its world features
 * (src/utils/pinHoleAlignment.js). Lengths in mm.
 *
 * - A rack is clipped onto a part when one of its clip legs lies on the line of one of the part's pin
 *   holes, its seat face within SEAT_MM of the part's face there (its box along the hole), the holes running
 *   on in a row along the rack, and at least a pitch of the rack over the row.
 * - A bracket holds a beam by the rack clipped on it: the rack's rail lies in the bracket's slot
 *   (teeth inward, the rail's height inside the slot and its width centred, within SEAT_MM), and the
 *   bracket lies somewhere along the beam's row of holes. A rack only rides through a bracket; the
 *   bracket's lips are too narrow for a beam (they hold the rack's rail), so a plain beam makes no
 *   slide.
 */
import * as THREE from 'three';

export const SEAT_MM = 0.5;
const PITCH_MM = 12.7;
const PARALLEL = Math.cos(THREE.MathUtils.degToRad(2));

const v3 = (a) => new THREE.Vector3(...a);
const dirOf = (matrix, a) => v3(a).transformDirection(matrix);
const pointOf = (matrix, a) => v3(a).applyMatrix4(matrix);
/** Distance from point p to the line through `origin` along unit `axis`. */
const offLine = (p, origin, axis) => {
  const d = p.clone().sub(origin);
  return d.addScaledVector(axis, -d.dot(axis)).length();
};

/** A box's range along a unit axis (its own frame). */
function boxAlong(bbox, axis) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [bbox.min[0], bbox.max[0]]) for (const y of [bbox.min[1], bbox.max[1]]) for (const z of [bbox.min[2], bbox.max[2]]) {
    const t = x * axis.x + y * axis.y + z * axis.z;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return [lo, hi];
}

export const isClipRack = (part) => Boolean(part?.clipSpecs?.measured);
export const isLinearBracket = (part) => Boolean(part?.channelSpecs?.measured);

/**
 * The rack clipped on a part, or null: { rack, beam, direction (world, the rack's length), rowSpan
 * ([lo, hi] of the beam's hole row along `direction`, a half pitch past the end holes), overlapMm }.
 * `beamFeatures` are the other part's world features.
 */
export function rackClip(rackPart, rackMatrix, rackId, beamPart, beamMatrix, beamFeatures, beamId) {
  const c = rackPart?.clipSpecs;
  if (!c?.measured) return null;
  const n = dirOf(rackMatrix, c.seatNormal);
  const dir = dirOf(rackMatrix, c.direction);
  const inverse = beamMatrix.clone().invert();
  const holes = beamFeatures.filter((f) => f.kind === 'pin_hole' && Math.abs(f.axis.dot(n)) >= PARALLEL);
  for (const leg of c.legs) {
    const p = pointOf(rackMatrix, leg.at);
    for (const h of holes) {
      if (offLine(p, h.origin, h.axis) > SEAT_MM) continue;
      // The seat face on the beam's face (its box along the hole), the hole running on into the beam
      const local = p.clone().applyMatrix4(inverse);
      const axis = h.axis.clone().transformDirection(inverse);
      const [lo, hi] = boxAlong(beamPart.bbox, axis);
      const t = local.dot(axis);
      const near = Math.abs(t - lo) < Math.abs(t - hi) ? t - lo : t - hi;
      const far = Math.max(...[h.start, h.end].map((e) => e.clone().sub(p).dot(n)));
      if (Math.abs(near) > SEAT_MM || far < 1) continue;
      // The beam's row of holes along the rack: holes on lines a whole number of pitches along it
      const row = holes.filter((o) => {
        const d = o.origin.clone().sub(h.origin);
        d.addScaledVector(n, -d.dot(n));
        const along = d.dot(dir);
        const side = d.addScaledVector(dir, -along).length();
        return side <= SEAT_MM && Math.abs(along / PITCH_MM - Math.round(along / PITCH_MM)) * PITCH_MM <= SEAT_MM;
      });
      if (row.length < 2) continue;
      const ts = row.map((o) => o.origin.dot(dir));
      const rowSpan = [Math.min(...ts) - PITCH_MM / 2, Math.max(...ts) + PITCH_MM / 2];
      const o = new THREE.Vector3().setFromMatrixPosition(rackMatrix).dot(dir);
      const rackSpan = [o + c.lengthSpanMm[0], o + c.lengthSpanMm[1]];
      const overlapMm = Math.min(rowSpan[1], rackSpan[1]) - Math.max(rowSpan[0], rackSpan[0]);
      if (overlapMm < PITCH_MM - SEAT_MM) continue;
      return { rack: rackId, beam: beamId, direction: dir.toArray(), rowSpan, overlapMm };
    }
  }
  return null;
}

/**
 * A bracket holding the beam a clipped rack is on, or null: { bracket, beam, rack, direction (world,
 * along the channel), point (the channel's middle on its face, world) }. `clip` is rackClip's result.
 */
export function bracketSlide(bracketPart, bracketMatrix, bracketId, rackPart, rackMatrix, clip) {
  const ch = bracketPart?.channelSpecs;
  const c = rackPart?.clipSpecs;
  const r = rackPart?.rackSpecs;
  if (!ch?.measured || !c?.measured || !r?.measured || !clip) return null;
  const dir = dirOf(bracketMatrix, ch.direction);
  const open = dirOf(bracketMatrix, ch.open);
  const across = dirOf(bracketMatrix, ch.across);
  const rackDir = dirOf(rackMatrix, c.direction);
  const teeth = dirOf(rackMatrix, r.normal);
  if (Math.abs(rackDir.dot(dir)) < PARALLEL || teeth.dot(open) > -PARALLEL) return null;
  const origin = new THREE.Vector3().setFromMatrixPosition(bracketMatrix);
  // The rail's heights in the bracket (along `open`): the rack's teeth point the other way
  const rackOrigin = new THREE.Vector3().setFromMatrixPosition(rackMatrix);
  const u0 = rackOrigin.clone().sub(origin).dot(open);
  const k = teeth.dot(open); // about -1
  const rail = c.rail.heightSpanMm.map((h) => u0 + k * h);
  const [rLo, rHi] = [Math.min(...rail), Math.max(...rail)];
  const [sLo, sHi] = ch.slot.spanMm;
  if (rLo < sLo - SEAT_MM || rHi > sHi + SEAT_MM) return null;
  // ... and centred across it
  const rackAcross = dirOf(rackMatrix, r.axis);
  const railCentre = rackOrigin.clone().addScaledVector(rackAcross, c.centerAcrossMm ?? 0).sub(origin).dot(across) - (ch.centerAcrossMm ?? 0);
  if (Math.abs(railCentre) + c.rail.halfWidthMm > ch.slot.halfWidthMm + SEAT_MM) return null;
  // The bracket lies along the beam's row of holes
  const sign = Math.sign(rackDir.dot(dir));
  const ends = ch.spanMm.map((s) => origin.dot(rackDir) + sign * s);
  const span = [Math.min(...ends), Math.max(...ends)];
  const row = clip.rowSpan;
  if (Math.min(span[1], row[1]) - Math.max(span[0], row[0]) <= 0) return null;
  const point = origin.clone().addScaledVector(open, ch.faceMm ?? 0);
  return { bracket: bracketId, beam: clip.beam, rack: clip.rack, direction: dir.toArray(), point: point.toArray() };
}

/** A slide's direction turned to point up when it has any up in it (else along its first non-zero axis). */
export function upward(direction) {
  const d = v3(direction).normalize();
  const flip = Math.abs(d.y) > 1e-6 ? d.y < 0 : Math.abs(d.x) > 1e-6 ? d.x < 0 : d.z < 0;
  return (flip ? d.negate() : d).toArray().map((x) => Math.round(x * 1e6) / 1e6 + 0);
}

/**
 * The stretch of travel (mm along `direction` from where it sits) over which some bracket still
 * holds a rack on the slide's line: the run containing 0 of the union of each bracket-rack overlap.
 * `brackets` and `racks` are [{ span: [lo, hi] }] along `direction`. [lo, hi], or null when nothing
 * holds it now.
 */
export function heldTravel(brackets, racks) {
  const runs = [];
  for (const b of brackets) for (const r of racks) runs.push([b.span[0] - r.span[1], b.span[1] - r.span[0]]);
  runs.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run[0] <= last[1]) last[1] = Math.max(last[1], run[1]);
    else merged.push([...run]);
  }
  return merged.find(([lo, hi]) => lo <= 0 && hi >= 0) || null;
}

/**
 * Slides on the same two assemblies lock them when their directions aren't parallel (within 2°):
 * `directions` are the slides' world directions.
 */
export function slidesLock(directions) {
  const first = v3(directions[0]).normalize();
  return directions.some((d) => Math.abs(v3(d).normalize().dot(first)) < PARALLEL);
}
