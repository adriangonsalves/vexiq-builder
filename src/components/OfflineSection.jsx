import React from 'react';
import { Share } from 'lucide-react';
import { formatMB } from '../offline/useOffline.js';

const dateText = (at) => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null);

/** Steps for installing the app in this browser (see installKind in src/offline/install.js). */
function InstallSteps({ kind, onInstall }) {
  if (kind === 'installed') return <p className="settings-note">The app is installed on this device.</p>;
  if (kind === 'prompt') {
    return (
      <div className="offline-install">
        <p className="settings-note">Install it to open it from your apps, in its own window, even with no internet.</p>
        <button type="button" className="btn btn-primary-action" onClick={onInstall}>
          Install app
        </button>
      </div>
    );
  }
  if (kind === 'ios-safari' || kind === 'ios-other') {
    return (
      <ol className="offline-steps">
        <li>
          Tap the Share button <Share size={13} aria-label="Share" /> {kind === 'ios-safari' ? 'in Safari’s toolbar' : 'in the browser’s menu'}.
        </li>
        <li>
          Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
        </li>
        <li>Open VEX IQ from the Home Screen.</li>
      </ol>
    );
  }
  if (kind === 'mac-safari') {
    return (
      <ol className="offline-steps">
        <li>
          In Safari’s menu bar, choose <strong>File → Add to Dock…</strong>
        </li>
        <li>Open VEX IQ from the Dock or Launchpad.</li>
      </ol>
    );
  }
  return <p className="settings-note">This browser can’t install the app, but the site still works offline in this browser.</p>;
}

/**
 * Settings' Offline section on the static site (openspec offline-app): the Use offline switch, the
 * size check, download progress, the copy's state, keeping the data, backups and installing.
 * `offline` is what useOffline returns.
 */
export default function OfflineSection({ offline, sectionRef }) {
  const { status, progress, space, stop, notice, updating, downloadedAt, persisted, install } = offline;
  const on = status !== 'off';
  const nothingSaved = status === 'checking' || status === 'confirm' || status === 'ios-first';

  const onSwitch = (checked) => {
    if (checked) return offline.turnOn();
    if (nothingSaved) return offline.cancelConfirm();
    if (window.confirm('Remove the offline copy? The app will need the internet again. Your builds stay.')) offline.turnOff();
  };

  const percent = progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <section className="settings-section offline-section" ref={sectionRef}>
      <h3>Offline</h3>
      <label className="settings-row">
        <span className="settings-row-text">
          <span className="settings-row-label">Use offline</span>
          <span className="settings-row-hint">Download the app and every part, so it works with no internet</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="settings-switch"
          checked={on}
          disabled={!offline.ready}
          onChange={(e) => onSwitch(e.target.checked)}
        />
      </label>

      <div className="offline-status" aria-live="polite">
        {status === 'off' && <p className="settings-note">{notice ?? 'Not downloaded.'}</p>}

        {status === 'ios-first' && (
          <div className="offline-card">
            <p className="settings-note">
              On iPad and iPhone, an app on the Home Screen keeps its own copy, apart from Safari. Add it to the Home Screen first, open it from
              there, and turn on Use offline inside it.
            </p>
            <InstallSteps kind={install} />
            <p className="settings-note">
              Builds made here don’t appear in the Home Screen app. To move one, use <strong>File → Export</strong> here, then{' '}
              <strong>File → Load… → Open from computer…</strong> in the app.
            </p>
            <div className="offline-actions">
              <button type="button" className="btn btn-outline" onClick={offline.showSizeCheck}>
                Download in Safari anyway
              </button>
              <button type="button" className="btn" onClick={offline.cancelConfirm}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === 'checking' && <p className="settings-note">Checking the download size…</p>}

        {status === 'confirm' && space && (
          <div className="offline-card">
            <p className="settings-note">
              The download is about <strong>{formatMB(space.needed)}</strong>.
              {space.available != null && ` This device has about ${formatMB(space.available)} free for it.`}
            </p>
            <div className="offline-actions">
              <button type="button" className="btn btn-primary-action" onClick={offline.confirmDownload}>
                Download
              </button>
              <button type="button" className="btn" onClick={offline.cancelConfirm}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === 'downloading' && (
          <div className="offline-card">
            <p className="settings-note">{updating ? 'Downloading the new version…' : 'Downloading…'}</p>
            <div className="offline-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <div className="offline-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="offline-actions">
              <span className="offline-progress-text">
                {progress.total ? `${Math.round(progress.done / 1e6)} of ${formatMB(progress.total)}` : 'Getting ready…'}
              </span>
              <button type="button" className="btn" onClick={offline.cancelDownload}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {status === 'available' && (
          <p className="settings-note offline-ok">
            Available offline{downloadedAt ? ` · downloaded ${dateText(downloadedAt)}` : ''}.
          </p>
        )}

        {status === 'update' && (
          <div className="offline-card">
            <p className="settings-note">
              <strong>Update needed.</strong> A new version is out. Until you download it, the app keeps working offline with the version you
              have.
            </p>
            {stop && <p className="settings-note offline-warn">Download stopped: {stop.message}.</p>}
            <div className="offline-actions">
              <button type="button" className="btn btn-primary-action" onClick={offline.resume}>
                Download update
              </button>
            </div>
          </div>
        )}

        {status === 'stopped' && (
          <div className="offline-card">
            <p className="settings-note offline-warn">Download stopped: {stop?.message ?? 'it didn’t finish'}.</p>
            <div className="offline-actions">
              <button type="button" className="btn btn-primary-action" onClick={offline.resume}>
                Resume
              </button>
            </div>
          </div>
        )}
      </div>

      {on && !nothingSaved && persisted != null && (
        <p className="settings-note">
          {persisted
            ? 'This browser will keep the offline copy and your builds.'
            : 'This browser may clear the offline copy and your builds if the app isn’t used for a while. Installing the app makes this less likely.'}
        </p>
      )}
      <p className="settings-note">
        Builds are kept only in this browser on this device. Use <strong>File → Export</strong> to save a copy you can keep.
      </p>

      {status !== 'ios-first' && (
        <div className="offline-install-wrap">
          {offline.showInstallGuide || install === 'installed' ? (
            <InstallSteps kind={install} onInstall={offline.promptInstall} />
          ) : (
            <button type="button" className="link-btn" onClick={() => offline.setShowInstallGuide(true)}>
              Install the app
            </button>
          )}
        </div>
      )}
    </section>
  );
}
