/**
 * The help pictures' shot list (openspec in-app-help, design.md section 5): every
 * `scripts/help-shots/shots-<group>.mjs` joined into one list. Each of those files exports
 * `default` (or `shots`) as an array of shots, so several writers can each keep their own file.
 *
 * A shot:
 *   name    the picture's name: public/help/shots/<name>.webp, written ![…](shot:<name>) in a page
 *   layout  'large' (1280×800, the default), 'medium' (900×1100) or 'small' (390×780)
 *   touch   true to emulate a touch screen (default: on for medium and small)
 *   build   'fresh' (default: what a new browser shows, the Sample starter), 'empty' (File → New),
 *           'starter:<Starter name>', or 'file:scripts/help-shots/builds/<name>.vexiq.json'
 *   hash    an address to open at, e.g. '#help/gears' (pictures of the guide itself)
 *   setup   async (app) => { … } puts the app in the state the picture needs (see app.mjs)
 *   crop    [spec, …] the regions to keep, joined, plus 16 px round them; 'window' for the lot
 *   marks   [spec, …] marker 1, 2, … in this order; a spec may end in @center, @left, @top or @bottom
 *           (default: the middle of the control's right edge)
 * Specs: 'control:<help name>', 'button:<name>', 'menuitem:<text>', 'menu:<name>', 'dialog:<title>',
 * 'part:<Outline name>', 'text:<exact text>', 'css:<selector>', or a region: toolbar, view, library,
 * outline, properties, context-bar, help, view-cube.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function loadShots() {
  const files = fs
    .readdirSync(HERE)
    .filter((f) => /^shots-[\w-]+\.mjs$/.test(f))
    .sort();
  const all = [];
  const seen = new Map();
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(HERE, file)).href);
    const list = mod.default ?? mod.shots;
    if (!Array.isArray(list)) throw new Error(`${file} must export an array of shots as default`);
    for (const shot of list) {
      if (!shot?.name || !/^[a-z0-9][a-z0-9-]*$/.test(shot.name)) throw new Error(`${file}: a shot needs a name of lower-case letters, digits and dashes (got ${JSON.stringify(shot?.name)})`);
      if (seen.has(shot.name)) throw new Error(`Shot "${shot.name}" is in both ${seen.get(shot.name)} and ${file}`);
      seen.set(shot.name, file);
      all.push({ ...shot, file });
    }
  }
  return all;
}
