## Context

See proposal.md for why. The current state that shapes the approach:

- **Selection is one id.** `App.jsx` holds `selectedId`; `Viewport3D.jsx` reads it through `selectedIdRef` in about a dozen places (gizmo setup, hole picking, mate arrows, copy-insert, collision checks, highlight). The MCP bridge and WebMCP context also carry `selectedId`.
- **Clicks in the 3D view.** `handlePointerUp` picks the front part and calls `onSelect(front)`, sometimes after a double-click wait. Ctrl/Cmd is already used by copy-insert (`copy-insert` spec) and right-click toggles Move/Rotate (`rotate-mode` spec). Shift is free on a plain click (it is only used to step backwards through fits while hole picking).
- **Moving.** TransformControls is attached to the selected part's `THREE.Group`; on drag end the viewport calls `onUpdateTransform(id, patch)`. Rotation uses a custom ring gizmo that pivots about a joint or the part centre. Collision checks (`checkCandidateCollision`-style BVH in the viewport) run per part against all others.
- **History.** `buildHistory.js` diffs part lists; a part's tracked fields are `BUILD_FIELDS`. Any field added there becomes undoable and travels with the build automatically.
- **Joints.** Only the server side (`mcp/assembly-engine.mjs` `auditAssembly`) builds the joint graph (seated pins/pegs/shafts, gear meshes, battery bay). It runs in Node with the BVH collision meshes; the app reaches it through `/api/assembly/action` in `vite.config.js`.
- **Outliner** is a flat `instances.map` in `App.jsx`; the Inspector header just says "Part Inspector".

## Goals / Non-Goals

**Goals:**
- One selection model used by the 3D view, the Outliner, the Inspector and the MCP bridge, without breaking any single-part feature.
- Groups stored so they survive history, save/load, the library and the MCP server with no new history op types.
- One code path for moving/turning "a set of parts" that both groups and loose multi-selections use.
- A shape that lets group mating be added later without changing the saved format.

**Non-Goals:**
- Group mating, hole snap or flush stop for sets (later change).
- Nested groups.
- Cloning a group over MCP, and group tools for the in-page assistant (`webMcpTools.js`).

## Decisions

### 1. Selection state: `selectedIds` plus a derived primary
`App.jsx` holds `selectedIds: string[]`, ordered, last = primary. `selectedId` stays as a derived value (`selectedIds.length === 1 ? selectedIds[0] : null` for single-part tools, and `primaryId = selectedIds.at(-1)` for the header/locate). Everything single-part keeps reading `selectedId`, so hole picking, mating, copy-insert and the rotate rings switch off by themselves when more than one part is selected — which is what the spec asks.
- The viewport gets a new `selectedIds` prop (ref'd like `selectedIdRef`) for highlight and the set gizmo; `onSelect(id, { additive })` replaces the current `onSelect(id)`.
- The bridge and WebMCP keep sending `selectedId` (primary) and add `selectedIds`, so older readers still work.
- Alternative considered: making `selectedId` an array everywhere. Rejected: it touches every single-part branch in a 4,700-line viewport for no gain.

### 2. Groups as two part fields, not a separate list
Each part gets optional `groupId` and `groupName`. A group exists when two or more parts share a `groupId`; the folder name is read from them. Both fields are added to `BUILD_FIELDS`, so group/ungroup/rename are ordinary `update` ops and undo, branches, timeline playback, the library and the bridge carry them without new code.
- Renaming writes `groupName` on every member (one step).
- Alternative considered: a top-level `groups: [{ id, name }]` in the build. Cleaner on paper, but it needs a new history op, a new field in the saved state, the library format and every MCP writer, and it can get out of step with the parts. Rejected for now; the per-part form can be lifted into a list later if nesting is added.
- Outliner order: a folder sits where its first member is in `instances`; members are listed in their `instances` order. No reordering of `instances` is needed.

### 3. Pure helpers in `src/utils/partGroups.js`
No React/DOM, so the check script and the server can import them:
- `groupsOf(instances)` → `Map<groupId, { name, ids }>`; `expandToGroups(ids, instances)` (a grouped part pulls in its whole group); `nextGroupName(instances)`.
- `groupParts(instances, ids, name)` / `ungroupParts(instances, ids)` / `renameGroup(...)` returning patch lists, including dissolving groups left with one part.
- `setPivot(instances, ids, boxes)` → centre of the combined world box.
- `applySetTransform(instances, ids, pivot, { deltaPos, deltaQuat })` → new position/rotation for each part, composing the turn about the pivot with each part's own Euler XYZ rotation (same convention as `buildWorldMatrix`).
- Later group mating can be built on `collectWorldFeatures` for every member, treating the union as one part's features; that is why helpers take id lists rather than a group object.

### 4. Moving a set: a pivot object in the viewport
When the selection has more than one part, the viewport creates a `THREE.Object3D` pivot at the set centre and attaches TransformControls (and the ring gizmo, pivoting about the set centre) to it. While dragging, each member group's matrix is set to `pivotDelta × startMatrix`, so the scene updates live. On drag end it calls a new `onUpdateSet(ids, patchesById, meta)` that `App.jsx` turns into one `setInstances` call (one history step, label "Move <group>" / "Move N parts"). Grid and angle snap apply to the pivot.
- Collision during a set drag ignores pairs inside the set and checks members against everything else; overlapping outside parts are marked as today.
- Flush stop (`flushMoverRef`), hole snap and the rotate ring's joint pivot are skipped for sets in this change.
- Inspector position fields edit the pivot; nudge and quick 90° call `applySetTransform` with a fixed delta and a `mergeKey` so repeated nudges merge.
- Alternative considered: re-parenting members under a real `THREE.Group` for the drag. Rejected: members' meshes are shared with picking, explode and highlight code that expect them at the scene root.

### 5. Click rules
- 3D view: in `handlePointerUp`, `additive = e.shiftKey || selectModeRef.current`. Additive clicks toggle and skip the double-click wait; empty-space additive clicks do nothing. Shift while hole picking is not affected because picking returns earlier in the handler. The id passed up is the clicked part; `App.jsx` expands it to its group (`expandToGroups`) unless it came from an Outliner member row.
- Outliner: plain / Ctrl-Cmd / Shift-range as in the spec; range uses the rows in display order (folders count as one row when closed).
- Keys in the existing App keydown handler: `C` Select Connected, `G` group, `Shift+G` ungroup, `Ctrl/Cmd+A` select all, `Esc` leaves Select mode then clears selection. All skip text fields, as today. `G` and `C` are currently unused (check before wiring).

### 6. One joint graph from the server, walked by a pure helper
Add `jointGraph(state)` in `assembly-engine.mjs`, refactored out of `auditAssembly` (the audit then builds its components from it, so the two can't disagree). It returns `{ nodes: [instanceId], edges: [[a, b]] }` where every part, fasteners included, is a node, and an edge joins a fastener to each part it is seated in (from the existing `joints` list), plus the audit's other joins (motor to shaft, battery to brain bay, meshing gears). Fasteners as their own nodes is what makes Expand step pin → plate rather than beam → plate. `vite.config.js` gets a `joint_graph` action returning it for the app's current instances (sent with the request, as other actions do, so unsaved drags count).

A new pure `src/utils/jointLayers.js` walks the graph: `connectedFrom(graph, ids)` (Select Connected) and `layersFrom(graph, ids)` → `[[seed ids], [layer 1 ids], ...]` by breadth-first steps. Both take a `collapse` map from `partGroups.js` so a group is one node. The app, and the MCP server for `select_parts`, call the same helpers.
- Alternative considered: porting the joint graph to the browser. Rejected: it needs the BVH collision meshes and measured depths the server already loads; duplicating it is how the audit and the app would drift apart.
- When the request fails, keep the selection and show "Couldn't find connected parts: <reason>".

### 7. Locate button
`LocateFixed` (lucide) in the Outliner header. Rows get `data-row-id` and are found by query inside the list; `scrollIntoView({ block: 'nearest' })` then a manual centre when the list has room. Long press: `pointerdown` starts a 500 ms timer, `pointerup` before it fires is a click, after it fires toggles the pin and swallows the click; `pointercancel`/leave clears the timer. Pinned state in `localStorage` (`vexiq.outlinerLocatePinned`) with the same try/catch pattern as `PANELS_HIDDEN_KEY`. A `useEffect` on `primaryId` scrolls when pinned, after opening the folder (`openFolders` state set).

### 8. Inspector header and group view
The header becomes a two-line block: name (bold, ellipsis, `title` for full text) and a muted second line (catalog name · part number, "in <group>", or the part count). With a group or loose set, the body shows: group name field (groups only), set position (pivot) with nudges, quick 90° turns, and hide/lock/delete/clone; the per-part sections (color, label, mating, fastening, gear train) are not rendered.

### 9. MCP server: keeping groups
- `readAssemblyState`/`writeAssemblyState` already pass part objects through; confirm nothing rebuilds parts from a whitelist (the `update_part` handler spreads `...inst`, which keeps the fields).
- The saved state gains `selectedIds` beside `selectedId`; the server keeps both in step (any write that sets only `selectedId` sets `selectedIds` to `[selectedId]`).
- `get_assembly` adds `groupId`/`groupName` per part, `selectedIds`, and a `groups` list (id, name, part ids, centre from `setPivot` on the server's world boxes).
- `place_parts`, `mirror_subassembly`, gear train and auto-fasten create parts without group fields; mirror must drop `groupId`/`groupName` when copying a source part's fields.

### 10. MCP tools share the app's rules
The four new tools (`select_parts`, `group_parts`, `ungroup_parts`, `update_group`) and `remove_part`'s `groupId` live in `vexiq-mcp-server.mjs` and do no group logic of their own:
- Group/ungroup/rename/set-move patches come from `src/utils/partGroups.js`, imported by the server the same way it already imports `buildHistory.js`. The app and the server then can't group or turn a set differently.
- `select_parts` with `connected: true` or `expandLayers` calls `jointGraph(state)` and the `jointLayers.js` helpers (decision 6) directly; the app goes through the bridge to the same functions.
- Writes go through `writeAssemblyState` with `source: 'mcp'`, so each call is one history step and the open app gets it over the existing `/api/assembly/events` stream; the app applies `selectedIds` from that stream like it applies `selectedId` today.
- `update_group` applies all its fields in one patch list, then sets overlap flags with `checkCandidateCollision` for each moved part against parts outside the set, and replies with `summarizeAudit` like `place_parts`.
- One tool `update_group` rather than separate rename/move/turn tools: an assistant usually does several at once, and one call keeps them one undo step. Separate tools were considered and rejected for that reason.

### 11. Moving a loose selection
No extra code beyond decision 4: the pivot path runs whenever `selectedIds.length > 1`, grouped or not. Only the step label differs ("Move 5 parts" vs "Move Left Drive").

### 12. Expand / contract with Shift+wheel
- The viewport's wheel capture handler (`handleWheelCapture`) gets a new first branch: Shift held, at least one part selected, not hole picking, no copy preview, no rotate ring selected → `preventDefault` (no zoom) and call `onExpandSelection(+1 | -1)`. Wheel `deltaY` sign gives the direction; on macOS some mice report Shift+wheel as `deltaX`, so use whichever of `deltaY`/`deltaX` is non-zero. Notches are rate-limited (one step per ~120 ms) so a trackpad flick doesn't jump five layers.
- `App.jsx` keeps `expandState = { seedIds, layers, depth, graph }`. On the first step it fetches `joint_graph` once and computes `layersFrom`; later steps just change `depth` and set `selectedIds` to the union of layers `0..depth`. Any selection change not made by expand clears `expandState` (compare against the ids it last set).
- Alternatives considered: holding `E` (the user's first idea) clashes with `E` = Rotate mode; a free letter key (`Q`) works but is less discoverable than Shift, which already means "add to the selection".

### 13. Box select and the selection contour
- Box select is a mode (Select menu, `B`), like Select mode: while on, OrbitControls' rotate is off and a left-drag that doesn't start on the gizmo or a ring draws a DOM rectangle over the canvas (OrbitControls is disabled during the drag so Shift doesn't pan). On release, each visible part's mesh points (sampled to about 4000 per mesh) are projected with the pointer camera: left-to-right keeps parts wholly inside, right-to-left parts with any point inside. The ids go to `App.jsx`, which expands them to whole groups and replaces or (Shift, Select mode) adds to the selection.
- The contour is drawn per pane after the scene (both the plain and the AO paths): selected part meshes are also on a dedicated layer, rendered flat white into a mask target with only that layer, then a full-screen shader draws a bright line with a dark rim where the mask's edge is within a few pixels. It ignores depth, so it shows through other parts, and it relies on brightness, not hue. Screenshots for MCP don't go through it.

## Risks / Trade-offs

- [Set rotation composes Euler angles; repeated turns can pick a different but equal Euler triple] → Compose with quaternions and convert back with the same order as `buildWorldMatrix`; the check script turns a set 4×90° and compares world matrices, not angles.
- [Set drags check collisions for many parts per frame and may lag on 100-part groups] → Check only on drag end and on a throttle during the drag (the single-part path already throttles); members' broad-phase boxes first.
- [Every single-part branch reading `selectedId` silently turns off for sets] → Intended, but list the user-visible ones in the spec (done) and give a message where a user would expect something to happen (mate arrows, hole picking).
- [`groupName` stored on every member can disagree after an MCP writer edits one part] → `groupsOf` takes the most common name in a group and the next rename rewrites all members.
- [Shift+wheel is horizontal scroll on some systems] → Read `deltaX` too (decision 12); the viewport canvas doesn't scroll, so nothing else is lost.
- [Select Connected and Expand depend on the bridge] → The app is always served through the Vite bridge in practice; the failure message covers the static `dist` case.
- [Shift+click instead of the requested Ctrl-click] → Called out in the proposal; the Outliner does accept Ctrl/Cmd+click.

## Migration Plan

No migration: builds without `groupId` load as ungrouped. Rolling back the code leaves extra fields on parts, which the older app ignores (and old history steps that changed only those fields would show as no-op steps).
