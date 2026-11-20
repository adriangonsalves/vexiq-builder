## ADDED Requirements

### Requirement: Drive folder metadata for library grouping
While staying within the `drive.file` OAuth scope, the app SHALL record best-effort folder metadata on each Drive-linked build (`folderId`, `folderName`, and `parentFolderName` when accessible) so **File → Load…** can group Drive builds by their Drive folder and disambiguate duplicate folder names:
- When saving a build to a chosen folder via **Save to Google Drive…**, the app SHALL store that folder's `id` and `name`, attempt a best-effort metadata read for that folder's parent folder name (ignoring permission/404 errors), and store the known `folderName` (and `parentFolderName`, if known) in the Drive file's `appProperties` so teammates who later open the file can see its folder name too.
- When saving a build directly to **My Drive**, the app SHALL record the folder as My Drive.
- When opening or reconnecting a Drive file, the app SHALL read `parents` and any stored folder metadata from `appProperties`, and attempt a best-effort metadata read for the file's parent folder (and its parent, if accessible) without failing the open or reconnect if Google Drive restricts access under `drive.file`.
- When a Drive file's folder name cannot be determined under `drive.file`, the build SHALL still open and sync normally and appear under a fallback **"Google Drive"** folder group in **File → Load…**.

#### Scenario: Saving to a chosen Drive folder records folder metadata
- **WHEN** the user saves "Clawbot" via **File → Save to Google Drive… → Choose a folder…** and picks the folder "Team Robot"
- **THEN** the saved build record and Drive `appProperties` record "Team Robot" as the build's Drive folder, and **File → Load…** groups "Clawbot" under "Team Robot"

#### Scenario: Teammate opening a file sees its folder name
- **WHEN** Student A saved `TeamBot.vexiq.json` into "Team Robot" from VEX IQ Builder and Student B opens `TeamBot.vexiq.json` via **Open from Google Drive…**
- **THEN** Student B's library groups `TeamBot` under "Team Robot" even if `drive.file` does not allow reading the parent folder object directly

#### Scenario: Unreadable folder falls back cleanly
- **WHEN** a user opens a Drive file placed in a folder outside VEX IQ Builder and Google Drive returns 404 for the parent folder metadata under `drive.file`
- **THEN** the file still opens normally without error and appears under the "Google Drive" group in **File → Load…**
