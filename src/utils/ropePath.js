/**
 * Ropes and spools (openspec rope-and-spool): the rope and spool parts and their sizes, how much rope
 * a spool holds, where a rope's ends can go and which way round a spot it goes by default. Pure
 * (three.js maths only), so the app, the MCP engine, Play mode and the node checks share it.
 *
 * Sizes come from each part's measured data (`ropeSpecs`, `spoolSpecs` in the catalog, written by
 * scripts/index-part-metadata.mjs); the tables here hold the same numbers for code that has no
 * catalog part to hand.
 */
import * as THREE from 'three';
import { partSpots } from './bandPath.js';

export const ROPE_KIND = 'rope';
const PITCH = 12.7;

/** Rope sizes: hole-to-hole length (one pitch less than the name), cord and tab, per part number. */
const TAB = { widthMm: 8, thickMm: 4.57, lengthMm: 11.5, holeRadiusMm: 2.1 };
export const ROPE_SPECS = {
  '228-2500-430': { lengthMm: 139.7, cordMm: 1.2, tab: TAB, name: '12x Pitch Rope', pitches: 12 },
  '228-2500-436': { lengthMm: 241.3, cordMm: 1.2, tab: TAB, name: '20x Pitch Rope', pitches: 20 },
  '228-2500-438': { lengthMm: 292.1, cordMm: 1.2, tab: TAB, name: '24x Pitch Rope', pitches: 24 },
  '228-2500-442': { lengthMm: 596.9, cordMm: 1.2, tab: TAB, name: '48x Pitch Rope', pitches: 48 },
  '228-2500-448': { lengthMm: 1511.3, cordMm: 1.2, tab: TAB, name: '120x Pitch Rope', pitches: 120 }
};

/** Spool sizes in the spool's own frame (axis +z), measured from VEX's meshes. */
export const SPOOL_SPECS = {
  '228-2500-421': { axis: [0, 0, 1], coreRadiusMm: 7.48, flangeRadiusMm: 12.55, drumSpanMm: [-10.6, 10.6], pocket: { center: [0, 0, 9.87], radiusMm: 4.04, spanMm: [7.2, 12.55], slotDeg: 90 }, name: '2x Wide Spool' },
  '228-2500-420': { axis: [0, 0, 1], coreRadiusMm: 7.49, flangeRadiusMm: 12.55, drumSpanMm: [-4.25, 4.25], pocket: { center: [0, 0, 3.47], radiusMm: 4.04, spanMm: [0.75, 6.2], slotDeg: 90 }, name: '1x Wide Spool' }
};

export const isRopePart = (part) => Boolean(part && ROPE_SPECS[part.partNumber]);
export const isSpoolPart = (part) => Boolean(part && (part.spoolSpecs || SPOOL_SPECS[part.partNumber]));

/** A rope part's sizes, with its two tab holes in its own frame. */
export function ropeSpec(part) {
  if (!isRopePart(part)) return null;
  const base = ROPE_SPECS[part.partNumber];
  const m = part.ropeSpecs || {};
  const half = base.lengthMm / 2;
  return { ...base, ...(m.lengthMm ? { lengthMm: m.lengthMm } : {}), holes: m.holes || [[-half, 0, 0], [half, 0, 0]] };
}

/** A spool part's sizes (its measured data, else the table). */
export function spoolSpec(part) {
  if (!part) return null;
  const s = part.spoolSpecs || SPOOL_SPECS[part.partNumber];
  return s ? { ...SPOOL_SPECS[part.partNumber], ...s } : null;
}

// ---------------------------------------------------------------------------------------------
// Winding (design decision 5)

const drumWidth = (spool) => Math.abs(spool.drumSpanMm[1] - spool.drumSpanMm[0]);
/** Turns of cord that lie side by side across the drum in one layer. */
export const turnsPerLayer = (spool, cordMm = 1.2) => Math.max(1, Math.floor(drumWidth(spool) / cordMm + 1e-6));
/** Layers that fit below the flange. */
export const layersThatFit = (spool, cordMm = 1.2) => Math.max(1, Math.floor((spool.flangeRadiusMm - spool.coreRadiusMm) / cordMm + 1e-6));
/** Turns the drum holds, full to the flange. */
export const turnsThatFit = (spool, cordMm = 1.2) => turnsPerLayer(spool, cordMm) * layersThatFit(spool, cordMm);
/** The radius of the cord's middle in `layer` (0 on the core). */
export const layerRadius = (spool, cordMm, layer) => spool.coreRadiusMm + cordMm * (layer + 0.5);

/** Rope taken up by `turns` turns, layer by layer from the core out. */
export function woundLengthMm(spool, cordMm, turns) {
  const per = turnsPerLayer(spool, cordMm);
  let left = Math.max(0, turns);
  let mm = 0;
  for (let layer = 0; left > 1e-9; layer++) {
    const t = Math.min(per, left);
    mm += t * 2 * Math.PI * layerRadius(spool, cordMm, layer);
    left -= t;
  }
  return mm;
}

/** The most turns `mm` of rope makes on the drum, rounded down to a quarter turn. */
export function turnsForLength(spool, cordMm, mm) {
  const per = turnsPerLayer(spool, cordMm);
  let left = Math.max(0, mm);
  let turns = 0;
  for (let layer = 0; left > 1e-9 && layer < 50; layer++) {
    const one = 2 * Math.PI * layerRadius(spool, cordMm, layer);
    const t = Math.min(per, left / one);
    turns += t;
    left -= t * one;
    if (t < per) break;
  }
  return Math.floor(turns * 4 + 1e-6) / 4;
}

/**
 * Where the cord is after `turns` turns from the pocket's end of the drum: its layer, the radius of
 * its middle and its height along the spool's axis (the turns of a layer lie side by side across the
 * drum, going back the other way in the next layer).
 */
export function windingAt(spool, cordMm, turns) {
  const per = turnsPerLayer(spool, cordMm);
  const [z0, z1] = spool.drumSpanMm;
  const pocketAtHi = (spool.pocket?.center?.[2] ?? 1) > (z0 + z1) / 2;
  const start = pocketAtHi ? z1 - cordMm / 2 : z0 + cordMm / 2;
  const dir = pocketAtHi ? -1 : 1;
  const t = Math.max(0, turns);
  const layer = Math.min(Math.floor(t / per + 1e-9), layersThatFit(spool, cordMm) - 1);
  const inLayer = Math.min(per, t - layer * per);
  // Even layers go away from the pocket, odd ones come back; the cord's height runs within the drum
  const along = Math.min(inLayer, per - 1) * cordMm;
  const height = layer % 2 === 0 ? start + dir * along : start + dir * ((per - 1) * cordMm - along);
  return { layer, radius: layerRadius(spool, cordMm, layer), height };
}

/** The shortest library rope at least `usedMm` long (with a spool: one more full turn), or null. */
export function suggestRope(usedMm, spool = null, cordMm = 1.2) {
  const extra = spool ? 2 * Math.PI * layerRadius(spool, cordMm, 0) : 0;
  const list = Object.entries(ROPE_SPECS).sort((a, b) => a[1].lengthMm - b[1].lengthMm);
  const fit = list.find(([, s]) => s.lengthMm >= usedMm + extra - 1e-6) || (spool ? list.find(([, s]) => s.lengthMm >= usedMm) : null);
  return fit ? { partNumber: fit[0], ...fit[1] } : null;
}

// ---------------------------------------------------------------------------------------------
// Ends and sides

/** A tab needs this much free post to sit on (its thickness and a little play). */
export const TAB_SPAN_MM = 4.6;

/**
 * Where a rope's end can go on a part, in the part's own frame: its posts (pin shanks, standoff
 * bodies, shafts) and, on a spool, its pocket. [{ feature, kind: 'post' | 'pocket', label, center,
 * axis, span }].
 */
export function endPlaces(part) {
  if (!part) return [];
  const out = [];
  const spool = spoolSpec(part);
  if (spool) out.push({ feature: 'pocket', kind: 'pocket', label: 'spool pocket', center: spool.pocket.center, axis: spool.axis, span: spool.pocket.spanMm.map((z) => z - spool.pocket.center[2]) });
  for (const s of partSpots(part)) if (s.kind === 'post') out.push({ feature: s.feature, kind: 'post', label: s.label, center: s.center, axis: s.axis, span: s.span });
  return out;
}

/** The drum spot of a spool, in its own frame (offered only to a rope whose end is in that spool). */
export function drumSpot(part) {
  const spool = spoolSpec(part);
  if (!spool) return null;
  const [z0, z1] = spool.drumSpanMm;
  return { feature: 'drum', kind: 'drum', label: 'drum', shape: 'circle', center: [0, 0, (z0 + z1) / 2], axis: spool.axis, radius: spool.coreRadiusMm, span: [(z0 - z1) / 2, (z1 - z0) / 2] };
}

const v3 = (a) => (a?.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));

/**
 * The way a rope goes round a spot when no side is given (design decision 1): on the side facing away
 * from the midpoint of the spots before and after it, the side a rope pulled tight presses on.
 * Returns 1 (anticlockwise about the spot's axis, right-hand rule) or -1.
 */
export function defaultTurn(prevPoint, spot, nextPoint) {
  const axis = v3(spot.axis).normalize();
  const c = v3(spot.center);
  const prev = v3(prevPoint);
  const next = v3(nextPoint);
  const mid = prev.clone().add(next).multiplyScalar(0.5);
  const away = c.clone().sub(mid);
  away.addScaledVector(axis, -away.dot(axis));
  if (away.lengthSq() < 1e-9) {
    // Spots in line: the side to the right of the way the rope runs
    const run = next.clone().sub(prev);
    away.crossVectors(run, axis);
  }
  return turnForSide(prev, spot, next, away);
}

/**
 * The way round a spot that puts the rope on a given side of it (`side`: a direction from the spot's
 * centre, world; the Rope builder gives where the spot was tapped). Returns 1 or -1 as defaultTurn does.
 */
export function turnForSide(prevPoint, spot, nextPoint, side) {
  const axis = v3(spot.axis).normalize();
  const out = v3(side);
  out.addScaledVector(axis, -out.dot(axis));
  if (out.lengthSq() < 1e-9) return defaultTurn(prevPoint, spot, nextPoint);
  const along = v3(nextPoint).sub(v3(prevPoint));
  const motion = new THREE.Vector3().crossVectors(axis, out.normalize());
  return motion.dot(along) >= 0 ? 1 : -1;
}

/**
 * A hanging curve between `a` and `b` (world points) whose length is their distance plus `slackMm`:
 * a parabola sagging along `down` in the plane through them. Returns the points from a to b.
 */
export function sagCurve(a, b, slackMm, down = new THREE.Vector3(0, -1, 0), steps = 24) {
  const A = v3(a);
  const B = v3(b);
  const L = A.distanceTo(B);
  const target = L + Math.max(0, slackMm);
  const pts = (d) => {
    const out = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      out.push(A.clone().lerp(B, t).addScaledVector(down, 4 * d * t * (1 - t)));
    }
    return out;
  };
  const len = (list) => list.reduce((s, p, k) => (k ? s + p.distanceTo(list[k - 1]) : 0), 0);
  if (slackMm <= 1e-3) return pts(0);
  let lo = 0;
  let hi = Math.max(target, 1);
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (len(pts(mid)) < target) lo = mid;
    else hi = mid;
  }
  return pts((lo + hi) / 2);
}

export const ropeLengthName = (part) => ropeSpec(part)?.name || part?.name || 'rope';
export { PITCH };
