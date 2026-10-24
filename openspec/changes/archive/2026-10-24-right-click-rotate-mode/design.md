## Context

See `proposal.md` for why; the rules are in `specs/rotate-mode/spec.md`.

Current state that shapes the approach:

- **Rotate today** (`src/components/Viewport3D.jsx`): one `TransformControls` instance serves both modes. `transform.setMode(transformMode)` switches it, `setRotationSnap` takes the App's `rotationSnapDeg` (15 / 45 / 90 / 0 = Free). It turns the group around its origin, not its center. `objectChange` in rotate mode only runs the collision check, recolors, and calls `updateAlignedHoleHighlights()`. `dragging-changed` (release) commits `{ position, rotation (Euler XYZ degrees, 2 decimals), isIntersecting }` through `onUpdateTransformRef`.
- **Mode state** (`src/App.jsx`): `transformMode` is `'translate' | 'rotate'`, set by `W` / `E`, the toolbar, the server state sync, and WebMCP `configureViewport`. It is saved in the assembly's `viewport` block.
- **Camera**: `OrbitControls` with default buttons, so right-drag pans and the wheel zooms. There is no `contextmenu` handler.
- **Pointer handling**: `handlePointerUp` ignores anything but the left button; `pickPartsAt(e)` returns the visible parts under the pointer, nearest first. `handleDoubleClick` skips gizmo handles via `transform.axis`.
- **Joints**: nothing is stored. `findAlignedOpenings` in `src/utils/pinHoleAlignment.js` pairs inserts (pins, shafts) with openings, checking axes within 2° and 0.25 mm, and keeps only pairs whose axial overlap is ≤ 0.05 mm (still outside). Feature `start`/`end` points give each usable span. `otherFeaturesRef` caches the world features of every other visible part (rebuilt at drag start and after each instance sync).
- **Parts**: each group has `userData.localBox` (part-local box) and BVH collision meshes; `checkGroupCollision(group)` is the overlap test.
- **Messages**: `onMateFeedback(message, isError)` → App `setActionFeedback`.
- **Mate arrows** hide the gizmo while they are shown (`hideMateArrows` / `showMateArrows`).
- No undo; no test runner. `scripts/check-pin-hole-alignment.mjs` is the Node check for the pure module.

## Goals / Non-Goals

**Goals:**
- One ring gizmo used for every way into Rotate mode.
- Joint finding as a pure function in `pinHoleAlignment.js`, checked from Node like the highlight rules.
- Commit path identical to a drag release, so saving, server sync, last-valid pose and highlights behave the same.

**Non-Goals:**
- Stopping a turn at contact (no flush search for rotation).
- Moving other parts along with the turned part (a pin left in a turned beam stays where it was; it stays on axis because the turn is around that axis).
- Turning a part held in several places.
- Gear meshing or any other kind of joint besides pin/shaft-in-opening.
- Local-axis rings for free parts.

## Decisions

### 1. Finding joints: `findEngagedJoints(selectedFeatures, otherFeatures)`
New export in `pinHoleAlignment.js`, next to `findAlignedOpenings`, using the same insert/opening pairing (`OPENINGS_BY_INSERT`) and the same 2° / 0.25 mm axis test. A pair is engaged when the axial overlap of the insert's span and the opening's span is > `OUTSIDE_OVERLAP_ALLOWANCE_MM` (0.05 mm), which is exactly the case `facesIfAlignedAndOutside` rejects, so a pair is never both highlighted and engaged. Pin end freeness is not checked: a buried pin span can only overlap a hole if the parts already overlap.

Returns `{ lines: [{ origin, axis, pairs }] }`: pairs whose axes are parallel within 2° and whose lines are within 0.25 mm of each other are merged into one line (origin and axis from the first pair; axis sign fixed so it points the same way for all pairs). The viewport only needs `lines.length` and the first line.

Factor the shared axis test (parallel + line distance) and the span projection out of `facesIfAlignedAndOutside` into a small helper used by both, so the tolerances can't drift apart.

*Alternative considered:* storing joints when a mate completes. Rejected: parts can be placed into holes by dragging, by the assistant, or by loading a file, and all of those must count. Computing from geometry covers them all.

### 2. Custom ring gizmo instead of `TransformControls` rotate
New `createRotateGizmo(scene)` in `Viewport3D.jsx`, built like `createMateArrowOverlay`: a group in gizmo units, rescaled each frame by the same screen-size factor, `depthTest: false`, render order above the hole rings and arrows. Per ring:
- a flat annulus (`RingGeometry`, inner 0.85, outer 1.0 gizmo units) in the ring's plane, semi-transparent, colored X red / Y green / Z blue as the stock gizmo; a held part's single ring uses the orange accent;
- a thicker invisible picking torus;
- tick marks at each snap angle (none when Free);
- a pie slice (`CircleGeometry` with `thetaStart` / `thetaLength`) shown only while dragging;
- states: normal, hover, selected (brighter and thicker), dragging.

`TransformControls` stays for Move only: in Rotate mode it is detached, and the ring gizmo is attached instead. `setMode('rotate')` and `setRotationSnap` are no longer used.

*Alternative considered:* patching the stock gizmo (as `enhanceTranslatePlaneHandles` does for planes). Rejected: it can't hide axes, can't move its pivot off the object origin, has no angle labels, and owns the wheel and pointer in ways we'd fight.

### 3. Pivot and axes
At the start of each rotate session (mode entered, selection changed, or after each commit) compute the setup:
- `findEngagedJoints(selected world features, otherFeaturesRef)` → 0, 1 or more lines.
- 0 lines: pivot = `localBox` center transformed by the group's `matrixWorld` (this point is fixed under any turn about itself); axes = world X, Y, Z.
- 1 line: axis = the line's axis; pivot = the point on the line closest to the part's center.
- More: no rings; message.

Turning by angle θ around unit axis `a` through pivot `p`: with `q = Quaternion.setFromAxisAngle(a, θ)` applied to the pose at the start of the gesture, `position = p + q·(position₀ − p)`, `quaternion = q · quaternion₀`. Apply from the start pose each time (not incrementally) so snapping doesn't build up error. Since the turn is around the joint line, every held pin/shaft stays on it.

### 4. Ring angles
Each ring keeps `angleDeg`, the total turned around it this session (starting at 0). During a drag:
- project the pointer onto the ring's plane (ray–plane intersection through the pivot), measure the signed angle from the press point around the axis, add it to the angle at press;
- snap the ring's total (`Math.round(total / step) * step`) when snap is on;
- set the pose from the gesture start pose turned by `snapped − angleAtPress`.

The label value is the ring's total wrapped to (−180, 180]. Typing a value `v` turns by `v − angleDeg`. Each turn applies to the current pose, so turning X then Z composes in that order (spec: "Any orientation").

### 5. Angle labels and typing
HTML elements in a `div` overlay over the canvas (absolutely positioned inside `.viewport-canvas`'s parent), one per ring, placed each frame by projecting a point just outside the ring (at the ring's top on screen). Each label is a button showing e.g. `Z 30°`; clicking turns it into an `<input type="number" step="any">`. Enter applies, Esc / blur cancels. App's `window` keydown handler already ignores keys while an `INPUT` is focused, so `E`/`W`/Delete won't fire while typing. Labels are hidden when the rings are hidden.

*Alternative considered:* `CSS2DRenderer`. It does the same projection but adds a second renderer to resize and dispose; a few elements placed by hand is simpler.

### 6. Pointer, right-click and wheel
- `contextmenu` on the canvas: always `preventDefault()`.
- Right button: record the press point in `pointerdown`; in `pointerup` with `button === 2`, if moved < 5 px and `pickPartsAt(e)` includes the selected id, call a new `onToggleRotateRequest` prop. App decides: locked → message, Explode on → message, otherwise toggles `transformMode`. OrbitControls' pan on right-drag is left as is (a click without movement doesn't pan).
- Left `pointerdown` on a ring: raycast the picking tori before anything else; start a drag, set `orbit.enabled = false`, and mark it so `handlePointerUp` doesn't change the selection. Release with < 5 px of movement → toggle the ring's selected state instead of turning. Left click anywhere off a ring unselects it (and selects/deselects parts as usual).
- Wheel: `wheel` listener on the canvas with `{ passive: false }`, registered before OrbitControls'. When a ring is selected: `preventDefault()` + `stopImmediatePropagation()` so OrbitControls doesn't zoom; accumulate `deltaY` and turn one step per 100 units (one mouse notch; trackpads give smaller deltas and add up). Set `orbit.enableZoom = false` while a ring is selected as a second guard. Commit 300 ms after the last wheel event.
- Esc: the existing capture-phase key handler unselects a selected ring first (and stops the event), like it dismisses mate arrows; otherwise App's handler runs as today.
- `handleDoubleClick` also returns early when the pointer is on a ring (spec: double-click on a ring handle doesn't mate).

### 7. Committing a turn
One `commitRotation()` used by drag release, typed angle, and the wheel pause: run `checkGroupCollision`, recolor with `applyGroupAppearance`, call `onUpdateTransformRef.current(id, { position, rotation, isIntersecting })` with the same rounding as the drag release, then recompute highlights. Rotation is read as Euler XYZ from the group (the group's `rotation` stays in sync with its quaternion). During a drag the collision check and recolor run on each pointer move as `objectChange` does today. After the commit, the instance sync effect rebuilds `otherFeaturesRef`, then the rotate setup (§3) is recomputed, which resets the ring angles only if the joint lines changed; otherwise the totals are kept so the labels keep counting during a session.

### 8. Refusals and messages
- Locked or Explode: checked in App on right-click; for `E` / toolbar the viewport shows no rings for a locked part (as `TransformControls` is not attached today) and sends "Part is locked" once per selection.
- Several joint lines: the viewport sends "Can't rotate: held by pins or shafts on more than one axis" when the setup finds > 1 line, once per selection.
- Mate arrows: `showMateArrows` hides the rotate gizmo too; `hideMateArrows` shows it again if Rotate mode is on.

## Risks / Trade-offs

- [Rounding Euler angles to 2 decimals drifts a joint off its axis after many turns] → Turning is around the joint line, so the drift is at most a few hundredths of a mm per save, well inside the 0.25 mm joint tolerance; the next session re-reads the line from the parts.
- [A part sitting in a hole by accident (not mated) counts as held and gets one ring] → That is the behavior the spec asks for; the message names the reason when more than one axis holds it.
- [Loose pins left in a beam make it "held in several places"] → Accepted for now (spec); listed as future work in the proposal.
- [Wheel handling fighting OrbitControls] → Listener registered before OrbitControls' and `enableZoom` turned off while a ring is selected.
- [Labels covering the part on small parts] → Labels sit just outside each ring, and rings are sized in screen units, so they stay clear of the part.
- [Right-click on a touchpad (two-finger click) may move a few pixels] → Same 5 px threshold as left clicks.

## Migration Plan

No data migration: `transformMode: 'rotate'` in saved states and from the assistant now opens the ring gizmo. Rollback is reverting the change; saved assemblies stay valid.
