/**
 * A pretend Google for the Google Drive help pictures (openspec google-drive-sync): stand-ins for
 * Google sign-in and the Picker in the page, and a small Drive that answers the app's requests, so
 * the pictures show the real Drive button, banners and viewer without a Google account.
 *
 * The static build must have been made with Google values in .env.local (any values do), or the
 * Drive menu items aren't there to photograph.
 *
 *   await usePretendDrive(app, { files: [{ id, name, lockedBy }] })
 *   - signing in always works, as "Ana"
 *   - the Picker picks the first file in `files`, or, choosing a folder, "Team Robot"
 *   - a file with `lockedBy: 'Maya'` is locked by Maya for the next hour
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sampleBuild = () => fs.readFileSync(path.join(ROOT, 'scripts/help-shots/builds/two-beams-pin.vexiq.json'), 'utf8');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS'
};

export async function usePretendDrive(app, { files = [] } = {}) {
  const { page } = app;
  const store = new Map();
  let rev = 1;
  for (const f of files) {
    const appProperties = f.lockedBy ? { lockHolderId: 'client-teammate', lockHolderName: f.lockedBy, lockAt: String(Date.now()), lockExpiresAt: String(Date.now() + 3_600_000) } : {};
    store.set(f.id, { id: f.id, name: f.name, parents: ['team-folder'], appProperties, content: f.content ?? sampleBuild(), headRevisionId: `rev-${rev++}`, canEdit: f.canEdit !== false });
  }
  const meta = (f) => ({ id: f.id, name: f.name, headRevisionId: f.headRevisionId, modifiedTime: new Date().toISOString(), parents: f.parents, appProperties: { ...f.appProperties }, capabilities: { canEdit: f.canEdit } });
  const applyProps = (f, props = {}) => {
    for (const [k, v] of Object.entries(props)) {
      if (v === null) delete f.appProperties[k];
      else f.appProperties[k] = String(v);
    }
  };
  const multipart = (body) => {
    const parts = String(body || '').split(/--vexiq[a-z0-9]+/).filter((p) => p.includes('\r\n\r\n'));
    const [m, c] = parts.map((p) => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''));
    return { metadata: JSON.parse(m || '{}'), content: c ?? '' };
  };

  // The page: Google's two scripts count as loaded, with stand-ins that work without Google
  await page.evaluate((first) => {
    window.gapi = { load: (_name, opts) => setTimeout(() => (typeof opts === 'function' ? opts() : opts?.callback?.()), 0) };
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg) => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'pretend-token', expires_in: 3600, scope: cfg.scope }), 50) })
        }
      },
      picker: (() => {
        class DocsView {
          constructor(viewId) { this.viewId = viewId; }
          setSelectFolderEnabled() { return this; }
          setMimeTypes() { return this; }
          setIncludeFolders() { return this; }
          setOwnedByMe() { return this; }
          setLabel() { return this; }
        }
        class PickerBuilder {
          constructor() { this.cb = null; this.folders = false; }
          setTitle() { return this; }
          setOAuthToken() { return this; }
          setDeveloperKey() { return this; }
          setAppId() { return this; }
          setOrigin() { return this; }
          addView(v) { if (v?.viewId === 'folders') this.folders = true; return this; }
          setCallback(cb) { this.cb = cb; return this; }
          build() {
            const cb = this.cb;
            const doc = this.folders ? { id: 'team-folder', name: 'Team Robot' } : first;
            return { setVisible: () => setTimeout(() => cb({ action: 'picked', docs: doc ? [doc] : [] }), 50) };
          }
        }
        return { DocsView, PickerBuilder, ViewId: { DOCS: 'docs', FOLDERS: 'folders' }, Action: { PICKED: 'picked', CANCEL: 'cancel', LOADED: 'loaded' } };
      })()
    };
  }, files[0] ? { id: files[0].id, name: files[0].name } : null);

  // The network: Google's scripts are never fetched; Drive requests get the pretend Drive's answers
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.isInterceptResolutionHandled?.()) return;
    const url = new URL(req.url());
    const reply = (status, body, type = 'application/json') => req.respond({ status, headers: CORS, contentType: type, body: typeof body === 'string' ? body : JSON.stringify(body) });
    if (url.hostname === 'accounts.google.com' || url.hostname === 'apis.google.com') return req.abort();
    if (url.hostname !== 'www.googleapis.com') return req.continue();
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: CORS, body: '' });
    if (url.pathname.endsWith('/about')) return reply(200, { user: { displayName: 'Ana' } });
    const upload = url.pathname.startsWith('/upload/');
    if (req.method() === 'POST' && upload) {
      const { metadata, content } = multipart(req.postData());
      const id = `pretend-${store.size + 1}`;
      const f = { id, name: metadata.name, parents: metadata.parents ?? ['my-drive'], appProperties: {}, content, headRevisionId: `rev-${rev++}`, canEdit: true };
      applyProps(f, metadata.appProperties);
      store.set(id, f);
      return reply(200, meta(f));
    }
    const id = decodeURIComponent(url.pathname.split('/').pop());
    const f = store.get(id);
    if (!f) return reply(404, { error: { message: 'File not found' } });
    if (req.method() === 'GET') return url.searchParams.get('alt') === 'media' ? reply(200, f.content) : reply(200, meta(f));
    if (req.method() === 'PATCH') {
      if (upload) {
        const { metadata, content } = multipart(req.postData());
        if (metadata.name) f.name = metadata.name;
        applyProps(f, metadata.appProperties);
        f.content = content;
        f.headRevisionId = `rev-${rev++}`;
      } else {
        applyProps(f, JSON.parse(req.postData() || '{}').appProperties);
      }
      return reply(200, meta(f));
    }
    return reply(400, { error: { message: 'Not supported by the pretend Drive' } });
  });
  return store;
}

/** Links the open build to a pretend Drive file and reloads, so it opens paused (Reconnect to Drive). */
export async function openPausedDriveBuild(app) {
  const { page } = app;
  const name = await page.$eval('.build-name', (e) => e.textContent.trim());
  await page.evaluate(async (name) => {
    const db = await new Promise((res) => {
      const q = indexedDB.open('vexiq-builds');
      q.onsuccess = () => res(q.result);
    });
    const store = db.objectStoreNames[0];
    const all = await new Promise((res) => {
      const t = db.transaction(store).objectStore(store).getAll();
      t.onsuccess = () => res(t.result);
    });
    const rec = all.find((r) => r.name === name);
    rec.drive = { fileId: 'pretend-paused', fileName: `${name}.vexiq.json`, lastSyncedRev: (rec.history?.rev ?? 0) - 1, lastSyncedName: name, lastSyncedHeadRevisionId: 'rev-1' };
    await new Promise((res) => {
      const t = db.transaction(store, 'readwrite');
      t.objectStore(store).put(rec);
      t.oncomplete = res;
    });
  }, name);
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('.topbar', { timeout: 30000 });
  await app.waitForCatalog();
  await page.waitForSelector('[data-help="drive-paused"]', { timeout: 15000 });
}
