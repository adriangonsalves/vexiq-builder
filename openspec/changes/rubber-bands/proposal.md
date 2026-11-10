## Why

Rubber bands are on almost every VEX IQ competition robot. They power catapults, hold latches shut, pull arms back and make grippy intake rollers. The library already has the bands and belts, but only as flat, unstretched rings. Nobody can string one round the parts it really goes on, and the CAD import leaves them out. VEX's own Hero Bot Swish uses six: two #117B bands pulling the catapult arm down to the chassis, two #117B bands looped across the intake, and two 2x30 mm Square Silicone Belts holding the winch pawl on its ratchet. None of them can be shown in the app today.

The intake bands show how precise a route must be. Each end wraps two 0.5x Pitch Standoffs held between a pair of 24 Tooth Sprockets. On its way out, each of the band's two runs drops through one particular tooth gap of the inner sprocket: the gap in line with its standoff, as measured from VEX's CAD. A band tool has to let the builder say exactly which standoff, pin, tooth gap or pulley the band goes on, in what order and on which side.

## What Changes

- **New shape kind `band`** for the library's band and belt parts (#32, #64, Thin #64, #117B, 2x30 mm Square Silicone Belt, 2x30/40/50/60 mm Rubber Belts). A band copy carries its route and its stretched path, and is drawn as a round band along that path.
- **Spots a band can go on**, found from part data: standoff bodies, pin heads and shanks, shaft ends, pulley grooves, gear and sprocket rims, single tooth gaps (passing through or hooked on), beam and bracket ends and edges, and the Rubber Band Anchor's hook.
- **Tools → Band builder**, a picking mode in the 3D view:
  - Choose a band size, then click spots in order. A see-through band follows the pointer from the last spot.
  - The single feature under the pointer lights up, for example one standoff or one tooth gap with its number.
  - R, Shift+R or the mouse wheel step to the next feature or gap, the same keys that step through fits when placing a part.
  - Each spot has on-screen controls for side (outside or inside), wraps (1–3) and cross (figure-8, between two round spots).
  - The band is coloured by how far it stretches, and the panel names a better size when it's slack or too tight.
  - Clicking only a start and an end lists the possible routes, sorted, and R steps the preview through them.
- **Gap picking** in three ways:
  - click a gap while routing;
  - drag a straight run of a finished band onto a rim, where it snaps gap to gap;
  - a flat ring close-up of a gear or sprocket in the panel, with numbered gaps and the band's route drawn on it.
- **Quick paths:**
  - **Band between these** for two selected parts.
  - **Belt round these** for selected pulleys or hubs.
- **Editing:**
  - A selected band shows a handle at each spot. Drag a handle to another spot to move it.
  - Tools → Flatten takes a band off its route.
  - The Inspector shows the size, stretch, pull and every spot.
  - A band follows its parts when they move, and is rerouted in the same history step.
- **Mirror and duplicate** carry bands. Mirror keeps the matching gap on a mirrored sprocket.
- **Play mode:**
  - A band pulls on the parts it touches, along its path, harder the more it stretches.
  - It is redrawn as those parts move.
  - Its pull and stretch limits are assumed values, marked as such.
- **MCP:**
  - New `place_band` tool. Called without a full route, it lists the spots and routes within reach.
  - `get_assembly` and `get_part_details` report a band's route.
- **CAD import:**
  - Bands bent in VEX's CAD are no longer skipped.
  - Each is matched to the spots its mesh touches and placed as a band, and the report lists each band's spots.
  - Swish is the test robot.

## Capabilities

### New Capabilities
- `rubber-bands`: placing, routing, editing and drawing rubber bands and belts. Covers spots, the Band builder, gap picking, routes, stretch, following parts, mirror and duplicate, and the `place_band` MCP tool.

### Modified Capabilities
- `play-mode`: bands pull on the bodies they touch and are redrawn as the bodies move.
- `cad-import`: bent rubber bands and belts are imported as bands instead of being left out.

## Impact

- `src/utils/shapedParts.js`: register the `band` kind.
- New `src/utils/bandPath.js`: spots, path and stretch, written as pure functions so node checks can test them.
- New `src/engine/bandRouting.js`: routes, candidates and rerouting after moves.
- `src/engine/actions.js` and `src/engine/core.js`: the band action, and rerouting when anchor parts move, are removed, hidden or mirrored.
- `src/components/Viewport3D.jsx`: band picking mode, spot highlights and handles.
- New `src/components/BandBuilderPanel.jsx` with the ring close-up.
- `ToolsMenu.jsx`: the menu item.
- `SetInspector.jsx`: band details.
- `src/sim/bodyGraph.js`, `src/sim/physics.js` and `src/sim/playRunner.js`: band pull and redraw.
- `src/sim/fastenerStrength.js`, or a sibling file: assumed band stiffness values.
- `mcp/vexiq-mcp-server.mjs` and `src/utils/webMcpTools.js`: `place_band`.
- `scripts/import-cad.mjs`: remove the band skip and add band matching.
- `public/cad-frames.json`: band entries if needed.
- New check `scripts/check-bands.mjs`.
- `features.md`, plus the part-usage notes in `AGENTS.md`.
- No new dependencies. Saved builds without bands are unchanged. A band part saved flat, with no shape, stays a flat ring.
