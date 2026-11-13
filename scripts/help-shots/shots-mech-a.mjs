/**
 * Pictures for the Pins and connectors and the Shafts and wheels pages. Written by a scribe assistant.
 */

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
  // The whole Speedbot: brain on standoffs and a corner connector, motor pins, hubs and tires
  { name: 'pins-speedbot', layout: 'large', build: 'starter:Speedbot 2.0', async setup(app) { await cropBox(app, 0.15, 0.2, 0.85, 0.85); }, crop: ['css:#help-crop-box'], marks: [] },
  // The same robot for the wheel stack: motor, shaft, spacer, wheel
  { name: 'wheels-speedbot', layout: 'large', build: 'starter:Speedbot 2.0', async setup(app) { await cropBox(app, 0.15, 0.2, 0.85, 0.85); }, crop: ['css:#help-crop-box'], marks: [] }
];
