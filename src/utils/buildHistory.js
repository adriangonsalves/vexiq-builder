/**
 * Build history: every change to the assembly's parts is a step of reversible ops, kept in a tree
 * so undoing and then editing starts a branch instead of throwing steps away.
 * Pure (no React/DOM/Node) so the browser, the MCP server and the Vite bridge share one format.
 *
 * history = {
 *   version: 1,
 *   base: [],                                   // parts before the first step
 *   steps: [{ id, parentId, at, source, label, mergeKey?, ops }],   // creation order
 *   headId,                                     // current step (null = before the first step)
 *   activeChild: { [stepId | 'root']: childId }, // the branch redo follows
 *   rev                                         // bumped on every step or head move
 * }
 *
 * ops (applied forward in this order; prefixes are used for part-by-part playback):
 *   { op: 'remove', index, part }               // index in the list before the step
 *   { op: 'add', index, part }                  // index in the list after the step
 *   { op: 'update', id, name, before: {...}, after: {...} }   // build fields only; name = label after
 *   { op: 'reorder', beforeIds, afterIds }      // only when kept parts change order
 */

export const HISTORY_VERSION = 1;
export const ROOT = 'root';
export const MERGE_WINDOW_MS = 1000;
// Fields that make up the build. isIntersecting / lastValid* are bookkeeping the viewport recomputes.
// socketAngleDeg: a Smart Motor's drive hub angle (openspec square-shaft-fit)
// groupId / groupName: the part's group (openspec outliner-part-groups); missing = no group
export const BUILD_FIELDS = ['position', 'rotation', 'color', 'label', 'visible', 'locked', 'socketAngleDeg', 'groupId', 'groupName'];
const GROUP_FIELDS = new Set(['groupId', 'groupName']);
export const SOURCES = ['app', 'mcp', 'assistant', 'action'];

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// Missing visible/locked mean the defaults, so parts placed by different writers compare equal
const normalizeField = (field, value) => {
  if (field === 'visible') return value !== false;
  if (field === 'locked') return value === true;
  if (field === 'socketAngleDeg') return Number(value) || 0;
  if (GROUP_FIELDS.has(field)) return value || null;
  return value;
};

const sameValue = (a, b) => {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => Number(v) === Number(b[i]));
  }
  return a === b;
};

const sameField = (field, a, b) => sameValue(normalizeField(field, a), normalizeField(field, b));

export function createHistory(base = []) {
  return { version: HISTORY_VERSION, base: clone(base), steps: [], headId: null, activeChild: {}, rev: 0 };
}

export function isHistory(value) {
  return Boolean(
    value &&
      value.version === HISTORY_VERSION &&
      Array.isArray(value.base) &&
      Array.isArray(value.steps) &&
      value.activeChild &&
      typeof value.activeChild === 'object'
  );
}

/** Ops that turn `before` into `after`. Empty when every part's build fields are unchanged. */
export function diffParts(before = [], after = []) {
  const beforeIds = new Map(before.map((p, i) => [p.instanceId, i]));
  const afterIds = new Map(after.map((p, i) => [p.instanceId, i]));
  const ops = [];

  before.forEach((part, index) => {
    if (!afterIds.has(part.instanceId)) ops.push({ op: 'remove', index, part: clone(part) });
  });
  after.forEach((part, index) => {
    if (!beforeIds.has(part.instanceId)) ops.push({ op: 'add', index, part: clone(part) });
  });
  after.forEach((part) => {
    if (!beforeIds.has(part.instanceId)) return;
    const prev = before[beforeIds.get(part.instanceId)];
    const fieldsBefore = {};
    const fieldsAfter = {};
    for (const field of BUILD_FIELDS) {
      if (!sameField(field, prev[field], part[field])) {
        // A missing hub angle means 0 and a missing group null; recorded that way so the value survives saving (JSON drops undefined)
        const stored = (value) => (field === 'socketAngleDeg' || GROUP_FIELDS.has(field) ? normalizeField(field, value) : value);
        fieldsBefore[field] = clone(stored(prev[field]));
        fieldsAfter[field] = clone(stored(part[field]));
      }
    }
    if (Object.keys(fieldsAfter).length > 0) {
      ops.push({ op: 'update', id: part.instanceId, name: part.label, before: fieldsBefore, after: fieldsAfter });
    }
  });

  const keptBefore = before.filter((p) => afterIds.has(p.instanceId)).map((p) => p.instanceId);
  const keptAfter = after.filter((p) => beforeIds.has(p.instanceId)).map((p) => p.instanceId);
  if (keptBefore.some((id, i) => id !== keptAfter[i])) {
    ops.push({ op: 'reorder', beforeIds: keptBefore, afterIds: keptAfter });
  }
  return ops;
}

const setFields = (part, fields) => {
  const next = { ...part };
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined || (value === null && GROUP_FIELDS.has(field))) delete next[field];
    else next[field] = clone(value);
  }
  // A pose restored from history is the part's new known pose
  if (fields.position || fields.rotation) {
    next.lastValidPosition = clone(next.position);
    next.lastValidRotation = clone(next.rotation);
  }
  return next;
};

const orderBy = (parts, ids) => {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return [...parts].sort((a, b) => (rank.get(a.instanceId) ?? Infinity) - (rank.get(b.instanceId) ?? Infinity));
};

const insertAt = (list, index, part) => {
  const next = [...list];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, clone(part));
  return next;
};

/** Applies ops forward. With `count`, only the first `count` ops (part-by-part playback). */
export function applyOps(parts, ops, count = ops.length) {
  let next = [...parts];
  for (const op of ops.slice(0, count)) {
    if (op.op === 'remove') next = next.filter((p) => p.instanceId !== op.part.instanceId);
    else if (op.op === 'add') {
      if (!next.some((p) => p.instanceId === op.part.instanceId)) next = insertAt(next, op.index, op.part);
    } else if (op.op === 'update') next = next.map((p) => (p.instanceId === op.id ? setFields(p, op.after) : p));
    else if (op.op === 'reorder') next = orderBy(next, op.afterIds);
  }
  return next;
}

/** Applies ops backward: the parts as they were before the step. */
export function revertOps(parts, ops) {
  let next = [...parts];
  for (const op of [...ops].reverse()) {
    if (op.op === 'update') next = next.map((p) => (p.instanceId === op.id ? setFields(p, op.before) : p));
    else if (op.op === 'reorder') next = orderBy(next, op.beforeIds);
    else if (op.op === 'add') next = next.filter((p) => p.instanceId !== op.part.instanceId);
    else if (op.op === 'remove') {
      if (!next.some((p) => p.instanceId === op.part.instanceId)) next = insertAt(next, op.index, op.part);
    }
  }
  return next;
}

// --- Tree helpers ---------------------------------------------------------------------------------

// Steps arrays are never mutated (every change makes a new array), so an index per array is safe to cache
const indexCache = new WeakMap();
const indexOf = (history) => {
  let index = indexCache.get(history.steps);
  if (!index) {
    const byId = new Map();
    const children = new Map();
    for (const step of history.steps) {
      byId.set(step.id, step);
      const key = step.parentId || ROOT;
      if (!children.has(key)) children.set(key, []);
      children.get(key).push(step);
    }
    index = { byId, children };
    indexCache.set(history.steps, index);
  }
  return index;
};

export function stepById(history, id) {
  if (!id) return null;
  return indexOf(history).byId.get(id) || null;
}

export function childrenOf(history, id) {
  return indexOf(history).children.get(id || ROOT) || [];
}

/** Step ids from the first step down to `id` (empty for the start). */
export function pathTo(history, id) {
  const { byId } = indexOf(history);
  const path = [];
  let cursor = id ? byId.get(id) : null;
  while (cursor) {
    path.unshift(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }
  return path;
}

const nextChildId = (history, id) => {
  const preferred = history.activeChild[id || ROOT];
  const children = childrenOf(history, id);
  if (preferred && children.some((c) => c.id === preferred)) return preferred;
  return children.length > 0 ? children[children.length - 1].id : null;
};

/** The last step reached from `id` by always following the branch redo would take. */
export function leafOf(history, id) {
  let cursor = id || null;
  for (let next = nextChildId(history, cursor); next; next = nextChildId(history, cursor)) cursor = next;
  return cursor;
}

/** Steps on the current line: the start to the head, then on along the branch redo follows. */
export function currentLine(history) {
  const ids = pathTo(history, history.headId);
  for (let next = nextChildId(history, history.headId); next; next = nextChildId(history, next)) ids.push(next);
  const { byId } = indexOf(history);
  return ids.map((id) => byId.get(id));
}

/** 1-based number of the head on the current line (0 = before the first step) and the line length. */
export function headPosition(history) {
  return { currentStep: pathTo(history, history.headId).length, totalSteps: currentLine(history).length };
}

/** Branches that start right after `id` (null = the start), each with its first label and length. */
export function branchesAt(history, id) {
  return childrenOf(history, id).map((child) => {
    const leaf = leafOf(history, child.id);
    const length = pathTo(history, leaf).length - pathTo(history, child.id).length + 1;
    return {
      id: child.id,
      label: child.label,
      source: child.source,
      at: child.at,
      length,
      leafId: leaf,
      active: nextChildId(history, id) === child.id
    };
  });
}

/** Parts at the head, replayed from the base. */
export function replay(history, stepId = history.headId) {
  let parts = clone(history.base);
  for (const id of pathTo(history, stepId)) parts = applyOps(parts, stepById(history, id).ops);
  return parts;
}

// --- Labels ---------------------------------------------------------------------------------------

const VERBS = {
  position: ['move', 'Move'],
  rotation: ['rotate', 'Rotate'],
  color: ['recolor', 'Recolor'],
  label: ['rename', 'Rename'],
  locked: ['lock', 'Lock'],
  visible: ['hide', 'Hide']
};

const updateVerb = (op, app) => {
  const fields = Object.keys(op.after);
  const pick = (pair) => (app ? pair[1] : pair[0]);
  if (fields.length === 1 && fields[0] === 'visible') return pick(op.after.visible === false ? VERBS.visible : ['show', 'Show']);
  if (fields.length === 1 && fields[0] === 'locked') return pick(op.after.locked ? VERBS.locked : ['unlock', 'Unlock']);
  if (fields.every((f) => f === 'position' || f === 'rotation' || f === 'socketAngleDeg')) {
    return pick(fields.includes('position') ? VERBS.position : VERBS.rotation);
  }
  if (fields.length === 1 && VERBS[fields[0]]) return pick(VERBS[fields[0]]);
  return app ? 'Change' : 'change';
};

const partName = (op, partsAfter) => {
  if (op.part) return op.part.label || op.part.instanceId;
  return op.name || partsAfter?.find((p) => p.instanceId === op.id)?.label || op.id;
};

/**
 * A short description of what the ops did.
 * style 'mcp' (after "<tool>: "): "72 parts", "Left Motor Pin 3", "move Robot Brain".
 * style 'app': "Add 2x12 Beam #1", "Delete 3 parts", "Move Robot Brain".
 */
export function summarize(ops, { style = 'mcp', parts } = {}) {
  const app = style === 'app';
  const adds = ops.filter((o) => o.op === 'add');
  const removes = ops.filter((o) => o.op === 'remove');
  const updates = ops.filter((o) => o.op === 'update');
  const count = (n) => `${n} part${n === 1 ? '' : 's'}`;

  if (adds.length > 0 && removes.length === 0 && updates.length === 0) {
    const what = adds.length === 1 ? partName(adds[0]) : count(adds.length);
    return app ? `Add ${what}` : what;
  }
  if (removes.length > 0 && adds.length === 0 && updates.length === 0) {
    const what = removes.length === 1 ? partName(removes[0]) : count(removes.length);
    return app ? `Delete ${what}` : what;
  }
  if (updates.length > 0 && adds.length === 0 && removes.length === 0) {
    const verbs = new Set(updates.map((op) => updateVerb(op, app)));
    const verb = verbs.size === 1 ? [...verbs][0] : app ? 'Change' : 'change';
    const what = updates.length === 1 ? partName(updates[0], parts) : count(updates.length);
    return `${verb} ${what}`;
  }
  if (adds.length + removes.length + updates.length === 0) return app ? 'Reorder parts' : 'reorder parts';
  const bits = [];
  if (adds.length) bits.push(`${adds.length} added`);
  if (removes.length) bits.push(`${removes.length} removed`);
  if (updates.length) bits.push(`${updates.length} changed`);
  const text = bits.join(', ');
  return app ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// --- Recording and moving -------------------------------------------------------------------------

const newStepId = (at) => `step-${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const resolveLabel = (label, ops, parts, style) => {
  if (typeof label === 'function') return label(ops, parts);
  if (typeof label === 'string' && label) return label;
  return summarize(ops, { style, parts });
};

/** `history` without every step below `id` (the undone steps), and redo pointers into them. */
function dropBelow(history, id) {
  const dropped = new Set();
  const stack = childrenOf(history, id).map((c) => c.id);
  while (stack.length) {
    const next = stack.pop();
    dropped.add(next);
    for (const c of childrenOf(history, next)) stack.push(c.id);
  }
  if (dropped.size === 0) return history;
  const activeChild = Object.fromEntries(
    Object.entries(history.activeChild).filter(([key, child]) => !dropped.has(key) && !dropped.has(child))
  );
  return { ...history, steps: history.steps.filter((s) => !dropped.has(s.id)), activeChild };
}

/**
 * Records the change from `before` to `after` as a step after the head.
 * Returns { history, step, merged, branched }; step is null when nothing in the build changed.
 * With `mergeKey`, a change within `mergeWindowMs` of a leaf head with the same key and source
 * amends that head instead (typing in a field, repeated nudges, several writes in one MCP call).
 * With `linear` (the app's default History setting), a change after undo drops the undone steps
 * instead of keeping them as a branch.
 */
export function recordStep(
  history,
  before,
  after,
  { source = 'app', label, mergeKey, at = Date.now(), mergeWindowMs = MERGE_WINDOW_MS, linear = false } = {}
) {
  const head = stepById(history, history.headId);
  const canMerge =
    mergeKey &&
    head &&
    head.mergeKey === mergeKey &&
    head.source === source &&
    at - (head.lastAt ?? head.at) <= mergeWindowMs &&
    childrenOf(history, head.id).length === 0;

  if (canMerge) {
    const beforeHead = revertOps(before, head.ops);
    const ops = diffParts(beforeHead, after);
    const parentKey = head.parentId || ROOT;
    if (ops.length === 0) {
      // The edit came back to where it started: the step goes away
      const steps = history.steps.filter((s) => s.id !== head.id);
      const activeChild = { ...history.activeChild };
      if (activeChild[parentKey] === head.id) delete activeChild[parentKey];
      return {
        history: { ...history, steps, headId: head.parentId || null, activeChild, rev: history.rev + 1 },
        step: null,
        merged: true,
        branched: false
      };
    }
    const style = source === 'mcp' ? 'mcp' : 'app';
    const step = { ...head, ops, lastAt: at, label: resolveLabel(label, ops, after, style) };
    return {
      history: { ...history, steps: history.steps.map((s) => (s.id === head.id ? step : s)), rev: history.rev + 1 },
      step,
      merged: true,
      branched: false
    };
  }

  const ops = diffParts(before, after);
  if (ops.length === 0) return { history, step: null, merged: false, branched: false };

  if (linear) history = dropBelow(history, history.headId);
  const branched = childrenOf(history, history.headId).length > 0;
  const style = source === 'mcp' ? 'mcp' : 'app';
  const step = {
    id: newStepId(at),
    parentId: history.headId || null,
    at,
    source: SOURCES.includes(source) ? source : 'app',
    label: resolveLabel(label, ops, after, style),
    ops
  };
  if (mergeKey) step.mergeKey = mergeKey;
  return {
    history: {
      ...history,
      steps: [...history.steps, step],
      headId: step.id,
      activeChild: { ...history.activeChild, [history.headId || ROOT]: step.id },
      rev: history.rev + 1
    },
    step,
    merged: false,
    branched
  };
}

/**
 * Moves the head to `targetId` (null = the start): undoes back to the step the two share, then
 * redoes forward, marking the branch taken. `parts` are the parts at the current head.
 */
export function moveTo(history, parts, targetId) {
  const target = targetId || null;
  if (target && !stepById(history, target)) return null;
  const from = pathTo(history, history.headId);
  const to = pathTo(history, target);
  let shared = 0;
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1;

  let next = parts;
  for (let i = from.length - 1; i >= shared; i -= 1) next = revertOps(next, stepById(history, from[i]).ops);
  const activeChild = { ...history.activeChild };
  for (let i = shared; i < to.length; i += 1) {
    const step = stepById(history, to[i]);
    next = applyOps(next, step.ops);
    activeChild[step.parentId || ROOT] = step.id;
  }
  return {
    history: { ...history, headId: target, activeChild, rev: history.rev + 1 },
    parts: next,
    undone: from.slice(shared).reverse(),
    redone: to.slice(shared)
  };
}

/** Undo `count` steps. Returns null when already at the start. */
export function undo(history, parts, count = 1) {
  const path = pathTo(history, history.headId);
  if (path.length === 0) return null;
  const targetIndex = path.length - 1 - Math.max(1, count);
  return moveTo(history, parts, targetIndex >= 0 ? path[targetIndex] : null);
}

/** Redo `count` steps along the current line. Returns null when already at its end. */
export function redo(history, parts, count = 1) {
  let target = history.headId || null;
  let moved = 0;
  for (let next = nextChildId(history, target); next && moved < Math.max(1, count); next = nextChildId(history, target)) {
    target = next;
    moved += 1;
  }
  if (moved === 0) return null;
  return moveTo(history, parts, target);
}

// --- Files ----------------------------------------------------------------------------------------

/** History for parts that came without one: one "Starting assembly" step from an empty build. */
export function fromLegacy(parts = [], { at = Date.now(), source = 'app' } = {}) {
  const empty = createHistory([]);
  if (parts.length === 0) return empty;
  return recordStep(empty, [], parts, { source, label: 'Starting assembly', at }).history;
}

/**
 * The history to save with an export that keeps only `keptParts`: when parts were left out, a final
 * step removes them, so replaying the saved history gives exactly the saved parts.
 */
export function withExportStep(history, parts, keptParts) {
  return recordStep(history, parts, keptParts, { source: 'app', label: 'Leave out overlapping parts' }).history;
}

/** True when replaying `history` to its head gives `parts` (same ids, order and build fields). */
export function matchesParts(history, parts) {
  return diffParts(replay(history), parts).length === 0;
}

/**
 * The history to use with saved parts. A valid history that matches is used as is. One that doesn't
 * match (an older writer changed the parts without recording) gets an "External change" step, so
 * nothing before it is lost. Without a valid history, the parts get one starting step.
 */
export function loadHistory(savedHistory, parts, { source = 'mcp', label = 'External change' } = {}) {
  if (!isHistory(savedHistory)) return fromLegacy(parts);
  if (matchesParts(savedHistory, parts)) return savedHistory;
  return recordStep(savedHistory, replay(savedHistory), parts, { source, label }).history;
}

// --- Saving from the browser ----------------------------------------------------------------------

/**
 * How the bridge saves a browser POST. `saved` is the state on disk (with history), `payload` what
 * the browser sent: parts, maybe `history`, and `baseHistoryRev` (the history rev it last synced).
 * - If the saved history moved on since then (an MCP step landed in between), the save is refused:
 *   { conflict: true, state: saved }, and the browser adopts it and re-records its change on top.
 * - A payload without history (selection or viewport-only saves) keeps the saved history.
 */
export function mergeBrowserSave(saved, payload) {
  const { baseHistoryRev, ...rest } = payload;
  const savedRev = saved?.history?.rev;
  if (savedRev !== undefined && baseHistoryRev !== undefined && savedRev !== baseHistoryRev) {
    return { conflict: true, state: saved };
  }
  const history = isHistory(rest.history) ? rest.history : saved?.history;
  return { conflict: false, state: history ? { ...rest, history, historyRev: history.rev } : rest };
}
