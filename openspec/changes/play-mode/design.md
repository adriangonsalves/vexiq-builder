## Context

See proposal.md - Why. The pieces Play mode needs mostly exist: `jointGraph` (`src/engine/core.js`) says which parts are pinned to which, `shaftGroups` (`src/utils/shaftGroups.js`) already gathers each square shaft with what fits it and the motor hub (square-shaft-fit spec, written "ready for a later motion simulation"), `gearMeshing.js` finds meshing pairs and racks, and `chainFit.js` knows which links sit on which sprockets. The robot stands still in the air: no gravity, no floor.

## Goals / Non-Goals

**Goals:**
- Build the moving model from the assembly once, on entry, and step it every frame.
- Keep body building pure and testable outside the browser (like the other `src/utils` modules).

**Non-Goals:**
- Gravity, floor, wheel traction, driving the robot (a later change).
- Real tooth contact, gear backlash, part flex, chain slack or animated links.
- MCP tools for Play mode.

## Decisions

1. **Build a body graph first, then hand it to Rapier.** A pure module (`src/sim/bodyGraph.js`) turns the assembly into `{ bodies, hinges, axles, gearLinks, chainLinks, warnings }`. Bodies come from `jointGraph` edges: count the pins joining each pair of parts; pairs with ≥2 fixing joins (or a standoff / connector peg) merge (union-find). Shaft groups from `shaftGroups` become their own bodies. Then for each pair of bodies left: one pin → revolute joint on the pin axis; shaft through round hole → revolute joint on the shaft axis. Keeping this separate lets `scripts/check-play-mode.mjs` test it with no WASM.
   *Alternative:* build Rapier objects straight from parts. Rejected: hard to test and to report what was set up.

2. **Rapier rigid bodies with convex-hull colliders per part.** Each part's collider is a convex hull of its mesh (decimated); a body is a compound of its parts' hulls. Pin joins inside a body need no collider pairs. Collisions between bodies joined by a joint are disabled (Rapier `contactsEnabled(false)` on the joint), so a shaft in its hole or a beam on its pin never counts as a hit. Pairs already overlapping on entry (tight fits, tire on hub) are added to a skip list.
   *Alternative:* exact trimesh colliders. Rejected: Rapier can't collide two moving trimeshes well, and they're slow. Hulls fill in holes, so a hull for concave parts like plates is split by `convexDecomposition` where needed — decided by part type, plates and C-channels split, small parts single hull.

3. **Gears and chains as ratio constraints, solved each step.** Rapier has no gear joint. Each step, before the physics step, a small solver adjusts the angular velocities of linked shaft bodies about their axes so `ω_a·T_a + s·ω_b·T_b = 0` (s = +1 gears, −1 chains), spreading the correction by each body's inertia about its axis, a few passes over the whole set. Racks use linear speed = ω × pitch radius. This keeps whole trains locked together; if one body is stopped by contact, the solver drags the others to stop with it.
   *Alternative:* fixed multibody joints. Rejected: no ratio support.

4. **Motors are revolute-joint motors on the hub axle.** The motor's shaft-group axle joint uses `configureMotorVelocity(target, factor)` with max force set to stall torque 0.4 N·m (units scaled: mm → m inside Rapier, masses from part volumes at ABS density ~1.05 g/cm³). Throttle maps −1..1 to ±120 rpm.

5. **Stall detection on measured speed.** Stalled when |throttle| > 0.05 and actual speed < 10% of target for 300 ms; clears once above 25%.

6. **Visuals follow bodies; build state untouched.** On entry, record each part's pose and its offset in its body. Each frame, write body transforms to the part meshes directly (not through the store), so history and the saved build never change. On leave, reset meshes from the recorded poses and free the Rapier world.

7. **Load Rapier on demand.** Dynamic `import('@dimforge/rapier3d-compat')` when Play mode opens; add its WASM to the offline manifest and static build.

8. **Kinematic first pass.** Phase 1 runs without Rapier: motor speed walks through shaft groups and ratio links to spin bodies, no collisions. It checks the body graph and ratios on screen early, and stays as the fallback if Rapier fails to load.

## Risks / Trade-offs

- [Hull colliders fill holes and gaps, causing false collisions] → joined bodies skip contacts with each other; split concave parts; ignore pairs overlapping on entry.
- [Ratio solver fights the physics solver, jitter] → small fixed step (1/240 s, several substeps per frame), solver runs on velocities before each step.
- [Pin counting is wrong for unusual joins (shaft couplers, capped shafts as pins)] → report what each join became in the Play panel's setup list; tests cover common joins.
- [Heavy robots slow to set up] → build hulls once per part type and cache.

## Migration Plan

Additive. Play mode is a separate mode; turning it off returns to the editor. No saved-file changes.

## Open Questions

- Exact hull split list per part type; tune on Flop and a clawbot.
