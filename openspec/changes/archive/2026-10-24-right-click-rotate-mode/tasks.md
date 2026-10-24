## 1. Finding joints (`src/utils/pinHoleAlignment.js`)

- [x] 1.1 Factor the axis test (parallel within 2°, lines within 0.25 mm) and the span projection out of `facesIfAlignedAndOutside` into a shared helper, per design.md §1. Verify `node scripts/check-pin-hole-alignment.mjs` still passes with no changes to its expectations.
- [x] 1.2 Add `findEngagedJoints(selectedFeatures, otherFeatures)` per design.md §1 (overlap > 0.05 mm, merge pairs on the same line, return `{ lines: [{ origin, axis, pairs }] }`). Add check-script cases:
  - 0x2 Connector Pin seated in a 1x6 Beam hole: 1 line, along the hole axis;
  - the same pin 5 mm above the hole: 0 lines (and the hole is still highlighted by `findAlignedOpenings`);
  - 4x Pitch Shaft through a beam hole and a 36 Tooth Gear bore on one axis: 1 line, 2 pairs;
  - 1x6 Beam selected with pins seated in two of its holes: 2 lines;
  - the beam selected with one pin seated: 1 line;
  - a pin selected that is seated in two stacked beams: 1 line.

## 2. Ring gizmo (`src/components/Viewport3D.jsx`)

- [x] 2.1 Add `createRotateGizmo(scene)` per design.md §2: rings in gizmo units with screen-size rescale, picking tori, snap ticks, drag slice, hover/selected/dragging looks, and `show({ pivot, axes, color })` / `hide()` / `pick(raycaster)` / `setSnap(step)` / `dispose()`. Verify `npm run build` passes and, in the app, three X/Y/Z rings render around a selected free part in Rotate mode and stay the same screen size when zooming.
- [x] 2.2 Add the rotate setup per design.md §3: on entering Rotate mode, on selection change, and after each commit, compute joint lines with `findEngagedJoints` against `otherFeaturesRef`, then pivot and axes (0 lines: part center and world axes; 1 line: that line; more: hide rings and send the message). Detach `TransformControls` in Rotate mode and stop calling `setMode('rotate')` / `setRotationSnap`. Verify in the app: a free beam shows three rings at its middle; a pin mated into a beam shows one orange ring on the hole axis; a beam with two seated pins shows no rings and the message.
- [x] 2.3 Add ring dragging per design.md §4: pointer projected on the ring plane, angle from the press point, snap the ring total to the Rotation Snap step, set the pose from the gesture start pose about the pivot, orbit disabled during the drag, collision recolor on each move, and no selection change on release. Verify in the app: a free 1x6 Beam dragged a quarter turn on Y turns 90° with its center unchanged; with 15° snap the angle only lands on multiples of 15°; with Free it follows the pointer; a beam on one pin swings with the pin still in its hole (the pin is not shown as overlapping).

## 3. Angle labels and typing (`Viewport3D.jsx`, `src/styles.css`)

- [x] 3.1 Add the label overlay per design.md §5: one label per visible ring, placed each frame just outside the ring, showing the axis and the ring total wrapped to (−180, 180]. Verify in the app: labels read 0° on entering Rotate mode, track a drag, and reset to 0° after selecting another part and coming back.
- [x] 3.2 Make labels editable: click → number input; Enter turns by `typed − current`; Esc / blur cancels; a non-number is ignored. Verify in the app: typing 22.5 on the Z label turns the part so it reads 22.5°; Esc leaves it unchanged; pressing `E`, `W` or Delete while typing does nothing else.

## 4. Right-click, wheel, Esc and double-click (`Viewport3D.jsx`, `src/App.jsx`)

- [x] 4.1 Add the right-click handling per design.md §6: block `contextmenu` on the canvas; a right press/release under 5 px on the selected part (anywhere under the pointer) calls a new `onToggleRotateRequest` prop. In App, refuse with a message for a locked part or Explode view, otherwise toggle `transformMode`. Verify in the app: right-click toggles Move ↔ Rotate; right-drag still pans and doesn't toggle; right-click on another part or empty space does nothing; no browser menu appears; a locked part shows "Part is locked" and the mode stays.
- [x] 4.2 Add ring selection and wheel turning per design.md §6: a click without drag on a ring toggles it selected; a click off a ring unselects it; a capture-phase `wheel` listener (registered before OrbitControls) turns one step per 100 `deltaY` (5° when Free) and blocks zoom, with `orbit.enableZoom` off while a ring is selected; commit 300 ms after the last wheel event. Esc unselects the ring before App's handler sees it. Verify in the app: with 15° snap, selecting X and scrolling three notches turns 45° with no zoom; after Esc the part stays selected and the wheel zooms.
- [x] 4.3 Make `handleDoubleClick` ignore double-clicks on a ring, and make `showMateArrows` / `hideMateArrows` hide and restore the ring gizmo. Verify in the app: double-clicking a ring of a lined-up pin doesn't mate it; double-clicking the pin itself in Rotate mode still mates; while mate arrows are shown no rings are visible.

## 5. Saving (`Viewport3D.jsx`)

- [x] 5.1 Add `commitRotation()` per design.md §7 and use it for drag release, typed angles and the wheel pause; rerun the rotate setup after the instance sync. Verify in the app: after a ring drag the saved `public/assembly-state.json` (via the server sync) has the new rotation and position; a beam swung into another beam is shown overlapping and is put back at its last clear pose when another part is selected; a free part turned so a pin lands in a hole then shows only that joint's ring.

## 6. Wrap-up

- [x] 6.1 Update `features.md` (Rotate mode section and shortcuts: right-click, rings, typed angles, wheel) and the Viewport section of `design.md` (ring gizmo replaces the stock rotate gizmo; joint finding). Verify both describe the behavior in `specs/rotate-mode/spec.md`.
- [x] 6.2 Run `npm run build` and `node scripts/check-pin-hole-alignment.mjs`; both pass. Then go through every scenario in `specs/rotate-mode/spec.md` in the running app and note any that fail.
