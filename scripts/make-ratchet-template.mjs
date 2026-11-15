/**
 * Writes templates/assemblies/ratchet-winch.vexiq.json: Hero Bot Swish's winch (a ratchet and pawl
 * on a swinging arm, openspec ratchet-and-pawl) as a build the app can open with File → Load.
 * Made from scripts/fixtures/swish-winch.json (VEX's CAD poses) with its two belts strung.
 *
 *   node scripts/make-ratchet-template.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT_DIR, auditAssembly, findPart } from '../mcp/assembly-engine.mjs';
import { stringBand } from '../src/utils/bandRoute.js';

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
const instances = [...parts, ...belts].map(instance);
const audit = auditAssembly({ instances });
const out = path.join(ROOT_DIR, 'templates', 'assemblies', 'ratchet-winch.vexiq.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${JSON.stringify({ version: '1.1', pitchUnitMm: 12.7, name: 'Ratchet winch', exportedAt: '2026-11-14T00:00:00.000Z', instances }, null, 1)}\n`);
console.log(`Wrote ${path.relative(ROOT_DIR, out)}: ${instances.length} parts.`);
console.log('Ratchets:', JSON.stringify(audit.ratchets.map((r) => ({ pawl: r.pawl, ratchet: r.ratchet, holds: r.holds, turns: r.freeDirection, pressed: r.pressed }))));
console.log('Sound:', audit.isMechanicallySound, '| tilted motors:', audit.tiltedMotors?.length, '| floating pins:', audit.floatingFasteners?.length, '| loose groups:', audit.disconnectedIslands?.length);
console.log('Overlaps:', audit.collisions.length, audit.collisions.map((c) => `${c.label} x ${c.collidingWith.join(', ')}`).join('; '));
