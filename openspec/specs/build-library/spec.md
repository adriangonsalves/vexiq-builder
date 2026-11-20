# build-library Specification

## Purpose
Lets builders keep many builds in the browser without ever pressing Save: every build saves itself as it changes, a File menu starts new or starter builds, and a library shows every saved build with a picture to open, rename, copy or delete.

## Requirements

### Requirement: File menu
The toolbar SHALL have a File drop-down in place of the Starter, Save and Load buttons, with:
- **New**;
- **Starter ▸**, a submenu listing every starter build by name;
- **Load…**;
- **Export**;
- **Delete this build…**: asks first ("Delete <name>? This can't be undone."), then deletes the current build from the browser's storage as Delete in the library does.

Starters SHALL be defined as a list of named part layouts, so more can be added without changing the menu. The menu SHALL open and close like the other toolbar drop-downs.

#### Scenario: File menu contents
- **WHEN** the user opens the File menu
- **THEN** it shows New, Starter ▸, Load…, Export and Delete this build…, and hovering or clicking Starter shows "Sample starter"

#### Scenario: Delete the open build from the File menu
- **WHEN** the user picks File → Delete this build… on "Build #2" and confirms
- **THEN** "Build #2" is removed from the browser's storage, and the most recently changed other build is shown (or a new empty build if none is left)

#### Scenario: Cancel a delete
- **WHEN** the user picks File → Delete this build… and cancels
- **THEN** nothing changes

### Requirement: Builds save themselves
The current build SHALL be saved to the browser's storage about one second after each change: its parts, its undo history, its view settings, its name and a small picture. The same applies to changes made by the assistant while the app is open. There SHALL be no Save button. A build SHALL never be lost by New, Starter, opening another build, closing the tab or reloading. Reloading SHALL open the build that was current, except that an unedited starter (not yet saved to the library) SHALL NOT create a library entry on reload, tab close, or switch.

#### Scenario: Reload keeps the build
- **WHEN** the user adds two parts and reloads the page
- **THEN** the same build opens with both parts and its undo history

#### Scenario: New keeps the old build
- **WHEN** the user has "Build #1" with parts and picks File → New
- **THEN** an empty "Build #2" is shown, and "Build #1" with its parts is in the library

#### Scenario: Unedited starter is not saved on switch or close
- **WHEN** the user opens a starter ("Huey") by itself, orbits the camera, runs Play mode or a drop test, and then switches to another build or closes the tab without changing any parts
- **THEN** no "Huey" entry is created in the browser's library

### Requirement: Build names
A new build SHALL be named "Build #N", where N is one more than the highest number used by any build named that way in the library (1 when there is none). The current build's name SHALL show in the toolbar beside the title. Clicking it SHALL let the user type a new name; Enter or clicking away SHALL keep it, Esc SHALL cancel, and an empty name SHALL keep the old one. Renaming SHALL NOT add a history step.

#### Scenario: Rename in the toolbar
- **WHEN** the user clicks "Build #3" in the toolbar, types "Clawbot" and presses Enter
- **THEN** the toolbar and the library show "Clawbot"

### Requirement: New and Starter
File → New SHALL make a new, empty build with a fresh history and make it current. File → Starter → a starter SHALL, when the open build has no parts or the user picks "Open by itself" (see add-to-build), load that starter's parts with a fresh history whose first step adds them, showing the starter's name without creating a library entry yet. Both SHALL turn Explode off, select nothing, and frame the view. When the open build has parts — including when it is an unedited starter — opening another starter, saved build, or file SHALL still prompt whether to open it by itself or add it to the open build. When the user picks "Add to this build", the picked build SHALL be added to the open build as add-to-build describes and no separate build SHALL be made.

An unedited starter SHALL be promoted into a saved build in the library — named after the starter ("Huey", then "Huey 2", …) — as soon as the user makes a change to its parts/history (including "Add to this build" or an assistant edit), explicitly renames it, or saves it to Google Drive. If a starter was promoted solely by edits (not explicitly renamed or linked to Google Drive) and the user undoes all changes so the build returns to the starter's initial state, it SHALL return to the unsaved starter state and any auto-created library entry for it SHALL be removed.

#### Scenario: Starter as a new build
- **WHEN** the user picks File → Starter → Sample starter with an empty build open and waits more than one second without editing parts
- **THEN** the starter parts are shown with the name "Sample starter", the previously open build (if any) remains in the library, and no new "Sample starter" entry is created in the library until edited

#### Scenario: Starter promoted on first edit
- **WHEN** the user has opened starter "Huey" (unsaved) and moves or deletes a part
- **THEN** after about a second, a build named "Huey" (or "Huey 2" if "Huey" already exists in the library) is saved in the library with the change

#### Scenario: Starter undone back to initial state is not saved
- **WHEN** the user has opened starter "Huey", moves a part (which autosaves "Huey" in the library), and then clicks Undo so the build returns to Huey's initial step
- **THEN** the auto-created "Huey" entry is removed from the library and the open starter returns to the unsaved state

#### Scenario: Explicitly renamed starter stays saved after undo
- **WHEN** the user opens starter "Huey", renames it to "My Huey", moves a part, and then clicks Undo
- **THEN** "My Huey" remains saved in the library

#### Scenario: Opening another build while viewing an unedited starter still prompts
- **WHEN** the user is viewing an unedited starter ("Huey") and picks File → Starter → Simple claw (or opens a saved build or file)
- **THEN** the app prompts whether to open it by itself or add it to the open build; picking "Add to this build" adds "Simple claw" as a group to Huey and promotes Huey to a saved build in the library

#### Scenario: Starter added to the open build
- **WHEN** the open build has parts and the user picks File → Starter → Sample starter → "Add to this build"
- **THEN** the open build keeps its name and gains a group "Sample starter", and the library has no new build

### Requirement: Library
File → Load… SHALL open a library dialog listing every saved build, most recently changed first within each section. Each entry SHALL show its picture, its name, when it was last changed and how many parts it has. The current build SHALL be marked. Each entry linked to a Google Drive file SHALL show a distinct Google Drive indicator.

Clicking or tapping an entry's picture (thumbnail) SHALL open that build, and entries SHALL NOT have a separate Open button:
- When the open build has no parts or the user picks "Open by itself" (see add-to-build), the chosen build becomes the current build with its parts, history and view settings; the dialog closes.
- When the user picks "Add to this build", its parts are added to the open build as add-to-build describes.
- Clicking the current build's thumbnail does nothing.

Each entry SHALL still offer:
- **Rename.**
- **Duplicate:** a copy named "<name> copy", with the same parts and history (kept in the same local folder as the original, if any).
- **Delete:** asks first ("Delete <name>? This can't be undone."). Deleting SHALL remove the build from the browser's storage for good. Deleting the current build SHALL open the most recently changed other build, or a new empty build if none is left.

The dialog SHALL support **multi-select** on desktop, tablet, and phone via a **Select** toggle in the header:
- While Select mode is active, clicking or tapping a build card toggles its selection instead of opening it, and per-card action buttons are hidden.
- When Select mode is active, a bulk action bar SHALL offer:
  - **Select all / Deselect all:** selects every currently visible build (or clears the selection when all visible builds are already selected). Each visible folder or duplicate group section header SHALL also offer a per-section **Select all** toggle while Select mode is active.
  - **Move to folder…** (enabled when one or more builds are selected and all selected builds are local builds): lets the user pick an existing local folder, create a new single-level local folder, or remove the selected builds from their folder (back to ungrouped local builds). Drive-linked builds SHALL NOT be moved into local folders.
  - **Delete:** asks once ("Delete N builds? This can't be undone."), removes all selected builds from the browser's storage, and if the current build was among them, opens the most recently changed remaining build (or a new empty build if none is left).
  - **Cancel / Done:** exits Select mode and clears the selection.

The dialog SHALL offer a **Group duplicates** toggle in the header (when at least two builds exist):
- Two builds SHALL be considered identical when they have the same parts with the same positions, rotations, colors, and flexible geometry (sheet bends, bands, ropes), ignoring build name, internal part IDs, part order, timestamps, and undo history.
- When **Group duplicates** is active, the dialog SHALL show only groups containing two or more identical builds (or a clear "No identical builds found." message when there are none).
- Each duplicate group header SHALL offer **Select all** (entering Select mode if needed and selecting every build in that group) and **Select extras** (entering Select mode if needed and selecting all copies in that group except one kept copy, preferring a Drive-linked or currently open build, otherwise the most recently updated copy).

The dialog SHALL organize builds into sections:
- **Local builds** not in a folder appear together, and **local folders** (single-level) appear as collapsible folder sections holding the local builds grouped in them. Each local folder header SHALL allow renaming the folder or removing the folder (removing a folder ungroups its builds rather than deleting them).
- **Google Drive builds** SHALL be grouped under collapsible sections named after the Google Drive folder they live in (with a **"Google Drive"** fallback section when Drive does not expose the folder's name, and **"My Drive"** for builds saved directly in My Drive).
- **Duplicate folder names:** whenever two or more folder sections shown in the library share the same folder name (ignoring case and outer whitespace), each colliding folder's heading SHALL include its parent folder name (for example `Drivetrains (2025)` and `Drivetrains (2026)`, or `Team Builds (My Drive)` vs `Team Builds (Local)` when a Drive folder and a local folder share a name) so the user can tell them apart.

The dialog SHALL also have **Open from computer…**, which picks a `.vexiq.json` file. When the open build has no parts or the user picks "Open by itself", the file SHALL be added to the library as a new build named after the file (without `.vexiq.json`) and opened. When the user picks "Add to this build", the file's parts SHALL be added to the open build as add-to-build describes and the library SHALL NOT gain a build. A file that can't be read SHALL show a message and change nothing.

#### Scenario: Open an older build
- **WHEN** the user opens the library, clicks the thumbnail of "Build #1" and picks "Open by itself"
- **THEN** "Build #1" is shown with its parts, and undo steps back through its own history

#### Scenario: No separate Open button on build cards
- **WHEN** the user opens File → Load…
- **THEN** build cards do not display a separate Open button, and clicking the current build's thumbnail does not reopen or change the build

#### Scenario: Multi-select and group local builds into a new folder
- **WHEN** the user opens File → Load…, taps **Select**, taps "Build #1" and "Build #2", chooses **Move to folder…**, and creates a new folder named "Drivetrains"
- **THEN** both builds appear together under the "Drivetrains" folder section and Select mode exits

#### Scenario: Multi-select and delete multiple builds
- **WHEN** the user opens File → Load…, taps **Select**, selects two builds, taps **Delete**, and confirms
- **THEN** both builds are removed from the browser's storage, and if the current build was deleted, the most recently changed remaining build opens

#### Scenario: Google Drive indicator and folder grouping
- **WHEN** the library contains a local build "Clawbot" and two Drive-linked builds saved in the Drive folder "Team 1234"
- **THEN** the two Drive-linked build cards display a Google Drive indicator and appear grouped under a "Team 1234" folder section, while "Clawbot" appears without the Drive indicator in the local section

#### Scenario: Duplicate folder names show parent folder name
- **WHEN** the library has builds in two Drive folders both named "Drivetrains", one inside "2025" and one inside "2026"
- **THEN** the two folder headings display their parent folder names (e.g. `Drivetrains (2025)` and `Drivetrains (2026)`)

#### Scenario: Group identical builds and select extras
- **WHEN** the library has three builds with identical parts and poses (named "Huey", "Huey 2", and "Huey 3") plus one unique build "Clawbot", and the user toggles **Group duplicates**
- **THEN** only the duplicate group of 3 identical builds is shown, and tapping **Select extras** enters Select mode with 2 of the 3 builds selected (leaving 1 kept copy unselected)

#### Scenario: Select all visible builds
- **WHEN** the user enters Select mode and taps **Select all**
- **THEN** every currently visible build is selected, and tapping **Deselect all** clears the selection

#### Scenario: Delete asks first
- **WHEN** the user clicks Delete on a build and confirms
- **THEN** it is gone from the library, and if it was the current build, the most recently changed other build is shown

#### Scenario: Open from computer
- **WHEN** the user picks "Open from computer…" with an empty build open and chooses `drivetrain.vexiq.json`
- **THEN** a build named "drivetrain" is added to the library and shown

#### Scenario: Add a file to the open build
- **WHEN** the open build has parts and the user picks "Open from computer…", chooses `claw.vexiq.json` and picks "Add to this build"
- **THEN** the open build gains a group "claw" and the library has no build named "claw"

### Requirement: Export
File → Export SHALL download the current build as a `.vexiq.json` file named after the build (for example `Clawbot.vexiq.json`), with the same content rules as before: its history, and overlapping parts left out with a closing step.

#### Scenario: Export named after the build
- **WHEN** the current build is "Clawbot" and the user picks File → Export
- **THEN** a file `Clawbot.vexiq.json` is downloaded

### Requirement: The current build is shared
The current build's id and name SHALL be saved with the build state that the app's bridge and the assistant use, so that:
- every open tab shows the same current build and name;
- the assistant's changes go to the current build;
- a build opened, made or renamed in one tab is current in the others too.

The library itself lives in each browser's storage. A tab SHALL save a change it receives into the library entry for that build.

#### Scenario: Assistant edits are kept
- **WHEN** the app is open on "Clawbot" and the assistant places a part
- **THEN** after about a second, the library's "Clawbot" entry has the new part

### Requirement: Taking over the old single build
On the first start with an empty library, the build that was open before this change (the saved build state) SHALL become "Build #1" in the library, with its history, so nothing is lost.

#### Scenario: First start after the update
- **WHEN** the app starts with an empty library and a saved build of 26 parts
- **THEN** the library has "Build #1" with the 26 parts, and it is shown
