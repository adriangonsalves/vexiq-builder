/**
 * Lock and conflict rules for builds kept on Google Drive (openspec google-drive-sync).
 *
 * The lock lives in the Drive file's `appProperties` (strings only):
 *   lockHolderId   this browser's client id
 *   lockHolderName the signed-in person's display name
 *   lockAt         epoch ms when taken
 *   lockExpiresAt  epoch ms when the lease runs out (taken + 2 minutes, pushed on by the heartbeat)
 *
 * Drive doesn't honour If-Match (trial result 1), so a lock is taken by writing it, waiting, and
 * reading it back (driveClient.acquireLock). Everything here is pure, so the Node check can run it.
 */

export const LOCK_LEASE_MS = 120_000;
export const HEARTBEAT_MS = 45_000;
export const FOLLOW_UP_CHECK_MS = 5_000;
export const VIEWER_POLL_MS = 10_000;
export const LOCK_READ_BACK_MS = 400;
export const LOCK_READ_BACK_JITTER_MS = 150;

export const CLIENT_ID_KEY = 'vexiq.driveClientId';
export const LAST_FOLDER_KEY = 'vexiq.driveLastFolder';

/** The Drive folder this browser saved a new build to last ({ id, name }), or null. */
export function readLastFolder(storage = globalThis.localStorage) {
  try {
    const f = JSON.parse(storage?.getItem(LAST_FOLDER_KEY) || 'null');
    return f?.id ? { id: String(f.id), name: String(f.name || 'your folder') } : null;
  } catch {
    return null;
  }
}

/** Remembers (or, with null, forgets) the folder for the next Save to Google Drive…. */
export function writeLastFolder(folder, storage = globalThis.localStorage) {
  try {
    if (folder?.id) storage?.setItem(LAST_FOLDER_KEY, JSON.stringify({ id: folder.id, name: folder.name }));
    else storage?.removeItem?.(LAST_FOLDER_KEY);
  } catch {
    /* storage blocked: the choice just isn't remembered */
  }
}
export const LOCK_KEYS = ['lockHolderId', 'lockHolderName', 'lockAt', 'lockExpiresAt'];

const randomPart = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
let memoryClientId = null;

/**
 * This browser's lock identity, kept in localStorage so a reload keeps the same lock. Falls back to
 * one id for the page's life when storage is blocked (private browsing).
 */
export function getOrCreateClientId(storage = globalThis.localStorage) {
  try {
    const saved = storage?.getItem(CLIENT_ID_KEY);
    if (saved) return saved;
    const id = `client-${randomPart()}`;
    storage?.setItem(CLIENT_ID_KEY, id);
    if (storage?.getItem(CLIENT_ID_KEY) === id) return id;
  } catch {
    /* storage blocked */
  }
  memoryClientId ??= `client-${randomPart()}`;
  return memoryClientId;
}

/** Whether someone holds an unexpired lock. */
export function isLockActive(props, now = Date.now()) {
  return Boolean(props?.lockHolderId) && Number(props.lockExpiresAt) > now;
}

/** Whether this browser holds the lock (expired or not: the lease may just need pushing on). */
export const holdsLock = (props, clientId) => Boolean(clientId) && props?.lockHolderId === clientId;

/** Whether this browser may write its lock: nobody holds an unexpired one, or it is already ours. */
export function canAcquireLock(props, clientId, now = Date.now()) {
  return !isLockActive(props, now) || holdsLock(props, clientId);
}

/** Who holds the lock, for "Read-only · Locked by <name>". */
export const lockHolderName = (props) => String(props?.lockHolderName || '').trim() || 'a teammate';

/** The appProperties that take (or extend) the lock. */
export function buildLockProps({ clientId, name, now = Date.now(), lockAt = now }) {
  return {
    lockHolderId: clientId,
    lockHolderName: String(name || '').slice(0, 60),
    lockAt: String(lockAt),
    lockExpiresAt: String(now + LOCK_LEASE_MS)
  };
}

/** The appProperties that release the lock (Drive deletes a key set to null). */
export const clearLockProps = () => Object.fromEntries(LOCK_KEYS.map((k) => [k, null]));

/** The lock as the Drive button and banners need it. */
export function lockState(props, clientId, now = Date.now()) {
  const active = isLockActive(props, now);
  const mine = holdsLock(props, clientId);
  return { active, mine, byOther: active && !mine, holderName: active && !mine ? lockHolderName(props) : '' };
}

/**
 * Whether a Drive-linked build has changes Drive hasn't got: parts or history changed since the last
 * Drive save, or the build was renamed.
 */
export function hasUnsavedDriveChanges(drive, { rev, name } = {}) {
  if (!drive?.fileId) return false;
  return rev !== drive.lastSyncedRev || name !== drive.lastSyncedName;
}

/**
 * The check before every upload (Save to Drive, Done editing, Save and leave). Never overwrites a
 * file someone else changed: a new headRevisionId is a conflict even when this browser's id is
 * still in the lock fields (two sessions can both pass a lock race; trial result 2 says only
 * content saves move headRevisionId).
 *   { safe: true, needsLock }        upload; needsLock = take the lock with write-wait-read first
 *   { safe: false, reason, holderName } reason: 'read-only' | 'locked-by-other' | 'changed'
 */
export function checkPreSaveSafety({ meta, clientId, lastSyncedHeadRevisionId, now = Date.now() }) {
  const props = meta?.appProperties ?? {};
  if (meta?.capabilities?.canEdit === false) return { safe: false, reason: 'read-only', holderName: '' };
  if (isLockActive(props, now) && !holdsLock(props, clientId)) {
    return { safe: false, reason: 'locked-by-other', holderName: lockHolderName(props) };
  }
  if (lastSyncedHeadRevisionId && meta?.headRevisionId !== lastSyncedHeadRevisionId) {
    return { safe: false, reason: 'changed', holderName: '' };
  }
  return { safe: true, needsLock: !(holdsLock(props, clientId) && isLockActive(props, now)) };
}

/**
 * What the 45-second heartbeat (and waking the tab) does in Edit mode:
 *   'extend'   our lock, file unchanged: push lockExpiresAt on
 *   'reacquire' lock ran out while asleep, nobody took it, file unchanged: write-wait-read again
 *   'lost'     someone else holds it, or the file changed: leave Edit mode
 */
export function heartbeatOutcome({ meta, clientId, lastSyncedHeadRevisionId, now = Date.now() }) {
  const props = meta?.appProperties ?? {};
  const changed = Boolean(lastSyncedHeadRevisionId) && meta?.headRevisionId !== lastSyncedHeadRevisionId;
  if (changed) return 'lost';
  if (holdsLock(props, clientId)) return 'extend';
  if (!isLockActive(props, now)) return 'reacquire';
  return 'lost';
}

/**
 * Where a paused build goes after Reconnect to Drive (and where an Edit-mode build goes when the
 * heartbeat says 'lost'):
 *   'edit'     nobody else locked or saved: take the lock, keep local edits for Save to Drive
 *   'readonly' someone else locked or saved, and there are no local edits: load the latest, view only
 *   'conflict' someone else locked or saved, and there are local edits: the changed-on-Drive prompt
 */
export function reconnectOutcome({ meta, clientId, lastSyncedHeadRevisionId, dirty, now = Date.now() }) {
  const props = meta?.appProperties ?? {};
  const changed = Boolean(lastSyncedHeadRevisionId) && meta?.headRevisionId !== lastSyncedHeadRevisionId;
  const lockedByOther = isLockActive(props, now) && !holdsLock(props, clientId);
  if (!changed && !lockedByOther && meta?.capabilities?.canEdit !== false) return 'edit';
  return dirty ? 'conflict' : 'readonly';
}
