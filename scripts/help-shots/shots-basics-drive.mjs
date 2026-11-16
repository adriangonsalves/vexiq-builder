/**
 * Pictures for the Google Drive help page (src/help/pages/google-drive.md, openspec google-drive-sync).
 * They use a pretend Google (pretend-drive.mjs), so no account is needed, but the static build must
 * have Google values in .env.local or the Drive items aren't there.
 */
import { openPausedDriveBuild, usePretendDrive } from './pretend-drive.mjs';

const waitFor = (app, selector) => app.page.waitForSelector(selector, { visible: true, timeout: 15000 });

const MY_DRIVE = 'css:dialog[data-help="drive-save-where"] .open-or-add-choices .open-or-add-btn:last-child';

/** Save to Google Drive… (My Drive) with the pretend Google, leaving the build in Edit mode. */
async function saveToPretendDrive(app) {
  await usePretendDrive(app);
  await app.menu('File', 'Save to Google Drive…');
  await waitFor(app, 'dialog[data-help="drive-save-where"][open]');
  await app.click(MY_DRIVE);
  await waitFor(app, '.drive-wide.drive-doneEditing');
  await app.sleep(600);
}

export default [
  {
    name: 'drive-save-menu', layout: 'large', build: 'fresh',
    async setup(app) { await app.openMenu('File'); },
    crop: ['toolbar', 'menu:File'], marks: ['control:File', 'menuitem:Save to Google Drive…']
  },
  {
    name: 'drive-save-where', layout: 'large', build: 'fresh',
    async setup(app) {
      await app.menu('File', 'Save to Google Drive…');
      await waitFor(app, 'dialog[data-help="drive-save-where"][open]');
      await app.sleep(500);
    },
    crop: ['css:dialog[data-help="drive-save-where"]'],
    marks: ['css:dialog[data-help="drive-save-where"] .open-or-add-choices .open-or-add-btn:first-child', MY_DRIVE]
  },
  {
    name: 'drive-save-button', layout: 'large', build: 'fresh',
    async setup(app) {
      await saveToPretendDrive(app);
      await app.press('d'); // a change: the selected part is duplicated
      await waitFor(app, '.drive-wide.drive-saveToDrive');
    },
    crop: ['css:.brand'], marks: ['control:Drive button']
  },
  {
    name: 'drive-done-editing', layout: 'large', build: 'fresh',
    async setup(app) { await saveToPretendDrive(app); },
    crop: ['css:.brand'], marks: ['control:Drive button']
  },
  {
    name: 'drive-open', layout: 'large', build: 'fresh',
    async setup(app) {
      await app.menu('File', 'Load…');
      await app.page.waitForSelector('dialog.library-dialog[open]', { timeout: 5000 });
      await app.sleep(800);
    },
    crop: ['dialog:Your builds'], marks: ['control:Open from Google Drive…']
  },
  {
    name: 'drive-read-only', layout: 'large', build: 'fresh',
    async setup(app) {
      await usePretendDrive(app, { files: [{ id: 'team-robot', name: 'TeamBot.vexiq.json', lockedBy: 'Maya' }] });
      await app.menu('File', 'Load…');
      await app.page.waitForSelector('dialog.library-dialog[open]', { timeout: 5000 });
      await app.clickControl('Open from Google Drive…');
      await waitFor(app, '.drive-wide.drive-tag');
      await app.sleep(1500);
    },
    crop: ['toolbar'], marks: ['control:Drive button', 'css:[data-help="viewer-explode"]', 'css:[data-help="viewer-play"]']
  },
  {
    name: 'drive-paused', layout: 'large', build: 'fresh',
    async setup(app) {
      await openPausedDriveBuild(app);
      await app.sleep(800);
    },
    crop: ['css:.brand', 'css:[data-help="drive-paused"]'],
    marks: ['css:[data-help="drive-paused"] .btn-primary-action', 'text:Work on this device only']
  }
];
