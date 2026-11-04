## Context

See proposal.md for why. The current state (after outliner-part-groups):

- **Set drag.** When more than one part is selected, `Viewport3D.jsx` attaches TransformControls to a pivot `Object3D` at the set's bounding-box centre. `objectChange` rounds the pivot to whole steps from the drag start, moves every member by the same delta, and checks overlaps with outside parts every 150 ms; `dragging-changed` (end) calls `commitSetPoses(ids, 'move')`. No hole snap, flush stop or settle runs for sets.
- **Single-part drag** already has everything this change needs, written for one part: `snapDragToHoles` (collects the part's world features, calls `findHoleSnap` in `src/utils/pinHoleAlignment.js` against `otherFeaturesRef`), `settleAlongLine` (nearest clear spot along a line via `clearSpotAlongLine`), Alt to skip snapping, and the aligned-hole highlights.
- **`findHoleSnap(selectedFeatures, candidates, directions)`** takes any feature list, picks the smallest move along the dragged directions, and prefers moves several pairs agree on (`HOLE_SNAP_AGREE_MM`). It doesn't care which part a feature belongs to.
- **`otherFeaturesRef`** is rebuilt at drag start from every visible part except `selectedIdRef.current`. With a set, `selectedId` is null, so today it includes the set's own members.
- **Set turns** pivot on the set's bounding-box centre (`setPivot`) in the app (`refreshSetRotateSetup`, Inspector quick turns) and on the server (`update_group`). Single parts use `gridPivot(features, center)` from `pinHoleAlignment.js`, which finds a point on the part's own hole grid.
- **Typed centre** (`handleMoveSetCentreTo` in `App.jsx`) and `update_group moveCentreTo` move by the exact difference, which is how the Claw left its grid.
- **Fix assembly** (`src/engine/fixAssembly.js`, engine action `fix_assembly`) chooses the moving block itself and returns a saved step; it runs in the worker / bridge via `backend.runAction`.
- **Turn put-back** (outliner-part-groups, rotate-mode): `commitRotation` already restores a set's start poses when a turn ends in a new overlap. The drag put-back follows the same pattern.

## Goals / Non-Goals

**Goals:**
- Reuse the single-part snap and settle code with a set's combined features, rather than a second snap implementation.
- One rule for the grid in the app and on the server, from shared pure helpers.
- Keep set drags responsive for 45+ part groups: per-frame work grows with the set's free outer features near outside parts, not with its part count.
- Reuse Fix assembly's fitting code for the release fit, not a second fitting method.

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

### 3. Hole pull for a set drag: one combined feature list, short reach
At drag start (set pivot attached), build `setDragRef.features`: `freeSetFeatures` of every member's world features at the start pose, plus `otherFeaturesRef` rebuilt to exclude all set members (generalise `rebuildOtherFeatures` to take an exclude set). In `objectChange`, after the whole-step rounding, translate the start features by the current delta (a set drag only translates, so no recollection per frame) and call `findHoleSnap(movedFeatures, candidates, directions, { axialReachMm: SET_HOLE_SNAP_AXIAL_REACH_MM, rejectMove })` with the dragged axes, filtering candidates by the set's box grown by the same 25.4 mm. Apply `snap.offset` to the pivot delta, keeping axes along the hole line on the drag grid, exactly as `snapDragToHoles` does. Remember the snap line for release. Alt skips it (`altKeyRef`).
- **Reach:** new `SET_HOLE_SNAP_AXIAL_REACH_MM = 25.4` in `pinHoleAlignment.js`. `findHoleSnap` already takes `axialReachMm`; the sideways `radiusMm` stays 3.5 mm. A short reach is the user's sign of meaning to mate, and the smaller reach box drops most candidates before any pair is formed (single parts keep 152.4 mm).
- **Free outer features:** new pure `freeSetFeatures(features)` in `pinHoleAlignment.js`, using `findSeatedPairs` among the set's own features (different members only): an opening in a seated pair is dropped; an insert is dropped when it sticks out less than 1.5 mm (`FREE_INSERT_MIN_MM`) past the outermost of the set openings it is seated in, at both ends (a pin flush with a beam sticks out ~0.6 mm past the hole's measured faces; gaps between stacked parts' hole spans don't count). Run once at drag start. Without it a set's filled holes and buried pins can pull onto outside holes on the same line, and the pair count grows with every pin in the set.
- **No pulling back to the start:** `findHoleSnap` gets an optional `rejectMove(offset)`; candidates whose move is rejected are skipped and the next best is used. The set drag rejects a move whose resulting delta from the drag start is under 0.25 mm while `setDragRef.leftStart` is false; `leftStart` turns true the first time the delta exceeds 3.5 mm (`HOLE_SNAP_RADIUS_MM`) and stays true for the drag. Rejecting by result, not by "the holes it started in", still lets the next pin drop into a hole the first one just left.
  - Alternative: ignore the outside features the set was seated on at drag start. Rejected: blocks real moves along a hole row, and needs the seated pairs worked out across the whole set.
  - Alternative: a 25.4 mm leave distance. Rejected: a set pulled straight off its pins would need an inch of travel before it could be pushed back on.
- Highlights: `updateAlignedHoleHighlights` currently looks at the selected part; for a set, feed it the moved set features (a small branch, throttled with the overlap check).
- Alternative: run `snapDragToHoles` per member and take the best. Rejected: N calls per frame and no cross-member agreement.

### 4. Release: settle along the line, fit, else put back
At drag end, with the members at their dropped poses, in order:
1. **Settle:** if a snap line was used and an edge member (§7) overlaps an outside part, search `clearSpotAlongLine` moving all members together (a set-level `isClearAt(t)` that offsets every member and checks only edge members against outside parts, broad phase by box first), within the single-part reach (`max(0.25P, step / 2)`).
2. **Fit** (§4a), unless Alt is held or `leftStart` is false.
3. **Put back:** if an edge member at the final pose overlaps an outside part it didn't overlap at drag start (`setDragRef.startOverlap`, a set of `memberId|otherId`, computed at drag start): restore start poses (undoing the straightening turn and the fit), re-mark overlaps, show the message, no `onUpdateSet`. Otherwise commit the final poses as one step (`commitSetPoses(ids, 'move')`, with the fit's label text when a fit was made).
- Cost: `clearSpotAlongLine` probes ~10–20 positions; each probe checks only edge members, so for a claw against a plate it's a handful of BVH tests per probe.

### 4a. Release fit: Fix assembly's core, on a given set
`fixAssembly(state, { instanceId })` chooses its own moving block (the smaller joined block near one part) and returns a saved step, so it can't be called as is. Split it in `src/engine/fixAssembly.js`:
- `fitBlock(state, { movingIds, fixedIds, region })` — steps 3–5 of today's function (pairs with `nearPairs`, `solveLines` with outlier dropping, `squareUp`, the 25° / 10 mm limit, seating with `CLEAR_REACH_MM` / `SEAT_*`). Returns `{ ok, poses: Map<id, {position, rotation}>, pairs, partnerLabel }` or `{ ok: false, reason: 'none' | 'done' | 'too-far' | 'disagree' }`. Doesn't touch history.
- `fixAssembly` keeps choosing the blocks (including its group refusal) and calls `fitBlock`, then builds the step as now. `scripts/check-fix-assembly.mjs` must pass unchanged.
- New engine action `fit_set` in `src/engine/actions.js`: params `{ ids, poses }` (the set's dropped poses, since they aren't saved yet). It applies `poses` to a copy of the state, uses `ids` as moving, every visible part outside them whose box meets the set's box grown by `REGION_MM` (20 mm) as fixed, and returns `fitBlock`'s result. No save.
- The app (`Viewport3D` release, via the `backend.runAction` path `App.jsx` already uses) awaits `fit_set`, poses the members at the returned poses, then runs step 3. While it waits the set stays at its dropped pose, the gizmo is hidden and pointer input on the viewport is ignored; a failed or unavailable call counts as "no fit". The group refusal in Fix assembly does not apply: the set is the user's chosen moving block, even when it splits a group.
- Pairs with the start pose: the fit is skipped when `leftStart` is false, so a small nudge is not fitted back where it was. Once the set has left, fitting back onto the start holes is allowed (the user brought it back).
- Alternative: run the fit synchronously in the viewport. Rejected: the engine (`getCatalog`, `jointGraph`, `worldFeaturesFor`) lives in the worker / bridge, and the dev server and static site already share the action path.
- Alternative: show the fit as a suggestion the user accepts. Rejected: the user chose automatic.

### 5. Server parity
`update_group` uses `stepDelta` for `moveCentreTo` and `setGridPivot` for `turn`; `moveBy` stays exact (an explicit distance). The reply's `centre` is the one reached. No hole pull on the server (an assistant uses `place_parts` inserts to seat parts).

### 6. Straightening small tilts
New pure helper `findStraighten(movingFeatures, candidates, { maxDeg = 5, minDeg = 0.1 })` in `pinHoleAlignment.js`: for each fitting pair in reach (same pairing and reach tests as `findHoleSnap`, but parallel within 5°), the turn that makes the moving axis parallel to the other (axis = cross of the two directions, sign-corrected for opposite-facing pairs) and its pivot (the moving feature's point). Pairs whose turns agree within 0.5° (axis and angle) are grouped; the largest group wins, ties to the smallest sideways pull. Returns `{ quaternion, pivot }` or null.
- Single-part drag (`objectChange`, before `snapDragToHoles`): if not Alt, compute from the features at the drag's start rotation; set `obj.quaternion = turn × startQuat` and turn the position about the pivot, then run the existing snap. The turn is recomputed from the start pose every frame, so it never accumulates; moving away from the pair returns the part to its start rotation.
- Set drag: same, with the combined set features; the turn is applied to every member's start pose about the pivot, and the set features are turned with it before `findHoleSnap`.
- `findHoleSnap`'s 2° parallel test stays as is: after straightening the pair is parallel to within rounding.
- Alternative: widen `findHoleSnap` to 5° without turning. Rejected: it would pull tilted parts onto lines they can't seat on.

### 7. Edge members: overlap tests only where an overlap can happen
`setDragRef.edge` = the members whose world box (grown by a small margin; by the slide's reach for the release slide) meets the box of a visible outside part. Outside boxes are cached at drag start (outside parts don't move). It is worked out again each time it is used: at drag start (`startOverlap`), at every throttled overlap check, for the release slide, and at the final pose before the put-back test. It costs only box tests, and since `checkGroupCollision` only reaches the mesh test for parts whose boxes meet, testing only `edge` gives the same answer as testing every member. Members not in `edge` keep their overlap flag cleared. (Planned first as "recompute after moving 25.4 mm"; working it out at each use is simpler and exact, including after a straightening turn.)
- Why it matters: a 45-part claw against a plate has a few edge members; testing all 45 against their box neighbours every probe made set checks the slowest step.
- Live contact stop stays out (non-goal): contact is only resolved on release, by the settle and the fit.

### 8. Moving part of a group
Nothing in the set drag reads `groupId`: the set is the selection. When the selection is some members of a group (made in the Outliner), the other members are outside parts like any other (in `otherFeaturesRef`, in the edge test, in `startOverlap`, as fixed parts for `fit_set`), and `commitSetPoses` patches only position and rotation, so `groupId` / `groupName` stay. The only code change is making sure the set drag's exclude set is the selected ids, not `expandToGroups` of them.

### 9. Double-click mates a set
`handleDoubleClick` no longer stops at "Mating works on one part" for a set (Ctrl/Cmd still does, for copy-insert). With the set selected, `handleMateRequest` takes a set branch:
- **Lined up:** the pairs are `findAlignedOpenings(freeSetFeatures at the current pose, outside candidates)` filtered to 25.4 mm along the line (the same list `showSetHighlights` makes while dragging; worked out fresh on double-click, since the set may not have been dragged). `planMates(aligned, ids)` is generalised to take a set of ids (today `selectedId`): a pair's insert counts as "ours" when its instance is in the set. One plan → push; several → `showMateArrows` with the set's pivot as the arrow base; an arrow click pushes.
- **Push (`mateSet(plan)`):** like `mateSelected`, but every member moves by the same offset: shift sideways onto the line (≤ 0.25 mm), then step along the direction up to `sweepMm` in `SEAT_STEP`-sized steps testing the edge members (§7) for new overlap pairs, bisect to contact, and stop where the touching faces are flush (the same quarter-pitch back-off `fitBlock` uses, reused from `fixAssembly.js` as a small exported helper, or the app's `findFlushBoundaryPosition` run over the set). Then the release fit (`fitSetNow`, shared with §4 step 2: `fit_set`, poses applied, input waiting) unless Alt is held, then the members are put at their poses as saved (`roundSetPoses`: 0.001 mm, 0.01°) so the put-back test (§4 step 3) sees the saved poses, then one step "Mate <set> onto <part>[. Lined up N pins and holes with <part>]" via `commitSetPoses` with a label. (Added after trying it: a push alone could leave a set pressed slightly in, which Fix assembly then fixed.)
- **Nothing lined up:** start the set pick session (§10); no free inserts or no ringed faces → the message.

### 10. Hole picking for a set: facing pins only, up to 30°
A set pick session (`buildSetPickSession`, kind 'set-pick') replaces the single-part one when a set is selected:
- **Leading ends:** `freeSetLeadEnds(features, { isCapped })` returns, for each free pin, peg or shaft, the ends that stick out of the set (an end whose tip is past every set opening it is seated in by ≥ `FREE_INSERT_MIN_MM`; both ends for a loose one; for a pin feature also its own `freeAtStart`/`freeAtEnd`). Each leading end is `{ feature, point (tip), dir (unit, pointing out of the set) }`.
- **Ringed faces:** of the outside openings that fit some leading end's kind, each face (`openFaces`) whose `-outward` is within 30° of some leading end's `dir`. Only these get rings; with none, the message and no session.
- **Fits at a hovered face (`listSetInsertFits` in `pinHoleAlignment.js`, pure):** for each leading end within 30°: `q = setFromUnitVectors(dir, -outward)` (the smallest turn, so no turn about the hole's line); for a square shaft into a square hole, then the `squareFitRoll` turn about the hole line. Pose = turn about the tip, then move the tip to `face + outward · PICK_GAP_MM`. Score: turn every other leading end with the fit and count those on a matching outside hole's line (parallel within 2°, line within 0.25 mm, within 25.4 mm along) → green markers; the rest red. Sort: green count desc, turn angle asc, move length asc. Cost is per hover change only: (leading ends within 30°) × (leading ends) × (outside openings near the set's box at the fit), with candidates pruned by box like the drag.
- **Preview:** one see-through copy of every member's meshes, built once per session in the set's frame (an extension of `setGhostSource` that takes several groups and a frame), shown at the fit pose by moving and turning that one object; markers as today.
- **Click:** pose the set at the fit (just outside the face), check edge members for overlap ("The way in is blocked" if any new pair), then `mateSet` along `-outward`, then put-back test, one step "Insert <set> into <part>". R / Shift+R / wheel step `fitIndex`; Esc / empty click ends the session.
- Single-part picking is unchanged (any pin, both ends, quarter turns, pattern turns).
- Alternative: single-part rules for sets. Rejected: ~100 fits per hole for a 12-pin set, each a turned 45-part preview; most fits turn the set onto its side, which no one wants from a hover.
- Alternative: 5° (the drag's straightening limit). Rejected by the user: 30° lets a roughly aimed group be picked without first squaring it with the rings; more than that is a different way round, not a small correction.

## Risks / Trade-offs

- [Per-frame snap cost on big sets: 45 parts can carry several hundred features] → Features are collected once at drag start and only translated; `findHoleSnap` caps pairs (`HOLE_SNAP_MAX_PAIRS`); candidates filtered by the set's reach box.
- [A set snaps onto the wrong plate when two are equally near] → Same as single parts: nearest pair, agreement wins; Alt to drag freely; undo.
- [Rounding a typed centre surprises a user who wanted an exact value] → The field shows the reached value; Free snap gives exact moves.
- [Put-back hides a drop the user wanted, e.g. deliberately overlapping a tire on a hub] → Overlap rules already exclude tire-on-hub; sets that overlap at drag start aren't put back, so a user can still drag a set out of an overlap.
- [A part angled on purpose within 5° of a hole line gets straightened while dragged near it] → Only within pull distance of a matching pair; Alt drags freely; the 5° limit leaves deliberate angles beyond it alone.
- [Turn pivot moves compared with today (box centre → grid point)] → Visible only as a slightly different ring centre; the turn result is what was asked for.
- [The release fit waits on the engine; on the dev server that is a bridge round trip] → Usually tens of ms; the set stays visibly at its dropped pose with input ignored meanwhile; a failed call counts as no fit.
- [The fit grabs a nearby part the user didn't mean] → Only pairs within 4 mm along the line and 4.5 mm off it count, the moves are capped at 25° / 10 mm, Alt at release skips it, and undo takes the whole step back.
- [A set user who wants it 1 inch+ above holes before pushing on doesn't get pulled] → Intended: the short reach is the sign of intent; dragging closer pulls as usual.
- [A 30° turn of a big set swings its far end a long way and can hit something] → The way-in check tests the turned pose before the push; "The way in is blocked" and nothing moves.
- [No ring where the user expected one, because the set's pins face another way] → The message says to turn the group so its pins face the part; the rotate rings do that in one turn.
- [`freeSetFeatures` drops a through hole with a pin only half in from one side] → VEX pins fill the holes they're in; such a hole can't take another pin from the far side in practice.

## Migration Plan

No saved-format change. Builds already off-grid (like the current Claw) stay where they are until moved: the first snap onto holes fixes them. Rollback restores today's behaviour.
