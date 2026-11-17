/**
 * Checks ropes and spools (openspec rope-and-spool): rope and spool sizes from the models, winding
 * sums, the side a rope takes round a spot, the open path, stringing ropes on small builds,
 * `place_rope`, ropes following their parts, mirror, copy, the audit and saving.
 * Run: node scripts/check-ropes.mjs   (exits 1 on failure)
 */
import fs from 'node:fs';
import * as THREE from 'three';
import { getCatalog, partOf } from '../mcp/assembly-engine.mjs';
import { solveBandPath } from '../src/utils/bandPath.js';
import { ROPE_SPECS, SPOOL_SPECS, defaultTurn, turnForSide, endPlaces, ropeSpec, sagCurve, spoolSpec, suggestRope, turnsForLength, turnsPerLayer, turnsThatFit, woundLengthMm } from '../src/utils/ropePath.js';
import { copiedRope, followRopes, isRoutedRope, mirroredRope, repairRopes, ropePlacesOn, ropeReport, stringRope } from '../src/utils/ropeRoute.js';
import { normalizeShape, shapedPart, shapeMeshArrays } from '../src/utils/shapedParts.js';
import { placeRope } from '../src/engine/ropeRouting.js';
import { runAction } from '../src/engine/actions.js';
import { auditAssembly, mirrorSubassembly } from '../mcp/assembly-engine.mjs';
import { cloneSet } from '../src/utils/partGroups.js';
import { getPartRawGeometry, playInputs } from '../mcp/assembly-engine.mjs';
import { buildBodyGraph } from '../src/sim/bodyGraph.js';
import { createPhysics } from '../src/sim/physics.js';
import { kinematicNotes } from '../src/sim/kinematic.js';
import { createPlayRunner } from '../src/sim/playRunner.js';
import { starterById } from '../src/starters.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};
const { catalog } = getCatalog();
const byNumber = (pn) => catalog.find((p) => p.partNumber === pn);
const v3 = (a) => new THREE.Vector3(...a);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// --- 1. Part data ---
for (const [pn, spec] of Object.entries(ROPE_SPECS)) {
  const part = byNumber(pn);
  const holes = (part?.ports || []).filter((p) => p.type === 'pin_hole');
  const len = holes.length === 2 ? v3(holes[0].origin).distanceTo(v3(holes[1].origin)) : 0;
  check(`${spec.name}: two tab holes, ${spec.lengthMm} mm apart ((N − 1) × 12.7)`, part && part.ports.length === 2 && near(len, (spec.pitches - 1) * 12.7, 0.05) && near(ropeSpec(part).lengthMm, spec.lengthMm, 0.05), `${part?.ports.length} ports, ${len.toFixed(2)} mm`);
}
const spool2 = byNumber('228-2500-421');
const spool1 = byNumber('228-2500-420');
const s2 = spoolSpec(spool2);
check('2x Wide Spool: core 7.5 mm, flange 12.55 mm, drum about 21 mm, pocket at the +z end', near(s2.coreRadiusMm, 7.5, 0.05) && near(s2.flangeRadiusMm, 12.55, 0.02) && near(s2.drumSpanMm[1] - s2.drumSpanMm[0], 21, 0.5) && s2.pocket.center[2] > 5, JSON.stringify(spool2.spoolSpecs));
for (const sp of [spool1, spool2]) {
  const bore = sp.ports.find((p) => p.type === 'shaft_bore');
  check(`${sp.name} has a square shaft bore`, sp.ports.length === 1 && bore?.shape === 'square');
}
check("2x Wide Spool's square bore keeps the old hole's ids", spool2.ports[0].aliases?.includes('hole.+z.0_0_4') && spool2.ports[0].aliases?.includes('hole_1'));
const idler = byNumber('228-2500-1413');
check('.5x Pitch Idler Pulley: groove 3.2 mm, below its 5.5 mm rim', near(idler.gearSpecs.grooveRadiusMm, 3.15, 0.1));

// --- 2.1 Winding ---
check('2x spool holds 17 turns in a layer', turnsPerLayer(s2, 1.2) === 17, String(turnsPerLayer(s2, 1.2)));
const oneTurn = woundLengthMm(s2, 1.2, 1);
check('one first-layer turn is about 51 mm', near(oneTurn, 51, 1), oneTurn.toFixed(1));
const all120 = turnsForLength(s2, 1.2, ROPE_SPECS['228-2500-448'].lengthMm);
check('a 120x rope needs a second layer on the 2x spool', all120 > 17, `${all120} turns`);
check('turnsForLength is the inverse of woundLengthMm, a quarter turn below', near(turnsForLength(s2, 1.2, woundLengthMm(s2, 1.2, 1.25) + 5), 1.25, 1e-9) && turnsForLength(s2, 1.2, 67) === 1.25);
check('the 2x spool holds 4 layers', turnsThatFit(s2, 1.2) === 68, String(turnsThatFit(s2, 1.2)));
check('Choose for me: a 225 mm route to a spool takes the 24x rope', suggestRope(225, s2)?.partNumber === '228-2500-438');
check('Choose for me: a 225 mm route between pins takes the 20x rope', suggestRope(225)?.partNumber === '228-2500-436');

// --- 2.2a Side by default ---
const pulleyAt = { center: [0, 0, 0], axis: [0, 0, 1] };
const t1 = defaultTurn([-20, -80, 0], pulleyAt, [20, -80, 0]);
check('pin below, pulley, pin below: the rope goes over the top', t1 === -1, `turn ${t1}`);
check('a pulley tapped on its top takes the rope over the top, tapped underneath takes it under (the Rope builder)', turnForSide([-20, -80, 0], pulleyAt, [20, -80, 0], [0, 1, 0]) === t1 && turnForSide([-20, -80, 0], pulleyAt, [20, -80, 0], [0.3, -1, 0.4]) === -t1 && turnForSide([20, -80, 0], pulleyAt, [-20, -80, 0], [0, 1, 0]) === -t1);

// --- 2.2 Open path ---
const pt = (c) => ({ shape: 'point', center: c, axis: [0, 0, 1], span: [0, 0], kind: 'end' });
const groove = (c, r) => ({ shape: 'circle', kind: 'groove', center: c, axis: [0, 0, 1], radius: r, span: [-0.5, 0.5] });
const over = solveBandPath([pt([-20, -80, 0]), groove([0, 0, 0], 3.15), pt([20, -80, 0])], { open: true, turns: [0, -1, 0], thickMm: 1.2, widthMm: 1.2 });
const top = over.points.reduce((m, p) => Math.max(m, p.y), -Infinity);
const under = solveBandPath([pt([-20, -80, 0]), groove([0, 0, 0], 3.15), pt([20, -80, 0])], { open: true, turns: [0, 1, 0], thickMm: 1.2, widthMm: 1.2 });
check('open path: pin → groove → pin goes over the top, with no run back', top > 3 && over.lengthMm < 180 && over.lengthMm > 160, `${over.lengthMm.toFixed(1)} mm, top ${top.toFixed(2)}`);
check('flipping the turn takes the bottom of the groove, longer', under.lengthMm > over.lengthMm + 1, `${under.lengthMm.toFixed(1)} mm`);
// Huey's numbers (design Context): pin (238,66), pulley (235,231.6), pin (212.7,155.6), axis x
const hueyPts = [pt([57, 66, 238]), { ...groove([50.8, 231.6, 235], 3.15), axis: [1, 0, 0] }, pt([69.8, 155.6, 212.7])];
hueyPts[0].axis = [1, 0, 0];
hueyPts[2].axis = [1, 0, 0];
const hp = solveBandPath(hueyPts, { open: true, turns: [0, defaultTurn(hueyPts[0].center, hueyPts[1], hueyPts[2].center), 0], thickMm: 1.2, widthMm: 1.2 });
check("Huey's lift rope solves to about 270 mm (VEX's pieces)", near(hp.lengthMm, 255, 20), `${hp.lengthMm.toFixed(1)} mm`);
// Twelve grooves on three parts in a zigzag
const zig = [pt([0, -40, 0])];
const zturn = [0];
for (let k = 0; k < 12; k++) {
  zig.push(groove([k * 15, k % 2 ? -20 : 20, 0], 3.15));
  zturn.push(k % 2 ? 1 : -1);
}
zig.push(pt([12 * 15, -40, 0]));
zturn.push(0);
const zp = solveBandPath(zig, { open: true, turns: zturn, thickMm: 1.2, widthMm: 1.2 });
check('12 grooves in a zigzag solve, each wrapped on the turn given', zp && zp.contacts.slice(1, -1).every((c, k) => c.turn === zturn[k + 1] && c.wrapDeg > 10), zp ? `${zp.lengthMm.toFixed(1)} mm` : 'no path');
const twice = solveBandPath([pt([-30, -40, 0]), groove([0, 0, 0], 3.15), groove([30, -10, 0], 3.15), groove([0, 0, 0], 3.15), pt([-30, 40, 0])], { open: true, turns: [0, -1, 1, -1, 0], thickMm: 1.2, widthMm: 1.2 });
const r1 = Math.hypot(...twice.contacts[1].a.slice(0, 2));
const r3x = Math.hypot(...twice.contacts[3].a.slice(0, 2));
check('one groove named twice: the second pass lies beside or outside the first', Math.abs(r3x - r1) > 1 || Math.abs(twice.contacts[3].height - twice.contacts[1].height) >= 1.1, `r ${r1.toFixed(2)} / ${r3x.toFixed(2)}`);

// --- 2.5 Sag ---
const sag = sagCurve([0, 0, 0], [100, 0, 0], 22);
const sagLen = sag.reduce((s, p, k) => (k ? s + p.distanceTo(sag[k - 1]) : 0), 0);
check('a sagging curve is the run plus the slack long', near(sagLen, 122, 1), sagLen.toFixed(2));

// --- 3.1 Stringing ropes on small builds ---
const inst = (id, pn, position, rotation = [0, 0, 0], extra = {}) => ({ instanceId: id, partId: byNumber(pn).id, label: `${byNumber(pn).name} ${id}`, position, rotation, visible: true, ...extra });
// A winch: a 2x spool on a 4x shaft along z, a pin 220 mm above
const winch = [
  inst('shaft', '228-2500-120', [0, 0, 0]),
  inst('spool', '228-2500-421', [0, 0, 0]),
  inst('armpin', '228-2500-060', [0, 220, 0]),
  inst('rope', '228-2500-438', [100, 100, 0])
];
const wr = stringRope(winch[3], { ends: [{ instanceId: 'spool', feature: 'pocket' }, { instanceId: 'armpin', feature: 'post:pin' }], via: [] }, winch, partOf);
check('winch: rope strung from the spool pocket to a pin 220 mm away', !wr.error && near(wr.usedMm, 220, 4), wr.error || `${wr.usedMm?.toFixed(1)} mm used`);
check('winch: the spare is wound to the quarter turn below (about 1.25 turns)', !wr.error && wr.turns === turnsForLength(s2, 1.2, 292.1 - wr.usedMm) && wr.turns >= 1 && wr.turns <= 1.5, `${wr.turns} turns, ${wr.slackMm?.toFixed(1)} mm slack`);
const wrLess = stringRope(winch[3], { ends: [{ instanceId: 'spool', feature: 'pocket' }, { instanceId: 'armpin', feature: 'post:pin' }], via: [], spool: { turns: 0.25 } }, winch, partOf);
check('fewer turns: one turn of rope becomes slack', !wrLess.error && near(wrLess.slackMm - wr.slackMm, woundLengthMm(s2, 1.2, wr.turns) - woundLengthMm(s2, 1.2, 0.25), 2), wrLess.error || `${wrLess.slackMm.toFixed(1)} mm slack`);
const wrFlip = stringRope(winch[3], { ends: [{ instanceId: 'spool', feature: 'pocket' }, { instanceId: 'armpin', feature: 'post:pin' }], via: [], spool: { winding: -1 } }, winch, partOf);
check('flip winding: the rope leaves the drum from the other side', !wrFlip.error && Math.sign(wrFlip.contacts[0].a[0]) === -Math.sign(wr.contacts[0].a[0]) && Math.abs(wr.contacts[0].a[0]) > 5, `${wr.contacts[0].a[0].toFixed(2)} / ${wrFlip.contacts[0]?.a[0]?.toFixed(2)}`);
const len = (ps) => ps.reduce((s, p, k) => (k ? s + v3(p).distanceTo(v3(ps[k - 1])) : 0), 0);
const drawn = len(wr.shape.path.points);
check('the drawn path is the route plus what is wound (and the pocket-to-drum piece)', near(drawn, wr.usedMm + wr.woundMm + wr.slackMm, 12), `${drawn.toFixed(1)} vs ${(wr.usedMm + wr.woundMm + wr.slackMm).toFixed(1)}`);
const short = stringRope({ ...winch[3], partId: byNumber('228-2500-430').id }, { ends: [{ instanceId: 'spool', feature: 'pocket' }, { instanceId: 'armpin', feature: 'post:pin' }], via: [] }, winch, partOf);
check('a 12x rope is refused on a 220 mm route, naming the rope that fits', short.error && /24x Pitch Rope/.test(short.error), short.error);
const free = stringRope(winch[3], { ends: [{ instanceId: 'spool', feature: 'pocket' }, null], via: [], spool: { turns: 4 } }, winch, partOf);
const lastPt = free.shape?.path.points.at(-1);
check('free end: four turns wound, the rest hangs straight down from the drum', !free.error && free.turns === 4 && near(free.hangMm, 292.1 - woundLengthMm(s2, 1.2, 4), 1) && lastPt[1] + free.position[1] < -80, free.error || `${free.hangMm.toFixed(1)} mm hanging`);

// A lift: pin below, idler pulley above on a pin, pin below and to one side (axes along x)
const lift = [
  inst('pinA', '228-2500-060', [57, 66, 238], [0, 90, 0]),
  inst('pulleyPin', '228-2500-060', [50.8, 231.6, 235], [0, 90, 0]),
  inst('pulley', '228-2500-1413', [50.8 + 3.5, 231.6, 235], [0, 90, 0]),
  inst('pinB', '228-2500-060', [69.8, 155.6, 212.7], [0, 90, 0]),
  inst('rope', '228-2500-438', [0, 0, 0])
];
const lr = stringRope(lift[4], { ends: [{ instanceId: 'pinA', feature: 'post:pin' }, { instanceId: 'pinB', feature: 'post:pin' }], via: [{ instanceId: 'pulley', feature: 'groove' }] }, lift, partOf);
check('lift: rope over the pulley with the rest as slack', !lr.error && near(lr.usedMm, 262, 15) && near(lr.slackMm, 292.1 - lr.usedMm, 0.01), lr.error || `${lr.usedMm.toFixed(1)} used, ${lr.slackMm.toFixed(1)} slack`);
const lrTop = !lr.error && lr.via[0].turn === -1 && lr.shape.path.points.some((p) => p[1] + lr.position[1] > 231.6 + 3.5);
check('lift: the default side takes the top of the pulley', lrTop);
const lrFlip = stringRope(lift[4], { ends: lr.shape?.ends, via: [{ instanceId: 'pulley', feature: 'groove', turn: -lr.via[0].turn }] }, lift, partOf);
check('flip a side: the rope goes under the pulley and its used length grows', !lrFlip.error && lrFlip.usedMm > lr.usedMm + 1, lrFlip.error || `${lrFlip.usedMm.toFixed(1)} mm`);

// The rope's mesh
const derived = shapedPart(byNumber('228-2500-438'), wr.shape);
check('a routed rope is a derived part with no holes', derived.id.includes('~') && derived.ports.length === 0);

// --- end places and listing ---
check("a spool offers its pocket as an end, a pin its shank", endPlaces(spool2).some((p) => p.feature === 'pocket') && endPlaces(byNumber('228-2500-060')).some((p) => p.feature === 'post:pin'));
const placed = { ...winch[3], ...wr, shape: wr.shape };
const listed = ropePlacesOn([...winch.slice(0, 3), placed], ['spool'], partOf);
check('a pocket holding a rope is not offered', !listed.ends.some((e) => e.feature === 'pocket'));
check('a spool lists its drum', listed.spots.some((s) => s.feature === 'drum'));

// --- 3.2 place_rope ---
const winchState = { instances: winch.slice(0, 3) };
const pr = placeRope(winchState, { from: { instanceId: 'spool', feature: 'pocket' }, to: { instanceId: 'armpin', feature: 'post:pin' } });
check('place_rope: Choose for me puts a 24x rope from the spool to the pin, its spare wound', pr.ok && pr.size === '24x Pitch Rope' && pr.turns >= 1 && pr.record && /^Rope: 24x from /.test(pr.stepLabel), pr.error || `${pr.size}, ${pr.usedMm} used, ${pr.turns} turns, "${pr.stepLabel}"`);
const list = placeRope(winchState, { instanceId: 'spool', list: true });
check('place_rope with a spool and list: its pocket and drum, nothing changes', list.ok && !list.state && list.ends.some((e) => e.feature === 'pocket') && list.spots.some((x) => x.feature === 'drum'));
const tooShort = placeRope(winchState, { ropePartId: byNumber('228-2500-430').id, from: { instanceId: 'spool', feature: 'pocket' }, to: { instanceId: 'armpin', feature: 'post:pin' } });
check('place_rope: a 12x rope on a 220 mm route is refused naming the rope that fits', !tooShort.ok && !tooShort.state && /24x Pitch Rope/.test(tooShort.error), tooShort.error);
const dry = placeRope(winchState, { from: { instanceId: 'spool', feature: 'pocket' }, to: { instanceId: 'armpin', feature: 'post:pin' }, dryRun: true });
check('place_rope dryRun returns the path and changes nothing', dry.ok && dry.dryRun && dry.points.length > 10 && !dry.state);
// A beam across the straight line: the rope bends round it
const blocked = { instances: [...winch.slice(0, 3), inst('beam', '228-2500-005', [0, 110, 0], [0, 0, 0])] };
const bent = placeRope(blocked, { from: { instanceId: 'spool', feature: 'pocket' }, to: { instanceId: 'armpin', feature: 'post:pin' } });
check('round a part in the way: the rope bends round the beam and the beam is added as a bend', bent.ok && bent.bends.some((b) => b.instanceId === 'beam'), bent.error || JSON.stringify(bent.bends?.map((b) => b.label)));
if (bent.ok) {
  const a = auditAssembly(bent.state);
  const r = a.ropes.find((x) => x.instanceId === bent.instanceId);
  check('the bent rope passes through no part', r && r.through.length === 0, JSON.stringify(r?.through));
}
// Four pulleys, no sides given
const tackle = { instances: [inst('top', '228-2500-060', [70, 140, 0]), inst('end', '228-2500-060', [-30, 0, 0])] };
const pulleys = [];
for (let k = 0; k < 4; k++) {
  const id = `p${k}`;
  tackle.instances.push(inst(id, '228-2500-1413', [k * 15, k % 2 ? 40 : 100, 0]));
  pulleys.push({ instanceId: id, feature: 'groove' });
}
const tk = placeRope(tackle, { from: { instanceId: 'end', feature: 'post:pin' }, via: pulleys, to: { instanceId: 'top', feature: 'post:pin' }, ignoreInWay: true });
check('place_rope over four pulleys with no turn given: the reply lists the turn chosen at each', tk.ok && tk.via.length === 4 && tk.via.every((v) => v.turn === 1 || v.turn === -1), tk.error || JSON.stringify(tk.via));
{
  // The same route's length, summed by hand: straight runs between contacts, and each arc as the
  // groove's radius plus half the cord, times the angle wrapped
  const rope4 = tk.ok && tk.state.instances.find((i) => i.instanceId === tk.instanceId);
  const st4 = rope4 && stringRope(rope4, { ends: rope4.shape.ends, via: rope4.shape.via }, tackle.instances, partOf);
  const groove = byNumber('228-2500-1413').gearSpecs.grooveRadiusMm;
  let hand = 0;
  if (st4 && !st4.error) {
    const c = st4.contacts;
    for (let k = 0; k + 1 < c.length; k++) hand += v3(c[k].b).distanceTo(v3(c[k + 1].a));
    for (let k = 1; k + 1 < c.length; k++) hand += (groove + 0.6) * THREE.MathUtils.degToRad(c[k].wrapDeg);
  }
  check('four pulleys: all four grooves stay in order, and the used length is the hand sum of runs and arcs within 1 mm', st4 && !st4.error && st4.via.map((x) => x.instanceId).join() === 'p0,p1,p2,p3' && near(hand, st4.usedMm, 1), st4?.error || `${hand.toFixed(2)} vs ${st4?.usedMm?.toFixed(2)} mm`);
}

// The side a pulley is tapped on (the Rope builder), with the pulley as placed and turned half round
// so its own axis points the other way: the rope must lie on the tapped side either way
{
  const { partSpots, worldSpot } = await import('../src/utils/bandPath.js');
  const { buildWorldMatrix } = await import('../mcp/assembly-engine.mjs');
  for (const turnY of [0, 180]) {
    const parts = [inst('a', '228-2500-060', [-40, 100, 0]), inst('b', '228-2500-060', [40, 100, 0]), inst('p', '228-2500-1413', [0, 100, 0], [0, turnY, 0])];
    const groove = worldSpot(partSpots(byNumber('228-2500-1413')).find((x) => x.kind === 'groove'), buildWorldMatrix(parts[2].position, parts[2].rotation));
    const ys = {};
    for (const [name, side] of [['top', [0, 1, 0]], ['bottom', [0, -1, 0]]]) {
      const turn = turnForSide([-40, 100, 0], groove, [40, 100, 0], side);
      const res = placeRope({ instances: parts }, { ropePartId: byNumber('228-2500-430').id, from: { instanceId: 'a', feature: 'post:pin' }, via: [{ instanceId: 'p', feature: 'groove', turn }], to: { instanceId: 'b', feature: 'post:pin' }, dryRun: true, allowShort: true, ignoreInWay: true, turns: 0 });
      const near = res.ok ? res.points.filter((q) => Math.abs(q[0]) < 3).map((q) => q[1] - groove.center.y) : [];
      // (lowest and highest point of the rope at the pulley, from its middle; the slack hangs below either way)
      ys[name] = near.length ? [Math.min(...near), Math.max(...near)] : null;
    }
    check(`a pulley turned ${turnY}°: tapped on top the rope goes over it, tapped underneath it goes under`, ys.top && ys.bottom && ys.top[1] > 2 && ys.bottom[0] < -2 && ys.bottom[1] < 1, JSON.stringify(ys));
  }
}

// --- 3.3 Ropes follow their parts ---
if (pr.ok) {
  const st = pr.state;
  const rope0 = st.instances.find((i) => i.instanceId === pr.instanceId);
  const moved = runAction('fit_set', st, {}); // any action: nothing moves, nothing changes
  void moved;
  const pin30 = st.instances.map((i) => (i.instanceId === 'armpin' ? { ...i, position: [0, 250, 0] } : i));
  const f = followRopes(st.instances, pin30, partOf);
  const rope1 = f.instances.find((i) => i.instanceId === pr.instanceId);
  const offSpool = woundLengthMm(s2, 1.2, rope0.shape.spool.turns) - woundLengthMm(s2, 1.2, rope1.shape.spool.turns);
  check('arm moved 30 mm away: the rope follows and about 30 mm comes off the spool (slack first)', f.changed.includes(pr.instanceId) && offSpool > 15 && offSpool < 55 && rope1.shape.usedMm > rope0.shape.usedMm + 29, `${rope0.shape.spool.turns} → ${rope1.shape.spool.turns} turns, ${offSpool.toFixed(1)} mm off`);
  const far = st.instances.map((i) => (i.instanceId === 'armpin' ? { ...i, position: [0, 220 + 72 + 20 + 3, 0] } : i));
  const ff = followRopes(st.instances, far, partOf);
  const rope2 = ff.instances.find((i) => i.instanceId === pr.instanceId);
  check('moved too far: the rope stays on its route marked too short, and the audit lists it', rope2.shape.short > 5 && rope2.shape.spool.turns === 0 && auditAssembly({ instances: ff.instances }).ropes.some((r) => r.tooShortMm), `short by ${rope2.shape.short}`);
  const gone = st.instances.filter((i) => i.instanceId !== 'armpin');
  const fg = followRopes(st.instances, gone, partOf);
  const rope3 = fg.instances.find((i) => i.instanceId === pr.instanceId);
  check('pin removed: that end becomes free and the rope hangs from the spool', rope3.shape && rope3.shape.ends[1] === null && rope3.shape.hangMm > 50, JSON.stringify(rope3.shape?.ends));
  // Audit: the winch's rope isn't loose and nothing about it is an overlap
  const a = auditAssembly(st);
  const ropeIssue = a.collisions.some((c) => c.instanceId === pr.instanceId || c.collidingWith.includes(rope0.label)) || a.unsecuredParts.some((u) => u.instanceId === pr.instanceId);
  check('clean winch: the rope is not loose and not an overlap', !ropeIssue && a.ropes.length === 1, JSON.stringify(a.ropes));
  check('the spool on its shaft holds the rope end (no loose-pocket finding)', a.ropes[0] && !a.ropes[0].loosePocket);
  const noShaft = { instances: st.instances.filter((i) => i.instanceId !== 'shaft') };
  check('a rope end in a spool with no shaft is listed', auditAssembly(noShaft).ropes.some((r) => r.loosePocket));
  // 3.6 Saving: the shape survives a JSON round trip and draws the same
  const saved = JSON.parse(JSON.stringify(st));
  const back = saved.instances.find((i) => i.instanceId === pr.instanceId);
  check('saved and opened again: same ends, same turns', JSON.stringify(normalizeShape(back.shape)) === JSON.stringify(normalizeShape(rope0.shape)) && isRoutedRope(back));
  // 3.4 Copy: with its parts it stays routed on the copies; alone it is straight
  const copies = cloneSet(st.instances, st.instances.map((i) => i.instanceId), [0, 0, 50]);
  const ropeCopy = copies.find((c) => c.partId === rope0.partId);
  const ids = new Set(copies.map((c) => c.instanceId));
  check('duplicated with its parts: the copy is routed on the copied parts', isRoutedRope(ropeCopy) && [ropeCopy.shape.ends[0].instanceId, ropeCopy.shape.ends[1].instanceId].every((id) => ids.has(id)));
  check('copied alone: a straight rope', !isRoutedRope(copiedRope(rope0, new Map())));
  // Mesh: the rope draws with its tabs
  const part = byNumber('228-2500-438');
  const glb = await import('../mcp/assembly-engine.mjs').then((m) => m.getPartRawGeometry(part));
  const arrays = shapeMeshArrays(shapedPart(part, rope0.shape), glb.attributes.position.array, glb.attributes.normal?.array, glb.index?.array);
  check('a routed rope draws a cord and its tab(s)', arrays.idx.length > 1000 && arrays.pos.length > 3000, `${arrays.idx.length / 3} triangles`);
}

// --- 3.4 Mirror a lift ---
{
  const liftState = { instances: lift.slice(0, 4) };
  const lp = placeRope(liftState, { from: { instanceId: 'pinA', feature: 'post:pin' }, via: [{ instanceId: 'pulley', feature: 'groove' }], to: { instanceId: 'pinB', feature: 'post:pin' }, ignoreInWay: true });
  check('lift rope placed over the pulley', lp.ok && lp.via[0].turn === -1, lp.error || JSON.stringify(lp.via));
  if (lp.ok) {
    const ids = lp.state.instances.map((i) => i.instanceId);
    const m = mirrorSubassembly(lp.state, { instanceIds: ids, axis: 'x', planeOffsetMm: 0 });
    const mirRope = (m.mirroredInstances || []).find((i) => isRoutedRope(i) && i.instanceId !== lp.instanceId);
    const top = mirRope && mirRope.shape.path.points.some((p) => p[1] + mirRope.position[1] > 231.6 + 3.5);
    check('mirror a lift: the right side has its own rope, over the top of its pulley', Boolean(mirRope) && top && mirRope.shape.via[0].instanceId !== 'pulley', mirRope ? JSON.stringify(mirRope.shape.via) : JSON.stringify(Object.keys(m)));
  }
}

// --- 1.2 Both spools seat on a 4x Pitch Shaft by their square bore ---
for (const pn of ['228-2500-420', '228-2500-421']) {
  const a = auditAssembly({ instances: [inst('s', '228-2500-120', [0, 0, 0]), inst('sp', pn, [0, 0, 0])] });
  const joint = a.joints.find((j) => j.instanceId === 's');
  check(`${byNumber(pn).name} seats on a 4x Pitch Shaft`, joint?.seatedIn.some((x) => x.instanceId === 'sp'), JSON.stringify(joint?.seatedIn));
}

// --- 2.4 The drawn path is the route plus what is wound (without the pocket-to-drum piece) ---
for (const [pn, turns] of [['228-2500-438', 0], ['228-2500-438', 1.25], ['228-2500-448', 20]]) {
  const r = stringRope({ ...winch[3], partId: byNumber(pn).id }, { ends: [{ instanceId: 'spool', feature: 'pocket' }, { instanceId: 'armpin', feature: 'post:pin' }], via: [], spool: { turns } }, winch, partOf);
  const drawnMm = len(r.shape.path.points.slice(1));
  check(`drawn length = route + wound + slack within 1 mm at ${turns} turns`, !r.error && r.turns === turns && Math.abs(drawnMm - (r.usedMm + r.woundMm + r.slackMm)) <= 1, r.error || `${drawnMm.toFixed(2)} vs ${(r.usedMm + r.woundMm + r.slackMm).toFixed(2)}`);
}

// --- 3.6 A saved rope naming a part that isn't there ---
if (pr.ok) {
  const missingPin = pr.state.instances.filter((i) => i.instanceId !== 'armpin');
  const fixed = repairRopes(missingPin, partOf);
  const r = fixed.instances.find((i) => i.instanceId === pr.instanceId);
  check('opened with its end part missing: that end is free, with a message', r?.shape?.ends[1] === null && fixed.messages.length === 1, JSON.stringify(fixed.messages));
  const none = repairRopes(pr.state.instances.filter((i) => i.instanceId !== 'spool' && i.instanceId !== 'armpin'), partOf);
  check('opened with both end parts missing: a straight rope, with a message', !none.instances.find((i) => i.instanceId === pr.instanceId).shape && none.messages.length === 1);
  check('a build whose ropes are whole opens unchanged', repairRopes(pr.state.instances, partOf).instances === pr.state.instances);
}

// --- 7.1 Ropes that pull on nothing ---
{
  const one = { instances: [inst('plate', '228-2500-043', [0, 0, 0]), inst('pa', '228-2500-060', [-44.45, -19.05, 3.05], [-180, 0, 0]), inst('pb', '228-2500-060', [44.45, 19.05, 3.05], [-180, 0, 0])] };
  const r = placeRope(one, { from: { instanceId: 'pa', feature: 'post:pin' }, to: { instanceId: 'pb', feature: 'post:pin' }, ignoreInWay: true, allowShort: true });
  const g1 = r.ok ? buildBodyGraph(playInputs(r.state)) : null;
  check('Play: a rope with both ends on one rigid body pulls on nothing', g1?.ropes.length === 1 && !g1.ropes[0].pulls, r.error || JSON.stringify(g1?.ropes[0]?.bodies));
  const fr = placeRope({ instances: winch.slice(0, 3) }, { from: { instanceId: 'spool', feature: 'pocket' }, turns: 4 });
  const g2 = fr.ok ? buildBodyGraph(playInputs(fr.state)) : null;
  check('Play: a rope with a free end pulls on nothing', g2?.ropes.length === 1 && g2.ropes[0].free && !g2.ropes[0].pulls, fr.error || '');
}

// --- 10.1 The Ratchet winch starter's rope ---
{
  const rw = starterById('ratchet-winch').build(catalog);
  const rope = rw.find((i) => isRoutedRope(i));
  const spool = rw.find((i) => byNumber('228-2500-421').id === i.partId);
  const a = auditAssembly({ instances: rw });
  const r = a.ropes[0];
  check('Ratchet winch starter: its rope has one end in the spool pocket, is wound, and its other end hangs free', rope && rope.shape.ends[0]?.instanceId === spool.instanceId && rope.shape.ends[0].feature === 'pocket' && rope.shape.ends[1] === null && rope.shape.spool.turns === 4 && r && !r.loosePocket && r.through.length === 0, JSON.stringify(r));
}

// --- 7. Play: the Rope winch starter (a motor winds a rope that pulls an arm against a belt) ---
{
  const instances = starterById('rope-winch').build(catalog);
  const audit = auditAssembly({ instances });
  check('Rope winch starter: sound, its rope wound on the spool and ending on the arm', audit.isMechanicallySound && audit.ropes.length === 1 && audit.ropes[0].turns > 1, JSON.stringify({ sound: audit.isMechanicallySound, ropes: audit.ropes, half: audit.halfSeatedFasteners.map((f) => f.label), col: audit.collisions }));
  const g = buildBodyGraph(playInputs({ instances }));
  const rope = g.ropes[0];
  check('Play: the rope is no body, and pulls the spool and the arm (two bodies)', g.ropes.length === 1 && rope.pulls && !g.bodies.some((b) => b.parts.includes(rope.id)) && rope.spool?.body && rope.spool.body !== rope.bodies.at(-1), JSON.stringify(rope?.bodies));
  check('Play without physics lists "ropes don\'t pull without physics"', kinematicNotes(g).some((n) => /ropes don't pull without physics/.test(n.text)));
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const phys = await createPhysics(g, instances, { points: (pid) => getPartRawGeometry(partOf(byId.get(pid))).attributes.position.array });
  const motor = g.motors[0];
  const arm = rope.bodies.at(-1);
  const armTurn = () => {
    const q = new THREE.Quaternion().setFromRotationMatrix(phys.deltas().get(arm));
    return (2 * Math.atan2(q.z, q.w) * 180) / Math.PI;
  };
  const run = (secs, throttles) => {
    for (let i = 0; i < Math.round(secs * 60); i++) phys.step(1 / 60, throttles);
  };
  const st = () => phys.ropeStates()[0];
  const t0 = st().turns;
  run(0.6, new Map([[motor.id, 1]]));
  const wound = st();
  const swung = armTurn();
  check('winding pulls the arm: the coils grow and the arm swings toward the spool, the rope tight', wound.turns > t0 + 0.5 && swung > 20 && wound.tensionN > 0.2 && wound.slackMm < 0.5, `turns ${t0} → ${wound.turns.toFixed(2)}, arm ${swung.toFixed(1)}°, ${wound.tensionN.toFixed(2)} N`);
  run(1.4, new Map([[motor.id, 1]]));
  const full = st();
  const heldAt = armTurn();
  run(0.5, new Map([[motor.id, 1]]));
  check('fully wound: the arm meets the spool, the motor stalls and holds it there', phys.status()[motor.id].stalled && Math.abs(armTurn() - heldAt) < 1 && full.turns > wound.turns, `arm ${heldAt.toFixed(1)}° → ${armTurn().toFixed(1)}°, ${full.turns.toFixed(2)} turns`);
  const stopAt = armTurn();
  const stopTurns = st().turns;
  run(0.4, new Map());
  check('motor stops with no ratchet: the stopped motor holds the spool and the arm stays', Math.abs(st().turns - stopTurns) < 0.1 && Math.abs(armTurn() - stopAt) < 3, `${stopTurns.toFixed(2)} → ${st().turns.toFixed(2)} turns, arm ${stopAt.toFixed(1)}° → ${armTurn().toFixed(1)}°`);
  run(0.6, new Map([[motor.id, -1]]));
  check('  run in reverse: the belt pulls the arm back and the spool pays the rope out', st().turns < full.turns - 0.5 && armTurn() < heldAt - 30, `${full.turns.toFixed(2)} → ${st().turns.toFixed(2)} turns, arm ${armTurn().toFixed(1)}°`);
  // The redraw: the rope follows its spool and arm every frame and is put back on leaving Play
  const meshes = new Map();
  const ropeMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  ropeMesh.userData.isPartMesh = true;
  const group = new THREE.Group();
  group.add(ropeMesh);
  meshes.set(rope.id, group);
  const runner = createPlayRunner(g, instances, phys);
  const saved = ropeMesh.geometry;
  runner.frame(meshes, 0);
  runner.frame(meshes, 50);
  check('Play redraws the rope each frame from its parts and turns', ropeMesh.geometry !== saved && ropeMesh.geometry.attributes.position?.count > 100);
  runner.dispose();
  check('leaving Play puts the rope back as it was in the build', ropeMesh.geometry === saved);
}

// --- 7.2 / 7.4 / 8 Rigs: a weight hanging on a rope (R1) and on a moving pulley (R4), gravity on ---
{
  const frame = (zFrame) => [inst('frame', '228-2500-009', [0, 0, zFrame]), ...[-57.15, -31.75, -19.05, 0, 19.05, 31.75, 57.15].map((x, k) => inst(`fp${k}`, '228-2500-060', [x, 0, zFrame + 3.05]))];
  // A balanced load: two 1x5 beams on three long pins, the rope's tab between them
  const block = (y, upright) => (upright
    ? [inst('beamA', '228-2500-004', [0, y - 25.4, 3.05], [0, 0, 90]), inst('bp', '228-2500-061', [0, y, 0]), inst('beamB', '228-2500-004', [0, y - 25.4, -9.4], [0, 0, 90]), inst('bp2', '228-2500-061', [0, y - 25.4, 0]), inst('bp3', '228-2500-061', [0, y - 50.8, 0])]
    : [inst('beamA', '228-2500-004', [0, y, 3.05]), inst('bp', '228-2500-061', [0, y, 0]), inst('beamB', '228-2500-004', [0, y, -9.4]), inst('bp2', '228-2500-061', [25.4, y, 0]), inst('bp3', '228-2500-061', [-25.4, y, 0])]);
  const runRig = async (parts, rope, ropePn = '228-2500-430') => {
    const placed = placeRope({ instances: parts }, { ...rope, ropePartId: byNumber(ropePn).id, ignoreInWay: true, allowShort: true });
    if (!placed.ok) return { error: placed.error };
    const instances = placed.state.instances;
    const g = buildBodyGraph(playInputs({ instances }));
    const byIdR = new Map(instances.map((i) => [i.instanceId, i]));
    const phys = await createPhysics(g, instances, { points: (pid) => getPartRawGeometry(partOf(byIdR.get(pid))).attributes.position.array }, { simulateGravity: true });
    phys.step(1 / 60, new Map());
    const mass = g.roped.reduce((sum, id) => sum + phys.massOf(id), 0);
    const samples = [];
    let stepMs = 0;
    for (let t = 1; t <= 600; t++) {
      const t0 = performance.now();
      phys.step(1 / 60, new Map());
      stepMs += performance.now() - t0;
      const st = phys.ropeStates()[0];
      samples.push({ t: t / 60, T: st.tensionN, path: st.pathMm, speed: Math.max(...g.roped.map((id) => phys.speedOf(id))) });
    }
    return { g, mass, samples, phys, stepMs: stepMs / 600, rope: placed };
  };
  const after = (samples, from) => samples.filter((x) => x.t >= from);
  const avg = (list, k) => list.reduce((sum, x) => sum + x[k], 0) / list.length;
  const maxOf = (list, k) => Math.max(...list.map((x) => x[k]));

  const r1 = await runRig([...frame(-8.525), ...block(-139.7 + 10, false)], { from: { instanceId: 'fp3', feature: 'post:pin', at: 2.3 }, to: { instanceId: 'bp', feature: 'post:pin', at: -3.175 } });
  if (r1.error) check('R1 rig built', false, r1.error);
  else {
    check('R1: a part held only by a rope is roped, not loose, and the rope pulls', r1.g.roped.length === 1 && r1.g.loose.length === 0 && r1.g.ropes[0].pulls && !r1.g.warnings.some((w) => /isn't joined/.test(w.text)), JSON.stringify({ roped: r1.g.roped, loose: r1.g.loose }));
    const settled = after(r1.samples, 1);
    const ratio = avg(settled, 'T') / (r1.mass * 9.81);
    check('R1: dropped 10 mm onto its rope, it hangs: pull = weight within 5% after 1 s', Math.abs(ratio - 1) < 0.05, `pull/weight ${ratio.toFixed(3)}`);
    check('R1: the path stays within 0.5 mm of the rope length', settled.every((x) => Math.abs(x.path - 139.7) < 0.5), `${Math.min(...settled.map((x) => x.path)).toFixed(2)}–${maxOf(settled, 'path').toFixed(2)} mm`);
    check('R1: over 10 s nothing gains speed by itself', maxOf(after(r1.samples, 8), 'speed') <= maxOf(after(r1.samples, 1).filter((x) => x.t < 4), 'speed') * 1.2 + 0.005, `${maxOf(after(r1.samples, 8), 'speed').toFixed(4)} m/s at the end`);
  }

  const L = 55;
  const r4 = await runRig([...frame(-8.525), ...block(-L, true), inst('pulley', '228-2500-1413', [0, -L, -3.175])], { from: { instanceId: 'fp1', feature: 'post:pin', at: 2.3 }, via: [{ instanceId: 'pulley', feature: 'groove' }], to: { instanceId: 'fp5', feature: 'post:pin', at: 2.3 } });
  if (r4.error) check('R4 rig built', false, r4.error);
  else {
    check('R4: the idler pulley spinning on its pin passes the pull on to the block it is in', r4.g.ropes[0].bodies[1] !== r4.g.ropes[0].riders[1] && r4.g.ropes[0].riders[1]);
    const settled = after(r4.samples, 2);
    // Two runs from the frame pins (31.75 mm out) to the groove's sides (3.8 mm), down to the block
    const d = r4.phys.deltas().get(r4.g.ropes[0].bodies[1]);
    const c = new THREE.Vector3(0, -L, -3.175).applyMatrix4(d);
    const cosA = Math.abs(c.y) / Math.hypot(31.75 - 3.77, c.y);
    const ratio = avg(settled, 'T') / ((r4.mass * 9.81) / (2 * cosA));
    check('R4: a moving pulley halves the pull (along the runs) within 5%', Math.abs(ratio - 1) < 0.05, `pull / (weight / 2cos) ${ratio.toFixed(3)}`);
    check('R4: the path stays within 0.5 mm of the rope length', settled.every((x) => Math.abs(x.path - 139.7) < 0.5), `${Math.min(...settled.map((x) => x.path)).toFixed(2)}–${maxOf(settled, 'path').toFixed(2)} mm`);
  }

  // R5: a four-run tackle. Two pulleys on the hanging block, one on the frame between them
  {
    const flatBlock = (y) => [inst('beamA', '228-2500-004', [0, y, 3.05]), inst('bp', '228-2500-061', [0, y, 0]), inst('beamB', '228-2500-004', [0, y, -9.4]), inst('bp2', '228-2500-061', [25.4, y, 0]), inst('bp3', '228-2500-061', [-25.4, y, 0])];
    const D = 50;
    const r5 = await runRig(
      [...frame(-8.525), ...flatBlock(-D), inst('pl', '228-2500-1413', [-25.4, -D, -3.175]), inst('pr', '228-2500-1413', [25.4, -D, -3.175]), inst('pt', '228-2500-1413', [0, 0, -3.175])],
      { from: { instanceId: 'fp1', feature: 'post:pin', at: 2.3 }, via: [{ instanceId: 'pl', feature: 'groove' }, { instanceId: 'pt', feature: 'groove' }, { instanceId: 'pr', feature: 'groove' }], to: { instanceId: 'fp5', feature: 'post:pin', at: 2.3 } },
      '228-2500-436'
    );
    if (r5.error) check('R5 rig built', false, r5.error);
    else {
      const settled = after(r5.samples, 2);
      // Four runs hold the block: two from the frame pins (6.35 mm out from the block's pulleys, less
      // the groove) and two to the frame's pulley (25.4 mm in, less two grooves)
      const drop = Math.abs(new THREE.Vector3(0, -D, 0).applyMatrix4(r5.phys.deltas().get(r5.g.roped.find((id) => r5.phys.massOf(id) > 0.004))).y);
      const cosOut = drop / Math.hypot(6.35 - 3.77, drop);
      const cosIn = drop / Math.hypot(25.4 - 2 * 3.77, drop);
      const ratio = avg(settled, 'T') / ((r5.mass * 9.81) / (2 * cosOut + 2 * cosIn));
      // (the block rocks on its two frictionless pulleys and doesn't settle, as the two-rope block does:
      // the pull is judged on its mean, the path on its middle value)
      const paths = settled.map((x) => x.path).sort((a, b) => a - b);
      check('R5: four runs carry the block, so the mean pull is about a quarter of its weight (along the runs) within 8%', r5.g.ropes[0].pulls && Math.abs(ratio - 1) < 0.08, `pull / (weight / sum of cos) ${ratio.toFixed(3)}, pull/weight ${(avg(settled, 'T') / (r5.mass * 9.81)).toFixed(3)}`);
      check('R5: the path is the rope length within 0.5 mm half the time or more, and never more than 5 mm over', Math.abs(paths[Math.floor(paths.length / 2)] - 241.3) < 0.5 && Math.abs(paths[Math.floor(paths.length / 4)] - 241.3) < 0.5 && paths.at(-1) < 246.3, `${paths[0].toFixed(2)}–${paths.at(-1).toFixed(2)} mm, middle ${paths[Math.floor(paths.length / 2)].toFixed(2)}`);
      check('R5: a whole physics step with a rope over three pulleys takes under 1 ms', r5.stepMs < 1, `${r5.stepMs.toFixed(2)} ms a step of 1/60 s`);
    }
  }

  // Two ropes on one body (a stand-in for R8 until the Huey fixture): a block on two 12x ropes
  {
    const flat = (y) => [inst('beamA', '228-2500-004', [0, y, 3.05]), inst('bp', '228-2500-061', [0, y, 0]), inst('beamB', '228-2500-004', [0, y, -9.4]), inst('bp2', '228-2500-061', [25.4, y, 0]), inst('bp3', '228-2500-061', [-25.4, y, 0])];
    const runRopes = async (parts, ropes, secs) => {
      let instances = parts;
      for (const r of ropes) {
        const placed = placeRope({ instances }, { ...r, ropePartId: byNumber('228-2500-430').id, ignoreInWay: true, allowShort: true });
        if (!placed.ok) return { error: placed.error };
        instances = placed.state.instances;
      }
      const g = buildBodyGraph(playInputs({ instances }));
      const byIdR = new Map(instances.map((i) => [i.instanceId, i]));
      const phys = await createPhysics(g, instances, { points: (pid) => getPartRawGeometry(partOf(byIdR.get(pid))).attributes.position.array }, { simulateGravity: true });
      phys.step(1 / 60, new Map());
      const mass = g.roped.reduce((sum, id) => sum + phys.massOf(id), 0);
      const samples = [];
      for (let t = 1; t <= secs * 60; t++) {
        phys.step(1 / 60, new Map());
        samples.push({ t: t / 60, ropes: phys.ropeStates().map((x) => ({ T: x.tensionN, path: x.pathMm, slack: x.slackMm })) });
      }
      return { g, mass, samples };
    };
    const two = await runRopes([...frame(-8.525), ...flat(-130)], [
      { from: { instanceId: 'fp1', feature: 'post:pin', at: 2.3 }, to: { instanceId: 'bp3', feature: 'post:pin', at: -3.175 } },
      { from: { instanceId: 'fp5', feature: 'post:pin', at: 2.3 }, to: { instanceId: 'bp2', feature: 'post:pin', at: -3.175 } }
    ], 4);
    if (two.error) check('two-rope rig built', false, two.error);
    else {
      const settled = two.samples.filter((x) => x.t >= 1);
      const share = [0, 1].map((k) => settled.reduce((sum, x) => sum + x.ropes[k].T, 0) / settled.length / (two.mass * 9.81));
      check('two ropes on one body: each carries half its weight within 10%', share.every((x) => Math.abs(x - 0.5) < 0.05), share.map((x) => x.toFixed(3)).join(' / '));
      const paths = settled.flatMap((x) => x.ropes.map((r) => r.path));
      check('  both paths stay within 0.5 mm of the rope length, and neither goes slack', paths.every((x) => Math.abs(x - 139.7) < 0.5) && settled.every((x) => x.ropes.every((r) => r.slack < 0.2 && r.T > 0)), `${Math.min(...paths).toFixed(2)}–${Math.max(...paths).toFixed(2)} mm`);
    }
    // A part hanging on one pin under the part the rope holds: its weight comes through the pin
    const y = -130;
    const hook = await runRopes([...frame(-8.525), ...flat(y), inst('hookpin', '228-2500-060', [12.7, y, 6.1]), inst('hook', '228-2500-004', [12.7, y - 25.4, 9.15], [0, 0, 90])], [
      { from: { instanceId: 'fp3', feature: 'post:pin', at: 2.3 }, to: { instanceId: 'bp', feature: 'post:pin', at: -3.175 } }
    ], 4);
    if (hook.error) check('hook rig built', false, hook.error);
    else {
      check('hook rig: the hook swings on its own pin, both held by the rope', hook.g.roped.length === 2 && hook.g.hinges.length === 1, JSON.stringify({ roped: hook.g.roped, hinges: hook.g.hinges.length }));
      const settled = hook.samples.filter((x) => x.t >= 1);
      const paths = settled.map((x) => x.ropes[0].path);
      check('  the path stays within 0.5 mm of the rope length though the hook swings', paths.every((x) => Math.abs(x - 139.7) < 0.5), `${Math.min(...paths).toFixed(2)}–${Math.max(...paths).toFixed(2)} mm`);
      const mean = settled.reduce((sum, x) => sum + x.ropes[0].T, 0) / settled.length / (hook.mass * 9.81);
      check('  on average the rope carries both parts\' weight within 10%', Math.abs(mean - 1) < 0.1, `pull/weight ${mean.toFixed(3)}`);
    }
  }
}

// --- Stopping modes (openspec motor-stopping) on the Rope winch: its belt pulls the arm back ---
{
  const runWinch = async (mode) => {
    const instances = starterById('rope-winch').build(catalog).map((i) => (i.stopping ? { ...i, stopping: mode } : i));
    const g = buildBodyGraph(playInputs({ instances }));
    const byIdW = new Map(instances.map((i) => [i.instanceId, i]));
    const phys = await createPhysics(g, instances, { points: (pid) => getPartRawGeometry(partOf(byIdW.get(pid))).attributes.position.array });
    const motor = g.motors[0];
    const hinge = g.hinges.find((h) => h.id === motor.hinge);
    const arm = g.ropes[0].bodies.at(-1);
    const turnOf = (body, axis) => {
      const q = new THREE.Quaternion().setFromRotationMatrix(phys.deltas().get(body));
      return (2 * Math.atan2(new THREE.Vector3(q.x, q.y, q.z).dot(new THREE.Vector3(...axis)), q.w) * 180) / Math.PI;
    };
    const run = (secs, th = new Map()) => {
      for (let i = 0; i < Math.round(secs * 60); i++) phys.step(1 / 60, th);
    };
    run(0.6, new Map([[motor.id, 1]]));
    return { g, phys, motor, hinge, arm, run, armTurn: () => turnOf(arm, [0, 0, 1]), shaftTurn: () => turnOf(hinge.b, hinge.axis) };
  };
  const back = {};
  for (const mode of ['coast', 'brake', 'hold']) {
    const w = await runWinch(mode);
    const at = w.armTurn();
    w.run(2);
    back[mode] = at - w.armTurn();
  }
  check('Coast: released, the belt pulls the arm back (more than 25° in 2 s)', back.coast > 25, `${back.coast.toFixed(1)}°`);
  check('Brake: the arm creeps back, at least 2° but under a quarter as far as Coast', back.brake > 2 && back.brake < back.coast / 4, `${back.brake.toFixed(1)}° (coast ${back.coast.toFixed(1)}°)`);
  check('Hold: the arm stays where it stopped (within 0.5°)', Math.abs(back.hold) < 0.5, `${back.hold.toFixed(2)}°`);
  {
    // Hold through the rope (the way a held winch is loaded): twisting the arm against the rope pulls on
    // the held spool. Below stall torque it holds; a hard knock past it pulls rope off, and let go, the
    // motor winds back to where it stopped
    const w = await runWinch('hold');
    w.run(0.5);
    const pivot = [44.45, -6.35, 0];
    const a0 = w.armTurn();
    const s0 = w.shaftTurn();
    for (let k = 1; k <= 12; k++) {
      w.phys.pull(w.arm, [0, 0, 1], pivot, (-0.5 * k) / 12);
      w.run(1 / 60);
    }
    w.run(1);
    const under = w.armTurn() - a0;
    w.phys.pull(w.arm, [0, 0, 1], pivot, -6);
    w.run(0.1);
    w.phys.pull(w.arm, [0, 0, 1], pivot, 0);
    const knocked = w.shaftTurn() - s0;
    w.run(1.5);
    check('Hold: twisting the arm against the rope with 0.5 N·m, the held spool lets it move under 2°', Math.abs(under) < 2, `${under.toFixed(2)}°`);
    check('Hold: a hard knock past stall torque pulls rope off the spool; let go, the motor winds back to where it stopped (within 3°)', Math.abs(knocked) > 10 && Math.abs(w.shaftTurn() - s0) < 3, `knocked ${knocked.toFixed(0)}°, then ${(w.shaftTurn() - s0).toFixed(1)}°`);
  }
  {
    // A mode change in a running sim takes effect at once: coasting back, switched to Hold, it stops
    const w = await runWinch('coast');
    w.run(0.5);
    w.phys.setStopping(w.motor.id, 'hold');
    w.run(0.2);
    const at = w.armTurn();
    w.run(1);
    check('setStopping: a coasting arm switched to Hold stops where it is', Math.abs(w.armTurn() - at) < 1, `${at.toFixed(1)}° → ${w.armTurn().toFixed(1)}°`);
  }
}

// --- 8 The Rope lift starter: a weight held only by its rope, lifted by the winch ---
{
  const instances = starterById('rope-lift').build(catalog);
  const audit = auditAssembly({ instances });
  check('Rope lift starter: sound (the weight hanging on the rope is not an island)', audit.isMechanicallySound && audit.disconnectedIslands.length === 0, JSON.stringify({ islands: audit.disconnectedIslands, ropes: audit.ropes }));
  const g = buildBodyGraph(playInputs({ instances }));
  check('Play: the weight is held by its rope, not listed as loose', g.roped.length === 1 && g.loose.length === 0 && !g.warnings.length, JSON.stringify({ roped: g.roped, loose: g.loose, w: g.warnings }));
  const byIdL = new Map(instances.map((i) => [i.instanceId, i]));
  const phys = await createPhysics(g, instances, { points: (pid) => getPartRawGeometry(partOf(byIdL.get(pid))).attributes.position.array }, { simulateGravity: true });
  const motor = g.motors[0].id;
  // The height of the weight's top pin, where the rope is tied on
  const pinAt = instances.find((i) => i.label === 'Weight Top Pin').position;
  const y = () => new THREE.Vector3(...pinAt).applyMatrix4(phys.deltas().get(g.roped[0])).y - pinAt[1];
  const run = (secs, th) => {
    for (let i = 0; i < Math.round(secs * 60); i++) phys.step(1 / 60, th);
  };
  const turns0 = phys.ropeStates()[0].turns;
  run(1, new Map());
  const hung = y();
  check('gravity on, motor idle: the weight settles onto its rope and the idle motor holds it (the spool barely pays out)', hung < 0 && hung > -6 && Math.abs(phys.ropeStates()[0].turns - turns0) < 0.1, `${hung.toFixed(1)} mm, ${turns0.toFixed(2)} → ${phys.ropeStates()[0].turns.toFixed(2)} turns`);
  run(1, new Map([[motor, 1]]));
  const up = y();
  check('running the motor winds the rope and lifts the weight', up > hung + 40 && phys.ropeStates()[0].tensionN > 0, `${hung.toFixed(1)} → ${up.toFixed(1)} mm`);
  run(1.5, new Map([[motor, 1]]));
  const top = y();
  run(0.5, new Map([[motor, 1]]));
  check('fully wound: the weight meets the spool and the stalled motor holds it', phys.status()[motor].stalled && Math.abs(y() - top) < 3, `${top.toFixed(1)} → ${y().toFixed(1)} mm`);
  run(1, new Map([[motor, -1]]));
  check('reversing lets the weight down (wound right up, the weight against the spool, it backs out)', y() < top - 30, `${y().toFixed(1)} mm`);
  check('the weight lowering does not drive the motor past its top speed (it brakes)', Math.abs(phys.status()[motor].rpm) < 130, `${phys.status()[motor].rpm.toFixed(0)} rpm`);
  run(1, new Map());
  const held = y();
  run(1, new Map());
  check('let go part way down: the idle motor holds the weight', Math.abs(y() - held) < 3, `${held.toFixed(1)} → ${y().toFixed(1)} mm`);
  {
    // Paid right out and on past (openspec rope-and-spool, decision 9): the rope ties on where it left
    // the drum, swings round with the spool, then winds on the other way, with no jerk
    const p3 = await createPhysics(g, instances, { points: (pid) => getPartRawGeometry(partOf(byIdL.get(pid))).attributes.position.array }, { simulateGravity: true });
    const at = () => new THREE.Vector3(...pinAt).applyMatrix4(p3.deltas().get(g.roped[0]));
    for (let i = 0; i < 60; i++) p3.step(1 / 60, new Map());
    let last = at();
    let biggest = 0;
    let pull = 0;
    const seen = new Set();
    for (let i = 0; i < 150; i++) {
      p3.step(1 / 60, new Map([[motor, -1]]));
      const now = at();
      biggest = Math.max(biggest, now.distanceTo(last));
      last = now;
      const st = p3.ropeStates()[0];
      pull = Math.max(pull, st.tensionN);
      seen.add(st.anchor ? 'tied' : `wound ${st.winding}`);
    }
    check('paid right out and on past: the rope ties on, then winds the other way, with no jerk (each step under 5 mm, the pull under 0.3 N)', seen.has('tied') && seen.size === 3 && biggest < 5 && pull < 0.3, `${[...seen].join(', ')}; ${biggest.toFixed(2)} mm, ${pull.toFixed(3)} N`);
  }
  // Gravity off: the weight stays where it is
  const phys2 = await createPhysics(g, instances, { points: (pid) => getPartRawGeometry(partOf(byIdL.get(pid))).attributes.position.array }, { simulateGravity: false });
  for (let i = 0; i < 60; i++) phys2.step(1 / 60, new Map());
  check('gravity off: the weight stays where it is', Math.abs(new THREE.Vector3().setFromMatrixPosition(phys2.deltas().get(g.roped[0])).y) < 0.5);
}

// --- Fixtures: VEX's own ropes on Swish and Huey (scripts/make-rope-fixture.mjs) ---
{
  const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
  const partsOf = (fx) => fx.parts.map((p) => ({ ...p, visible: true }));
  const cloud = (r) => {
    const out = [];
    for (let i = 0; i < r.points.length; i += 3) out.push(new THREE.Vector3(r.points[i], r.points[i + 1], r.points[i + 2]));
    return out;
  };
  const offCord = (pts, p) => Math.min(...pts.map((c) => c.distanceTo(v3(p))));
  const ropeOf = (r) => ({ instanceId: 'fx-rope', partId: r.partQuery, label: r.label, position: [0, 0, 0], rotation: [0, 0, 0], visible: true });

  const swish = load('swish-rope.json');
  const sw = swish.ropes[0];
  const swParts = partsOf(swish);
  check('Swish fixture: one rope, read from the spool pocket to the arm shaft', swish.ropes.length === 1 && !sw.error && sw.from.feature === 'pocket' && /3x Pitch Motor Shaft/.test(sw.names.to), sw.error || `${sw.names.from} -> ${sw.names.to}`);
  const sws = stringRope(ropeOf(sw), { ends: [sw.from, sw.to], via: sw.via, spool: { winding: sw.winding === 'under' ? -1 : 1 } }, swParts, partOf);
  check("Swish's rope: about 225 mm used, 1.25 turns on the spool", !sws.error && near(sws.usedMm, 225, 8) && sws.turns === 1.25, sws.error || `${sws.usedMm.toFixed(1)} mm, ${sws.turns} turns`);
  const armShaft = swParts.find((i) => i.instanceId === sw.to.instanceId);
  const spoolFx = swParts.find((i) => i.instanceId === sw.from.instanceId);
  const places = ropePlacesOn(swParts, [armShaft.instanceId, spoolFx.instanceId], partOf);
  check("Swish's arm shaft offers a free stretch for a tab beside its collar, and the spool its pocket", !sws.error && places.ends.some((e) => e.instanceId === armShaft.instanceId && e.kind === 'post') && places.ends.some((e) => e.feature === 'pocket') && Number.isFinite(sws.shape.ends[1].at), JSON.stringify(sws.shape?.ends));
  const swPlaced = placeRope({ instances: swParts }, { ropePartId: sw.partQuery, from: sw.from, to: sw.to, via: sw.via });
  check('Swish: place_rope puts it on, and the pocket is then not offered', swPlaced.ok && !ropePlacesOn(swPlaced.state.instances, [spoolFx.instanceId], partOf).ends.some((e) => e.feature === 'pocket'), swPlaced.error || '');

  const huey = load('huey-lift.json');
  const huParts = partsOf(huey);
  check('Huey fixture: two ropes, each from a pin over the pulley groove (and the standoff it bears on below) to a pin', huey.ropes.length === 2 && huey.ropes.every((r) => !r.error && r.via.length === 2 && r.via[0].feature === 'groove' && /Standoff/.test(r.names.via[1]) && /Claw Mount/.test(r.names.from) && /Middle Stage/.test(r.names.via[0]) && /Holder/.test(r.names.to)), huey.ropes.map((r) => r.error || r.names.via.join()).join(' | '));
  huey.ropes.forEach((r, k) => {
    const h = stringRope(ropeOf(r), { ends: [r.from, r.to], via: r.via }, huParts, partOf);
    check(`Huey rope ${k + 1}: about 265 mm used, the rest slack`, !h.error && near(h.usedMm, 265, 12) && near(h.slackMm, 292.1 - h.usedMm, 0.01), h.error || `${h.usedMm.toFixed(1)} mm used, ${h.slackMm.toFixed(1)} mm slack`);
    // The solved path against VEX's own cord: its ends and the top of the pulley
    const pts = cloud(r);
    const miss = h.error ? [] : [offCord(pts, h.contacts[0].b), offCord(pts, h.contacts[1].a), offCord(pts, h.contacts[1].b), offCord(pts, h.contacts.at(-1).a)];
    // (VEX's cord starts at the tab's edge, about 3 mm from the hole the end is measured at)
    check(`Huey rope ${k + 1}: where it meets the pulley lies within 2 mm of VEX's cord, its ends within 4 mm`, !h.error && Math.max(miss[1], miss[2]) < 2 && Math.max(miss[0], miss[3]) < 4, h.error || `${miss.map((m) => m.toFixed(1)).join(', ')} mm`);
  });
}

export { failed, check, inst, byNumber };
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(failed ? `\n${failed} rope check(s) failed` : '\nAll rope checks passed');
  process.exit(failed ? 1 : 0);
}
