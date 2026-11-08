## Context

Play mode (`src/engine/core.js`, `src/sim/bodyGraph.js`, `src/sim/physics.js`) merges any two parts joined along two or more non-collinear pin lines into a single rigid body (`b0`, `b1`, etc.) and keeps the main chassis body (`fixed[0]`) fixed in space while loose parts fall onto the floor collider at `robotMinY`. See `proposal.md` for why we need a Drop / Crash Simulator with realistic fastener pullout forces (~20 N for `1x1` pins, ~35–40 N for longer pins/standoffs, ~80 N for capped pins), ABS plastic compliance, and directional joint mechanics.

## Goals / Non-Goals

**Goals:**
- Annotate every seated fastener connection in `playInputs` with its axial pullout strength (`pulloutN`) based on part type, length, cap, and engagement depth (`overlapMm`).
- Preserve the individual part-to-part pin connections (`pinJoints`, excluding round-bore axle joins) and square-shaft fitted bonds (`shaftPairs`) inside `buildBodyGraph` even after parts are merged into rigid bodies.
- Simulate a whole-robot drop from height $H$ (`0.15 m`–`1.5 m`) onto the floor plane at `robotMinY` in `src/sim/physics.js`, including free-fall under gravity, slight drop orientation asymmetry, ABS + tire elastic impact compliance ($\Delta t_\text{abs} \approx 14\text{ ms}$, restitution $\approx 0.26$), and post-impact elastic shudder.
- Evaluate per-pin axial pullout and lever-arm prying forces during impact taking into account pin orientation (axial tension vs. radial shear and vertical compression), joint capture (clevis/boxed vs. single-sided cantilever whip), and free hinge rotation; snap pins whose load exceeds `pulloutN`; and dynamically split any detached part or subassembly into its own `Dynamic` Rapier rigid body (or hinged body if 1 pin line remains).
- Provide clean UI controls in `PlayPanel` (`Drop height`, `Drop`, `Reset`, and crash report with hover highlight).

**Non-Goals:**
- Permanent plastic deformation or fracturing solid beams in half (only pin/fastener pullout and elastic ABS flex are simulated).
- Modifying the user's saved CAD assembly or undo history during a drop test.

## Decisions

1. **Fastener Pullout Force Model (`src/engine/core.js`)**:
   - Inspect the fastener and opening parts in `playInputs`:
     - **Rubber Shaft Collars** (`228-2500-143`, `openingKind === 'collar_hole'`): `8 N` axial friction slip threshold on shafts.
     - `1x1` connector pins (`228-2500-060`) and integral corner-connector / traction-pad pegs (`insertKind === 'pin_peg'` on non-fasteners): `20 N`.
     - Longer connector pins (`1x2`, `2x2`, `3x` pins `228-2500-061`, `062`, etc.) and standoffs (`fastenerType === 'standoff'`): `35–40 N`.
     - Capped pins (`hasEndCap === true`, e.g. `0x2`, `1x2`, `2x2` Capped Pins): `80 N` on the cap-retained side and `20–34 N` on the uncapped pin side.
     - Scale by engagement depth factor $\text{clamp}(\text{overlapMm} / d_\text{full}, 0.35, 1.0)$, where $d_\text{full} = 2.4\text{ mm}$ for integral pegs (`pin_peg`) and $5.0\text{ mm}$ for discrete connector pins so short integral pegs achieve their rated `20 N` retention when fully seated.

2. **Preserving the Pin Network, Collar Joints & Square-Shaft Bonds in `buildBodyGraph` (`src/sim/bodyGraph.js`)**:
   - Record `pinJoints: [{ id, a, b, pinIds, axis, point, pulloutN, isCollar }]` for every pin stack, direct peg join, or Rubber Shaft Collar (`isCollar: true`, `pulloutN: 8`) between parts `a` and `b` (excluding free-spinning `isShaft` axle joins in round holes).
   - Record `shaftPairs: [[shaftId, memberId]]` for every part fitted onto a square shaft (`shaftOf.get(id) === gi`), and combine `bays` and `shaftPairs` into `hardPairs` so wheels and gears fitted on square shafts stay bonded unless their retaining rubber collar fails under severe axle side-thrust (`> 18 N`).

3. **Whole-Robot Drop, Directional Joint Mechanics & Dynamic Body Splitting (`src/sim/physics.js`)**:
   - When `drop(heightMeters)` is called:
     - Reset any previous drop state so repeated drops start cleanly from the assembled robot.
     - Turn the main fixed chassis body (`mainFixedId`) into a `Dynamic` rigid body (moving the floor collider onto its own dedicated fixed ground body at $y = \text{robotMinY} - 0.5\text{ m}$), and lift all robot bodies by $+H$ metres with a small realistic drop tilt (~4° roll, ~2.5° pitch).
     - On first floor contact (`evaluateDropImpact`), compute the impact deceleration $a_\text{crash} = ((1 + e_\text{abs}) v_\text{impact} / \Delta t_\text{abs}) \cdot \text{bottomOutBoost}$ using $\Delta t_\text{abs} = 14\text{ ms}$, $e_\text{abs} = 0.26$, and a nonlinear hard-stop bottoming-out factor `bottomOutBoost` above $h = 0.45\text{ m}$ ($v_\text{impact} > 2.97\text{ m/s}$) where rubber tires and ABS flex bottom out against rigid hubs and frame stops.
     - Evaluate lateral axle thrust on **Rubber Shaft Collars** (`pj.isCollar`, `8 N` threshold): at `0.15 m`–`0.30 m` collars hold (`~3–6 N`), at `0.50 m`–`0.80 m` collars slip and pop off their shafts, and above `18 N` (`1.0 m`–`1.5 m`) the wheel/hub assemblies retained by those collars also slide off their axle hinges.
     - Root each body's structural graph at its hinge anchor parts (for moving bodies like a wrist/claw) or highest-degree structural backbone part (for fixed chassis bodies), and normalize candidate cuts so `subParts` always represents the peripheral/distal subassembly rather than the main chassis.
     - For each candidate subassembly `subParts` and its cut-set `cutJoints`:
       - **Axial Tension vs. Radial Shear (`verticalAlign`)**: Horizontal pins (`|u_y| ≈ 0`) carry vertical drop impact primarily in radial shear against the solid ABS pin wall (`axialShare = 0.18`), whereas vertical pins aligned with the impact axis (`|u_y| > 0.7`) experience higher axial load only when in hanging tension.
       - **Vertical Compression vs. Hanging Tension (`inVerticalCompression`)**: When a subassembly sits *above* vertical pins or standoffs (`|u_y| > 0.7` and $r_y \ge -2\text{ mm}$, such as an upper claw beam and motor resting on standoffs), primary impact pushes the joint into axial compression against the standoff shoulder (`axialShare = 0.12`, `pryFactor = 0.42`) rather than pulling the pins out.
       - **Clevis / Boxed Capture vs. Single-Sided Cantilever Whip (`isClevisOrBoxed`, `isSingleSidedCantilever`)**: Subassemblies captured between left and right plates (`axialSpan > 20 mm`), multi-axis joints, or 3+ pin bridges across $\ge 2$ support parts resist prying (`pryFactor = 0.38`) and cannot cam out axially. Conversely, a single-sided 2-pin lap-jointed cantilevered beam (`partnerParts.size === 1, k <= 2, mSub >= 5.5 g`) experiences flexural whip from the supporting plate (`mEff = mSub + 0.056`).
       - **Free Hinge Rotation & Multi-Hinge Load Sharing (`isHinge`, `childHingeJoints`)**: Hinges turn freely around their pin axis $\hat{\mathbf{u}}_0$, so only out-of-plane offset $r_\text{axial}$ pries the hinge pin (`effectiveOverhang = rAxial + 0.15 * rPerp`), and all parallel hinges supporting the same child body (e.g. the 4 wrist pins of a 4-bar linkage) share the load together.
       - Run up to 3 cascade passes: if any pin's axial load exceeds `pulloutN`, mark it broken and re-evaluate surviving pins with the redistributed load.
     - When pin joints break (`splitDetachedParts`):
       - Re-run connected-components over the unbroken `pinJoints` and `hardPairs`.
       - Any component of parts no longer connected by $\ge 2$ pin lines to its host body is split off: its colliders are moved onto a newly spawned `Dynamic` Rapier rigid body with a pop-off impulse along the broken pin axis (or a `revolute` joint if 1 unbroken pin line remains).

## Risks / Trade-offs

- **[Risk] Rapier instantaneous rigid-body impulse is much stiffer than real ABS plastic** → **Mitigation**: Use the physical impact velocity $v_\text{impact} = \sqrt{2 g H}$ over the ABS + tire elastic deformation window ($\Delta t_\text{abs} = 14\text{ ms}$, restitution $e = 0.26$), and superimpose a visible damped elastic flex shudder on impact.
- **[Risk] Treating heavy payload modules (e.g. Robot Brain) as the graph root could invert the cut and treat the chassis as hanging off the Brain** → **Mitigation**: Root fixed bodies at the highest-degree structural frame part and normalize every candidate cut so `subParts` is always the smaller/distal side of the partition.
