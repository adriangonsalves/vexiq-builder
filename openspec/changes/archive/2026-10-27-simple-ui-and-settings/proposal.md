## Why

The screen has grown crowded:
- The toolbar has about 30 buttons in one row: pitch, explode, grid, axes, shadows, AO, projection, layouts and stereo controls.
- The Inspector's lower half has tool cards and metadata most users never need.

The app should be easy for middle school students by default. Advanced tools and settings should still be there, out of the way, for parents and older builders to turn on.

## What Changes

- **View cube does more:**
  - dragging on the cube turns the view;
  - double-clicking a face looks from the opposite side;
  - right-clicking it opens a view menu: perspective or orthographic, Single, 4-View or Stereo (with stereo's cross-eyed, depth and full screen), Grid and Axes.
- **Shorter toolbar:**
  - Pitch snap and Explode become small drop-down menus showing the current choice.
  - Projection, layout, stereo, Grid and Axes move to the cube menu.
  - Shadows and AO move to Settings.
- **Settings panel:** a gear button opens it, with:
  - **Display:** Shadows, Ambient occlusion.
  - **History:** linear (the default: a change after undo drops the undone steps), or keep branches (today's behaviour).
  - **Assistant:** MCP on or off. Off means the app ignores the assistant: MCP tools that would change the build reply that it is off, and nothing reaches the build.
  - **Advanced options:** a single switch, off by default, with no password. It shows the extra parts of the app: the Smart Assembly tools, the CAD & Semantic Metadata section, the MCP status badge, the branch choice in History, and the Assistant section.
- **Calmer Inspector:** with advanced options off, the "Smart Assembly & Fastening" and "CAD & Semantic Metadata" sections are hidden. Action messages ("Meshed …", "Mated with …") move out of the Smart Assembly section into a message strip over the view, so they still show.
- **Saved settings:** History, Assistant and Advanced options live in one settings file shared by the app, the Vite bridge and the MCP server, so the MCP and history choices apply to every writer. They are not part of the build. Shadows and AO stay in the saved viewport settings as today.
- **Out of scope:** new tools, a parent PIN, theming, changing what the 3D tools themselves do.

## Capabilities

### New Capabilities
- `view-cube-menu`: dragging the cube to turn the view, double-click for the opposite face, and the right-click view menu.
- `app-settings`: the Settings panel, the advanced options switch and what it reveals, display and MCP settings, the compact toolbar menus, the calmer Inspector, the message strip, and where settings are saved.

### Modified Capabilities
- `camera-views`: the cube requirement gains drag, double-click and the menu; projection and layout controls move from the toolbar to the cube menu; the hide-panels toggle stays in the toolbar.
- `build-history`: "Branches are kept" applies only when the History setting is set to keep branches. The default is linear, where a change after undo drops the undone steps.
- `history-timeline`: editing after scrubbing back follows the History setting; branch markers only appear when branches are kept.
- `four-view-layout`: the layout choice moves from the toolbar to the cube menu (and a Stereo-only View button).
- `render-shadows`, `render-ambient-occlusion`: the toggles move from the toolbar to Settings.
- `mcp-app-link`: with MCP off, changing tools refuse and report it.

## Impact

- **`src/App.jsx`:**
  - toolbar restructure (drop-down menus);
  - Settings panel and its state;
  - advanced gating of the Inspector sections;
  - the message strip;
  - the MCP badge;
  - loading and saving settings.
- **`src/components/Viewport3D.jsx`:** cube drag-to-orbit, double-click and right-click with the menu's position; a new `ViewMenu` component for the menu.
- **`src/utils/buildHistory.js`:** `recordStep` takes a linear option that drops the undone steps.
- **`vite.config.js`:** `/api/settings` (GET and POST), a settings file (`public/app-settings.json`, ignored by git), refusing MCP posts while MCP is off, and linear history for MCP steps.
- **`mcp/vexiq-mcp-server.mjs`, `mcp/assembly-engine.mjs`:** read the settings file; changing tools refuse when MCP is off; steps follow the History setting.
- **`src/utils/webMcpTools.js`:** the in-browser tools refuse when MCP is off.
- **Checks:** `check-history.mjs` (linear mode), `check-mcp-tools.mjs` (MCP off), and a browser run for the cube and Settings.
- **Docs:** `features.md`.
