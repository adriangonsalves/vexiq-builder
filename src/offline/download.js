/**
 * Downloading the static site for offline use (openspec offline-app). The build lists every file
 * with its size and hash in `offline-manifest.json`; a version is downloaded into its own cache,
 * `vexiq-offline-<version>`, and marked complete with a `__complete__` entry holding that list. The
 * service worker serves the version the active pointer names (src/offline/sw.js).
 */
import { assetUrl } from '../utils/assetUrl.js';

export const CACHE_PREFIX = 'vexiq-offline-';
export const ACTIVE_CACHE = 'vexiq-offline-active';
const COMPLETE_KEY = '__complete__';
const ACTIVE_KEY = '__active__';
const PARALLEL = 4;
const TRIES = 3;
const SPACE_MARGIN = 1.1; // the download needs this much more than its size, to be safe
const LOCK_NAME = 'vexiq-offline-download';
// Marks the downloader's requests, so the service worker fetches them instead of answering from
// the copy (a changed file keeps its name: models, catalog.json, index.html)
const DOWNLOAD_HEADER = 'x-vexiq-offline-download';

export const offlineSupported = () => typeof caches !== 'undefined' && 'serviceWorker' in navigator;

/** Why a download stopped: `reason` is 'cancelled', 'offline', 'space', 'failed' or 'busy'. */
export class DownloadStop extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

const cacheName = (version) => `${CACHE_PREFIX}${version}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The newest published file list. Throws when it can't be fetched (offline, or the host is down). */
export async function fetchManifest() {
  const res = await fetch(assetUrl('offline-manifest.json'), { cache: 'no-store' });
  if (!res.ok) throw new Error(`offline-manifest.json: ${res.status}`);
  return res.json();
}

/** `{ needed, available }` in bytes; `available` is null where the browser doesn't say. */
export async function spaceFor(manifest) {
  const needed = manifest.total;
  try {
    const { quota, usage } = (await navigator.storage?.estimate?.()) ?? {};
    return { needed, available: Number.isFinite(quota) ? Math.max(0, quota - (usage ?? 0)) : null };
  } catch {
    return { needed, available: null };
  }
}

export const enoughSpace = ({ needed, available }) => available == null || available >= needed * SPACE_MARGIN;

/** The active version's file list (complete by definition), or null when there is none. */
export async function activeManifest() {
  if (!offlineSupported() || !(await caches.has(ACTIVE_CACHE))) return null;
  const pointer = await (await caches.open(ACTIVE_CACHE)).match(assetUrl(ACTIVE_KEY));
  if (!pointer) return null;
  const complete = await (await caches.open(await pointer.text())).match(assetUrl(COMPLETE_KEY));
  return complete ? complete.json() : null;
}

/** Bytes of `manifest` already saved in its version's cache (a stopped download's progress). */
export async function savedBytes(manifest) {
  if (!(await caches.has(cacheName(manifest.version)))) return 0;
  const cache = await caches.open(cacheName(manifest.version));
  const have = new Set((await cache.keys()).map((req) => req.url));
  return manifest.files.reduce((sum, f) => sum + (have.has(new URL(assetUrl(f.path), location.href).href) ? f.size : 0), 0);
}

/** One file, checked against its listed size; tried TRIES times before giving up. */
async function fetchFile(file, signal) {
  let lastError = null;
  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    if (signal?.aborted) throw new DownloadStop('cancelled', 'Download cancelled');
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(assetUrl(file.path), { cache: 'no-cache', headers: { [DOWNLOAD_HEADER]: '1' }, signal });
      if (!res.ok) throw new Error(`${res.status}`);
      const body = await res.blob();
      if (body.size !== file.size) throw new Error(`${body.size} bytes, expected ${file.size}`);
      return new Response(body, { headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream' } });
    } catch (err) {
      if (signal?.aborted) throw new DownloadStop('cancelled', 'Download cancelled');
      if (!navigator.onLine) throw new DownloadStop('offline', 'The connection was lost');
      lastError = err;
    }
  }
  throw new DownloadStop('failed', `Couldn't download ${file.path} (${lastError?.message ?? 'error'})`);
}

/**
 * Saves every file of `manifest` that isn't saved yet, then marks the version complete. Files with
 * the same hash in `previous` (the active version's list) are copied from its cache instead of
 * fetched. `onProgress(done, total)` in bytes (for an update, only the bytes fetched). Throws
 * DownloadStop when it stops early; what is saved stays, so running it again resumes. Only one tab
 * downloads at a time.
 */
export async function downloadVersion(manifest, { previous = null, onProgress, signal } = {}) {
  const run = async () => {
    const cache = await caches.open(cacheName(manifest.version));
    const have = new Set((await cache.keys()).map((req) => req.url));
    const urlOf = (file) => new URL(assetUrl(file.path), location.href).href;
    const missing = manifest.files.filter((f) => !have.has(urlOf(f)));

    // Unchanged files come from the version already downloaded, and don't count in the progress
    const oldCache = previous && previous.version !== manifest.version ? await caches.open(cacheName(previous.version)) : null;
    const oldByHash = new Map((previous?.files ?? []).map((f) => [`${f.hash} ${f.size}`, f]));
    const copyFrom = new Map(); // file path -> the old copy's URL
    if (oldCache) {
      for (const file of missing) {
        const old = oldByHash.get(`${file.hash} ${file.size}`);
        if (old && (await oldCache.match(urlOf(old)))) copyFrom.set(file.path, urlOf(old));
      }
    }
    const fetchBytes = missing.reduce((sum, f) => sum + (copyFrom.has(f.path) ? 0 : f.size), 0);
    const total = oldCache ? fetchBytes : manifest.total;
    let done = total - fetchBytes;
    onProgress?.(done, total);

    const queue = [...missing];
    let stopped = false; // one worker stopping stops the others after their current file
    const worker = async () => {
      while (queue.length && !stopped) {
        if (signal?.aborted) throw new DownloadStop('cancelled', 'Download cancelled');
        const file = queue.shift();
        const copied = copyFrom.has(file.path) ? await oldCache.match(copyFrom.get(file.path)) : null;
        const response = copied ?? (await fetchFile(file, signal));
        try {
          await cache.put(urlOf(file), response);
        } catch (err) {
          if (err?.name === 'QuotaExceededError') throw new DownloadStop('space', 'There isn’t enough space on this device');
          throw new DownloadStop('failed', `Couldn't save ${file.path} (${err?.message ?? 'error'})`);
        }
        if (copied) continue;
        done += file.size;
        onProgress?.(done, total);
      }
    };
    const guarded = () =>
      worker().catch((err) => {
        stopped = true;
        throw err;
      });
    const results = await Promise.allSettled(Array.from({ length: Math.min(PARALLEL, queue.length) }, guarded));
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) {
      throw failed.reason instanceof DownloadStop ? failed.reason : new DownloadStop('failed', String(failed.reason?.message ?? failed.reason));
    }
    await cache.put(assetUrl(COMPLETE_KEY), new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/json' } }));
  };
  if (!navigator.locks) return run();
  return navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => {
    if (!lock) throw new DownloadStop('busy', 'Downloading in another tab');
    return run();
  });
}

/** The service worker for the site, registered and running (registers it if needed). */
async function readyWorker() {
  await navigator.serviceWorker.register(assetUrl('sw.js'), { scope: assetUrl('') });
  const reg = await navigator.serviceWorker.ready;
  return reg.active;
}

/**
 * Makes a complete version the one the site runs offline: registers the service worker if needed,
 * and has it point at the version and drop older copies.
 */
export async function activateVersion(version) {
  const worker = await readyWorker();
  const reply = await new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => resolve(event.data);
    worker.postMessage({ type: 'activate-version', version }, [channel.port2]);
  });
  if (!reply?.ok) throw new Error(reply?.error ?? 'Could not switch to the new version');
}

/** Deletes every downloaded copy and unregisters the service worker. Builds are not touched. */
export async function removeOfflineCopy() {
  if (!offlineSupported()) return;
  for (const reg of await navigator.serviceWorker.getRegistrations()) {
    if (reg.scope === new URL(assetUrl(''), location.href).href) await reg.unregister();
  }
  for (const key of await caches.keys()) if (key.startsWith(CACHE_PREFIX)) await caches.delete(key);
}

/** Asks the browser to keep the site's data; true when it will. */
export async function requestPersistence() {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return Boolean(await navigator.storage?.persist?.());
  } catch {
    return false;
  }
}

export async function isPersisted() {
  try {
    return Boolean(await navigator.storage?.persisted?.());
  } catch {
    return false;
  }
}
