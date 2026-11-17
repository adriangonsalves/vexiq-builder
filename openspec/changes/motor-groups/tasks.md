## 1. Motor group data

- [x] 1.1 Write `scripts/check-motor-groups.mjs` with one case per spec scenario that can run without the app (make, regroup, take out second-last, break up, rename/empty name refused, part groups untouched, starting direction on a mirrored drive, throttle fan-out, copies leave groups, old builds load); verify it runs and fails before the module exists
- [x] 1.2 Add `src/utils/motorGroups.js` (membership, patch helpers, `nextMotorGroupName`, starting direction from the socket axis, `groupThrottles`) and verify `node scripts/check-motor-groups.mjs` passes its data cases
- [x] 1.3 Drop `motorGroupId`, `motorGroupName`, `motorReversed` wherever clone, paste and mirror drop `groupId`/`groupName`; verify the copy cases in `check-motor-groups.mjs` pass and `node scripts/check-part-groups.mjs` still passes

## 2. Outliner and Select menu

- [x] 2.1 Add Group motors to the Select menu and the Selected box (enabled with 2+ Smart Motors selected), as one history step; verify in the app that grouping "Left Drive" + "Right Drive" makes "Motor group 1" and leaves the part groups as they were
- [x] 2.2 Add the "Motor groups" section to `AssemblyOutliner.jsx`: folder rows (arrow, name, count, break-up), motor rows (Same/Opposite button, take-out), folder click selects only the motors, pencil rename; verify by click and by touch (tablet viewport) that each action works and undoes in one step

## 3. Play panel

- [x] 3.1 In App, build the Play panel's control list (one entry per motor group, one per ungrouped motor) and fan group throttles out to motors with the direction sign; verify with `check-motor-groups.mjs` fan-out cases and in the app that the Drive group drives a mirrored drivetrain straight
- [x] 3.2 Update `PlayPanel.jsx` for group rows: Keep and let-go per row, group stopping mode (mixed shows none, one history step), Stalled if any motor stalls, fastest rpm, hover lights all motors, open the row to flip directions (`inPlay` step); verify each in the app and that `node scripts/check-play-mode.mjs` still passes

## 4. MCP

- [x] 4.1 Report `motorGroupId`, `motorGroupName`, `motorDirection` in `get_assembly`; add the `group_motors` tool (create, set_direction, rename, remove, break) to `mcp/vexiq-mcp-server.mjs` and `src/utils/webMcpTools.js`, refusing non-motors with a message; add cases to `scripts/check-mcp-tools.mjs` and verify it passes
- [x] 4.2 Add a short motor-groups line to the AGENTS.md "How pieces are used" section (sent to MCP clients) and verify the server's connect message includes it

## 5. Help and wrap-up

- [x] 5.1 Update `src/help/pages/play-mode.md` and `outline.md` (text, `tags:`, `answers:`), `src/help/coverage.json` and `src/help/controls.js` chips; retake pictures with `VEXIQ_BASE=/vexiq-builder/ npm run build:static` then `node scripts/capture-help-shots.mjs`; verify `check-help.mjs`, `check-help-tags.mjs` and `check-help-context.mjs` pass
- [x] 5.2 Run every `node scripts/check-*.mjs` and verify all pass; reload a saved build with a motor group and confirm it is kept
