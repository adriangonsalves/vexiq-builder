## 1. Group data and helpers

- [x] 1.1 Add `groupId` and `groupName` to `BUILD_FIELDS` in `src/utils/buildHistory.js` (missing = no group in `normalizeField`); verify `node scripts/check-history.mjs` still passes and a group-only change produces one `update` step
- [x] 1.2 Create `src/utils/partGroups.js` with `groupsOf`, `expandToGroups`, `nextGroupName`, `groupParts`, `ungroupParts`, `renameGroup` (patch lists, dissolving groups left with one part); verify with the check script in 1.4
- [x] 1.3 Add `setPivot` and `applySetTransform` (quaternion turn about a pivot, written back in Euler XYZ like `buildWorldMatrix`) to `partGroups.js`; verify with the check script in 1.4
- [x] 1.4 Write `scripts/check-part-groups.mjs` covering: group/ungroup/regroup patches, dissolve of one-part groups, name numbering, 4×90° set turn returns every part's world matrix to the start, a pin seated in a beam stays seated after a set move; verify it exits 0

## 2. Selection model

- [x] 2.1 Replace `selectedId` state in `App.jsx` with `selectedIds` (ordered, last = primary) and derive `selectedId` (single) and `primaryId`; prune ids missing from `instances`; verify every single-part feature (Inspector fields, hole pick, mate, copy-insert, rotate rings) still works with one part selected
- [x] 2.2 Send `selectedIds` alongside `selectedId` to the bridge, WebMCP context and saved state, and accept either on load; verify `get_assembly` from MCP shows the primary as `selectedId` after a multi-select
- [x] 2.3 Change the viewport's `onSelect(id)` to `onSelect(id, { additive })`, add a `selectedIds` prop, and highlight every selected part (primary stronger); verify visually with two parts selected
- [x] 2.4 In `handlePointerUp`, make Shift+click (and any click in Select mode) toggle the clicked part, skip the double-click wait, and leave the selection alone on empty space; verify Shift+click adds/removes, plain click replaces, and Shift while hole picking still steps fits backwards
- [ ] 2.5 In `App.jsx`, expand a 3D-view selection to whole groups with `expandToGroups`; verify clicking a grouped part selects the group

## 3. Select menu, keys and Select Connected

- [ ] 3.1 Add a Select menu to the toolbar (using `ToolbarMenu`/`PopoverMenu`) with Select mode, Select Connected, Select All, Select None, Invert, Group, Ungroup, with disabled states; show a Select mode indicator in the toolbar; verify each item from the menu
- [ ] 3.2 Add keys to the App keydown handler: `C`, `G`, `Shift+G`, `Ctrl/Cmd+A` (visible parts), `Esc` (Select mode off, then clear), all skipped in text fields and open dialogs; verify each key and that typing "g" in the label field does nothing else
- [ ] 3.3 Refactor the joint graph out of `auditAssembly` into an exported `jointGraph(state)` in `mcp/assembly-engine.mjs` (every part a node, fasteners included; edges for seated joints, motor–shaft, battery bay, gear meshes); have the audit build its components from it; verify `node scripts/check-mcp-tools.mjs` passes and the audit's island counts are unchanged on the BaseBot starter
- [ ] 3.4 Write `src/utils/jointLayers.js` (`connectedFrom`, `layersFrom`, group collapse) and add it to `scripts/check-part-groups.mjs`: a beam → pins → plates graph gives those three layers, a group counts as one node, an empty layer stops expansion; verify the script exits 0
- [ ] 3.4b Add a `joint_graph` action in `vite.config.js` returning `jointGraph` for the app's current instances; verify with curl on the BaseBot starter that `connectedFrom` on one side plate gives its drive side and not the other side
- [ ] 3.5 Wire Select Connected in the app: fetch `joint_graph`, run `connectedFrom`, expand to groups, show "N parts selected", "Select a part first", or the failure message; verify on the BaseBot starter in the app

- [ ] 3.6 Add Shift+wheel expand/contract: a first branch in the viewport's wheel capture (Shift, a selection, not hole picking / copy preview / ring selected; no zoom; `deltaY` or `deltaX`; ~120 ms per step) calling `onExpandSelection(±1)`; `expandState` in `App.jsx` (seed, layers, depth, fetched graph once) cleared by any other selection change; "Layer N · M parts" message; verify on the BaseBot starter: expand twice from a beam, contract once, contract past the start does nothing, a click resets, and the camera doesn't zoom

## 4. Outliner

- [ ] 4.1 Turn the Outliner list into folders + rows: folder row (arrow, name, count, hide/lock with mixed state) at its first member's place, indented member rows when open, open state kept in component state; verify with a group made in the app
- [ ] 4.2 Outliner clicks: plain selects (folder = whole group, member row = that part only), Ctrl/Cmd+click toggles, Shift+click selects a range in display order; verify each
- [ ] 4.3 Folder hide/lock apply to all members as one step; verify one undo restores all
- [ ] 4.4 Add the locate button (`LocateFixed`) with click-to-scroll (opening the folder), disabled with no selection; verify on a 100-part build
- [ ] 4.5 Add long-press pin (500 ms, pointer events, swallows the click), pressed look, `localStorage` persistence, and scroll-on-selection-change while pinned (including selections from MCP); verify pin, follow, unpin and reload

## 5. Inspector

- [ ] 5.1 Replace the "Part Inspector" header text with the selection name block: label + catalog name · part number (+ "in <group>"), group name · N parts, or "N parts selected"; ellipsis with full name on hover; verify each case
- [ ] 5.2 Add the set view of the Inspector for groups and loose sets: group name field (rename, empty refused), set position with nudges, quick 90° turns, hide/lock/clone/delete; hide per-part sections; verify rename is one undoable step

## 6. Group actions

- [ ] 6.1 Wire Group / Ungroup / Rename through `partGroups.js` patches as one `setInstances` step each, labeled "Group N parts as <name>", "Ungroup <name>", "Rename <old> to <new>"; verify in the history timeline
- [ ] 6.2 Make Delete and Clone work on the whole selection: delete all as one step; clone all with a one-pitch offset, new `groupId` and "<name> copy" for groups, copies selected; verify a cloned beam with pins keeps the pins in its holes
- [ ] 6.3 Turn off hole picking, mate arrows, double-click mating and copy-insert while more than one part is selected, with a short message when the user tries; verify each gives the message and changes nothing

## 7. Moving and turning a set

- [ ] 7.1 In the viewport, attach TransformControls to a pivot `Object3D` at the set centre when more than one part is selected; move members live from their start matrices; apply grid snap to the pivot; on drag end call a new `onUpdateSet(ids, patches, meta)`; verify dragging a group moves every part and one undo moves them back
- [ ] 7.2 Show the rotate rings on the pivot for sets (turning about the set centre, angle snap applied), committing through `onUpdateSet`; verify a 90° ring turn keeps pins seated
- [ ] 7.3 Collision for sets: ignore pairs inside the set, check members against outside parts on drag end and throttled during the drag, mark overlaps as for one part; skip flush stop and hole snap; verify a group dragged into a beam marks it overlapping and pins inside the group don't
- [ ] 7.4 No gizmo and the "Part is locked" / "Some parts are hidden" messages for sets with locked or hidden parts, and no gizmo in Explode view; verify each
- [ ] 7.4b Check the set path runs for a loose (ungrouped) multi-selection with "Move N parts" / "Turn N parts" labels and no group made; verify by Shift+clicking a beam and its pins and dragging
- [ ] 7.5 Wire Inspector set position, nudges (merged with a `mergeKey`) and quick 90° turns to `applySetTransform`; verify typing a centre X moves the whole group and repeated nudges are one step

## 8. MCP server and docs

- [ ] 8.1 Make `mirror_subassembly`, `place_parts`, gear train and auto-fasten create parts without group fields; confirm `update_part` keeps them; keep `selectedIds` and `selectedId` in step in the saved state; verify `node scripts/check-mcp-tools.mjs` passes and an MCP `update_part` on a grouped part keeps its group
- [ ] 8.2 Check the build library save/load keeps groups and older saved builds load ungrouped; verify `node scripts/check-build-library.mjs` passes and a saved grouped build reopens with its folders
## 9. MCP tools

- [ ] 9.1 Extend `get_assembly` with `selectedIds`, each part's `groupId`/`groupName`, and a `groups` list (id, name, part ids, centre); verify with a check case on a build with two groups and one without
- [ ] 9.2 Add `select_parts` (modes replace/add/remove/all/none/invert, `connected`, `expandLayers`, `expandGroups`, unknown ids refused, `connected` with `expandLayers` refused, no history step) using `jointGraph` and `jointLayers.js`; verify check cases: `connected` returns the same ids as the app's Select Connected, `expandLayers: 1` from a beam returns the beam and its pins only, and that the open app highlights the selection
- [ ] 9.3 Add `group_parts` and `ungroup_parts` using `partGroups.js` patches, one `mcp` step each, group selected after grouping, fewer than two parts refused; verify check cases for group, regroup, ungroup and undo
- [ ] 9.4 Add `update_group` (name, visible, locked, moveBy, moveCentreTo, turn) as one step, refusing locked sets, setting overlap flags against outside parts only, replying with centre and `summarizeAudit`; verify a check case turns a beam-and-pins group 90° and reports no floating or half-seated pins
- [ ] 9.5 Add `groupId` to `remove_part` (whole group, one step; both ids or unknown group refused); verify with a check case and one undo
- [ ] 9.6 Add the new tools to `scripts/check-mcp-tools.mjs`'s tool list and to `features.md`'s MCP section; verify the script exits 0

## 10. Docs and final pass

- [ ] 10.1 Update `features.md` with multi-select, Select mode, Select Connected, Shift+wheel expand/contract, moving a loose selection, groups and the locate button
- [ ] 10.2 Final pass: run all `node scripts/check-*.mjs`, then in the app make a group from Select Connected on the BaseBot starter, move it, turn it, undo, reload, and confirm with `capture_screenshot` from two views that the parts kept their places relative to one another; repeat the group, move and turn through the MCP tools and check the app shows each change live
