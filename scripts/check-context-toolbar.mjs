/**
 * Node check for src/utils/contextToolbarItems.js (which buttons the context bar shows).
 * Run: node scripts/check-context-toolbar.mjs   (exits 1 on any failure)
 */
import { barItems } from '../src/utils/contextToolbarItems.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const none = { count: 0, wholeGroup: false, stampable: false, locked: false, hidden: false, band: false };
const sel = (extra = {}) => ({ ...none, count: 1, ...extra });
const base = (extra = {}) => ({
  selection: none,
  transformMode: 'translate',
  locked: false,
  explode: false,
  playing: false,
  previewing: false,
  immersive: false,
  hasTarget: false,
  stepper: null,
  ...extra
});
const ids = (input) => barItems(input).map((i) => i.id);
const item = (input, id) => barItems(input).find((i) => i.id === id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => same([...a].sort(), [...b].sort());
const show = (a) => JSON.stringify(a);

// --- Normal bar ---------------------------------------------------------------------------------------
{
  const got = ids(base());
  check('nothing selected: Move, Rotate, Add to selection, Mark a hole only', same(got, ['move', 'rotate', 'addToSelection', 'markHole']), show(got));
}
{
  const got = ids(base({ selection: sel({ stampable: true }) }));
  const want = ['move', 'rotate', 'addToSelection', 'markHole', 'join', 'stampCopies', 'worldArrows', 'freeMove', 'growSelection', 'duplicate', 'delete'];
  check('0x2 Connector Pin, Move mode: the 11 buttons in order', same(got, want), show(got));
}
{
  const got = ids(base({ selection: sel({ stampable: false }) }));
  check('2x8 Beam (not stampable): no Stamp copies, but Join/World arrows/Duplicate/Delete', !got.includes('stampCopies') && ['join', 'worldArrows', 'duplicate', 'delete'].every((i) => got.includes(i)), show(got));
}
{
  const got = ids(base({ selection: sel({ stampable: true }), transformMode: 'rotate' }));
  const want = ['move', 'rotate', 'addToSelection', 'markHole', 'join', 'stampCopies', 'worldArrows', 'turnStep', 'growSelection', 'duplicate', 'delete'];
  check('Rotate mode: Turn step takes Free move\'s place', same(got, want) && !got.includes('freeMove'), show(got));
}
{
  const got = ids(base({ selection: sel({ count: 5, wholeGroup: true }) }));
  const want = ['move', 'rotate', 'addToSelection', 'markHole', 'join', 'freeMove', 'growSelection', 'onePartOfGroup', 'duplicate', 'delete'];
  check('whole group (5): One part of a group shown; no World arrows, no Stamp copies', same(got, want), show(got));
}
{
  const got = ids(base({ selection: sel({ count: 3 }) }));
  check('several parts, not a group: no One part of a group, no World arrows', !got.includes('onePartOfGroup') && !got.includes('worldArrows') && got.includes('delete'), show(got));
}
{
  const input = base({ selection: sel({ locked: true, stampable: true }) });
  const join = item(input, 'join');
  check('locked part: Join is disabled with "Part is locked"', !!join && join.state === 'disabled' && /Part is locked/.test(join.disabledReason || ''), show(join));
  check('locked part: no World arrows', !ids(input).includes('worldArrows'), show(ids(input)));
}
{
  const got = ids(base({ selection: sel({ hidden: true }) }));
  check('hidden part: no World arrows', !got.includes('worldArrows'), show(got));
}
{
  const input = base({ selection: sel({ band: true }) });
  const mv = item(input, 'move');
  const rot = item(input, 'rotate');
  const why = (x) => !!x && x.state === 'disabled' && /band/i.test(x.disabledReason || '') && /follow/i.test(x.disabledReason || '');
  check('strung band: Move and Rotate disabled, reason says a band follows its spots', why(mv) && why(rot), show([mv, rot]));
  check('strung band: no World arrows', !ids(input).includes('worldArrows'), show(ids(input)));
}
{
  const had = ids(base({ selection: sel({ stampable: true }) }));
  const got = ids(base({ selection: none }));
  const gone = ['worldArrows', 'freeMove', 'join', 'duplicate', 'delete'];
  check('selection cleared: World arrows, Free move, Join, Duplicate, Delete gone', gone.every((i) => had.includes(i) && !got.includes(i)), show(got));
}

// --- Hidden bar ---------------------------------------------------------------------------------------
{
  const s = sel({ stampable: true });
  for (const [name, flag] of [['Play', 'playing'], ['Explode', 'explode'], ['timeline preview', 'previewing'], ['Stereo full screen', 'immersive']]) {
    const got = barItems(base({ selection: s, [flag]: true }));
    check(`${name}: bar is hidden ([])`, Array.isArray(got) && got.length === 0, show(got));
  }
  const empty = barItems(base({ playing: true }));
  check('Play with nothing selected: still []', Array.isArray(empty) && empty.length === 0, show(empty));
}

// --- State and disabledReason -------------------------------------------------------------------------
{
  const input = base({ hasTarget: true });
  const mark = item(input, 'markHole');
  check('target marked: Mark a hole state is "set"', !!mark && mark.state === 'set', show(mark));
  const off = item(base(), 'markHole');
  check('no target: Mark a hole state is "off"', !!off && off.state === 'off', show(off));
}
{
  const m = base({ selection: sel() });
  const r = base({ selection: sel(), transformMode: 'rotate' });
  check('Move mode: move on, rotate off', item(m, 'move').state === 'on' && item(m, 'rotate').state === 'off', show([item(m, 'move'), item(m, 'rotate')]));
  check('Rotate mode: rotate on, move off', item(r, 'rotate').state === 'on' && item(r, 'move').state === 'off', show([item(r, 'move'), item(r, 'rotate')]));
}
{
  const all = [
    ...barItems(base()),
    ...barItems(base({ selection: sel({ locked: true }) })),
    ...barItems(base({ selection: sel({ band: true }) })),
    ...barItems(base({ selection: sel({ stampable: true }) }))
  ];
  const bad = all.filter((i) => (i.state === 'disabled') !== (typeof i.disabledReason === 'string' && i.disabledReason.length > 0) || (i.state !== 'disabled' && i.disabledReason !== null));
  check('disabledReason is a non-empty string only when disabled, otherwise null', all.length > 0 && bad.length === 0, show(bad));
}

// --- Wheel sessions -----------------------------------------------------------------------------------
const wheelOnly = ['wheel', 'stepUp', 'stepDown', 'commit', 'cancel', 'turnStep', 'worldArrows', 'pinsOnly'];
const st = (kind, extra = {}) => ({ kind, canStep: true, canCommit: true, hasCommit: true, hasCancel: true, ...extra });
const wheel = (kind, extra = {}, over = {}) => base({ selection: sel({ stampable: true }), stepper: st(kind, extra), ...over });
const step3 = ['wheel', 'stepUp', 'stepDown'];

{
  const got = ids(wheel('fits'));
  check('fits: wheel, steps, tick and cross; no extras', sameSet(got, [...step3, 'commit', 'cancel']), show(got));
  check('fits: normal buttons replaced (only wheel-bar ids)', got.every((i) => wheelOnly.includes(i)) && !got.includes('move') && !got.includes('join'), show(got));
}
{
  const got = ids(wheel('bendFits', { hasCancel: true }));
  check('bendFits: wheel, steps, tick and cross; no extras', sameSet(got, [...step3, 'commit', 'cancel']), show(got));
}
{
  const got = ids(wheel('ring', { hasCancel: false }));
  check('ring, single part: tick, turnStep, worldArrows, no cross', sameSet(got, [...step3, 'commit', 'turnStep', 'worldArrows']), show(got));
  const multi = ids(wheel('ring', { hasCancel: false }, { selection: sel({ count: 3 }) }));
  check('ring, several parts: turnStep but no worldArrows, no cross', sameSet(multi, [...step3, 'commit', 'turnStep']), show(multi));
  const locked = ids(wheel('ring', { hasCancel: false }, { selection: sel({ locked: true }) }));
  check('ring, single locked part: no worldArrows (arrows not showing)', !locked.includes('worldArrows'), show(locked));
}
{
  const got = ids(wheel('layers', { hasCancel: false }));
  check('layers: tick and pinsOnly, no cross', sameSet(got, [...step3, 'commit', 'pinsOnly']), show(got));
}
{
  const got = ids(wheel('band', { hasCancel: false }));
  check('band: tick only, no cross, no extras', sameSet(got, [...step3, 'commit']), show(got));
}
{
  const got = ids(wheel('arrows', { hasCommit: false, canStep: false }));
  check('arrows (mate arrows only): cancel only', same(got, ['cancel']), show(got));
}
{
  for (const kind of ['fits', 'bendFits', 'ring', 'layers', 'band']) {
    const got = ids(wheel(kind));
    const stray = got.filter((i) => !wheelOnly.includes(i));
    check(`${kind}: result holds only wheel-bar ids`, got.length > 0 && stray.length === 0, show(stray));
  }
}
{
  // No hole lit yet: nothing to step and nothing to put in
  const input = wheel('fits', { canStep: false, canCommit: false });
  const states = Object.fromEntries(barItems(input).map((i) => [i.id, i]));
  const dis = (id) => states[id] && states[id].state === 'disabled' && typeof states[id].disabledReason === 'string' && states[id].disabledReason.length > 0;
  check('fits, no hole lit: wheel, stepUp, stepDown, commit disabled with a reason', ['wheel', 'stepUp', 'stepDown', 'commit'].every(dis), show(states));
  check('fits, no hole lit: cancel stays enabled', !!states.cancel && states.cancel.state !== 'disabled', show(states.cancel));
  // A lit hole with only one fit: the wheel is greyed but the tick still puts the part in
  const one = Object.fromEntries(barItems(wheel('fits', { canStep: false, canCommit: true })).map((i) => [i.id, i]));
  check('fits, one fit: wheel greyed, tick enabled', one.wheel?.state === 'disabled' && one.commit && one.commit.state !== 'disabled', show(one));
  const ok = Object.fromEntries(barItems(wheel('fits')).map((i) => [i.id, i]));
  check('fits, canStep true: nothing disabled', Object.values(ok).every((i) => i.state !== 'disabled'), show(ok));
}
{
  const states = Object.fromEntries(barItems(wheel('layers', { canStep: false, hasCancel: false })).map((i) => [i.id, i]));
  const dis = (id) => states[id] && states[id].state === 'disabled' && !!states[id].disabledReason;
  check('layers, canStep false: wheel, stepUp, stepDown disabled', step3.every(dis), show(states));
}
{
  const got = barItems(wheel('fits', {}, { playing: true }));
  check('wheel session while Play: bar still hidden ([])', got.length === 0, show(got));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
