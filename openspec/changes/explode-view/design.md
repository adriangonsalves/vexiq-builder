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
