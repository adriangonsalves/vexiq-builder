/**
 * Node check for openspec precise-placement: a Smart Motor squared on its shaft, mesh-safe Fix
 * assembly, lining up after a pin goes in. The rig is the 90° gear test build: a worm on a 4x Pitch
 * Shaft driven by Smart Motor #2 (tilted 0.9° off the shaft), meshed with a 36 Tooth Gear whose shaft
 * carries a 2x9 Beam, a 1x1 corner connector and a capped pin 0.58 mm off the motor's hole.
 * Run: node scripts/check-precise-placement.mjs   (exits 1 on any failure)
 */
import * as THREE from 'three';
import { applyPosePatches, checkCandidateCollision, findPart, settlePlacedInstance, worldFeaturesFor } from '../mcp/assembly-engine.mjs';
import { motorShaftTilt } from '../src/utils/placementFit.js';
import { findSeatedPairs } from '../src/utils/pinHoleAlignment.js';
import { runAction } from '../src/engine/actions.js';
import { lineUpAfterInsert } from '../src/engine/fixAssembly.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const inst = (instanceId, query, position, rotation, extra = {}) => ({
  instanceId,
  partId: findPart(query).id,
  label: extra.label || instanceId,
  position,
  rotation,
  visible: true,
  ...extra
});

export const rig = () => [
  inst('gear36', '36 Tooth Gear', [100, 40, 0], [0, 0, 0], { label: 'Gear 36' }),
  inst('gearShaft', '4x Pitch Shaft', [100, 40, 21.33], [0, 0, 0], { label: 'Gear shaft' }),
  inst('worm', 'Worm Gear', [111.559, 65.4, -0.005], [98.53, -90, 0], { label: 'Worm' }),
  inst('wormShaft', '4x Pitch Shaft', [121.999, 65.4, -0.005], [8.53, -90, 0], { label: 'Worm shaft' }),
  inst('motor', 'VEX IQ Smart Motor', [137.904, 55.875, -0.031], [-180, -0.9, 90], { label: 'Smart Motor #2', socketAngleDeg: -22.63 }),
  inst('beam', '2x9 Beam', [150.8, 33.65, 15.021], [0, 0, 0], { label: '2x9 Beam' }),
  inst('corner', '1x Wide, 1x1 Corner Connector', [131.75, 33.65, 12.118], [0, 0, 90], { label: 'Corner connector' }),
  inst('pin', '0x2 Connector Pin with Spherical Cap', [133.142, 33.65, 5.758], [-180, 89.1, 0], { label: 'Pin #4' })
];

const byId = (list, id) => list.find((i) => i.instanceId === id);
const socketOf = (motor) => worldFeaturesFor(motor).find((f) => f.kind === 'shaft_socket');
const shaftOf = (shaft) => worldFeaturesFor(shaft).find((f) => f.kind === 'shaft');
const tiltOf = (motor, shaft) => motorShaftTilt(socketOf(motor), worldFeaturesFor(shaft));
const quat = (rot) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
// Turn about the shaft's line between two motor poses (degrees)
const rollAbout = (a, b, axis) => {
  const d = quat(b.rotation).multiply(quat(a.rotation).invert());
  const v = new THREE.Vector3(d.x, d.y, d.z);
  return THREE.MathUtils.radToDeg(2 * Math.atan2(v.dot(axis), d.w));
};

// --- 1.1 / 7.5 A tilted Smart Motor: the shaft turns into it, the motor body stays ----------------
{
  const list = rig();
  const motor = byId(list, 'motor');
  const shaft = byId(list, 'wormShaft');
  const before = tiltOf(motor, shaft);
  check('rig motor is found on the worm shaft, about 0.9° off', before && Math.abs(before.angleDeg - 0.9) < 0.1, JSON.stringify(before && { a: before.angleDeg, o: before.offsetMm }));

  // The rig: the worm on that shaft meshes with the 36 Tooth Gear, so nothing moves
  const meshed = settlePlacedInstance(motor, list);
  check('worm shaft meshed: placing the motor moves neither the motor nor the shaft', !meshed.patches.some((p) => ['motor', 'wormShaft', 'worm'].includes(p.instanceId) && p.rotation), JSON.stringify(meshed.patches.map((p) => p.instanceId)));
  check('  and says turning the shaft would take the worm out of mesh', meshed.messages.some((m) => /turning the shaft would take Worm out of mesh with Gear 36/.test(m)), JSON.stringify(meshed.messages));

  // A free shaft carrying the worm (no 36 Tooth Gear): the shaft and worm turn into the motor
  const free = [shaft, byId(list, 'worm'), motor];
  const settled = settlePlacedInstance(motor, free);
  const after = applyPosePatches(free, settled.patches);
  const tilt = tiltOf(byId(after, 'motor'), byId(after, 'wormShaft'));
  check('free shaft: it turns square into the socket (within 0.05°)', tilt && tilt.angleDeg < 0.05, JSON.stringify(tilt && tilt.angleDeg));
  check('  onto the socket line (within 0.01 mm)', tilt && tilt.offsetMm < 0.01, JSON.stringify(tilt && tilt.offsetMm));
  check('  the motor body stays where it was', !settled.patches.some((p) => p.instanceId === 'motor' && (p.position || p.rotation)));
  check('  the worm on it turns with it', settled.patches.some((p) => p.instanceId === 'worm' && p.rotation) && settled.patches.some((p) => p.instanceId === 'wormShaft' && p.rotation));
  check('  a message says so', settled.messages.some((m) => /Turned Worm shaft 0\.9° to sit square in Smart Motor #2/.test(m)), JSON.stringify(settled.messages));
  const hub = settled.patches.find((p) => p.instanceId === 'motor' && 'socketAngleDeg' in p);
  check('  the hub angle is kept (within 0.5°)', !hub || Math.abs(hub.socketAngleDeg - motor.socketAngleDeg) < 0.5, JSON.stringify(hub));

  // The shaft also runs through a beam hole: left as it is, naming the beam
  const beam = { instanceId: 'holder', partId: findPart('2x9 Beam').id, label: 'Holding beam', position: [118, 59.05, -50.805], rotation: [0, 90, 0], visible: true };
  const held = [shaft, motor, beam];
  const inBeam = findSeatedPairs(worldFeaturesFor(shaft), worldFeaturesFor(beam)).length > 0;
  check('a shaft through a beam hole: it is seated in the beam', inBeam);
  const heldSettle = settlePlacedInstance(motor, held);
  check('  placing the motor leaves the shaft and motor as they are', !heldSettle.patches.some((p) => p.rotation), JSON.stringify(heldSettle.patches));
  check('  and names the beam', heldSettle.messages.some((m) => /also sits in Holding beam/.test(m)), JSON.stringify(heldSettle.messages));

  // 5° off: not in the socket as far as squaring goes
  const far = { ...motor, rotation: [-180, -5, 90] };
  check('a motor 5° off its shaft is left alone', !tiltOf(far, shaft) && !settlePlacedInstance(far, [shaft, far]).patches.some((p) => p.rotation));
}


// --- 2. Mesh-safe Fix assembly ------------------------------------------------------------------
const poseOf = (list, id) => byId(list, id) && { position: byId(list, id).position, rotation: byId(list, id).rotation };
const samePose = (a, b) => a.position.every((v, k) => Math.abs(v - b.position[k]) < 0.002) && a.rotation.every((v, k) => Math.abs(v - b.rotation[k]) < 0.01);
const pinInHole = (list) => {
  const hole = worldFeaturesFor(byId(list, 'motor')).find((f) => f.featureId === 'hole.+y.7_0_-2');
  const pin = worldFeaturesFor(byId(list, 'pin')).find((f) => f.kind === 'pin');
  const angle = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(hole.axis.dot(pin.axis)))));
  const p = pin.origin.clone().sub(hole.origin);
  const line = p.sub(hole.axis.clone().multiplyScalar(p.dot(hole.axis))).length();
  return { line, angle };
};
{
  const list = rig();
  const before = pinInHole(list);
  check('rig: the pin starts about 0.6 mm off the motor hole', before.line > 0.5 && before.line < 0.7, JSON.stringify(before));
  const r = runAction('fix_assembly', { instances: JSON.parse(JSON.stringify(list)) }, { instanceId: 'pin' });
  check('Fix assembly on the pin works', r.ok, r.error);
  if (r.ok) {
    const after = r.state.instances;
    const still = ['gearShaft', 'gear36', 'worm', 'wormShaft'];
    check('  the shafts, the 36 Tooth Gear and the worm stay where they are', still.every((id) => samePose(poseOf(after, id), poseOf(list, id))), JSON.stringify(still.filter((id) => !samePose(poseOf(after, id), poseOf(list, id)))));
    // The beam rides on the gear's shaft through a round hole, so it can slide along it; the connector's
    // peg is seated in the beam and keeps its depth, so the three move together
    const slid = ['beam', 'corner', 'pin'].map((id) => new THREE.Vector3(...byId(after, id).position).sub(new THREE.Vector3(...byId(list, id).position)));
    check('  the beam, connector and pin slide together along the gear shaft (z), not sideways', slid.every((d) => Math.abs(d.z) > 0.4 && Math.abs(d.z) < 1 && Math.hypot(d.x, d.y) < 0.05 && Math.abs(d.z - slid[0].z) < 0.01), JSON.stringify(slid.map((d) => d.toArray().map((v) => v.toFixed(3)))));
    const seat = (insts) => findSeatedPairs(worldFeaturesFor(byId(insts, 'corner')), worldFeaturesFor(byId(insts, 'beam'))).map((p) => p.insert.origin.clone().sub(p.opening.origin).dot(p.opening.axis));
    check('  the connector stays seated as deep on the beam as it was', seat(after).length === 1 && Math.abs(seat(after)[0] - seat(list)[0]) < 0.01, JSON.stringify([seat(list), seat(after)]));
    check('  the motor stays where it was (its worm shaft is meshed, so it is not squared)', samePose(poseOf(after, 'motor'), poseOf(list, 'motor')));
    const now = pinInHole(after);
    check('  the pin lines up with the motor hole (0.25 mm, 2°)', now.line < 0.25 && now.angle < 2, JSON.stringify(now));
    const overlapping = after.filter((i) => checkCandidateCollision(i, after).isIntersecting).map((i) => i.instanceId);
    check('  nothing overlaps', overlapping.length === 0, overlapping.join(', '));
    check('  the message says what moved, why the motor side did not, and why the tilt stays', /moved 2x9 Beam/.test(r.message) && /would have taken Worm out of mesh with Gear 36/.test(r.message) && /Smart Motor #2 is 0\.9° off Worm shaft; turning the shaft would take Worm out of mesh/.test(r.message), r.message);
  }
}
{
  // Nothing can move: the motor locked (it could turn about its shaft), the beam grouped with the gear's
  // shaft (so it can't slide on it) and the connector grouped with the beam
  const list = rig().map((i) =>
    i.instanceId === 'motor' ? { ...i, locked: true } : ['beam', 'gearShaft', 'corner', 'pin'].includes(i.instanceId) ? { ...i, groupId: 'g1' } : i
  );
  const r = runAction('fix_assembly', { instances: JSON.parse(JSON.stringify(list)) }, { instanceId: 'pin' });
  check('with nothing free to move, Fix assembly moves nothing', !r.ok, JSON.stringify(r.ok && r.moved));
  check('  and says what is out of line, by how much, and the gear in the way', /Pin #4 is 0\.\d+ mm and 0\.\d° out of line with Smart Motor #2\. Nothing can move .* out of mesh with/.test(r.error || ''), r.error);
}

// --- 3.1 Lining up after a pin goes in -----------------------------------------------------------
{
  const list = rig();
  const r = lineUpAfterInsert({ instances: list }, { instanceId: 'pin' });
  check('after Pin #4 goes into the connector, the motor hole 0.6 mm off is lined up', r && r.patches.length > 0, JSON.stringify(r));
  if (r?.patches.length) {
    const after = applyPosePatches(list, r.patches);
    const now = pinInHole(after);
    check('  the pin is on the motor hole line (0.25 mm, 2°)', now.line < 0.25 && now.angle < 2, JSON.stringify(now));
    check('  no meshed gear or shaft moved', !r.patches.some((p) => ['gear36', 'worm', 'gearShaft', 'wormShaft'].includes(p.instanceId)), JSON.stringify(r.moved));
    check('  nothing overlaps', !r.patches.some((p) => p.isIntersecting));
    check('  the message says what moved', /moved 2x9 Beam/.test(r.message), r.message);
  }
  // Only holes the inserted part itself nearly reaches count: the gear's shaft, seated in the beam, is
  // in the pin's block, but the pin's near miss isn't the shaft's, so nothing moves
  check('a shaft put in leaves its block alone when only another part of it nearly lines up', lineUpAfterInsert({ instances: rig() }, { instanceId: 'gearShaft' }) === null);
  // 2 mm off: too far to count
  const far = rig().map((i) => (['beam', 'corner', 'pin'].includes(i.instanceId) ? { ...i, position: [i.position[0], i.position[1], i.position[2] - 2] } : i));
  check('a motor hole 2 mm off the pin is left alone', lineUpAfterInsert({ instances: far }, { instanceId: 'pin' }) === null);
  // Blocked: the message only
  const blocked = rig().map((i) => (i.instanceId === 'motor' ? { ...i, locked: true } : ['beam', 'gearShaft', 'corner', 'pin'].includes(i.instanceId) ? { ...i, groupId: 'g1' } : i));
  const b = lineUpAfterInsert({ instances: blocked }, { instanceId: 'pin' });
  check('when nothing may move, no patches and the message says what is out of line', b && b.patches.length === 0 && /out of line with Smart Motor #2/.test(b.message), JSON.stringify(b));
}

// --- A shaft put into a meshed gear just off its beam hole: the beam and motor stay put -----------
{
  const train = [
    inst('beam20', '2x20 Beam', [-4.488, -43.434, 44.153], [0, 0, -0.44], { label: '2x20 Beam #1' }),
    inst('motor3', 'VEX IQ Smart Motor', [93.935, -44.072, 47.248], [-90, 0.44, 0], { label: 'Smart Motor #3', socketAngleDeg: -14.1 }),
    inst('p5', '0x2 Connector Pin with Spherical Cap', [116.208, -37.892, 47.251], [0, 0, -0.44]),
    inst('p6', '0x2 Connector Pin with Spherical Cap', [103.411, -50.495, 47.251], [0, 0, -0.44]),
    inst('p7', '0x2 Connector Pin with Spherical Cap', [116.111, -50.592, 47.251], [0, 0, -0.44]),
    inst('p8', '0x2 Connector Pin with Spherical Cap', [103.508, -37.795, 47.67], [0, 0, -0.44]),
    inst('shaft6', '4x Pitch Shaft', [84.41, -43.999, 31.405], [0, 0, 0]),
    inst('g36a', '36 Tooth Gear', [84.41, -43.999, 36.215], [0, 0, 0], { label: '36 Tooth Gear #2' }),
    inst('g24', '24 Tooth Gear', [52.66, -37.764, 39.237], [0, 0, 2.22], { label: '24 Tooth Gear #1' }),
    inst('g36b', '36 Tooth Gear', [20.91, -44.114, 39.235], [0, 0, -2.63], { label: '36 Tooth Gear #3' }),
    inst('newShaft', '4x Pitch Shaft', [20.91, -44.114, 34.425], [0, 0, -2.63], { label: 'New shaft' })
  ];
  const r = lineUpAfterInsert({ instances: train }, { instanceId: 'newShaft' });
  // The train is laid out again from the motor's gear: the 36 Tooth Gear and its new shaft move onto
  // the beam hole and turn to mesh; the beam, motor, pins and the motor's shaft and gear stay put
  const { meshRelation, meshTurn, worldToothed } = await import('../src/utils/gearMeshing.js');
  const moved = new Set(r?.moved || []);
  check('shaft into the 36 Tooth Gear 0.5 mm off its beam hole: the gear and shaft move, the beam and motor stay', r && moved.has('g36b') && moved.has('newShaft') && !['beam20', 'motor3', 'p5', 'p6', 'p7', 'p8', 'shaft6', 'g36a'].some((id) => moved.has(id)), JSON.stringify(r?.moved));
  const after = applyPosePatches(train, r?.patches || []);
  check('  the new shaft is now in the beam hole', findSeatedPairs(worldFeaturesFor(byId(after, 'newShaft')), worldFeaturesFor(byId(after, 'beam20'))).length > 0);
  const t = (id) => worldToothed(findPart(byId(after, id).label.replace(/ #\d+$/, '')), byId(after, id).position, byId(after, id).rotation, id);
  const meshed = (a, b) => Boolean(meshRelation(t(a), t(b)) || meshRelation(t(b), t(a)));
  check('  every pair still meshes', meshed('g36a', 'g24') && meshed('g24', 'g36b'));
  const phase = Math.abs(meshTurn(t('g36b'), [t('g24')])?.turnDeg ?? 99);
  check('  and the moved gear is turned to mesh with the one before it', phase < 0.05, String(phase));
  check('  the message says what moved', /Moved 36 Tooth Gear #3 0\.\d+ mm onto the hole of 2x20 Beam #1/.test(r?.message || ''), r?.message);
}

// --- A pin grazing a beam hole's mouth doesn't lock a gear to the beam in Play --------------------
{
  const { playInputs } = await import('../mcp/assembly-engine.mjs');
  const { buildBodyGraph } = await import('../src/sim/bodyGraph.js');
  const arm = [
    inst('beam20', '2x20 Beam', [-4.488, -43.434, 44.153], [0, 0, -0.44]),
    inst('g60', '60 Tooth Gear', [-29.887, -43.239, 39.01], [0, 0, 0]),
    inst('shaft8', '4x Pitch Shaft', [-29.887, -43.239, 17.68], [0, 0, 1.72]),
    inst('arm', '1x6 Beam', [-23.537, -42.897, 33.751], [0, 0, 1.72]),
    inst('pin9', '0x2 Connector Pin with Spherical Cap', [-42.578, -43.469, 36.35], [0, 0, 1.72]),
    inst('pin10', '0x2 Connector Pin with Spherical Cap', [-17.19, -42.706, 35.842], [0, 0, 1.72])
  ];
  const g = buildBodyGraph(playInputs({ instances: arm }));
  const body = g.bodies.find((b) => b.parts.includes('g60'));
  check('Play: a pin tip 0.1 mm into a beam hole doesn\'t join the 60 Tooth Gear to the beam', body && !body.parts.includes('beam20'), JSON.stringify(body?.parts));
  check('  the gear, its arm and pins turn together on the shaft', body && ['shaft8', 'arm', 'pin9', 'pin10'].every((id) => body.parts.includes(id)), JSON.stringify(body?.parts));
}

// --- 7.6 90° gears just out of mesh snap into mesh when placed ------------------------------------
{
  const { meshRelation, rightAngleNearMiss, worldToothed } = await import('../src/utils/gearMeshing.js');
  const pair = (dy = 0, dx = 0) => [
    inst('gearShaft', '4x Pitch Shaft', [100, 40, 21.33], [0, 0, 0], { label: 'Gear shaft' }),
    inst('upright', '18 Tooth Bevel Gear', [100, 40, 50.99], [0, 0, 0], { label: 'Upright bevel' }),
    inst('side', '18 Tooth Bevel Gear', [101.159 + dx, 40 + dy, 50.249], [15, -90, 0], { label: 'Side bevel' }),
    inst('sideShaft', '4x Pitch Shaft', [108.393 + dx, 40 + dy, 50.249], [0, 90, 0], { label: 'Side shaft' })
  ];
  const tooth = (list, id) => worldToothed(findPart('18 Tooth Bevel Gear'), byId(list, id).position, byId(list, id).rotation, id);
  const list = pair();
  check('orange bevels: 1.4 mm out of mesh to start', rightAngleNearMiss(tooth(list, 'side'), tooth(list, 'upright'))?.offMm === 1.4);
  const r = settlePlacedInstance(byId(list, 'side'), list);
  const after = applyPosePatches(list, r.patches);
  check('  placing the side bevel slides both into mesh', Boolean(meshRelation(tooth(after, 'side'), tooth(after, 'upright'))), JSON.stringify(r.messages));
  const moved = (id) => new THREE.Vector3(...byId(after, id).position).distanceTo(new THREE.Vector3(...byId(list, id).position));
  check('  the side bevel slid about 1.16 mm, the upright one about 0.74 mm', Math.abs(moved('side') - 1.159) < 0.1 && Math.abs(moved('upright') - 0.741) < 0.1, `${moved('side').toFixed(3)} / ${moved('upright').toFixed(3)}`);
  check('  neither shaft moved off its line', moved('gearShaft') < 1e-6 && moved('sideShaft') < 1e-6);
  check('  the message says what slid', r.messages.some((m) => /Slid Side bevel 1\.\d mm along its shaft to mesh with Upright bevel/.test(m)), JSON.stringify(r.messages));
  // The side shaft 2 mm out of line sideways: slides along the two axes can't close it
  const aside = pair(2);
  const r2 = settlePlacedInstance(byId(aside, 'side'), aside);
  const slid = (before, res) => res.patches.some((p) => p.position && ['side', 'upright'].includes(p.instanceId) && new THREE.Vector3(...p.position).distanceTo(new THREE.Vector3(...byId(before, p.instanceId).position)) > 0.01);
  check('shaft lines 2 mm out of line: nothing slides', !slid(aside, r2), JSON.stringify(r2.messages));
  // 4 mm away along the side gear's own axis: further than the snap reaches
  const far = pair(0, 4);
  const r3 = settlePlacedInstance(byId(far, 'side'), far);
  check('4 mm from meshing: nothing slides', !slid(far, r3), JSON.stringify(r3.messages));
}

if (failures) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll precise-placement checks passed');
