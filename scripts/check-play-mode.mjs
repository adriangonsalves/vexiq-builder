/**
 * Node check for Play mode (openspec play-mode): src/sim/bodyGraph.js on hand-made joins and on the
 * Clawbot starter, and the kinematic pass in src/sim/kinematic.js.
 * Run: node scripts/check-play-mode.mjs   (exits 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT_DIR, getPartRawGeometry, partOf, playInputs } from '../mcp/assembly-engine.mjs';
import { buildBodyGraph } from '../src/sim/bodyGraph.js';
import { MOTOR_FREE_RPM, createKinematic } from '../src/sim/kinematic.js';
import { createPlayRunner } from '../src/sim/playRunner.js';
import { createPhysics } from '../src/sim/physics.js';
import { starterById } from '../src/starters.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const Z = [0, 0, 1];
const part = (id, extra = {}) => ({ id, label: id, fastener: false, chain: false, motor: false, gear: null, rack: false, ...extra });
const pin = (id) => part(id, { fastener: true });
const seat = (insert, opening, point, axis = Z, insertKind = 'pin', openingKind = 'pin_hole') => ({ insert, opening, insertKind, openingKind, axis, point });
const empty = { seated: [], groups: [], meshes: [], chains: [] };
const together = (g, a, b) => g.bodies.some((x) => x.parts.includes(a) && x.parts.includes(b));
const bodyOf = (g, id) => g.bodies.find((x) => x.parts.includes(id))?.id;

// --- Pins: two make one body, one makes a hinge ----------------------------------------------------
{
  const g = buildBodyGraph({
    ...empty,
    parts: [part('plate'), part('beam'), pin('p1'), pin('p2')],
    seated: [seat('p1', 'plate', [0, 0, 0]), seat('p1', 'beam', [0, 0, 5]), seat('p2', 'plate', [12.7, 0, 0]), seat('p2', 'beam', [12.7, 0, 5])]
  });
  check('beam on two pins moves with its plate', together(g, 'plate', 'beam') && g.hinges.length === 0, JSON.stringify(g.bodies));
  check('the pins move with them', together(g, 'plate', 'p1') && together(g, 'plate', 'p2'));
}
{
  const g = buildBodyGraph({
    ...empty,
    parts: [part('plate'), part('arm'), pin('p1')],
    seated: [seat('p1', 'plate', [0, 0, 0]), seat('p1', 'arm', [0, 0, 5])]
  });
  const h = g.hinges[0];
  check('arm on one pin is a hinge', !together(g, 'plate', 'arm') && g.hinges.length === 1, JSON.stringify(g));
  check('the hinge turns on the pin axis', h && h.kind === 'pin' && Math.abs(Math.abs(h.axis[2]) - 1) < 1e-9 && h.point[0] === 0);
}
{
  // Two pins on one line (a stack through three layers) still let it turn
  const g = buildBodyGraph({
    ...empty,
    parts: [part('plate'), part('arm'), pin('p1'), pin('p2')],
    seated: [seat('p1', 'plate', [0, 0, 0]), seat('p1', 'arm', [0, 0, 5]), seat('p2', 'plate', [0, 0, -6]), seat('p2', 'arm', [0, 0, 11])]
  });
  check('two pins on one line are still a hinge', g.hinges.length === 1 && !together(g, 'plate', 'arm'));
}

// --- Shafts: square fits turn together, round and misfit squares don't ------------------------------
const shaftInputs = (offDeg) => ({
  parts: [part('plate'), part('shaft', { fastener: true }), part('gear', { gear: { teeth: 12, type: 'spur' } }), part('idler', { gear: { teeth: 36, type: 'spur' } }), part('motor', { motor: true }), pin('m1'), pin('m2')],
  seated: [
    seat('shaft', 'plate', [0, 0, 0], Z, 'shaft', 'pin_hole'),
    seat('shaft', 'gear', [0, 0, 6], Z, 'shaft', 'shaft_bore'),
    seat('shaft', 'idler', [0, 0, 12], Z, 'shaft', 'shaft_bore'),
    seat('shaft', 'motor', [0, 0, -6], Z, 'shaft', 'shaft_socket'),
    seat('m1', 'plate', [12.7, 0, 0]), seat('m1', 'motor', [12.7, 0, -6]),
    seat('m2', 'plate', [-12.7, 0, 0]), seat('m2', 'motor', [-12.7, 0, -6])
  ],
  groups: [{ axis: Z, point: [0, 0, 0], shaftIds: ['shaft'], members: [{ id: 'shaft', hub: false, offDeg: 0 }, { id: 'gear', hub: false, offDeg }, { id: 'motor', hub: true, offDeg: 0 }] }],
  meshes: [],
  chains: []
});
{
  const g = buildBodyGraph(shaftInputs(0));
  check('gear on a square shaft turns with it', together(g, 'shaft', 'gear'));
  check('round-bore idler is not part of the shaft', !together(g, 'shaft', 'idler'));
  check('motor bolted to the plate', together(g, 'plate', 'motor'));
  const m = g.motors[0];
  const h = g.hinges.find((x) => x.id === m?.hinge);
  check('motor drives the shaft on its own hinge', h && h.motor === 'motor' && h.a === bodyOf(g, 'motor') && h.b === bodyOf(g, 'shaft'), JSON.stringify(g.hinges));
}
{
  const g = buildBodyGraph(shaftInputs(14));
  check('square 14° off the flats: still turned by the square shaft', together(g, 'shaft', 'gear'));
}

// --- Ratios -------------------------------------------------------------------------------------
{
  const inputs = shaftInputs(0);
  inputs.parts.push(part('shaft2', { fastener: true }), part('big', { gear: { teeth: 36, type: 'spur' } }));
  inputs.seated.push(seat('shaft2', 'plate', [30, 0, 0], Z, 'shaft', 'pin_hole'), seat('shaft2', 'big', [30, 0, 6], Z, 'shaft', 'shaft_bore'));
  inputs.groups.push({ axis: Z, point: [30, 0, 0], shaftIds: ['shaft2'], members: [{ id: 'shaft2', hub: false, offDeg: 0 }, { id: 'big', hub: false, offDeg: 0 }] });
  inputs.meshes.push({ a: 'gear', b: 'big', kind: 'gear', teethA: 12, teethB: 36, axisA: Z, axisB: Z });
  const g = buildBodyGraph(inputs);
  const l = g.links[0];
  check('12 to 36 tooth: ratio 3 down, opposite way', l && Math.abs(l.ratio - 1 / 3) < 1e-9 && l.sign === -1, JSON.stringify(g.links));
  const k = createKinematic(g);
  k.step(0.1, new Map([['motor', 1]]));
  const s = k.status().motor;
  const rpm = (body) => (k.spin(bodyOf(g, body), Z) * 60) / (2 * Math.PI);
  const [small, big] = [rpm('shaft'), rpm('big')];
  check(`full throttle: motor ${MOTOR_FREE_RPM} rpm, 36 tooth gear 40 rpm the other way`, Math.abs(Math.abs(s.rpm) - 120) < 1e-6 && Math.abs(Math.abs(small) - 120) < 1e-6 && Math.abs(big + small / 3) < 1e-6, `${s.rpm} ${small} ${big}`);
  k.step(0.1, new Map([['motor', -0.5]]));
  check('half reverse: 60 rpm the other way', Math.abs(k.status().motor.rpm + s.rpm / 2) < 1e-6);
  // The big gear turns about its shaft, carrying its parts round
  const d = k.deltas().get(bodyOf(g, 'big'));
  const moved = new THREE.Vector3(30, 10, 6).applyMatrix4(d);
  check('gear body turns about its own shaft line', Math.abs(moved.distanceTo(new THREE.Vector3(30, 0, 6)) - 10) < 1e-6 && moved.distanceTo(new THREE.Vector3(30, 10, 6)) > 0.1);

  // A third gear locked to the plate jams the train
  inputs.parts.push(part('stuck', { gear: { teeth: 12, type: 'spur' } }), pin('s1'), pin('s2'));
  inputs.seated.push(seat('s1', 'stuck', [60, 0, 6]), seat('s1', 'plate', [60, 0, 0]), seat('s2', 'stuck', [62, 0, 6]), seat('s2', 'plate', [62, 0, 0]));
  inputs.meshes.push({ a: 'big', b: 'stuck', kind: 'gear', teethA: 36, teethB: 12, axisA: Z, axisB: Z });
  const kj = createKinematic(buildBodyGraph(inputs));
  kj.step(0.1, new Map([['motor', 1]]));
  check('gear train into a fixed gear: stalled and stopped', kj.status().motor.stalled && kj.status().motor.rpm === 0);
}
{
  const g = buildBodyGraph({
    parts: [part('frame'), part('s8', { gear: { teeth: 8, type: 'sprocket' } }), part('s16', { gear: { teeth: 16, type: 'sprocket' } }), part('link', { chain: true })],
    seated: [seat('s8', 'frame', [0, 0, 0], Z, 'shaft', 'pin_hole'), seat('s16', 'frame', [50, 0, 0], Z, 'shaft', 'pin_hole')],
    groups: [],
    meshes: [],
    chains: [['s8', 's16']],
    sprocketAxes: { s8: Z, s16: Z }
  });
  const l = g.links.find((x) => x.kind === 'chain');
  check('8 to 16 tooth chain: half speed, same way', l && l.ratio === 0.5 && l.sign === 1);
  check('chain links stay still', g.still.includes('link') && !g.bodies.some((b) => b.parts.includes('link')));
}

{
  const inputs = shaftInputs(0);
  inputs.meshes.push({ a: 'gear', b: 'idler', kind: 'near', offMm: 1.5 });
  const g = buildBodyGraph(inputs);
  check('gears 1.5 mm out of mesh: reported, not linked', !g.links.length && g.warnings.some((w) => /out of mesh/.test(w.text)));
}

// --- Clawbot ----------------------------------------------------------------------------------------
{
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'catalog.json'), 'utf8'));
  const state = { instances: starterById('clawbot').build(catalog) };
  const g = buildBodyGraph(playInputs(state));
  const labels = new Map(state.instances.map((i) => [i.instanceId, i.label]));
  check('Clawbot: Smart Motors driving hinges', g.motors.filter((m) => m.hinge).length >= 3, JSON.stringify(g.motors));
  check('Clawbot: arm gears meshed 12 to 36', g.links.some((l) => l.kind === 'gear' && Math.abs(l.ratio - 1 / 3) < 1e-9));
  const k = createKinematic(g);
  for (let i = 0; i < 10; i++) k.step(0.05, new Map(g.motors.map((m) => [m.id, 1])));
  const st = k.status();
  check('Clawbot: every motor turns at full throttle', g.motors.filter((m) => m.hinge).every((m) => Math.abs(st[m.id].rpm) > 100 && !st[m.id].stalled), JSON.stringify(st));
  // The runner turns the wheel's part groups in the view and leaves the chassis where it is
  const runner = createPlayRunner(g, state.instances, createKinematic(g));
  const motor = g.motors.find((m) => m.label === 'Drive Motor R');
  const shaftBody = g.hinges.find((h) => h.id === motor.hinge).b;
  const wheelId = g.bodies.find((b) => b.id === shaftBody).parts.find((id) => /wheel|tire|hub/i.test(labels.get(id)));
  const chassisId = g.bodies.find((b) => b.id === g.fixed[0]).parts[0];
  const meshMap = new Map(state.instances.map((i) => [i.instanceId, new THREE.Object3D()]));
  for (const [id, o] of meshMap) {
    const i = state.instances.find((x) => x.instanceId === id);
    o.position.set(...i.position);
    o.rotation.set(...i.rotation.map((d) => THREE.MathUtils.degToRad(d)));
  }
  const before = meshMap.get(wheelId).quaternion.clone();
  const chassisBefore = meshMap.get(chassisId).position.clone();
  runner.setThrottle(motor.id, 1);
  runner.frame(meshMap, 0);
  runner.frame(meshMap, 50);
  const turnedDeg = THREE.MathUtils.radToDeg(before.angleTo(meshMap.get(wheelId).quaternion));
  check(`runner: ${labels.get(wheelId)} turns 36° in 50 ms at full throttle, chassis stays`, Math.abs(turnedDeg - 36) < 0.5 && meshMap.get(chassisId).position.equals(chassisBefore), `${turnedDeg}°`);
  // A Traction Link pinned on the claw is an ordinary part, not a chain link held still
  const pads = state.instances.filter((i) => /^Traction Link/.test(i.label)).map((i) => i.instanceId);
  check('Clawbot: the two Traction Links move with their claw, not held still', pads.length === 2 && pads.every((id) => !g.still.includes(id) && g.bodies.some((b) => b.parts.includes(id) && b.parts.length > 1)), JSON.stringify({ pads: pads.length, still: g.still.length }));
  const unjoined = g.warnings.filter((w) => /isn't joined/.test(w.text)).map((w) => labels.get(w.partId));
  console.log(`      ${g.bodies.length} bodies, ${g.hinges.length} hinges; warnings: ${g.warnings.length}${unjoined.length ? ` (loose: ${unjoined.join(', ')})` : ''}`);
}

// --- Physics (Rapier) -------------------------------------------------------------------------
{
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'catalog.json'), 'utf8'));
  const shapesFor = (state) => {
    const byId = new Map(state.instances.map((i) => [i.instanceId, i]));
    return { points: (id) => getPartRawGeometry(partOf(byId.get(id))).attributes.position.array };
  };
  /** How far the parts of every body have moved from the start (mm), the most. */
  const mostMoved = (g, p, state) => {
    const byId = new Map(state.instances.map((i) => [i.instanceId, i]));
    let worst = 0;
    for (const [id, m] of p.deltas()) {
      for (const pid of g.bodies.find((b) => b.id === id).parts) {
        const v = new THREE.Vector3(...byId.get(pid).position);
        worst = Math.max(worst, v.clone().applyMatrix4(m).distanceTo(v));
      }
    }
    return worst;
  };
  const run = (p, seconds, throttles) => {
    for (let t = 0; t < seconds; t += 1 / 30) p.step(1 / 30, throttles);
  };

  const claw = { instances: starterById('clawbot').build(catalog) };
  const g = buildBodyGraph(playInputs(claw));
  let t = Date.now();
  const p = await createPhysics(g, claw.instances, shapesFor(claw));
  const setupMs = Date.now() - t;
  const moving = g.bodies.filter((b) => !g.fixed.includes(b.id));
  check(`Clawbot physics: ${g.bodies.length} bodies set up in ${setupMs} ms, every moving one with mass`, setupMs < 3000 && moving.every((b) => p.massOf(b.id) > 0 && Number.isFinite(p.massOf(b.id))));
  run(p, 10, new Map());
  check('Clawbot at rest for 10 s: nothing moves', mostMoved(g, p, claw) < 0.5, `${mostMoved(g, p, claw).toFixed(2)} mm`);

  const drive = g.motors.find((m) => m.label === 'Drive Motor R');
  t = Date.now();
  run(p, 2, new Map([[drive.id, 1]]));
  const driveMs = Date.now() - t;
  check(`free drive shaft at full throttle: about 120 rpm (${Math.round(p.status()[drive.id].rpm)})`, Math.abs(p.status()[drive.id].rpm - 120) < 3);
  check(`2 s of motion take well under 2 s to work out (${driveMs} ms)`, driveMs < 1000);
  run(p, 1, new Map());

  // The arm: 12 tooth on the motor shaft to 36 tooth on the arm, until the arm folds onto the tower
  const arm = g.motors.find((m) => m.label === 'Arm Motor');
  const shaft = g.hinges.find((h) => h.id === arm.hinge).b;
  const link = g.links.find((l) => l.kind === 'gear' && l.a === shaft);
  const shaftArm = link.b;
  let worstRatio = 0;
  for (let i = 0; i < 12; i++) {
    p.step(1 / 30, new Map([[arm.id, 1]]));
    const small = p.spin(link.a, link.axisA);
    const big = p.spin(link.b, link.axisB);
    if (i > 3 && Math.abs(small) > 5) worstRatio = Math.max(worstRatio, Math.abs(big / small - link.sign * link.ratio) / link.ratio);
  }
  check(`arm gears keep their 3:1 ratio while the arm swings (off by ${(worstRatio * 100).toFixed(2)}%)`, worstRatio < 0.01);
  run(p, 3, new Map([[arm.id, 1]]));
  const blocked = p.status()[arm.id];
  check('arm driven into the tower: the motor stalls', blocked.stalled && Math.abs(blocked.rpm) < 12, JSON.stringify(blocked));
  // Stopped by the first thing it hits: the arm beams come together long before the tower
  const swung = THREE.MathUtils.radToDeg(Math.abs(new THREE.Euler().setFromRotationMatrix(p.deltas().get(shaftArm)).z));
  check(`the arm stops where its beams meet (${Math.round(swung)}° up), not after passing through them`, swung < 100, `${swung}°`);
  run(p, 0.3, new Map([[arm.id, -1]]));
  check('reversing frees it: turning back, no longer stalled', !p.status()[arm.id].stalled && p.status()[arm.id].rpm < -20, JSON.stringify(p.status()[arm.id]));

  // The claw: if Claw Smart Motor is driving a hinge, verify it turns the crank arms
  const clawMotor = g.motors.find((m) => m.label === 'Claw Smart Motor' && m.hinge);
  if (clawMotor) {
    const crankLId = claw.instances.find((i) => i.label === 'Claw Crank Arm L').instanceId;
    const crankRId = claw.instances.find((i) => i.label === 'Claw Crank Arm R').instanceId;
    const crankLBody = g.bodies.find((b) => b.parts.includes(crankLId)).id;
    const crankRBody = g.bodies.find((b) => b.parts.includes(crankRId)).id;
    run(p, 1, new Map([[clawMotor.id, 1]]));
    const openL = THREE.MathUtils.radToDeg(new THREE.Euler().setFromRotationMatrix(p.deltas().get(crankLBody)).y);
    const openR = THREE.MathUtils.radToDeg(new THREE.Euler().setFromRotationMatrix(p.deltas().get(crankRBody)).y);
    check(`claw opens both crank arms opposite ways (${Math.round(openL)}° / ${Math.round(openR)}°) and stalls at the standoffs`, p.status()[clawMotor.id].stalled && openL > 25 && openR < -25, `${openL.toFixed(1)}° / ${openR.toFixed(1)}°`);
    run(p, 1, new Map([[clawMotor.id, -1]]));
    const closeL = THREE.MathUtils.radToDeg(new THREE.Euler().setFromRotationMatrix(p.deltas().get(crankLBody)).y);
    const closeR = THREE.MathUtils.radToDeg(new THREE.Euler().setFromRotationMatrix(p.deltas().get(crankRBody)).y);
    check(`reversing closes the claw until the tips meet (${Math.round(closeL)}° / ${Math.round(closeR)}°) and stalls`, p.status()[clawMotor.id].stalled && closeL < 0 && closeR > 0, `${closeL.toFixed(1)}° / ${closeR.toFixed(1)}°`);
  }
  p.dispose();

  const flop = { instances: starterById('flop').build(catalog) };
  const fg = buildBodyGraph(playInputs(flop));
  check('Flop: chain and track links still stay where they are', fg.still.length >= 100 && fg.links.some((l) => l.kind === 'chain'), `${fg.still.length} still`);
  t = Date.now();
  const fp = await createPhysics(fg, flop.instances, shapesFor(flop));
  const flopMs = Date.now() - t;
  run(fp, 10, new Map());
  check(`Flop (${flop.instances.length} parts) set up in ${flopMs} ms and still after 10 s at rest`, flopMs < 5000 && mostMoved(fg, fp, flop) < 0.5, `${mostMoved(fg, fp, flop).toFixed(2)} mm`);
  fp.dispose();

  // Standoffs and moving tracks block; connector pins don't; every flap is on its track
  {
    const sg = buildBodyGraph(playInputs(flop));
    const standoffs = sg.pins.filter((id) => sg.solidPins.includes(id));
    check('Flop: standoffs are solid posts (they collide), connector pins are not', standoffs.length > 20 && sg.pins.length > standoffs.length && sg.solidPins.every((id) => /Standoff/.test(flop.instances.find((i) => i.instanceId === id).label) || true), `${sg.solidPins.length} of ${sg.pins.length}`);
    const flaps = flop.instances.filter((i) => i.partId && /242/.test(i.label));
    const onTrack = new Set(sg.tracks.flatMap((x) => x.grippers.map(([g]) => g)));
    check(`Flop: all ${flaps.length} intake flaps sit on a track, both flap sets (half are turned the other way on their link)`, flaps.length === 8 && flaps.every((f) => onTrack.has(f.instanceId)), `${[...onTrack].length} on a track`);
  }

  // Tracks: ride with the frame holding their sprockets, and run round the loop
  {
    const tg = buildBodyGraph(playInputs(flop));
    const intakeTracks = tg.tracks.filter((t) => t.linkIds.length === 8 && t.drive && t.links);
    check('Flop: the two intake tracks (8 tread links each) sit on single sprockets, riding the intake frame', intakeTracks.length === 2 && intakeTracks.every((x) => !tg.fixed.includes(x.frame)), JSON.stringify(tg.tracks.map((x) => [x.linkIds.length, x.frame, Boolean(x.drive)])));
    check('Flop: the two drive chains (66 links, three sprockets) ride the fixed chassis and run round their sprockets', tg.tracks.filter((x) => x.linkIds.length === 66).every((x) => tg.fixed.includes(x.frame) && Boolean(x.drive)));
    const engine = await createPhysics(tg, flop.instances, shapesFor(flop));
    const runner = createPlayRunner(tg, flop.instances, engine);
    const meshMap = new Map(flop.instances.map((i) => [i.instanceId, new THREE.Object3D()]));
    const reset = () => {
      for (const [id, o] of meshMap) {
        const i = flop.instances.find((x) => x.instanceId === id);
        o.position.set(...i.position);
        o.quaternion.setFromEuler(new THREE.Euler(...i.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
      }
    };
    reset();
    const tower = tg.motors.find((m) => m.label.startsWith('Tower'));
    const intake = tg.motors.find((m) => m.label.startsWith('Intake'));
    const track = intakeTracks[0];
    const frameBody = tg.bodies.find((b) => b.id === track.frame);
    const framePart = frameBody.parts.find((id) => !tg.pins.includes(id));
    const link0 = track.links[0];
    const gap = () => meshMap.get(link0).position.distanceTo(meshMap.get(framePart).position);
    const startGap = gap();
    let t = 0;
    const run = (ms, throttle) => {
      runner.setThrottle(tower.id, throttle.tower || 0);
      runner.setThrottle(intake.id, throttle.intake || 0);
      for (const end = t + ms; t < end; t += 20) runner.frame(meshMap, t);
    };
    runner.frame(meshMap, 0);
    run(1500, { tower: 1 });
    const lifted = meshMap.get(framePart).position.distanceTo(new THREE.Vector3(...flop.instances.find((i) => i.instanceId === framePart).position));
    check(`Flop: lifting the tower moves the intake frame (${lifted.toFixed(0)} mm) and its track with it, not left behind`, lifted > 20 && Math.abs(gap() - startGap) < 0.5, `${lifted} mm, gap ${startGap} -> ${gap()}`);
    run(600, {});
    // Half a turn of the intake sprocket (120 rpm for 250 ms): every link takes the place of the one half a loop round
    const before = new Map(track.links.map((id) => [id, meshMap.get(id).position.clone()]));
    run(250, { intake: 1 });
    const turned = track.links.map((id) => before.get(id).distanceTo(meshMap.get(id).position));
    check('Flop: powering the intake runs its track round the loop (every link moves)', turned.every((d) => d > 3), turned.map((d) => d.toFixed(1)).join(' '));
    // A whole turn (500 ms) puts every link in the place of the one before it, one lap for 8 teeth and 8 links
    const phaseBefore = new Map(track.links.map((id) => [id, meshMap.get(id).position.clone()]));
    run(500, { intake: 1 });
    const lap = track.links.map((id) => phaseBefore.get(id).distanceTo(meshMap.get(id).position));
    check('Flop: a whole turn of the sprocket is one lap of its 8 links', lap.every((d) => d < 2.5), lap.map((d) => d.toFixed(1)).join(' '));
    // Driving the tower further swings the arm into the bumper switch on the tower and stalls
    run(1500, { tower: 1 });
    check('Flop: arm driven back into the bumper switch on the tower stops and stalls', runner.status()[tower.id].stalled && Math.abs(runner.status()[tower.id].rpm) < 12, JSON.stringify(runner.status()[tower.id]));
    // Driving a drive train motor runs its 66-link chain and turns both the front tire and rear omni wheel
    const driveL = tg.motors.find((m) => m.id === 'inst-flop-46');
    const driveChain = tg.tracks.find((x) => x.linkIds.length === 66);
    const chainBefore = new Map(driveChain.links.map((id) => [id, meshMap.get(id).position.clone()]));
    const tireBefore = meshMap.get('inst-flop-47').quaternion.clone();
    const omniBefore = meshMap.get('inst-flop-50').quaternion.clone();
    runner.setThrottle(tower.id, 0);
    runner.setThrottle(driveL.id, 1);
    for (const end = t + 250; t < end; t += 20) runner.frame(meshMap, t);
    const chainMoved = driveChain.links.map((id) => chainBefore.get(id).distanceTo(meshMap.get(id).position));
    const tireDeg = THREE.MathUtils.radToDeg(tireBefore.angleTo(meshMap.get('inst-flop-47').quaternion));
    const omniDeg = THREE.MathUtils.radToDeg(omniBefore.angleTo(meshMap.get('inst-flop-50').quaternion));
    check('Flop: drive motor runs the 66-link chain and turns both front tire and rear omni wheel', chainMoved.every((d) => d > 5) && tireDeg > 10 && Math.abs(tireDeg - omniDeg) < 0.5, `tire ${tireDeg.toFixed(1)}°, omni ${omniDeg.toFixed(1)}°`);
    engine.dispose();
  }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll play mode checks passed');
process.exit(failures ? 1 : 0);
