/**
 * Writes src/starters/assemblies/ratchet-winch.js, the "Ratchet winch" starter for File → Starter:
 * Hero Bot Swish's winch (a ratchet and pawl on a swinging arm, openspec ratchet-and-pawl).
 * Made from scripts/fixtures/swish-winch.json (VEX's CAD poses) with its two belts strung.
 *
 *   node scripts/make-ratchet-template.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT_DIR, auditAssembly, findPart } from '../mcp/assembly-engine.mjs';
import { stringBand } from '../src/utils/bandRoute.js';
import { placeRope } from '../src/engine/ropeRouting.js';

const swish = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'fixtures', 'swish-winch.json'), 'utf8'));
const seen = new Map();
const named = (partId) => {
  const name = findPart(partId)?.name || partId;
  const n = (seen.get(name) || 0) + 1;
  seen.set(name, n);
  return `${name} #${n}`;
};
const instance = (x) => ({
  instanceId: x.instanceId,
  partId: x.partId,
  label: x.label,
  position: x.position,
  rotation: x.rotation,
  color: findPart(x.partId)?.defaultColor || '#9ca3af',
  visible: true,
  locked: false,
  isIntersecting: false,
  lastValidPosition: [...x.position],
  lastValidRotation: [...x.rotation],
  ...(x.shape ? { shape: x.shape } : {})
});
// VEX's CAD leaves the motor shaft's gears a few degrees out of mesh with the arm's gears, and the
// arm's capped shaft 1 mm into a gear's face. Turn what sits on the motor shaft 4° and slide the
// capped shaft 1 mm, so the build opens with no overlaps (the ratchet, pawl and arm stay as VEX drew them).
const MOTOR_SHAFT_XY = [12.522, 28.717];
const MESH_TURN_DEG = 4;
const CAPPED_SHAFT_SLIDE_MM = -1;
const RAD = Math.PI / 180;
const turnAboutZ = (rot, deg) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * RAD, rot[1] * RAD, rot[2] * RAD, 'XYZ'));
  q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), deg * RAD));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z].map((v) => Math.round((v / RAD) * 1000) / 1000 + 0);
};
const tidy = (x) => {
  if (Math.hypot(x.position[0] - MOTOR_SHAFT_XY[0], x.position[1] - MOTOR_SHAFT_XY[1]) < 0.05) return { ...x, rotation: turnAboutZ(x.rotation, MESH_TURN_DEG) };
  if (findPart(x.partId)?.partNumber === '228-2500-2238') return { ...x, position: [x.position[0], x.position[1], Math.round((x.position[2] + CAPPED_SHAFT_SLIDE_MM) * 1000) / 1000] };
  return x;
};
const parts = swish.parts.map(tidy).map((x) => ({ ...x, label: named(x.partId), visible: true }));
const belts = swish.bands.map((b, k) => {
  const band = { instanceId: `belt-${k + 1}`, partId: b.partId, label: `Pawl belt #${k + 1}`, position: [0, 0, 0], rotation: [0, 0, 0], visible: true };
  const strung = stringBand(band, b.spots, parts, (i) => findPart(i.partId));
  return { ...band, position: strung.position, rotation: strung.rotation, shape: strung.shape };
});
// The rope (openspec rope-and-spool): one end in the spool's pocket, four turns wound, the rest
// hanging free, ready to be tied to a build. It names the starter's own ids (inst-ratchet-winch-<row>),
// which starters.js gives each row, not the fixture's.
const rowId = (k) => `inst-ratchet-winch-${k + 1}`;
const ropeRow = parts.findIndex((x) => findPart(x.partId)?.partNumber === '228-2500-438');
const spoolRow = parts.findIndex((x) => findPart(x.partId)?.partNumber === '228-2500-421');
const asRows = parts.map((x, k) => ({ ...x, instanceId: rowId(k) }));
const roped = placeRope({ instances: asRows.filter((_, k) => k !== ropeRow) }, { instanceId: undefined, ropePartId: parts[ropeRow].partId, from: { instanceId: rowId(spoolRow), feature: 'pocket' }, turns: 4, label: parts[ropeRow].label });
if (!roped.ok) throw new Error(`Rope: ${roped.error}`);
const ropeInst = roped.state.instances.find((i) => i.instanceId === roped.instanceId);
parts[ropeRow] = { ...parts[ropeRow], position: ropeInst.position, rotation: ropeInst.rotation, shape: ropeInst.shape };
console.log(`Rope: ${roped.message}`);
const instances = [...parts, ...belts].map(instance);
const audit = auditAssembly({ instances });
const round = (x) => Math.round(x * 1000) / 1000;
const rows = instances.map((x) => {
  const row = [findPart(x.partId).partNumber, x.label, x.position.map(round), x.rotation.map(round), x.color, 'Ratchet winch'];
  if (x.shape) row.push(null, x.shape);
  return row;
});
const out = path.join(ROOT_DIR, 'src', 'starters', 'assemblies', 'ratchet-winch.js');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  `// Ratchet winch: Hero Bot Swish's winch, made by scripts/make-ratchet-template.mjs (${rows.length} parts).\n` +
    '// [part number, label, position, rotation, colour, group, motor hub turn, shape]\n' +
    `export default [\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n];\n`
);
console.log(`Wrote ${path.relative(ROOT_DIR, out)}: ${rows.length} parts.`);
console.log('Ratchets:', JSON.stringify(audit.ratchets.map((r) => ({ pawl: r.pawl, ratchet: r.ratchet, holds: r.holds, turns: r.freeDirection, pressed: r.pressed }))));
console.log('Overlaps:', audit.collisions.length);
console.log('Ropes:', JSON.stringify(auditAssembly({ instances: instances.map((x, k) => ({ ...x, instanceId: rowId(k), ...(x.shape?.kind === 'rope' ? {} : {}) })) }).ropes));
