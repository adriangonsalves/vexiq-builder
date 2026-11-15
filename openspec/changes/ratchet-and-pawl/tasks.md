## 1. Measure the parts

- [x] 1.1 Set up: `npm install`; in a worktree link `VEX-IQ-All-Parts/` and `VEX-IQ-All-Control/` from the main checkout. Verify `node scripts/check-gear-meshing.mjs` and `node scripts/check-play-mode.mjs` pass before any change.
- [x] 1.2 Add `measureRatchet` to `scripts/measure-part-geometry.mjs` (tooth count, tip and root radius, tooth phase, face span, lean; design §1). Verify by printing both ratchets: 16 and 40 teeth, tip radius within 0.2 mm of the bounding box, and a clear lean (steep and sloped sides differ) or, if the sides match, `lean: 0` with a note added to design §1.
- [x] 1.3 Add `measurePawl` (tip point, tip direction, thickness, holes). Verify the tip lies on the part's outline below the hole row and the thickness matches the bounding box (4.57 mm).
- [x] 1.4 Call both from `measureShapes` in `scripts/index-part-metadata.mjs`, writing `ratchetSpecs` and leaving `gearSpecs.measured` false. Run `npm run index-metadata` twice and verify the three records are identical between runs and `check-gear-meshing.mjs` still passes ("ratchets are not meshing gears").

## 2. Holding rule and spots

- [x] 2.1 Create `scripts/check-ratchet-pawl.mjs` with one case per scenario of "Measured ratchet and pawl data", "When a pawl holds a ratchet", "Set pawl" (the spot rules) and "A placed pawl swings onto its ratchet", using real catalog data. Verify it runs and fails only on cases not built yet.
- [x] 2.2 Create `src/utils/ratchetPawl.js` with `pawlRelation` (design §2). Verify the "Pawl in the teeth", "Ratchet turned over", "Pawl out of plane" and "Pawl facing the wrong way" cases pass.
- [x] 2.3 Add `pawlRestTurn`. Verify that for pivots 15–30 mm from a 16 Tooth Ratchet, at 12 angles round it, every rest it gives has the pawl within 0.1 mm of touching the ratchet's outline at the tip, no overlap with the ratchet by the engine's check (tight fits allowed), and the ratchet pose untouched; out of reach, or body touching first, gives `null`.
- [x] 2.4 Save the Swish winch as a fixture (`scripts/fixtures/swish-winch.json`: the `Catapult Winch` parts and poses from the import report) and verify `pawlRelation` says the CAD pawl holds the CAD ratchet with the free direction that matches winding (arm shaft turning anticlockwise seen from +Z when the motor shaft turns clockwise). If it misses, record by how much and apply the mitigation in design "Risks".
- [x] 2.5 Add `pawlSpots` (design §3). Verify: a ratchet between two plates gives spots that all hold, none overlapping; a bare shaft gives none; a spot with a beam in the way is marked blocked with the beam named; spots come out in order round the ratchet. Check the 40 Tooth Ratchet too and close the design's open question.

## 3. Engine, audit and the assistant's tool

- [x] 3.1 Add `listPawlSpots` and `setPawl` to `src/engine/core.js` (one history step; the ratchet never moves). Verify in the check script: set, undo, set again steps to the next spot.
- [x] 3.2 Add the audit's `ratchets` list and its issues (`src/utils/auditIssues.js`): holding pair with free direction, wrong way, two pins, no pin, nothing pressing it. Leave parts with `ratchetSpecs` out of the meshed gear pairs. No special overlap allowance (design §6). Verify the three "Audit reports ratchets and pawls" scenarios, with `check-audit-issues.mjs` and `check-tight-fits.mjs` still passing.
- [x] 3.3 Swing a placed pawl in `settlePlacement` (`src/utils/placementFit.js`), with the Alt / Free move / Rotate exceptions. Verify the three "A placed pawl swings onto its ratchet" cases.
- [x] 3.4 Add `set_pawl` to `mcp/vexiq-mcp-server.mjs` and `src/utils/webMcpTools.js`, and make `place_part` / `place_parts` swing pawls. Add cases to `scripts/check-mcp-tools.mjs`. Verify "Listing spots", "Placing at a spot" and "Blocked spot" pass.
- [x] 3.5 Add the ratchet and pawl line to `AGENTS.md` "How pieces are used" (between the markers). Verify a fresh MCP connection shows it in the server's instructions.

## 4. In the app

- [x] 4.1 Tools → **Set pawl** in `src/components/ToolsMenu.jsx`, greyed out with a reason unless a pawl is selected and a ratchet is selected or the only one in reach. Verify "Tools menu" and "Set pawl turned off" in the running app.
- [x] 4.2 Double-click a ratchet with a pawl selected moves the pawl to the spot nearest the click (`Viewport3D.jsx`, beside the 90° gear partner double-click). Verify "Double-click the ratchet", "Next spot" and "Nothing to pin to", and that double-clicking a ratchet with a non-pawl selected still mates as before.
- [x] 4.3 Join on the context bar for a selected pawl with a ratchet in reach (`src/utils/contextToolbarItems.js`). Verify "On a tablet" at a tablet-sized window with touch emulation, and `check-context-toolbar.mjs` passes.
- [x] 4.4 Draw the direction arrow while a holding pawl or its ratchet is selected. Verify "Selecting the ratchet" from two views, and that turning the ratchet over flips the arrow.
- [x] 4.5 Verify dragging a pawl onto a pin beside a ratchet swings it on, Alt doesn't, and a hand turn in Rotate mode is kept.

## 5. Play mode: ratchets

- [x] 5.1 Add cases to `scripts/check-play-mode.mjs` for every scenario of "Ratchets turn one way", built from catalog parts (motor, shaft, ratchet, pawl on a frame pin, band, arm). Verify they run and fail only because the feature isn't built.
- [x] 5.2 Add `ratchets` to `src/sim/bodyGraph.js` from the audit's list, with entry warnings for wrong-way pawls and pawls on two pins. Verify the graph for the check build has one ratchet with the right bodies and `freeSign`.
- [x] 5.3 Add `holdRatchets` to `src/sim/physics.js`: the stop, the drag, the pawl's rocking pose, down/up (design §7). Verify "Free direction", "Held direction stalls the motor", "Ratchet holds a load" and "Pawl on two pins".
- [x] 5.4 Verify "Lifting the pawl lets go" with a second motor's beam pushing the pawl, and that the pawl drops back under its band. (The check stands in for the second motor's beam with an outside push on the pawl's body, `push` in `src/sim/physics.js`: lifting its tip at 6 rad/s to 1.5 mm clear and holding it there. Covered: gravity, a band (the audit's `pressed`), and neither.)
- [x] 5.5 Hold a fixed-holder ratchet one way in `src/sim/kinematic.js` and list what the fallback doesn't run. Verify the free and held direction cases with the fallback engine.
- [x] 5.6 Show the new entry warnings in `src/components/PlayPanel.jsx`. Verify in the app with a pawl pinned twice.

## 6. Play mode: swinging arm and the release

- [x] 6.1 Add cases to `scripts/check-play-mode.mjs` for "Gears on a swinging arm", "Gears come into and out of mesh" and "Ratchet release on a swinging arm" (a small three-shaft build from catalog parts, plus the Swish winch fixture). Record Clawbot and Flop motor and shaft speeds before any change for task 6.6.
- [x] 6.2 Mark gear links whose shaft holder can move as `carried` and hold them at the teeth (design §8). Verify the three "Gears on a swinging arm" scenarios, with arm gear speed steady within 2% over 5 s.
- [x] 6.3 Add `maybeMeshes` and the mesh-distance stop, engage and release (design §9). Verify "Swinging into mesh", "Swinging out of mesh" and "Fixed gears unchanged", and that the arm doesn't chatter at the stop (engaged for the whole 5 s of winding).
- [x] 6.4 Run the small three-shaft build and the Swish winch fixture: print the bodies and hinges first and confirm the arm, shaft A, shaft B and the pawl are separate bodies. Verify "Winding", "Holding" and "Releasing".
- [x] 6.5 Import Swish (`node scripts/import-cad.mjs "4094-viqc 2024-2025 hero bot swish" --clear`), audit it, and run its winch motors in Play mode in the app: forward, stop, reverse. Verify the "Swish winch" scenarios of both specs, with screenshots from two views of the arm in and out of mesh.
- [x] 6.6 Verify nothing else moved: Clawbot and Flop speeds match the values recorded in 6.1 within 1%, and every `node scripts/check-*.mjs` passes.

## 7. Help and docs

- [ ] 7.1 Add "Ratchets and pawls" to `src/help/pages/gears.md` and the one-way and release parts to `play-mode.md`, with `tags:`, `answers:`, `src/help/coverage.json` and a Set pawl chip in `src/help/controls.js`. Verify `node scripts/check-help.mjs`, `check-help-tags.mjs` and `check-help-context.mjs` pass.
- [ ] 7.2 Take the pictures (a set pawl with its arrow; the release arm in mesh): `VEXIQ_BASE=/vexiq-builder/ npm run build:static`, then `node scripts/capture-help-shots.mjs <names>`. Verify the pictures show in the Help page on the static preview (port 5174).
- [ ] 7.3 Update `features.md` (part data, Set pawl, audit lines, Play mode). Verify each new spec requirement has a matching line.
- [ ] 7.4 Add leftovers to `openspec/follow-ups.md` (rope winding and firing the catapult, anything found and not fixed). Verify `openspec validate ratchet-and-pawl --strict` passes.
