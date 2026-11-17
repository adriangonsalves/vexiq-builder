## 1. Part data

- [x] 1.1 Measure the continuous rack's clip seat and both brackets' channels from their models (`clipSpecs`, `channelSpecs`: direction, cross-section planes, span, `measured`) in `scripts/measure-part-geometry.mjs`, written by `scripts/index-part-metadata.mjs`; show them in `get_part_details`. Verify: `npm run index-metadata` reports all three measured, and a new `scripts/check-linear-motion.mjs` shows that with the Huey starter's poses each 1x18 Beam's cross-section lies inside every bracket channel and rack seat it passes through within 0.5 mm.
- [x] 1.2 Measure which end of each idler pin is smooth (`fastenerSpecs.smoothEnd`) for the seven idler pins named in the spec. Verify: a check lists each pin's smooth end, and on Huey each 0x2 Idler Pin's smooth end is the one inside its gear.

## 2. Joints in the engine

- [x] 2.1 Find clips (rack on beam) beside `seatedPairs` in `src/engine/core.js` and treat them as rigid joints for unsecured parts, islands, groups and `playInputs`. Verify in `check-linear-motion.mjs`: Huey's four racks are joined to their 1x18 Beams and not unsecured; a rack moved 3 mm off its beam is unsecured again.
- [x] 2.2 Find slides (beam in bracket channel) and report them from the audit (`slides`: the two sides, direction, travel each way). A part held only by slides is held. Non-parallel brackets on the same two assemblies lock and are reported. Verify: Huey's Middle Stage is on the Holder by one slide through six brackets and is not an island; a beam beside a bracket makes no slide; a rig with two brackets at 90° reports the lock.
- [x] 2.3 Idler pins: the smooth end seats in a gear's, sprocket's, pulley's or wheel's centre hole (`turns: true`). Verify: Huey's two 36 Tooth and two 48 Tooth idler gears are held; an ordinary 1x1 Connector Pin in a gear's centre holds nothing; a smooth end less than 2 mm in holds nothing; `node scripts/check-audit-issues.mjs` and `check-mcp-tools.mjs` still pass.
- [x] 2.4 Audit wording in `src/utils/auditIssues.js`: the slide note and the locked-brackets problem. Verify with cases in `check-audit-issues.mjs`.

## 3. Play mode

- [x] 3.1 `src/sim/bodyGraph.js`: racks join their beam's body; `slideJoints` between bodies with limits from the collision search (design decision 3); pieces found across slide joints; a body on a slide is not loose or roped; idler gears hinge on their pins. Verify in `check-play-mode.mjs`: on Huey the graph has one slide joint between the Holder's body and the Middle Stage's body with travel within 3 mm of a hand measurement of the starter, two rack links onto the stage's body, hinges for the four idler gears, and no "isn't held" or "isn't joined" warning for racks, stage or idler gears.
- [x] 3.2 `src/sim/physics.js`: a prismatic joint with limits for each slide joint, and the rack coupling for a rack on a body joined by a slide (design decisions 4 and 5). Confirm the Rapier 0.14 names for prismatic limits first. Verify "Huey's lift rises" (one gear turn raises the stage 39.9 ± 2 mm, both sides together, no tilt over 0.2°), "Lift lowered", "Stops" (within 3 mm of the audit's travel, motor stalled) and "Stage at rest".
- [x] 3.3 Stopping modes through the rack: verify "Lift held" (Hold, gravity on: within 1 mm over 3 s), and that Brake creeps and Coast falls to the lower stop.
- [x] 3.4 Idler gears in the gear train: verify "Huey's drive" (front and back wheel on a side both turn at twice the motor's speed, same way round) with a drive motor running, and that the existing gear checks pass.
- [x] 3.5 `src/sim/kinematic.js`: the stage follows the lift motor without physics, clamped to its limits; idler gears turn. Verify the "No physics" scenario.
- [x] 3.6 Time a Play step on Huey before and after this change. Verify it is no more than 10% slower, and record both numbers in design.md.

## 4. Wrap-up

- [x] 4.1 Starter check: add to `scripts/check-starter-assemblies.mjs` that Huey has no unsecured racks or idler gears and one lift slide. Open Huey in the 5174 static preview (`VEXIQ_BASE=/vexiq-builder/ npm run build:static`, then `VEXIQ_BASE=/vexiq-builder/ npx vite preview --mode static --port 5174`), start Play mode, run the lift motor up and down and a drive motor. Verify with screenshots of the stage down and up, and no page errors. Do not use the dev server on 5173 or the build open in it.
- [x] 4.2 Run every `node scripts/check-*.mjs`. Verify all exit 0.
- [x] 4.3 Write as-built notes into design.md for anything that differed, answer the open question on the Snap bracket, and add leftovers to `openspec/follow-ups.md` (one-tap placing of racks and brackets; the Rack Gear and Linear Slide pair; anything found and not fixed). Verify `openspec validate linear-motion-and-idler-pins --strict` passes.
- [ ] 4.4 Help (held back on the owner's request; do only when asked): a page or section on linear motion and idler pins, `tags:`, `answers:`, `coverage.json`, pictures.
