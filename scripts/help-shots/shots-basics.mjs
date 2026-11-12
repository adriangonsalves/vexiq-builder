/**
 * Pictures for the Basics pages written by the main scribe: moving, joining (reuses quick-start's),
 * context-bar, selecting.
 */
const BAR = (id) => `css:[data-help="context-bar"] [data-tip="${id}"]`;

/** An invisible box over part of the 3D view (fractions of it), so the picture stays under the size limit. */
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
const MID = (app) => cropBox(app, 0.18, 0.36, 0.9, 0.7);

export default [
  {
    name: 'moving-arrows', layout: 'large', build: 'fresh',
    async setup(app) { await app.select(['2x10 Beam #1']); await MID(app); },
    crop: [BOX, 'context-bar'], marks: ['control:Move']
  },
  {
    name: 'moving-snap', layout: 'large', build: 'fresh',
    async setup(app) { await app.openMenu('Snap'); },
    crop: ['toolbar', 'menu:Snap'], marks: ['control:Snap', 'css:[role="menu"][aria-label="Snap"] [role^="menuitem"]:nth-child(2)']
  },
  {
    name: 'moving-rings', layout: 'large', build: 'fresh',
    async setup(app) { await app.select(['2x10 Beam #1']); await app.click(BAR('rotate')); await app.waitStill(); await MID(app); },
    crop: [BOX, 'context-bar'], marks: ['control:Rotate']
  },
  { name: 'context-bar-where', layout: 'large', build: 'fresh', setup: MID, crop: [BOX, 'context-bar'], marks: ['control:Context bar'] },
  {
    name: 'context-bar-tip', layout: 'large', build: 'fresh',
    async setup(app) { await app.hover(BAR('duplicate')); await app.sleep(800); await MID(app); },
    crop: [BOX, 'context-bar'], marks: []
  },
  {
    name: 'selecting-click', layout: 'large', build: 'fresh',
    async setup(app) { await app.select(['60 Tooth Gear #1']); await MID(app); },
    crop: [BOX], marks: []
  },
  {
    name: 'selecting-add', layout: 'large', build: 'fresh',
    async setup(app) { await app.select(['2x10 Beam #1', '60 Tooth Gear #1']); await MID(app); },
    crop: [BOX, 'context-bar'], marks: ['control:Add to selection']
  },
  {
    name: 'selecting-group', layout: 'large', build: 'fresh',
    async setup(app) { await app.select(['2x10 Beam #1', '60 Tooth Gear #1']); await app.openMenu('Select'); },
    crop: ['toolbar', 'menu:Select'], marks: ['control:Select', 'menuitem:Group']
  }
];
