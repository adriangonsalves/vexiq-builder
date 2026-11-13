/**
 * Pictures for the History branches page (the Assistant page has none).
 */
const TWO = 'file:scripts/help-shots/builds/two-beams-joined.vexiq.json';
const KEEP_HINT = 'text:A change after undo starts a branch; the undone steps stay in the timeline';
const LINEAR_HINT = 'text:Undo and redo as usual; a change after undo drops the undone steps';

async function openSettings(app) {
  await app.clickControl('Settings');
  await app.page.waitForSelector('dialog.settings-dialog[open]', { timeout: 5000 });
  await app.waitStill();
}

async function clickLabel(app, text) {
  await app.page.evaluate((t) => {
    [...document.querySelectorAll('dialog.settings-dialog label')].find((e) => e.innerText.includes(t)).click();
  }, text);
  await app.sleep(300);
}

/** Advanced options on and Keep branches chosen. */
async function keepBranches(app) {
  await openSettings(app);
  await clickLabel(app, 'Show advanced options');
  await clickLabel(app, 'Keep branches');
}

/** Two different steps after the same step, with the branch menu open. */
async function twoBranches(app) {
  await keepBranches(app);
  await app.page.keyboard.press('Escape');
  await app.sleep(300);
  await app.clickControl('History');
  await app.page.waitForSelector('.history-timeline', { timeout: 5000 });
  await app.select(['2x8 Beam #1']);
  await app.press('Delete');
  await app.clickControl('Undo');
  await app.select(['2x8 Beam #2']);
  await app.press('Delete');
  await app.page.click('.history-branch-marker');
  await app.waitStill();
}

export default [
  { name: 'history-branches-settings', layout: 'large', build: TWO, crop: ['control:Settings'], marks: ['control:Settings'] },
  {
    name: 'history-branches-advanced', layout: 'large', build: TWO, setup: openSettings,
    crop: ['css:.settings-section:last-child'], marks: ['text:Show advanced options']
  },
  {
    name: 'history-branches-keep', layout: 'large', build: TWO,
    async setup(app) { await openSettings(app); await clickLabel(app, 'Show advanced options'); },
    crop: ['css:input[name="history-mode"]', LINEAR_HINT, KEEP_HINT], marks: ['text:Keep branches']
  },
  {
    name: 'history-branches-menu', layout: 'large', build: TWO, setup: twoBranches,
    crop: ['css:.history-timeline', 'css:.history-branch-menu'], marks: ['css:.history-branch-marker@center']
  }
];
