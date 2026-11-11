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
- **Swish, measured again in the app's own frames** (tasks 1.1–2.4, `scripts/fixtures/swish-bands.json`, `scripts/check-bands.mjs`). These replace the scratch numbers above:
  - **Intake bands:** each passes through gaps 17 and 23 (upper) or 5 and 11 (lower) of both inner sprockets, counted from each sprocket's own tooth phase. At each end the band hooks under two 0.5x Pitch Standoffs. The solved path lies within 1.5 mm of VEX's mesh.
  - **Arm bands:** each runs from the Catapult Arm standoff down under a chassis 2x20 Beam's bottom edge, along the bottom, and round another 2x20 Beam's bottom edge up to the 0x3 Connector Pin. It then comes back the same way, as a thin loop folded out and back. The standoff end is 0.3 mm off; the 3 mm above came from the old measurement. VEX draws the band sagging in a free curve between the chassis and the arm, touching nothing, where a stretched band runs straight. So the solved path matches VEX's band only along most of it (median 3.5 mm).
  - **Latch belts:** each is also folded, from a 1x Pitch Standoff round the 2x3 Right Angle Beam's two rounded ends (holes `0_0_0` and `4_0_0`) to the pawl's 0x2 Connector Pin. The return run lies on the first one, one belt thickness out.
  - **Effect on the design:** a route may name the same spot twice. A pass at the same height as an earlier one lies one band thickness further out. An imported spot also keeps the side VEX's band touches (`wrapDir`, in the spot part's frame), and the solver follows it instead of judging the side from the loop's middle. Beams and plates get straight-edge spots (long sides and ends) alongside their rounded ends. A pin's spot is its leg (2.1 mm radius).
  - **Import reads a route from the mesh in four steps:**
    - Find the spots the band lies against (within 0.6 mm).
    - Order them by which runs between them the band covers. Take the shortest closed cycle, or the shortest path folded out and back.
    - Drop spots the band runs straight past.
    - Of the candidate orders, keep the one whose solved path is closest to the mesh (`routeFromPoints`).

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
   - **Anchor hook:** from a small hand table, `src/utils/bandSpotTable.js` (implemented as a module rather than `public/band-spots.json`, so the app and Node load it the same way), keyed by part number. Parts whose shape the rules above get wrong can be added there too.

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
   - **Parts in the way (revised after trying it on a user's build):**
     - **Wrapping by itself:** a run through a part goes round it without asking. The engine tries each of the part's round spots on each side, including the hidden edges of its box for odd shapes like corner connectors. It keeps the shortest one whose two new runs clear the part.
     - **Order:** runs are handled one at a time, the hit nearest the start of its run first. A spot may be used twice (a two-pin band's return run crosses the same beam).
     - **Pruning:** after each round, an added spot the band no longer needs is dropped.
     - **Testing:** rays along the band's middle and both edges of its strip check for parts in the way; the strip's real mesh then catches small pins the rays slip past.
     - **Giving up:** past 6 added spots, or past 3× stretch, the builder asks over or under (`needsRoute`) and changes nothing.
     - **Gears:** a run through a gear's or sprocket's web goes through the shortest gap.
   - **Free length of a post:** measured on the shapes of the parts it goes into, in the engine (`postCover`: a ring of points where a band would lie, inside or outside each part by ray crossing count). The hole data's spans turned out not to be lengths. A post needs at least 1.5 mm free; a buried pin is refused.
   - **The builder's preview:** after each click, the preview asks the engine for a dry-run placement (`place_band` with `dryRun`) and draws the wrapped route it returns. On hover it draws the plain route from the main thread, which has no meshes.

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

11. **Routing rework: a band is a tight string, routed one half at a time** (added after Build #5, `scripts/fixtures/band-wrap.json`).

    **What was measured on Build #5** (two 2x14 Beams in an L, a standoff on the outer face of each, a 1x1 Connector Pin on the corner connector inside the L):

    | Clicks | Band | Route the app gave | Stretch | What is wrong |
    |---|---|---|---|---|
    | standoff `wbyr`, pin `zqal` (2 clicks, or 3 with beam `dqdw edge:side+`) | #117B | standoff, `dqdw edge:side+`, pin, `umxw box:z-+`, `dqdw box:x++` | 0.47× | The way out goes over the beam's top edge. The way back goes round the connector's box and a different point on the beam's box. The band is twice too long and is drawn tight. The view shows it red. |
    | same, #32 | #32 | standoff, `dqdw edge:side+`, pin, `umxw edge:hole…(in)`, `dqdw edge:side-` | 0.91× | Out over the top, back under the bottom, through a connector hole edge. |
    | same 3 clicks with `back: "same"` | #32 | standoff, `side+`, pin, `umxw box:x+-`, `side+` | 0.90× | The way back still gets an extra box edge. 0.52 mm into the pin. |
    | standoff `cp2r`, standoff `wbyr` (2 clicks) | #32 | 8 entries round `i11q box:x-+`, `box:x--`, `dqdw edge:side+` | 2.00× | Box edges of the beam, not its real corners. |
    | standoff `cp2r`, standoff `wbyr` (2 clicks) | #117B | 8 entries with `i11q edge:side+(in)` | 1.03× | 0.52 to 0.68 mm into both beams and the standoff. |
    | `wbyr`, `dqdw edge:side-`, `i11q edge:side-`, `cp2r`, `back: "same"` | #32 | those four spots, there and back | 1.97× | Nothing: this is the right answer, and at most 0.30 mm into anything. |

    Depths are how far any point of the band's strip sits inside a part's collision mesh (which is already 0.38 mm inside the real surface). Good routes measure 0.30 mm or less; wrong ones 0.5 mm or more.

    **Four causes:**
    - **The halves are routed apart.** The loop is closed straight from the last click to the first, and that closing run is then pushed round parts one hit at a time (`placeBand` → `wrapRound`), each time keeping whichever single spot makes the whole band shortest. Nothing makes the way back match the way out.
    - **Detours bend round the wrong shapes.** A beam's long edge is one circle of half the beam's thickness, which cuts the beam's corners. Every other part is its bounding box (`box:` spots), which is not the part.
    - **Two overlap rules, both wrong for bands.** `checkCandidateCollision` skips every part on the band's route (`bandRestsOn`), so the audit never sees a band cutting a part it is strung on (placement does test runs against route parts, by rays, but arcs and later moves are not tested). `Viewport3D.jsx`'s `checkGroupCollision` has no band rule at all, so a band lying on a beam is red; it writes `isIntersecting: true` on the band when the band's mesh loads (near line 6852), when its shape is rebuilt (near 6905) and after undo or redo (near 7019).
    - **A slack band is accepted and drawn tight.**

    **The model:**
    - A route's spots are **hooks** or **guides**. A hook is something the band is looped on. A guide is something a half of the band bends round on its way. The first and last clicks are always hooks. Between them, posts, grooves, rims, gaps and the anchor hook are hooks; edges are guides.
    - A route with **two hooks** is a **fold**: one half is routed from the first hook to the second, and the other half comes back over the same guides and added bends in reverse, lying beside the first. This is the default, with no control to set. A bend that either half needs is added to both (the way back leaves the far side of each hook, so it can hit a part the way out misses).
    - The shape keeps the user's own clicks (`shape.picks`, `shape.back`) beside the solved route, so the band can be routed again when parts move. A caller sending a whole route (import, mirror) says `back: "straight"`.
    - A route with **three or more hooks** is a **loop**: one half per pair of neighbouring hooks, the last back to the first, each routed by itself. A guide belongs to the half it was clicked in.
    - `back: "straight"` forces a loop on any route; `back: "same"` forces a fold. The default is `"auto"` as above.
    - Each half is the **shortest clear way** from one hook to the next: straight if nothing is in the way, else bent round the real corners of the parts between.

    **One overlap rule** (`bandOverlaps` in a new `src/engine/bandFit.js`, the only place a routed band's overlaps are judged):
    - The band's strip is sampled every 1 mm along its path, across its width at the middle of its thickness. Its thickness isn't tested: rubber pressed on a part squashes flat. (Testing the corners of the section put all of Swish's arm bands 0.7 to 0.8 mm into the beams beside them.)
    - On a post, the band's middle stays half its width in from the ends of the post's free stretch, so its width doesn't sink into the part the post stands on.
    - A part overlaps the band when any sample is more than `TIGHT_FIT_MM` (0.5 mm) inside that part's collision mesh.
    - Left out: samples on the curve round a spot, against that spot's own part (the spot's circle is not the part's exact shape); any gear the band passes a tooth gap of (it runs inside the gear's outline there); other bands.
    - `checkCandidateCollision` uses this for any pair with a routed band and no longer skips route parts. The 3D view skips every pair with a routed band and never writes a routed band's flag; the flag is set by `place_band` and by the engine's band-follow step.

    **Slack:** the builder's size is **Choose for me** unless the user picks one. A picked size that would be slack (below 1.0×) is not placed: the panel names the size that fits and offers it in one click. `place_band` refuses the same way unless `allowSlack` is given. Imports (`ignoreInWay`) are not refused. A band that goes slack later, because its parts moved, stays and is shown slack.

    **How a half finds its way (stage B).** Shortest paths round solids in 3D have no cheap exact answer, so the method is bounded:
    1. Solve the half straight. Collect the parts its runs pass through (`partsInWay` with `checkRoute` and `allRuns`, then `bandOverlaps`). None: done.
    2. For each such part, take its **wrap edges**: the sharp edges of the convex hull of its mesh (`three/examples/jsm/math/ConvexHull.js`), found once per part and cached, in the part's frame, each with the direction pointing out of the part. Gears and sprockets have none (gaps handle them). Measured: 2 to 6 ms a part; a 2x14 Beam gives 64 edges, the four longest (165.1 mm) along its long corners; a 2x2 corner connector 43. A round part (a standoff) gives none at 15°, so a part with a post or groove spot gives that circle instead.
    3. Make points along those edges: both ends and every 6 mm, each moved out of the part by half the band's thickness plus 0.3 mm. Add the two hook points. Two points are joined when the straight line between them is clear of every part gathered so far and of the hooks' own parts.
    4. Find the shortest chain of joined points from hook to hook (A*, joins tested only when reached). Guides are honoured by going hook → a point on the guide's edges → … → hook. A guide's edges are the wrap edges of its part within 1.5 mm of the clicked spot's circle.
    5. Each bend becomes a route entry that carries its own edge: `{ instanceId, feature: "wrap", line: [a, b], wrap: out, auto: true }`, in the part's frame, so the path can be found again without meshes when parts move. `resolveRoute` turns it into a circle of radius 1 mm along `line`, its centre set back inside the corner (as a rounded edge), bent from the `wrap` side.
    6. Run the existing solver (`solveBandPath`), which slides each bend along its edge to the shortest path. Drop bends where the band turns less than 2° or no longer presses on the edge. Go back to step 1 with the new runs.
    7. Stop and return `needsRoute` after 6 rounds, more than 8 bends on a half, more than 3× stretch, or 300 ms.

    The hidden `box:` spots and the automatic use of `edge:side±` and `edge:end±` circles for detours go away. The `edge:` spots stay for clicking (they become guides) and for imported routes.

    **Known limit:** a convex hull fills a part's notches and inside corners, so a band won't bend round an inside corner by itself. The straight-line tests use the real mesh, so a clear line through a notch is still taken, and clicked spots cover the rest.

    **What must not change:** the six Swish bands (import places them with `ignoreInWay`, which skips all of this) and their distances from VEX's meshes in `check-bands.mjs`; tooth-gap handling; saved builds (old route entries, `box:` ones included, still open and solve).

    *Alternatives considered:* relaxing a chain of points against the meshes until it is tight (handles any shape, but slow for a live preview, can stick on mesh detail, and gives no stable route to store); sharp edges of the real mesh in place of the hull (thousands of edges on a ribbed VEX beam).

## Risks / Trade-offs

- **The solver may settle on a wrong local answer** on routes with many slanted posts. → Start from the straight-line guess with the stated sides. Check every built-in Swish route against VEX's mesh within 2 mm in `scripts/check-bands.mjs`.
- **Rerouting on every move could slow big builds.** → Only bands touching moved parts are re-solved. A band's path is re-solved, not its mesh, until it is drawn. Timed in the check on a 1,000-part build.
- **The assumed stiffness makes Play pull wrong.** → It is one table, marked assumed, and named in features.md. The Play spec promises only the direction of pull and that it grows with stretch.
- **The Swish gap numbers measured so far come from world angles.** → The specs name gaps by what they line up with. Task 1.3 finds the part-frame numbers for the checks.
- **A hull fills notches**, so a band never bends round an inside corner by itself (decision 11). → Clicked spots cover it; the message names the part when no way is found.
- **Edge spots on beams are only right for rounded ends.** → Square-ended parts get spots only from `bandSpotTable.js` entries. The import report lists any band it couldn't match.
- **The 3 mm gap seen at Swish's arm standoff could be a VEX CAD error or a different post.** → Import matching allows 4 mm, and the check compares against the instructions' finished view by eye once.

## Migration Plan

Nothing to migrate. Builds without bands are unchanged. A band copy with no `shape` stays a flat ring. Builds saved with bands open in older versions as flat rings, because unknown shape kinds are ignored. Rollback means dropping the kind, and bands then show as flat rings.

## Open Questions

These were settled as assumptions. They can change without changing the approach:

- **Sizes:** only the library's band and belt parts. Free length is measured from each model.
- **Too far:** a band past 3× shows red and a suggestion. It doesn't snap in Play mode.
- **Play redraw:** bands are redrawn live every frame. If it costs too much on big builds, a setting can drop it to every few frames.
