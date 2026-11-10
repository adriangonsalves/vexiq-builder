## Context

See proposal.md for why. What exists today:

- **Band parts are in the catalog as flat rings with no ports:**
  - Silicone Rubber Band #32 (228-2500-468), #64 (475), Thin #64 (474) and #117B (470);
  - the 2x30 mm Square Silicone Belt (1225);
  - the 2x30/40/50/60 mm Rubber Belts (221–224);
  - the Rubber Band Anchor (157), which also has no ports and so can't be mounted yet.

  Their boxes give the ring size. For example, #117B is 114 mm across and 6.3 mm wide, and the 2x30 belt is 32 mm across and 2 mm thick.
- **Shaped parts** (`src/utils/shapedParts.js`) let a part copy carry `shape: { kind, ... }`. The file names rubber bands as a planned kind. A kind's `shapeMesh(pos, norm, idx, shape, part)` sees only the part and its shape, never other parts. Bent sheets keep their whole geometry in the shape for this reason.
- **Part data has what spots need:**
  - Gears and sprockets carry `gearSpecs` with tip and root radius, `gapPhaseDeg`, `toothPhaseDeg`, `faceSpanMm` and `boreAxis`. The 24 Tooth Sprocket has tip 26.19, root 22.68, gaps every 15° from 15°, and a face from −2.68 to 2.67 mm.
  - Pulleys carry `gearType: "pulley"` and `pitchRadiusMm`.
  - Standoffs, pins and shafts are fasteners with ports and axes.
- **Chain builder** already does over-or-under questions and obstacle finding (`chainPath.js`, `chainObstacles.js`). Hole picking already has a hover-step-click session in `Viewport3D.jsx`, where the wheel, R and Shift+R step through fits.
- **Play mode** has a kinematic pass and a Rapier physics world (`src/sim/physics.js`). Chains have no body of their own and are moved by `playRunner.js`.
- **Swish measurements** (scratch script on VEX's meshes, 24 Tooth Sprockets with axes along x):
  - Each intake band end wraps two 0.5x Pitch Standoffs, 12.7 mm from the sprocket centre at 45° and 315° (upper band) or 135° and 225° (lower band). The standoffs sit 6.4 mm off each sprocket of a pair, so they are held between the two.
  - Each run then crosses the inner sprocket's tooth ring through the gap at the same angle as its standoff. Those are gaps 2 and 20, or 8 and 14, counted from the world angle, not yet from the part's own phase.
  - The band's points reach from radius 10 to 28 mm there. So the run climbs from the standoff, out through the gap, then on across the robot.
  - The arm bands' standoff end sits about 3 mm from the standoff in VEX's CAD.

## Goals / Non-Goals

**Goals:**
- A band is a shaped part whose drawing is self-contained, so saving, history, thumbnails and the MCP server need no new paths.
- One path solver serves the builder preview, editing, rerouting after moves, Play mode redraw, MCP and import.
- Placing bands ships and is useful before Play pull and import are done.

**Non-Goals:**
- Belts driving pulleys by friction in Play mode. A belt doesn't link pulley turning in this change; a later change can add it as chains do.
- Bands snapping, or wearing.
- Bands as tires stretched over hubs. Use the Tire parts.
- Twisting a band along its length, other than the figure-8 cross.
- Making the Rubber Band Anchor mountable (it has no ports). Its hook is a spot only once something places it; giving it ports is a separate fix.

## Decisions

1. **The shape stores the route and the solved path.**

   `shape = { kind: 'band', route: [{ instanceId, feature, side, wraps, height }], cross: [i…], path: { points, radius } }`:
   - `points` is the band's middle line, in the band copy's own frame.
   - The band copy's position is the middle of the path, and its rotation is none.
   - `shapeMesh` sweeps a round section of the measured thickness along `points`. It stays pure, as a sheet bend does.
   - The engine re-solves `path` whenever a part in `route` moves, and saves the new shape in the same history step.

   *Alternatives considered:*
   - Store only the route and solve in `shapeMesh`. Rejected: `shapeMesh` can't see other parts, and thumbnails, the MCP server and loading would all need the whole build.
   - Make bands a separate list outside the parts. Rejected: everything that already works for shaped parts (copy, delete, groups, history) would have to be built again.

2. **Every spot becomes a circle or a point.**

   `src/utils/bandPath.js` turns each spot into one of these, in the spot part's frame:
   - **Circle** (centre, axis, radius, free span along the axis):
     - post: standoff body radius, pin shank or head radius, shaft end;
     - groove: `pitchRadiusMm`;
     - rim: `tipRadiusMm`;
     - edge, rounded end: a beam's or bracket's rounded end, as a circle round the end hole's axis at half the beam's width; a right-angle beam's corner the same way, round its corner hole.
     - edge, straight: a straight edge a band hooks over, as a circle whose axis runs along the edge, at half the part's thickness, with a free span the edge's length. Task 1.3 measures which form Swish's latch belts use on the 2x3 Right Angle Beam.
   - **Point** (gap pass and gap hook): the gap's centre at `rootRadiusMm` plus half the band's thickness, at angle `gapPhaseDeg + 15k` (or that tooth count's spacing). It also carries the sprocket's axis, so the solver knows the band crosses the face there.
   - **Anchor hook:** from a small hand table, `public/band-spots.json`, keyed by part number. Parts whose shape the rules above get wrong can be added there too.

   Spots are found from metadata, never from meshes, so the app and the MCP server agree.

   *Alternative considered:* find spots by mesh shape. Rejected: slow, and the metadata already has every radius needed.

3. **The path is the shortest loop that meets the route.**

   The variables are each circle's contact angles and each post's height. The solver uses alternating one-dimensional minimising: move one variable at a time to shorten the loop, keeping side, wraps and the height limits. It stops when no move shortens the loop by more than 0.01 mm, or after 200 rounds.
   - **Side** sets which way the band goes round each circle relative to the loop's direction.
   - A **cross** swaps the side on the second circle of the pair, which gives the inner tangent.
   - **Wraps** add whole turns, laid side by side along the axis by the band's thickness.
   - **Gap points** are fixed in their part.

   With every axis parallel, this gives the usual flat belt answer in one round. It also handles Swish's slanted arm bands and the intake runs that climb through a gap.

   *Alternative considered:* closed-form tangent lines only. Rejected: it can't handle posts at different angles or gap points, which Swish needs.

4. **Gaps are numbered from the part's own tooth phase.** Gap k sits at `gapPhaseDeg + k × 360/teeth`, measured in the part's frame about its `boreAxis`, so a number stays with its tooth when the part turns. Mirror maps gap k to the gap at the mirrored angle on the mirrored part. The Swish numbers in Context (2, 20, 8, 14) are provisional, counted from the world angle. The specs say "the gap in line with each standoff" instead. Task 1.3 finds the part-frame numbers for the fixture.

5. **Routes and parts in the way reuse the chain code.**
   - **Candidates:** spots on parts within reach (inside a box round the two clicked spots, grown by half the band's free length). Routes are tried with zero, one or two middle spots, on each side.
   - **Filtering:**
     - runs that hit part hulls are dropped, using the same hull test as `chainObstacles.js`;
     - routes that aren't snug or tight are dropped.
   - **Ranking:** as the spec says.
   - **Parts in the way:** a run through a part that isn't a gear asks over or under, as Chain builder does. A run through a gear's or sprocket's web is moved to the shortest gap without asking.

6. **Builder interaction** reuses the hole-pick session in `Viewport3D.jsx`:
   - **Hover:** a raycast on parts, then the spot on the hit part nearest the hit point. Each part type's spot list is cached in its own frame.
   - **Stepping:** the wheel, R and Shift+R step through the spots within 8 mm of the pointer, nearest first, as they step through fits when placing a part.
   - **Panel:** `BandBuilderPanel.jsx` has the size list, the route list with side, wraps and cross controls, the stretch readout, Show routes, and the ring close-up.
   - **Ring close-up:** an SVG drawn from `gearSpecs` and the parts on the gear, with the route's crossings drawn on it.
   - **Keys:** Tab is avoided, since it moves the browser's focus. Every key action also has a button, for touch and young builders.

7. **Rerouting after edits happens in the engine.**
   - `core.js` keeps a map from each part to the bands that touch it.
   - After any action that moves, turns, mirrors, removes or hides parts, the bands that touch them are re-solved inside the same action, so undo takes both back together.
   - The solver is fast enough to run every time: a band has under 12 spots and the solver runs at most 200 rounds.
   - A band that loses spots, down to fewer than two, becomes a flat ring at its last position.
   - Overlap checks skip a band against the parts on its route, and against other bands on the same spot.

8. **Play mode pull:**
   - `bodyGraph.js` records each band's spots against the body holding them.
   - Each physics substep, `physics.js` re-solves the band from the bodies' poses, starting from the last answer, which takes a few rounds.
   - Its tension is `T = k × (L − L0)` when `L > L0`. At each spot it adds `T × (in + out)` as a force at the contact point on that body, using the unit directions along the band.
   - `k` per band size, and the colour limits, are assumed values in a new `src/sim/bandStrength.js`, in the `assumed(value, unit, note)` style of `fastenerStrength.js`.
   - `playRunner.js` sweeps each band's mesh again from the current path every frame.
   - The kinematic pass leaves bands as they are and lists them.

   *Alternative considered:* Rapier spring joints between body pairs. Rejected: a band touching three or more bodies, or wrapping a post, can't be one spring.

9. **MCP:**
   - Features are written as `post:<portId>`, `groove`, `rim`, `gap:<k>`, `gaphook:<k>`, `edge:<portId>` and `hook`.
   - `place_band` calls the same engine action as the app.
   - With two or more spots it places the band, unless a part in the way needs an answer, in which case it returns `needsRoute`, as `build_chain` does.
   - With `list: true`, or one spot, it returns spots and candidate routes and changes nothing, as `bend_sheet` does without a choice.

10. **Import** (`scripts/import-cad.mjs`):
    - Visible bent band leaves (`/470 .*bent|1225\) Bent/i` and their kin) are no longer skipped. Their meshes are decoded as in the Swish script.
    - After the other parts are placed, `place_band` with `list: true` gives the spots on the parts near each band.
    - **Spot test:** a spot is touched when band points come within 4 mm of its circle or point. The 4 mm allows for the arm band's 3 mm miss.
    - **Gap passes** are found where band points cross the tooth ring inside the face span.
    - **Order:** by angle round the band's own best-fit plane.
    - **Side:** inside or outside, from whether the spot's centre lies inside the band's outline in that plane.
    - The band is then placed with `place_band`. The report prints its spots and stretch.

## Risks / Trade-offs

- **The solver may settle on a wrong local answer** on routes with many slanted posts. → Start from the straight-line guess with the stated sides. Check every built-in Swish route against VEX's mesh within 2 mm in `scripts/check-bands.mjs`.
- **Rerouting on every move could slow big builds.** → Only bands touching moved parts are re-solved. A band's path is re-solved, not its mesh, until it is drawn. Timed in the check on a 1,000-part build.
- **The assumed stiffness makes Play pull wrong.** → It is one table, marked assumed, and named in features.md. The Play spec promises only the direction of pull and that it grows with stretch.
- **The Swish gap numbers measured so far come from world angles.** → The specs name gaps by what they line up with. Task 1.3 finds the part-frame numbers for the checks.
- **Edge spots on beams are only right for rounded ends.** → Square-ended parts get spots only from `band-spots.json` entries. The import report lists any band it couldn't match.
- **The 3 mm gap seen at Swish's arm standoff could be a VEX CAD error or a different post.** → Import matching allows 4 mm, and the check compares against the instructions' finished view by eye once.

## Migration Plan

Nothing to migrate. Builds without bands are unchanged. A band copy with no `shape` stays a flat ring. Builds saved with bands open in older versions as flat rings, because unknown shape kinds are ignored. Rollback means dropping the kind, and bands then show as flat rings.

## Open Questions

These were settled as assumptions. They can change without changing the approach:

- **Sizes:** only the library's band and belt parts. Free length is measured from each model.
- **Too far:** a band past 3× shows red and a suggestion. It doesn't snap in Play mode.
- **Play redraw:** bands are redrawn live every frame. If it costs too much on big builds, a setting can drop it to every few frames.
