## Context

See proposal.md for why. What the code does today, and what shapes the approach:

- **Part data.** `scripts/measure-part-geometry.mjs` leaves ratchets and the pawl unmeasured on purpose (`NOT_MESHING_PATTERN`), so `gearSpecs.measured` is `false` and `isMeshingGear` skips them. `check-gear-meshing.mjs` checks that this stays so. The pawl has four pin holes in a row (`hole.thru.-2_0_0` … `hole.thru.4_0_0`) and a tip below them.
- **Swish in VEX's CAD** (`node scripts/import-cad.mjs "4094-viqc 2024-2025 hero bot swish" --dry-run`, subassembly `Catapult Winch`; all shafts along Z):
  - motor shaft A at (12.52, 28.72): 6x Pitch Shaft, two 36 Tooth Gears, two motors;
  - swing arm: two 3x4 Plates turned 63° with two 2x3 Right Angle Beams between them, on shaft A through round holes;
  - arm shaft B at (29.82, 62.66): 4x Pitch Motor Shaft, two 36 Tooth Gears 38.1 mm from A (in mesh), the 16 Tooth Ratchet in the middle;
  - the pawl at (8.33, 67.95), on a 2x2 Connector Pin through the plates, with a 0x2 Connector Pin carrying two square silicone belts to a standoff;
  - spool shaft C at (76.05, 28.74): the spool and two 36 Tooth Gears. B is 57.3 mm from C as drawn (out of mesh); swung to 33.6° it is 38.1 mm from both A and C.
- **Play mode** (`src/sim/`): `bodyGraph.js` makes bodies, hinges and gear links once, on entry, from the audit's mesh list. `physics.js` holds each gear link by pulling the two bodies' spins *about their own shafts, measured against the world* to the tooth ratio (`holdLinks`), and applies the correction as a pure turn of each body about its shaft. Meshing gears don't collide; every other part collides as a convex hull; parts overlapping on entry never collide; contacts have no friction. The worm link (`oneWay`) is the only one-way link. `kinematic.js` is the fallback with no collisions.
- Three things in Swish's winch don't fit that: a link that holds one way, a gear whose shaft rides on a swinging body, and a mesh that forms and breaks while playing.

## Goals / Non-Goals

**Goals:**
- One set of rules (`src/utils/ratchetPawl.js`) used by placing, the audit, the tool and Play mode, as `gearMeshing.js` is for gears.
- Setting a pawl takes one gesture and works by touch.
- Swish's winch, imported as VEX drew it, winds, holds and releases in Play mode with no hand set-up.
- Builds with no ratchet and no swinging gear run exactly as before (same links, same numbers).

**Non-Goals:**
- Rope and spool winding (see proposal).
- Real tooth-on-tooth collision. Teeth are handled by rules, as gears are.
- Swinging gears and meshes that come and go in the fallback engine (`kinematic.js`): it lists them as not run. It does hold ratchets one way.
- Bevel, crown and worm pairs coming into and out of mesh.

## Decisions

### 1. Measured data
Add `measureRatchet` and `measurePawl` to `scripts/measure-part-geometry.mjs`, called from `measureShapes` in `scripts/index-part-metadata.mjs`. They write a new record, `ratchetSpecs`, and leave `gearSpecs.measured` false so nothing in gear meshing changes.

- Ratchet: `{ kind: 'ratchet', teeth, tipRadiusMm, rootRadiusMm, toothPhaseDeg, faceSpanMm, lean }`. `lean` is +1 or −1: the turning direction about the bore axis (+Z of the part) that a pawl stops. Found from the outline's radius against angle: each tooth has one steep side and one sloped side; the steep side leads in the stopped direction.
- Ratchets also carry `profileMm`: the outline radius at 48 points across one tooth (the crest is rounded, 0.28 mm off a sharp corner).
- Pawl: `{ kind: 'pawl', tipPoint, tipNormal, thicknessMm, holes, outline }`, in the part's frame: the tip's contact point, the outward direction of its catching face, its hole ids (nearest the tip first), and `outline`, the cut through the part at the holes' middle plane (100–200 points).

Measured (task 1): both ratchets lean one way (`lean −1`: a pawl stops clockwise turning about the part's +Z). 16 Tooth: tip 12.434, root 10.502. 40 Tooth: tip 31.487, root 29.525.

*If the teeth turn out to be the same on both sides,* `lean` is 0 and the stopped direction comes from the pawl alone (the side whose push runs toward the pawl's pin). The rule in §2 covers both, so the specs don't change. Task 1.2 settles which it is.

*Why not reuse `gearSpecs`:* every user of `gearSpecs.measured` would start treating ratchets as gears.

### 2. The holding rule (`src/utils/ratchetPawl.js`)
`pawlRelation(ratchet, pawl)` works in the ratchet's plane and returns `null` or `{ holds, freeSign, wrongWay, tipDepthMm, pivot }`:
- axes parallel within 2° (same limit as gears), pawl thickness overlapping `faceSpanMm` by at least 1 mm, tip radius from the ratchet's centre within `[root − 0.5, tip + 0.5]` mm;
- the stopped direction is the one in which a tooth's steep side moves into the tip;
- it *catches* when that push, at the tip, points toward the pawl's pivot within 35° (the pawl is squeezed between tooth and pin). Otherwise the push swings the pawl out: `wrongWay`.
- `pivot` is the single hinge line the pawl hangs on (from the audit's joins), or `null` when it has none or more than one.

`pawlRestTurn(ratchet, pawl, pivot)` swings the pawl's whole outline about the pivot toward the ratchet's outline until the two first touch, and gives that turn. The rest only counts when the first touch is at the tip and `pawlRelation` says it holds; otherwise (the pawl's body reaches the teeth before its tip, or it is out of reach) it gives `null`. *Why not the tip alone:* tried first, and most tip-only rests left the pawl's body inside the teeth (180 of 212 between two 4x6 Plates); the pawl only works one way up on each side and from pins about 20 mm or more away. It never turns the ratchet: in Swish the ratchet's shaft carries meshed gears, and Fix assembly's rule is that meshed gears don't move.

### 3. Pawl spots and Set pawl
`pawlSpots(ratchet, pawlMeta, neighbours)`:
1. candidates: pin holes (and pins standing in them) of parts other than the ratchet, with axes parallel to the ratchet's, whose face lies against the pawl's plane when the pawl is centred on the ratchet's tooth band, within pawl reach of the ratchet's centre (pivot-to-tip length + tip radius);
2. for each candidate and each of the pawl's four holes, both ways up: `pawlRestTurn`; keep poses that hold (`pawlRelation`);
3. mark as blocked those that overlap another part (the engine's existing overlap check), with the blocker.

Spots are ordered by angle round the ratchet so "next spot" walks round it. The engine (`src/engine/core.js`) gets `listPawlSpots` and `setPawl`, used by the app and by the `set_pawl` tool, the way `mesh_right_angle` is built.

In the app the gestures copy the 90° gear ones so there is nothing new to learn: double-click the ratchet with the pawl selected (`Viewport3D.jsx`, where the gear partner double-click is handled), the context bar's Join button (`contextToolbarItems.js`), and one Tools item, **Set pawl**. No panel and no dialog. Alternative considered: a "Ratchet builder" panel that also adds the pin and the band. Rejected: pins and bands already have their own simple ways in, and a panel is one more thing on a phone screen.

### 4. A placed pawl swings on
In `settlePlacement` (`src/utils/placementFit.js`), after the existing gear turn: if the placed part is a pawl with exactly one pivot and a ratchet in reach, apply `pawlRestTurn`. Same Alt / Free move / Rotate-mode exceptions as gears, through the same flags.

### 5. Arrow
A flat curved arrow drawn round the ratchet in `Viewport3D.jsx` while a holding pawl or its ratchet is selected, made the way the rotate rings are (overlay geometry, not a part). Direction from `freeSign`.

### 6. Audit
`core.js` adds a `ratchets` list to the audit (`{ ratchetId, pawlId, freeSign, wrongWay, pivotCount, pressed }`) and issues through `auditIssues.js`. `pressed` is true when a band has a spot on the pawl or on a pin seated in it. No special overlap allowance for pawls: a pawl at rest touches the ratchet, which the ordinary tight-fit rule (up to 0.5 mm) already covers, and a pawl whose body is in the teeth must show as an overlap. Parts with `ratchetSpecs` are left out of the audit's meshed gear pairs (`findJoints` paired any two parts with `gearSpecs` by pitch radius without checking `measured`, so a ratchet or pawl beside a gear read as meshing).

### 7. Play mode: the ratchet link
`bodyGraph.js` adds `ratchets: [{ ratchetBody, holderBody, pawlBody, axis, point, freeSign, teeth, ... }]` from the audit's list. The pawl on one pin is already its own hinged body.

In `physics.js`, each substep, for each ratchet (new `holdRatchets`, run with `holdLinks`):
- relative spin `w` = ratchet body's spin about its axis minus the holder body's spin about the same line;
- **stop:** if the pawl is down and `w` is in the held direction, remove it with equal and opposite turns on the ratchet body and the holder body (weighted by inertia, like a gear link with ratio 1). Up to one tooth of back-turn is allowed before it bites (the tip reaching the next steep side), tracked from the relative angle and `toothPhaseDeg`;
- **drag:** if `w` is in the free direction, a small fixed torque (`PAWL_DRAG`, about 2% of stall torque) opposes it, on both bodies. This is what swings Swish's arm toward the spool when the motors wind; real pawls drag for the same reason (the belt presses them on the teeth);
- **pawl pose:** the pawl's angle about its pin is set from the relative angle through the tooth outline (it rides up the slope and drops), so it shows the click without colliding with the ratchet. Pawl and ratchet never collide as hulls;
- **down or up:** the pawl is down while its tip is within tooth depth. It is a normal hinged body for everything else, so another part can push it up; a band, or gravity when on, brings it back; with neither it stays put. A pawl on two pins (no hinge) is always down and stops both directions. `wrongWay` pawls make no link.

`kinematic.js` treats a ratchet with a fixed holder as a jam in the held direction (as it does a worm asked to turn backward) and ignores the rest.

Alternative considered: exact tooth meshes colliding in Rapier. Rejected: the file header already records that exact meshes are far too slow, and 6 mm teeth at 1/240 s steps would chatter.

### 8. Play mode: gears on a swinging arm
For a gear link, find the bodies that hold each gear's shaft (the other side of the gear body's axle hinge). If both are fixed, or the same body, nothing changes. Otherwise the link is marked `carried` and `holdLinks` handles it differently:
- the error is the difference in tooth speed at the pitch point (the point between the two centres, split by tooth counts), each gear's speed there taken from its body's full motion, so the arm's swing is included;
- the correction is a push along the tooth direction at that point, applied to both gear bodies as an impulse at a point (not a pure turn), so the hinges pass the reaction to the arm.

This is the ordinary gear rule written at the teeth; for fixed shafts it gives the same numbers, but the old path is kept for those so existing builds don't shift. Drift (`trackDrift`) for carried links is measured relative to the line of centres.

### 9. Play mode: meshes that come and go
On entry `bodyGraph.js` lists `maybeMeshes`: pairs of measured spur gears of the same tooth size, axes parallel, tooth bands overlapping, on different bodies, where at least one shaft's holder can move relative to the other's, and whose centres are within 80 mm of mesh distance. Pairs meshed on entry with a moving holder go in this list instead of `links`.

Each substep, for each pair:
- **no hull contact** between the two gears, ever (their smooth hulls would meet 2 mm early, at tip circles);
- **stop at mesh distance:** if the centres are closer than the mesh distance, remove the closing speed with equal and opposite pushes along the line of centres at the two shafts, and take back the depth as links take back drift;
- **engaged** while the centre distance is within `MESH_CENTER_TOLERANCE_MM` (1 mm) of mesh distance: held as a `carried` link (§8). On engaging, the link's drift starts at the tooth misfit folded into ±half a tooth, so one gear slips that much instead of jumping;
- otherwise nothing links them.

Motor stall and "blocked" checks treat the mesh-distance stop like a contact, so an arm held in mesh by tooth force doesn't read as a stall while the gears turn.

### 10. Order of the Swish release, as a check on the design
A at the origin, C at (63.5, 0), B engaged at (31.75, 21.06). Winding turns A clockwise, B anticlockwise on the arm (its free direction), C clockwise. With the spool resisting, the two tooth forces on B have equal size (B spins freely), their sideways parts cancel and the rest pushes B's shaft straight down: a clockwise turn on the arm about A, so the arm is pressed into mesh and the §9 stop holds it. With the motors stopped the forces are the same, and with them off the load turns B the held way, locks it to the arm, and the push from C on the locked arm is again clockwise. Reversing A turns the locked arm anticlockwise: out of mesh. So §7 + §8 + §9 give wind, hold and release with nothing special for Swish.

### 11. Help and docs
`src/help/pages/gears.md` gets a "Ratchets and pawls" section (Set pawl, the arrow, what the audit says); `play-mode.md` a short part on one-way turning and the swinging release. Tags, `answers:`, `coverage.json`, a control chip for Set pawl, and two pictures. `AGENTS.md` "How pieces are used" gets one line on ratchets and pawls (it is sent to every assistant client, so short).

## Risks / Trade-offs

- [Tooth-point pushes on carried gears may jitter where pure turns didn't] → only links with a moving holder use them; `LINK_PASSES` sweeps stay; `check-play-mode.mjs` gets a case that the arm's gear speed stays within 2% over 5 s.
- [The arm may bounce at the mesh-distance stop and chatter in and out of mesh] → engage on the 1 mm band but release only beyond 1.5 mm; the pawl drag keeps pressing it in while winding.
- [Pawl drag makes a fixed-pawl ratchet read slightly under 120 rpm] → 2% of stall torque is far below what moves the speed reading; scenario says "about 120 rpm".
- [VEX's CAD may draw the Swish pawl a little off the teeth] → the holding rule has 0.5 mm of give; if the import still misses, add a pawl swing to the import (same call as §4) and say so in the report. Checked in task 6.4.
- [The Swish arm may be found fused to the frame or to shaft A (one body) by the body graph] → task 6.4 prints the bodies first; fix the join detection there if needed, not with a Swish special case.
- [The 35° catching rule could reject a pose that holds on a real robot] → check it against the Swish pose and against each spot `pawlSpots` gives on both ratchets; widen if any real pose fails.
- [Spur gears elsewhere that now count as "can come apart" behave differently] → the old path is kept unless a holder can move; a check runs the Clawbot and Flop starters before and after and compares speeds.

## Findings while building

- The 40 Tooth Ratchet's own pin holes, and parts locked to its shaft, are never offered as places to pin a pawl, so its holes change nothing (12 free spots between two plates).
- With whole-outline contact, a pawl on hole `2_0_0` of a 16 Tooth Ratchet rests cleanly at every tooth position only with its pin 27.7–28.3 mm from the shaft; from 21.8 to 29.5 mm it rests at some tooth positions (Swish's pin is 25.4 mm out and works at VEX's pose); outside that, never. It works one way up from each side.
- **Sections 8 and 9 were built differently (group 6).** Separate corrections for the ratchet stop, the gear teeth and the mesh-distance stop let Swish's spool creep back under load and the arm pop out of mesh. Bodies tied by gears that can swing into or out of mesh, and ratchets whose pawl rides a moving body, now form a cluster (on Swish: shaft A, the arm, shaft B, shaft C). Each body has one turn speed about its hinge; the cluster's inertia matrix is built each substep; gear rows, the mesh-distance stop, the ratchet stop and the pawl's drag are solved together (40 passes), and the bodies' velocities are set from the result. Gear links where no shaft's holder can move stay on the old path, so Clawbot and Flop have no cluster.
- **Pawl drag** is friction between the ratchet and the pawl's holder, with no make-up torque on the motor.
- **Motor control, two general fixes:** the torque that builds while a motor is under speed now rises at a usable rate on a very light shaft; and every motor's speed is read before any motor pushes, so two motors on one shaft share the load.
- **Hold on Swish:** with 0.05, 0.3 and 0.6 N·m pulling the spool back, it turns back 19.7° (the ratchet's tooth of slack), then creeps 0° over 2 s, arm in mesh. The meshed arm sits at 29.4° (§10 estimated 33.6°).
- **Lifting the pawl (task 5.4)** is checked with an outside push on the pawl, not a second motor's beam.

