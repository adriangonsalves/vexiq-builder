## Context

- `handleAddPart` (App) puts a new part two pitch along X from the selected part, or at `spotBesideBuild` (in front of the build's box). Neither looks at the camera.
- Hole picking (Viewport3D, openspec hole-pick-insert) already lists every fit of the selected part for the hovered hole face, steps through them with the wheel / `R`, and inserts on click (`pickClick` → `mateSelected` → `commitPlacement`). It leaves the part where it is and shows a see-through copy at the fit.
- History steps can be merged by `mergeKey` (`recordStep`), and a merge that brings the build back to where the step started removes the step.
- The engine (`src/engine/core.js`) has world features per instance (`worldFeaturesFor`), the joint graph (`jointGraph`) and BVH collision (`checkCandidateCollision`), and runs both in the dev bridge and in the browser's engine worker.

## Decisions

### Where a clicked part lands
Viewport registers `viewSpot(bbox, pointer?)` with App (like the screenshot and flush-mover hooks). With no pointer it tries spots on the plane through the orbit target facing the camera: the target first, then rings of eight around it, one part-size apart, up to six rings. Each spot is rounded to the 1-pitch world grid; the first whose box (2 mm margin) touches no visible part's box and whose corners all project inside 90 % of the view wins. No spot: the target. App uses it for every library click; MCP and other callers that pass a position are unchanged.

### Placing a dragged part: a mode of the hole-picking session
The library card/tile listens for `pointerdown`; past 6 px of travel it becomes a drag (a chip with the part's name follows the pointer). When the pointer is first over the viewport, App adds the part at `viewSpot(bbox, pointer)` (the point under the pointer on the plane through the orbit target) with `mergeKey: place:<id>` and an unlimited merge window, and sets a `placeRequest` prop. Viewport starts a pick session with `place: { dropPending }` once the part's mesh has loaded.

In the session:
- **Pointer move:** the hovered hole is found as in picking. With a fit, the part itself is posed at that fit (no see-through copy). Without one, it follows the pointer on the plane through its centre facing the camera, at its starting turn; a part with no inserts and no bore also pulls onto lined-up holes (`findHoleSnap`, all three directions). Moves with a mouse button held (orbiting) don't move the part, except while the library drag is still going.
- **Release of the library drag** (`dropPending`): ignored, the mode carries on.
- **Click:** on a hovered fit, the existing insert (labelled "Add X into Y"); elsewhere, the part is committed where it is ("Add X").
- **Esc**, or anything that ends picking: App removes the part with the same merge key, so the add step goes away.
Both commits pass the same merge key, so add + place is one step.

Alternative considered: HTML drag-and-drop. Rejected: the wheel doesn't reach the page during a native drag, and the drop target would need its own pointer maths.

### Fix assembly in the engine
`fixAssembly(state, { instanceId })` in `src/engine/fixAssembly.js`, run as action `fix_assembly`:

1. **Blocks:** components of `jointGraph(state)` with group members joined.
2. **Near pairs:** features of the selected part's block within its box grown by 20 mm, against features of parts in other blocks in the same region. A pair is a pin/shaft and an opening it fits, or two openings a shaft fits. It is near when the axes are within 20°, the moving line passes within 4.5 mm of the middle of the other feature, and the two spans are within 4 mm along the line (or overlap). Pairs already within 0.05 mm and 0.3° are kept as constraints but don't count as something to fix. Each feature pairs once (pin/shaft pairs before hole pairs, then smallest miss).
   If no other block has a near pair, the search runs inside the block: the selected part and the parts that hang only off it (the components of the block without the selected part that don't hold the partner) against the rest, so a part held by one joint but with its other pins off can still be fixed.
3. **Partner and mover:** the partner block is the one with the most near pairs. The block with fewer parts moves (the selected one on a tie). A block with a locked part doesn't move; when both have one, nothing happens.
4. **Lining up:** point-to-line ICP. Each pair gives two points on the moving line, 3 mm either side of its nearest point to the other feature; each round, they are matched to their nearest points on the fixed line and the best turn + move is found with Horn's quaternion method (largest eigenvector of the 4x4 matrix, cyclic Jacobi). Seven far points of the moving block, weighted 1e-8, keep anything the pairs don't decide (turns about a single line, slides along it) from changing. While a pair is left more than 0.2 mm off its line, the worst pair is dropped and it runs again (a hole pattern nearly half a pitch off pairs both ways; the majority wins). Then, when the moving part with the most pairs is within 1.5° of square with the fixed part with the most pairs, it is made square and moved (least squares across the lines) if every pair is still within 0.1 mm, or no more than 0.06 mm worse than before: CAD hole patterns are a little uneven, which otherwise leaves turns of a few hundredths of a degree. The move must be under 25° and 10 mm.
5. **Seating:** when every pair's line is parallel, the block slides along that line: out to the nearest clear spot (within 4 mm) when it overlaps, otherwise in toward the other block until it touches, at most as far as the insert reaches the far face of its hole (or two holes' faces meet). The collision meshes are shrunk 0.38 mm each, so contact shows ~0.76 mm deep: from the contact it backs off (up to 0.95 mm) to the nearest clear spot where the boxes of the parts it touches sit a whole number of quarter pitches apart, preferring parts that aren't pins or shafts (a pin's collar often meets first but its length isn't on that step). Contact within 0.85 mm means it was already touching, and it isn't moved along the line. Pairs already lined up still count for seating, so a part that only sits short or pressed in along its pins is fixed too; when nothing moves, it says the part is already lined up and seated.
6. One history step, "Fix assembly: <moved> onto <other>", with the overlap flags of the moved parts.

Alternatives considered: running it in the viewport (has meshes, but can't be checked in Node or used by MCP later); a full-6-DOF least-squares solve (needs SVD and still needs the same regularisation).

## Risks / Trade-offs

- A hole pattern off by close to half a pitch can pair with the wrong holes; the 4.5 mm reach keeps that rare, and undo is one step.
- Seating uses collision meshes eroded 0.38 mm, so "touching" can still leave up to that much gap, the same as mating.
