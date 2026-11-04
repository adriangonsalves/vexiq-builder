## Why

A group (or several selected parts) moves as one, but none of the single-part placing help applies to it: typed centre values and free drags can leave it a fraction of a millimetre off its own hole grid, it never pulls onto the holes it is dropped on, and a move can end pressed into another part with no sign of it. In the Clawbot build this left the 45-part Claw 0.58 mm deep in the Wrist 4x4 Plate: invisible on screen, but its pins and corner connectors overlap the plate and one corner's pegs miss their holes. Building with groups should feel the same as building with single parts.

## What Changes

- **A group keeps its own hole grid.** Typed centre values (Inspector) and `update_group` `moveCentreTo` move the set by a whole number of snap steps (the nearest to the typed value). Nudges and drags already move in whole steps from where the set is. Turning a set (rings, quick 90° turns, `update_group` `turn`) goes about a point on the set's own hole grid instead of its bounding-box centre, so a turn can't shift its holes off the grid either. Nothing snaps a set to the world grid or to another part's grid: lining up with another part is done by its holes (below).
- **A dragged group pulls onto holes, but only nearby.** While the Move arrows drag a set, the pins, pegs, shafts and openings of every part in the set are matched against the openings, pins and shafts of parts outside the set, with the single-part rules for kind, sideways pull (3.5 mm) and agreement: the nearest fitting pair wins, several pairs that need the same move win over one, axes must be parallel. The reach along a hole's line is **25.4 mm (1 inch)** for a set instead of 152.4 mm for one part: bringing a set that close shows the user means to mate it, and it keeps the number of pairs (and the work per frame) down. When it lines up, the whole set jumps onto the line.
  - Only the set's **free outer** pins and holes count: an opening of the set with a set pin seated in it, and a set pin with no length outside the set's own openings, are left out.
  - **No pulling back to the start:** a pull that would put the set back exactly where the drag started is refused until the set has once been more than 3.5 mm from its start, so sliding a set off the pins it sat on doesn't stick.
- **A group is fitted on release.** When the drag ends, the Fix assembly fit (turn and move, at any angle, then seat along the pins) runs by itself on the moved set against the parts outside it, when its pins and holes are within Fix assembly's limits of outside ones. It is part of the drag's history step. It is skipped when the set never got more than 3.5 mm from its start.
- **Small tilts are straightened, for parts and groups.** When a dragged part's or group's pins, pegs, shafts or holes come within 5° of a matching hole's line, it turns by that small angle so they are exactly parallel, then pulls on as usual. Several pairs needing the same turn win; tilts of 5° or more are left alone; Alt turns it off. Today a pair more than 2° off parallel isn't matched at all, and a pair just under 2° is pulled on still tilted.
- **A group lands clear.** On release, in this order: a set lined up on a hole line but pressed into something slides along that line to the nearest clear spot; then the fit above; then a set that still ends in a new overlap goes back to where it was before the drag, with a message, and no history step (the same rule as turns that end overlapping). While dragging, overlaps with outside parts are still shown (throttled).
- **Moving part of a group.** Selecting some parts of a named group (from the Outliner) and moving them leaves every part's group membership as it is. The unselected members stay where they are and count as outside parts: overlaps with them show, a new overlap with them is put back, and the moved parts can pull onto them. One selected part follows the single-part rules.
- **Double-click mates a set.** Double-clicking a part of a selected set mates the whole set instead of saying "Mating works on one part". When its free pins and holes are lined up with an outside part (within 1 inch along the line), it is pushed straight in, or mate arrows are shown when there are several ways in. When nothing is lined up, it starts hole picking for the set.
- **Hole picking for a set uses only the pins facing the hole.** Only the set's free pins whose free end already points within **30°** of straight into a hole take part, and only holes they point into get rings. Each fit turns the set by at most 30° (never round the hole's line) and slides it so that pin waits at the hole; fits that put the most other pins over holes come first. Keeping to pins that already face the hole cuts the choices from every pin × both ends × four turns to a handful, keeps the preview a shifted copy of the set, and shows the user means that side. Copy-insert (Ctrl/Cmd + double-click) stays single-part.
- **Big sets stay smooth.** The set's features are collected once at drag start and only shifted while dragging. Overlap marking and the release checks look only at the set's edge members (those near an outside part), which gives the same answer as checking every member. Stopping at contact still happens only on release, not every frame.
- **MCP:** `update_group` follows the grid rules (whole-step `moveCentreTo`, turns on the hole grid). It does not pull onto holes; assistants place with `place_parts` inserts.
- **Not in this change:** reporting near-misses in the audit (parts pressed in, or pegs just off their holes, by under 1 mm) with a one-click fix; snapping a group onto holes from the Inspector or MCP.

## Capabilities

### New Capabilities
- `group-snapping`: how a group or multi-selection stays on its hole grid, pulls onto nearby holes while dragged, is fitted and settles or is put back when a move or turn ends, and how moving part of a group behaves.

### Modified Capabilities
- `drag-hole-snap`: hole pulls match pairs up to 5° off parallel and straighten the part first (was: parallel within 2°, no turn).
- `part-groups`: "A group moves and turns as one" no longer rules out hole snap, flush stop, mate arrows, double-click mating and hole picking for a set; turns go about a point on the set's hole grid.
- `multi-select`: "Acting on several parts" lets double-click mating and hole picking start with several parts selected (copy-insert still doesn't).

<!-- The rotate-mode put-back rule and Fix assembly (fix-assembly) are referenced, not modified. Tools → Fix assembly keeps its behavior; only its fitting code is shared. -->

## Impact

- `src/components/Viewport3D.jsx`: the set drag (`objectChange` on the set pivot) runs a hole snap with the set's free outer features at the set reach, excludes set members from the "other parts" features while a set is selected, keeps a list of edge members, settles along the snap line on release, runs the release fit and puts the set back on a new overlap; set rotate rings pivot on the set's hole grid.
- `src/utils/pinHoleAlignment.js`: the set reach constant, `freeSetFeatures`, a `rejectMove` option on `findHoleSnap`, and working out the straightening turn (shared by single-part and set drags); `scripts/check-pin-hole-alignment.mjs` cases.
- `src/components/Viewport3D.jsx` mating: `handleDoubleClick` / `handleMateRequest` take a set; mate arrows and the push work on every member; a set pick session (facing leading ends, ringed faces, fits, see-through copy of the whole set, insert and push).
- `src/utils/pinHoleAlignment.js`: `planMates` for a set of ids; `freeSetFeatures` also gives each free insert's leading ends; `listSetInsertFits` (fits for a set at a hovered hole, 30° limit, pattern count); check cases.
- `src/engine/fixAssembly.js`: the fitting core split out so it can fit a given moving set at given poses without saving; `src/engine/actions.js`: a `fit_set` action that returns the fitted poses; `scripts/check-fix-assembly.mjs` cases (and Tools → Fix assembly unchanged).
- `src/components/Viewport3D.jsx` single-part drag: straighten before the hole pull.
- `src/utils/partGroups.js`: helpers for the set's hole-grid pivot and for rounding a centre move to whole snap steps (shared with the server).
- `src/App.jsx`: Inspector centre fields and quick 90° turns use those helpers.
- `mcp/vexiq-mcp-server.mjs`: `update_group` `moveCentreTo` and `turn` use the same helpers.
- Checks: `scripts/check-part-groups.mjs` (grid helpers), `scripts/check-mcp-tools.mjs` (`update_group` stays on grid).
- Builds on outliner-part-groups and easier-placing-and-fix-assembly, both archived.
