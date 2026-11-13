/**
 * The guide-wide rules for the in-app Help (openspec change in-app-help, specs/help-content).
 * Node only. `checkGuide(options)` reads the pages, pictures and coverage list and returns
 * `{ problems: [{ page, rule, message }], pages: { [id]: parsed } }`. Used by scripts/check-help.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePage, plainText, splitSentences } from '../src/help/renderPage.js';
import { HELP_PAGES, DEV_ONLY_PAGES } from '../src/help/pageList.js';
import { HELP_CONTROLS } from '../src/help/controls.js';
import { HELP_ICONS } from '../src/help/icons.js';
import { BAR_IDS, WHEEL_IDS, BAR_TIPS, COMMIT_TIPS } from '../src/utils/contextToolbarItems.js';
import { STARTERS } from '../src/starters.js';
import { TOPIC_TAGS, SITUATIONS } from '../src/help/tags.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KB = 1024;

const defaultBarLabels = () => {
  const names = [...BAR_IDS, ...WHEEL_IDS].map((id) => BAR_TIPS[id] && BAR_TIPS[id][0]);
  names.push(BAR_TIPS.autoJoin[0], ...Object.values(COMMIT_TIPS).map((t) => t[0]));
  return [...new Set(names.filter(Boolean))];
};

const GENERIC_TITLES = ['details', 'more', 'more details', 'other', 'misc', 'notes', 'info', 'information'];
const BANNED = /\b(instances?|ports?|BVH|viewport|kinematic|semantic|MCP)\b/gi;
const FILE_NAME = /\b[\w-]+(?:\.[\w-]+)*\.(?:js|jsx|mjs|json|md|css|html|webp|png|svg)\b/gi;

export function checkGuide(options = {}) {
  const {
    pagesDir = path.join(ROOT, 'src/help/pages'),
    shotsDir = path.join(ROOT, 'public/help/shots'),
    coveragePath = path.join(ROOT, 'src/help/coverage.json'),
    only = null,
    pageList = HELP_PAGES,
    devOnlyPages = DEV_ONLY_PAGES,
    controls = HELP_CONTROLS,
    icons = HELP_ICONS,
    barLabels = defaultBarLabels(),
    starterNames = STARTERS.map((s) => s.name),
    topicTags = TOPIC_TAGS,
    situations = SITUATIONS,
    limits = {}
  } = options;
  const shotBytes = limits.shotBytes ?? 150 * KB;
  const totalBytes = limits.totalBytes ?? 8 * KB * KB;

  const problems = [];
  const add = (page, rule, message) => problems.push({ page, rule, message });
  const pages = {};
  const listed = new Map(pageList.map((p) => [p.id, p]));
  const inScope = (id) => !only || only.includes(id);

  const fileOf = (id) => path.join(pagesDir, `${id}.md`);
  const read = (id) => {
    if (!(id in pages)) {
      pages[id] = fs.existsSync(fileOf(id)) ? parsePage(fs.readFileSync(fileOf(id), 'utf8')) : null;
    }
    return pages[id];
  };

  // --- which pages are checked
  const files = fs.existsSync(pagesDir)
    ? fs.readdirSync(pagesDir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))
    : [];
  const checked = [];
  for (const { id } of pageList) {
    if (!inScope(id)) continue;
    if (read(id)) checked.push(id);
    else add(id, 'page-list', `Page "${id}" is in the page list but ${id}.md was not found in ${pagesDir}.`);
  }
  if (!only) {
    for (const id of files) {
      if (!listed.has(id)) add(id, 'page-list', `File "${id}.md" is not in the page list (src/help/pageList.js).`);
    }
  }

  // --- pictures
  let shotsJson = {};
  try {
    shotsJson = JSON.parse(fs.readFileSync(path.join(shotsDir, 'shots.json'), 'utf8'));
  } catch { /* none yet */ }
  const shotFiles = fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir).filter((f) => f.endsWith('.webp')) : [];
  const sizeOf = (name) => {
    try {
      return fs.statSync(path.join(shotsDir, `${name}.webp`)).size;
    } catch {
      return null;
    }
  };

  const sectionText = (p) => [p.top, ...p.sections.map((s) => s.body)];

  for (const id of checked) {
    const p = pages[id];
    const m = p.meta;
    const where = `Page "${id}"`;
    const entry = listed.get(id);

    // page-list: header agrees with the list
    if (m.group !== entry.group) add(id, 'page-list', `${where}: header group "${m.group}" differs from the page list ("${entry.group}").`);
    if (m.order !== entry.order) add(id, 'page-list', `${where}: header order ${m.order} differs from the page list (${entry.order}).`);

    // header
    for (const key of ['title', 'group', 'summary', 'icon']) {
      if (!m[key]) add(id, 'header', `${where}: header ${key} is missing.`);
    }
    if (!Number.isFinite(m.order)) add(id, 'header', `${where}: header order is missing or not a number.`);
    if (m.icon && !(m.icon in icons)) add(id, 'header', `${where}: header icon "${m.icon}" is not in the icon list (src/help/icons.js).`);

    // links
    for (const l of p.links) {
      const text = `help:${l.page}${l.section ? `#${l.section}` : ''}`;
      if (!listed.has(l.page)) {
        add(id, 'link', `${where}: link "${text}" names a page that is not in the page list.`);
        continue;
      }
      const target = read(l.page);
      if (!target) add(id, 'link', `${where}: link "${text}" points to ${l.page}, whose file is missing.`);
      else if (l.section && !target.sections.some((s) => s.id === l.section)) {
        add(id, 'link', `${where}: link "${text}" names a section that page "${l.page}" does not have.`);
      }
    }

    // pictures
    for (const s of p.shots) {
      if (sizeOf(s.name) === null) add(id, 'shot-missing', `${where}: picture "${s.name}" has no ${s.name}.webp in ${shotsDir}.`);
      else if (sizeOf(s.name) > shotBytes) add(id, 'shot-size', `${where}: picture "${s.name}" is ${sizeOf(s.name)} bytes, over the limit of ${shotBytes} bytes.`);
      if (!shotsJson[s.name]) add(id, 'shot-missing', `${where}: picture "${s.name}" has no entry in shots.json.`);
      if (!s.alt.trim()) add(id, 'shot-alt', `${where}: picture "${s.name}" has no description.`);
    }
    for (const mk of p.markers) {
      if (!mk.shot) {
        add(id, 'marker', `${where}: marker (${mk.n}) in ${mk.where} has no picture to belong to.`);
        continue;
      }
      const marks = shotsJson[mk.shot] && shotsJson[mk.shot].marks;
      if (marks && mk.n > marks.length) {
        add(id, 'marker', `${where}: marker (${mk.n}) names a mark that picture "${mk.shot}" does not have (it has ${marks.length}).`);
      }
    }

    // controls
    for (const c of p.controls) {
      if (!(c.name in controls)) add(id, 'control', `${where}: [[${c.name}]] is not a known control (src/help/controls.js).`);
    }

    // length
    const len = (message) => add(id, 'length', `${where}: ${message}`);
    const over = p.sentences.filter((s) => s.words > 25);
    for (const s of over) len(`a sentence has ${s.words} words, over the limit of 25: "${s.text}"`);
    if (p.sentences.length) {
      const avg = p.sentences.reduce((a, s) => a + s.words, 0) / p.sentences.length;
      if (avg > 15) len(`sentences average ${avg.toFixed(1)} words, over the limit of 15.`);
    }
    const first = splitSentences(p.opening)[0];
    if (first && first.split(/\s+/).length > 20) len(`the opening sentence has ${first.split(/\s+/).length} words, over the limit of 20.`);
    for (const [i, s] of p.steps.entries()) {
      if (s.words > 25) len(`step ${i + 1} has ${s.words} words, over the limit of 25.`);
    }
    if (id === 'quick-start') {
      if (p.steps.length > 8) len(`${p.steps.length} steps, over the limit of 8.`);
      if (p.words.total > 250) len(`${p.words.total} words in all, over the limit of 250.`);
      for (const s of p.sections) {
        if (s.id !== 'where-next') len(`More section "${s.title}" is not allowed (only "Where next").`);
      }
      for (const [i, s] of p.steps.entries()) {
        if (!s.shot) len(`step ${i + 1} has no picture (every step needs one).`);
      }
    } else {
      if (p.steps.length > 6) len(`${p.steps.length} steps, over the limit of 6.`);
      if (p.words.top > 120) len(`the top part has ${p.words.top} words, over the limit of 120.`);
      for (const s of p.sections) {
        if (p.words.sections[s.id] > 200) len(`More section "${s.title}" has ${p.words.sections[s.id]} words, over the limit of 200.`);
      }
    }

    // more titles
    for (const s of p.sections) {
      if (GENERIC_TITLES.includes(s.title.trim().toLowerCase())) add(id, 'more-title', `${where}: More section title "${s.title}" is too generic.`);
    }

    // tips
    for (const t of p.tips) {
      if (splitSentences(t.text).length > 1) add(id, 'tips', `${where}: a ${t.kind === 'tip' ? 'Tip' : 'Watch out'} has more than one sentence: "${t.text}"`);
    }
    const topTips = p.tips.filter((t) => t.where === 'top').length;
    if (topTips > 2) add(id, 'tips', `${where}: ${topTips} tips or warnings in the top part, over the limit of 2.`);

    // words
    const bare = [...sectionText(p).map((t) => plainText(t, { dropBold: true })), ...p.sections.map((s) => s.title), m.title].join('\n');
    const seen = new Set();
    for (const w of bare.match(BANNED) || []) {
      const key = w.toLowerCase();
      if (seen.has(key) || (key === 'mcp' && devOnlyPages.includes(id))) continue;
      seen.add(key);
      add(id, 'words', `${where}: uses the word "${w}", which the guide does not use.`);
    }
    for (const f of new Set(bare.match(FILE_NAME) || [])) {
      if (!f.endsWith('.vexiq.json')) add(id, 'words', `${where}: mentions the file name "${f}".`);
    }

    // tags (an empty topic list means the set carries no tags and is not checked)
    if (topicTags.length) {
      const known = new Set(topicTags);
      for (const t of m.tags) {
        if (!known.has(t)) add(id, 'tags', `${where}: tag "${t}" is not a topic tag (src/help/tags.js).`);
      }
      if (m.tags.length < 3 || m.tags.length > 10) add(id, 'tags', `${where}: has ${m.tags.length} topic tag(s) and needs 3 to 10.`);
    }

    // answers: labels must be situations
    const labels = new Set(situations.map((x) => x.id));
    for (const a of m.answers) {
      if (!labels.has(a)) add(id, 'answers', `${where}: answers label "${a}" is not a situation (src/help/tags.js).`);
    }
    for (const sec of p.sections) {
      for (const a of sec.answers) {
        if (!labels.has(a)) add(id, 'answers', `${where}, section "${sec.id}": answers label "${a}" is not a situation (src/help/tags.js).`);
      }
    }

    // dev-only
    if (devOnlyPages.includes(id) && !m.devOnly) add(id, 'dev-only', `${where}: is a developer page and needs "devOnly: true".`);
    if (!devOnlyPages.includes(id) && m.devOnly) add(id, 'dev-only', `${where}: has "devOnly: true" but is not a developer page.`);
  }

  // --- full-run rules
  if (!only) {
    // each situation is claimed once by a page header and once by a section (one of each is allowed)
    for (const { id: sit } of situations) {
      const pageClaims = checked.filter((id) => pages[id].meta.answers.includes(sit));
      const sectionClaims = checked.flatMap((id) => pages[id].sections.filter((x) => x.answers.includes(sit)).map((x) => `page "${id}" section "${x.id}"`));
      if (!pageClaims.length && !sectionClaims.length) add('answers', 'answers', `Situation "${sit}" is not claimed by any page or section.`);
      if (pageClaims.length > 1) add(pageClaims[1], 'answers', `Situation "${sit}" is claimed by two pages: "${pageClaims[0]}" and "${pageClaims[1]}".`);
      if (sectionClaims.length > 1) add('answers', 'answers', `Situation "${sit}" is claimed by two sections: ${sectionClaims[0]} and ${sectionClaims[1]}.`);
    }
    const total = shotFiles.reduce((a, f) => a + sizeOf(f.slice(0, -5)), 0);
    if (total > totalBytes) add('shots', 'shots-total', `All pictures together are ${total} bytes, over the limit of ${totalBytes} bytes.`);
    const used = new Set(Object.values(pages).filter(Boolean).flatMap((p) => p.shots.map((s) => s.name)));
    for (const f of shotFiles) {
      const name = f.slice(0, -5);
      if (!used.has(name) && !name.startsWith('fixture-')) add('shots', 'shot-unused', `Picture "${name}" (${f}) is not used by any page.`);
    }
    for (const name of Object.keys(shotsJson)) {
      if (!used.has(name) && !name.startsWith('fixture-')) add('shots', 'shot-unused', `shots.json entry "${name}" is not used by any page.`);
    }
  }

  // --- coverage
  let coverage = null;
  try {
    coverage = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  } catch { /* checked below */ }
  if (!Array.isArray(coverage)) {
    if (!only) add('coverage', 'coverage', `The coverage list ${coveragePath} is missing or is not a JSON array.`);
  } else {
    for (const e of coverage) {
      if (only && !only.includes(e.page)) continue;
      const label = `Coverage entry "${e.feature || e.name}"`;
      const p = listed.has(e.page) ? read(e.page) : null;
      if (!p) {
        if (!(listed.has(e.page) && !only)) add('coverage', 'coverage', `${label}: page "${e.page}" is not a page of the guide.`);
        continue;
      }
      let text;
      if (!e.section) text = p.top;
      else {
        const s = p.sections.find((x) => x.id === e.section);
        if (!s) {
          add(e.page, 'coverage', `${label}: page "${e.page}" has no section "${e.section}".`);
          continue;
        }
        text = s.body;
      }
      if (!plainText(text).toLowerCase().includes(String(e.name).toLowerCase())) {
        add(e.page, 'coverage', `${label}: page "${e.page}"${e.section ? ` section "${e.section}"` : ''} does not mention "${e.name}".`);
      }
    }
  }

  // --- the guide-wide lists
  const everything = (id) => sectionText(pages[id]).map((t) => plainText(t).toLowerCase()).join('\n');
  if (checked.includes('context-bar')) {
    const text = everything('context-bar');
    for (const label of barLabels) {
      if (!text.includes(label.toLowerCase())) add('context-bar', 'context-bar', `Page "context-bar" does not name the bar button "${label}".`);
    }
  }
  if (checked.includes('saving')) {
    const text = everything('saving');
    for (const name of starterNames) {
      if (!text.includes(name.toLowerCase())) add('saving', 'starters', `Page "saving" does not name the starter "${name}".`);
    }
  }

  return { problems, pages: Object.fromEntries(Object.entries(pages).filter(([, v]) => v)) };
}
