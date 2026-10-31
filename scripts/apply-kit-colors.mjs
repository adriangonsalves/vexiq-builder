/**
 * Sets the default colours of the catalog parts that appear in the Competition Kit poster
 * (scripts/kit-colors.mjs). Without --write it only lists what would change.
 * Run: node scripts/apply-kit-colors.mjs [--write]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kitColor } from './kit-colors.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'public', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));

let changed = 0;
let same = 0;
const byColor = new Map();
for (const part of catalog) {
  const color = kitColor(part.name);
  if (!color) continue;
  if (color === part.defaultColor) {
    same += 1;
    continue;
  }
  byColor.set(color, [...(byColor.get(color) || []), `${part.name} (was ${part.defaultColor})`]);
  part.defaultColor = color;
  changed += 1;
}
for (const [color, names] of byColor) console.log(`${color}  ${names.length}\n  ${names.join('\n  ')}`);
console.log(`\n${changed} to change, ${same} already right, ${catalog.length - changed - same} not in the poster`);

if (process.argv.includes('--write')) {
  fs.writeFileSync(file, JSON.stringify(catalog, null, 2));
  console.log('catalog.json written');
}
