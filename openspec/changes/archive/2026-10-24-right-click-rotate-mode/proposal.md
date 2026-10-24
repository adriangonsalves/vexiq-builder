## Why

Turning a part today means using the stock rotate gizmo, which always spins the part around its origin on all three world axes, even when the part is held by a pin or shaft. That pulls a pinned beam off its pin instead of swinging it around the pin like the real part would. The gizmo also shows no angle, and the only way to type an angle is the Euler fields in the Inspector. Now that pins and shafts can be mated by double-click, parts are often held by exactly one pin or shaft, so rotation needs to respect that.

## What Changes

- Right-clicking the selected part (press and release without moving the mouse) switches to Rotate mode; right-clicking it again goes back to Move. Right-drag still pans the camera, and the browser menu no longer opens over the viewport.
- A new rotate gizmo replaces the stock one in Rotate mode, so the `E` key, the toolbar Rotate button and the assistant's `transformMode: 'rotate'` all use it.
- **Not held** (no pin or shaft of it is in another part's opening, and it holds no other part's pin or shaft): three flat rings, one per world axis (X, Y, Z), centered on the middle of the part. Dragging a ring turns the part around that axis through its center, so any orientation can be reached.
- **Held on one axis** (all of its pin/shaft joints share one axis line): one ring, around that axis line. Dragging it swings the part around the pin or shaft, which stays in its hole.
- **Held on two or more axis lines**: no rings; a message says the part can't be turned because it is held in more than one place.
- Each ring shows the angle turned around it, a shaded slice from the start angle while dragging, and tick marks at the snap angles. Dragging snaps to the existing Rotation Snap setting (15°, 45°, 90°, or Free).
- The angle on each ring can be clicked and typed into; pressing Enter turns the part to that angle.
- Clicking a ring selects it; while a ring is selected, the mouse wheel turns the part one snap step per notch instead of zooming the camera.
- Locked parts and Explode view refuse Rotate mode with a message, as they do for mating.
- Rotation is not blocked by other parts: an overlap is shown and saved as overlapping, as with the current rotate gizmo.
- Out of scope (future): turning a part held in several places around one of its joints when nothing else stops it.

## Capabilities

### New Capabilities
- `rotate-mode`: entering and leaving Rotate mode (right-click, `E`, toolbar), how the turning axis is chosen from the part's pin/shaft joints, the ring gizmo, angle display and typed angles, snapping, wheel turning, and how the result is saved.

### Modified Capabilities
<!-- None: the pin-mating rule that double-clicking a gizmo ring does not mate already covers the new rings. -->

## Impact

- `src/components/Viewport3D.jsx`: new ring gizmo and angle labels (replacing `TransformControls` rotate mode), right-click and wheel handling, OrbitControls zoom paused while a ring is selected, commit through `onUpdateTransform` like a drag.
- `src/utils/pinHoleAlignment.js`: new pure helper that finds the selected part's engaged (inserted) pin/shaft joints and groups them by axis line.
- `src/App.jsx`: right-click toggling of `transformMode`, messages through `actionFeedback`, and refusing Rotate mode for locked parts.
- `src/styles.css`: angle label and input styles.
- `scripts/check-pin-hole-alignment.mjs`: checks for the joint-finding helper.
- `features.md`: describe the new Rotate mode.
- No new dependencies. Saved assembly format is unchanged (rotation stays Euler XYZ degrees).
