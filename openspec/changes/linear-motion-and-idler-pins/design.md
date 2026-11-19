## Context

The app joins parts by seated pins, pegs and shafts (`seatedPairs` in `src/engine/core.js`, found from each part's ports and `src/utils/pinHoleAlignment.js`). The audit, moving, groups and Play mode all read those joints. Play mode (`src/sim/bodyGraph.js`) merges rigidly joined parts into bodies, makes hinges where one pin or shaft lets a part turn, links gears, and already has one kind of slide: a rack held by nothing but its gear (`sliders`, a prismatic joint to the frame in `src/sim/physics.js`, about line 343).

Hero Bot Huey (the `huey` starter, 490 parts) uses two joints the app doesn't know, measured on the starter:
- Four `1x6 Continuous Linear Motion Rack Gear` (228-2500-1473, no ports, `rackSpecs` measured) sit two each on the Middle Stage's two `1x18 Beam`s, at z = ±57 mm.
- Six `2x Pitch Linear Motion Bracket (Side Mount)` (228-2500-1469, 4 pegs and 2 holes) are pinned to the Holder's `2x16 Beam`s; each touches the 1x18 Beam and its rack, which run through it.
- Two `12 Tooth Gear`s on the Holder's 6x Pitch Shafts (chain-driven from the lift motor) touch the upper racks.
- In the Drive group, two `36 Tooth Gear`s and two `48 Tooth Gear`s each have a `0x2 Idler Pin` (228-2500-084, one `pin_peg` port) through their square centre hole (`sq.thru.0_0_0`, a `shaft_bore`), and no joint.

Play today reports the racks and those gears as "isn't joined to anything", holds the Middle Stage only by its ropes, and forms no rack link.

## Goals / Non-Goals

**Goals:**
- Racks clipped on beams, beams in brackets and gears on idler pins are joints the audit and Play mode both see, found from where the parts sit.
- Huey's lift goes up and down by its motor between its stops, and all four wheels turn.
- Nothing already working changes: every existing check passes untouched, including the rack-held-by-its-gear slider and the Clawbot, Flop, ratchet and rope checks.

**Non-Goals:**
- Tools to place these parts with one tap; help pages; the Claw Mount's slide and ropes; friction in slides; the older Rack Gear and Linear Slide pair unless free.

## Decisions

1. **Sizes are measured into part metadata, not typed in.** `scripts/measure-part-geometry.mjs` gains two measurements, written by `scripts/index-part-metadata.mjs` beside `rackSpecs` and `spoolSpecs`:
   - `clipSpecs` on the continuous rack: the seat's direction (the rack's length), the plane its inner face lies on, the two side planes, and its span along the length. Found from the mesh: the faces of the slot on the side away from the teeth.
   - `channelSpecs` on each bracket: the channel's direction, its cross-section (the inner faces that face each other across the opening) and its span.
   Each carries `measured: true` or a `reason`, as `rackSpecs` does. *Why:* every earlier fit rule that used typed numbers was wrong on some part; the fit script found three wrong hand entries on Flop. Check the numbers against Huey: with the starter's poses, the 1x18 Beam's cross-section must lie inside each bracket's measured channel and each rack's measured seat within 0.5 mm. If Huey's poses miss by more, look at the measurement before loosening the tolerance.

2. **Two new joint kinds beside pins, found in one place.** Add them where `seatedPairs` are built in `core.js`, as their own lists so pin logic is untouched:
   - `clips: [{ rack, beam }]`: rigid. For everything that asks "what is this part joined to" (unsecured, islands, groups that move together, Play bodies) a clip is the same as a seated pin.
   - `slides: [{ bracket, beam, direction }]`: held, one line of travel. For the audit a slide joins (held, one island). For Play it does not merge bodies.
   A "beam" for both is any part with a straight 1x-wide run of the VEX beam cross-section; find it from the part's holes in a row (their spacing and the bbox across them), not from the part's name. *Alternative considered:* giving the rack and bracket fake ports and reusing pin seating. Rejected: a pin seats at a point and a rack or channel seats anywhere along a line, and the slide must not lock.

3. **Slides between bodies in the graph.** `buildBodyGraph` already returns `sliders` (body ids pinned to the frame's axis by a rack link). Add `slideJoints: [{ id, a, b, direction, point, limits: [lo, hi] }]` between any two bodies, built from the `slides` after bodies are formed:
   - all slides between the same two bodies with parallel directions become one joint; non-parallel ones add a warning and the two bodies are merged (locked);
   - `limits` come from stepping body `b` along the direction, both ways from where it sits, until the audit's collision test says parts meet (use the meshes and the tight-fit allowance the audit uses; step 1 mm, then halve to 0.25 mm). The pair of parts in each slide and each clip is left out of that test, as seated pins are, since they touch by design. Cap the search at the beam's length.
   - a body reached only through a slide joint is not `loose` and gets no "isn't joined" warning; pieces are found across slide joints as they are across hinges.
   The existing `sliders` stay as they are (a rack with no bracket still slides on the frame).

4. **Physics: a prismatic joint with limits.** In `physics.js`, for each slide joint create `RAPIER.JointData.prismatic` between the two bodies along `direction` at `point`, with `limitsEnabled` and `limits`, contacts between the two bodies off (as the existing slider does), and both bodies' rotations coupled by the joint itself (a prismatic joint already removes all turning). Confirm the Rapier 0.14 names for prismatic limits before using them. Collisions between the two bodies are off, so the limits are what stops the stage; that is why they are found from the meshes first.

5. **The rack drive.** `links` of kind `rack` exist (`{ a: gear body, b: rack body, axisA, direction, mmPerRad }`) and `holdLinks` couples speeds for the frame-anchored slider. Make that coupling work for any rack link whose two bodies are joined by a slide joint (or by the old slider): the gear's turning speed about `axisA` times `mmPerRad` equals body `b`'s speed along `direction` relative to the gear's holder body. With the rack now part of the beam's body (clip), the link's `b` is the Middle Stage. Two gears on one shaft driving two racks on one body is two links between the same bodies; they must agree and not fight. Check `mmPerRad` on Huey: a 12 Tooth Gear's pitch radius is 6.35 mm, so one turn is 39.9 mm.
   *Order in the step:* keep `stopMotors` before `holdLinks` (openspec motor-stopping), so Hold on the lift motor holds the stage through the chain, shaft, gear and rack.

6. **Idler pins: one more thing a pin end can sit in.** In `pinHoleAlignment.js` / `core.js`, an idler pin's smooth end may seat in a `shaft_bore` opening (square or round) of a part with `gearSpecs`, a sprocket, a pulley or a wheel. Which end is smooth: measured from the model into the pin's metadata (`fastenerSpecs.smoothEnd`, the end with no snap ridge; the 0x2 Idler Pin's two ends differ), with the part-name list in the spec as the gate for which pins are idler pins. The seat is a `seatedPair` marked `turns: true`:
   - audit: the gear is held, the pin isn't floating;
   - Play: the gear's body hinges on the pin's body about the pin's line. `bodyGraph` already makes a hinge for a part on one pin through a round hole; reuse that path, do not add a second hinge kind.
   A gear on an idler pin that also has a second pin through one of its off-centre holes is fixed, as two pins fix any part today.

7. **No-physics fallback.** `src/sim/kinematic.js` moves the rack's body along the slide by `mmPerRad` per radian, clamped to `limits`, and turns idler gears through their links as it does gears on shafts.

8. **Audit wording** (`auditIssues.js`): no new problems for a clean lift. One new note per slide: "<group or part> slides on <group or part>: N mm up, M mm down" (direction words from the slide's direction against world up; "along" otherwise). Locked non-parallel brackets are a problem: "<part> is held by brackets that point different ways, so it can't slide."

## Building it: where to look

| Need | Existing code |
|---|---|
| Measured shapes written to metadata | `measureShapes` in `scripts/index-part-metadata.mjs` (rack teeth, spools), `scripts/measure-part-geometry.mjs` |
| Joints found for audit and Play | `seatedPairs` and the audit in `src/engine/core.js`; `playInputs` |
| What a pin end fits | `src/utils/pinHoleAlignment.js` |
| Bodies, hinges, pieces, `sliders`, rack links | `src/sim/bodyGraph.js` (rack links about line 354, pieces about line 391) |
| Prismatic joint, `holdLinks`, `stopMotors` | `src/sim/physics.js` |
| Collision test with tight-fit allowance | the audit's collision pass in `core.js` (`getPartCollisionBvh`, `posedPieces`) |
| Fixture | `starterById('huey').build(catalog)`; groups Drive, Elevator Holder, Elevator Middle Stage, Claw Mount |
| Rack and gear mesh checks | `scripts/check-gear-meshing.mjs` |

Run `node scripts/check-play-mode.mjs`, `check-ropes.mjs` and `check-gear-meshing.mjs` after every change to `bodyGraph.js` or `physics.js`.

## Risks / Trade-offs

- [Huey's CAD has 25 overlapping part pairs, some perhaps in the lift] → the travel search leaves out the clip and slide pairs; if other overlaps at the start pose stop the search at 0 mm, list them in the task's notes and leave those pairs out only when they are tight fits by the audit's own rule. Don't widen the allowance.
- [The stage's ropes and the Claw Mount] → the Middle Stage is rope-held (`roped`) today because it is loose. Once it is on a slide it must no longer be `roped`; the ropes still pull it. The Claw Mount stays held still (its piece has a motor) until the rope-and-spool slider work; raising the stage will then stretch the ropes' paths. That is expected for now: check only that nothing errors and the ropes report "too short" or slack rather than yanking the stage. Record what happens.
- [Two rack links fighting] → both sides of Huey's lift are driven from one shaft; if the coupling over-constrains, apply one link per pair of bodies and check the other agrees within 0.5 mm.
- [Idler pin rule joining things it shouldn't] → gated on the idler pin part list and the measured smooth end; the "ordinary pin" scenario is a check.
- [Speed] → Huey ran at about 0.6 of real time in Play before this change. Time a step before and after; this change must not make it slower by more than 10%.

## Open Questions

- Whether the 1x Pitch Linear Motion Bracket (Snap) clips onto its beam rigidly rather than sliding. Huey doesn't use it. Measure its channel; if the model shows a snap that grips, make it a clip, and say so in the as-built notes.
  *Answered:* measured, its snap peg is how it mounts on its own part; its channel (along its local z) has the same slot and narrower mouth as the Side Mount bracket's, so it holds a rack's rail and slides. It is a bracket, not a clip.

## As built

- **Where the checks live.** The Play checks for this change are in `scripts/check-linear-motion.mjs` (section 3) with the rest of the change's checks, not in `check-play-mode.mjs`.
- **Huey's lift needed its carriage first.** With the slide in place the Middle Stage still couldn't move: the Claw Mount, held still because its piece carries a motor, sat in the stage's rails. The rope-and-spool slider rule (that change's decision 10, tasks 8.2–8.3) was built here so the lift could be checked at all: `playInputs` hands the body graph a `guide` that tries a rope-held piece's moves against the body it is nested in, and a piece with one line of travel becomes a slide joint (`rope: true`) on that body and is listed as `roped`, even with a motor on it. The rule asks for one axis clear at least one way (a carriage sits at one end of its rails) with the other two held both ways and every ±3° turn blocked. The travel search the slides use is shared (`travelSearch` in `core.js`).
- **The rack drive (decision 5).** Three things beyond the speed coupling:
  - a rack on a body at the end of its slide holds still, and how far its gear turns on past the end counts as a press, so the motor stalls there ("Stops"); an idle motor's count is cleared, so a stage resting on its stop doesn't stall the motor when it starts;
  - while a motor drives the gear (throttle on, not stalled), the stage takes the whole correction, not shared by weight: shared, the light gear took it, the motor drove it on again, and the carriage's weight left the stage 7 mm behind its gear (one gear turn read 42 mm up, 37 down with gravity on). Stopped, the ordinary shared coupling is kept, since Hold, Brake and Coast work through it (Hold, with the stage firm, swung wider each step);
  - other tries that didn't work, for the record: adding gravity to the stage's speed before the coupling (no change); applying the stage's weight by hand before the coupling (Hold stopped holding); moving the stage back onto its gear's spot each step (fought the slide's ends and ran away).
- **Measured on Huey** (check-linear-motion.mjs): one turn of the motor's 12 Tooth Gear raises the stage 39.94 mm and lowers it 39.94 mm with gravity off; with gravity on and Hold the stage moves 0.04 mm over 3 s; driven up it stops at 196.88 mm (the audit's travel) with the motor stalled; Brake creeps about 8 mm/s, Coast falls to the lower stop; the carriage rises ×1.99 the stage, each rope carries 1.47–1.49 N against half the carriage's weight 1.47 N. The drive turns both wheels on a side at 240 rpm from a 120 rpm motor.
- **Speed (task 3.6).** A 1/60 s Play step on Huey, nothing driven, gravity off, best of three 2 s runs: 4.63 ms before this change, 6.50 ms as first built. Two changes brought it to **3.10 ms**: an idle, unblocked motor no longer reads every contact of every part it moves each step (it reads them when it next runs), and the gear link sweep works out each gear body's turning inertia once per call instead of on every impulse.
- **Motors ignore loose parts.** A part not joined to the robot that falls with gravity on no longer stalls a motor it lands on. Huey has one such group (see follow-ups), and it stalled the lift as soon as gravity was turned on in the app.
- **In the app** (static preview, task 4.1): Huey's Play panel lists its four motors with no warnings about the lift, the gravity hint shows while gravity is off, the lift and drive run, and there were no page errors. The headless browser draws Huey at about 1.5 frames a second, so Play runs at about a twentieth of real time there and the screenshots show only part of the travel; the numbers above come from the checks.
- **Follow-up fixes (2026-11-18):**
  - `src/sim/playRunner.js` advances chain/track phase from the drive sprocket's actual pose delta relative to its frame (`deltas`) instead of instantaneous `engine.spin() * dt`, eliminating phantom chain creep when a lift is held stationary in `Hold` mode against gravity.
  - `scripts/index-part-metadata.mjs` now probes center square shaft bores on Lock Beams (all 8 Lock Beams, including `228-2500-1925`, so Huey's top timing-shaft coupler joins both lift shafts into one body rather than falling off as a loose island) and measures blind-hole `spanMm` from the entry face when `entryFace` lies outside the raw STEP cylinder span (seating `228-3010` Touch Sensor on all 4 pins).
  - `ropeGuide` in `src/engine/core.js` chooses the enclosing candidate with the tightest lateral play (`heldPlay`) rather than the first bounding-box hit, keeping multi-stage carriages guided by their inner rails once outer chassis sensors are attached.
  - `src/starters/huey.js` aligns the tooth phases of Huey's 4 meshing gear/rack pairs and clears 0.25 mm CAD pin grazes on the claw `36 Tooth Gear`s and drive `1x8 Beam`s (0 claw collisions, 0 unsecured parts, 0 disconnected islands).
