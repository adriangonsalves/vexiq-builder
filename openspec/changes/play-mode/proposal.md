## Why

The app can build a robot but can't show what it does when its motors run. Builders want to turn a motor and see the gears, wheels and arms move, and find out where the mechanism jams, before building it for real.

## What Changes

- New **Play mode** under Tools. Entering it freezes editing and turns the assembly into moving bodies; leaving it puts every part back where it was.
- Parts held to each other by two or more pins move as one rigid body. A part held to the rest by a single pin turns freely about that pin, as a hinge.
- Everything locked onto a square shaft (gears, wheels, sprockets, hubs, spacers on square bores) turns with the shaft. The shaft turns where it passes through round holes in plates and beams.
- Square shafts only drive what their square fits: a gear or motor socket on a shaft at the wrong angle, or with a round bore, doesn't turn with it.
- Meshed gears turn each other at their tooth ratio. Sprockets joined by a chain or track turn each other at their tooth ratio; the chain links themselves don't move.
- Each Smart Motor gets a throttle in a Play panel: drag either way from centre to run it forward or backward at up to full speed.
- Motion carries on until solid parts collide and block it. A motor whose drive is blocked stops and is shown as stalled, on its throttle and on the motor in the view.
- Adds the Rapier physics library (`@dimforge/rapier3d-compat`), loaded only when Play mode opens.

## Capabilities

### New Capabilities
- `play-mode`: entering and leaving Play mode, how parts become rigid bodies, hinges and shaft groups, gear and chain linking, motor throttles, collisions and stall display.

### Modified Capabilities
<!-- None: square-shaft-fit already defines shaft groups and square alignment; Play mode uses them as they are. -->

## Impact

- New: Play mode panel and throttle controls, a simulation module under `src/` that builds bodies and joints from the assembly, a Tools menu entry (`src/components/ToolsMenu.jsx`).
- Reuses: `jointGraph` (`src/engine/core.js`), `shaftGroups` and square fit (`src/utils/shaftGroups.js`), gear meshing (`src/utils/gearMeshing.js`), chain fit (`src/utils/chainFit.js`).
- New dependency: `@dimforge/rapier3d-compat` (WASM, loaded on demand so the editor and static site don't grow at start-up; the offline manifest must include it).
- Not in this change: a floor and driving the robot around, the MCP server, animating chain links.
