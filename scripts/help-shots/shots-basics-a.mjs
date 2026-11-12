/**
 * Pictures for the Library and Looking around pages. Written by a scribe assistant.
 */
const LIB = '[data-help="library"]';
const LIB_SEARCH = `css:${LIB} input`;
const FIRST_CARD = `css:${LIB} .part-card`;

async function searchLibrary(app, query) {
  const input = await app.find(LIB_SEARCH);
  await input.click();
  await input.evaluate((e) => e.select());
  await app.type(query);
  await app.sleep(800);
}

/** Searches the Library and presses the first + Add. */
async function addPart(app, query) {
  const { page } = app;
  await searchLibrary(app, query);
  const add = await page.evaluateHandle(() => [...document.querySelectorAll('[data-help="library"] button')].find((b) => /\+ Add/.test(b.innerText)));
  await add.asElement().click();
  await app.sleep(600);
  await app.waitStill();
}

/** An invisible box over part of the 3D view, so the picture is cropped tighter and stays under the size limit. */
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
  { name: 'library-search', layout: 'large', build: 'empty', async setup(app) { await searchLibrary(app, '2x8 beam'); }, crop: ['library'], marks: [LIB_SEARCH] },
  // The first category button after Recent and All
  { name: 'library-category', layout: 'large', build: 'empty', crop: ['library'], marks: [`css:${LIB} .category-pill:nth-child(3)`] },
  { name: 'library-add', layout: 'large', build: 'empty', async setup(app) { await searchLibrary(app, '2x8 beam'); }, crop: ['library'], marks: [FIRST_CARD] },
  {
    name: 'library-grid', layout: 'large', build: 'empty',
    async setup(app) { await app.click(`css:${LIB} .view-switch button:nth-child(2)`); await app.sleep(600); },
    crop: ['library'], marks: [`css:${LIB} .view-switch button:nth-child(2)`]
  },
  { name: 'looking-around-view', layout: 'large', build: 'empty', async setup(app) { await addPart(app, '2x8 beam'); await cropBox(app, 0.1, 0.25, 0.9, 0.7); }, crop: ['css:#help-crop-box'], marks: [] },
  { name: 'looking-around-focus', layout: 'large', build: 'empty', crop: ['toolbar'], marks: ['control:Focus'] },
  { name: 'looking-around-cube', layout: 'large', build: 'empty', crop: ['view-cube'], marks: ['control:View cube'] }
];
