## MODIFIED Requirements

### Requirement: Changes to the build become steps
The system SHALL record one step for each change to the build's parts. A step SHALL be recorded when a part is added, moved, rotated, mated, deleted, duplicated, recolored, renamed, hidden or shown, locked or unlocked, when parts are grouped or ungrouped or a group is renamed, when an overlapping part is moved back to its last good pose, when the build is cleared or replaced with the starter, and when a smart action (auto-fasten, gear train, mirror) changes parts. A change to several parts at once (moving, turning, hiding, locking, deleting or cloning a group or a set of selected parts) SHALL be one step listing every part it changed. A change that leaves every part exactly as it was SHALL NOT create a step. Selection, the camera, explode view, viewport settings (snap, grid, connectors, Move/Rotate mode), Select mode, whether a group folder is open in the Outliner, and the Outliner's locate pin SHALL NOT create steps. When the app updates a part's overlap flag by itself, that SHALL NOT create a step.

#### Scenario: Dragging a part
- **WHEN** the user drags a part and releases it
- **THEN** one step is recorded for the whole drag, with the part's position before and after

#### Scenario: Selecting a part
- **WHEN** the user clicks a part to select it and nothing else changes
- **THEN** no step is recorded

#### Scenario: Same result twice
- **WHEN** the same part list arrives twice in a row (for example from an action reply and its live update)
- **THEN** only the first creates a step

#### Scenario: Grouping
- **WHEN** the user groups four selected parts
- **THEN** one step labeled "Group 4 parts as Group 1" is recorded, listing the four parts as changed, and undo leaves them ungrouped

#### Scenario: Opening a folder
- **WHEN** the user opens a group folder in the Outliner
- **THEN** no step is recorded
