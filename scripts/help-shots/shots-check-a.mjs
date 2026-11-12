/**
 * Pictures for the View options, Explode and Blueprint pages. Written by a scribe assistant.
 */
async function cubeMenu(app) {
  const r = await app.rectOf('view-cube');
  await app.page.mouse.click(r.x + r.width / 2, r.y + r.height / 2, { button: 'right' });
  await app.sleep(400);
}

export default [
  { name: 'views-projection', layout: 'large', build: 'empty', setup: cubeMenu, crop: ['menu:View options'], marks: ['menuitem:Orthographic'] },
  { name: 'views-layout', layout: 'large', build: 'empty', setup: cubeMenu, crop: ['menu:View options'], marks: ['menuitem:4-View'] },
  { name: 'explode-menu', layout: 'large', build: 'fresh', async setup(app) { await app.openMenu('Tools'); }, crop: ['control:Tools', 'menu:Tools'], marks: ['menuitem:Explode'] },
  { name: 'explode-panel', layout: 'large', build: 'fresh', async setup(app) { await app.press('x'); await app.sleep(5000); await app.waitStill(); }, crop: ['css:.explode-panel'], marks: ['css:.explode-slider'] },
  { name: 'explode-close', layout: 'large', build: 'fresh', async setup(app) { await app.press('x'); await app.sleep(5000); await app.waitStill(); }, crop: ['css:.explode-panel'], marks: ['css:.explode-close'] },
  { name: 'blueprint-menu', layout: 'large', build: 'fresh', async setup(app) { await app.openMenu('Tools'); }, crop: ['control:Tools', 'menu:Tools'], marks: ['menuitem:Blueprint'] },
  { name: 'blueprint-dialog', layout: 'large', build: 'fresh', async setup(app) { await app.menu('Tools', 'Blueprint'); await app.sleep(3000); }, crop: ['css:dialog[open] .audit-dialog-header'], marks: ['button:Open Full SVG'] },
  { name: 'blueprint-close', layout: 'large', build: 'fresh', async setup(app) { await app.menu('Tools', 'Blueprint'); await app.sleep(3000); }, crop: ['css:dialog[open] .audit-dialog-header'], marks: ['css:dialog[open] form[method="dialog"] button'] }
];
