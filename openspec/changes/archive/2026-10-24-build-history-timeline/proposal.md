## Why

The app keeps only the current state of a build. There is no undo, so a wrong drag, delete or MCP call can only be fixed by hand. Nothing records how a robot came together, and a saved `.vexiq.json` holds just the final parts. Agents now build whole robots over MCP in a few large calls, so the user can't see the order things went together, or step back through it.

## What Changes

- **Build history.** Every change to the build is recorded as one step with a label, the time, and who made it: you in the app, an MCP tool, an in-page assistant, or a smart action. Changes include adding, moving, rotating, mating, deleting, duplicating, recoloring, renaming, hiding and locking parts, plus clearing and loading the starter. Selection, the camera and viewport settings are not recorded. Steps are kept for as long as the build exists; there is no limit.
- **Unlimited undo and redo.** Undo and redo move through the steps with Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z (or Ctrl+Y), plus toolbar buttons. While you type in a text field, those keys keep their normal text-editing behavior.
- **Nothing is thrown away.** If you undo and then make a new change, the steps you undid stay in the history as a branch you can switch back to.
- **Saved with the file.** History is saved in `public/assembly-state.json` and in exported `.vexiq.json` files, and comes back when the file is opened. A file saved before this change opens with one starting step that holds its parts.
- **Timeline.** A History button shows or hides a timeline along the bottom of the 3D view. It has one mark per step on the current line, markers where branches split off, and a different look for steps made over MCP. Hovering a mark shows its label, time and source.
- **Scrubbing and playback.** Dragging along the timeline shows the build as it was at that point. A step that added many parts at once, such as one `place_parts` call, plays one part at a time while you scrub through it. A Play button replays the whole build from the start.
- **MCP steps.** Every MCP tool call that changes the build becomes one step, labeled with the tool and a short summary (for example `place_parts: 72 parts`). Undo removes the whole call at once. Check-only calls (`dryRun`) record nothing.
- **New MCP tools.** `get_history` lists the steps and branches, and `undo` / `redo` move through them, so an agent can back out its own mistake.
- **Saved files get bigger.** `assembly-state.json` and `.vexiq.json` gain a `history` field. Files saved by this version keep the same `instances` list, so older readers still open them.

## Capabilities

### New Capabilities
- `build-history`: which changes become steps, step labels and sources, unlimited undo/redo, branches kept after undo-then-edit, and saving and loading history with the file (including files saved before this change).
- `history-timeline`: the timeline panel (toggle, marks, branch markers, MCP marking), scrubbing to a past point, part-by-part playback inside multi-part steps, Play, and editing after scrubbing back.
- `mcp-history`: one step per changing MCP tool call with its label, nothing recorded for check-only calls, and the `get_history`, `undo` and `redo` tools.

### Modified Capabilities
<!-- None. mcp-app-link, mcp-batch-placement, pin-mating and rotate-mode keep their requirements; their changes are now also recorded as steps, which build-history and mcp-history describe. -->

## Impact

- New shared history module in `src/utils/` (plain JS, used by the browser, the MCP server and the Vite bridge): record a step from the before and after parts, undo, redo, move to any step, branches, and load/save.
- `src/App.jsx`:
  - Route every change to the build through one commit function that records a step.
  - Keyboard shortcuts and toolbar buttons.
  - Adopt history from MCP updates.
  - Save and load history in `.vexiq.json`.
  - Keep history out of localStorage, which is too small for it.
- `src/components/`: new timeline panel. `Viewport3D.jsx` shows a past point as a read-only preview.
- `mcp/assembly-engine.mjs`: `readAssemblyState` / `writeAssemblyState` carry history and record one step per tool call.
- `mcp/vexiq-mcp-server.mjs`: step labels per tool, plus new `get_history`, `undo` and `redo` tools.
- `vite.config.js`: bridge actions record steps, and the bridge keeps the saved history when the browser sends only the parts.
- `src/utils/webMcpTools.js`: in-page assistant changes are recorded as steps.
- `scripts/check-mcp-tools.mjs` and a new history check script.
- `features.md`.
- No new dependencies.
