## Why

The explode view could not take Flop apart. Its parts are pinned in from several sides, so the planned explode found a clear straight path for almost nothing: with groups kept whole it moved 8 of 593 parts, and with groups ignored it took over five minutes to move 152. Separately, the 3D view looked flat next to VEX's own viewer (instructions.online): most of its light came evenly from every side, the main light stayed fixed while the camera turned, and a blue fill light tinted dark parts navy.

## What Changes

- **Spread-out explode for big or locked builds.** A build of more than 300 visible parts, or one the planned explode leaves mostly in place (fewer than half its parts moved), is spread out instead, at once. Up to 40% of the slider the groups move apart as wholes; then each piece (a part with its pins, a tire on its hub, a whole chain) moves straight out from its group's middle, further the further out it starts, sideways or up but never down through the floor.
- **Fully apart, nothing overlaps.** A spread-out piece still meeting another at 100% is pushed further out along its way until nothing meets. On the way out parts may pass through each other; the planned explode keeps its rule of no overlaps at any slider value.
- **Lighting as in VEX's viewer.** One strong light from over the viewer's shoulder that turns with the camera, little even light from all round, no coloured fill, matte plastic, and room reflections at full strength on metal and a third of that on plastic.
- **The explode check uses fixed builds** (the Clawbot and Flop starters) instead of whatever build the app has open.

## Capabilities

### New Capabilities
- `viewport-lighting`: how the 3D view is lit and how shiny parts are.

### Modified Capabilities
- `explode-view`: big or locked builds are spread out; groups move whole only in the planned explode or the first stage of the spread; the no-overlap rule is for the planned explode, and a spread build only guarantees it once fully apart.

## Impact

- `src/utils/explodePlan.js` (`spreadExplodePlan`, `partsMovedBy`), `src/engine/core.js` (`explodePlanFor` picks the spread, `settleSpread`).
- `src/components/Viewport3D.jsx` (lights, materials).
- `scripts/check-explode-plan.mjs`, `features.md`, the `configure_viewport` description in `mcp/vexiq-mcp-server.mjs`.
