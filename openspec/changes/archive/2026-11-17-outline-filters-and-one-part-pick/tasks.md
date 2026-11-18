## 1. Ctrl/Cmd+click picks one part in the 3D view

- [x] 1.1 In `Viewport3D.jsx` pointer-up, a single Ctrl+click (Cmd+click on macOS) on a part schedules `select(front, { additive: true, exact: true })` on the pending-select timer; Ctrl/Cmd+click on empty space does nothing; on macOS Ctrl+click selects nothing. Verify in the app: with the right drive motor selected, Cmd+click the left motor in "Left Drive" selects just the two motors; Ctrl/Cmd+click a selected grouped beam removes only it
- [x] 1.2 Cancel that pending toggle from `handleCopyPointerUp` (second click) and from `handleDoubleClick` (Ctrl/Cmd); verify in the app that Cmd+double-click on a lit free hole with a pin selected inserts a copy and leaves the beam unselected, and that `node scripts/check-*` copy-insert checks still pass

## 2. Outline filters

- [x] 2.1 Write `scripts/check-outline-filter.mjs` (Electronics in/out list incl. motor shafts and caps, locked, hidden, colour, chips combined with search, folder kept only for passing parts, colours in build by count) and `src/utils/outlineFilter.js`; verify the check passes
- [x] 2.2 Add the chips row (Electronics, Locked, Hidden, Colour with swatch menu, Clear filters) and Select shown to `AssemblyOutliner.jsx`, using the helper for rows and the title count; verify in the app on desktop and the phone layout (one sideways-scrolling row) that the Electronics filter on the Simple drivetrain shows "2 / 84", Hidden + Select shown selects the hidden parts, and filters are gone after a reload

## 3. Help and wrap-up

- [x] 3.1 Update `src/help/pages/selecting.md` (Ctrl/Cmd+click picks one part; why a search can match parts named after another part) and `outline.md` (filters, Select shown), `src/help/coverage.json`, `src/help/controls.js` chips; verify `check-help.mjs`, `check-help-tags.mjs`, `check-help-context.mjs` pass
- [x] 3.2 Run every `node scripts/check-*.mjs` and verify all pass
