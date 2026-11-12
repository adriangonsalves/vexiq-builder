/**
 * Help search (openspec change in-app-help, design section 4): a small index over the guide's pages
 * and More sections, matched by word start. Pure, so it runs in the browser and in Node.
 */
import { plainText } from './renderPage.js';

const wordsOf = (s) => String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const starts = (words, q) => words.some((w) => w.startsWith(q));

/** pages: [{ id, ...parsePage(text) }] in guide order. */
export function buildIndex(pages) {
  const entries = [];
  for (const p of pages) {
    const titleWords = wordsOf(p.meta.title);
    const make = (section, sectionTitle, text) => ({
      page: p.id,
      section,
      sectionTitle,
      title: p.meta.title,
      titleWords,
      ownTitleWords: sectionTitle ? wordsOf(sectionTitle) : [],
      tagWords: p.meta.tags ? p.meta.tags.flatMap(wordsOf) : [],
      keywordWords: section ? [] : p.meta.keywords.flatMap(wordsOf),
      text,
      textWords: wordsOf(text)
    });
    entries.push(make(null, null, plainText(p.top)));
    for (const s of p.sections) entries.push(make(s.id, s.title, plainText(s.body)));
  }
  return { entries };
}

function snippetOf(text, queryWords) {
  const flat = text.replace(/\s+/g, ' ').trim();
  let at = -1;
  for (const m of flat.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (queryWords.some((q) => m[0].toLowerCase().startsWith(q))) {
      at = m.index;
      break;
    }
  }
  const from = at > 30 ? at - 30 : 0;
  const cut = flat.slice(from, from + 100).trim();
  return `${from > 0 ? '…' : ''}${cut}${from + 100 < flat.length ? '…' : ''}`;
}

/** [{ page, section, title, sectionTitle, snippet, score }], best first; equal scores keep index order. */
export function search(index, query) {
  const q = wordsOf(query);
  if (!q.length) return [];
  const results = [];
  for (const e of index.entries) {
    let score = 0;
    let ok = true;
    for (const w of q) {
      const inTitle = starts(e.titleWords, w);
      const inOwn = starts(e.ownTitleWords, w) || starts(e.keywordWords, w);
      const inText = e.textWords.filter((x) => x.startsWith(w)).length;
      if (!inTitle && !inOwn && !inText) {
        ok = false;
        break;
      }
      if (inTitle && !e.section) score += 100;
      if (inOwn) score += 30;
      if (starts(e.tagWords, w)) score += 5;
      score += inText;
    }
    if (ok) {
      results.push({ page: e.page, section: e.section, title: e.title, sectionTitle: e.sectionTitle, snippet: snippetOf(e.text, q), score });
    }
  }
  return results.sort((a, b) => b.score - a.score);
}
