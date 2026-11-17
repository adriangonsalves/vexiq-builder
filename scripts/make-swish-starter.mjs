/**
 * Writes the Swish starter (src/starters/swish.js) from an imported build of VEX's CAD:
 *
 *   VEXIQ_STATE_PATH=/tmp/swish.json node scripts/import-cad.mjs 856670fb-2cfa-48e6-b439-4e3b45a5f28e --clear
 *   node scripts/make-swish-starter.mjs /tmp/swish.json
 *
 * The groups get plain names ("Catapult Winch" -> "Winch"). The CAD's top-level parts (grouped by
 * part number, or not grouped) join the subassemblies to the chassis, so they go in "Chassis"; the
 * bands stay loose, since they span groups. Every part id in a band's or rope's route is rewritten to
 * the starter's own id (`inst-swish-<row>`), so the bands and rope stay on their parts when the
 * starter is opened.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) {
  console.error('Usage: node scripts/make-swish-starter.mjs <imported build .json>');
  process.exit(1);
}
const NAMES = {
  'Catapult Winch': 'Winch',
  'Catapult Arm': 'Arm',
  'Catapult Intake': 'Intake',
  'Catapult Chassis': 'Chassis',
  'Catapult Optical Sensor Assembly': 'Optical Sensor Mount',
  'Catapult Distance Sensor Assembly': 'Distance Sensor Mount'
};
const groupFor = (i) => {
  if (i.shape?.kind === 'band') return null;
  if (NAMES[i.groupName]) return NAMES[i.groupName];
  return 'Chassis';
};
const relabel = (label, from, to) => (typeof label === 'string' && from ? label.split(`${from}:`).join(`${to}:`) : label);

const state = JSON.parse(fs.readFileSync(source, 'utf8'));
const visible = state.instances.filter((i) => i.visible !== false);
const newId = new Map(visible.map((i, k) => [i.instanceId, `inst-swish-${k + 1}`]));
const remap = (v) => {
  if (Array.isArray(v)) return v.map(remap);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = k === 'instanceId' && newId.has(x) ? newId.get(x) : remap(x);
    return out;
  }
  return v;
};
const instances = visible.map((i) => {
  const groupName = groupFor(i);
  const out = { ...i, label: relabel(i.label, i.groupName, groupName || 'Bands'), groupName };
  if (i.shape) out.shape = remap(i.shape);
  return out;
});
const left = JSON.stringify(instances.map((i) => i.shape || null)).match(/"instanceId":"(?!inst-swish-)[^"]+"/g);
if (left) throw new Error(`Routes still name parts outside the starter: ${[...new Set(left)].join(', ')}`);
const tmp = path.join(os.tmpdir(), `swish-starter-${process.pid}.json`);
fs.writeFileSync(tmp, JSON.stringify({ ...state, instances }));
try {
  execFileSync('node', [path.join(root, 'scripts', 'save-starter.mjs'), 'swish', 'Swish'], { stdio: 'inherit', env: { ...process.env, VEXIQ_STATE_PATH: tmp } });
} finally {
  fs.rmSync(tmp, { force: true });
}
