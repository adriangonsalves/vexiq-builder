## 1. Shared grid helpers

- [x] 1.1 Add `stepDelta(delta, stepMm)` (round each axis to whole steps; 0 = exact) and `setGridPivot(features, centre)` (`gridPivot` over the union, box centre when no features) to `src/utils/partGroups.js`; verify with new cases in `scripts/check-part-groups.mjs`: 12.68 mm at 6.35 rounds to 12.7, Free stays exact, and a beam-and-pins set turned 4×90° about `setGridPivot` returns to the start with every hole still on its grid after each quarter turn
- [x] 1.2 Verify `node scripts/check-part-groups.mjs` exits 0

## 2. Grid rules in the app

- [ ] 2.1 Inspector typed centre (`handleMoveSetCentreTo` in `src/App.jsx`) moves by `stepDelta` of the typed difference at the current snap; verify in the app that typing 160 into a centre X of 147.32 at 0.5P moves 12.7 mm and the field shows 160.02, and that Free moves exactly
- [ ] 2.2 Set turn pivot: Inspector quick 90° turns and the set rotate rings (`refreshSetRotateSetup`) use `setGridPivot` of the members' world features (rings keep it in the first member's frame between turns); verify four quick 90° turns of the BaseBot right side return every part to its start and the ring centre sits on a hole-grid point

## 3. Hole pull while dragging a set

- [ ] 3.1 Generalise `rebuildOtherFeatures` in `src/components/Viewport3D.jsx` to exclude a set of ids, and exclude all set members when a set drag starts; verify a beam-and-pins group dragged over empty space never jumps (no pulls between its own parts)
- [ ] 3.2 At set drag start collect the members' world features once and keep `freeSetFeatures` of them; in `objectChange` translate them by the current delta and run `findHoleSnap` with the dragged axes, `axialReachMm: SET_HOLE_SNAP_AXIAL_REACH_MM` and candidates filtered by the set's box grown by 25.4 mm; apply the offset to the pivot (axes along the hole line stay on the drag grid), remember the snap line, skip with Alt; verify in the app that dragging the Claw toward the Wrist 4x4 Plate jumps it onto the plate's hole lines, and that Alt drags freely
- [ ] 3.3 Show the aligned-hole highlights for the set's lined-up pairs while dragging (throttled with the overlap check); verify the plate's holes highlight as the Claw lines up

- [x] 3.4 Add `SET_HOLE_SNAP_AXIAL_REACH_MM = 25.4`, `freeSetFeatures(features)` and a `rejectMove(offset)` option on `findHoleSnap` to `src/utils/pinHoleAlignment.js`, with cases in `scripts/check-pin-hole-alignment.mjs`: a beam with one pin sticking out and one flush pin keeps the sticking-out pin and its empty holes and drops the filled holes and flush pin; a pin 0.3 mm off a hole line 30 mm along it snaps at 152.4 mm reach and not at 25.4 mm; with `rejectMove` refusing the nearest move, the next best is returned; verify the script exits 0
- [ ] 3.5 No pulling back to the start in the set drag: `rejectMove` refuses a move leaving the delta under 0.25 mm while `setDragRef.leftStart` is false; `leftStart` turns true when the delta first exceeds 3.5 mm; verify in the app (snap Free) that a group seated on pins dragged 2 mm sideways isn't pulled back, and that one pulled 10 mm off along the pins and pushed back pulls on again

## 3a. Straightening small tilts

- [x] 3a.1 Add `findStraighten` to `src/utils/pinHoleAlignment.js` and cases to `scripts/check-pin-hole-alignment.mjs`: a pin 3° off a hole gives a 3° turn about the pin's point, 6° gives none, 0.05° gives none, three agreeing pairs beat one nearer pair; verify the script exits 0
- [ ] 3a.2 Single-part drag straightens before the hole pull (from the drag's start rotation, skipped with Alt); verify in the app that a 1x6 Beam tilted 3° dragged onto two standing pins ends square and seated, a beam angled 20° isn't turned, and Alt keeps the tilt
- [ ] 3a.3 Set drag straightens with the combined free outer features (set reach, same candidates as 3.2), turning every member about the pivot; verify the Claw turned 2° off the wrist plate ends square with its pins and pegs on the plate's hole lines

## 3b. Edge members

- [ ] 3b.1 At set drag start work out `setDragRef.edge` (members whose box meets a cached outside part's box, worked out again at each use); `markSetOverlaps`, `startOverlap` and the release tests use only `edge` (worked out again at the release pose); verify in the app that dragging the Claw group along the chassis shows the same overlap marks as a full check (temporary debug compare of edge-only vs all members over a few drags, removed after), and that the drag keeps up with the pointer

## 4. Release: settle, fit, or put back

- [ ] 4.1 Record `startOverlap` at set drag start; on release, if a snap line was used and members overlap outside parts, slide all members along the line with `clearSpotAlongLine` (set-level clear test, broad phase by box) within the single-part reach and commit there; verify a Claw snapped one step too deep into the plate settles flush and is saved as one "Move Claw" step
- [ ] 4.2 After the fit (4.4), if the set overlaps something it didn't at drag start, restore the start poses, re-mark overlaps, show "Can't place it there: it would overlap another part. Put back.", and save nothing (a straightening turn and the fit are undone too); verify dropping a group inside a beam puts it back with the message and adds no history step, and that a set already overlapping a part can still be dragged a step and saved

- [x] 4.3 Split `fitBlock(state, { movingIds, fixedIds, region })` out of `fixAssembly` in `src/engine/fixAssembly.js` (pairing, line fit with outliers, square-up, 25°/10 mm limit, seating; returns poses and pair count or a `reason`, no history) and have `fixAssembly` call it; add the `fit_set` action (`{ ids, poses }`, fixed = visible outside parts within the set's box grown by 20 mm) to `src/engine/actions.js`; add cases to `scripts/check-fix-assembly.mjs`: a two-part set 3° off and 2 mm short of a plate's holes comes back square and seated; a set split from its group is fitted (no group refusal); 30° off gives `too-far`; verify the existing cases still pass and the script exits 0
- [ ] 4.4 On set drag release, after the settle (4.1) and unless Alt is held or `leftStart` is false, await `fit_set` with the dropped poses through the `backend.runAction` path, gizmo hidden and viewport input ignored meanwhile; pose the members at the returned poses and save the drag and fit as one step labelled "Move <set>. Lined up N pins and holes with <part>"; a failed call or a `reason` keeps the dropped poses with no fit message; verify in the app (dev server and static preview) that the Claw dropped 3° off and 2 mm short of the wrist plate lands square and seated as one step, and that undo takes it back to the start in one step
- [ ] 4.5 Moving part of a group: make sure the set drag's ids are the selection itself (not grown with `expandToGroups`) and that `commitSetPoses` leaves `groupId` / `groupName` alone; verify in the app that two Claw parts selected in the Outliner and dragged out along their pins move alone, the rest stays, all stay in the Claw group, and dragging them sideways through Claw pins left behind is put back with the message

## 4a. Mating a set by double-click

- [x] 4a.1 Generalise `planMates(aligned, ids)` to take a set of ids (a single id still works) and extend `freeSetFeatures` to return each free insert's leading ends; add `listSetInsertFits` (30° limit, smallest turn, square-shaft roll, pattern count, sort) to `src/utils/pinHoleAlignment.js`; cases in `scripts/check-pin-hole-alignment.mjs`: a beam with four downward pins 12.7 mm apart over a plate lists the all-four-green fit first; pins tilted 20° give a 20° turn and land on the holes; 40° gives no fit; a sideways pin gives no fit at a top-face hole; a single-id `planMates` call gives today's result; verify the script exits 0
- [ ] 4a.2 Double-click on a set: `handleDoubleClick` passes sets (not Ctrl/Cmd) to `handleMateRequest`'s set branch; lined-up pairs within 25.4 mm → `mateSet` push or mate arrows (arrow click pushes the set); `mateSet` moves every member, stops flush on contact using edge members, runs the release fit (`fitSetNow`, not with Alt), tests overlap on the rounded poses, puts back on a new overlap, and saves one "Mate <set> onto <part>" step; verify in the app that the Claw 8 mm off the wrist plate with its pins on the hole lines is pushed on by a double-click, and that a set lined up two ways shows two arrows
- [ ] 4a.3 Set hole picking: `buildSetPickSession` with leading ends and only the faces within 30° ringed; hover lists `listSetInsertFits`; one see-through copy of the whole set shown at the fit with green/red markers; R / wheel step fits; click poses, checks the way in, pushes with `mateSet`, saves one "Insert <set> into <part>" step; Esc / empty click ends it; no faces → the message; verify in the app with a group of a beam and four downward pins tilted 20° over a plate (rings only on the plate's top faces, first fit all green, click seats it square), and that Ctrl/Cmd + double-click with a group selected still says copies go one part at a time

## 5. Server parity

- [x] 5.1 `update_group` in `mcp/vexiq-mcp-server.mjs`: `moveCentreTo` moves by `stepDelta` at the saved viewport snap (reply gives the centre reached), `turn` pivots on `setGridPivot` of `worldFeaturesFor` the members; verify new cases in `scripts/check-mcp-tools.mjs` (moveCentreTo 2 mm off a step lands on whole steps; four 90° turns return to the start) and that the script exits 0

## 6. Docs and final pass

- [x] 6.1a Update `features.md` for double-click mating and hole picking of a set (facing pins only, 30°), and for copy-insert staying single-part
- [x] 6.1 Update `features.md` (group moves keep their hole grid, pull onto holes within 1 inch along the line while dragged using only free outer pins and holes and never back to the start, are fitted with Fix assembly's rules on release, settle or are put back; moving part of a group keeps its membership; parts and groups straighten small tilts onto hole lines; `update_group` grid rules)
- [ ] 6.2 Final pass: run all `node scripts/check-*.mjs`; drag the 45-part Claw near the chassis for several seconds and confirm it keeps up with the pointer; in the app, on a copy of the Clawbot build with the Claw 0.58 mm off, drag the Claw a step away and back onto the wrist plate and confirm the audit shows no overlap between the Claw and the plate and that the wrist pins and Wrist Chassis Corner L are seated (Corner R is 0.338 mm off within the group itself, which a group move can't fix)
