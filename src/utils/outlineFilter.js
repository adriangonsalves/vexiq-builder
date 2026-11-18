/**
 * The Outline's search and filter chips (openspec outline-filters-and-one-part-pick): which parts the
 * list shows. Pure (no React/DOM). Filters change only the list, never the build or the selection.
 */

/**
 * Electronics: Smart Motors, brains, batteries, sensors, radio, controller and cables. The library puts
 * motor shafts and motor support caps in the same category, so only its "VEX IQ ..." parts count.
 */
export const isElectronics = (meta) => Boolean(meta && meta.category === 'Electronics & Motion' && /^VEX IQ /.test(meta.name || ''));

/** No chip on: { electronics, locked, hidden: false, color: null }. */
export const NO_FILTERS = Object.freeze({ electronics: false, locked: false, hidden: false, color: null });

/** Whether any chip is on. */
export const filtersOn = (f = NO_FILTERS) => Boolean(f.electronics || f.locked || f.hidden || f.color);

const sameColor = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

/** Whether the search text matches the part: its label, catalog name or part number. */
export function searchMatches(inst, meta, query = '') {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (inst.label || '').toLowerCase().includes(q) || Boolean(meta && ((meta.name || '').toLowerCase().includes(q) || (meta.partNumber || '').toLowerCase().includes(q)));
}

/** Whether the part passes every chip that is on. */
export function chipsPass(inst, meta, f = NO_FILTERS) {
  if (f.electronics && !isElectronics(meta)) return false;
  if (f.locked && !inst.locked) return false;
  if (f.hidden && inst.visible !== false) return false;
  if (f.color && !sameColor(inst.color, f.color)) return false;
  return true;
}

/** Whether the part shows: it passes the chips and matches the search text. */
export const partPasses = (inst, meta, query, f) => chipsPass(inst, meta, f) && searchMatches(inst, meta, query);

/** The colours the build's parts use, most used first: [{ color, count }]. */
export function colorsInBuild(instances = []) {
  const counts = new Map();
  for (const inst of instances) {
    if (!inst.color) continue;
    const key = inst.color.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([color, count]) => ({ color, count })).sort((a, b) => b.count - a.count || a.color.localeCompare(b.color));
}

/**
 * Narrow Outline rows ({ kind: 'folder', group, listed } and { kind: 'part', inst, depth }, a folder's
 * open parts following it at depth 1) to what shows. With chips on, a folder stays only when one of its
 * parts passes, and lists only those; with just a search, a folder whose name matches keeps all its
 * parts, as before. `metaOf(inst)` gives the catalog entry; `byId` maps ids to parts.
 */
export function filterRows(rows, { query = '', filters = NO_FILTERS, metaOf, byId }) {
  const q = query.trim().toLowerCase();
  const chips = filtersOn(filters);
  if (!q && !chips) return rows;
  const passes = (inst) => partPasses(inst, metaOf(inst), query, filters);
  const out = [];
  let named = false; // the folder whose parts follow matched by name (search only)
  for (const row of rows) {
    if (row.kind === 'folder') {
      named = !chips && Boolean(q) && row.group.name.toLowerCase().includes(q);
      const anyPart = row.listed.some((id) => byId.get(id) && passes(byId.get(id)));
      if (named || anyPart) out.push(chips ? { ...row, listed: row.listed.filter((id) => byId.get(id) && passes(byId.get(id))) } : row);
    } else if (row.depth > 0) {
      if (named || passes(row.inst)) out.push(row);
    } else {
      named = false;
      if (passes(row.inst)) out.push(row);
    }
  }
  return out;
}

/**
 * The ids the list shows, in order, for Select shown: each part on its own (a closed folder's shown parts
 * where the folder is, an open folder's from its rows).
 */
export function shownIds(rows, openFolderIds = new Set()) {
  const ids = [];
  const seen = new Set();
  const add = (id) => {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  };
  for (const row of rows) {
    if (row.kind === 'folder') {
      if (!openFolderIds.has(row.group.id)) row.listed.forEach(add);
    } else add(row.inst.instanceId);
  }
  return ids;
}
