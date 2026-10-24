## 1. Shared history module (`src/utils/buildHistory.js`)

- [x] 1.1 Add `diffParts(before, after)` per design.md §1. It compares only `position`, `rotation`, `color`, `label`, `visible` and `locked`. Ops come out with removes in `before` order (with index), then adds (with index) and updates in `after` order. Add `scripts/check-history.mjs` with cases:
  - an empty diff for the same list;
  - an `isIntersecting`-only change gives no ops;
  - 3 added parts keep list order;
  - a removed part keeps its index.

  Verify with `node scripts/check-history.mjs`.
- [x] 1.2 Add the history tree per design.md §2: `createHistory`, `recordStep` (empty diff gives no step; same `mergeKey`, under 1 s, leaf head and same source amends the head), `undo`, `redo`, `moveTo`, `partsAt(history, stepId, opCount)`, `currentLine` and `branchesAt`. Check-script cases:
  - add A, B, C, undo twice, add D: parts are A and D, and B and C are kept as a branch;
  - `moveTo` the old branch gives A, B, C;
  - 500 steps undone back to the start give the base parts;
  - redo follows the most recently used branch;
  - a deleted part comes back at its old index with the same fields;
  - merging: 5 X-field edits within 1 s give 1 step.
- [x] 1.3 Add `summarize(ops)`, `fromLegacy(parts)` and `withExportStep(history, parts, keptParts)` per design.md §3 and §7. Check-script cases:
  - `summarize` gives "72 parts" for 72 adds and "move Robot Brain" for one position change;
  - `fromLegacy` on 65 parts gives one "Starting assembly" step, and undo empties the build;
  - after `withExportStep`, replaying the history gives exactly the kept parts.

## 2. MCP server and engine (`mcp/assembly-engine.mjs`, `mcp/vexiq-mcp-server.mjs`)

- [x] 2.1 Make `readAssemblyState()` return `history` and `historyRev`, converting files without history with `fromLegacy`. Make `writeAssemblyState(nextState, { recordHistory = true })` re-read the file, record one step (`source: 'mcp'`, label `<tool>: <summary>`, `mergeKey` = per-call id from the `appSyncContext` store) and bump `historyRev`. Set the tool name and call id in the store in the server's `tools/call` handler. Verify with a new `scripts/check-mcp-tools.mjs` case: `place_parts` with 36 items and `mirror` adds exactly one step of 72 adds in placement order, labeled `place_parts: 72 parts`.
- [x] 2.2 Cover every changing tool: `place_part`, `place_parts`, `update_part`, `align_part_to_hole`, `mate_parts`, `auto_fasten_joint`, `mesh_gear_train`, `mirror_subassembly`, `remove_part` and `clear_assembly`. Have the reply say when the step started a new branch. Check-script cases:
  - each tool adds one step;
  - `place_parts` with `dryRun`, a refused `rejectIntersecting` call, `configure_viewport` and the reading tools add none;
  - after every changing call, replaying the saved history equals the saved `instances`.
- [x] 2.3 Add the `get_history` (`limit`, default 50), `undo` (`steps`, default 1) and `redo` (`steps`, default 1) tools per the mcp-history spec. They use `moveTo` and `writeAssemblyState(..., { recordHistory: false })`, report the step reached and what changed, and include `appSync`. Change `get_assembly` to return `{ currentStep, totalSteps }` instead of the history. Check-script cases:
  - undo after `place_parts` removes its parts and adds no step;
  - redo restores them;
  - undo on an empty history refuses with a message;
  - `get_history` lists labels, sources and the branch point after undo then place.

## 3. Bridge (`vite.config.js`)

- [x] 3.1 Keep the file's `history` when a POST has none. Refuse with `409` and the file's state when a POST carries history built on an older `historyRev` (design.md §6). Verify with a check-script case against the bridge middleware (or a small Node test calling the handler): a POST without history leaves the saved history unchanged; a stale POST gets 409.
- [x] 3.2 Make `/api/assembly/action` (auto-fasten, gear train, mirror) record a step with `source: 'action'` and the action name, and broadcast parts plus history. Verify in the app: running Mirror from the Inspector adds one "mirror_subassembly" step, and undo removes the mirrored parts.

## 4. Browser history (`src/App.jsx`, `src/utils/webMcpTools.js`)

- [x] 4.1 Add `history` and `historyRev` state and `commitBuild(updater, { label, source, mergeKey })` per design.md §4. Move every build-changing `setInstances` call site to it and list each one in this task when done:
  - add part, duplicate, delete;
  - `handleUpdateTransform` (drag, rotate, mate, color, label, lock, visibility);
  - selection-triggered overlap revert;
  - Esc revert;
  - clear and starter;
  - smart-action replies (adopt).

  Leave the viewport's own `isIntersecting` updates as plain state updates. Inspector fields and nudge buttons use `mergeKey`. Verify in the app:
  - a drag adds one step;
  - clicking parts adds none;
  - typing "63.5" in X adds one step;
  - recolor, rename, lock and hide each add one labeled step.

  Done: `commitBuild` is `setInstances(updater, { label, source, mergeKey })` in `App.jsx`, so every existing call site records a step. Call sites:
  - add part (`handleAddPart`), duplicate, delete;
  - `handleUpdateTransform` (viewport drag, rotate, mate and its own overlap-flag updates, which give an empty diff and no step; Inspector color, lock, visibility);
  - selection-triggered overlap revert, Revert Pose button, Esc revert ("Move back …" / "Cancel placement of …");
  - Clear All, Starter, WebMCP reset;
  - the 409 re-record.

  Server-sourced parts go through `adoptServerState` instead: startup, SSE broadcasts and smart-action replies. File import and undo/redo replace parts and history together. There is no rename control in the app, so no rename step exists yet.
- [x] 4.2 Load and adopt history:
  - on startup, from `/api/assembly` (or `fromLegacy`);
  - from SSE broadcasts that carry `history` (replace both);
  - from broadcasts without it ("External change" step);
  - from a 409 reply (adopt, then re-record the pending change on top).

  POST `history` only when `historyRev` changed. Verify in the app: reloading keeps the timeline; an MCP `place_parts` call while the app is open shows up as one MCP step within a second.
- [x] 4.3 Undo/redo keys and toolbar buttons per design.md §9, with buttons disabled at the line's ends. Verify in the app:
  - Ctrl/Cmd+Z undoes a delete with the part's id, label, color and pose restored;
  - Shift+Ctrl/Cmd+Z and Ctrl+Y redo;
  - Ctrl/Cmd+Z in the part search box only edits the text;
  - overlap colors are right after undoing a move into another part.
- [x] 4.4 Export and import per design.md §7. Export writes `version: '1.1'`, `history` and `historyRev`, adding the "left out overlapping parts" step when needed. Import adopts the file's history, or uses `fromLegacy`. localStorage keeps parts only. Verify in the app:
  - export a 40-step build, reload, import it: 40 steps and branches are back;
  - importing `scripts/fixtures/drivetrain.json` (no history) gives one "Starting assembly" step.
- [x] 4.5 Record WebMCP tool changes with `source: 'assistant'` (done by passing `source: 'assistant'` from the WebMCP context's place and reset functions, the only WebMCP tools that change parts, instead of a ref flag). Verify by calling one registered tool's handler from the browser console: one step with source `assistant` appears.

## 5. Timeline (`src/components/HistoryTimeline.jsx`, `Viewport3D.jsx`, `src/styles.css`)

- [x] 5.1 Add the History toolbar toggle (remembered in localStorage) and the timeline bar. It shows:
  - one mark per step on the current line, colored by source;
  - the current step highlighted;
  - branch markers;
  - hover tips with label, source and time;
  - "Step N of M".

  Marks are drawn per pixel column when there are more marks than pixels. Verify in the app: the drivetrain from this session shows its steps; MCP steps look different; a 5,000-step history (made with a check-script helper and imported) stays responsive while hovering.
- [x] 5.2 Scrubbing per design.md §8:
  - flat positions, with one per op inside multi-op steps;
  - snapshots every 100 steps;
  - stopping on a step boundary calls `moveTo`;
  - inside a step, App passes `previewParts` and `readOnly` to `Viewport3D`, which turns off selection, gizmos, mating and rotate mode and shows the banner with "Go to end of step".

  Verify in the app:
  - scrubbing through the `place_parts: 72 parts` step shows parts appearing one at a time in placement order;
  - dragging a part mid-step does nothing;
  - stopping on step 10 then redo goes to step 11;
  - the camera doesn't move.
- [x] 5.3 Play/Pause with 1×/2×/4× speed. Play stops on any edit, undo or redo, and finishing leaves the head on the last step. Verify in the app: Play on the drivetrain builds it from empty and ends on the finished build.
- [x] 5.4 Branch marker menu (first label, length, time per branch). Choosing a branch switches the line and moves to its end. Editing after scrubbing back starts a new branch, and the timeline follows it. Verify in the app: scrub to step 10, move a part, see a new step 11 and a branch marker at 10 that leads back to the old steps.

  Notes from implementation:
  - The History toggle is an icon button (with an "History" label for screen readers) next to Undo/Redo. The toolbar now grows to a second row in narrow windows instead of being clipped; at 1600 px it was already over-full.
  - Scrubbing shows only the latest position per frame, and Play schedules each position after the previous one is shown, so slow redraws don't build up a backlog.
  - Sync robustness found while testing (design.md §6): each browser tab sends an id, so tabs skip only their own echoes and stay in step with each other. On a 409, a tab that only moved through the history (undo, redo, timeline) makes the same move on the saved history instead of re-recording it as a new step.

## 6. Docs and final checks

- [x] 6.1 Update `features.md`: history, undo/redo, timeline, the MCP history tools, and the file format fields. Verify the section lists the new tools and keys.
- [x] 6.2 Run `npm run build`, `node scripts/check-history.mjs`, `node scripts/check-pin-hole-alignment.mjs` and `node scripts/check-mcp-tools.mjs`; all pass. Then rebuild the drivetrain over MCP with the app open. Confirm:
  - each call is one MCP step;
  - Play shows the robot going together part by part;
  - one MCP `undo` removes the last call's parts in the app.
