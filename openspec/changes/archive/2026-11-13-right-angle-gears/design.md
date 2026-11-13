## Context

See proposal.md for the motivation. What exists today:

- **Part data.** `inferGearSpecs` in `scripts/index-part-metadata.mjs` already labels the four parts by name (`gearType: 'bevel' | 'crown' | 'worm'`), but `measureShapes` only measures `spur`, `sprocket` and `rack`. The catalog values for the 90° gears are guesses: the worm has `teeth: null` and `pitchRadiusMm: 7.29` (half its bbox width), the bevels' `pitchRadiusMm` is half their bbox too. Useful facts already in the catalog:
  - both bevel gears' models span z −12.7…−6.35 with the part origin on the axis one pitch in front of the back face, which is where the cone point is expected to be;
  - the crown gear's teeth are on its −z face only, a ring from about 17 to 20.1 mm radius; its rim is smooth (probed 2026-11-12), so it doesn't mesh as a spur gear;
  - the worm is 19.05 mm long, radius 7.29 mm, with a square bore right through.
- **Meshing maths.** `src/utils/gearMeshing.js` is pure: `worldToothed(partMeta, position, rotation)` gives a gear or rack in world space, `meshRelation(gear, other)` says whether they are in range and what tooth phase meshes exactly, and `meshTurn(gear, neighbours)` picks the turn. `isMeshingGear` is `gearType === 'spur' && measured`. Everything rejects axes that aren't parallel.
- **Placement.** Every placement ends in `settlePlacement` (`src/utils/placementFit.js`): square fit, then mesh (turning the whole shaft group when the gear is on a square axle), then motor hubs. The viewport calls `meshTurn` live while dragging (`liveFitWhileDragging`), and hole-picking previews call it in `meshPreviewTurn` (`src/utils/pinHoleAlignment.js`). All of these are guarded by `isMeshingGear`.
- **Position always comes from holes.** Nothing today moves a gear to a meshed position; a spur gear is only turned. Parts are pulled onto hole lines by `snapDragToHoles`.
- **Join.** Double-clicking the selected part mates it; double-clicking a Robot Brain with a battery selected slides the battery in, and the context bar's Join button does both by tap (context-toolbar spec, "Join").
- **Play mode.** `src/engine/core.js` builds a `meshes` list (`kind: 'gear' | 'rack' | 'near'`) from `meshRelation`. `src/sim/bodyGraph.js` turns it into links `{ kind, a, b, ratio, sign, axisA, axisB }`. `src/sim/kinematic.js` passes speeds across links both ways; `src/sim/physics.js` (`holdLinks`) pulls both bodies' speeds to the ratio with equal and opposite impulses, and leaves linked gear pairs out of collisions.
- **Assistant.** Tools are defined in `mcp/vexiq-mcp-server.mjs` and `src/utils/webMcpTools.js`, and run in `src/engine/core.js`. `bend_sheet` and `place_band` already use "call once to list the choices, again with one".

Constraints: the app runs with no server, is used by middle school kids, also on tablets and phones, and part rotations are stored as Euler XYZ degrees.

## Goals / Non-Goals

**Goals:**
- One set of pure functions for the 90° rules and mesh spots, used by the viewport, the engine and the Node checks, so the app and the assistant place gears identically.
- Runtime uses only measured values from the metadata. Nothing measures a model in the browser.
- A loose gear can be put in mesh with one drag or one tap, with no new mode, panel or setting.

**Non-Goals:**
- The Differential Gear housings.
- Loose spur gears jumping into mesh beside spur gears.
- Angles other than 90°, and bevel pairs whose cone angles don't add up to 90°.
- Keeping a loose gear in mesh when its partner is moved afterwards. The jump is a one-time placement.
- Worm efficiency, friction or tooth strength in Play mode.

## Decisions

### 1. Measure the three shapes in the indexer
New functions in `scripts/measure-part-geometry.mjs`, called from `measureShapes` for `gearType` `bevel`, `crown` and `worm`, using the same ray casting and Fourier fit as spur gears.

- **Bevel.** At several heights along the axis, cast inward rays and take tip and root radius of the tooth band. Fit a straight line through the tip radii and one through the root radii: where each reaches radius 0 is the cone point. The gear is measured when the two lines agree on the cone point within 0.5 mm. The cone angle (from the mean of the two slopes) is recorded only as a sanity value: a 1:1 pair at 90° is 45° by geometry, and on the 12 Tooth High Strength gear the tall, uneven teeth make the fitted angle drift, so it doesn't decide anything. What decides meshing is the cone point, the tooth count and the tooth phase (Fourier fit in the middle of the band). Output: `measured`, `teeth`, `conePointZ`, `coneAngleDeg`, `pitchRadiusMm` (mean mid-tooth radius at the band's middle), `toothPhaseDeg`, `faceSpanMm`.
- **Crown.** Cast rays along the axis onto rings of several radii from both faces; the toothed face is the one with a 36-fold height pattern (−z on the 36 Tooth Crown Gear). Output: `measured`, `teeth`, `moduleMm` (from tooth spacing at the ring's pitch radius, snapped to a VEX IQ size), `toothFace` (+1 or −1 along the axis), `pitchPlaneZ` (one module in from the tooth tips), `ringRadiiMm: [inner, outer]`, `toothPhaseDeg`. The rim has no spur teeth, so there is no spur form.
- **Worm.** Cast inward rays along lines parallel to the axis at several angles of the `refAxes` frame; each gives radius against position, a wave whose period is the thread spacing and whose shift from one angle to the next gives the lead and the winding direction. Output: `measured`, `threadSpacingMm`, `leadMm`, `starts` (`lead / spacing`, rounded), `hand` (+1 when turning the worm by +θ about its +axis moves the crest by +lead·θ/360 along the axis), `pitchRadiusMm`, `threadSpanMm`, `threadPhaseMm` (crest position along the axis at the reference angle). The pitch radius is tip minus one module (module = spacing/π), snapped to the nearest eighth-pitch step when within 0.2 mm. On the VEX IQ worm that is 6.23 → 6.35 mm: the collision check is clear at both 25.28 and 25.4 mm from a 36 Tooth Gear (it can't tell them apart), and the grid value puts a worm's shaft in line with the holes. The bevel cone point is snapped the same way (within 0.4 mm), since its fits drift a few tenths.

Why measure rather than type the numbers in: the spur work showed name-based values were wrong (the 34DP gears, the 36 Tooth Gear's phase), and tooth phase can only come from the model. A hand-entered table was considered for the handful of parts involved and kept only as the check: `scripts/check-right-angle-gears.mjs` asserts the measured values against expected ranges (cone point within 0.5 mm of the origin, worm thread spacing within 2% of a standard tooth spacing), so a bad measurement fails loudly.

### 2. One relation function, more kinds
Extend `src/utils/gearMeshing.js` rather than add a parallel module, because `meshTurn`'s "several neighbours" logic must weigh 90° and parallel partners together (a spur gear between a worm and another spur gear).

- `worldToothed` returns `kind: 'bevel' | 'crown' | 'worm'` for the new parts with their world axis, cone point, tooth plane and so on.
- `meshRelation(a, b)` dispatches on the pair of kinds. Each 90° rule returns the same shape as today (`{ other, distanceMm, exactDeg, errorTeeth(phi) }`) for the part being turned, so `meshTurn`, the messages and `settlePlacement` need no new branches.
- A new `canTurnToMesh(partMeta)` replaces `isMeshingGear` at the call sites that guard turning (placementFit, Viewport3D, pinHoleAlignment, core). `isMeshingGear` stays for code that means "spur gear" (gear trains, chain code).

The phase rules, all written as "fraction of a tooth from a tooth center to the meeting point", so the existing `t_A + t_B ≡ ½` test is reused:
- **Bevel–bevel.** The meeting line runs from the shared cone point along the bisector of the two axes. For each gear, `t` is measured about its own axis at the direction of the other gear's axis.
- **Crown–spur.** The meeting point is on the crown's tooth ring under the spur's axis. The crown's `t` is taken at that angle about its axis; the spur's at the direction pointing down into the crown.
- **Worm–spur.** At the point of closest approach, the worm's `t` is `frac((s − threadPhase − lead·θ/360) / spacing)`, where `s` is the point's position along the worm and `θ` the worm's turn. Turning the worm by `θ` shifts it by `lead·θ/360`; that gives the worm's meshing turn directly. The spur's `t` is taken at the direction toward the worm.

Tolerances: axes at 90° within 2° means `|a·b| ≤ sin 2°`; distances use the existing `MESH_CENTER_TOLERANCE_MM` (1.0).

### 3. Mesh spots are computed, not searched
`meshSpots(gear, partner)` in the same module returns up to 8 poses `{ position, quaternion, axisDir, index }`:
1. pick the quarter-turn directions round the partner's axis: the world axes perpendicular to it when it is within 2° of a world axis, else `refAxes(partnerAxis)`;
2. for each direction, build the gear's pose from the pair rule in closed form (bevel: gear's cone point on the partner's, axis along the direction; crown/spur: axis along the direction, at the ring; worm/spur: tangent to the gear in its tooth plane);
3. of the two ways a gear can point along its axis, keep the one nearer its current orientation, so a dragged gear doesn't flip;
4. apply the meshing turn from decision 2.

The caller drops spots that collide, using the existing candidate collision check (viewport and engine each have one).

Alternative considered: let the gear be dragged freely and only turn its teeth once the user has positioned it within 1 mm. Rejected by the user's answer and by the audience: lining up two axes at 90° in 3D by hand, on a tablet, is the hard part.

### 4. The drag shows a preview and jumps on release
While dragging, the viewport asks for the nearest spot within 6.35 mm of the dragged gear's center, across all partner gears in the scene. If there is one and no hole snap is active, it shows a see-through copy of the gear at the spot (the same ghost material hole picking uses for its previews) and remembers the spot; on release the gear is moved there through the normal placement step, so history, overlap flags and `settlePlacement` behave as for any placement.

Why a preview instead of moving the dragged part live, as hole snaps do: a jump changes orientation, and turning the object under the Move gizmo mid-drag would swing the gizmo's arrows and fight the pointer. A ghost is also clear on touch, where the finger covers the part.

Hole snap wins over a spot so that a gear being pulled onto a shaft or hole behaves exactly as today; once on the hole it still turns to mesh by decision 2.

### 5. Join by double-click and by the Join button
- Double-click: in `handleDoubleClick`, before the existing mate path, when one unlocked gear is selected and the part under the pointer is a different gear with at least one mesh spot for it, take the spot nearest the clicked point. This mirrors the battery-into-brain branch.
- Join button: extend the battery rule in the Join logic. "Auto Join" when a single gear is selected, nothing is lined up to mate, and a 90° partner lies within 40 mm; tapping it uses the nearest spot on the nearest partner. The context-toolbar spec's Join requirement is not rewritten; the new behaviour is specified in right-angle-gears ("Joining a gear to its partner"). When this change is archived, add a cross-reference line to context-toolbar's Join requirement the next time that spec is edited (noted in `openspec/follow-ups.md`).

No new button, mode or panel: the two gestures kids already use to join parts.

### 6. Play mode links carry a direction rule and a one-way flag
- `core.js` adds mesh entries `kind: 'bevel' | 'crown' | 'worm'` with `teethA`, `teethB` (for the worm, `starts`), both axes, and the meeting point. "Near" entries are added for 90° pairs within 3 mm of range.
- The ratio and sign come from the meshing maths itself, so placement and Play mode agree by construction: `core.js` turns part A by a small δ about its axis, recomputes B's exact meshing phase from `meshRelation`, and the change in B's phase divided by δ is the signed speed ratio (B about its own axis per A about its own axis). `bodyGraph.js` stores it as `ratio` (its size) and `sign`. The check script asserts this gives −1 × teeth ratio for parallel spur gears, so existing links don't change.
- Worm links get `oneWay: true` with the worm always as `a`.
  - `kinematic.js`: speeds pass a→b only. Reaching a one-way link from `b` with a non-zero wanted speed jams that motor, like asking a fixed body to turn.
  - `physics.js` `holdLinks`: for a one-way link the whole correction goes to `b` (the gear) and none to `a` (the worm). The gear follows the worm, and a load on the gear can't move the worm, which is what "self-locking" means. The `trains` walk that adds up what a motor turns doesn't cross a one-way link from `b`.
  - On entry, a motor whose shaft body is on the `b` side of a one-way link with no path to the worm's own shaft is listed: "… can't turn Worm Gear #1: a worm can only be turned from its own shaft."
- Linked pairs are already left out of collisions by `touchingParts`; the new links ride on that.

Alternative considered: model the worm as an ordinary two-way link with a huge ratio. Rejected: a back-driven worm would spin at 36× speed instead of locking, the opposite of the real part.

### 7. The assistant's tool
`mesh_right_angle({ instanceId | part, targetInstanceId, spot?, label?, color? })` in `core.js`, defined in both tool lists. Without `spot` it returns the spots (index, axis direction, center, `blocked`); with one it places and returns the pose and mesh message. It uses `meshSpots` and the engine's collision check, and records one history step. `place_part` / `place_parts` need no new code beyond decision 2, since they already end in `settlePlacement`.

The server's connect-time guidance (the marked section of `AGENTS.md`) gains one bullet on the three pairs and the worm's one-way drive.

## Risks / Trade-offs

- [The bevel cone point isn't at the part origin] → the measurement decides (probe 2026-11-12: both bevel gears' tooth cones point at the origin); a bevel whose tip and root lines disagree on the cone point by more than 0.5 mm is marked unmeasured with a reason rather than meshed badly.
- [The 12 Tooth High Strength Bevel Gear may only be meant for the high strength differential] → it meshes with another of itself; it never pairs with the 18 Tooth Bevel Gear, since their tooth counts differ.
- [The worm's thread fit depends on a low-polygon model] → the Fourier fit is taken over the whole threaded length at four angles; the check requires the four to agree on spacing within 0.05 mm.
- [The collision check reports a correctly meshed 90° pair as overlapping, because bevel and worm teeth are modelled more coarsely than spur teeth] → scenarios require no contact after meshing; if the models can't meet that, treat a meshed 90° pair like the tire-on-hub case (a known pair that isn't a collision) and say so in the spec before archiving.
- [A spot preview appears when the builder only wanted to drag a gear past another] → the 6.35 mm range is small, nothing moves until release, and Alt or Free move turns it off, the same escape as hole snaps.
- [Double-clicking another gear used to select it after the double-click interval] → the new branch only fires when the selected part and the clicked part form a 90° pair with a free spot; every other double-click is unchanged.
- [One-way links in the physics pass could let the gear drift from the worm under load] → the existing drift catch-up (`trackDrift`) applies to the gear side, pulling it back to the worm's position.

## Migration Plan

1. Regenerate the metadata (`npm run index-metadata`) with the STEP folders linked into the worktree first (see AGENTS.md), and commit `public/catalog.json` and `public/part-metadata.json`.
2. Saved builds need no change: nothing is stored on instances beyond position and rotation.
3. Rollback is reverting the change; the extra metadata fields are ignored by older code.

## Open Questions

- The exact distances in two spec scenarios (worm and 36 Tooth Gear axes "25.4 mm apart") assume the worm's measured pitch radius is 6.35 mm. If it measures differently, correct the number in the scenario; the rule itself doesn't change.
