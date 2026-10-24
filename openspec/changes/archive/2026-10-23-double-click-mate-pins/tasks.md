## 1. Which pin ends stick out (`src/utils/pinHoleAlignment.js`)

- [x] 1.1 Add `measurePinEnds(partMeta, raycast)` per design.md §1 (radial open-space test 1.5 mm in from each end, plus an open-air vote 1 mm past the end; no entry when neither end passes). `raycast` returns `{ distance, normal }` or null. Shafts are skipped (both ends free); unmeasurable pins keep both ends. Verify in the check script (2.1) with the engine BVH:
  - Triple 2x Wide, 2x2 Corner Connector: `peg_1`/`peg_4` free only at `hi` (+X), `peg_2`/`peg_3` free at both ends (the part has pins on its +Z and −Z faces);
  - 1x Wide, 1x1 Corner Connector `peg_1`: `hi` only;
  - Small Chassis Corner Connector: `peg_1` free at `lo` (−Y), `peg_2` free at `hi` (+Z);
  - 1x1 Connector Pin: both ends;
  - 1x Pitch Standoff: both ends (male–male: pin, 12.7 mm body, pin);
  - 1x2 Idler Pin: unmeasurable (inward-facing mesh), no entry, so both ends count.
- [x] 1.2 Change `collectWorldFeatures`'s fourth argument to `measured = { surfaces, pinEnds }`. Pin features carry `freeAtStart` / `freeAtEnd`; both are true when there's no measurement. Verify the existing check-script cases still pass after updating their calls.
- [x] 1.3 In `facesIfAlignedAndOutside`, reject a `pin` insert whose end on the opening's side is not free. Verify with check-script cases:
  - beam hole on the body side of a 1x Wide, 1x1 Corner Connector pin → nothing;
  - the pin side → hole;
  - 1x1 Connector Pin between two beams → both holes;
  - Triple corner connector with beams on its +X and −X sides → only the +X beam's holes.

## 2. Mate planning (`src/utils/pinHoleAlignment.js`)

- [x] 2.1 Make `findAlignedOpenings` results also carry `insertInstanceId`, `insertStart`, `insertEnd`, and the opening's `start`/`end`. Add `planMates(alignedOpenings, selectedId)` per design.md §3: direction per pair, 2° grouping, lateral correction from the nearest pair, and `travelMm`. Verify with check-script cases:
  - pin 20 mm above a beam hole: one direction (−Z), travel so the pin's lower end reaches the beam's bottom face;
  - pin over two stacked beams: one direction, both pairs;
  - beam selected over a placed pin: one direction toward the pin;
  - Triple corner connector with beams on +X and +Z: two directions;
  - shaft over a beam and a gear: travel puts the shaft's lower end flush with the gear's far face;
  - gear selected over a placed shaft: travel puts the shaft's top flush with the gear's top face;
  - pin 0.2 mm off-axis: lateral correction of 0.2 mm toward the axis.

## 3. Viewport: measuring, mating, double-click (`src/components/Viewport3D.jsx`)

- [x] 3.1 Add `pinEndCache` and `getPinEnds(group, partMeta)` next to `getOpeningSurfaces`, using the collision BVH (raycast returning distance and local face normal). Pass `{ surfaces, pinEnds }` to every `collectWorldFeatures` call. Keep the latest highlight result in `lastAlignedRef` inside `updateAlignedHoleHighlights`. Verify `npm run build` passes, and in the app (scratch copy with a debug hook) a corner connector no longer lights a beam on its body side.
- [x] 3.2 Add `mateSelected(direction)` per design.md §4: lateral shift, an already-touching check, 0.5 mm stepped sweep, `findFlushBoundaryPosition` at the first contact, else travel to `travelMm`, then commit through `onUpdateTransformRef` with `isIntersecting: false`. Verify in the app:
  - a pin mated into a beam ends not intersecting, and 0.5 mm further along the direction does intersect (contact);
  - a shaft mated into the Smart Motor socket stops at the socket bottom;
  - a shaft over a beam and a gear stops flush with the gear's far face;
  - a pin 0.2 mm off-axis ends on the axis.
  - _Done: tested in headless Chrome against an isolated copy of the app, with each stop confirmed by the engine BVH. A 0x2 pin over a beam stops at z = 8.18, clear, and 0.5 mm further down touches. The 0.2 mm off-axis pin ends at x = −19.05. The shaft over a beam and gear stops with its lower end at −3.18 (gear far face). The gear onto a shaft stops at z = 21.33. The shaft into the Smart Motor stops with its end at y = −4.7, the socket bottom from catalog `maxDepthMm`; nothing is touched first because the real socket is slightly deeper. A beam onto a standing pin stops by the travel rule (pin top flush with beam top), about 0.07 mm from resting on the shoulder._
- [x] 3.3 Add the `dblclick` handler per design.md §5 (ignore gizmo handles, drags, and other parts; locked and Explode checks; 0 / 1 / many plans). Add the `onMateFeedback` prop and wire it in `App.jsx` to `setActionFeedback`. Verify in the app:
  - double-clicking a lined-up pin mates it and shows "Mated with 1x6 Beam";
  - a locked part shows "Part is locked";
  - a part with nothing lined up shows "Nothing lined up to mate with";
  - double-clicking a gizmo arrow does nothing.
  - _Done: double-click goes through the gizmo center grab area (`XYZ` / `XYZE`). Only arrow, plane or ring handles, or a drag that actually moved the part, block it (design.md §5, revised). Messages checked in the app: "Mated with beam", "Part is locked", "Nothing lined up to mate with". A double-click on the gizmo X arrow does not mate._

## 4. Direction arrows (`src/components/Viewport3D.jsx`)

- [x] 4.1 Add the `__mate_direction_arrows__` overlay: pooled arrow meshes, orange with a lighter hover color, `depthTest: false`, sized like the gizmo and rescaled in the animate loop, at the selected part's bbox center. Hide and disable the gizmo while it shows. Verify in the app: double-clicking a Triple corner connector lined up on +X and +Z shows two large arrows pointing +X and +Z, and the gizmo is hidden.
- [x] 4.2 Clicking and hovering: `handlePointerUp` raycasts the arrows first (a hit mates; a miss dismisses and continues normal selection), and `pointermove` sets the hover color. Verify: clicking the +Z arrow mates in +Z, the arrows disappear, and the gizmo returns; clicking another part dismisses the arrows and selects that part.
  - _Done: clicking a part while the arrows show hides them and selects that part; checked with a click on a second beam, which then showed as selected (228-2500-005), and the triple did not move._
- [x] 4.3 Dismissals: a capture-phase `keydown` Esc handler that hides the arrows and stops propagation only while they show; also hide them on drag start, selection change, Explode, and hidden part. Verify: Esc with arrows showing leaves the part selected and unmoved; Esc without arrows still deselects as before.

## 5. End-to-end check and docs

- [x] 5.1 Run every `pin-mating` spec scenario in the app (scratch copy, headless Chrome as in the previous change), plus the modified alignment-rule scenarios. Check that the saved state after a mate has the new position and `lastValidPosition`. Note any failure here before checking it off.
  - _Done: all pin-mating scenarios pass in the app. Two first-run "failures" (shaft into motor socket, beam onto pin) had test expectations that also demanded contact; both stop exactly where the spec's no-collision rule says. Modified alignment scenarios: the corner connector body side no longer lights; the pin side lights._
- [x] 5.2 Re-run `node scripts/check-pin-hole-alignment.mjs` (exits 0) and the earlier aligned-hole-highlighting in-app scenarios. Verify there are no changes other than the intended body-side pin cases.
  - _Done: the check script exits 0. Earlier highlighting scenarios in the app are unchanged, except the intended case: the old "corner connector with a beam under its body" check no longer lights that hole._
- [x] 5.3 Update `features.md` (double-click mating, arrows, pins only projecting the way they stick out, and keyboard/mouse notes) and `design.md` (new §5.5 for mating, plus the §5.4 alignment-rule update). Verify the text matches the code constants.

## 6. Fixes from user testing

- [x] 6.1 Never save an overlapping pose. After the sweep, round the position to 0.001 mm and, if it collides, back off along the move in 0.002 mm steps until clear. Verify by reproducing the user's scene in the isolated app: the Triple 2x Wide, 2x2 Corner Connector mated into the 2x10 Beam ends at z = −2.835 with no intersecting parts (the engine BVH finds none, and the browser doesn't flag it). Before the fix it was saved at z = −2.833, overlapping.
- [x] 6.2 Keep looking for contact while the pin or shaft is still in a lined-up opening: `planMates` returns `sweepMm`, the sweep runs to it, and `travelMm` is used only when nothing is touched. Verify:
  - a new check-script case for `sweepMm` > `travelMm` on a pin above a beam;
  - in the app, the user's cap-up 0x2 Connector Pin goes in until it touches (clear, and 0.5 mm further touches) instead of stopping at z = 2.977;
  - the full mating set passes (19/19), with the motor socket now stopping at its real bottom and a beam onto a pin stopping at the pin's cap.

## 7. All pins mate (follow-up from user testing)

- [x] 7.1 Make the pin-end test (a) ignore face direction: count hits at the pin's radius, and reject the end if anything is closer. Verify with the check script:
  - all six idler pins (0x2, 0x2 Weak, 0x3, 0x3 Smooth Weak, 1x1, 1x2) project from both ends;
  - the corner-connector, Triple, Small Chassis, standoff, capped-pin and sheet-pin expectations are unchanged;
  - a 0x3 Idler Pin below a beam with its smooth end up gets a ring and one mate direction.
- [x] 7.2 Add a stand-in pin along local Z for pin-shaped "...Pin" parts in Pins & Standoffs with no stored pin (2x3 Smooth Idler Pin). Verify with the check script: the 2x3 Smooth Idler Pin projects from both ends, and all 18 pin parts in Pins & Standoffs project from at least one end.
- [x] 7.3 Double-click mates a selected part that is behind another part; a single click on the front part waits 350 ms before selecting it. Verify in the isolated app with the user's 2x10 Beam and idler pin positions:
  - the 0x3 Idler Pin, the 0x2 Idler Pin (Weak, hidden behind the beam) and the 2x3 Smooth Idler Pin each show a ring and mate up into the beam until they touch;
  - a single click on the beam over the hidden pin selects the beam after the wait;
  - the full mating set still passes (19/19).

## 8. Longer reach (follow-up from user request)

- [x] 8.1 Raise the alignment reach from 4 × pitch (50.8 mm) to 12 × pitch (152.4 mm) (`MAX_AXIAL_GAP_MM`; the viewport's reach boxes use the same constant). Verify with the check script (a hole 140 mm past a pin's end lights; 160 mm does not) and in the isolated app (a pin 140 mm below a beam lights its hole).
