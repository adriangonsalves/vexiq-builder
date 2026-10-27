/**
 * Node check for src/utils/gearMeshing.js and src/utils/shaftGroups.js against real catalog data,
 * using the MCP engine's collision meshes to confirm that meshed teeth don't overlap.
 * Run: node scripts/check-gear-meshing.mjs   (exits 1 on any failure)
 */
import * as THREE from 'three';
import { buildWorldMatrix, checkCandidateCollision, findPart, getPartCollisionBvh, getPartRawGeometry, worldFeaturesFor } from '../mcp/assembly-engine.mjs';
import { hubMatrix } from '../src/utils/motorHub.js';
import { settlePlacement } from '../src/utils/placementFit.js';
import { boreTargets, collectWorldFeatures, findHoleSnap, isBorePart, listBoreFits, listInsertFits, openFaces } from '../src/utils/pinHoleAlignment.js';
import { meshTurn, quaternionToEulerDeg, turnQuaternion, worldToothed } from '../src/utils/gearMeshing.js';
import { groupOf, hubAngleFor, shaftGroups, squareFitRoll, turnGroup } from '../src/utils/shaftGroups.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const part = (name) => {
  const p = findPart(name);
  if (!p || p.name !== name) throw new Error(`Catalog part not found: ${name}`);
  return p;
};

let nextId = 1;
const inst = (p, position, rotation = [0, 0, 0]) => ({
  instanceId: `i${nextId++}`,
  partId: p.id,
  label: `${p.name} #${nextId}`,
  position,
  rotation,
  visible: true
});
const toothed = (i) => worldToothed(part(findPart(i.partId).name), i.position, i.rotation, i.instanceId);
const collides = (a, others) => checkCandidateCollision(a, others).isIntersecting;
// The instance turned by the mesh result about its own axis
const turned = (i, result) => ({
  ...i,
  rotation: quaternionToEulerDeg(turnQuaternion(i.rotation, result.axis, result.turnDeg))
});

const G12 = part('12 Tooth Gear');
const G24 = part('24 Tooth Gear');
const G36 = part('36 Tooth Gear');
const G48 = part('48 Tooth Gear');
const G60 = part('60 Tooth Gear');
const RACK = part('1x6 Linear Motion Rack Gear');

// --- Measured data -------------------------------------------------------------------------------
for (const g of [G12, G24, G36, G48, G60]) {
  const nominal = (g.gearSpecs.teeth / 24) * 12.7;
  const rawModule = (2 * g.gearSpecs.tipRadiusMm) / (g.gearSpecs.teeth + 2);
  check(
    `${g.name}: measured, pitch radius ${g.gearSpecs.pitchRadiusMm} = ${nominal.toFixed(3)}, tip within 2% of 24 DP`,
    g.gearSpecs.measured && Math.abs(g.gearSpecs.pitchRadiusMm - nominal) < 0.01 && Math.abs(rawModule / (25.4 / 24) - 1) < 0.02,
    JSON.stringify(g.gearSpecs)
  );
}
check('24 and 48 tooth gears have the same tooth spacing', G24.gearSpecs.toothSpacingMm === G48.gearSpecs.toothSpacingMm);
for (const name of ['15 Tooth Gear (34DP)', '36 Tooth Gear (34DP)']) {
  const g = part(name).gearSpecs;
  check(`${name}: sized from its model, not as a standard gear`, g.measured && Math.abs(g.pitchRadiusMm - (g.teeth / 24) * 12.7) > 1, JSON.stringify(g));
}
check('the 34DP pair meshes 1.5 pitch apart', Math.abs(part('15 Tooth Gear (34DP)').gearSpecs.pitchRadiusMm + part('36 Tooth Gear (34DP)').gearSpecs.pitchRadiusMm - 19.05) < 0.01);
check('ratchets are not meshing gears', part('16 Tooth Ratchet').gearSpecs.measured === false);
check('the linear motion rack is measured', RACK.rackSpecs?.measured === true, JSON.stringify(RACK.rackSpecs));

// --- Gear on gear ---------------------------------------------------------------------------------
{
  const a = inst(G48, [0, 0, 0]);
  const b = inst(G24, [38.1, 0, 0], [0, 0, 0]);
  const result = meshTurn(toothed(b), [toothed(a)]);
  check('24T next to a 48T at 38.1 mm is in mesh range', Boolean(result) && result.meshed.length === 1, JSON.stringify(result));
  const meshed = turned(b, result);
  check(`24T turned ${result?.turnDeg}° to mesh with the 48T has no contact`, !collides(meshed, [a]));
  const again = meshTurn(toothed(meshed), [toothed(a)]);
  check('a meshed gear needs no further turn', Math.abs(again.turnDeg) < 0.01, again.turnDeg);
  // Half a tooth off the meshing turn puts tooth on tooth
  const clash = turned(b, { axis: result.axis, turnDeg: result.turnDeg + 7.5 });
  check('unturned at a non-meshing phase (half a tooth off), it does have contact', collides(clash, [a]));
  // Any rotation of the 48T: the turn still meshes
  for (const rz of [3, 11.2, 47]) {
    const a2 = inst(G48, [0, 0, 0], [0, 0, rz]);
    const b2 = inst(G24, [26.94, 26.94, 0], [0, 0, 20]);
    const r2 = meshTurn(toothed(b2), [toothed(a2)]);
    check(`48T turned ${rz}°, 24T on the diagonal: meshes without contact`, r2 && !collides(turned(b2, r2), [a2]), JSON.stringify(r2?.turnDeg));
  }
  // Upside-down gear (axis flipped) and a tilted pair (axes along X)
  const flipped = inst(G24, [38.1, 0, 0], [180, 0, 13]);
  const rf = meshTurn(toothed(flipped), [toothed(a)]);
  check('a flipped 24T meshes without contact', rf && !collides(turned(flipped, rf), [a]), JSON.stringify(rf?.turnDeg));
  const ax = inst(G36, [0, 0, 0], [0, 90, 0]);
  const bx = inst(G12, [0, 17.96, 17.96], [0, 90, 31]);
  const rx = meshTurn(toothed(bx), [toothed(ax)]);
  check('12T on a 36T, both along X, 25.4 mm apart diagonally: meshes without contact', rx && !collides(turned(bx, rx), [ax]), JSON.stringify(rx?.turnDeg));
  // 60T and 12T: gears of very different sizes
  const big = inst(G60, [0, 0, 0], [0, 0, 7]);
  const small = inst(G12, [0, -38.1, 0]);
  const rs = meshTurn(toothed(small), [toothed(big)]);
  check('12T under a 60T meshes without contact', rs && !collides(turned(small, rs), [big]), JSON.stringify(rs?.turnDeg));
}

// --- Out of range ---------------------------------------------------------------------------------
{
  const a = inst(G48, [0, 0, 0]);
  check('3 mm further than the pitch radii: no turn', meshTurn(toothed(inst(G24, [41.1, 0, 0])), [toothed(a)]) === null);
  check('different gear planes (8 mm apart along the axis): no turn', meshTurn(toothed(inst(G24, [38.1, 0, 8])), [toothed(a)]) === null);
  check('axes 10° apart: no turn', meshTurn(toothed(inst(G24, [38.1, 0, 0], [10, 0, 0])), [toothed(a)]) === null);
  check('a high strength gear does not mesh with a standard one', meshTurn(toothed(inst(part('24 Tooth High Strength Hybrid Gear'), [44.45, 0, 0])), [toothed(a)]) === null);
}

// --- Gear on a rack -------------------------------------------------------------------------------
{
  const rack = inst(RACK, [0, 0, 0]);
  const pitchY = RACK.rackSpecs.pitchLineOffset + G12.gearSpecs.pitchRadiusMm;
  for (const x of [0, 4.1, -13.3]) {
    const g = inst(G12, [x, pitchY, 0], [0, 0, 9]);
    const r = meshTurn(toothed(g), [toothed(rack)]);
    check(`12T on the rack at x ${x}: meshes without contact`, r && r.meshed.length === 1 && !collides(turned(g, r), [rack]), JSON.stringify(r?.turnDeg));
    if (x === 0) {
      const clash = turned(g, { axis: r.axis, turnDeg: r.turnDeg + 15 });
      check('12T on the rack half a tooth off has contact', collides(clash, [rack]));
    }
  }
  // Rack turned upside down and moved: teeth face -Y
  const rack2 = inst(RACK, [10, 50, 0], [180, 0, 0]);
  const g2 = inst(G24, [17.3, 50 - RACK.rackSpecs.pitchLineOffset - G24.gearSpecs.pitchRadiusMm, 0], [0, 0, 2]);
  const r2 = meshTurn(toothed(g2), [toothed(rack2)]);
  check('24T under a flipped rack meshes without contact', r2 && !collides(turned(g2, r2), [rack2]), JSON.stringify(r2?.turnDeg));
}

// --- Several neighbours ---------------------------------------------------------------------------
{
  const b = inst(G24, [0, 0, 0]);
  const a1 = inst(G24, [25.4, 0, 0]);
  const a1Mesh = meshTurn(toothed(a1), [toothed(b)]);
  const a1m = turned(a1, a1Mesh);
  // A second neighbour turned a third of a tooth (5°) off any phase that suits both
  const a2Base = inst(G24, [-25.9, 0, 0]);
  const a2Mesh = meshTurn(toothed(a2Base), [toothed(b)]);
  const a2off = turned(a2Base, { axis: a2Mesh.axis, turnDeg: a2Mesh.turnDeg + 5 });
  const probe = inst(G24, [0, 0, 0], [0, 0, 4]);
  const r = meshTurn(toothed(probe), [toothed(a1m), toothed(a2off)]);
  check(
    'two neighbours that can\'t both mesh: meshes with the closer one, reports the other',
    r && r.meshed.length === 1 && r.meshed[0].other.instanceId === a1m.instanceId && r.conflicts.length === 1 && r.conflicts[0].other.instanceId === a2off.instanceId,
    JSON.stringify({ meshed: r?.meshed.map((m) => [m.other.instanceId, m.errorTeeth]), conflicts: r?.conflicts.map((m) => [m.other.instanceId, m.errorTeeth]) })
  );
  check('  and the closer one has no contact', !collides(turned(probe, r), [a1m]));
  // Two neighbours that can both mesh (a 24T between two meshed 24Ts in a row)
  const c2 = inst(G24, [-25.4, 0, 0]);
  const c2m = turned(c2, meshTurn(toothed(c2), [toothed(b)]));
  const r2 = meshTurn(toothed(probe), [toothed(a1m), toothed(c2m)]);
  check('two neighbours that agree: both meshed, no conflict', r2 && r2.meshed.length === 2 && r2.conflicts.length === 0, JSON.stringify(r2?.conflicts.map((c) => c.errorTeeth)));
}

// --- Square fits and shaft groups (src/utils/shaftGroups.js) --------------------------------------
// The collision meshes are shrunk 0.38 mm, too much to see a square axle turned in a square hole,
// so fits are measured on the real meshes: at the hole's middle, the wall in each of the axle's
// corner directions must be at least as far out as the axle's corner (0.05 mm slack).
const localRay = (instance, origin, dir) => {
  const m = buildWorldMatrix(instance.position, instance.rotation).invert();
  return new THREE.Ray(origin.clone().applyMatrix4(m), dir.clone().transformDirection(m));
};
const rawDistance = (instance, origin, dir) => {
  const geo = getPartRawGeometry(findPart(instance.partId));
  return geo.boundsTree.raycastFirst(localRay(instance, origin, dir), THREE.DoubleSide)?.distance ?? null;
};
function squareClearance(shaftInst, holeInst, center, axis) {
  const shaft = worldFeaturesFor(shaftInst).find((f) => f.kind === 'shaft');
  let worst = Infinity;
  for (let k = 0; k < 4; k++) {
    const corner = shaft.flatDir.clone().applyAxisAngle(axis, THREE.MathUtils.degToRad(45 + 90 * k));
    const wall = rawDistance(holeInst, center, corner);
    const start = center.clone().addScaledVector(corner, 6);
    const shaftR = 6 - rawDistance(shaftInst, start, corner.clone().negate());
    worst = Math.min(worst, (wall ?? Infinity) - shaftR);
  }
  return worst;
}
const featureOf = (i, kind) => worldFeaturesFor(i).find((f) => f.kind === kind);
const turnAbout = (i, axis, deg) => ({ ...i, rotation: quaternionToEulerDeg(turnQuaternion(i.rotation, axis, deg)) });
const SHAFT = part('4x Pitch Shaft');
{
  check('4x Pitch Shaft and the 24 Tooth Gear bore are square', Boolean(featureOf(inst(SHAFT, [0, 0, 0]), 'shaft').flatDir && featureOf(inst(G24, [0, 0, 0]), 'shaft_bore').flatDir));
  const gear = inst(G24, [0, 0, 0], [0, 0, 22.5]);
  const shaft = inst(SHAFT, [0, 0, 0]);
  const z = new THREE.Vector3(0, 0, 1);
  const before = squareClearance(shaft, gear, new THREE.Vector3(), z);
  const roll = squareFitRoll(featureOf(shaft, 'shaft'), featureOf(gear, 'shaft_bore'));
  const fitted = turnAbout(shaft, z, roll);
  const after = squareClearance(fitted, gear, new THREE.Vector3(), z);
  check(`axle into a gear turned 22.5°: rolls ${roll}° and fits (clearance ${after.toFixed(2)} mm, was ${before.toFixed(2)})`, Math.abs(Math.abs(roll) - 22.5) < 0.2 && after > -0.05 && before < -0.3);

  const hubPart = part('Small Wheel Hub (44 mm)');
  const turnedShaft = inst(SHAFT, [0, 0, 0], [0, 0, 10]);
  const wheel = inst(hubPart, [0, 0, 0]);
  const bore = worldFeaturesFor(wheel).find((f) => f.kind === 'shaft_bore' && f.flatDir);
  const wheelRoll = squareFitRoll(bore, featureOf(turnedShaft, 'shaft'));
  const wheelFitted = turnAbout(wheel, bore.axis, wheelRoll);
  const boreCenter = bore.start.clone().add(bore.end).multiplyScalar(0.5);
  const wheelClear = squareClearance(turnedShaft, wheelFitted, boreCenter, z);
  check(`wheel hub onto an axle turned 10°: turns ${wheelRoll}° and fits (clearance ${wheelClear.toFixed(2)} mm)`, Math.abs(Math.abs(wheelRoll) - 10) < 0.2 && wheelClear > -0.05);
}
{
  // An axle along X with a wheel hub, a 24T gear, a tire (round bore) and a beam (pin hole) on it
  const axle = inst(SHAFT, [0, 20, 30], [0, 90, 0]);
  const gear = inst(G24, [6, 20, 30], [0, 90, 0]);
  const wheel = inst(part('Small Wheel Hub (44 mm)'), [-12, 20, 30], [0, 90, 0]);
  const tire = inst(part('Tire (100 mm Travel)'), [16, 20, 30], [0, 90, 0]);
  const beamPart = part('1x2 Beam');
  const beam = inst(beamPart, [-6.35 - 0, 20, 30], [0, 90, 0]);
  const other = inst(SHAFT, [0, 45.4, 30], [0, 90, 0]);
  const all = [axle, gear, wheel, tire, beam, other];
  const groups = shaftGroups(all.map((i) => ({ instanceId: i.instanceId, features: worldFeaturesFor(i), hasHub: Boolean(findPart(i.partId).hubSpecs) })));
  const g = groupOf(groups, axle.instanceId);
  const ids = new Set(g?.members.map((m) => m.instanceId));
  check('shaft group: the axle, the gear and the wheel hub', g && ids.has(axle.instanceId) && ids.has(gear.instanceId) && ids.has(wheel.instanceId), JSON.stringify([...ids]));
  check('round bores (tire) and pin holes (beam) are left out, and the other axle is its own group', g && !ids.has(tire.instanceId) && !ids.has(beam.instanceId) && !ids.has(other.instanceId) && groupOf(groups, other.instanceId) !== g);
  const poses = new Map(all.map((i) => [i.instanceId, i]));
  // An off-axis pose (a part whose origin is off the axle's line) turns about the line too
  poses.set('fake', { position: [5, 25, 30], rotation: [0, 0, 0] });
  const patches = turnGroup({ ...g, members: [...g.members, { instanceId: 'fake' }] }, 90, (id) => poses.get(id));
  const fake = patches.find((p) => p.instanceId === 'fake');
  const axleP = patches.find((p) => p.instanceId === axle.instanceId);
  check('a group turn moves positions about the axle line', fake && Math.abs(fake.position[1] - 20) < 1e-6 && Math.abs(Math.abs(fake.position[2] - 30) - 5) < 1e-6, JSON.stringify(fake));
  check('every member turns the same angle', patches.length === g.members.length + 1 && axleP && JSON.stringify(axleP.position) === JSON.stringify(axle.position));
  const fitsAfter = squareClearance(
    { ...axle, ...axleP },
    { ...gear, ...patches.find((p) => p.instanceId === gear.instanceId) },
    new THREE.Vector3(6, 20, 30),
    new THREE.Vector3(1, 0, 0)
  );
  check(`after a group turn the axle still fits the gear (clearance ${fitsAfter.toFixed(2)} mm)`, fitsAfter > -0.05);
}
{
  // A square axle in the Smart Motor's drive socket (local +Y, at x -9.525)
  const MOTOR = part('VEX IQ Smart Motor');
  check('the Smart Motor has a hub wider than the socket\'s square', MOTOR.hubSpecs?.radiusMm > 2.3, JSON.stringify(MOTOR.hubSpecs));
  const motor = { ...inst(MOTOR, [0, 0, 0]), socketAngleDeg: 0 };
  const socket = featureOf(motor, 'shaft_socket');
  const fitAngle = hubAngleFor(socket, featureOf(inst(SHAFT, [-9.525, 21.4, 0], [-90, 0, 0]), 'shaft'), 0);
  // An axle turned 30° from the angle that fits the hub at 0°
  const axle = inst(SHAFT, [-9.525, 21.4, 0], [-90, 0, 0]);
  const axle30 = turnAbout(axle, socket.axis, 30 - fitAngle);
  const hubAngle = hubAngleFor(socket, featureOf(axle30, 'shaft'), 0);
  check(`axle turned 30° in the motor: the hub turns to ${hubAngle}°`, Math.abs(hubAngle - 30) < 0.05);
  const groups = shaftGroups([motor, axle30].map((i) => ({ instanceId: i.instanceId, features: worldFeaturesFor(i), hasHub: Boolean(findPart(i.partId).hubSpecs) })));
  const g = groupOf(groups, axle30.instanceId);
  const hubMember = g?.members.find((m) => m.instanceId === motor.instanceId);
  check('the motor is in the axle\'s group as its hub', hubMember?.hub === true);
  const poses = new Map([[motor.instanceId, motor], [axle30.instanceId, axle30]]);
  const patches = turnGroup(g, 15, (id) => poses.get(id), () => socket.axis);
  const motorPatch = patches.find((p) => p.instanceId === motor.instanceId);
  check('a group turn only changes the motor\'s socketAngleDeg', motorPatch && Object.keys(motorPatch).sort().join() === 'instanceId,socketAngleDeg' && Math.abs(Math.abs(motorPatch.socketAngleDeg) - 15) < 1e-6, JSON.stringify(motorPatch));

  // The engine's collision pieces: the hub is split off, carries the socket walls, and turns with
  // socketAngleDeg. Fit is measured against the posed hub piece (eroded 0.38 mm, so a fit has at least
  // that much room and a turned-wrong axle's corner still hits the wall).
  const { pieces, hubFrame: frame } = getPartCollisionBvh(MOTOR);
  const hubPiece = pieces.find((p) => p.hub);
  check('the motor\'s collision mesh has a body piece and a hub piece', pieces.length === 2 && Boolean(hubPiece));
  // (pieces share the whole mesh's vertices, so the box is taken over the hub's own triangles)
  const hubBox = new THREE.Box3();
  const posAttr = hubPiece.geo.getAttribute('position');
  for (const vi of hubPiece.geo.index.array) hubBox.expandByPoint(new THREE.Vector3().fromBufferAttribute(posAttr, vi));
  check('the hub piece stays inside the hub cylinder', hubBox.max.x - hubBox.min.x <= 2 * MOTOR.hubSpecs.radiusMm + 1.2 && hubBox.max.z - hubBox.min.z <= 2 * MOTOR.hubSpecs.radiusMm + 1.2, JSON.stringify(hubBox));
  const socketCenter = new THREE.Vector3(-9.525, -2.5, 0);
  const hubClearance = (axleInst, hubDeg) => {
    const shaftF = featureOf(axleInst, 'shaft');
    const inv = hubMatrix(frame, hubDeg).invert();
    let worst = Infinity;
    for (let k = 0; k < 4; k++) {
      const corner = shaftF.flatDir.clone().applyAxisAngle(socket.axis, THREE.MathUtils.degToRad(45 + 90 * k));
      const ray = new THREE.Ray(socketCenter.clone().applyMatrix4(inv), corner.clone().transformDirection(inv));
      const wall = hubPiece.geo.boundsTree.raycastFirst(ray, THREE.DoubleSide)?.distance ?? Infinity;
      const start = socketCenter.clone().addScaledVector(corner, 6);
      const shaftR = 6 - rawDistance(axleInst, start, corner.clone().negate());
      worst = Math.min(worst, wall - shaftR);
    }
    return worst;
  };
  const at30 = hubClearance(axle30, 30);
  const at0 = hubClearance(axle30, 0);
  check(`an axle at 30° fits a hub at 30° (room ${at30.toFixed(2)} mm) but not a hub at 0° (${at0.toFixed(2)} mm)`, at30 > 0.3 && at0 < 0);
  // Engine collision with the hub piece posed: a probe that only reaches the turned hub
  const probeAt = (deg) => checkCandidateCollision(axle30, [{ ...motor, socketAngleDeg: deg }]).isIntersecting;
  check('engine collision runs with a turned hub (the axle in the socket is clear at hub angles 0, 30, 45)', [0, 30, 45].every((d) => !probeAt(d)));
  // A beam lying across the hub's face clashes with the hub whatever its angle, and is clear once lifted
  const plate = inst(part('1x2 Beam'), [-9.525, 0.5, 0], [90, 0, 0]);
  const plateHits = [0, 30].map((d) => checkCandidateCollision(plate, [{ ...motor, socketAngleDeg: d }]).isIntersecting);
  const lifted = checkCandidateCollision({ ...plate, position: [-9.525, 4.5, 0] }, [{ ...motor, socketAngleDeg: 30 }]).isIntersecting;
  check('a beam pushed into the turned hub collides; lifted clear, it does not', plateHits.every(Boolean) && !lifted, JSON.stringify({ plateHits, lifted }));
}

// --- The placement step (src/utils/placementFit.js) ------------------------------------------------
{
  const settle = (placedId, instances, receivingId = null) =>
    settlePlacement({ placedId, instances, partOf: (i) => findPart(i.partId), featuresOf: worldFeaturesFor, receivingId });
  const apply = (instances, patches) =>
    instances.map((i) => {
      const p = patches.find((q) => q.instanceId === i.instanceId);
      return p ? { ...i, ...p } : i;
    });
  const z = new THREE.Vector3(0, 0, 1);

  // An axle mated into a gear turned 22.5°
  const gear = { ...inst(G24, [0, 0, 0], [0, 0, 22.5]), label: '24 Tooth Gear #1' };
  const axle = { ...inst(SHAFT, [0, 0, 10]), label: '4x Pitch Shaft #1' };
  const r1 = settle(axle.instanceId, [gear, axle], gear.instanceId);
  const axleAfter = apply([gear, axle], r1.patches).find((i) => i.instanceId === axle.instanceId);
  check(
    `placing an axle in a turned gear turns only the axle (${r1.squareFit?.deg}°), and it fits`,
    r1.patches.length === 1 && r1.patches[0].instanceId === axle.instanceId && squareClearance(axleAfter, gear, new THREE.Vector3(), z) > -0.05,
    JSON.stringify(r1)
  );

  // A 24T gear placed on an axle that carries a wheel hub, next to a 48T gear on another axle
  const axleA = { ...inst(SHAFT, [0, 0, 0], [0, 0, 7]), label: 'Axle A' };
  const wheel = { ...inst(part('Small Wheel Hub (44 mm)'), [0, 0, -16], [0, 0, 7]), label: 'Wheel' };
  const axleB = { ...inst(SHAFT, [38.1, 0, 0], [0, 0, 3]), label: 'Axle B' };
  const big = { ...inst(G48, [38.1, 0, 0], [0, 0, 3]), label: '48 Tooth Gear #1' };
  const small = { ...inst(G24, [0, 0, 0], [0, 0, 40]), label: '24 Tooth Gear #2' };
  const scene = [axleA, wheel, axleB, big, small];
  const r2 = settle(small.instanceId, scene);
  const after = apply(scene, r2.patches);
  const byId = (list, i) => list.find((x) => x.instanceId === i.instanceId);
  const turnedIds = new Set(r2.patches.map((p) => p.instanceId));
  check(
    'gear on a loaded axle: the gear, its axle and the wheel turn; the 48T and its axle stay put',
    turnedIds.has(small.instanceId) && turnedIds.has(axleA.instanceId) && turnedIds.has(wheel.instanceId) && !turnedIds.has(big.instanceId) && !turnedIds.has(axleB.instanceId),
    JSON.stringify(r2.patches.map((p) => p.instanceId))
  );
  check('  the gears mesh without contact', !collides(byId(after, small), [byId(after, big)]));
  check('  the axle still fits the gear and the wheel', squareClearance(byId(after, axleA), byId(after, small), new THREE.Vector3(), z) > -0.05);
  check('  the message names the mesh and the turn', /^Meshed 24 Tooth Gear #2 with 48 Tooth Gear #1 \(turned -?[\d.]+°\)/.test(r2.messages[0] || ''), r2.messages.join(' | '));
  const again = settle(small.instanceId, after);
  check('  placing it again changes nothing', again.patches.length === 0, JSON.stringify(again.patches));

  // An axle turned 30° (from the angle that fits the hub at 0°) placed into a Smart Motor
  const MOTOR = part('VEX IQ Smart Motor');
  const motor = { ...inst(MOTOR, [0, 0, 0]), label: 'Motor' };
  const socket = featureOf(motor, 'shaft_socket');
  const straight = inst(SHAFT, [-9.525, 21.4, 0], [-90, 0, 0]);
  const fit0 = hubAngleFor(socket, featureOf(straight, 'shaft'), 0);
  const axle30 = { ...turnAbout(straight, socket.axis, 30 - fit0), label: 'Motor Axle' };
  const r3 = settle(axle30.instanceId, [motor, axle30], motor.instanceId);
  const motorPatch = r3.patches.find((p) => p.instanceId === motor.instanceId);
  check(
    'axle at 30° into the motor: the axle keeps its angle and the hub turns to 30°',
    !r3.patches.some((p) => p.instanceId === axle30.instanceId) && Math.abs((motorPatch?.socketAngleDeg ?? 0) - 30) < 0.05,
    JSON.stringify(r3)
  );
}

// --- Hole picking previews (listInsertFits, modified Lined-up preview) -----------------------------
{
  const gear = inst(G24, [0, 0, 0], [0, 0, 22.5]);
  const bore = featureOf(gear, 'shaft_bore');
  const face = openFaces(bore).find((f) => f.outward.z > 0);
  const fits = listInsertFits({
    partMeta: SHAFT,
    instanceId: 'picked',
    hovered: { opening: bore, face },
    receivingQuaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(22.5)),
    otherFeatures: worldFeaturesFor(gear),
    currentQuaternion: new THREE.Quaternion()
  });
  const flatsOff = fits.map((f) => {
    const shaftF = collectWorldFeatures(SHAFT, f.matrix ?? new THREE.Matrix4().compose(f.position, f.quaternion, new THREE.Vector3(1, 1, 1)), 'picked').find((w) => w.kind === 'shaft');
    return Math.abs(squareFitRoll(shaftF, bore));
  });
  check(
    `picking an axle into a gear turned 22.5°: ${fits.length} fits, every one with its flats on the bore's`,
    fits.length >= 4 && flatsOff.every((d) => d < 0.05),
    JSON.stringify(flatsOff)
  );

  // No catalog gear has a pin or axle of its own (so none can be hole-picked today); a made-up 24T
  // gear with an axle on its own axis shows the preview meshing: picked into a beam hole 38.1 mm
  // from a 48T gear, every fit's pose meshes once pushed in
  const gearWithAxle = {
    ...G24,
    id: 'check-gear-with-axle',
    fastenerSpecs: { fastenerType: 'straight_shaft', axis: [0, 0, 1], usableSpanZ: [-10, 10], shape: 'square', squarePhaseDeg: 0 }
  };
  const big = inst(G48, [0, 0, 0]);
  const beam = inst(part('1x2 Beam'), [38.1, 0, -3.6], [0, 0, 90]);
  const hole = worldFeaturesFor(beam).find((f) => f.featureId === 'hole_2');
  const top = openFaces(hole).find((f) => f.outward.z > 0);
  const gearFits = listInsertFits({
    partMeta: gearWithAxle,
    instanceId: 'picked-gear',
    hovered: { opening: hole, face: top },
    receivingQuaternion: new THREE.Quaternion(),
    otherFeatures: [...worldFeaturesFor(beam), ...worldFeaturesFor(big)],
    currentQuaternion: new THREE.Quaternion(),
    meshNeighbours: [toothed(big)]
  });
  const offMesh = gearFits.map((f) => {
    const seated = f.position.clone().addScaledVector(f.direction, f.travelMm);
    const t = meshTurn(worldToothed(gearWithAxle, seated, f.quaternion), [toothed(big)]);
    return t ? Math.abs(t.turnDeg) : null;
  });
  check(
    `picking a gear in mesh range previews it meshed (${gearFits.length} fits)`,
    gearFits.length > 0 && offMesh.every((d) => d !== null && d < 0.05),
    JSON.stringify(offMesh)
  );
}

// --- Drag pull reach (drag-hole-snap: 12 pitch along the line) ---------------------------------------
{
  // The user's scene: a 12 Tooth Gear 33 mm above a 2x18 Beam, its bore 0.27 mm off hole_8's line
  const beam = inst(part('2x18 Beam'), [34.652, 12.7, -3.784]);
  const gear = inst(G12, [28.575, 6.35, 34.925]);
  const snap = findHoleSnap(worldFeaturesFor(gear), worldFeaturesFor(beam), [new THREE.Vector3(0, 1, 0)]);
  const landed = snap && new THREE.Vector3(...gear.position).add(snap.offset);
  check(
    'a 12 Tooth Gear dragged 33 mm above a beam hole, 0.27 mm off its line, is pulled onto it',
    snap && Math.abs(landed.x - 28.302) < 0.01 && Math.abs(landed.y - 6.35) < 0.01,
    JSON.stringify(snap?.offset)
  );
  // Two holes in reach with about the same pull: the one nearer along the line wins
  const near = inst(part('1x2 Beam'), [0, 0, 10]);
  const far = inst(part('1x2 Beam'), [0.1, 0, -60]);
  const shaft = inst(SHAFT, [0.05, 0, 50]);
  const tie = findHoleSnap(worldFeaturesFor(shaft), [...worldFeaturesFor(near), ...worldFeaturesFor(far)], [new THREE.Vector3(1, 0, 0)]);
  check('pulls within 0.25 mm of each other go to the hole nearer along the line', tie?.opening.instanceId === near.instanceId, JSON.stringify(tie?.opening.instanceId));
}

// --- Hole picking for bore parts (listBoreFits) ------------------------------------------------------
{
  check('a gear, a wheel hub and the Smart Motor are bore parts; a beam and an axle are not',
    isBorePart(G24) && isBorePart(part('Small Wheel Hub (44 mm)')) && isBorePart(part('VEX IQ Smart Motor')) && !isBorePart(part('1x6 Beam')) && !isBorePart(SHAFT));
  // An upright axle turned 10°, through a beam; a 48T gear on another axle 38.1 mm away
  const axle = inst(SHAFT, [0, 0, 20], [0, 0, 10]);
  const big = inst(G48, [38.1, 0, 0]);
  const targets = boreTargets([...worldFeaturesFor(axle), ...worldFeaturesFor(big)]);
  const top = targets.find((t) => t.onShaft && t.opening.instanceId === axle.instanceId && t.face.outward.z > 0);
  check('an axle offers both its ends as targets', targets.filter((t) => t.onShaft && t.opening.instanceId === axle.instanceId).length === 2);
  const shaftF = featureOf(axle, 'shaft');
  const fitsFor = (meshNeighbours) =>
    listBoreFits({ partMeta: G24, instanceId: 'picked-gear', hovered: top, receivingQuaternion: new THREE.Quaternion(), currentQuaternion: new THREE.Quaternion(), meshNeighbours }).map((f) => {
      const bore = collectWorldFeatures(G24, new THREE.Matrix4().compose(f.position, f.quaternion, new THREE.Vector3(1, 1, 1)), 'picked-gear').find((w) => w.kind === 'shaft_bore');
      const seated = f.position.clone().setZ(0); // slid down to the 48T's plane
      const mesh = meshTurn(worldToothed(G24, seated, f.quaternion), [toothed(big)]);
      const d = bore.origin.clone().sub(shaftF.origin);
      return {
        onLine: d.lengthSq() - d.dot(shaftF.axis) ** 2 < 0.01,
        fit: Math.abs(squareFitRoll(bore, shaftF)),
        mesh: mesh ? Math.abs(mesh.turnDeg) : null,
        above: f.position.z > shaftF.end.z
      };
    });
  const plain = fitsFor(null);
  check(
    `a 24 Tooth Gear picked onto an axle end: ${plain.length} fits, bore on the axle's line, above its end, turned to fit its flats`,
    plain.length >= 4 && plain.every((r) => r.onLine && r.above && r.fit < 0.05),
    JSON.stringify(plain)
  );
  // With a 48T gear beside the axle, the preview shows the gear at its meshing turn (placing it
  // then turns the whole axle group to that angle, so it fits the axle again)
  const meshed = fitsFor([toothed(big)]);
  check('  and, since the axle runs past a 48T gear, shown meshed with it', meshed.every((r) => r.onLine && r.mesh !== null && r.mesh < 0.05), JSON.stringify(meshed.map((r) => r.mesh)));
  // Onto a beam hole's face: the bore on the hole's line, the gear on the beam's side of the face
  const beam = inst(part('1x6 Beam'), [0, 60, 0]);
  const holeTarget = boreTargets(worldFeaturesFor(beam)).find((t) => !t.onShaft && t.face.outward.z > 0);
  const holeFits = listBoreFits({ partMeta: G24, instanceId: 'g', hovered: holeTarget, receivingQuaternion: new THREE.Quaternion(), currentQuaternion: new THREE.Quaternion() });
  check('a gear picked onto a beam hole face: bore on the hole line, just outside the face', holeFits.length > 0 && holeFits.every((f) => {
    const bore = collectWorldFeatures(G24, new THREE.Matrix4().compose(f.position, f.quaternion, new THREE.Vector3(1, 1, 1)), 'g').find((w) => w.kind === 'shaft_bore');
    const d = bore.origin.clone().sub(holeTarget.opening.origin);
    return d.lengthSq() - d.dot(holeTarget.opening.axis) ** 2 < 0.01 && Math.min(bore.start.z, bore.end.z) > holeTarget.face.point.z;
  }));
}

export { check, inst, part, toothed, turned, collides };
export const finish = () => {
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
};
if (process.argv[1]?.endsWith('check-gear-meshing.mjs')) finish();
