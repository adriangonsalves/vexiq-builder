/**
 * Pictures for the Undo and the timeline page and the Saving and sharing page.
 */
const TL = 'css:.history-timeline';
const TRACK = 'css:.history-track';
const PLAY = 'css:.history-controls button[aria-label="Play"]';
const SPEED = 'css:.history-speed';

/** Shows the timeline if it isn't showing yet. */
async function showTimeline(app) {
  const on = await app.page.$('[data-help="history"][aria-pressed="true"]');
  if (!on) await app.clickControl('History');
  await app.page.waitForSelector('.history-timeline', { timeout: 5000 });
  await app.waitStill();
}

const TWO = 'file:scripts/help-shots/builds/two-beams-joined.vexiq.json';

/** An invisible box over the middle of the 3D view, so the picture stays under the size limit. */
async function cropMiddle(app) {
  const r = await app.rectOf('view');
  await app.page.evaluate((r) => {
    const d = document.createElement('div');
    d.id = 'help-crop-box';
    Object.assign(d.style, { position: 'fixed', pointerEvents: 'none', left: `${r.x}px`, top: `${r.y + r.height * 0.22}px`, width: `${r.width}px`, height: `${r.height * 0.5}px` });
    document.body.appendChild(d);
  }, r);
}

const starter = (id, name) => ({
  name: `saving-starter-${id}`, layout: 'large', build: `starter:${name}`, setup: cropMiddle, crop: ['css:#help-crop-box'], marks: []
});

export default [
  { name: 'undo-history-buttons', layout: 'large', build: TWO, crop: ['control:Undo', 'control:Redo'], marks: ['control:Undo', 'control:Redo'] },
  { name: 'undo-history-open', layout: 'large', build: TWO, setup: showTimeline, crop: ['toolbar'], marks: ['control:History'] },
  { name: 'undo-history-bar', layout: 'large', build: TWO, setup: showTimeline, crop: [TL], marks: [TRACK + '@center'] },
  { name: 'undo-history-play', layout: 'large', build: TWO, setup: showTimeline, crop: [TL], marks: [PLAY, SPEED] },
  {
    name: 'undo-history-bigstep', layout: 'large', build: 'starter:Flop',
    async setup(app) {
      await showTimeline(app);
      const box = await (await app.find(TRACK)).boundingBox();
      await app.page.mouse.click(box.x + box.width * 0.3, box.y + box.height / 2);
      await app.sleep(800);
    },
    crop: [TL], marks: ['button:Go to end of step']
  },

  { name: 'saving-name', layout: 'large', build: 'fresh', crop: ['toolbar'], marks: ['control:Build name'] },
  {
    name: 'saving-new', layout: 'large', build: 'fresh', async setup(app) { await app.openMenu('File'); },
    crop: ['toolbar', 'menu:File'], marks: ['control:File', 'menuitem:New']
  },
  {
    name: 'saving-load', layout: 'large', build: 'fresh', async setup(app) { await app.openMenu('File'); },
    crop: ['toolbar', 'menu:File'], marks: ['control:File', 'menuitem:Load…']
  },
  {
    name: 'saving-open', layout: 'large', build: 'fresh',
    async setup(app) {
      await app.menu('File', 'New');
      await app.sleep(2000);
      await app.menu('File', 'Load…');
      await app.page.waitForSelector('dialog.library-dialog[open]', { timeout: 5000 });
      await app.sleep(800);
    },
    crop: ['dialog:Your builds'], marks: ['css:dialog.library-dialog .library-card:not(.current) button[title="Open this build"]']
  },
  {
    name: 'saving-export', layout: 'large', build: 'fresh', async setup(app) { await app.openMenu('File'); },
    crop: ['toolbar', 'menu:File'], marks: ['control:File', 'menuitem:Export']
  },
  {
    name: 'saving-delete', layout: 'large', build: 'fresh', async setup(app) { await app.openMenu('File'); },
    crop: ['toolbar', 'menu:File'], marks: ['control:File', 'menuitem:Delete this build…']
  },
  {
    name: 'saving-starters', layout: 'large', build: 'fresh',
    async setup(app) { await app.openMenu('File'); await app.click('menuitem:Starter', { wait: 300 }); },
    crop: ['toolbar', 'menu:File', 'css:.popover-submenu'], marks: ['menuitem:Starter', 'css:.popover-submenu']
  },
  starter('sample', 'Sample starter'),
  starter('speedbot', 'Speedbot 2.0'),
  starter('basebot', 'BaseBot'),
  starter('clawbot', 'Clawbot'),
  starter('flop', 'Flop')
];
