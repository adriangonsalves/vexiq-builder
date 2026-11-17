/**
 * Writes src/starters/assemblies/rope-lift.js, the "Rope lift" starter for File → Starter (openspec
 * rope-and-spool): the Rope winch's motor and 2x Wide Spool on a 4x8 plate, with a 12x Pitch Rope
 * from the spool's pocket down to a weight (two 1x5 beams on three pins) that hangs on it, held by
 * nothing else. In Play with gravity on, the weight hangs on the rope; running the motor winds it up,
 * reversing lets it down.
 *
 *   node scripts/make-rope-lift-template.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, auditAssembly, findPart } from '../mcp/assembly-engine.mjs';
import { placeRope } from '../src/engine/ropeRouting.js';

const GROUP = 'Rope lift';
// The weight's top pin, under the side of the drum the rope leaves from, its tab between the beams
const W = { x: -31.75, y: -112.7, z: -7.825 };
const PARTS = [
  ['228-2500-043', 'Lift Plate', [0, 0, 0], [0, 0, 0]],
  ['228-2500-060', 'Motor Pin 1', [-31.75, -6.35, 3.05], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin 2', [-44.45, -6.35, 3.05], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin 3', [-31.75, -19.05, 3.05], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin 4', [-44.45, -19.05, 3.05], [-180, 0, 0]],
  ['228-2560', 'Lift Motor', [-28.57, -12.7, 3.18], [-90, 0, 0]],
  ['228-2500-2236', 'Spool Shaft', [-38.1, -12.7, 6.25], [0, 0, 0]],
  ['228-2500-114', 'Spool Spacer', [-38.1, -12.7, -4.64], [0, 0, 0]],
  ['228-2500-421', 'Spool', [-38.1, -12.7, -18.78], [0, 0, 0]],
  ['228-2500-004', 'Weight Front', [W.x, W.y - 25.4, W.z + 3.05], [0, 0, 90]],
  ['228-2500-004', 'Weight Back', [W.x, W.y - 25.4, W.z - 9.4], [0, 0, 90]],
  ['228-2500-061', 'Weight Top Pin', [W.x, W.y, W.z], [0, 0, 0]],
  ['228-2500-061', 'Weight Pin 2', [W.x, W.y - 25.4, W.z], [0, 0, 0]],
  ['228-2500-061', 'Weight Pin 3', [W.x, W.y - 50.8, W.z], [0, 0, 0]]
];
const SOCKET_ANGLE = { 'Lift Motor': -14.1 };
const idOf = (row) => `inst-rope-lift-${row + 1}`;
const idByLabel = new Map(PARTS.map(([, label], i) => [label, idOf(i)]));
const parts = PARTS.map(([pn, label, position, rotation], i) => {
  const p = findPart(pn);
  return { instanceId: idOf(i), partId: p.id, label, position, rotation, color: p.defaultColor, visible: true, locked: false, isIntersecting: false, lastValidPosition: [...position], lastValidRotation: [...rotation], ...(SOCKET_ANGLE[label] ? { socketAngleDeg: SOCKET_ANGLE[label] } : {}) };
});
const ropeRow = PARTS.length;
const rope = placeRope({ instances: parts }, { ropePartId: findPart('228-2500-430').id, from: { instanceId: idByLabel.get('Spool'), feature: 'pocket' }, to: { instanceId: idByLabel.get('Weight Top Pin'), feature: 'post:pin', at: -3.175 }, label: 'Lift Rope' });
if (!rope.ok) throw new Error(`Rope: ${rope.error}`);
console.log(`Rope: ${rope.message}`);
const state = { instances: rope.state.instances.map((i) => (i.instanceId === rope.instanceId ? { ...i, instanceId: idOf(ropeRow), label: 'Lift Rope' } : i)) };
const audit = auditAssembly(state);
const round = (x) => Math.round(x * 1000) / 1000 + 0;
const ordered = [...parts.map((p) => state.instances.find((i) => i.instanceId === p.instanceId)), state.instances.find((i) => i.instanceId === idOf(ropeRow))];
const rows = ordered.map((x) => {
  const row = [findPart(x.partId).partNumber, x.label, x.position.map(round), x.rotation.map(round), x.color || findPart(x.partId).defaultColor, GROUP];
  if (x.shape || x.socketAngleDeg) row.push(x.socketAngleDeg || null);
  if (x.shape) row.push(x.shape);
  return row;
});
const out = path.join(ROOT_DIR, 'src', 'starters', 'assemblies', 'rope-lift.js');
fs.writeFileSync(out, `// Rope lift: a motor winds a rope on a spool to lift a weight hanging on it, made by\n// scripts/make-rope-lift-template.mjs (${rows.length} parts). The rope names the ids inst-rope-lift-<row>.\n// [part number, label, position, rotation, colour, group, motor hub turn, shape]\nexport default [\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n];\n`);
console.log(`Wrote ${path.relative(ROOT_DIR, out)}: ${rows.length} parts.`);
console.log('Audit:', JSON.stringify({ collisions: audit.collisions.map((c) => `${c.label} × ${c.collidingWith.join(', ')}`), floating: audit.floatingFasteners.map((f) => f.label), half: audit.halfSeatedFasteners.map((f) => f.label), unsecured: audit.unsecuredParts.map((u) => u.label), islands: audit.disconnectedIslands.map((i) => i.map((p) => p.label).join(', ')), ropes: audit.ropes }, null, 1));
