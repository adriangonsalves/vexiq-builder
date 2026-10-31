/**
 * Node check for the recent-parts ranking and storage (src/utils/recentParts.js).
 * Run: node scripts/check-recent-parts.mjs   (exits 1 on any failure)
 */
import { MAX_RECENT, RECENT_KEY, loadRecent, recordUse, saveRecent } from '../src/utils/recentParts.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const ids = (entries) => entries.map((e) => e.id);
const run = (...parts) => parts.reduce((entries, id) => recordUse(entries, id), []);
const memory = (initial) => {
  const map = new Map(initial ? [[RECENT_KEY, initial]] : []);
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
};

check('five uses of A then one of B: A first', ids(run('A', 'A', 'A', 'A', 'A', 'B'))[0] === 'A', ids(run('A', 'A', 'A', 'A', 'A', 'B')).join());
check('A once then B once: B first', ids(run('A', 'B')).join() === 'B,A');

const others = Array.from({ length: 40 }, (_, i) => `P${i % 8}`);
const faded = ids(run('M', 'M', 'M', ...others));
check('three old uses then 40 adds of 8 other parts: M ranks below them', faded.indexOf('M') === -1 || faded.indexOf('M') > 7, faded.join());

const many = run(...Array.from({ length: 21 }, (_, i) => `Q${i}`));
check('21 different parts: 20 kept, the first one gone', many.length === MAX_RECENT && !ids(many).includes('Q0'), String(many.length));

check('bad JSON loads as []', loadRecent(memory('{nope')).length === 0);
check('wrong version loads as []', loadRecent(memory('{"version":2,"entries":[{"id":"A","score":1}]}')).length === 0);
check('throwing storage loads as []', loadRecent({ getItem() { throw new Error('blocked'); } }).length === 0);
let threw = false;
try { saveRecent({ setItem() { throw new Error('full'); } }, run('A')); } catch { threw = true; }
check('saving to a throwing storage does not throw', !threw);

const store = memory();
saveRecent(store, run('A', 'B', 'B'));
check('save then load round-trips', ids(loadRecent(store)).join() === 'B,A', ids(loadRecent(store)).join());

process.exit(failures ? 1 : 0);
