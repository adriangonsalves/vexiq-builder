## 1. Pose and fit math (`src/utils/pinHoleAlignment.js`)

- [x] 1.1 Add `insertPose({ partMeta, measured, anchorFeatureId, leadEnd, face, outward, receivingQuaternion, roll })` per design.md §1. It returns `{ quaternion, position, rotationDeg, leadPoint }`. Leading ends are pins' sticking-out ends, both ends of straight shafts, and the uncapped end of capped shafts. Add cases to `scripts/check-pin-hole-alignment.mjs`, each verified by transforming the part's features with the result:
  - an upright 0x2 Connector Pin into a 2x12 Beam turned 30° about X: the pin's axis equals the hole's axis and its tip is 1 mm outside the picked face;
  - the same hole picked from its other face: the tip is outside the other face;
  - a 2x Pitch Capped Shaft into a beam hole: it leads with its uncapped end;
  - a shaft into a Smart Motor socket: it comes in from outside the motor.
- [x] 1.2 Add `listInsertFits(selectedFeaturesLocal, partMeta, measured, hovered, receivingQuaternion, otherFeatures, currentQuaternion)` per design.md §2. It returns fits sorted by green pins, then by smallest turn, with duplicate poses removed and markers (`{ point, green }`) for parallel inserts only. Check cases:
  - a 2x Wide 2x2 Corner Connector (two pegs 12.7 mm apart) into a hole of a 2x12 Beam turned 30° in its own plane: the first fit has both pegs green and its peg line runs along the beam's 30° hole row;
  - the same connector at the beam's last hole: the best fit is 2 green, and a fit with the second peg past the end is 1 green plus 1 red;
  - a single 0x2 pin: its 4 rolls collapse to 1 fit per leading end;
  - a corner connector's pegs on its other face are never counted.
- [x] 1.3 Add `openFaces(openingFeature)` per design.md §3 (through: both faces; `@hi` / `@lo`: the open face; other blind openings: the `end` face) and `isOpeningTaken(opening, otherFeatures)` (seated pair, via `findSeatedPairs`). Check cases:
  - a beam hole offers 2 faces, and the Smart Motor socket offers 1, outside the motor;
  - a beam hole with a seated connector pin is taken, and one with a pin 5 mm above it is not.

  Note: fits also try **pattern rolls** (design.md §2), the exact turns that put another parallel pin on a nearby parallel hole, so patterns at an angle to the receiving part can be filled. Found in use: a 2x3 corner connector couldn't go into a 30° corner connector's angled holes. Checked with those two parts at their real scene poses: both pegs green and both seated after the push-in, from either face.

  Note: a part whose insert runs through the middle of a bbox that is equally wide both ways across it (pins, shafts, standoffs) looks the same at every roll, so it gets one roll instead of four (`spinSymmetric`). That is how a single pin's 4 rolls collapse to one fit per end.

## 2. Pick mode in the viewport (`src/components/Viewport3D.jsx`)

- [x] 2.1 Change `handleMateRequest`: with no plans, start picking when the selected part has an insert feature, and keep the message otherwise. Add `pickModeRef` and `onPickStatus`. Hide the gizmo while picking (as the mate arrows do), and leave picking per design.md §5:
  - `Esc`;
  - a click with nothing hovered;
  - a selection change;
  - a Move/Rotate change;
  - Explode;
  - the part removed or changed by history.

  Verify in the app: double-click a lone pin to see the banner with the gizmo hidden; `Esc` restores the gizmo and adds no history step; double-click a lone beam to get "Nothing lined up to mate with".
- [x] 2.2 Hover per design.md §3: candidate faces gathered on entry; once-per-frame screen projection within 24 px, nearest to the camera; a cyan face ring, grey and "taken" for occupied holes. Verify in the app:
  - hovering a beam hole's top face rings it;
  - turning the camera and hovering the bottom face rings that face;
  - a hole with a pin in it shows as taken;
  - with the drivetrain loaded (thousands of holes), hovering stays smooth.
- [x] 2.3 Preview per design.md §4: a see-through ghost of the selected part at the best fit, and green/red discs at the markers. The wheel (only while a hole is hovered), `R` and `Shift+R` step through fits, with the banner showing "Fit i of n · g of m pins in holes". Verify in the app:
  - an upright pin over a plate turned 30° shows a tilted ghost;
  - a corner connector over the turned beam shows both pegs green along the hole row;
  - the wheel changes the fit without zooming.
- [x] 2.4 Insert: refactor `mateSelected(plan, { label })` to accept a label and commit through `onUpdateTransform(id, patch, { label })`. On click, set the fit's pose; if it overlaps, restore the pose and show "The way in is blocked"; otherwise sweep with `{ lateral: 0, direction: −n, travelMm, sweepMm }` and leave picking. A taken hole shows "That hole already has a part in it". Verify in the app:
  - a pin inserts and stops with its cap on the face, and the history shows "Insert 0x2 Connector Pin #… into …";
  - one undo restores the old position and rotation;
  - a 2x capped shaft stops with its cap on the hole's lip;
  - picking a hole right next to a wall gives "The way in is blocked".

  Verified in the app (headless Chrome):
  - a pin into a beam tilted 30°, a corner connector into a beam turned 30° (both pegs seated), and a capped shaft into a beam;
  - Esc, the wheel, R / Shift+R, and undo;
  - taken holes and hover speed on the drivetrain.

  "The way in is blocked" was confirmed on the drivetrain: holes with the motor, gears or collars just outside refuse with that message.

## 3. App, styles, docs

- [x] 3.1 `src/App.jsx`: pass `onPickStatus` and show its text in a HUD pill. `Esc` doesn't deselect while picking. `handleUpdateTransform` already forwards `meta.label`; confirm the insert step's label in the timeline. `src/styles.css`: pill and marker colors. Verify in the app: the banner shows the part label and fit count, and `Esc` while picking keeps the part selected.
- [x] 3.2 Update `features.md` (pin mating and a new "Pick a hole" section). Run `npm run build`, `node scripts/check-pin-hole-alignment.mjs`, `node scripts/check-history.mjs` and `node scripts/check-mcp-tools.mjs`; all pass. Then, in the app with the drivetrain loaded: pick a stray 0x2 pin into a wall plate hole from the outside, and a corner connector into the 30°-turned beam from a check scene, and confirm both insert as previewed and undo in one step.
