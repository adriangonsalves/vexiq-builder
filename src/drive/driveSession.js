/**
 * The Drive state of the open build (openspec google-drive-sync): Edit, Read-only or paused, the lock
 * timers, saving with the pre-save check, Done editing, leaving, reconnecting, the viewer's refresh,
 * and Work on this device only. Plain code with no React, so the Node check can drive it with a
 * pretend Drive and clock; useGoogleDrive.js connects it to the app.
 *
 * Modes (design decision 6): 'edit' | 'readonly' | 'disconnected' (paused). A build with no Drive
 * file has mode null and no Drive button.
 *
 * Actions that may need a sign-in (save, Done editing, Edit build, Reconnect, Open, Save to Google
 * Drive…, Save and leave) call auth.signInFromTap() before anything is awaited, so they must be
 * called straight from a tap.
 *
 * `host` is the app:
 *   getBuild()                       → { id, name, instances, history, drive } (drive: the link, or undefined)
 *   setDrive(drive | null)           store the link on the build (null: Work on this device only)
 *   isBusy()                         Play mode is on or the model is exploded (a refresh waits)
 *   replaceBuildContent(content)     → the history rev now open (a teammate's save; camera stays)
 *   saveLocalCopy({ name, instances, history })  → the name used (a new local build, no Drive link)
 *   linkAsNewFile({ name, drive })   the open build becomes this Drive file under this name
 *   openDriveBuild({ fileId, fileName, content, meta }) → { reused } (reused: the library already had it)
 *   notify(message, isError)
 *
 * `auth` also has openFolderPicker(token) → { id, name } | null for Save to Google Drive…'s
 * Choose a folder…; `storage` remembers the last folder.
 */
import { FOLLOW_UP_CHECK_MS, HEARTBEAT_MS, VIEWER_POLL_MS, buildLockProps, checkPreSaveSafety, hasUnsavedDriveChanges, lockState, readLastFolder, reconnectOutcome, writeLastFolder } from './driveLock.js';
import { driveButtonState } from './driveButton.js';
import { buildFileContent, isConnectionError } from './driveClient.js';

/** The changed-on-Drive prompt's message for each reason. */
export const CHANGED_ON_DRIVE = (name, reason) =>
  reason === 'read-only' ? `You can only view ${name} on Google Drive, so your changes can't be saved to it.` : `${name} was changed on Google Drive while your lock expired.`;
export const COPY_IN_MY_DRIVE = "Saved in your My Drive. Move it into your team's folder in Google Drive.";

/** `<Name>.vexiq.json`, with characters Drive file names can't hold replaced. */
const driveFileName = (name) => `${String(name || 'Build').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Build'}.vexiq.json`;
const baseName = (fileName) => String(fileName || '').replace(/\.vexiq\.json$|\.json$/i, '') || 'Build';

/**
 * @param {object} o
 * @param {object} o.client   createDriveClient(...)
 * @param {object} o.auth     { signInFromTap, getAccessToken, dropAccessToken, openDrivePicker, preload }
 * @param {object} o.host     see above
 * @param {string} o.clientId this browser's lock id
 * @param {object} [o.timers] { setTimeout, clearTimeout, setInterval, clearInterval, now }
 * @param {() => boolean} [o.isVisible]
 * @param {Storage} [o.storage]
 */
export function createDriveSession({ client, auth, host, clientId, timers = globalThis, isVisible = () => globalThis.document?.visibilityState !== 'hidden', storage = globalThis.localStorage }) {
  const now = () => (timers.now ? timers.now() : Date.now());
  const listeners = new Set();
  let s = {
    fileId: null,
    mode: null,
    connected: true,
    meta: null, // the latest Drive metadata read
    prompt: null, // { type: 'conflict', reason } | { type: 'leave' }
    banner: null, // 'paused' | 'unlocked'
    pending: null, // a teammate's save held while busy: { content, headRevisionId }
    needsContinue: null, // { retry } when a tap came before the Google scripts were ready
    working: false
  };
  let myName = '';
  let heartbeat = null;
  let followUp = null;
  let poll = null;
  let leaveResolve = null;
  // The leave question came from Open from Google Drive…: the build stays open afterwards (Read-only
  // after Save and leave, paused after Leave without saving) and the student taps Open again
  let leaveThenStay = false;
  // Timer jobs (heartbeat, follow-up, viewer poll) never overlap an action: they don't start while one
  // runs, an action waits for one in flight, and a job an action overtook ignores what it read.
  let timerJob = null;
  let actionSeq = 0;
  function runTimerJob(job) {
    if (s.working || timerJob) return timerJob ?? Promise.resolve();
    const seq = actionSeq;
    const stillValid = () => seq === actionSeq && !s.working;
    timerJob = job(stillValid).finally(() => {
      timerJob = null;
    });
    return timerJob;
  }
  /** Marks the start of an action and waits for a timer job in flight to finish. */
  function beginAction() {
    actionSeq += 1;
    return (timerJob ?? Promise.resolve()).catch(() => {});
  }

  const emit = () => listeners.forEach((fn) => fn());
  const set = (patch) => {
    s = { ...s, ...patch };
    emit();
  };
  const build = () => host.getBuild() ?? {};
  const drive = () => build().drive ?? null;
  const dirtyNow = () => hasUnsavedDriveChanges(drive(), { rev: build().history?.rev, name: build().name });
  const name = () => build().name || 'Build';
  const setDrive = (patch) => host.setDrive({ ...drive(), ...patch });
  const contentNow = () => {
    const b = build();
    return buildFileContent({ name: b.name, instances: b.instances, history: b.history, now: now() });
  };

  function stopTimers() {
    timers.clearInterval(heartbeat);
    timers.clearTimeout(followUp);
    timers.clearInterval(poll);
    heartbeat = followUp = poll = null;
  }

  // --- sign-in from a tap -------------------------------------------------------------------
  function withToken(run) {
    if (s.working) return Promise.resolve(false);
    const r = auth.signInFromTap();
    if (r.unavailable) {
      host.notify("Google Drive can't be reached right now.", true);
      return Promise.resolve(false);
    }
    if (r.needsContinue) {
      set({ needsContinue: { retry: () => withToken(run) } });
      // When the scripts arrive, Continue becomes tappable; if they can't load, say so and drop it
      r.ready?.then((ok) => {
        if (ok === false && s.needsContinue) {
          set({ needsContinue: null });
          host.notify("Google Drive can't be reached right now.", true);
        } else emit();
      });
      return Promise.resolve(false);
    }
    if (s.needsContinue) set({ needsContinue: null });
    const tokenReady = r.token ? Promise.resolve(r.token) : r.promise;
    set({ working: true });
    const settled = beginAction();
    return tokenReady
      .then(async () => {
        await settled;
        if (!myName) myName = await client.getDisplayName().catch(() => '');
        return await run();
      })
      .catch((err) => {
        handleError(err);
        return false;
      })
      .finally(() => set({ working: false }));
  }
  function handleError(err) {
    if (err?.kind === 'popup-blocked') return host.notify('The Google sign-in window was blocked. Tap again to sign in.', true);
    if (err?.kind === 'cancelled' || err?.kind === 'denied') return host.notify('Google sign-in was cancelled.', true);
    if (err?.kind === 'auth') auth.dropAccessToken?.();
    if (isConnectionError(err)) {
      if (s.mode === 'edit') set({ connected: false });
      return host.notify("Couldn't reach Google Drive. Your changes are kept on this device.", true);
    }
    if (err?.kind === 'not-found') return host.notify("This build's Google Drive file can't be opened. It may have been deleted, or you may no longer have access.", true);
    if (err?.kind === 'forbidden') return host.notify("You don't have permission to change this Google Drive file.", true);
    host.notify(`Google Drive: ${err?.message || err}`, true);
  }

  // --- mode changes ---------------------------------------------------------------------------
  function enterEdit(meta) {
    stopTimers();
    set({ mode: 'edit', connected: true, meta, banner: null, prompt: null });
    followUp = timers.setTimeout(() => runTimerJob(followUpCheck), FOLLOW_UP_CHECK_MS);
    heartbeat = timers.setInterval(() => runTimerJob(beat), HEARTBEAT_MS);
  }

  async function enterReadonly(meta) {
    stopTimers();
    set({ mode: 'readonly', connected: true, meta, banner: null });
    if (meta.headRevisionId !== drive()?.lastSyncedHeadRevisionId) await fetchLatest(meta);
    poll = timers.setInterval(() => runTimerJob(viewerPoll), VIEWER_POLL_MS);
  }

  function enterPaused() {
    stopTimers();
    set({ mode: 'disconnected', banner: 'paused' });
  }

  /** Lost the lock while editing (heartbeat, follow-up, wake): Read-only when clean, else the prompt. */
  async function lockLost(meta) {
    stopTimers();
    if (dirtyNow()) {
      set({ meta, mode: 'disconnected', banner: null, prompt: { type: 'conflict', reason: lockState(meta.appProperties, clientId, now()).byOther ? 'locked-by-other' : 'changed' } });
    } else {
      await enterReadonly(meta);
    }
  }

  /** Downloads the latest content and opens it, or holds it while Play or Explode is on. */
  async function fetchLatest(meta) {
    const content = await client.downloadBuildFile(s.fileId);
    if (host.isBusy()) {
      set({ pending: { content, headRevisionId: meta.headRevisionId } });
      return;
    }
    applyContent(content, meta.headRevisionId);
  }
  function applyContent(content, headRevisionId) {
    const rev = host.replaceBuildContent(content);
    setDrive({ lastSyncedRev: rev, lastSyncedName: name(), lastSyncedHeadRevisionId: headRevisionId });
    set({ pending: null });
  }

  // --- timers ---------------------------------------------------------------------------------
  async function followUpCheck(stillValid) {
    followUp = null;
    if (s.mode !== 'edit') return;
    try {
      const { held, meta } = await client.verifyLock(s.fileId, { clientId });
      if (!stillValid() || s.mode !== 'edit') return;
      if (!held) await lockLost(meta);
    } catch (err) {
      if (isConnectionError(err) && stillValid()) set({ connected: false });
    }
  }

  async function beat(stillValid) {
    if (s.mode !== 'edit') return;
    try {
      const res = await client.refreshLock(s.fileId, { clientId, name: myName, lastSyncedHeadRevisionId: drive()?.lastSyncedHeadRevisionId, shouldContinue: stillValid });
      if (!stillValid() || s.mode !== 'edit' || res.outcome === 'skipped') return;
      if (res.held) set({ connected: true, meta: res.meta });
      else await lockLost(res.meta);
    } catch (err) {
      if (!stillValid()) return;
      if (isConnectionError(err)) {
        if (err.kind === 'auth') auth.dropAccessToken?.();
        set({ connected: false }); // keep editing; the button reads Reconnect to Drive
      }
    }
  }

  async function viewerPoll(stillValid) {
    if (s.mode !== 'readonly' || !isVisible()) return;
    try {
      const meta = await client.getFileMeta(s.fileId);
      if (!stillValid() || s.mode !== 'readonly') return;
      const was = lockState(s.meta?.appProperties, clientId, now());
      const lock = lockState(meta.appProperties, clientId, now());
      const unlocked = was.byOther && !lock.active && meta.capabilities?.canEdit !== false;
      set({ meta, banner: unlocked ? 'unlocked' : s.banner });
      const known = s.pending?.headRevisionId ?? drive()?.lastSyncedHeadRevisionId;
      if (meta.headRevisionId !== known) await fetchLatest(meta);
    } catch (err) {
      if (err?.kind === 'auth' && stillValid()) {
        auth.dropAccessToken?.();
        enterPaused(); // a viewer whose sign-in ran out would stop seeing saves
      }
    }
  }

  // --- the reconcile used by Reconnect and by reopening a known file ------------------------------
  async function reconcile() {
    const meta = await client.getFileMeta(s.fileId);
    const outcome = reconnectOutcome({ meta, clientId, lastSyncedHeadRevisionId: drive()?.lastSyncedHeadRevisionId, dirty: dirtyNow(), now: now() });
    if (outcome === 'edit') return takeLock();
    if (outcome === 'readonly') return enterReadonly(meta);
    set({ meta, mode: 'disconnected', banner: null, prompt: { type: 'conflict', reason: lockState(meta.appProperties, clientId, now()).byOther ? 'locked-by-other' : 'changed' } });
    return true;
  }

  async function takeLock() {
    const res = await client.acquireLock(s.fileId, { clientId, name: myName });
    if (res.acquired) {
      enterEdit(res.meta);
      return true;
    }
    if (dirtyNow()) {
      // never replace unsaved edits: the prompt keeps them (a copy on Drive, or a local build)
      set({ meta: res.meta, mode: 'disconnected', banner: null, prompt: { type: 'conflict', reason: res.reason === 'read-only' ? 'read-only' : 'locked-by-other' } });
    } else {
      await enterReadonly(res.meta);
    }
    return false;
  }

  /** Upload after the pre-save check. Returns true when saved; false after raising the prompt. */
  async function uploadChecked() {
    const meta = await client.getFileMeta(s.fileId);
    const check = checkPreSaveSafety({ meta, clientId, lastSyncedHeadRevisionId: drive()?.lastSyncedHeadRevisionId, now: now() });
    if (!check.safe) {
      stopTimers();
      set({ meta, mode: 'disconnected', banner: null, prompt: { type: 'conflict', reason: check.reason } });
      return false;
    }
    if (check.needsLock) {
      const res = await client.acquireLock(s.fileId, { clientId, name: myName });
      if (!res.acquired) {
        stopTimers();
        set({ meta: res.meta, mode: 'disconnected', banner: null, prompt: { type: 'conflict', reason: 'locked-by-other' } });
        return false;
      }
    }
    const b = build();
    const renamed = b.name !== drive()?.lastSyncedName;
    const lockAt = Number(meta.appProperties?.lockAt) || now();
    const saved = await client.updateBuildFile(s.fileId, contentNow(), {
      name: renamed ? driveFileName(b.name) : undefined,
      appProperties: buildLockProps({ clientId, name: myName, now: now(), lockAt })
    });
    setDrive({ fileName: saved.name ?? drive()?.fileName, lastSyncedRev: b.history?.rev, lastSyncedName: b.name, lastSyncedHeadRevisionId: saved.headRevisionId });
    if (s.mode !== 'edit') enterEdit(saved);
    else set({ meta: saved, connected: true });
    host.notify('Saved to Drive', false);
    return true;
  }

  // --- public actions -------------------------------------------------------------------------
  const api = {
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),

    getState() {
      const d = drive();
      const linked = Boolean(d?.fileId) && s.mode !== null;
      const lock = lockState(s.meta?.appProperties, clientId, now());
      const canEdit = s.meta?.capabilities?.canEdit;
      const dirty = dirtyNow();
      return {
        linked,
        fileId: s.fileId,
        mode: s.mode,
        connected: s.connected,
        dirty,
        lock,
        canEdit,
        prompt: s.prompt,
        banner: s.banner,
        pendingRefresh: Boolean(s.pending),
        needsContinue: Boolean(s.needsContinue),
        working: s.working,
        readOnlyViewer: linked && (s.mode === 'readonly' || s.mode === 'disconnected'),
        button: driveButtonState({ linked, mode: s.mode, dirty, lock, canEdit, connected: s.connected })
      };
    },

    /** The open build changed (startup, switching builds). A Drive build with no lock in hand opens paused. */
    attach() {
      const d = drive();
      if (!d?.fileId) {
        stopTimers();
        set({ fileId: null, mode: null, meta: null, prompt: null, banner: null, pending: null, connected: true });
        return;
      }
      if (d.fileId === s.fileId && s.mode) return; // same file, already tracked
      stopTimers();
      set({ fileId: d.fileId, mode: null, meta: null, prompt: null, banner: null, pending: null, connected: true });
      auth.preload?.();
      enterPaused();
    },

    /** The Drive button. */
    pressButton() {
      const action = api.getState().button?.action;
      return action ? api[action]() : Promise.resolve(false);
    },

    /** Continue to Google Drive (a tap came before the scripts were ready). */
    continueToDrive() {
      const pending = s.needsContinue;
      set({ needsContinue: null });
      return pending ? pending.retry() : Promise.resolve(false);
    },

    saveToDrive: () => withToken(() => uploadChecked()),

    /** Saves if needed, then releases the lock; no question. */
    doneEditing: () =>
      withToken(async () => {
        if (dirtyNow() && !(await uploadChecked())) return false;
        await client.releaseLock(s.fileId);
        const meta = await client.getFileMeta(s.fileId);
        await enterReadonly(meta);
        return true;
      }),

    /** Edit build (Drive button or unlock banner): latest content first, then write-wait-read. */
    enterEditMode: () =>
      withToken(async () => {
        const meta = await client.getFileMeta(s.fileId);
        if (meta.headRevisionId !== drive()?.lastSyncedHeadRevisionId && !dirtyNow()) await fetchLatestNow(meta);
        set({ banner: null });
        return takeLock();
      }),

    dismissUnlock: () => set({ banner: null }),

    reconnectToDrive: () => withToken(() => reconcile()),

    /** Removes the Drive link, keeps every edit, makes no request. */
    workOnThisDeviceOnly() {
      stopTimers();
      host.setDrive(null);
      set({ fileId: null, mode: null, meta: null, prompt: null, banner: null, pending: null, connected: true, needsContinue: null });
    },

    /** The changed-on-Drive prompt's choices: 'copy' | 'latest' | 'cancel'. */
    resolveConflict(choice) {
      if (choice === 'cancel') {
        set({ prompt: null, mode: 'disconnected', banner: null });
        return Promise.resolve(true);
      }
      if (choice === 'latest') {
        return withToken(async () => {
          const b = build();
          await host.saveLocalCopy({ name: `${b.name} (my changes)`, instances: b.instances, history: b.history });
          const meta = await client.getFileMeta(s.fileId);
          set({ prompt: null });
          applyContent(await client.downloadBuildFile(s.fileId), meta.headRevisionId);
          await enterReadonly(meta);
          return true;
        });
      }
      return withToken(async () => {
        const b = build();
        const copyName = `${b.name} copy`;
        const parents = s.meta?.parents;
        const { meta, inFolder } = await client.createBuildFile({
          name: driveFileName(copyName),
          content: buildFileContent({ name: copyName, instances: b.instances, history: b.history, now: now() }),
          parents,
          appProperties: buildLockProps({ clientId, name: myName, now: now() })
        });
        const linkedName = await host.linkAsNewFile({
          name: copyName,
          drive: { fileId: meta.id, fileName: meta.name, lastSyncedRev: b.history?.rev, lastSyncedHeadRevisionId: meta.headRevisionId }
        });
        setDrive({ lastSyncedName: linkedName ?? copyName });
        set({ fileId: meta.id, prompt: null });
        enterEdit(meta);
        host.notify(inFolder ? `Saved ${copyName} to Drive` : COPY_IN_MY_DRIVE, false);
        return true;
      });
    },

    /**
     * Before New, Starter or Load switches away. Resolves true to go ahead, false to stay. With
     * unsaved Drive changes it raises the leave prompt; resolveLeave answers it.
     */
    leaveBuild() {
      if (!s.fileId || s.mode !== 'edit') return Promise.resolve(true);
      if (!dirtyNow()) {
        const fileId = s.fileId;
        stopTimers();
        return beginAction().then(() => {
          if (auth.getAccessToken()) client.releaseLock(fileId).catch(() => {});
          return true;
        });
      }
      return new Promise((resolve) => {
        leaveResolve = resolve;
        set({ prompt: { type: 'leave' } });
      });
    },

    /** The leave prompt's choices: 'save' | 'discard' (Leave without saving) | 'cancel'. */
    resolveLeave(choice) {
      const stay = leaveThenStay;
      const finish = (go) => {
        const r = leaveResolve;
        leaveResolve = null;
        leaveThenStay = false;
        if (s.prompt?.type === 'leave') set({ prompt: null });
        if (go) stopTimers();
        if (go && stay) host.notify('Now choose Open from Google Drive… again.', false);
        r?.(go);
        return go;
      };
      if (choice === 'cancel') return Promise.resolve(finish(false));
      if (choice === 'discard') {
        const fileId = s.fileId;
        stopTimers();
        return beginAction().then(() => {
          if (auth.getAccessToken()) client.releaseLock(fileId).catch(() => {});
          if (stay) enterPaused(); // the edits stay in the local build; Reconnect offers them later
          return finish(true);
        });
      }
      set({ prompt: null });
      return withToken(async () => {
        if (!(await uploadChecked())) return finish(false); // the changed-on-Drive prompt is up
        await client.releaseLock(s.fileId);
        if (stay) await enterReadonly(await client.getFileMeta(s.fileId));
        return finish(true);
      }).then((ok) => (ok ? true : leaveResolve && !s.needsContinue ? finish(false) : false));
    },

    /**
     * Open from Google Drive… (Load dialog). Leaving a Drive build with unsaved changes asks first,
     * in place of the Picker; with nothing unsaved its lock is released once another file is picked.
     */
    openFromDrive() {
      if (s.fileId && s.mode === 'edit' && dirtyNow()) {
        leaveThenStay = true;
        api.leaveBuild();
        return Promise.resolve(false);
      }
      return withToken(async () => {
        const picked = await auth.openDrivePicker(auth.getAccessToken());
        if (!picked) return false;
        const leaving = s.fileId && s.fileId !== picked.id && s.mode === 'edit' ? s.fileId : null;
        const meta = await client.getFileMeta(picked.id);
        const content = await client.downloadBuildFile(picked.id);
        if (leaving) {
          stopTimers();
          await client.releaseLock(leaving).catch(() => {});
        }
        const { reused } = await host.openDriveBuild({ fileId: picked.id, fileName: meta.name, name: baseName(meta.name), content, meta });
        stopTimers();
        set({ fileId: picked.id, mode: 'disconnected', meta, prompt: null, banner: null, pending: null, connected: true });
        if (reused) return reconcile();
        return takeLock();
      });
    },

    /** File → Save to Google Drive…: asks where (the save-where question), every time. */
    askWhereToSave() {
      set({ prompt: { type: 'save-where', lastFolder: readLastFolder(storage) } });
    },

    /**
     * The save-where question's choices, straight from the tap: 'last' (Save in <folder>), 'choose'
     * (Choose a folder…), 'myDrive', 'cancel'.
     */
    resolveSaveWhere(choice) {
      const lastFolder = s.prompt?.type === 'save-where' ? s.prompt.lastFolder : readLastFolder(storage);
      set({ prompt: null });
      if (choice === 'cancel') return Promise.resolve(false);
      return withToken(async () => {
        let folder = null;
        if (choice === 'last') folder = lastFolder;
        if (choice === 'choose') {
          folder = await auth.openFolderPicker(auth.getAccessToken());
          if (!folder) return false; // closed without picking: nothing saved
        }
        return createNewFile(folder);
      });
    },

    /** A new Drive file for the open build, in `folder` or My Drive; Save to Google Drive… uses it. */
    saveNewToDrive: (folder = null) => withToken(() => createNewFile(folder)),
    /** Play mode ended or Explode closed: apply a teammate's save that was held. */
    busyChanged() {
      if (s.pending && !host.isBusy()) applyContent(s.pending.content, s.pending.headRevisionId);
    },

    /** The tab became visible: check the lock (Edit) or look for saves (Read-only) at once. */
    visible() {
      if (s.mode === 'edit') return runTimerJob(beat);
      if (s.mode === 'readonly') return runTimerJob(viewerPoll);
      return Promise.resolve();
    },

    /** The page is going away: release the lock if nothing is unsaved (else the lease runs out). */
    pageHide() {
      if (s.mode === 'edit' && !dirtyNow() && auth.getAccessToken()) client.releaseLockOnPageHide(s.fileId).catch(() => {});
    },

    dispose() {
      stopTimers();
      listeners.clear();
    }
  };

  /** Creates the open build's Drive file in `folder` ({ id, name }) or My Drive, links it and locks it. */
  async function createNewFile(folder) {
    const b = build();
    const { meta, inFolder } = await client.createBuildFile({
      name: driveFileName(b.name),
      content: contentNow(),
      parents: folder ? [folder.id] : undefined,
      appProperties: buildLockProps({ clientId, name: myName, now: now() })
    });
    host.setDrive({ fileId: meta.id, fileName: meta.name, lastSyncedRev: b.history?.rev, lastSyncedName: b.name, lastSyncedHeadRevisionId: meta.headRevisionId });
    set({ fileId: meta.id, prompt: null, banner: null, pending: null });
    enterEdit(meta);
    if (folder && inFolder) {
      writeLastFolder(folder, storage);
      host.notify(`Saved ${meta.name} in ${folder.name}`, false);
    } else if (folder) {
      writeLastFolder(null, storage); // that folder refused the file: don't offer it again
      host.notify(COPY_IN_MY_DRIVE, false);
    } else {
      host.notify(`Saved ${meta.name} in your My Drive`, false);
    }
    return true;
  }

  async function fetchLatestNow(meta) {
    applyContent(await client.downloadBuildFile(s.fileId), meta.headRevisionId);
  }

  return api;
}
