## Context

See `proposal.md` for why; the rules are in `specs/pin-mating/spec.md` and the modified alignment rule in `specs/aligned-hole-highlighting/spec.md`.

Current state that shapes the approach:

- **Highlighting** (`src/utils/pinHoleAlignment.js`, `src/components/Viewport3D.jsx`):
  - `findAlignedOpenings(selectedFeatures, otherFeatures)` returns, per highlighted opening, `{ instanceId, featureId, kind, origin, axis, face, farFace, outward, radiusMm }`.
  - `outward` points from the opening toward the insert.
  - Features carry world `start`/`end` points of their usable length.
  - Opening extents use mesh-measured surfaces (`measureOpeningSurfaces`, cached per part id in `openingSurfaceCache`) once the GLB has loaded.
  - `updateAlignedHoleHighlights()` runs on every `objectChange` and after every instance sync.
- **Pin data** (`public/catalog.json` `ports[]` with `type: 'pin_peg'`):
  - Most pins are one entry covering the whole axis line through the part. The 1x Wide, 1x1 Corner Connector peg spans `z ∈ [-12.55, 5.439]`, but only `z > 0` sticks out; the rest is body.
  - The Triple 2x Wide, 2x2 Corner Connector has pegs along `+X` (`x ∈ [19.05, 24.49]`, part ends at 25.19) and along `Z` (`z ∈ [-30.84, 5.44]`, sticking out `+Z`).
  - 14 parts have pegs on two axis lines.
  - Some spans are garbage (90 Degree Standoff Connector: `500000`) and are already clamped to the bbox.
  - There is no "which end sticks out" field.
- **Collision and contact** (`Viewport3D.jsx`):
  - `checkGroupCollision(group)` tests the group's eroded (0.38 mm) BVH meshes against every other visible part.
  - `findFlushBoundaryPosition(group, clearPos, desiredPos)` bisects 10 times between a clear and a colliding position. It then prefers a clean 0.25 × pitch coordinate on the dominant axis within 0.95 mm, if that spot is clear.
  - Both are used by the gizmo drag and the Inspector nudge.
- **Saving a pose:** `onUpdateTransformRef.current(instId, { position, rotation, isIntersecting })` on drag release. `App.jsx` `handleUpdateTransform` stores it, and when it isn't intersecting also sets `lastValidPosition`. The state effect POSTs it to `/api/assembly`.
- **Pointer handling:**
  - `handlePointerUp` (a click that moved under 5 px and wasn't a drag) raycasts `partsRoot` meshes and calls `onSelect`.
  - There is no `dblclick` handling.
  - `App.jsx` handles keys on `window` (`Escape` exits Explode, otherwise reverts intersecting parts and deselects).
- **Feedback:** `App.jsx` `actionFeedback` (`{ message, isError }`) is shown as `.action-toast` in the Inspector's Smart Assembly card; the nudge already uses it.
- **Undo and tests:** there is no undo, and no test runner; `scripts/check-pin-hole-alignment.mjs` is the Node check for the pure module and uses the engine's eroded BVH (`getPartCollisionBvh`).

## Goals / Non-Goals

**Goals:**
- Reuse the highlight results as the single source of mate candidates, so the user can only mate what the rings show.
- Keep all new geometry decisions (which pin ends stick out, mate directions, travel limits) in the pure module, checkable from Node.
- Reuse the existing collision check and flush-boundary bisection for the stop, so a mate lands exactly where a careful drag would.

**Non-Goals:**
- Rotating parts to fix tilt (the 2° tolerance stays).
- Undo.
- Mating through MCP or WebMCP tools.
- Choosing which pins go into which holes beyond what is already lined up.
- Changing the catalog or the indexer.

## Decisions

### 1. Which pin ends stick out: measured once per part on the mesh
_Revised during implementation; the original plan was only the radial test with ≥ 6/8 hits. See the probe notes at the end of this section._

`measurePinEnds(partMeta, raycast)` (pure, next to `measureOpeningSurfaces`) returns `Map(featureId → { lo: boolean, hi: boolean })` for every `pin` feature. `lo` and `hi` are the `tMin` and `tMax` ends.

For each end:
- take a point on the axis 1.5 mm in from that end (the midpoint if the pin is shorter than 3 mm);
- cast 8 rays toward the axis from 4.5 mm out.

The end **sticks out** when both of these hold:
- **(a) open space around the pin near the end.** At least 4 of the 8 radial rays first hit within 2.0–3.0 mm of their start (the pin's own surface at about 1.5–2.5 mm radius, allowing for the 0.38 mm erosion), and none hits anything closer. Material closer than the pin's surface means the probe started inside the body. Rays that miss went through the split in the pin tip; 2–4 of 8 do that. _Revised after user testing:_ (a) first also required front faces. On idler pins the smooth, free-spinning end has inward-facing triangles, so idler pins (and the 1x2 Idler Pin entirely) failed that end and never projected or mated from it. Face direction is now ignored in (a). (b) still uses it; on those inward-facing ends, the point past the tip mostly sees misses, so (b) still passes.
- **(b) open air just past the end.** Take a point 1 mm past the end on the axis and cast 6 rays from it (±axis and two perpendicular directions each way). At most 2 may first meet a back face. A single axial ray isn't enough: VEX pins are hollow, so an axial ray runs down the bore and misses.

(a) rejects ends buried in the body (the 1x1 Corner Connector's span runs through it). (b) rejects a base end where the stored span stops at the body face (the Triple connector's +X pegs, stored only from the face at x = 19.05 to the tip).

If neither end passes, the pin gets **no entry**, so both ends count, as today. That happens on parts whose "peg" is really a hollow tube (Straight Standoff Connector, span ±500000).

**Stand-in pin:** a part in Pins & Standoffs named "...Pin" with no `pin_peg` port, a bbox no more than 6.5 mm across in X and Y, and longest in Z gets a `pin` feature (`pin_body`) along local Z through the origin, spanning the bbox. Only the 2x3 Smooth Idler Pin matches; its ends are measured like any pin (both stick out). After this, all 18 pin parts in Pins & Standoffs project from at least one end; the check script asserts it.

Probe notes, with the engine BVH over the whole catalog:
- 96 pins get a result: 42 stick out both ways and 54 one way; 11 have no entry.
- The Triple 2x Wide, 2x2 Corner Connector has pins on +X, +Z **and −Z**. The radial profile along its Z pin line shows a pin from z ≈ −30.5 to −26, the body from −24.5 to −0.5, and a pin from 1 to 5.5.
- The 1x Pitch Standoff is male–male.

`raycast` here returns the hit distance and the local face normal. The viewport passes the collision BVH; the check script passes the engine BVH.

- **Shafts** skip the test and stick out both ways.
- **Results** are cached per part id (`pinEndCache`), like `openingSurfaceCache`.
- **Before the GLB loads**, or if a pin can't be measured (zero length after clamping), both ends count, which is today's behavior.

Alternatives considered:
- `fastenerSpecs.sideNegZ_mm` / `sidePosZ_mm`: rejected, because they exist only for the 9 connector pins and not for brackets or corner connectors.
- A bbox heuristic ("end near the bbox face"): rejected, because the body end of a corner connector peg also touches the bbox.

### 2. Alignment respects pin ends
`collectWorldFeatures(partMeta, matrixWorld, instanceId, measured)` takes `measured = { surfaces, pinEnds }`. The current fourth argument, a surfaces map, becomes the `surfaces` field. Pin features carry `freeAtStart` / `freeAtEnd` (the world `start`/`end` correspond to `tMin`/`tMax`).

In `facesIfAlignedAndOutside`, after the existing tests, a `pin` insert is rejected unless its end on the opening's side is free. The side is known from `insertAbove`: the opening is on the insert's `start` side when the insert is above the opening along `insert.axis` and `start` is the lower end, and so on.

This is the only change to highlighting behavior.

### 3. Mate directions and travel (pure)
`findAlignedOpenings` results also carry the pair's insert: `insertInstanceId`, `insertStart`, `insertEnd`, and the opening's own `start`/`end`.

New pure function `planMates(alignedOpenings, selectedId)` returns `[{ direction: Vector3, pairs, lateral: Vector3, travelMm }]`:
- **Direction for each pair:** the selected part holds the insert when `insertInstanceId === selectedId`, and then it moves toward the opening: `direction = −outward`. Otherwise it holds the opening and moves toward the insert: `direction = +outward`.
- **Grouping:** directions within 2° (`dot ≥ cos 2°`) are merged; pairs in the same group mate together.
- **Lateral correction** comes from the pair with the smallest axial gap in the group. It is the perpendicular vector from the insert's axis line to the opening's origin; the selected part is moved by it, negated when the selected part holds the opening. It is never more than 0.25 mm.
- **Travel limit** (used when nothing collides):
  - let `v` be the insert's motion relative to the opening: `+direction` if the selected part holds the insert, `−direction` otherwise;
  - for each pair, `travel = max_v(opening extent) − max_v(insert extent)`, where `max_v` is the largest projection of the two extent end points on `v`;
  - `travelMm` is the largest of these over the group.

  This gives "leading end flush with the far face of the farthest opening". A shaft moving down through a beam and a gear stops flush with the gear's bottom face. A gear moving down onto a shaft stops when the shaft top is flush with the gear's top face.
- **Contact search range** `sweepMm = max over pairs of (max_v(opening extent) − min_v(insert extent))`: keep looking for contact until the insert's trailing end reaches the far face, i.e. for as long as it is still in an opening. `travelMm` is only used when nothing is touched in that range.

  _Added after user testing:_ originally the sweep stopped at `travelMm`. A 0x2 Connector Pin turned cap-up and mated into a 2x10 Beam stopped with its tip flush with the beam's bottom, 6.5 mm before its cap reached the top face. With the longer range, pins seat on their cap or shoulder. A shaft reaches the real bottom of the Smart Motor socket (y ≈ −6.23 instead of the catalog's −4.7). Plain shafts and gears on shafts still find nothing and stop at `travelMm`.

Alternative: the user picks pins and holes. Rejected, because everything needed is already lined up.

### 4. The move: sideways correction, then a stepped sweep with bisection (viewport)
`mateSelected(direction)` in `Viewport3D.jsx`:
1. Read the plan for `direction`, then `start = position + lateral`.
2. If `checkGroupCollision` at `start` is true, abort with "Can't mate: already touching another part".
3. Step from `start` along `direction` in 0.5 mm steps up to `sweepMm`. At the first colliding step, `findFlushBoundaryPosition(group, lastClear, colliding)` gives the contact position, including its 0.25 × pitch flush-seat preference.
4. If nothing collides, the final position is `start + direction × travelMm`.
5. Round to 0.001 mm and re-check. If the rounded position collides, step back along `−direction` in 0.002 mm steps (up to 50) until it is clear. Bisection ends within about 0.0005 mm of contact, so rounding alone can land on the touching side. _Found in user testing: a Triple corner connector saved at z = −2.833 overlapped the 2x10 Beam, while −2.8335 was clear._
6. Commit with `onUpdateTransformRef.current(id, { position, rotation, isIntersecting: false })`, the same as a drag release. Then call `onMateFeedback`.

Why 0.5 mm steps: eroded caps and shoulders are only a few hundredths of a mm thick. Once they enter a 6 mm wall, though, they stay overlapping for several mm, so a 0.5 mm step can't jump past a contact. The sweep is at most about 150 mm, so about 300 collision checks. Each check is limited to the parts whose boxes touch, so this runs once per mate, not per frame.

Alternative: one `findFlushBoundaryPosition` over the whole travel. Rejected, because bisection over a long segment can land in a later gap and skip the first contact.

### 5. Double-click and arrows (viewport)
- **`dblclick` listener** on the canvas:
  - ignore it while `transform.dragging`, or after a gizmo drag that actually moved the part (`wasDraggingRef` and `dragMovedRef`, set in `objectChange`);
  - ignore it when the pointer is on an arrow, plane or ring handle (`transform.axis` set and not the center grab area `XYZ` / `XYZE`);
  - ignore it within 600 ms of an arrow click, which is the second click of a double-click on an arrow;
  - raycast parts; act when the selected part is **anywhere** under the pointer, not just the nearest hit.
  - **Clicks:** a single click whose nearest hit is another part, while the selected part is also under the pointer, waits 350 ms before selecting that front part. The `dblclick` cancels the wait.

  _Added after user testing:_ a 0x2 Idler Pin (Weak) behind a 2x10 Beam showed its ring but could not be double-clicked. The beam was the nearest hit, and the first click would also have moved the selection to the beam.

  _Revised during implementation:_ the gizmo's center grab area (move mode, about 14 mm across) sits on top of small selected parts like pins. Pressing it starts a zero-length drag, so the original "ignore if a drag happened or `transform.axis` is set" rule would have blocked almost every double-click on a pin.

  The first click of a double-click already selected it.
- **Checks before mating:** locked → message "Part is locked"; Explode on → nothing. The plans come from the last highlight result (`lastAlignedRef`, set in `updateAlignedHoleHighlights`):
  - 0 plans → "Nothing lined up to mate with";
  - 1 plan → `mateSelected`;
  - more than 1 → show arrows.
- **Arrows:** group `__mate_direction_arrows__` on the scene root, one arrow per plan:
  - a cylinder and cone in orange `0xf97316`, highlighted lighter on hover, with `depthTest: false` and `renderOrder` above the rings;
  - placed at the selected part's world bbox center, pointing along `direction`;
  - sized like the gizmo (`distance × min(1.9·tan(fov/2), 7) / 4`, about 1.3 gizmo units long) and rescaled in the animate loop so they stay large on screen;
  - the gizmo is hidden while they show (`transform.getHelper().visible = false`, and `transform.enabled = false` so it can't be grabbed).
- **Clicks while arrows show:** `handlePointerUp` raycasts the arrows first. A hit runs `mateSelected(plan.direction)`. A miss hides the arrows, then normal selection continues. `pointermove` raycasts the arrows for the hover color.
- **Esc:** a `keydown` listener on `window` in the **capture** phase hides the arrows and calls `stopImmediatePropagation()`, so `App.jsx`'s Esc handler (deselect) doesn't also run. With no arrows showing it does nothing, and App's handler runs as before.
- **Other dismissals:** drag start (`dragging-changed`) hides the arrows. So does **any run of the instance-sync effect**: selection change, Explode, a hidden part, a server sync, or the committed mate itself. Any of these can make the shown plans stale. Orbiting the camera does not hide them.

### 6. Feedback to the app
New `Viewport3D` prop `onMateFeedback(message, isError)`. `App.jsx` passes `(message, isError) => setActionFeedback({ message, isError })`.

Success messages list the distinct part labels of the pairs used: "Mated with 1x6 Beam", or "Mated with 1x6 Beam, 36 Tooth Gear".

## Risks / Trade-offs

- [The pin-end ray test could misjudge pins that stand very close to a wall of their own part (less than 2 mm of clear space around the pin)] → Such a pin would project nothing from that end. The check script covers the connector-pin, standoff, and corner-connector families; widen the sample radius or count if a real part fails.
- [`findFlushBoundaryPosition`'s 0.25 × pitch preference works on the dominant world axis; for a part rotated off the world axes it may not find a clean seat] → It falls back to the exact bisected contact, which is still non-intersecting.
- [A mate with nothing to stop it can push a shaft visibly far, e.g. a long shaft lined up with many holes] → Travel is limited to the farthest lined-up opening; nothing beyond the highlights can pull it further.
- [Double-click also fires two `pointerup` clicks] → Both select the same part (no change), so selection is unaffected. A click on an arrow is consumed and does not select.
- [Hiding the gizmo by disabling TransformControls] → It is re-enabled whenever the arrows hide, on every dismissal path in §5.

## Migration Plan

Front-end only. No data, API, or saved-state changes. Rollback is reverting the commit.
