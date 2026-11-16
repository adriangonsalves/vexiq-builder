# google-drive-sync Specification

## Purpose

Lets builders collaborate on a shared robot design stored in Google Drive directly from the browser (including iPads) by locking the file while one person edits, protecting against lost locks after sleep or reload, offering one Drive button that saves, finishes editing, reconnects or starts editing, showing a lightweight Read-only viewer when locked, and prompting viewers to enter Edit mode once the lock is released. Sharing the file with teammates happens in Google Drive itself (normally by keeping it in a folder shared with the team), not in the app.

## Requirements

### Requirement: Linking and opening builds from Google Drive
When Google Drive integration is configured, the **File** menu SHALL offer **Save to Google Drive…** and **File → Load…** SHALL offer **Open from Google Drive…**. Sign-in and file selection SHALL run directly in the browser using Google OAuth (`drive.file` scope) and the Google Picker. Google sign-in and Picker scripts SHALL be preloaded before the user taps a Drive action — when opening the **File** menu, opening **File → Load…**, or starting with a Drive-linked build — so sign-in opens synchronously from the tap without popup blocking on tablet browsers such as iPad Safari. If a user on a slow connection taps before the script finishes loading, the app SHALL display a one-tap **Continue to Google Drive** confirmation once ready so sign-in still opens directly from a tap. When offline or unconfigured, Drive actions SHALL be hidden or disabled with a clear explanation.

**Save to Google Drive…** SHALL ask where to save the new file, every time, with: **Save in <folder>** (the folder this browser saved to last, shown only once there is one), **Choose a folder…** (the Google Picker, listing folders in the user's My Drive and folders shared with them, including a folder a teammate shared), **My Drive** (the top of the user's own Drive), and **Cancel** (nothing is saved). The new file SHALL be created in the chosen place. The app SHALL NOT share the file. A file the user later moves into another folder or shares in Google Drive SHALL stay linked to the build. The Google Picker SHALL open in front of the app's own windows. The Picker SHALL let the user open files shared with them, including a file inside a folder someone shared with them, and opening, locking and saving SHALL work the same for these as for a file in the user's own My Drive. All of this SHALL work with personal Google accounts; no school or work account is needed.

#### Scenario: Save a local build to Google Drive
- **WHEN** the user has "Clawbot" open, selects **File → Save to Google Drive…** and chooses **My Drive**
- **THEN** `Clawbot.vexiq.json` is created in the user's My Drive, the open build is linked to that Drive file, and the user holds the edit lock

#### Scenario: Save straight into the team's shared folder
- **WHEN** a teammate shared the folder "Team Robot" with Student A, and Student A selects **File → Save to Google Drive…**, then **Choose a folder…**, opens Shared with me and picks "Team Robot"
- **THEN** `Clawbot.vexiq.json` is created in "Team Robot", the open build is linked to it, Student A holds the edit lock, and the next **Save to Google Drive…** offers **Save in Team Robot**

#### Scenario: Cancel saving to Google Drive
- **WHEN** the user selects **File → Save to Google Drive…** and then **Cancel**, or closes the folder picker without picking
- **THEN** nothing is saved to Google Drive and the build stays a local build

#### Scenario: The file picker opens in front
- **WHEN** the user selects **File → Load…**, then **Open from Google Drive…**
- **THEN** the builds window closes and the Google Picker shows in front, without having to be brought forward

#### Scenario: Open an unlocked build from Google Drive
- **WHEN** the user selects **Open from Google Drive…** and chooses an unlocked `.vexiq.json` file
- **THEN** the app acquires the edit lock on Google Drive, adds or updates the build in the local library, and opens it in Edit mode

#### Scenario: Sign-in popup opens directly from a tap on iPad
- **WHEN** a student on iPad Safari opens the **File** menu and taps **Save to Google Drive…**
- **THEN** the sign-in script is already loaded and the Google sign-in window opens directly from that tap without being blocked by Safari's popup blocker

#### Scenario: Open a build kept in a folder a teammate shared
- **WHEN** Student A, on a personal Google account, shares the folder "Team Robot" with Student B and keeps `TeamBot.vexiq.json` in it, and Student B selects **Open from Google Drive…**
- **THEN** the Picker shows the "Team Robot" folder under Shared with me, Student B can open it and choose `TeamBot.vexiq.json`, and opening, locking and saving it work the same as for a file in My Drive

#### Scenario: A file moved into a shared folder stays linked
- **WHEN** the user saves "Clawbot" to Google Drive, moves `Clawbot.vexiq.json` into the team's shared folder in Google Drive, and then selects the Drive button to save again
- **THEN** the save goes to the same file in its new place

### Requirement: File locking while editing
While a user has a Drive-linked build open in Edit mode, the Drive file SHALL carry lock metadata (`lockHolderId`, `lockHolderName`, `lockAt`, and `lockExpiresAt`) identifying this browser's client session, the signed-in user's display name, and a 2-minute lease expiration timestamp. Because Drive updates do not enforce preconditions on lock metadata writes, lock acquisition SHALL write the lock metadata, wait briefly, and read the metadata back from Google Drive to confirm `lockHolderId` still matches this session before entering Edit mode; if another user's lock won the race, the app SHALL open the build in **Read-only** mode instead. About 5 seconds after entering Edit mode the app SHALL read the lock metadata once more, and SHALL leave Edit mode for Read-only mode if another session now holds the lock. While open in Edit mode, a background heartbeat every 45 seconds (and immediately upon returning to the tab) SHALL read `lockHolderId` and `headRevisionId` to verify this session still holds the lock before extending `lockExpiresAt`; if the lock was lost while the device slept and another user took it or updated the file content, the app SHALL stop refreshing the lock and leave Edit mode.

#### Scenario: Lock is acquired on open
- **WHEN** User A opens `TeamBot.vexiq.json` from Google Drive while no active lock is held
- **THEN** Google Drive records User A's `lockHolderId` with a 2-minute lease, read-back confirms User A owns the lock, and User A opens the build in Edit mode

#### Scenario: Two users try to lock at the same time
- **WHEN** User A and User B simultaneously select **Open from Google Drive…** on an unlocked `TeamBot.vexiq.json` and User B's write overwrites User A's
- **THEN** User A's read-back, or the follow-up check about 5 seconds later, sees User B's `lockHolderId`; User A's build switches to **Read-only** mode showing User B holds the lock, and only User B stays in Edit mode

#### Scenario: Expired lock from a closed device is taken over
- **WHEN** User A's device goes offline, sleeps, or closes without releasing, `lockExpiresAt` passes without a heartbeat, and User B opens `TeamBot.vexiq.json`
- **THEN** User B acquires the edit lock and opens the build in Edit mode

### Requirement: One Drive button beside the build name
While the open build is linked to a Drive file, the toolbar SHALL show exactly one Drive button beside the build name, and no other Drive controls. Its label SHALL name the build's Drive state and selecting it SHALL do the action it names:

| State | Label | Selecting it |
|---|---|---|
| Edit mode, changes not yet on Drive | **Save to Drive** | saves to Google Drive |
| Edit mode, everything saved | **Done editing** | releases the lock |
| Read-only, another user holds the lock | `Read-only · Locked by <name>` | nothing (shown as a tag) |
| Read-only, the user has view permission only | `Read-only` | nothing (shown as a tag) |
| Read-only, no active lock | **Edit build** | takes the lock and enters Edit mode |
| Paused after a reload or reopen, or signed out | **Reconnect to Drive** | signs in and reconciles |

The button SHALL fit the phone toolbar (a Drive icon with a short label). A build that is not linked to Drive SHALL NOT show the button.

#### Scenario: The button follows the build's state
- **WHEN** the user edits a Drive-linked build, selects the Drive button to save, and selects it again
- **THEN** the button reads **Save to Drive**, then **Done editing**, then **Edit build**

#### Scenario: A local build has no Drive button
- **WHEN** the open build is not linked to a Drive file
- **THEN** the toolbar shows no Drive button

### Requirement: Saving to Drive and lost-lock protection
Local edits on a Drive-linked build SHALL continue to auto-save to the browser's local storage, and SHALL NOT be uploaded to Google Drive automatically on every edit. Whenever the open Drive-linked build in Edit mode has changes not yet saved to Google Drive (parts or history changed since the last Drive save, or the build was renamed), the Drive button SHALL read **Save to Drive**. Before uploading on **Save to Drive** (or `Ctrl/Cmd+S`), the app SHALL check the Drive file's current lock metadata and content revision (`headRevisionId`):
- If this session still holds the lock, OR no active lock is held and `headRevisionId` still matches the last synced content revision, the app SHALL re-acquire or refresh the lock, upload the `.vexiq.json` file, record the new `headRevisionId`, show a brief **Saved to Drive** message, and change the Drive button to **Done editing** until the next change.
- If another user holds the lock OR `headRevisionId` has changed since this session's last sync, the app SHALL NOT overwrite the Drive file, and SHALL prompt: `"<Name> was changed on Google Drive while your lock expired."` with:
  - **Save as a copy on Drive**, which saves the local build to a new Drive file `<Name> copy.vexiq.json` in the same folder as the original so teammates can see it (or, if Drive doesn't allow that, in the user's My Drive with the message "Saved in your My Drive. Move it into your team's folder in Google Drive.") and opens it in Edit mode;
  - **Load latest from Drive**, which first keeps the user's version as a separate local build named `<Name> (my changes)` that is not linked to Drive, then opens the latest Drive version;
  - **Cancel**, which closes the prompt, changes nothing on Google Drive, keeps the local edits, and leaves the build paused with the Drive button reading **Reconnect to Drive**.

No choice in this prompt SHALL delete the user's unsaved edits.

#### Scenario: Making an edit shows Save to Drive
- **WHEN** the user is editing a Drive-linked build and adds, moves, or deletes a part
- **THEN** the Drive button reads **Save to Drive**

#### Scenario: Saving to Drive clears the unsaved state
- **WHEN** the user holds the lock and selects **Save to Drive** (or presses `Ctrl/Cmd+S`)
- **THEN** the current build is uploaded to Google Drive, **Saved to Drive** is shown briefly, and the Drive button reads **Done editing**

#### Scenario: Reloading before saving keeps local changes
- **WHEN** the user edits a Drive-linked build and reloads the browser tab without saving to Drive
- **THEN** the local edits remain loaded from browser storage, and after reconnecting the Drive button reads **Save to Drive**

#### Scenario: Lock expired while asleep but nobody else edited
- **WHEN** Student A's iPad sleeps for 5 minutes so the lock expires, nobody else edits or locks the file on Drive, and Student A wakes the iPad and selects **Save to Drive**
- **THEN** the pre-save check finds `headRevisionId` unchanged and no active lock, re-acquires the lock, and uploads Student A's changes cleanly

#### Scenario: Teammate took over and saved while this device was asleep — Save as a copy
- **WHEN** Student A's iPad sleeps with unsaved edits, Student B takes the expired lock and saves a new version (`headRevisionId` changes), and Student A wakes the iPad and selects **Save to Drive**
- **THEN** the app refuses to overwrite Student B's file and prompts Student A; choosing **Save as a copy on Drive** creates a new `<Name> copy.vexiq.json` in the same shared folder without touching Student B's file

#### Scenario: The copy can't go in the original's folder
- **WHEN** Student A chooses **Save as a copy on Drive** and Google Drive refuses to create a file in the original's folder
- **THEN** `<Name> copy.vexiq.json` is created in Student A's My Drive, the message "Saved in your My Drive. Move it into your team's folder in Google Drive." is shown, and the copy opens in Edit mode

#### Scenario: Load latest keeps the user's edits as a local build
- **WHEN** Student A is shown the changed-on-Drive prompt for "TeamBot" and chooses **Load latest from Drive**
- **THEN** the library gains a local build "TeamBot (my changes)" holding Student A's edits, and "TeamBot" opens with Student B's latest version

#### Scenario: Cancel changes nothing
- **WHEN** Student A is shown the changed-on-Drive prompt and chooses **Cancel**
- **THEN** the Drive file is untouched, Student A's edits are still in the open build, editing is paused, and the Drive button reads **Reconnect to Drive**

### Requirement: Finishing editing
While in Edit mode on a Drive-linked build, the user SHALL be able to finish editing so teammates can edit: the Drive button reads **Done editing** when everything is saved, and the **File** menu SHALL offer **Done editing** whenever the build is in Edit mode. **Done editing** SHALL first save any unsaved changes to Google Drive (running the same pre-save lock and `headRevisionId` check), then clear the lock metadata on Google Drive and switch the open build into **Read-only** viewer mode. It SHALL NOT ask a question unless the pre-save check finds a conflict.

When the user switches away from a Drive-linked build in Edit mode (**File → New**, **File → Starter**, or **File → Load…**):
- with no unsaved Drive changes, the app SHALL release the lock and switch;
- with unsaved Drive changes, the app SHALL ask `"Save your changes to Google Drive before leaving?"` with **Save and leave**, **Leave without saving**, and **Cancel**. **Leave without saving** SHALL release the lock and SHALL keep the unsaved edits in the local build, so they are offered for saving the next time the build is opened and reconnected.

#### Scenario: Done editing with everything saved
- **WHEN** all edits have been saved to Google Drive and the user selects **Done editing**
- **THEN** the lock metadata is cleared on Google Drive and the open build switches to Read-only viewer mode with the Drive button reading **Edit build**

#### Scenario: Done editing from the File menu with unsaved changes
- **WHEN** the user has unsaved Drive changes, still holds the lock, and selects **File → Done editing**
- **THEN** the changes are uploaded to Google Drive, the lock metadata is cleared, and the build switches to Read-only viewer mode without a prompt

#### Scenario: Leaving without saving keeps the edits on this device
- **WHEN** the user has unsaved Drive changes on "TeamBot", selects **File → New**, and chooses **Leave without saving**
- **THEN** the lock is released, the Drive file is unchanged, and "TeamBot" in the local library still holds the unsaved edits

### Requirement: Read-only tag and lightweight viewer when locked
When a user opens a Drive file that currently has an active lock held by another session (or where Google Drive reports the user cannot edit the file), the build SHALL open in **Read-only** mode:
- The Drive button SHALL show the **Read-only** tag (including who holds the lock when locked, for example `Read-only · Locked by Maya`).
- The app SHALL show a **lightweight 3D viewer**:
  - The Part Library, Assembly Outliner, Part Inspector, Context editing bar, Undo/Redo/History editing, Select menu, Snap menu, and editing Tools actions SHALL be hidden.
  - The 3D viewport SHALL fill the workspace and allow **Orbit, Pan, Zoom**, **Focus (`F`)**, **View options** (Perspective/Orthographic, 4-View, Stereo), **Explode** (slider and play), and **Play mode** (motor throttles, gravity, and drop tests).
  - No part SHALL be selectable, movable, rotatable, addable, deletable, or renamable, and the build name SHALL NOT be editable.
- While in Read-only mode, the viewer SHALL track the Drive file's content revision (`headRevisionId`) rather than its metadata version counter, so lock heartbeat refreshes from the editor SHALL NOT trigger model re-downloads. The viewer SHALL download and refresh the displayed 3D model only when `headRevisionId` changes.
- A refresh SHALL NOT interrupt what the viewer is doing: while Play mode is on or the model is exploded, the app SHALL hold the new version and show it when the viewer leaves Play mode and closes Explode. A refresh SHALL keep the viewer's camera position.

#### Scenario: Opening a build locked by a teammate
- **WHEN** User B opens `TeamBot.vexiq.json` while User A holds an active edit lock
- **THEN** the Drive button displays `Read-only · Locked by User A`, the Part Library, Outliner, Inspector, and editing controls are hidden, and User B can orbit, zoom, Focus, Explode, and run Play mode without changing any parts

#### Scenario: Viewer refreshes when the editor saves
- **WHEN** User B is viewing `TeamBot` in Read-only mode and User A selects **Save to Drive**
- **THEN** User B's metadata poll detects a changed `headRevisionId` and refreshes the 3D view with User A's saved changes

#### Scenario: Lock heartbeats do not re-download the model
- **WHEN** User B is viewing `TeamBot` in Read-only mode and User A's 45-second heartbeat updates `lockExpiresAt` without saving new build content
- **THEN** `headRevisionId` is unchanged and User B's browser does not re-download `TeamBot.vexiq.json`

#### Scenario: A save during Play mode waits
- **WHEN** User B is running Play mode on `TeamBot` in Read-only mode and User A saves a new version
- **THEN** User B's Play mode carries on undisturbed, and the new version appears when User B leaves Play mode

### Requirement: Prompt to open in Edit mode when the lock is released
While a Drive-linked build is open in Read-only mode because another user holds the lock (and the viewer has edit permission on the Drive file), the app SHALL poll the Drive file's metadata every 10 seconds while the tab is visible and immediately when returning to the tab. When the lock is released or expires, the app SHALL display a prompt banner over the 3D view: `"<Name> is now unlocked. Open in edit mode?"` with **Edit build** and **Stay read-only**, and the Drive button SHALL read **Edit build**. Choosing **Edit build** (on the banner or the Drive button) SHALL fetch the latest version from Drive, run write-wait-read lock acquisition, and, if acquired, restore the full editing workspace. Choosing **Stay read-only** SHALL dismiss the banner; the Drive button SHALL keep reading **Edit build** while the file remains unlocked.

#### Scenario: Teammate finishes editing while viewer is watching
- **WHEN** User B is viewing `TeamBot` in Read-only mode and User A selects **Done editing** (or the lease expires)
- **THEN** User B sees the banner `"TeamBot is now unlocked. Open in edit mode?"` with **Edit build** and **Stay read-only**

#### Scenario: Switching to Edit mode from the prompt
- **WHEN** User B selects **Edit build** on the unlock prompt
- **THEN** the latest Drive build is loaded, User B acquires the edit lock, the **Read-only** tag disappears, and the Part Library, Outliner, Inspector, and toolbar editing controls are restored

#### Scenario: Choosing Stay read-only
- **WHEN** User B selects **Stay read-only** on the unlock prompt
- **THEN** the banner closes, the viewer stays in Read-only mode, and the Drive button reads **Edit build**

### Requirement: Reconnecting after reload or reopening from the local library
When a Drive-linked build is opened on page reload or from **File → Load…** and the browser has no active Google sign-in token in memory, the build SHALL open in a paused state: editing SHALL be disabled (using the Read-only viewer layout), local unsaved edits from browser storage SHALL be preserved, the Drive button SHALL read **Reconnect to Drive**, and a banner over the 3D view SHALL say `"This build is on Google Drive. Reconnect to keep editing."` (adding `"You have changes that are not on Drive yet."` when there are unsaved local changes) with **Reconnect to Drive** and **Work on this device only**. Selecting **Reconnect to Drive** SHALL request an access token directly from that tap and check the Drive file's lock metadata and `headRevisionId`:
- If this browser's `lockHolderId` still holds the lock OR no active lock is held, AND `headRevisionId` matches the last synced content revision, the app SHALL acquire or refresh the lock and enter Edit mode (keeping any unsaved local edits ready to **Save to Drive**).
- If another user holds the lock OR `headRevisionId` changed while disconnected:
  - When there are no unsaved local changes, the app SHALL load the latest Drive version in **Read-only** mode.
  - When there are unsaved local changes, the app SHALL show the changed-on-Drive prompt (**Save as a copy on Drive**, **Load latest from Drive**, **Cancel**) without overwriting the Drive file.

#### Scenario: Reloading a Drive build pauses it
- **WHEN** a student reloads the browser tab while a Drive-linked build is open (or opens it later from **File → Load…**)
- **THEN** the build opens paused with editing disabled, the Drive button reads **Reconnect to Drive**, and the banner offers **Reconnect to Drive** and **Work on this device only**

#### Scenario: Reconnecting when nobody else edited resumes Edit mode
- **WHEN** the student has unsaved local edits on a reloaded Drive build, selects **Reconnect to Drive**, and nobody else locked or saved a newer `headRevisionId` meanwhile
- **THEN** the app acquires or refreshes the lock, keeps the student's unsaved edits, restores the full editing workspace, and the Drive button reads **Save to Drive**

#### Scenario: Reconnecting with unsaved local changes after a teammate edited
- **WHEN** the student reloads with unsaved local edits, a teammate took the lock or saved a new version meanwhile, and the student selects **Reconnect to Drive**
- **THEN** the app does not overwrite the teammate's Drive file and shows the changed-on-Drive prompt

### Requirement: Working without Google Drive
A Drive-linked build SHALL never be unusable because Google Drive cannot be reached. From the paused state, **Work on this device only** SHALL work with no internet and no sign-in: it SHALL remove the build's link to the Drive file, keep every local edit, restore the full editing workspace, and leave the Drive file and its contents untouched (a lock this browser still holds is left to expire). The build then behaves as any local build, and **File → Save to Google Drive…** SHALL later save it as a new Drive file. If the connection or the sign-in is lost while the user is in Edit mode, editing SHALL continue with edits saved locally, the Drive button SHALL read **Reconnect to Drive**, and the next reconnect SHALL run the same reconciliation before anything is uploaded.

#### Scenario: No internet after a reload
- **WHEN** a student with no internet reloads a Drive-linked build and selects **Work on this device only**
- **THEN** the full editing workspace returns with all local edits, the Drive button is gone, and nothing is sent to Google

#### Scenario: Wi-Fi drops while editing
- **WHEN** the connection is lost while a student edits a Drive-linked build
- **THEN** the student can keep editing, the edits are saved on the device, and the Drive button reads **Reconnect to Drive**
