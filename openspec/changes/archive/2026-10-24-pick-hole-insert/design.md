## Context

See proposal.md for the motivation. Relevant pieces today:

- **Features.** `pinHoleAlignment.js` turns a part's catalog ports into local features (`getLocalFeatures`: pins, shafts and openings, each with an origin, axis and span) and world features (`collectWorldFeatures`, with measured faces and which pin ends stick out). Fit rules are in `pairRoles` (`OPENINGS_BY_INSERT`) and line matching is `linesCoincide` (2°, 0.25 mm).
- **Mating.** `Viewport3D.handleMateRequest` runs on double-click. It calls `planMates(lastAlignedRef.current)`, and with no plans it shows "Nothing lined up to mate with". `mateSelected(plan)` shifts the part onto the axis, sweeps along the direction in 0.5 mm steps until contact (using `findFlushBoundaryPosition`), backs off rounding, and commits position and rotation through `onUpdateTransform`. With the cap check from the last change, contact also stops a shaft cap at a hole's lip.
- **Other parts' features.** `otherFeaturesRef` caches the world features of every visible non-selected part. It is rebuilt at drag start and after scene syncs.
- **Wheel and keys.** The ring wheel (`handleWheelCapture`) and `Esc` (`handleKeyDownCapture`) already take over the wheel and keys in capture phase while a mode is active. Mate arrows show how a temporary mode hides the gizmo and gives it back (`hideMateArrows`).
- **History labels.** `App.handleUpdateTransform(id, patch, meta)` already passes `meta.label` to the recorded history step.

## Goals / Non-Goals

**Goals:**
- Pure, Node-checkable math for the pose of a part inserted into a picked hole, and for ranking fits.
- Reuse the mating sweep for the actual insert, so contact, cap stops and flush seats behave exactly like double-click mating.
- Smooth hover on large models (thousands of holes).

**Non-Goals:**
- A part with holes picked onto existing pins (the reverse case); see proposal.md.
- Picking several holes one by one, or free rolls other than 90° steps.
- Snapping the inserted part's other pins sideways into nearby holes. Markers only report whether they line up.
- An MCP tool.

## Decisions

### 1. Pose from three facts: anchor axis, entry face, receiving part's frame
For a hovered opening with highlighted face point `F` and outward unit `n` (pointing out of that face, toward the side the part comes from), and an anchor insert of the selected part, the pose is built from two orthonormal bases.

- **Anchor direction:** in local coordinates, `d` is the anchor's axis pointing toward its leading end (the end that goes in).
  - Pins: an end that sticks out (`pinEnds`). For a 0x2 pin, both ends are offered.
  - Shafts: both ends, except that a capped shaft leads with its uncapped end. The cap is at `capShoulderZ` / the high end of its span.
- **Selected part's reference:** `rs` is the selected part's local X, Y or Z axis most perpendicular to `d`, made perpendicular to `d`.
- **Receiving part's reference:** `rr` is the receiving part's world X, Y or Z axis (its rotation applied) most perpendicular to `n`, made perpendicular to `n`.
- **Roll:** for roll `k` in {0, 1, 2, 3}, `rk = rr` turned `k × 90°` about `n`.
- **Rotation:** `Q = [−n, rk, −n × rk] · [d, rs, d × rs]ᵀ`. This sends `d` to `−n` (pointing into the hole) and `rs` to `rk`, so the pattern rolls with the receiving part (the 30° example).
- **Position:** `P = F + n·GAP − Q·leadEnd`, where `leadEnd` is the local point at the anchor's leading end and `GAP = 1 mm`. The anchor's line is then the hole's line, and its tip sits 1 mm outside the face.

The rotation is stored as Euler XYZ degrees, like every other pose.

*Alternative:* line the pattern up with the selected part's current roll. Rejected: the request is explicitly to follow the receiving part's orientation. Free roll angles are not needed, because every VEX IQ pin pattern sits on the 90° grid of its own part.

### 2. Fits and ranking
`listInsertFits(selected, hovered, others)` builds one fit per (anchor, leading end, roll). Fits whose `Q` and `P` match another fit (within 0.01 mm / 0.1°) are dropped, so symmetric parts don't repeat.

The rolls are the four quarter turns plus **pattern rolls**. Quarter turns alone miss hole patterns that aren't square to the receiving part's axes, such as the angled face of a 30° corner connector, whose hole line runs 30° off the part's axes. Pattern rolls are found like this:
- At roll 0, take each other insert parallel to the anchor and its offset `u` across the hole axis.
- For each opening parallel to the picked one and fitting that insert, take its offset `v` across the axis from the picked opening. Only openings within 2 pitch along the axis are considered, and only out to the part's widest spread across the axis (the largest `|u|` plus 0.25 mm), since no pin can reach further. The widest spread in the catalog is 38.1 mm (1x4 Bearing Surface Block).
- When `|u| = |v|` within 0.25 mm, the roll `atan2(n · (u × v), u · v)` puts that insert on that opening; add it.

The ranking by green count then picks the roll that fills the most holes. `insertPose` takes `rollRad` for these rolls.

For each fit, the selected part's other inserts are transformed with `Q`, `P`, and only those parallel to the anchor are kept. A kept insert is green when `linesCoincide` matches it with a compatible opening in `others`, red otherwise.

Fits are sorted by green count (descending), then by the angle between `Q` and the part's current rotation (ascending). Each fit carries:
- the pose,
- the markers: for each kept insert, its leading-end point projected onto the face plane (`F`, `n`), with a green or red flag,
- `insertTravelMm` and `sweepMm` for the sweep (decision 4).

### 3. Hover hit-testing in screen space
- **Candidates:** on entering pick mode, gather `otherFeaturesRef` openings that fit at least one of the selected part's inserts. Each opening offers its open faces:
  - through openings: both `start` and `end`;
  - split blind openings: `@hi` → `end`, `@lo` → `start`;
  - other blind openings: the `end` face, since their port axis points out of the opening (Smart Motor socket, standoff ends).
- **Picking a face:** on pointermove (once per animation frame), project every candidate face point to the canvas and keep those within 24 px of the cursor. Among those, take the one nearest the camera, or the nearest on screen when depths are within 2 mm.
- **Highlight:** a ring drawn at the face (cyan; grey when taken), reusing the hole overlay's ring geometry.
- **Taken holes:** run `findSeatedPairs([hoveredOpening], otherInserts)` once per newly hovered hole.

*Alternative:* raycast the scene and use the hit point. Rejected: hole interiors are empty, so the ray hits the far wall or misses, and small parts are hard to hit. Screen-space face points are cheap and forgiving.

### 4. Preview and insert reuse the mate sweep
- **Ghost:** a clone of the selected group's meshes with a see-through material (like the overlapping-part look, but cyan), added to the scene and posed per fit. Markers are small discs (green or red) facing `n`.
- **Insert:**
  1. Set the selected group to the fit's pose.
  2. If it overlaps anything there, restore the old pose and show "The way in is blocked".
  3. Otherwise call the refactored `mateSelected(plan, { label })` with `plan = { lateral: 0, direction: −n, travelMm, sweepMm }`:
     - `travelMm`: from the leading end to the opening's far face (through openings) or bottom (blind openings);
     - `sweepMm`: `travelMm` plus the insert's length, to keep looking for contact while still inside.
  4. `mateSelected` already commits position and rotation. It gains an optional label passed as `onUpdateTransform(id, patch, { label })`, which gives the single "Insert … into …" step.

### 5. Mode state and exits
- **State:** `pickModeRef` (`null` or `{ selId, candidates, hovered, fits, fitIndex }`) lives in the viewport.
- **Banner:** a new `onPickStatus(status | null)` prop tells App what to show in a HUD pill: part label, fit number, pins in holes, and taken-hole messages.
- **Exits:** effects on `selectedId`, `transformMode`, `explodeMode` and `instances` end picking when they no longer fit the mode (the selected part is gone or changed by history).
- **Input:**
  - capture-phase `wheel` (only while a hole is hovered) and `keydown` (`Esc`, `R`, `Shift+R`) handlers, like the ring wheel;
  - a pointerup with less than 5 px of travel is a click (insert, or exit when nothing is hovered);
  - larger travel is a camera orbit and is ignored.
- App's `Esc` handler does not deselect while picking; the viewport's capture handler stops the key.

## Risks / Trade-offs

- **[Ghost meshes on very large parts cost a frame to build]** → The clone is built once per pick session; per-fit changes only update the pose.
- **[Picking a face hidden behind other parts]** → Nearest-to-camera usually picks the visible face, but holes deep inside an assembly can still be chosen by hovering their screen position. That is acceptable, and even useful, since the camera can be turned. The ghost shows the result before the click.
- **[A different anchor end than the user expects for a 0x2 pin]** → Both ends are fits. The ranking prefers the smaller turn from the current orientation, and the wheel switches.
- **[The parallel-only pattern ignores pegs on another face]** → This matches the spec. A later version could check them as a second contact plane.
- **[Openings whose axis convention differs (blind ports not pointing outward)]** → Covered by checks on the Smart Motor socket and standoff ends. If a part type gets the face wrong, the preview shows it coming from inside, and the user can pick the other face.
