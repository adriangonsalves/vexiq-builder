/**
 * Takes the Help guide's pictures from the app (openspec in-app-help, design.md section 5).
 *
 *   node scripts/capture-help-shots.mjs [name…] [--url http://localhost:5174/vexiq-builder/] [--headful]
 *
 * With no names it retakes every shot in scripts/help-shots/shots-*.mjs; with names, only those.
 * It opens the static preview in the installed Chrome with a new empty profile, sets the shot's
 * window size, loads its build, runs its setup, waits until the view is still, and saves
 * public/help/shots/<name>.webp (2× for sharp screens, cropped) with its entry in
 * public/help/shots/shots.json: { w, h, marks: [{ n, x, y }] } (x, y as fractions of the picture).
 *
 * The preview must be built from the current code first:
 *   VEXIQ_BASE=/vexiq-builder/ npm run build:static
 * The script stops with that command when dist-static is older than src/ (help page text, the
 * coverage list and the writer's brief don't count, since pictures of the app don't depend on them).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_URL, LAYOUTS, launchBrowser, openApp } from './help-shots/app.mjs';
import { loadShots } from './help-shots/shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS_DIR = path.join(ROOT, 'public', 'help', 'shots');
const SHOTS_JSON = path.join(SHOTS_DIR, 'shots.json');
const REBUILD = 'VEXIQ_BASE=/vexiq-builder/ npm run build:static';
const PAD = 16;
const QUALITY = 80;

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const value = args[i + 1];
  args.splice(i, 2);
  return value;
};
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const url = (opt('--url') || DEFAULT_URL).replace(/\/?$/, '/');
const headful = flag('--headful');
const names = args;

/** The newest change under src/ that the built site depends on. */
function newestSource(dir = path.join(ROOT, 'src')) {
  let newest = { time: 0, file: null };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);
    if (entry.isDirectory()) {
      if (rel === path.join('src', 'help', 'pages')) continue;
      const inner = newestSource(full);
      if (inner.time > newest.time) newest = inner;
    } else {
      if (rel === path.join('src', 'help', 'coverage.json') || rel === path.join('src', 'help', 'WRITING.md')) continue;
      const time = fs.statSync(full).mtimeMs;
      if (time > newest.time) newest = { time, file: rel };
    }
  }
  return newest;
}

function checkPreviewIsCurrent() {
  const built = path.join(ROOT, 'dist-static', 'offline-manifest.json');
  if (!fs.existsSync(built)) {
    console.error(`The static preview hasn't been built. Run:\n  ${REBUILD}`);
    process.exit(1);
  }
  const builtAt = fs.statSync(built).mtimeMs;
  const { time, file } = newestSource();
  if (time > builtAt) {
    console.error(`The static preview is older than ${file}. Rebuild it first:\n  ${REBUILD}`);
    process.exit(1);
  }
}

async function checkPreviewIsServed() {
  try {
    const res = await fetch(`${url}offline-manifest.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const served = await res.json();
    const local = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist-static', 'offline-manifest.json'), 'utf8'));
    if (served.version !== local.version) {
      console.error(`${url} serves a different build than dist-static (version ${served.version}, local ${local.version}). Is the preview on port 5174 serving dist-static?`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Can't reach the static preview at ${url} (${err.message}). Start it with: npx vite preview --mode static --port 5174 --strictPort`);
    process.exit(1);
  }
}

const union = (rects) => {
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.width));
  const y2 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

/** Where a marker goes on its control: the middle of its right edge unless the spec says otherwise. */
function markPoint(r, where) {
  switch (where) {
    case 'center':
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 };
    case 'top':
      return { x: r.x + r.width / 2, y: r.y };
    case 'bottom':
      return { x: r.x + r.width / 2, y: r.y + r.height };
    default:
      return { x: r.x + r.width, y: r.y + r.height / 2 };
  }
}

const round = (n) => Math.round(n * 10000) / 10000;

async function capture(browser, shot) {
  const layout = shot.layout || 'large';
  const app = await openApp(browser, { url, layout, touch: shot.touch, hash: shot.hash || '' });
  try {
    const build = shot.build || 'fresh';
    if (build === 'empty') await app.newBuild();
    else if (build.startsWith('starter:')) await app.starter(build.slice('starter:'.length));
    else if (build.startsWith('file:')) await app.loadBuild(path.resolve(ROOT, build.slice('file:'.length)));
    else if (build !== 'fresh') throw new Error(`Unknown build "${build}"`);
    await app.waitStill();
    if (shot.setup) await shot.setup(app);
    await app.waitStill();

    const win = LAYOUTS[layout];
    const crops = shot.crop?.length ? shot.crop : ['window'];
    const rects = [];
    for (const spec of crops) {
      const r = await app.rectOf(spec);
      if (!r) throw new Error(`crop "${spec}" isn't on screen`);
      rects.push(r);
    }
    const u = union(rects);
    const whole = crops.includes('window');
    const x = whole ? 0 : Math.max(0, Math.floor(u.x - PAD));
    const y = whole ? 0 : Math.max(0, Math.floor(u.y - PAD));
    const clip = {
      x,
      y,
      width: Math.min(win.width, Math.ceil(u.x + u.width + (whole ? 0 : PAD))) - x,
      height: Math.min(win.height, Math.ceil(u.y + u.height + (whole ? 0 : PAD))) - y
    };

    const marks = [];
    for (const [i, raw] of (shot.marks || []).entries()) {
      const [spec, where] = raw.split('@');
      const r = await app.rectOf(spec);
      if (!r) throw new Error(`mark ${i + 1} "${raw}" isn't on screen`);
      const p = markPoint(r, where);
      if (p.x < clip.x || p.x > clip.x + clip.width || p.y < clip.y || p.y > clip.y + clip.height) throw new Error(`mark ${i + 1} "${raw}" is outside the crop`);
      marks.push({ n: i + 1, x: round((p.x - clip.x) / clip.width), y: round((p.y - clip.y) / clip.height) });
    }

    const file = path.join(SHOTS_DIR, `${shot.name}.webp`);
    const data = await app.page.screenshot({ type: 'webp', quality: QUALITY, clip, captureBeyondViewport: false });
    fs.writeFileSync(file, data);
    return { w: Math.round(clip.width), h: Math.round(clip.height), marks, bytes: data.length };
  } finally {
    await app.close();
  }
}

const all = await loadShots();
const unknown = names.filter((n) => !all.some((s) => s.name === n));
if (unknown.length) {
  console.error(`No shot named ${unknown.join(', ')} in scripts/help-shots/shots-*.mjs`);
  process.exit(1);
}
const todo = names.length ? all.filter((s) => names.includes(s.name)) : all;
checkPreviewIsCurrent();
await checkPreviewIsServed();

fs.mkdirSync(SHOTS_DIR, { recursive: true });
const { browser, close } = await launchBrowser({ headful });
let failed = 0;
try {
  for (const shot of todo) {
    try {
      const entry = await capture(browser, shot);
      // Merge into shots.json as each picture is done, so a later failure keeps the earlier ones
      const json = fs.existsSync(SHOTS_JSON) ? JSON.parse(fs.readFileSync(SHOTS_JSON, 'utf8')) : {};
      json[shot.name] = { w: entry.w, h: entry.h, marks: entry.marks };
      const sorted = Object.fromEntries(Object.keys(json).sort().map((k) => [k, json[k]]));
      fs.writeFileSync(SHOTS_JSON, `${JSON.stringify(sorted, null, 2)}\n`);
      console.log(`ok    ${shot.name}  ${entry.w}×${entry.h}  ${(entry.bytes / 1024).toFixed(0)} KB  ${entry.marks.length} mark(s)`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL  ${shot.name}: ${err.message}`);
    }
  }
} finally {
  await close();
}
if (failed) {
  console.error(`\n${failed} shot(s) failed`);
  process.exit(1);
}
console.log(`\n${todo.length} shot(s) taken`);
