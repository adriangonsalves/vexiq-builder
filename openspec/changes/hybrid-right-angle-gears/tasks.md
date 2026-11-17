## 1. Measure the hybrid gears

- [x] 1.1 Add `measureHybridFace(part, gearSpecs)` to `scripts/measure-part-geometry.mjs` (design decision 1): the extended face, `plainZ`, `tipZ` and `stretchMm` in the part's frame. Verify by printing the values for the eight hybrid gears and the plain 12 and 24 Tooth Gears: every hybrid reports face +1 and a stretch that holds both 2.45 and 3.3 mm (Swish's pair); the plain gears report nothing.
- [x] 1.2 Call it from `measureShapes` in `scripts/index-part-metadata.mjs` for spur gears, storing `gearSpecs.hybrid` only when found. Run `npm run index-metadata` twice and verify the eight records carry `hybrid` and agree between runs within 0.01 mm, and that `git diff public/` shows no change outside those eight records.

## 2. The meshing rule

- [x] 2.1 Add cases to `scripts/check-right-angle-gears.mjs`, one per new scenario in `specs/right-angle-gears/spec.md` ("Hybrid gears are measured", "Swish's intake gears", "Hybrid face turned away", "Hybrid with a plain spur gear at 90°", "Hybrid gear slid onto a shaft", "Four spots round a hybrid gear"), using the Swish starter's poses for Swish's pair. Verify the script runs and fails only on those cases.
- [x] 2.2 In `src/utils/gearMeshing.js`: `rightAnglePair` returns `'hybrid'` for two hybrid gears of one module, and `worldToothed` adds the `hybrid` face and stretch to the gear object (decisions 2–3). Verify `node scripts/check-gear-meshing.mjs` and the existing right-angle cases still pass.
- [x] 2.3 Route perpendicular hybrid pairs to the 90° path and add `hybridContact` (decisions 4–5), with `rightAngleMeshKind` and `rightAngleNearMiss` accepting the pair. Verify the "Which gears mesh at 90°" hybrid cases pass, `meshRatio` gives −2 or +2 for Swish's pair (24 to 12) with the teeth moving together at the contact point, and parallel hybrid pairs give the same results as before (the gear-meshing cases).
- [x] 2.4 Verify `meshTurn` leaves no contact for Swish's pair and for a 12 with a 36 Tooth Hybrid placed by the rule, at several starting angles, using the engine's collision check. If a correctly meshed pair still reports contact, stop and raise it before group 4 (design, Risks).
- [x] 2.5 Add the `'hybrid'` case to `meshSpots` (decision 6). Verify "Four spots round a hybrid gear": axes along ±X and ±Z for a Y-axis partner, each spot in mesh range with tooth error under a quarter tooth, and a blocked spot dropped.

## 3. Placement, jump, Join and the assistant

- [x] 3.1 Check that placement turning (`src/utils/placementFit.js`), the drag preview and loose-gear jump, double-click on the partner and Auto Join (`src/components/Viewport3D.jsx`), and `mesh_right_angle` (`src/engine/core.js`) take the new pair through `rightAnglePair` and `meshRelation` with no other change, and fix any guard that still names only bevel, crown and worm. Verify "Hybrid gear slid onto a shaft" in the check script, and `mesh_right_angle` listing four spots for a 12 Tooth Hybrid round a 24 Tooth Hybrid and placing one with no overlap (`node scripts/check-mcp-tools.mjs` with a new case).
- [ ] 3.2 In the running app at 5173: drag a loose 12 Tooth Hybrid Gear near a 24 Tooth Hybrid Gear's extended face and release, then select another and tap Join. Verify "Loose hybrid gear dragged near another" and Join, with screenshots from two views showing both extended faces toward the crossing and no overlap flagged, and that one undo puts the gear back. *Partly done, in the static preview (5174; the dev server shares the user's build): Join moves a loose 12 Tooth Hybrid to the spot beside a 24 Tooth Hybrid (15.95 mm out, 9.65 mm up, axis toward it) and one undo returns it to (30, 10, 0); pictures from two views (the Join screenshot and the Help picture `gears-hybrid-corner`). Not done: the drag (the script couldn't pick the gear without the dev server's point helper), see follow-ups.*
- [x] 3.3 Update the `mesh_right_angle` tool description (`mcp/vexiq-mcp-server.mjs`, `src/utils/webMcpTools.js`) and its error's list of pairs, and the "Gears at 90°" line in `AGENTS.md` (hybrid with hybrid of the same tooth size, extended faces toward each other). Verify `node scripts/check-mcp-tools.mjs` passes and the server's connect instructions show the line.

## 4. Play mode and Swish's intake

- [x] 4.1 Add `'hybrid'` to the 90° branch in `src/sim/bodyGraph.js` (decision 7). Verify a case in `scripts/check-play-mode.mjs` for "Hybrid gears turn a corner": a motor at 120 rpm on a 24 Tooth Hybrid turns a 12 Tooth Hybrid at 90° at 240 rpm, the teeth moving together.
- [x] 4.2 Verify "Swish's intake runs" with a case in `scripts/check-play-mode.mjs` on the Swish starter (decision 8): the intake roller turns at twice the intake motor's shaft speed within 5%, and the other way on reversing. If it doesn't, name the first body between motor and roller that doesn't turn, fix the cause or record it in `openspec/follow-ups.md`, and say which in design.md.
- [x] 4.3 Run Swish's intake in Play mode in the app at 5173 and verify the roller and its intake bands turn, with a screenshot. *Run in the static preview (5174), since the dev server at 5173 shares the user's open build: Keep ticked and full throttle on the intake motor, it runs at 109 rpm and isn't stalled (it stalled before this change). That the roller turns at 2× is checked in `check-play-mode.mjs`.*

## 5. Docs and checks

- [x] 5.1 Help: add hybrid gears at 90° to `src/help/pages/gears.md` (what pairs, which face, Join), its `tags:` and `answers:`, `src/help/coverage.json`, and a picture (`VEXIQ_BASE=/vexiq-builder/ npm run build:static`, then `node scripts/capture-help-shots.mjs <name>`). Verify `node scripts/check-help.mjs`, `check-help-tags.mjs` and `check-help-context.mjs` pass.
- [x] 5.2 `features.md`: hybrid gears at 90° under the 90° gears entry. Verify it names the files this change touches.
- [x] 5.3 Run every `node scripts/check-*.mjs`. Verify all exit 0.
- [x] 5.4 Add leftovers to `openspec/follow-ups.md` (a hybrid with a plain spur gear at 90° if the models suggest it works, anything found and not fixed). Verify `npx openspec validate hybrid-right-angle-gears --strict` passes.
