/**
 * Checks for the in-app Help guide (openspec change in-app-help).
 *
 *   node scripts/check-help.mjs [--only id,id,...] [--pages dir] [--shots dir] [--coverage file]
 *
 * 1. Self-tests: parsePage / renderPage on fixture pages (scripts/fixtures/help/format/), search on small
 *    in-memory pages, and the guide-wide rules (scripts/help-rules.mjs) on fixture sets
 *    (scripts/fixtures/help/rules/<case>/{pages,shots,coverage.json}).
 * 2. Then the real guide, with the command-line options.
 * Exits 1 on any failed self-test or any problem found in the guide.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'help');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const show = (v) => JSON.stringify(v);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A case that throws (for example because a module isn't written yet) is one failed line, not a crash.
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
const R = await load('../src/help/renderPage.js');
const S = await load('../src/help/search.js');
const G = await load('./help-rules.mjs');
const need = (m) => {
  if (!m.mod) throw new Error(m.error);
  return m.mod;
};

// ---------------------------------------------------------------------------------------------------
// Task 1.2: parsePage / sectionId / renderMarkdown / renderPage
// ---------------------------------------------------------------------------------------------------
const fmt = (name) => fs.readFileSync(path.join(FIX, 'format', name), 'utf8');
const parseFixture = (name) => need(R).parsePage(fmt(name));
const render = (name, opts) => {
  const m = need(R);
  return m.renderPage(m.parsePage(fmt(name)), opts);
};
const has = (html, s) => html.includes(s);
const tagOf = (html, re) => (html.match(re) || [''])[0];

const SHOTS = {
  'chain-tools-menu': { w: 640, h: 320, marks: [{ n: 1, x: 0.25, y: 0.5 }, { n: 2, x: 0.75, y: 0.125 }] },
  'chain-sag': { w: 300, h: 200, marks: [{ n: 1, x: 0.5, y: 0.5 }] }
};

// --- sectionId
test('sectionId: "If the chain sags" -> if-the-chain-sags', () => need(R).sectionId('If the chain sags') === 'if-the-chain-sags');
test('sectionId: apostrophe removed ("Something\'s not working?")', () => {
  const got = need(R).sectionId("Something's not working?");
  return got === 'somethings-not-working' || got;
});
test('sectionId: curly apostrophe removed too', () => need(R).sectionId('Something’s not working?') === 'somethings-not-working');
test('sectionId: "Every button on the bar"', () => need(R).sectionId('Every button on the bar') === 'every-button-on-the-bar');
test('sectionId: runs of other characters become one dash, ends trimmed ("  Plan B: Don\'t panic!! ")', () => {
  const got = need(R).sectionId("  Plan B: Don't panic!! ");
  return got === 'plan-b-dont-panic' || got;
});

// --- header block
test('header: title, group, summary, icon are read, comments after # dropped', () => {
  const m = parseFixture('full.md').meta;
  return (m.title === 'Chain and track' && m.group === 'mechanisms' && m.summary === 'Wrap chain round sprockets.' && m.icon === 'link') || show(m);
});
test('header: order is a number (4)', () => parseFixture('full.md').meta.order === 4 || show(parseFixture('full.md').meta.order));
test('header: keywords split on commas and trimmed', () => {
  const k = parseFixture('full.md').meta.keywords;
  return same(k, ['sprocket', 'tread', 'links', 'tank']) || show(k);
});
test('header: empty keywords -> []', () => same(parseFixture('devonly.md').meta.keywords, []) || show(parseFixture('devonly.md').meta.keywords));
test('header: devOnly false -> false, "true" -> true', () => {
  const a = parseFixture('full.md').meta.devOnly;
  const b = parseFixture('devonly.md').meta.devOnly;
  return (a === false && b === true) || show([a, b]);
});
test('header: missing key reads as empty text', () => {
  const m = need(R).parsePage('---\ntitle: Only a title\n---\nHi there.\n').meta;
  return (m.title === 'Only a title' && m.summary === '' && m.icon === '' && m.group === '' && m.devOnly === false && same(m.keywords, [])) || show(m);
});

// --- top part / More sections
test('top part is everything before <!-- more -->, trimmed, with no marker or section text in it', () => {
  const p = parseFixture('full.md');
  return (p.top.startsWith('Wrap chain round two sprockets.') && p.top.endsWith('Fix it.') && !p.top.includes('more -->') && !p.top.includes('If the chain sags') && !p.top.includes('title:')) || show(p.top);
});
test('More sections: one per ## heading, in order, with ids from the heading text', () => {
  const ids = parseFixture('full.md').sections.map((s) => s.id);
  return same(ids, ['if-the-chain-sags', 'somethings-not-working', 'every-button-on-the-bar']) || show(ids);
});
test('More sections: title is the heading text and body is the trimmed text under it', () => {
  const s = parseFixture('full.md').sections;
  return (s[0].title === 'If the chain sags' && s[0].body.startsWith('Look at the mark (1) first.') && s[0].body.endsWith('(help:words).') && !s[0].body.includes('Something') && s[1].title === "Something's not working?" && s[1].body === 'Nothing here yet.') || show(s);
});
test('page with no <!-- more --> marker: all of it is the top part, no sections', () => {
  const p = parseFixture('nomore.md');
  return (p.sections.length === 0 && p.top.includes('Do the second thing.') && p.top.startsWith('One short opening sentence.')) || show(p);
});
test('opening is the plain text of the first paragraph', () => parseFixture('full.md').opening === 'Wrap chain round two sprockets.' || show(parseFixture('full.md').opening));

// --- steps
test('steps: items of the first ordered list (3 in full.md)', () => parseFixture('full.md').steps.length === 3 || show(parseFixture('full.md').steps.length));
test('steps: words counted on plain text (key name and link text count, markers and pictures do not)', () => {
  const s = parseFixture('full.md').steps;
  return (s[0].words === 9 && s[2].words === 9) || show(s.map((x) => x.words));
});
test('steps: {{a | b}} counts the longer wording ("Tap Join, then the sprocket" + "and press W.")', () => parseFixture('full.md').steps[1].words === 8 || show(parseFixture('full.md').steps[1]));
test('steps: markers are the (n) numbers in the step', () => {
  const s = parseFixture('full.md').steps;
  return (same(s[0].markers, [1]) && same(s[1].markers, [2]) && same(s[2].markers, [])) || show(s.map((x) => x.markers));
});
test('steps: shot is the picture inside that step, null when none', () => {
  const s = parseFixture('full.md').steps;
  return (s[0].shot === 'chain-tools-menu' && s[1].shot === 'chain-sprocket' && s[2].shot === null) || show(s.map((x) => x.shot));
});
test('steps: text is plain (no markup, no marker, no picture description)', () => {
  const t = parseFixture('full.md').steps[0].text;
  return (t.includes('Pick the sprockets with Tools → Chain builder') && !t.includes('**') && !t.includes('[[') && !t.includes('(1)') && !t.includes('Tools menu open')) || show(t);
});
test('steps: a page with no ordered list has none', () => parseFixture('devonly.md').steps.length === 0);

// --- pictures, links, controls, markers, tips
test('shots: every picture with name, alt and where (top or section id)', () => {
  const s = parseFixture('full.md').shots;
  const want = [
    { name: 'chain-tools-menu', alt: 'The Tools menu open with Chain builder marked', where: 'top' },
    { name: 'chain-sprocket', alt: 'Sprocket picked', where: 'top' },
    { name: 'chain-sag', alt: 'The slack run', where: 'if-the-chain-sags' }
  ];
  return same(s, want) || show(s);
});
test('links: page, section (null when none), text and where', () => {
  const l = parseFixture('full.md').links;
  const want = [
    { page: 'gears', section: 'meshing', text: 'Gears', where: 'top' },
    { page: 'quick-start', section: null, text: 'Quick', where: 'top' },
    { page: 'words', section: null, text: 'the words page', where: 'if-the-chain-sags' }
  ];
  return same(l, want) || show(l);
});
test('controls: [[name]] with an arrow name kept whole, with where', () => {
  const c = parseFixture('full.md').controls;
  return same(c, [{ name: 'Tools', where: 'top' }, { name: 'Tools → Explode', where: 'top' }]) || show(c);
});
test('markers: in a list item the marker belongs to that item\'s picture; outside a list, to the next picture', () => {
  const m = parseFixture('full.md').markers;
  const want = [
    { n: 1, shot: 'chain-tools-menu', where: 'top' },
    { n: 2, shot: 'chain-sprocket', where: 'top' },
    { n: 1, shot: 'chain-sag', where: 'if-the-chain-sags' }
  ];
  return same(m, want) || show(m);
});
test('markers: a marker with no picture after it in its part has shot null', () => {
  const p = need(R).parsePage('---\ntitle: T\n---\nLook at (2) now.\n\n<!-- more -->\n\n## A\n![x](shot:later)\n');
  return same(p.markers, [{ n: 2, shot: null, where: 'top' }]) || show(p.markers);
});
test('tips: Tip and Watch out, kind and plain text after the label', () => {
  const t = parseFixture('full.md').tips;
  const want = [
    { kind: 'tip', text: 'Keep sprockets in one plane.', where: 'top' },
    { kind: 'warning', text: 'The chain sags. Fix it.', where: 'top' }
  ];
  return same(t, want) || show(t);
});

// --- word counts
test('words: opening 5, top 18 (picture description and (n) not counted, longer {{ | }} wording counted)', () => {
  const w = parseFixture('words.md').words;
  return (w.opening === 5 && w.top === 18) || show(w);
});
test('words: each More section counted by id, total is top plus the sections', () => {
  const w = parseFixture('words.md').words;
  return (w.sections['short-one'] === 2 && w.sections.second === 4 && w.total === w.top + 2 + 4) || show(w);
});

// --- sentences
test('sentences: list items are never joined; split after . ! ? (not inside 1.5); empty pieces dropped', () => {
  const s = parseFixture('sentences.md').sentences.map((x) => x.text.trim());
  const want = ['Start here.', 'Pick a beam', 'Add a pin', 'One.', 'Two!', 'Three?', 'Four', 'Version 1.5 is fine.'];
  return same(s, want) || show(s);
});
test('sentences: words per sentence and where', () => {
  const s = parseFixture('sentences.md').sentences;
  return (s[1].words === 3 && s[7].words === 4 && s.every((x) => x.where === 'top')) || show(s.map((x) => [x.words, x.where]));
});
test('sentences: headings are not sentences, section text is, with its section id', () => {
  const s = parseFixture('full.md').sentences;
  return (!s.some((x) => x.text.trim() === 'If the chain sags') && s.some((x) => x.where === 'if-the-chain-sags' && x.text.trim() === 'Then move a sprocket.')) || show(s.map((x) => [x.text, x.where]));
});
test('sentences: a step with {{a | b}} is one sentence counted at the longer wording', () => {
  const s = parseFixture('full.md').sentences.find((x) => x.text.includes('and press'));
  return (s && s.words === 8) || show(s);
});

// --- renderMarkdown / renderPage
test('render: {{mouse | touch}} mouse input shows only the first wording', () => {
  const h = render('full.md', { input: 'mouse' });
  return (has(h, 'Double-click the sprocket') && !has(h, 'then the sprocket') && !has(h, '{{') && !has(h, ' | ')) || 'wrong wording';
});
test('render: {{mouse | touch}} touch input shows only the second wording (bold kept)', () => {
  const h = render('full.md', { input: 'touch' });
  return (has(h, 'Tap <strong>Join</strong>, then the sprocket') && !has(h, 'Double-click') && !has(h, '{{')) || 'wrong wording';
});
test('render: input defaults to mouse', () => has(render('full.md'), 'Double-click the sprocket') || 'no default');
test('render: an empty half of {{ | }} gives nothing for that input', () => {
  const m = need(R);
  const src = 'Press {{ | tap}} and {{click | }} now.';
  const mouse = m.renderMarkdown(src, { input: 'mouse' });
  const touch = m.renderMarkdown(src, { input: 'touch' });
  return (!has(mouse, 'tap') && has(mouse, 'click') && !has(touch, 'click') && has(touch, 'tap') && !has(mouse + touch, '|') && !has(mouse + touch, '{{')) || show([mouse, touch]);
});
test('render: inline code becomes a key cap', () => has(render('full.md'), '<kbd class="help-key">W</kbd>') || 'no kbd');
test('render: [[Tools → Explode]] becomes a Show me chip', () => has(render('full.md'), '<button type="button" class="help-chip" data-control="Tools → Explode">Tools → Explode</button>') || 'no chip');
test('render: [[Tools]] chip', () => has(render('full.md'), '<button type="button" class="help-chip" data-control="Tools">Tools</button>') || 'no chip');
test('render: picture with no shots entry: figure, img src under base, alt, lazy, no width/height, no marks', () => {
  const h = render('full.md', {});
  const img = tagOf(h, /<img[^>]*chain-tools-menu[^>]*>/);
  return (has(h, '<figure class="help-shot" data-shot="chain-tools-menu">') && img.includes('src="/help/shots/chain-tools-menu.webp"') && img.includes('alt="The Tools menu open with Chain builder marked"') && img.includes('loading="lazy"') && !/width=/.test(img) && !has(h, 'help-mark')) || img;
});
test('render: base is put before help/shots/', () => {
  const img = tagOf(render('full.md', { base: '/vexiq-builder/' }), /<img[^>]*chain-sag[^>]*>/);
  return img.includes('src="/vexiq-builder/help/shots/chain-sag.webp"') || img;
});
test('render: picture with a shots entry has width and height', () => {
  const img = tagOf(render('full.md', { shots: SHOTS }), /<img[^>]*chain-tools-menu[^>]*>/);
  return (img.includes('width="640"') && img.includes('height="320"')) || img;
});
test('render: marks are help-mark spans at the fractions as percentages, inside the picture\'s figure', () => {
  const h = render('full.md', { shots: SHOTS });
  const fig = tagOf(h, /<figure class="help-shot" data-shot="chain-tools-menu">[\s\S]*?<\/figure>/);
  return (fig.includes('<span class="help-mark" style="left:25%;top:50%">1</span>') && fig.includes('<span class="help-mark" style="left:75%;top:12.5%">2</span>') && !fig.includes('chain-sag')) || fig;
});
test('render: a picture\'s marks do not leak into another picture', () => {
  const h = render('full.md', { shots: SHOTS });
  const fig = tagOf(h, /<figure class="help-shot" data-shot="chain-sprocket">[\s\S]*?<\/figure>/);
  return !fig.includes('help-mark') || fig;
});
test('render: help: link with a section', () => {
  const a = tagOf(render('full.md'), /<a [^>]*>Gears<\/a>/);
  return (a.includes('href="#help/gears/meshing"') && a.includes('data-help-page="gears"') && a.includes('data-help-section="meshing"')) || a;
});
test('render: help: link with no section has no data-help-section', () => {
  const a = tagOf(render('full.md'), /<a [^>]*>Quick<\/a>/);
  return (a.includes('href="#help/quick-start"') && a.includes('data-help-page="quick-start"') && !a.includes('data-help-section')) || a;
});
test('render: links to other sites are normal links', () => {
  const h = need(R).renderMarkdown('See [VEX](https://www.vexrobotics.com/iq).');
  return h.includes('href="https://www.vexrobotics.com/iq"') || h;
});
test('render: Tip box', () => /<div class="help-tip" role="note">[\s\S]*Keep sprockets in one plane\.[\s\S]*<\/div>/.test(render('full.md')) || 'no tip box');
test('render: Watch out box', () => /<div class="help-warn" role="note">[\s\S]*The chain sags\.[\s\S]*<\/div>/.test(render('full.md')) || 'no warn box');
test('render: (1) becomes a badge (in a step, after a space, before a full stop)', () => {
  const h = render('full.md');
  return (has(h, '<span class="help-badge">1</span>') && has(h, '<span class="help-badge">2</span>') && !has(h, '(1)') && !has(h, '(2)')) || 'no badge';
});
test('render: only (n) of 1-2 digits after a space or line start is a badge', () => {
  const m = need(R);
  const none = m.renderMarkdown('Call (123) now, f(1)x and (2024) too.');
  const some = m.renderMarkdown('(1) first, then (12) and (3).');
  const count = (some.match(/help-badge/g) || []).length;
  return (!has(none, 'help-badge') && count === 3) || show([none, some]);
});
test('render: normal Markdown (bold, table) as marked does', () => {
  const h = need(R).renderMarkdown('A **bold** word.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  return (has(h, '<strong>bold</strong>') && has(h, '<table>')) || h;
});
test('render: More sections are closed details elements with id, data-section, summary h2, body', () => {
  const h = render('full.md');
  return (has(h, '<details class="help-more" id="help-sec-if-the-chain-sags" data-section="if-the-chain-sags"><summary><h2>If the chain sags</h2></summary>') && has(h, 'id="help-sec-somethings-not-working"') && has(h, 'id="help-sec-every-button-on-the-bar"') && (h.match(/<details/g) || []).length === 3 && (h.match(/<\/details>/g) || []).length === 3) || 'details';
});
test('render: the top part comes first, then the sections in order', () => {
  const h = render('full.md');
  const a = h.indexOf('Wrap chain round two sprockets.');
  const b = h.indexOf('<details');
  const c = h.indexOf('help-sec-somethings');
  const d = h.indexOf('help-sec-every');
  return (a >= 0 && a < b && b < c && c < d) || show([a, b, c, d]);
});
test('render: section text is inside its details (marker badge + picture of the section)', () => {
  const h = render('full.md', { shots: SHOTS });
  const det = tagOf(h, /<details[^>]*id="help-sec-if-the-chain-sags"[\s\S]*?<\/details>/);
  return (det.includes('data-shot="chain-sag"') && det.includes('help-badge') && det.includes('left:50%;top:50%')) || det;
});
test('render: a page with no More sections has no details element', () => !has(render('nomore.md'), '<details') || 'has details');

// ---------------------------------------------------------------------------------------------------
// Task 1.5: search
// ---------------------------------------------------------------------------------------------------
const mkPage = (id, title, keywords, top, sections = []) => {
  const text = `---\ntitle: ${title}\ngroup: basics\norder: 1\nsummary: s\nicon: book\nkeywords: ${keywords}\ndevOnly: false\n---\n${top}\n${sections.length ? '\n<!-- more -->\n' : ''}${sections.map(([t, b]) => `\n## ${t}\n${b}\n`).join('')}`;
  return { id, ...need(R).parsePage(text) };
};
const PAGES = () => [
  mkPage('gears', 'Gears', 'teeth, mesh', 'Turn one wheel and the next turns too. Each tooth meets another.'),
  mkPage('shafts-and-wheels', 'Shafts and wheels', 'axle, shaft, wheel', 'A shaft carries a wheel. Push the wheel until it stops.'),
  mkPage('chain-and-track', 'Chain and track', 'sprocket, links', 'Wrap chain round the gears you picked.', [['If the chain sags', 'Move a sprocket to remove the slack.']]),
  mkPage('explode', 'Explode', 'spread, apart', 'Pull your build apart to look inside.')
];
const find = (index, q) => need(S).search(index, q);
const idx = () => need(S).buildIndex(PAGES());

test('search: a title match ranks first ("gears" -> Gears page before text mentions)', () => {
  const r = find(idx(), 'gears');
  return (r.length >= 2 && r[0].page === 'gears' && r[0].section === null && r[0].score >= 100 && r.some((x) => x.page === 'chain-and-track')) || show(r.map((x) => [x.page, x.section, x.score]));
});
test('search: results are best first (scores never go up)', () => {
  const r = find(idx(), 'wheel');
  return (r.length >= 1 && r.every((x, i) => i === 0 || r[i - 1].score >= x.score)) || show(r.map((x) => x.score));
});
test('search: a query word matches the start of a word ("gea" finds Gears)', () => {
  const r = find(idx(), 'gea');
  return r.some((x) => x.page === 'gears' && x.section === null) || show(r.map((x) => x.page));
});
test('search: a query word does not match the middle of a word ("ears" finds nothing)', () => {
  const r = find(idx(), 'ears');
  return r.length === 0 || show(r.map((x) => x.page));
});
test('search: keyword match ("axle" finds shafts-and-wheels, whose text does not say axle)', () => {
  const page = PAGES().find((p) => p.id === 'shafts-and-wheels');
  if (/axle/i.test(page.top)) return 'fixture text mentions axle';
  const r = find(idx(), 'axle');
  return (r.length === 1 && r[0].page === 'shafts-and-wheels' && r[0].section === null && r[0].score >= 30) || show(r.map((x) => [x.page, x.score]));
});
test('search: every query word must match ("chain sprocket" finds only the chain page and its section; "chain zebra" finds nothing)', () => {
  const r = find(idx(), 'chain sprocket');
  const none = find(idx(), 'chain zebra');
  return (r.length >= 1 && r.every((x) => x.page === 'chain-and-track') && r.some((x) => x.section === 'if-the-chain-sags') && none.length === 0) || show([r.map((x) => [x.page, x.section]), none.length]);
});
test('search: the page title counts for a section entry too ("chain slack" finds the section)', () => {
  const r = find(idx(), 'chain slack');
  return (r.length === 1 && r[0].section === 'if-the-chain-sags') || show(r.map((x) => [x.page, x.section]));
});
test('search: no match returns an empty list', () => same(find(idx(), 'zebra'), []));
test('search: blank query returns an empty list ("" and spaces)', () => same(find(idx(), ''), []) && same(find(idx(), '   '), []));
test('search: case is ignored', () => {
  const a = find(idx(), 'GeArS').map((x) => [x.page, x.section]);
  const b = find(idx(), 'gears').map((x) => [x.page, x.section]);
  return (a.length > 0 && same(a, b)) || show([a, b]);
});
test('search: a section result carries its section id and title, and the page title', () => {
  const r = find(idx(), 'sags');
  const x = r[0];
  return (r.length === 1 && x.page === 'chain-and-track' && x.section === 'if-the-chain-sags' && x.sectionTitle === 'If the chain sags' && x.title === 'Chain and track' && typeof x.snippet === 'string' && typeof x.score === 'number') || show(r);
});
test('search: a page result has section and sectionTitle null, a snippet and the page title', () => {
  const x = find(idx(), 'explode')[0];
  return (x && x.page === 'explode' && x.section === null && x.sectionTitle === null && x.title === 'Explode' && typeof x.snippet === 'string' && x.snippet.length > 0 && x.snippet.length <= 140) || show(x);
});
test('search: a title word beats a section title word beats a text word', () => {
  const pages = [
    mkPage('c', 'Cherry', 'plain', 'Nothing here.'),
    mkPage('b', 'Banana', 'plain', 'Nothing here.', [['Cherry tips', 'Nothing here.']]),
    mkPage('a', 'Apple', 'plain', 'A cherry is red.')
  ];
  const r = need(S).search(need(S).buildIndex(pages), 'cherry').map((x) => [x.page, x.section]);
  const want = [['c', null], ['b', 'cherry-tips'], ['a', null]];
  return same(r, want) || show(r);
});
test('search: equal scores keep the guide order, whatever the page ids', () => {
  const a = mkPage('a-page', 'Alpha', 'plain', 'A zebra walks.');
  const b = mkPage('b-page', 'Bravo', 'plain', 'A zebra runs.');
  const ab = need(S).search(need(S).buildIndex([a, b]), 'zebra').map((x) => x.page);
  const ba = need(S).search(need(S).buildIndex([b, a]), 'zebra').map((x) => x.page);
  return (same(ab, ['a-page', 'b-page']) && same(ba, ['b-page', 'a-page'])) || show([ab, ba]);
});

// ---------------------------------------------------------------------------------------------------
// Task 1.4: guide-wide rules (scripts/help-rules.mjs)
// ---------------------------------------------------------------------------------------------------
const PAGE_LIST = [
  { id: 'quick-start', group: 'start', order: 1 },
  { id: 'gears', group: 'basics', order: 1 },
  { id: 'context-bar', group: 'basics', order: 2 },
  { id: 'saving', group: 'basics', order: 3 },
  { id: 'assistant', group: 'advanced', order: 1 }
];
const CLEAN_OPTS = {
  pageList: PAGE_LIST,
  devOnlyPages: ['assistant'],
  controls: { Tools: {}, 'Tools → Explode': {} },
  icons: { book: 1, gear: 1 },
  barLabels: ['Move', 'Rotate'],
  starterNames: ['Sample', 'Flop'],
  limits: { shotBytes: 100, totalBytes: 1000 },
  topicTags: [],
  situations: []
};
const caseOpts = (dir, extra = {}) => ({
  ...CLEAN_OPTS,
  pagesDir: path.join(FIX, 'rules', dir, 'pages'),
  shotsDir: path.join(FIX, 'rules', dir, 'shots'),
  coveragePath: path.join(FIX, 'rules', dir, 'coverage.json'),
  ...extra
});
const runCase = (dir, extra) => need(G).checkGuide(caseOpts(dir, extra));
const brief = (problems) => problems.map((p) => `${p.page}:${p.rule}:${p.message}`).join(' | ') || '(no problems)';
const low = (s) => String(s).toLowerCase();

/**
 * expect: [{ rule, page?, has?: [text the message must contain], pageOrMsg?: true }]
 *   page: the problem's page field must be this id.
 *   has: the message must contain each text (case-insensitive).
 * also: other rules allowed to appear because of the same breakage. Any other rule is a failure.
 */
const ruleCase = (label, dir, expect, { also = [], opts = {} } = {}) => test(`rules: ${label}`, () => {
  const { problems } = runCase(dir, opts);
  for (const e of expect) {
    const hits = problems.filter((p) => p.rule === e.rule && (e.page === undefined || p.page === e.page));
    if (!hits.length) return `no ${e.rule} problem${e.page ? ` for ${e.page}` : ''}; got ${brief(problems)}`;
    const named = hits.some((p) => (e.has || []).every((t) => low(p.message).includes(low(t))));
    if (!named) return `${e.rule} message does not name ${show(e.has)}; got ${brief(hits)}`;
  }
  const allowed = new Set([...expect.map((e) => e.rule), ...also]);
  const stray = problems.filter((p) => !allowed.has(p.rule));
  if (stray.length) return `unexpected problems: ${brief(stray)}`;
});
const noProblems = (label, dir, opts = {}) => test(`rules: ${label}`, () => {
  const { problems } = runCase(dir, opts);
  return problems.length === 0 || brief(problems);
});

noProblems('clean set gives no problems (MCP on the dev-only page, {{ | }} wording, quick-start Where next, links, markers, tips all fine)', 'clean');
test('rules: checkGuide returns the parsed pages by id', () => {
  const { pages } = runCase('clean');
  return (pages && pages.gears && pages.gears.meta.title === 'Gears' && pages['quick-start'] && pages['quick-start'].steps.length === 3) || show(Object.keys(pages || {}));
});

// page-list
ruleCase('page-list: an id in the page list with no file is reported once, naming the page, and skipped by other rules', 'page-list-missing', [{ rule: 'page-list', page: 'gears', has: ['gears'] }], { also: ['link'] });
test('rules: page-list: a missing page has one problem, not one per rule', () => {
  const { problems } = runCase('page-list-missing');
  const mine = problems.filter((p) => p.page === 'gears');
  return mine.length === 1 || brief(mine);
});
ruleCase('page-list: a file that is not in the list is reported, naming it', 'page-list-extra', [{ rule: 'page-list', has: ['extra'] }]);
ruleCase('page-list: header order differs from the list', 'page-list-order', [{ rule: 'page-list', page: 'gears', has: ['gears'] }]);
ruleCase('page-list: header group differs from the list', 'page-list-group', [{ rule: 'page-list', page: 'gears', has: ['gears'] }]);

// header
ruleCase('header: summary missing', 'header-missing-summary', [{ rule: 'header', page: 'gears', has: ['gears', 'summary'] }]);
ruleCase('header: title missing', 'header-missing-title', [{ rule: 'header', page: 'gears', has: ['gears', 'title'] }]);
ruleCase('header: icon not in the icon list', 'header-bad-icon', [{ rule: 'header', page: 'gears', has: ['gears', 'no-such-icon'] }]);

// link
ruleCase('link: help: link to a page that is not in the list (names page and link)', 'link-no-page', [{ rule: 'link', page: 'context-bar', has: ['context-bar', 'nowhere'] }]);
ruleCase('link: help:gears#no-such-section (spec scenario: names the page and the link)', 'link-no-section', [{ rule: 'link', page: 'context-bar', has: ['context-bar', 'no-such-section'] }]);

// pictures
ruleCase('shot-missing: picture file not in the shots folder (names page and picture)', 'shot-missing-file', [{ rule: 'shot-missing', page: 'gears', has: ['gears', 'ghost'] }]);
ruleCase('shot-missing: picture file present but no shots.json entry', 'shot-missing-json', [{ rule: 'shot-missing', page: 'gears', has: ['gears', 'nojson'] }]);
ruleCase('shot-alt: picture with an empty description', 'shot-alt', [{ rule: 'shot-alt', page: 'gears', has: ['gears', 'gear-extra'] }]);
ruleCase('shot-size: a used picture over the byte limit fails and names the picture (spec: 300 KB picture)', 'shot-size', [{ rule: 'shot-size', has: ['gear-big'] }]);
ruleCase('shots-total: all pictures together over the limit', 'shots-total', [{ rule: 'shots-total' }], { opts: { limits: { shotBytes: 100, totalBytes: 50 } } });
ruleCase('shot-unused: a picture file no page uses (spec: names it)', 'shot-unused-file', [{ rule: 'shot-unused', has: ['orphan'] }]);
ruleCase('shot-unused: a shots.json entry no page uses', 'shot-unused-json', [{ rule: 'shot-unused', has: ['orphan-entry'] }]);
noProblems('shot-unused: names starting fixture- are ignored', 'fixture-ignored');

// markers
ruleCase('marker: (1) with no picture to belong to', 'marker-no-shot', [{ rule: 'marker', page: 'gears', has: ['gears'] }]);
ruleCase('marker: step says (3) and its picture has two marks (spec: names page and picture)', 'marker-too-big', [{ rule: 'marker', page: 'gears', has: ['gears', 'gear-pair'] }]);

// controls
ruleCase('control: [[Nonsense]] is not a known control', 'control-unknown', [{ rule: 'control', page: 'gears', has: ['gears', 'Nonsense'] }]);

// length
ruleCase('length: a sentence over 25 words', 'length-sentence', [{ rule: 'length', page: 'gears', has: ['gears', '25'] }]);
ruleCase('length: average sentence over 15 words', 'length-avg', [{ rule: 'length', page: 'gears', has: ['gears', '15'] }]);
ruleCase('length: opening sentence over 20 words', 'length-opening', [{ rule: 'length', page: 'gears', has: ['gears', '20'] }]);
ruleCase('length: 7 steps on an ordinary page (limit 6)', 'length-steps', [{ rule: 'length', page: 'gears', has: ['gears', '6'] }]);
ruleCase('length: a step over 25 words', 'length-step-words', [{ rule: 'length', page: 'gears', has: ['gears', '25'] }]);
ruleCase('length: top part of about 140 words fails and names the page and the limit 120 (spec scenario)', 'length-top', [{ rule: 'length', page: 'gears', has: ['gears', '120'] }]);
ruleCase('length: a More section over 200 words', 'length-section', [{ rule: 'length', page: 'gears', has: ['gears', '200'] }]);
noProblems('length: quick-start may have 8 steps (each with a picture)', 'quick-start-8-steps');
ruleCase('length: quick-start with 9 steps fails (limit 8)', 'quick-start-9-steps', [{ rule: 'length', page: 'quick-start', has: ['quick-start', '8'] }]);
ruleCase('length: quick-start over 250 words in total', 'quick-start-words', [{ rule: 'length', page: 'quick-start', has: ['quick-start', '250'] }]);
ruleCase('length: quick-start More section other than "Where next"', 'quick-start-other-section', [{ rule: 'length', page: 'quick-start', has: ['quick-start'] }]);
ruleCase('length: quick-start step with no picture', 'quick-start-no-picture', [{ rule: 'length', page: 'quick-start', has: ['quick-start'] }]);

// more titles
ruleCase('more-title: "More details" is too generic', 'more-title-details', [{ rule: 'more-title', page: 'gears', has: ['gears'] }]);
ruleCase('more-title: "NOTES" in capitals is too generic', 'more-title-notes', [{ rule: 'more-title', page: 'gears', has: ['gears'] }]);

// tips
ruleCase('tips: a tip with two sentences', 'tips-two-sentences', [{ rule: 'tips', page: 'gears', has: ['gears'] }]);
ruleCase('tips: three tips or warnings in the top part', 'tips-three', [{ rule: 'tips', page: 'gears', has: ['gears'] }]);

// words
test('rules: words: instance, instances, port, ports, viewport, BVH, kinematic, semantic each fail and are named', () => {
  const { problems } = runCase('words-dev');
  const w = problems.filter((p) => p.rule === 'words' && p.page === 'gears');
  const missing = ['instance', 'instances', 'port', 'ports', 'viewport', 'BVH', 'kinematic', 'semantic'].filter((t) => !w.some((p) => new RegExp(`\\b${t}\\b`, 'i').test(p.message)));
  const stray = problems.filter((p) => p.rule !== 'words');
  return (!missing.length && !stray.length) || `not named: ${missing.join(', ')}; ${brief(stray)}`;
});
ruleCase('words: "MCP" on a page other than the assistant page (names the word and the page)', 'words-mcp', [{ rule: 'words', page: 'gears', has: ['gears', 'MCP'] }]);
test('rules: words: file names App.jsx and notes.json each fail and are named', () => {
  const { problems } = runCase('words-files');
  const w = problems.filter((p) => p.rule === 'words' && p.page === 'gears');
  const missing = ['App.jsx', 'notes.json'].filter((t) => !w.some((p) => p.message.includes(t)));
  const stray = problems.filter((p) => p.rule !== 'words');
  return (!missing.length && !stray.length) || `not named: ${missing.join(', ')}; ${brief(stray)}`;
});
noProblems('words: banned words inside bold (**Snap & Mate to Port**), "support", "export" and a .vexiq.json name are allowed', 'words-allowed');

// dev-only
ruleCase('dev-only: assistant page without devOnly: true', 'dev-only-missing', [{ rule: 'dev-only', page: 'assistant', has: ['assistant'] }]);
ruleCase('dev-only: another page marked devOnly: true', 'dev-only-extra', [{ rule: 'dev-only', page: 'gears', has: ['gears'] }]);

// coverage
ruleCase('coverage: coverage file missing (full run)', 'coverage-missing-file', [{ rule: 'coverage' }]);
ruleCase('coverage: coverage file is not a JSON array', 'coverage-not-array', [{ rule: 'coverage' }]);
ruleCase('coverage: entry whose page is not a page', 'coverage-bad-page', [{ rule: 'coverage', has: ['nope-page'] }]);
ruleCase('coverage: entry whose section does not exist', 'coverage-bad-section', [{ rule: 'coverage', has: ['nope-sec'] }]);
ruleCase('coverage: the section text lacks the feature\'s name (spec: Nothing left out)', 'coverage-name-missing', [{ rule: 'coverage', has: ['Zebra'] }]);

// the guide-wide lists
ruleCase('context-bar: a bar button label the context-bar page does not name (spec: names the button)', 'context-bar-missing', [{ rule: 'context-bar', page: 'context-bar', has: ['Mirror Everything'] }], { opts: { barLabels: ['Move', 'Rotate', 'Mirror Everything'] } });
ruleCase('starters: a starter the saving page does not name (spec: names it)', 'starters-missing', [{ rule: 'starters', page: 'saving', has: ['Zorp'] }], { opts: { starterNames: ['Sample', 'Flop', 'Zorp'] } });
noProblems('context-bar and starters: names are matched ignoring case, and a label in a More section counts', 'clean', { barLabels: ['move', 'ROTATE'], starterNames: ['sample', 'FLOP'] });

// --only scoping
test('only: a full run flags a picture no page uses', () => runCase('shot-unused-file').problems.some((p) => p.rule === 'shot-unused') || 'not flagged');
noProblems('only: the same set with only does not flag the unused picture', 'shot-unused-file', { only: ['gears'] });
noProblems('only: the total size rule is a full-run rule', 'shots-total', { only: ['gears'], limits: { shotBytes: 100, totalBytes: 50 } });
noProblems('only: a broken page not in only is not reported (icon problem on gears, only quick-start)', 'header-bad-icon', { only: ['quick-start'] });
noProblems('only: a missing coverage file is not a problem', 'coverage-missing-file', { only: ['gears'] });
noProblems('only: other listed pages missing, and extra files, give no page-list problem (only saving)', 'only-others-missing', { only: ['saving'] });
test('only: the same set as a full run does report the missing pages', () => runCase('only-others-missing').problems.some((p) => p.rule === 'page-list' && p.page === 'gears') || 'not reported');
test('only: a link target is read even when it is not in only (clean, only gears)', () => {
  const { problems } = runCase('clean', { only: ['gears'] });
  return problems.length === 0 || brief(problems);
});
ruleCase('only: a link to a page whose file is missing is broken', 'link-target-missing', [{ rule: 'link', page: 'gears' }], { opts: { only: ['gears'] } });
test('only: a link problem on a page outside only is not reported', () => {
  const { problems } = runCase('link-no-section', { only: ['gears'] });
  return problems.length === 0 || brief(problems);
});
test('only: context-bar rule runs when context-bar is in only, and not otherwise', () => {
  const o = { barLabels: ['Move', 'Rotate', 'Mirror Everything'] };
  const withIt = runCase('context-bar-missing', { ...o, only: ['context-bar'] }).problems.some((p) => p.rule === 'context-bar');
  const without = runCase('context-bar-missing', { ...o, only: ['gears'] }).problems.some((p) => p.rule === 'context-bar');
  return (withIt && !without) || show([withIt, without]);
});
test('only: starters rule runs when saving is in only, and not otherwise', () => {
  const o = { starterNames: ['Sample', 'Flop', 'Zorp'] };
  const withIt = runCase('starters-missing', { ...o, only: ['saving'] }).problems.some((p) => p.rule === 'starters');
  const without = runCase('starters-missing', { ...o, only: ['gears'] }).problems.some((p) => p.rule === 'starters');
  return (withIt && !without) || show([withIt, without]);
});
test('only: coverage entries are checked for pages in only (name missing on gears, only gears)', () => runCase('coverage-name-missing', { only: ['gears'] }).problems.some((p) => p.rule === 'coverage') || 'not checked');
test('only: coverage entries of pages not in only are not checked (name missing on gears, only saving)', () => {
  const { problems } = runCase('coverage-name-missing', { only: ['saving'] });
  return !problems.some((p) => p.rule === 'coverage') || brief(problems);
});

// ---------------------------------------------------------------------------------------------------
// The real guide
// ---------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const selfFailures = failures;
console.log(`\nSelf-tests: ${selfFailures === 0 ? 'all passed' : `${selfFailures} failed`}\n`);

const guideOpts = {};
if (arg('--only')) guideOpts.only = arg('--only').split(',').map((s) => s.trim()).filter(Boolean);
if (arg('--pages')) guideOpts.pagesDir = path.resolve(arg('--pages'));
if (arg('--shots')) guideOpts.shotsDir = path.resolve(arg('--shots'));
if (arg('--coverage')) guideOpts.coveragePath = path.resolve(arg('--coverage'));

let guideProblems = 0;
let guideNote = '';
try {
  const { problems, pages } = need(G).checkGuide(guideOpts);
  for (const p of problems) console.log(`FAIL  ${p.page}: ${p.rule}: ${p.message}`);
  guideProblems = problems.length;
  guideNote = `${Object.keys(pages || {}).length} page(s) read${guideOpts.only ? ` (only ${guideOpts.only.join(', ')})` : ''}`;
} catch (e) {
  console.log(`FAIL  guide: could not run the guide check  -> ${e.message}`);
  guideProblems = 1;
}
console.log(`\nGuide: ${guideProblems === 0 ? `no problems${guideNote ? `, ${guideNote}` : ''}` : `${guideProblems} problem(s)`}`);

failures += guideProblems;
console.log(failures === 0 ? '\nAll help checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
