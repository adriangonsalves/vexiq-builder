/**
 * The static site's file list for offline use (openspec offline-app): every file the site needs,
 * with its size and content hash, and a version that changes when any of them does. Written into
 * `dist-static/offline-manifest.json` by the static build and read back by check-offline-manifest.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const OFFLINE_MANIFEST_FILE = 'offline-manifest.json';
export const SERVICE_WORKER_FILE = 'sw.js';

/** Files the site serves but never downloads for offline use: the worker itself, this list, maps. */
const leftOut = (file) => file === SERVICE_WORKER_FILE || file === OFFLINE_MANIFEST_FILE || file.endsWith('.map') || path.basename(file) === '.DS_Store';

const hashOf = (data) => crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);

/** Every file under `dir`, as `/`-separated paths relative to it, sorted. */
function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else out.push(rel);
  }
  return out.sort();
}

/** `{ version, total, files: [{ path, size, hash }] }` for the built site in `dir`. */
export function buildOfflineManifest(dir) {
  const files = listFiles(dir)
    .filter((file) => !leftOut(file))
    .map((file) => {
      const data = fs.readFileSync(path.join(dir, file));
      return { path: file, size: data.length, hash: hashOf(data) };
    });
  const version = hashOf(files.map((f) => `${f.path} ${f.size} ${f.hash}`).join('\n'));
  const total = files.reduce((sum, f) => sum + f.size, 0);
  return { version, total, files };
}

/** Writes the manifest into `dir` and returns it. */
export function writeOfflineManifest(dir) {
  const manifest = buildOfflineManifest(dir);
  fs.writeFileSync(path.join(dir, OFFLINE_MANIFEST_FILE), JSON.stringify(manifest));
  return manifest;
}

/** Lines describing how the files in `dir` differ from `manifest` (empty when they match). */
export function compareWithManifest(dir, manifest) {
  const problems = [];
  const listed = new Set();
  for (const f of manifest.files) {
    listed.add(f.path);
    const file = path.join(dir, f.path);
    if (!fs.existsSync(file)) {
      problems.push(`missing: ${f.path}`);
      continue;
    }
    const data = fs.readFileSync(file);
    if (data.length !== f.size) problems.push(`size differs: ${f.path} (${data.length}, listed ${f.size})`);
    else if (hashOf(data) !== f.hash) problems.push(`content differs: ${f.path}`);
  }
  for (const file of listFiles(dir)) if (!leftOut(file) && !listed.has(file)) problems.push(`not listed: ${file}`);
  return problems;
}
