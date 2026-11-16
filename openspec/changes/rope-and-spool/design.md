## Context

See proposal.md for why. What exists today, and what was measured for this change:

- **Rope parts** (catalog): 12x (228-2500-430), 20x (436), 24x (438), 48x (442) and 120x (448) Pitch Rope. Each is a 1.2 mm cord with a moulded tab at each end (8 mm wide, 4.57 mm thick, one 2.1 mm-radius hole). Hole to hole is one pitch less than the name: 139.7, 241.3, 292.1, 596.9 and 1511.3 mm. Data faults: four of the five carry a third port (`hole.-x…`, the cord's end read as a hole), and the 20x rope's origin is off its middle (`originType: "offset"`).
- **Spools:** 2x Wide Spool (421), measured from VEX's mesh in its own frame, axis along z:
  - drum core radius 7.5 mm, flange radius 12.55 mm, drum from z = −10.5 to 10.5 (21 mm);
  - a square bore 3.18 mm across at the −z end (z −12.7 to −6.5), a round clearance through the middle;
  - a round pocket of radius 4 mm at the +z end (z 8 to 12.55), with a slot out through the flange. This is where a rope's end tab sits.
  
  Its catalog entry has one wrong port (a blind round hole). The 1x Wide Spool (420) has no ports at all, so it can't be placed on a shaft. Neither has `gearSpecs`.
- **.5x Pitch Idler Pulley** (1413): `gearType: "pulley"`, `pitchRadiusMm: 5.5` (its rim, not its groove), one round hole, so it turns freely on a pin. The 10 to 40 mm pulleys have square bores.
- **Swish in VEX's CAD** (`Catapult Winch`, app frame, mm): the rope's first tab is in the spool's pocket at spool z ≈ 9.4, on the 4x Pitch Shaft (spool at (76.05, 28.74, 0), axis along z). VEX draws the rope twice: the straight library rope standing up from the spool to y = 318, and a bent piece ("228-2500-438 bent for catapultbot") leaving the spool radially through the flange slot and running to (64, 231, 0), then bending to the Catapult Arm, where a loose tab ("228-2500-ROPE-OVERMOLD-MASTER") sits on the arm's 3x Pitch Motor Shaft at about (37, 247, 0), beside a Rubber Shaft Collar. The drawn path is about 225 mm, so about 67 mm of the 292.1 mm rope is spare. VEX draws no turns on the drum.
- **Huey in VEX's CAD:** no spool. Each side: the straight library rope's tab on a Claw Mount 0x2 Connector Pin at (238, 66, ±57), its cord straight up past the .5x Pitch Idler Pulley on the Elevator Middle Stage at (235, 231.6, ±50.8) (axis along x) and on to y = 355; a bent piece ("Lift Rope", "Lift Rope- Left") from the top of the pulley down to (214, 159, ±73); and a loose tab on an Elevator Holder 0x2 Connector Pin at (212.7, 155.6, ±69.8). Up 166 mm, round the pulley, down about 90 mm: about 270 mm, so about 22 mm of slack as drawn.
- **How Huey's lift moves:** the Holder (fixed) carries a Smart Motor, 12 Tooth Gears and six 2x Pitch Linear Motion Brackets. The Middle Stage carries four 1x6 Continuous Linear Motion Rack Gears, so Play mode already slides it (a rack joined only to its gear, `sliders` in `bodyGraph.js`, a prismatic joint in `physics.js`). The Claw Mount is joined to nothing by pin or shaft: it rides between the Middle Stage's beams and hangs on the two ropes. Today Play mode lists it as loose.
- **Rubber bands** (change `rubber-bands`, 33/41 tasks) give most of what a rope needs: spots (`bandPath.js`, `bandSpotTable.js`), the path solver (`solveBandPath`), the way round parts (`bandStrand.js`, `bandHull.js`), stringing and following parts (`bandRoute.js`), the engine action (`bandRouting.js`), the builder's picking in `Viewport3D.jsx`, pull in `physics.js` (`pullBands`: an impulse along the path at each spot), and redraw in `playRunner.js`. A band is a closed loop or a fold; a rope is an open path with two different ends.
- **Ratchet and pawl** (change `ratchet-and-pawl`, 31/35 tasks): Swish's winch winds, holds and releases in Play mode. With 0.05 to 0.6 N·m turning the spool back it holds. Nothing loads the spool yet.

## Goals / Non-Goals

**Goals:**
- A rope is a shaped part whose drawing is self-contained, as a band is, so saving, history, thumbnails and the MCP server need no new paths.
- Reuse the band solver and picking; add only what is different about a rope (open path, end tabs, fixed length, winding).
- Swish winds, holds and fires, and Huey's carriage rises twice as far as its middle stage, both as imported, with no hand set-up.
- Placing and winding ropes in the build is useful before Play and import are done.

**Non-Goals:**
- Rope as a chain of small bodies. It would be slow, and it would jitter on a spool.
- Friction, pulleys spinning under the rope, rope rubbing on parts not in its route.
- A general "slides in a guide" rule for every loose part. Only rope-held bodies are checked for one line of travel.
- Rope collisions in Play mode.

## Decisions

1. **A `rope` shape kind beside `band`.**

   `shape = { kind: 'rope', ends: [{ instanceId, feature, at }, { … } | null], via: [{ instanceId, feature, turn, wraps, h, line?, wrap?, auto? }], spool: { end: 0 | 1, turns, winding: 1 | -1 } | null, path: { points, radius }, tabs: [{ position, quaternion } …], usedMm, slackMm, short }`:
   - `points` is the cord's middle line in the rope copy's frame; the copy's position is the middle of the path with no rotation, as for a band.
   - `shapeMesh` sweeps a round section along `points` (coils included) and adds the tab mesh at each held end. The tab mesh is cut once from the rope part's own model (the 12 mm at each end) and kept with the part's geometry.
   - `via` entries have the same fields as band route entries (`instanceId`, `feature`, `wraps`, `h`, and for bends `line` / `wrap` / `auto`), so `resolveRoute`, wrap entries and mirroring are shared. One field differs: a band entry's `side` (`out` / `in`) means outside or inside the loop, which an open rope doesn't have. A rope entry stores `turn: 1 | -1` instead: the way the rope goes round the spot's own axis, in the spot part's frame (right-hand rule about the spot's `axis`). It is passed to the solver as `opts.turns[i]`, which `solveOnce` already takes. `turn` doesn't change when a free pulley spins on its pin, which a stored direction (`wrap`) would.
   - `via` may be any length, may name spots on any number of parts, and may name one spot twice.
   - `ropePath.js` holds `ROPE_SPECS` (length, cord, tab per part number) and `SPOOL_SPECS` (bore, pocket, drum), both filled from measured part data.

   *Alternatives considered:* a `band` with an `open` flag. Rejected: band code assumes a closed loop or a fold in many places (stretch, free length round the ring, `isFold`), and a rope has things a band never has (tabs, turns). Sharing the solver and keeping the kinds apart is less risky to the open band work.

2. **An open path from the band solver.**

   `solveBandPath` solves a closed loop of circles and points. A rope's path is solved by the same code with an `open` option: no run from the last element back to the first, and the first and last elements are points (the tab hole's centre) or the drum circle. `routeHalf` in `bandStrand.js` already routes one stretch from hook A to hook B round parts in the way; a rope is one such stretch per pair of neighbouring route entries, with no return half.

   *Alternative:* a separate rope solver. Rejected: two solvers would drift apart on wrap sides, heights and bends.

3. **Ends are joins, not spots.**

   A tab on a post is found from the post's free spans: the stretches of a pin shank, standoff or shaft not inside another part (the band spot code already finds these as `post:*`, with `setPostCover`). The tab needs 4.6 mm of free span; it sits at the clicked height, slid against the nearest part on that post. It is stored as `{ instanceId, feature: 'post:…', at }` with `at` along the post in the post part's frame.

   The audit counts a rope with a held end as held (as it counts a Gen 1 battery in its bay), and doesn't count the tab's hole on the post, or coils on the drum, as overlaps. No pin-join record is made for the tab: Play mode must not turn a rope into a rigid link, and a rope pinned by its tab hole the ordinary way (a straight rope) keeps working as it does today.

4. **Spools: a square bore, a `pocket` end and a `drum` spot.**

   - `measure-part-geometry.mjs` / the conversion give both spools a `shaft_bore` port (`shape: "square"`) at the bore end, replace the 2x spool's wrong port, and write `spoolSpecs: { axis, coreRadiusMm, flangeRadiusMm, drumSpanMm: [z0, z1], pocket: { center, radiusMm, spanMm, slotDeg } }` into part metadata. The 1x spool is measured the same way.
   - `pocket` is an end feature; `drum` is a circle spot at core radius plus half a cord, offered only to a rope whose end is in that spool.
   - A rope leaves the pocket through the flange slot and goes straight onto the drum. The short piece from pocket to drum is drawn but not counted in the route's length (it is the same for every turn count).

5. **Winding is a number, not geometry the user draws.**

   `spool.turns` (in quarter turns) and `spool.winding` (+1 or −1 about the spool's axis). Wound length = Σ over layers of turns in that layer × 2π × (core + cord × (layer + ½)). Turns per layer = ⌊drum width ÷ cord⌋ (17 on the 2x spool); layers stop at the flange (4 on a 12.55 mm flange). The cord leaves the drum tangent to its current layer, on the side `winding` gives, at the height along the drum of the last turn.

   With 0 turns the rope leaves the drum from the point facing its next spot, and `winding` has no effect until a turn is added.

   On placing: `turns = ⌊spare ÷ one turn⌋` to the nearest quarter below; the rest is slack. The stepper moves between 0 and that maximum.

   *Alternative:* let the user wrap the drum with the band builder's "wraps" control. Rejected: wraps go to 3, and a winch has many turns that change in Play.

6. **Slack is drawn as a sag on one run.**

   The longest run not touching a spot gets the whole slack as a hanging curve in the vertical plane through its two ends (a parabola whose arc length is the run plus the slack). A free end hangs as a straight line down from the last spot with the rope's remaining length. Both are cheap, and good enough to show "this rope is loose". In Play the same drawing is used each frame.

7. **Rope builder reuses the band picking session.**

   `Viewport3D.jsx` has a spot-picking mode for bands (hover lights the nearest spot; R, Shift+R and the wheel step; click adds; a dry-run placement draws the preview). The Rope builder runs the same mode with a different spot filter (ends first, then grooves, posts, edges) and calls `place_rope` with `dryRun` for the preview. `RopeBuilderPanel.jsx` is a sibling of `BandBuilderPanel.jsx`: size list, the route list with side and wraps, length figures, **Turns on spool**, **Flip winding**, and **Next**, **Back**, **Undo last**, **Done**, **Cancel** buttons so the whole flow works by touch.

   The flow is kept to "tap the start, tap what it passes, tap the end, Done". Which post is the second end isn't asked: the last post tapped is the end.

8. **Play: one pull along the whole rope, acting on every body it touches.**

   The rope is treated as weightless, frictionless and unable to stretch. So a tight rope has one pull `T ≥ 0` (newtons) along its whole length, however many pulleys it passes, and the only thing to find each step is `T`.

   `core.js` gets `playRopes(visible)` beside `playBands` (same plain-data form), and `bodyGraph.js` turns it into:

   ```
   ropes: [{ id, label, partNumber, lengthMm, cordMm,
             elements: [ … ],   // open path order, world at the start, as playBands gives them:
                                //   an end on a post: { kind: 'end', shape: 'circle', center (tab hole centre), axis, radius: 0 }
                                //   a drum:           { kind: 'drum', shape: 'circle', center, axis, radius: core + cord/2, span }
                                //   a via spot:       the band element for that feature, plus turn
             bodies: [bodyId per element],
             spool: { element: 0 | n-1, body, turns, winding, coreRadiusMm, drumSpanMm } | null,
             free: boolean,     // one end held by nothing
             pulls: boolean }]  // !free and its elements are on more than one body
   ```

   `physics.js` gets `pullRopes(h)`, called where `pullBands(h)` is called. Per step:

   1. **Path.** Move each element to the world with its body's pose (copy the first lines of `pullBands`). `path = solveBandPath(els, { open: true, turns, thickMm: cordMm, widthMm: cordMm, maxRounds: 40, tolMm: 0.02 })`. `path.contacts[i] = { a, b }` are the points where the rope arrives at and leaves element `i` (for an end, `a = b`).
   2. **Winding** (decision 9) updates `spool.turns`. `given = lengthMm − woundLengthMm(spool, turns)`, or `lengthMm` with no spool.
   3. **How far over.** `C = path.lengthMm − given` (work in metres from here). `C < 0` is slack.
   4. **Run directions.** Run `i` goes from `b_i` to `a_(i+1)`; `û_i` is its unit direction. There are `n − 1` runs.
   5. **What each body feels for a pull of 1 N.** For element `i` on body `B`: a force `−û_(i−1)` at `a_i` (toward the spot before; none for the first element) and a force `+û_i` at `b_i` (toward the spot after; none for the last). Sum per body: force `f_B` and torque about its centre of mass `τ_B = Σ (p − com_B) × f`. Several elements on one body just add. Fixed bodies are skipped.
   6. **How fast the rope is being stretched.** `Ċ = Σ over runs of û_i · (v(a_(i+1)) − v(b_i))`, where `v(p)` is the velocity of the body carrying that contact, at that point: `linvel + angvel × (p − com)`, zero for a fixed body. Use the body's velocity at the point, not the change in the contact point between steps: at the drum this makes the spool's spin count as rope taken in, so winding needs no extra term here.
   7. **How easily the bodies give.** `w = Σ over moving bodies of ( |f_B|² ÷ mass_B + τ_B · (I_B⁻¹ τ_B) )`, with `I_B⁻¹` the body's world inverse inertia. (Rapier 0.14: `body.mass()`, `body.invMass()`; for the inertia use `effectiveWorldInvInertiaSqrt()` applied twice, or `principalInertia()` with `principalInertiaLocalFrame()` and the body's rotation. Check the names against the installed package before writing this.)
   8. **Pull.** Keep `T` from the last step. Each step:
      - if `C < −0.2 mm`: `T = 0` (slack), nothing applied;
      - else apply last step's `T` first (impulse `T·h` to each body: `f_B` as a force at the contact points, see 9);
      - then repeat 4 times, for all ropes in turn (so two ropes on one body settle against each other): read velocities again, compute `Ċ`, `ΔT = γ · (Ċ + β·max(C, 0)/h) ÷ (w·h)`, `T_new = clamp(T + ΔT, 0, T_max)`, apply the impulse for `(T_new − T)`, `T = T_new`.
      
      `γ = 0.6`, `β = 0.2`, `T_max = 150 N`, all in `ropeStrength.js` marked `assumed`. `T_max` must stay above 51 N: a stalled Smart Motor (0.414 N·m) on a bare 2x spool (8.1 mm) pulls that hard, and the rope must be able to stall it.
   9. **Applying it.** For each moving body and each of its elements: `body.applyImpulseAtPoint(−û_(i−1) · J, a_i)` and `body.applyImpulseAtPoint(+û_i · J, b_i)` with `J = T·h` (or `ΔT·h`). `pullBands` applies one summed impulse at the middle of `a` and `b`; a rope applies the two separately so a pulley far from its body's hinge turns the body by the right amount.
   10. **Read-outs.** `ropeStates()` on the physics object returns `[{ id, tensionN, slackMm, turns, pathMm }]` for `playRunner.js`, the checks and the over-full warning.

   Why this form: applying the same `T` to every run of the path, at every contact, is what "a rope pulls on every part it is connected to" means, and it needs no special case for one pulley, ten pulleys, a moving block or a spool. Mechanical advantage falls out: with four runs on a block, the block feels `4T`.

   What it must reach (tasks 7.2 to 7.5): a hanging 100 g body settles within 1 s; the path stays within 0.5 mm of `given` under a steady 10 N; the pull on a moving pulley is half the load and on a four-run tackle a quarter, within 5%; nothing gains speed by itself over 10 s.

   *If it doesn't reach them, in this order:*
   - lower `γ` to 0.3 and raise the passes to 8;
   - step ropes at half the step (two `pullRopes` and two `world.step` per frame step) while any rope is tight;
   - for a rope with two ends and nothing between, use Rapier's rope joint (`JointData.rope(length, anchor1, anchor2)`) and keep `pullRopes` for routes with pulleys or a spool.

   *Alternatives considered:*
   - A spring (`T = k·C`), as bands use. Rejected: stiff enough not to look stretchy under a stalled motor's 50 N, it rings at 240 steps a second on light bodies; soft enough to be steady, a lift sags by millimetres.
   - Rapier's rope joint for everything. It limits the distance between two anchors only: no shared length over pulleys, no moving leaving point on a drum.
   - Moving bodies to fit after each step. Rejected: it fights the gear and ratchet cluster solver that keeps Swish's winch in mesh.

9. **Play: winding follows the spool's turning.**

   For a rope with a spool, each step before finding `C`:
   - `φ` = the angle, about the spool's axis and measured in the spool body's own frame, of the point where the rope leaves the drum (`contacts[drum].b` minus the drum's centre, turned into the body's frame, `atan2` in the plane across the axis);
   - `Δφ` = `φ − φ_last`, brought into −π…π (so a full turn isn't lost at the wrap);
   - `turns += −winding × Δφ ÷ 2π`. (When the spool turns in its winding direction, the leaving point moves the other way round in the spool's frame.) Confirm the sign on rig R3 before going on: `turns` must go up while the motor winds the arm in. If it goes down, the sign of `winding` stored by `stringRope` and the one used here disagree; fix it in one place.
   - if `turns` was 0 at the start of the step, set `winding` from the sign of the first non-zero `Δφ` so that `turns` goes up;
   - if `turns` drops below 0, set `winding = −winding` and `turns = −turns`: the rope has paid right out and is now winding the other way;
   - the drum element's `radius` and its height along the drum for the next step come from `turns` (decision 5): layer `= ⌊turns ÷ turnsPerLayer⌋`, radius `= core + cord × (layer + ½)`.

   This is right for a spool carried on a moving body too, because `φ` is measured in the spool's own frame.

   Nothing extra stops winding. It stops when the path can't get shorter (the far part has met something): `C` grows, `T` rises to the motor's stall, and the motor stalls by the existing rule. A drum wound past `turnsThatFit` keeps winding, is drawn full to the flange, and adds the warning "… is over full".

   `playRunner.js` redraws ropes with the live `turns` (coils from decision 5) and puts the saved shape back on leaving Play, as it does for bands.

10. **Play: a body held only by ropes.**

    After pieces are found, a body in `loose` that holds a rope end or a `via` spot becomes `roped` instead:
    - **One line of travel.** For each rope-held body, test moves of ±3 mm along the three axes of the neighbouring body it overlaps boxes with (the body it is nested in), using the collision meshes the audit already uses. If exactly one axis is clear both ways, and turning ±3° about each axis is blocked, the body is a slider on that neighbour along that axis: a prismatic joint between the two (not to the frame, as rack sliders are), with travel limits found by stepping along the axis until parts meet. This is Huey's Claw Mount on the Middle Stage.
    - **Otherwise** it is a free dynamic body (a hook on a rope): gravity when the toggle is on, pulled by its ropes, colliding as dropped parts do.
    
    The rule is pure geometry, so `check-ropes.mjs` can test it on a fixture without the physics.

    *Alternative considered:* let collisions alone guide the carriage between its rails. Rejected as the first choice: tight sliding fits jitter and jam in the physics, and the lift would be the hardest thing in Play mode to keep steady. Task 8.1 still tries it on Huey for an hour before building the slider rule, since it would need no detection at all.

11. **Import: rope pieces are gathered, then read like a band.**

    - A CAD part is a rope piece when its number is a library rope's, when its name starts with a rope's number and goes on ("228-2500-438 bent…"), or when its name matches `/rope/i` and the library lacks it ("Lift Rope", "228-2500-ROPE-OVERMOLD-MASTER").
    - Each piece's mesh is split into cord points and tab bodies (a tab is a body about 8 × 11.5 × 4.6 mm).
    - Pieces are joined when their points come within 3 mm, or when both touch the same groove.
    - Ends: each tab lying on a post (hole axis within 1 mm of the post's line) or in a spool's pocket. More than two tabs (Huey's straight rope has a tab at its overshoot end, in mid air): keep the two that sit on something.
    - Spots: `routeFromPoints` with open order, from one end to the other, on grooves, posts and edges the cord touches. Cord points further along a straight piece than the last thing it touches are dropped.
    - The straight library rope among the pieces gives the part; it is not placed as an item of its own.
    - Then `place_rope` with the ends, spots, and default winding (decision 5).

12. **MCP `place_rope`** mirrors `place_band`'s shape: listing mode, `dryRun`, the same feature names for `via`. Kept a separate tool because a rope has ends, turns and no stretch; folding it into `place_band` would make both harder to describe to a model.

13. **Ratchet winch starter.** `make-ratchet-template.mjs` writes the starter's rope with `ends: [spool pocket, null]`, four turns wound and the rest hanging, and names the starter's own instance ids (the fault in follow-up "The Ratchet winch starter's belts point at parts it doesn't have" is not repeated for the rope).

## Building it: what to reuse, in what order

This section is for whoever builds the change. Read the specs first; this says how.

**Order.** Tasks run 1 → 10. Groups 1 to 4 (data, path, engine, MCP) need no UI and are tested by `scripts/check-ropes.mjs` alone. Group 5 and 6 (UI) need 1 to 3. Group 7 (pull, winding) needs 1 to 3. Group 8 needs 7. Group 9 (import) needs 1 to 4. Do not start the UI before `place_rope` passes its checks: the builder is a thin layer over it.

**Where things are today** (line numbers as of this change's writing; search for the names if they have moved):

| Need | Reuse | Where |
|---|---|---|
| Spots on a part | `partSpots`, `spotByFeature`, `worldSpot`, `findSpots` | `src/utils/bandPath.js` 63–210 |
| Hand-entered spots | `BAND_SPOT_TABLE` | `src/utils/bandSpotTable.js` |
| The path round spots | `solveBandPath` → `solveOnce` (takes `opts.turns`) | `src/utils/bandPath.js` 234–460 |
| Route entries → world elements, post cover | `resolveRoute`, `setPostCover` | `src/utils/bandRoute.js` 92, `src/engine/core.js` 1133 |
| One stretch round parts in the way | `routeHalf` (returns `bends` or `blockedBy`) | `src/engine/bandStrand.js` 229 |
| Stringing a band, the model for `stringRope` | `stringBand` | `src/utils/bandRoute.js` 183 |
| The engine action, the model for `placeRope` | `placeBand` | `src/engine/bandRouting.js` 229 |
| Following parts after any action | `runAction` wrapper, `followBands`, `rerouteBands` | `src/engine/actions.js` 36–47 |
| Shape kinds | `SHAPE_KINDS`, `bandKind` | `src/utils/shapedParts.js` 16, `src/utils/bandShape.js` 182 |
| Play inputs | `playBands` | `src/engine/core.js` 1199 |
| Play pull | `pullBands` | `src/sim/physics.js` 1840 |
| Play redraw | band drawing in the runner | `src/sim/playRunner.js` 85–125 |
| Rack sliders (a prismatic joint) | `sliders` | `src/sim/bodyGraph.js` 397, `src/sim/physics.js` 333 |
| Loose bodies | `loose`, `looseSet` | `src/sim/bodyGraph.js` 417, `src/sim/physics.js` 154 |
| Builder state and picking | `useBandBuilder`, `bandPick` prop | `src/components/useBandBuilder.js`, `Viewport3D.jsx` 1518, 1629 |
| Builder panel | `BandBuilderPanel` | `src/components/BandBuilderPanel.jsx` |
| MCP tool and handler | `place_band` | `mcp/vexiq-mcp-server.mjs` 795, 1167; `src/utils/webMcpTools.js` 223 |
| Import of bent bands | `importBands`, `bandPiecesOf`, `routeFromPoints` | `scripts/import-cad.mjs` 346, `scripts/cad-meshes.mjs` 231, `bandPath.js` 490 |

**Rules for touching band code.** `rubber-bands` is still open. Add options and new exports; don't change what a closed band does. After any edit to a `band*.js` file run `node scripts/check-bands.mjs`.

**The `open` option of `solveBandPath`.** `solveOnce` treats elements as a ring: it reads the previous and next contact with `(i ± 1 + n) % n` (lines 313, 349, 398). With `open`:
- element 0 has no previous and element `n−1` no next: skip those reads; an end's contact is its centre (`a = b = c`), and a drum's leaving point is the tangent from the next contact, on the side `turns[0]` gives;
- the length sum leaves out the closing run (line 398 for `i = n−1`);
- skip the fold search (`foldHooks`) and the "second pass lies further out" step only when the two passes are on a groove wide enough to lie side by side; otherwise keep it;
- `points` is not closed: don't join the last point to the first.

**New functions and what they return.**

- `ropePath.js`
  - `ROPE_SPECS[partNumber] = { lengthMm, cordMm, tab: { widthMm, thickMm, lengthMm, holeRadiusMm }, name }`
  - `SPOOL_SPECS[partNumber] = { axis, coreRadiusMm, flangeRadiusMm, drumSpanMm: [z0, z1], pocket: { center, radiusMm, spanMm: [z0, z1], slotDeg } }`
  - `turnsPerLayer(spool, cordMm)`, `turnsThatFit(spool, cordMm)`
  - `woundLengthMm(spool, cordMm, turns)`: sum per layer of `turnsInLayer × 2π × (core + cord × (layer + ½))`
  - `turnsForLength(spool, cordMm, mm)`: its inverse, rounded down to a quarter turn
  - `endPlaces(part)`: `[{ feature: 'post:…' | 'pocket', … }]`, in the part's frame
  - `defaultTurn(prevPoint, spot, nextPoint)`: `1 | -1`, the side facing away from the midpoint of the two neighbours
  - `suggestRope(usedMm, withSpool)`: the shortest rope that fits (plus one turn with a spool)
- `ropeRoute.js`
  - `stringRope(ropeInst, { ends, via, spool }, instances, partOf)` → `{ position, rotation, shape, lengthMm, usedMm, spareMm, slackMm, turns, short, contacts }` or `{ error, missing }`
  - `followRopes(before, after, partOf)`, `ropeReport(inst, partOf)`, `copiedRope`, `mirroredRope`, `isRoutedRope(inst)`
- `ropeRouting.js`
  - `placeRope(state, params)` → `{ ok, state?, instanceId?, lengthMm, usedMm, spareMm, slackMm, turns, via (with the `turn` used), bends, suggestion?, needsRoute?, error? }`; with `list`, `{ ok, ends, spots }`

**How `stringRope` builds a path.**
1. Resolve `ends[0]`: a post → a point element at the tab hole's centre on the post; a pocket → the drum circle (the tab is drawn in the pocket, the path starts on the drum).
2. For each neighbouring pair of route entries call `routeHalf` to get bends round parts in the way; insert them as `auto` entries. A `blockedBy` answer ends with `needsRoute`.
3. Fill in any missing `turn` with `defaultTurn`.
4. `solveBandPath(elements, { open: true, turns })` → the taut path and `usedMm`.
5. `spareMm = lengthMm − usedMm`. With a spool: `turns` = the asked value, or `turnsForLength(spare)`; `slackMm = spare − woundLengthMm(turns)`. Without: `slackMm = spare`. `short = spare < 0`.
6. Points for drawing: coils on the drum (a helix across the drum per layer, from the pocket end), then the taut path, with the sag put on the longest free run when `slackMm > 0`, then the tab poses.
7. The shape (decision 1), with points relative to the path's middle.

**Test rigs for Play** (built from catalog parts in `check-play-mode.mjs`, as its existing small builds are; read each body's mass from the graph rather than assuming it):

| Rig | Build | Must show |
|---|---|---|
| R1 hanging weight | A beam pinned to the frame; a 12x rope from a pin on it to a pin in a loose 2x4 beam; gravity on | Loose beam is `roped`, not loose; settles in 1 s; `T = m·g` within 5%; path within 0.5 mm of 139.7 |
| R2 arm and band | A hinged arm, a band pulling it one way, a rope to a fixed pin the other way | Arm stops where the rope goes straight; slack case pulls nothing |
| R3 winch | Motor, shaft, 2x spool, rope to a hinged arm held by a band | Winding pulls the arm; released, the spool runs back; back-torque on the shaft = `T × leaving radius` within 5% |
| R4 moving pulley | Rope: fixed pin → idler pulley on a hanging block → spool | `T` = half the block's weight within 5%; 100 mm wound raises the block 50 ± 2 mm |
| R5 four-run tackle | Two pulleys on a fixed beam, two on a hanging block | `T` = a quarter of the weight within 5%; 100 mm wound raises the block 25 ± 2 mm |
| R6 three bodies | Frame pin → pulley on arm 1 → pulley on arm 2 → pulley on frame → pin on a rack slider | Driving the slider swings both arms; each arm's first movement is toward the line between its two runs |
| R7 pulley on an arm | Spool → pulley on a hinged arm → fixed pin | The arm moves though neither end is on it |
| R8 lift | The Huey fixture | Middle stage up 50 → carriage up 100 ± 3 mm; each rope carries half the carriage's weight within 10% |

**Things that will go wrong if missed.**
- The idler pulley is held by one pin, so Play makes it a hinged body of its own. Its `bodies[i]` must still pass the pull on: the pull on a free pulley goes through its pin to the body the pin is in, which the hinge joint does. Check R4 with the pulley left as its own body.
- `turn` is about the spot's axis in the part's frame. Mirroring a part flips its axis sense: `mirroredRope` must flip `turn` when the mirrored part's axis comes out reversed (see how `mirroredRoute` treats `wrap`).
- A rope's tab is drawn on a post but makes no pin join. Don't let seating or Fix assembly treat the rope as a part to move onto the pin.
- Catalog units are mm; the physics works in metres (`MM = 0.001`). `C`, `w` and `T` in decision 8 are in metres, kilograms and newtons.
- In the build, the rope copy's `position` is the middle of its path. Selecting, focusing and exploding use it; nothing else should.

## Risks / Trade-offs

- [The rope's pull rings or runs away at the physics step] → the pull is carried from step to step and only corrected by a share (`γ`) of what the bodies' own masses say is needed, it is capped, and rigs R1 to R8 give numbers it must reach. Decision 8 lists three fallbacks in order.
- [Many pulleys make each step slow] → one path solve per rope per step (as bands), 4 cheap passes after it. A 12-spot rope is checked to cost under 1 ms a step in task 7.4.
- [The rope's pull upsets Swish's winch cluster (ratchet, swinging gears)] → the rope loads the spool through an ordinary impulse on the spool's body, the same way the hold test already loads it with 0.05 to 0.6 N·m. Task 7.6 runs the hold test again with the rope and the arm bands in place.
- [The one-line-of-travel test misreads a carriage] (clear on two axes, or blocked on all three because VEX's CAD has tight fits) → moves are tested with the tight-fit allowance (0.5 mm) the audit uses; a body that fits no rule falls back to a free body and Play lists "… hangs on its rope; it isn't held in a guide". Huey is the fixture.
- [Huey's carriage can't come down: gravity is off by default] → with ropes holding a body and gravity off, Play shows one line: "Turn on gravity so parts on ropes can come down."
- [VEX's drawn rope is shorter than the real one (Swish: 225 of 292 mm)] → the spare is wound on the spool, which is what a real builder does with it, and the report says how many turns.
- [Two open changes underneath] → this change calls `rubber-bands` code that may still move. Tasks touch band files only by adding options (`open`), never changing closed-loop behaviour, and `check-bands.mjs` runs after each such task.
- [Rope too thin to tap] → picking works on ends and spots, not on the cord; a placed rope is selected from the Outline or by its tabs, and gets a wider invisible pick strip (as chains have).

## Migration Plan

- Catalog and metadata are regenerated (`npm run convert` for the ropes and spools, `npm run index-metadata`). Port ids on the rope tabs stay as they are; the stray `hole.-x…` ports go. A saved build that pinned something into that stray port keeps its parts where they are; the audit will list that pin as not in a hole.
- The 2x Wide Spool's old port (`hole.+z.0_0_4`, alias `hole_1`) is replaced by the square bore, with the old id kept as an alias so the Ratchet winch starter and Swish imports still seat on their shaft.
- Saved builds with straight ropes open unchanged. Nothing to roll back in saved data: removing the `rope` kind would leave routed ropes as straight ropes at their saved place.

## Open Questions

- The exact values of `γ`, `β` and the pull cap (`ropeStrength.js`): assumed now, tuned on rigs R1 to R8, and a real rope's strength measured later, as for bands.
- Whether the idler pulley should be drawn turning as rope passes. Left out; it changes nothing else.
