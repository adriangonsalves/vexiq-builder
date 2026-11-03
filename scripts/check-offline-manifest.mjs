/**
 * Checks the static build's offline file list (openspec offline-app): every listed file exists with
 * its size and hash, every file the site serves is listed, the service worker, web app manifest
 * and icons are there, and the version doesn't change when nothing does. Run after
 * `npm run build:static` (or pass a folder). Exits 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFLINE_MANIFEST_FILE, SERVICE_WORKER_FILE, buildOfflineManifest, compareWithManifest } from './offline-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.resolve(process.argv[2] ?? path.join(root, 'dist-static'));
let failures = 0;
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures += 1;
};

const manifestFile = path.join(dir, OFFLINE_MANIFEST_FILE);
if (!fs.existsSync(manifestFile)) {
  console.error(`No ${OFFLINE_MANIFEST_FILE} in ${dir}: run npm run build:static first`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

const problems = compareWithManifest(dir, manifest);
check(problems.length === 0, `files match the list (${manifest.files.length} files)`);
for (const p of problems.slice(0, 20)) console.log(`     ${p}`);
if (problems.length > 20) console.log(`     … and ${problems.length - 20} more`);

check(manifest.total === manifest.files.reduce((sum, f) => sum + f.size, 0), `total is the sum of the sizes (${(manifest.total / 1e6).toFixed(1)} MB)`);

const listed = new Set(manifest.files.map((f) => f.path));
for (const needed of ['index.html', 'catalog.json', 'part-metadata.json', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png']) {
  check(listed.has(needed), `${needed} is listed`);
}
check(manifest.files.some((f) => /^assets\/worker-.*\.js$/.test(f.path)), 'the engine worker is listed');
const models = manifest.files.filter((f) => f.path.startsWith('models/')).length;
const catalog = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'));
const modelUrls = new Set((Array.isArray(catalog) ? catalog : catalog.parts ?? []).map((p) => String(p.modelUrl ?? '').replace(/^\//, '')).filter(Boolean));
const unlisted = [...modelUrls].filter((u) => !listed.has(u));
check(unlisted.length === 0, `every catalog model is listed (${models} models)`);
for (const u of unlisted.slice(0, 10)) console.log(`     ${u}`);

check(fs.existsSync(path.join(dir, SERVICE_WORKER_FILE)) && !listed.has(SERVICE_WORKER_FILE), `${SERVICE_WORKER_FILE} is served but not downloaded`);
check(buildOfflineManifest(dir).version === manifest.version, 'the version is the same when worked out again');

const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
check(/rel="manifest"/.test(html) && /rel="apple-touch-icon"/.test(html), 'index.html links the manifest and the Apple icon');

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll offline manifest checks passed');
