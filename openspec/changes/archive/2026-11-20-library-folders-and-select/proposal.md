## Why

As students accumulate local builds and shared Google Drive builds in **File → Load…**, the flat grid becomes cluttered and hard to manage: opening a build requires hitting a small separate **Open** button instead of tapping its picture, builds cannot be cleaned up or organized in batches, and Google Drive builds look identical to local builds with no indication of which Drive folder they live in.

## What Changes

- **Tap thumbnail to open:** Clicking or tapping a build's thumbnail (or card picture) opens it directly (still showing the "Open by itself / Add to this build" choice when the current build has parts) and removes the separate **Open** button from each card.
- **Multi-select for bulk actions:** Add a touch-friendly **Select** mode in **File → Load…** so builders on desktop, tablet, or phone can select multiple builds (including **Select all** / **Deselect all** and per-section **Select all**) and either **Move to folder…** (grouping local builds into single-level folders) or **Delete** them together (with one confirmation).
- **Group identical builds (duplicates cleanup):** Add a **Group duplicates** toggle in **File → Load…** that matches builds with identical parts, positions, rotations, and colors (ignoring build name, timestamps, and undo history), shows only groups with 2 or more identical builds, and offers **Select all** and **Select extras** (keeping one copy unselected) per group so large libraries can be cleaned up quickly.
- **Local folders:** Support single-level local folders in the build library so students can group, ungroup, rename, or remove local folders without losing builds.
- **Google Drive badge and folder grouping:** Show a distinct Google Drive indicator on Drive-linked build cards, and group Drive-linked builds under the Google Drive folder they live in (keeping Drive builds organized by their Drive folder rather than local folders).
- **Duplicate folder name disambiguation:** When two folders shown in **File → Load…** share the same name (for example two Drive folders named `Drivetrains` under different parent folders, or a local folder and a Drive folder sharing a name), display the parent folder name alongside the folder name so builders can tell them apart.
- **Best-effort Drive folder metadata under `drive.file`:** Keep the kid- and school-safe `drive.file` OAuth scope; record folder (and best-effort parent folder) metadata when saving to or opening from Google Drive, share the folder name in Drive `appProperties` so teammates see it too, and fall back to a **"Google Drive"** group when Google Drive hides an unpicked folder's name.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `build-library`: Update the **Library** requirement to open builds by clicking/tapping the thumbnail (removing the separate Open button), add multi-select bulk actions (group into single-level local folders and bulk delete), display a distinct Google Drive indicator on Drive-linked builds, group Drive-linked builds under their Drive folder, and disambiguate duplicate folder names using their parent folder name.
- `google-drive-sync`: Record Drive folder metadata (folder id, folder name, and best-effort parent folder name) on Drive-linked builds and in Drive `appProperties` under the existing `drive.file` scope so **File → Load…** can group Drive builds by folder and disambiguate duplicate folder names.

## Impact

- **UI & styles:** `src/components/LibraryDialog.jsx`, `src/styles.css`, `src/App.jsx`
- **Local library & folder logic:** `src/utils/buildLibrary.js`, `scripts/check-build-library.mjs`
- **Google Drive metadata:** `src/drive/driveClient.js`, `src/drive/driveSession.js`, `src/drive/googleAuth.js`, `scripts/check-google-drive.mjs`
- **Help documentation:** `src/help/pages/saving.md`, `src/help/pages/google-drive.md`, `src/help/controls.js` (if control chips change)
- **No server component:** 100% client-side using IndexedDB and the existing Google Drive REST v3 + Picker integration under `drive.file`.
