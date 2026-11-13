/**
 * Checks for "Help opens on what you're doing" (openspec in-app-help, tasks 9.2 and 9.3):
 *   helpContext / partKindTag   (src/help/context.js)
 *   helpTarget / relatedPages   (src/help/target.js)
 *   tag boost in the search     (src/help/search.js)
 *
 *   node scripts/check-help-context.mjs
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const show = (v) => JSON.stringify(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const test = (label, fn) => {
  try {
    const r = fn();
    if (r === undefined || r === true) check(label, true);
    else check(label, false, typeof r === 'string' ? r : show(r));
  } catch (e) {
    check(label, false, e.message);
  }
};
const load = async (rel) => {
  try {
    return { mod: await import(new URL(rel, import.meta.url)), error: null };
  } catch (e) {
    return { mod: null, error: `module missing or broken: ${rel} (${e.code || e.name}: ${String(e.message).split('\n')[0]})` };
  }
};
const need = (m) => {
  if (!m.mod) throw new Error(m.error);
  return m.mod;
};
const C = await load('../src/help/context.js');
const T = await load('../src/help/target.js');
const S = await load('../src/help/search.js');
const R = await load('../src/help/renderPage.js');
const TAGS = await load('../src/help/tags.js');

const ctx = (snap) => need(C).helpContext(snap);
const kind = (name, category) => need(C).partKindTag({ name, category });
const GEAR = { name: '36 Tooth Gear', category: 'Gears, Sprockets & Pulleys' };
const SPROCKET = { name: '16 Tooth Sprocket', category: 'Gears, Sprockets & Pulleys' };
const SENSOR = { name: 'VEX IQ Distance Sensor', category: 'Electronics & Motion' };

// ---------------------------------------------------------------------------------------------------
// helpContext: the scenarios of "Help opens on what you're doing"
// ---------------------------------------------------------------------------------------------------
test('scenario: Band builder open with two spots chosen -> band-builder first', () => {
  const r = ctx({ panels: { band: true }, interaction: { session: 'band' }, selection: [] });
  return (Array.isArray(r) && r[0] === 'band-builder') || show(r);
});
test('scenario: Mark a hole armed -> mark-hole', () => {
  const r = ctx({ pointerTool: 'target' });
  return same(r, ['mark-hole']) || show(r);
});
test('scenario: one 36 Tooth Gear selected -> gear first', () => {
  const r = ctx({ selection: [GEAR] });
  return (r[0] === 'gear') || show(r);
});
test('scenario: two sprockets selected with the Track builder dialog open -> track-builder first, then sprocket', () => {
  const r = ctx({ panels: { track: true }, selection: [SPROCKET, { ...SPROCKET }] });
  return same(r, ['track-builder', 'sprocket']) || show(r);
});
test('scenario: nothing going on -> empty list ({} and everything off)', () => {
  const off = {
    panels: { band: false, chain: false, track: false, bend: false, explode: false, play: false, drop: false, audit: false, blueprint: false, timeline: false, buildLibrary: false, settings: false, offline: false },
    viewLayout: 'single',
    interaction: { session: null, fitsKind: null, fit: null, placing: false },
    pointerTool: 'select',
    bar: { selectMode: false, boxSelect: false, worldAxes: false, freeMove: false, grow: false, exactPick: false, turnMenu: false },
    transformMode: 'translate',
    selection: []
  };
  const a = ctx({});
  const b = ctx(off);
  return (same(a, []) && same(b, [])) || show([a, b]);
});

// ---------------------------------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------------------------------
test('priority: tool beats armed button beats Rotate mode beats selection', () => {
  const r = ctx({ panels: { audit: true }, pointerTool: 'target', transformMode: 'rotate', selection: [GEAR] });
  return same(r, ['audit', 'mark-hole', 'rotate', 'gear']) || show(r);
});
test('priority: tier 1, then 2, then 3, then 4 (4-View, hole pick, Grow, gear)', () => {
  const r = ctx({ viewLayout: 'four', interaction: { fitsKind: 'pick' }, bar: { grow: true }, selection: [GEAR] });
  return same(r, ['four-view', 'hole-pick', 'grow-selection', 'gear']) || show(r);
});
test('priority: wheel-bar fits beats placing beats hole-pick', () => {
  const r = ctx({ interaction: { fit: { index: 0, count: 3 }, placing: true, fitsKind: 'pick' } });
  return same(r, ['fits-wheel', 'placing', 'hole-pick']) || show(r);
});
test('priority: a fit list with one way only is not the fits wheel', () => {
  const r = ctx({ interaction: { fit: { index: 0, count: 1 } } });
  return !r.includes('fits-wheel') || show(r);
});
test('priority: Drop test report is listed before Play when both are on', () => {
  const r = ctx({ panels: { play: true, drop: true } });
  return same(r, ['drop-test', 'play']) || show(r);
});
test('priority: Offline is listed before Settings when both are on', () => {
  const r = ctx({ panels: { settings: true, offline: true } });
  return same(r, ['offline', 'settings']) || show(r);
});
test('priority: the same situation is listed once (stamp from the pointer tool and from a copy)', () => {
  const r = ctx({ pointerTool: 'stamp', interaction: { fitsKind: 'copy' } });
  return same(r, ['stamp']) || show(r);
});
test('priority: placing from both flags is listed once', () => {
  const r = ctx({ interaction: { placing: true, fitsKind: 'place' } });
  return same(r, ['placing']) || show(r);
});

// ---------------------------------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------------------------------
test('selection: several parts of the same kind -> that kind (two gears)', () => same(ctx({ selection: [GEAR, { ...GEAR }] }), ['gear']) || show(ctx({ selection: [GEAR, { ...GEAR }] })));
test('selection: several parts of different kinds -> several-parts (gear and sprocket)', () => {
  const r = ctx({ selection: [GEAR, SPROCKET] });
  return same(r, ['several-parts']) || show(r);
});
test('selection: several parts with no kind at all -> several-parts (two sensors)', () => {
  const r = ctx({ selection: [SENSOR, { ...SENSOR }] });
  return same(r, ['several-parts']) || show(r);
});
test('selection: a part with a kind and a part with none -> several-parts', () => {
  const r = ctx({ selection: [GEAR, SENSOR] });
  return same(r, ['several-parts']) || show(r);
});
test('selection: a whole group selected -> group-selected first', () => {
  const r = ctx({ groupSelected: true, selection: [GEAR, SPROCKET] });
  return r[0] === 'group-selected' || show(r);
});
test('selection: one part in Move mode gives its kind and never "move"', () => {
  const r = ctx({ transformMode: 'translate', selection: [GEAR] });
  return (same(r, ['gear']) && !r.includes('move')) || show(r);
});
test('selection: Rotate mode with a gear -> rotate then gear', () => {
  const r = ctx({ transformMode: 'rotate', selection: [GEAR] });
  return same(r, ['rotate', 'gear']) || show(r);
});
test('selection: Rotate mode with nothing selected -> rotate only', () => same(ctx({ transformMode: 'rotate' }), ['rotate']) || show(ctx({ transformMode: 'rotate' })));
test('selection: a sensor selected (no situation of its own) -> empty list', () => {
  const r = ctx({ selection: [SENSOR] });
  return same(r, []) || show(r);
});
test('selection: a sensor selected in Rotate mode -> rotate only', () => {
  const r = ctx({ transformMode: 'rotate', selection: [SENSOR] });
  return same(r, ['rotate']) || show(r);
});

// ---------------------------------------------------------------------------------------------------
// The mapping, one case per tier
// ---------------------------------------------------------------------------------------------------
const tableCase = (label, rows) => test(label, () => {
  const bad = [];
  for (const [snap, want] of rows) {
    const got = ctx(snap);
    if (!same(got, [want])) bad.push(`${show(snap)} -> ${show(got)} (want ${want})`);
  }
  return bad.length ? bad.join(' ; ') : undefined;
});
tableCase('tier 1: each panel and view layout gives its situation', [
  [{ panels: { band: true } }, 'band-builder'],
  [{ panels: { chain: true } }, 'chain-builder'],
  [{ panels: { track: true } }, 'track-builder'],
  [{ panels: { bend: true } }, 'bend-sheet'],
  [{ panels: { explode: true } }, 'explode'],
  [{ panels: { play: true } }, 'play'],
  [{ panels: { drop: true } }, 'drop-test'],
  [{ panels: { audit: true } }, 'audit'],
  [{ panels: { blueprint: true } }, 'blueprint'],
  [{ panels: { timeline: true } }, 'timeline'],
  [{ panels: { buildLibrary: true } }, 'build-library'],
  [{ panels: { settings: true } }, 'settings'],
  [{ panels: { offline: true } }, 'offline'],
  [{ viewLayout: 'four' }, 'four-view'],
  [{ viewLayout: 'stereo' }, 'stereo']
]);
tableCase('tier 2: each 3D-view activity gives its situation', [
  [{ interaction: { fit: { index: 1, count: 4 } } }, 'fits-wheel'],
  [{ interaction: { placing: true } }, 'placing'],
  [{ interaction: { session: 'fits', fitsKind: 'place' } }, 'placing'],
  [{ interaction: { session: 'fits', fitsKind: 'copy' } }, 'stamp'],
  [{ interaction: { session: 'fits', fitsKind: 'pick' } }, 'hole-pick'],
  [{ interaction: { session: 'fits', fitsKind: 'target' } }, 'hole-pick'],
  [{ interaction: { session: 'arrows' } }, 'mate-arrows'],
  [{ interaction: { session: 'ring' } }, 'mate-arrows']
]);
tableCase('tier 3: each armed bar button, the Mark/Stamp tools and Rotate mode give their situation', [
  [{ pointerTool: 'target' }, 'mark-hole'],
  [{ pointerTool: 'stamp' }, 'stamp'],
  [{ bar: { selectMode: true } }, 'select-mode'],
  [{ bar: { boxSelect: true } }, 'box-select'],
  [{ bar: { worldAxes: true } }, 'world-arrows'],
  [{ bar: { freeMove: true } }, 'free-move'],
  [{ bar: { grow: true } }, 'grow-selection'],
  [{ bar: { exactPick: true } }, 'one-of-group'],
  [{ bar: { turnMenu: true } }, 'turn-step'],
  [{ transformMode: 'rotate' }, 'rotate']
]);
test('tier 4: group, several parts and each kind of part (one part selected)', () => {
  const bad = [];
  const rows = [
    [{ groupSelected: true }, 'group-selected'],
    [{ selection: [GEAR, SPROCKET] }, 'several-parts'],
    [{ selection: [GEAR] }, 'gear'],
    [{ selection: [SPROCKET] }, 'sprocket']
  ];
  for (const [snap, want] of rows) {
    const got = ctx(snap);
    if (got[0] !== want) bad.push(`${show(snap)} -> ${show(got)} (want ${want})`);
  }
  return bad.length ? bad.join(' ; ') : undefined;
});
test('every id helpContext returns is one of the SITUATIONS', () => {
  const ids = new Set(need(TAGS).SITUATIONS.map((s) => s.id));
  const r = ctx({ panels: { play: true, drop: true, offline: true, settings: true }, viewLayout: 'stereo', interaction: { fit: { index: 0, count: 2 }, placing: true, fitsKind: 'pick' }, pointerTool: 'stamp', bar: { turnMenu: true }, transformMode: 'rotate', selection: [GEAR] });
  const bad = r.filter((x) => !ids.has(x));
  return (r.length > 5 && !bad.length) || show(r);
});

// ---------------------------------------------------------------------------------------------------
// partKindTag on the real catalog
// ---------------------------------------------------------------------------------------------------
const catalog = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../public/catalog.json', import.meta.url)), 'utf8'));
const byName = (name) => catalog.find((p) => p.name === name);
const NAMED = [
  ['VEX IQ Smart Motor', 'motor'],
  ['2x Pitch Motor Shaft', 'motor-shaft'],
  ['4x Pitch Motor Shaft', 'motor-shaft'],
  ['4x Pitch Shaft', 'shaft'],
  ['36 Tooth Gear', 'gear'],
  ['16 Tooth Sprocket', 'sprocket'],
  ['Chain Link', 'chain'],
  ['Tank Tread, Attachment Link', 'track'],
  ['Tire (200 mm Travel)', 'tire'],
  ['Small Wheel Hub (44 mm)', 'hub'],
  ['200mm Travel Omni-Directional Wheel', 'omni-wheel'],
  ['4x Pitch Diameter (160mm Travel) Smooth Wheel', 'wheel'],
  ['Double 2x Wide, 1x2 Corner Connector', 'connector'],
  ['2x Wide, 2x2 Offset Corner Connector', 'connector'],
  ['0.5x Pitch Standoff', 'standoff'],
  ['1x1 Connector Pin', 'pin'],
  ['1x2 Idler Pin', 'pin'],
  ['2x12 Plastic Sheet', 'sheet'],
  ['VEX IQ Robot Brain Gen 2', 'brain'],
  ['VEX IQ Robot Brain Gen 1', 'brain'],
  ['VEX IQ Robot Battery', 'battery'],
  ['Silicone Rubber Band #32', 'band'],
  ['2x30mm Rubber Belt', 'belt'],
  ['.5x Pitch Idler Pulley', 'pulley'],
  ['2x10 Beam', 'beam'],
  ['4x8 Plate', 'plate'],
  ['Rubber Shaft Collar', 'collar'],
  ['0.25x Pitch Spacer', 'spacer']
];
for (const [name, want] of NAMED) {
  test(`partKindTag: ${name} -> ${want}`, () => {
    const p = byName(name);
    if (!p) return `no part called "${name}" in public/catalog.json (fix the test)`;
    const got = need(C).partKindTag({ name: p.name, category: p.category });
    return got === want || show(got);
  });
}
for (const name of ['VEX IQ Distance Sensor', 'VEX IQ Touch Sensor', 'VEX IQ Color Sensor']) {
  test(`partKindTag: ${name} -> null (selecting it opens Help as if nothing were selected)`, () => {
    const p = byName(name);
    if (!p) return `no part called "${name}" (fix the test)`;
    const got = need(C).partKindTag({ name: p.name, category: p.category });
    return got === null || show(got);
  });
}
test('partKindTag: for every catalog part the answer is null or a part-kind situation', () => {
  const kinds = new Set(need(TAGS).SITUATIONS.filter((s) => s.tier === 4 && s.id !== 'group-selected' && s.id !== 'several-parts').map((s) => s.id));
  const bad = [];
  for (const p of catalog) {
    const got = need(C).partKindTag({ name: p.name, category: p.category });
    if (got !== null && !kinds.has(got)) bad.push(`${p.name} -> ${show(got)}`);
  }
  return bad.length ? bad.slice(0, 10).join(' ; ') : undefined;
});
test('partKindTag sweep: report parts that look like a known kind but get null (information only)', () => {
  const cats = new Set(['Gears, Sprockets & Pulleys', 'Pins & Standoffs', 'Shafts, Spacers & Collars', 'Wheels & Treads', 'Beams & Plates', 'Connectors & Brackets']);
  const looks = /gear|sprocket|chain link|tread|sheet|band|belt|motor|brain|battery|shaft|wheel|\bpin\b|standoff|connector|pulley|collar|spacer|tire|hub/i;
  const nulls = [];
  for (const p of catalog) {
    if (!cats.has(p.category) || !looks.test(p.name)) continue;
    if (need(C).partKindTag({ name: p.name, category: p.category }) === null) nulls.push(p.name);
  }
  console.log(`      (${nulls.length} look-alike parts have no kind${nulls.length ? `: ${nulls.join('; ')}` : ''})`);
});

// ---------------------------------------------------------------------------------------------------
// 9.3 helpTarget
// ---------------------------------------------------------------------------------------------------
const pg = (id, answers = [], sections = [], tags = [], extra = {}) => ({
  id,
  meta: { title: id, answers, tags, devOnly: false, ...extra },
  sections: sections.map(([sid, sa]) => ({ id: sid, answers: sa }))
});
const idOf = (x) => (x && typeof x === 'object' ? x.id : x);
const target = (pages, sits) => need(T).helpTarget(pages, sits);
const PAGES = [
  pg('gears', ['gear'], [['gear-sizes', []]]),
  pg('wheels', ['wheel'], [['omni', ['omni-wheel']], ['tire-tips', ['tire']]]),
  pg('chain', ['chain-builder'], [['sags', []]]),
  pg('sprockets', ['sprocket'], []),
  pg('misc', [], [['more-gears', ['gear']]])
];
test('helpTarget: the first situation with a claimant wins, unclaimed ones are skipped', () => {
  const t = target(PAGES, ['mark-hole', 'chain-builder', 'gear']);
  return (t && idOf(t.page) === 'chain' && !t.section && t.situation === 'chain-builder') || show(t);
});
test('helpTarget: an earlier claimed situation beats a later one', () => {
  const t = target(PAGES, ['sprocket', 'chain-builder']);
  return (t && idOf(t.page) === 'sprockets' && t.situation === 'sprocket') || show(t);
});
test('helpTarget: a section claim wins over the page claim, and opens that section on its own page', () => {
  const t = target(PAGES, ['gear']);
  return (t && idOf(t.page) === 'misc' && idOf(t.section) === 'more-gears' && t.situation === 'gear') || show(t);
});
test('helpTarget: a page with a section claim and no page claim opens the section', () => {
  const t = target(PAGES, ['omni-wheel']);
  return (t && idOf(t.page) === 'wheels' && idOf(t.section) === 'omni' && t.situation === 'omni-wheel') || show(t);
});
test('helpTarget: a page claim gives section null', () => {
  const t = target(PAGES, ['wheel']);
  return (t && idOf(t.page) === 'wheels' && t.section === null) || show(t);
});
test('helpTarget: no situation has a claimant -> null', () => target(PAGES, ['mark-hole', 'rotate']) === null || show(target(PAGES, ['mark-hole', 'rotate'])));
test('helpTarget: an empty list -> null', () => target(PAGES, []) === null || show(target(PAGES, [])));

// ---------------------------------------------------------------------------------------------------
// relatedPages
// ---------------------------------------------------------------------------------------------------
const REL = [
  pg('a', [], [], ['gear', 'wheel', 'shaft']),
  pg('b', [], [], ['wheel']),
  pg('c', [], [], ['gear', 'wheel', 'shaft', 'pin']),
  pg('d', [], [], ['gear']),
  pg('e', [], [], ['wheel', 'gear']),
  pg('f', [], [], ['beam']),
  pg('assistant', [], [], ['gear', 'wheel', 'shaft'], { devOnly: true })
];
const related = (page, max, opts) => need(T).relatedPages(REL, page, max, opts).map(idOf);
const pageA = REL[0];
test('relatedPages: most shared tags first, ties keep list order, at most 3 by default', () => {
  const r = related(pageA, undefined, { hasAssistant: true });
  return same(r, ['c', 'assistant', 'e']) || show(r);
});
test('relatedPages: never the page itself and only pages sharing a tag (f shares none)', () => {
  const r = related(pageA, 10, { hasAssistant: true });
  return (!r.includes('a') && !r.includes('f') && same(r, ['c', 'assistant', 'e', 'b', 'd'])) || show(r);
});
test('relatedPages: a dev-only page is left out when hasAssistant is false', () => {
  const r = related(pageA, 10, { hasAssistant: false });
  return same(r, ['c', 'e', 'b', 'd']) || show(r);
});
test('relatedPages: max is honoured', () => {
  const r = related(pageA, 2, { hasAssistant: false });
  return same(r, ['c', 'e']) || show(r);
});
test('relatedPages: no shared tags -> empty list', () => same(related(REL[5], 3, { hasAssistant: true }), []) || show(related(REL[5], 3, { hasAssistant: true })));

// ---------------------------------------------------------------------------------------------------
// Search boost by tag
// ---------------------------------------------------------------------------------------------------
const mk = (id, title, tags) => ({
  id,
  ...need(R).parsePage(`---\ntitle: ${title}\ngroup: basics\norder: 1\nsummary: s\nicon: book\nkeywords: plain\ntags: ${tags}\nanswers:\ndevOnly: false\n---\nA zebra walks by.\n`)
});
test('search: a page whose tags hold a query word ranks above an otherwise equal page without it', () => {
  const a = mk('a-page', 'Alpha', 'gear, wheel, shaft');
  const b = mk('b-page', 'Bravo', 'zebra, wheel, shaft');
  const s = need(S);
  const r = s.search(s.buildIndex([a, b]), 'zebra').map((x) => x.page);
  const r2 = s.search(s.buildIndex([b, a]), 'zebra').map((x) => x.page);
  return (r[0] === 'b-page' && r2[0] === 'b-page') || show([r, r2]);
});

console.log(failures === 0 ? '\nAll help-context checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
