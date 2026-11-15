## Why

Students building a robot together have no way to combine their work: opening a saved build, a file or a starter always replaces what is on screen. Letting a build be added into the open one means one student can make the drive base, another the claw, and they bring the two together on one computer with Export and Load.

## What Changes

- Opening a starter (File → Starter), a saved build (File → Load… → Open) or a file (Open from computer…) asks one question when the open build has parts: **Open by itself** or **Add to this build**. With an empty build open there is no question and it opens as today.
- **Open by itself** does what happens today: the open build stays saved and the chosen one is shown.
- **Add to this build** puts a copy of the chosen build's parts into the open build as one new group named after it, set down beside the parts already there, selected and ready to move into place. It is one history step, so one undo takes it out again. The build it came from is not changed.
- The question is a small dialog with two large buttons and a Cancel, usable by mouse, keyboard and touch.
- The Help page on saving and loading explains how to share a sub-assembly with a teammate (Export, send the file, Load → Open from computer… → Add to this build).

Not in this change: two students editing the same build at the same time, sharing over the internet, and adding a build through the MCP server. Everything here runs in the browser; nothing needs a server.

## Capabilities

### New Capabilities
- `add-to-build`: the open-or-add question, and how a starter, saved build or file is added into the open build as a new group.

### Modified Capabilities
- `build-library`: File → Starter, the library's Open and Open from computer… no longer always start or switch to another build; with parts in the open build they ask first.

## Impact

- `src/App.jsx`: `handleStarterBuild`, `handleOpenBuild`, `handleOpenFile` gain the question and the add path.
- New small dialog component, plus `src/components/FileMenu.jsx` and `src/components/LibraryDialog.jsx` item hints.
- `src/utils/partGroups.js` (or a new helper beside it): turning a build's parts into a new group with fresh ids, labels and a clear spot.
- Help: `src/help/pages/saving.md` (and `outline.md` if it lists how groups are made), `src/help/coverage.json`, `src/help/controls.js`, pictures.
- `features.md`, and a new `scripts/check-add-to-build.mjs`.
- No change to the saved file format or to the MCP server.
