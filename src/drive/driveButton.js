/**
 * The one toolbar Drive button (openspec google-drive-sync, design decision 4). Its label names the
 * build's Drive state and selecting it does the action it names; a tag does nothing.
 *
 *   edit, not connected     Reconnect to Drive              reconnectToDrive
 *   edit, unsaved changes   Save to Drive                   saveToDrive
 *   edit, all saved         Done editing                    doneEditing
 *   readonly, locked        Read-only · Locked by <name>    (tag)
 *   readonly, view only     Read-only                       (tag)
 *   readonly, unlocked      Edit build                      enterEditMode
 *   disconnected (paused)   Reconnect to Drive              reconnectToDrive
 *   not linked              no button (null)
 */

export const DRIVE_LABELS = {
  reconnect: 'Reconnect to Drive',
  save: 'Save to Drive',
  done: 'Done editing',
  readOnly: 'Read-only',
  edit: 'Edit build'
};

/**
 * @param {object} s
 * @param {boolean} s.linked   the open build has a Drive file
 * @param {'edit'|'readonly'|'disconnected'} s.mode
 * @param {boolean} s.dirty    changes not yet on Drive
 * @param {{ byOther?: boolean, holderName?: string }} [s.lock]  from driveLock.lockState
 * @param {boolean} [s.canEdit]   false when the file is shared as Viewer or Commenter
 * @param {boolean} [s.connected] false when the network or the sign-in dropped in Edit mode
 * @returns {null | { label: string, action: string|null, tag: boolean, holderName?: string }}
 */
export function driveButtonState({ linked, mode, dirty, lock, canEdit, connected = true }) {
  if (!linked) return null;
  const act = (label, action) => ({ label, action, tag: false });
  const tag = (label, extra = {}) => ({ label, action: null, tag: true, ...extra });
  if (mode === 'edit') {
    if (!connected) return act(DRIVE_LABELS.reconnect, 'reconnectToDrive');
    return dirty ? act(DRIVE_LABELS.save, 'saveToDrive') : act(DRIVE_LABELS.done, 'doneEditing');
  }
  if (mode === 'readonly') {
    if (lock?.byOther) {
      const holderName = lock.holderName || 'a teammate';
      return tag(`${DRIVE_LABELS.readOnly} · Locked by ${holderName}`, { holderName });
    }
    if (canEdit === false) return tag(DRIVE_LABELS.readOnly);
    return act(DRIVE_LABELS.edit, 'enterEditMode');
  }
  return act(DRIVE_LABELS.reconnect, 'reconnectToDrive');
}
