## Why

In Play mode a stopped Smart Motor either spins freely (as before) or, since the rope-and-spool work, brakes so hard it holds any load below stall torque. Real VEX IQ motors have three stopping modes, set by the "set motor stopping" block (coast, brake, hold; brake by default), and kids building lifts, arms and winches need to see the difference: a braked arm creeps down under its weight, a held one stays put.

## What Changes

- Each Smart Motor gets a stopping mode: **Coast** (spins freely when stopped), **Brake** (the default: resists being turned in proportion to how fast it turns, so a load creeps down slowly) or **Hold** (drives back to the angle where it stopped, up to the 0.414 N·m stall torque, so loads stay put).
- The mode is saved with the motor in the build (`stopping` on the motor's instance) and chosen in the Play panel on each motor's row, by tap as well as click.
- **BREAKING (wording):** the Play panel's existing per-motor "Hold" checkbox, which keeps a throttle where it is let go, is renamed **Keep**, so "Hold" means only the stopping mode, as it does in VEX's blocks.
- MCP: `update_part` takes `stopping` for a Smart Motor; `get_assembly` / `get_part_details` report it.
- The Rope lift and Rope winch starters come set to Hold.
- Motor fixes made while testing ropes move here from rope-and-spool (its tasks 7.8, 7.9, part of 7.11), as requirements of this change:
  - a running motor brakes a load that runs ahead of it, so a lowering weight can't drive it past its top speed;
  - letting go of the throttle clears a motor's "blocked" state;
  - a motor backing out of a block isn't blocked again by the knock of starting back, only by pressing deeper for a while;
  - in Hold, a rope pulling on the motor's own shaft counts against its stall torque.
- Fix the Play check "reversing closes the claw until the tips meet", broken by the backing-out change.

## Capabilities

### New Capabilities
- (none)

### Modified Capabilities
- `play-mode`: "Motor throttles" (stopping mode per motor, the Keep checkbox) and "Collisions block motion and stall motors" (braking ahead-running loads, clearing a block on letting go, backing out).

## Impact

- `src/sim/physics.js` (`driveMotors`, `checkBlocked`, `heldByMotors`, rope budget), `src/sim/bodyGraph.js` (motor's stopping mode into the graph), `src/engine/core.js` (`playInputs`).
- `src/components/PlayPanel.jsx` and the App's Play wiring (mode control, Keep rename), saving the mode through the normal update action so it undoes.
- `mcp/vexiq-mcp-server.mjs`, `src/utils/webMcpTools.js`, `src/engine/actions.js` (`stopping` on update_part).
- Starters: `scripts/make-rope-lift-template.mjs`, `scripts/make-rope-winch-template.mjs`, `src/starters.js`.
- Checks: `scripts/check-play-mode.mjs`, `scripts/check-ropes.mjs`, `scripts/check-mcp-tools.mjs`.
- Help (`src/help/pages/` Play page, `controls.js` chip for Keep and the mode): deferred while docs are skipped.
- All client side; no server.
- Depends on the rope-and-spool branch (the code being moved is there, uncommitted); built on the same branch.
