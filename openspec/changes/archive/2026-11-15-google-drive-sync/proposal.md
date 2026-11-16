## Why

Students working in teams (especially on iPads and Chromebooks in classrooms) need a way to collaborate on a common robot design through Google Drive without a custom backend server and without two teammates overwriting each other's work. Locking the file on Google Drive while one builder edits it, protecting against lost locks after an iPad sleeps or reloads, showing a clean read-only 3D viewer to teammates while it is locked, and prompting them to edit once the lock is released keeps collaboration simple and safe for middle-schoolers.

## What Changes

- **Connect to Google Drive (client-side only):**
  - Add **Save to Google Drive…** to the **File** menu (asks where to save: the folder used last time, **Choose a folder…** in the Google Picker (including a folder a teammate shared), or **My Drive**; creates the `.vexiq.json` file there, links the open build to it and locks it for editing) and **Open from Google Drive…** to **File → Load…** (picks a `.vexiq.json` file from Google Drive using the Google Picker, including a file inside a folder a teammate shared with the user).
  - Uses Google Identity Services (OAuth2 token client) and Drive REST API v3 (`drive.file` scope) directly in the browser when `VITE_GOOGLE_CLIENT_ID` is configured, with no backend server.
  - Preloads Google Identity Services and Picker scripts when the **File** menu or **File → Load…** dialog opens (and on startup whenever the open build is Drive-linked), so sign-in (`requestAccessToken()`) executes synchronously on the user's tap without iPadOS Safari blocking the popup (with a one-tap **Continue to Google Drive** fallback if a slow network is still loading).
  - Sharing is done in Google Drive, not in the app: a team shares a folder and keeps the build file in it. Personal Google accounts are enough; no school or work account is needed. The Picker lets a student open a shared folder and pick the file inside, and that file then works the same as one in their own My Drive.
- **File locking on Google Drive:**
  - Opening an unlocked Drive build (or saving a build to Drive for the first time) acquires a lock stored in the Drive file's `appProperties` (`lockHolderId`, `lockHolderName`, `lockAt`, `lockExpiresAt`) with a 2-minute lease.
  - Because Google Drive API v3 does not enforce `If-Match` on metadata updates, lock acquisition uses **Write → Wait → Read-back** verification (`~400 ms` + jitter before confirming `lockHolderId === clientId`), one more ownership check about 5 seconds after entering Edit mode, and a 45-second background heartbeat that re-reads `appProperties` to confirm lock ownership before extending `lockExpiresAt`.
- **One Drive button beside the build name:**
  - A Drive-linked build shows a single Drive button in the toolbar, and no other Drive controls. Its label names the state and tapping it does that action: **Save to Drive** (changes not on Drive yet), **Done editing** (everything saved; releases the lock), `Read-only · Locked by Maya` (a tag), **Edit build** (file is unlocked), **Reconnect to Drive** (paused or signed out).
  - **Done editing** is also in the **File** menu while editing; with unsaved changes it saves first, then releases, without asking.
  - Switching builds with unsaved Drive changes asks **Save and leave**, **Leave without saving** (the edits stay in the local build), or **Cancel**.
- **Manual save and lost-lock protection:**
  - Local edits still save automatically to the browser's IndexedDB (`vexiq-builds`), so reloads never lose work.
  - Before every upload (and when waking or returning to the tab), the app checks `appProperties` and `headRevisionId` on Drive. If another user took the lock or saved a newer `headRevisionId` while this device slept or its lock expired, the app refuses to overwrite: when local unsaved changes exist, it offers **Save as a copy on Drive** (made next to the original so teammates see it, or in My Drive with a message if Drive refuses), **Load latest from Drive** (the user's version is first kept as a local build `<Name> (my changes)`), or **Cancel**; when clean, it switches straight to Read-only mode with the latest Drive file. No choice deletes unsaved edits.
  - When the pre-save check confirms the lock is still held (or free with `headRevisionId` unchanged), the save uploads the `.vexiq.json` file, refreshes the lock, updates `lastSyncedHeadRevisionId`, and shows a brief **Saved to Drive** message.
- **Read-only tag and lightweight model viewer when locked:**
  - When a Drive build is opened while another user holds the lock (or when the user only has view permission in Drive), the Drive button shows a **Read-only** tag naming who holds the lock.
  - The app switches into a **lightweight viewer**: the Part Library, Outliner, Inspector, Context editing bar, Undo/Redo, Select, and Snap controls are hidden, leaving the full 3D view with camera controls (Orbit, Pan, Zoom, Focus, View Cube / 4-View / Stereo) plus direct toolbar buttons for **Explode** and **Play** so teammates can inspect and test the model without changing it.
  - Viewers watch `headRevisionId` rather than Drive's `version` counter so 45-second lock heartbeats never trigger unnecessary re-downloads; the 3D model only refreshes when the active editor saves. A refresh waits while the viewer is in Play mode or has the model exploded, and keeps the camera where it is.
- **Prompt to open in Edit mode when the lock is released:**
  - While viewing a locked Drive build in Read-only mode, the app polls the Drive file's metadata every 10 seconds (and on tab focus).
  - When the lock is released (or expires), a banner over the view prompts: `"<Name> is now unlocked. Open in edit mode?"` with **Edit build** and **Stay read-only**, and the Drive button reads **Edit build**.
- **Reconnect to Drive after reload or reopening from the local library:**
  - Because browser OAuth tokens are not kept across reloads and Safari blocks silent refreshes, reloading a Drive-linked build or opening it from **File → Load…** without an active session opens it paused (editing disabled, local unsaved edits preserved) with a banner offering **Reconnect to Drive** and **Work on this device only**.
  - **Reconnect to Drive** signs in on tap and reconciles `appProperties` and `headRevisionId`: resuming Edit mode if nobody else edited or took the lock, switching to Read-only viewer mode if clean and locked/updated, or showing the changed-on-Drive prompt if local unsaved changes conflict with newer Drive edits.
- **Never stuck without Google Drive:**
  - **Work on this device only** needs no internet and no sign-in: it removes the build's Drive link, keeps every local edit and restores full editing. The Drive file is untouched.
  - If the connection or sign-in is lost while editing, editing continues locally and the Drive button reads **Reconnect to Drive**.

## Capabilities

### New Capabilities
- `google-drive-sync`: signing in and picking/saving `.vexiq.json` files on Google Drive from the browser (My Drive and shared folders, personal accounts included) with preloaded scripts for iPad Safari, write-wait-read edit locking with follow-up and heartbeat verification, one toolbar Drive button whose label and action follow the build's Drive state, manual save with pre-save lock/revision protection that never deletes unsaved edits, **Done editing**, a **Read-only** tag and lightweight 3D viewer watching `headRevisionId`, the unlock prompt, reconnecting after reload or local library reopen, and **Work on this device only** when Drive can't be reached.

### Modified Capabilities
<!-- None. As with offline-app, the Drive menu items, toolbar controls, and viewer state are specified in google-drive-sync. -->

## Impact

- **Outside the code (the only dependency that is not client-side):** someone must own a Google Cloud project with the Drive API and Picker API enabled, an OAuth consent screen, an OAuth client ID whose authorised JavaScript origins list every web address the app is served from, and an API key. Their values are baked into the build as `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_APP_ID`. For teams on personal accounts the project must be published, which needs no Google review with only `drive.file`. A school's Google Workspace admin may need to allow the app. Anyone hosting their own copy needs their own project. There is still no server of ours.
- **Code:**
  - New `src/drive/`: Google Identity Services & Picker preloader/auth (`googleAuth.js`), Drive REST v3 client (`driveClient.js`), lock lease & conflict helpers (`driveLock.js`), Drive button state (`driveButton.js`), and React hook (`useGoogleDrive.js`).
  - `src/utils/buildLibrary.js`: persist optional `drive` metadata (`fileId`, `fileName`, `lastSyncedRev`, `lastSyncedName`, `lastSyncedHeadRevisionId`) on build records; remove it for **Work on this device only**.
  - `src/components/FileMenu.jsx`, `src/components/LibraryDialog.jsx`: Drive actions (**Save to Google Drive…**, **Done editing**, **Open from Google Drive…**) and script preloading on open.
  - `src/App.jsx`: the one toolbar Drive button, lightweight viewer layout mode (`readOnlyViewer`), the changed-on-Drive prompt, the leave prompt, the reconnect banner, and the lock-released banner.
  - `src/offline/sw.js`: confirm requests to Google are never answered from the offline copy.
  - New Help page `src/help/pages/google-drive.md` with pictures, plus `src/help/coverage.json`, `src/help/controls.js`, a pointer from `saving.md`, and `features.md`.
  - New `docs/google-drive-setup.md`: how to set up the Google Cloud project.
- **Checks:** new `scripts/check-google-drive-sync.mjs` testing write-wait-read lock contention, the follow-up and heartbeat ownership checks, Drive button states, `headRevisionId` viewer refresh filtering and deferral, lost-lock save conflict, reconnect after reload, **Work on this device only**, and unlock prompt transitions using a mock Drive transport. A real two-account test on an iPad covers what a mock can't.
- **Dependencies:** none added (Google Identity Services and Google Picker scripts load from Google only when the File menu, Load dialog, or a Drive-linked build opens).
- **Out of scope:** sharing a file or choosing who can open it (done in Google Drive by sharing a folder); shared drives (school and work accounts only), left to a later change once they can be tested; real-time simultaneous multi-cursor editing on the same build; automatic background sync on every part move without pressing **Save to Drive**; server-side Drive webhooks.
