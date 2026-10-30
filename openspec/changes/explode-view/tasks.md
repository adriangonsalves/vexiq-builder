## 1. Plan module: pieces and joints

- [ ] 1.1 Create `src/utils/explodePlan.js` with `buildPieces(instances, joints, { catalogMap, groups })`. It merges group members, tires with hubs (`tireFit.js`), and each pin or standoff into the part it sits deeper in (larger part on a tie). It keeps shafts as their own pieces, picks the base piece (the brain's, else the largest box volume), and lists the joints between pieces with their axes (none for "held on" and battery-bay edges). Verify with a new `scripts/check-explode-plan.mjs` on `public/assembly-state.json`: the base holds the brain, no pin is a piece of its own, every shaft is, and each group sits in one piece.
- [ ] 1.2 In `mcp/assembly-engine.mjs`, add an export that returns the joint data the plan needs from `findJoints`: seated pairs with world axes, `seatedIn` with seated depth per part, direct edges, battery bays, and the too-wide inserts per opening. `jointGraph` stays unchanged. Verify `node scripts/check-mcp-tools.mjs` and `node scripts/check-explode-plan.mjs` exit 0.

## 2. Plan module: slide tests and Pass A

- [ ] 2.1 Add `freeDistance(movingIds, d, others, query)` using box culling plus corner-point rays both ways (capped at about 500 points per piece), and skip pairs that overlap when assembled. The mesh query is passed in, so the app uses its collision BVHs and Node uses `getPartCollisionBvh`. Verify check-script cases: a 1x6 beam on two pins has free distance ≥ its clear-out along the pin axis and about 0 sideways, and a collar on a shaft is free outward along the shaft.
- [ ] 2.2 Add Pass A, `takeApartOrder(pieces, joints, directionChoice, query)`:
  - candidates go one-joint pieces first, then smaller first;
  - directions go joint axes first, then main axes, filtered by the direction choice (shaft axes within 2° count);
  - too-wide-insert directions are ruled out;
  - the moving body is the piece plus the pieces already taken off it;
  - each step records holder and direction;
  - when nothing passes, merge the piece with the fewest blocked directions into its holder.

  Verify check-script cases: on the Clawbot, a wheel stack comes off in collar → wheel → spacer → shaft order along the shaft axis, and no motor shaft leaves through a plate on its ring side.

## 3. Plan module: distances, timeline and the slider check

- [ ] 3.1 Add Pass B (room and travel from the leaves up, 6.35 mm gap, rows of siblings stacked along shared directions) and the timeline (depth-based start and end, smoothstep). Add `explodedPositions(plan, t)`. Verify check-script cases:
  - t=0 gives every assembled position exactly;
  - the same t always gives the same positions;
  - a child's start ≥ its holder's start;
  - shaft, spacer, wheel and collar spread in order along the shaft at t=1 with gaps ≥ 6.35 mm.
- [ ] 3.2 Add the slider check: at 101 values of t, mesh-vs-mesh test the pairs whose boxes meet, counting only overlaps not present (or grown) when assembled. Fix hits by moving the later slice back, then adding travel, for up to 8 rounds. Report any left in `plan.unplaced`. Export `buildExplodePlan(...)` → `{ pieces, steps, unplaced }`. Verify that `node scripts/check-explode-plan.mjs` builds the Clawbot plan for `all`, `x`, `y` and `z`, has no hits left at any of the 101 values, prints the build time, and exits 0.

## 4. Viewport: use the plan

- [ ] 4.1 In `src/components/Viewport3D.jsx`:
  - take `explodeMode` (direction or `off`) and `explodeAmount` props;
  - keep the plan in a ref keyed by build signature (ids, positions, rotations, visibility, group ids) plus direction, and rebuild it when the key changes, with mesh queries from the collision BVHs;
  - remove `computeExplodedPositions`.

  Verify in the app (port 5173) that opening Explode on the Clawbot spreads it and that hiding a part rebuilds the plan without the hidden part.
- [ ] 4.2 Make a slider change update only group positions and trace-line ends (no full scene sync), and draw the trace lines only for parts that have moved. Verify dragging the slider stays smooth on the Clawbot (no frame over about 30 ms in the Performance panel) and the lines follow the parts.
- [ ] 4.3 Show a "Working out explode…" note while a plan build takes over about 300 ms. Verify that slowing the build in dev shows the note, and that it's gone when the plan is ready.
- [ ] 4.4 Keep every existing Explode block (move, rotate, hole pick, copy preview, collision marks at assembled positions) keyed on `explodeMode !== 'off'`, and make the 4-View side views and Frame (`F`) use the exploded positions. Verify that dragging a part while exploded does nothing, that a right-click shows "Can't rotate in Explode view", and that `F` frames the spread robot.

## 5. Explode panel in the app

- [ ] 5.1 In `src/App.jsx`:
  - replace the Explode `ToolbarMenu` with a toolbar button that opens and closes a floating panel holding the X / Y / Z / All choice (All by default, or the saved direction) and a 0–100% slider;
  - add `explodeAmount` and `explodePlaying` state;
  - closing the panel sets `explodeMode` to `off`.

  Verify in the app that the button opens and closes the panel, and that closing puts every part back.
- [ ] 5.2 Add the play on open: a `requestAnimationFrame` run from 0 to 1 over 2.5 s. Pressing the slider stops it, and changing direction during the play restarts it from 0. Verify that opening plays once to 100%, that grabbing at about 40% stops there, and that switching to Y during the play restarts it.
- [ ] 5.3 Keys: `X` opens or closes the panel (no more cycling), and `Esc` closes it when no mate arrows are shown. Update the shortcut list in the help panel. Verify both keys in the app, and that `Esc` with mate arrows showing still only hides the arrows.
- [ ] 5.4 Save `explodeMode` and `explodeAmount` with the viewport state. A saved view with a direction but no amount loads at 1, with no play when loaded. Verify that reloading the page with the panel at 60% on Y comes back at 60% on Y without playing.

## 6. MCP

- [ ] 6.1 In `mcp/vexiq-mcp-server.mjs`, add `explodeAmount` (0–1) to `configure_viewport`'s schema and pass it through the bridge. `explodeMode` alone sets the amount to 1, MCP never plays, and `off` closes the panel. Update the tool description. Verify a new case in `scripts/check-mcp-tools.mjs`, and in the app that `configure_viewport {explodeMode:'all', explodeAmount:0.5}` then `capture_screenshot` shows the half-spread robot.

## 7. Docs and final checks

- [ ] 7.1 Update `features.md`: rewrite the Multi-Axis Exploded View section for the panel, slider, take-apart order and no-overlap rule, and change the `X` and `Esc` shortcut lines. Verify the section matches the spec's requirements.
- [ ] 7.2 Run every `node scripts/check-*.mjs` and confirm each exits 0. Then, in the app, scrub the Clawbot slider from 0 to 100% and back in All and in each axis. From at least two views, confirm that no parts pass through each other, that wheel stacks spread along their shafts, and that the battery slides out of its bay.
