## Context

See proposal.md for why. Current code:
- `refreshRotateSetup` in `Viewport3D.jsx` sets `pivot = center` (the world bounding-box centre) for a free part, and the point on the joint line nearest the centre for a held part. Rings and the turn (`group.position.sub(pivot).applyQuaternion(q).add(pivot)`) use that pivot.
- For the Robot Brain with Battery, the box centre is (-2.7, 3.28, 0) in the part's frame: the battery makes the box lopsided, while the side holes are symmetric about the origin. Most beams and plates have their box centre on their own hole grid, which is why this hasn't shown up before.
- `findHoleSnap` → `moveOntoLine` drops a pair whose leftover sideways miss is over `HOLE_SNAP_SETTLE_MM` (1 mm). Each pair is judged alone, so eight pins all 2.7 mm off count the same as one.

## Goals / Non-Goals

**Goals:**
- A ring turn by any multiple of 90° keeps a free part's holes on the 6.35 mm grid they were on.
- A part whose whole hole pattern is a little off can be pushed straight onto it.

**Non-Goals:**
- Fixing parts already off grid (the brain in the current scene is moved once by hand).
- Held parts: they already turn about their joint line, which is on the grid.
- The Inspector's quick 90° buttons, which turn about the part's origin. That keeps the grid for parts whose origin is on their hole grid (the brain's is) and is left as it is.

## Decisions

### 1. Pivot from hole-line offsets, per world axis
New pure `gridPivot(features, center, { gridMm = 6.35 })` in `pinHoleAlignment.js`, using the world features `collectWorldFeatures` already gives (`origin`, `axis`):
1. Keep features whose axis is within 2° of a world axis; if none, or any feature is tilted off the axes, return `center`.
2. For each world axis k, take the residue `origin[k] mod gridMm` of every feature whose axis is not along k, rounded to 0.01 mm. Residues within 0.3 mm of each other count together (the brain's CAD side-hole rows are 0.15 mm apart in height); pick the residue with the most features within 0.3 mm of it, ties going to the one nearest 0 (the world grid).
3. An axis with no residue takes the residue of another axis that has one (Y's first, as most builds sit flat).
4. Return the point with those residues nearest `center`.

Why residues mod 6.35 and not "the nearest hole": a single hole doesn't fix the pivot for all three rings, and parts like the brain have no hole along the turn axis at all. Any point with the right residue on every axis keeps every line on the grid through a 90° turn, because a line's offset from the pivot is then a whole number of half-pitches before and after the turn. 6.35 rather than 12.7 because VEX parts often sit half a pitch apart (pins at 2.5P), and pitch snap defaults to 0.5P.

The pivot stays within about 5.5 mm of the box centre (at most 3.175 mm per axis), so the rings still look centred.

Between turns the pivot is kept in the part's own frame (`localPivot` on the rotate setup), so it doesn't jump after a turn moves the box centre, and it follows the part if it's moved while Rotate mode stays on.

### 2. Settle limit depends on agreement
`findHoleSnap` first works out every pair's move as today, but with a 3.5 mm settle. Then for each candidate it counts the other pairs whose own move is within 0.25 mm of it and whose moving-part feature is on a different line (some holes are listed twice in the catalog, and those mustn't count as a pattern). A candidate whose sideways settle is over 1 mm is dropped unless that count is at least 1. Picking the winner is unchanged (smallest pull, ties by gap). `HOLE_SNAP_SETTLE_MM` stays as the single-pair limit; a new `HOLE_SNAP_PATTERN_SETTLE_MM = 3.5` sits beside it.

Alternative considered: just raise the settle to 3.5 mm for everyone. Rejected, because a lone pin dragged along a beam would jump sideways onto every hole line it passes within 3.5 mm.

Cost: pairs in reach are few (tens), so comparing moves pairwise during a drag is cheap; cap at the 64 nearest pairs to be safe.

### 3. Slide along the snapped line to a clear spot
`snapDragToHoles` returns the snapped line's axis with the position. After the collision check, if the part overlaps and a line was snapped, `clearSpotAlongLine(isClearAt, reach)` (pure, in `pinHoleAlignment.js`) looks for the nearest clear offset: out 0.1 mm at a time both ways, then four halvings onto the edge. If the far edge is within 2 mm the middle is used, so a part held between pins on both sides isn't left pressed against one side. Reach is max(3.175 mm, half the pitch step), which covers any pitch step landing. The result is cached per snapped pose and reset at each drag start, so repeated pointer moves over the same step don't repeat the ~30 to 60 collision checks. A slide that would carry a cap past a lip (`firstTooNarrowCrossing`) is dropped. It runs before the existing flush-stop clamp, which then only sees parts it couldn't settle.

Why along the line rather than any direction: the hole pull already fixed the sideways position; along the line is the only freedom left that keeps the pins in their holes.

## Risks / Trade-offs

- [Pivot residues of a part with mixed hole offsets (holes at 0.25P steps, like some specialty parts) can pick a pivot that keeps only most holes on the grid] → Most common residue wins; the rest were never on a shared grid anyway.
- [The ring centre moves up to ~5.5 mm from where users are used to seeing it] → It's still inside the part; the scenario list covers that the beam's centre stays put for normal beams.
- [The line slide picks the near edge of a wide clear spot, so a part pushed onto a pin that's free to slide deeper stops at first contact] → Same as the existing flush stop; double-click mating still pushes it all the way in.
- [A 3.5 mm settle along the dragged line may pull a pattern onto the neighbour pattern half a pitch over] → 3.5 mm is just over half of 6.35 mm, and the smallest pull wins, so the nearer pattern always takes it.
