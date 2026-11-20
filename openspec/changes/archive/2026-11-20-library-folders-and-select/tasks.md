## 1. Library data model & grouping helpers

- [x] 1.1 Update `src/utils/buildLibrary.js` so `listBuilds()` includes `folder` and compact `drive` metadata (`fileId`, `folderId`, `folderName`, `parentFolderName`), and add pure `groupLibraryBuilds(builds)` handling ungrouped local builds, single-level local folders, Google Drive folder sections (with `"My Drive"` and `"Google Drive"` fallbacks), and parent-name disambiguation for duplicate folder names; verify with unit tests in `scripts/check-build-library.mjs`.
- [x] 1.2 Add bulk library operations in `src/utils/buildLibrary.js` (`setBuildsFolder(ids, folderName)`, `renameLocalFolder(oldName, newName)`, `deleteBuilds(ids)`) and verify `node scripts/check-build-library.mjs` passes.

## 2. Google Drive folder metadata (under `drive.file`)

- [x] 2.1 Add best-effort `getFolderInfo(folderId)` in `src/drive/driveClient.js` (returning `{ id, name, parents }` or `null` on 403/404) and `resolveDriveFolderMeta` in `src/drive/driveSession.js` so saving to a chosen folder, saving to My Drive, opening from Drive, and reconnecting record `{ folderId, folderName, parentFolderName }` on the build's `drive` object and write `vexiqFolderId` / `vexiqFolderName` / `vexiqParentFolderName` in Drive `appProperties`; verify with `node scripts/check-google-drive.mjs`.

## 3. Load dialog UI, multi-select, folders, and Drive badges

- [x] 3.1 Update `src/components/LibraryDialog.jsx` and `src/styles.css` to: (a) make each card's thumbnail a clickable/tappable button that opens the build (disabled on the current build) and remove the separate **Open** button; (b) show a distinct Google Drive indicator on Drive-linked build cards; (c) render collapsible local folder and Google Drive folder sections using `groupLibraryBuilds(builds)` with duplicate-name disambiguation and local folder rename/remove actions. Verify the dialog renders cleanly with `npm run build`.
- [x] 3.2 Add touch-friendly **Select** mode in `src/components/LibraryDialog.jsx` and wire bulk handlers in `src/App.jsx` (`onMoveToFolder`, `onBulkDelete`, `onRenameFolder`, `onRemoveFolder`), including the sticky selection bar (**Move to folder…**, **Delete**, **Done**), inline folder chooser with **+ New folder…** and **Remove from folder**, disabling **Move to folder…** when Drive builds are selected, and preserving `folder` on Duplicate and autosave. Verify `npm run build` succeeds.

## 4. Help documentation & verification

- [x] 4.1 Update `src/help/pages/saving.md` and `src/help/pages/google-drive.md` (and `src/help/controls.js` / `src/help/coverage.json` if control chips changed) to document tapping thumbnails to open, Select mode, local folders, Drive badges, and Drive folder grouping; verify `node scripts/check-help.mjs`, `node scripts/check-help-tags.mjs`, and `node scripts/check-help-context.mjs` all pass.
- [x] 4.2 Run `node scripts/check-build-library.mjs`, `node scripts/check-google-drive.mjs`, `npm run build`, and live browser verification of File → Load… (thumbnail open, no Open button, Select mode multi-select group into folder, duplicate folder disambiguation, Drive badge & Drive folder grouping, and bulk delete).

## 5. Duplicate build grouping & Select all

- [x] 5.1 Add pure `buildFingerprint(instances)` and `groupDuplicateBuilds(builds, currentId)` in `src/utils/buildLibrary.js`, persist `fingerprint` on save (`saveCurrentBuildNow`, `putBuild`) and compute/backfill it in `listBuilds()` for older records without a cached fingerprint; verify with unit tests in `scripts/check-build-library.mjs`.
- [x] 5.2 Add **Group duplicates** toggle (showing only 2+ identical build groups, with per-group **Select all** and **Select extras**) and global **Select all / Deselect all** + per-section **Select all** in `src/components/LibraryDialog.jsx` and `src/styles.css`, and update `src/help/pages/saving.md` (passing `check-help*.mjs`).
- [x] 5.3 Run `node scripts/check-build-library.mjs`, `node scripts/check-help.mjs`, `npm run build`, and live browser verification of Group duplicates, Select extras, and Select all / Deselect all.
