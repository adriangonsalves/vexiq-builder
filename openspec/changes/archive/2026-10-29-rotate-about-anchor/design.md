## Context

Rotate mode lives in `src/components/Viewport3D.jsx`:

- `createRotateGizmo()` builds up to three rings around one point (`group.position`), with hover, selected and dragging looks, picking (`pick(raycaster)`), and `frame(index)`.
- `refreshRotateSetup()` decides the rings for one part. It calls `findEngagedJoints(selectedFeatures, candidates)` (`src/utils/pinHoleAlignment.js`), which returns `lines: [{ origin, axis }]`, one per axis line that holds the part. With one line it shows a single Joint ring on that line; otherwise X/Y/Z rings about `gridPivot(...)`, kept between turns as `localPivot` in the part's frame. It keeps the ring angles only while the rings and pivot stay the same (`prev.pivot.distanceTo(pivot) < 0.5`).
- `rotateSetupRef.current = { instanceId, pivot, localPivot, rings, angles }`; `turnSelectedTo` turns about `setup.rings[ring].axis` through `setup.pivot`.
- Ring presses go through `handleRingPointerDown` / `handleRingPointerUp`; a press without movement toggles `selectRing(index)`. A click elsewhere unselects the ring (around line 3939).
- Sets (groups, multi-selections) go through `refreshSetRotateSetup` and have no joint lines.

See proposal.md for why; the requirements are in `specs/rotate-mode/spec.md`.

## Goals / Non-Goals

**Goals:**
- One turning-axis line for the chosen ring, for single parts and sets.
- For a single part held on 2+ lines: clickable anchor lines parallel to the selected ring, and a dashed default-centre line once moved.
- The chosen anchor survives turns, saves and put-backs, and is cleared on selection change or re-entering Rotate mode.

**Non-Goals:**
- Anchors for groups or multi-selections (joints between the set and outside parts).
- Rings for directions other than world X/Y/Z or the single joint line (e.g. a ring for a tilted anchor that isn't parallel to any world axis).
- Any change to MCP tools, saved state or history steps. `update_part` and friends don't see the gizmo.

## Decisions

**Draw the lines inside the gizmo group.** Add to `createRotateGizmo` one turning-axis line and a small pool of anchor lines plus one dashed line, all fat lines (`Line2` / `LineMaterial` from three's examples, 3 px, 2 px dashed, `depthTest: false`, render order above the rings). Plain 1 px `THREE.Line`s were tried first and were too faint to tell from the grid's axis lines; `LineMaterial` needs the view size, which `updateScale(camera, width, height)` passes from the input layer (the working half in Stereo). They live in world space, not under `group`'s scale, so their length is in mm: half-length = half the bounding-box diagonal + 10 mm, centred on the point of the line nearest the part's centre. New gizmo methods: `setAxisLine({ origin, axis, color } | null)`, `setAnchorLines([{ origin, axis }], dashed | null)`, `pickAnchor(pointerPx, projectFn)`. Being part of the scene, they are drawn in both stereo pictures for free.
*Alternative:* a separate overlay object like the hole highlights. Rejected: the gizmo already owns show/hide and stereo handling, and the lines must hide with it.

**Pick anchor lines on screen, not by raycasting.** Lines are 1 px wide, so raycasting with a line threshold depends on zoom. Project each line's two ends with `projectToCanvas` and take the nearest within 6 px of the pointer. Check anchors in `handleRingPointerDown` before `rotateGizmo.pick`, so an anchor in front of a ring wins. A press on an anchor records `{ kind: 'anchor', index, pressX, pressY }`; on release under 5 px it applies, otherwise it was a camera orbit and nothing happens. Mark the click handled (`ringClickHandled`) so the part under the pointer isn't selected and the ring isn't unselected.

**Which line the ring turns about.** `refreshRotateSetup` keeps `lines` on the setup. Anchors for ring `i` = lines with `|line.axis · ring.axis| > cos 2°`, minus the one the pivot currently sits on (distance from pivot to the line < 0.25 mm). Put the filter in `pinHoleAlignment.js` as `parallelLines(lines, axis, { exclude: point })` so `scripts/check-pin-hole-alignment.mjs` can test it without a browser.

**Store the chosen anchor in the part's frame.** On click, the new pivot = `origin + axis * ((center − origin) · axis)`; set `setup.localPivot` to it in the part's frame and set `setup.anchorKey = instanceId` plus `setup.anchored = true`. Each refresh, any X/Y/Z ring that has a joint line running its way through the pivot turns about that line's exact direction (sign matched to the world axis), so a joint up to 2° off a world axis still turns exactly about the pin; the other rings keep their world axes. This is worked out from the current joint lines rather than stored, so it stays right after turns with the other rings. The default centre is remembered separately as `localDefaultPivot`; clicking the dashed line restores it. Only the pivot (`localPivot`) and default pivot (`localDefaultPivot`) are stored.
*Alternative:* move only the selected ring. Rejected: the user asked for the gizmo to move, and one centre keeps the labels and slice drawing simple.

**Keep angles when the centre moves.** Replace the `prev.pivot.distanceTo(pivot) < 0.5` test with "same part, same ring names", so moving the centre doesn't zero the labels. The pivot itself still comes from `localPivot` each refresh. Selection change or re-entering Rotate mode already clears `rotateSetupRef`, which drops the anchor.

**Turning axis source.** `refreshLooks` already knows `dragIndex`, `selectedIndex`, `hoverIndex`; pick the first of these that is ≥ 0 and draw that ring's axis through `group.position`. That gives "drag beats selected beats hover" with no new state. Anchor lines are refreshed in `selectRing` and at the end of `refreshRotateSetup`.

**After a turn that changes the joints.** `refreshRotateSetup` runs after each save. If the part is now held on one line, it shows the Joint ring and drops `anchored`; if free, the X/Y/Z rings keep `localPivot` (so a part turned off its pins stays centred where the user put it), which matches the spec's "shown as for a free part" since the pivot is still found from the stored point. Put-back restores the pose, and the stored local pivot comes back with it.

## Risks / Trade-offs

- [Many pins on one plate along the same axis give many lines on top of the part] → lines are thin and only shown for the selected ring; no labels.
- [An anchor line seen end-on projects to a point and is hard to click] → the 6 px test still catches a point; the user can orbit. A dot marker at each line's middle could be added later if this is a problem.
- [Clicks near a ring and an anchor both] → anchor checked first, but only within 6 px, so a ring press slightly off a line still grabs the ring.
- [Turning about one pin of a two-pin part always pulls the beam off the other pin] → that's expected; the overlap check on release still puts back turns that end inside another part.
