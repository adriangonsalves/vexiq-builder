## Context

See proposal.md for why. What exists today:

- **Rotate mode** (`refreshRotateSetup` in `src/components/Viewport3D.jsx`): a part held on one axis line gets one ring about it; a part held on several lines gets X/Y/Z rings about `gridPivot` (a point on the half-pitch hole grid). Nothing places the pivot at the depth where pins sit, so a half turn about a row of pins lands them a few mm off their holes.
- **Target** (open change `target-hole-placement`, built): `targetRef`, `resolveTarget()`, `targetFits(session, group, target)` (lists fits with `listTargetFits`, seats each, drops blocked ones, prefers plug fits), `startPlace({ atTarget })` for library parts and `startTargetFit()` for parts with only holes. `handleDoubleClick` uses the target only when nothing is lined up and the part has only holes.
- **Fix assembly** (`src/engine/fixAssembly.js`, run through `handleRunSmartAction('fix_assembly')`, also an MCP action): blocks come from `jointGraph` and part groups; near pairs within 20°/4.5 mm/4 mm; the smaller block moves rigidly, then slides along parallel pair lines and settles. It already imports `playInputs` and `buildBodyGraph`.
- **Play mode's body graph** (`src/sim/bodyGraph.js`) splits a block at shafts running through round holes (`hinges`, kind `axle`) and lists gear meshes (`links`, including the new 90° kinds). That's the split "Lining up and seating" needs: parts on the far side of an axle hinge can slide along and turn about that shaft without moving it.
- **Motor socket** (`src/utils/placementFit.js`): the placement step already turns a motor's hub (`socketAngleDeg`) to fit a shaft's flats. It doesn't correct tilt.

## Goals / Non-Goals

**Goals:**
- One shared "line up nearly-reached holes without moving a meshed gear" routine used by Fix assembly and by every insert path.
- The row-flip pivot found from the joints the rotate setup already computes.
- Target placement for scene parts reuses the library path (`targetFits`, fixed pick session, wheel bar) rather than a second fit search.

**Non-Goals:**
- Sliding along a shaft for parts held by more than one axle hinge on different lines (they can't slide; they're treated as rigid).
- Lining up chains, bands or sheets.
- Changing the stamp/copy gestures (dropped from the request).
- Fixing the tilt already in saved builds automatically on load. The audit lists it, and Fix assembly or moving the motor squares it.

## Decisions

### 1. Row pivot: computed from the held joints, not the hole grid
When the selected part's joints form two or more parallel lines (2°) lying in one plane (0.25 mm), take the row direction as the direction across the lines in that plane, the row line through the joints' points, and the depth as the mean of each joint's overlap midpoint (the overlap span is what `seatedSpans`/`findSeatedPairs` already report). The pivot is the point on the row line at that depth. Ring selection: if the row direction is within 2° of a world axis, that world ring's axis becomes the row direction and every ring uses the new pivot; otherwise a fourth ring is added with its own colour. *Alternative:* keep the grid pivot and snap it to the pins' depth. Rejected because the grid point needn't lie on the row line when the part is off-grid (the rig's 0.9° tilt), and the flip would still miss.

### 2. Scene part into the target: a fixed pick session on the existing part
`handleDoubleClick` (and Join through `joinSelected`) checks the target before `planMates`. It selects the double-clicked part, builds a pick session as `startTargetFit` does but for any part kind (`buildPickSession('pick', { allowFollowOnly: true })`), lists `targetFits`, and sets `fixed`. The commit path is `pickClick`, which mates in along the fit. Its label becomes "Move … into …" when the part was already in the scene (`pick.place` absent). On `Esc`, `endPick` already restores `startPosition`/`startQuaternion`. The pins leave their old holes because `targetFits` seats from the fit's outside pose and the old position is ignored once the part is posed there. *Alternative:* remove and re-add the part through the library path. Rejected: it loses its id, colour and label, and undo would show two steps.

The double-clicked part may not be the selected one yet. The existing "click waits one double-click interval" rule already holds the selection, so the double-click handler resolves the part under the pointer (as `pickPartsAt` does) and selects it synchronously before starting the session.

### 3. Mesh-safe line-up: candidate movers when the smaller block holds a meshed gear
Blocks are now built from pinned joints only (`jointGraph(state, { pinnedOnly: true })` plus groups). With the default graph, gear meshes and touching parts joined everything in the rig into one block, so the motor hole and the pin were never paired across blocks. Inside `fixAssembly` the mover is chosen:
1. The smaller block (today's rule, locked blocks skipped). If it holds no gear meshed with one outside it, it moves rigidly, with today's overlap swap.
2. Otherwise these candidates are fitted: (a) the other block's rigid pieces held with what the pairs line up with (the existing overlap-swap pieces, from `buildBodyGraph(playInputs(state)).bodies`); (b) in either block, the bodies beyond an axle hinge, moving only by a slide along the hinge's axis plus a turn about it (`solveSlideTurn`, least squares in those 2 numbers). Pieces with a locked part, a meshed gear or only part of a group are skipped. The pick is fewest new overlaps, then least turn, then fewest parts.
3. None works: no move, and a message built from the worst pair (its line distance and angle) and the meshed gear from step 1.

A piece also must keep the seat depth of every pin or peg joint it keeps with the rest of its block (within 0.1 mm; a shaft through a round hole is exempt, since it can slide). Without that rule, the rig's 1x1 corner connector, which hangs on the beam by one peg and so is its own body, won on part count. It slid 0.74 mm along its peg, pressing into the beam as a tight fit. The collision meshes are shrunk about 0.76 mm, so "no overlap" didn't catch it. With the rule, the beam, connector and pin slide together along the gear shaft, keeping the peg's seat.

"Meshed gear" is any part in a `links` entry of kind `gear`, `rack` or the 90° kinds whose partner is not itself moving. Gears are tested with the same `meshRelation` the audit uses, so a slide along a gear's own shaft that leaves the gear in place passes trivially. *Alternative:* allow a meshed gear to move when the mesh still holds afterwards. Rejected after the user's question: moving the worm side even within tolerance leaves the gear off the grid it was meshed on, and kids can't see why it moved.

### 4. After-insert line-up: a narrow entry point on the same routine
Add `lineUpAfterInsert(state, { instanceId, keepPairs })` to `fixAssembly.js`: near pairs limited to 1 mm/3°/4 mm, the inserted part's own block as one side, `keepPairs` (the holes it just went into) as pairs that must stay lined up. It returns pose patches and a message, or nothing. The Viewport insert paths (`mateSelected`, `pickClick`, target commit, `copyInsert`) already call `settleInstances` to collect extra patches into the same history step, and the line-up result is appended there. The engine runs in the browser (it's the same module the Tools menu uses), so no server is involved. *Alternative:* run full Fix assembly after every insert. Rejected: its 20°/4.5 mm reach would move parts the user didn't mean to touch.

### 5. Square the shaft into the motor, not the motor onto the shaft (revised after review)
At first the motor body was turned onto the shaft. The user pointed out that in a real build the motor is mounted and the shaft goes into it. `squareShaftInMotor` in `placementFit.js` now keeps the motor body still. It turns the shaft and its shaft group (the parts fixed on it by square holes, from `shaftGroups`) about the socket onto the socket's line: the smallest turn, so the shaft's turn about its own line and the hub angle are kept, plus a sideways move onto the line, keeping the depth. It refuses, returning the reason, when a member is locked, when a member sits in anything other than the motor and the group (a beam hole, a pin), or when a group gear meshes with a gear outside the group (by `meshRelation`). The placement step calls it when a motor is placed, and Fix assembly and `lineUpAfterInsert` call it for motors near the part first, adding the reason to the message when refused. The hub can't do this alone: it turns about the socket axis but can't tilt. The audit's "motor tilted off its shaft" entry stays.

### 6. Snapping 90° gears into mesh (added after review)
Placement step 1b, before the mesh turn: for the placed gear and each 90° partner `rightAngleNearMiss` reports (≤ 3 mm), `meshSnapSlides` searches slides along the gears' own axes that bring the contact distance (`rightAngleContact`) under 0.15 mm. It tries the placed gear alone (a coarse 0.1 mm scan over ±3 mm, then 0.01 mm round the best), then both gears by alternating scans. A gear only slides when it isn't locked and every seated pair it's in is a shaft in its own bore. Shafts never move, though the mesh turn after it may still turn a shaft group about its own line as before. The `preTurnForPlacement` probes along a push pass `snap: false`, so the search runs once, where the part lands (about 0.3 s on the rig, and only when a near miss exists). The right-angle-gears "Out of range" scenario moves from 3 mm to 3.5 mm, past the snap.

### 7. Meshed-gear outlines (added after review)
`refreshMeshMarks` runs on instances, selection and Explode changes. With one gear (or rack) selected, every other visible toothed part in `meshRelation` with it gets `userData.meshMark` green on its `__cad_edges__` lines, and each `rightAngleNearMiss` amber. `applyGroupAppearance` uses the mark as the part's resting edge colour, so selection changes don't wipe it. The marks ride on the parts' own edges, so they follow drags.

## Risks / Trade-offs

- [The after-insert line-up moves a part the user didn't touch, which can surprise them] → Limited to 1 mm/3°, same history step (one undo), and the message names what moved.
- [The 2-DOF slide/turn solve may not reach 0.2 mm when the error isn't along the shaft] → It falls back to the message. The rig case (error along the shaft) is the scenario that has to pass.
- [Row-flip ring replacing a world ring may confuse users who expect X/Y/Z] → It only replaces a ring within 2° of the same direction, so it looks the same and just turns about a better point.
- [Double-click with a target now ignores an obvious lined-up mate] → That's what the user asked for. The target is visible (its own ring colour) and `Esc` or Alt+click clears it.
- [Body graph cost on large builds for every insert] → Only built when a near pair is found (rare). Most inserts find none and skip it.

## Migration Plan

No data change. Saved builds with tilted motors show an audit entry; nothing moves until the user acts.
