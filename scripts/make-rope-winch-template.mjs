/**
 * Writes src/starters/assemblies/rope-winch.js, the "Rope winch" starter for File → Starter
 * (openspec rope-and-spool): a Smart Motor turns a 2x Wide Spool on a 4x8 plate; a 20x Pitch Rope
 * runs from the spool's pocket to a pin on the top of an arm hinged on one pin, and a rubber belt
 * pulls the arm the other way. In Play, running the motor winds the rope and pulls the arm over
 * against the belt; let go, the belt pulls the arm back and the rope pays out.
 *
 * The motor mount is the Speedbot's (same plate, pins, motor and motor shaft). The rope and belt are
 * strung by the engine and name the starter's own instance ids (inst-rope-winch-<row>).
 *
 *   node scripts/make-rope-winch-template.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, auditAssembly, findPart } from '../mcp/assembly-engine.mjs';
import { placeBand } from '../src/engine/bandRouting.js';
import { placeRope } from '../src/engine/ropeRouting.js';

const GROUP = 'Rope winch';
// [part number, label, position, rotation]
const PARTS = [
  ['228-2500-043', 'Winch Plate', [0, 0, 0], [0, 0, 0]],
  ['228-2500-060', 'Motor Pin 1', [-31.75, -6.35, 3.05], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin 2', [-44.45, -6.35, 3.05], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin 3', [-31.75, -19.05, 3.05], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin 4', [-44.45, -19.05, 3.05], [-180, 0, 0]],
  ['228-2560', 'Winch Motor', [-28.57, -12.7, 3.18], [-90, 0, 0]],
  ['228-2500-2236', 'Spool Shaft', [-38.1, -12.7, 6.25], [0, 0, 0]],
  ['228-2500-114', 'Spool Spacer', [-38.1, -12.7, -4.64], [0, 0, 0]],
  ['228-2500-421', 'Spool', [-38.1, -12.7, -18.78], [0, 0, 0]],
  ['228-2500-060', 'Arm Pivot Pin', [44.45, -6.35, -3.05], [0, 0, 0]],
  ['228-2500-009', 'Arm', [44.45, 25.4, -6.1], [0, 0, 90]],
  ['228-2500-060', 'Arm Top Pin', [44.45, 82.55, -9.15], [0, 0, 0]],
  ['228-2500-065', 'Arm Belt Post', [44.45, -31.75, -9.15], [0, 0, 0]],
  ['228-2500-065', 'Plate Belt Post', [-19.05, -19.05, -3.05], [0, 0, 0]]
];
const SOCKET_ANGLE = { 'Winch Motor': -14.1 };
const idOf = (row) => `inst-rope-winch-${row + 1}`;
const idByLabel = new Map(PARTS.map(([, label], i) => [label, idOf(i)]));

const parts = PARTS.map(([pn, label, position, rotation], i) => {
  const p = findPart(pn);
  return {
    instanceId: idOf(i),
    partId: p.id,
    label,
    position,
    rotation,
    color: p.defaultColor,
    visible: true,
    locked: false,
    isIntersecting: false,
    lastValidPosition: [...position],
    lastValidRotation: [...rotation],
    ...(SOCKET_ANGLE[label] ? { socketAngleDeg: SOCKET_ANGLE[label] } : {})
  };
});

// The belt: from the plate's post round the arm's bottom post
let state = { instances: parts };
const beltRow = PARTS.length;
let belt = null;
for (const pn of ['228-2500-222', '228-2500-223', '228-2500-224', '228-2500-468']) {
  const r = placeBand(state, { bandPartId: findPart(pn).id, label: 'Arm Belt', spots: [{ instanceId: idByLabel.get('Plate Belt Post'), feature: 'post:body' }, { instanceId: idByLabel.get('Arm Belt Post'), feature: 'post:body' }] });
  if (r.ok) {
    belt = r;
    break;
  }
}
if (!belt) throw new Error('No belt fits between the posts');
state = { instances: belt.state.instances.map((i) => (i.instanceId === belt.instanceId ? { ...i, instanceId: idOf(beltRow), label: 'Arm Belt' } : i)) };
console.log(`Belt: ${belt.message}`);

// The rope: from the spool's pocket to the arm's top pin, the size chosen to fit, the spare wound
const ropeRow = PARTS.length + 1;
const rope = placeRope(state, { from: { instanceId: idByLabel.get('Spool'), feature: 'pocket' }, to: { instanceId: idByLabel.get('Arm Top Pin'), feature: 'post:pin' }, label: 'Winch Rope' });
if (!rope.ok) throw new Error(`Rope: ${rope.error}`);
console.log(`Rope: ${rope.message}`);
state = { instances: rope.state.instances.map((i) => (i.instanceId === rope.instanceId ? { ...i, instanceId: idOf(ropeRow), label: 'Winch Rope' } : i)) };

const audit = auditAssembly(state);
const round = (x) => Math.round(x * 1000) / 1000 + 0;
const ordered = [...parts.map((p) => state.instances.find((i) => i.instanceId === p.instanceId)), state.instances.find((i) => i.instanceId === idOf(beltRow)), state.instances.find((i) => i.instanceId === idOf(ropeRow))];
const rows = ordered.map((x) => {
  const row = [findPart(x.partId).partNumber, x.label, x.position.map(round), x.rotation.map(round), x.color || findPart(x.partId).defaultColor, GROUP];
  if (x.shape || x.socketAngleDeg) row.push(x.socketAngleDeg || null);
  if (x.shape) row.push(x.shape);
  return row;
});
const out = path.join(ROOT_DIR, 'src', 'starters', 'assemblies', 'rope-winch.js');
fs.writeFileSync(
  out,
  `// Rope winch: a motor winds a rope on a spool to pull an arm against a belt, made by\n// scripts/make-rope-winch-template.mjs (${rows.length} parts). Rope and belt name the ids inst-rope-winch-<row>.\n` +
    '// [part number, label, position, rotation, colour, group, motor hub turn, shape]\n' +
    `export default [\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n];\n`
);
console.log(`Wrote ${path.relative(ROOT_DIR, out)}: ${rows.length} parts.`);
const problems = {
  collisions: audit.collisions.map((c) => `${c.label} × ${c.collidingWith.join(', ')}`),
  floating: audit.floatingFasteners.map((f) => f.label),
  halfSeated: audit.halfSeatedFasteners.map((f) => f.label),
  unsecured: audit.unsecuredParts.map((u) => u.label),
  islands: audit.disconnectedIslands.map((i) => i.map((p) => p.label).join(', ')),
  tilted: audit.tiltedMotors.map((m) => m.label),
  ropes: audit.ropes
};
console.log('Audit:', JSON.stringify(problems, null, 1));
