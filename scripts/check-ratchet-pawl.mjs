/**
 * Node check for ratchets and pawls (openspec ratchet-and-pawl): the measured teeth and pawl tip,
 * the holding rule and the pawl's rest turn (src/utils/ratchetPawl.js), pawl spots and Set pawl
 * (src/engine/core.js), the audit, and a placed pawl swinging onto its ratchet
 * (src/utils/placementFit.js), against real catalog data, VEX's own Swish winch
 * (scripts/fixtures/swish-winch.json) and the engine's collision meshes.
 * Run: node scripts/check-ratchet-pawl.mjs   (exits 1 on any failure)
 */
import fs from 'node:fs';
import * as THREE from 'three';
import * as engine from '../mcp/assembly-engine.mjs';
import { measurePawl, measureRatchet } from './measure-part-geometry.mjs';
import { quaternionToEulerDeg, worldToothed } from '../src/utils/gearMeshing.js';
import { stringBand } from '../src/utils/bandRoute.js';
import { auditIssues } from '../src/utils/auditIssues.js';

const { auditAssembly, checkCandidateCollision, findPart, getPartRawGeometry, settlePlacedInstance } = engine;
// Built step by step: a missing piece fails its own cases, not the whole script
const rp = await import('../src/utils/ratchetPawl.js').catch((e) => ({ loadError: e }));
const { settlePlacement } = await import('../src/utils/placementFit.js');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
/** Runs a group of cases; an exception (a piece not built yet) fails it with the reason. */
const cases = (label, fn) => {
  try {
    fn();
  } catch (e) {
    check(label, false, e.message.split('\n')[0]);
  }
};

const part = (name) => {
  const p = findPart(name);
  if (!p || p.name !== name) throw new Error(`Catalog part not found: ${name}`);
  return p;
};
let nextId = 1;
const inst = (p, position, rotation = [0, 0, 0], label = null) => {
  const n = nextId++;
  return { instanceId: `i${n}`, partId: p.id, label: label || `${p.name} #${n}`, position, rotation, visible: true };
};
const vec = (a) => (a?.isVector3 ? a.clone() : new THREE.Vector3(...a));
const ratchetOf = (i) => rp.worldRatchet(findPart(i.partId), i.position, i.rotation, i.instanceId);
const pawlOf = (i) => rp.worldPawl(findPart(i.partId), i.position, i.rotation, i.instanceId);
const holeOf = (pawlInst, id) => pawlOf(pawlInst).holes.find((h) => h.id === id).point;
/** A pose mirrored across the world plane x = 0, for a part symmetric about its own z = 0 plane. */
const mirrorX = (i) => {
  const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...i.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ')));
  const m = new THREE.Matrix4().makeScale(-1, 1, 1).multiply(R).multiply(new THREE.Matrix4().makeScale(1, 1, -1));
  return { ...i, position: [-i.position[0], i.position[1], i.position[2]], rotation: quaternionToEulerDeg(new THREE.Quaternion().setFromRotationMatrix(m)) };
};
/** `i` turned by `deg` about the world line through `point` along `axis`. */
const turned = (i, axis, point, deg) => {
  const a = vec(axis).normalize();
  const q = new THREE.Quaternion().setFromAxisAngle(a, THREE.MathUtils.degToRad(deg));
  const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(...i.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
  return { ...i, position: vec(i.position).sub(vec(point)).applyQuaternion(q).add(vec(point)).toArray(), rotation: quaternionToEulerDeg(q.multiply(q0)) };
};

const R16 = part('16 Tooth Ratchet');
const R40 = part('40 Tooth Ratchet');
const PAWL = part('Short Low-Profile Pawl');
const G36 = part('36 Tooth Gear');
const PLATE = part('4x6 Plate');
const SHAFT = part('4x Pitch Shaft');
const PIN12 = part('1x2 Connector Pin');
const BEAM12 = part('1x2 Beam');

/** The ratchet's real outline radius at the world direction of `point` (raycast on its mesh). */
function meshRadiusAt(ratchetInst, point, extraTurnDeg = 0) {
  const meta = findPart(ratchetInst.partId);
  const geo = getPartRawGeometry(meta);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...ratchetInst.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
  const local = vec(point).sub(vec(ratchetInst.position)).applyQuaternion(q.clone().invert());
  // The ratchet turned by extraTurnDeg about its own +Z sees the point turned back by as much
  local.applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-extraTurnDeg));
  const dir = new THREE.Vector3(local.x, local.y, 0).normalize();
  const ray = new THREE.Ray(new THREE.Vector3(dir.x * 50, dir.y * 50, local.z), dir.clone().negate());
  const hit = geo.boundsTree.raycastFirst(ray, THREE.DoubleSide);
  return hit ? 50 - hit.distance : null;
}
/** Distance (mm) from a world point in the ratchet's plane to the ratchet's real outline. */
function meshOutlineDistance(ratchetInst, point) {
  const meta = findPart(ratchetInst.partId);
  const geo = getPartRawGeometry(meta);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...ratchetInst.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
  const local = vec(point).sub(vec(ratchetInst.position)).applyQuaternion(q.clone().invert());
  const a0 = Math.atan2(local.y, local.x);
  let best = Infinity;
  for (let k = -400; k <= 400; k++) {
    const a = a0 + THREE.MathUtils.degToRad(k * 0.01);
    const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    const hit = geo.boundsTree.raycastFirst(new THREE.Ray(new THREE.Vector3(dir.x * 50, dir.y * 50, local.z), dir.clone().negate()), THREE.DoubleSide);
    if (!hit) continue;
    const p = dir.multiplyScalar(50 - hit.distance);
    best = Math.min(best, Math.hypot(p.x - local.x, p.y - local.y));
  }
  return best;
}
/** How near (mm) the pawl's tip (its outline within 1 mm of the tip point) comes to the ratchet's real outline. */
function tipTouchDistance(ratchetInst, pawlInst) {
  const pawl = pawlOf(pawlInst);
  const local = PAWL.ratchetSpecs.outline;
  const z = PAWL.ratchetSpecs.tipPoint[2];
  const pts = [];
  for (let i = 0; i < local.length; i++) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    for (let k = 0; k < 4; k++) pts.push(new THREE.Vector3(a[0] + ((b[0] - a[0]) * k) / 4, a[1] + ((b[1] - a[1]) * k) / 4, z));
  }
  const tipLocal = vec(PAWL.ratchetSpecs.tipPoint);
  const near = pts.filter((p) => p.distanceTo(tipLocal) <= 1).map((p) => p.applyQuaternion(pawl.quaternion).add(pawl.position));
  return Math.min(...near.map((p) => meshOutlineDistance(ratchetInst, p)));
}
/**
 * Turning the ratchet `sign` (about its axis) through one tooth from where it is, the biggest rise
 * of its real outline under a fixed point in one 0.1° step: a steep side running into the point
 * rises over a millimetre at once, a sloped side passing under it by a few hundredths.
 */
function steepestRiseUnder(ratchetInst, point, sign) {
  const meta = findPart(ratchetInst.partId);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...ratchetInst.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  // Turning about world `axis` by +d is turning about the part's own +Z by +d
  const period = 360 / meta.ratchetSpecs.teeth;
  let prev = meshRadiusAt(ratchetInst, point, 0);
  let rise = 0;
  for (let d = 0.1; d <= period + 1e-9; d += 0.1) {
    const r = meshRadiusAt(ratchetInst, point, sign * d);
    if (r != null && prev != null) rise = Math.max(rise, r - prev);
    prev = r;
  }
  return { rise, axis };
}

// --- Measured ratchet and pawl data --------------------------------------------------------------
cases('Ratchet data', () => {
  for (const [p, teeth] of [[R16, 16], [R40, 40]]) {
    const s = p.ratchetSpecs;
    check(
      `${p.name}: ${teeth} teeth, tip and root radius, tooth angle and lean`,
      s?.kind === 'ratchet' && s.teeth === teeth && s.tipRadiusMm > s.rootRadiusMm && Number.isFinite(s.toothPhaseDeg) && [1, -1].includes(s.lean),
      JSON.stringify({ ...s, profileMm: s?.profileMm?.length })
    );
    check(`  its tip radius is within 0.2 mm of its box (${s?.tipRadiusMm} vs ${p.bbox.max[0]})`, Math.abs(s.tipRadiusMm - p.bbox.max[0]) <= 0.2);
    check(`  its tooth band is the pawl's thickness about its middle (${s?.faceSpanMm})`, Math.abs(s.faceSpanMm[0] + 2.29) < 0.05 && Math.abs(s.faceSpanMm[1] - 2.29) < 0.05);
    const again = measureRatchet(p, p.gearSpecs.teeth);
    const { measured, ...fresh } = again;
    check('  measuring it twice gives the same values as the part data', JSON.stringify(fresh) === JSON.stringify(s) && JSON.stringify(measureRatchet(p, teeth)) === JSON.stringify(again));
  }
  const s = PAWL.ratchetSpecs;
  check(
    'Short Low-Profile Pawl: tip below its hole row, facing away from the holes, 4.57 mm thick',
    s?.kind === 'pawl' && s.tipPoint[1] < -4 && s.tipNormal[0] < -0.9 && Math.abs(s.thicknessMm - PAWL.bbox.size[2]) < 0.02 && s.holes.length === 4,
    JSON.stringify(s)
  );
  const { measured, ...fresh } = measurePawl(PAWL, PAWL.ports.filter((p) => p.type === 'pin_hole'));
  check('  measuring it twice gives the same tip', JSON.stringify(fresh.tipPoint) === JSON.stringify(s.tipPoint) && JSON.stringify(fresh.tipNormal) === JSON.stringify(s.tipNormal));
  // The tip lies on the pawl's real outline: just outside it is air, just inside it is plastic
  const geo = getPartRawGeometry(PAWL);
  const inside = (x, y) => geo.boundsTree.raycast(new THREE.Ray(new THREE.Vector3(x, y, 0), new THREE.Vector3(0, 0, 1)), THREE.DoubleSide).length % 2 === 1;
  const [tx, ty] = s.tipPoint;
  const n = s.tipNormal;
  check('  the tip is on the outline (plastic 0.2 mm in, air 0.2 mm out)', inside(tx - n[0] * 0.2 + 0.1, ty - n[1] * 0.2 + 0.1) && !inside(tx + n[0] * 0.2, ty + n[1] * 0.2));
});

cases('Ratchet beside a gear', () => {
  for (const d of [8.467 + 19.05, 25, 30, 40]) {
    const r = inst(R16, [0, 0, 0]);
    const g = inst(G36, [d, 0, 0]);
    const meshed = auditAssembly({ instances: [r, g] }).kinematics.meshedGearPairs;
    check(`a 16 Tooth Ratchet and a 36 Tooth Gear ${d.toFixed(1)} mm apart are not meshing`, meshed.length === 0, JSON.stringify(meshed));
    const rTurn = settlePlacedInstance(r, [g, r]).patches.find((p) => p.instanceId === r.instanceId);
    const gTurn = settlePlacedInstance(g, [r, g]).patches.find((p) => p.instanceId === g.instanceId);
    check('  and neither turns to fit the other when placed', !rTurn && !gTurn, JSON.stringify({ rTurn, gTurn }));
  }
  check('a ratchet has no meshing teeth', worldToothed(R16, [0, 0, 0], [0, 0, 0]) === null && R16.gearSpecs.measured === false);
  const p = inst(PAWL, [0, 0, 0]);
  const g = inst(G36, [14.655 + 19.05, 2.2, 0]);
  check('a pawl beside a gear is not meshing either', auditAssembly({ instances: [p, g] }).kinematics.meshedGearPairs.length === 0);
});

// --- Swish winch from VEX's CAD ---------------------------------------------------------------------
const swish = JSON.parse(fs.readFileSync(new URL('./fixtures/swish-winch.json', import.meta.url), 'utf8'));
const swishInstances = swish.parts.map((p) => ({ ...p, visible: true }));
const swishRatchet = swishInstances.find((i) => findPart(i.partId)?.name === '16 Tooth Ratchet');
const swishPawl = swishInstances.find((i) => findPart(i.partId)?.name === 'Short Low-Profile Pawl');
const swishPivotPin = swishInstances.find((i) => i.label.endsWith('228-2500-062-4'));
const AXIS_Z = new THREE.Vector3(0, 0, 1);

// --- When a pawl holds a ratchet ---------------------------------------------------------------------
// The Swish winch's ratchet and pawl, moved to the origin: a pawl VEX drew holding a ratchet
const offset = vec(swishRatchet.position);
const r0 = inst(R16, [0, 0, 0], swishRatchet.rotation, 'Ratchet');
const p0 = inst(PAWL, vec(swishPawl.position).sub(offset).toArray(), swishPawl.rotation, 'Pawl');
const pivot0 = () => [{ point: holeOf(p0, 'hole.thru.2_0_0'), axis: AXIS_Z }];

cases('Pawl in the teeth', () => {
  if (rp.loadError) throw rp.loadError;
  const rel = rp.pawlRelation(ratchetOf(r0), pawlOf(p0), { pivots: pivot0() });
  check('a pawl pinned beside a 16 Tooth Ratchet with its tip in the teeth holds it', rel?.holds === true && rel.wrongWay === false, JSON.stringify(rel));
  // The free direction is the one in which sloped sides pass under the tip: read off the real mesh
  const free = steepestRiseUnder(r0, pawlOf(p0).tip, rel.freeSign * Math.sign(rel.axis.dot(AXIS_Z)));
  const held = steepestRiseUnder(r0, pawlOf(p0).tip, -rel.freeSign * Math.sign(rel.axis.dot(AXIS_Z)));
  check(
    `  its free direction turns sloped sides under the tip (outline rises at most ${free.rise.toFixed(3)} mm per 0.1°) and the other way a steep side into it (${held.rise.toFixed(2)} mm)`,
    free.rise < 0.1 && held.rise > 1
  );
  const tip = rp.pawlRestTurn(ratchetOf(r0), pawlOf(p0), pivot0()[0]);
  check('  the rest turn from VEX\'s pose is small (the pawl is drawn on the teeth)', tip && Math.abs(tip.turnDeg) < 1, JSON.stringify(tip?.turnDeg));
});

cases('Ratchet turned over', () => {
  if (rp.loadError) throw rp.loadError;
  const rel = rp.pawlRelation(ratchetOf(r0), pawlOf(p0), { pivots: pivot0() });
  // The same build mirrored across a plane through the shaft: the ratchet is turned over on its
  // shaft and the pawl set on it from the matching side
  const r1 = mirrorX(r0);
  const p1 = mirrorX(p0);
  const rel1 = rp.pawlRelation(ratchetOf(r1), pawlOf(p1), { pivots: [{ point: holeOf(p1, 'hole.thru.2_0_0'), axis: AXIS_Z }] });
  const world = (r) => r.axis.clone().multiplyScalar(r.freeSign);
  check('the ratchet turned over (and the pawl set from the matching side) still holds', rel1?.holds === true, JSON.stringify(rel1));
  check('  and its free direction is the opposite one', world(rel1).dot(world(rel)) < -0.99, `${world(rel).toArray()} vs ${world(rel1).toArray()}`);
});

cases('Pawl out of plane', () => {
  if (rp.loadError) throw rp.loadError;
  const up = { ...p0, position: vec(p0.position).add(new THREE.Vector3(0, 0, 6.35)).toArray() };
  const rel = rp.pawlRelation(ratchetOf(r0), pawlOf(up), { pivots: [{ point: holeOf(up, 'hole.thru.2_0_0'), axis: AXIS_Z }] });
  check('a pawl one beam thickness further along the shaft does not hold the ratchet', !rel?.holds, JSON.stringify(rel));
  const tilted = turned(p0, new THREE.Vector3(1, 0, 0), holeOf(p0, 'hole.thru.2_0_0'), 5);
  check('  nor does a pawl tilted 5° off the shaft', !rp.pawlRelation(ratchetOf(r0), pawlOf(tilted))?.holds);
});

cases('Pawl facing the wrong way', () => {
  if (rp.loadError) throw rp.loadError;
  // Mirror the pawl alone across the plane through the shaft and its tip: the tip stays in the
  // teeth, but now points the way the teeth lean
  const tip = pawlOf(p0).tip;
  const n = new THREE.Vector3(-tip.y, tip.x, 0).normalize(); // normal of that plane
  const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...p0.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ')));
  const S = new THREE.Matrix4().set(1 - 2 * n.x * n.x, -2 * n.x * n.y, 0, 0, -2 * n.x * n.y, 1 - 2 * n.y * n.y, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const m = S.clone().multiply(R).multiply(new THREE.Matrix4().makeScale(1, 1, -1));
  const pos = vec(p0.position).applyMatrix4(S);
  const wrong = { ...p0, position: pos.toArray(), rotation: quaternionToEulerDeg(new THREE.Quaternion().setFromRotationMatrix(m)) };
  check('  (the mirrored pawl\'s tip is where it was)', pawlOf(wrong).tip.distanceTo(tip) < 0.01);
  const rel = rp.pawlRelation(ratchetOf(r0), pawlOf(wrong), { pivots: [{ point: holeOf(wrong, 'hole.thru.2_0_0'), axis: AXIS_Z }] });
  check('a pawl in the teeth pointing the way they lean faces the wrong way', rel?.wrongWay === true, JSON.stringify(rel));
  check('  and the ratchet counts as free both ways', rel?.holds === false && rel.freeSign === 0);
});

cases('Swish winch pawl (VEX CAD)', () => {
  if (rp.loadError) throw rp.loadError;
  const r = ratchetOf(swishRatchet);
  const p = pawlOf(swishPawl);
  const pivot = { point: holeOf(swishPawl, 'hole.thru.2_0_0'), axis: AXIS_Z };
  check('the Swish pawl\'s hole 2_0_0 is on its 2x2 pin', vec(swishPivotPin.position).setZ(0).distanceTo(pivot.point.clone().setZ(0)) < 0.05);
  const rel = rp.pawlRelation(r, p, { pivots: [pivot] });
  console.log(`      Swish: tip ${rel?.radiusMm} mm from the ratchet's centre (tip circle ${r.tipRadius}, root ${r.rootRadius}), ${rel?.gapMm} mm above the outline, catch angle ${rel?.catchDeg}°, real outline there ${meshRadiusAt(swishRatchet, p.tip)?.toFixed(3)} mm`);
  // Winding turns the motor shaft clockwise seen from +Z and the arm's shaft anticlockwise
  check('VEX\'s Swish pawl holds its ratchet, free anticlockwise seen from +Z (the winding way)', rel?.holds === true && rel.axis.clone().multiplyScalar(rel.freeSign).z > 0.99, JSON.stringify(rel));
});

// --- The pawl's rest turn ----------------------------------------------------------------------------
cases('Rest turn', () => {
  if (rp.loadError) throw rp.loadError;
  const r = inst(R16, [0, 0, 0], [0, 0, 17], 'Ratchet');
  const ratchet = ratchetOf(r);
  let worst = 0;
  let count = 0;
  const notHeld = [];
  const overlapping = [];
  const restsAt = new Map(); // distance -> angles with a rest
  for (const dist of [15, 20, 25, 28, 30]) {
    restsAt.set(dist, new Set());
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI * 2) / 12;
      const P = new THREE.Vector3(Math.cos(a) * dist, Math.sin(a) * dist, 0);
      for (const holeId of PAWL.ratchetSpecs.holes) {
        const port = PAWL.ports.find((x) => x.portId === holeId);
        for (const flip of [[0, 0, k * 30], [180, 0, k * 30]]) {
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...flip.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
          const pawlInst = inst(PAWL, P.clone().sub(vec(port.origin).applyQuaternion(q)).toArray(), flip);
          const rest = rp.pawlRestTurn(ratchet, pawlOf(pawlInst), { point: P, axis: AXIS_Z });
          if (!rest) continue;
          const at = turned(pawlInst, AXIS_Z, P, rest.turnDeg);
          worst = Math.max(worst, tipTouchDistance(r, at));
          count++;
          restsAt.get(dist).add(k);
          if (!rest.relation.holds) notHeld.push(`${dist}/${k}/${holeId}`);
          // The whole pawl rests on the teeth: touching (a tight fit) but not passing into them
          if (checkCandidateCollision(at, [r]).isIntersecting) overlapping.push(`${dist} mm ${k * 30}° ${holeId}${flip[0] ? ' turned over' : ''}`);
        }
      }
    }
  }
  console.log(`      rests found at 12 angles: ${[...restsAt].map(([d, s]) => `${d} mm ${s.size}`).join(', ')}`);
  check(`pivots 15–30 mm from a 16 Tooth Ratchet at 12 angles: every rest has the pawl within 0.1 mm of touching the real outline at its tip (worst ${worst.toFixed(3)} mm over ${count}) and holds`, count > 0 && worst <= 0.1 && notHeld.length === 0, notHeld.join(' '));
  check(`  no rest leaves the pawl overlapping the ratchet (${overlapping.length} of ${count} do)`, overlapping.length === 0, overlapping.slice(0, 6).join('; '));
  check('  a pivot 28 mm out gives a rest at every angle', restsAt.get(28).size === 12, String(restsAt.get(28).size));
  check('  and the ratchet\'s pose is untouched', r.rotation[2] === 17 && r.position.every((v) => v === 0));
  // 18 mm out on hole 2_0_0 the tip reaches the teeth, but the pawl's underside lands on them first
  const close = new THREE.Vector3(18, 0, 0);
  const port2 = PAWL.ports.find((x) => x.portId === 'hole.thru.2_0_0');
  const closePawl = inst(PAWL, close.clone().sub(vec(port2.origin)).toArray());
  const lever = pawlOf(closePawl).tip.distanceTo(close);
  check(`a pawl whose body touches the teeth before its tip gives no rest turn (18 mm out, hole 2_0_0, tip ${lever.toFixed(1)} mm from the pin)`, lever > 18 - ratchet.tipRadius && rp.pawlRestTurn(ratchet, pawlOf(closePawl), { point: close, axis: AXIS_Z }) === null);
  const far = new THREE.Vector3(45, 0, 0);
  const port = PAWL.ports.find((x) => x.portId === 'hole.thru.4_0_0');
  const farPawl = inst(PAWL, far.clone().sub(vec(port.origin)).toArray());
  check('a pivot further than the pawl reaches gives no rest turn', rp.pawlRestTurn(ratchet, pawlOf(farPawl), { point: far, axis: AXIS_Z }) === null);
});

// --- Pawl spots and Set pawl -------------------------------------------------------------------------
// A ratchet on a shaft between two 4x6 Plates (faces against its hub), plate hole (-6.35, -6.35) on the shaft
const plateZ = 3.175 + 3.05;
const between = () => {
  const r = inst(R16, [0, 0, 0], [0, 0, 0], 'Ratchet');
  return {
    ratchet: r,
    instances: [
      r,
      inst(SHAFT, [0, 0, 0], [0, 0, 0], 'Shaft'),
      inst(PLATE, [6.35, 6.35, -plateZ], [0, 0, 0], 'Lower Plate'),
      inst(PLATE, [6.35, 6.35, plateZ], [0, 0, 0], 'Upper Plate')
    ]
  };
};
const loosePawl = () => inst(PAWL, [40, -40, 0], [0, 0, 0], 'Pawl');

cases('Pawl spots', () => {
  if (typeof engine.listPawlSpots !== 'function') throw new Error('listPawlSpots is not built yet');
  const { ratchet, instances } = between();
  const pawl = loosePawl();
  const state = { instances: [...instances, pawl] };
  const res = engine.listPawlSpots(state, { pawlId: pawl.instanceId, ratchetId: ratchet.instanceId });
  const spots = res.spots || [];
  console.log(`      16 Tooth Ratchet between two 4x6 Plates: ${spots.length} spots, ${spots.filter((x) => !x.blocked).length} free: ${spots.map((x) => `${x.spot} ${x.pinTo.label} ${x.pawlHole}${x.turnedOver ? ' over' : ''} ${x.freeDirection}`).join('; ')}`);
  check(`a ratchet between two plates gives pawl spots (${spots.length})`, res.ok && spots.length >= 4, JSON.stringify(res).slice(0, 300));
  const free = spots.filter((s) => !s.blocked);
  const held = free.every((s) => {
    const at = { ...pawl, ...s.pose };
    const pin = s.pinTo.point;
    const rel = rp.pawlRelation(ratchetOf(ratchet), pawlOf(at), { pivots: [{ point: vec(pin), axis: AXIS_Z }] });
    return rel?.holds && !checkCandidateCollision(at, instances).isIntersecting;
  });
  check(`  every free spot (${free.length}) holds the ratchet and overlaps no part`, free.length >= 4 && held);
  check('  each pins the pawl to a plate hole, with the hole lined up', spots.every((s) => /Plate/.test(s.pinTo.label) && s.pinTo.kind === 'hole'));
  const angles = spots.map((s) => s.angleDeg);
  check('  spots come out in order round the ratchet', angles.every((a, i) => i === 0 || a >= angles[i - 1]), angles.join(', '));
  check('  listing changes nothing', state.instances.find((i) => i.instanceId === pawl.instanceId).position[0] === 40);

  const bare = { instances: [inst(R16, [0, 0, 0], [0, 0, 0], 'Ratchet'), inst(SHAFT, [0, 0, 0]), loosePawl()] };
  const none = engine.listPawlSpots(bare, { pawlId: bare.instances[2].instanceId, ratchetId: bare.instances[0].instanceId });
  check('a ratchet on a bare shaft gives no spots, with the reason', none.spots?.length === 0 && /beam or plate beside the ratchet/.test(none.message || ''), JSON.stringify(none));

  // A 1x2 Beam lying between the plates where the first free spot's pawl would be
  const first = free[0];
  const at = { ...pawl, ...first.pose };
  const center = vec(PAWL.bbox.center).applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...at.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'))).add(vec(at.position));
  const beam = inst(BEAM12, [center.x, center.y, 0], [0, 0, 0], 'Blocking Beam');
  const blockedState = { instances: [...instances, beam, pawl] };
  const res2 = engine.listPawlSpots(blockedState, { pawlId: pawl.instanceId, ratchetId: ratchet.instanceId });
  const same = res2.spots.find((s) => s.pose && vec(s.pose.position).distanceTo(vec(first.pose.position)) < 0.01);
  check('a spot with a beam in the way is marked blocked, naming the beam', same?.blocked === true && same.blockedBy.includes('Blocking Beam'), JSON.stringify(same));
});

cases('40 Tooth Ratchet spots', () => {
  if (typeof engine.listPawlSpots !== 'function') throw new Error('listPawlSpots is not built yet');
  const r = inst(R40, [0, 0, 0], [0, 0, 0], 'Ratchet 40');
  const instances = [r, inst(SHAFT, [0, 0, 0]), inst(PLATE, [6.35, 6.35, -plateZ], [0, 0, 0], 'Lower Plate'), inst(PLATE, [6.35, 6.35, plateZ], [0, 0, 0], 'Upper Plate')];
  const pawl = loosePawl();
  const res = engine.listPawlSpots({ instances: [...instances, pawl] }, { pawlId: pawl.instanceId, ratchetId: r.instanceId });
  const free = (res.spots || []).filter((s) => !s.blocked);
  console.log(`      40 Tooth Ratchet between two 4x6 Plates: ${res.spots?.length} spots, ${free.length} free`);
  check('a 40 Tooth Ratchet between plates gives free spots that hold', free.length >= 1 && free.every((s) => rp.pawlRelation(ratchetOf(r), pawlOf({ ...pawl, ...s.pose }), { pivots: [{ point: vec(s.pinTo.point), axis: AXIS_Z }] })?.holds));
  check('  none pins the pawl to the ratchet\'s own holes', (res.spots || []).every((s) => s.pinTo.instanceId !== r.instanceId));
});

cases('Swish spots', () => {
  if (typeof engine.listPawlSpots !== 'function') throw new Error('listPawlSpots is not built yet');
  // Take the pawl out of VEX's winch: the spots round its ratchet include where VEX put it
  const pawl = { ...swishPawl, position: [200, 200, 0], rotation: [0, 0, 0] };
  const state = { instances: swishInstances.map((i) => (i.instanceId === swishPawl.instanceId ? pawl : i)) };
  const res = engine.listPawlSpots(state, { pawlId: pawl.instanceId, ratchetId: swishRatchet.instanceId });
  const cadTip = pawlOf(swishPawl).tip;
  const match = (res.spots || []).find((s) => s.pinTo.instanceId === swishPivotPin.instanceId && s.pawlHole === 'hole.thru.2_0_0' && pawlOf({ ...pawl, ...s.pose }).tip.clone().setZ(0).distanceTo(cadTip.clone().setZ(0)) < 0.3);
  check(`Swish winch without its pawl: the spots (${res.spots?.length}) include VEX's pose, on the 2x2 pin through hole 2_0_0`, Boolean(match), JSON.stringify((res.spots || []).map((s) => [s.spot, s.pinTo.label, s.pawlHole, s.blocked])));
  check('  and that spot is free', match?.blocked === false, JSON.stringify(match?.blockedBy));
});

cases('Set pawl', () => {
  if (typeof engine.setPawl !== 'function') throw new Error('setPawl is not built yet');
  const { ratchet, instances } = between();
  const pawl = loosePawl();
  const s0 = { instances: [...instances, pawl] };
  const list = engine.listPawlSpots(s0, { pawlId: pawl.instanceId, ratchetId: ratchet.instanceId }).spots.filter((s) => !s.blocked);
  // Double-click: the spot nearest the click
  const click = pawlOf({ ...pawl, ...list[2].pose }).tip; // a click on the teeth where spot 3's tip rests
  const a = engine.setPawl(s0, { pawlId: pawl.instanceId, ratchetId: ratchet.instanceId, near: click.toArray() });
  const placed = a.state?.instances.find((i) => i.instanceId === pawl.instanceId);
  const rat = a.state?.instances.find((i) => i.instanceId === ratchet.instanceId);
  check('double-click: the pawl moves to the spot nearest the click, as one history step', a.ok && a.record === true && a.spot === list[2].spot, JSON.stringify({ ok: a.ok, spot: a.spot, want: list[2].spot, error: a.error }));
  check('  one of its holes lines up with a plate hole and its tip rests in the teeth', a.ok && rp.pawlRelation(ratchetOf(rat), pawlOf(placed), { pivots: [{ point: vec(list[2].pinTo.point), axis: AXIS_Z }] })?.holds);
  check('  the ratchet has not moved', JSON.stringify(rat?.position) === JSON.stringify(ratchet.position) && JSON.stringify(rat?.rotation) === JSON.stringify(ratchet.rotation));
  check('  undo (the state before) puts the pawl back', s0.instances.find((i) => i.instanceId === pawl.instanceId).position[0] === 40);
  // Tools menu: from the pawl's own place, the nearest spot
  const near = { ...pawl, position: vec(list[1].pose.position).add(new THREE.Vector3(3, 3, 0)).toArray() };
  const b = engine.setPawl({ instances: [...instances, near] }, { pawlId: pawl.instanceId, ratchetId: ratchet.instanceId });
  check('Tools menu: the pawl moves to the spot nearest where it is', b.ok && b.spot === list[1].spot, JSON.stringify({ spot: b.spot, want: list[1].spot, error: b.error }));
  // Next spot: set again
  const c = engine.setPawl(b.state, { pawlId: pawl.instanceId, ratchetId: ratchet.instanceId });
  // The next spot at a different angle round the ratchet (a twin at the same angle, against the other plate, is skipped)
  const from = list.find((s) => s.spot === b.spot);
  const at = list.findIndex((s) => s.spot === b.spot);
  const next = [...list.slice(at + 1), ...list.slice(0, at)].find((s) => Math.abs(((s.angleDeg - from.angleDeg + 540) % 360) - 180) > 1);
  const cSpot = list.find((s) => s.spot === c.spot);
  check(
    `setting it again steps to the next spot round the ratchet (${from.angleDeg}° -> ${cSpot?.angleDeg}°)`,
    c.ok && c.spot === next.spot && cSpot.angleDeg > from.angleDeg,
    JSON.stringify({ spot: c.spot, want: next.spot })
  );
  // A double-click somewhere else on the ratchet after setting: the spot nearest that click, not the next one
  const far = list.reduce((a, s2) => (Math.abs(((s2.angleDeg - from.angleDeg + 540) % 360) - 180) > Math.abs(((a.angleDeg - from.angleDeg + 540) % 360) - 180) ? s2 : a));
  const e = engine.setPawl(b.state, { pawlId: pawl.instanceId, ratchetId: ratchet.instanceId, near: pawlOf({ ...pawl, ...far.pose }).tip.toArray() });
  check('after setting, a double-click elsewhere on the ratchet goes to the spot nearest that click', e.ok && list.find((s2) => s2.spot === e.spot)?.angleDeg === far.angleDeg, JSON.stringify({ spot: e.spot, want: far.spot }));
  const f = engine.setPawl(b.state, { pawlId: pawl.instanceId, ratchetId: ratchet.instanceId, near: pawlOf({ ...pawl, ...from.pose }).tip.toArray() });
  check('  and a double-click where it already rests steps to the next spot', f.ok && f.spot === next.spot, JSON.stringify({ spot: f.spot, want: next.spot }));
  // Round and round: setting it again and again visits every angle once before coming back
  let st = c.state;
  const seen = [cSpot.angleDeg];
  const distinct = [...new Set(list.map((s) => s.angleDeg))].length;
  for (let k = 1; k < distinct; k++) {
    const r = engine.setPawl(st, { pawlId: pawl.instanceId, ratchetId: ratchet.instanceId });
    if (!r.ok) break;
    st = r.state;
    seen.push(list.find((s) => s.spot === r.spot).angleDeg);
  }
  check(`  and keeps walking round: ${distinct} different angles, each visited before any repeats`, new Set(seen).size === distinct, seen.join(', '));
  const bare = { instances: [inst(R16, [0, 0, 0], [0, 0, 0], 'Ratchet'), inst(SHAFT, [0, 0, 0]), loosePawl()] };
  const d = engine.setPawl(bare, { pawlId: bare.instances[2].instanceId, ratchetId: bare.instances[0].instanceId });
  check('nothing to pin to: nothing moves and the message says it needs a beam or plate beside the ratchet', d.ok === false && !d.state && /beam or plate beside the ratchet/.test(d.error || ''), JSON.stringify(d));
});

// --- A placed pawl swings onto its ratchet --------------------------------------------------------------
// One plate under the ratchet, a 1x2 pin standing in a plate hole, its long leg up through the ratchet's plane
const swingBuild = (holeXY) => {
  const r = inst(R16, [0, 0, 0], [0, 0, 0], 'Ratchet');
  const plate = inst(PLATE, [6.35, 6.35, -plateZ], [0, 0, 0], 'Plate');
  // The pin's shoulder on the plate's top face (z = -3.175), long leg up
  const pin = inst(PIN12, [holeXY[0], holeXY[1], -3.175], [180, 0, 0], 'Pin');
  return { r, instances: [r, inst(SHAFT, [0, 0, 0]), plate, pin], pin };
};
/** A pawl with hole 2_0_0 on the pin, turned `deg`, in the ratchet's plane against the plate. */
const pawlOnPin = (pin, deg) => {
  const q = new THREE.Quaternion().setFromAxisAngle(AXIS_Z, THREE.MathUtils.degToRad(deg));
  const hole = vec(PAWL.ports.find((p) => p.portId === 'hole.thru.2_0_0').origin).applyQuaternion(q);
  return inst(PAWL, [pin.position[0] - hole.x, pin.position[1] - hole.y, -3.175 + 2.286], [0, 0, deg], 'Pawl');
};
const swing = (instances, placed, flags = {}) =>
  settlePlacement({ placedId: placed.instanceId, instances: [...instances, placed], partOf: (i) => findPart(i.partId), featuresOf: engine.worldFeaturesFor, ...flags });

cases('Pawl dropped on a pin', () => {
  if (rp.loadError) throw rp.loadError;
  const pinAt = [25.4, 12.7]; // 28.4 mm out: hole 2_0_0 rests on the teeth at every tooth alignment from about 28 mm
  const { r, instances, pin } = swingBuild(pinAt);
  const pawl = pawlOnPin(pin, 0);
  const res = swing(instances, pawl);
  const own = res.patches.find((p) => p.instanceId === pawl.instanceId);
  const at = own ? { ...pawl, ...own } : pawl;
  const rel = rp.pawlRelation(ratchetOf(r), pawlOf(at), { pivots: [{ point: new THREE.Vector3(...pinAt, 0), axis: AXIS_Z }] });
  check(`a pawl dropped on a pin ${Math.hypot(...pinAt).toFixed(1)} mm from the ratchet's shaft lands turned so its tip rests in the teeth`, Boolean(own) && rel?.holds === true && tipTouchDistance(r, at) <= 0.1, JSON.stringify({ own, rel }));
  check('  without passing into the ratchet', !checkCandidateCollision(at, [r]).isIntersecting);
  check('  still on the pin', pawlOf(at).holes.find((h) => h.id === 'hole.thru.2_0_0').point.clone().setZ(0).distanceTo(new THREE.Vector3(...pinAt, 0)) < 0.01);
  check('  the ratchet does not move', !res.patches.some((p) => p.instanceId === r.instanceId));
  check('  and the message says so', res.messages.some((m) => /pawl|Pawl/.test(m) && /Ratchet/.test(m)), JSON.stringify(res.messages));
});

cases('Pawl with a band post', () => {
  // A 0x2 pin seated in the pawl alone (a post for its band, as on Swish) is not a second pivot
  const pinAt = [25.4, 12.7];
  const { r, instances, pin } = swingBuild(pinAt);
  const pawl = pawlOnPin(pin, 0);
  const post = holeOf(pawl, 'hole.thru.4_0_0');
  const postPin = inst(part('0x2 Connector Pin'), [post.x, post.y, -3.175 + 2.286], [0, 0, 0], 'Band Post');
  const res = swing([...instances, postPin], pawl);
  const own = res.patches.find((p) => p.instanceId === pawl.instanceId);
  const rel = own && rp.pawlRelation(ratchetOf(r), pawlOf({ ...pawl, ...own }), { pivots: [{ point: new THREE.Vector3(...pinAt, 0), axis: AXIS_Z }] });
  check('a pawl on its pin with a band post in another hole still swings onto the teeth', rel?.holds === true, JSON.stringify(res.patches));
});

cases('Pushed onto a long pin', () => {
  if (typeof rp.pawlHoldsAt !== 'function') throw new Error('pawlHoldsAt is not built yet');
  // A pawl turned to rest while pushed onto its pin keeps the turn only where it lands holding the ratchet
  const pinAt = [25.4, 12.7];
  const { instances, pin } = swingBuild(pinAt);
  const turnedRest = (() => {
    const pawl = pawlOnPin(pin, 0);
    const own = swing(instances, pawl).patches.find((p) => p.instanceId === pawl.instanceId);
    return { ...pawl, ...own };
  })();
  const holds = (pawl, list) => rp.pawlHoldsAt({ pawlId: pawl.instanceId, instances: [...list, pawl], partOf: (i) => findPart(i.partId), featuresOf: engine.worldFeaturesFor });
  check('the swung pawl in the ratchet\'s plane, on its pin: it holds there, so it keeps the turn', holds(turnedRest, instances));
  // The 1x2 pin's long leg ends 8.6 mm up; pushed on, the pawl stops at its end, above the teeth
  const atPinEnd = { ...turnedRest, position: [turnedRest.position[0], turnedRest.position[1], 6.5] };
  check('the same turn where a push onto a 1x2 pin stops (at the pin\'s end, above the teeth): it doesn\'t hold there, so it is left unturned', !holds(atPinEnd, instances));
  check('  and the placement step leaves a pawl there unturned', !swing(instances, { ...pawlOnPin(pin, 0), position: [pawlOnPin(pin, 0).position[0], pawlOnPin(pin, 0).position[1], 6.5] }).patches.some((p) => p.label === 'Pawl' || p.rotation));
});

cases('Ratchet out of reach', () => {
  const { instances, pin } = swingBuild([38.1, 25.4]);
  const pawl = pawlOnPin(pin, 0);
  const res = swing(instances, pawl);
  check('a pawl on a pin further than it can reach is placed as any other part, not turned', !res.patches.some((p) => p.instanceId === pawl.instanceId), JSON.stringify(res.patches));
});

cases('In reach, no clean rest', () => {
  // 18 mm out on hole 2_0_0 the tip reaches the teeth but the pawl's body lands on them first
  const { instances, pin } = swingBuild([12.7, 12.7]);
  const pawl = pawlOnPin(pin, 0);
  const res = swing(instances, pawl);
  check('a pawl on a pin in reach with no clean rest is placed without turning', !res.patches.some((p) => p.instanceId === pawl.instanceId), JSON.stringify(res.patches));
});

cases('Alt keeps the pose', () => {
  // The same pin as "Pawl dropped on a pin", where it would otherwise swing on
  const { instances, pin } = swingBuild([25.4, 12.7]);
  const pawl = pawlOnPin(pin, 0);
  const res = swing(instances, pawl, { mesh: false });
  check('with Alt held (no meshing turns) the pawl keeps the turn it had', !res.patches.some((p) => p.instanceId === pawl.instanceId), JSON.stringify(res.patches));
});

// --- Set pawl: what the Tools item, Join and double-click act on; the direction arrow ----------------------
cases('Set pawl target', () => {
  if (typeof rp.setPawlTarget !== 'function') throw new Error('setPawlTarget is not built yet');
  const partOf = (i) => findPart(i.partId);
  const { ratchet, instances } = between();
  const pawl = inst(PAWL, [20, -20, 0], [0, 0, 0], 'Pawl');
  const all = [...instances, pawl];
  const t = (ids, list = all) => rp.setPawlTarget({ selectedIds: ids, instances: list, partOf });
  check('Set pawl turned off: no pawl selected, the tip says to select a pawl', /select a pawl/i.test(t([]).reason || '') && /select a pawl/i.test(t([ratchet.instanceId]).reason || ''), JSON.stringify(t([])));
  check('a pawl and a ratchet selected: Set pawl acts on them', t([pawl.instanceId, ratchet.instanceId]).ratchetId === ratchet.instanceId);
  check('a pawl alone with one ratchet in reach: that ratchet', t([pawl.instanceId]).ratchetId === ratchet.instanceId);
  const far = { ...pawl, position: [200, 0, 0] };
  check('a pawl alone far from any ratchet: off, saying to move it near one or select the ratchet', /near a ratchet/.test(t([pawl.instanceId], [...instances, far]).reason || ''));
  const second = inst(R16, [30, 0, 0], [0, 0, 0], 'Second Ratchet');
  check('two ratchets in reach: off, asking which', /select the one/.test(t([pawl.instanceId], [...all, second]).reason || ''));
  check('a pawl with another part selected: off', Boolean(t([pawl.instanceId, instances[2].instanceId]).reason));
});

cases('Direction arrow', () => {
  if (typeof rp.ratchetArrows !== 'function') throw new Error('ratchetArrows is not built yet');
  const partOf = (i) => findPart(i.partId);
  const arrows = (id, list) => rp.ratchetArrows({ selectedId: id, instances: list, partOf, featuresOf: engine.worldFeaturesFor });
  const onRatchet = arrows(swishRatchet.instanceId, swishInstances);
  const onPawl = arrows(swishPawl.instanceId, swishInstances);
  const way = (a) => a.axis.clone().multiplyScalar(a.freeSign);
  check('selecting the Swish ratchet: an arrow round it, anticlockwise seen from +z', onRatchet.length === 1 && way(onRatchet[0]).z > 0.99, JSON.stringify(onRatchet));
  check('  selecting its pawl shows the same arrow', onPawl.length === 1 && onPawl[0].ratchetId === swishRatchet.instanceId && way(onPawl[0]).z > 0.99);
  const flipped = swishInstances.map(mirrorX);
  const onFlipped = arrows(swishRatchet.instanceId, flipped);
  check('  the build mirrored (the ratchet turned over): the arrow points the other way', onFlipped.length === 1 && way(onFlipped[0]).z < -0.99, JSON.stringify(onFlipped));
  const { ratchet, instances } = between();
  check('a ratchet with no pawl holding it shows no arrow', arrows(ratchet.instanceId, instances).length === 0);
  check('a part that is neither shows none', arrows(instances[2].instanceId, swishInstances).length === 0);
});

// --- Audit -------------------------------------------------------------------------------------------
cases('Audit', () => {
  if (rp.loadError) throw rp.loadError;
  // Swish's winch with its two belts strung as VEX drew them
  const belts = swish.bands.map((b, k) => {
    const band = { instanceId: `belt-${k}`, partId: b.partId, label: `Belt ${k + 1}`, position: [0, 0, 0], rotation: [0, 0, 0], visible: true };
    const strung = stringBand(band, b.spots, swishInstances, (i) => findPart(i.partId));
    if (strung.error) throw new Error(`Couldn't string ${b.label}: ${strung.error}`);
    return { ...band, position: strung.position, rotation: strung.rotation, shape: strung.shape };
  });
  const swishAudit = auditAssembly({ instances: [...swishInstances, ...belts], groups: [] });
  const pair = (swishAudit.ratchets || []).find((x) => x.ratchetId === swishRatchet.instanceId && x.pawlId === swishPawl.instanceId);
  check('Swish winch: the audit lists its pawl holding the 16 Tooth Ratchet, free anticlockwise seen from +z', pair?.holds === true && pair.wrongWay === false && pair.pivotCount === 1 && pair.freeDirection === 'anticlockwise seen from +z', JSON.stringify(swishAudit.ratchets));
  const overlap = swishAudit.collisions.some((c) => [swishRatchet.instanceId, swishPawl.instanceId].includes(c.instanceId) && c.collidingWith.some((l) => [swishRatchet.label, swishPawl.label].includes(l)));
  check('  with no overlap between them (no special allowance: VEX\'s pawl is a plain tight fit or clear)', !overlap, JSON.stringify(swishAudit.collisions.filter((c) => [swishRatchet.instanceId, swishPawl.instanceId].includes(c.instanceId))));
  check('Working ratchet: its belts press the pawl on, and the audit gives no warning for it', pair?.pressed === true && !auditIssues(swishAudit).some((i) => i.kind.startsWith('pawl-')), JSON.stringify(auditIssues(swishAudit).filter((i) => /pawl|ratchet/.test(i.kind))));
  const listed = auditIssues(swishAudit).find((i) => i.kind === 'ratchet');
  check('  and lists the pair with the way the ratchet turns, as a note', listed?.level === 'note' && /turns anticlockwise seen from \+z only/.test(listed.title), JSON.stringify(listed));
  const noBelts = auditAssembly({ instances: swishInstances, groups: [] });
  check('without its belts: a note that only its weight presses the pawl on', auditIssues(noBelts).some((i) => i.kind === 'pawl-unpressed' && i.level === 'note'));

  // Pawl on two pins: a pawl set on a plate spot, then a 1x2 Beam under it pinned through two holes
  const { ratchet, instances } = between();
  const pawl = loosePawl();
  const set = engine.setPawl({ instances: [...instances, pawl] }, { pawlId: pawl.instanceId, ratchetId: ratchet.instanceId });
  const at = set.state.instances.find((i) => i.instanceId === pawl.instanceId);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...at.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
  const z = -3.175 - 3.05;
  const beamPos = vec(at.position).add(new THREE.Vector3(6.35, 0, 0).applyQuaternion(q)).setZ(z);
  const beam = inst(BEAM12, beamPos.toArray(), at.rotation, 'Pawl Beam');
  const pinAt = (holeId, label) => inst(PIN12, holeOf(at, holeId).setZ(-3.175).toArray(), [180, 0, 0], label);
  const one = auditAssembly({ instances: [ratchet, instances[1], beam, at, pinAt('hole.thru.2_0_0', 'Pin A')] });
  const onePair = one.ratchets.find((x) => x.pawlId === pawl.instanceId);
  check('a pawl on one pin through a beam holds the ratchet (one pivot, not locked)', onePair?.holds && onePair.pivotCount === 1 && !onePair.locked, JSON.stringify(one.ratchets));
  const two = auditAssembly({ instances: [ratchet, instances[1], beam, at, pinAt('hole.thru.2_0_0', 'Pin A'), pinAt('hole.thru.4_0_0', 'Pin B')] });
  const twoPair = two.ratchets.find((x) => x.pawlId === pawl.instanceId);
  const warn = auditIssues(two).find((i) => i.kind === 'pawl-locked');
  check('Pawl on two pins: the audit warns that the pawl can\'t lift and the ratchet is locked', twoPair?.locked === true && twoPair.pivotCount === 2 && warn?.level === 'problem' && /can't lift/.test(warn.title) && /locked/.test(warn.title), JSON.stringify({ twoPair, warn }));
  check('  and the build is not counted sound', two.isMechanicallySound === false);
  const none = auditAssembly({ instances: [ratchet, instances[1], at] });
  check('a pawl held by no pin is warned about', auditIssues(none).some((i) => i.kind === 'pawl-no-pin' && i.level === 'problem'));
});

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll ratchet and pawl checks passed.');
process.exit(failures ? 1 : 0);
