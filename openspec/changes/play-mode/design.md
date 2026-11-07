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

2. **Rapier rigid bodies with a convex hull per part, for every body.** Each body starts at the world origin with its parts' hulls placed where the parts are, so a body's pose is its move. Pins, chain links and loose pieces get no shape. Contacts are off between hinged bodies (`setContactsEnabled(false)`), and part pairs whose hulls overlap by more than 0.3 mm at entry (measured in a throwaway world stepped once) are dropped by a contact filter hook, as are meshing gears. Pairs that only touch stay in (beams side by side must collide); an earlier 1 mm "close at the start" rule dropped them and let the Clawbot's arm beams pass through each other. Colliders have no friction. Every moving body weighs at least 5 g, or a washer hanging on a frame makes the solver unsteady. A hull that comes out flat is replaced by its bounding box.
   *Alternatives:* trimesh colliders for fixed bodies (planned at first): Flop's fixed parts are 271k triangles, which ran 3× slower than real time; hulls run about 13× faster than real time. `convexDecomposition` isn't in the JS build. Hulls fill holes and hollows; the entry-overlap filter covers what sits in them at the start.
   *Rapier gotchas met:* a `ColliderDesc` can only be used once; rotations need `w`; `world.step` ignores the hooks unless it is given an event queue too.

3. **Gears and chains as ratio constraints, solved each step.** Rapier has no gear joint. Before each substep, eight passes of impulses pull each link's speeds to `ω_b = k·ω_a` (k = sign × tooth ratio), weighted by each body's inertia about its axis, plus a fifth of the turn the two have drifted apart (kept in full, never faded, or a blocked gear lets its train slip); after the substep the speeds are pulled back again without the drift part. Racks use linear speed = ω × pitch radius. A gear stopped by contact stops its whole train.
   *Alternative:* fixed multibody joints. Rejected: no ratio support.

4. **Motors are a capped torque, not Rapier's joint motor.** Rapier 0.14's JS joint motors have no force limit, so a joint motor would never stall. Each substep the motor applies a torque about its hinge (the motor body takes it back): a part proportional to the speed error weighted by what it turns (its shaft plus the gear train, each body weighted by ratio², arm centres off the axis included), plus a part that builds while it stays off speed (for linkages and damping) and is let go when the throttle reverses; the sum is capped at 0.4 N·m. Throttle −1..1 maps to ±120 rpm. Units: mm → m inside Rapier, masses from hull volume at 1050 kg/m³.

5. **Stall detection on smoothed speed.** A blocked shaft jitters, so the speed shown and checked is smoothed over 0.15 s. Stalled when |throttle| > 0.05 and that speed < 10% of target for 300 ms; clears once above 25%.

5b. **A motor stops when what it moves presses into something.** The solver alone doesn't do this: the Clawbot's arm is a closed linkage (a four-bar) driven through a gear tie, and Rapier let it swing 258° through its own beams (contacts only pushed back about 6–11 mm deep; more solver passes, finer steps, stiffer contacts and continuous detection changed nothing). So each motor has the set of bodies it moves (its shaft body, then everything reachable through hinges and gear/chain ties, never a body that holds still). After every substep the deepest contact between those bodies' hulls and anything else (not pairs let off at the start) is read. Deeper than 0.8 mm and still deepening: the motor is *blocked* in the throttle's direction: no torque, those bodies' velocities zeroed each substep, shown Stalled. The opposite throttle (or stop) lifts the block and measures depth afresh, so only deepening blocks again. Costs about 7 ms per 33 ms frame on Flop.

5c. **Tracks ride a frame, and single-sprocket tracks run round.** Chain and track parts have no body and no collision shape. Each track takes the frame its sprockets hang on (votes within two hinges: most sprockets reaching a body, then nearest, then largest), so Flop's intake tracks follow the intake frame and its drive chains the chassis. A closed track on one sprocket also circulates: the links are ordered round the loop from their joins, the loop's direction is compared with the sprocket's axis, and each frame the phase advances by (spin of the sprocket against its frame) × teeth/2π links, each link taking a pose blended between its neighbours' start poses (grippers keep their place on their link). Tracks on several sprockets only ride along: the sprockets are tied by ratio, but their loop isn't circular, so the same trick would need the loop's path.

5a. **What holds still.** With no floor, each piece of the robot (bodies joined by hinges) that is the largest or carries a driving motor holds one body fixed: the one with most driving motors (motors sit on the frame), else the largest. Picking the largest alone fixed the Clawbot's arm instead of its tower, whose join to the base isn't detected. Other pieces stay still with no shapes (they'd fall off a real robot) and are listed; a rack joined only to its gear slides on a prismatic joint.

6. **Visuals follow bodies; build state untouched.** On entry, record each part's pose and its offset in its body. Each frame, write body transforms to the part meshes directly (not through the store), so history and the saved build never change. On leave, reset meshes from the recorded poses and free the Rapier world.

7. **Load Rapier on demand.** Dynamic `import('@dimforge/rapier3d-compat')` when Play mode opens; add its WASM to the offline manifest and static build.

8. **Kinematic first pass.** Phase 1 runs without Rapier: motor speed walks through shaft groups and ratio links to spin bodies, no collisions. It checks the body graph and ratios on screen early, and stays as the fallback if Rapier fails to load.

## Risks / Trade-offs

- [Hull colliders fill holes and gaps, causing false collisions] → joined bodies skip contacts with each other; pairs within 1 mm at entry never collide.
- [Ratio solver fights the physics solver, jitter] → small fixed step (1/240 s, several substeps per frame), solver runs on velocities before each step.
- [Pin counting is wrong for unusual joins (shaft couplers, capped shafts as pins)] → report what each join became in the Play panel's setup list; tests cover common joins.
- [Heavy robots slow to set up] → build hulls once per part type and cache.

## Migration Plan

Additive. Play mode is a separate mode; turning it off returns to the editor. No saved-file changes.

## Open Questions

- Flop's tower motor drives its heavy intake linkage through a 10:1 train and only reaches about 72 rpm with nothing touching; the linkage loop may be binding. Worth a look when a floor and gravity come in.
