## Context

See proposal.md (Why). Today `src/sim/physics.js` (1,700 lines) holds the Rapier world, the motor and gear code and about 700 lines of drop code. Everything a new solve needs already exists:

- `playInputs` (`src/engine/core.js`) lists every seated pair with its axis, point and `overlapMm`.
- `buildBodyGraph` (`src/sim/bodyGraph.js`) keeps the part-level `pinJoints`, `shaftPairs` and `bays` inside merged bodies.
- The catalog gives each fastener's specs (`fastenerSpecs`: `shoulderZ`, side lengths, `hasEndCap`) and ports (`stop: { kind: 'cap', end }` on capped shafts), and gives each part's `bbox` and category.
- Rapier already drops the robot and finds the first floor contact.

The build's axes are +Y up and +X front (the view cube's "Front" is `1,0,0`), so right = +Z and left = −Z.

## Goals / Non-Goals

**Goals:**
- Break decisions come only from the strength table, part shapes and one impact solve, with no constants tuned per robot.
- The solve is pure JavaScript with no Rapier, so it runs and is checked in node.
- A drop on Flop (594 parts) is worked out in under a second from first contact to broken joints (the drop itself may play slower than real time).

**Non-Goals:**
- Second impacts after a bounce or tumble. Only the first floor contact is solved.
- Parts breaking or bending for good. Parts flex during the impact and spring back.
- Gear teeth skipping and chain jumping its sprockets.
- The motor speed and gravity rules (see the follow-ups in proposal.md).

## Decisions

### 1. Strengths live in one data table, `src/sim/fastenerStrength.js`

A plain object, one entry per value: `{ value, unit, source: 'assumed' | 'measured', note }`. It sits next to the functions that use it:
- `seatGrip(seat)`: grip of one pin end in one part, in N
- `gapStrength(pinStack, gap)`: the slide-off rule
- `jointStrength(link)`: pull, sideways and prying strengths

It is a JS module, not a JSON file in `public/`, so `bodyGraph.js` can import it in both node and the browser without a fetch. `allMeasured()` drives the panel's estimate notice.

*Alternative:* JSON in `public/` like `cad-frames.json`. Rejected: the play code is synchronous and runs in node checks, and the table is small and changes rarely.

**Starting values, all `assumed` (TODO: measure, see Open Questions).** The table below is the plan as written; `src/sim/fastenerStrength.js` is the source of truth, and during implementation several values moved (each entry's note says why): a fully seated 1x1 pin end now holds about 44 N (snap 15 N + 6 N/mm), pin stiffness has 0.15 mm of play (6×10⁴ / 1.2×10⁵ N/m beyond it), pin rocking stiffness is 1 N·m/rad, collars slide at 5 N, tires press at 20 kN/m, hard plastic at 50 kN/m, joint damping is 0.3, the Gen 1 battery is one piece with its Brain (no latch), and face friction (0.4) and connector walls (3 mm) were added.

| What | Assumed value | Reasoning |
|---|---|---|
| Pin end snap ridge (tip part only) | 8 N | With friction, a fully seated 1x1 end in a 6.1 mm beam ≈ 20 N, the figure builders usually quote |
| Pin end friction | 2.0 N per mm seated | Makes depth matter; a 3 mm seat holds ≈ 14 N |
| Integral peg (corner connectors, etc.) snap ridge | 5 N, plus 2.0 N/mm | Short pegs, smaller ridge |
| Standoff pin ends | same as connector pin ends | Same 6.14 mm pin |
| Weak variants | 0.6 × regular | "(Weak)" parts are made to let go more easily |
| Capped end, pulled against the cap | blocked; plate under the cap tears out at 150 N | The cap can't pass the hole |
| Pin sideways (shear) strength, per seat | 120 N | The hole wall gives way first; rarely the cause |
| Single pin end rocking (prying) strength | 0.5 × pull strength × depth seated (≈ 0.06 N·m full seat) | Levering the snap fingers out |
| Rubber Shaft Collar slip along shaft | 3 N | Friction only |
| Spacer / washer | 0 N pull; pushes only | Held only by what is either side of it |
| Square shaft in square opening, along shaft | 0 N | Slides freely; collars and neighbours hold it |
| Shaft in round hole, sideways | can't fail | A part round a shaft can only leave by sliding off its end |
| Motor shaft in Smart Motor socket | captured both ways | Stop ring against the plate, socket floor in the motor |
| Gen 1 battery in its bay | 40 N pull | Latch |
| Pin seat stiffness | axial 2×10⁵ N/m, sideways 4×10⁵ N/m, rocking 15 N·m/rad | Order of magnitude for snap-fit plastic |
| ABS stiffness (E) | 2.2 GPa | Handbook range 2.0–2.6 |
| Metal shafts (E) | 200 GPa | Steel |
| Plastic shafts (E) | 2.5 GPa | |
| Beam/plate section factor | 0.35 × solid section | Holes and ribs remove material |
| Tire contact stiffness | 25 kN/m per tire | Soft rubber |
| Hard plastic contact stiffness | 150 kN/m per touching part | |
| Contact damping | 0.3 of critical | Bounce of roughly 0.3 |
| Joint damping | 0.05 of critical | Keeps the solve steady |
| Masses | Brain 0.18 kg, Gen 1 battery 0.14 kg, Smart Motor 0.082 kg; other parts from hull volume × 1050 kg/m³ × 0.38 fill | Current values in `physics.js`, moved into the table |

Rapier's collider masses switch to the same mass table, so the visible fall and the solve agree. Today they use two different estimates.

### 2. The slide-off rule for pins (in `bodyGraph.js`)

Each pin or pin stack keeps its seats in order along its axis. Each seat records:
- the part it holds and its depth (`overlapMm`)
- where it sits along the pin, in the pin's own frame (new from `playInputs`)
- the spans along the pin that no part can slide past (`blockersZ`, measured from the mesh: shoulders, caps, standoff bodies)

For a gap between neighbouring parts *i* and *i+1*:
- the low group (parts 1..*i*) can slide off the low tip
- or the high group (parts *i+1*..*n*) can slide off the high tip

A way is blocked when a blocker (cap, shoulder, standoff body) lies between that group and its tip. A way's hold = sum of `seatGrip` for the parts in the group, plus the snap ridge, since the group always includes that tip's part. The gap's pull strength = the smallest unblocked way.

Each gap becomes one link between parts *i* and *i+1* at the pin's point. This replaces today's all-pairs joins for stacks, which counted a three-part pin three times.

Integral pegs work the same way with one seat. Collars, spacers, square fits, round bearings, motor sockets and bays become links of their own kinds with the strengths in the table.

### 3. Bending: flexible parts become chains of nodes (in `impact.js`)

Parts in "Beams & Plates", plus shafts, are flexible. Every other part (motors, brain, gears, wheels, connectors) is one rigid node.

**Beams.** A flexible part's long axis comes from its `bbox` in its own frame. It gets a node at each joint position along that axis and at its centre. Nodes closer than 12.7 mm merge, which keeps nodes heavy enough for a sensible time step. Neighbouring nodes are joined by standard straight-beam springs (bending in both directions, stretch and twist). Those springs use E from the table and a section of width × thickness × the section factor.

**Plates.** A plate gets the same treatment in both in-plane directions: a grid of beam springs through its joint points.

**Mass.** The part's mass is shared out to its nodes by length.

*Alternative:* add each part's bending as a single spring in series with every joint (one node per part). Rejected because it can't tell a beam held at both ends from a cantilever, and that difference is exactly what the bracing scenario checks.

### 4. The impact solve: small motions of a spring network, stepped finely

At first floor contact, `physics.js` hands `impact.js`:
- the nodes, with mass, inertia and position at the robot's current pose relative to its lowest point (positions are relative, so moving the build changes nothing)
- the links
- the fall speed
- the contact candidates: parts within 15 mm of the floor, each with up to 4 of its lowest hull points

Each node has 6 degrees of freedom (move and turn), treated as small motions around the landing pose. The time step is 0.2 × the shortest `√(mass / stiffness)` over all links and nodes (as built: a fixed 12 µs step, with light nodes given extra mass or inertia until that step is steady, and a retry at half and a quarter step if any node runs away; see §8.6). Stepping uses the plain update (speeds first, then positions). Everything is held in Float64Arrays with no allocation inside the loop.

- **Contacts** push only while a point is below the floor. Tire parts use tire stiffness; everything else uses hard-plastic stiffness.
- **Gravity** acts throughout.
- **Free hinges** have no stiffness about their pin axis.
- **Motor-held hinges** (the motor's hinge, and hinges reached through its gear train using `loadBranches`' factors) hold up to the stall torque × the gear factor, then turn freely for the rest of the impact.
- **Pins and chain links** are not nodes. Their mass is added to the parts they sit in or ride on.

**Failure.** Each step, each link's force is split into:
- pull along its axis (tension only; compression goes through the touching faces)
- sideways load
- rocking moment about the two directions across its axis

Utilisation = pull / pull strength + (sideways / sideways strength)². Sideways load past its strength breaks the link at once: its springs go to zero and the step continues. Pull past its grip does not break it at once; it slides (see §8.2). This is the "load passes to the joints that are left" requirement, with no passes or reductions. A pin that comes out is "pried out" when most of its pull came from the part tipping on its face edge, "pulled out" otherwise. Collars fail only by sliding off. (As built, prying reaches a pin as pull through face pads round it rather than as a separate rocking strength; see §8.3.)

**End of the solve.** As built: it stops once at least the minimum time has passed and no joint's load has risen for 10 ms, and either the robot has left the floor or it has stopped falling with the floor carrying it; at most 0.2 s. (The planned 60 ms cap cut off slow slides.) It returns:
- broken links, each with kind, force, strength and time
- each link's peak utilisation (for weak spots)
- the peak deceleration
- each node's final speed and spin

*Alternatives:*
- **One static solve with a fixed deceleration:** that is today's method in disguise. It can't give each part its own deceleration or let bending soften the hit.
- **Implicit stepping:** stable at any time step, but it needs a sparse solver and a refactor whenever a link breaks. Kept as the fallback if explicit stepping misses the 500 ms budget (see Risks).

### 5. Back to Rapier

From the broken links, `physics.js` groups parts into pieces using the unbroken links (the same grouping as today's `splitDetachedParts`, driven by links instead of `activePinJoints`). The heaviest piece holding the main frame stays. Others become new dynamic bodies, or hinged bodies if one pin line remains. Each new body takes the mass-weighted average speed and spin of its nodes from the solve; the made-up kicks are deleted. There is no separate flex shudder on screen: the robot bounces and rocks as the solve says, and wobbling parts on their own made them swing through the parts they're fixed to.

### 6. Landing pose

| Landing | Turn applied | Face down |
|---|---|---|
| Flat | none | −Y |
| Front | −90° about Z | +X |
| Back | +90° about Z | −X |
| Right side | +90° about X | +Z |
| Left side | −90° about X | −Z |
| Corner | 35° about X, then 35° about Z | front-left-bottom corner first |

The robot is turned about its own centre of mass and then lifted so its lowest point is at the chosen height. There is no random or fixed extra tilt; the same input always gives the same result.

### 7. What gets deleted from `physics.js`

The whole `evaluateDropImpact` body (candidate search, `aCrash`, `bottomOutBoost`, whip mass, shares, `sideBias`, `isLowerAxle`, the 18 N collar rule, the 0.85 cascade factor), the fixed pop-off velocities, and `pulloutN` / `fastenerPulloutN` in `core.js`.

### 8. Decisions made while building it

Each came from a problem found in testing, most of them reported from the running app.

1. **Kept a fully seated pin end at about 44 N, and fixed the model instead.** When the robot came apart too easily, the first idea was to lower the table values; 45 N also looked high for a simple pin. Comparing with the old formula (which gave believable results) showed the loads, not the strengths, were wrong: sideways strength was counted against every pin at once, pins had no play so a tiny shift loaded them fully, prying was counted twice, and floor contacts were too stiff. With those fixed, the Clawbot is intact at 0.15 m and 0.30 m with the same pin values, so the values stayed and wait on real measurements.
2. **Pins and collars slide out over time instead of breaking at once.** A real collar grips along the rest of the shaft and a pin grips along its whole seated depth: a brief jolt loosens them, only a sustained pull removes them. Pulled past its grip, a pin slides by however far the pull moves the parts apart, gripping less the further it has slid, and lets go only once it has slid its whole seated depth; a collar slides at its slip force and comes off after its whole remaining travel. A harder pull pushes the parts apart faster, so it comes out sooner: on the test arm the first root pin comes out 35 ms after landing from 0.3 m, 18 ms from 1 m and 9 ms from 3 m. The report lists a joint that slid part way as "Loosened" with how far.
3. **Pins have 0.15 mm of play and parts press on each other through face pads with friction (0.4).** Without play, a joint took its full stiffness from the first micron of movement and every pin in a row shared load as if welded. Face pads at the corners of the shared face let a part pivot on its edge, which is how prying really reaches a pin: the pin is stretched as the part tips.
4. **Joints round a shaft never fail sideways.** Bearings, square fits and the Smart Motor socket only let go by sliding off the end of the shaft. When they could shear, sprockets and wheels on Flop flew off while their shaft stayed put, which can't happen.
5. **Tires on hubs and the Gen 1 battery in its Brain are one piece.** A tire's rubber needs far more force to come off than a drop gives, and the battery is held by friction and a clip that a drop doesn't open. Both are joined by a stiff link that never breaks (kinds `tire` and `bay`); the battery latch value was removed from the table.
6. **The solve takes a fixed small step and guards against running away.** Parts with tiny mass on stiff links made the planned step unsteady, and one bad step turned every value into nonsense. Light nodes get extra mass or inertia (checked on every axis, not just the diagonal) until the step is steady, and if any node passes 100 m/s the solve starts again at half and then a quarter of the step.
7. **Pieces that break off leave with at most half the landing speed and 25 rad/s of spin, and the drop steps every 1 ms with continuous collision on.** Light parts are still ringing when the impact ends; with their raw speeds they flew off and passed through the floor.
8. **No separate wobble of each part on screen.** Shaking each part on its own made tires and sprockets swing through their hubs and shafts. The robot shows the bounce and rocking the solve gives as whole bodies.
9. **Pieces collide again with the parts they broke away from once a gap opens.** To keep a new piece from springing out of the overlap it was built with, collisions between it and its neighbours are switched off when it breaks away. Before, they stayed off for good, so a loose Brain swung through the plates it had sat on. Now each pair collides again once half a millimetre separates them, or once they press half a millimetre deeper than when let off (parts pushed straight into each other never open a gap). Reset switches the original pairs back off. During a drop, Rapier gets 12 passes per step instead of 4 so a pile of loose pieces doesn't sink in. The cost: the impact frame takes about 1 s and later frames about 55–65 ms on Flop (follow-ups). About 3–4 mm of overlap remains, from the simplified collision outlines.
10. **An unbreakable strength is read as any value that isn't a positive number.** The body graph reaches the browser as JSON, where `Infinity` becomes `null`; read as zero, every unbreakable joint broke at once in the app but not in the node checks. A check now sends the Clawbot's graph through JSON and compares.
11. **The dev server restarts itself when the server-side play code changes.** The browser got its joints from a dev server still running old code, so the app and the checks disagreed. `vite.config.js` now restarts the server when files under `src/engine`, `src/utils`, `bodyGraph.js`, `fastenerStrength.js`, the assembly engine or the catalog change.
12. **Slow motion is a choice of 2, 4 or 8 times slower,** in place of a fixed quarter speed: the landing and the first pins letting go happen within tens of milliseconds, and builders wanted to watch them at different speeds.
13. **"Highlight loose parts" is an option, off by default.** It lights up the parts that came off and those left hanging by one pin line until Reset; the report lists the hanging ones. It is off by default because a hard drop lights up a large share of the robot.
14. **Flop at 0.30 m is allowed to pry a pin or two loose.** With the assumed values, two 1x1 pins near its Brain pry loose at 0.30 m flat, with nothing coming off. Rather than tune values to pass, the check requires Flop intact at 0.15 m and no parts off at 0.30 m, and the gap waits on measurements (follow-ups).

## Risks / Trade-offs

- **[Risk] Explicit stepping is too slow on Flop.** Light nodes on stiff springs force tiny time steps.
  → Merge nodes closer than 12.7 mm. Measure Flop early (task 3.4). If it is over 500 ms, switch to implicit stepping with a sparse solve refactored only when a link breaks.
- **[Risk] With the assumed values, Clawbot fails its 0.15 m or 0.30 m drop, or survives 1.5 m.**
  → Adjust only table values, within their stated plausible ranges, and record why in the entry's note. Never add special cases to the code. Real measurements replace the values later.
- **[Risk] Small-motion math is wrong for big bends.**
  → Impacts last tens of milliseconds and joints usually fail before bends get large. Report the peak deflection so a builder can see when a part bent a lot.
- **[Trade-off] Plates as a grid of beams are an approximation.** They overstate stiffness near holes and understate it across ribs. This is acceptable for comparing builds.
- **[Trade-off] Motor-held hinges slip at stall torque.** Gearboxes and unpowered motors really behave in between. This is a stated simplification.
- **[Trade-off] Only the first impact.** A corner landing followed by a slap flat underrates the slap. Listed as a follow-up.

## Migration Plan

Archive `drop-crash-simulator` first, since its requirements are already merged into the main play-mode spec. Then:
1. Land the strength table, the slide-off rule and `impact.js` with node checks (no UI change).
2. Switch `physics.js` to the solve and delete the old formula.
3. Add the panel changes.

Nothing saved depends on the drop test, so rolling back is a plain revert.

## Open Questions

**TODO: measure real forces.** Every value in the table above starts as `assumed`. Measure each with a luggage scale that holds its peak reading (0.1 N steps): pull slowly, take 5 pulls each, record the median and spread, and set `source: 'measured'` with the date.

1. A 1x1 pin pulled out of a 2x beam, fully seated (snap ridge + friction).
2. A 1x1 pin seated about half depth (a spacer limits it), to get friction per mm.
3. The long end of a 1x2 pin through two beams: pull the outer beam off, then the inner one with the outer removed (tip vs inner grip).
4. A capped pin joining two plates: pull the plain-end plate off, then try to pull the capped plate off (expect tear-out or no failure).
5. A corner connector peg out of a plate.
6. A Rubber Shaft Collar slid along a square shaft.
7. Prying: a 2x8 beam on one pin, weight hung 50 mm out, add weight until it pops (rocking strength).
8. A standoff pin end out of a beam.
9. Stiffness: a 2x8 and a 2x16 beam clamped at one end, 100 g hung at the free end, deflection measured (sets the section factor).
10. Weights (kitchen scale): Brain, battery, Smart Motor, 2x8 beam, 4x8 plate, wheel with tire.
11. End to end: drop a real Clawbot flat from 0.3, 0.5 and 0.8 m on a hard floor and note what pops, to compare with the app.

**Which pins really have a cap, and at which end** (resolved during implementation): the indexer now measures `blockersZ` from each pin's mesh, any span wider than a hole can pass. That covers the 1x1's middle shoulder, the 1x2 and 2x2 shoulders (at z ≈ −6, not the `shoulderZ: 0` the metadata claimed), the end caps on the 0x2, 0x3 and Spherical Cap pins, and standoff bodies. Caps and shoulders are one kind of data for the slide-off rule. Peg spans that ran past their part (−500000 on six parts) are cut to the part's box.
