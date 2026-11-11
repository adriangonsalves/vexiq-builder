## Why

Bend sheet today works from a part selection: select the sheet and a target part, open a dialog, pick from a list of "sheet row N → part" choices. Two problems:

- **It anchors the wrong place.** Trying to bend a sheet over `2x10 Beam #1 (Copy)` anchors the middle of the sheet to the beam. The tool decides which sheet rows count as already held and which row meets the beam, and the builder can't say where the bend should start or which holes should meet.
- **The builder knows the holes, not the rows.** "This sheet hole goes onto that beam hole" is how people think about it, and the Alt+click hole target already works that way for placing parts.

## What Changes

- **Pick the sheet hole first.** With a plastic sheet in the build, the builder marks one of its holes and starts bending from the Tools menu (or by Alt+click on the sheet hole, then Tools → Bend sheet). That hole's row is the row that will be anchored. The row's line is the bend line.
- **Then pick a hole on any other part.** Alt+click a hole on any other part (a beam, a plate, another sheet's hole) and ask it to bend. The sheet is bent so the marked sheet hole lands on the picked hole and as many holes as possible of that row line up with the part's holes along the line.
- **Best match wins, automatically.** The tool tries each face of the part and each way the sheet can curve, and shows the one that lines up the most holes (then least bending, least stretch). Mouse wheel / `R` steps through the other fits that work, like hole-target placement does ("Fit 2 of 3: 3 holes line up"). A click keeps it as one history step; `Esc` cancels.
- **No more wrong anchor.** The row anchored is always the one of the marked sheet hole, never a row picked by the tool. Rows already pinned stay flat; the sheet doesn't bend between its held rows. When nothing can be bent, a message says why (nothing pinned yet, holes not parallel, out of reach, too tight, would pass through a part).
- The list dialog is kept as a fallback for a sheet and a part selected together with no hole marked (as today), so existing builds, MCP use and Flop's intake keep working.
- MCP `bend_sheet` gains optional `sheetPortId` and `targetPortId` to do the same by hole.

Out of scope: touch devices (no Alt key), bending a sheet onto two parts in one go (do it one anchor at a time, as today), rows of a sheet that aren't the sheet's hole rows.

## Capabilities

### New Capabilities
- `sheet-bend-by-holes`: bending a plastic sheet by marking one of its holes and a hole of another part, choosing the fit that lines up the most holes.

### Modified Capabilities

None. The existing sheet-bending behaviour is in the not-yet-archived `shaped-parts-and-sheet-bending` change; this change adds a second way in and leaves its rules (how a sheet bends, held rows, stacking, flex) as they are.

## Impact

- `src/engine/sheetBending.js`: choices limited to a given sheet row and target hole, counting holes that line up; a bug fix for which rows count as held.
- `src/engine/actions.js`, `mcp/vexiq-mcp-server.mjs`: new optional hole parameters; reply gains `holesMatched`.
- `src/components/Viewport3D.jsx`, `src/App.jsx`, `src/components/ToolsMenu.jsx`: marking the sheet hole, using the Alt+click target as the second hole, fit stepping and banner, reuse of `BendSheetDialog` preview rings.
- `scripts/check-sheet-bend.mjs`: new checks. `features.md`: describe it.
