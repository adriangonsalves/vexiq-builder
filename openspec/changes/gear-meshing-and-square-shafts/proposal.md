## Why

Gears are placed at whatever roll they happen to have, so their teeth often clash with a neighbouring gear's teeth. The collision check then holds the gear short of the hole it should sit in. "24 Tooth Gear #1" in the current build is an example: it sits off its backplate hole and off pitch (y 12.187 instead of 12.7) next to "48 Tooth Gear #1".

The catalog's gear data is guessed from part names:
- `phaseOffsetDeg` is just 180/teeth;
- the pitch radius assumes one tooth size, which is wrong for the 34DP gears;
- nothing records where the teeth, or a square bore's flats, actually sit on each model.

Square axles and square holes have the same gap. An axle can go into a turned gear's square hole at a roll that doesn't fit, and the Smart Motor's square socket can only take an axle at the one angle the model was drawn at.

Fixing this also prepares a later simulation, where a motor turns a shaft and the gears and wheels fixed on it turn with it. That simulation is a separate change.

## What Changes

- **Measured part data.** The metadata indexer measures, from each model:
  - **Spur gears:** where the teeth sit (tooth phase), the tip and pitch radii, and the tooth spacing. The 34DP gears get their real size.
  - **Racks:** the tooth positions along the rack and its pitch line.
  - **Square bores:** whether each shaft bore is square or round, and the angle of its flats.
  - **Square axles:** the angle of their flats.
  - **The Smart Motor's drive socket:** the extent of the hub that turns.
- **Gears turn to mesh.** When a spur gear is placed at a center distance where it meets another spur gear or a rack (parallel axes), it turns about its own axis by the amount that puts its teeth in the other part's gaps. This happens:
  - while dragging, so tooth clashes no longer hold it short of a hole;
  - on drag release;
  - on double-click mating, hole picking and Ctrl-copy insert;
  - in MCP `place_part`, `place_parts` and `mesh_gear_train`.

  With several neighbours, the turn that suits them best is chosen, and a message names any gear it could not mesh with.
- **Axles fit square holes.** An axle going into a square bore, whether by drag, mate, hole pick, copy or MCP, turns about its own axis to line its flats up with the hole.
- **Shaft groups turn together.** An axle and every part fixed on it by a square hole (gears, wheels, hubs) form a shaft group, and a gear meshing on an axle turns its whole group. Parts on other axles are left alone.
- **Motor hub turns.** The Smart Motor's square-socket hub is drawn as its own piece and turns to take an axle at any angle. Its angle is saved per motor, so a later simulation can drive it.
- **Longer drag pull along the hole line.** While dragging, a part is pulled sideways onto a hole's line from up to 12 pitch (152.4 mm) away along the line, the same reach the hole highlights use, instead of 2 pitch. A gear dragged well above a beam now snaps onto the hole below it. When two pulls are about equal, the nearer hole wins.
- **Hole picking for bore parts.** Double-clicking a gear, wheel hub, pulley or Smart Motor with nothing lined up starts hole picking, as it already does for pins and axles. The part can go onto another part's axle (sliding along it) or onto a hole's face (bore on the hole's line), previewed turned to fit the axle and to mesh. Ctrl/Cmd copy insert works the same way.
- **Out of scope:** bevel, crown and worm gears; sprockets and chains; pulleys; driving or simulating motion; re-meshing a whole existing train in one action.

## Capabilities

### New Capabilities
- `gear-meshing`: measured gear and rack tooth data, the meshing rule for spur–spur and spur–rack pairs, automatic turning on every placement path, several neighbours, messages and MCP behaviour.
- `square-shaft-fit`: measured square bore and axle orientations, axles turning to fit square holes, shaft groups turning together, and the Smart Motor's turning hub with its saved angle.

### Modified Capabilities
- `drag-hole-snap`: the pull reaches 12 pitch along the hole's line instead of 2, with a tie-break toward the nearer hole.
- `copy-insert`: bore parts get the copy preview too, with axle ends and hole faces as targets.
- `hole-pick-insert`: the preview's roll is no longer always "relative to the receiving part in 90° steps". A square axle into a square hole takes the hole's flat angle, and a gear in mesh range takes its meshing turn. Bore parts (gears, hubs, pulleys, the motor) can now be picked onto axle ends and hole faces.

## Impact

- **`scripts/index-part-metadata.mjs`:** new measurements via the existing BVH raycasting, written to `public/part-metadata.json` and `catalog.json` (`gearSpecs` extended, `rackSpecs`, port `shape`/`squarePhaseDeg`, shaft `squarePhaseDeg`, motor `hubRadiusMm`).
- **`src/utils/`:** new pure helpers for mesh phase, square-fit roll and shaft groups (e.g. `gearMeshing.js`), shared by the app and the MCP engine, with Node checks in `scripts/check-gear-meshing.mjs`.
- **`src/components/Viewport3D.jsx`:**
  - mesh turning in the drag and placement paths;
  - axle roll on insert;
  - shaft-group turns;
  - splitting the motor hub at load, with its own collision geometry and transform.
- **`src/App.jsx`:** saving the motor's `socketAngleDeg`; shaft-group turns as one history step.
- **`mcp/assembly-engine.mjs`, `mcp/vexiq-mcp-server.mjs`:** measured phases in `mesh_gear_train`, square fits and meshing in `place_part`/`place_parts`, notes in replies.
- **Saved format:** Smart Motor instances gain an optional `socketAngleDeg`. Older saves load unchanged (angle 0).
- **`features.md`.**
