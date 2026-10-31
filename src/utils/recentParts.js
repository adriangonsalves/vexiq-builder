// Recently used library parts: a score per part that rises with each use and fades with every add
// of any part, so both how often and how lately a part was used count. Kept per browser.
export const RECENT_KEY = 'vexiq.recentParts';
export const MAX_RECENT = 20;
export const DECAY = 0.9;

/** Entries `[{ id, score }]` after one more use of `partId`, best first, cut to MAX_RECENT. */
export function recordUse(entries, partId) {
  const prior = entries.find((e) => e.id === partId);
  const faded = entries
    .filter((e) => e.id !== partId)
    .map((e) => ({ id: e.id, score: e.score * DECAY }));
  const used = { id: partId, score: (prior ? prior.score * DECAY : 0) + 1 };
  // The used part goes in front, so it wins a tie (the sort is stable)
  return [used, ...faded].sort((a, b) => b.score - a.score).slice(0, MAX_RECENT);
}

/** The stored entries, or [] when nothing usable is stored. */
export function loadRecent(storage) {
  try {
    const data = JSON.parse(storage.getItem(RECENT_KEY) || 'null');
    if (!data || data.version !== 1 || !Array.isArray(data.entries)) return [];
    return data.entries
      .filter((e) => e && typeof e.id === 'string' && Number.isFinite(e.score))
      .map((e) => ({ id: e.id, score: e.score }))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function saveRecent(storage, entries) {
  try {
    storage.setItem(RECENT_KEY, JSON.stringify({ version: 1, entries }));
  } catch {
    // storage blocked or full: the list just isn't kept
  }
}
