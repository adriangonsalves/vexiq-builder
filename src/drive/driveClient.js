/**
 * Google Drive REST v3 calls for builds kept on Drive (openspec google-drive-sync). Straight from the
 * browser with the signed-in person's token; no server of ours.
 *
 * Shared folders between personal accounts are the case this supports (design decision 2). Shared
 * drives are not: no request sets `supportsAllDrives`.
 *
 * Every call goes through `transport(method, url, { headers, body, keepalive })`, which resolves to
 * `{ status, ok, text }`. The browser uses fetch; the Node check passes a pretend Drive.
 */
import { LOCK_READ_BACK_JITTER_MS, LOCK_READ_BACK_MS, buildLockProps, canAcquireLock, clearLockProps, heartbeatOutcome, holdsLock } from './driveLock.js';

export const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_ABOUT_URL = 'https://www.googleapis.com/drive/v3/about';
export const META_FIELDS = 'id,name,headRevisionId,modifiedTime,parents,appProperties,capabilities(canEdit)';
export const BUILD_FILE_MIME = 'application/json';

/** A failed Drive call. `kind`: 'network' | 'auth' (sign-in ran out) | 'not-found' | 'forbidden' | 'other'. */
export class DriveError extends Error {
  constructor(message, { status = 0, kind = 'other' } = {}) {
    super(message);
    this.name = 'DriveError';
    this.status = status;
    this.kind = kind;
  }
}
const kindFor = (status) => (status === 401 ? 'auth' : status === 404 ? 'not-found' : status === 403 ? 'forbidden' : 'other');
/** Whether an error means "can't reach Drive right now" (keep editing, show Reconnect to Drive). */
export const isConnectionError = (err) => err?.kind === 'network' || err?.kind === 'auth';

/** The browser transport. */
export async function fetchTransport(method, url, { headers = {}, body, keepalive = false } = {}) {
  const res = await fetch(url, { method, headers, body, keepalive });
  return { status: res.status, ok: res.ok, text: await res.text() };
}

/** The `.vexiq.json` content saved to Drive: the same shape as Export, with every part kept. */
export function buildFileContent({ name, instances, history, now = Date.now() }) {
  return {
    version: '1.1',
    pitchUnitMm: 12.7,
    name,
    exportedAt: new Date(now).toISOString(),
    instances,
    history,
    historyRev: history?.rev
  };
}

/** Parses a downloaded build file. Throws when it isn't a build. */
export function parseBuildFile(text) {
  const parsed = typeof text === 'string' ? JSON.parse(text) : text;
  if (!parsed || !Array.isArray(parsed.instances)) throw new Error('it has no parts list');
  return parsed;
}

function multipart(metadata, content) {
  const boundary = `vexiq${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${BUILD_FILE_MIME}\r\n\r\n${JSON.stringify(content)}\r\n--${boundary}--`;
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/**
 * @param {object} o
 * @param {() => string|null} o.getToken  the current access token
 * @param {Function} [o.transport]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @param {() => number} [o.random]
 * @param {() => number} [o.now]
 */
export function createDriveClient({ getToken, transport = fetchTransport, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), random = Math.random, now = Date.now }) {
  async function call(method, url, { headers = {}, body, raw = false, keepalive = false } = {}) {
    const token = getToken();
    if (!token) throw new DriveError('Not signed in to Google', { kind: 'auth', status: 401 });
    let res;
    try {
      res = await transport(method, url, { headers: { Authorization: `Bearer ${token}`, ...headers }, body, keepalive });
    } catch (err) {
      throw new DriveError(`Couldn't reach Google Drive: ${err?.message || err}`, { kind: 'network' });
    }
    if (!res.ok) {
      let message = `Google Drive answered ${res.status}`;
      try {
        message = JSON.parse(res.text)?.error?.message || message;
      } catch {
        /* not JSON */
      }
      throw new DriveError(message, { status: res.status, kind: kindFor(res.status) });
    }
    if (raw) return res.text;
    return res.text ? JSON.parse(res.text) : {};
  }
  const fileUrl = (fileId, query = `fields=${encodeURIComponent(META_FIELDS)}`) => `${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?${query}`;
  const json = { 'Content-Type': 'application/json' };

  const getFileMeta = (fileId) => call('GET', fileUrl(fileId));
  /** Best-effort folder name/parent lookup under drive.file; returns null on 403/404. */
  async function getFolderInfo(folderId) {
    if (!folderId) return null;
    try {
      return await call('GET', fileUrl(folderId, `fields=${encodeURIComponent('id,name,parents')}`));
    } catch (err) {
      if (err instanceof DriveError && (err.kind === 'not-found' || err.kind === 'forbidden')) return null;
      throw err;
    }
  }
  const downloadBuildFile = async (fileId) => parseBuildFile(await call('GET', fileUrl(fileId, 'alt=media'), { raw: true }));
  const patchAppProperties = (fileId, appProperties) =>
    call('PATCH', fileUrl(fileId), { headers: json, body: JSON.stringify({ appProperties }) });

  /**
   * Makes a new build file. With `parents` (Save as a copy: the original's folder) it goes there; if
   * Drive refuses that folder it goes in My Drive instead. Returns { meta, inFolder }.
   */
  async function createBuildFile({ name, content, parents, appProperties }) {
    const send = (withParents) => {
      const metadata = { name, mimeType: BUILD_FILE_MIME, ...(withParents ? { parents } : {}), ...(appProperties ? { appProperties } : {}) };
      const { body, contentType } = multipart(metadata, content);
      return call('POST', `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=${encodeURIComponent(META_FIELDS)}`, { headers: { 'Content-Type': contentType }, body });
    };
    if (parents?.length) {
      try {
        return { meta: await send(true), inFolder: true };
      } catch (err) {
        if (!(err instanceof DriveError) || isConnectionError(err)) throw err;
      }
    }
    return { meta: await send(false), inFolder: false };
  }

  /** Uploads new content (and optionally a new name and lock fields in the same request). */
  function updateBuildFile(fileId, content, { name, appProperties } = {}) {
    const metadata = { ...(name ? { name } : {}), ...(appProperties ? { appProperties } : {}) };
    const { body, contentType } = multipart(metadata, content);
    return call('PATCH', `${DRIVE_UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${encodeURIComponent(META_FIELDS)}`, {
      headers: { 'Content-Type': contentType },
      body
    });
  }

  /**
   * Write, wait, read back (design decision 3; Drive ignores If-Match). Returns
   * { acquired, meta, reason } with reason 'read-only' | 'locked-by-other' | 'lost-race' when not.
   * `meta` is the latest read either way.
   */
  async function acquireLock(fileId, { clientId, name, shouldContinue = () => true }) {
    const before = await getFileMeta(fileId);
    if (before.capabilities?.canEdit === false) return { acquired: false, meta: before, reason: 'read-only' };
    if (!canAcquireLock(before.appProperties, clientId, now())) return { acquired: false, meta: before, reason: 'locked-by-other' };
    if (!shouldContinue()) return { acquired: false, meta: before, reason: 'skipped' };
    await patchAppProperties(fileId, buildLockProps({ clientId, name, now: now() }));
    await sleep(LOCK_READ_BACK_MS + Math.floor(random() * LOCK_READ_BACK_JITTER_MS));
    const after = await getFileMeta(fileId);
    const acquired = holdsLock(after.appProperties, clientId);
    return { acquired, meta: after, reason: acquired ? null : 'lost-race' };
  }

  /** Whether this browser still holds the lock (the 5-second follow-up check). */
  async function verifyLock(fileId, { clientId }) {
    const meta = await getFileMeta(fileId);
    return { held: holdsLock(meta.appProperties, clientId), meta };
  }

  /**
   * The heartbeat: reads the lock and headRevisionId before doing anything. Returns
   * { outcome: 'extend'|'reacquire'|'lost'|'skipped', held, meta }. `shouldContinue` is asked before
   * any write, so a heartbeat overtaken by a save or Done editing writes nothing ('skipped').
   */
  async function refreshLock(fileId, { clientId, name, lastSyncedHeadRevisionId, shouldContinue = () => true }) {
    const meta = await getFileMeta(fileId);
    const outcome = heartbeatOutcome({ meta, clientId, lastSyncedHeadRevisionId, now: now() });
    if (outcome !== 'lost' && !shouldContinue()) return { outcome: 'skipped', held: null, meta };
    if (outcome === 'extend') {
      const lockAt = Number(meta.appProperties?.lockAt) || now();
      const updated = await patchAppProperties(fileId, buildLockProps({ clientId, name, now: now(), lockAt }));
      return { outcome, held: true, meta: { ...meta, ...updated, appProperties: { ...meta.appProperties, ...updated.appProperties } } };
    }
    if (outcome === 'reacquire') {
      const res = await acquireLock(fileId, { clientId, name, shouldContinue });
      return { outcome: res.reason === 'skipped' ? 'skipped' : outcome, held: res.reason === 'skipped' ? null : res.acquired, meta: res.meta };
    }
    return { outcome, held: false, meta };
  }

  /** Done editing: clears the four lock fields. */
  const releaseLock = (fileId) => patchAppProperties(fileId, clearLockProps());

  /** Leaving the page with nothing unsaved: clear the lock in a request that outlives the page. */
  function releaseLockOnPageHide(fileId) {
    return call('PATCH', fileUrl(fileId, 'fields=id'), { headers: json, body: JSON.stringify({ appProperties: clearLockProps() }), keepalive: true });
  }

  /** The signed-in person's name, for "Locked by <name>" (trial result 5). */
  async function getDisplayName() {
    const about = await call('GET', `${DRIVE_ABOUT_URL}?fields=${encodeURIComponent('user(displayName)')}`);
    return about?.user?.displayName || '';
  }

  return {
    getFileMeta,
    getFolderInfo,
    downloadBuildFile,
    patchAppProperties,
    createBuildFile,
    updateBuildFile,
    acquireLock,
    verifyLock,
    refreshLock,
    releaseLock,
    releaseLockOnPageHide,
    getDisplayName
  };
}
