/**
 * Pictures for the gears, chain, bands, sheets, check, play, devices and advanced pages (round two,
 * main scribe).
 */
const BUILDS = 'file:scripts/help-shots/builds/';
const SPROCKETS = ['16 Tooth Sprocket #1', '16 Tooth Sprocket #2'];

async function turnOnAdvanced(app) {
  await app.clickControl('Settings');
  await app.page.waitForSelector('dialog[open], [role="dialog"]', { timeout: 5000 }).catch(() => {});
  await app.sleep(300);
  await app.page.evaluate(() => {
    const el = [...document.querySelectorAll('label, button, [role="switch"]')].find((e) => /Show advanced options/.test(e.textContent));
    (el.querySelector('input') || el).click();
  });
  await app.sleep(300);
}


/** An invisible box over part of the 3D view, so the picture is cropped tight and stays under the size limit. */
async function cropBox(app, x0, y0, x1, y1) {
  const r = await app.rectOf('view');
  await app.page.evaluate(({ r, x0, y0, x1, y1 }) => {
    document.getElementById('help-crop-box')?.remove();
    const d = document.createElement('div');
    d.id = 'help-crop-box';
    Object.assign(d.style, { position: 'fixed', pointerEvents: 'none', left: `${r.x + r.width * x0}px`, top: `${r.y + r.height * y0}px`, width: `${r.width * (x1 - x0)}px`, height: `${r.height * (y1 - y0)}px` });
    document.body.appendChild(d);
  }, { r, x0, y0, x1, y1 });
}

export default [
  { name: 'gears-pair', layout: 'large', build: BUILDS + 'gear-pair.vexiq.json', async setup(app) { await cropBox(app, 0.2, 0.2, 0.8, 0.8); }, crop: ['css:#help-crop-box'] },
  {
    name: 'chain-menu', layout: 'large', build: BUILDS + 'two-sprockets.vexiq.json',
    async setup(app) { await app.select(SPROCKETS); await app.openMenu('Tools'); },
    crop: ['control:Tools', 'menu:Tools'], marks: ['control:Tools', 'menuitem:Chain builder']
  },
  {
    name: 'chain-done', layout: 'large', build: BUILDS + 'two-sprockets.vexiq.json',
    async setup(app) { await app.select(SPROCKETS); await app.menu('Tools', 'Chain builder'); await app.sleep(800); await app.waitStill(); await app.press('Escape'); await cropBox(app, 0.25, 0.3, 0.75, 0.75); },
    crop: ['css:#help-crop-box']
  },
  {
    name: 'bands-menu', layout: 'large', build: BUILDS + 'band-standoffs.vexiq.json',
    async setup(app) { await app.openMenu('Tools'); },
    crop: ['control:Tools', 'menu:Tools'], marks: ['control:Tools', 'menuitem:Band builder']
  },
  {
    name: 'bands-panel', layout: 'large', build: BUILDS + 'band-standoffs.vexiq.json',
    async setup(app) { await app.menu('Tools', 'Band builder'); },
    crop: ['css:.band-panel'], marks: ['css:.band-panel']
  },
  {
    name: 'sheets-menu', layout: 'large', build: BUILDS + 'sheet-one-row.vexiq.json',
    async setup(app) { await app.select(['6x6 Plastic Sheet #1', '2x8 Beam #1']); await app.openMenu('Tools'); },
    crop: ['control:Tools', 'menu:Tools'], marks: ['control:Tools', 'menuitem:Bend sheet…']
  },
  {
    name: 'sheets-dialog', layout: 'large', build: BUILDS + 'sheet-one-row.vexiq.json',
    async setup(app) { await app.select(['6x6 Plastic Sheet #1', '2x8 Beam #1']); await app.menu('Tools', 'Bend sheet…'); await app.sleep(1500); },
    crop: ['dialog:Bend sheet'], marks: ['dialog:Bend sheet', 'button:Apply']
  },
  {
    name: 'check-audit', layout: 'large', build: BUILDS + 'audit-problems.vexiq.json',
    async setup(app) { await app.menu('Tools', 'Audit'); await app.sleep(1500); await app.waitStill(); },
    crop: ['css:.audit-panel'], marks: ['css:.audit-issue-button', 'button:Attempt Fix']
  },
  {
    name: 'play-panel', layout: 'large', build: 'starter:Speedbot 2.0',
    async setup(app) { await app.menu('Tools', 'Play mode'); await app.sleep(2500); },
    crop: ['css:.play-panel'], marks: ['css:.play-panel input[type="range"]']
  },
  {
    name: 'tablet-layout', layout: 'medium', build: 'fresh',
    async setup(app) { await app.select([]).catch(() => {}); },
    crop: ['control:Library', 'control:Outline'], marks: ['control:Library', 'control:Outline']
  },
  {
    name: 'advanced-smart', layout: 'large', build: BUILDS + 'two-beams-joined.vexiq.json',
    async setup(app) { await turnOnAdvanced(app); await app.press('Escape'); await app.select(['2x8 Beam #1']); },
    crop: ['properties'], marks: ['text:Smart Assembly & Fastening']
  }
];
