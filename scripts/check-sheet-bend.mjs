/**
 * Checks shaped parts and bent sheets (openspec shaped-parts-and-sheet-bending) on the Flop starter,
 * the test robot: its intake's 6x12 and 6x6 sheets are laid flat on the rows their sheet pins hold,
 * then bent onto the beams the way the robot has them.
 * Run: node scripts/check-sheet-bend.mjs   (exits 1 on failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import {
  ROOT_DIR,
  auditAssembly,
  buildWorldMatrix,
  checkCandidateCollision,
  getCatalog,
  getPartRawGeometry,
  getWorldPortsForInstance,
  mirrorSubassembly,
  partOf
} from '../mcp/assembly-engine.mjs';
import { bendSheet, sheetBendChoices } from '../src/engine/sheetBending.js';
import { bendCurve, sheetFrame, sheetRows, solvePiece, seriesPieces, seriesFromKappas, SERIES_SCALE } from '../src/utils/sheetBend.js';
import { shapeKey, shapedPart, shapeError } from '../src/utils/shapedParts.js';
import { applyOps, diffParts } from '../src/utils/buildHistory.js';
import { starterById } from '../src/starters.js';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};
const v3 = (a) => new THREE.Vector3(...a);
const { catalog } = getCatalog();
const byNumber = (pn) => catalog.find((p) => p.partNumber === pn);
const SHEET_6X12 = byNumber('228-2500-2712');
const SHEET_6X6 = byNumber('228-2500-2711');

// --- Shape keys and the registry ---
const someShape = { kind: 'sheet-bend', across: 'z', from: 'min', held: [1, 2], anchors: [{ row: 4, at: [5.8361, -3.5222], dir: [0.906, -0.423], stretch: 0 }] };
check('the same bend gives the same key', shapeKey(someShape) === shapeKey(JSON.parse(JSON.stringify(someShape))));
check('noise under 0.001 mm keeps the key', shapeKey(someShape) === shapeKey({ ...someShape, anchors: [{ ...someShape.anchors[0], at: [5.83612, -3.52218] }] }));
check('a beam refuses a bend', shapeError(byNumber('228-2500-011'), someShape) === 'Only plastic sheets can be bent.');
check('a plain copy is its catalog part', shapedPart(SHEET_6X12, null) === SHEET_6X12);

// --- Rows ---
const rows = sheetRows(SHEET_6X12, 'z', 'min');
check('a 6x12 has 6 rows across its width, 12.7 mm apart', rows.length === 6 && rows.every((r, i) => !i || Math.abs(r.s - rows[i - 1].s - 12.7) < 0.01), rows.map((r) => r.s.toFixed(1)).join(' '));
check('its edge rows have 12 holes and the others 2', rows[0].ports.length === 12 && rows[1].ports.length === 2 && rows[5].ports.length === 12);
check('a 6x12 has 12 rows along its length', sheetRows(SHEET_6X12, 'x', 'max').length === 12);

// --- A flat sheet laid on the holes a pair of sheet pins hold (one pin per row) ---
let state = { instances: starterById('flop').build(catalog).filter((i) => !i.label.includes('228-7711-71')) };
const inst = (label) => state.instances.find((i) => i.label === `Intake v2: ${label}`);
function layFlat(sheetPart, id, holderLabel, pinRow1, pinRow2, alsoPins = []) {
  const holder = inst(holderLabel);
  const holes = getWorldPortsForInstance(holder).filter((p) => p.type === 'pin_hole');
  const near = (q) => holes.reduce((a, b) => (v3(b.worldOrigin).distanceTo(v3(q)) < v3(a.worldOrigin).distanceTo(v3(q)) ? b : a));
  const p1 = inst(pinRow1).position;
  const p2 = inst(pinRow2).position;
  const [h1, h2] = [near(p1), near(p2)];
  const part = partOf(holder);
  const local = part.ports.find((p) => p.portId === h1.portId);
  const ai = local.axis.map(Math.abs).indexOf(Math.max(...local.axis.map(Math.abs)));
  const ax = v3(h1.worldAxis).normalize();
  const out = ax.clone().multiplyScalar(Math.sign(v3(p1).sub(v3(h1.worldOrigin)).dot(ax)));
  const localOut = out.clone().applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...holder.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ')).invert());
  const face = localOut.getComponent(ai) * local.axis[ai] > 0 ? part.bbox.max[ai] - local.origin[ai] : local.origin[ai] - part.bbox.min[ai];
  const mid = sheetPart.bbox.size[1] / 2;
  const P1 = v3(h1.worldOrigin).addScaledVector(out, face + mid);
  const P2 = v3(h2.worldOrigin).addScaledVector(out, face + mid);
  const zW = P2.clone().sub(P1).normalize();
  const xW = out.clone().cross(zW).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xW, out, zW));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const row1 = sheetRows(sheetPart, 'z', 'min')[0];
  const sheet = { instanceId: id, partId: sheetPart.id, label: `Test ${sheetPart.name}`, rotation: [e.x, e.y, e.z].map((r) => THREE.MathUtils.radToDeg(r)), visible: true, color: null };
  sheet.position = P1.clone().sub(v3([0, mid, row1.ports[0].origin[2]]).applyQuaternion(q)).toArray();
  // Slide along the row so a row-1 hole sits on the first pin and a row-2 hole on the second
  const base = sheet.position;
  for (const hole of row1.ports) {
    const ports = getWorldPortsForInstance({ ...sheet, position: base });
    const at = ports.find((p) => p.portId === hole.portId);
    const shift = xW.clone().multiplyScalar(v3(p1).sub(v3(at.worldOrigin)).dot(xW));
    sheet.position = v3(base).add(shift).toArray();
    if ([p1, p2, ...alsoPins.map((l) => inst(l).position)].every((p) => holeGapOf(sheet, p) < 0.2)) break;
  }
  return sheet;
}
const big = layFlat(SHEET_6X12, 'test-6x12', '228-2500-128-1', '228-2500-099-1', '228-2500-099-2', ['228-2500-099-9', '228-2500-099-10']);
state = { instances: [...state.instances, big] };
const holeGap = (sheet, pinLabel) => holeGapOf(sheet, inst(pinLabel).position);
function holeGapOf(sheet, at) {
  return Math.min(...getWorldPortsForInstance(sheet).filter((p) => p.type === 'pin_hole').map((p) => {
  const d = v3(at).sub(v3(p.worldOrigin));
  const ax = v3(p.worldAxis);
  return d.sub(ax.multiplyScalar(d.dot(ax))).length();
}));
}
// SHEET_TEST_STATE=<file>: keep the build with the flat 6x12 for trying Bend sheet in the app
if (process.env.SHEET_TEST_STATE) fs.writeFileSync(process.env.SHEET_TEST_STATE, JSON.stringify({ instances: state.instances, selectedIds: [big.instanceId, inst('228-2500-011-1').instanceId], selectedId: inst('228-2500-011-1').instanceId }));
check('the flat 6x12 sits on its two held rows', holeGap(big, '228-2500-099-1') < 0.1 && holeGap(big, '228-2500-099-2') < 0.1, [holeGap(big, '228-2500-099-1'), holeGap(big, '228-2500-099-2')].map((x) => x.toFixed(2)).join(' '));

// --- Choices ---
const unpinned = { ...big, instanceId: 'loose', position: [0, 300, 0] };
const none = sheetBendChoices({ instances: [...state.instances, unpinned] }, { sheetId: 'loose', targetId: inst('228-2500-011-1').instanceId });
check('an unpinned sheet is told to pin a row first', none.choices.length === 0 && /Pin one row/.test(none.reasons[0] || ''), none.reasons[0]);

const t0 = Date.now();
const toBeam = sheetBendChoices(state, { sheetId: big.instanceId, targetId: inst('228-2500-011-1').instanceId });
const row4 = toBeam.choices.find((c) => c.row === 4);
check('row 4 onto the 1x12 Beam is offered, nearly exact', Boolean(row4) && row4.missMm <= 0.5, `${toBeam.choices.map((c) => c.name).join(' | ')} in ${Date.now() - t0} ms`);

// A twisted target
const twisted = { ...inst('228-2500-011-1'), instanceId: 'twisted', rotation: [inst('228-2500-011-1').rotation[0] + 10, inst('228-2500-011-1').rotation[1], inst('228-2500-011-1').rotation[2]] };
const tw = sheetBendChoices({ instances: [...state.instances.filter((i) => i.label !== 'Intake v2: 228-2500-011-1'), twisted] }, { sheetId: big.instanceId, targetId: 'twisted' });
check('a beam 10° off parallel is refused for twisting', tw.choices.length === 0 && tw.reasons.some((r) => /twist/.test(r)), tw.reasons.join(' | '));

// A part in the curve's way removes that choice, saying what it would hit
const blocker = { ...inst('228-2500-011-1'), instanceId: 'blocker', label: 'Blocking beam', position: [103, 23.3, 0] };
const blocked = sheetBendChoices({ instances: [...state.instances, blocker] }, { sheetId: big.instanceId, targetId: inst('228-2500-011-1').instanceId });
check('a beam across the curve removes the row 4 choice', !blocked.choices.some((c) => c.row === 4 && c.face === row4?.face) && blocked.reasons.some((x) => /Blocking beam/.test(x)), blocked.reasons.filter((x) => /pass/.test(x)).join(' | '));

// --- By hole: the marked sheet hole's row is the only row anchored (openspec bend-sheet-by-holes) ---
{
  const beamId = inst('228-2500-011-1').instanceId;
  const sheetHoles = (row) => sheetRows(SHEET_6X12, 'z', 'min').find((x) => x.row === row).ports;
  const beamHoles = getWorldPortsForInstance(inst('228-2500-011-1')).filter((p) => p.type === 'pin_hole');
  const all = sheetBendChoices(state, { sheetId: big.instanceId, targetId: beamId });
  const wanted = all.choices.find((c) => c.row === 4);
  // Try each (row 4 hole, beam hole) pair: the pairs that line up give choices
  let target = null;
  let sheetHole = null;
  let hit = null;
  for (const sh of sheetHoles(4)) {
    for (const bh of wanted ? beamHoles : []) {
      const r2 = sheetBendChoices(state, { sheetId: big.instanceId, targetId: beamId, sheetPortId: sh.portId, targetPortId: bh.portId });
      if (r2.choices?.length) { [sheetHole, target, hit] = [sh, bh, r2]; break; }
    }
    if (hit) break;
  }
  check('marking a row 4 hole offers only row 4 choices', Boolean(hit?.choices?.length) && hit.choices.every((c) => c.row === 4), hit ? hit.choices.map((c) => c.name).join(' | ') + ' / ' + hit.reasons.join(' | ') : 'no row 4 choice');
  check('each by-hole choice says how many holes line up, the most first', Boolean(hit?.choices?.length) && hit.choices.every((c, i, a) => c.holesMatched >= 1 && (!i || a[i - 1].holesMatched >= c.holesMatched)), hit?.choices?.map((c) => c.holesMatched).join(' '));
  const held = sheetBendChoices(state, { sheetId: big.instanceId, targetId: beamId, sheetPortId: sheetHoles(2)[0].portId, targetPortId: beamHoles[0].portId });
  check('a hole in an already held row is refused, saying so', held.choices.length === 0 && held.reasons.some((x) => /already held/.test(x)), held.reasons.join(' | '));
  // A marked hole far along the row from the picked one: a plain reason, never the empty answer
  let far = null;
  for (const bh of beamHoles) {
    const r3 = sheetBendChoices(state, { sheetId: big.instanceId, targetId: beamId, sheetPortId: sheetHoles(4)[0].portId, targetPortId: bh.portId });
    if (!r3.choices.length) { far = r3; break; }
  }
  check('a marked hole that can\'t reach the picked hole says how far along the row it is', Boolean(far) && far.reasons.length > 0 && far.reasons.some((x) => /along the row|can't slide|out of reach|too tightly|pass through/.test(x)), far?.reasons?.join(' | '));
  const direct = hit?.choices?.length ? bendSheet(state, { sheetId: big.instanceId, targetId: beamId, sheetPortId: sheetHole.portId, targetPortId: target.portId }) : { ok: false };
  check('bending by hole is one step and reports holesMatched', direct.ok && direct.record === true && direct.holesMatched >= 1, direct.error || `${direct.holesMatched} holes`);
  check('a bad hole id is refused', sheetBendChoices(state, { sheetId: big.instanceId, targetId: beamId, sheetPortId: 'nope' }).ok === false);
}

// --- One smooth bend when the sheet has spare length (no S) ---
{
  // Up, then turned 120° onto a face 49 mm along and 25 mm over, from a 63.5 mm sheet: 14 mm spare
  const piece = solvePiece([-31.8, 0.1], [1, 0], [10.6, 24.9], [-0.5, 0.866], 63.5);
  const pts = piece.sample ? piece.sample(200) : [];
  let left = 0, right = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
    const b = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
    const c = a[0] * b[1] - a[1] * b[0];
    if (c > 1e-4) left++;
    if (c < -1e-4) right++;
  }
  const length = pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  check('a sheet with spare length bends one way, in one arc', piece.kind === 'arc' && (left === 0 || right === 0), `${piece.kind}, r ${(1 / piece.maxK).toFixed(1)} mm`);
  check('that arc is exactly as long as the sheet and ends on the target', Math.abs(length - 63.5) < 0.2 && Math.hypot(pts.at(-1)[0] - 10.6, pts.at(-1)[1] - 24.9) < 0.01, length.toFixed(2));
}

// --- The longer search: S-bends and loops, when the plain bends don't clear the parts ---
{
  const t = Date.now();
  const found = seriesPieces([-31.8, 0.1], [1, 0], [10.6, 24.9], [-0.5, 0.866], 63.5);
  const ok = found.length >= 3 && found.every((piece) => {
    const pts = piece.sample(300);
    const length = pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
    return Math.abs(length - 63.5) < 0.3 && Math.hypot(pts.at(-1)[0] - 10.6, pts.at(-1)[1] - 24.9) < 0.05 && piece.maxK <= 1 / 3 + 1e-6;
  });
  check('the longer search finds several paths, each the sheet\'s length, ending on the target, none tighter than 3 mm', ok, `${found.length} paths in ${Date.now() - t} ms`);
  const again = found.every((piece) => {
    const saved = piece.kappas.map((k) => Math.round(k * SERIES_SCALE) / SERIES_SCALE); // as a saved bend keeps them
    const back = seriesFromKappas([-31.8, 0.1], [1, 0], 63.5, saved).sample(300);
    return Math.hypot(back.at(-1)[0] - 10.6, back.at(-1)[1] - 24.9) < 0.1;
  });
  check('a saved search result comes back ending on the target (to 0.1 mm), without searching again', again);
  check('they come gentlest first', found.every((x, i) => !i || found[i - 1].bending <= x.bending + 1e-9));
}

// --- Bending ---
let r = bendSheet(state, { sheetId: big.instanceId, targetId: inst('228-2500-011-1').instanceId, choice: row4?.id });
check('bending row 4 is one step', r.ok && r.record === true, r.error || r.stepLabel);
const before = state.instances;
state = r.state;
const ops = diffParts(before, state.instances);
const undone = applyOps(state.instances, ops.map((o) => o).reverse().map((o) => (o.op === 'update' ? { ...o, after: o.before } : o)));
check('undo makes the sheet flat again', !undone.find((i) => i.instanceId === big.instanceId).shape && ops.some((o) => o.op === 'update' && 'shape' in o.after));

// A loose beam just out of reach moves to the sheet
const nudged = { instances: state.instances.map((i) => (i.label === 'Intake v2: 228-2500-005-1' ? { ...i, position: [i.position[0] - 2.5, i.position[1] + 2.5, i.position[2]] } : i)) };
const moved = bendSheet(nudged, { sheetId: big.instanceId, targetId: inst('228-2500-005-1').instanceId, sheetRow: 6, moveTarget: true });
check('a loose beam out of reach is moved to the sheet', moved.ok && /Moved/.test(moved.message), moved.error || moved.message);

const toSmall = sheetBendChoices(state, { sheetId: big.instanceId, targetId: inst('228-2500-005-1').instanceId });
const row6 = toSmall.choices.find((c) => c.row === 6);
check('only rows past row 4 are offered next', toSmall.choices.every((c) => c.row > 4));
check('row 6 onto the 1x6 Beam is offered with a stretch of at most 1 mm', Boolean(row6) && row6.stretchMm > 0 && row6.stretchMm <= 1, row6?.name || toSmall.reasons.join(' | '));
r = bendSheet(state, { sheetId: big.instanceId, targetId: inst('228-2500-005-1').instanceId, choice: row6?.id });
check('bending row 6 works', r.ok, r.error);
if (r.ok) state = r.state;
const bent = state.instances.find((i) => i.instanceId === big.instanceId);
const curve = bendCurve(SHEET_6X12, bent.shape);
const stretch = bent.shape.anchors.reduce((s, a) => s + (a.stretch || 0), 0);
check('the curve keeps the sheet length (plus the stretch)', Math.abs(curve.length - (75.9 + stretch)) < 0.1, `${curve.length.toFixed(2)} mm`);
const turnAcross = (s) => {
  const a = curve.at(s - 0.02).t;
  const b = curve.at(s + 0.02).t;
  return THREE.MathUtils.radToDeg(Math.acos(Math.min(1, a[0] * b[0] + a[1] * b[1])));
};
check('no corner at row 4', turnAcross(rows[3].s) < 1, `${turnAcross(rows[3].s).toFixed(2)}°`);
check('the bent row 4 holes line up with the 1x12 Beam', holeGap(bent, '228-2500-099-13') < 0.3, holeGap(bent, '228-2500-099-13').toFixed(2));
check('the bent row 6 holes line up with the 1x6 Beam', holeGap(bent, '228-2500-099-11') < 0.3, holeGap(bent, '228-2500-099-11').toFixed(2));
const col = checkCandidateCollision(bent, state.instances);
check('the bent sheet overlaps nothing', !col.isIntersecting, col.collidingWith.map((c) => c.label).join(', '));

// Shaped holes and box match the shaped mesh; the bent holes point straight through the sheet
const derived = partOf(bent);
const geo = getPartRawGeometry(derived);
geo.computeBoundingBox();
const meshBox = geo.boundingBox;
check('the shaped box matches the shaped mesh', meshBox.min.distanceTo(v3(derived.bbox.min)) < 0.3 && meshBox.max.distanceTo(v3(derived.bbox.max)) < 0.3, `${meshBox.min.toArray().map((x) => x.toFixed(2))} ${meshBox.max.toArray().map((x) => x.toFixed(2))} vs ${derived.bbox.min} ${derived.bbox.max}`);
const f = sheetFrame(SHEET_6X12, 'z', 'min');
const perpendicular = derived.ports.every((p) => {
  const s = (p.origin.length && derived.flatPorts.find((q) => q.portId === p.portId).origin[f.ai] - f.edge) * f.sign;
  const t = curve.at(s).t;
  return Math.abs(p.axis[f.ai] * t[0] + p.axis[1] * t[1]) < 0.01;
});
check('every bent hole points straight through the sheet', perpendicular);
let thick = 0;
const pos = geo.attributes.position.array;
for (let i = 0; i < pos.length; i += 3) thick = Math.max(thick, Math.abs(pos[i + 1]));
check('the bent mesh is the shaped part, not the flat one', derived.id !== SHEET_6X12.id && meshBox.max.y - meshBox.min.y > 5);

// Mirror: the copy's holes are the original's reflected
const mir = mirrorSubassembly(state, { instanceIds: [big.instanceId], mirrorPlane: 'Z', planeOffsetMm: 200 });
const copy = mir.mirroredInstances[0];
const reflect = (p) => [p[0], p[1], 400 - p[2]];
const origHoles = getWorldPortsForInstance(bent).map((p) => reflect(p.worldOrigin));
const copyHoles = getWorldPortsForInstance(copy).map((p) => p.worldOrigin);
check('a mirrored bent sheet has the original holes reflected', Boolean(copy?.shape) && origHoles.every((o) => copyHoles.some((c) => v3(c).distanceTo(v3(o)) < 0.05)));

// --- Stacking: the 6x6 upright on its top rows, curled onto the same 1x6 Beam over the 6x12 ---
const small = layFlat(SHEET_6X6, 'test-6x6', '228-2500-134-1', '228-2500-099-3', '228-2500-099-5', ['228-2500-099-7', '228-2500-099-8']);
state = { instances: [...state.instances, small] };
check('the flat 6x6 sits on its two held rows', holeGap(small, '228-2500-099-3') < 0.1 && holeGap(small, '228-2500-099-5') < 0.1);
const stack = sheetBendChoices(state, { sheetId: small.instanceId, targetId: inst('228-2500-005-1').instanceId });
const top = stack.choices.find((c) => c.row === 6 && c.layers === 1);
check('row 6 of the 6x6 stacks on the 6x12', Boolean(top), stack.choices.map((c) => c.name).join(' | ') || stack.reasons.join(' | '));
r = bendSheet(state, { sheetId: small.instanceId, targetId: inst('228-2500-005-1').instanceId, choice: top?.id });
if (r.ok) state = r.state;
const smallBent = state.instances.find((i) => i.instanceId === small.instanceId);
const gap = (() => {
  const a = getWorldPortsForInstance(smallBent).filter((p) => p.type === 'pin_hole');
  const b = getWorldPortsForInstance(state.instances.find((i) => i.instanceId === big.instanceId)).filter((p) => p.type === 'pin_hole');
  let best = Infinity;
  for (const p of a) for (const q of b) {
    const d = v3(p.worldOrigin).sub(v3(q.worldOrigin));
    const ax = v3(q.worldAxis);
    const along = Math.abs(d.dot(ax));
    if (d.clone().sub(ax.clone().multiplyScalar(d.dot(ax))).length() < 0.3) best = Math.min(best, along);
  }
  return best - SHEET_6X12.bbox.size[1];
})();
check('the stacked sheets are 0.1 mm apart', Math.abs(gap - 0.1) < 0.02, `${gap.toFixed(3)} mm`);
const both = checkCandidateCollision(smallBent, state.instances);
check('the stacked 6x6 overlaps nothing', r.ok && !both.isIntersecting, r.error || both.collidingWith.map((c) => c.label).join(', '));

// --- Pins move with the sheet ---
const flat6x12 = bendSheet(state, { sheetId: big.instanceId, flatten: true });
const flatSheet = flat6x12.state.instances.find((i) => i.instanceId === big.instanceId);
const pinNow = (label) => flat6x12.state.instances.find((i) => i.label === `Intake v2: ${label}`).position;
check('flattening moves the pins in the bent rows with the sheet', ['228-2500-099-13', '228-2500-099-11'].every((l) => flat6x12.movedIds.includes(inst(l).instanceId) && holeGapOf(flatSheet, pinNow(l)) < 0.1));

// --- Flatten ---
const flat = bendSheet(state, { sheetId: small.instanceId, flatten: true });
check('flatten removes the bend as one step', flat.ok && !flat.state.instances.find((i) => i.instanceId === small.instanceId).shape && flat.stepLabel.startsWith('Flatten'));

// --- The audit sees the bent sheets ---
const audit = auditAssembly(state);
check('the audit finds no overlaps with the bent sheets', !(audit.collisions || []).some((c) => JSON.stringify(c).includes('Test ')), JSON.stringify(audit.collisions || []).slice(0, 200));

// --- Against VEX's own sheets, when the CAD project is cached ---
const cache = path.join(ROOT_DIR, '.cache', 'cad-projects');
const vexFile = path.join(cache, 'flop-sheets.json');
if (fs.existsSync(vexFile)) {
  const vex = JSON.parse(fs.readFileSync(vexFile, 'utf8'));
  for (const [id, key] of [[big.instanceId, '712'], [small.instanceId, '711']]) {
    const sheet = state.instances.find((i) => i.instanceId === id);
    const g = getPartRawGeometry(partOf(sheet));
    g.computeBoundingBox();
    const toLocal = buildWorldMatrix(sheet.position, sheet.rotation).invert();
    const pts = vex[key];
    const hit = {};
    let sum = 0;
    let n = 0;
    for (let i = 0; i < pts.length; i += 3 * 11) {
      const p = v3([pts[i], pts[i + 1], pts[i + 2]]).applyMatrix4(toLocal);
      g.boundsTree.closestPointToPoint(p, hit);
      sum += hit.distance;
      n++;
    }
    check(`the bent ${key === '712' ? '6x12' : '6x6'} lies within 1.5 mm on average of VEX's sheet`, sum / n <= 1.5, `${(sum / n).toFixed(2)} mm`);
  }
} else {
  console.log('SKIP  comparison with VEX\'s sheets (no .cache/cad-projects/flop-sheets.json)');
}

// --- The Flop starter has both intake sheets bent, every sheet pin seated, nothing overlapping ---
const starter = { instances: starterById('flop').build(catalog) };
const starterSheets = starter.instances.filter((i) => /228-7711-71[12]/.test(i.label));
check('the Flop starter has its two intake sheets, both bent', starterSheets.length === 2 && starterSheets.every((i) => i.shape?.kind === 'sheet-bend'));
const starterAudit = auditAssembly(starter);
const sheetPinsLoose = (starterAudit.halfSeatedFasteners || []).filter((h) => /228-2500-099/.test(h.label)).map((h) => h.label);
check('every sheet pin in the Flop starter is seated', sheetPinsLoose.length === 0, sheetPinsLoose.join(', '));
const sheetOverlaps = starterSheets.flatMap((i) => checkCandidateCollision(i, starter.instances).collidingWith.map((c) => `${i.label} x ${c.label}`));
check('the Flop starter\'s sheets overlap nothing', sheetOverlaps.length === 0, sheetOverlaps.join(', '));
if (fs.existsSync(vexFile)) {
  const vex = JSON.parse(fs.readFileSync(vexFile, 'utf8'));
  for (const sheet of starterSheets) {
    const key = sheet.label.includes('712') ? '712' : '711';
    const g = getPartRawGeometry(partOf(sheet));
    const toLocal = buildWorldMatrix(sheet.position, sheet.rotation).invert();
    const pts = vex[key];
    const hit = {};
    let sum = 0;
    let n = 0;
    for (let i = 0; i < pts.length; i += 3 * 11) {
      g.boundsTree.closestPointToPoint(v3([pts[i], pts[i + 1], pts[i + 2]]).applyMatrix4(toLocal), hit);
      sum += hit.distance;
      n++;
    }
    check(`the starter's ${key === '712' ? '6x12' : '6x6'} lies within 1.5 mm on average of VEX's sheet`, sum / n <= 1.5, `${(sum / n).toFixed(2)} mm`);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll sheet bend checks passed');
process.exit(failed ? 1 : 0);
