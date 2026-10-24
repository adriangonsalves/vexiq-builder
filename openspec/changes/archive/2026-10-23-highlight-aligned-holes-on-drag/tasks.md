## 1. Alignment math (`src/utils/pinHoleAlignment.js`)

- [x] 1.1 Create `src/utils/pinHoleAlignment.js` (imports only `three`) with named constants: parallel limit `cos(2°)`, line distance `0.25` mm, axial reach `4 × 12.7 = 50.8` mm, outside allowance `0.05` mm, collar hole radius range `[1.4, 1.7]` mm, shaft types `straight_shaft` / `capped_shaft` / `motor_shaft`, collar name pattern `/rubber shaft collar/i`, and an empty excluded-names list. Verify with `node -e "import('./src/utils/pinHoleAlignment.js').then(m => console.log(Object.keys(m)))"`, which lists the exports with no errors.
- [x] 1.2 Implement `collectWorldFeatures(partMeta, matrixWorld, instanceId)` following the table in design.md §2: `pin` from `pin_peg` ports; `shaft` from shaft `fastenerSpecs` (skipping collars) as the axis line through local `(0,0,0)` with `usableSpanZ`; `pin_hole` / `shaft_bore` from ports; `shaft_socket` with extent `[t0 − maxDepthMm, t0]`; `collar_hole` from the collar's `cylinders` entry with radius in `[1.4, 1.7]` mm. Clamp every extent to the bbox projected on the axis, then transform origin/axis/end points to world. Verify in the check script (2.1) that at the identity pose: the 0x2 Connector Pin peg extent is inside `[-6.26, 6.14]`; the 4x Pitch Shaft is `[-24.51, 24.51]`; the Smart Motor socket is `[-4.7, 0]`; `Rubber Shaft Collar` yields one `collar_hole` along ±Y through `x ≈ 4.091, z ≈ 8.095` and no `shaft`.
- [x] 1.3 Implement `findAlignedOpenings(selectedFeatures, otherFeatures)`: check both directions, apply the matching table (`pin` → `pin_hole`; `shaft` → `pin_hole`, `shaft_bore`, `shaft_socket`, `collar_hole`), skip same-instance pairs, run the parallel → line distance → gap/overlap tests from design.md §3, keep only `gap ≤ 50.8` and `overlap ≤ 0.05`, and de-duplicate by `instanceId:featureId`. Verify with the check script cases in 2.1.

## 2. Node check script

- [x] 2.1 Add `scripts/check-pin-hole-alignment.mjs` that loads `public/catalog.json`, places parts with `buildWorldMatrix` from `mcp/assembly-engine.mjs`, and asserts each case below. Verify by running `node scripts/check-pin-hole-alignment.mjs`, which prints a pass line per case and exits 0.
  - Pins:
    - 0x2 Connector Pin 20 mm above a 1x6 Beam hole → that hole is returned.
    - The same pin 1 mm to the side → nothing; tilted 10° → nothing; the hole 60 mm past the pin's tip → nothing.
    - Pin end exactly on the hole's face → hole returned. Pin tip 0.5 mm into the hole → nothing.
    - Beam selected with a placed pin under one hole → that beam hole is returned.
    - 1x Pitch Standoff and 1x1 Corner Connector each above a beam hole → hole returned; each seated → nothing.
    - Pin over a 36 Tooth Gear's center bore → nothing.
  - Shafts:
    - 4x Pitch Shaft above a beam hole → hole returned. Shaft end 0.5 mm into it → nothing.
    - Shaft through beam A and lined up with beam B beyond it → only beam B's hole is returned.
    - Shaft above a 36 Tooth Gear bore → bore returned.
    - Gear selected with a placed shaft below its bore → bore returned.
    - Shaft lined up with the Smart Motor socket, outside → socket returned; inserted → nothing.
  - Rubber collars:
    - Rubber Shaft Collar selected over beam holes → nothing.
    - Rubber Shaft Collar with its hole lined up with a placed shaft, outside → `collar_hole` returned.
- [x] 2.2 In the same script, confirm each collar's chosen cylinder is its real hole as described in design.md §7: load it with `getPartCollisionBvh`, cast 8 radial rays from 3 points along the axis, and require wall hits within 1.2–2.4 mm. If a collar fails, add its name to the excluded-names list from 1.1 and add a case asserting it returns no features. Verify by the script's pass/fail line for each collar.

## 3. Viewport overlay (`src/components/Viewport3D.jsx`)

- [x] 3.1 In the scene-setup effect, create the `__aligned_hole_highlights__` group on `scene` (not `partsRoot`), with one shared `RingGeometry` (≈2.6–3.6 mm), a small shared center-dot geometry, and one shared orange (`0xf97316`) `MeshBasicMaterial` with `depthTest: false`, `depthWrite: false`, `transparent`, `DoubleSide`, `toneMapped: false`, `renderOrder ≈ 1001`. Dispose the shared geometry/material in the effect cleanup. Verify `npm run build` succeeds and the app loads with no console errors.
- [x] 3.2 Add a pooled `showHoleHighlights(openings)` helper: reuse or grow ring objects, set position to the opening origin and orientation with `quaternion.setFromUnitVectors(+Z, axis)`, and set unused pool entries `visible = false`. Verify by temporarily calling it with one hard-coded hole and seeing an orange ring in the viewport that shows through a part placed in front of it.
  - _Done: the helper is the `show()` function returned by `createHoleHighlightOverlay()` in `Viewport3D.jsx`. Verified in headless Chrome: ring visible through a 12x12 Plate placed in front of the beam hole._
- [x] 3.3 Add `otherFeaturesRef` and `rebuildOtherFeatures()`, which collects world features for every visible, loaded, non-selected group in `meshMapRef` (using `catalogMapRef` and each group's `matrixWorld`). Verify by logging the count once while developing: it matches the number of inserts plus openings on the visible non-selected parts in a small test scene that includes a shaft and a gear.
  - _Done: features come from catalog data, so parts whose GLB is still loading are included too (the cache is not rebuilt when a GLB finishes loading). Verified by exact highlight sets instead of a count log: two stacked beams, shaft over beam + gear, hidden other part excluded._
- [x] 3.4 Add `updateAlignedHoleHighlights()`: hide everything when nothing is selected, the selected instance is hidden, or `explodeModeRef.current !== 'off'`; otherwise `updateMatrixWorld()` the selected group, collect its world features, run the 50.8 mm-grown world-box filter on other parts, call `findAlignedOpenings`, and pass the result to `showHoleHighlights`. Verify that selecting a pin already lined up over a beam hole shows the ring, and deselecting (click empty space / `Esc`) removes it.

## 4. Hook into drag and scene sync

- [x] 4.1 In `dragging-changed`, call `rebuildOtherFeatures()` at drag start. Verify a drag that starts after another part was moved still highlights against that part's new position.
- [x] 4.2 In `objectChange`, call `updateAlignedHoleHighlights()` after the translate branch has set the final `obj.position` (just before `return`), and in the rotate branch after the collision check. Verify by dragging a 0x2 Connector Pin across a beam with the Move gizmo (rings appear only when the pin is over a hole), dragging a shaft down toward a beam (the ring disappears as soon as the shaft enters), and rotating a pin with the Rotate gizmo (`E`) into a hole's axis (the hole lights up).
- [x] 4.3 At the end of the instance-sync `useEffect`, call `rebuildOtherFeatures()` then `updateAlignedHoleHighlights()`. Verify: after releasing a lined-up pin the ring stays; an Inspector `+X` nudge that lands the pin over a hole shows the ring; turning on Explode clears it; hiding the selected part clears it.

## 5. End-to-end check in the app

- [x] 5.1 With `npm run dev`, check each spec scenario by hand and note any failure in this task before checking it off:
  - _Done: run as scripted headless-Chrome scenarios against an isolated copy of the app (scratch-only debug hook reporting the highlighted openings). All scenarios pass; three early failures were mistakes in the test setup (corner connector hole axis, a click landing on the gizmo, a collar placed off the shaft) and passed once corrected. Collar cases were set up by placing parts rather than dragging. Hole-behind-the-dragged-part is covered by the same see-through drawing as the plate-in-front check._
  - Pins:
    - A pin over a beam hole lights the hole; over two stacked beams, both holes light.
    - Sliding the pin off alignment clears the ring.
    - The ring disappears the moment the pin's tip enters the hole and comes back when it's pulled out.
    - Dragging a beam over a placed pin lights the beam's hole.
    - A corner connector (pins and holes) lights openings both ways.
    - A pin over a gear's center bore does not light it.
  - Shafts:
    - A shaft over a beam hole and a gear bore behind it lights both.
    - Once the shaft enters the beam, only the gear bore stays lit.
    - Dragging a gear onto a placed shaft lights its bore.
    - Moving a Smart Motor over a shaft lights its socket.
  - Rubber collars:
    - Dragging a Rubber Shaft Collar onto a shaft lights its hole until it slides on.
    - Dragging a collar over beam holes lights nothing.
  - Display:
    - The ring is visible when the hole is behind the dragged part and inside a plate stack.
    - Clicking where a ring is drawn selects the part underneath as before.
- [x] 5.2 Check drag smoothness on the largest available scene (e.g. a 12x12 Plate dragged over a grid of placed pins, and a 12x Pitch Shaft dragged through a frame): no visible stutter compared to before the change. Verify with the browser Performance panel that `objectChange` stays under ~8 ms per call.
  - _Done: measured in headless Chrome (software rendering) on an isolated copy. Highlight update: 3.4 ms avg / 5.7 ms max with a 12x12 Plate over 120 pins, 0.04 ms for a 12x Pitch Shaft over a 6-beam frame. Whole pointer move: ~219 ms with the feature off vs ~229 ms on in the plate scene. The 8 ms target is not met even with the feature off; that cost was there before this change, so the check is on the added cost (~4%)._
- [x] 5.3 Confirm display-only behavior: after a session with highlights shown, `.vexiq-assembly-state.json` contains no highlight data and part positions match what was dragged. Verify by inspecting the file.
  - _Done: the bridge writes `public/assembly-state.json` (not `.vexiq-assembly-state.json`). After the test session it held only `version, selectedId, viewport, instances, updatedAt`, with no highlight fields._

## 6. Docs

- [x] 6.1 Update `features.md` section 2 with an "Aligned Hole Highlighting" entry: what lights up for pins and for shafts (pin holes, gear/wheel bores, motor socket, rubber collar holes), both directions, see-through, stays while selected, clears as soon as the pin or shaft enters. Verify the entry is present and matches the shipped behavior.
- [x] 6.2 Update `design.md`: add `src/utils/pinHoleAlignment.js` to the module table and a new §5.4 describing the matching table, where shaft/socket/collar features come from, the `spanMm` clamping, the thresholds, and the overlay. Verify the module table and section are present and the thresholds match the code constants.

## 7. Ring on the rim, at the face toward the pin/shaft (follow-up from user testing)

- [x] 7.1 In `pinHoleAlignment.js`, make openings run to the part's faces: through holes/bores in parts ≤ 7 mm thick along the axis (`THIN_PART_MAX_MM`) use the whole bbox; other opening ends within 1 mm of a face (`FACE_SNAP_MM`) move out onto it. Give each opening a rim radius (`OPENING_RIM_RADIUS_MM`: pin hole 3.175 mm, bore/socket 2.5 mm; collar uses its cylinder radius). Verify with the check script: Smart Motor socket extent is `[-4.7, 0.13]`, and a pin 0.5 mm into a 12x12 Plate's bottom face returns nothing.
- [x] 7.2 Make `findAlignedOpenings` return `face` (the opening end on the insert's side) and `radiusMm`. Verify with new check-script cases: ring at beam top face `z = 3.05` for a pin above, at `z = -3.05` when the beam is selected over a pin below, at the 12x12 Plate bottom face for a pin below, at the gear top face `z = 3.18` with radius 2.5, at the motor top `y = 0.13`, and at the collar face `y = 9.44` with radius 1.575. `node scripts/check-pin-hole-alignment.mjs` exits 0.
- [x] 7.3 In `Viewport3D.jsx`, draw each ring at `face`, from the rim radius to rim + 0.7 mm (one cached `RingGeometry` per radius), and remove the center dot. Verify with `npm run build` and close-up screenshots in the app: rings sit on the hole rim at the near face of a beam, the far face (beam selected over a pin behind it), a gear bore's top face, and a plate's front face.
- [x] 7.4 Update `features.md` and `design.md` §5.4 for the face position, rim radii, and face-to-face thin through holes. Verify the text matches the code constants.

## 8. Project rings onto the receiving part's surface (follow-up from user testing)

- [x] 8.1 Add `measureOpeningSurfaces(partMeta, raycast)` to `pinHoleAlignment.js` (8 rays per side at rim + 0.35 mm, nearest hit to the insert, hits > 1 mm outside the catalog extent ignored, clamped to the bbox) and an optional `surfaces` argument to `collectWorldFeatures`. Verify with the check script: 1x6 Beam hole_2 measured faces are symmetric and inside ±3.05; Smart Motor socket face ≤ 0.13.
- [x] 8.2 Verify the outside test uses the measured surface: ring drawn at the measured beam surface; still shown with the pin tip between the bbox face and that surface; gone 0.5 mm past it. `node scripts/check-pin-hole-alignment.mjs` exits 0.
- [x] 8.3 In `Viewport3D.jsx`, measure each part's opening surfaces once on its collision BVH (minus the 0.38 mm erosion), cache per part id, pass them to `collectWorldFeatures`, and rebuild highlights when a GLB finishes loading. Verify with `npm run build` and in the app: ring faces reported at z = ±2.462 for beam/plate holes (was ±3.05); the earlier scenarios give the same results.
- [x] 8.4 Update `features.md` and `design.md` §5.4. Verify the text matches the code.

## 9. Solid on-surface rings on both faces + faint see-through ring (follow-up from user review)

- [x] 9.1 Return `farFace` (null for non-through openings) and `outward` from `findAlignedOpenings`; carry `through` on opening features. Verify with the check script: beam hole far face at z = -3.05 with outward +Z; measured far face at the measured bottom surface; Smart Motor socket has no far face.
- [x] 9.2 In `Viewport3D.jsx`, draw depth-tested solid rings (polygon offset, lifted 0.15 mm) at both faces and one 30% see-through ghost ring at the entry face, from two pools. Verify with `npm run build` and in-app close-ups: front hole shows a solid ring; with the entry face pointing away, a solid ring on the visible far face plus a faint ghost; a hole covered by a plate shows only the ghost; earlier scenarios unchanged.
- [x] 9.3 Update `features.md` and `design.md` §5.4. Verify the text matches the code.
