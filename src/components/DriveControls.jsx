import React, { useEffect, useRef } from 'react';
import { CloudCheck, CloudOff, CloudUpload, Copy, DownloadCloud, Folder, FolderSearch, HardDrive, LogOut, Lock, Pencil, Save, X } from 'lucide-react';
import { CHANGED_ON_DRIVE } from '../drive/driveSession.js';

/**
 * Google Drive controls (openspec google-drive-sync): the one Drive button beside the build name, the
 * banners over the view (paused, now unlocked, Continue to Google Drive), and the two questions
 * (changed on Drive; leaving with unsaved Drive changes). What they show comes from useGoogleDrive.
 */

const ICONS = { saveToDrive: CloudUpload, doneEditing: CloudCheck, reconnectToDrive: CloudOff, enterEditMode: Pencil };
// On a phone the button shows its icon and one short word
const SHORT = { saveToDrive: 'Save', doneEditing: 'Done', reconnectToDrive: 'Reconnect', enterEditMode: 'Edit' };
const Label = ({ full, short }) => (
  <>
    <span className="drive-label drive-label-full">{full}</span>
    <span className="drive-label drive-label-short">{short}</span>
  </>
);

/**
 * The Drive button: its label names the state and selecting it does that; a tag does nothing.
 * `compact`: the copy in the toolbar row on tablets and phones, where the build name is hidden.
 */
export function DriveButton({ drive, compact = false }) {
  const b = drive.button;
  if (!b) return null;
  if (b.tag) {
    return (
      <span className={`drive-button drive-tag ${compact ? 'drive-compact' : 'drive-wide'}`} data-help="drive-button" title={b.holderName ? `${b.holderName} is editing this build. You can look, Explode and Play.` : 'You can only view this build.'}>
        <Lock size={13} />
        <Label full={b.label} short="Read-only" />
      </span>
    );
  }
  const Icon = ICONS[b.action] ?? CloudUpload;
  const titles = {
    saveToDrive: 'Save your changes to Google Drive (Ctrl/Cmd+S)',
    doneEditing: 'Everything is saved. Finish editing so a teammate can edit.',
    reconnectToDrive: 'Sign in to Google Drive again to keep saving there',
    enterEditMode: 'Start editing this build (teammates see it locked)'
  };
  return (
    <button
      type="button"
      className={`btn drive-button drive-${b.action} ${compact ? 'drive-compact' : 'drive-wide'}`}
      data-help="drive-button"
      disabled={drive.working}
      onClick={() => drive.session.pressButton()}
      title={titles[b.action]}
    >
      <Icon size={14} />
      <Label full={drive.working ? 'Working…' : b.label} short={drive.working ? '…' : SHORT[b.action]} />
    </button>
  );
}

/** Banners over the 3D view: paused (Reconnect / Work on this device only), now unlocked, Continue. */
export function DriveBanners({ drive, buildName }) {
  const { session } = drive;
  // A tap came before the Google scripts were ready: Continue opens sign-in straight from its own tap
  const continueButton = (
    <button type="button" className="btn btn-primary-action" disabled={!drive.scriptsReady} onClick={() => session.continueToDrive()}>
      {drive.scriptsReady ? 'Continue to Google Drive' : 'Connecting…'}
    </button>
  );
  if (drive.needsContinue && !(drive.linked && drive.mode === 'disconnected' && !drive.prompt)) {
    return (
      <div className="offline-update-banner drive-banner" role="status">
        <span>{drive.scriptsReady ? 'Google Drive is ready.' : 'Connecting to Google Drive…'}</span>
        {continueButton}
      </div>
    );
  }
  if (!drive.linked || drive.prompt) return null;
  if (drive.mode === 'disconnected') {
    return (
      <div className="offline-update-banner drive-banner" role="status" data-help="drive-paused">
        <span>
          <strong>This build is on Google Drive. Reconnect to keep editing.</strong>
          {drive.dirty && <> You have changes that are not on Drive yet.</>}
        </span>
        {drive.needsContinue ? (
          continueButton
        ) : (
          <button type="button" className="btn btn-primary-action" disabled={drive.working} onClick={() => session.reconnectToDrive()}>
            Reconnect to Drive
          </button>
        )}
        <button type="button" className="btn btn-outline" onClick={() => session.workOnThisDeviceOnly()} title="Keep your changes and edit here, without Google Drive">
          Work on this device only
        </button>
      </div>
    );
  }
  if (drive.banner === 'unlocked' && drive.mode === 'readonly') {
    return (
      <div className="offline-update-banner drive-banner" role="status" data-help="drive-unlocked">
        <span>
          <strong>{buildName} is now unlocked.</strong> Open in edit mode?
        </span>
        <button type="button" className="btn btn-primary-action" disabled={drive.working} onClick={() => session.enterEditMode()}>
          Edit build
        </button>
        <button type="button" className="btn btn-outline" onClick={() => session.dismissUnlock()}>
          Stay read-only
        </button>
      </div>
    );
  }
  return null;
}

/** A modal question whose closing (Esc, ×, a tap outside) means Cancel. */
function Question({ open, title, onCancel, children, help }) {
  const ref = useRef(null);
  const answeredRef = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      answeredRef.current = false;
      dialog.showModal();
    }
    if (!open && dialog.open) {
      answeredRef.current = true;
      dialog.close();
    }
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const onClose = () => {
      if (!answeredRef.current) onCancel();
    };
    dialog.addEventListener('close', onClose);
    return () => dialog.removeEventListener('close', onClose);
  }, [onCancel]);
  const answer = (fn) => () => {
    answeredRef.current = true;
    ref.current?.close();
    fn();
  };
  return (
    <dialog ref={ref} className="settings-dialog open-or-add-dialog" aria-labelledby={`${help}-title`} data-help={help}>
      <div className="settings-header">
        <strong id={`${help}-title`}>{title}</strong>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cancel" title="Cancel (Esc)">
          <X size={16} />
        </button>
      </div>
      <div className="settings-body">{children(answer)}</div>
    </dialog>
  );
}

function Choice({ icon: Icon, title, note, onClick, autoFocus }) {
  return (
    <button type="button" className="btn btn-outline open-or-add-btn" autoFocus={autoFocus} onClick={onClick}>
      <Icon size={20} />
      <span>
        <strong>{title}</strong>
        {note && <small>{note}</small>}
      </span>
    </button>
  );
}

/** The where-to-save question, the changed-on-Drive question and the leave question. */
export function DriveQuestions({ drive, buildName }) {
  const { session, prompt } = drive;
  const name = buildName || 'This build';
  const conflict = prompt?.type === 'conflict';
  const leave = prompt?.type === 'leave';
  const saveWhere = prompt?.type === 'save-where';
  const lastFolder = saveWhere ? prompt.lastFolder : null;
  return (
    <>
      <Question open={saveWhere} title={`Save ${name} to Google Drive`} help="drive-save-where" onCancel={() => session.resolveSaveWhere('cancel')}>
        {(answer) => (
          <>
            <p className="settings-note" style={{ marginTop: 10 }}>
              Where should it go? Pick your team's shared folder so your teammates can open it.
            </p>
            <div className="open-or-add-choices">
              {lastFolder && <Choice icon={Folder} autoFocus title={`Save in ${lastFolder.name}`} note="The folder you saved to last time" onClick={answer(() => session.resolveSaveWhere('last'))} />}
              <Choice icon={FolderSearch} autoFocus={!lastFolder} title="Choose a folder…" note="Your folders, and folders shared with you" onClick={answer(() => session.resolveSaveWhere('choose'))} />
              <Choice icon={HardDrive} title="My Drive" note="The top of your own Google Drive" onClick={answer(() => session.resolveSaveWhere('myDrive'))} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, marginBottom: 12 }}>
              <button type="button" className="btn btn-outline" onClick={answer(() => session.resolveSaveWhere('cancel'))}>
                Cancel
              </button>
            </div>
          </>
        )}
      </Question>
      <Question open={conflict} title="Changed on Google Drive" help="drive-conflict" onCancel={() => session.resolveConflict('cancel')}>
        {(answer) => (
          <>
            <p className="settings-note" style={{ marginTop: 10 }}>
              {CHANGED_ON_DRIVE(name, prompt?.reason)} Nothing has been lost: your changes are still here.
            </p>
            <div className="open-or-add-choices">
              <Choice icon={Copy} autoFocus title="Save as a copy on Drive" note={`Saves your version as ${name} copy, next to the original`} onClick={answer(() => session.resolveConflict('copy'))} />
              <Choice icon={DownloadCloud} title="Load latest from Drive" note={`Your version is kept on this device as ${name} (my changes)`} onClick={answer(() => session.resolveConflict('latest'))} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, marginBottom: 12 }}>
              <button type="button" className="btn btn-outline" onClick={answer(() => session.resolveConflict('cancel'))}>
                Cancel
              </button>
            </div>
          </>
        )}
      </Question>
      <Question open={leave} title="Save your changes to Google Drive before leaving?" help="drive-leave" onCancel={() => session.resolveLeave('cancel')}>
        {(answer) => (
          <>
            <p className="settings-note" style={{ marginTop: 10 }}>
              {name} has changes that are not on Google Drive yet.
            </p>
            <div className="open-or-add-choices">
              <Choice icon={Save} autoFocus title="Save and leave" note="Saves to Google Drive, then finishes editing" onClick={answer(() => session.resolveLeave('save'))} />
              <Choice icon={LogOut} title="Leave without saving" note="Your changes stay in this build on this device" onClick={answer(() => session.resolveLeave('discard'))} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, marginBottom: 12 }}>
              <button type="button" className="btn btn-outline" onClick={answer(() => session.resolveLeave('cancel'))}>
                Cancel
              </button>
            </div>
          </>
        )}
      </Question>
    </>
  );
}
