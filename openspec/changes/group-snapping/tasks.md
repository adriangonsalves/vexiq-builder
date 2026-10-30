## 1. Shared grid helpers

- [ ] 1.1 Add `stepDelta(delta, stepMm)` (round each axis to whole steps; 0 = exact) and `setGridPivot(features, centre)` (`gridPivot` over the union, box centre when no features) to `src/utils/partGroups.js`; verify with new cases in `scripts/check-part-groups.mjs`: 12.68 mm at 6.35 rounds to 12.7, Free stays exact, and a beam-and-pins set turned 4×90° about `setGridPivot` returns to the start with every hole still on its grid after each quarter turn
- [ ] 1.2 Verify `node scripts/check-part-groups.mjs` exits 0

## 2. Grid rules in the app

- [ ] 2.1 Inspector typed centre (`handleMoveSetCentreTo` in `src/App.jsx`) moves by `stepDelta` of the typed difference at the current snap; verify in the app that typing 160 into a centre X of 147.32 at 0.5P moves 12.7 mm and the field shows 160.02, and that Free moves exactly
- [ ] 2.2 Set turn pivot: Inspector quick 90° turns and the set rotate rings (`refreshSetRotateSetup`) use `setGridPivot` of the members' world features (rings keep it in the first member's frame between turns); verify four quick 90° turns of the BaseBot right side return every part to its start and the ring centre sits on a hole-grid point

## 3. Hole pull while dragging a set

- [ ] 3.1 Generalise `rebuildOtherFeatures` in `src/components/Viewport3D.jsx` to exclude a set of ids, and exclude all set members when a set drag starts; verify a beam-and-pins group dragged over empty space never jumps (no pulls between its own parts)
- [ ] 3.2 At set drag start collect the members' world features once; in `objectChange` translate them by the current delta and run `findHoleSnap` with the dragged axes and reach-box-filtered candidates; apply the offset to the pivot (axes along the hole line stay on the drag grid), remember the snap line, skip with Alt; verify in the app that dragging the Claw toward the Wrist 4x4 Plate jumps it onto the plate's hole lines, and that Alt drags freely
- [ ] 3.3 Show the aligned-hole highlights for the set's lined-up pairs while dragging (throttled with the overlap check); verify the plate's holes highlight as the Claw lines up

## 4. Release: settle or put back

- [ ] 4.1 Record `startOverlap` at set drag start; on release, if a snap line was used and members overlap outside parts, slide all members along the line with `clearSpotAlongLine` (set-level clear test, broad phase by box) within the single-part reach and commit there; verify a Claw snapped one step too deep into the plate settles flush and is saved as one "Move Claw" step
- [ ] 4.2 If the set still overlaps something it didn't at drag start, restore the start poses, re-mark overlaps, show "Can't place it there: it would overlap another part. Put back.", and save nothing; verify dropping a group inside a beam puts it back with the message and adds no history step, and that a set already overlapping a part can still be dragged a step and saved

## 5. Server parity

- [ ] 5.1 `update_group` in `mcp/vexiq-mcp-server.mjs`: `moveCentreTo` moves by `stepDelta` at the saved viewport snap (reply gives the centre reached), `turn` pivots on `setGridPivot` of `worldFeaturesFor` the members; verify new cases in `scripts/check-mcp-tools.mjs` (moveCentreTo 2 mm off a step lands on whole steps; four 90° turns return to the start) and that the script exits 0

## 6. Docs and final pass

- [ ] 6.1 Update `features.md` (group moves keep their hole grid, pull onto holes while dragged, settle or are put back on release; `update_group` grid rules)
- [ ] 6.2 Final pass: run all `node scripts/check-*.mjs`; in the app, on a copy of the Clawbot build with the Claw 0.58 mm off, drag the Claw a step away and back onto the wrist plate and confirm the audit shows no overlap between the Claw and the plate and that the wrist pins and Wrist Chassis Corner L are seated (Corner R is 0.338 mm off within the group itself, which a group move can't fix)
