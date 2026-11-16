/**
 * Google sign-in and the Google Picker for builds on Drive (openspec google-drive-sync, decision 1).
 *
 * iPad Safari blocks the sign-in window unless it opens straight from a tap, with nothing awaited in
 * between. So the two Google scripts are loaded ahead of time (preloadGoogleDriveScripts: when the
 * File menu or Load dialog opens, or at start with a Drive-linked build), and signInFromTap() calls
 * requestAccessToken() synchronously. A tap that comes before the scripts are ready gets
 * { needsContinue } back, and the app shows a one-tap Continue to Google Drive.
 *
 * Tokens live in memory only (about an hour, gone on reload); that is why a reloaded Drive build
 * opens paused with Reconnect to Drive.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
const TOKEN_MARGIN_MS = 60_000;

const env = import.meta.env ?? {};
export const driveConfig = {
  clientId: env.VITE_GOOGLE_CLIENT_ID || '',
  apiKey: env.VITE_GOOGLE_API_KEY || '',
  appId: env.VITE_GOOGLE_APP_ID || ''
};
/** Whether this copy of the app was built with Google project values (else no Drive items show). */
export const driveConfigured = () => Boolean(driveConfig.clientId && driveConfig.apiKey && driveConfig.appId);

let loadPromise = null;
let status = 'idle'; // 'idle' | 'loading' | 'ready' | 'failed'
let tokenClient = null;
let token = null; // { accessToken, expiresAt }
let pending = null; // { resolve, reject } for the sign-in in progress
let signedInBefore = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

/** 'idle' | 'loading' | 'ready' | 'failed' */
export const scriptStatus = () => status;
export const onAuthChange = (fn) => (listeners.add(fn), () => listeners.delete(fn));

/** Loads a script once. `isLoaded` checks for what it defines, so a script already on the page counts. */
function loadScript(src, isLoaded) {
  return new Promise((resolve, reject) => {
    if (isLoaded()) return resolve();
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing?.dataset.loaded) return resolve();
    const s = existing ?? document.createElement('script');
    s.addEventListener('load', () => ((s.dataset.loaded = '1'), resolve()), { once: true });
    s.addEventListener('error', () => (s.remove(), reject(new Error(`Couldn't load ${src}`))), { once: true });
    if (!existing) {
      s.src = src;
      s.async = true;
      document.head.appendChild(s);
    }
  });
}

function failSignIn(kind, message) {
  const err = Object.assign(new Error(message), { kind });
  pending?.reject(err);
  pending = null;
}

/** Starts loading the Google scripts (once). Safe to call often; never blocks the app. */
export function preloadGoogleDriveScripts() {
  if (!driveConfigured() || typeof document === 'undefined') return Promise.resolve(false);
  if (loadPromise) return loadPromise;
  status = 'loading';
  notify();
  const gisLoaded = () => Boolean(window.google?.accounts?.oauth2);
  const pickerLoaded = () => Boolean(window.google?.picker?.PickerBuilder);
  loadPromise = Promise.all([
    loadScript(GIS_SRC, gisLoaded),
    loadScript(GAPI_SRC, () => Boolean(window.gapi?.load)).then(() =>
      pickerLoaded() ? null : new Promise((r, j) => window.gapi.load('picker', { callback: r, onerror: j, timeout: 15_000, ontimeout: j }))
    )
  ])
    .then(() => {
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: driveConfig.clientId,
        scope: DRIVE_SCOPE,
        callback: (resp) => {
          if (resp.error) return failSignIn('denied', resp.error_description || resp.error);
          token = { accessToken: resp.access_token, expiresAt: Date.now() + Number(resp.expires_in || 3600) * 1000 };
          signedInBefore = true;
          pending?.resolve(token.accessToken);
          pending = null;
          notify();
        },
        error_callback: (err) => {
          if (err?.type === 'popup_failed_to_open') failSignIn('popup-blocked', 'The Google sign-in window was blocked.');
          else failSignIn('cancelled', 'Google sign-in was closed.');
        }
      });
      status = 'ready';
      notify();
      return true;
    })
    .catch(() => {
      status = 'failed';
      loadPromise = null; // let a later open try again
      notify();
      return false;
    });
  return loadPromise;
}

/** The current access token, or null when signed out or about to run out. */
export function getAccessToken() {
  return token && token.expiresAt - TOKEN_MARGIN_MS > Date.now() ? token.accessToken : null;
}
export const isSignedIn = () => Boolean(getAccessToken());

/** Forget the token (after Google says it is no longer valid). */
export function dropAccessToken() {
  token = null;
  notify();
}

/**
 * Call straight from a tap handler, before any await. Returns
 *   { promise }          the sign-in window opened; resolves to the token
 *   { token }            already signed in
 *   { needsContinue, ready }  scripts still loading: show Continue to Google Drive, whose tap
 *                        calls this again (ready resolves when it can)
 *   { unavailable }      not configured, or Google couldn't be reached
 */
export function signInFromTap({ forceAccountChooser = false } = {}) {
  if (!driveConfigured()) return { unavailable: true };
  const current = getAccessToken();
  if (current && !forceAccountChooser) return { token: current };
  if (status !== 'ready' || !tokenClient) {
    const ready = preloadGoogleDriveScripts();
    return status === 'failed' ? { unavailable: true } : { needsContinue: true, ready };
  }
  if (pending) failSignIn('cancelled', 'A newer sign-in started.');
  const promise = new Promise((resolve, reject) => (pending = { resolve, reject }));
  tokenClient.requestAccessToken({ prompt: forceAccountChooser || !signedInBefore ? 'select_account' : '' });
  return { promise };
}

/**
 * The Google Picker choosing a folder for Save to Google Drive…: My Drive and Shared with me, folders
 * only. Picking a folder this way gives the app access to it under drive.file. Resolves to
 * { id, name } or null when closed. (It can't choose the top of My Drive itself; the app offers
 * My Drive as its own choice.)
 */
export function openFolderPicker(accessToken, { title = 'Choose a folder' } = {}) {
  return new Promise((resolve, reject) => {
    const picker = window.google?.picker;
    if (!picker) return reject(Object.assign(new Error('The Google file picker is not loaded.'), { kind: 'unavailable' }));
    const view = (ownedByMe, label) => {
      const v = new picker.DocsView(picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder').setOwnedByMe(ownedByMe);
      if (typeof v.setLabel === 'function') v.setLabel(label);
      return v;
    };
    new picker.PickerBuilder()
      .setTitle(title)
      .setOAuthToken(accessToken)
      .setDeveloperKey(driveConfig.apiKey)
      .setAppId(driveConfig.appId)
      .setOrigin(`${window.location.protocol}//${window.location.host}`)
      .addView(view(true, 'My Drive'))
      .addView(view(false, 'Shared with me'))
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve({ id: data.docs[0].id, name: data.docs[0].name });
        else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

/**
 * The Google Picker: My Drive and Shared with me, both with folders so a teammate can open a shared
 * folder and pick the build inside (Drive lists only the folder under Shared with me). Passing the
 * project number gives this app access to the picked file under drive.file. Resolves to
 * { id, name } or null when closed.
 */
export function openDrivePicker(accessToken) {
  return new Promise((resolve, reject) => {
    const picker = window.google?.picker;
    if (!picker) return reject(Object.assign(new Error('The Google file picker is not loaded.'), { kind: 'unavailable' }));
    const view = (ownedByMe, label) => {
      const v = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes('application/json').setIncludeFolders(true).setOwnedByMe(ownedByMe);
      if (typeof v.setLabel === 'function') v.setLabel(label);
      return v;
    };
    new picker.PickerBuilder()
      .setTitle('Open a build from Google Drive')
      .setOAuthToken(accessToken)
      .setDeveloperKey(driveConfig.apiKey)
      .setAppId(driveConfig.appId)
      .setOrigin(`${window.location.protocol}//${window.location.host}`)
      .addView(view(true, 'My Drive'))
      .addView(view(false, 'Shared with me'))
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve({ id: data.docs[0].id, name: data.docs[0].name });
        else if (data.action === picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
