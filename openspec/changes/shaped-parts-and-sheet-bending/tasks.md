## 1. Shaped parts (groundwork)

- [ ] 1.1 `src/utils/shapedParts.js`: the shape-kind registry (`accepts`, `check`, `shapeMesh`, `shapePorts`, `mirror`, `describe`, `verb`) and `shapeKey`; verify with a unit check in `scripts/check-sheet-bend.mjs` that the same settings give the same key and rounding noise below 0.001 doesn't change it
- [ ] 1.2 `partOf(instance)` in `src/engine/core.js` returning the catalog part or a cached derived part (`<partId>~<shapeKey>`, shaped ports and box, bounded cache); `readPartGlb` shapes the base GLB for derived ids; verify a plain build's audit and overlap results are byte-for-byte the same as before (`node scripts/check-*.mjs` all pass)
- [ ] 1.3 Swap every instance lookup in core.js and `mcp/vexiq-mcp-server.mjs` (`catalogById.get(inst.partId)` and the like) for `partOf`; verify by grep that no instance-based catalog lookup is left, and the check script's bent sheet gives shaped world holes, box and collisions
- [ ] 1.4 `loadPartAsset` in `src/utils/geometryCache.js` and the viewport build meshes for derived parts; verify in the app (port 5173) that a sheet given a bend by hand in `assembly-state.json` is drawn bent and a flat copy beside it stays flat
- [ ] 1.5 `shape` in `BUILD_FIELDS` (`src/utils/buildHistory.js`) with the kind's verb in the timeline; copy, paste, duplicate and mirror carry it (mirror through the kind's `mirror`); verify undo/redo of a bend and a mirrored bent sheet's holes against the originals in the check script
- [ ] 1.6 Saved builds, library builds, starters and the static site keep `shape`; `scripts/save-starter.mjs` writes it as an optional eighth column and `src/starters.js` reads it; verify a build with a bent sheet survives save and reload in the app and the static preview (port 5174)

## 2. Bent sheet shape

- [ ] 2.1 `src/utils/sheetBend.js`: rows of a sheet (index → distance along the sheet, holes per row) for the 2x12, 6x6 and 6x12, both directions; verify row counts and 12.7 mm steps in the check script
- [ ] 2.2 The curve: straight through held rows, one least-bending cubic piece per anchor with the exact length plus stretch, straight to the edge, 3 mm tightest-radius check; verify length 75.9 ± 0.1 mm, under 1° turn across each anchored row, and refusal of a too-tight anchor
- [ ] 2.3 Cut the mesh into 1 mm strips across the bend, map points and normals through the curve table, map ports (origin and axis); register it as the `sheet-bend` kind; verify every bent hole's axis is perpendicular to the sheet where it is and the bent mesh's thickness stays 0.25 mm
- [ ] 2.4 Compare with VEX: a check that bends the test robot's (Flop's) two sheets through their pinned rows on the Flop starter's parts and measures against VEX's sheet meshes when `.cache/cad-projects` has them (skipped otherwise); verify mean distance within 1.5 mm

## 3. Choices and applying a bend (engine)

- [ ] 3.1 Held rows from seated pins and lined-up holes (and a bent sheet's own held and anchored rows); "pin one row of the sheet first" when none; verify on Flop's 6x12 (rows 1–2) and an unpinned sheet
- [ ] 3.2 Target hole lines parallel within 3°, faces, stacking layers, row matching within 1 mm along the bend line, reach with up to 1 mm stretch, refusal reasons (twist, out of reach by N mm, too tight); verify "sheet row 4 → 1x12 Beam" on Flop's 6x12 is offered within 0.5 mm, a 10°-off beam is refused for twist
- [ ] 3.3 Clearance: pose each choice and drop those that hit a part (leaving out pins in the sheet and stacked sheets), with a count and the first part hit; verify a beam placed across the curve's path removes that choice
- [ ] 3.4 `bend_sheet` in the engine: apply a choice, move pins seated in the moving part, move a loose target when asked, flatten; one history step; verify pins stay seated after bend and flatten, and a 4 mm-off loose beam moves to the row
- [ ] 3.5 Stacking: Flop's 6x6 at row 6 over the 6x12 sits 0.1 mm off it; verify the measured gap and no overlap between the two sheets

## 4. App: Tools → Bend sheet

- [ ] 4.1 Tools menu item with hover text when the selection isn't one sheet plus one part; engine actions reachable through `src/backend` (`sheet_bend_choices`, `bend_sheet`); verify the item greys out and in with the selection
- [ ] 4.2 Dialog (draggable, like the chain over/under dialog): choices by name with miss and stretch, target holes highlighted, see-through preview for the pointed or picked choice, Apply / Cancel / Flatten, reasons when there are none; verify headless (Chrome over the debugging protocol) on Flop: pick row 4 on the 1x12 Beam, Apply, Undo, Redo, with screenshots from two views
- [ ] 4.3 Inspector shows a bent sheet's description and stretch; verify on the bent Flop sheet

## 5. MCP

- [ ] 5.1 `bend_sheet` tool (list, apply by choice or by sheet row and target holes, move target, flatten) with the post-placement check; `get_assembly` and `get_part_details` report `shape`; verify by calling it on Flop: list for the 1x12 Beam, apply row 4, audit, screenshot

## 6. CAD import (tested on Flop)

- [ ] 6.1 `"bend": "pins"` in `public/cad-frames.json` for 228-7711-711 and -712; `scripts/import-cad.mjs` groups the sheet's pins into rows, finds the held end, the flat pose and row indices, and anchors the later rows through the engine; report lists stretches and unanchored rows; verify a dry run on Flop reports both sheets bent with the 0.6 mm stretch at the 6x12's row 6
- [ ] 6.2 Import Flop, audit (every sheet pin seated, no overlaps), compare with VEX's meshes, screenshots from two views; save it again with `node scripts/save-starter.mjs flop Flop`; verify `scripts/check-build-library.mjs` (Flop starter: no overlaps, both sheets bent)

## 7. Docs and checks

- [ ] 7.1 `features.md` (shaped parts, Bend sheet, stacking, stretch), `AGENTS.md` "How pieces are used" (how sheets bend and stack, use `bend_sheet`), the MCP tool descriptions
- [ ] 7.2 Run every `node scripts/check-*.mjs` and `npm run build`; verify all pass
