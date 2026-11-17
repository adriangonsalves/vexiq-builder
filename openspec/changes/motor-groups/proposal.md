## Why

In Play mode every Smart Motor has its own throttle, so driving a robot forward means moving two sliders at once, and the left and right drive motors face opposite ways, so the same push on both makes the robot spin. VEXcode solves this with motor groups; kids should be able to do the same in the builder: put motors together, say which ones turn the other way, and drive them with one control.

## What Changes

- **Motor groups**: two or more Smart Motors can be put in a named motor group ("Motor group 1", renamable). It is separate from part groups: a motor can be in a part group (such as "Left Drive") and a motor group (such as "Drive") at the same time. A motor is in at most one motor group.
- **Direction per motor**: each motor in a group is set to turn the **same** way as the group or the **opposite** way. When a group is made, motors whose shafts point the opposite way to the first motor's (a mirrored drive) start as opposite, so the robot drives straight without changes; the user can flip any motor.
- **Outline**: a "Motor groups" section at the top of the Assembly Outliner lists each group as a folder with its motors under it, each with a Same / Opposite button. Group motors from the Select menu or the Selected box with two or more motors selected; remove a motor from a group from its row; rename from the folder. All by tap as well as click.
- **Play panel**: a motor group shows as one row with one throttle, Keep and stopping mode, driving every motor in it together (opposite motors get the reversed throttle). Its motors don't get rows of their own. The row shows Stalled when any of its motors stalls. The row can be opened to flip a motor's direction while playing.
- Motor groups and directions are saved with the build (file, library, history, undo) and survive MCP edits.
- MCP: `get_assembly` reports each motor's group and direction; a new `group_motors` tool makes, changes and breaks up motor groups.
- Help: the Play mode and Outline help pages cover motor groups.

## Capabilities

### New Capabilities
- `motor-groups`: making, naming and breaking up motor groups, each motor's direction, how they show in the outline, how a group shows and drives as one control in the Play panel, and saving and MCP access.

### Modified Capabilities
- (none) — the `play-mode` requirement "Motor throttles" says the Play panel lists every Smart Motor; `motor-groups` narrows that (a grouped motor is listed by its group). That requirement is being rewritten by the unarchived `motor-stopping` change, so it is not touched here; when both are archived, add a line to "Motor throttles" pointing to `motor-groups`.

## Impact

- Data: three new optional fields on a Smart Motor instance (`motorGroupId`, `motorGroupName`, `motorReversed`). Old builds load with no motor groups.
- `src/utils/motorGroups.js` (new, pure helpers shared by app and MCP), `src/components/AssemblyOutliner.jsx`, `src/components/SelectMenu.jsx`, `src/components/PlayPanel.jsx`, `src/App.jsx` (Play wiring: one group throttle fans out to its motors).
- The simulation (`src/sim/*`) is unchanged: it still gets one throttle per motor.
- `src/engine/actions.js`, `src/engine/core.js` (`get_assembly`), `mcp/vexiq-mcp-server.mjs`, `src/utils/webMcpTools.js`.
- Checks: new `scripts/check-motor-groups.mjs`; `scripts/check-mcp-tools.mjs`.
- Help: `src/help/pages/play-mode.md`, `outline.md`, `src/help/coverage.json`, `controls.js`, pictures.
- Builds on `motor-stopping` (Keep checkbox, stopping mode on each row).
- All client side; no server.
