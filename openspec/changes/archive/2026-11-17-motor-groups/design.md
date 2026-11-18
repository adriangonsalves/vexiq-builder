## Context

- Part groups (`src/utils/partGroups.js`) store membership on each part: `groupId` and `groupName`, with pure helpers that return patch lists `[{ id, fields }]` so the app makes one history step and the MCP server one `mcp` step. Motor groups follow the same pattern, on separate fields, because a motor is usually already in a part group such as "Left Drive" (user chose a separate Outliner section).
- Play mode: `playInputs` (`src/engine/core.js`) lists motors for the graph; the Play panel (`src/components/PlayPanel.jsx`) renders one row per motor and calls `onThrottle(id, value)`, which App passes to `playRef.current.runner.setThrottle(id, value)`. The simulation steps with `Map<motorId, -1..1>`.
- The `motor-stopping` change (unarchived, same area) adds the Keep checkbox and the stopping-mode chips per row, and lets App save `stopping` on a motor while in Play (`inPlay: true` history step). This change builds on it.

## Goals / Non-Goals

**Goals:**
- One shared, pure module for motor-group membership, used by the app and the MCP server.
- Group throttles fan out to motor throttles before the simulation, so physics and kinematic code stay unchanged.

**Non-Goals:**
- Drivetrain controls (one stick for forward and turn, as a VEX controller has). A later change can build on motor groups.
- Motor groups in programs or blocks; there is no code editor.
- Nesting motor groups, or a motor in two groups.

## Decisions

1. **Data on the motor instance**: `motorGroupId`, `motorGroupName`, `motorReversed` (true = opposite), mirroring `groupId`/`groupName`. A group exists when two or more visible-or-hidden motors share a `motorGroupId`; a lone leftover id is ignored (as `groupsOf` does). Name conflicts resolve by most common name. *Alternative*: a top-level `motorGroups` list in the build. Rejected: every save, history, library, MCP and copy path already carries instance fields; a separate list would need plumbing through all of them and could point at deleted motors.

2. **`src/utils/motorGroups.js`** (pure, no React/THREE scene): `motorGroupsOf(instances)` → `Map<id, { id, name, motors: [{ id, reversed }] }>`; `makeMotorGroup(instances, ids, name?)`, `setMotorReversed`, `renameMotorGroup`, `removeFromMotorGroup`, `breakMotorGroup` → patch lists; `nextMotorGroupName`; `groupThrottles(groupValues, motorValues, groups)` → per-motor `Map`. Smart Motor test: the part has `hubSpecs` (same as `playInputs`).

3. **Starting direction**: compare each motor's drive-socket axis in world space (the socket axis from the part's `hubSpecs`, turned by the motor's rotation, as `motorHub.js` does) with the first motor's. Dot product below −0.5 → opposite; otherwise same. *Alternative*: always start same. Rejected: a mirrored drive would spin and kids wouldn't know why. Motors at right angles stay same; the user flips if needed.

4. **Play panel controls**: App builds the panel's control list from `play.graph.motors` plus `motorGroupsOf(instances)`: one entry per motor group (key `mg:<groupId>`) and one per ungrouped motor. The panel keeps its throttle/Keep state per control key. `onThrottle(key, v)` in App: for a group, call `runner.setThrottle(motorId, reversed ? -v : v)` for each motor. Direction flips while playing re-send the current group throttle. Stopping mode on a group row calls the existing stopping handler for every motor, batched into one history step. Status: Stalled if any member stalled; rpm = max |rpm| of members.

5. **Direction flip in Play**: allowed like the stopping mode (`inPlay: true` history step), because fixing a spinning robot is the common need. Nothing else becomes editable.

6. **Outliner**: a "Motor groups" section rendered above the existing rows, its own open/closed set. Folder click selects the motors via `onSelectIds(motorIds)` directly, bypassing `expandToGroups`, so a part group the motor is in is not pulled in. Rename: a pencil button on the folder row turns the name into a text field (Enter or blur saves, Esc cancels); works by tap. Buttons sized for touch like the existing hide/lock buttons.

7. **Copies**: wherever `groupId`/`groupName` are dropped from copies (clone, paste, mirror; e.g. `core.js` mirror path), also drop the three motor-group fields. Delete needs no special code: a lone leftover id is ignored, and patching the last member clear keeps files tidy.

8. **MCP**: one tool `group_motors` with `action`: `create` (`instanceIds`, `name?`, `opposite?: [ids]`), `set_direction` (`instanceId`, `opposite: bool`), `rename` (`groupId`, `name`), `remove` (`instanceIds`), `break` (`groupId`). Each is one `mcp` history step built from the module's patches. `get_assembly` adds `motorGroupId`, `motorGroupName`, `motorDirection` (`same` | `opposite`) on grouped motors. *Alternative*: overload `group_parts`. Rejected: part groups and motor groups mean different things and a motor can be in both.

## Risks / Trade-offs

- [Two unarchived changes touch the Play panel rows and the "Motor throttles" requirement] → build on the `motor-stopping` branch state; proposal notes the spec line to add when both are archived.
- [Socket axis guess wrong on odd builds (motors at an angle)] → only a starting value; the button is right there in the outline and the Play row.
- [Hidden motors: a hidden motor in a group isn't in the Play graph] → fan-out skips motors missing from the graph; the row still shows if at least one motor is in it.
- [Group row hides per-motor control] → by design; take a motor out of the group to drive it alone.

## Migration Plan

None needed: the fields are optional, old builds load without groups, and older app versions ignore unknown instance fields.
