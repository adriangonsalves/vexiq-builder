## Context

See proposal.md. Today:
- **One build:** `public/assembly-state.json` holds it, along with its history and viewport. The app, the Vite bridge and the MCP server all read and write it, and the app syncs over `/api/assembly` (POST, with `baseHistoryRev` against conflicts) and SSE.
- **localStorage:** the app also keeps the parts in localStorage (`vexiq_builder_assembly_v2`), which is never read back.
- **Save** downloads a `.vexiq.json` (`handleExportJson`). **Load** reads one, replacing the build and its history (`handleImportJson`). **Starter** replaces the build with `buildStarterAssembly`.
- **Screenshots:** the viewport can render a screenshot (`screenshotRef`, used by MCP `capture_screenshot`).
- **Toolbar menus:** `ToolbarMenu` / `PopoverMenu` (simple-ui-and-settings) are the toolbar's drop-downs.

## Goals / Non-Goals

**Goals:**
- Never lose a build.
- A browser library with pictures.
- Starters as data.
- The assistant and every tab keep working on "the current build".

**Non-Goals:** cloud sync, sharing, folders, or a server-side library.

## Decisions

### 1. Storage: IndexedDB in the browser
- **Where:** `src/utils/buildLibrary.js`, database `vexiq-builds` (version 1), object store `builds` keyed by `id`. localStorage's ~5 MB cap is too small for long histories with pictures.
- **Record:** `{ id, name, createdAt, updatedAt, partCount, thumbnail (JPEG data URL, 240×160), instances, history, viewport }`.
- **API (promises):** `listBuilds()` (newest first, without the parts and history, to stay light), `getBuild(id)`, `putBuild(record)`, `deleteBuild(id)`.
- **Pure helpers** (Node-checkable): `nextBuildName(names, base = 'Build')` gives "Build #N"; `nextCopyName`; `starterBuildName`; `newBuildId()`; `fileBuildName(fileName)` strips `.vexiq.json` / `.json`.

### 2. The current build
- `assembly-state.json` gains `build: { id, name }`. The app sends it in its POSTs. The bridge (`mergeBrowserSave` keeps unknown fields) and the MCP server (`writeAssemblyState` spreads the state) keep it unchanged.
- **At start:** the app reads the saved state.
  - With `build.id` already in the library, it uses the saved state, which is newer (the assistant may have changed it).
  - With no `build`, or an id missing from the library (a new browser): it becomes a library record. With an empty library, that is "Build #1" (taking over the old single build); otherwise it gets the next "Build #N".
- **Switching** (New, Starter, Open, Duplicate→Open, Open from computer, Delete of the current one):
  1. flush the pending auto-save of the current build;
  2. set the new parts, history, viewport and `build`, through the existing `setBuild` / `adoptServerState`-style path;
  3. post it to the bridge, so other tabs and the assistant switch too.

  Other tabs see the new `build` in the SSE state and adopt it like any other pushed state.

### 3. Auto-save
- A one-second debounce after any change to `instances`, `history`, `viewport` fields or `build.name` writes the record with `putBuild`. A pending save is flushed on `visibilitychange` (hidden) and before a switch.
- **The picture:** taken by the viewport's screenshot function in a framed `iso` view at 240×160, as a JPEG at about 0.7 quality. Every save gets a picture.
- **One writer per change:** a tab saves only changes it made, or changes it received from the bridge for the current build. Two tabs writing the same record is harmless, because the content is the same and the latest wins.

### 4. The File menu, name field and library dialog
- **`ToolbarMenu`** gains submenu items (`{ label, submenu: [...] }`), opened by hover or click.
- **The File menu** is a `ToolbarMenu` without a current-value label: items New, Starter ▸ (from `STARTERS`), Load…, Export, and Delete this build… (`confirm()`, then the same path as the library's Delete).
- **The build name:** an inline `<input>` styled as text next to the title. Commit on Enter or blur, Esc restores, an empty name is ignored. It updates `build.name`, which syncs and saves.
- **`LibraryDialog.jsx`:** a `<dialog>` like Settings.
  - A grid of cards: picture, name, "changed 5 min ago", parts count, and a "Current" tag.
  - Buttons: Open, Rename (inline input), Duplicate, Delete (`confirm()`).
  - **Open from computer…** uses a hidden file input. It parses the file like `handleImportJson` (`loadHistory` for files without history), makes a new record, then opens it.
- **`src/starters.js`:** `STARTERS = [{ id: 'sample', name: 'Sample starter', build(catalog) → instances }]`. The current `buildStarterAssembly` moves here.

## Risks / Trade-offs

- **IndexedDB unavailable** (private mode in some browsers) → the app works as before with only the current build: the library dialog says saving isn't available in this browser, and File still has New, Starter and Export.
- **Pictures cost a render each save** → it's debounced to one per second of changes and is small. It's skipped when the tab is hidden.
- **Libraries are per browser** → that matches the request ("application storage in browser"). Export covers moving builds between computers.

## Migration Plan

On the first start, the existing saved build becomes "Build #1" (Decision 2). The old localStorage key is no longer written. Nothing else changes for MCP or saved files.
