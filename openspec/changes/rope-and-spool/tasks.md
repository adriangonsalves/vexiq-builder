## 1. Part data

- [ ] 1.1 Measure both spools from their models in `scripts/measure-part-geometry.mjs`: axis, core and flange radius, drum span, square bore span, pocket centre, radius, span and slot angle. Write them as `spoolSpecs` in part metadata. Verify the 2x Wide Spool reads core 7.5 mm, flange 12.55 mm, drum about 21 mm, pocket at the +z end, and print the 1x Wide Spool's numbers into design.md's Context.
- [ ] 1.2 Give both spools a square `shaft_bore` port at the bore end (conversion rule or override), replacing the 2x spool's wrong round port and keeping `hole.+z.0_0_4` / `hole_1` as an alias. Run `npm run convert` for the two parts and `npm run index-metadata`. Verify in the app that a 1x and a 2x Wide Spool each seat on a 4x Pitch Shaft, and that `node scripts/check-starter-assemblies.mjs` and `check-connection-points.mjs` pass.
- [ ] 1.3 Measure the ropes: hole-to-hole length, cord thickness, tab size, and cut the tab mesh from each end. Remove the stray `hole.-x…` port from the 12x, 20x, 48x and 120x ropes and centre the 20x rope's origin. Verify each rope has exactly two ports and its length is (N − 1) × 12.7 mm.
- [ ] 1.4 Measure the .5x Pitch Idler Pulley's groove radius and width and store the groove (not the rim) as its band/rope spot radius. Verify a band placed on its groove with `place_band` still passes `node scripts/check-bands.mjs`.
- [ ] 1.5 Save fixtures from the dry-run imports: `scripts/fixtures/swish-rope.json` (Catapult Winch and Catapult Arm parts, the rope pieces' points) and `scripts/fixtures/huey-lift.json` (Holder, Middle Stage and Claw Mount parts, rope pieces' points). Verify each loads in a new `scripts/check-ropes.mjs` that for now only prints the rope pieces' ends and exits 0.

## 2. Rope path and shape

- [ ] 2.1 Add `src/utils/ropePath.js`: `ROPE_SPECS`, `SPOOL_SPECS` (from metadata), `isRopePart`, `isSpoolPart`, `woundLengthMm(spool, turns)`, `turnsThatFit(spool, cord)`, `maxTurnsFor(spareMm)`. Verify with cases in `check-ropes.mjs`: 2x spool holds 17 turns in a layer, one first-layer turn is about 51 mm, a 120x rope needs a second layer.
- [ ] 2.2 Add the `open` option to `solveBandPath` / `solveOnce` as design.md "The `open` option" describes (no closing run; first and last elements are points or a drum circle; per-element `turns`). Verify `node scripts/check-bands.mjs` still passes unchanged; a new case solves pin → groove → pin with the fixture's Huey numbers to within 2 mm of VEX's pieces; a case with 12 grooves in a zigzag on three parts solves with every groove wrapped on the `turn` given; and a case naming one groove twice puts the two passes side by side.
- [ ] 2.2a Add `defaultTurn` (the side facing away from the midpoint of the spots before and after). Verify pin below, pulley, pin below gives the top of the pulley, and that flipping `turn` gives the bottom with a longer path.
- [ ] 2.3 Add end places: free spans of posts that can take a tab (4.6 mm), and a spool's `pocket`; add the `drum` spot. Verify on the fixtures: Swish's arm shaft offers a span beside its collar, the spool offers `pocket`, a pocket holding a rope isn't offered.
- [ ] 2.4 Add the path for winding: coils across the drum by layer, the leaving tangent for a winding direction, and the straight leave at 0 turns. Verify the path length equals route + wound length within 1 mm for 0, 1.25 and 20 turns.
- [ ] 2.5 Add slack and free-end drawing (sag on the longest free run; free end straight down). Verify the sagging curve's length equals the run plus the slack within 1 mm.
- [ ] 2.6 Add `src/utils/ropeShape.js` (`rope` kind: `shapeMesh` sweeps the cord and adds the tabs; `mirror`; `describe`) and register it in `shapedParts.js`. Verify a rope with a hand-written shape draws in the app with both tabs on their posts, and its thumbnail renders.

## 3. Placing a rope in the engine

- [ ] 3.1 Add `src/utils/ropeRoute.js`: `stringRope(ropeInst, { ends, via, spool }, instances, partOf)` following the seven steps in design.md "How `stringRope` builds a path", returning the shape, used length, spare, slack, turns and `short`. Reuse `resolveRoute` and `routeHalf` for the way round parts. Verify on the Swish fixture: used about 225 mm, 1.25 turns; on Huey: about 270 mm, about 22 mm slack; and on a four-pulley block and tackle built from catalog parts: the route keeps all four grooves in order and the used length matches a hand sum of its runs and arcs within 1 mm.
- [ ] 3.2 Add `src/engine/ropeRouting.js` `placeRope(state, params)` with listing mode, `dryRun`, Choose for me, too-short refusal naming the rope that fits, and `allowShort`. Register the action in `actions.js` as one history step with the label from the spec. Verify the three MCP scenarios of the spec as cases in `check-ropes.mjs`.
- [ ] 3.3 Follow parts: in `core.js`, route ropes again when a part on their route moves, turns, is hidden or removed, by the rules in "Ropes follow their parts" (slack first, then turns, then too short; removed end becomes free). Verify with cases for each of the three scenarios, and that each is one undo.
- [ ] 3.4 Mirror, duplicate and clone: carry ropes with their parts, flip `winding` on mirror, flip each `turn` whose part's axis comes out reversed, straight rope when copied alone. Verify the "Mirror a lift" scenario on the Huey fixture: the mirrored rope goes over the top of its pulley, as the first does.
- [ ] 3.5 Audit: a rope with a held end is held; tab-on-post and coils aren't overlaps; list too-short ropes, an end in a spool with no shaft, and a path through a part. Verify with `check-ropes.mjs` cases and that `node scripts/check-audit-issues.mjs` and `check-fix-assembly.mjs` pass.
- [ ] 3.6 Saving: confirm route, turns and path survive save, load, build library and history; a missing part frees that end or flattens the rope with a message; old builds open unchanged. Verify with `check-ropes.mjs` cases and `node scripts/check-build-library.mjs`, `check-history.mjs`.

## 4. MCP

- [ ] 4.1 Add `place_rope` to `mcp/vexiq-mcp-server.mjs` (tool list near `place_band`, handler beside its handler) and `src/utils/webMcpTools.js`, and rope fields to `get_assembly` / `get_part_details`. Verify with new cases in `node scripts/check-mcp-tools.mjs`, including a `via` of four pulleys with no `turn` given, whose reply lists the `turn` chosen for each.
- [ ] 4.2 Add a rope line to the "How pieces are used" section of `AGENTS.md` (sent to MCP clients): ends go on a pin, standoff or shaft or in a spool's pocket; `via` lists any number of pulleys, posts and edges in order; use `place_rope`, not hand placing; spare winds on the spool; in Play the rope pulls every part it touches. Verify the server's instructions show it on connect.

## 5. Rope builder

- [ ] 5.1 Add Tools → Rope builder and `RopeBuilderPanel.jsx` (sizes, Choose for me, route list with Flip side and wraps, length / used / spare line, Next, Back, Undo last, Done, Cancel). Reuse the band picking mode in `Viewport3D.jsx` with the rope spot filter and `place_rope` dry-run preview. Verify the "Winch rope in three taps" and "Lift rope over a pulley" scenarios in the app at 5173, with screenshots.
- [ ] 5.2 Add **Turns on spool** and **Flip winding** to the panel when the route has a spool, and **Flip side** on each spot; a tap on a groove or post takes its side from where it was tapped. Verify "Fewer turns", "Flip winding", "Flip a side", "Three pulleys on three parts" and "Block and tackle" in the app, with screenshots.
- [ ] 5.3 Touch: check the whole flow on tablet and phone widths with taps only (no keyboard, no wheel); buttons at least 44 px. Verify the "No keyboard" scenario at 800 px and 390 px wide, with screenshots.
- [ ] 5.4 Add **Rope between these** to the context toolbar and Tools menu for two selected parts. Verify the "Spool and shaft selected" scenario and `node scripts/check-context-toolbar.mjs`.

## 6. Editing

- [ ] 6.1 Handles on a selected rope's ends and spots; drag to move, drag off to free an end; a wider pick strip along the cord. Verify "Move an end" in the app and that one undo restores it.
- [ ] 6.2 Inspector: size, used, spare, slack, ends and spots, Turns on spool, Flip winding. Tools → Flatten works on a rope. Verify "Flatten" and that each Inspector change is one history step.

## 7. Play mode: pull and winding

- [ ] 7.1 `core.js` `playRopes(visible)` beside `playBands`; `bodyGraph.js`: list `ropes` in the form of design.md decision 8 (elements, `bodies` per element, `spool`, `free`, `pulls`); `kinematic.js`: list "ropes don't pull without physics". Verify with cases in `node scripts/check-play-mode.mjs` for "Rope on one body", a free-ended rope (`pulls` false) and the no-physics warning.
- [ ] 7.2 Add `src/sim/ropeStrength.js` (`γ`, `β`, passes, pull cap, slack tolerance, each marked `assumed`) and `pullRopes(h)` in `physics.js` beside `pullBands`, following decision 8 steps 1 to 10, and `ropeStates()`. Confirm the Rapier 0.14 names for a body's mass and world inverse inertia first. Verify rigs R1 and R2: the hanging body settles within 1 s, `T = m·g` within 5%, the path stays within 0.5 mm of the rope's length, the slack case applies nothing, and over 10 s at rest no body gains speed. If a number is missed, work down decision 8's fallback list and record which one was needed in design.md.
- [ ] 7.3 Winding (decision 9): track each spool's turns from its leaving angle in the spool's own frame; winding from empty either way; flipping through zero; the drum radius and height from the turns; the "over full" warning. Verify rig R3 for "Winding pulls the arm", "Motor stops with no ratchet", "Fully wound" and "Paid out and wound the other way", and that the back-torque on the spool's shaft is `T ×` the leaving radius within 5%.
- [ ] 7.4 Many pulleys and every body: verify rigs R4 (moving pulley: half the weight, 100 mm wound lifts 50 ± 2 mm), R5 (four runs: a quarter, 25 ± 2 mm), R6 (three pulleys on three bodies: both arms swing toward the line between their runs) and R7 (a pulley on an arm moves the arm). Run R4 with the idler pulley left as its own hinged body. Time a 12-spot rope: `pullRopes` under 1 ms a step.
- [ ] 7.5 Two ropes on one body: verify on rig R8 (the Huey fixture, sliders from task 8.2 or a hand-made prismatic joint until then) that each rope carries half the carriage's weight within 10% and the 4 passes leave neither rope slack.
- [ ] 7.6 `playRunner.js`: redraw ropes each frame with live turns, sag and tabs from `ropeStates()`; restore on leaving Play. Verify "Rope follows the arm" and "Leave Play" in the app, with no new history step.
- [ ] 7.7 Swish: import it, run the winch forward, stop, reverse. Verify the "Swish winds, holds and fires" scenario, and that the ratchet hold cases already in `check-play-mode.mjs` still pass with the rope and arm bands loading the spool. Screenshots from two views of arm down and arm fired.

## 8. Play mode: bodies held by a rope

- [ ] 8.1 Time-boxed try (one hour): make Huey's Claw Mount a plain dynamic body guided only by collisions, and watch it over a full lift. Record in design.md decision 10 whether it holds steady. If it does, keep it and skip 8.2; if not, go on.
- [ ] 8.2 One-line-of-travel rule in `bodyGraph.js`: for each rope-held loose body, test ±3 mm moves and ±3° turns against its neighbour with the audit's meshes and tight-fit allowance; make it a slider on that neighbour with travel limits, else a free body with the "hangs on its rope" note. Verify on the Huey fixture that the Claw Mount is a slider on the Middle Stage along the lift direction, and that a hook on a rope is a free body.
- [ ] 8.3 `physics.js`: prismatic joint between a roped slider and its neighbour, with limits; free roped bodies as dynamic bodies with gravity when on; the gravity hint line in the Play panel. Verify "Carriage in its rails", "Hook on a rope" and "Gravity off".
- [ ] 8.4 Huey: import it, turn gravity on, raise and lower the lift. Verify "Huey's lift doubles the travel", "Lift lowered" and "Two ropes on one body" by reading the carriage's and middle stage's heights and `ropeStates()`, and with screenshots from two views.

## 9. CAD import

- [ ] 9.1 `scripts/cad-meshes.mjs` / `import-cad.mjs`: find rope pieces, split cord and tabs, join pieces, read ends and spots, drop overshoot, and call `place_rope`; stop placing the straight rope as an item and stop listing rope pieces as left out; add the rope lines to the report. Verify with `--dry-run` on both robots that the report matches the two import scenarios.
- [ ] 9.2 Add `cad-frames.json` entries the rope and spool need, if `node scripts/fit-cad-frames.mjs` on Swish and Huey asks for any. Verify both report "Every part type has a checked frame entry" for ropes and spools.
- [ ] 9.3 Import Swish and Huey with `--clear`, run `audit_assembly`, and take screenshots from two views of each rope. Verify tabs sit on their posts, no rope passes through a part, and `node scripts/check-cad-import.mjs` passes with new rope cases.

## 10. Starter, docs and checks

- [ ] 10.1 Ratchet winch starter: `make-ratchet-template.mjs` writes the rope with its end in the spool's pocket, four turns wound, far end free, naming the starter's own ids. Verify the "Ratchet winch starter" scenario and `node scripts/check-starter-assemblies.mjs`.
- [ ] 10.2 Help: a Ropes page (Rope builder, winding, slack, editing), additions to the Play mode page (ropes, spools, parts on ropes, the gravity hint), `tags:`, `answers:`, `coverage.json`, control chips in `src/help/controls.js`, and pictures (`VEXIQ_BASE=/vexiq-builder/ npm run build:static`, then `node scripts/capture-help-shots.mjs`). Verify `node scripts/check-help.mjs`, `check-help-tags.mjs` and `check-help-context.mjs` pass.
- [ ] 10.3 `features.md`: a Ropes section and the `place_rope` entry. Verify it names every file added by this change.
- [ ] 10.4 Run every `node scripts/check-*.mjs`. Verify all exit 0.
- [ ] 10.5 Add leftovers to `openspec/follow-ups.md` (measured rope strength, pulleys turning, anything found and not fixed). Verify `openspec validate rope-and-spool --strict` passes.
