## Context

See [proposal.md](./proposal.md) for why. Today:

- All builds are stored locally in IndexedDB (`vexiq-builds` in `src/utils/buildLibrary.js`), saved automatically 1 second after each change.
- Build state uses an operation-based history tree (`src/utils/buildHistory.js`) with a monotonically bumped revision `history.rev`.
- The app already supports a read-only interaction guard in `src/App.jsx` (`const locked = Boolean(preview || play)` and `lockedRef`) and `barItems({ locked })` in `src/utils/contextToolbarItems.js`, which disables editing and clears the context toolbar during timeline preview and Play mode.
- The static site (`npm run build:static`, openspec `static-site` and `offline-app`) runs with zero custom backend server. On iPadOS Safari, standard OS file pickers do not support writing back to a selected Google Drive file in place, and Safari blocks `window.open` sign-in popups if a script loads asynchronously between the user's tap and `requestAccessToken()`.

## Goals / Non-Goals

**Goals:**
- Run 100% client-side in the browser (works on static hosts and iPadOS Safari; the Home Screen app is confirmed by trial task 0.3) with no custom server.
- Enforce a single active editor per Drive file via write-wait-read lock verification, with automatic lease expiry and pre-save conflict checks so sleeping or reloaded tablets never silently overwrite a teammate's edits.
- Never delete a student's unsaved edits, and never leave a build unusable because Google can't be reached.
- One Drive control in the toolbar, usable on a phone.
- Avoid redundant downloads for Read-only viewers by watching `headRevisionId` instead of `version`.
- Keep local IndexedDB auto-save intact while making Google Drive saves explicit.
- Work for files a team keeps in a folder shared between personal Google accounts (no school or work account needed).

**Non-Goals:**
- Sharing files or managing who can open them; teams do that in Google Drive (a shared folder, or sharing the file).
- Shared drives (school and work accounts only). A later change can add them once they can be tested; see decision 2.
- Real-time simultaneous multi-editor cursors, CRDT merging, or character-by-character live streaming.
- Auto-uploading every drag or undo step to Google Drive without user confirmation.
- Running Google Drive sync while completely offline (local builds continue to work offline as today).

## Decisions

### 1. Preloading OAuth2 & Picker Scripts for iPad Safari (`src/drive/googleAuth.js`)

Google Identity Services (`https://accounts.google.com/gsi/client`) and Google Picker (`https://apis.google.com/js/api.js`) are needed only when Drive is configured (`VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, `VITE_GOOGLE_APP_ID`), and offline/non-Drive users should not depend on them.

- **Preloading:** `preloadGoogleDriveScripts()` begins loading GIS and Picker scripts when the user opens the **File** menu, opens **File → Load…**, or starts the app with a Drive-linked build (`drive.fileId` present). That ensures `tokenClient` is already initialized before the user taps **Save to Google Drive…**, **Open from Google Drive…**, or **Reconnect to Drive**.
- **Synchronous tap execution & slow-network fallback:** `tokenClient.requestAccessToken()` runs synchronously inside the button tap handler so iPadOS Safari never treats the OAuth window as an unrequested popup. If a user on a slow network taps a Drive action before preloading finishes, the app awaits script readiness and renders a one-tap **Continue to Google Drive** prompt so `requestAccessToken()` still executes directly from a tap.
- **Scope:** Restricted to `https://www.googleapis.com/auth/drive.file` (per-file access only: files created by VEX IQ Builder or chosen in Google Picker), avoiding sensitive-scope verification barriers in school Google Workspace domains.

*Alternative:* Lazy-loading scripts only after clicking **Save to Google Drive…**, or using the OS `<input type="file">` picker. Rejected because waiting on a script download after a tap breaks Safari's transient user activation (causing blocked popups on iPad), and iPadOS Files only grants one-time read-only copies.

### 2. Shared Folders and Where Files Go (`src/drive/driveClient.js`, `src/drive/googleAuth.js`)

Teams share outside the app. The main case is a private team on personal Google accounts: one student makes a folder in their My Drive, shares it with teammates as Editors, and the build file lives in it. No school or work account is involved.

- **Picker:** two tabs, **My Drive** and **Shared with me**, both showing folders (`DocsView.setIncludeFolders(true)`) and filtered to JSON files. Files inside a shared folder are not listed on their own under Shared with me, only the folder is, so a teammate opens the folder and picks the file inside. The Picker gets the project number (`setAppId`) so picking a file gives this app access to that one file for that account, which `drive.file` needs.
- **Save to Google Drive… asks where, every time,** in a small window of the app's own: **Save in <folder>** (the last folder used, kept in `localStorage` as `vexiq.driveLastFolder` = `{ id, name }`, shown only when there is one), **Choose a folder…**, **My Drive**, **Cancel**. Each is a tap, so sign-in still opens straight from it. **Choose a folder…** opens the Picker in folder mode (`ViewId.FOLDERS`, `setSelectFolderEnabled(true)`, tabs My Drive and Shared with me); picking a folder through the Picker with the project number gives the app access to it under `drive.file`, and trial result 7 showed a second account can create a file in a shared folder. The file is created with `parents: [folderId]`; if Drive refuses (a folder shared as Viewer), it goes in My Drive with the message "Saved in your My Drive. Move it into your team's folder in Google Drive." The Picker can't choose the top of My Drive itself, which is why **My Drive** is its own choice. Closing the Picker without picking saves nothing.
- The app links by `fileId`, which doesn't change when the file is moved, so a file can still be moved in Drive afterwards and keep saving. The student who created it stays its owner. Each teammate opens it once through the Picker.
- **The Picker in front:** the builds window is a modal `<dialog>`, which the browser keeps above everything else on the page, Google's Picker included. **Open from Google Drive…** closes it before the Picker opens.
- **Permissions:** a teammate the folder is shared with as Viewer or Commenter gets `capabilities.canEdit === false` and opens Read-only (they cannot write the lock fields).
- **Save as a copy on Drive** creates the copy with the original's `parents`, so it lands in the team's folder where everyone can see it. If Drive refuses (for example because `drive.file` doesn't allow the app to add a file to a folder it wasn't given), the copy is created in My Drive and the app says "Saved in your My Drive. Move it into your team's folder in Google Drive." Trial check (f) finds out which happens.
- **Shared drives are not in this change.** Requests don't set `supportsAllDrives`, and the Picker has no Shared drives tab, so a file moved into a shared drive stops opening. A later change adds both once someone can test with a school or work account.

*Alternative:* Save to My Drive and let students move the file in Drive (the first version of this plan). Replaced at the user's request: saving straight into the team's folder saves a trip to Drive. A Share button calling `permissions.create` stays out of scope: Drive's own sharing already does it.

### 3. Lock Protocol in Google Drive `appProperties` Without `If-Match` (`src/drive/driveLock.js`)

Google Drive API v3 does not enforce `If-Match` ETag preconditions on `files.update` metadata requests, so two simultaneous patches would simply overwrite one another. Instead, locking uses an explicit **Write → Wait → Read-back** protocol plus ownership checks:

- **Persistent client identity:** `clientId` (`client-<random>`) is stored in `localStorage` (`vexiq.driveClientId`) so reloading a tab preserves this browser's lock identity.
- **Lock fields in `appProperties`:**
  - `lockHolderId`: `clientId`
  - `lockHolderName`: signed-in user's display name
  - `lockAt`: epoch ms when acquired
  - `lockExpiresAt`: epoch ms (`now + 120_000`)
- **Acquire (`acquireLock`):**
  1. Read `files.get(fileId, fields="id,name,headRevisionId,modifiedTime,appProperties,capabilities")`. If `capabilities.canEdit === false` or `isLockActive(appProperties)` for a different `lockHolderId`, enter `'readonly'` mode immediately.
  2. Write `{ lockHolderId: clientId, lockHolderName, lockAt, lockExpiresAt }` via `files.update`.
  3. Wait `400 ms + random(0..150) ms` and read `appProperties` back from Drive.
  4. Enter `'edit'` mode **only** if `appProperties.lockHolderId === clientId`; otherwise enter `'readonly'` mode naming the winning lock holder.
  5. **Follow-up check:** 5 seconds after entering `'edit'`, read `appProperties` once more. The read-back in step 3 can pass for both sessions when the second write lands after the first session's read-back (two taps within about half a second on a slow network). The follow-up catches that: the session that no longer holds the lock drops to `'readonly'`. Five seconds is short enough that the loser has made at most a few edits, and those stay in its local build.
- **Heartbeat & Wake Ownership Verification:**
  - Every 45 seconds while open in `'edit'` mode (and immediately on `visibilitychange` to `'visible'`), read `appProperties` and `headRevisionId` before refreshing `lockExpiresAt`.
  - If `appProperties.lockHolderId === clientId`, extend `lockExpiresAt = Date.now() + 120_000`.
  - If the lock expired while the iPad slept and nobody else locked or edited (`!isLockActive` and `headRevisionId === lastSyncedHeadRevisionId`), re-run `acquireLock` (write-wait-read).
  - If another user holds the lock or `headRevisionId` changed, stop the heartbeat immediately and leave `'edit'` mode (entering `'readonly'` if clean, or raising the changed-on-Drive prompt if unsaved local changes exist).
  - If the request fails because the network or the sign-in is gone, stay in `'edit'` (see decision 6).
- **Release & `pagehide`:**
  - **Done editing** clears the four `appProperties` keys (`null`) via `PATCH` and transitions the view to `'readonly'`.
  - On `pagehide` when there are no unsaved Drive changes, a `fetch(..., { keepalive: true })` `PATCH` clears the lock immediately; if the tab crashes or has unsaved changes, the 2-minute lease (`lockExpiresAt`) prevents permanent lockouts.

Even if every check here failed, the pre-save check in decision 5 still stops an overwrite; the lock keeps two people from wasting effort, the pre-save check keeps work from being lost.

*Alternative:* Relying on `If-Match` headers or Drive `contentRestrictions`. Rejected because Drive v3 ignores `If-Match` on `files.update`, and `contentRestrictions` adds friction when uploading media.

### 4. One Drive Button (`src/drive/driveButton.js`)

An earlier draft put up to seven Drive controls in the toolbar (Save to Drive, Saved to Drive, Reconnect to Drive, Release, a Read-only tag, Edit build). That doesn't fit a phone and asks a middle-schooler to learn seven things. Each state has exactly one sensible next action, so one button can carry them all.

`driveButtonState({ linked, mode, dirty, lock, canEdit, connected })` is a pure function returning `{ label, action, tag }`:

| State | Label | Action |
|---|---|---|
| `edit`, not connected (network or sign-in lost) | **Reconnect to Drive** | `reconnectToDrive` |
| `edit`, dirty | **Save to Drive** | `saveToDrive` |
| `edit`, clean | **Done editing** | `doneEditing` |
| `readonly`, locked by another | `Read-only · Locked by <name>` | none (`tag: true`) |
| `readonly`, `canEdit === false` | `Read-only` | none (`tag: true`) |
| `readonly`, no active lock | **Edit build** | `enterEditMode` |
| `disconnected` | **Reconnect to Drive** | `reconnectToDrive` |
| not linked | no button | |

- The natural flow is two taps on the same spot: **Save to Drive**, then **Done editing**.
- "Saved" is a brief message through the existing action feedback, not a standing indicator; the button turning into **Done editing** is the lasting sign that everything is on Drive.
- **Done editing** replaces "Release". With unsaved changes it saves first (pre-save check), then releases, with no question. It is also in the File menu so it can be reached while the button reads **Save to Drive**.
- There is no "release without saving" on the open build. The one place the choice exists is leaving a build with unsaved Drive changes (**Save and leave** / **Leave without saving** / **Cancel**), and there **Leave without saving** only releases the lock: the edits stay in the local build and reconnecting later offers to save them.
- On a phone the button is a Drive icon plus the short label; the lock holder's name is cut short with an ellipsis before the label wraps.

*Alternative:* A button that opens a small menu of Drive actions. Rejected: every save would take two taps, and the menu repeats what the label already says.

### 5. Tracking `headRevisionId`, Dirty State, and Pre-Save Lock Verification (`src/drive/useGoogleDrive.js`)

Each build record in IndexedDB (`src/utils/buildLibrary.js`) carries an optional `drive` metadata object:

```js
drive: {
  fileId,
  fileName,
  lastSyncedRev,
  lastSyncedName,
  lastSyncedHeadRevisionId
}
```

- **Why `headRevisionId` instead of `version`:** Google Drive increments `file.version` on every metadata patch—including the 45-second `appProperties.lockExpiresAt` heartbeat—which would force every viewer to re-download the build JSON every 45 seconds. `headRevisionId` changes only when the `.vexiq.json` content changes.
- **Dirty tracking:** `hasUnsavedDriveChanges = Boolean(drive?.fileId) && (history.rev !== drive.lastSyncedRev || currentBuild.name !== drive.lastSyncedName)`. Local edits continue saving to IndexedDB every 1 second so reloads never lose work.
- **Pre-save check before every upload (Save to Drive, Done editing, Save and leave):**
  1. Fetch current `appProperties` and `headRevisionId` from Google Drive.
  2. **Safe to upload:** `appProperties.lockHolderId === clientId`, OR (`!isLockActive(appProperties)` and `meta.headRevisionId === drive.lastSyncedHeadRevisionId`, in which case the lock is re-acquired via write-wait-read first). Upload the `.vexiq.json` via multipart `PATCH` and store the returned `headRevisionId`, `lastSyncedRev`, and `lastSyncedName`.
  3. **Conflict (lost lock or newer `headRevisionId`):** Never overwrite the Drive file. Prompt: `"<Name> was changed on Google Drive while your lock expired."` with:
     - **Save as a copy on Drive:** creates `<Name> copy.vexiq.json` in the original's folder, or in My Drive if Drive refuses (decision 2), via `createBuildFile` (with a fresh lock for `clientId`) and links the local build to the new copy in `'edit'` mode.
     - **Load latest from Drive:** first saves the open build, with its history, as a new local record named `<Name> (my changes)` (through `uniqueName`, no `drive` field), then downloads the Drive file's latest content into the linked record and opens it in `'readonly'`. The student's work is one **File → Load…** away.
     - **Cancel:** closes the prompt and moves to `'disconnected'`. Nothing is written to Drive, the edits stay in the open build, and **Reconnect to Drive** runs the same check again.

No path deletes unsaved edits: they are uploaded, copied to Drive, kept as a local build, or left where they are.

### 6. Paused State, and Working Without Drive

OAuth2 access tokens in GIS are stored in memory only and disappear on page reload or when opening a Drive-linked build later from **File → Load…**. Because Safari blocks silent iframe token refreshes, a Drive-linked build with no active token cannot check or hold the lock until the user taps.

- **Three Drive modes (`drive.mode`):** `'edit'`, `'readonly'`, and `'disconnected'`.
- On startup (after reload) or when opening a Drive-linked build from `LibraryDialog` without an active token, the build opens in `'disconnected'`:
  - Editing is paused (`readOnlyViewer = true`, hiding editing panels/gizmos so the user cannot pile more edits onto a stale lock).
  - A banner over the view says `"This build is on Google Drive. Reconnect to keep editing."` (plus `"You have changes that are not on Drive yet."` when dirty) with **Reconnect to Drive** and **Work on this device only**. The Drive button also reads **Reconnect to Drive**.
- Tapping **Reconnect to Drive** executes `requestAccessToken()` synchronously on that tap, reads `appProperties` and `headRevisionId` from Drive, and reconciles:
  - `(lockHolderId === clientId || !isLockActive(appProperties)) && headRevisionId === lastSyncedHeadRevisionId` → acquires/refreshes lock via write-wait-read → `'edit'` mode (keeping local unsaved edits ready for **Save to Drive**).
  - Locked by another user or `headRevisionId` changed, with **no** unsaved local edits → downloads latest Drive file → `'readonly'` mode.
  - Locked by another user or `headRevisionId` changed, **with** unsaved local edits → opens the changed-on-Drive prompt.
- **Work on this device only** (`workOnThisDeviceOnly`): deletes the `drive` field from the build record and returns to normal editing. It makes no network request, so it works with no Wi-Fi, with Google blocked, or when sign-in fails. The Drive file is untouched; a lock this browser still holds simply expires. The build keeps its name and history. To put it back on Drive the student uses **Save to Google Drive…**, which makes a new file (the old one may have moved on without them).
- **Connection or sign-in lost while in `'edit'`** (heartbeat or save fails with a network error or `401`; tokens last about an hour): the student keeps editing and IndexedDB keeps saving. The Drive button reads **Reconnect to Drive**. The lock will expire after 2 minutes, which is safe because reconnecting runs the same reconciliation and every upload runs the pre-save check. Pausing editing here was considered and rejected: it would stop a student mid-build every hour and on every Wi-Fi hiccup.

### 7. Lightweight Read-Only Viewer Mode & Polling on `headRevisionId`

`src/App.jsx` extends its existing lock guard:

```js
const readOnlyViewer = drive.mode === 'readonly' || drive.mode === 'disconnected';
const locked = Boolean(preview || play || readOnlyViewer);
```

When `readOnlyViewer` is true:
- `workspace-grid` receives `panels-hidden readonly-viewer`, hiding the Part Library (`panel-left`), Outliner/Inspector (`panel-right`), and the phone bottom Library/Outline drawer toggles across desktop, tablet, and phone layouts.
- The toolbar hides editing controls (`Undo`, `Redo`, `History`, `SelectMenu`, `ToolsMenu`, `Snap`, `Wide`) and renders direct **Explode** and **Play** buttons alongside **Focus**, **View**, **File**, **Help**, **Settings**, and the Drive button.
- `barItems` in `src/utils/contextToolbarItems.js` receives `locked: Boolean(readOnlyViewer)`, hiding the 3D Context Toolbar.
- `BuildNameField` renders non-editable text.
- While in `'readonly'` mode, a 10-second polling interval (paused while `document.visibilityState === 'hidden'`, firing immediately on `visibilitychange` to `visible`) fetches `files.get(fileId, fields="id,name,headRevisionId,modifiedTime,appProperties,capabilities")`:
  - **Live model refresh:** Only when `meta.headRevisionId !== drive.lastSyncedHeadRevisionId` does the viewer download `alt=media` and update `instances`/`history`. Lock heartbeats leave `headRevisionId` untouched and trigger zero downloads.
  - **Not while the viewer is busy:** if Play mode is on or the explode amount is above zero, the downloaded version is held (`pendingRefresh`) and applied when the viewer leaves Play mode and closes Explode. Swapping the parts under a running drop test or a half-exploded model would reset what they were watching. Only the newest held version is kept. The camera is never moved by a refresh.
  - **Unlock prompt:** When `appProperties` transitions from locked-by-other to free and `capabilities?.canEdit !== false`, `unlockPrompt` surfaces `"<Name> is now unlocked. Open in edit mode?"` with **Edit build** (runs write-wait-read lock acquisition) and **Stay read-only**; the Drive button reads **Edit build** either way.

### 8. Google Cloud Project (the one thing outside the code)

There is no server of ours, but Drive access needs a Google Cloud project: Drive API and Picker API enabled, an OAuth consent screen, an OAuth client ID (web) whose authorised JavaScript origins list every address the app is served from, and an API key limited to those addresses. `drive.file` is a non-sensitive scope, so Google's app review for sensitive scopes isn't needed; a school Workspace admin may still have to allow the app. For teams on personal accounts the project must be published (**Publish app**); while it is in Testing only listed test users can sign in. Publishing with only `drive.file` needs no review. The values go into the build as `VITE_GOOGLE_*`; without them the Drive menu items don't appear. `docs/google-drive-setup.md` records the steps so a self-hosted copy can set up its own.

## Trial results

Tasks 0.2 and 0.3 were run on 2026-11-15 with the trial page (`scripts/drive-trial/`) in desktop Chrome and two personal Google accounts. Account A created the file in its My Drive, shared a folder with account B as Editor, and moved the file into it. Only `drive.file` was granted.

| # | Assumption | Result |
|---|---|---|
| 1 | `files.update` ignores `If-Match` | **Confirmed.** A patch sent with a stale `If-Match` got HTTP 200 and was applied. The browser also can't read Drive's `ETag` header, so `If-Match` couldn't be used anyway. Write-wait-read stays. |
| 2 | `appProperties` patch keeps `headRevisionId`; upload changes it | **Confirmed.** A property patch left `headRevisionId` the same and a content upload changed it. `version` went up on both (29 → 30 → 31), which is why viewers watch `headRevisionId`. |
| 3 | Second account can pick a file in a shared folder and read, lock and upload | **Confirmed.** B picked A's file through Shared with me → the folder (`ownedByMe=false`, `canEdit=true`); download, `appProperties` write, upload and clearing the lock fields all got HTTP 200. |
| 4 | A file moved into a shared folder keeps its id and stays writable | **Confirmed for the owner.** After A moved its file from My Drive into the shared folder, A's page still used the id from creation and its patches and uploads worked; B reached the same id too. Not separately run: B moving its own file into A's folder. Drive doesn't change an id on a move, so this isn't expected to differ; task 4.4 covers it. |
| 5 | Display name readable | **Confirmed.** `about.get` with `fields=user(displayName)` returned the account's name; so did the file's `lastModifyingUser.displayName`. |
| 6 | iPad Safari and Home Screen sign-in, renewed by a later tap | **Confirmed** (reported 2026-11-15; no copied log). On an iPad with the trial page on GitHub Pages: sign-in opened from a tap, the Picker listed Shared with me → the shared folder, a shared file was picked, and a new file was saved. One setup fix came out of it: the API key's website entry must be `https://adriangonsalves.github.io/*`, because browsers send Google only the site's name, so `…/vexiq-builder/*` never matched ("API key is invalid"). The Home Screen app and renewing after an hour are checked again in task 4.4. |
| 7 | Second account can create a file in the shared folder | **Confirmed.** B created a file with the original's `parents` and it landed in the shared folder. **Save as a copy on Drive** puts the copy next to the original; the My Drive fallback stays only for a refusal (for example a folder shared as Viewer). |

## Risks / Trade-offs

- **[An assumption in "Trial results" turns out false]** → Section 0 of the tasks runs first; a failed item goes back to the user before building. Item 6 (Home Screen app) is the most likely to fail; the fallback is to say in Help that Drive needs Safari.
- **[Simultaneous lock race]** Two teammates tap **Open from Google Drive…** or **Edit build** within milliseconds. → Write-wait-read settles most cases; the 5-second follow-up catches the rest; the pre-save check means even a missed race can't overwrite a file.
- **[Clocks]** `lockExpiresAt` is compared with each device's own clock. A device several minutes wrong could see a live lock as expired. → It could then take the lock, but the real editor's next heartbeat or save sees the change and gets the changed-on-Drive prompt; nothing is overwritten.
- **[School Wi-Fi or offline environments]** Google scripts (`accounts.google.com` / `apis.google.com`) may be unreachable offline or blocked. → Scripts never block app startup; if preloading fails, Drive menu items show an unavailable note, and a Drive-linked build offers **Work on this device only**.
- **[Unsaved Drive changes when switching builds]** → The leave prompt (**Save and leave**, **Leave without saving**, **Cancel**); edits stay in the local build either way.
- **[Expired OAuth token during a long edit session]** → Editing continues; the Drive button reads **Reconnect to Drive** and the next tap renews the sign-in.
- **[Local builds pile up]** **Load latest from Drive** adds a `<Name> (my changes)` build each time. → Rare (needs a real conflict), and the library already lets students delete builds.
- **[A student unlinks by mistake]** **Work on this device only** drops the Drive link. → The Drive file is untouched and can be opened again from **Open from Google Drive…**; the local edits are kept as well.

## Migration Plan

No changes to existing `.vexiq.json` files or local IndexedDB records are required: existing builds simply lack the optional `drive` field and behave identically to today until a user chooses **Save to Google Drive…** or **Open from Google Drive…**.
