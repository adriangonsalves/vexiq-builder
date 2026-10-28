## Context

See proposal.md. The current state:
- **Toolbar** (`src/App.jsx`, the `<header>`): one wrapping row of groups.
  - Undo, Redo, History; Move, Rotate.
  - Pitch (4 buttons) and Explode (5 buttons).
  - Grid, Axes, Shadows, AO, Focus.
  - Projection and layout (3 buttons), plus Cross-eyed, Depth and Full screen in Stereo; Wide.
  - Starter, Audit, Save, Load.
- **Inspector:** "Smart Assembly & Fastening" holds four tool cards and also the `actionFeedback` toast, so messages only show while a part is selected. "CAD & Semantic Metadata" sits below it.
- **View cube** (`Viewport3D.jsx`): its own scene. Capture-phase pointer handlers on `inputEl`, a click (≤ 5 px) calls `animateViewTo(direction)`, hover highlights, and it is hidden in Stereo.
- **History** (`src/utils/buildHistory.js`): `recordStep` always keeps undone steps as a branch. Steps are recorded by:
  - App's `setInstances`;
  - the Vite bridge (`mergeBrowserSave`, MCP pushes);
  - the MCP server's `writeAssemblyState`.
- **MCP:** the server writes `public/assembly-state.json` and POSTs to `/api/assembly`, and the bridge broadcasts over SSE. WebMCP tools in `src/utils/webMcpTools.js` call App handlers.
- **Shadows and AO** are viewport settings, saved in `assembly-state.json` `viewport` and set by `configure_viewport`.

## Goals / Non-Goals

**Goals:**
- A short toolbar and a calm Inspector by default.
- One advanced switch, plus a few real settings.
- The history and assistant settings bind every writer: app, bridge, MCP server.

**Non-Goals:** a parent PIN, theming, rearranging the part library, changing how any 3D tool works.

## Decisions

### 1. One settings file
- **The file:** `public/app-settings.json`, ignored by git: `{ advanced: false, history: 'linear' | 'branches', mcpEnabled: true }`.
- **`src/utils/appSettings.js`:** pure `DEFAULT_SETTINGS` and `normalizeSettings` (unknown keys dropped, bad values replaced by defaults).
- **The bridge:** `GET` and `POST /api/settings` read and write the file and broadcast a `settings` SSE event so other tabs update.
- **The MCP engine:** exports `readAppSettings()`, reading the file on every call; `VEXIQ_SETTINGS_PATH` overrides the path for checks.
- **The app:** loads settings at start. Without a bridge (a static build) it falls back to localStorage.
- **Not in the file:** Shadows and AO stay in the viewport settings. The Settings panel edits those same states, so `configure_viewport` keeps working.

### 2. Linear history
`recordStep(history, before, after, { …, linear })`: when `linear` is set and the head has children, every step below the head is removed before the new step is added, and `activeChild` entries pointing into the removed steps are cleared. Every writer passes `linear: settings.history !== 'branches'`:
- App `setInstances`;
- the bridge (MCP pushes and `mergeBrowserSave`'s recording);
- the MCP server's `writeAssemblyState`.

Old branches elsewhere in the tree are untouched. Undo and redo are unchanged. `check-history.mjs` gains the linear cases.

### 3. Assistant off
- **The MCP server:** `READ_ONLY_TOOLS = { search_parts, get_part_details, get_assembly, get_history, audit_assembly, capture_viewport_views }`. Before dispatching any other tool it reads the settings and, when `mcpEnabled === false`, returns `{ isError: true, error: "The assistant is turned off in the app's Settings (Assistant). Turn it on there to make changes." }`.
- **The bridge:** refuses `POST /api/assembly` with a non-browser source while off (HTTP 423).
- **WebMCP:** tools check the settings ref and refuse the same way.

### 4. View cube
In the capture-phase handlers:
- **Press:** stores `{ index, x, y, lastX, lastY, dragging: false }`.
- **Move:** past 5 px, the press becomes a drag, which orbits by spherical deltas about `orbit.target` like OrbitControls: `2π·dx/height` around, `2π·dy/height` up and down, clamped to its polar limits. The pointer is captured so the drag continues off the cube.
- **Release:** without a drag it is a click. A second click on the same cube index within 350 ms is a double-click, which calls `animateViewTo(-direction)`.
- **Right-click:** a `contextmenu` listener in capture phase on a cube hit calls `preventDefault()` and the new `onCubeMenu({ x, y })` prop. It runs before Rotate mode's right-click on the selected part.
- **The menu:** a new component `src/components/ViewMenu.jsx`, rendered by App at that point, clamped into the window. The same component opens from the Stereo-only View button.

### 5. Toolbar menus and the message strip
- **`src/components/ToolbarMenu.jsx`:** a small drop-down (a button with a label and the current value; a list; `Esc` and outside clicks close it). Used for Snap and Explode.
- **Moved:** Grid and Axes go to `ViewMenu`; Shadows and AO to the Settings panel (`src/components/SettingsPanel.jsx`, a `<dialog>` like the audit dialog).
- **`actionFeedback`:** rendered as a strip absolutely positioned at the top of the viewport area. It clears after 4 s (a timer reset on each new message). It is removed from the Smart Assembly section.
- **Advanced gating:** `settings.advanced` wraps the two Inspector sections and the MCP badge.

## Risks / Trade-offs

- **Users looking for moved buttons** → the cube's tooltip says "Drag to turn · double-click: other side · right-click: view options"; the View button covers Stereo; `features.md` lists where each control went.
- **Linear history drops steps that can't come back** → that is the requested default; Keep branches is one switch away (advanced).
- **A stale settings file during MCP calls** → it is read on every call, and it's tiny.
- **Cube drag vs. click** → the 5 px threshold matches the existing click rule.

## Migration Plan

Without a settings file, the defaults apply (advanced off, linear, MCP on). Saved shadows and AO keep working as before. There is nothing to migrate in builds.
