/**
 * Pictures for the Start here pages (quick-start, tour). Written by the main scribe.
 */
const LIB_SEARCH = 'css:[data-help="library"] input';

/** Searches the Library and presses the first + Add (the Library is a tab or drawer on small layouts, so it is opened first). */
async function addPart(app, query) {
  const { page } = app;
  if (app.layout === 'medium') await app.click('css:[data-help="library-tab"]');
  if (app.layout === 'small' && !(await page.$('.drawer-library'))) await app.click('css:[data-help="library-button"]');
  const input = await app.find(LIB_SEARCH);
  await input.click();
  await input.evaluate((e) => e.select());
  await app.type(query);
  await app.sleep(800);
  const add = await page.evaluateHandle(() => [...document.querySelectorAll('[data-help="library"] button')].find((b) => /\+ Add/.test(b.innerText)));
  await add.asElement().click();
  await app.sleep(600);
  await app.waitStill();
}

/**
 * Draws an invisible box over part of the 3D view (fractions of the view) so a picture can be cropped
 * tighter than the whole view and stay under the size limit. Nothing visible changes.
 */
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
const BOX = 'css:#help-crop-box';

/**
 * Turns the Grid off (right-click the view cube on a computer, the View button on a tablet) so the
 * full-screen tour pictures stay under the size limit. The grid is a normal View option.
 */
async function gridOff(app) {
  if (app.layout === 'large') {
    const r = await app.rectOf('view-cube');
    await app.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: 'right' });
    await app.sleep(400);
  } else {
    await app.clickControl('View');
  }
  await app.page.evaluate(() => [...document.querySelectorAll('[role^="menuitem"]')].find((e) => /Grid$/.test(e.innerText.trim()))?.click());
  await app.sleep(300);
  await app.press('Escape');
  await app.waitStill();
}

const joinBar = (app) => app.click('css:[data-help="context-bar"] [data-tip="join"]');

export default [
  { name: 'qs-new', layout: 'large', build: 'fresh', async setup(app) { await app.openMenu('File'); }, crop: ['toolbar', 'menu:File'], marks: ['control:File', 'menuitem:New'] },
  {
    name: 'qs-beam', layout: 'large', build: 'empty',
    async setup(app) {
      const input = await app.find(LIB_SEARCH);
      await input.click();
      await app.type('2x8 beam');
      await app.sleep(800);
    },
    crop: ['library'], marks: [LIB_SEARCH, 'text:+ Add']
  },
  { name: 'qs-look', layout: 'large', build: 'empty', async setup(app) { await addPart(app, '2x8 beam'); await cropBox(app, 0.1, 0.25, 0.9, 0.7); }, crop: [BOX], marks: [] },
  { name: 'qs-pin', layout: 'large', build: 'empty', async setup(app) { await addPart(app, '2x8 beam'); await addPart(app, '0x2 Connector Pin'); await cropBox(app, 0.1, 0.25, 0.9, 0.7); }, crop: [BOX], marks: [] },
  {
    name: 'qs-autojoin', layout: 'large', build: 'empty',
    async setup(app) { await addPart(app, '2x8 beam'); await addPart(app, '0x2 Connector Pin'); await cropBox(app, 0.1, 0.25, 0.9, 0.7); },
    crop: [BOX, 'context-bar'], marks: ['control:Auto Join']
  },
  {
    name: 'qs-beam2', layout: 'large', build: 'empty',
    async setup(app) { await addPart(app, '2x8 beam'); await addPart(app, '0x2 Connector Pin'); await joinBar(app); await addPart(app, '2x8 beam'); await cropBox(app, 0.12, 0.05, 0.88, 0.62); },
    crop: [BOX], marks: []
  },
  {
    name: 'qs-manual', layout: 'large', build: 'empty',
    async setup(app) {
      await addPart(app, '2x8 beam'); await addPart(app, '0x2 Connector Pin'); await joinBar(app); await addPart(app, '2x8 beam');
      await cropBox(app, 0.28, 0.05, 0.85, 0.62);
    },
    crop: [BOX, 'context-bar'], marks: ['control:Manual Join']
  },
  { name: 'qs-undo', layout: 'large', build: 'file:scripts/help-shots/builds/two-beams-joined.vexiq.json', crop: ['control:Undo', 'control:Redo'], marks: ['control:Undo', 'control:Redo'] },
  {
    name: 'tour-large', layout: 'large', build: 'fresh',
    async setup(app) {
      const input = await app.find('css:[data-help="library"] input');
      await input.click();
      await app.type('2x8 beam');
      await app.sleep(800);
      await gridOff(app);
      await app.page.mouse.move(700, 600);
    },
    crop: ['window'],
    marks: ['toolbar@bottom', 'control:Build name@bottom', 'library@top', 'view@left', 'context-bar@left', 'view-cube@left', 'outline@top', 'properties@top', 'css:.viewport-hud-top@bottom', 'control:Shortcuts strip@top']
  },
  {
    name: 'tour-tablet', layout: 'medium', build: 'fresh',
    async setup(app) {
      const input = await app.find('css:[data-help="library"] input');
      await input.click();
      await app.type('2x8 beam');
      await app.sleep(800);
      await gridOff(app);
    },
    crop: ['window'],
    marks: ['toolbar@bottom', 'control:Library', 'control:Outline', 'view@left', 'context-bar@left', 'view-cube@left']
  },
  {
    name: 'tour-phone', layout: 'small', build: 'fresh',
    crop: ['window'],
    marks: ['toolbar@bottom', 'view@left', 'context-bar@right', 'view-cube@left']
  }
];
