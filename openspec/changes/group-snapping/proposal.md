## Why

A group (or several selected parts) moves as one, but none of the single-part placing help applies to it: typed centre values and free drags can leave it a fraction of a millimetre off its own hole grid, it never pulls onto the holes it is dropped on, and a move can end pressed into another part with no sign of it. In the Clawbot build this left the 45-part Claw 0.58 mm deep in the Wrist 4x4 Plate: invisible on screen, but its pins and corner connectors overlap the plate and one corner's pegs miss their holes. Building with groups should feel the same as building with single parts.

## What Changes

- **A group keeps its own hole grid.** Typed centre values (Inspector) and `update_group` `moveCentreTo` move the set by a whole number of snap steps (the nearest to the typed value). Nudges and drags already move in whole steps from where the set is. Turning a set (rings, quick 90° turns, `update_group` `turn`) goes about a point on the set's own hole grid instead of its bounding-box centre, so a turn can't shift its holes off the grid either. Nothing snaps a set to the world grid or to another part's grid: lining up with another part is done by its holes (below).
- **A dragged group pulls onto holes.** While the Move arrows drag a set, the pins, pegs, shafts and openings of every part in the set are matched against the openings, pins and shafts of parts outside the set, with the same rules as the single-part hole snap: the nearest fitting pair wins, several pairs that need the same move win over one, axes must be parallel. When it lines up, the whole set jumps onto the line.
- **Small tilts are straightened, for parts and groups.** When a dragged part's or group's pins, pegs, shafts or holes come within 5° of a matching hole's line, it turns by that small angle so they are exactly parallel, then pulls on as usual. Several pairs needing the same turn win; tilts of 5° or more are left alone; Alt turns it off. Today a pair more than 2° off parallel isn't matched at all, and a pair just under 2° is pulled on still tilted.
- **A group lands clear.** On release: a set lined up on a hole line but pressed into something slides along that line to the nearest clear spot; a set that ends in a new overlap without lining up goes back to where it was before the drag, with a message, and no history step (the same rule as turns that end overlapping). While dragging, overlaps with outside parts are still shown (throttled).
- **MCP:** `update_group` follows the grid rules (whole-step `moveCentreTo`, turns on the hole grid). It does not pull onto holes; assistants place with `place_parts` inserts.
- **Not in this change:** reporting near-misses in the audit (parts pressed in, or pegs just off their holes, by under 1 mm) with a one-click fix; snapping a group onto holes from the Inspector or MCP.

## Capabilities

### New Capabilities
- `group-snapping`: how a group or multi-selection stays on its hole grid, pulls onto holes while dragged, and settles or is put back when a move or turn ends.

### Modified Capabilities
- `drag-hole-snap`: hole pulls match pairs up to 5° off parallel and straighten the part first (was: parallel within 2°, no turn).

<!-- The group and multi-select behavior this builds on (part-groups, multi-select, and the rotate-mode put-back rule) is defined in the change outliner-part-groups, which is not archived yet; its requirements are referenced, not modified, here. -->

## Impact

- `src/components/Viewport3D.jsx`: the set drag (`objectChange` on the set pivot) runs a hole snap with the set's combined features, excludes set members from the "other parts" features while a set is selected, settles along the snap line on release and puts the set back on a new overlap; set rotate rings pivot on the set's hole grid.
- `src/utils/pinHoleAlignment.js`: working out the straightening turn (shared by single-part and set drags); `scripts/check-pin-hole-alignment.mjs` cases.
- `src/components/Viewport3D.jsx` single-part drag: straighten before the hole pull.
- `src/utils/partGroups.js`: helpers for the set's hole-grid pivot and for rounding a centre move to whole snap steps (shared with the server).
- `src/App.jsx`: Inspector centre fields and quick 90° turns use those helpers.
- `mcp/vexiq-mcp-server.mjs`: `update_group` `moveCentreTo` and `turn` use the same helpers.
- Checks: `scripts/check-part-groups.mjs` (grid helpers), `scripts/check-mcp-tools.mjs` (`update_group` stays on grid).
- Depends on outliner-part-groups (groups, set moves); apply after it is archived.
