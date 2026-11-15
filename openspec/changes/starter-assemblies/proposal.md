## Why

Now that a starter can be added into the open build as a group, the starters are useful as pieces, not only as whole robots. Students need small ready-made pieces to combine and learn from, and a Starter list that keeps whole robots apart from pieces so it stays easy to scan.

## What Changes

- **File → Starter ▸** shows two labelled sections: **Robots** (Speedbot 2.0, BaseBot, Clawbot, Flop) and **Assemblies** (Sample starter and Ratchet winch, which move out of the robot list as they aren't robots, and the three new pieces below).
- Three new assemblies taken from the Clawbot, each one group:
  - **Simple drivetrain**: the chassis, wheels, drive motors and crossbeams. No Robot Brain and no brain mounts.
  - **Simple arm**: the tower, arm motor, shafts, gears and arm beams.
  - **Simple claw**: the wrist and arm-tip corners, the claw base, claw motor and jaws.
- The Robot Brain and its connectors and pins are in none of the three.
- The Help page on saving lists the starters under the same two headings, with a picture of each new assembly.

Not in this change: new robots, joining the three pieces automatically, or moving any other robot's parts into assemblies.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `build-library`: the File menu's Starter submenu is split into Robots and Assemblies, and three Clawbot assemblies are added.

## Impact

- `src/starters.js`: each starter gets a section; three new starters built from the Clawbot's rows (no copied part data).
- `src/components/FileMenu.jsx`: section headings in the Starter submenu.
- `src/help/pages/saving.md`, `src/help/coverage.json`, `scripts/help-shots/shots-basics-c.mjs` and the pictures.
- `features.md`; a check in `scripts/check-build-library.mjs` (or a new `scripts/check-starter-assemblies.mjs`).
- No change to saved builds, the file format or the MCP server.
