## Purpose

Lets builders keep many builds in the browser without ever pressing Save: every build saves itself as it changes, a File menu starts new or starter builds, and a library shows every saved build with a picture to open, rename, copy or delete.

## ADDED Requirements

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
The current build SHALL be saved to the browser's storage about one second after each change: its parts, its undo history, its view settings, its name and a small picture. The same applies to changes made by the assistant while the app is open. There SHALL be no Save button. A build SHALL never be lost by New, Starter, opening another build, closing the tab or reloading. Reloading SHALL open the build that was current.

#### Scenario: Reload keeps the build
- **WHEN** the user adds two parts and reloads the page
- **THEN** the same build opens with both parts and its undo history

#### Scenario: New keeps the old build
- **WHEN** the user has "Build #1" with parts and picks File → New
- **THEN** an empty "Build #2" is shown, and "Build #1" with its parts is in the library

### Requirement: Build names
A new build SHALL be named "Build #N", where N is one more than the highest number used by any build named that way in the library (1 when there is none). The current build's name SHALL show in the toolbar beside the title. Clicking it SHALL let the user type a new name; Enter or clicking away SHALL keep it, Esc SHALL cancel, and an empty name SHALL keep the old one. Renaming SHALL NOT add a history step.

#### Scenario: Rename in the toolbar
- **WHEN** the user clicks "Build #3" in the toolbar, types "Clawbot" and presses Enter
- **THEN** the toolbar and the library show "Clawbot"

### Requirement: New and Starter
File → New SHALL make a new, empty build with a fresh history and make it current. File → Starter → a starter SHALL make a new build holding that starter's parts, with a fresh history whose first step adds them, named after the starter ("Sample starter", then "Sample starter 2", …). Both SHALL turn Explode off, select nothing, and frame the view.

#### Scenario: Starter as a new build
- **WHEN** the user picks File → Starter → Sample starter
- **THEN** a new build named "Sample starter" with the starter parts is shown, and the build that was open is still in the library

### Requirement: Library
File → Load… SHALL open a library dialog listing every saved build, most recently changed first. Each entry SHALL show its picture, its name, when it was last changed and how many parts it has. The current build SHALL be marked. Each entry SHALL offer:
- **Open:** it becomes the current build with its parts, history and view settings; the dialog closes. Double-clicking the entry does the same.
- **Rename.**
- **Duplicate:** a copy named "<name> copy", with the same parts and history.
- **Delete:** asks first ("Delete <name>? This can't be undone."). Deleting SHALL remove the build from the browser's storage for good. Deleting the current build SHALL open the most recently changed other build, or a new empty build if none is left.

The dialog SHALL also have **Open from computer…**, which picks a `.vexiq.json` file. The file SHALL be added to the library as a new build named after the file (without `.vexiq.json`) and opened. A file that can't be read SHALL show a message and change nothing.

#### Scenario: Open an older build
- **WHEN** the user opens the library and clicks Open on "Build #1"
- **THEN** "Build #1" is shown with its parts, and undo steps back through its own history

#### Scenario: Delete asks first
- **WHEN** the user clicks Delete on a build and confirms
- **THEN** it is gone from the library, and if it was the current build, the most recently changed other build is shown

#### Scenario: Open from computer
- **WHEN** the user picks "Open from computer…" and chooses `drivetrain.vexiq.json`
- **THEN** a build named "drivetrain" is added to the library and shown

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
