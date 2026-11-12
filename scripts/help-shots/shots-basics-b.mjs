/**
 * Pictures for the Outline and Properties page and the Copying page.
 */
const OUT = 'css:[data-help="outline"]';
const SEARCH = `${OUT} input[type="search"]`;
const ROW = (n) => `${OUT} .instance-row:nth-child(${n})`;
const HIDE = `${OUT} .instance-row button[title="Hide Part"]`;
const LOCK = `${OUT} .instance-row button[title="Lock Part"]`;

export default [
  { name: 'outline-list', layout: 'large', build: 'fresh', crop: ['outline'], marks: [`${OUT}@top`] },
  {
    name: 'outline-search', layout: 'large', build: 'fresh',
    async setup(app) {
      const input = await app.find(SEARCH);
      await input.click();
      await app.type('beam');
      await app.sleep(500);
    },
    crop: ['outline'], marks: [SEARCH]
  },
  {
    name: 'outline-hide-lock', layout: 'large', build: 'fresh',
    async setup(app) { await app.click(ROW(1) + ' .instance-row-name'); },
    crop: ['outline', 'properties'], marks: [HIDE, LOCK]
  },
  {
    name: 'outline-properties-touch', layout: 'medium', build: 'fresh',
    async setup(app) {
      await app.showOutline();
      await app.click(ROW(1) + ' .instance-row-name');
      await app.waitStill();
    },
    crop: ['properties'], marks: ['css:.inspector-back']
  },
  {
    name: 'copying-duplicate', layout: 'large', build: 'fresh',
    async setup(app) { await app.click(ROW(1) + ' .instance-row-name'); },
    crop: ['context-bar'], marks: ['control:Duplicate']
  },
  {
    name: 'copying-stamp', layout: 'large', build: 'fresh',
    async setup(app) { await app.click(ROW(2) + ' .instance-row-name'); },
    crop: ['context-bar'], marks: ['control:Stamp copies']
  }
];
