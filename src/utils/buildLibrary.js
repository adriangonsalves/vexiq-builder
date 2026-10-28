/**
 * The build library (openspec build-library): every build saved in the browser's IndexedDB, so
 * builds save themselves and many can be kept. A record is
 *   { id, name, createdAt, updatedAt, partCount, thumbnail, instances, history, viewport }.
 * The name helpers are pure so Node checks can run them.
 */

const DB_NAME = 'vexiq-builds';
const DB_VERSION = 1;
const STORE = 'builds';

// --- Names and ids --------------------------------------------------------------------------------

/** "Build #N", one more than the highest "Build #N" in `names` (1 when there is none). */
export function nextBuildName(names, base = 'Build') {
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} #(\\d+)$`);
  const used = names.map((n) => pattern.exec(String(n).trim())).filter(Boolean).map((m) => Number(m[1]));
  return `${base} #${used.length ? Math.max(...used) + 1 : 1}`;
}

/** `name` if free, else `name 2`, `name 3`, … */
export function uniqueName(names, name) {
  const taken = new Set(names.map((n) => String(n).trim()));
  if (!taken.has(name)) return name;
  for (let i = 2; ; i++) if (!taken.has(`${name} ${i}`)) return `${name} ${i}`;
}

/** The name of a copy: "<name> copy", "<name> copy 2", … */
export const copyName = (names, name) => uniqueName(names, `${name} copy`);

/** The name of a build made from a starter: its name, then "<name> 2", … */
export const starterBuildName = (names, starterName) => uniqueName(names, starterName);

/** A build's name from a file's name, without `.vexiq.json` / `.json`. */
export function fileBuildName(fileName) {
  const base = String(fileName || '').split(/[\\/]/).pop().replace(/\.vexiq\.json$/i, '').replace(/\.json$/i, '').trim();
  return base || 'Opened build';
}

export const newBuildId = () => `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A file name for exporting a build (characters files can't hold replaced). */
export const exportFileName = (name) => `${String(name || 'Build').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Build'}.vexiq.json`;

/** "just now", "5 min ago", "3 h ago", "2 days ago", or the date. */
export function changedAgo(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} day${Math.round(s / 86400) === 1 ? '' : 's'} ago`;
  return new Date(at).toLocaleDateString();
}

// --- IndexedDB ------------------------------------------------------------------------------------

let dbPromise = null;

/** True when this browser can keep a library. */
export const libraryAvailable = () => typeof indexedDB !== 'undefined';

function openDb() {
  if (!libraryAvailable()) return Promise.reject(new Error('This browser has no storage for builds'));
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

const run = async (mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

/** Every build's summary (no parts or history), most recently changed first. */
export async function listBuilds() {
  const all = (await run('readonly', (store) => store.getAll())) || [];
  return all
    .map(({ id, name, createdAt, updatedAt, partCount, thumbnail }) => ({ id, name, createdAt, updatedAt, partCount, thumbnail }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getBuild = (id) => run('readonly', (store) => store.get(id));
export const putBuild = (record) => run('readwrite', (store) => store.put(record));
export const deleteBuild = (id) => run('readwrite', (store) => store.delete(id));
