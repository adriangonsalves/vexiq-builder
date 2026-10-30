# mcp-selection-groups Specification

## Purpose
Lets an assistant connected over MCP select parts, find connected parts, and make, change, move and delete groups, with the same rules and results as doing it in the app.

## Requirements

### Requirement: Select parts over MCP
The `select_parts` tool SHALL change the app's selection. It SHALL take a `mode`: `replace` (default), `add`, `remove`, `all` (every visible part), `none` or `invert`, with `instanceIds` for `replace`, `add` and `remove`. With `connected: true` it SHALL then select every part joined to the chosen parts, by the same rules as Select Connected in the app (see multi-select). With `expandLayers: n` it SHALL instead add n layers of directly joined parts, by the same rules as expanding the selection with Shift+wheel in the app (see multi-select); `connected` and `expandLayers` SHALL NOT be given together. With `expandGroups` (default true), a part in a group SHALL bring in its whole group, as a click in the 3D view does. The reply SHALL list the selected parts (id and label), the primary part, and the groups they belong to. Unknown ids SHALL be refused with an error naming them, and the selection SHALL stay as it was. The open app SHALL show the new selection straight away. Selecting SHALL NOT create a history step.

#### Scenario: Select a drive side
- **WHEN** the assistant calls `select_parts` with one side plate's id and `connected: true`
- **THEN** the reply lists the same parts Select Connected selects in the app, and the app highlights them

#### Scenario: Expand one layer
- **WHEN** the assistant calls `select_parts` with a beam's id and `expandLayers: 1`
- **THEN** the reply lists the beam and the pins seated in it, and nothing further

#### Scenario: Unknown id
- **WHEN** the assistant calls `select_parts` with an id that is not in the build
- **THEN** the call fails naming that id and the selection is unchanged

#### Scenario: Grouped part
- **WHEN** the assistant selects one part of the group "Claw" with default options
- **THEN** every part of "Claw" is selected

### Requirement: Group and ungroup over MCP
The `group_parts` tool SHALL group the given `instanceIds`, or the current selection when none are given, with an optional `name` (default "Group N"), following the same rules as Group in the app (two or more parts; parts leave their old group; groups left with one part are dissolved). It SHALL reply with the new group's id, name and parts, and select the group. The `ungroup_parts` tool SHALL take a `groupId` or `instanceIds` and dissolve every group they name or belong to, leaving the parts where they are. Each call SHALL be one history step with source `mcp`, and SHALL NOT move any part.

#### Scenario: Group the selection
- **WHEN** five parts are selected and the assistant calls `group_parts` with `name: "Left Drive"`
- **THEN** the app's Outliner shows a "Left Drive" folder with the five parts, and one undo removes the group

#### Scenario: Too few parts
- **WHEN** the assistant calls `group_parts` with one id
- **THEN** the call fails saying a group needs two or more parts, and nothing changes

### Requirement: Change, move and turn a group over MCP
The `update_group` tool SHALL act on a `groupId`, or on a list of `instanceIds` treated as one set. It SHALL accept any of: `name` (groups only; not empty), `visible`, `locked`, `moveBy` ([x, y, z] mm), `moveCentreTo` ([x, y, z] mm, the centre of the parts' combined bounding box), and `turn` ({ `axis`: X, Y or Z, `deg` }, about that centre). Moves and turns SHALL keep the parts' places relative to one another, exactly as moving a set in the app does. Everything given in one call SHALL be one history step with source `mcp`, labeled with the group name or the part count. A move or turn of a set holding a locked part SHALL be refused with "Part is locked" and change nothing. The reply SHALL give the set's new centre and the same short check summary as `place_parts` (overlaps with parts outside the set, floating and half-seated fasteners, unsecured parts, disconnected groups). Parts inside the set SHALL NOT count as overlapping one another.

#### Scenario: Move a group
- **WHEN** the assistant calls `update_group` on "Left Drive" with `moveBy: [0, 0, 25.4]`
- **THEN** every part of "Left Drive" moves 25.4 mm along Z in one step, and the reply gives the new centre

#### Scenario: Turn keeps pins seated
- **WHEN** the assistant turns a group of a beam and its pins by 90° about Y
- **THEN** the reply's check summary shows no floating or half-seated pins in that group

#### Scenario: Rename
- **WHEN** the assistant calls `update_group` with `name: "Claw"`
- **THEN** the folder in the app is named "Claw"

### Requirement: Delete a group over MCP
The `remove_part` tool SHALL also accept a `groupId`, and then remove every part of that group as one history step. Giving both `instanceId` and `groupId`, or a `groupId` that does not exist, SHALL be refused with an error.

#### Scenario: Remove a group
- **WHEN** the assistant calls `remove_part` with the id of the 14-part group "Left Drive"
- **THEN** all 14 parts are removed and one undo brings them back

### Requirement: Selection and groups in get_assembly
`get_assembly` SHALL report `selectedIds` and `selectedId` (the primary part), each part's `groupId` and `groupName`, and a `groups` list with each group's id, name, part ids and centre. Builds without groups SHALL report an empty `groups` list.

#### Scenario: Read groups
- **WHEN** the build has the groups "Left Drive" and "Claw" and the assistant calls `get_assembly`
- **THEN** the `groups` list names both with their parts and centres
