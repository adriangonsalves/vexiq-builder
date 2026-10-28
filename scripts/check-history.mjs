/**
 * Node check for src/utils/buildHistory.js (build history: steps, undo/redo, branches, files).
 * Run: node scripts/check-history.mjs   (exits 1 on any failure)
 */
import {
  applyOps,
  branchesAt,
  createHistory,
  currentLine,
  diffParts,
  fromLegacy,
  headPosition,
  loadHistory,
  mergeBrowserSave,
  matchesParts,
  moveTo,
  recordStep,
  redo,
  replay,
  summarize,
  undo,
  withExportStep
} from '../src/utils/buildHistory.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

let nextId = 0;
const makePart = (label, extra = {}) => ({
  instanceId: `p${(nextId += 1)}`,
  partId: 'beam',
  label,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  color: '#64748b',
  visible: true,
  locked: false,
  isIntersecting: false,
  lastValidPosition: null,
  lastValidRotation: null,
  ...extra
});
const ids = (parts) => parts.map((p) => p.instanceId).join(',');

// A tiny "app": parts + history, every change recorded like commitBuild does
const session = () => {
  const s = { parts: [], history: createHistory(), at: 1_000_000 };
  s.commit = (next, meta = {}) => {
    s.at += meta.dt ?? 5000;
    const r = recordStep(s.history, s.parts, next, { at: s.at, ...meta });
    s.history = r.history;
    s.parts = next;
    return r;
  };
  s.undo = (n) => {
    const r = undo(s.history, s.parts, n);
    if (r) Object.assign(s, { history: r.history, parts: r.parts });
    return r;
  };
  s.redo = (n) => {
    const r = redo(s.history, s.parts, n);
    if (r) Object.assign(s, { history: r.history, parts: r.parts });
    return r;
  };
  return s;
};

// --- 1.1 diffParts --------------------------------------------------------------------------------
{
  const a = makePart('A');
  const b = makePart('B');
  check('diff: same list gives no ops', diffParts([a, b], [a, b]).length === 0);
  check(
    'diff: isIntersecting-only change gives no ops',
    diffParts([a], [{ ...a, isIntersecting: true, lastValidPosition: [1, 2, 3] }]).length === 0
  );
  check('diff: missing visible/locked equal the defaults', diffParts([a], [{ ...a, visible: undefined, locked: undefined }]).length === 0);
  const c = makePart('C');
  const d = makePart('D');
  const e = makePart('E');
  const addOps = diffParts([a], [a, c, d, e]);
  check(
    'diff: 3 added parts keep list order',
    addOps.length === 3 && addOps.every((o) => o.op === 'add') && addOps.map((o) => o.part.label).join('') === 'CDE',
    JSON.stringify(addOps.map((o) => [o.op, o.part?.label, o.index]))
  );
  check('diff: adds replay to the after list', ids(applyOps([a], addOps)) === ids([a, c, d, e]));
  const removeOps = diffParts([a, b, c], [a, c]);
  check(
    'diff: a removed part keeps its index',
    removeOps.length === 1 && removeOps[0].op === 'remove' && removeOps[0].index === 1 && removeOps[0].part.label === 'B'
  );
  const moved = { ...b, position: [12.7, 0, 0], color: '#ffffff' };
  const updateOps = diffParts([a, b], [a, moved]);
  check(
    'diff: update holds only changed fields, before and after',
    updateOps.length === 1 &&
      updateOps[0].op === 'update' &&
      Object.keys(updateOps[0].after).sort().join() === 'color,position' &&
      updateOps[0].before.position[0] === 0
  );
  check('diff: reorder detected', diffParts([a, b], [b, a]).some((o) => o.op === 'reorder'));
}

// --- Linear history (the app's default History setting) --------------------------------------------
{
  const s = session();
  const A = makePart('A');
  const B = makePart('B');
  const C = makePart('C');
  const D = makePart('D');
  s.commit([A], { linear: true });
  s.commit([A, B], { linear: true });
  s.commit([A, B, C], { linear: true });
  s.undo(3);
  s.redo(2);
  check('linear: undo three, redo two gives A,B', ids(s.parts) === ids([A, B]));
  s.redo();
  check('linear: one more redo brings C back', ids(s.parts) === ids([A, B, C]));
  s.undo(2);
  const r = s.commit([A, D], { linear: true });
  check('linear: undo twice then add gives A,D', ids(s.parts) === ids([A, D]));
  check('linear: B and C are no longer in the history', s.history.steps.length === 2 && !r.branched, JSON.stringify(s.history.steps.map((x) => x.label)));
  check('linear: redo is unavailable', redo(s.history, s.parts) === null && headPosition(s.history).currentStep === headPosition(s.history).totalSteps);
  check('linear: no branch is left behind', branchesAt(s.history, s.history.steps[0].id).length <= 1);
  check('linear: the history replays to the parts', ids(replay(s.history)) === ids([A, D]));
}

// --- 1.2 history tree -----------------------------------------------------------------------------
{
  const s = session();
  const A = makePart('A');
  const B = makePart('B');
  const C = makePart('C');
  const D = makePart('D');
  s.commit([A]);
  s.commit([A, B]);
  s.commit([A, B, C]);
  s.undo();
  s.undo();
  const r = s.commit([A, D]);
  check('branch: undo twice then add gives A,D', ids(s.parts) === ids([A, D]));
  check('branch: recordStep reports the new branch', r.branched === true);
  check('branch: all 4 steps are kept', s.history.steps.length === 4);
  const firstStep = s.history.steps[0].id;
  const branches = branchesAt(s.history, firstStep);
  check('branch: 2 branches after step 1', branches.length === 2, JSON.stringify(branches));
  const old = branches.find((b) => b.label.includes('B'));
  const back = moveTo(s.history, s.parts, old.leafId);
  check('branch: moving to the old branch gives A,B,C', ids(back.parts) === ids([A, B, C]));
  check('branch: replay agrees with moveTo', ids(replay(back.history)) === ids([A, B, C]));
  check('branch: current line follows the moved-to branch', currentLine(back.history).length === 3);

  // redo follows the most recently used branch
  const s2 = { ...s, history: back.history, parts: back.parts };
  const u = undo(s2.history, s2.parts, 2);
  const rd = redo(u.history, u.parts, 2);
  check('redo: follows the most recently used branch', ids(rd.parts) === ids([A, B, C]), ids(rd.parts));
  check('redo: refuses at the end of the line', redo(rd.history, rd.parts) === null);
  check('undo: refuses at the start', undo(createHistory(), []) === null);
}
{
  const s = session();
  const parts = [];
  for (let i = 0; i < 500; i += 1) {
    const p = makePart(`P${i}`);
    parts.push(p);
    s.commit([...s.parts, p]);
    if (i % 3 === 0) s.commit(s.parts.map((q) => (q.instanceId === p.instanceId ? { ...q, position: [i, 1, 2] } : q)));
  }
  const steps = s.history.steps.length;
  const t0 = Date.now();
  const back = undo(s.history, s.parts, steps);
  check(`undo: ${steps} steps back gives the base parts`, back && back.parts.length === 0);
  const fwd = redo(back.history, back.parts, steps);
  check(
    'redo: all the way forward gives the same build',
    diffParts(fwd.parts, s.parts).length === 0 && headPosition(fwd.history).currentStep === steps
  );
  check(`undo/redo ${steps} steps under 1 s`, Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
}
{
  const s = session();
  const P = makePart('Beam', { color: '#111111', position: [1, 2, 3], rotation: [0, 90, 0] });
  const Q = makePart('Other');
  s.commit([P, Q]);
  s.commit([Q], { label: 'Delete Beam' });
  s.undo();
  const back = s.parts[0];
  check(
    'undo delete: part back at its index with id, label, color and pose',
    back.instanceId === P.instanceId &&
      back.label === 'Beam' &&
      back.color === '#111111' &&
      back.position.join() === '1,2,3' &&
      back.rotation.join() === '0,90,0'
  );
}
{
  // Typing "63.5" in a field: 4 edits within 1 s merge into one step
  const s = session();
  const P = makePart('Beam');
  s.commit([P]);
  for (const x of [6, 63, 63, 63.5]) {
    s.commit(s.parts.map((q) => ({ ...q, position: [x, 0, 0] })), { mergeKey: `pos:${P.instanceId}`, dt: 200 });
  }
  check('merge: field edits within 1 s are one step', s.history.steps.length === 2, `${s.history.steps.length} steps`);
  check('merge: merged step goes from the start value to the last', s.history.steps[1].ops[0].after.position[0] === 63.5 && s.history.steps[1].ops[0].before.position[0] === 0);
  s.commit(s.parts.map((q) => ({ ...q, position: [70, 0, 0] })), { mergeKey: `pos:${P.instanceId}`, dt: 1500 });
  check('merge: a pause over 1 s starts a new step', s.history.steps.length === 3);
  s.commit(s.parts.map((q) => ({ ...q, position: [63.5, 0, 0] })), { mergeKey: `pos:${P.instanceId}`, dt: 100 });
  check('merge: editing back to the start value drops the step', s.history.steps.length === 2);
  s.commit(s.parts.map((q) => ({ ...q, isIntersecting: true })));
  check('no step for an overlap-flag-only change', s.history.steps.length === 2);
}

// --- 1.3 labels and files -------------------------------------------------------------------------
{
  const many = Array.from({ length: 72 }, (_, i) => makePart(`P${i}`));
  check('summarize: 72 adds', summarize(diffParts([], many)) === '72 parts');
  const brain = makePart('Robot Brain');
  const brainMoved = { ...brain, position: [0, 61.9, 0] };
  check('summarize: move one part', summarize(diffParts([brain], [brainMoved])) === 'move Robot Brain', summarize(diffParts([brain], [brainMoved])));
  const pin = makePart('Left Motor Pin 3');
  check('summarize: remove one part (mcp)', summarize(diffParts([pin], [])) === 'Left Motor Pin 3');
  check('summarize: app style delete', summarize(diffParts([pin], []), { style: 'app' }) === 'Delete Left Motor Pin 3');
  check('summarize: app style hide', summarize(diffParts([pin], [{ ...pin, visible: false }]), { style: 'app' }) === 'Hide Left Motor Pin 3');

  const legacyParts = Array.from({ length: 65 }, (_, i) => makePart(`L${i}`));
  const legacy = fromLegacy(legacyParts);
  check('legacy: one "Starting assembly" step', legacy.steps.length === 1 && legacy.steps[0].label === 'Starting assembly');
  check('legacy: replays to the 65 parts', matchesParts(legacy, legacyParts));
  const emptied = undo(legacy, legacyParts);
  check('legacy: undo empties the build', emptied.parts.length === 0);
  check('legacy: no parts gives an empty history', fromLegacy([]).steps.length === 0);

  const overlapping = { ...legacyParts[3], isIntersecting: true };
  const live = [...legacyParts.slice(0, 3), overlapping, ...legacyParts.slice(4)];
  const kept = live.filter((p) => !p.isIntersecting);
  const saved = withExportStep(legacy, live, kept);
  check('export: extra step when overlapping parts are left out', saved.steps.length === 2 && saved.steps[1].label === 'Leave out overlapping parts');
  check('export: replaying the saved history gives exactly the saved parts', matchesParts(saved, kept));
  check('export: no extra step when nothing is left out', withExportStep(legacy, legacyParts, legacyParts).steps.length === 1);

  const roundTrip = JSON.parse(JSON.stringify(saved));
  check('load: a saved history that matches its parts is used', loadHistory(roundTrip, kept) === roundTrip);
  const reconciled = loadHistory(roundTrip, legacyParts);
  check(
    'load: a history that does not match its parts gets an "External change" step',
    reconciled.steps.length === 3 && reconciled.steps[2].label === 'External change' && matchesParts(reconciled, legacyParts)
  );
  check('load: no history gives one starting step', loadHistory(undefined, legacyParts).steps.length === 1);
}

// --- 3.1 bridge save rule -------------------------------------------------------------------------
{
  const A = makePart('A');
  const B = makePart('B');
  const h1 = fromLegacy([A]);
  const saved = { instances: [A], history: h1, historyRev: h1.rev };
  const keep = mergeBrowserSave(saved, { instances: [A], selectedId: A.instanceId, baseHistoryRev: h1.rev });
  check('bridge: a POST without history keeps the saved history', !keep.conflict && keep.state.history === h1 && keep.state.selectedId === A.instanceId && !('baseHistoryRev' in keep.state));
  const h2 = recordStep(h1, [A], [A, B]).history;
  const ok = mergeBrowserSave(saved, { instances: [A, B], history: h2, baseHistoryRev: h1.rev });
  check('bridge: a POST built on the saved rev is saved with its history', !ok.conflict && ok.state.history === h2 && ok.state.historyRev === h2.rev);
  const mcpMoved = { instances: [A, B], history: h2, historyRev: h2.rev };
  const stale = mergeBrowserSave(mcpMoved, { instances: [A], selectedId: null, baseHistoryRev: h1.rev });
  check('bridge: a stale POST (MCP step landed in between) is refused with the saved state', stale.conflict && stale.state === mcpMoved);
  const legacy = mergeBrowserSave(null, { instances: [A] });
  check('bridge: nothing saved yet and no history: saved as sent', !legacy.conflict && legacy.state.instances.length === 1);
}

console.log(failures === 0 ? '\nAll history checks passed.' : `\n${failures} history check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
