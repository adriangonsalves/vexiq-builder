## Why

Explode today pushes every part straight out from the robot's centre to a fixed end spot. Pins and shafts get pulled sideways through the parts they sit in, parts that start close together end up with crossing paths, and there is no way to see the robot come apart step by step. An exploded view should show how the robot really comes apart, and be something you can scrub back and forth without parts passing through each other.

## What Changes

- **Explode panel.** The toolbar's Explode button (and `X`) opens a small panel instead of the Off / X / Y / Z / All drop-down. The panel has a direction choice (X, Y, Z, All; starts on All) and a slider from 0% (assembled) to 100% (fully apart). On opening, it plays from 0% to 100% over about 2.5 s; grabbing the slider stops the play where it is. Closing the panel or `Esc` puts the parts back together. **BREAKING:** `X` no longer cycles through the axes.
- **Parts come apart in a real order, without touching.** The app works out an order to take the robot apart: each piece slides out along a direction it can actually move (its pin or shaft axis first, then the main axes), carrying the parts held on it. The slider plays that order big pieces first: side plates and motors move out carrying their parts, then the smaller parts fan out from them (spacers, wheels and collars spread along their shaft). At every slider value, no two parts overlap that don't overlap when assembled.
- **Direction choice limits the slides.** X, Y or Z only allows slides along that axis; parts that can't slide that way stay with the part they're held on. All allows every direction.
- **Pins stay in their part.** A pin rides with the part it sits deeper in; the other part slides off it along the pin's axis. Standoffs are treated like pins. Shafts still move on their own.
- **Groups move as one**, a tire stays on its hub, and the battery slides out of its bay.
- Everything Explode blocks today (Move, Rotate, hole picking, the copy preview) stays blocked while the slider is above 0%, and the dashed lines back to each part's assembled spot stay.
- **MCP:** `configure_viewport` keeps `explodeMode` (now the direction, with `off` closing the panel) and adds `explodeAmount` (0 to 1), so screenshots can show a partly exploded robot. The direction and amount are saved with the rest of the view.
- **Not in this change:** pins coming out on their own; a choice of motion style (one at a time, all together); exporting the animation.

## Capabilities

### New Capabilities
- `explode-view`: the Explode panel, how the take-apart order and slide directions are worked out, how the slider moves parts without them overlapping, and the MCP controls for it.

### Modified Capabilities
<!-- None: Explode has no spec yet. Specs that mention Explode only as a state that blocks their tool (rotate-mode, hole-pick-insert, copy-insert, four-view-layout) keep their wording: the slider above 0% is "in Explode view". -->

## Impact

- `src/components/Viewport3D.jsx`: `computeExplodedPositions` is replaced by positions from the take-apart plan at the slider value; the scene sync and the trace lines follow the slider without rebuilding the plan.
- New pure module `src/utils/explodePlan.js` (shared shape with the MCP engine): grouping pieces, the take-apart order, slide directions and distances, the slider timeline, and the overlap check over slider values. Uses `three-mesh-bvh` (already a dependency) for slide tests.
- Uses existing joint data: seated pairs and `seatedIn` from `mcp/assembly-engine.mjs` (pin and shaft axes, which part a pin sits deeper in), `partGroups.js` groups, `tireFit.js`, `batteryBay.js`, and the too-wide-insert checks in `pinHoleAlignment.js` (a motor shaft's stop ring can't pass a hole).
- `src/App.jsx`: the Explode panel, the `X` and `Esc` keys, the play on open, and the saved viewport state (`explodeMode`, `explodeAmount`).
- `mcp/vexiq-mcp-server.mjs`: `configure_viewport` `explodeAmount`.
- `features.md`: the Multi-Axis Exploded View section and the `X` shortcut.
- Checks: a new `scripts/check-explode-plan.mjs` (order, directions, no overlaps at sampled slider values on the saved Clawbot build).
