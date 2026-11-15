## MODIFIED Requirements

### Requirement: New and Starter
File → New SHALL make a new, empty build with a fresh history and make it current. File → Starter → a starter SHALL, when the open build has no parts or the user picks "Open by itself" (see add-to-build), make a new build holding that starter's parts, with a fresh history whose first step adds them, named after the starter ("Sample starter", then "Sample starter 2", …). Both SHALL turn Explode off, select nothing, and frame the view. When the user picks "Add to this build", the starter SHALL be added to the open build as add-to-build describes and no new build SHALL be made.

#### Scenario: Starter as a new build
- **WHEN** the user picks File → Starter → Sample starter with an empty build open
- **THEN** a new build named "Sample starter" with the starter parts is shown, and the build that was open is still in the library

#### Scenario: Starter added to the open build
- **WHEN** the open build has parts and the user picks File → Starter → Sample starter → "Add to this build"
- **THEN** the open build keeps its name and gains a group "Sample starter", and the library has no new build

### Requirement: Library
File → Load… SHALL open a library dialog listing every saved build, most recently changed first. Each entry SHALL show its picture, its name, when it was last changed and how many parts it has. The current build SHALL be marked. Each entry SHALL offer:
- **Open:** when the open build has no parts or the user picks "Open by itself" (see add-to-build), it becomes the current build with its parts, history and view settings; the dialog closes. When the user picks "Add to this build", its parts are added to the open build as add-to-build describes. Double-clicking the entry does the same as Open. Open on the current build itself does nothing.
- **Rename.**
- **Duplicate:** a copy named "<name> copy", with the same parts and history.
- **Delete:** asks first ("Delete <name>? This can't be undone."). Deleting SHALL remove the build from the browser's storage for good. Deleting the current build SHALL open the most recently changed other build, or a new empty build if none is left.

The dialog SHALL also have **Open from computer…**, which picks a `.vexiq.json` file. When the open build has no parts or the user picks "Open by itself", the file SHALL be added to the library as a new build named after the file (without `.vexiq.json`) and opened. When the user picks "Add to this build", the file's parts SHALL be added to the open build as add-to-build describes and the library SHALL NOT gain a build. A file that can't be read SHALL show a message and change nothing.

#### Scenario: Open an older build
- **WHEN** the user opens the library, clicks Open on "Build #1" and picks "Open by itself"
- **THEN** "Build #1" is shown with its parts, and undo steps back through its own history

#### Scenario: Delete asks first
- **WHEN** the user clicks Delete on a build and confirms
- **THEN** it is gone from the library, and if it was the current build, the most recently changed other build is shown

#### Scenario: Open from computer
- **WHEN** the user picks "Open from computer…" with an empty build open and chooses `drivetrain.vexiq.json`
- **THEN** a build named "drivetrain" is added to the library and shown

#### Scenario: Add a file to the open build
- **WHEN** the open build has parts and the user picks "Open from computer…", chooses `claw.vexiq.json` and picks "Add to this build"
- **THEN** the open build gains a group "claw" and the library has no build named "claw"
