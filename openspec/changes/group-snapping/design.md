## Context

See proposal.md for why. The current state (after outliner-part-groups):

- **Set drag.** When more than one part is selected, `Viewport3D.jsx` attaches TransformControls to a pivot `Object3D` at the set's bounding-box centre. `objectChange` rounds the pivot to whole steps from the drag start, moves every member by the same delta, and checks overlaps with outside parts every 150 ms; `dragging-changed` (end) calls `commitSetPoses(ids, 'move')`. No hole snap, flush stop or settle runs for sets.
- **Single-part drag** already has everything this change needs, written for one part: `snapDragToHoles` (collects the part's world features, calls `findHoleSnap` in `src/utils/pinHoleAlignment.js` against `otherFeaturesRef`), `settleAlongLine` (nearest clear spot along a line via `clearSpotAlongLine`), Alt to skip snapping, and the aligned-hole highlights.
- **`findHoleSnap(selectedFeatures, candidates, directions)`** takes any feature list, picks the smallest move along the dragged directions, and prefers moves several pairs agree on (`HOLE_SNAP_AGREE_MM`). It doesn't care which part a feature belongs to.
- **`otherFeaturesRef`** is rebuilt at drag start from every visible part except `selectedIdRef.current`. With a set, `selectedId` is null, so today it includes the set's own members.
- **Set turns** pivot on the set's bounding-box centre (`setPivot`) in the app (`refreshSetRotateSetup`, Inspector quick turns) and on the server (`update_group`). Single parts use `gridPivot(features, center)` from `pinHoleAlignment.js`, which finds a point on the part's own hole grid.
- **Typed centre** (`handleMoveSetCentreTo` in `App.jsx`) and `update_group moveCentreTo` move by the exact difference, which is how the Claw left its grid.
- **Turn put-back** (outliner-part-groups, rotate-mode): `commitRotation` already restores a set's start poses when a turn ends in a new overlap. The drag put-back follows the same pattern.

## Goals / Non-Goals

**Goals:**
- Reuse the single-part snap and settle code with a set's combined features, rather than a second snap implementation.
- One rule for the grid in the app and on the server, from shared pure helpers.
- Keep set drags responsive for 45+ part groups.

**Non-Goals:**
- Live flush stop (stopping at contact during the drag) for sets: replaced by settle-or-put-back on release.
- Turning a set to mesh gears or fit square shafts while dragging (`liveFitWhileDragging` stays single-part).
- Snapping during Inspector or MCP moves.

## Decisions

### 1. Grid rule: whole steps from where the set is, never an absolute grid
A set has no single grid of its own, and other plates may sit on different offsets, so snapping to "a" grid would be ambiguous. Instead every move keeps whatever offset the set already has: the delta is rounded to whole snap steps. New pure helper `stepDelta(delta, stepMm)` in `partGroups.js` (`stepMm = 0` means exact). Used by the Inspector typed centre (delta = typed − centre, rounded) and `update_group moveCentreTo` (server reads `viewport.snapPitchFactor` from the saved state). Drags and nudges already use whole steps. Lining up with a particular plate is left to the hole pull (decision 3).
- Alternative: snap to the world grid. Rejected: axles at wheel height, offset connectors and rotated sub-assemblies are deliberately off it (same reason single-part drags count steps from the start).
- Alternative: snap to "all possible grids" of nearby plates. Rejected: ambiguous with several plates, and the hole pull already finds the plate actually being approached.

### 2. Turn pivot on the set's hole grid
New helper `setGridPivot(features, centre)` = `gridPivot` over the union of the members' world features (it already picks the most common grid offset per axis and ignores features whose axes aren't on a world axis), falling back to the box centre when there are none. The app gathers features with `collectWorldFeatures` for each member; the server uses `worldFeaturesFor`. Used by the set rotate rings (`refreshSetRotateSetup`, kept in the first member's frame between turns as now), Inspector quick turns, and `update_group turn`. Because the pivot is on the grid, 90° turns map grid points to grid points.

### 3. Hole pull for a set drag: one combined feature list
At drag start (set pivot attached), build `setDragRef.features`: every member's world features at the start pose, plus `otherFeaturesRef` rebuilt to exclude all set members (generalise `rebuildOtherFeatures` to take an exclude set). In `objectChange`, after the whole-step rounding, translate the start features by the current delta (a set drag only translates, so no recollection per frame) and call `findHoleSnap(movedFeatures, candidates, directions)` with the dragged axes, filtering candidates by a reach box around the set's box. Apply `snap.offset` to the pivot delta, keeping axes along the hole line on the drag grid, exactly as `snapDragToHoles` does. Remember the snap line for release. Alt skips it (`altKeyRef`).
- Highlights: `updateAlignedHoleHighlights` currently looks at the selected part; for a set, feed it the moved set features (a small branch, throttled with the overlap check).
- Alternative: run `snapDragToHoles` per member and take the best. Rejected: N calls per frame and no cross-member agreement.

### 4. Release: settle along the line, else put back
At drag end, with the members at their dropped poses: compute overlaps with outside parts (`markSetOverlaps`). If a snap line was used and something overlaps, search `clearSpotAlongLine` moving all members together (a set-level `isClearAt(t)` that offsets every member and checks each against outside parts, broad phase by box first), within the single-part reach (`max(0.25P, step / 2)`). If clear: commit there. If still overlapping and it didn't overlap at drag start (`setDragRef.startOverlap`, computed at drag start): restore start poses, re-mark overlaps, show the message, no `onUpdateSet`. Otherwise commit as now.
- Cost: `clearSpotAlongLine` probes ~10–20 positions; each probe checks every member against outside parts. Only members whose box meets an outside part's box are checked, so for a claw against a plate it's a handful of BVH tests per probe.

### 5. Server parity
`update_group` uses `stepDelta` for `moveCentreTo` and `setGridPivot` for `turn`; `moveBy` stays exact (an explicit distance). The reply's `centre` is the one reached. No hole pull on the server (an assistant uses `place_parts` inserts to seat parts).

## Risks / Trade-offs

- [Per-frame snap cost on big sets: 45 parts can carry several hundred features] → Features are collected once at drag start and only translated; `findHoleSnap` caps pairs (`HOLE_SNAP_MAX_PAIRS`); candidates filtered by the set's reach box.
- [A set snaps onto the wrong plate when two are equally near] → Same as single parts: nearest pair, agreement wins; Alt to drag freely; undo.
- [Rounding a typed centre surprises a user who wanted an exact value] → The field shows the reached value; Free snap gives exact moves.
- [Put-back hides a drop the user wanted, e.g. deliberately overlapping a tire on a hub] → Overlap rules already exclude tire-on-hub; sets that overlap at drag start aren't put back, so a user can still drag a set out of an overlap.
- [Turn pivot moves compared with today (box centre → grid point)] → Visible only as a slightly different ring centre; the turn result is what was asked for.

## Migration Plan

No saved-format change. Builds already off-grid (like the current Claw) stay where they are until moved: the first snap onto holes fixes them. Rollback restores today's behaviour.
