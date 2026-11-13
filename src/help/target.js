/**
 * Which help page to open for the situations helpContext() returned, and which pages are related
 * (openspec in-app-help, design.md section 12). Pure data in, ids and pages out.
 */

/**
 * pages: [{ id, meta: { answers }, sections: [{ id, answers }] }]; situations: ids, most specific first.
 * The first situation with a claimant wins; a section claim beats a page claim.
 * Returns { page: id, section: id | null, situation } or null.
 */
export function helpTarget(pages, situations) {
  for (const situation of situations) {
    for (const p of pages) {
      const s = (p.sections || []).find((x) => (x.answers || []).includes(situation));
      if (s) return { page: p.id, section: s.id, situation };
    }
    const p = pages.find((x) => ((x.meta && x.meta.answers) || []).includes(situation));
    if (p) return { page: p.id, section: null, situation };
  }
  return null;
}

/** Up to `max` other pages sharing topic tags with `page` (a page or its id), most shared first, ties in list order. */
export function relatedPages(pages, page, max = 3, { hasAssistant = false } = {}) {
  const id = page && typeof page === 'object' ? page.id : page;
  const mine = new Set((pages.find((p) => p.id === id) || page || { meta: {} }).meta.tags || []);
  return pages
    .filter((p) => p.id !== id && (hasAssistant || !p.meta.devOnly))
    .map((p, i) => ({ p, i, shared: (p.meta.tags || []).filter((t) => mine.has(t)).length }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.i - b.i)
    .slice(0, max)
    .map((x) => x.p);
}
