## Why

VEX IQ plastic sheets are meant to be bent: robots use them as ramps, scoops and guards, held flat on one or two rows of holes and curved onto beams or other sheets. The library only has flat sheets, and every copy of a part in the app shares one shape, so there is no way to build a bent sheet, and the CAD import can only place a bent sheet flat or leave it out. The 2026-27 Herobot Flop, used here as the test robot, shows both: its 6x12 intake sheet is left out (flat, it went 4.4 mm into a beam) and its 6x6 is placed flat, wrong for its lower half. Wires, rubber bands and ropes will need the same thing later: a part whose shape belongs to that one copy.

An exploration in this session showed the approach works. A sheet bent through its pinned rows, with one smooth curve between rows that leaves each row in line with the sheet and keeps the sheet's real length, comes out within about 0.5 mm on average of VEX's own bent sheets on the test robot. VEX's sheets are stretched (rows 26.0 and 27.1 mm apart where the holes are 25.4 mm apart), so a curve that keeps the real length is more realistic than VEX's.

## What Changes

- **Shaped parts (groundwork):** a part copy can carry its own shape, saved with the build and kept in history. The app and the MCP server draw it, check overlaps against it, and place its holes from it, so pins seat, the audit, explode and screenshots all use the shaped part. The first kind of shape is a bent sheet; the mechanism is written so wires, rubber bands and ropes can be added as further kinds without touching drawing, overlap checks or saving again.
- **Bent sheets:** a plastic sheet (2x12, 6x6, 6x12) bends along a line parallel to its rows, never twisting. Rows already pinned stay flat; between each anchored row the sheet follows a smooth curve that leaves each row in line with the sheet there and is exactly as long as the sheet between those holes; past the last anchored row it runs straight. Holes move with the sheet.
- **Tools → Bend sheet:** select a sheet and the part to anchor it to. The tool finds rows of holes on that part that match a later row of the sheet to within about 1 mm, can be reached with the sheet's length, and are parallel to the bend. Each choice is highlighted in the viewport and named ("sheet row 4 → this face of the 1x12 Beam"); the user picks one, sees it, and applies it. Run it again to anchor further rows. A target that only just misses (up to about 1 mm) is accepted, with the sheet stretched by that much between the two rows so the pins seat, and the stretch reported; a target farther off is refused with the reason, and when nothing else holds the target part the tool offers to move it to the sheet.
- **Stacked sheets:** when another sheet already lies on that face, the new sheet sits one sheet thickness plus 0.1 mm farther out, so both pin through the same holes without overlapping.
- **Refusals:** a row that would need a twist, a row out of reach, or a curve that would pass through a part is refused with the reason.
- **MCP:** a `bend_sheet` tool does the same (list the choices, or anchor a named row to a named part's holes), and `get_assembly` / `get_part_details` report a sheet's bend.
- **CAD import:** a sheet that is bent in VEX CAD is placed bent, anchored through the rows its sheet pins go through, instead of flat or dropped. The Flop starter, the test robot, is saved again with its bent sheets.
- **Unshaped sheets keep working as now;** a bend can be removed to make the sheet flat again.

## Capabilities

### New Capabilities

- `shaped-parts`: a part copy with its own shape (saved, in history, undoable), drawn, overlap-checked and holed from that shape in the app and the MCP server; a list of shape kinds that later kinds (wires, rubber bands, ropes) join.
- `sheet-bending`: how a plastic sheet bends through anchored rows (flat pinned rows, a smooth curve of the sheet's real length between rows, straight past the last), the Bend sheet tool and its choices, stacking, tolerances and refusals, and the `bend_sheet` MCP tool.

### Modified Capabilities

- `cad-import`: sheets bent in VEX CAD are imported bent through their pinned rows rather than placed flat or left out.

## Impact

- `src/engine/core.js`: geometry, collision meshes, measurements and world holes are looked up per part copy when it has a shape, not only per catalog part (about 13 lookups); the caches are keyed by part and shape.
- New `src/utils/shapedParts.js` (shape kinds, shape keys) and `src/utils/sheetBend.js` (bend curve, mesh cutting and bending, bent holes, finding anchor choices), shared by the browser and Node.
- `src/utils/geometryCache.js`, `src/components/Viewport3D.jsx`: load a shaped copy's mesh; highlight anchor choices.
- `src/components/BuildMenu.jsx` (or its Tools menu): Bend sheet dialog.
- `src/utils/buildHistory.js`: a new build field for the shape.
- `mcp/vexiq-mcp-server.mjs`: `bend_sheet` tool; shapes in assembly output.
- `scripts/import-cad.mjs`, `public/cad-frames.json`, `scripts/save-starter.mjs`, `src/starters.js`, `src/starters/flop.js`: bent sheets in the import, starter rows with a shape column, the Flop test starter saved again.
- New check script `scripts/check-sheet-bend.mjs`; `features.md`; `AGENTS.md` (how sheets are bent and stacked).
