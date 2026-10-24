## Purpose

Keeps every change to a build as a step that can be undone, redone and saved with the file, so no work is ever lost and the way a robot was put together is preserved.

## ADDED Requirements

### Requirement: Changes to the build become steps
The system SHALL record one step for each change to the build's parts. A step SHALL be recorded when a part is added, moved, rotated, mated, deleted, duplicated, recolored, renamed, hidden or shown, locked or unlocked, when an overlapping part is moved back to its last good pose, when the build is cleared or replaced with the starter, and when a smart action (auto-fasten, gear train, mirror) changes parts. A change that leaves every part exactly as it was SHALL NOT create a step. Selection, the camera, explode view and viewport settings (snap, grid, connectors, Move/Rotate mode) SHALL NOT create steps. When the app updates a part's overlap flag by itself, that SHALL NOT create a step.

#### Scenario: Dragging a part
- **WHEN** the user drags a part and releases it
- **THEN** one step is recorded for the whole drag, with the part's position before and after

#### Scenario: Selecting a part
- **WHEN** the user clicks a part to select it and nothing else changes
- **THEN** no step is recorded

#### Scenario: Same result twice
- **WHEN** the same part list arrives twice in a row (for example from an action reply and its live update)
- **THEN** only the first creates a step

### Requirement: Steps describe themselves
Each step SHALL have a short label saying what changed and to which part or parts (for example "Move Left Inner Wall", "Delete 1x Standoff #3", "Clear assembly"), the time it was made, and its source: `app` (the user in the app), `mcp` (an MCP tool), `assistant` (an in-page WebMCP assistant) or `action` (a smart action run from the app). Each step SHALL also list the parts it added, removed and changed.

#### Scenario: Recolor
- **WHEN** the user picks a new color for the selected part "2x12 Beam #1"
- **THEN** the new step's label names the part and the change, its source is `app`, and it lists that one part as changed

### Requirement: Typing in a field is one step
Changes made by typing into one Inspector field (position, rotation, label), and by repeated nudge-button clicks on the same part, SHALL be merged into one step while they continue, for as long as no more than 1 second passes between changes. Changing to a different part, a different kind of change, or pausing longer starts a new step.

#### Scenario: Typing a coordinate
- **WHEN** the user types "63.5" into the X position field of a part
- **THEN** the history gains one step that moves the part to x = 63.5, not one step per keystroke

### Requirement: Unlimited undo and redo
Undo SHALL put the build back to how it was before the current step; redo SHALL apply the next step again. There SHALL be no limit on how many steps can be undone or kept. Undo and redo SHALL be available from toolbar buttons and the keys Ctrl/Cmd+Z (undo) and Shift+Ctrl/Cmd+Z or Ctrl+Y (redo). When focus is in a text field, those keys SHALL keep their normal text-editing behavior. Undo SHALL be unavailable at the first step and redo at the last step of the current line, and the buttons SHALL show that. After undo or redo, any part whose pose changed SHALL have its overlap status checked again.

#### Scenario: Undo a delete
- **WHEN** the user deletes a part and presses Ctrl+Z
- **THEN** the part is back with the same id, label, color, position and rotation

#### Scenario: Undo across many steps
- **WHEN** the user makes 500 changes and then presses undo 500 times
- **THEN** the build is back to how it was before the first of those changes

#### Scenario: Key in a text field
- **WHEN** the user is typing in the part search box and presses Ctrl+Z
- **THEN** the text in the box is undone and the build history does not move

### Requirement: Branches are kept
If the user undoes one or more steps and then makes a new change, the undone steps SHALL stay in the history as a branch, and the new change SHALL start a new branch from that point. Redo SHALL follow the branch that was most recently used. The user SHALL be able to switch to any branch and continue from it. No step SHALL ever be deleted by undo, redo, scrubbing or branching.

#### Scenario: Edit after undo
- **WHEN** the user adds parts A, B and C, undoes twice, then adds part D
- **THEN** the build has A and D, and the history still holds the branch with B and C, which the user can switch to and get A, B and C back

### Requirement: History is saved with the build
The history SHALL be saved with the build in `public/assembly-state.json` and in exported `.vexiq.json` files, and SHALL be restored when the app starts or a file is opened, including the current step and branches. The saved `instances` list SHALL stay as it is today, so a reader that ignores history still opens the file. Replaying the saved history from its start to its current step SHALL give exactly the saved `instances`. If the export leaves out overlapping parts, the saved history SHALL end with a step that removes them. History SHALL NOT be stored in the browser's local storage.

#### Scenario: Export and reopen
- **WHEN** the user exports a build with 40 steps and later opens that file
- **THEN** the same 40 steps, branches and current step are back, and undo works through all of them

#### Scenario: Restart the app
- **WHEN** the app is reloaded
- **THEN** the history from `assembly-state.json` is restored with the build

### Requirement: Files without history
When a build is opened that has parts but no history (a file saved before this change, or an `assembly-state.json` written by an older tool), the system SHALL start its history with one step labeled "Starting assembly" that adds all of its parts, from an empty build.

#### Scenario: Old file
- **WHEN** the user opens a `.vexiq.json` saved before this change that has 65 parts
- **THEN** the history has one step that adds the 65 parts, and undoing it leaves an empty build

### Requirement: Opening a file replaces the history
Opening a `.vexiq.json` file SHALL replace the current build and its history with the file's build and history.

#### Scenario: Open another build
- **WHEN** the user has a build with history and opens a different file
- **THEN** the timeline shows the opened file's history, not the previous build's
