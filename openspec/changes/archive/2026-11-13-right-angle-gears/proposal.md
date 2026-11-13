## Why

The library has bevel gears, a crown gear and a worm gear, but the app only knows how to mesh spur gears and racks, whose shafts are parallel. A builder who wants to turn a drive through 90° has to line the teeth up by eye, the gears show as overlapping, and Play mode doesn't turn one from the other.

## What Changes

- **Measured teeth for the 90° gears.** The part data records where the teeth of the 12 Tooth High Strength Bevel Gear, 18 Tooth Bevel Gear, 36 Tooth Crown Gear and Worm Gear really are, measured from their models as spur gears are today.
- **Three 90° pairs mesh:**
  - bevel gear with bevel gear of the same tooth size, shafts crossing at 90°;
  - crown gear with a standard spur gear, shafts crossing at 90°;
  - worm gear with a standard spur gear, shafts at 90° and passing each other, the worm lying in line with the spur gear's teeth.
- **A gear that is held turns to mesh.** When one of these gears is placed on a shaft or in a hole (drag, double-click mate, hole picking, copy insert, the assistant's tools) and ends up in the right spot next to its partner, it turns about its own shaft so the teeth fit, the same as spur gears do now.
- **A loose gear jumps into mesh.** A gear with nothing holding it can be dragged near its partner, or selected and joined to it (double-click the partner, or the Join button), and it jumps to the meshed spot: turned 90° to the partner, teeth fitted. It only lands on spots where a shaft through it would line up with the hole grid (every 90° round the partner). The shaft and the beams that hold it are added afterwards.
- **Play mode turns them.** Bevel and crown pairs turn each other by their tooth counts. A worm turns its gear one tooth per turn, and only that way round: the gear can't turn the worm, so a motor on the gear's side stalls and an arm held by a worm stays up.
- **The assistant can do the same** with a new `mesh_right_angle` tool, and `place_part` / `place_parts` mesh these gears when they place them.

Not in this change:
- the Differential Gear housings (the bevel gears inside them);
- the crown gear meshing as a spur gear by its rim (its rim is smooth; its teeth are on one face);
- a loose spur gear jumping into mesh beside another spur gear (spur gears still get their position from holes and shafts);
- gears meshing at angles other than 90°.

## Capabilities

### New Capabilities
- `right-angle-gears`: measured tooth data for bevel, crown and worm gears, the rule for when each 90° pair meshes, turning a placed gear to mesh, a loose gear jumping into mesh, and the assistant's tool for it.

### Modified Capabilities
- `play-mode`: "Gears and chains link by tooth ratio" also covers bevel, crown and worm pairs, with the worm driving one way only.

## Impact

- **Part data:** `scripts/measure-part-geometry.mjs` and `scripts/index-part-metadata.mjs` (new measurements), then `public/catalog.json` and `public/part-metadata.json` regenerated with `npm run index-metadata`.
- **Meshing maths:** `src/utils/gearMeshing.js` (new pair rules and mesh spots), `src/utils/placementFit.js` (turning on placement).
- **App:** `src/components/Viewport3D.jsx` (drag preview and jump, double-click on the partner gear, the Join button), `src/utils/pinHoleAlignment.js` (the turn shown in hole-picking previews).
- **Engine and assistant:** `src/engine/core.js` (mesh list for the audit and Play mode, the new tool), `mcp/vexiq-mcp-server.mjs` and `src/utils/webMcpTools.js` (tool definition).
- **Play mode:** `src/sim/bodyGraph.js`, `src/sim/kinematic.js`, `src/sim/physics.js` (links for the new pairs, one-way worm).
- **Checks and docs:** a new `scripts/check-right-angle-gears.mjs`, additions to `scripts/check-play-mode.mjs` and `scripts/check-mcp-tools.mjs`, `features.md`, and a line in `AGENTS.md` on how these gears go together.
- Everything runs in the browser; nothing needs a server. No new dependencies.
