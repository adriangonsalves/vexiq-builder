## Why

The chain builder can't build the most common VEX IQ drive chain: a motor sprocket between two wheel sprockets in a line, bigger than them, as on the 2026-27 Herobot Flop (8T–16T–8T, 65 links each side). It reports "No chain fits round these sprockets." even when told to go over or under the middle one. The outer loop it builds can visit each sprocket only once, but here the middle sprocket belongs on both runs: the top run bends over it and the bottom run under it. Chains also can't avoid anything but standoffs. On Flop, the drive chains run past a Double Offset Corner Connector, and there was no way to make the chain clear it.

## What Changes

- **A sprocket can be wrapped by both runs.** When both straight runs past a sprocket would cut through it (a bigger sprocket between two smaller ones in a line), the chain bends round its top on one run and its bottom on the other, without asking. Flop's drive chain builds in one step.
- **A run that comes into contact with a sprocket wraps it.** When a run, as bent round an enclosed part or an obstacle, would pass through a selected sprocket it doesn't already wrap there, it wraps that sprocket too and meshes with its teeth, so a sprocket can sit in the chain on two runs. There is no "Both" choice: a tight chain can't touch a part between its runs on both runs (the runs would cross), so two runs only wrap one sprocket where they really meet it.
- **Selected parts become obstacles.** Any selected part that isn't a sprocket or standoff (a bracket, connector, beam end) is an obstacle. The builder takes its outline where it crosses the chain's plane, and the chain bends round it, over or under as chosen, the way it bends round a standoff today.
- **Parts in the way are named.** When a run would pass through an unselected part, the reply and the Build menu hover text name it, so it can be selected as an obstacle or the route changed.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `chain-track-builder`:
  - a sprocket on both runs, and a bent run wrapping a sprocket it comes into contact with;
  - selected parts of any kind as obstacles;
  - naming parts a run would pass through.

## Impact

- `src/utils/chainPath.js`: the outer loop becomes a sequence of (part, side) stops in which a part may appear twice. Runs are the outer or crossing tangent depending on the two stops' sides. Obstacle outlines come from slicing a part's model at the chain's plane.
- `src/components/BuildMenu.jsx` / the over-or-under dialog: obstacle rows and the part highlighted for each.
- `mcp/vexiq-mcp-server.mjs`: `build_chain` accepts any part id in `instanceIds`, lists a sprocket on two runs as wrapped on `both`, and replies with `blockedBy`.
- `scripts/check-chain-builder.mjs`: new cases (Flop's 8T–16T–8T, an obstacle connector, refusals).
- `features.md`, and the chain line in `AGENTS.md`.
- Not in this change: tracks bending round anything (tracks stay outside-only); picking obstacles automatically without selecting them.
