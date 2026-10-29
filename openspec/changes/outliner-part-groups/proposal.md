## Why

Builds now run to a hundred or more parts (the BaseBot starter, the Clawbot), and the app only knows one part at a time: the Inspector doesn't say which part it is showing, the Assembly Outliner is a flat list you have to hunt through, and moving a finished sub-assembly (a drive side, a claw) means moving every beam, pin and shaft in it one by one. Selecting several parts and grouping them into a named component fixes all three, and sets up components that can later be mated as a whole.

## What Changes

- **Inspector names the selection.** The Part Inspector header shows the selected part's label, catalog name and part number (or, for a group, its name and part count; for several loose parts, how many are selected).
- **Locate in the Outliner.** A small locate button in the Outliner header scrolls the selected part's row into view, opening its group folder if needed. A long press pins it: while pinned, every new selection is scrolled to. The pinned state is remembered per browser.
- **Selecting several parts.**
  - In the 3D view, **Shift+click** adds or removes a part from the selection.
  - In the Outliner, **Ctrl/Cmd+click** adds or removes a row and **Shift+click** selects a range.
  - A new **Select** menu in the toolbar with a **Select mode** toggle: while on, a plain click in the 3D view adds or removes parts, no modifier needed.
  - **Select Connected** (in the Select menu, and key `C`): selects every part joined to the selected part(s) through seated pins, pegs and shafts, using the same joint rules as the audit, including the fasteners that join them.
  - **Expand / contract selection:** with parts selected, Shift + mouse wheel over the 3D view grows the selection one layer of joined parts per notch (beam → its pins → the parts those pins go into …) and the other direction takes layers back off. It uses the same joint rules as Select Connected.
  - Select All, Select None and Invert also go in the Select menu.
- **Moving several parts without grouping.** Any multi-selection, grouped or not, moves and turns as one with the Move arrows, rotate rings, nudges and quick 90° turns.
- **Groups.** The Select menu (and `G` / `Shift+G`) groups the selected parts into a named component or ungroups the selected group.
  - A group shows as a folder in the Outliner that opens and closes, with its own hide/lock buttons and a part count; the name can be changed in the Inspector.
  - Clicking any part of a group in the 3D view selects the whole group. One part inside can be picked from the folder in the Outliner.
  - A selected group (or several loose selected parts) moves and turns as one with the Move arrows, the rotate rings, the nudge buttons and the quick 90° turns, about the centre of the parts. Clone and Delete act on the whole group.
  - Grouping, ungrouping and renaming are each one undoable step; groups are saved with the build and kept by the MCP server.
- **The same over MCP.** An assistant can do everything above through MCP tools, and the app shows the result live:
  - `select_parts`: replace, add to, remove from, select all, select none or invert the selection, select connected parts, or expand by n layers; returns what is selected. No undo step.
  - `group_parts` / `ungroup_parts`: make or break up a group from part ids or the current selection.
  - `update_group`: rename, hide/show, lock/unlock, move by a distance, move the centre to a point, or turn about the centre, for a group or a list of parts, as one undo step; replies with the short check summary `place_parts` gives.
  - `remove_part` takes a `groupId` to delete a whole group.
  - `get_assembly` reports `selectedIds` and every group (id, name, parts, centre).
- **Decided against what was asked:** the request named Ctrl-click for multi-select. In the 3D view Ctrl/Cmd is already taken by copy-insert (Ctrl/Cmd held previews copies, Ctrl/Cmd+double-click inserts them), and on macOS Ctrl+click is a right-click that switches Move/Rotate. So the 3D view uses Shift+click, while the Outliner, where nothing conflicts, uses Ctrl/Cmd+click.
- **Not in this change (planned later):** mating or snapping a whole group to other parts (hole snap, double-click mate, hole picking and copy-insert stay single-part and are off while a group is selected), groups inside groups, cloning a group over MCP (`mirror_subassembly` and `place_parts` cover copying), and the in-page assistant's tool list (`webMcpTools.js`). The design notes how groups are stored so group mating can be added without changing the saved format.

## Capabilities

### New Capabilities
- `inspector-selection-name`: the Inspector header names what is selected (one part, a group, or several parts).
- `outliner-locate`: the Outliner's locate button, its long-press pin, and scrolling the selection into view.
- `multi-select`: selecting several parts by Shift+click, Outliner Ctrl/Cmd/Shift+click, Select mode, Select Connected, Shift+wheel expand/contract, the Select menu, and moving and turning a multi-selection without grouping it.
- `part-groups`: grouping and ungrouping, group folders in the Outliner, selecting a group, and moving, turning, cloning, deleting, hiding and locking a group as one.
- `mcp-selection-groups`: MCP tools to select parts (including connected parts), group, ungroup, rename, hide, lock, move, turn and delete groups, and the selection and groups in `get_assembly`.

### Modified Capabilities
- `build-history`: grouping, ungrouping and renaming a group are added to the changes that record a step.

## Impact

- `src/App.jsx`: selection becomes a list (`selectedIds`) with a primary `selectedId` kept for everything single-part; the Outliner becomes a tree with folders and the locate button; the Inspector header and a group view of the Inspector; Select menu in the toolbar; group/ungroup/rename handlers; keys `C`, `G`, `Shift+G`, `Ctrl/Cmd+A`.
- `src/components/Viewport3D.jsx`: Shift+click and Select-mode clicks; highlight for every selected part; the Move gizmo and rotate rings on a pivot for a set of parts; collision checks that ignore parts in the same moving set; hole snap, mate arrows, hole picking and copy-insert off while more than one part is selected.
- `src/utils/buildHistory.js`: `groupId` and `groupName` become build fields so group changes are steps.
- New `src/utils/partGroups.js` (pure): group helpers, pivot, applying a move/turn to a set of parts.
- `mcp/assembly-engine.mjs` + `vite.config.js`: the audit's joint graph is split out as `jointGraph` and exposed as a `joint_graph` action for Select Connected and Expand; new pure `src/utils/jointLayers.js` walks it for the app and the server; reads and writes keep `groupId`/`groupName`; the saved state gains `selectedIds`.
- `mcp/vexiq-mcp-server.mjs`: new tools `select_parts`, `group_parts`, `ungroup_parts`, `update_group`; `remove_part` gains `groupId`; `get_assembly` reports `selectedIds` and groups. The server uses the same `partGroups.js` helpers as the app.
- `scripts/check-mcp-tools.mjs`: cases for the new tools.
- `features.md`: describe selection, groups and the locate button.
- New check: `scripts/check-part-groups.mjs`.
