/**
 * Saves the app's current build (public/assembly-state.json, or VEXIQ_STATE_PATH) as a starter for File → Starter:
 * writes src/starters/<id>.js with one row per visible part, keyed by part number so the starter
 * still loads after the catalog is converted again. Add the starter to STARTERS in src/starters.js.
 * Run: node scripts/save-starter.mjs <id> [name]   e.g. node scripts/save-starter.mjs flop Flop
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [id, nameArg] = process.argv.slice(2);
if (!id || !/^[a-z0-9-]+$/.test(id)) {
  console.error('Usage: node scripts/save-starter.mjs <id> [name]   (id: lower-case letters, digits, dashes)');
  process.exit(1);
}
const state = JSON.parse(fs.readFileSync(process.env.VEXIQ_STATE_PATH || path.join(root, 'public', 'assembly-state.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public', 'catalog.json'), 'utf8'));
const byId = new Map(catalog.map((p) => [p.id, p]));
const name = nameArg || state.build?.name || id;
const round = (x) => Math.round(x * 1000) / 1000;

const rows = [];
for (const inst of state.instances || []) {
  if (inst.visible === false) continue;
  const p = byId.get(inst.partId);
  if (!p) throw new Error(`${inst.label}: part ${inst.partId} is not in the catalog`);
  const row = [p.partNumber, inst.label, inst.position.map(round), inst.rotation.map(round), inst.color || null, inst.groupName || null];
  if (inst.socketAngleDeg || inst.shape) row.push(inst.socketAngleDeg ? round(inst.socketAngleDeg) : null);
  if (inst.shape) row.push(inst.shape);
  rows.push(row);
}

const out = path.join(root, 'src', 'starters', `${id}.js`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(
  out,
  `// ${name}: saved from the app by scripts/save-starter.mjs (${rows.length} parts).\n` +
    '// [part number, label, position, rotation, colour, group, motor hub turn, shape]\n' +
    `export default [\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n];\n`
);
console.log(`Wrote ${path.relative(root, out)}: ${rows.length} parts of "${name}".`);
