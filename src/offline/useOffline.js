/**
 * Offline use on the static site (openspec offline-app): the Use offline switch's state, the
 * download with progress, cancel and resume, the check for a newer published version, persistent
 * storage, and how this browser installs the app. The downloaded copies (Cache Storage) are the
 * source of truth; a small localStorage record adds what the caches can't say (why a download
 * stopped, when the copy was made, a newer version already seen).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DownloadStop,
  activateVersion,
  activeManifest,
  downloadVersion,
  enoughSpace,
  fetchManifest,
  isPersisted,
  offlineSupported,
  removeOfflineCopy,
  requestPersistence,
  savedBytes,
  spaceFor
} from './download.js';
import { installKind, isAppleMobile, isInstalled, onInstallChange, promptInstall } from './install.js';

const RECORD_KEY = 'vexiq-offline';
const CHECK_EVERY_MS = 60_000; // version checks at most this often

function readRecord() {
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECORD_KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeRecord(patch) {
  const next = { ...readRecord(), ...patch };
  try {
    window.localStorage.setItem(RECORD_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the caches still say what was downloaded
  }
  return next;
}

/** "About 90 MB", "41 of 90 MB". */
export const formatMB = (bytes) => `${Math.max(0, Math.round(bytes / 1e6))} MB`;

/**
 * `status` is one of:
 * - 'off': not downloaded, switch off;
 * - 'ios-first': iPad/iPhone Safari, showing the Home Screen steps before anything downloads;
 * - 'checking': fetching the file list to show the size;
 * - 'confirm': showing the size and space, waiting for Download or Cancel;
 * - 'downloading': with `progress`;
 * - 'available': the copy is complete and current;
 * - 'update': a newer version is published (the older copy still works offline);
 * - 'stopped': switch on, no complete copy (see `stop`).
 *
 * `onBeforeReload` runs (awaited) before the page reloads into a newly downloaded version.
 */
export default function useOffline({ enabled = true, onBeforeReload } = {}) {
  const supported = enabled && offlineSupported();
  const [status, setStatus] = useState('off');
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [space, setSpace] = useState(null); // { needed, available } for 'confirm'
  const [stop, setStop] = useState(null); // { reason, message } for the last stopped download
  const [active, setActive] = useState(null); // the downloaded version's file list
  const [downloadedAt, setDownloadedAt] = useState(null);
  const [persisted, setPersisted] = useState(null);
  const [install, setInstall] = useState(() => (supported ? installKind() : 'other'));
  const [showUpdateMessage, setShowUpdateMessage] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [notice, setNotice] = useState(null); // a one-line message in the section (can't reach the site…)
  const [updating, setUpdating] = useState(false); // the download in progress is an update

  const abortRef = useRef(null);
  const latestRef = useRef(null); // the newest file list seen
  const pendingManifestRef = useRef(null); // the list 'confirm' would download
  const lastCheckRef = useRef(0);
  const dismissedRef = useRef(null); // the newer version whose message was put off with Later
  const statusRef = useRef(status);
  statusRef.current = status;
  const activeRef = useRef(active);
  activeRef.current = active;
  const beforeReloadRef = useRef(onBeforeReload);
  beforeReloadRef.current = onBeforeReload;

  // Where things stand when the app opens
  useEffect(() => {
    if (!supported) return undefined;
    let cancelled = false;
    (async () => {
      const record = readRecord();
      const current = await activeManifest().catch(() => null);
      if (cancelled) return;
      setPersisted(await isPersisted());
      if (current) {
        setActive(current);
        setDownloadedAt(record.downloadedAt ?? null);
        const newer = record.newerVersion && record.newerVersion !== current.version;
        setStatus(newer ? 'update' : 'available');
        if (newer && record.stop) setStop(record.stop);
        // The copy is there but its worker isn't (site data partly cleared): register it again
        const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
        if (!reg) activateVersion(current.version).catch(() => {});
      } else if (record.enabled) {
        setStop(
          record.downloadedAt
            ? { reason: 'removed', message: 'The browser removed the offline copy' }
            : (record.stop ?? { reason: 'stopped', message: 'The download stopped' })
        );
        setStatus('stopped');
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  useEffect(() => (supported ? onInstallChange(() => setInstall(installKind())) : undefined), [supported]);

  /** Downloads `manifest` (first download, resume or update) and makes it the version used offline. */
  const runDownload = useCallback(async (manifest, { update = false } = {}) => {
    const controller = new AbortController();
    abortRef.current = controller;
    writeRecord({ enabled: true, stop: null });
    setStop(null);
    setNotice(null);
    setUpdating(update);
    setShowUpdateMessage(false);
    setStatus('downloading');
    setProgress({ done: 0, total: 0 }); // until the download has looked at what is already saved
    requestPersistence().then(setPersisted);
    try {
      await downloadVersion(manifest, {
        previous: activeRef.current,
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total })
      });
      await activateVersion(manifest.version);
      writeRecord({ downloadedAt: Date.now(), newerVersion: null, stop: null });
      if (update) {
        // Into the new version, with the build saved first
        await beforeReloadRef.current?.();
        window.location.reload();
        return;
      }
      setActive(manifest);
      setDownloadedAt(Date.now());
      setStatus('available');
      setShowInstallGuide(true);
    } catch (err) {
      const reason = err instanceof DownloadStop ? { reason: err.reason, message: err.message } : { reason: 'failed', message: String(err?.message ?? err) };
      writeRecord({ stop: reason });
      setStop(reason);
      setStatus(update ? 'update' : 'stopped');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setUpdating(false);
    }
  }, []);

  /** Fetches the file list and shows its size and the space there is. */
  const showSizeCheck = useCallback(async () => {
    setNotice(null);
    setStatus('checking');
    try {
      const manifest = await fetchManifest();
      latestRef.current = manifest;
      pendingManifestRef.current = manifest;
      const room = await spaceFor(manifest);
      if (!enoughSpace(room)) {
        setNotice(`There isn’t enough space on this device. It needs about ${formatMB(room.needed)}; about ${formatMB(room.available)} is free.`);
        setStatus('off');
        return;
      }
      setSpace(room);
      setStatus('confirm');
    } catch {
      setNotice('Can’t reach the site to download it. Check the internet connection and try again.');
      setStatus('off');
    }
  }, []);

  /** The Use offline switch turned on. */
  const turnOn = useCallback(() => {
    if (isAppleMobile() && !isInstalled()) setStatus('ios-first');
    else showSizeCheck();
  }, [showSizeCheck]);

  const confirmDownload = useCallback(() => {
    const manifest = pendingManifestRef.current;
    if (manifest) runDownload(manifest);
  }, [runDownload]);

  /** Cancel on the size check: the switch goes back off. */
  const cancelConfirm = useCallback(() => {
    pendingManifestRef.current = null;
    setStatus('off');
  }, []);

  const cancelDownload = useCallback(() => abortRef.current?.abort(), []);

  /** Resume a stopped first download, or download the newest version (Download update). */
  const resume = useCallback(async () => {
    const update = Boolean(activeRef.current);
    let manifest;
    try {
      manifest = await fetchManifest();
      latestRef.current = manifest;
    } catch {
      const offline = { reason: 'offline', message: 'No internet connection. Connect and try again.' };
      setStop(offline);
      return;
    }
    if (update && manifest.version === activeRef.current.version) {
      // Nothing newer after all (the release was taken back)
      writeRecord({ newerVersion: null, stop: null });
      setStop(null);
      setStatus('available');
      return;
    }
    if (!update) {
      // A first download needs the space it hasn't saved yet
      const room = await spaceFor(manifest);
      const left = { ...room, needed: manifest.total - (await savedBytes(manifest)) };
      if (!enoughSpace(left)) {
        const reason = { reason: 'space', message: 'There isn’t enough space on this device' };
        writeRecord({ stop: reason });
        setStop(reason);
        return;
      }
    }
    runDownload(manifest, { update });
  }, [runDownload]);

  /** The switch turned off (after the caller has asked): removes every downloaded copy. */
  const turnOff = useCallback(async () => {
    abortRef.current?.abort();
    await removeOfflineCopy().catch(() => {});
    try {
      window.localStorage.removeItem(RECORD_KEY);
    } catch {
      // nothing saved
    }
    setActive(null);
    setDownloadedAt(null);
    setStop(null);
    setNotice(null);
    setShowUpdateMessage(false);
    setShowInstallGuide(false);
    setStatus('off');
  }, []);

  /** Asks the site for its newest file list; a newer version turns the copy into 'update'. */
  const checkForUpdate = useCallback(async ({ force = false } = {}) => {
    const current = activeRef.current;
    if (!current || statusRef.current === 'downloading') return;
    const now = Date.now();
    if (!force && now - lastCheckRef.current < CHECK_EVERY_MS) return;
    lastCheckRef.current = now;
    let latest;
    try {
      latest = await fetchManifest();
    } catch {
      return; // offline or the site is down: not a new version
    }
    latestRef.current = latest;
    if (latest.version === current.version) {
      if (readRecord().newerVersion) writeRecord({ newerVersion: null });
      if (statusRef.current === 'update') {
        setStatus('available');
        setStop(null);
      }
      setShowUpdateMessage(false);
      return;
    }
    writeRecord({ newerVersion: latest.version });
    setStatus('update');
    if (dismissedRef.current !== latest.version) setShowUpdateMessage(true);
  }, []);

  // Checked on opening, on coming back online and on returning to the app
  useEffect(() => {
    if (!supported || !ready || !active) return undefined;
    checkForUpdate({ force: true });
    const onOnline = () => checkForUpdate({ force: true });
    const onVisible = () => document.visibilityState === 'visible' && checkForUpdate();
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [supported, ready, active, checkForUpdate]);

  /** Later: the message stays hidden for this version until the app is opened again. */
  const dismissUpdate = useCallback(() => {
    dismissedRef.current = readRecord().newerVersion ?? null;
    setShowUpdateMessage(false);
  }, []);

  const handlePromptInstall = useCallback(async () => {
    await promptInstall();
    setInstall(installKind());
  }, []);

  return {
    supported,
    ready,
    status,
    progress,
    space,
    stop,
    notice,
    updating,
    downloadedAt,
    persisted,
    install,
    showUpdateMessage,
    showInstallGuide,
    setShowInstallGuide,
    turnOn,
    showSizeCheck,
    confirmDownload,
    cancelConfirm,
    cancelDownload,
    resume,
    turnOff,
    dismissUpdate,
    promptInstall: handlePromptInstall
  };
}
