/**
 * Node check for Google Drive sync (openspec google-drive-sync): lock rules, the Drive button, and the
 * Drive client against a pretend Google Drive with a pretend clock, so lock races play out exactly.
 * Run: node scripts/check-google-drive-sync.mjs   (exits 1 on any failure)
 */
import {
  CLIENT_ID_KEY,
  LOCK_LEASE_MS,
  buildLockProps,
  canAcquireLock,
  checkPreSaveSafety,
  clearLockProps,
  getOrCreateClientId,
  hasUnsavedDriveChanges,
  heartbeatOutcome,
  isLockActive,
  lockState,
  reconnectOutcome
} from '../src/drive/driveLock.js';
import { driveButtonState } from '../src/drive/driveButton.js';
import { DriveError, buildFileContent, createDriveClient, isConnectionError } from '../src/drive/driveClient.js';
import { createDriveSession } from '../src/drive/driveSession.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const section = (title) => console.log(`\n${title}`);

// ---------------------------------------------------------------------------------------------
// A pretend clock: timers run in time order when advanced, so concurrent calls interleave exactly.
export function createClock(start = 1_000_000) {
  let now = start;
  let seq = 0;
  let timers = [];
  const flush = () => new Promise((r) => setImmediate(r));
  const add = (fn, ms, every = 0) => {
    const t = { at: now + ms, seq: seq++, fn, every };
    timers.push(t);
    timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
    return t;
  };
  const cancel = (t) => {
    if (t) timers = timers.filter((x) => x !== t);
  };
  const clock = {
    now: () => now,
    sleep: (ms) => new Promise((resolve) => add(resolve, ms)),
    setTimeout: (fn, ms) => add(fn, ms),
    clearTimeout: cancel,
    setInterval: (fn, ms) => add(fn, ms, ms),
    clearInterval: cancel,
    /** Runs every timer due up to now + ms, in order, letting the code after each one run. */
    async advance(ms) {
      const end = now + ms;
      await flush();
      while (timers.length && timers[0].at <= end) {
        const t = timers.shift();
        now = t.at;
        if (t.every) {
          t.at += t.every;
          t.seq = seq++;
          timers.push(t);
          timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
        }
        t.fn();
        for (let k = 0; k < 8; k += 1) await flush();
      }
      now = end;
      for (let k = 0; k < 8; k += 1) await flush();
    }
  };
  return clock;
}

// A pretend Google Drive: files with appProperties, content, headRevisionId and version, and the
// accounts allowed to edit each. Requests are logged so checks can count downloads.
export function createFakeDrive(clock) {
  const files = new Map();
  let nextId = 1;
  let nextRev = 1;
  const log = [];
  const folders = new Map(); // folderId -> Set(account) that may add files
  const meta = (f, account) => ({
    id: f.id,
    name: f.name,
    headRevisionId: f.headRevisionId,
    modifiedTime: new Date(clock.now()).toISOString(),
    parents: f.parents,
    appProperties: { ...f.appProperties },
    capabilities: { canEdit: f.editors.has(account) }
  });
  const ok = (body) => ({ status: 200, ok: true, text: typeof body === 'string' ? body : JSON.stringify(body) });
  const err = (status, message) => ({ status, ok: false, text: JSON.stringify({ error: { message } }) });
  const parseMultipart = (body) => {
    const parts = body.split(/--vexiq[a-z0-9]+/).filter((p) => p.includes('\r\n\r\n'));
    const [m, c] = parts.map((p) => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''));
    return { metadata: JSON.parse(m), content: c };
  };
  const applyProps = (f, props = {}) => {
    for (const [k, v] of Object.entries(props)) {
      if (v === null) delete f.appProperties[k];
      else f.appProperties[k] = String(v);
    }
  };
  return {
    files,
    log,
    folders,
    addFile({ name = 'TeamBot.vexiq.json', content = { instances: [], history: { rev: 0 } }, editors = ['A', 'B'], parents = ['team-folder'] } = {}) {
      const id = `file-${nextId++}`;
      files.set(id, { id, name, parents, appProperties: {}, content: JSON.stringify(content), headRevisionId: `rev-${nextRev++}`, version: 1, editors: new Set(editors) });
      return id;
    },
    /** A transport for one account, with a per-request delay (a function of the request number). */
    transport(account, { delay = () => 10, lag = () => 0, offline = () => false } = {}) {
      let n = 0;
      const handle = this.handle;
      return async (method, url, opts = {}) => {
        const i = n++;
        await clock.sleep(delay(i, method, url, opts.body));
        const res = await handle(account, method, url, opts, offline);
        const wait = lag(i, method, url, opts.body); // Drive has acted; the reply is slow
        if (wait) await clock.sleep(wait);
        return res;
      };
    },
    async handle(account, method, url, { headers = {}, body } = {}, offline = () => false) {
      {
        if (offline()) throw new TypeError('Failed to fetch');
        log.push({ account, method, url, at: clock.now(), headers });
        const u = new URL(url);
        const upload = u.pathname.startsWith('/upload/');
        const idMatch = u.pathname.match(/\/files\/([^/]+)$/);
        if (u.pathname.endsWith('/about')) return ok({ user: { displayName: `Student ${account}` } });
        if (method === 'POST' && upload) {
          const { metadata, content } = parseMultipart(body);
          if (metadata.parents) {
            const allowed = folders.get(metadata.parents[0]);
            if (!allowed?.has(account)) return err(404, 'File not found: folder');
          }
          const id = `file-${nextId++}`;
          const f = { id, name: metadata.name, parents: metadata.parents ?? ['my-drive-' + account], appProperties: {}, content, headRevisionId: `rev-${nextRev++}`, version: 1, editors: new Set([account]) };
          applyProps(f, metadata.appProperties);
          files.set(id, f);
          return ok(meta(f, account));
        }
        const f = idMatch && files.get(decodeURIComponent(idMatch[1]));
        if (!f) return err(404, 'File not found');
        if (method === 'GET') return u.searchParams.get('alt') === 'media' ? ok(f.content) : ok(meta(f, account));
        if (method === 'PATCH') {
          if (!f.editors.has(account)) return err(403, 'The user does not have sufficient permissions for this file.');
          f.version += 1;
          if (upload) {
            const { metadata, content } = parseMultipart(body);
            if (metadata.name) f.name = metadata.name;
            applyProps(f, metadata.appProperties);
            f.content = content;
            f.headRevisionId = `rev-${nextRev++}`;
          } else {
            applyProps(f, JSON.parse(body).appProperties);
          }
          return ok(meta(f, account));
        }
        return err(400, 'unsupported');
      }
    }
  };
}

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

// ---------------------------------------------------------------------------------------------
section('Lock rules (driveLock.js)');
{
  const now = 5_000_000;
  const storage = memoryStorage();
  const id1 = getOrCreateClientId(storage);
  check('client id is made once and kept in storage', /^client-/.test(id1) && getOrCreateClientId(storage) === id1 && storage.getItem(CLIENT_ID_KEY) === id1);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const mem = getOrCreateClientId(blocked);
  check('  storage blocked: one id for the page', /^client-/.test(mem) && getOrCreateClientId(blocked) === mem);

  const free = {};
  const mine = buildLockProps({ clientId: 'me', name: 'Ana', now });
  const other = buildLockProps({ clientId: 'them', name: 'Maya', now });
  const expired = buildLockProps({ clientId: 'them', name: 'Maya', now: now - LOCK_LEASE_MS - 1 });
  check('free: no active lock, can acquire', !isLockActive(free, now) && canAcquireLock(free, 'me', now));
  check('lock props are strings with a 2-minute lease', Object.values(mine).every((v) => typeof v === 'string') && Number(mine.lockExpiresAt) - now === LOCK_LEASE_MS);
  check('active lock by someone else: cannot acquire', isLockActive(other, now) && !canAcquireLock(other, 'me', now));
  check('active lock that is ours: can acquire (extend)', canAcquireLock(mine, 'me', now));
  check('expired lock: not active, can acquire', !isLockActive(expired, now) && canAcquireLock(expired, 'me', now));
  check('lock state names the holder', lockState(other, 'me', now).byOther && lockState(other, 'me', now).holderName === 'Maya');
  check('  an empty name reads "a teammate"', lockState({ ...other, lockHolderName: '' }, 'me', now).holderName === 'a teammate');
  check('clearing sets all four lock fields to null', Object.keys(clearLockProps()).length === 4 && Object.values(clearLockProps()).every((v) => v === null));

  const drive = { fileId: 'f', lastSyncedRev: 7, lastSyncedName: 'TeamBot' };
  check('clean: no unsaved Drive changes', !hasUnsavedDriveChanges(drive, { rev: 7, name: 'TeamBot' }));
  check('dirty: history moved on', hasUnsavedDriveChanges(drive, { rev: 8, name: 'TeamBot' }));
  check('dirty: renamed', hasUnsavedDriveChanges(drive, { rev: 7, name: 'TeamBot 2' }));
  check('not linked: never dirty', !hasUnsavedDriveChanges(null, { rev: 8, name: 'x' }));

  const m = (appProperties, headRevisionId = 'r1', canEdit = true) => ({ appProperties, headRevisionId, capabilities: { canEdit } });
  const pre = (meta) => checkPreSaveSafety({ meta, clientId: 'me', lastSyncedHeadRevisionId: 'r1', now });
  check('pre-save: our lock, unchanged → safe, no new lock', pre(m(mine)).safe && pre(m(mine)).needsLock === false);
  check('pre-save: free, unchanged → safe, take the lock first', pre(m(free)).safe && pre(m(free)).needsLock === true);
  check('pre-save: expired other lock, unchanged → safe, take the lock', pre(m(expired)).safe && pre(m(expired)).needsLock === true);
  check('pre-save: locked by someone else → conflict', !pre(m(other)).safe && pre(m(other)).reason === 'locked-by-other' && pre(m(other)).holderName === 'Maya');
  check('pre-save: lock expired and someone saved → conflict (lost lock)', !pre(m(expired, 'r2')).safe && pre(m(expired, 'r2')).reason === 'changed');
  check('pre-save: our id but the file changed → conflict, never overwrite', !pre(m(mine, 'r2')).safe && pre(m(mine, 'r2')).reason === 'changed');
  check('pre-save: view only → not safe', !pre(m(free, 'r1', false)).safe && pre(m(free, 'r1', false)).reason === 'read-only');

  const hb = (meta) => heartbeatOutcome({ meta, clientId: 'me', lastSyncedHeadRevisionId: 'r1', now });
  check('heartbeat: ours → extend', hb(m(mine)) === 'extend');
  check('heartbeat: ran out, nobody took it → reacquire', hb(m(free)) === 'reacquire' && hb(m(expired)) === 'reacquire');
  check('heartbeat: someone else holds it → lost', hb(m(other)) === 'lost');
  check('heartbeat: file changed → lost', hb(m(mine, 'r2')) === 'lost');

  const rc = (meta, dirty) => reconnectOutcome({ meta, clientId: 'me', lastSyncedHeadRevisionId: 'r1', dirty, now });
  check('reconnect: free and unchanged → edit (clean or dirty)', rc(m(free), false) === 'edit' && rc(m(free), true) === 'edit');
  check('reconnect: still our lock → edit', rc(m(mine), true) === 'edit');
  check('reconnect: locked by other, clean → readonly', rc(m(other), false) === 'readonly');
  check('reconnect: locked by other, dirty → conflict', rc(m(other), true) === 'conflict');
  check('reconnect: changed, clean → readonly', rc(m(free, 'r2'), false) === 'readonly');
  check('reconnect: changed, dirty → conflict', rc(m(free, 'r2'), true) === 'conflict');
}

// ---------------------------------------------------------------------------------------------
section('Drive button (driveButton.js)');
{
  const b = (s) => driveButtonState({ linked: true, dirty: false, canEdit: true, connected: true, lock: {}, ...s });
  const is = (st, label, action, tag = false) => st && st.label === label && st.action === action && st.tag === tag;
  check('edit, unsaved → Save to Drive', is(b({ mode: 'edit', dirty: true }), 'Save to Drive', 'saveToDrive'));
  check('edit, all saved → Done editing', is(b({ mode: 'edit' }), 'Done editing', 'doneEditing'));
  check('edit, connection lost → Reconnect to Drive', is(b({ mode: 'edit', dirty: true, connected: false }), 'Reconnect to Drive', 'reconnectToDrive'));
  check('read-only, locked by Maya → tag', is(b({ mode: 'readonly', lock: { byOther: true, holderName: 'Maya' } }), 'Read-only · Locked by Maya', null, true));
  check('read-only, view permission only → tag', is(b({ mode: 'readonly', canEdit: false }), 'Read-only', null, true));
  check('read-only, unlocked → Edit build', is(b({ mode: 'readonly' }), 'Edit build', 'enterEditMode'));
  check('paused → Reconnect to Drive', is(b({ mode: 'disconnected', dirty: true }), 'Reconnect to Drive', 'reconnectToDrive'));
  check('not linked → no button', driveButtonState({ linked: false, mode: 'edit' }) === null);
  const flow = [b({ mode: 'edit', dirty: true }), b({ mode: 'edit' }), b({ mode: 'readonly' })].map((s) => s.label);
  check('save → done → edit, in turn', flow.join(' / ') === 'Save to Drive / Done editing / Edit build', flow.join(' / '));
}

// ---------------------------------------------------------------------------------------------
section('Drive client (driveClient.js) against a pretend Drive');
{
  const clock = createClock();
  const drive = createFakeDrive(clock);
  const client = (account, opts) => createDriveClient({ getToken: () => `token-${account}`, transport: drive.transport(account, opts), sleep: clock.sleep, random: () => 0, now: clock.now });

  // Lock taken on open
  {
    const fileId = drive.addFile();
    const a = client('A');
    const p = a.acquireLock(fileId, { clientId: 'cA', name: 'Student A' });
    await clock.advance(1000);
    const res = await p;
    const props = drive.files.get(fileId).appProperties;
    check('free file: write, wait, read back → acquired', res.acquired && props.lockHolderId === 'cA' && Number(props.lockExpiresAt) - Number(props.lockAt) === LOCK_LEASE_MS);
    const reads = drive.log.filter((r) => r.method === 'GET' && r.account === 'A').length;
    check('  read before and after the write', reads === 2, String(reads));
    const b = client('B');
    const pb = b.acquireLock(fileId, { clientId: 'cB', name: 'Student B' });
    await clock.advance(1000);
    const rb = await pb;
    check('second person while it is locked → not acquired, holder named', !rb.acquired && rb.reason === 'locked-by-other' && rb.meta.appProperties.lockHolderName === 'Student A');
  }

  // Race caught by the read-back: B's write lands after A's write, before A reads back
  {
    const fileId = drive.addFile();
    const a = client('A');
    const b = client('B', { delay: (i) => (i === 0 ? 15 : 10) });
    const pa = a.acquireLock(fileId, { clientId: 'cA', name: 'Student A' });
    const pb = b.acquireLock(fileId, { clientId: 'cB', name: 'Student B' });
    await clock.advance(2000);
    const [ra, rb] = await Promise.all([pa, pb]);
    check('simultaneous: read-back sees the other write, only one acquires', !ra.acquired && ra.reason === 'lost-race' && rb.acquired, `A=${ra.acquired} B=${rb.acquired}`);
    check('  the loser learns who holds it', ra.meta.appProperties.lockHolderName === 'Student B');
  }

  // Race only the 5-second check catches: B's slow write lands after A's read-back
  {
    const fileId = drive.addFile();
    const a = client('A');
    const b = client('B', { delay: (i) => (i === 1 ? 450 : 10) });
    const pa = a.acquireLock(fileId, { clientId: 'cA', name: 'Student A' });
    const pb = b.acquireLock(fileId, { clientId: 'cB', name: 'Student B' });
    await clock.advance(2000);
    const [ra, rb] = await Promise.all([pa, pb]);
    check('slow write: both read-backs pass', ra.acquired && rb.acquired, `A=${ra.acquired} B=${rb.acquired}`);
    const pv = a.verifyLock(fileId, { clientId: 'cA' });
    await clock.advance(100);
    const v = await pv;
    check('  the follow-up check catches the loser', !v.held && v.meta.appProperties.lockHolderId === 'cB');
  }

  // Heartbeat
  {
    const fileId = drive.addFile();
    const a = client('A');
    const pa = a.acquireLock(fileId, { clientId: 'cA', name: 'Student A' });
    await clock.advance(1000);
    const { meta } = await pa;
    const rev = meta.headRevisionId;
    await clock.advance(45_000);
    const before = drive.files.get(fileId).appProperties.lockExpiresAt;
    const ph = a.refreshLock(fileId, { clientId: 'cA', name: 'Student A', lastSyncedHeadRevisionId: rev });
    await clock.advance(100);
    const h = await ph;
    const f = drive.files.get(fileId);
    check('heartbeat: ours → lease pushed on, lockAt kept', h.outcome === 'extend' && h.held && Number(f.appProperties.lockExpiresAt) > Number(before) && f.appProperties.lockAt === meta.appProperties.lockAt);
    check('  heartbeat leaves headRevisionId alone', f.headRevisionId === rev);
    // Someone else takes it after expiry
    await clock.advance(LOCK_LEASE_MS + 1);
    const b = client('B');
    const pb = b.acquireLock(fileId, { clientId: 'cB', name: 'Student B' });
    await clock.advance(1000);
    await pb;
    const ph2 = a.refreshLock(fileId, { clientId: 'cA', name: 'Student A', lastSyncedHeadRevisionId: rev });
    await clock.advance(100);
    const h2 = await ph2;
    check('heartbeat after someone took the lock → lost, nothing written', h2.outcome === 'lost' && !h2.held && drive.files.get(fileId).appProperties.lockHolderId === 'cB');
    // Expired, nobody took it: reacquire
    const id2 = drive.addFile();
    const p3 = a.acquireLock(id2, { clientId: 'cA', name: 'Student A' });
    await clock.advance(1000);
    const r3 = await p3;
    await clock.advance(LOCK_LEASE_MS * 3);
    drive.files.get(id2).appProperties.lockHolderId = 'cGone';
    const ph3 = a.refreshLock(id2, { clientId: 'cA', name: 'Student A', lastSyncedHeadRevisionId: r3.meta.headRevisionId });
    await clock.advance(2000);
    const h3 = await ph3;
    check('heartbeat after an expired lock nobody used → reacquired', h3.outcome === 'reacquire' && h3.held);
  }

  // Upload, create, copies, release
  {
    const fileId = drive.addFile();
    const a = client('A');
    const content = buildFileContent({ name: 'TeamBot', instances: [{ instanceId: 'p1' }], history: { rev: 3 }, now: clock.now() });
    const before = drive.files.get(fileId).headRevisionId;
    const pu = a.updateBuildFile(fileId, content, { appProperties: buildLockProps({ clientId: 'cA', name: 'Student A', now: clock.now() }) });
    await clock.advance(100);
    const up = await pu;
    check('upload changes headRevisionId and returns it', up.headRevisionId !== before && up.headRevisionId === drive.files.get(fileId).headRevisionId);
    const pd = a.downloadBuildFile(fileId);
    await clock.advance(100);
    const down = await pd;
    check('download gives back the build', down.instances[0].instanceId === 'p1' && down.historyRev === 3);
    const pr = a.releaseLock(fileId);
    await clock.advance(100);
    await pr;
    check('Done editing clears the lock fields', !('lockHolderId' in drive.files.get(fileId).appProperties));

    drive.folders.set('team-folder', new Set(['A', 'B']));
    const pc = a.createBuildFile({ name: 'TeamBot copy.vexiq.json', content, parents: ['team-folder'] });
    await clock.advance(100);
    const copy = await pc;
    check('copy goes in the original’s folder', copy.inFolder && copy.meta.parents[0] === 'team-folder');
    drive.folders.set('team-folder', new Set(['A']));
    const b = client('B');
    const pc2 = b.createBuildFile({ name: 'TeamBot copy.vexiq.json', content, parents: ['team-folder'] });
    await clock.advance(200);
    const copy2 = await pc2;
    check('folder refused → copy goes in My Drive', !copy2.inFolder && copy2.meta.parents[0] === 'my-drive-B');

    const pn = a.getDisplayName();
    await clock.advance(100);
    check('display name is read', (await pn) === 'Student A');
  }

  // Errors
  {
    const fileId = drive.addFile({ editors: ['A'] });
    let offline = true;
    const a = client('A', { offline: () => offline });
    const p = a.getFileMeta(fileId).catch((e) => e);
    await clock.advance(100);
    const e1 = await p;
    check('no network → DriveError "network", counts as connection lost', e1 instanceof DriveError && e1.kind === 'network' && isConnectionError(e1));
    offline = false;
    const noToken = createDriveClient({ getToken: () => null, transport: drive.transport('A'), sleep: clock.sleep, now: clock.now });
    const e2 = await noToken.getFileMeta(fileId).catch((e) => e);
    check('signed out → "auth", counts as connection lost', e2.kind === 'auth' && isConnectionError(e2));
    const b = client('B');
    const pb = b.acquireLock(fileId, { clientId: 'cB', name: 'Student B' });
    await clock.advance(1000);
    const rb = await pb;
    check('view-only person → not acquired, read-only, nothing written', !rb.acquired && rb.reason === 'read-only' && !drive.files.get(fileId).appProperties.lockHolderId);
    const p404 = a.getFileMeta('missing').catch((e) => e);
    await clock.advance(100);
    const e3 = await p404;
    check('missing file → "not-found", not a connection problem', e3.kind === 'not-found' && !isConnectionError(e3));
  }

  check('no request asks for shared drives (not in this change)', drive.log.every((r) => !r.url.includes('supportsAllDrives')));
}

// ---------------------------------------------------------------------------------------------
section('Drive session (driveSession.js): two students on one file');
{
  const clock = createClock();
  const drive = createFakeDrive(clock);
  drive.folders.set('team-folder', new Set(['A', 'B']));
  const content = (parts, rev) => ({ instances: parts.map((id) => ({ instanceId: id })), history: { rev } });
  const ids = (b) => b.instances.map((i) => i.instanceId).join(',');

  /** One student: a browser with its own build, sign-in, lock id and session. */
  function student(account, { online = () => true, delay, lag, ready = true, signedIn = false, library = new Map(), storage = memoryStorage() } = {}) {
    let token = signedIn ? `t-${account}` : null;
    const st = {
      account,
      busy: false,
      notes: [],
      copies: [],
      library, // fileId -> build record kept locally
      build: { id: `local-${account}`, name: 'TeamBot', instances: [{ instanceId: 'base' }], history: { rev: 1 }, drive: undefined },
      authReady: ready,
      pick: null,
      folderPick: null,
      storage
    };
    const auth = {
      signInFromTap: () => {
        if (!st.authReady) return { needsContinue: true, ready: Promise.resolve(true) };
        if (token) return { token };
        token = `t-${account}`;
        return { promise: Promise.resolve(token) };
      },
      getAccessToken: () => token,
      dropAccessToken: () => (token = null),
      openDrivePicker: async () => st.pick,
      openFolderPicker: async () => st.folderPick,
      preload: () => {}
    };
    const host = {
      getBuild: () => st.build,
      setDrive: (d) => {
        st.build = { ...st.build, drive: d ?? undefined };
        if (d?.fileId) st.library.set(d.fileId, st.build);
      },
      isBusy: () => st.busy,
      replaceBuildContent: (c) => {
        st.build = { ...st.build, instances: c.instances, history: c.history };
        return c.history.rev;
      },
      saveLocalCopy: async (b) => {
        st.copies.push(b);
        return b.name;
      },
      linkAsNewFile: async ({ name, drive: d }) => {
        st.build = { ...st.build, id: `local-${account}-copy`, name, drive: d };
        return name;
      },
      openDriveBuild: async ({ fileId, fileName, name, content: c }) => {
        const known = st.library.get(fileId);
        if (known) {
          st.build = known;
          return { reused: true };
        }
        st.build = { id: `drive-${account}-${fileId}`, name, instances: c.instances, history: c.history, drive: { fileId, fileName, lastSyncedRev: c.history.rev, lastSyncedName: name, lastSyncedHeadRevisionId: drive.files.get(fileId).headRevisionId } };
        st.library.set(fileId, st.build);
        return { reused: false };
      },
      notify: (m, e) => st.notes.push(`${e ? 'ERR ' : ''}${m}`)
    };
    st.client = createDriveClient({ getToken: auth.getAccessToken, transport: drive.transport(account, { delay, lag, offline: () => !online() }), sleep: clock.sleep, random: () => 0, now: clock.now });
    st.session = createDriveSession({ client: st.client, auth, host, clientId: `c${account}`, timers: clock, isVisible: () => true, storage: st.storage });
    st.state = () => st.session.getState();
    st.label = () => st.state().button?.label ?? 'no button';
    st.edit = (part) => {
      st.build = { ...st.build, instances: [...st.build.instances, { instanceId: part }], history: { rev: st.build.history.rev + 1 } };
    };
    st.run = async (promise, ms = 2000) => {
      await clock.advance(ms);
      return promise;
    };
    return st;
  }
  const downloadsBy = (account) => drive.log.filter((r) => r.account === account && r.method === 'GET' && r.url.includes('alt=media')).length;
  const uploadsBy = (account) => drive.log.filter((r) => r.account === account && r.url.includes('/upload/') && r.method === 'PATCH').length;

  // Save a local build to Drive, edit, save, Done editing
  const A = student('A');
  check('local build: no Drive button', A.state().button === null && !A.state().linked);
  await A.run(A.session.saveNewToDrive());
  A.session.attach();
  const fileId = A.state().fileId;
  check('Save to Google Drive…: new file, linked, locked, Done editing', fileId && drive.files.get(fileId).appProperties.lockHolderId === 'cA' && A.label() === 'Done editing');
  drive.files.get(fileId).parents = ['team-folder']; // A moves it into the shared folder in Drive
  drive.files.get(fileId).editors.add('B'); // the folder is shared with B as Editor
  A.edit('wheel');
  check('an edit → Save to Drive', A.label() === 'Save to Drive' && A.state().dirty);
  await A.run(A.session.pressButton());
  check('Save to Drive → uploaded, Saved to Drive shown, Done editing', A.notes.includes('Saved to Drive') && A.label() === 'Done editing' && JSON.parse(drive.files.get(fileId).content).instances.length === 2);
  check('  the moved file is still the one saved to', A.state().fileId === fileId);
  await clock.advance(3 * 60_000);
  check('heartbeats keep the lock for 3 minutes', A.state().mode === 'edit' && Number(drive.files.get(fileId).appProperties.lockExpiresAt) > clock.now());

  // B opens it from the shared folder while A holds it
  const B = student('B');
  B.pick = { id: fileId, name: 'TeamBot.vexiq.json' };
  await B.run(B.session.openFromDrive());
  check('B opens while A edits → Read-only · Locked by Student A', B.state().mode === 'readonly' && B.label() === 'Read-only · Locked by Student A' && B.state().button.tag && B.state().readOnlyViewer);
  check('  B sees A’s saved build', ids(B.build) === 'base,wheel');

  // Viewer refresh: heartbeats download nothing, a save downloads once
  const before = downloadsBy('B');
  await clock.advance(2 * 60_000);
  check('B polls through A’s heartbeats with no downloads', downloadsBy('B') === before);
  A.edit('arm');
  await A.run(A.session.saveToDrive());
  await clock.advance(11_000);
  check('A saves → B downloads it once and shows it', downloadsBy('B') === before + 1 && ids(B.build) === 'base,wheel,arm');

  // A save during B's Play mode waits
  B.busy = true;
  A.edit('claw');
  await A.run(A.session.saveToDrive());
  await clock.advance(11_000);
  check('during Play: the save is held, the view unchanged', B.state().pendingRefresh && ids(B.build) === 'base,wheel,arm');
  B.busy = false;
  B.session.busyChanged();
  check('  after Play: it comes in', !B.state().pendingRefresh && ids(B.build) === 'base,wheel,arm,claw');

  // Done editing (dirty: saves first, then releases) → unlock prompt for B
  A.edit('sensor');
  const upBefore = uploadsBy('A');
  await A.run(A.session.pressButton()); // Save to Drive
  await A.run(A.session.pressButton()); // Done editing
  check('Save then Done editing → Edit build, lock cleared', A.label() === 'Edit build' && A.state().mode === 'readonly' && !drive.files.get(fileId).appProperties.lockHolderId && uploadsBy('A') === upBefore + 1);
  await clock.advance(11_000);
  check('B: "now unlocked" banner, Edit build', B.state().banner === 'unlocked' && B.label() === 'Edit build');
  await B.run(B.session.enterEditMode());
  check('B: Edit build → latest content, lock taken, editing', B.state().mode === 'edit' && ids(B.build) === 'base,wheel,arm,claw,sensor' && drive.files.get(fileId).appProperties.lockHolderId === 'cB' && !B.state().readOnlyViewer);
  check('A sees B locked it', (await (async () => (await clock.advance(11_000), A.label()))()) === 'Read-only · Locked by Student B');

  // Done editing with nothing unsaved: no upload
  const upB = uploadsBy('B');
  await B.run(B.session.doneEditing());
  check('Done editing, all saved → no upload, released', uploadsBy('B') === upB && !drive.files.get(fileId).appProperties.lockHolderId);

  // The race only the 5-second check catches
  {
    const id = drive.addFile();
    const P = student('A', { delay: () => 10 });
    const Q = student('B', { delay: (i) => (i === 4 ? 450 : 10) }); // B's lock write is slow (about, meta, download, read, write)
    P.pick = Q.pick = { id, name: 'Race.vexiq.json' };
    const pp = P.session.openFromDrive();
    const pq = Q.session.openFromDrive();
    await clock.advance(2000);
    await Promise.all([pp, pq]);
    const both = P.state().mode === 'edit' && Q.state().mode === 'edit';
    await clock.advance(6000);
    check('lock race: both pass the read-back, the 5-second check drops one', both && P.state().mode === 'readonly' && P.label() === 'Read-only · Locked by Student B' && Q.state().mode === 'edit', `${P.state().mode}/${Q.state().mode}`);
  }

  // Asleep with unsaved edits while a teammate takes over and saves: all three choices keep the edits
  for (const choice of ['copy', 'latest', 'cancel']) {
    const id = drive.addFile({ content: content(['base'], 1) });
    let awake = true;
    const S = student('A', { online: () => awake });
    const T = student('B');
    S.pick = T.pick = { id, name: 'TeamBot.vexiq.json' };
    await S.run(S.session.openFromDrive());
    S.edit('mine');
    awake = false; // the iPad sleeps: heartbeats fail, the lease runs out
    await clock.advance(3 * 60_000);
    await T.run(T.session.openFromDrive());
    T.edit('theirs');
    await T.run(T.session.saveToDrive());
    const theirs = drive.files.get(id).content;
    awake = true;
    check(`[${choice}] asleep: still editing, button reads Reconnect to Drive`, S.state().mode === 'edit' && S.label() === 'Reconnect to Drive');
    await S.run(S.session.saveToDrive());
    check(`[${choice}] wake and save → refused, prompt shown, teammate’s file untouched`, S.state().prompt?.type === 'conflict' && drive.files.get(id).content === theirs);
    await S.run(S.session.resolveConflict(choice));
    if (choice === 'copy') {
      const copy = drive.files.get(S.state().fileId);
      check('  Save as a copy → TeamBot copy in the shared folder with my edits, editing it', copy.name === 'TeamBot copy.vexiq.json' && copy.parents[0] === 'team-folder' && copy.content.includes('mine') && S.state().mode === 'edit' && S.build.name === 'TeamBot copy');
      check('  the teammate’s file is untouched', drive.files.get(id).content === theirs);
    } else if (choice === 'latest') {
      check('  Load latest → my version kept as "TeamBot (my changes)"', S.copies[0]?.name === 'TeamBot (my changes)' && S.copies[0].instances.some((i) => i.instanceId === 'mine'));
      check('  and the teammate’s version opens read-only', ids(S.build) === 'base,theirs' && S.state().mode === 'readonly' && S.label() === 'Read-only · Locked by Student B');
    } else {
      check('  Cancel → paused, edits kept, Reconnect to Drive, nothing written', S.state().mode === 'disconnected' && ids(S.build) === 'base,mine' && S.label() === 'Reconnect to Drive' && drive.files.get(id).content === theirs);
    }
  }

  // Lost the lock with nothing unsaved: straight to Read-only, no prompt
  {
    const id = drive.addFile();
    let awake = true;
    const S = student('A', { online: () => awake });
    const T = student('B');
    S.pick = T.pick = { id, name: 'TeamBot.vexiq.json' };
    await S.run(S.session.openFromDrive());
    awake = false;
    await clock.advance(3 * 60_000);
    await T.run(T.session.openFromDrive());
    T.edit('theirs');
    await T.run(T.session.saveToDrive());
    awake = true;
    await clock.advance(46_000);
    check('clean and lost the lock → Read-only with the latest, no prompt', S.state().mode === 'readonly' && !S.state().prompt && ids(S.build).endsWith('theirs'));
  }

  // Reconnect after a reload (a new session, no sign-in): clean, dirty, and dirty after a teammate saved
  {
    const id = drive.addFile();
    const S = student('A');
    S.pick = { id, name: 'TeamBot.vexiq.json' };
    await S.run(S.session.openFromDrive());
    const lib = S.library;
    S.session.dispose(); // the tab is reloaded
    const reload = () => {
      const R = student('A', { library: lib });
      R.build = lib.get(id);
      R.session.attach();
      return R;
    };
    const R1 = reload();
    check('reload: opens paused, banner, Reconnect to Drive', R1.state().mode === 'disconnected' && R1.state().banner === 'paused' && R1.label() === 'Reconnect to Drive' && R1.state().readOnlyViewer);
    await R1.run(R1.session.pressButton());
    check('  Reconnect, nobody else edited → editing (same lock id)', R1.state().mode === 'edit' && R1.label() === 'Done editing');
    R1.edit('unsaved');
    lib.set(id, R1.build);
    R1.session.dispose(); // reloaded again
    const R2 = reload();
    await R2.run(R2.session.reconnectToDrive());
    check('reload with unsaved edits → Reconnect keeps them, Save to Drive', R2.state().mode === 'edit' && R2.label() === 'Save to Drive' && ids(R2.build).endsWith('unsaved'));
    lib.set(id, R2.build);
    await clock.advance(3 * 60_000);
    const T = student('B');
    T.pick = { id, name: 'TeamBot.vexiq.json' };
    R2.session.dispose(); // closed, so the lock runs out
    await clock.advance(3 * 60_000);
    await T.run(T.session.openFromDrive());
    T.edit('theirs');
    await T.run(T.session.saveToDrive());
    const R3 = reload();
    await R3.run(R3.session.reconnectToDrive());
    check('reload, unsaved, teammate saved meanwhile → the changed-on-Drive prompt', R3.state().prompt?.type === 'conflict');
  }

  // Work on this device only: no request, link gone, edits kept
  {
    const id = drive.addFile();
    const S = student('W');
    S.build = { ...S.build, instances: [{ instanceId: 'kept' }], drive: { fileId: id, fileName: 'TeamBot.vexiq.json', lastSyncedRev: 0, lastSyncedName: 'TeamBot', lastSyncedHeadRevisionId: drive.files.get(id).headRevisionId } };
    S.session.attach();
    const n = drive.log.length;
    S.session.workOnThisDeviceOnly();
    await clock.advance(60_000);
    check('Work on this device only → no request, no Drive button, edits kept', drive.log.slice(n).every((r) => r.account !== 'W') && S.state().button === null && S.build.drive === undefined && ids(S.build) === 'kept');
  }

  // Connection lost while editing, then back
  {
    const id = drive.addFile();
    let up = true;
    const S = student('A', { online: () => up });
    S.pick = { id, name: 'TeamBot.vexiq.json' };
    await S.run(S.session.openFromDrive());
    up = false;
    await clock.advance(46_000);
    S.edit('offline-edit');
    check('Wi-Fi drops while editing → keep editing, Reconnect to Drive', S.state().mode === 'edit' && !S.state().readOnlyViewer && S.label() === 'Reconnect to Drive');
    up = true;
    await clock.advance(46_000);
    check('  Wi-Fi back → next heartbeat → Save to Drive', S.state().connected && S.label() === 'Save to Drive');
  }

  // Leaving with unsaved Drive changes
  for (const choice of ['discard', 'save', 'cancel']) {
    const id = drive.addFile();
    const S = student('A');
    S.pick = { id, name: 'TeamBot.vexiq.json' };
    await S.run(S.session.openFromDrive());
    S.edit('pending');
    const leaving = S.session.leaveBuild();
    check(`[${choice}] leaving with unsaved changes asks first`, S.state().prompt?.type === 'leave');
    const answered = S.session.resolveLeave(choice);
    await clock.advance(3000);
    const go = await leaving;
    await answered;
    const f = drive.files.get(id);
    if (choice === 'discard') check('  Leave without saving → goes, lock released, edits stay in the local build, nothing uploaded', go && !f.appProperties.lockHolderId && ids(S.build).endsWith('pending') && !f.content.includes('pending'));
    if (choice === 'save') check('  Save and leave → uploaded, released, goes', go && f.content.includes('pending') && !f.appProperties.lockHolderId);
    if (choice === 'cancel') check('  Cancel → stays, still editing', !go && S.state().mode === 'edit' && f.appProperties.lockHolderId === 'cA');
  }
  {
    const id = drive.addFile();
    const S = student('A');
    S.pick = { id, name: 'TeamBot.vexiq.json' };
    await S.run(S.session.openFromDrive());
    const go = await S.session.leaveBuild();
    await clock.advance(1000);
    check('leaving with everything saved → no question, lock released', go && !drive.files.get(id).appProperties.lockHolderId);
  }

  // A tap before the Google scripts are ready → Continue to Google Drive
  {
    const id = drive.addFile();
    const S = student('A', { ready: false });
    S.pick = { id, name: 'TeamBot.vexiq.json' };
    const first = await S.session.openFromDrive();
    check('tap before the scripts load → Continue to Google Drive, nothing sent', first === false && S.state().needsContinue);
    S.authReady = true;
    await S.run(S.session.continueToDrive());
    check('  Continue → opens and locks', S.state().mode === 'edit' && !S.state().needsContinue);
  }

  // A heartbeat landing in the middle of a save must not look like someone else's save
  {
    const id = drive.addFile({ editors: ['X'] });
    let slowUpload = false;
    const S = student('X', { lag: (i, method, url) => (slowUpload && method === 'PATCH' && url.includes('/upload/') ? 60_000 : 0) });
    S.pick = { id, name: 'TeamBot.vexiq.json' };
    await S.run(S.session.openFromDrive());
    S.edit('slow-save');
    slowUpload = true;
    const saving = S.session.saveToDrive();
    await clock.advance(50_000); // a heartbeat has fired while the upload's reply is still on its way
    check('heartbeat during a slow save → no prompt and no pause meanwhile', S.state().mode === 'edit' && !S.state().prompt, `${S.state().mode} ${S.state().prompt?.type}`);
    await clock.advance(20_000);
    await saving;
    slowUpload = false;
    await clock.advance(50_000);
    check('heartbeat during a slow save → still editing, no prompt, Done editing', S.state().mode === 'edit' && !S.state().prompt && S.label() === 'Done editing' && drive.files.get(id).content.includes('slow-save'), `${S.state().mode} ${S.state().prompt?.type} ${S.label()}`);
  }

  // A heartbeat already on its way must not put the lock back after Done editing
  {
    const id = drive.addFile({ editors: ['Y'] });
    let slowBeat = false;
    const S = student('Y', { delay: (i, method, url, body) => (slowBeat && method === 'PATCH' && !url.includes('/upload/') && /"lockExpiresAt":"/.test(body || '') ? 3000 : 10) });
    S.pick = { id, name: 'TeamBot.vexiq.json' };
    await S.run(S.session.openFromDrive(), 1000);
    slowBeat = true;
    await clock.advance(44_480); // opened at about +460 ms, so the heartbeat at +45460 has read the file; its lock write is on its way
    const inFlight = drive.log.filter((r) => r.account === 'Y').slice(-1)[0];
    check('  (setup: the heartbeat has just read the file)', inFlight?.method === 'GET' && clock.now() - inFlight.at < 100, `${inFlight?.method} ${clock.now() - inFlight?.at}`);
    const done = S.session.doneEditing();
    await clock.advance(6000);
    await done;
    slowBeat = false;
    await clock.advance(60_000);
    check('heartbeat in flight during Done editing → lock stays cleared, Edit build', !drive.files.get(id).appProperties.lockHolderId && S.state().mode === 'readonly' && S.label() === 'Edit build', `${drive.files.get(id).appProperties.lockHolderId} ${S.state().mode}`);
  }

  // Leaving the page, and coming back to the tab
  {
    const id = drive.addFile({ editors: ['Z'] });
    const S = student('Z');
    S.pick = { id, name: 'TeamBot.vexiq.json' };
    await S.run(S.session.openFromDrive());
    S.edit('unsaved');
    S.session.pageHide();
    await clock.advance(100);
    check('page closed with unsaved edits → lock left to run out', drive.files.get(id).appProperties.lockHolderId === 'cZ');
    await S.run(S.session.saveToDrive());
    S.session.pageHide();
    await clock.advance(100);
    check('page closed with everything saved → lock cleared', !drive.files.get(id).appProperties.lockHolderId);
  }
  {
    const id = drive.addFile({ editors: ['Q'] });
    const S = student('Q');
    S.pick = { id, name: 'TeamBot.vexiq.json' };
    await S.run(S.session.openFromDrive(), 6000);
    const reads = () => drive.log.filter((r) => r.account === 'Q' && r.method === 'GET').length;
    const n = reads();
    S.session.visible();
    await clock.advance(100);
    check('back to the tab in Edit mode → lock checked at once', reads() === n + 1);
  }

  // Open from Google Drive… while editing another Drive build
  {
    const idA = drive.addFile({ editors: ['K'] });
    const idB = drive.addFile({ editors: ['K'] });
    const S = student('K');
    S.pick = { id: idA, name: 'A.vexiq.json' };
    await S.run(S.session.openFromDrive());
    S.pick = { id: idB, name: 'B.vexiq.json' };
    await S.run(S.session.openFromDrive());
    check('open another Drive file, nothing unsaved → the first file’s lock is released', !drive.files.get(idA).appProperties.lockHolderId && S.state().fileId === idB && S.state().mode === 'edit');

    S.edit('unsaved-b');
    S.pick = { id: idA, name: 'A.vexiq.json' };
    const pickedBefore = drive.log.filter((r) => r.account === 'K' && r.url.includes(idA)).length;
    const first = await S.session.openFromDrive();
    await clock.advance(1000);
    check('open another Drive file with unsaved changes → the leave question, not the Picker', first === false && S.state().prompt?.type === 'leave' && drive.log.filter((r) => r.account === 'K' && r.url.includes(idA)).length === pickedBefore);
    await S.run(S.session.resolveLeave('discard'));
    check('  Leave without saving → lock released, build paused with its edits, asked to tap again', !drive.files.get(idB).appProperties.lockHolderId && S.state().mode === 'disconnected' && ids(S.build).endsWith('unsaved-b') && S.notes.at(-1)?.includes('Open from Google Drive… again'));
    await S.run(S.session.openFromDrive());
    check('  tapping again opens the other file', S.state().fileId === idA && S.state().mode === 'edit');

    S.edit('unsaved-a');
    S.pick = { id: idB, name: 'B.vexiq.json' };
    await S.session.openFromDrive();
    await S.run(S.session.resolveLeave('save'));
    check('  Save and leave → saved, released, Read-only until tapped again', drive.files.get(idA).content.includes('unsaved-a') && !drive.files.get(idA).appProperties.lockHolderId && S.state().mode === 'readonly');
  }

  // Save to Google Drive… asks where, every time
  {
    drive.folders.set('team-folder', new Set(['A', 'B', 'F']));
    const posts = () => drive.log.filter((r) => r.account === 'F' && r.method === 'POST').length;
    const F = student('F');
    F.session.askWhereToSave();
    check('Save to Google Drive… asks where, with no last folder the first time', F.state().prompt?.type === 'save-where' && F.state().prompt.lastFolder === null);
    F.folderPick = { id: 'team-folder', name: 'Team Robot' };
    await F.run(F.session.resolveSaveWhere('choose'));
    const f1 = drive.files.get(F.state().fileId);
    check('  Choose a folder… → created in the team folder, linked, locked, remembered', f1?.parents[0] === 'team-folder' && F.state().mode === 'edit' && f1.appProperties.lockHolderId === 'cF' && F.notes.at(-1) === 'Saved TeamBot.vexiq.json in Team Robot');

    const G = student('F', { storage: F.storage });
    G.session.askWhereToSave();
    check('  next time it offers Save in Team Robot', G.state().prompt?.lastFolder?.name === 'Team Robot');
    await G.run(G.session.resolveSaveWhere('last'));
    check('  Save in Team Robot → created there', drive.files.get(G.state().fileId)?.parents[0] === 'team-folder');

    const n = posts();
    const H = student('F');
    H.session.askWhereToSave();
    H.folderPick = null; // the folder picker is closed without picking
    await H.run(H.session.resolveSaveWhere('choose'));
    check('  picker closed without picking → nothing saved, still a local build', posts() === n && H.state().button === null && !H.build.drive);
    H.session.askWhereToSave();
    await H.run(H.session.resolveSaveWhere('cancel'));
    check('  Cancel → nothing saved', posts() === n && !H.build.drive && !H.state().prompt);

    H.session.askWhereToSave();
    H.folderPick = { id: 'viewer-folder', name: 'Look Only' }; // shared as Viewer: Drive refuses
    await H.run(H.session.resolveSaveWhere('choose'));
    check('  a folder Drive refuses → My Drive with the move message, folder not remembered', drive.files.get(H.state().fileId)?.parents[0] === 'my-drive-F' && H.notes.at(-1)?.startsWith('Saved in your My Drive') && H.storage.getItem('vexiq.driveLastFolder') === null);

    const M = student('F');
    M.session.askWhereToSave();
    await M.run(M.session.resolveSaveWhere('myDrive'));
    check('  My Drive → created at the top of My Drive', drive.files.get(M.state().fileId)?.parents[0] === 'my-drive-F' && M.notes.at(-1) === 'Saved TeamBot.vexiq.json in your My Drive');
  }

  // View-only teammate
  {
    const id = drive.addFile({ editors: ['A'] });
    const V = student('B');
    V.pick = { id, name: 'TeamBot.vexiq.json' };
    await V.run(V.session.openFromDrive());
    check('shared as Viewer → Read-only tag, no lock written', V.label() === 'Read-only' && V.state().button.tag && !drive.files.get(id).appProperties.lockHolderId);
  }
}

// ---------------------------------------------------------------------------------------------
section('Offline copy (src/offline/sw.js) leaves Google alone');
{
  const fs = await import('node:fs');
  const sw = fs.readFileSync(new URL('../src/offline/sw.js', import.meta.url), 'utf8');
  const fetchHandler = sw.slice(sw.indexOf("addEventListener('fetch'"), sw.indexOf("addEventListener('message'"));
  check('the offline copy answers only requests to the app’s own address', fetchHandler.split('\n').some((line) => line.includes('!request.url.startsWith(scope)') && line.trim().endsWith('return;')));
  check('  and nothing in it mentions Google', !/google/i.test(sw));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll Google Drive sync checks passed');
process.exit(failures ? 1 : 0);
