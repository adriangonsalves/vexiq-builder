/**
 * Checks for "Pages and sections carry tags" (openspec in-app-help, task 9.1):
 *   parsePage reads `tags:`, `answers:` and `<!-- answers: ... -->` (src/help/renderPage.js)
 *   checkGuide rules `tags` and `answers` (scripts/help-rules.mjs)
 *
 *   node scripts/check-help-tags.mjs
 *
 * The guide-wide cases copy the fixture set scripts/fixtures/help/rules/clean to a temporary folder and
 * add the tag lines there, so they use small injected lists and not the real 32 pages.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLEAN = path.join(HERE, 'fixtures', 'help', 'rules', 'clean');

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
const R = await load('../src/help/renderPage.js');
const S = await load('../src/help/search.js');
const G = await load('./help-rules.mjs');
const parse = (src) => need(R).parsePage(src);

// ---------------------------------------------------------------------------------------------------
// parsePage
// ---------------------------------------------------------------------------------------------------
const head = (extra) => `---\ntitle: T\ngroup: basics\norder: 1\nsummary: s\nicon: book\nkeywords: k\n${extra}devOnly: false\n---\n`;
const BODY = 'Opening sentence here.\n\n<!-- more -->\n\n';
const sec = (title, text, comment) => `## ${title}\n${comment ? `${comment}\n` : ''}${text}\n\n`;

test('parse: header tags are split on commas and trimmed', () => {
  const t = parse(head('tags: gear,  wheel ,shaft\nanswers: gear\n') + 'Hi there.\n').meta.tags;
  return same(t, ['gear', 'wheel', 'shaft']) || show(t);
});
test('parse: header answers are split on commas and trimmed', () => {
  const a = parse(head('tags: gear, wheel, shaft\nanswers: gear,  omni-wheel\n') + 'Hi there.\n').meta.answers;
  return same(a, ['gear', 'omni-wheel']) || show(a);
});
test('parse: an empty answers line -> []', () => {
  const a = parse(head('tags: gear, wheel, shaft\nanswers:\n') + 'Hi there.\n').meta.answers;
  return same(a, []) || show(a);
});
test('parse: tags and answers do not disturb the other header keys', () => {
  const m = parse(head('tags: gear, wheel, shaft\nanswers: gear\n') + 'Hi there.\n').meta;
  return (m.title === 'T' && m.group === 'basics' && m.order === 1 && same(m.keywords, ['k']) && m.devOnly === false) || show(m);
});
test('parse: a section answers comment right under its heading is read into section.answers', () => {
  const p = parse(head('tags: a, b, c\nanswers:\n') + BODY + sec('One', 'First text here.', '<!-- answers: gear, omni-wheel -->') + sec('Two', 'Second text.'));
  const a = p.sections.map((s) => s.answers);
  return same(a, [['gear', 'omni-wheel'], []]) || show(a);
});
test('parse: the answers comment is not in section.body', () => {
  const p = parse(head('tags: a, b, c\nanswers:\n') + BODY + sec('One', 'First text here.', '<!-- answers: gear -->'));
  return (p.sections[0].body === 'First text here.' && !p.sections[0].body.includes('answers')) || show(p.sections[0].body);
});

const WITH = head('tags: a, b, c\nanswers:\n') + BODY + sec('One', 'Pick a part. Then move it.', '<!-- answers: zebrafish -->') + sec('Two', 'Plain words.');
const WITHOUT = head('tags: a, b, c\nanswers:\n') + BODY + sec('One', 'Pick a part. Then move it.') + sec('Two', 'Plain words.');
test('parse: the answers comment is not counted in words.sections or words.total', () => {
  const a = parse(WITH).words;
  const b = parse(WITHOUT).words;
  return same(a, b) || show([a, b]);
});
test('parse: the answers comment adds no sentence', () => {
  const a = parse(WITH).sentences.map((s) => [s.text.trim(), s.words, s.where]);
  const b = parse(WITHOUT).sentences.map((s) => [s.text.trim(), s.words, s.where]);
  return (same(a, b) && !a.some((s) => /zebrafish|answers/.test(s[0]))) || show([a, b]);
});
test('parse: the answers comment is not in the plain text of the section', () => {
  const p = parse(WITH);
  const text = need(R).plainText(p.sections[0].body);
  return (!/zebrafish|answers/.test(text) && text.includes('Pick a part')) || show(text);
});
test('parse: the answers comment is not searchable ("zebrafish" finds nothing)', () => {
  const s = need(S);
  const page = { id: 'p', ...parse(WITH) };
  const r = s.search(s.buildIndex([page]), 'zebrafish');
  return r.length === 0 || show(r.map((x) => [x.page, x.section]));
});
test('parse: the page top and the other sections are unchanged by the comment', () => {
  const a = parse(WITH);
  const b = parse(WITHOUT);
  return (a.top === b.top && same(a.sections.map((s) => [s.id, s.title, s.body]), b.sections.map((s) => [s.id, s.title, s.body]))) || show([a.sections, b.sections]);
});

// ---------------------------------------------------------------------------------------------------
// checkGuide: rules `tags` and `answers`
// ---------------------------------------------------------------------------------------------------
const TOPIC = ['gear', 'wheel', 'shaft', 'pin', 'beam', 'plate', 'help'];
const SITS = [
  { id: 'sit-a', tier: 1, reason: 'doing a' },
  { id: 'sit-b', tier: 2, reason: 'doing b' },
  { id: 'sit-c', tier: 4, reason: 'doing c' }
];
// Section ids in the clean set: gears -> if-gears-slip, context-bar -> every-button-on-the-bar, quick-start -> where-next
const SECS = { gears: 'If gears slip', 'context-bar': 'Every button on the bar', 'quick-start': 'Where next' };
const BASE = {
  gears: { tags: ['gear', 'wheel', 'shaft'], answers: ['sit-a'] },
  'context-bar': { tags: ['pin', 'beam', 'plate'], answers: ['sit-b'] },
  'quick-start': { tags: ['help', 'gear', 'pin'], answers: ['sit-c'] },
  saving: { tags: ['help', 'beam', 'plate'], answers: [] },
  assistant: { tags: ['help', 'gear', 'shaft'], answers: [] }
};
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'help-tags-'));
let n = 0;
/** Copy the clean set and add tag lines. spec: { pageId: { tags?, answers?, sectionAnswers?: [labels] } } merged over BASE. */
function build(over = {}) {
  const dir = path.join(tmpRoot, `case${n++}`);
  fs.cpSync(CLEAN, dir, { recursive: true });
  for (const id of Object.keys(BASE)) {
    const spec = { ...BASE[id], ...(over[id] || {}) };
    const file = path.join(dir, 'pages', `${id}.md`);
    let text = fs.readFileSync(file, 'utf8');
    const lines = [];
    if (spec.tags) lines.push(`tags: ${spec.tags.join(', ')}`);
    if (spec.answers) lines.push(`answers: ${spec.answers.join(', ')}`);
    text = text.replace(/^(keywords:.*)$/m, `$1\n${lines.join('\n')}`);
    if (spec.sectionAnswers) {
      const heading = `## ${SECS[id]}`;
      if (!text.includes(heading)) throw new Error(`fixture page ${id} has no "${heading}"`);
      text = text.replace(heading, `${heading}\n<!-- answers: ${spec.sectionAnswers.join(', ')} -->`);
    }
    fs.writeFileSync(file, text);
  }
  return dir;
}
const run = (over = {}, opts = {}) => {
  const dir = build(over);
  return need(G).checkGuide({
    pageList: [
      { id: 'quick-start', group: 'start', order: 1 },
      { id: 'gears', group: 'basics', order: 1 },
      { id: 'context-bar', group: 'basics', order: 2 },
      { id: 'saving', group: 'basics', order: 3 },
      { id: 'assistant', group: 'advanced', order: 1 }
    ],
    devOnlyPages: ['assistant'],
    controls: { Tools: {}, 'Tools → Explode': {} },
    icons: { book: 1, gear: 1 },
    barLabels: ['Move', 'Rotate'],
    starterNames: ['Sample', 'Flop'],
    limits: { shotBytes: 100, totalBytes: 1000 },
    pagesDir: path.join(dir, 'pages'),
    shotsDir: path.join(dir, 'shots'),
    coveragePath: path.join(dir, 'coverage.json'),
    topicTags: TOPIC,
    situations: SITS,
    ...opts
  });
};
const mine = (res) => res.problems.filter((p) => p.rule === 'tags' || p.rule === 'answers');
const brief = (ps) => ps.map((p) => `${p.page}:${p.rule}:${p.message}`).join(' | ') || '(no problems)';
const has = (p, ...texts) => texts.every((t) => String(p.message).toLowerCase().includes(String(t).toLowerCase()));

/** expect: [{ rule, page?, has: [...] }]; fails when any is missing, or when a tags/answers problem appears that no expect covers. */
const ruleCase = (label, over, expect, opts = {}) => test(`rules: ${label}`, () => {
  const ps = mine(run(over, opts));
  for (const e of expect) {
    const hit = ps.find((p) => p.rule === e.rule && (e.page === undefined || p.page === e.page) && has(p, ...(e.has || [])));
    if (!hit) return `no ${e.rule} problem${e.page ? ` for ${e.page}` : ''} naming ${show(e.has || [])}; got ${brief(ps)}`;
  }
  const stray = ps.filter((p) => !expect.some((e) => e.rule === p.rule));
  if (stray.length) return `unexpected: ${brief(stray)}`;
});

test('rules: a fully tagged set (every situation claimed once, 3 tags per page) has no tags or answers problems', () => {
  const ps = mine(run());
  return ps.length === 0 || brief(ps);
});
test('rules: checkGuide still returns the parsed pages with tags', () => {
  const { pages } = run();
  return (pages && same(pages.gears.meta.tags, ['gear', 'wheel', 'shaft']) && same(pages.gears.meta.answers, ['sit-a'])) || show(pages && pages.gears && pages.gears.meta);
});
ruleCase('tags: an unknown topic tag names the page and the label', { gears: { tags: ['gear', 'wheel', 'zebra'] } }, [{ rule: 'tags', page: 'gears', has: ['gears', 'zebra'] }]);
ruleCase('tags: a page with 2 tags fails and names the page', { saving: { tags: ['help', 'beam'] } }, [{ rule: 'tags', page: 'saving', has: ['saving'] }]);
ruleCase('tags: a page with no tags line fails and names the page', { saving: { tags: null } }, [{ rule: 'tags', page: 'saving', has: ['saving'] }]);
test('rules: tags: a page with exactly 3 and a page with exactly 10 tags are fine', () => {
  const ten = ['gear', 'wheel', 'shaft', 'pin', 'beam', 'plate', 'help'];
  const ps = mine(run({ saving: { tags: ten.slice(0, 3) } }, { topicTags: [...TOPIC, 't8', 't9', 't10'] }));
  const ps10 = mine(run({ saving: { tags: [...ten, 't8', 't9', 't10'] } }, { topicTags: [...TOPIC, 't8', 't9', 't10'] }));
  return (ps.length === 0 && ps10.length === 0) || brief([...ps, ...ps10]);
});
ruleCase('tags: a page with 11 tags fails and names the page', { saving: { tags: [...TOPIC, 't8', 't9', 't10', 't11'].slice(0, 11) } }, [{ rule: 'tags', page: 'saving', has: ['saving'] }], { topicTags: [...TOPIC, 't8', 't9', 't10', 't11'] });
ruleCase('answers: an unknown label in a page header names the page and the label', { gears: { answers: ['sit-a', 'sit-zzz'] } }, [{ rule: 'answers', page: 'gears', has: ['gears', 'sit-zzz'] }]);
ruleCase('answers: an unknown label in a section names the page and the label', { saving: { sectionAnswers: null }, 'context-bar': { sectionAnswers: ['sit-nope'] } }, [{ rule: 'answers', page: 'context-bar', has: ['context-bar', 'sit-nope'] }]);
test('rules: answers: a topic tag is not a situation (answers: gear is unknown)', () => {
  const ps = mine(run({ saving: { answers: ['gear'] } }));
  return ps.some((p) => p.rule === 'answers' && p.page === 'saving' && has(p, 'gear')) || brief(ps);
});
ruleCase('answers: a situation nobody claims names the situation', { 'quick-start': { answers: [] } }, [{ rule: 'answers', has: ['sit-c'] }]);
ruleCase('answers: a situation claimed by two pages names the situation and both pages', { saving: { answers: ['sit-a'] } }, [{ rule: 'answers', has: ['sit-a', 'gears', 'saving'] }]);
ruleCase('answers: a situation claimed by two sections names the situation and both pages', { gears: { sectionAnswers: ['sit-b'] }, saving: {}, 'quick-start': { sectionAnswers: ['sit-b'] } }, [{ rule: 'answers', has: ['sit-b', 'gears', 'quick-start'] }]);
test('rules: answers: one page claim plus one section claim (same page or another page) is allowed', () => {
  // sit-a: page claim on gears + section claim on gears itself; sit-b: page claim on context-bar + section on quick-start.
  const ps = mine(run({ gears: { sectionAnswers: ['sit-a'] }, 'quick-start': { sectionAnswers: ['sit-b'] } }));
  return ps.length === 0 || brief(ps);
});
test('rules: answers: a section-only claim (no page claims the situation) leaves the situation claimed', () => {
  const ps = mine(run({ 'quick-start': { answers: [], sectionAnswers: ['sit-c'] } }));
  return ps.length === 0 || brief(ps);
});
test('rules: answers: a page claim plus two section claims on one situation: the two section claims clash', () => {
  // sit-a: page claim (gears) + two section claims (context-bar, quick-start) -> the two section claims clash
  const ps = mine(run({ 'context-bar': { sectionAnswers: ['sit-a'] }, 'quick-start': { sectionAnswers: ['sit-a'] } }));
  return ps.some((p) => p.rule === 'answers' && has(p, 'sit-a', 'context-bar', 'quick-start')) || brief(ps);
});
test('rules: defaults come from src/help/tags.js (no injected lists: an unknown tag and a missing situation are still found)', () => {
  const dir = build({ gears: { tags: ['gear', 'wheel', 'zebra'], answers: [] } });
  const res = need(G).checkGuide({
    pageList: [
      { id: 'quick-start', group: 'start', order: 1 },
      { id: 'gears', group: 'basics', order: 1 },
      { id: 'context-bar', group: 'basics', order: 2 },
      { id: 'saving', group: 'basics', order: 3 },
      { id: 'assistant', group: 'advanced', order: 1 }
    ],
    devOnlyPages: ['assistant'],
    controls: { Tools: {}, 'Tools → Explode': {} },
    icons: { book: 1, gear: 1 },
    barLabels: ['Move', 'Rotate'],
    starterNames: ['Sample', 'Flop'],
    limits: { shotBytes: 100, totalBytes: 1000 },
    pagesDir: path.join(dir, 'pages'),
    shotsDir: path.join(dir, 'shots'),
    coveragePath: path.join(dir, 'coverage.json')
  });
  const ps = mine(res);
  return (ps.some((p) => p.rule === 'tags' && has(p, 'zebra')) && ps.some((p) => p.rule === 'answers' && has(p, 'band-builder'))) || brief(ps);
});

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(failures === 0 ? '\nAll help tag checks passed.' : `\n${failures} failure(s).`);
process.exit(failures === 0 ? 0 : 1);
