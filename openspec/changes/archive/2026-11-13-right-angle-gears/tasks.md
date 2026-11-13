## 1. Measure the gears

- [x] 1.1 Set up the worktree: `npm install`, and link `VEX-IQ-All-Parts/` and `VEX-IQ-All-Control/` from the main checkout. Verify `node scripts/check-gear-meshing.mjs` passes before any change.
- [x] 1.2 Add `measureBevelGear` to `scripts/measure-part-geometry.mjs` (cone point from tip and root lines, cone angle as a sanity value, tooth phase, face span; design §1). Verify by printing the values for both bevel gears: tip and root lines agree on a cone point within 0.5 mm of the part origin, or the gear is returned unmeasured with a reason.
- [x] 1.3 Add `measureCrownGear` (toothed face, pitch plane, ring radii, tooth phase). Verify the 36 Tooth Crown Gear reports 36 teeth, a standard tooth size, and `toothFace` −1.
- [x] 1.4 Add `measureWormGear` (thread spacing, lead, starts, hand, pitch radius, thread span, thread phase) in the `refAxes` frame. Verify the angles agree on thread spacing within 0.05 mm and the spacing is within 2% of a VEX IQ tooth spacing. Settle the pitch radius in task 2.4: if a worm meshed with a 36 Tooth Gear at 25.4 mm is free of contact, store the grid value 6.35 mm and say why in design §1; otherwise keep tip minus one module.
- [x] 1.5 Call the three from `measureShapes` in `scripts/index-part-metadata.mjs`, keep the differential housings unmeasured, and list unmeasured gears in the indexer's output. Run `npm run index-metadata` twice and verify the four records are `measured: true` and identical between runs (angles within 0.1°, lengths within 0.01 mm), and that `git diff` shows no change to any spur gear, sprocket or rack record.
- [x] 1.6 If the worm's pitch radius isn't 6.35 mm, correct the "25.4 mm" distances in `specs/right-angle-gears/spec.md` scenarios. Verify the scenario numbers equal the measured worm pitch radius plus 19.05 mm.

## 2. Meshing rules

- [x] 2.1 Create `scripts/check-right-angle-gears.mjs` with one case per scenario of "Measured tooth data", "Which gears mesh at 90°", "A placed gear turns to mesh at 90°" and "Mesh spots" (using real catalog data, as `check-gear-meshing.mjs` does). Verify it runs and fails only on the cases not built yet.
- [x] 2.2 In `src/utils/gearMeshing.js`, extend `worldToothed` to the `bevel`, `crown` and `worm` kinds and add `canTurnToMesh`. Verify existing `check-gear-meshing.mjs` still passes.
- [x] 2.3 Add the bevel–bevel, crown–spur and worm–spur rules to `meshRelation` (range and exact phase; design §2). Verify the "Which gears mesh at 90°" cases pass, including the pairs that must not mesh, and a check that turning the worm +θ moves its crest by `hand·lead·θ/360`.
- [x] 2.4 Verify `meshTurn` gives a turn after which the engine's collision check finds no contact for each pair (two 18 Tooth Bevel Gears; 12 Tooth Gear on the crown; worm with 24 and 36 Tooth Gears), at several starting angles, and check how the audit already treats meshed spur pairs. If a correctly meshed pair still reports contact because of coarse models, stop and raise it before groups 3, 4 and 6 (design, Risks).
- [x] 2.5 Add `meshSpots(gear, partner)` (design §3). Verify the "Mesh spots" cases: 4 spots round a bevel with axes on ±X/±Z for a Y-axis partner, 8 for a crown round a spur, worm kept along its length when the meeting point is on the thread, and every spot in mesh range with tooth error under a quarter tooth.

## 3. Turning on placement

- [x] 3.1 Use `canTurnToMesh` in `src/utils/placementFit.js` so `settlePlacement` turns the new kinds, with the shaft group on a square axle. Verify the "Worm on a square shaft" and "Spur gear dropped on a crown gear" cases in the check script.
- [x] 3.2 Use it in `src/components/Viewport3D.jsx` (`liveFitWhileDragging`, the mate sweep) and `src/utils/pinHoleAlignment.js` (`meshPreviewTurn`), and in `src/engine/core.js`'s insert path. Verify in the running app: slide a bevel gear along a shaft toward another at 90°; it turns as it arrives, the message reads "Meshed … with …", and no overlap is flagged.
- [x] 3.3 Verify Alt and Free move stop the turn, and a hand turn in Rotate mode is kept, for a bevel pair in the app.

## 4. Loose gear jump and Join

- [x] 4.1 In `Viewport3D.jsx`, find the nearest free mesh spot within 6.35 mm while dragging a single gear with no hole snap active, show the see-through preview there, and place the gear at the spot on release as one history step (design §4). Verify the "Loose bevel gear dragged near another", "Loose worm", "Hole snap wins" and "Two spur gears" scenarios in the app, and that one undo returns the gear to where the drag began.
- [x] 4.2 Verify "Supports added later": insert a shaft through the jumped gear and add a beam; the shaft turns to the bore, the gear stays meshed, and `audit_assembly` lists the gear on the shaft.
- [x] 4.3 Double-click on a partner gear moves the selected gear to the spot nearest the click (design §5). Verify the "Double-click the partner", "Gears that can't pair" and "No room" scenarios, and that double-clicking the selected part itself still mates as before.
- [x] 4.4 Extend the context bar's Join button: Auto Join for a single gear with a 90° partner within 40 mm and nothing lined up. Verify the "Join on a tablet" scenario at a tablet-sized window with touch emulation, and that the battery Join still works.

## 5. Audit and the assistant

- [x] 5.1 Add the 90° pairs and their "near" entries to the `meshes` list in `src/engine/core.js`. Verify the "Mesh report for 90° pairs" scenarios with a case in `scripts/check-audit-issues.mjs` (or the right-angle check).
- [x] 5.2 Add `mesh_right_angle` to `src/engine/core.js`, `mcp/vexiq-mcp-server.mjs` and `src/utils/webMcpTools.js` (design §7). Verify with new cases in `scripts/check-mcp-tools.mjs` for "List then place" and "Wrong pair".
- [x] 5.3 Verify `place_parts` meshes a worm placed by hole and reports the changed roll ("Placed by hole" scenario) with a case in `scripts/check-mcp-tools.mjs`.

## 6. Play mode

- [x] 6.1 In `src/engine/core.js` and `src/sim/bodyGraph.js`, make links from the new mesh kinds with the signed ratio taken from the meshing maths and `oneWay` for worms (design §6). Verify existing `scripts/check-play-mode.mjs` passes unchanged, and a check that the same ratio method gives −1 × teeth ratio for parallel spur gears.
- [x] 6.2 In `src/sim/kinematic.js`, pass speeds one way across worm links and jam a motor that reaches one from the gear side. Add cases to `scripts/check-play-mode.mjs` for "Bevel gears turn a corner", "Crown gear reduction", "Worm drives its gear" and "Gear can't drive the worm" and verify they pass.
- [x] 6.3 In `src/sim/physics.js`, apply a one-way link's correction to the gear only, keep the motor's train walk from crossing it backward, and list the motor on entry. Verify "Worm holds an arm" and "Gear can't drive the worm" in the app's Play mode with gravity on, and that the entry list shows the worm message.

## 7. Docs and wrap-up

- [x] 7.1 Add the 90° gears to `features.md`, and one bullet to the marked "How pieces are used" section of `AGENTS.md` (the three pairs, the worm drives its gear only, use `mesh_right_angle`). Verify the MCP server's connect-time guidance includes the bullet.
- [x] 7.2 Add to `openspec/follow-ups.md`: the differential housings, loose spur gears jumping into mesh, and a cross-reference from context-toolbar's Join requirement. Verify the three items are listed under this change's heading.
- [x] 7.3 Run every `node scripts/check-*.mjs` and `openspec validate right-angle-gears --strict`. Verify all exit 0.
- [x] 7.4 Build a small test rig through the MCP tools (motor, worm, 36 Tooth Gear, an arm; and a bevel pair turning a wheel), run `audit_assembly`, and take `capture_screenshot` from two views. Verify no overlaps and that each part faces the right way.
