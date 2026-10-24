## Purpose

Records what an agent does over MCP in the build history, the same way as changes made in the app, and lets an agent read the history and undo or redo, so a robot built over MCP can be replayed and corrected.

## ADDED Requirements

### Requirement: One step per MCP call
Each MCP tool call that changes the build SHALL add exactly one step with source `mcp`, holding every part it added, removed or changed, in the order the tool processed them. This SHALL apply to `place_part`, `place_parts` (including mirrored items), `update_part`, `align_part_to_hole`, `mate_parts`, `auto_fasten_joint`, `mesh_gear_train`, `mirror_subassembly`, `remove_part` and `clear_assembly`. Calls that don't change any part SHALL NOT add a step. That covers `dryRun` and refused `rejectIntersecting` calls, reading tools, and `configure_viewport`. The step SHALL be recorded whether or not the app is open, and SHALL appear in the app's history and timeline right away when it is.

#### Scenario: Batch placement
- **WHEN** an agent calls `place_parts` with 36 items and `mirror` on, and 72 parts are placed
- **THEN** the history gains one MCP step that adds the 72 parts in placement order, and one undo removes all 72

#### Scenario: Check only
- **WHEN** an agent calls `place_parts` with `dryRun: true`
- **THEN** no step is added

#### Scenario: App closed
- **WHEN** an agent places parts while the app isn't running, then the user opens the app
- **THEN** the agent's steps are in the timeline

### Requirement: MCP step labels
An MCP step's label SHALL start with the tool name followed by a short summary of what changed. Examples: `place_parts: 72 parts`, `remove_part: Left Motor Pin 3`, `clear_assembly`, `update_part: move Robot Brain`.

#### Scenario: Remove one part
- **WHEN** an agent removes the part labeled "Left Motor Pin 3"
- **THEN** the step label is `remove_part: Left Motor Pin 3`

### Requirement: MCP changes continue the current line
An MCP change SHALL be recorded after the build's current step. If the user has scrubbed or undone back in the app, the MCP change SHALL start a new branch from there, as an app change would. The agent's reply SHALL say when its change started a new branch.

#### Scenario: User scrubbed back
- **WHEN** the user has scrubbed to step 10 of 40 and an agent then places a part
- **THEN** the placement becomes step 11 on a new branch, the old steps 11–40 stay as a branch, and the tool reply mentions the new branch

### Requirement: History tools
The MCP server SHALL provide:
- `get_history`: returns the steps on the current line (number, label, source, time, and counts of added, removed and changed parts), which step is current, and where branches split off. It SHALL support returning only the last N steps, with a default of 50.
- `undo`: moves back a given number of steps, 1 by default.
- `redo`: moves forward a given number of steps on the current line, 1 by default.

`undo` and `redo` SHALL refuse with a clear message when there is nothing to undo or redo, SHALL report the step they ended on and what changed, and SHALL update the open app like any other change, including its `appSync` status. Undo and redo SHALL NOT add steps.

#### Scenario: Agent backs out its own mistake
- **WHEN** an agent's `place_parts` call placed parts in the wrong spot and it calls `undo`
- **THEN** those parts are removed, the reply names the step that was undone, and the app shows the build without them

#### Scenario: Nothing to undo
- **WHEN** an agent calls `undo` on an empty history
- **THEN** the reply says there is nothing to undo and nothing changes

### Requirement: get_assembly stays small
`get_assembly` SHALL NOT include the full history in its reply. It SHALL include only the current step number and the total number of steps.

#### Scenario: Large history
- **WHEN** a build has 2,000 steps and an agent calls `get_assembly`
- **THEN** the reply holds the parts and a step count, not the 2,000 steps
