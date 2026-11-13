/**
 * Help pages: read the Markdown file format and turn it into HTML (openspec change in-app-help,
 * design section 2). Pure: runs in the browser and in plain Node, so the Help panel and
 * scripts/check-help.mjs agree about what a page contains.
 */
import { Marked } from 'marked';

/** Section id from a heading: "If the chain sags" -> "if-the-chain-sags". */
export const sectionId = (title) => String(title)
  .toLowerCase()
  .replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

// ---------------------------------------------------------------------------------------------------
// Plain text, blocks and sentences
// ---------------------------------------------------------------------------------------------------
const PICTURE = /!\[([^\]]*)\]\(shot:([^)\s]*)\)/g;
const ANY_PICTURE = /!\[[^\]]*\]\([^)]*\)/g;
const MARKER = /(^|\s)\((\d{1,2})\)(?=[\s.,;:!?]|$)/g;
const WORDING = /\{\{([^}]*)\}\}/g;
const countWords = (s) => s.split(/\s+/).filter(Boolean).length;

/** Split the inside of {{a | b}} at the first bar. */
function wordings(inner) {
  const i = inner.indexOf('|');
  return i < 0 ? [inner.trim(), inner.trim()] : [inner.slice(0, i).trim(), inner.slice(i + 1).trim()];
}

/**
 * Plain text of one piece of Markdown. `both` keeps both wordings of {{a | b}}; otherwise the one with
 * more words. `dropBold` leaves out text inside **bold**.
 */
function plain(md, { both = false, dropBold = false } = {}) {
  let s = md.replace(ANY_PICTURE, ' ');
  s = s.replace(WORDING, (_, inner) => {
    const [a, b] = wordings(inner);
    if (both) return `${a} ${b}`;
    return countWords(b) > countWords(a) ? b : a;
  });
  if (dropBold) s = s.replace(/\*\*[^*]*\*\*/g, ' ');
  s = s.replace(/\[\[([^\]]*)\]\]/g, (_, n) => n.trim());
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(MARKER, (m, lead) => (lead ? ' ' : '')).replace(/\s+([.,;:!?])/g, '$1');
  s = s.replace(/[*`]/g, '');
  s = s.replace(/(^|[\s(])_+(?=\S)|(?<=\S)_+(?=[\s.,;:!?)]|$)/g, '$1');
  return s.replace(/\s+/g, ' ').trim();
}

const ITEM_START = /^(\s*)(\d+[.)]|[-*+])\s+(.*)$/;
const ORDERED_START = /^\d+[.)]\s+/;

/** Paragraph, list item and quote blocks of a part, raw (no list number or `>`); headings dropped. */
function blocksOf(text) {
  const blocks = [];
  let cur = null;
  const flush = () => {
    if (cur) blocks.push({ kind: cur.kind, raw: cur.lines.join(' ') });
    cur = null;
  };
  for (const line of text.split('\n')) {
    let m;
    if (!line.trim()) flush();
    else if (/^\s{0,3}#{1,6}\s/.test(line)) flush();
    else if ((m = line.match(ITEM_START))) {
      flush();
      cur = { kind: 'item', lines: [m[3]] };
    } else if ((m = line.match(/^\s{0,3}>\s?(.*)$/))) {
      if (cur && cur.kind === 'quote') cur.lines.push(m[1]);
      else {
        flush();
        cur = { kind: 'quote', lines: [m[1]] };
      }
    } else if (cur) cur.lines.push(line.trim());
    else cur = { kind: 'para', lines: [line.trim()] };
  }
  flush();
  return blocks;
}

/** Sentences of a piece of plain text: split after . ! or ? followed by a space or the end. */
export const splitSentences = (s) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

/**
 * Plain text of Markdown for the checks: one line per paragraph / list item / quote, pictures and
 * markers left out. Options as for `plain`; both wordings are kept unless `both: false`.
 */
export function plainText(md, { both = true, dropBold = false } = {}) {
  return blocksOf(md).map((b) => plain(b.raw, { both, dropBold })).filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------------------------------
// parsePage
// ---------------------------------------------------------------------------------------------------
function readHeader(text) {
  const lines = text.split('\n');
  const meta = { title: '', group: '', order: NaN, summary: '', icon: '', keywords: [], tags: [], answers: [], devOnly: false };
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (lines[i] === undefined || lines[i].trim() !== '---') return { meta, body: text };
  let end = i + 1;
  while (end < lines.length && lines[end].trim() !== '---') end += 1;
  for (let k = i + 1; k < end; k += 1) {
    const m = lines[k].match(/^([A-Za-z]+)\s*:(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].replace(/(^|\s)#.*$/, '').trim();
    if (key === 'order') meta.order = value === '' ? NaN : Number(value);
    else if (key === 'keywords' || key === 'tags' || key === 'answers') meta[key] = value.split(',').map((x) => x.trim()).filter(Boolean);
    else if (key === 'devOnly') meta.devOnly = value === 'true';
    else if (key in meta) meta[key] = value;
  }
  return { meta, body: lines.slice(end + 1).join('\n') };
}

/** Top-level list items of a part as line ranges: [{ start, end, ordered }] (end excludes trailing blank lines). */
function listItems(lines) {
  const items = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^(\d+[.)]|[-*+])\s+/);
    if (!m) {
      i += 1;
      continue;
    }
    let end = i;
    let j = i + 1;
    while (j < lines.length) {
      if (/^\s+\S/.test(lines[j])) {
        end = j;
        j += 1;
      } else if (!lines[j].trim()) {
        let k = j;
        while (k < lines.length && !lines[k].trim()) k += 1;
        if (k < lines.length && /^\s+\S/.test(lines[k])) j = k;
        else break;
      } else break;
    }
    items.push({ start: i, end, ordered: ORDERED_START.test(lines[i]) });
    i = end + 1;
  }
  return items;
}

/** Pictures in a part with their position: [{ name, alt, line, col }]. */
function picturesIn(lines) {
  const out = [];
  lines.forEach((line, l) => {
    for (const m of line.matchAll(PICTURE)) out.push({ name: m[2], alt: m[1], line: l, col: m.index });
  });
  return out;
}

/** The markers of a part: [{ n, line, col }] (pictures masked so their description is skipped). */
function markersIn(lines) {
  const out = [];
  lines.forEach((line, l) => {
    const masked = line.replace(ANY_PICTURE, (x) => ' '.repeat(x.length));
    for (const m of masked.matchAll(MARKER)) out.push({ n: Number(m[2]), line: l, col: m.index + m[1].length });
  });
  return out;
}

export function parsePage(source) {
  const text = String(source).replace(/\r\n?/g, '\n');
  const { meta, body } = readHeader(text);
  const more = body.match(/^<!--\s*more\s*-->[ \t]*$/m);
  const top = (more ? body.slice(0, more.index) : body).trim();
  const sections = [];
  if (more) {
    const rest = body.slice(more.index + more[0].length).split('\n');
    let cur = null;
    for (const line of rest) {
      const h = line.match(/^##\s+(.+?)\s*#*\s*$/);
      if (h && !line.startsWith('###')) {
        cur = { id: sectionId(h[1]), title: h[1].trim(), answers: [], lines: [] };
        sections.push(cur);
      } else if (cur) {
        const a = !cur.lines.length && line.match(/^<!--\s*answers\s*:(.*?)-->\s*$/);
        if (a) cur.answers = a[1].split(',').map((x) => x.trim()).filter(Boolean);
        else cur.lines.push(line);
      }
    }
    sections.forEach((s) => {
      s.body = s.lines.join('\n').trim();
      delete s.lines;
    });
  }

  const parts = [{ where: 'top', text: top }, ...sections.map((s) => ({ where: s.id, text: s.body }))];
  const shots = [];
  const links = [];
  const controls = [];
  const markers = [];
  const tips = [];
  const sentences = [];
  const words = { opening: 0, top: 0, sections: {}, total: 0 };
  let opening = '';
  let steps = [];

  for (const part of parts) {
    const lines = part.text.split('\n');
    const pics = picturesIn(lines);
    pics.forEach((p) => shots.push({ name: p.name, alt: p.alt, where: part.where }));
    for (const m of part.text.matchAll(/(?<!!)\[([^\]]*)\]\(help:([^)#\s]+)(?:#([^)\s]+))?\)/g)) {
      links.push({ page: m[2], section: m[3] || null, text: m[1], where: part.where });
    }
    for (const m of part.text.matchAll(/\[\[([^\]]+)\]\]/g)) controls.push({ name: m[1].trim(), where: part.where });

    const items = listItems(lines);
    for (const mk of markersIn(lines)) {
      const item = items.find((it) => mk.line >= it.start && mk.line <= it.end);
      let pic = item && pics.find((p) => p.line >= item.start && p.line <= item.end);
      if (!pic) pic = pics.find((p) => p.line > mk.line || (p.line === mk.line && p.col > mk.col));
      markers.push({ n: mk.n, shot: pic ? pic.name : null, where: part.where });
    }

    const blocks = blocksOf(part.text);
    let total = 0;
    for (const b of blocks) {
      const t = plain(b.raw);
      const n = countWords(t);
      total += n;
      for (const s of splitSentences(t)) sentences.push({ text: s, words: countWords(s), where: part.where });
      const tip = b.kind === 'quote' && b.raw.match(/^\*\*(Tip|Watch out)\*\*\s*(.*)$/);
      if (tip) tips.push({ kind: tip[1] === 'Tip' ? 'tip' : 'warning', text: plain(tip[2]), where: part.where });
    }
    if (part.where === 'top') {
      words.top = total;
      const first = blocks.find((b) => b.kind === 'para');
      opening = first ? plain(first.raw) : '';
      words.opening = countWords(opening);

      const firstOrdered = items.findIndex((it) => it.ordered);
      if (firstOrdered >= 0) {
        const group = [items[firstOrdered]];
        for (let k = firstOrdered + 1; k < items.length; k += 1) {
          const prev = group[group.length - 1];
          const gap = lines.slice(prev.end + 1, items[k].start);
          if (!items[k].ordered || gap.some((g) => g.trim())) break;
          group.push(items[k]);
        }
        steps = group.map((it) => {
          const raw = lines.slice(it.start, it.end + 1).join('\n');
          const t = plain(raw.replace(ORDERED_START, ''));
          const pic = pics.find((p) => p.line >= it.start && p.line <= it.end);
          return {
            text: t,
            words: countWords(t),
            markers: markersIn(lines.slice(it.start, it.end + 1)).map((m) => m.n),
            shot: pic ? pic.name : null
          };
        });
      }
    } else words.sections[part.where] = total;
  }
  words.total = words.top + Object.values(words.sections).reduce((a, b) => a + b, 0);

  return { meta, top, sections, opening, steps, shots, links, controls, markers, tips, sentences, words };
}

// ---------------------------------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (f) => `${Math.round(f * 10000) / 100}%`;

// The options of the call being rendered (rendering is synchronous, so one slot is enough).
let ctx = { input: 'mouse', shots: {}, base: '/' };

function figure(href, alt) {
  const name = href.slice('shot:'.length);
  const info = ctx.shots[name];
  const size = info && info.w && info.h ? ` width="${info.w}" height="${info.h}"` : '';
  const marks = info && info.marks
    ? info.marks.map((m) => `<span class="help-mark" style="left:${pct(m.x)};top:${pct(m.y)}">${m.n}</span>`).join('')
    : '';
  return `<figure class="help-shot" data-shot="${esc(name)}"><img src="${esc(`${ctx.base}help/shots/${name}.webp`)}" alt="${esc(alt)}" loading="lazy"${size}>${marks}</figure>`;
}

const marked = new Marked({
  gfm: true,
  renderer: {
    codespan: ({ text }) => `<kbd class="help-key">${esc(text)}</kbd>`,
    image({ href, text }) {
      if (href && href.startsWith('shot:')) return figure(href, text);
      return false;
    },
    paragraph({ tokens }) {
      // a picture on its own line is a figure, not a paragraph
      const only = tokens.length === 1 && tokens[0].type === 'image' && String(tokens[0].href).startsWith('shot:');
      return only ? `${this.parser.parseInline(tokens)}\n` : false;
    },
    link({ href, tokens }) {
      const m = String(href).match(/^help:([^#]+)(?:#(.+))?$/);
      if (!m) return false;
      const text = this.parser.parseInline(tokens);
      const sec = m[2] ? ` data-help-section="${esc(m[2])}"` : '';
      return `<a href="#help/${esc(m[1])}${m[2] ? `/${esc(m[2])}` : ''}" data-help-page="${esc(m[1])}"${sec}>${text}</a>`;
    },
    blockquote({ tokens }) {
      const first = tokens[0];
      const label = first && first.type === 'paragraph' && first.tokens[0] && first.tokens[0].type === 'strong'
        ? first.tokens[0].text : '';
      const cls = label === 'Tip' ? 'help-tip' : label === 'Watch out' ? 'help-warn' : null;
      if (!cls) return false;
      return `<div class="${cls}" role="note">${this.parser.parse(tokens)}</div>\n`;
    }
  },
  extensions: [
    {
      name: 'helpChip',
      level: 'inline',
      start: (src) => src.indexOf('[['),
      tokenizer(src) {
        const m = src.match(/^\[\[([^\]]+)\]\]/);
        return m ? { type: 'helpChip', raw: m[0], name: m[1].trim() } : undefined;
      },
      renderer: (t) => `<button type="button" class="help-chip" data-control="${esc(t.name)}">${esc(t.name)}</button>`
    },
    {
      name: 'helpBadge',
      level: 'inline',
      start(src) {
        const re = /\(\d{1,2}\)(?=[\s.,;:!?]|$)/g;
        for (let m = re.exec(src); m; m = re.exec(src)) {
          if (m.index === 0 || /\s/.test(src[m.index - 1])) return m.index;
        }
        return undefined;
      },
      tokenizer(src) {
        const m = src.match(/^\((\d{1,2})\)(?=[\s.,;:!?]|$)/);
        return m ? { type: 'helpBadge', raw: m[0], n: m[1] } : undefined;
      },
      renderer: (t) => `<span class="help-badge">${t.n}</span>`
    }
  ]
});

/** Markdown to HTML, with the page extras. `{{mouse | touch}}` shows the wording for `input`. */
export function renderMarkdown(markdown, { input = 'mouse', shots = {}, base = '/' } = {}) {
  const pick = input === 'touch' ? 1 : 0;
  const src = String(markdown).replace(WORDING, (_, inner) => wordings(inner)[pick]);
  const saved = ctx;
  ctx = { input, shots, base };
  try {
    return marked.parse(src, { async: false });
  } finally {
    ctx = saved;
  }
}

/** A parsed page as HTML: the top part, then each More section in a closed details element. */
export function renderPage(parsed, options = {}) {
  const more = parsed.sections.map((s) => (
    `<details class="help-more" id="help-sec-${esc(s.id)}" data-section="${esc(s.id)}"><summary><h2>${esc(s.title)}</h2></summary>${renderMarkdown(s.body, options)}</details>`
  ));
  return [renderMarkdown(parsed.top, options), ...more].join('\n');
}
