## 1. Library storage

- [x] 1.1 `src/utils/buildLibrary.js`: IndexedDB `listBuilds` / `getBuild` / `putBuild` / `deleteBuild` and the pure name helpers; `src/starters.js` with the sample starter moved from App. Verify: a Node check (`scripts/check-build-library.mjs`) for `nextBuildName` (none gives #1; #1, #3 and "Clawbot" give #4), copy names, starter names and `fileBuildName`.

## 2. The current build and auto-save

- [x] 2.1 App: `build: { id, name }` in state, posts and adoption; taking over the old build as "Build #1" at first start; auto-save (1 s debounce, flush on hide or switch) with a 240×160 picture. Verify in the browser on a test server: adding parts and reloading keeps them and their history; the library record has a picture; the saved state carries `build`.

## 3. File menu, name and library

- [x] 3.1 The File menu (New, Starter ▸ with submenu, Load…, Export, Delete this build…) replacing Starter, Save and Load; the toolbar build-name field (rename, Esc cancels). Verify: New makes an empty "Build #2" while "Build #1" stays in the library; Starter makes "Sample starter"; the rename shows in the library; Export downloads `<name>.vexiq.json`; File → Delete this build… asks first, and confirming removes it from storage and opens the next build, while cancelling changes nothing.
- [x] 3.2 `LibraryDialog.jsx`: cards with picture, name, time and parts; Open, Rename, Duplicate, Delete (confirm; deleting the current build opens the next); Open from computer. Verify in the browser: opening an older build restores its parts and its own undo history; Duplicate makes "<name> copy"; Delete of the current build opens the next; a `.vexiq.json` opens as a new build named after the file.

## 4. Sharing and docs

- [x] 4.1 Other tabs and the assistant follow the current build: a switch in one tab shows in another; an MCP change is saved into the current build's record. Update `features.md`. Run `npm run build`, `check-history.mjs`, `check-mcp-tools.mjs`, `check-build-library.mjs`; all pass.
