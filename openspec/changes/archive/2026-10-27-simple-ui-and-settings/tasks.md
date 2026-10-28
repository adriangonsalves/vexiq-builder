## 1. Settings store

- [x] 1.1 `src/utils/appSettings.js` (defaults, normalize); `/api/settings` GET/POST with a `settings` SSE event in `vite.config.js`; `public/app-settings.json` in `.gitignore`; `readAppSettings()` in the engine (`VEXIQ_SETTINGS_PATH`). Verify: GET returns the defaults without a file, and POST round-trips and is normalized.

## 2. History setting

- [x] 2.1 `recordStep` `linear` option, passed by App `setInstances`, the bridge and the MCP server from the settings (design.md §2). Verify: `check-history.mjs` gains linear cases (A, B, C, undo twice, add D: B and C gone, redo off; undo three times then redo twice) and the branch cases still pass.

## 3. Assistant setting

- [x] 3.1 The MCP server refuses changing tools when off, and reading tools still answer; the bridge refuses MCP posts (423); WebMCP refuses (design.md §3). Verify: `check-mcp-tools.mjs` cases for off (place_part refused, state and history unchanged; get_assembly answers), back on (place_part works), and the bridge's 423.

## 4. View cube

- [x] 4.1 Cube drag to orbit, double-click to the opposite face, right-click with `onCubeMenu` (design.md §4). Verify in the browser, on a test server: dragging the cube orbits without selecting; a 3 px wobble still clicks; double-clicking Top ends looking up; right-clicking shows the menu with no browser menu.
- [x] 4.2 `ViewMenu.jsx`: projection, layout, stereo controls, Grid, Axes; the View button in Stereo. Verify in the browser: Orthographic from the menu, Grid off keeps the menu open, Stereo → Single through the View button.

## 5. Toolbar, Settings panel, Inspector

- [x] 5.1 `ToolbarMenu.jsx` Snap and Explode drop-downs; the toolbar order from the spec; Grid, Axes, Shadows, AO and the layout buttons removed from the toolbar. Verify: the `X` key updates the Explode drop-down, and picking 0.25P snaps by 3.175 mm.
- [x] 5.2 `SettingsPanel.jsx` (Display, History, Assistant, Advanced) wired to the settings and viewport states; the gear button. Verify: the Shadows switch works; advanced on shows the History and Assistant sections; changing a setting adds no history step; a second tab follows.
- [x] 5.3 Advanced gating of the Smart Assembly and metadata sections and the MCP badge; the message strip over the view replacing the toast. Verify: in simple mode a mesh message shows over the view and fades; advanced on shows the sections as before.

## 6. Docs and checks

- [x] 6.1 Update `features.md` (where each control went, Settings, advanced options, linear history, assistant off). Run `npm run build`, `check-history.mjs`, `check-mcp-tools.mjs`, `check-pin-hole-alignment.mjs` and `check-gear-meshing.mjs`; all pass.
