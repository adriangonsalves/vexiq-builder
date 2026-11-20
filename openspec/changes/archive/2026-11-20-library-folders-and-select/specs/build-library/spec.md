## MODIFIED Requirements

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
