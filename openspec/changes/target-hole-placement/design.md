## Context

The viewport already has most of the pieces (see proposal.md for why this is wanted):

- **Hole picking / placing** (`buildPickSession`, `startPlace`, `updatePickHover`, `renderPick`, the click handler that calls `mateSelected` in `src/components/Viewport3D.jsx`): a session holds `candidates` (hole faces or axle ends), the `hovered` one, its `fits` and `fitIndex`; the wheel / `R` step fits; a click poses the part at the fit and pushes it in with `mateSelected`. A library drag runs this as a `place` session whose part follows the pointer, merged with the add into one history step through `placeRequest.mergeKey`.
- **Fit lists** in `src/utils/pinHoleAlignment.js`: `listInsertFits` (pins, pegs, shafts into a hole face, with rolls, parallel holes, square flats), `listBoreFits` and `boreTargets` (bore parts onto axle ends and hole faces), `insertPose`, `openFaces`, `isOpeningTaken`, `freeSetLeadEnds` (insert ends sticking out of the parts they sit in).
- **Seated pose for a fit without committing it:** `computeCopyPose` poses the group at a fit, checks the way in, pushes it to contact with `sweepToContact`, and puts it back.
- **Alt** is tracked in `altKeyRef` (drags without snapping; gizmo in world space while held). Plain Alt+click is unused; Shift+Alt+click selects one part of a group.
- **Rings** are drawn by `createPickOverlay` (`showRings`, `showGhost`, `showMarkers`).

## Goals / Non-Goals

**Goals:**
- Reuse the placing session, fit lists and push-in for the new flow, so pins seat exactly as in hole picking.
- Keep fit listing fast enough that a library click shows the part without a visible pause on a big build.

**Non-Goals:**
- Changing hole picking, copy-insert, library drag or the mate arrows.
- A general "any hole of a beam" search; corner holes only (see specs).

## Decisions

### 1. Target state lives in the viewport, keyed by feature
`targetRef = { instanceId, featureId, kind: 'face' | 'end', faceSide | end }`. It is turned into a world face/end from the part's current matrix each time it is drawn or used, so it follows the part for free. It is checked on every instances change: if the part is gone or hidden, or the hole is now taken, it is cleared. App only needs to know whether a target is set (for `handleLibraryAdd`), passed up through an `onTargetChange` callback.
Alternative: storing a world position. Rejected: it would go stale when the part moves.

### 2. Alt hover uses its own candidate list, built on Alt press
On Alt keydown (when no drag, pick, mate arrows, explode or box select is active), `rebuildOtherFeatures()` and collect every open hole face (`openFaces`) plus every free insert end (`freeSetLeadEnds` over all visible parts' world features). Hover reuses the projection and nearest-to-camera logic of `updatePickHover`, factored into a shared `nearestScreenTarget(candidates, x, y)`. The list is dropped on Alt keyup.
Alternative: a list per part type, like the copy preview. Rejected: the target doesn't depend on a selected part.

### 3. Alt+click is handled before selection
In the pointer-up click path, `e.altKey && !e.shiftKey` with a lit target sets/moves/clears the target and returns before any select logic, so Alt+click never changes the selection. A click with no lit target falls through as today (it's a plain click).

### 4. Placing at the target is a `place` session with a fixed hover
`handleLibraryAdd` with a target set adds the part with a `placeRequest` carrying `atTarget: true` (same `mergeKey` scheme, so add + finalise is one step and `Esc` removes it). `startPlace` builds the session as now, then sets `pick.hovered` to the target and `pick.fixed = true`: `updatePickHover` and `followPointer` return early when `fixed`, so the part stays at the fit. The click handler finalises on any click (not just a lit hole) when `fixed`. Starting from the library orientation keeps the "smallest turn" ordering stable.

### 5. One fit lister that picks the rule by part and target
New `listTargetFits({ partMeta, measured, target, receivingQuaternion, otherFeatures, currentQuaternion, meshNeighbours })` in `pinHoleAlignment.js`:
- target face + inserts that fit → `listInsertFits`;
- target face + bore part → `listBoreFits` with the face as target;
- target end + part openings the insert fits, or target face + part holes with no plug fit → new `listHoleFits`: for each eligible hole of the part (corner holes, decision 6) and each of its two faces, pose the part with that hole coaxial with the target, facing it (on a pin end: the hole's face toward the pin's end, just past it; on a hole face: the part's face flat on the target face, just outside it), at the four 90° rolls about the axis relative to the receiving part, or the flats rolls for a square shaft. Each fit gets `direction`, `travelMm`, `sweepMm` like an insert fit, so the existing push-in works: onto a pin it slides along the pin until contact; on a face it is already flush (travel 0).
All return the existing fit shape, so `renderPick`, markers and stepping don't change.

### 6. Corner holes by rectangle in the part's own axes
`cornerHoles(features)`: group the part's hole features by axis direction (parallel within 2°); for a group with more than four, project centres onto the two part axes across the hole axis and keep holes within 0.25 mm of min/max on both. A single row gives its two ends. Done on local features, once per part type (cached by part id).

### 7. Overlap filter at the seated pose, computed once per library click
For each fit, run `computeCopyPose` on the placed group (it is already in the scene), then `checkGroupCollision(group, false, null, null, true)` at the seated pose (tight fits allowed), and keep the fit with its seated pose. Restore the group afterwards. Then dedupe by seated pose (position 0.05 mm, angle 0.5°) and sort. The pair-answer cache (edit-responsiveness) doesn't help here since every pose is new, so the list is capped: at most 48 candidate fits are seated, best-ordered first; the banner counts what's left after the filter.
Alternative: filter lazily while stepping. Rejected: the banner couldn't say "Fit 2 of N", and the first fit shown could overlap.

### 8. Finalising
The click calls the existing insert path with the fit's seated pose already known: pose at the fit and `mateSelected` as today (same label "Add <part> into <receiving>", same `stepMeta` merge). Then clear the target. No-fit cases never add the part: App removes it again via the existing cancel path (`onCancelPlace`), and the viewport shows the message.

## Risks / Trade-offs

- [Seating up to 48 fits on a big robot could take a moment] → Fits are ordered before seating and capped; the collision pair cache keeps neighbour tests cheap for the unchanged parts; measure on the Clawbot and lower the cap if a click takes over ~150 ms.
- [Alt on macOS types special characters in text fields] → Alt hover only runs when the viewport has focus or the pointer is over it, and keyboard focus in an input skips it.
- [Alt held also turns the gizmo to world space] → Harmless for hovering; mention in features.md.
- [Corner holes may miss the hole the builder wanted (a beam's middle hole)] → Stated as out of scope; the shown part can still be dragged after finalising.
- [A hole-to-hole fit leaves the part unpinned] → Expected: it lines up ready for pins, the same as stacking by holes.

## Open Questions

- Exact target colour (orange or magenta) — pick whichever reads best against amber selection and cyan rings when implementing.
