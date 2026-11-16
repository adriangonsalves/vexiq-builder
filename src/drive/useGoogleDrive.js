/**
 * React side of Google Drive sync (openspec google-drive-sync): one driveSession for the app, fed the
 * open build through `host`, re-rendering when the session changes. All the rules are in
 * driveSession.js.
 *
 * `host` (see driveSession.js) is read through a ref, so App can pass a fresh object each render.
 * `buildKey` changes when the open build or its Drive link changes; `busy` is Play mode or Explode.
 */
import { useEffect, useReducer, useRef, useState } from 'react';
import { createDriveClient } from './driveClient.js';
import { getOrCreateClientId } from './driveLock.js';
import { createDriveSession } from './driveSession.js';
import { driveConfigured, dropAccessToken, getAccessToken, onAuthChange, openDrivePicker, openFolderPicker, preloadGoogleDriveScripts, scriptStatus, signInFromTap } from './googleAuth.js';

export function useGoogleDrive({ host, buildKey, busy }) {
  const hostRef = useRef(host);
  hostRef.current = host;
  const [, rerender] = useReducer((n) => n + 1, 0);

  const [session] = useState(() =>
    createDriveSession({
      client: createDriveClient({ getToken: getAccessToken }),
      auth: { signInFromTap, getAccessToken, dropAccessToken, openDrivePicker, openFolderPicker, preload: preloadGoogleDriveScripts },
      clientId: getOrCreateClientId(),
      host: {
        getBuild: () => hostRef.current.getBuild(),
        setDrive: (d) => hostRef.current.setDrive(d),
        isBusy: () => hostRef.current.isBusy(),
        replaceBuildContent: (c) => hostRef.current.replaceBuildContent(c),
        saveLocalCopy: (b) => hostRef.current.saveLocalCopy(b),
        linkAsNewFile: (b) => hostRef.current.linkAsNewFile(b),
        openDriveBuild: (b) => hostRef.current.openDriveBuild(b),
        notify: (m, e) => hostRef.current.notify(m, e)
      }
    })
  );

  useEffect(() => {
    const offSession = session.subscribe(rerender);
    const offAuth = onAuthChange(rerender);
    const onVisible = () => {
      if (document.visibilityState === 'visible') session.visible();
    };
    const onPageHide = () => session.pageHide();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      offSession();
      offAuth();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [session]);

  // The open build (or its link) changed
  useEffect(() => {
    session.attach();
  }, [session, buildKey]);

  // Play mode ended or Explode closed: a held teammate save comes in
  useEffect(() => {
    if (!busy) session.busyChanged();
  }, [session, busy]);

  return { ...session.getState(), configured: driveConfigured(), scriptsReady: scriptStatus() === 'ready', session };
}
