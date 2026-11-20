## Why

Opening a starter build (such as Huey, Swish, Flop, or Clawbot) to explore, inspect, run Play mode, or run a drop test currently creates and autosaves a new project entry in the Build Library immediately — even when the user never changes a single part. Over time this clutters kids' Build Libraries with duplicate copies (`Huey`, `Huey 2`, `Huey 3`, …).

## What Changes

- Opening a starter by itself loads the starter in an **unsaved preview state** with its plain starter name (not a numbered copy) and does **not** write an entry to the browser's Build Library.
- Non-editing actions (orbiting, exploding, view settings, Play mode, Drop test) leave the starter unsaved.
- The first real edit to the starter's parts/history (including choosing "Add to this build" to bring an assembly into the starter), or an explicit rename or Google Drive save, promotes it into a real saved build in the Build Library with a unique name (`<Starter>`, then `<Starter> 2`, …).
- If a user edits a starter and then **undoes** all changes back to the starter's initial state (without having explicitly renamed it or linked it to Google Drive), the starter returns to the unsaved state and any auto-created library entry for it is removed.
- Opening another starter, saved build, or file while viewing an unedited starter continues to offer the "Open by itself / Add to this build" prompt so assemblies can still be brought into a starter.

## Capabilities

### New Capabilities
- *(none)*

### Modified Capabilities
- `build-library`: Starters opened by themselves are not persisted to the Build Library until modified (or explicitly renamed / saved to Drive), and revert to unsaved (removing any auto-created library entry) if all edits are undone back to the starter's initial state.

## Impact

- **Client state & autosave:** `src/App.jsx` (`handleStarterBuild`, `switchToBuild`, `saveCurrentBuildNow`, autosave effect, `handleRenameBuild`, undo/history reconciliation, `File → Delete this build…`).
- **Pure helpers & tests:** `src/utils/buildLibrary.js` (any pure starter-dirty/promotion helper) and `scripts/check-build-library.mjs`.
- **In-app Help:** `src/help/pages/saving.md` (clarify that starters only save to the library once changed).
- **Client-side only:** No server component or internet connection required.
