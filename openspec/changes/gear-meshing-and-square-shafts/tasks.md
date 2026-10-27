## 1. Measured part data

- [x] 1.1 Move `crossAxes` into a shared `refAxes` helper used by `pinHoleAlignment.js`, the indexer and the engine (design.md §1). Export `getPartRawGeometry` from the engine for the indexer. Verify: `node scripts/check-pin-hole-alignment.mjs` still passes.
- [x] 1.2 Indexer: measure spur gears (tip radius, module, pitch radius, tooth spacing, tooth phase) and racks (direction, tooth offset, spacing, pitch line) with the Fourier fits in design.md §2. Write the new `gearSpecs` fields and `rackSpecs`. Verify: re-running gives identical values; standard gears are within 2% of `teeth/24 × 12.7`; the 34DP gears differ; the script prints any part it couldn't measure.
- [x] 1.3 Indexer: measure the shape and flat angle of shaft bores and sockets, the flat angle of square axles, and the Smart Motor `hubSpecs`. Verify: the 24 Tooth Gear bore is square; the 36 Tooth Idler Gear bore is round; every straight, capped and motor shaft has a flat angle; the motor has a hub radius larger than the square's diagonal.
- [x] 1.4 Regenerate `public/part-metadata.json` and `catalog.json`. Verify with a diff script that only the new fields were added and the old port IDs and values are unchanged. Run `node scripts/check-mcp-tools.mjs`.

## 2. Shared maths (`src/utils/gearMeshing.js`, `src/utils/shaftGroups.js`)

- [x] 2.1 `meshTurn` for spur–spur and spur–rack, with mesh range, several neighbours and error reporting (design.md §3). Add `scripts/check-gear-meshing.mjs`, which uses the engine's collision BVH to check:
  - a 24T gear turned to mesh with a 48T gear at 38.1 mm has no contact;
  - unturned, at a non-meshing phase, it does have contact;
  - a 12T gear on a rack meshes;
  - 3 mm out of range gives no turn;
  - two conflicting neighbours report one.
- [x] 2.2 `squareFitRoll`, `shaftGroups` and `turnGroup` (design.md §4). Checks:
  - an axle into a gear turned 22.5° fits without contact;
  - a wheel onto an axle turned 10° fits;
  - a group of axle, wheel and gear turns together, with positions turned about the axis;
  - round bores are left out of groups;
  - a motor hub member only changes `socketAngleDeg`.

## 3. Motor hub

- [x] 3.1 Viewport: split the Smart Motor's render and collision geometry into body and hub at load. Draw the hub at `socketAngleDeg`. Make `checkGroupCollision` honour `userData.localMatrix` (design.md §6). Verify in the app: the hub looks unchanged at 0°; an axle at 30° in a hub at 30° doesn't overlap, while in a hub at 0° it does.
- [x] 3.2 Engine: the same split and hub matrix in `checkCandidateCollision`. `socketAngleDeg` is saved, shown by `get_assembly`, and handled by history diffs. Verify: a check in `check-mcp-tools.mjs`; undo or redo of a hub turn restores it; an old save without the field loads at 0.

## 4. Viewport placement paths

- [x] 4.1 Live drag: meshing turn for spur gears in mesh range, and square-fit roll for axles on a square bore line, applied before the flush or collision step and skipped with Alt (design.md §5). Verify in the app, with the user's go-ahead or on a separate test server: dragging "24 Tooth Gear #1" onto the backplate hole beside "48 Tooth Gear #1" turns it, reaches the hole at y 12.7, and nothing overlaps.
- [x] 4.2 The post-placement step on drag release, mate, hole pick and copy insert: square fit, then mesh, then group turns, then the motor hub, all in one history step, with message text. Verify:
  - mating an axle into a turned gear fits;
  - a gear placed on a loaded axle next to another gear turns the whole group, and the other axle stays put;
  - one undo restores everything;
  - a hand turn in Rotate mode is kept.
- [x] 4.3 Hole picking and the copy preview: square axles into square holes use the four fitting rolls, and gears preview at their meshing turn (modified Lined-up preview). Verify: picking an axle into a turned gear previews it turned to fit; picking a gear in mesh range previews it meshed; the earlier pick and copy checks still pass.

## 5. MCP

- [x] 5.1 `mesh_gear_train` uses meshing turns. `place_part` and `place_parts` run the post-placement step, replace `rollDeg` on square fits and meshes, and report meshes and conflicts. `get_part_details` returns the new metadata (design.md §7). Verify: new cases in `check-mcp-tools.mjs` (a 12–36–60 train audits with no overlaps; a `rollDeg: 3` gear in mesh range is replaced and reported; an axle into a motor sets `socketAngleDeg`); existing cases pass.

## 6b. Drag pull reach and bore-part picking

- [x] 7.1 Drag pull reach of 12 pitch along the line, with the wider nearby-part box in `snapDragToHoles` and the nearer-hole tie-break in `findHoleSnap` (design.md §8). Verify: a Node check that a 12 Tooth Gear 33 mm above a beam hole, 0.27 mm off its line, is pulled onto it; `check-pin-hole-alignment.mjs` still passes.
- [x] 7.2 Hole picking and copy preview for bore parts: targets at axle ends and hole faces, `listBoreFits` with square-fit rolls and the meshing preview, double-click starting picking, and banner text (design.md §8). Verify: Node checks for a gear previewed onto an axle (turned to fit) and onto an axle past a 48T (meshed). In the app, on the test server: picking a gear onto an axle slides it down and fits it; picking it onto a beam hole beside a 48T meshes it; a Ctrl/Cmd copy of a gear onto an axle works.

## 6. Docs and checks

- [x] 6.1 Update `features.md` (measured gear data, meshing, square fits, shaft groups, motor hub, MCP notes). Run `npm run build`, `node scripts/check-pin-hole-alignment.mjs`, `node scripts/check-gear-meshing.mjs`, `node scripts/check-history.mjs` and `node scripts/check-mcp-tools.mjs`; all pass.
