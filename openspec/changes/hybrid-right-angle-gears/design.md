## Context

See proposal.md for why. What exists today:

- **Hybrid gears are spur gears in the data.** All eight (12/24/36/48/60 Tooth Hybrid, 8/16/24 Tooth High Strength Hybrid) have `gearType: 'spur'`, measured spur data (teeth, module, pitch radius, tooth phase), and `faceSpanMm` of about `[-2.43, 4.42]` (`4.67` for high strength) where a plain gear has `[-2.43, 2.42]`. Since d7c9aaf every one has a square shaft bore.
- **The shape, probed for this plan (2026-11-17).** Rays cast along the axis at radii across the teeth show that on every hybrid gear, high strength ones included, the teeth carry on about 3 mm past the +z face, with tops sloping down from root to tip (a chamfer). The −z face is flat, as on a plain gear. A plain 24 Tooth Gear shows nothing of this. The existing crown measurement finds a tooth pattern on the +z face of every hybrid gear but rejects it (its "tooth depth" of 4.5–6 mm is the length of the extended teeth, not a crown tooth's height).
- **Swish's intake pose (from VEX's CAD).** The 24 Tooth Hybrid's axis runs along world X and the 12 Tooth Hybrid's along Z. The axes cross (0.03 mm apart): 8.8 mm out along the 24 Tooth's +z from its center, and 16.0 mm out along the 12 Tooth's +z. Both extended faces point at the crossing. Less the partner's pitch radius, that's 8.8 − 6.35 = 2.45 mm and 16.0 − 12.7 = 3.3 mm: each gear's pitch circle passes through the other's extended teeth.
- **The 90° code** (`src/utils/gearMeshing.js`). `worldToothed` gives `kind: 'gear'` for spur gears and `'bevel' | 'crown' | 'worm'` for the 90° parts. `meshRelation` sends any pair with a 90° kind to `rightAngleRelation`, and otherwise rejects axes that aren't parallel. `rightAngleContact` finds the contact point `P` per pair kind, and `patternOf` / `angularPattern` read each part's tooth phase at `P`, which gives the meshing turn, the tooth error and (by `meshRatio`) the signed speed ratio. `rightAnglePair(metaA, metaB)` decides which parts may pair (spots, jump, Join, `mesh_right_angle`). `bodyGraph.js` turns mesh entries of kind `bevel | crown | worm` into links with a signed ratio.

## Goals / Non-Goals

**Goals:**
- One rule for hybrid pairs, used by placement, the audit, the spots and Play mode alike, so they agree by construction (as for the other 90° pairs).
- Hybrid gears keep meshing side by side exactly as today.

**Non-Goals:**
- A tooth-by-tooth contact model. As for crown gears, the mesh is judged at one contact point.
- Measuring a hybrid gear's face as crown teeth (it isn't one).

## Decisions

1. **Data: a `hybrid` block inside `gearSpecs`, `gearType` stays `'spur'`.** New `measureHybridFace(part, gearSpecs)` in `scripts/measure-part-geometry.mjs`, called from `measureShapes` for spur gears. It casts rays along the axis from both faces at radii between root and tip (as `measureCrownGear` does), and reports the face whose tooth tops stand clear of the hub plane by more than 1 mm: `{ face: +1 | -1, plainZ, tipZ, stretchMm: [lo, hi] }`, all along the part's own Z in the same frame as `faceSpanMm`. `plainZ` is where a plain gear's face would be (the mirror of the flat face), `tipZ` how far the teeth reach at the tip radius, and `stretchMm` the stretch past the face center where the teeth are whole at the pitch radius: from the plain face to the sloped top at the pitch radius, less a quarter module at the top (the teeth are whole down through the plain face; trimming there too left Swish's 24 Tooth, whose partner's pitch circle passes 0.16 mm past it, outside). Plain spur gears get no `hybrid` block. *As measured:* plain face 2.29 mm on all eight; the band runs to 4.22–4.31 mm on the standard hybrids and 4.63–4.74 mm on the high strength ones.
   *Why not a new gearType:* every spur code path (parallel meshing, gear trains, chain code, the audit) would need to learn it. A flag keeps hybrid gears spur gears and adds only the 90° role.
   *Why measure:* the high strength hybrids have a different module and face (4.67 mm), and the right-angle work showed name-based values go wrong. The check asserts the measured stretch includes Swish's 2.45 and 3.3 mm.

2. **Pairing: `rightAnglePair` returns `'hybrid'`** for two spur gears that both have a `hybrid` block and the same module. So standard hybrids pair with standard, high strength with high strength, and a hybrid never pairs with a plain spur gear at 90°.

3. **World part: `worldToothed` adds `hybrid` to the spur gear object:** the face direction (`axis × face`) and the stretch as two world distances along it. The part stays `kind: 'gear'`.

4. **Routing: a perpendicular pair of hybrid gears goes to the 90° path.** In `meshRelation`, before the parallel check, a gear pair where both have `hybrid` and the axes are perpendicular (within 2°) is sent to `rightAngleRelation`. `rightAngleMeshKind` and `rightAngleNearMiss` accept such a pair too (they check `RIGHT_ANGLE_KINDS` today; add "or both hybrid gears"). Parallel hybrid pairs never reach the new code.

5. **Contact: `hybridContact(a, b)`.** Find the crossing `O` of the two axes (closest points; their gap must be within the 1.0 mm tolerance). Each gear's distance to `O` along its own face direction, `dA` and `dB`, must be positive (face toward the crossing). Then `hA = dA − pitchB` must lie within A's stretch, and `hB = dB − pitchA` within B's, each with the 1.0 mm tolerance. The contact point is `P = O − pitchB·faceA − pitchA·faceB`: one pitch radius from each axis, on the side of each gear the other stands on. `distanceMm` is the largest amount by which any of these misses (0 inside the stretch), so the near-miss report and the 3 mm precise-placement slide work as for the other pairs. The tooth phase at `P` comes from the existing `angularPattern` (both are spur gears turning about their centers), so `exactDeg`, `errorTeeth` and `meshRatio` need no new code. The ratio comes out as −(teeth ratio) with the sign set by the geometry. The check asserts 2:1 for Swish's pair and that the teeth move together at `P`.
   *Alternative considered:* treating one gear as a crown and reusing `crownContact`. It fits Swish's 12 Tooth as the "crown", but the rule isn't symmetric, has no stretch for a gear's own teeth, and would need the hybrid face measured as crown teeth. Rejected.

6. **Spots: four, at the middle of the stretches.** In `meshSpots`, for pair `'hybrid'`, each quarter-turn direction `u` round the partner's axis puts the gear's axis along `u` (face toward the partner's axis), with `dGear = pitchPartner + mid(stretchGear)` and `dPartner = pitchGear + mid(stretchPartner)`. That fixes the crossing point on the partner's axis and the gear's center from it. The spot then gets the meshing turn as other spots do. Blocked spots are dropped by the callers, as today.

7. **Play mode: kind `'hybrid'` joins the 90° links.** `core.js` already adds mesh entries with `kind` from `rightAngleMeshKind` and a signed `ratio` from `meshRatio`; with decisions 4–5 these appear for hybrid pairs. `bodyGraph.js` adds `'hybrid'` to the `bevel | crown | worm` branch (two-way, not `oneWay`). `kinematic.js` and `physics.js` need nothing new, since they take links by ratio and sign.

8. **Acceptance on Swish.** A case in `scripts/check-play-mode.mjs`: open the Swish starter, run the intake motor forward 1 s, and check the intake roller body turns at 2× the motor shaft's speed within 5%, the same way on reversing. A case in `scripts/check-right-angle-gears.mjs` checks the pair from the starter is reported as `'hybrid'`, in mesh, with no overlap, and that flipping the 12 Tooth or swapping in a plain 24 Tooth Gear takes it out of range.

   *As built (task 4.2):* one more cause stood between motor and roller. The 12 Tooth Hybrid's square bore (made a shaft bore in d7c9aaf) had no flat angle and kept the pin hole's length (−14.5 to 9.5 mm), so its shaft's group left it out and it turned loose. The indexer now measures the converted bore's flats and gives it the gear's thickness as its length. With that, the roller turns at 240 rpm for the motor's 120, both ways.

## Risks / Trade-offs

- **[Swish's pose is one sample of a hybrid pair]** → the stretch comes from the models, not from Swish. Swish only has to fall inside it. Build a second pair by hand (12 with 36 Tooth Hybrid) with `mesh_right_angle` and look at it from two views. If the teeth visibly clash or float, adjust the stretch's quarter-module trim and say so in this file.
- **[The intake may still not turn for another reason]** (the imported intake has two other overlaps: a 2x Motor Shaft in a gear, and a 24 Tooth Sprocket against a 6x Pitch Spacer) → the Swish check names any body between the motor and the roller that doesn't move. Look into it before calling the change done.
- **[The collision check sees a meshed hybrid pair as overlapping]** (the sloped tooth tops pass close) → the scenarios require no contact after meshing. If the models can't meet that, treat a meshed hybrid pair like the tire-on-hub case and say so in the spec before archiving, as right-angle-gears planned for bevels.
- **[A hybrid gear flipped on its shaft]** keeps meshing side by side but leaves 90° range. That's right (its extended face is the meshing side), and the message on placing names it as out of range.

## Migration Plan

Part data is regenerated (`npm run index-metadata`): hybrid gears gain `gearSpecs.hybrid`, nothing else changes. Saved builds need no change. Rollback is reverting the commit and regenerating.
