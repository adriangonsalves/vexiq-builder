## Context

See `proposal.md` for why, and `specs/aligned-hole-highlighting/spec.md` for the exact rules: which inserts match which openings; 2° / 0.25 mm / 50.8 mm alignment; highlight only while the insert is outside the opening (overlap ≤ 0.05 mm); when highlights show and clear.

Current state that shapes the approach:

- `src/components/Viewport3D.jsx` owns the Three.js scene. Each placed part is a `THREE.Group` in `meshMapRef` (keyed by `instanceId`) under `partsRoot`, with world position/rotation set from the instance.
- Gizmo moves go through the `TransformControls` `objectChange` handler. In translate mode it snaps to the pitch grid, tests 0.25P flush seats, and may bisect back to a contact boundary, temporarily moving `obj.position` while it tests. The final pose is only known at the end of that handler. Rotate mode only runs a collision check.
- `dragging-changed` marks drag start/end; on end it reports the pose through `onUpdateTransform`, which flows back into the instance-sync `useEffect` (`[instances, selectedId, catalogMap, showConnectors, explodeMode]`). That effect also runs after Inspector nudges, Snap & Mate, MCP/SSE updates, hide/show, add/remove, selection changes and Explode toggles.
- Port data comes from `catalogMap.get(partId).ports`, in part-local mm: `{ type, origin, axis, spanMm }` (the `shaft_socket` has `maxDepthMm` instead of `spanMm`). Each part's local bounding box is in `bbox`.
- `spanMm: [minT, maxT]` (from `scripts/index-part-metadata.mjs`) is measured as `t = dot(localPoint, axis)` from the part's local origin, not from the port origin. For pegs it comes from STEP cylinder placement points and can run past the real geometry (0x2 Connector Pin peg: `spanMm [-14.441, 5.439]`, but `bbox.z` is `[-6.26, 6.14]`).
- **Shafts have no ports.** The 50 shaft parts carry only `fastenerSpecs: { fastenerType: 'straight_shaft' | 'capped_shaft' | 'motor_shaft', axis: [0,0,1], usableSpanZ: [zMin, zMax] }`. `mcp/assembly-engine.mjs` (`auditAssembly`, shaft protrusion stage) already treats a shaft as the local Z line through local `(0, 0)`, transformed by the instance matrix. All non-collar shafts have `axis [0,0,1]` and a bbox centered on X/Y = 0.
- **Rubber Shaft Collars are mis-tagged.** Both `Rubber Shaft Collar` and `Rubber Shaft Collar v1` have `fastenerType: 'straight_shaft'` and no ports, but they are rings that slide onto a shaft, and their geometry is not centered on local X/Y = 0:
  - `Rubber Shaft Collar`: `bbox` X `[-1.41, 9.58]`, Y `[3.09, 9.44]`, Z `[3.3, 12.9]`; its `cylinders` include the shaft hole, radius `1.575` mm, axis `[0,-1,0]`, at `[4.091, 8.551, 8.095]`.
  - `Rubber Shaft Collar v1`: `bbox` X `[-11.01, 1.19]`, Y `[-0.27, 6.01]`, Z `[-4.67, 7.51]`; its six `cylinders` include radius `1.5` mm, axis `[0,0,-1]`, at `[0, 0, 2.675]`, which may be the hole but is not confirmed.
- The only `shaft_socket` is on the VEX IQ Smart Motor: origin `[-9.525, 0, 0]`, axis `[0, 1, 0]`, `maxDepthMm 4.7`, motor `bbox` Y `[-50.35, 0.13]` (so the socket face is at y ≈ 0 and the socket goes into −Y).
- The existing `Axes` overlay (`createConnectorAxesGroup`) already draws see-through markers with `depthTest: false` and a high `renderOrder`; this feature uses the same method.
- The engine exports `getPartCollisionBvh(part)` (loads a `.glb` in Node and builds its BVH) and `buildWorldMatrix(position, rotationDeg)`, which a Node check script can reuse.
- The project has no test runner; `package.json` has only `dev`, `build`, `convert`, `index-metadata`, `mcp` scripts.

## Goals / Non-Goals

**Goals:**
- Keep the per-move cost small enough that dragging stays smooth next to the existing BVH collision work.
- Put the alignment math in a plain module with no React or DOM use, so it can be checked from Node against real catalog data.
- Draw highlights without allocating new geometry on every pointer move.

**Non-Goals:**
- Pulling or snapping the part into alignment. Highlighting only shows; it never moves anything.
- Showing which opening is already filled by another pin or shaft.
- Exposing alignment data through MCP, WebMCP, or the assembly state file.
- Fixing the Rubber Shaft Collar tags in the catalog or the engine. The fix here is local to the highlight module.
- Using the `cylinders` fallback for parts other than the two Rubber Shaft Collars; parts without `ports` or shaft `fastenerSpecs` get no highlights.

## Decisions

### 1. Separate alignment module: `src/utils/pinHoleAlignment.js`
Two pure functions, importing only `three`:
- `collectWorldFeatures(partMeta, matrixWorld, instanceId)` → a list of world-space features `{ instanceId, featureId, kind, origin: Vector3, axis: Vector3 (unit), tMin, tMax }`, where `kind` is one of the inserts `pin` | `shaft` or the openings `pin_hole` | `shaft_bore` | `shaft_socket` | `collar_hole`.
- `findAlignedOpenings(selectedFeatures, otherFeatures)` → the openings to highlight: `[{ instanceId, featureId, kind, origin, axis }]`. It checks both directions (selected inserts vs other openings, selected openings vs other inserts), applies the matching table, the alignment rule and the outside-only rule, and removes duplicates by `instanceId:featureId`.

Why: the viewport file is already ~1,100 lines and mixes rendering with collision logic. A pure module can be checked with a Node script using `public/catalog.json`, which is the only practical way to test without adding a test framework.
Alternative considered: inline functions in `Viewport3D.jsx`, like `findFlushBoundaryPosition`. Rejected because they can't be run outside the browser.

### 2. Where each feature comes from

| Kind | Source | Local axis / origin | Local extent `[tMin, tMax]` | Rim radius |
| :--- | :--- | :--- | :--- | :--- |
| `pin` | `ports[]` with `type: 'pin_peg'` | port `axis`, `origin` | `spanMm` clamped to the bbox | — |
| `shaft` | `fastenerSpecs.fastenerType` in `straight_shaft` / `capped_shaft` / `motor_shaft`, name not matching `/rubber shaft collar/i` | `fastenerSpecs.axis` through local `(0, 0, 0)` | `usableSpanZ` clamped to the bbox | — |
| `pin_hole`, `shaft_bore` | `ports[]` | port `axis`, `origin` | through hole in a part ≤ 7 mm thick along the axis: the whole bbox (face to face); otherwise `spanMm` clamped to the bbox, ends snapped to a face within 1 mm | 3.175 mm (pin hole), 2.5 mm (bore) |
| `shaft_socket` | `ports[]` | port `axis`, `origin` | `[t0 − maxDepthMm, t0]` with `t0 = dot(origin, axis)`, clamped to the bbox, ends snapped to a face within 1 mm | 2.5 mm |
| `collar_hole` | name matches `/rubber shaft collar/i`: the `cylinders[]` entry with radius in `[1.4, 1.7]` mm (smallest if several) | cylinder `axis`, `origin` | whole bbox projected on the axis | the cylinder's radius (1.575 mm) |

"Clamped to the bbox" means intersected with the part's local `bbox` projected onto the axis (min/max of `dot(corner, axis)` over the 8 corners). The two local end points are `origin + (t − dot(origin, axis)) · axis`; they are transformed by the group's `matrixWorld` and later projected onto the shared world axis.

Why clamp: raw peg spans overrun the part (see Context) and would make a pin look like it has entered a hole it hasn't reached.
Why openings run to the part's faces: the ring is drawn at the face end of the opening, and that end is also where "entered" starts. The stored spans don't reach the faces: interior beam holes stop at ±2.286 mm while the beam face is at ±3.05 mm (a 3.175 mm rim recess), and 2,152 of 3,875 holes and bores — every one a through hole in a part ≤ 7 mm thick — cover only part of the depth (12x12 Plate holes: `[1, 2.286]` in a plate spanning `[-3.05, 3.05]`). Thin through holes therefore use the whole bbox; other openings keep their span with ends within 1 mm of a face moved out onto it (Smart Motor socket face: `0 → 0.13`).
Rim radii come from the catalog `cylinders`: beams, plates, and gears all have a 3.175 mm cylinder at the hole face; gear/wheel bores have 2.5 mm.
Why the shaft line through local `(0, 0)`: matches what `auditAssembly` already does, and holds for every non-collar shaft in the catalog.
Why collars become openings: that is how they are used (slid onto a shaft). Treating them as shafts would put a Z line through `(0, 0)`, which for `Rubber Shaft Collar` is outside the part and in the wrong direction.
Why the socket extent runs from the face inward along −axis: for the Smart Motor, `t0 = 0` and the motor body is on the −Y side, so `[−4.7, 0]` (snapped to `[−4.7, 0.13]`) is inside the motor. This holds for the one socket in the catalog; the check script confirms it.
Alternative: re-index the catalog to add shaft and collar ports and tighter peg spans. Rejected for this change: much larger scope, and it would also change MCP engine behavior.

### 3. Matching, alignment, and the outside-only test
Matching table: `pin` → `pin_hole`. `shaft` → `pin_hole`, `shaft_bore`, `shaft_socket`, `collar_hole`.

For a matching insert I and opening O on different instances:
1. Parallel: `|axisI · axisO| ≥ cos(2°)` (≈ 0.99939).
2. Same line: distance from `O.origin` to I's axis line ≤ 0.25 mm.
3. Project both extents onto `axisI`. `gap = max(0, max(I.tMin, O.tMin) − min(I.tMax, O.tMax))`; `overlap = min(I.tMax, O.tMax) − max(I.tMin, O.tMin)`.
4. Highlight if `gap ≤ 50.8` and `overlap ≤ 0.05`.
5. Facing face: the insert lies wholly on one side of the opening, so the opening end on that side (`start` or `end`) is returned as `face`, along with `radiusMm`.

The 0.05 mm allowance means a flush seat (a face exactly touching) still counts as outside, without the ring flickering from rounding. Thresholds are named constants at the top of the module. The parallel test runs first because it rejects most pairs cheaply. Before the per-feature loop, each other part is skipped unless its world box, grown by 50.8 mm, overlaps the selected part's world box grown by 50.8 mm.

Why 0.25 mm instead of the 1.2 mm used by `autoFastenJoint`: here the highlight is a promise that the pin or shaft will go straight in. Grid snapping lands exactly on hole centers, so a tight value only rejects poses that really are off, such as `Free` snap mode.

### 4. Cache the other parts' features; recompute the selected part's every move
- `otherFeaturesRef` holds world features for every visible, non-selected part. Rebuilt (a) at drag start in `dragging-changed`, and (b) at the end of the instance-sync effect. Nothing else moves during a drag, so this stays valid for the whole drag.
- On each `objectChange` (after the translate snap/flush logic has set the final `obj.position`, and in the rotate branch), call `obj.updateMatrixWorld()`, recompute the selected part's world features, run `findAlignedOpenings`, and update the overlay.

Rough cost: a large plate has ~265 holes; a scene with 100 parts has a few thousand openings and maybe 100 inserts (each shaft adds one). Selected-vs-others is at most a few tens of thousands of dot products after the box filter, well under a millisecond.
Alternative: a spatial hash on axis lines. Not needed at these counts.

### 5. Overlay: a pooled, see-through ring group on the scene root
- One `THREE.Group` named `__aligned_hole_highlights__`, added to `scene` (not `partsRoot`), so the click-to-select raycast, which only checks `partsRoot` meshes flagged `isPartMesh`, ignores it. It is never a part mesh, so collision checks don't see it.
- Each highlight is one filled `RingGeometry` from the opening's rim radius to rim + 0.7 mm, so it hugs the hole edge. One geometry is cached per distinct radius (only a few exist). No center marker is drawn. Materials: `MeshBasicMaterial`, `depthTest: false`, `depthWrite: false`, `transparent`, `side: DoubleSide`, `toneMapped: false`. `renderOrder` ≈ 1001, above the `Axes` overlay (999/1000) and below the gizmo (`Infinity`).
- Color: bright orange (`0xf97316`). Not used by the `Axes` overlay (cyan/pink/purple/yellow), selection (blue glow), collision (grey), or gizmo (red/green/blue/yellow).
- Ring position: the opening's `face` point (the face toward the pin/shaft), not the port origin, which is mid-depth. Orientation: rotate the ring's +Z to the opening's world axis with `quaternion.setFromUnitVectors`.
- One shared material; geometries shared per rim radius. Ring objects are kept in a pool, grown on demand; unused ones are set `visible = false` instead of being removed, so dragging does not allocate.

Alternative: change the hole part's material or add an outline pass. Rejected: per-hole areas aren't separate meshes, and a postprocessing pass is a new pipeline for a small marker.

### 6. Show/clear logic in one place
`updateAlignedHoleHighlights()` in `Viewport3D.jsx` reads `selectedIdRef`, `explodeModeRef`, and the selected instance's `visible` flag. It hides all rings when there is no selection, the selected part is hidden, or Explode is on; otherwise it computes and shows them. It is called from `objectChange` and at the end of the instance-sync effect, which covers every case in the spec's show/update/clear rule. Locked parts can still be selected and get highlights; they just can't be dragged.

### 7. Confirming the Rubber Shaft Collar v1 hole
The check script loads `Rubber Shaft Collar v1` with `getPartCollisionBvh` and casts 8 radial rays outward from 3 points along the chosen cylinder's axis, inside the collar's bbox. The cylinder counts as the real hole only if every ray hits a wall within 1.2–2.4 mm (the 1.5 mm hole radius plus the 0.38 mm erosion and some margin). If it fails, v1 is added to a small excluded-names list in the module and gets no highlights; `Rubber Shaft Collar` runs the same check.

### 8. Project rings onto the receiving part's real surface
The catalog-based face (decision §2) is the part's bounding box, which floats above the real surface wherever the area around a hole is recessed: interior beam/plate holes sit in a recess (measured surface ±2.46 mm vs bbox ±3.05 mm), gear spoke holes are on a thin web (±1.2 mm), motor pin holes are ~0.6 mm below its top.
- `measureOpeningSurfaces(partMeta, raycast)` (pure, in `pinHoleAlignment.js`) casts 8 rays parallel to each opening axis from 2 mm outside the bbox on each side, at the middle of the drawn ring (rim + 0.35 mm). For each side it keeps the hit nearest the approaching insert, ignoring hits more than 1 mm outside the opening's catalog extent, and clamps the result to the bbox. A side with no usable hit keeps its catalog extent.
- The viewport supplies `raycast` using the part's existing collision BVH (no new BVH) and subtracts the 0.38 mm erosion to step back onto the visible surface. Results are cached per part id at module level (a 12x12 Plate, 265 holes, measures in ~17 ms once).
- `collectWorldFeatures(..., surfaces)` uses the measured `{lo, hi}` as the opening extent, so both the ring position and the outside test use the real surface.
- When a part's GLB finishes loading, the viewport rebuilds the cached features and the highlights, so rings move from the catalog face onto the measured surface.

Alternatives: build a BVH on the render geometry for exact surfaces (rejected: doubles memory per part for a sub-0.4 mm gain); per-vertex projection of the ring (rejected: hole surroundings are flat in practice; a planar ring at the nearest surface is enough).

### 9. Solid on-surface rings plus a faint see-through ring
Drawing only see-through rings made them read as floating stickers; drawing only depth-tested rings would hide them exactly when they matter (hole behind the dragged pin, inside a plate stack). So each opening gets both:
- `findAlignedOpenings` also returns `farFace` (opposite face, null when the opening is not `through`, e.g. the motor socket) and `outward` (unit axis direction from the opening toward the insert).
- Solid rings (`depthTest: true`, `polygonOffset`, opaque) at `face` and `farFace`, each lifted 0.15 mm off the surface along its outward normal so the depth test never buries it (the measured surface can be ~0.2 mm off on chamfers). `renderOrder` 1002.
- One ghost ring (`depthTest: false`, opacity 0.3) at `face` only; a ghost at both faces would just stack two faint circles. `renderOrder` 1001, so where the face is visible the solid ring covers it.
- Two pools (solid, ghost) share the per-radius ring geometries.

Alternative: ghost rings on both faces (rejected: clutter); depth-tested only (rejected: breaks the see-through requirement).

## Risks / Trade-offs

- [Some part types have imprecise `spanMm` even after clamping, for example a standoff whose body section is counted as peg] → The outside-only test could be off by a few mm on those parts. Mitigation: the Node check script covers a pin, a standoff, a corner connector and shafts against a beam; tune the clamp only if a real case fails.
- [A long shaft can light many openings at once] → Each one really is aligned and not yet entered, so this is correct. The 50.8 mm reach past the shaft's ends keeps far-away openings out.
- [Large plates over a grid of pins can show many rings at once] → Same reasoning as above.
- [Drawing on top of everything can make it unclear which of two stacked holes a ring belongs to] → Both stacked holes are on the same axis and both are valid targets, so they draw at their own depths along the axis and look like a short stack of rings, which is the intended reading.
- [The handler briefly moves `obj.position` while testing flush seats] → Highlights are computed only after the final position is set, so test poses never show.
- [Collar and socket handling depend on a name match and one motor's data] → Both are checked against real geometry in the check script. A new collar or motor part would need its own entry.
- [The erosion step-back is exact only on faces square to the ray; on chamfers and rounded edges the measured face can be off by ~0.2 mm] → Results are clamped to the bbox; the ring is drawn on top of everything, so a fraction of a mm is not visible.
- [On parts whose bore is deeper than the outer face, e.g. the 2x Wide Rover Wheel hub, the ring is placed where the shaft first meets the bore (6 mm inside the wheel), not on the wheel's outer face] → This is the surface the shaft will actually hit; revisit if it reads badly.
- [Parts without `ports` and without shaft `fastenerSpecs`] never highlight → Accepted. Nearly all structural parts, pins, standoffs and shafts are covered (3,914 `pin_hole`, 148 `pin_peg`, 74 `shaft_bore`, 1 `shaft_socket`, 48 shafts after excluding collars).

## Migration Plan

Front-end only. No data, API, or state changes. Rollback is reverting the commit.
