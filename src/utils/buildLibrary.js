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

/**
 * True when `build` came from a starter and its undo history is currently at the starter's
 * initial step (no un-undone edits, and not scrubbed part-way inside that step).
 */
export function isStarterAtInitialState(build, history) {
  const initialHeadId = build?.starter?.initialHeadId;
  if (!initialHeadId || !history) return false;
  return history.headId === initialHeadId && history.subIndex == null;
}

/**
 * Decides how autosave should treat `build` given its current `history` (openspec starter-save-on-edit):
 * - `'skip'`: unsaved starter still at its initial state (do not write to the library).
 * - `'promote'`: unsaved starter that has been edited, explicitly renamed, or linked to Google Drive.
 * - `'demote'`: auto-promoted starter (not explicitly renamed or linked to Drive) undone back to its initial state.
 * - `'save'`: ordinary build or kept starter build; save normally.
 */
export function starterSaveAction(build, history) {
  if (!build?.starter) return 'save';
  const locked = Boolean(build.starter.explicit || build.drive?.fileId);
  const atInitial = isStarterAtInitialState(build, history);
  if (build.unsaved) return locked || !atInitial ? 'promote' : 'skip';
  if (!locked && atInitial) return 'demote';
  return 'save';
}

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

/** Normalizes a local folder name: trimmed string, or null when blank. */
export function normalizeFolderName(name) {
  const trimmed = String(name ?? '').trim();
  return trimmed || null;
}

const round3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) || 0 : 0);
const roundVec = (v) => (Array.isArray(v) ? v.map(round3).join(',') : '');
const roundDeep = (val) => {
  if (typeof val === 'number') return round3(val);
  if (Array.isArray(val)) return val.map(roundDeep);
  if (val && typeof val === 'object') {
    const out = {};
    for (const k of Object.keys(val).sort()) {
      if (k === 'instanceId' || k === 'id') continue;
      out[k] = roundDeep(val[k]);
    }
    return out;
  }
  return val ?? null;
};

/**
 * Deterministic content fingerprint of a build's parts (openspec library-folders-and-select).
 * Matches builds with identical parts, positions, rotations, colors, and flexible geometry
 * (sheet bends, bands, ropes), ignoring build name, internal part IDs, part order, and history.
 */
export function buildFingerprint(instances) {
  const list = Array.isArray(instances) ? instances : [];
  if (list.length === 0) return '0:empty';
  const tokens = list.map((inst) => {
    const partId = String(inst?.partId ?? '');
    const pos = roundVec(inst?.position);
    const rot = roundVec(inst?.rotation);
    const color = String(inst?.color ?? '');
    const extra = [];
    if (inst?.bend) extra.push(`b:${JSON.stringify(roundDeep(inst.bend))}`);
    if (inst?.sheetBend) extra.push(`sb:${JSON.stringify(roundDeep(inst.sheetBend))}`);
    if (inst?.band) extra.push(`bd:${JSON.stringify(roundDeep(inst.band))}`);
    if (inst?.rope) extra.push(`rp:${JSON.stringify(roundDeep(inst.rope))}`);
    return `${partId}|${pos}|${rot}|${color}${extra.length ? `|${extra.join('|')}` : ''}`;
  });
  tokens.sort();
  // Two independent 32-bit FNV-1a hashes combined into a 16-hex-char 64-bit digest
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < tokens.length; i++) {
    const s = tokens[i];
    for (let j = 0; j < s.length; j++) {
      const c = s.charCodeAt(j);
      h1 = Math.imul(h1 ^ c, 0x01000193);
      h2 = Math.imul(h2 ^ ((c + j) & 0xffff), 0x85ebca6b);
    }
    h1 = Math.imul(h1 ^ 0x1f, 0x01000193);
    h2 = Math.imul(h2 ^ 0x1f, 0x85ebca6b);
  }
  const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
  return `${list.length}:${hex(h1)}${hex(h2)}`;
}

/**
 * Groups builds that share the exact same content fingerprint (2+ copies only).
 * Within each group, picks one `keepId` to leave unselected on "Select extras" (preferring a
 * Drive-linked build, then the currently open build, otherwise the most recently updated copy).
 */
export function groupDuplicateBuilds(builds, currentId = null) {
  const byRecent = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
  const buckets = new Map();
  for (const b of builds || []) {
    if (!b?.fingerprint) continue;
    let list = buckets.get(b.fingerprint);
    if (!list) {
      list = [];
      buckets.set(b.fingerprint, list);
    }
    list.push(b);
  }
  const groups = [];
  for (const [fp, list] of buckets.entries()) {
    if (list.length < 2) continue;
    list.sort(byRecent);
    const keep = list.find((b) => Boolean(b.drive?.fileId)) || list.find((b) => b.id === currentId) || list[0];
    const extraIds = list.filter((b) => b.id !== keep.id).map((b) => b.id);
    const displayName = keep.name || 'Untitled build';
    groups.push({
      key: `dup:${fp}`,
      kind: 'duplicate-group',
      fingerprint: fp,
      name: displayName,
      displayName,
      builds: list,
      keepId: keep.id,
      extraIds
    });
  }
  groups.sort((a, b) => b.builds.length - a.builds.length || (b.builds[0]?.updatedAt || 0) - (a.builds[0]?.updatedAt || 0));
  return groups;
}

/**
 * Groups library builds into sections for File → Load… (openspec library-folders-and-select):
 * - ungrouped local builds (`kind: 'local-ungrouped'`)
 * - single-level local folders (`kind: 'local-folder'`)
 * - Google Drive folders (`kind: 'drive-folder'`)
 * Whenever two or more folder sections share the same name (ignoring case), each colliding
 * folder's `displayName` appends its parent folder name in parentheses, e.g. `Drivetrains (2025)`.
 */
export function groupLibraryBuilds(builds) {
  const byRecent = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
  const ungrouped = [];
  const localMap = new Map();
  const driveMap = new Map();

  for (const b of builds || []) {
    if (b?.drive?.fileId) {
      const folderId = b.drive.folderId || null;
      const folderName = normalizeFolderName(b.drive.folderName);
      const parentFolderName = normalizeFolderName(b.drive.parentFolderName);
      const key = folderId
        ? `drive-id:${folderId}`
        : folderName
          ? `drive-name:${folderName.toLowerCase()}`
          : 'drive-default';
      let sec = driveMap.get(key);
      if (!sec) {
        const name = folderName || (folderId === 'my-drive' ? 'My Drive' : 'Google Drive');
        const parentName = parentFolderName || (folderId === 'my-drive' ? null : folderName ? 'Google Drive' : null);
        sec = { key, kind: 'drive-folder', folderId, name, parentName, builds: [] };
        driveMap.set(key, sec);
      } else {
        if (folderName && (sec.name === 'Google Drive' || sec.name === 'My Drive')) sec.name = folderName;
        if (parentFolderName && (!sec.parentName || sec.parentName === 'Google Drive')) sec.parentName = parentFolderName;
      }
      sec.builds.push(b);
    } else {
      const folder = normalizeFolderName(b?.folder);
      if (!folder) {
        ungrouped.push(b);
      } else {
        const lower = folder.toLowerCase();
        let sec = localMap.get(lower);
        if (!sec) {
          sec = { key: `local:${lower}`, kind: 'local-folder', name: folder, parentName: 'Local', builds: [] };
          localMap.set(lower, sec);
        }
        sec.builds.push(b);
      }
    }
  }

  ungrouped.sort(byRecent);
  const sortSections = (list) => {
    for (const s of list) s.builds.sort(byRecent);
    return list.sort((a, b) => (b.builds[0]?.updatedAt || 0) - (a.builds[0]?.updatedAt || 0));
  };
  const localFolders = sortSections([...localMap.values()]);
  const driveFolders = sortSections([...driveMap.values()]);

  // Disambiguate duplicate folder names across all folder sections (local + Drive)
  const allFolders = [...localFolders, ...driveFolders];
  const nameCounts = new Map();
  for (const s of allFolders) {
    const k = s.name.trim().toLowerCase();
    nameCounts.set(k, (nameCounts.get(k) || 0) + 1);
  }
  for (const s of allFolders) {
    const collides = (nameCounts.get(s.name.trim().toLowerCase()) || 0) > 1;
    s.displayName = collides && s.parentName ? `${s.name} (${s.parentName})` : s.name;
  }
  // If two distinct folders still share an identical displayName (e.g. two Drive folders whose
  // parents were both unreadable under drive.file), number them so the user can tell them apart.
  const displayCounts = new Map();
  for (const s of allFolders) {
    const k = s.displayName.toLowerCase();
    displayCounts.set(k, (displayCounts.get(k) || 0) + 1);
  }
  const seenDisplay = new Map();
  for (const s of allFolders) {
    const k = s.displayName.toLowerCase();
    if ((displayCounts.get(k) || 0) > 1) {
      const n = (seenDisplay.get(k) || 0) + 1;
      seenDisplay.set(k, n);
      if (n > 1) s.displayName = `${s.displayName} ${n}`;
    }
  }

  const sections = [...driveFolders];
  if (ungrouped.length > 0) {
    sections.push({ key: 'local-ungrouped', kind: 'local-ungrouped', name: 'Builds', displayName: 'Builds', parentName: null, builds: ungrouped });
  }
  sections.push(...localFolders);

  const localFolderNames = localFolders.map((s) => s.name).sort((a, b) => a.localeCompare(b));
  return { sections, localFolderNames };
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
    .map(({ id, name, createdAt, updatedAt, partCount, thumbnail, folder, drive, fingerprint, instances }) => ({
      id,
      name,
      createdAt,
      updatedAt,
      partCount,
      thumbnail,
      folder: normalizeFolderName(folder),
      fingerprint: fingerprint || (Array.isArray(instances) ? buildFingerprint(instances) : null),
      drive: drive?.fileId
        ? {
            fileId: drive.fileId,
            folderId: drive.folderId ?? null,
            folderName: normalizeFolderName(drive.folderName),
            parentFolderName: normalizeFolderName(drive.parentFolderName)
          }
        : null
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getBuild = (id) => run('readonly', (store) => store.get(id));

/** The saved build linked to a Google Drive file (openspec google-drive-sync), or null. */
export async function findBuildByDriveFile(fileId) {
  const all = (await run('readonly', (store) => store.getAll())) || [];
  return all.find((b) => b.drive?.fileId === fileId) ?? null;
}
export const putBuild = (record) => {
  const next = record && Array.isArray(record.instances) ? { ...record, fingerprint: buildFingerprint(record.instances) } : record;
  return run('readwrite', (store) => store.put(next));
};
export const deleteBuild = (id) => run('readwrite', (store) => store.delete(id));

/** Deletes multiple builds in one transaction. */
export async function deleteBuilds(ids) {
  const unique = [...new Set(ids || [])].filter(Boolean);
  if (!unique.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of unique) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Sets or clears `folder` on local builds in `ids` (Drive-linked builds are skipped so they stay
 * grouped by their Google Drive folder).
 */
export async function setBuildsFolder(ids, folderName) {
  const unique = [...new Set(ids || [])].filter(Boolean);
  if (!unique.length) return;
  const folder = normalizeFolderName(folderName);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of unique) {
      const req = store.get(id);
      req.onsuccess = () => {
        const rec = req.result;
        if (!rec || rec.drive?.fileId) return;
        const next = { ...rec };
        if (folder) next.folder = folder;
        else delete next.folder;
        store.put(next);
      };
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Renames (or removes, when `newName` is blank/null) a local folder across all local builds in it. */
export async function renameLocalFolder(oldName, newName) {
  const oldKey = normalizeFolderName(oldName)?.toLowerCase();
  if (!oldKey) return;
  const nextFolder = normalizeFolderName(newName);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      for (const rec of req.result || []) {
        if (rec.drive?.fileId) continue;
        if (normalizeFolderName(rec.folder)?.toLowerCase() !== oldKey) continue;
        const next = { ...rec };
        if (nextFolder) next.folder = nextFolder;
        else delete next.folder;
        store.put(next);
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
