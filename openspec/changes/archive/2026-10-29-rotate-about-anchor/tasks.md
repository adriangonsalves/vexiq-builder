## 1. Anchor lines helper

- [x] 1.1 Add `parallelLines(lines, axis, { exclude, maxAngleDeg = 2, excludeMm = 0.25 })` to `src/utils/pinHoleAlignment.js`: returns the joint lines whose axis is within 2° of `axis` (either sign), leaving out a line that passes within 0.25 mm of `exclude`; verify with 1.2
- [x] 1.2 Add checks to `scripts/check-pin-hole-alignment.mjs`: a plate with two pins seated along one axis gives two lines parallel to that axis and none parallel to the other two; excluding a point on one pin's line leaves one; a line 1.5° off counts, 3° off doesn't; verify `node scripts/check-pin-hole-alignment.mjs` exits 0

## 2. Gizmo lines

- [x] 2.1 In `createRotateGizmo` (`src/components/Viewport3D.jsx`), add a turning-axis line drawn over the parts (`depthTest: false`, render order above the rims), sized in mm from a half-length passed to `show`; draw it for the dragged, else selected, else hovered ring through the gizmo centre in the ring's colour, from `refreshLooks`; hide it in `hide`; verify in the app that hovering, selecting and dragging each ring on a free beam, a pinned beam (Joint ring) and a group shows one line along the right axis
- [x] 2.2 Add a pool of orange anchor lines and one dashed default-centre line (`LineDashedMaterial`) with `setAnchorLines(lines, dashedLine)` and `pickAnchor(pointerPx, project)` (nearest within 6 px on screen, `-1` for the dashed line's own id); verify by calling it from the console on a selected plate and seeing the lines in both stereo pictures

## 3. Rotate setup

- [x] 3.1 In `refreshRotateSetup`, keep `lines`, `center` and the part's default centre (`localDefaultPivot`) on `rotateSetupRef.current`; keep the angles when it's the same part with the same ring names (drop the 0.5 mm pivot test); verify turning a free beam still keeps its labels across turns and they reset on a new selection
- [x] 3.2 Add `refreshAnchorLines()`: for one part held on 2+ lines with a ring selected, show `parallelLines` for that ring's axis (excluding the current pivot) and the dashed line through the default centre when the pivot is elsewhere; clear otherwise; call it from `selectRing` and the end of `refreshRotateSetup` / `refreshSetRotateSetup`; verify Z ring on a plate held by pins along Z shows the pin lines, X ring shows none, Esc clears them
- [x] 3.3 Add `chooseAnchor(index)`: move the pivot to the point on the line nearest `center`, store it as `localPivot`, set that ring's axis to the line's exact direction (sign matched, kept as a part-frame axis), move the gizmo, keep the ring selected, refresh anchor lines; the dashed line restores `localDefaultPivot` and the world axis; verify the part doesn't move and labels keep their values

## 4. Pointer handling

- [x] 4.1 In `handleRingPointerDown`, test `pickAnchor` before the ring pick; on a hit start an `anchor` press; in `handleRingPointerUp`, call `chooseAnchor` when the pointer moved less than 5 px, and set `ringClickHandled` so the click neither changes the selection nor unselects the ring; a drag from an anchor orbits the camera; verify clicking a pin line moves the rings, dragging from it orbits, and the plate stays selected
- [x] 4.2 Make sure the "click off the rings unselects the ring" path and the right-click Move/Rotate switch ignore a click that landed on an anchor line; verify the ring stays selected after choosing an anchor and the wheel then turns the part about the pin (Rotation Snap 45°, two notches = 90°)

## 5. Whole behaviour

- [x] 5.1 Build a test case in the app (or via MCP: a 4x8 plate with two connector pins seated along Z into a beam below), select the plate, Rotate mode, Z ring, click one pin's line, drag 90°: verify the plate swings about that pin, the pin is still in its hole after `audit_assembly`, and `capture_screenshot` from two views shows the rings centred on the pin
- [x] 5.2 Turn the plate into a neighbouring part and release: verify the turn is put back with the overlap message and the rings stay on the chosen pin; then select another part and back: verify the rings are at the default centre again
- [x] 5.3 Update the Rotate mode section of `features.md` (turning-axis line, anchor lines, click to move the rings, dashed line to go back); run every `node scripts/check-*.mjs` and verify each exits 0
