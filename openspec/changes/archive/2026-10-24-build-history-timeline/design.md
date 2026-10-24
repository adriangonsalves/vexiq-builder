## Context

See proposal.md for the motivation. Three writers share one build today:

- **Browser** (`src/App.jsx`). It keeps `instances` in React state and changes them at about 16 `setInstances` call sites: add, duplicate, delete, `handleUpdateTransform` for drags, rotation, mating, Inspector fields, color, lock and visibility, selection-triggered overlap revert, clear and starter, file import, and smart-action replies. On every change to parts, selection or viewport settings, an effect POSTs the whole state to `/api/assembly` and saves the non-overlapping parts to localStorage. Inspector number fields call `handleUpdateTransform` on every keystroke. `Viewport3D` commits drags, rotations and mates once on release, but it also calls `onUpdateTransform` by itself to update a part's `isIntersecting` flag.
- **MCP server** (`mcp/vexiq-mcp-server.mjs`). Each changing tool reads `public/assembly-state.json` with `readAssemblyState()`, builds `{ ...state, instances }`, and calls `writeAssemblyState()` (about 12 call sites). That writes the file and POSTs it to the bridge, which tells the browser over SSE. Each call runs inside `appSyncContext`, a per-call store that already carries `appSync`.
- **Vite bridge** (`vite.config.js`). It writes the file on every POST and broadcasts the state to every browser. Smart actions under `/api/assembly/action` (auto-fasten, gear train, mirror) compute new parts there and broadcast them.

There is no undo or history anywhere. `.vexiq.json` export holds `version`, `exportedAt` and the non-overlapping `instances`.

## Goals / Non-Goals

**Goals:**
- One history format and one set of history operations, shared by the browser, the MCP server and the bridge. That way a step recorded by any of them can be undone, scrubbed and saved by the others.
- History kept small enough to live inside `assembly-state.json` and `.vexiq.json` with thousands of steps.
- Scrubbing that stays smooth across a long history.

**Non-Goals:**
- Merging histories from two files, or comparing branches side by side.
- Recording camera moves, selection or viewport settings (see the build-history spec).
- Live collaboration. Two writers editing at the same moment are handled by the conflict rule below, not by real-time merging.
- Deleting or pruning history steps. That could be a later feature.

## Decisions

### 1. Steps store changes, not copies of the whole build
Each step holds a list of reversible changes:
- `add` holds the full part and its index in the list.
- `remove` holds the full part and its index, so undo puts it back in the same place in the Outliner.
- `update` holds the part id plus the changed fields, before and after.

Only build fields are compared: `position`, `rotation`, `color`, `label`, `visible` and `locked`. `partId` never changes. `isIntersecting`, `lastValidPosition` and `lastValidRotation` are bookkeeping, so they are left out. The viewport recomputes them after undo, redo or a jump, as it already does for MCP updates.

*Alternative:* a full copy of the build per step. The drivetrain from this session is about 77 parts × ~400 bytes ≈ 30 KB per copy, so 1,000 steps would be ~30 MB in the saved file. Rejected.

### 2. History is a tree with a "last used child" per step
```
history = {
  version: 1,
  base: [],                       // parts before the first step (always empty for new builds)
  steps: [{ id, parentId, at, source, label, ops: [...] }, ...],  // in creation order
  headId,                         // current step, or null at the start
  activeChild: { [stepIdOrRoot]: childId }   // the branch redo follows
}
```
- A new step's parent is `headId`. It becomes the head, and its parent's `activeChild`.
- The current line runs from the start to `headId`, then follows `activeChild` down to a leaf.
- Branch markers are steps with more than one child.
- Moving to any step finds the steps the current head and the target share. It undoes the head's own steps back to that shared point, then redoes forward to the target.

Nothing is ever deleted, which is the branch rule in the build-history spec.

*Alternative:* a straight list where redo steps are dropped. The user chose to keep branches.

### 3. One shared module: `src/utils/buildHistory.js`
Plain JS with no browser or Node APIs, so `App.jsx`, `assembly-engine.mjs` and `vite.config.js` can all import it. This follows the existing pattern: `pinHoleAlignment.js` is already shared by the browser and the engine. It provides:
- `diffParts(before, after)` gives the ops: removes in `before` order, then adds and updates in `after` order. MCP tools append parts in placement order, so a step's op order is the order parts were placed. That is what part-by-part playback uses.
- `recordStep(history, beforeParts, afterParts, { source, label, mergeKey, at })` returns `{ history, step }`, or no step when the diff is empty.
- `undo`, `redo`, `moveTo(history, parts, stepId)` and `partsAt(history, stepId, opCount?)` return the new history and parts.
- `currentLine(history)`, `branchesAt(history, stepId)` and `summarize(ops)` (for example "72 parts", "move Robot Brain").
- `fromLegacy(parts)` builds a history with one "Starting assembly" step.
- `withExportStep(history, parts, keptParts)` adds the "left out overlapping parts" step for export.

`check-history.mjs` tests this module directly in Node.

### 4. Browser: one commit path for build changes
`App.jsx` gets `commitBuild(updater, { label, source = 'app', mergeKey })`. It computes the next parts, records a step, and sets both parts and history. Every call site that changes the build switches to it. Exceptions:
- Viewport-only `isIntersecting` updates keep using plain state updates, so they never create steps.
- Adopting a state that came from the server replaces parts and history together.

Inspector fields and nudge buttons pass `mergeKey = "<field>:<instanceId>"`. `recordStep` amends the head step instead of adding one when the head:
- has the same `mergeKey`,
- is less than 1 s old,
- has no children,
- and came from the same source.

The selection-triggered overlap revert records its own step ("Move back <label>").

WebMCP tools run through the same handlers. While a WebMCP tool runs, a ref sets `source = 'assistant'`.

History lives in React state next to `instances`. A `historyRev` counter goes up on every step or head move.

### 5. MCP server: one step per tool call
`writeAssemblyState(nextState)` re-reads the file's current parts and history, so it always records on top of the latest state. It then calls `recordStep` with:
- `source: 'mcp'`,
- `label = "<tool>: " + summarize(ops)`, where the tool name comes from the `appSyncContext` store, which the server already sets per call,
- `mergeKey = <per-call id>`.

A tool that writes twice in one call therefore amends a single step.

`writeAssemblyState(state, { recordHistory: false })` is used by the new `undo` / `redo` tools, which move the head with `moveTo` instead. `readAssemblyState()` converts a file without `history` using `fromLegacy`. `get_assembly` reports `{ currentStep, totalSteps }` instead of the history. Tools that don't write never touch history, so dryRun and refused calls are covered without extra code.

### 6. Bridge and sync
- **Browser to bridge.** The browser POSTs `history` only when `historyRev` changed since its last POST. Selection and viewport-only POSTs leave it out, and the bridge then keeps the file's history. This avoids sending a multi-megabyte history on every click.
- **Revision check.** Each saved state carries `historyRev`. If a browser POST carries history built from an older `historyRev` than the file's, the bridge doesn't overwrite. This happens when an MCP step landed in between. The bridge replies `409` with the file's state. The browser adopts that state and re-records its own pending change on top, as a new step from the server's head. Neither writer loses a step.
- **Moves that lose the race.** If the refused change was only a move through the history (undo, redo, a timeline click), the browser makes the same move on the server's history instead of recording a new step.
- **Several tabs.** Each tab sends an `x-client-id` header, and broadcasts carry it. A tab skips only its own echoes and adopts changes saved by other tabs, so tabs stay in step instead of colliding with 409s.
- **Smart actions.** `/api/assembly/action` calls `recordStep` with `source: 'action'` and the action name as the label, then broadcasts parts plus history.
- **Browser adopts broadcasts.** An SSE state with `history` replaces both parts and history. One without `history` comes from an older writer, so it is recorded as a step with source `mcp` and label "External change".

### 7. Files
`assembly-state.json` and the `.vexiq.json` export both get `history` and `historyRev`. The export's `version` goes to `'1.1'`. Export keeps writing only non-overlapping parts, as today. When any were left out, `withExportStep` adds a final step that removes them to the saved copy only, so replaying the file's history gives exactly its `instances`. Import with `history` adopts it. Import without it uses `fromLegacy`. localStorage keeps storing only parts, as today, plus the timeline-visible flag.

### 8. Timeline and preview
New `src/components/HistoryTimeline.jsx` sits under the viewport.
- **Positions.** It builds the flat list of positions on the current line: one per step boundary, plus one per op inside multi-op steps.
- **Many marks.** With more marks than pixels, marks are drawn per pixel column, colored by source, so the bar never overflows.
- **Scrubbing to a boundary.** Stopping on a step boundary calls `moveTo` and becomes the real current state.
- **Scrubbing inside a step.** The timeline sets a `previewParts` list that `App` passes to `Viewport3D` instead of `instances`, with a `readOnly` flag. Read-only turns off selection, gizmos, mating and rotate mode, and shows the banner.
- **Fast jumps.** For fast scrubbing over long lines, the timeline keeps in-memory snapshots of the parts every 100 steps along the current line. They are rebuilt when the line changes and never saved. Any position is then at most 100 steps of ops from a snapshot.
- **Play.** Play steps through the positions on a timer (base 6 positions/s, ×1/×2/×4). The final position moves the head to the last step.

### 9. Undo and redo keys
They are added at the top of the existing `keydown` handler in `App.jsx`, skipped when the event target is an `input`, `textarea`, `select` or contentEditable element. Cmd is used on macOS and Ctrl elsewhere. Ctrl+Y is redo on all systems. They don't clash with existing shortcuts: Ctrl/Cmd+D is duplicate, and Delete and Esc are unchanged.

## Risks / Trade-offs

- **[A large history makes every save slower]** → Diff steps keep it small: a 72-part `place_parts` step is ~30 KB, and a move is ~200 bytes. The browser sends history only when it changed. If it gets too slow, history can later move to its own file.
- **[Two writers at once]** → The `historyRev` check plus re-recording on top means neither the browser nor MCP loses a step. The cost is that a browser change made at the same moment as an MCP call lands after it.
- **[A call site that bypasses `commitBuild`]** → It would change parts without a step, and undo would then show a wrong build. Mitigation: the check script replays the saved history and compares it to `instances` after each MCP tool. During implementation, every `setInstances` call site is audited and listed in tasks.md.
- **[Op order is wrong for playback]** → The order comes from the part list. MCP tools append in placement order, so playback matches how the build was made. Smart actions that insert parts mid-list play in list order, which is acceptable.
- **[Opening an old build in an older version of the app]** → An older version ignores `history`, and when it saves, the field is dropped. The next new-version load starts over with "Starting assembly". The parts are never lost; only the history before that point is.
- **[Scrubbing loads many part models]** → Models are already cached per part, and preview changes add or remove one part per position, so frame cost matches placing a part today.

## Migration Plan

No data migration step. Files without `history` are converted when read (`fromLegacy`). Rolling back to an older build of the app ignores the `history` field. The only effect is losing history written after the rollback, as noted above.
