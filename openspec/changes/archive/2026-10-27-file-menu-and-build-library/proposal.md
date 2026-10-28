## Why

Today the app holds one build. Starting another means Save (download a file), then Starter or deleting everything, and getting the first one back means Load from a file. Young builders lose work this way, and there is no list of what they've built. A browser library that saves on its own, behind one File menu, fixes both. It also leaves room for more starters later (drivetrains, claws and so on).

## What Changes

- **A File menu** in the toolbar, replacing the Starter, Save and Load buttons. It has:
  - **New:** a new, empty build.
  - **Starter ▸:** a submenu of starter builds. Today it has "Sample starter"; drivetrains, claws and more can be added later as data.
  - **Load…:** opens the library.
  - **Export:** downloads the current build as a `.vexiq.json` file, as Save did.
  - **Delete this build…:** removes the open build from the browser's storage (it asks first).
- **Builds save on their own** to the browser's storage as they change. There is no Save button. Each build keeps its parts, its undo history and its view settings.
- **Names:** builds are named "Build #1", "Build #2", and so on. The current build's name shows in the toolbar next to the title, and you can type there to rename it.
- **The library (Load…)** shows every saved build:
  - a small picture of it, its name, when it last changed, and its part count;
  - Open, Rename, Duplicate and Delete (Delete asks first);
  - **Open from computer…** for a `.vexiq.json` file, which is added to the library as a build of its own.
- **New, Starter and Open never lose work:** the current build is already saved, so switching only changes which build is shown.
- **The assistant (MCP)** keeps working on the current build. Its changes are saved into that build's library entry.
- **Out of scope:** more starters (only the data shape for them), cloud sync, sharing, folders.

## Capabilities

### New Capabilities
- `build-library`: the File menu, auto-save to browser storage, build names, New, Starter, the Load library with its pictures and actions, Open from computer, Export, each build keeping its own history, the current build shared with the bridge and the assistant, and taking over the build saved before this change.

### Modified Capabilities
- `build-history`: "Opening a file replaces the history". A file opened from the computer becomes a new build with its own history, and the build that was open stays in the library with its history.
- The `app-settings` toolbar requirement (in the not yet archived `simple-ui-and-settings` change) is updated there to list File and the build name instead of Starter, Save and Load.

## Impact

- **`src/utils/buildLibrary.js` (new):** IndexedDB storage (`vexiq-builds` database, `builds` store), plus pure helpers for names and records.
- **`src/App.jsx`:**
  - the File menu and the build name field;
  - auto-save after changes;
  - New, Starter, Open and Export;
  - the current build's id and name kept in the saved state.
- **`src/components/LibraryDialog.jsx` (new):** the Load dialog. **`src/components/ToolbarMenu.jsx`:** submenus.
- **`src/starters.js` (new):** a list of starters. The current sample moves here.
- **The saved state** (`public/assembly-state.json`) gains `build: { id, name }`. The bridge and the MCP server pass it through unchanged.
- **Pictures:** made from the viewport's existing screenshot function, small (240×160 JPEG).
- **Checks:** a Node check for the library helpers, and a browser run for the File menu, auto-save, the library, rename, delete and open-from-computer.
- **Docs:** `features.md`.
