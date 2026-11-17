/**
 * Writes the Huey starter (src/starters/huey.js) from an imported build of VEX's CAD:
 *
 *   VEXIQ_STATE_PATH=/tmp/huey.json node scripts/import-cad.mjs 82f13c0c-d4a4-4db5-869e-5a18c90b9443 --clear
 *   node scripts/make-huey-starter.mjs /tmp/huey.json
 *
 * The groups get plain names, and each rope's route is rewritten to name the starter's own ids
 * (`inst-huey-<row>`), so the ropes stay on their parts when the starter is opened.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/make-huey-starter.mjs <imported build .json>');
  process.exit(1);
}
const NAMES = [['IQ Hero Elevetor Holder CAD', 'Elevator Holder'], ['IQ Hero Elevator Middle Stage', 'Elevator Middle Stage'], ['IQ Hero Claw Mount', 'Claw Mount'], ['IQ Hero Drive CAD', 'Drive']];
const rename = (s) => NAMES.reduce((t, [from, to]) => (typeof t === 'string' ? t.split(from).join(to) : t), s);
const state = JSON.parse(fs.readFileSync(source, 'utf8'));
const visible = state.instances.filter((i) => i.visible !== false);
const newId = new Map(visible.map((i, k) => [i.instanceId, `inst-huey-${k + 1}`]));
const ref = (r) => (r && newId.has(r.instanceId) ? { ...r, instanceId: newId.get(r.instanceId) } : r);
const instances = visible.map((i) => {
  const out = { ...i, label: rename(i.label), groupName: rename(i.groupName) };
  if (i.shape?.kind === 'rope') out.shape = { ...i.shape, ends: i.shape.ends.map(ref), via: (i.shape.via || []).map(ref) };
  return out;
});
const tmp = path.join(os.tmpdir(), `huey-starter-${process.pid}.json`);
fs.writeFileSync(tmp, JSON.stringify({ ...state, instances }));
try {
  execFileSync('node', [path.join(root, 'scripts', 'save-starter.mjs'), 'huey', 'Huey'], { stdio: 'inherit', env: { ...process.env, VEXIQ_STATE_PATH: tmp } });
} finally {
  fs.rmSync(tmp, { force: true });
}
