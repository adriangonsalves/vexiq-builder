## Why

Picking a part that sits in a group is hard: a click in the 3D view picks the whole group, and the only way to pick just the part is Shift+Alt+click, which few people find. With motor groups it comes up more, because a drive motor is usually inside a part group such as "Left Drive". The Outline also has only a text search to find parts, and searching "motor" lists the pins named after the motor they hold ("Left Motor Pin hole_10"), so it can't narrow to the motors themselves.

## What Changes

- **3D view, Ctrl+click (Cmd+click on a Mac)** on a part adds it to the selection, or takes it out, on its own and never its group, as Shift+Alt+click does now. A Ctrl/Cmd+double-click on a lit hole still inserts a copy, and the first click of it doesn't change the selection. Shift+click, Shift+Alt+click and the "One part of a group" bar button stay as they are.
- **BREAKING (spec wording):** the multi-select spec says Ctrl/Cmd+click is never used for selecting in the 3D view; that line is replaced.
- **Outline filters:** a row of chips under the Outline's search box: **Electronics** (Smart Motors, brains, batteries, sensors, radio, controller; not motor shafts or motor caps), **Locked**, **Hidden**, and **Colour** (a menu of the colours used in the build). Turning chips on narrows the list to parts that match all of them, together with the search text. A folder stays when any of its parts match, and lists only the matching parts. Filters change only the list, never the build or the selection, and aren't saved with the build.
- **Select shown:** while a search or a filter is on, a button selects every part the list shows (each part on its own, not whole groups).
- **Search "motor":** the search itself stays as it is (label, catalog name, part number). The Electronics filter, with or without the search text, lists just the motors and other electronics. The help page explains why a search can match parts named after another part.
- Help: the Selecting and Outline pages.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `multi-select`: "Shift+click in the 3D view" (Ctrl/Cmd+click picks one part, replacing the line that ruled it out); "Selecting in the Outliner" gains the filters and Select shown.
- `part-groups`: "Selecting a group" (Ctrl/Cmd+click in the 3D view picks one part of a group, as Shift+Alt+click does).

## Impact

- `src/components/Viewport3D.jsx` (pointer-up and double-click handling for Ctrl/Cmd, the copy preview), `src/App.jsx` (select handler, exact pick).
- `src/components/AssemblyOutliner.jsx` (filter chips, colour menu, Select shown), `src/styles.css`; a small pure filter helper in `src/utils/` with a check script.
- Help: `src/help/pages/selecting.md`, `outline.md`, `src/help/coverage.json`, `src/help/controls.js`.
- All client side; no server.
