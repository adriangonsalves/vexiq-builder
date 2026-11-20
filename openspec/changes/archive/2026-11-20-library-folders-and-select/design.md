## Context

See [proposal.md](./proposal.md) for motivation. Today:
- [LibraryDialog.jsx](file:///Users/adriangonsalves/projects/vexiq_builder/src/components/LibraryDialog.jsx) renders a flat CSS grid of cards. Each card has a thumbnail, name/metadata, and an action row with **Open**, **Rename**, **Duplicate**, and **Delete**.
- [buildLibrary.js](file:///Users/adriangonsalves/projects/vexiq_builder/src/utils/buildLibrary.js) stores builds in IndexedDB (`vexiq-builds`, store `builds`). `listBuilds()` strips `drive` and any folder fields when returning build summaries.
- [driveClient.js](file:///Users/adriangonsalves/projects/vexiq_builder/src/drive/driveClient.js) and [driveSession.js](file:///Users/adriangonsalves/projects/vexiq_builder/src/drive/driveSession.js) use the `drive.file` OAuth scope. `openFolderPicker()` returns `{ id, name }`, while `openDrivePicker()` returns `{ id, name }` for a picked file and `getFileMeta()` returns `parents: [parentId]` and `appProperties`.

## Goals / Non-Goals

**Goals:**
- Make opening a build one tap on its thumbnail (desktop, tablet, phone) and declutter cards by removing the separate **Open** button.
- Provide a touch-friendly **Select** mode for multi-selecting builds to group local builds into single-level folders or delete multiple builds in one confirmation.
- Visually distinguish Google Drive builds and group them by their Drive folder.
- Disambiguate any duplicate folder names across the library by appending the parent folder name.
- Keep everything 100% client-side and stay on the `drive.file` OAuth scope.

**Non-Goals:**
- Nested local folders (local folders are single-level).
- Moving or organizing Google Drive files inside Google Drive from VEX IQ Builder (Drive folder membership is owned by Google Drive; Drive builds stay in their Drive folder group).
- Switching to `drive.metadata.readonly` or any restricted Google OAuth scope.
- Real-time polling of Google Drive to detect files moved between folders while the Load dialog is open (folder metadata refreshes when a build is saved, opened, or reconnected).

## Decisions

### 1. Data model in IndexedDB (`src/utils/buildLibrary.js`)
- Add an optional `folder` string field (trimmed folder name, or `null`/`undefined` for ungrouped) on local build records in the existing `builds` object store — no IndexedDB schema version bump or separate `folders` store is required.
- Include `folder` and a compact `drive` summary (`{ fileId, folderId, folderName, parentFolderName }`) in `listBuilds()` results so `LibraryDialog` has everything it needs without loading full `instances` or `history`.
- *Alternative considered:* Adding a separate `folders` object store in IndexedDB (DB version 2). Rejected because single-level folders without empty-folder persistence are simpler, zero-migration, and easier for kids to understand (when the last build leaves a folder, the empty folder disappears cleanly instead of leaving orphan empty folders).

### 2. Pure grouping & duplicate-name disambiguation helper (`src/utils/buildLibrary.js`)
Add a pure `groupLibraryBuilds(builds)` helper (unit-testable in `scripts/check-build-library.mjs`) that partitions builds into ordered sections:
- **Ungrouped local builds** (no `drive?.fileId`, no `folder`) — shown first (or at top without a folder header when there are no folders at all, preserving the simple flat view for new users).
- **Local folders** (no `drive?.fileId`, has `folder`) — one section per local folder, sorted by most recently updated build in that folder; each section has `{ key, kind: 'local-folder', name, parentName: 'Local', builds }`.
- **Google Drive folders** (has `drive?.fileId`) — grouped by `drive.folderId || drive.folderName || '__drive_default__'`. Section name is `drive.folderName || 'Google Drive'`, `parentName` is `drive.parentFolderName || (drive.folderId === 'my-drive' ? null : 'Google Drive')`.
- **Disambiguation rule:** Count occurrences of `name.trim().toLowerCase()` across all folder sections (local + Drive). Whenever a folder name appears more than once, set `displayName = parentName ? \`${name} (${parentName})\` : name` (and if two Drive folders still collide without distinct `parentFolderName`, fall back to keeping their distinct `folderId` sections with a subtle disambiguator like `Google Drive` / `Shared` or short suffix only if needed).
- *Why:* Keeps all grouping, sorting, and collision logic deterministic, pure, and covered by Node checks.

### 3. Thumbnail click-to-open & touch-friendly multi-select (`src/components/LibraryDialog.jsx`)
- **Normal mode:** The `.library-thumb` becomes a `<button type="button" className="library-thumb-btn">` (disabled on the current build) so keyboard users, mouse users, and touch users all get a single-tap open target with proper focus/accessibility. Remove the **Open** button from `.library-actions`, leaving only compact **Rename**, **Duplicate**, and **Delete** icon buttons.
- **Select mode:** A **Select** toggle button in the dialog header (hidden when `builds.length === 0`) enters selection mode:
  - Tapping anywhere on a card toggles its checkbox.
  - Per-card action buttons are hidden while selecting to prevent accidental taps on small screens.
  - A compact sticky selection bar at the top of `.library-body` shows `"N selected"`, **Move to folder…**, **Delete**, and **Done**.
  - **Move to folder…** opens an inline/popover folder picker listing existing local folders, **+ New folder…** (inline name input), and **Remove from folder** (when any selected build is already in a folder). If any selected build is Drive-linked, **Move to folder…** is disabled with a short tooltip/hint (`"Google Drive builds stay in their Drive folder"`), while **Delete** still works on any selected builds (removing them from the local library, same as single-build Delete).

### 4. Best-effort Drive folder metadata under `drive.file` (`src/drive/driveClient.js`, `src/drive/driveSession.js`)
- Add `getFolderInfo(folderId)` in `driveClient.js` that calls `GET /drive/v3/files/{folderId}?fields=id,name,parents`, returning `{ id, name, parents }` or `null` on `403`/`404` (never throwing for permission errors).
- Add a helper `resolveDriveFolderMeta(client, { folder, meta })`:
  1. If `folder` (`{ id, name }`) was just picked in `Save to Google Drive… → Choose a folder…`: start with `folderId = folder.id`, `folderName = folder.name`. Best-effort fetch `getFolderInfo(folder.id)` to see if `parents[0]` is readable, and if so `getFolderInfo(parents[0])` to get `parentFolderName`.
  2. If saved to **My Drive** (`folder === null` or `inFolder === false`): record `{ folderId: 'my-drive', folderName: 'My Drive', parentFolderName: null }`.
  3. On open / reconnect (`meta` from `getFileMeta`): take `folderId = meta.parents?.[0] ?? null`. Try `getFolderInfo(folderId)` for `folderName` and its parent for `parentFolderName`. Fall back to `meta.appProperties?.vexiqFolderName` / `meta.appProperties?.vexiqParentFolderName` if Drive denies reading the folder object!
- When `createBuildFile` or `updateBuildFile` writes `appProperties`, include `vexiqFolderName` (and `vexiqParentFolderName` if known) alongside the lock props (keeping values short, well within Drive's 124-byte `appProperties` entry limit).
- *Alternative considered:* Adding `drive.metadata.readonly` scope. Rejected per user decision to preserve frictionless personal and school Google account sign-in under `drive.file`.

### 5. Local folder management
- Local folder headers include compact **Rename folder** and **Remove folder** icon buttons (hidden in Select mode).
- Renaming a folder updates `folder` on all builds in that folder in IndexedDB.
- Removing a folder clears `folder` on all builds in that folder (ungrouping them without deleting any builds).

## Risks / Trade-offs

- **[Drive hides unpicked parent/grandparent folder names under `drive.file`]** → Mitigated by storing `vexiqFolderName` / `vexiqParentFolderName` in Drive `appProperties` when saved from VEX IQ Builder, attempting best-effort `getFolderInfo` reads, and falling back cleanly to `"Google Drive"`.
- **[Drive file moved to a different folder in Google Drive externally]** → `appProperties.vexiqFolderName` might reflect the old folder if `getFolderInfo(meta.parents[0])` is blocked. Prefer live `getFolderInfo` whenever accessible, and only use `appProperties` when `meta.parents?.[0]` matches `appProperties.vexiqFolderId` (so a moved file won't show a stale folder name!).
- **[Deleting the currently open build in a bulk delete]** → Reuse the same switching logic as single delete: delete all selected builds first, then if `currentId` was among them, switch to the most recently updated remaining build (or create a new empty build if none remain).
