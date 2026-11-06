## Context

See proposal.md for why. What the code does today:

- A build is a list of part copies (`instanceId`, `partId`, `position`, `rotation`, `color`, `label`, `groupId`, `socketAngleDeg`, ...). Everything about a copy's solid comes from its catalog part: `src/engine/core.js` reads the part's GLB (`readPartGlb`) and caches the raw mesh, the eroded collision mesh, the deep collision mesh and measurements by `part.id`; world holes come from `part.ports` through the copy's pose (`getWorldPortsForInstance`). About 13 places in core.js (plus 3 in the MCP server) do `catalogById.get(inst.partId)`.
- The viewport loads meshes with `loadPartAsset(part)` in `src/utils/geometryCache.js`, cached by `part.id`.
- The engine runs in the browser (engine worker) and in Node (MCP server) from the same code; `src/utils/chainPath.js` and `chainObstacles.js` show the pattern for pure three helpers shared by both.
- History records the fields in `BUILD_FIELDS` (`src/utils/buildHistory.js`); a new field becomes undoable by being listed there.
- Plastic sheets are 0.25 mm thick in the library. Their holes are only round the edge: a 6x12 has full rows of 12 holes along its two long edges and two holes (one at each end) in each row between, so rows across the width have 2 or 12 holes.
- Pin seating allows holes 0.25 mm off line (`MAX_LINE_DISTANCE_MM`).
- Test robot: the 2026-27 Herobot Flop, whose intake has two bent sheets. The exploration (session scripts, not committed) found its sheets pinned at rows 1, 2, 4, 6 (6x12) and 1, 2, 6 (6x6), both bending across the 76 mm width, with the bend lines along world Z; one cubic piece per gap between pinned rows, with the least bending for the sheet's length, lands within 0.5 mm average of VEX's sheets.

## Goals / Non-Goals

**Goals:**
- One general way for a copy to have its own solid, holes and box, used everywhere a part's solid is used, so later kinds (wire, rubber band, rope) only add a kind definition.
- A bent sheet that is deterministic: the same saved bend gives the same mesh and holes in the browser and in Node.
- Any VEX CAD robot with bent sheets imports with them bent and a clean audit; Flop is the test case.

**Non-Goals:**
- Physics: no simulated sheet or forces. The curve is the least-bending shape of the right length, not an elastic simulation.
- Bends that twist, sheets bent along two directions at once, or creases. One set of parallel bend lines per sheet.
- Wires, rubber bands and ropes themselves: only the groundwork they will use.
- Bending parts other than the three plastic sheets.

## Decisions

### 1. A shaped copy resolves to its own derived part

`partOf(instance)` (new, in core.js) returns the catalog part for a plain copy, and for a copy with `shape` a derived part: `{ ...catalogPart, id: "<partId>~<shapeKey>", basePartId, shape, ports: shapedPorts, bbox: shapedBox }`. `shapeKey` is a short stable hash of the kind and its settings rounded to 0.001. Every instance site swaps `catalogById.get(inst.partId)` for `partOf(inst)`. `readPartGlb` (engine) and `loadPartAsset` (viewport) see the derived id, read the base part's GLB and run the kind's `shapeMesh`. All the existing caches keyed by `part.id` then work unchanged, and two copies with the same bend share one mesh.

*Alternatives:* passing the instance into every geometry function (touches every signature and cache); writing shaped meshes to disk as new catalog parts (bends are per build and change often, and a catalog entry per bend would pile up). The derived-part approach keeps the change to one lookup per site.

Derived parts are cached by id (bounded, least recently used, e.g. 200) so dragging through many bends doesn't grow memory without limit.

### 2. Shape kinds live in one registry

`src/utils/shapedParts.js` holds `SHAPE_KINDS = { 'sheet-bend': { accepts(part), check(settings, part), shapeMesh(positions, indices, settings, part), shapePorts(ports, settings, part), mirror(settings, axis), describe(settings) } }`. Core, viewport, history, save and the MCP server only call through this. A wire kind later adds an entry (and its own tool); nothing else changes. The instance field is `shape: { kind, ...settings }`, listed in `BUILD_FIELDS`; the timeline names a change to it "Bend" (the kind's `verb`).

### 3. What a bend stores: the curve, not the parts it was anchored to

A bend is stored in the sheet's own frame, so it doesn't depend on the target staying put:

```
{ kind: 'sheet-bend',
  across: 'x' | 'z',          // which sheet axis the bend runs along (the other is the bend line)
  from: -1 | 1,               // which end the held rows are at
  held: [r0, r1],             // held row indices (flat), counted from that end
  anchors: [{ row, at: [u, v], dir: [du, dv], stretch }] }   // in the plane across the bend
```

The curve is rebuilt from `held` and `anchors`: straight through the held rows, one piece per anchor, straight past the last. Rows are counted in 12.7 mm steps from the sheet's first row (6.2 mm from its edge). Storing the targets' ids instead would make the sheet change shape when a beam is nudged, and break on delete.

### 4. The curve: one cubic piece per gap, least bending for the length

Each piece runs from the previous row's point and direction to the anchor's point and direction, as a cubic with handle lengths `a`, `b`. The pair is the one with the least bending (sum of turn squared over length, on 120 samples) whose length equals the sheet length between the rows (plus `stretch`), found by a search over `a` with bisection on `b`, as in the exploration. Then a check: tightest radius at least 3 mm, otherwise refused. Pieces meet with matching direction, so there is no corner at a row.

*Alternatives:* a true elastic strip (smoother, much more code, and the exploration already matches VEX to 0.5 mm); a circular arc plus straight (can't meet a given point and direction with a given length in general).

The exploration's one flaw was a shallow dip where a short piece turns little; if that shows up on real builds, raise the weight on the end handles (a design detail, not a spec change).

### 5. Bending the mesh

The flat sheet mesh has long thin triangles between edge holes, so it is cut first: every triangle is split along planes across the bend direction every 1 mm (and at each held/anchored row) so each strip bends almost flat. Then each point at distance `s` along the sheet, height `h` above its bottom face and position `w` along the bend line goes to `curve(s) + (h - 0.125)·normal(s) + w·bendLine`. The curve is turned into a table of 0.25 mm steps for this lookup. Normals are recomputed. Ports move the same way: a hole's origin at `s` maps through the table and its axis becomes `normal(s)`. The result is cached by derived id. A 6x12 grows from about 4,400 to roughly 25,000 triangles, which the BVH handles.

The collision mesh is the existing eroded mesh built from the bent mesh. Sheets are thinner than the erosion (0.25 vs 0.38 mm), as they are today; the overlap test works on surfaces crossing, which still holds.

### 6. Finding choices (engine action `sheet_bend_choices`)

In the engine, shared by the app (through the backend's `runAction`) and the MCP server:

1. **Held rows.** Sheet holes with a pin seated in them or lined up with another part's hole (existing `findMatchingPinHoles` / joint graph) give the held rows; for a bent sheet, its `held` and anchored rows. Their direction gives `across` and `from`; a single held hole tries both directions.
2. **Target lines.** The target's holes (pin holes and pegs) grouped into lines parallel to the sheet's bend line (within 3°), each with the face it opens on (from the hole's faces and `getPartMeasurements` surfaces); each face is its own candidate.
3. **Rows.** For each sheet row past the last held or anchored row: in the plane across the bend, the target point is the hole line plus `(face offset + 0.125 + layers·(0.25 + 0.1))` along the face normal, where `layers` is the number of sheets already lying on that face at those holes. Check the sheet's holes in that row against the target's along the bend line (within 1 mm, at least one pair, and every sheet hole that lands on the target paired); check reach (straight distance ≤ length + 1 mm); work out the curve and the miss (`stretch = max(0, chord-based shortfall)`, measured as the length needed beyond the sheet's).
4. **Clearance.** Pose the shaped sheet and run `checkCandidateCollision` against the build, leaving out pins in the sheet's holes and the stacked sheets under it; drop clashing choices with a count and the first part hit.
5. Sort by miss, then by bending; name each "sheet row N → <target label>, <face>".

### 7. Applying a bend

`bend_sheet` (engine) sets the sheet's `shape` and, in the same history step, moves every part whose only joint to the sheet is through a hole that moves (sheet pins in the bent part) by that hole's change of pose. "Move the target" (only offered when the target's only joints are to this sheet) moves the target by the miss along the face normal and in-plane direction, so the row is exact. Flatten clears `shape` and moves those pins back the same way.

### 8. The Bend sheet tool in the app

A Tools menu item, enabled when the selection is one plastic sheet plus one other part (hover text says what's missing otherwise). It opens a small draggable dialog like the Chain builder's over/under dialog: it lists the choices, highlights each choice's target holes in the viewport (the aligned-hole ring markers) and shows a see-through preview of the bent sheet for the choice under the pointer or picked; Apply, Cancel, and Flatten when the sheet is already bent. No choices: the dialog says why (no held row, twist, out of reach by N mm, would hit <part>).

### 9. CAD import

A `cad-frames.json` entry can say `"bend": "pins"` for a CAD sheet part that VEX bends (the test robot's are 228-7711-711 and -712; other robots add their own entries). For such a sheet the import:
1. collects the sheet pins and other pinned parts whose pins sit within the sheet body's box;
2. groups the pins into rows (pins sharing a line parallel to the sheet's long or short side) and orders the rows along a chain from one end;
3. the end whose first two rows are flat and coplanar on their parts is the held end; the sheet's flat pose comes from those rows' holes;
4. each later row's index is the previous row's plus `round(chord / 12.7)`;
5. each later row is anchored with the engine's choice for that row and the part its pins go into (a row on another sheet stacks).

The sheet is then placed with its shape in the same batch. The report lists stretches and unanchored rows. The Flop test starter is saved again (`scripts/save-starter.mjs` writes the shape as an optional eighth column, `null` holding the motor-turn column's place when needed).

### 10. MCP

`bend_sheet { sheetId, targetId?, choice?, sheetRow?, targetPortIds?, face?, moveTarget?, flatten? }`: without a choice it returns the choices; with one it applies it, runs the usual post-placement check and reports overlaps. `get_assembly` / `get_part_details` include `shape` with `describe()` text ("bent: held rows 1–2, row 4 on 1x12 Beam ..., row 6 stretched 0.6 mm").

## Risks / Trade-offs

- [Every instance lookup must switch to `partOf`; one missed spot shows or collides the flat sheet] → a check script poses a bent sheet and compares world holes, box, overlap and the audit against the shaped mesh; grep for `catalogById.get(` on instances in review.
- [Shaped meshes are heavier (≈25k triangles per sheet)] → cached per bend; only sheets are shaped; strips are cut only across the bend direction.
- [Parts held only by a sheet in VEX CAD may sit a little off what a real sheet allows, because VEX's bent sheets are stretched (on the test robot, 0.6 mm at one row)] → the stretch rule covers up to 1 mm; the report says how much.
- [Stacking at a 0.1 mm gap is below the collision erosion, so a slightly wrong stack would not show as an overlap] → the stack offset is computed, not searched; the check script measures the gap between the two stacked sheets directly.
- [Mirror: a bend stored in the sheet's frame must flip with the part's mirror pose] → the kind's `mirror()` flips `from` or the sign of `v` per mirror axis; a check mirrors a bent sheet and compares holes with the mirrored originals.
- [Static site and saved builds from before this change] → no `shape` means flat, so old builds load unchanged; builds with a shape opened in an older app show the sheet flat (acceptable).

## Migration Plan

No data migration: `shape` is optional. The Flop test starter is regenerated after the import change. Rolling back means removing `shape` from saved builds (they show flat).

## Open Questions

- The exact weighting of the least-bending search may need tuning after seeing more bent sheets than the test robot's two. It doesn't change the specs or tasks.
