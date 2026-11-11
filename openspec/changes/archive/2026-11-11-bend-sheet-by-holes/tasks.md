## 1. Reproduce and fix the engine

- [x] 1.1 Reproduce the middle-of-sheet anchor on a build with a sheet and `2x10 Beam #1 (Copy)` in `scripts/check-sheet-bend.mjs`; the new check fails before the fix and the cause is noted in design.md
- [x] 1.2 Add `sheetPortId` / `targetPortId` to `sheetBendChoices` in `src/engine/sheetBending.js`: only the marked hole's row and the picked hole's line are tried; verify with a check that every returned choice has `row` equal to the marked hole's row
- [x] 1.3 Record `holesMatched` per choice (holes of the row lined up within 1 mm, marked hole required) and rank by it, then miss, then bending; verify with a check where one face lines up more holes and comes first
- [x] 1.4 Refuse a marked row at or before the last held or anchored row, with a clear reason; verify with a check on a held row and on an already bent sheet
- [x] 1.5 Pass the new parameters through `src/engine/actions.js` and `bend_sheet` in `mcp/vexiq-mcp-server.mjs`, replying with `holesMatched`; verify with an MCP-level check and that calls without them give the same choices as before (existing checks in `node scripts/check-sheet-bend.mjs` still pass)

## 2. Picking in the view

- [x] 2.1 Add the sheet-hole mark (own colour, Alt+click on a sheet hole, clear on `Esc` or Alt+click again or when the sheet goes) in `src/components/Viewport3D.jsx`; verify in the running app (port 5173) that it marks and clears
- [x] 2.2 Alt+click on a hole of another part with a sheet hole marked calls `sheet_bend_choices` and shows the best fit as the preview with the target holes ringed; verify in the app on the Flop starter and on a plain sheet beside a 2x10 Beam
- [x] 2.3 Fit stepping (wheel, `R`, `Shift+R`) and banner "Fit N of M: K holes line up", click keeps as one history step "Bend <sheet>", `Esc` cancels and keeps the mark; verify undo flattens it and the message for each no-fit reason shows
- [x] 2.4 Tools → Bend sheet starts hole marking when a sheet hole is marked and keeps opening the dialog when it isn't (`src/components/ToolsMenu.jsx`, `src/App.jsx`); verify both routes in the app

## 3. Docs and wrap-up

- [x] 3.1 Update `features.md` (Bend sheet section and MCP `bend_sheet` line) and the MCP tool description; verify the text matches the behaviour
- [x] 3.2 Run `node scripts/check-*.mjs` and confirm all exit 0; capture a screenshot of the bent sheet from two views in the app
