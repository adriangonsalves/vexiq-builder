## Context

See proposal.md for the motivation. The current state:

- **Part data.** `scripts/index-part-metadata.mjs` writes `gearSpecs` for 57 parts in the gears category, but only from their names:
  - `teeth` comes from the name;
  - `pitchRadiusMm = teeth/24 × 12.7` assumes one tooth size, so the 34DP gears come out wrong;
  - `phaseOffsetDeg = 180/teeth` is a guess, not where the teeth sit.

  Ports have `shaft_bore` (about 74 parts) and `shaft_socket` (the Smart Motor only), with no shape or angle. Axles are `fastenerSpecs.fastenerType` in `straight_shaft`, `capped_shaft` or `motor_shaft` (50 parts).
- **Meshes.** `mcp/assembly-engine.mjs` has `getPartRawGeometry(part)`: a BVH over a part's real, unshrunk mesh, already used for fine measurements. `getPartCollisionBvh` is the shrunk collision mesh. The Smart Motor's model is a single mesh, with one primitive.
- **Placement paths.** Every one of these goes through `src/utils/pinHoleAlignment.js` (features, `findHoleSnap`, `planMates`, `insertPose`/`listInsertFits`) and the viewport's collision sweep:
  - the drag's `objectChange` handler: grid steps, `snapDragToHoles`, flush stops;
  - `mateSelected`/`sweepToContact`;
  - hole picking and the copy preview.

  Shaft rolls in picking use `spinSymmetric`, which gives a square axle a single roll, so its flats are never considered.
- **MCP.** `mesh_gear_train` tries candidate rolls until there's no collision. `place_parts` inserts take an optional `rollDeg`.
- **Rotation.** A part's rotation is stored as Euler XYZ degrees on the instance. History records instance diffs.

## Goals / Non-Goals

**Goals:**
- One shared, pure module for the maths: mesh phase, square fit and shaft groups. The viewport and the MCP engine both use it, so the app and the assistant place parts identically.
- Every value used at runtime comes from the metadata. Nothing measures meshes in the browser.
- The data model is ready for a later motion simulation: shaft groups and the motor hub angle are explicit.

**Non-Goals:**
- Bevel, crown, worm, sprocket and chain meshing.
- Propagating turns through a whole gear train. Only the group being placed turns.
- Animating anything.

## Decisions

### 1. A common angle frame
All angles about an axis `a` are measured counter-clockwise (right-hand rule about `a`) from a reference direction `u = refAxes(a)[0]`, with `v = a × u`.
- `refAxes` is the existing `crossAxes` from `pinHoleAlignment.js`, moved to a shared helper so the indexer, the app and the engine agree exactly.
- **Metadata** angles are in part-local axes.
- **At runtime** a part's local tooth or flat angle is turned into a world angle about the world axis. The local `u` is mapped through the part's rotation and measured in the frame of `refAxes(worldAxis)`.
- If the world axis comes out opposite to the reference axis used for a comparison, angles are negated.

### 2. Measuring (indexer, raw mesh BVH)
All measurements cast rays at the raw mesh at 0.25° steps (1440 rays), and fit with a Fourier phase, `φ = atan2(Σ r·sin kθ, Σ r·cos kθ) / k`, which is robust to mesh noise.
- **Spur gears.** Rays come inward toward the bore axis in the gear's mid-plane: the middle of the tooth band along the axis, found from the bbox and refined by where the tip radius is greatest. Each gives a surface radius `r(θ)`.
  - Tip radius is the maximum of `r(θ)`.
  - Tooth phase comes from the Fourier fit with `k = teeth`, at the angle of a tooth center: a maximum of the fit.
  - The module is `2·tip/(teeth+2)` (standard involute), snapped to the nearest VEX IQ tooth size: 16 DP (high strength), 24 DP (standard) or 34 DP, within 10%. From it come the pitch radius `teeth·m/2` and the tooth spacing `π·m`. A size that fits none of them, ratchets and toothed non-gears (washers, belts, pawls, cams) are unmeasured.

  Standard gears' measured tip should give a module within 2% of 24 DP. The check script asserts this, so a bad measurement is caught. The 34 DP and high-strength gears get their own module.
  - The gear's own center hole is measured too (`boreShape`), since some gears, like the idler gear, have no shaft port.
- **Racks.** Rays come down onto each side face along the rack's length (the bbox's longest axis), giving a height `h(s)`. The fit is `k = 2π/spacing` for each VEX IQ tooth size's spacing `π·m`. The toothed face and tooth size are the strongest pattern whose tooth depth (tip minus root) is about 2.25 modules. The pitch line is one module below the tip line.
- **Square bores and sockets.** Rays go outward from the bore axis at mid-depth, giving the wall distance `d(θ)`. A 4-fold Fourier amplitude above 3% of the mean means square. The flat angle is the angle of a flat's normal, a minimum of `d`, taken modulo 90°.
- **Square axles.** Rays come inward toward the shaft axis at several points along it, giving `r(θ)`. Same 4-fold fit; the flat angle is at a minimum of `r`.
- **Motor hub.** Using the STEP cylinders coaxial with the drive socket, the hub radius is the smallest cylinder wall radius larger than the square's diagonal. The hub runs from its face (measured just outside the square's corners) down to the socket floor.

**Output:**
- `gearSpecs` gains `measured`, `diametralPitch`, `tipRadiusMm`, `rootRadiusMm`, `moduleMm`, `toothSpacingMm`, `toothPhaseDeg`, `faceSpanMm` (the tooth band along the axis), `boreShape`, and a corrected `pitchRadiusMm`.
- Racks get `rackSpecs: { direction, normal, axis, toothOffsetMm, toothSpacingMm, tipLineOffset, pitchLineOffset, lengthSpanMm, faceSpanMm }`.
- Shaft bore and socket ports get `shape` and `squarePhaseDeg`.
- Shafts get `fastenerSpecs.squarePhaseDeg`.
- Shafts also get `fastenerSpecs.shape`.
- The motor gets `hubSpecs: { radiusMm, faceOffsetMm, depthMm }`, offsets along the socket axis from the socket's origin.

`phaseOffsetDeg` stays for compatibility, but nothing new reads it.

### 3. The meshing maths (`src/utils/gearMeshing.js`)
For gears A (placed) and B (being placed) with parallel axes `a`:
- `β` is the angle of the direction A→B, and the tooth pitch is `p = 360/N`.
- The fractional tooth position facing the other gear is `t_A = frac((β − φ_A)/p_A)` and `t_B = frac((β + 180 − φ_B)/p_B)`.
- Rolling keeps `t_A + t_B` constant, and the gears mesh when `t_A + t_B ≡ ½ (mod 1)`. That gives the target `φ_B* = β + 180 − p_B·(½ − t_A)`.
- The meshing turn is `wrap(φ_B* − φ_B)` into `(−p_B/2, p_B/2]`.

For a rack, the gear's contact point projects to `s` along the rack, with `t_R = frac((s − s₀)/spacing)`. The rule is `t_R ± t_G ≡ ½`, with the sign set by `sign((a × n)·d)`, where `n` points from the rack to the gear.

`meshTurn(gear, neighbours)` returns the turn and per-neighbour errors. The candidates are each neighbour's exact turn, and the one with the smallest worst error wins. Neighbours over a quarter tooth off are reported. Mesh range follows the spec: parallel within 2°, axial overlap of tooth bands, center distance within 1.0 mm of the sum of pitch radii. All of it is pure functions of world features and metadata, with Node checks.

### 4. Square fit and shaft groups (`src/utils/shaftGroups.js`)
- **`squareFitRoll(shaft, bore)`:** the smallest turn of the shaft about its axis that makes `flat_shaft ≡ flat_bore (mod 90°)`, or 0 for a round or unmeasured bore. The reverse (a bore part onto a shaft) uses the same function with the sign flipped.
- **`shaftGroups(instances, features)`:** for each square axle, the members are:
  - the axle itself;
  - every part whose square bore is seated on it, using `findSeatedPairs` with the axle's span;
  - a Smart Motor whose socket is seated on it, as `{ instanceId, hub: true }`.

  Round bores are excluded.
- **`turnGroup(group, axis, point, deg)`:** returns new pose patches. Each member's rotation is pre-multiplied by the turn about the world axis, and its position is turned about the axis line. A hub member only changes `socketAngleDeg`.

### 5. Where the turns happen (viewport)
- **Drag, live:** in `objectChange`, after the existing hole snap and before the flush or collision step:
  - a dragged spur gear in mesh range gets its meshing turn applied to its own quaternion. While dragging, the gear has left any group;
  - a dragged square axle on a square bore's line gets `squareFitRoll`.

  Applying the turn before the collision step stops tooth clashes from holding the gear short of the hole.
- **Drag release, mate, hole pick, copy insert:** after the part is posed, a post-placement step runs:
  1. square fit, either the axle to its first bore, or a square-bore part to its axle;
  2. if the part is a gear in mesh range: if it now sits on a square axle, turn the whole group by the meshing turn; otherwise turn the gear;
  3. if an axle is seated in a motor socket, set the hub angle to the axle's flat angle relative to the socket's.

  The patches go to App with the placement's own patch, as one history step, and the message is extended.
- **Hole picking and the copy preview:** fits for a square axle into a square bore use `squareFitRoll`-based rolls, the four fitting rolls in place of `spinSymmetric`. A gear's preview pose applies the meshing turn (spec: modified Lined-up preview).
- **Rotate mode:** never auto-meshes.

### 6. Motor hub (viewport and engine)
At load, the motor's render and collision geometries are split by triangle: a triangle goes to the hub when all its vertices are within `hubSpecs.radiusMm + 0.2` of the socket axis and within `[face − depth, face + 0.2]` along it. The rest is the body.
- **Rendering:** the hub mesh is a child of the motor group, with `rotation = socketAngleDeg` about the socket axis through its origin.
- **Collision:** the hub is its own collision piece. Collision geometries are shared by every instance of a part, so the hub's turn is kept per instance: `group.userData.collisionLocalMatrices` in the viewport, and the engine's `posedPieces` from `socketAngleDeg`. `checkGroupCollision` and `checkCandidateCollision` multiply it in, so a turned axle in a turned hub doesn't count as overlapping.
- **Data:** `socketAngleDeg` lives on the motor instance, saved and diffed in history like other fields. `get_assembly` shows it.

### 7. MCP
- **`mesh_gear_train`:** each gear's roll is its meshing turn against the previous gear, replacing the candidate-roll loop.
- **`place_part`, `place_parts`:** after posing, run the same post-placement step as the app, through the shared modules. A given `rollDeg` on a square fit or a gear in mesh range is replaced, and the reply says so. Replies list meshes and conflicts.
- **`get_part_details`:** returns the new metadata.

### 8. Longer drag pull and hole picking for bore parts
- **Drag pull:** `HOLE_SNAP_AXIAL_REACH_MM` becomes `MAX_AXIAL_GAP_MM` (12 pitch). `snapDragToHoles` widens its nearby-part box to the same reach, or far holes would never be looked at. Among pairs in reach, `findHoleSnap` takes the smallest pull, and pulls within 0.25 mm of each other go to the pair with the smaller gap along the line.
- **Bore parts:** a part with no pins, pegs or shafts and at least one `shaft_bore` / `shaft_socket` feature. `buildPickSession` gives it these targets:
  - both ends of every other part's `shaft` feature: the end point, with `outward` along the axis away from the shaft;
  - every open face of other parts' openings that a shaft fits.

  `listBoreFits` (pinHoleAlignment.js) poses the part with `insertPose`, using a lead built from the bore: its face toward the target, `dir` pointing out of the part through that face. A socket leads only with its open end.
  - Rolls are the four quarter turns, or the four square-fit rolls when the bore and the target are both square.
  - A gear's preview takes its meshing turn at the first point along its way in where it meshes.
  - Travel and sweep: onto an axle, the axle's length (it slides until contact); onto a hole face, it stops at the first contact, within 1 pitch.

  `pickClick` and `copyInsert` are unchanged: they push along the fit's direction like mating and run the placement step. Axle ends are never "taken". The banner leaves out the pin count for bore parts.
- **Double-click:** `mateAction` is unchanged. When it says 'none' for a bore part, picking starts instead.

## Risks / Trade-offs

- **[Measurement fails on unusual geometry]** (hybrid gears with spokes, ratchets, gears fused to crank arms) → Each value carries `measured`. The check script asserts sane ranges, and standard gears within 2% of the nominal pitch radius. Unmeasured parts fall back to not turning (gears) or "round" (bores). The indexer prints a list of parts it couldn't measure.
- **[Euler round-off after many turns]** → Turns are composed as quaternions and stored back as Euler degrees rounded to 0.01°, as today.
- **[Group turns break other meshes]** (per the user's choice) → Only the group being placed turns. Neighbours left off-mesh are named in the message.
- **[Live turning while dragging feels jumpy]** → The turn is at most half a tooth (7.5° for a 24T gear), and only in mesh range. Alt turns hole snapping off as today, and with it live meshing.
- **[Splitting the motor mesh catches body triangles]** → The split region is limited to the measured hub cylinder and socket depth. It is checked visually, and by a collision check with axles at 0°, 30° and 45°.
- **[Metadata regeneration churn]** → The indexer only adds fields. Existing ports and IDs are unchanged, and a diff check in tasks confirms this.

## Migration Plan

- Re-run the indexer, and commit the regenerated `part-metadata.json` and `catalog.json`.
- Saves without `socketAngleDeg` load with 0.
- Existing builds aren't re-meshed automatically. A gear meshes again the next time it is placed (drag, mate, pick).
