## Context

See proposal.md for why. How `src/utils/chainPath.js` works today:

- Parts on the chain are circles in the chain's plane (sprockets: pitch radius and tip radius; standoffs: body radius).
- `outerLoop(circles)` keeps one outgoing tangent run per circle (`edges.set(i, …)`, the shortest valid one) and follows them round. A circle can therefore appear on the loop only once. With Flop's 8T–16T–8T drive, the 16 Tooth needs two outgoing runs (top and bottom), so the walk breaks and returns null: "No chain fits round these sprockets." That happens before any `route` is read, which is why over/under didn't help.
- `signedTangent(a, sa, b, sb)` already gives the outer run (same sides) and the crossing run (opposite sides) between two circles. `loopPath` turns a list of `{ c, s }` nodes into runs and arcs. Enclosed parts and crossing sprockets are then bent into the loop by side.
- Links are placed along the path; sprockets are turned so their teeth sit between pivots; `isChainFit` lets links sit in teeth without counting as overlaps.

## Goals / Non-Goals

**Goals:**
- One path model that covers a sprocket on both runs, Over/Under choices, runs bent into contact with a sprocket, and polygon obstacles, using the existing tangent and arc code.
- Keep every current chain and track identical: same links, same turns, same link counts.

**Non-Goals:**
- Concave obstacle shapes. Links are straight, so a chain can't follow a pocket; a convex outline is what it really rests on.
- Finding obstacles without the user selecting them. Unselected parts are only reported.

## Decisions

### The outer loop is built by wrapping round the circles, so a circle can appear twice
`outerLoop` is replaced by gift wrapping over circles. Start at the lowest point of the lowest circle, heading along +u. At each step, take the outer tangent run from the current circle to whichever circle needs the smallest turn, keeping every circle on the inside. This includes leaving the current circle along its own arc, when no tangent run is valid yet. Stop when the walk is back at its first run. The result is a list of stops `{ c, s: +1 }` in which a circle may appear more than once; for Flop: left 8T, 16T (top), right 8T, 16T (bottom).
- *Rejected: special-casing three circles in a line.* Gift wrapping handles any layout where a circle reaches the hull twice (an idler between two others, a big sprocket among small ones) without separate cases.
- Layouts where each circle appears once give the same loop as today. A check compares old and new loops on every existing check case.

### Routes work on stops, not circles
The enclosed-part and crossing-sprocket logic moves from "the circle" to "the stop":
- **Over/Under** removes or adds one stop on one run, as today.
- A crossing sprocket that every straight run would cut through gets its stops from the wrap itself, so it is never asked about.
- **Contact:** once the route is applied, a run that would pass through a selected sprocket it doesn't wrap there gets a stop on that sprocket, on the side the sprocket lies (inside the loop: +1, outside: −1), and the path is worked out again until no run passes through one. A sprocket with two stops is "wrapped by both runs".
- *Rejected: a "Both" route choice.* Touching a part between the runs on both runs needs the top run to pass below it and the bottom run above it, so the runs cross. Two runs only share a sprocket where they really meet it, which the hull and the contact rule already cover.
- A sprocket met on a second run lands on a tooth gap of its first wrap: the run onto it is eased within the chain's play or bowed a little out of the loop, so one turn of the sprocket seats both wraps.

A part touched on several runs is always touched from the same side (inside or outside the loop). The other side would need the chain to pass through it or cross itself, and the existing refusals already cover both. So no separate rule is needed.

### Obstacles: convex outline of a slice, as rounded corner guides
For a selected part that isn't a sprocket or standoff:
1. Take every mesh triangle that crosses the band `t0 ± link half-width` along the chain's axle, and project its band segments into the plane.
2. Take the 2D convex hull of those points, simplified to at most 12 corners.
3. Each corner becomes a zero-tooth guide circle whose radius is the link pivot's clearance (a link half-height), like a standoff of radius 0. All of an obstacle's corners are one unit: one row in the dialog, one entry in `route`, one highlight.

When wrapped, the chain takes the run past the obstacle's outer corners on the chosen side, using the same bend code as an enclosed standoff. The outline doesn't turn. An obstacle is asked about only when a run comes within a link's half-height of it; one clear of every run (on Flop, the Double Offset Corner Connector inside the loop) is left alone. Links may press 0.5 mm into an outline (a tight contact): VEX's own Flop chain touches its 2x20 Beam that much where it dips under it past the 16 Tooth.
- *Rejected: obstacle as its bounding circle.* A long bracket's circle would push the chain far out of its real path.
- *Rejected: true concave outline.* It isn't needed, because straight links rest on the convex hull anyway.

### Parts in the way: a collision pass on the planned links
After planning, each planned link pose is checked with `checkCandidateCollision` against every part not on the loop and not an obstacle. Overlaps (not tight fits, once cad-import-readiness lands) become `blockedBy` entries with the run index.
- The check runs on the plan, before anything is saved, so the dialog can show it and nothing needs to be undone.
- *Rejected: checking every part's slice like an obstacle.* That costs far more, and would make the chain dodge parts the user may want it to touch.

### Dialog and MCP
- The dialog gains obstacle rows and an "in the way" note.
- `build_chain` accepts any part ids in `instanceIds` and replies with:
  - `wrapped[*].side` (`inside`, `outside` or `both`);
  - `obstacles` (wrapped, or ignored with a reason);
  - `blockedBy`.

## Risks / Trade-offs

- [Gift wrapping changes an existing chain's path when two circles are exactly tangent to one run] → A check builds every existing check case before and after and compares link poses; ties go to the old path's choice.
- [Obstacle slices of large meshes are slow] → Slices are cached per part model and band; only triangles whose box crosses the band are visited, through the part's existing BVH.
- [A convex outline over-states a connector with an open slot the real chain passes through] → The user can leave the part unselected; it is then only reported in `blockedBy`.
- [Depends on tight fits from cad-import-readiness for clean `blockedBy` lists] → Until that lands, `blockedBy` uses plain overlaps, and links touching brackets by under 0.5 mm will be listed.

## Migration Plan

Code only; no saved data changes. Existing chains in saved builds are not rebuilt. Rollback is a revert.
