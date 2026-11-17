/**
 * Node check for linear motion parts and idler pins (openspec linear-motion-and-idler-pins): the clip
 * seat, channels and smooth ends measured into the catalog; racks clipped onto beams, beams sliding in
 * linear motion brackets and gears on idler pins, as the audit sees them, on the Huey starter and on
 * small rigs made from its parts.
 * Run: node scripts/check-linear-motion.mjs   (exits 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT_DIR, auditAssembly, buildWorldMatrix, checkCandidateCollision, getPartRawGeometry, partOf, playInputs, worldFeaturesFor } from '../mcp/assembly-engine.mjs';
import { createKinematic } from '../src/sim/kinematic.js';
import { createPhysics } from '../src/sim/physics.js';
import { slidesLock } from '../src/utils/linearMotion.js';
import { auditIssues } from '../src/utils/auditIssues.js';
import { buildBodyGraph } from '../src/sim/bodyGraph.js';
import { starterById } from '../src/starters.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'catalog.json'), 'utf8'));
const metadata = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'part-metadata.json'), 'utf8')).parts;
const byNumber = (pn) => catalog.find((p) => p.partNumber === pn);
const huey = starterById('huey').build(catalog);
const hueyById = new Map(huey.map((i) => [i.instanceId, i]));
const inst = (id) => hueyById.get(id);
const v3 = (a) => new THREE.Vector3(...a);
const matOf = (i) => buildWorldMatrix(i.position, i.rotation);
/** Point or direction `a` (in `from`'s frame) in `to`'s frame. */
const into = (from, to, a, dir = false) => {
  const m = matOf(to).invert().multiply(matOf(from));
  return dir ? v3(a).transformDirection(m) : v3(a).applyMatrix4(m);
};

// Huey's linear motion parts (design Context): racks on the Middle Stage's two 1x18 Beams, brackets on the Holder
const RACKS = { 'inst-huey-148': 'inst-huey-138', 'inst-huey-151': 'inst-huey-138', 'inst-huey-149': 'inst-huey-139', 'inst-huey-150': 'inst-huey-139' };
const BRACKETS = ['inst-huey-177', 'inst-huey-178', 'inst-huey-179', 'inst-huey-180', 'inst-huey-181', 'inst-huey-182'];
const IDLER_PINS = { 'inst-huey-412': 'Drive: 228-2500-214-2', 'inst-huey-413': 'Drive: 228-2500-214-1', 'inst-huey-414': 'Drive: 228-2500-228-1', 'inst-huey-415': 'Drive: 228-2500-228-4' };

// --- 1.1 Measured clip seat and channels -------------------------------------------------------------
const rack = byNumber('228-2500-1473');
const brackets = [byNumber('228-2500-1469'), byNumber('228-2500-1470')];
check('the continuous rack carries its measured clip seat (catalog and metadata)', rack.clipSpecs?.measured && metadata[rack.id]?.clipSpecs?.measured, JSON.stringify(rack.clipSpecs));
check('  two clip legs five pitches apart, 6 mm deep, its seat on the side away from the teeth', rack.clipSpecs.legs.length === 2 && near(Math.abs(rack.clipSpecs.legs[0].at[0] - rack.clipSpecs.legs[1].at[0]), 63.5, 0.3) && rack.clipSpecs.legs.every((l) => near(l.depthMm, 6.1, 0.3)) && v3(rack.clipSpecs.seatNormal).dot(v3(rack.rackSpecs.normal)) < -0.99, JSON.stringify(rack.clipSpecs.legs));
for (const b of brackets) {
  check(`${b.name} carries its measured channel (catalog and metadata)`, b.channelSpecs?.measured && metadata[b.id]?.channelSpecs?.measured, JSON.stringify(b.channelSpecs));
  check(`  its slot is wider than the rack's rail and its mouth narrower (the rail can't come out)`, b.channelSpecs.slot.halfWidthMm > rack.clipSpecs.rail.halfWidthMm && b.channelSpecs.mouth.halfWidthMm < rack.clipSpecs.rail.halfWidthMm, JSON.stringify([b.channelSpecs.slot, b.channelSpecs.mouth, rack.clipSpecs.rail]));
}
check("the Snap bracket's channel runs along its local z (its snap peg is its mount)", brackets[1].channelSpecs.direction[2] === 1, JSON.stringify(brackets[1].channelSpecs.direction));
{
  // With the starter's poses: each rack's rail in every bracket on its beam's line, each beam's face on its racks' seats
  const misses = [];
  let railWorst = 0;
  for (const k of BRACKETS) {
    const ch = partOf(inst(k)).channelSpecs;
    for (const r of Object.keys(RACKS)) {
      // Only racks on the line of this bracket (same side of the robot)
      if (Math.sign(inst(r).position[2]) !== Math.sign(inst(k).position[2])) continue;
      const c = partOf(inst(r)).clipSpecs;
      const teeth = into(inst(r), inst(k), partOf(inst(r)).rackSpecs.normal, true);
      const o = into(inst(r), inst(k), [0, 0, 0]);
      const heights = c.rail.heightSpanMm.map((h) => o.clone().addScaledVector(teeth, h).dot(v3(ch.open)));
      const [lo, hi] = [Math.min(...heights), Math.max(...heights)];
      const across = o.dot(v3(ch.across)) - ch.centerAcrossMm;
      const out = Math.max(ch.slot.spanMm[0] - lo, hi - ch.slot.spanMm[1], Math.abs(across) + c.rail.halfWidthMm - ch.slot.halfWidthMm, 0);
      railWorst = Math.max(railWorst, out);
      if (out > 0.5 || teeth.dot(v3(ch.open)) > -0.999) misses.push(`${inst(r).label} in ${inst(k).label}: ${out.toFixed(2)} mm`);
    }
  }
  check(`with Huey's poses each rack's rail lies in all three brackets on its line within 0.5 mm (worst ${railWorst.toFixed(2)} mm)`, misses.length === 0, misses.join('; '));
  let seatWorst = 0;
  const seatMisses = [];
  for (const [r, beam] of Object.entries(RACKS)) {
    const c = partOf(inst(r)).clipSpecs;
    const n = into(inst(r), inst(beam), c.seatNormal, true);
    const box = partOf(inst(beam)).bbox;
    const axis = [0, 1, 2].reduce((a, b) => (Math.abs(n.getComponent(b)) > Math.abs(n.getComponent(a)) ? b : a));
    for (const leg of c.legs) {
      const p = into(inst(r), inst(beam), leg.at);
      const gap = Math.min(Math.abs(p.getComponent(axis) - box.min[axis]), Math.abs(p.getComponent(axis) - box.max[axis]));
      seatWorst = Math.max(seatWorst, gap);
      if (gap > 0.5) seatMisses.push(`${inst(r).label}: ${gap.toFixed(2)} mm`);
    }
  }
  check(`  and each 1x18 Beam's face lies on its racks' seats within 0.5 mm (worst ${seatWorst.toFixed(2)} mm)`, seatMisses.length === 0, seatMisses.join('; '));
  // The beam's face against each bracket's outer face (the beam doesn't go in the channel: its rack does)
  let faceWorst = 0;
  for (const k of BRACKETS) {
    const ch = partOf(inst(k)).channelSpecs;
    const beam = inst(k).position[2] < 0 ? inst('inst-huey-138') : inst('inst-huey-139');
    const g = partOf(beam).bbox;
    const corners = [];
    for (const x of [g.min[0], g.max[0]]) for (const y of [g.min[1], g.max[1]]) for (const z of [g.min[2], g.max[2]]) corners.push(into(beam, inst(k), [x, y, z]).dot(v3(ch.open)));
    faceWorst = Math.max(faceWorst, Math.abs(Math.min(...corners) - ch.faceMm));
  }
  check(`  and lies against every bracket's outer face within 0.5 mm (worst ${faceWorst.toFixed(2)} mm)`, faceWorst <= 0.5, faceWorst.toFixed(2));
}

// --- 1.2 Idler pins' smooth ends ---------------------------------------------------------------------
const idlerNames = ['0x2 Idler Pin', '0x2 Idler Pin (Weak)', '0x3 Idler Pin', '0x3 Smooth Idler Pin (Weak)', '1x1 Idler Pin', '1x2 Idler Pin', '2x3 Smooth Idler Pin'];
for (const name of idlerNames) {
  const p = catalog.find((x) => x.name === name);
  const spans = p?.idlerSpecs?.smoothSpansMm;
  console.log(`      ${name}: smooth end${spans?.length === 1 ? '' : 's'} ${JSON.stringify(spans)} (pin z ${p?.bbox.min[2]}..${p?.bbox.max[2]})`);
  check(`${name}: smooth end measured, at a tip`, Boolean(spans?.length) && spans.every(([lo, hi]) => hi - lo >= 2 && (near(lo, p.bbox.min[2], 0.5) || near(hi, p.bbox.max[2], 0.5))), JSON.stringify(p?.idlerSpecs));
}
check('connector pins have no smooth end', !catalog.find((x) => x.name === '1x1 Connector Pin').idlerSpecs && !catalog.find((x) => x.name === '1x2 Connector Pin').idlerSpecs);
for (const [pinId, gearLabel] of Object.entries(IDLER_PINS)) {
  const pin = inst(pinId);
  const gear = huey.find((i) => i.label === gearLabel);
  const axis = v3([0, 0, 1]).transformDirection(matOf(pin));
  const origin = v3(pin.position);
  const along = (p) => p.clone().sub(origin).dot(axis);
  const spanOf = (f) => [along(f.start), along(f.end)].sort((a, b) => a - b);
  const bore = worldFeaturesFor(gear).find((f) => f.kind === 'shaft_bore');
  const hole = huey.flatMap((o) => (o === pin || o === gear ? [] : worldFeaturesFor(o).filter((f) => f.kind === 'pin_hole' && Math.abs(f.axis.dot(axis)) > 0.99 && f.origin.clone().sub(origin).cross(axis).length() < 0.3)));
  const smooth = partOf(pin).idlerSpecs.smoothSpansMm;
  const overlap = (s, [lo, hi]) => Math.min(s[1], hi) - Math.max(s[0], lo);
  const inGear = Math.max(...smooth.map((s) => overlap(s, spanOf(bore))));
  const inBeam = Math.max(...hole.flatMap((h) => smooth.map((s) => overlap(s, spanOf(h)))));
  check(`Huey ${pin.label}: its smooth end is the one in ${gear.label} (${inGear.toFixed(1)} mm in), not in the beam`, inGear >= 2 && inBeam < 0.5, `gear ${inGear.toFixed(2)} beam ${inBeam.toFixed(2)}`);
}

// --- 2.1 Racks clipped onto beams --------------------------------------------------------------------
const t0 = Date.now();
const audit = auditAssembly({ instances: huey });
const auditMs = Date.now() - t0;
const unsecured = new Set(audit.unsecuredParts.map((u) => u.instanceId));
check("Huey: its four racks are each clipped to the 1x18 Beam they sit on", Object.entries(RACKS).every(([r, b]) => audit.clips.some((c) => c.rackId === r && c.beamId === b)) && audit.clips.length === 4, JSON.stringify(audit.clips.map((c) => [c.rack, c.beam])));
check('  and none is listed as unsecured', Object.keys(RACKS).every((r) => !unsecured.has(r)), [...unsecured].join());
{
  const r = inst('inst-huey-148');
  const n = v3(partOf(r).clipSpecs.seatNormal).transformDirection(matOf(r));
  const moved = huey.map((i) => (i === r ? { ...i, position: i.position.map((v, k) => v - 3 * n.getComponent(k)) } : i));
  const a = auditAssembly({ instances: moved });
  check('a rack moved 3 mm off its beam is no longer clipped, and is unsecured', !a.clips.some((c) => c.rackId === r.instanceId) && a.unsecuredParts.some((u) => u.instanceId === r.instanceId), JSON.stringify(a.clips.map((c) => c.rack)));
}

// --- 2.2 Beams sliding in brackets -------------------------------------------------------------------
let upHand = null;
let downHand = null;
const slide = audit.slides[0];
check('Huey: one slide, the Elevator Middle Stage on the Elevator Holder, through all six brackets', audit.slides.length === 1 && slide.moving.name === 'Elevator Middle Stage' && slide.holder.name === 'Elevator Holder' && slide.bracketIds.length === 6 && BRACKETS.every((k) => slide.bracketIds.includes(k)) && !slide.locked, JSON.stringify(audit.slides.map((s) => [s.moving, s.holder, s.brackets.length])));
check('  along the lift (world up)', slide.direction[1] === 1, JSON.stringify(slide.direction));
const stageIds = new Set(huey.filter((i) => i.groupName === 'Elevator Middle Stage').map((i) => i.instanceId));
check('  and the Middle Stage is not a separate island', !audit.disconnectedIslands.some((isl) => isl.some((p) => stageIds.has(p.instanceId))), JSON.stringify(audit.disconnectedIslands.map((isl) => isl.length)));
{
  // Hand measurements, worked out apart from the engine's search: up, where the lower racks' bottom ends
  // leave the top brackets (nothing on the Holder is in the stage's way); down, the first 0.25 mm step at
  // which a stage part runs into a Holder part (the racks and beams in the brackets, and racks on the
  // lift gears, left out as they touch by design)
  const bottom = Math.min(...Object.keys(RACKS).map((r) => inst(r).position[1] + partOf(inst(r)).clipSpecs.lengthSpanMm[0]));
  const top = Math.max(...BRACKETS.map((k) => inst(k).position[1] + partOf(inst(k)).channelSpecs.spanMm[1]));
  upHand = top - bottom;
  const stage = huey.filter((i) => stageIds.has(i.instanceId) && i.shape?.kind !== 'rope');
  const holder = huey.filter((i) => (i.groupName === 'Drive' || i.groupName === 'Elevator Holder') && i.shape?.kind !== 'rope');
  const isRack = (i) => Boolean(partOf(i)?.clipSpecs);
  const skip = (m, o) => (BRACKETS.includes(o.instanceId) && (isRack(m) || m.instanceId in { 'inst-huey-138': 1, 'inst-huey-139': 1 })) || (isRack(m) && partOf(o)?.gearSpecs);
  for (let t = 0.25; t <= 3 && downHand === null; t += 0.25) {
    for (const m of stage) {
      const moved = { ...m, position: [m.position[0], m.position[1] - t, m.position[2]] };
      if (checkCandidateCollision(moved, holder.filter((o) => !skip(m, o))).isIntersecting) {
        downHand = t - 0.25;
        break;
      }
    }
  }
  console.log(`      travel: audit ${slide.travelMm.forward} mm up, ${slide.travelMm.back} mm down; by hand ${upHand.toFixed(2)} mm up, ${downHand} mm down (${JSON.stringify(slide.stops)})`);
  check('  its travel up is within 3 mm of where the racks leave the top brackets (no Holder part meets the stage before)', near(slide.travelMm.forward, upHand, 3), `${slide.travelMm.forward} vs ${upHand}`);
  check('  its travel down is within 3 mm of where a stage part first meets a Holder part', downHand !== null && near(slide.travelMm.back, downHand, 3) && slide.stops.back.meets, `${slide.travelMm.back} vs ${downHand}`);
}
{
  // Small rigs from Huey's parts: a bracket and a beam with its racks; the beam alone; the beam 3 mm aside
  const pick = (ids) => ids.map(inst);
  const rig = auditAssembly({ instances: pick(['inst-huey-177', 'inst-huey-138', 'inst-huey-148', 'inst-huey-151']) });
  check('a bracket and a beam with its racks in the channel make one slide', rig.slides.length === 1 && rig.slides[0].bracketIds[0] === 'inst-huey-177' && !rig.unsecuredParts.length && !rig.disconnectedIslands.length, JSON.stringify([rig.slides.length, rig.unsecuredParts.map((u) => u.label), rig.disconnectedIslands.length]));
  const bare = auditAssembly({ instances: pick(['inst-huey-177', 'inst-huey-138']) });
  check('a beam lying against a bracket with no rack on it makes no slide (the lips hold a rack, not a beam)', bare.slides.length === 0 && bare.disconnectedIslands.length === 1, JSON.stringify(bare.slides));
  const aside = auditAssembly({ instances: pick(['inst-huey-177', 'inst-huey-138', 'inst-huey-148', 'inst-huey-151']).map((i) => (i.instanceId === 'inst-huey-177' ? i : { ...i, position: [i.position[0], i.position[1], i.position[2] + 3] })) });
  check('a beam and its racks 3 mm aside of the channel make no slide', aside.slides.length === 0 && aside.clips.length === 2, JSON.stringify([aside.slides.length, aside.clips.length]));
}
{
  // Brackets pointing different ways on the same two assemblies lock them
  check('slides at 90° on the same assemblies lock; parallel and opposite ones do not', slidesLock([[0, 1, 0], [1, 0, 0]]) && !slidesLock([[0, 1, 0], [0, -1, 0], [0, 1, 0.01]]));
  const parts = ['K1', 'K2', 'B'].map((id) => ({ id, label: id, fastener: false, chain: false, motor: false, gear: null, rack: false }));
  const g = buildBodyGraph({ parts, seated: [], groups: [], meshes: [], chains: [], slides: [{ id: 's0', brackets: ['K1', 'K2'], beams: ['B'], racks: [], direction: [0, 1, 0], point: [0, 0, 0], limits: [0, 10], locked: true }] });
  check("  Play: a locked slide's beam is one body with its bracket, and says why", g.bodies.some((b) => b.parts.includes('K1') && b.parts.includes('B')) && !g.slideJoints.length && g.warnings.some((w) => /point different ways/.test(w.text)), JSON.stringify(g.warnings));
}

// --- 2.3 Idler pins ----------------------------------------------------------------------------------
for (const [pinId, gearLabel] of Object.entries(IDLER_PINS)) {
  const gear = huey.find((i) => i.label === gearLabel);
  const j = audit.joints.find((x) => x.instanceId === pinId);
  check(`Huey: ${gearLabel} on its 0x2 Idler Pin is held (not unsecured), the pin seated in it and its beam`, !unsecured.has(gear.instanceId) && j?.seatedIn.length === 2 && j.seatedIn.some((s) => s.instanceId === gear.instanceId) && !audit.halfSeatedFasteners.some((f) => f.instanceId === pinId), JSON.stringify(j?.seatedIn.map((s) => s.part)));
}
{
  const pin = inst('inst-huey-412');
  const gear = huey.find((i) => i.label === 'Drive: 228-2500-214-2');
  const beam = huey.find((i) => i.label === 'Drive: 228-2500-030-3');
  const plain = catalog.find((p) => p.name === '1x1 Connector Pin');
  const swapped = auditAssembly({ instances: [beam, gear, { ...pin, instanceId: 'plain-pin', partId: plain.id, label: '1x1 Connector Pin' }] });
  check("an ordinary 1x1 Connector Pin in a gear's centre hole doesn't hold the gear", swapped.unsecuredParts.some((u) => u.instanceId === gear.instanceId), JSON.stringify(swapped.joints.map((j) => j.seatedIn.map((s) => s.part))));
  const ok = auditAssembly({ instances: [beam, gear, pin] });
  check('  while the idler pin there does', !ok.unsecuredParts.some((u) => u.instanceId === gear.instanceId), JSON.stringify(ok.unsecuredParts.map((u) => u.label)));
  // Slid back 4.5 mm: its smooth end only 1.7 mm into the gear
  const axis = v3([0, 0, 1]).transformDirection(matOf(pin));
  const back = { ...pin, position: pin.position.map((v, k) => v - 4.5 * axis.getComponent(k)) };
  const short = auditAssembly({ instances: [beam, gear, back] });
  check("an idler pin whose smooth end is under 2 mm into the gear's centre doesn't hold it, and the gear is unsecured", short.unsecuredParts.some((u) => u.instanceId === gear.instanceId), JSON.stringify(short.joints.map((j) => j.seatedIn.map((s) => s.part))));
}

// --- 2.4 Audit wording -------------------------------------------------------------------------------
{
  const issues = auditIssues(audit);
  const note = issues.find((i) => i.kind === 'slide');
  check(`Huey's audit has the slide note: "${note?.title}"`, note?.level === 'note' && /^Elevator Middle Stage slides on Elevator Holder: \d+ mm up, \d+ mm down$/.test(note.title) && note.parts.length === 2, JSON.stringify(note));
  // (VEX's CAD has the lift gears' teeth in the racks' and other overlaps: those are listed as before)
  const held = issues.filter((i) => ['unsecured', 'island', 'floating', 'half-seated'].includes(i.kind) && i.parts.some((p) => stageIds.has(p.instanceId) || Object.values(IDLER_PINS).includes(p.label) || p.instanceId in IDLER_PINS));
  check('  and nothing about its racks, stage, idler gears or their pins not being held', held.length === 0, held.map((i) => i.title).join(' | '));
}

// --- 3. Play mode --------------------------------------------------------------------------------------
{
  const label = (id) => inst(id)?.label || id;
  const graph = buildBodyGraph(playInputs({ instances: huey }));
  const bodyOf = (id) => graph.bodies.find((b) => b.parts.includes(id))?.id;
  const STAGE = bodyOf('inst-huey-138');
  const HOLDER = bodyOf('inst-huey-177');
  const CARRIAGE = bodyOf(huey.find((i) => i.label === 'Claw Mount: 228-2500-014-1').instanceId);
  const lift = graph.slideJoints.filter((j) => !j.rope);
  check('Play: one lift slide, the Holder\'s body to the Middle Stage\'s, along world up', lift.length === 1 && lift[0].a === HOLDER && lift[0].b === STAGE && lift[0].direction[1] === 1, JSON.stringify(lift));
  check(`  its travel within 3 mm of the hand measurement (${lift[0]?.limits.join(' to ')} mm against ${-downHand} to ${upHand.toFixed(2)})`, near(lift[0].limits[1], upHand, 3) && near(-lift[0].limits[0], downHand, 3));
  const rackLinks = graph.links.filter((l) => l.kind === 'rack');
  check('  two rack links onto the stage\'s body, a 12 Tooth Gear\'s 6.35 mm a radian', rackLinks.length === 2 && rackLinks.every((l) => l.b === STAGE && near(Math.abs(l.mmPerRad), 6.35, 0.01)), JSON.stringify(rackLinks.map((l) => [l.a, l.b, l.mmPerRad])));
  const idlerGears = Object.values(IDLER_PINS).map((lab) => huey.find((i) => i.label === lab).instanceId);
  check('  each idler gear turns on a hinge of its own', idlerGears.every((id) => graph.hinges.some((h) => h.a === bodyOf(id) || h.b === bodyOf(id)) && graph.bodies.find((b) => b.id === bodyOf(id)).parts.length <= 2));
  const watched = new Set([...Object.keys(RACKS), ...stageIds, ...idlerGears, ...Object.keys(IDLER_PINS)]);
  const bad = graph.warnings.filter((w) => /isn't held|isn't joined/.test(w.text) && watched.has(w.partId));
  check('  no "isn\'t held" or "isn\'t joined" warning for its racks, stage or idler gears', bad.length === 0, bad.map((w) => w.text).join(' | '));
  const carriageJoint = graph.slideJoints.find((j) => j.rope);
  check('Carriage in its rails: the Claw Mount slides on the Middle Stage along world up (rope-and-spool 8.2)', carriageJoint?.a === STAGE && carriageJoint?.b === CARRIAGE && carriageJoint.direction[1] === 1 && carriageJoint.limits[1] > 100, JSON.stringify(carriageJoint));
  check('  and hangs on its ropes: roped, not loose (so the Play panel can ask for gravity)', graph.roped.includes(CARRIAGE) && !graph.loose.includes(CARRIAGE), JSON.stringify({ roped: graph.roped, loose: graph.loose }));

  // No physics: the stage follows the lift motor by a 12 Tooth Gear's turn on the rack, between its stops
  const motor = graph.motors.find((m) => m.label === 'Elevator Holder: 228-2560-1');
  {
    const k = createKinematic(graph);
    const y = () => k.deltas().get(STAGE).elements[13];
    for (let t = 0; t < 0.5 - 1e-9; t += 1 / 60) k.step(1 / 60, new Map([[motor.id, 1]]));
    const half = y();
    for (let t = 0; t < 8; t += 1 / 60) k.step(1 / 60, new Map([[motor.id, 1]]));
    const topY = y();
    for (let t = 0; t < 12; t += 1 / 60) k.step(1 / 60, new Map([[motor.id, -1]]));
    check(`No physics: half a second at full speed (one gear turn) raises the stage ${half.toFixed(2)} mm (39.9 ± 2), and it stops at its ends (${topY.toFixed(2)}, ${y().toFixed(2)} mm)`, near(half, 39.9, 2) && near(topY, lift[0].limits[1], 0.01) && near(y(), lift[0].limits[0], 0.01));
  }

  const byId = new Map(huey.map((i) => [i.instanceId, i]));
  const shapes = { points: (id) => getPartRawGeometry(partOf(byId.get(id))).attributes.position.array };
  const withMode = (mode) => huey.map((i) => (i.instanceId === motor.id ? { ...i, stopping: mode } : i));
  const physicsFor = async (mode, simulateGravity) => {
    const instances = withMode(mode);
    const g = buildBodyGraph(playInputs({ instances }));
    return createPhysics(g, instances, { points: (id) => getPartRawGeometry(partOf(instances.find((i) => i.instanceId === id))).attributes.position.array }, { simulateGravity });
  };
  const rig = (p) => {
    const y = (b) => p.deltas().get(b).elements[13];
    const tilt = (b) => {
      const q = new THREE.Quaternion().setFromRotationMatrix(p.deltas().get(b));
      return THREE.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(q.w))));
    };
    // Turns of each 12 Tooth Gear, counted step by step (the motor's own first)
    const gears = rackLinks;
    const turnOf = (l) => {
      const q = new THREE.Quaternion().setFromRotationMatrix(p.deltas().get(l.a));
      const a = new THREE.Vector3(...l.axisA).normalize();
      return 2 * Math.atan2(q.x * a.x + q.y * a.y + q.z * a.z, q.w);
    };
    let last = gears.map(turnOf);
    const turns = gears.map(() => 0);
    const step = (throttles) => {
      p.step(1 / 60, throttles);
      gears.forEach((l, i) => {
        const now = turnOf(l);
        turns[i] += ((((now - last[i] + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
        last[i] = now;
      });
    };
    const run = (seconds, throttles = new Map()) => {
      for (let t = 0; t < seconds - 1e-9; t += 1 / 60) step(throttles);
    };
    return { y, tilt, step, run, turns, gears };
  };
  const up = new Map([[motor.id, 1]]);
  const down = new Map([[motor.id, -1]]);
  // The gear the lift motor turns through its chain (the other side's gear follows the stage by its rack)
  const drivenGear = rackLinks.findIndex((l) => graph.links.some((c) => c.kind === 'chain' && (c.a === l.a || c.b === l.a)));

  {
    // Gravity off
    const p = await physicsFor('brake', false);
    const r = rig(p);
    r.run(1);
    check(`Stage at rest (gravity off): it stays where it is and level (${r.y(STAGE).toFixed(2)} mm, ${r.tilt(STAGE).toFixed(3)}°)`, Math.abs(r.y(STAGE)) < 0.1 && r.tilt(STAGE) < 0.01);
    r.run(0.25, up);
    const t0 = [...r.turns];
    const y0 = r.y(STAGE);
    let n = 0;
    while (Math.abs(r.turns[drivenGear] - t0[drivenGear]) < 2 * Math.PI && n++ < 300) r.step(up);
    const rise = r.y(STAGE) - y0;
    const other = (r.turns[1 - drivenGear] - t0[1 - drivenGear]) / (2 * Math.PI);
    check(`Huey's lift rises: one turn of the motor's 12 Tooth Gear raises the stage ${rise.toFixed(2)} mm (39.9 ± 2), the other side's gear turning with it (${other.toFixed(3)} turns), no tilt (${r.tilt(STAGE).toFixed(3)}°)`, near(rise, 39.9, 2) && near(Math.abs(other), 1, 0.03) && r.tilt(STAGE) < 0.2);
    r.run(0.25, down);
    const t1 = r.turns[drivenGear];
    const y1 = r.y(STAGE);
    n = 0;
    while (Math.abs(r.turns[drivenGear] - t1) < 2 * Math.PI && n++ < 300) r.step(down);
    const fall = r.y(STAGE) - y1;
    check(`Lift lowered: one turn back lowers it ${fall.toFixed(2)} mm (−39.9 ± 2)`, near(fall, -39.9, 2));
    // Gravity off, the ropes pull the carriage up (flung a little past, it coasts on: nothing slows it
    // but damping) and never down: lowering the stage, it doesn't come down with it, and the ropes go slack
    r.run(1, up);
    const [c2, s2] = [r.y(CARRIAGE), r.y(STAGE)];
    let lowest = c2;
    for (let t = 0; t < 0.5; t += 1 / 60) {
      r.step(down);
      lowest = Math.min(lowest, r.y(CARRIAGE));
    }
    const slack = p.ropeStates().map((x) => x.slackMm);
    check(`Gravity off: lowering the stage ${(s2 - r.y(STAGE)).toFixed(0)} mm doesn't bring the carriage down (lowest ${(lowest - c2).toFixed(2)} mm from where it was) and the ropes go slack (${slack.map((x) => x.toFixed(0)).join(', ')} mm)`, lowest - c2 > -1 && s2 - r.y(STAGE) > 30 && slack.every((x) => x > 20));
    p.dispose?.();
  }
  {
    // Huey's drive: through the 36 and 48 Tooth idler gears, front and back wheel on a side at twice the motor's speed
    const p = await physicsFor('brake', false);
    p.step(1 / 60, new Map());
    const wheels = huey.filter((i) => partOf(i)?.name === '200mm Travel Omni-Directional Wheel');
    for (const m of graph.motors.filter((x) => /^Drive/.test(x.label))) {
      for (let t = 0; t < 1; t += 1 / 60) p.step(1 / 60, new Map([[m.id, 1]]));
      const side = Math.sign(inst(m.id).position[2]);
      const rpm = wheels.filter((w) => Math.sign(w.position[2]) === side).map((w) => (p.spin(bodyOf(w.instanceId), [0, 0, 1]) * 60) / (2 * Math.PI));
      const motorRpm = Math.abs(p.status()[m.id].rpm);
      check(`Huey's drive: ${m.label} at ${motorRpm.toFixed(0)} rpm turns both wheels on its side at ${rpm.map((x) => x.toFixed(0)).join(' and ')} rpm (twice it, the same way round)`, rpm.length === 2 && rpm.every((x) => near(Math.abs(x), 2 * motorRpm, 0.05 * motorRpm)) && Math.sign(rpm[0]) === Math.sign(rpm[1]));
      for (let t = 0; t < 0.5; t += 1 / 60) p.step(1 / 60, new Map());
    }
    p.dispose?.();
  }
  {
    // Gravity on, Hold
    const p = await physicsFor('hold', true);
    const r = rig(p);
    r.run(1);
    r.run(1, up);
    const [s0, c0] = [r.y(STAGE), r.y(CARRIAGE)];
    r.run(0.5, up);
    const ratio = (r.y(CARRIAGE) - c0) / (r.y(STAGE) - s0);
    const tight = p.ropeStates().every((s) => s.slackMm < 0.5);
    check(`Huey's lift doubles the travel: with the ropes tight the carriage rises ${(r.y(CARRIAGE) - c0).toFixed(1)} mm while the stage rises ${(r.y(STAGE) - s0).toFixed(1)} (×${ratio.toFixed(2)})`, tight && near(ratio, 2, 0.1));
    r.run(1);
    const held = r.y(STAGE);
    r.run(3);
    check(`Lift held (Hold, gravity on): the stage stays within 1 mm over 3 s (moved ${(r.y(STAGE) - held).toFixed(2)} mm)`, Math.abs(r.y(STAGE) - held) <= 1);
    const carriageMass = graph.roped.reduce((m, b) => m + p.massOf(b), 0);
    const pulls = p.ropeStates().map((s) => s.tensionN);
    const half = (carriageMass * 9.81) / 2;
    check(`Two ropes on one body: each rope carries half the carriage's weight (${pulls.map((x) => x.toFixed(2)).join(' and ')} N against ${half.toFixed(2)} N), and it stays level (${r.tilt(CARRIAGE).toFixed(2)}°)`, pulls.length === 2 && pulls.every((x) => near(x, half, 0.1 * half)) && r.tilt(CARRIAGE) < 1);
    r.run(4, up);
    check(`Stops: driven up until it can go no further, the stage stops at ${r.y(STAGE).toFixed(2)} mm (the audit's ${slide.travelMm.forward}), the lift motor stalled`, near(r.y(STAGE), slide.travelMm.forward, 3) && p.status()[motor.id].stalled);
    r.run(0.5);
    const [s1, c1] = [r.y(STAGE), r.y(CARRIAGE)];
    r.run(1, down);
    const ratioDown = (r.y(CARRIAGE) - c1) / (r.y(STAGE) - s1);
    r.run(5, down);
    check(`Lift lowered (gravity on): the carriage comes down twice as far as the stage (×${ratioDown.toFixed(2)}), and the stage stops at its lower stop (${r.y(STAGE).toFixed(2)} mm)`, near(ratioDown, 2, 0.15) && near(r.y(STAGE), lift[0].limits[0], 0.5));
    p.dispose?.();
  }
  for (const mode of ['brake', 'coast']) {
    const p = await physicsFor(mode, true);
    const r = rig(p);
    r.run(1);
    r.run(1.5, up);
    const at = r.y(STAGE);
    r.run(2);
    const moved = r.y(STAGE) - at;
    if (mode === 'brake') check(`Brake lets the lift creep down (${moved.toFixed(1)} mm in 2 s from ${at.toFixed(0)} mm)`, moved < -2 && r.y(STAGE) > lift[0].limits[0] + 10);
    else check(`Coast lets it fall to its lower stop (${r.y(STAGE).toFixed(2)} mm)`, near(r.y(STAGE), lift[0].limits[0], 0.5));
    p.dispose?.();
  }
}
console.log(`      (Huey audit took ${auditMs} ms)`);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll linear motion checks passed');
process.exit(failures ? 1 : 0);
