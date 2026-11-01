## Context

See proposal.md for the why and specs/explode-view/spec.md for the behaviour.

Today `computeExplodedPositions` (`src/components/Viewport3D.jsx`) pushes each part away from the robot's centre by a scale plus a fixed step, and fans parts on the same plane out by their list index. It only produces end spots and never checks for overlaps. What we can build on:

- **Joint data:** `findJoints` in `mcp/assembly-engine.mjs` gives the seated pairs (insert and opening features, each with a world axis line), `seatedIn` (fastener → part → ports) and the direct edges from integral pegs, battery bays and parts held on parts. `jointGraph` turns this into nodes and edges.
- **Collision meshes:** each part's group carries `collisionGeometries`, shrunk 0.38 mm so pins and shafts pass cleanly through holes, plus a `localBox`. `three-mesh-bvh` is already a dependency.
- **Too-wide inserts:** `measureOpeningPassRadii` and `findTooWideInserts` in `pinHoleAlignment.js` know when a shaft's ring can't pass a hole. The shrunk mesh may miss this.
- **Pieces that move together:** `partGroups.js` (`groupsOf`, `groupCollapse`), `tireFit.js` (tire on hub), `batteryBay.js` (bay pose).

## Goals / Non-Goals

**Goals:**
- One plan per build and direction choice. Positions at any slider value come from the plan by simple sums, so scrubbing costs nothing.
- No overlaps at any slider value, checked over the whole slider and not just at the end spots.
- The plan builder is pure and runs in Node, so a check script can run it on the saved Clawbot build.

**Non-Goals:**
- Turning parts as they come out. Every slide is a straight move.
- The best possible order or the shortest total spread. A plan only needs to look sensible and be free of overlaps.
- Running the plan builder in a web worker. Keep it on the main thread unless timing shows it's needed (see Risks).

## Decisions

### 1. Pieces

A piece is a set of parts that never move apart. They are built in this order:

1. Each visible part starts as its own piece.
2. Group members are merged.
3. A tire is merged with its hub, using the `tireFit.js` test.
4. Each pin or standoff is merged into the part it sits deeper in. Depth is the length of the pin's insert feature that lies inside each opening, from the seated pair. On a tie, it goes to the larger part by box volume. Shafts are left as their own pieces.
5. The base piece is the one holding the Robot Brain, or failing that the piece with the largest box volume.

The joints between pieces are the seated pairs and direct edges that cross from one piece to another. Each joint keeps its axis, or no axis for edges like "held on" or "battery bay".

*Alternative:* pins as their own pieces. Rejected for now because there are many pins on a Clawbot and loose pins bury the picture. The pieces step is the only place to change if this comes back.

### 2. Pass A: take-apart order and slide directions (outside in)

The plan is built like taking the robot apart. Repeat until only the base is left:

- **Candidate pieces**, most likely first:
  1. Pieces joined to only one other remaining piece.
  2. Within those, smaller box volume first.

  Collars, wheels and pins-in-beams fall out early this way, and big plates late.
- **Candidate directions** for a piece, in order:
  1. ± the axis of each joint it has with the remaining pieces (pins and shafts).
  2. ±X, ±Y, ±Z.

  The direction choice filters this list: X, Y or Z keeps only the matching main axis. A shaft axis that lines up with the chosen axis within 2° also counts. A direction is ruled out when a too-wide insert in this piece would have to pass an opening in a remaining piece going that way. This covers a motor shaft's stop ring.
- **The slide test.** The moving body is the piece plus every piece already taken off it, still at their assembled spots. The reason is that the slider plays big pieces first, so when this piece moves, its small parts are still on it. Slide the body along `d` and test it against every remaining piece, also at assembled spots, plus everything they carry. It passes when the body can travel the clear-out distance without touching anything it doesn't already overlap when assembled.

  The clear-out distance is the extent of the body's box along `d` plus the extent of its holder's box along `d`. That's always enough to fully leave the holder.
- **Taking the piece off.** The first candidate and direction that pass are taken. The piece's **holder** is the remaining piece it has the most joints with. If it has none, the holder is the remaining piece whose box is nearest. The piece is recorded with `(holder, d)`.
- **Getting stuck.** If no candidate passes, merge the candidate with the fewest blocked directions into its holder and carry on. This happens with interlocked parts, or a single-axis direction that suits nothing. The merged parts then move as one. With a single-axis choice this is expected and matches the spec: a piece that can't slide that way stays on its holder.

How the test is done: compute the **free distance** along `d` exactly instead of stepping.

1. Use the boxes to drop pieces the moving body's swept box doesn't reach.
2. For each remaining piece, cast rays from the moving body's collision-mesh corner points along `d` into that piece's BVH.
3. Cast rays from that piece's corner points along `-d` into the moving body's BVH.
4. The smallest hit is the free distance. Pairs that already overlap when assembled are left out.

The slide passes when the free distance reaches the clear-out distance.

*Alternative:* step the body along `d` in 0.5 mm steps and run the existing mesh-vs-mesh check at each step. Simpler, but about 50 times slower for a 25 mm slide, and it can step over a thin wall. Keep it as the fallback check in the check script (see Decision 5).

### 3. Pass B: travel distances (inside out)

Pass A gives a tree: each piece points to its holder, with the base at the root. Travel is measured from the holder. Pieces sharing a holder and a direction stack in a row, the way a collar, wheel and spacer stack along a shaft.

Pass B walks the tree from the leaves up:

- The **room** a piece needs along `d` = the extent of its own box along `d` + the room its children need along `d` when spread out + a gap of 6.35 mm (0.5 pitch).
- The piece's **travel** = how far it must go to clear its holder (from Pass A) + the room of every sibling that comes off the same holder in the same direction and sits between it and the holder.

So along a shaft, the collar travels past the wheel's room, the wheel past the spacer's room, and so on. Children moving in other directions don't add room along `d`.

### 4. The slider timeline

The slider plays Pass A's order backwards. Each piece gets a **start** and an **end** on 0 to 1, set by its depth in the tree:

- Depth k of K runs from `k/(K+1)` to `(k+1.5)/(K+1)`, capped at 1.
- So all pieces at the same depth move together, and each depth starts while the one before is finishing.

Shown position:

```
pos(part, t) = assembled + sum over its piece and every ancestor piece p (not the base) of
                 p.d * p.travel * ease(clamp((t - p.start) / (p.end - p.start), 0, 1))
```

`ease` is smoothstep. Because start times rise with depth, a piece never starts moving off its holder before the holder has started. This is the spec's "big pieces first".

### 5. Checking the whole slider

Pass A proves that each piece can leave its holder while everything else sits at assembled spots. It does not cover pieces from other branches that have already moved and are in the way.

After Pass B, sample t at every 1/100. At each step, test every pair of pieces whose boxes meet, using the BVH meshes. For any pair that overlaps when assembled, the overlap only counts if it grew. When a pair hits:

1. Push back the later-starting piece's start and end within its depth, up to its depth's end. If the hit is still there, add the overlap depth plus the gap to its travel.
2. Run Pass B again from that piece upwards, and recheck.
3. Stop after 8 rounds.
4. Record any hits that remain. In development, log them to the console. The check script fails on them.

### 6. Where the code lives

- `src/utils/explodePlan.js` is pure. It takes instances, catalog metadata, joint data and a mesh-query function, and works out the pieces, Pass A, Pass B, the timeline and the slider check. It exports `buildExplodePlan(...)` → `{ pieces, steps, unplaced }` and `explodedPositions(plan, t)` → `Map<instanceId, [x,y,z]>`. The Viewport passes BVH-backed queries made from its collision meshes. The check script passes the same queries made from the catalog meshes in Node.
- `Viewport3D.jsx`:
  - Keeps the plan in a ref keyed by build signature + direction choice. The signature covers instance ids, positions, rotations, visibility and group ids.
  - Rebuilds the plan when the key changes.
  - On a slider change, only rewrites group positions and the trace-line ends. It does not run the full scene sync.
  - `computeExplodedPositions` is removed.
- `App.jsx`:
  - `explodeMode` becomes the direction (`off` | `x` | `y` | `z` | `all`), with `off` meaning the panel is closed.
  - New state `explodeAmount` (0..1) and `explodePlaying`. The play is a `requestAnimationFrame` loop over 2.5 s.
  - The panel is a small floating panel under the toolbar, styled like the existing toolbar menus.
- MCP:
  - `configure_viewport` takes `explodeAmount`, and the bridge passes it through like `explodeMode`.
  - The MCP engine does not need its own plan. Screenshots come from the app.

## Risks / Trade-offs

- **[Time to build the plan on big builds]** → Mitigations:
  - Box culling, and trying likely pieces first so most pieces pass on their first direction.
  - Free-distance rays use corner points cut down to about 500 per piece.
  - Time it on the Clawbot (193 parts). If it takes over about 300 ms, show a short "Working out explode…" note. Moving it to a worker is a follow-up, not part of this change.
- **[The shrunk collision mesh lets a part graze through a thin wall]** → Mitigation: the 0.38 mm shrink is the same one the overlap check uses everywhere, so explode agrees with the audit. Too-wide inserts are handled separately in Pass A.
- **[Corner-point rays miss edge-against-edge contact]** → Mitigation: the slider check in Decision 5 uses mesh-vs-mesh tests, so a miss in Pass A is caught and fixed by adding travel.
- **[A slide in a single direction leaves big clusters unmoved]** → Accepted. The spec says those pieces stay with their holder, and All is the default.
- **[Spread size]** → Deep trees on long shafts can spread far. Mitigation: the gap is fixed at 0.5 pitch rather than scaled. The camera's Frame (`F`) still frames all visible parts at their shown positions.

## Migration Plan

- Saved views with `explodeMode` in `x`, `y`, `z` or `all` open the panel with that direction at slider 1, with no play, because the play is only for opening by hand.
- Saved views without `explodeAmount` read it as 1 when `explodeMode` isn't `off`.
- Nothing else is stored, and rolling back is reverting the change.

## Changes made while building (feat/explode-view-v2)

Trying the decisions above on the saved Clawbot showed where they don't hold; the code differs from them in these ways.

- **Where the plan is built (Decision 6).** The dev server builds it (`explode_plan` bridge action, like `joint_graph`) in a worker thread (`mcp/explode-worker.mjs`) that keeps the engine's meshes loaded, and keeps the last 8 plans. The app sends its parts and gets the plan back. So the app and the check script use the same joint data and the same collision meshes, and the page and the bridge never stall while a plan is built. `src/utils/explodePlan.js` is still pure and takes the meshes and joint data as input (`explodePlanFor` in the engine supplies them). The server warms the worker with the saved build's plan when it starts.
- **Pass A slide test (Decision 2).** Pieces already taken off are not obstacles. With them in place, a lock beam behind the collar in an omni wheel's recess could never come out, and almost everything merged. Clashes with pieces that are still in the way when the slider plays are the scheduler's job (below). A slide that stays open for 40 mm past the holder is tried before one that only clears the holder, and the clear-out distance counts only holder parts in the piece's path.
- **Lumps come apart again.** When Pass A merges stuck pieces into a lump (a side frame stuck to the brain), the lump is taken apart again with only its own parts in the way, and the pieces that come off hang below it in the tree.
- **Timeline and slider check (Decisions 4 and 5).** These are one step: the scheduler places pieces holders first. Each piece takes the earliest start (at least 0.12 after its holder's) at which it and everything it carries can slide out and stay out, tested at every 1% against everything else's final motion. That gives no overlaps by construction, instead of fixing hits afterwards. A piece blocked by one not yet placed waits for it. If all are waiting, the blocking piece is hung on its holder's holder (only if riding there meets nothing), so it can go first. A piece that can't go its own way tries going further, then its other pin/shaft axes and the main axes, then hanging higher. Failing all of those, it stays on its holder. Each piece slides over 0.35 of the slider. A final full check runs on every plan; anything it finds stays on its holder (this hasn't been needed on the Clawbot).
- **Stop rings while the slider plays.** Along with the shrunk-mesh test, the scheduler uses the audit's too-wide test (`findTooWideInserts`, passed in by the engine) for every pair with a shaft, so a spacer can't slide sideways off a shaft end that is still inside it.

- **Only the brain stays.** Whatever is still on the brain after Pass A is split into lumps that slide off it, and each lump is then planned on its own, so a side frame comes off whole and then comes apart.
- **One fixed point.** Every piece moves away from the brain's centre (or the robot's centre of mass when there is no brain): no slide heads back toward it, except a shaft pulled out along its own length. No piece goes more than 3 times its planned distance.
- **Mirror-image robots.** When most parts pair up across a plane (left and right), one half is planned and the other half copies it, so both sides come apart the same way. Parts on the plane only move along it, and pieces near the plane never slide toward it. A piece holding a shaft that runs across the plane (an arm's shafts, which can only slide out to one side) goes back on the brain with everything it holds. Whatever is on the brain then (the tower, arm and claw) is planned with the whole robot and fitted into the timeline, so it needn't come apart symmetrically. Nothing ends up past the middle line from the side it started on: a piece wholly on one side never slides toward it, and one across it only moves along it (except a lone shaft through the middle, which slides out to one side). The layer spacing only counts neighbours: built within two gaps of each other and still in line at the end.
- **Pins that trap a part go with it.** A pin normally rides with the part it sits deeper in. When that leaves a part stuck behind the pin's head (a bearing pinned onto a side beam), the part takes those pins with it instead.
- **Stop rings are checked against every part.** Also parts already taken off: a side beam slid out along a motor shaft is still on it, so the shaft can't then go out through it.
- **Layers spread apart.** Pieces stacked one beyond another and sliding the same way end at least 12.7 mm (one pitch) apart, inner ones first, pushing the outer ones further out (side beam, bearing, washer, wheel, collar).

Measured on the saved Clawbot (193 parts): All moves 188 parts in 41 pieces and takes about 8 s in Node; only the brain and four of its pins stay. Y moves 180 parts, Z 69 and X 6 (most of the chassis can't slide along X alone).
- **Progress ring.** While a plan is being worked out, the Explode panel shows a ring that fills up with a percentage. The planner reports how far it has got (`options.progress`), the worker passes that on about every 2%, and the dev server sends it to the browser tabs as an `explode-progress` event.
- **All only, slider after the plan.** At the user's request the X / Y / Z choice is gone: single-axis explodes lock up too easily to be useful, so Explode always means All (an older saved X, Y or Z opens as All; `explodePlan.js` still takes a mode). The panel shows only the progress ring until the plan is ready, then the slider, which plays from 0%. Another tab's save no longer stops this tab's play: only the assistant sets the explode from outside.
- **No trace lines.** The dashed lines back to each part's built spot are gone, at the user's request: with the slider animating the take-apart they only add clutter.
