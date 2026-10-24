## Context

See proposal.md for the motivation. All three behaviors that need to learn about hole-to-hole pairs run through pure functions in `src/utils/pinHoleAlignment.js`. Each decides what pairs with what through `pairRoles(s, o)`, which only returns an insert/opening pair (`OPENINGS_BY_INSERT`).

| Behavior | Function | Called from |
|---|---|---|
| Drag pull | `findHoleSnap(selected, others, directions)` | `snapDragToHoles` in `Viewport3D` on every drag frame |
| Rings | `findAlignedOpenings(selected, others)`, then `facesIfAlignedAndOutside(insert, opening)` for the ring face and "still outside" test | `updateAlignedHoleHighlights` |
| Double-click | `planMates(aligned, selectedId)`, which groups pairs by direction with travel/sweep/lateral | `handleMateRequest` / `mateSelected` |

Because the viewport only consumes the results, teaching these functions about hole pairs gives the drag pull, the rings and double-click stacking with almost no viewport change.

## Goals / Non-Goals

**Goals:**
- One hole-pair rule shared by snapping, highlighting and mating.
- Stacking stops flush, using the existing mate sweep.

**Non-Goals:**
- Rotating a part to match another part's angle (hole picking already does this).
- Counting stacked parts as fastened in the audit. Only pins and shafts fasten.
- Hole pairs in hole picking or in MCP placement.

## Decisions

### 1. Hole-pair rule
Two openings of different parts pair as holes when a shaft fits both, i.e. both kinds are in `OPENINGS_BY_INSERT.shaft` (`pin_hole`, `shaft_bore`, `shaft_socket`, `collar_hole`). They are then treated as `{ insert: selectedHole, opening: otherHole, hole: true }`, with the selected part's hole in the insert role. A new helper `pairOf(s, o)` returns `pairRoles(s, o) ?? holeRoles(s, o)`, and the three functions use it.
- The rule is "an axle could run through both", so a Smart Motor's blind drive socket pairs with a beam hole (axle through the beam into the motor), and a rubber collar's hole pairs with a beam hole (collar beside the beam on the same axle). A motor held against a beam lines up its mounting pin holes and its socket at the same time.
- Pin-end rules (which end of a pin sticks out) don't apply to hole pairs.

*Alternative:* add `pin_hole: {pin_hole, shaft_bore}` to `OPENINGS_BY_INSERT`. Rejected: that table also drives the fit audit and seated-pair logic, where a hole in a hole is not a fastening.

### 2. Rings: apart, not outside
For a hole pair, `facesIfAlignedAndOutside` gets a hole variant: lines coincide (2°, 0.25 mm), and the spans are apart, with a gap between the facing hole faces greater than 0.05 mm and at most `MAX_AXIAL_GAP_MM`.

Hole faces are often recessed in their parts: beam hole spans stop about 0.6 mm inside the beam's face, and a corner connector's hole flange is set back from its lowest point. Two stacked parts therefore still show a span gap of a few millimetres. So the viewport also drops a direction's hole pairs when moving the selected part `TOUCH_PROBE_MM` toward the other part already collides (`dropTouchingHolePairs`). That is one collision test per direction, and only when hole pairs exist.

`TOUCH_PROBE_MM` is 0.91 mm (2 × 0.38 + 0.15). The collision meshes are shrunk 0.38 mm per part, so a smaller probe never sees two parts sitting flush as touching. That was found in the app: after stacking, the rings stayed and a second double-click stacked again in place. The ring face is the other hole's end toward the selected hole, and `outward` points from it toward the selected part. Result entries get `pairKind: 'hole'`; pin/shaft entries get `pairKind: 'insert'`. Everything else about rings (solid and faint ring, rim radius, face snapping) is unchanged.

### 3. Drag pull
`findHoleSnap` uses `pairOf`. The geometry (`moveOntoLine`, the 2-pitch axial reach on the spans, the 3.5 mm radius, the 1 mm settle) is already symmetric in the two features, so hole pairs need nothing else. The smallest pull still wins across all pair kinds.

### 4. Stacking travel
In `planMates`, a hole pair's `travelMm` and `sweepMm` are both the gap between the facing hole faces along the direction: `minAlong(other) − maxAlong(selected)`. Because hole faces are recessed, this is at least the real distance between the parts, so `mateSelected` meets the other part's surface first and stops there (within the usual collision-mesh contact tolerance). In a direction that also has pin/shaft pairs, the longest travel and sweep win, as today. `mateSelected` picks its message from the plan: only hole pairs gives "Stacked on <labels>"; otherwise "Mated with <labels>" as before.

### 5. Double-click with pins and holes
`mateAction(plans, hasInserts)` (pure, in `pinHoleAlignment.js`) decides what a double-click does:
- no plans: `pick` for a part with pins/pegs/shafts, else `none` ("Nothing lined up to mate with");
- only hole-to-hole pairs, and the part has pins/pegs/shafts: `arrows+pick`;
- one direction otherwise: `mate`;
- several directions: `arrows`.

Pins and holes lined up in different directions are already separate plans, so they get arrows. Pairs in the same direction stay one move, since one push seats both.

With `arrows+pick`, the mate arrows are shown and `startPick({ alongsideArrows: true })` runs too:
- A click is tested against the arrows first: an arrow ends picking and mates along it.
- Otherwise it goes to picking: a highlighted hole inserts and `endPick` hides the arrows; empty space ends both.
- `Esc` ends both. `hideMateArrows` keeps the gizmo hidden while picking is still on.
- The picking banner adds "or click the arrow to stack along the lined-up holes".

## Risks / Trade-offs

- **[More rings while dragging a plate over a busy frame]** → Same reach as pin rings. They only show while parts are apart, and disappear as soon as faces touch. If it proves noisy, the hole-pair reach can later be shortened to 2 pitch without touching the other rules.
- **[Parallel rails joined by standoffs ring each other when one is selected]** → True: they are 1 pitch apart and lined up. It is correct, and harmless, since nothing moves until the user double-clicks.
- **[Per-frame cost: hole pairs add opening × opening checks]** → The candidate list is already limited to nearby parts by the reach box. The extra work is one parallel/distance test per pair, as for pins.
