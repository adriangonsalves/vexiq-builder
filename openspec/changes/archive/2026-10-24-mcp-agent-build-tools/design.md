## Context

See `proposal.md` for why; the rules are in `specs/mcp-fit-audit`, `specs/mcp-batch-placement`, `specs/mcp-part-details` and `specs/mcp-app-link`.

Current state that shapes the approach:

- **Server** (`mcp/vexiq-mcp-server.mjs`):
  - `executeTool(name, args)` is one big `if (name === …)` chain;
  - `handleJsonRpcMessage` wraps each result as a single `text` content item with `JSON.stringify(output, null, 2)`;
  - each writing tool reads the state file, changes it, and calls `writeAssemblyState`, with no `await` between the read and the write, so concurrent calls don't interleave.
- **Engine** (`mcp/assembly-engine.mjs`):
  - `STATE_PATH` is fixed at `public/assembly-state.json`;
  - `getPartCollisionBvh(part)` gives a BVH over the part's 0.38 mm-eroded mesh;
  - `checkCandidateCollision(candidate, instances)` tests one candidate against all instances;
  - `computeMateTransform` lines a source port up with a target port, origin on origin, plus `axialOffsetMm` (no contact search);
  - `mirrorSubassembly(state, { instanceIds, mirrorPlane, planeOffsetMm })` handles the asymmetric parts;
  - `writeAssemblyState` writes the file, then POSTs to `localhost:${VEXIQ_APP_PORT || 5173}/api/assembly` and swallows errors.
- **Audit** (`auditAssembly`):
  - splits parts into fasteners and other parts by name (`includes('shaft')`, category Pins & Standoffs), which is why Rubber Shaft Collars count as shafts;
  - "engaged" means expanded (0.6 mm) bounding boxes intersect;
  - power tracing calls a part coaxial with a shaft when any of its port origins is within 2.2 mm of the shaft line.
- **Shared fit rules** (`src/utils/pinHoleAlignment.js`, pure, already imported from Node by `scripts/check-pin-hole-alignment.mjs`):
  - `getLocalFeatures`, `collectWorldFeatures(meta, matrix, id, { surfaces, pinEnds })`;
  - `measureOpeningSurfaces(meta, raycast)` measures the opening faces from the rim side;
  - `measurePinEnds(meta, raycastHit)`;
  - `findAlignedOpenings` (insert still outside), `findEngagedJoints` (insert inside, from the rotate-mode change);
  - `planMates(pairs, selectedId)` gives direction, lateral shift, travel and contact-search range.
- **Bridge** (`vite.config.js`):
  - `/api/assembly` GET/POST, where POST broadcasts over SSE to `sseClients` (a Set of open browser streams);
  - `/api/assembly/events` is the SSE stream;
  - `/api/assembly/action` runs UI-invoked engine tools.
- **App:** `App.jsx` listens to the SSE stream, ignoring `msg.source === 'browser'`. `Viewport3D.jsx` owns the renderer, camera and overlays. It already exposes one callback to App via a register prop (`onRegisterFlushMover`).

## Goals / Non-Goals

**Goals:**
- One fit rule for the server and the app: seating uses the same pure module.
- Every new behavior checkable from Node against a temporary state file, without touching the user's assembly.
- Fewer, smaller replies: one call and one summary for a whole layout.

**Non-Goals:**
- Changing the browser's hole highlighting or double-click mating to use measured depths. The app keeps today's rules; this is a possible follow-up.
- Regenerating `public/catalog.json`. Measured depths are computed at runtime and cached.
- Changing replies of existing single-part tools beyond adding `appSync`; only `get_part_details` gets a compact default.
- Rendering screenshots without a browser (no headless Chrome dependency).
- Undo.

## Decisions

### 1. Shared seating module, measured on the engine's meshes
Add an engine helper `getPartMeasurements(part)`, cached per part id. It builds raycasters over `getPartCollisionBvh(part).colGeo`, in the shapes `measureOpeningSurfaces` and `measurePinEnds` expect, and returns `{ surfaces, pinEnds, depths }`. `worldFeaturesFor(instance)` then calls `collectWorldFeatures(part, buildWorldMatrix(...), id, measurements)`.

Measuring on the eroded mesh puts surfaces up to 0.38 mm off. Openings come out slightly deeper and longer, which is well inside the 0.05 mm overlap rule for seating and the 0.25 mm axis tolerance. The browser measures on the full mesh, so values can differ by that much.

*Alternative considered:* a second copy of the rules in the engine. Rejected: two copies drift apart, and the module is already Node-safe.

### 2. Measured hole depth: `measureOpeningDepths(partMeta, raycast)`
New pure function in `pinHoleAlignment.js`. For each opening, it casts rays along the axis from just outside each face: one on the axis and four at half the rim radius. Each ray's first hit gives the depth from that face; the median of the five is used. The result is `Map(featureId -> { fromLo, fromHi, length })`.

In `collectWorldFeatures` (when `measured.depths` is given):
- if either depth reaches the full length (within 0.5 mm), it stays one through opening;
- otherwise each face open at least 1 mm deep gives a blind feature with its measured depth, named `<id>@lo` / `<id>@hi` when both faces are open, and keeping `<id>` when only one is; a face shallower than 1 mm counts as closed (the Smart Motor's back marks measure about 0.4 mm).

A ray that misses (open all the way) counts as the full length. The `@lo`/`@hi` ids keep the catalog port id visible in replies.

### 3. Audit on seated joints
Rewrite the engagement part of `auditAssembly`:

- **Role sorting:**
  - fasteners are parts with `fastenerSpecs.fastenerType` in `connector_pin`, `standoff`, `straight_shaft`, `capped_shaft` or `motor_shaft`, excluding Rubber Shaft Collars (`COLLAR_NAME_PATTERN`, exported from the module);
  - everything else, collars included, is a held part.
- **Joints:** for every pair of instances whose world boxes come within 12.7 mm, compute seated pairs. Use `findEngagedJoints` generalized to return `{ insert, opening }` pairs with ids, or a small `findSeatedPairs(featuresA, featuresB)` built from the same `pairRoles` / `coaxialSpans` helpers.
- **Fastener status:** each fastener's set of partner parts gives floating (0), half-seated (1) or fastening (≥ 2). A held part with integral pegs (a corner connector) links directly to the part its pegs sit in.
- **Graph:** adjacency comes only from fasteners with ≥ 2 partners and from integral-peg joints. Gear-mesh edges and the clamp rule stay as they are.
- **Fastener counts** for `minFastenersRequired` count distinct fasteners or pegs seated in the part.
- **Power tracing:** a part is on a shaft when the shaft is seated in one of its `shaft_bore`, `shaft_socket`, `pin_hole` or `collar_hole` openings. Wheels and tires with a center bore qualify; the 2.2 mm proximity rule goes.
- **Overhang** uses the shaft feature's span against the union of the seated openings' spans, collars included.
- **New result fields:** `joints` (per fastener: `[{ partId, port }]`), `halfSeatedFasteners`, `halfSeatedFastenerCount`. `isMechanicallySound` also requires no half-seated fasteners.

### 4. `place_parts` in the engine, thin wrapper in the server
`placeParts(state, items, { dryRun, mirror, rejectIntersecting, verbose })` in the engine returns `{ nextState, results, audit, error }`.

- **Order:** items are resolved in order into a working copy of the instances; refs map to instance ids.
- **Absolute items:** placed as given.
- **Insert items** (§5) are placed against the working copy, so later items see earlier ones.
- **Mirror** (§6) runs after all originals.
- **Overlaps:** checked last, each new instance against the working copy (old and new), so pairs among new items are found.
- **Audit:** `auditAssembly({ ...state, instances: working })`, shortened to the summary fields in the spec.
- **Saving:** the server writes `nextState` once unless `dryRun`, or unless `rejectIntersecting` found overlaps.
- **Failures:** an unresolvable item returns `error: { index, ref, reason }` and nothing is written.

### 5. Insert = line up outside, then `planMates`, then sweep
For an insert item:
1. Resolve the source feature (port id or default) and the target opening's world feature from `worldFeaturesFor(target)`.
2. Use `computeMateTransform` (with `rollDeg`, and `flipAxis` chosen so the source points into the opening from `fromSide`) to get the orientation. Then place the item along the axis so its leading end is 1 mm outside the target opening's face on `fromSide`.
3. Run `findAlignedOpenings(itemFeatures, targetFeatures)` and keep the pair for the requested opening. Then `planMates([pair], itemId)` gives the direction, lateral shift, travel and contact-search range: exactly the double-click mating plan.
4. **Sweep:** in 0.5 mm steps up to the contact-search range, using `checkCandidateCollision` against the working instances.
   - At the first contact, bisect 10 times between the last clear and the touching step.
   - Then round to 0.001 mm and back off along −direction in 0.002 mm steps until clear.
   - If nothing is touched, stop at the travel limit.

   This mirrors `mateSelected` in `Viewport3D.jsx` on the engine's collision check. The 0.25 × pitch flush-seat preference of `findFlushBoundaryPosition` is applied the same way on the dominant axis.
5. Report `stoppedAgainst` (the touched instance's label) or `"flush with far face"`.

*Alternative considered:* extend `mate_parts` with a `seat` option. Kept separate because batch inserts need refs to items not yet saved. `mate_parts` can gain `seat: 'contact'` later by calling the same helper.

### 6. Mirror inside the batch
`mirrorSubassembly` picks among a few candidate rotations by how well they move the part's box center. Tried on the drivetrain's left half, that turned the corner connector upside down: its flange ended up at the bottom, under the plate pins. So `place_parts` mirrors exactly instead:
- **Symmetry plane:** `localMirrorSymmetry(part)` finds a local axis k and plane x_k = c across which the part's own bbox and every catalog feature (kind and both span ends, within 0.3 mm) map onto themselves. It is cached per part.
- **Mirrored pose:** with world reflection S and that local reflection L, the mirrored geometry S(R p + t) equals R′ q + t′ with R′ = S R L (a proper rotation) and t′ = S(R(2c e_k) + t).
- **No symmetry plane** (left- or right-handed parts): fall back to `mirrorSubassembly`'s pose and flag the item `mirrorApproximate`.
- **Own mirror image:** an item whose mirrored features coincide with its own (within 0.05 mm) is not doubled.

Mirrored items are relabeled by swapping Left↔Right (case kept), or by adding " (mirror)", and get refs `<ref>#mirror`. Inserts are not re-run for mirrors; the mirror of a final pose is already seated. `mirror_subassembly` itself is unchanged; it could reuse `mirrorPose` later.

### 7. Compact `get_part_details`
Build `connections` from `getLocalFeatures` plus the measurements: `{ port, kind, origin, axis, span: [lo, hi], depthMm, through, sticksOut: 'lo' | 'hi' | 'both' }` for pegs and pins. Split openings show up as two entries. Default reply: identity, size, `bbox`, `originType`, `gearSpecs`, `fastenerSpecs`, `connections`. `verbose: true` adds today's full object. Numbers are rounded to 0.01 mm.

### 8. `appSync` on every write
- `writeAssemblyState` returns `{ state, appSync, hint }`:
  - POST failed → `saved-to-file-only`;
  - POST succeeded → read the bridge's reply `{ ok, browserClients }`, where the bridge's POST handler is changed to include `sseClients.size`: 0 → `no-browser`, more → `live`.
- `executeTool` callers that write already `await` it; a module-level `lastWrite` is set per call.
- `handleJsonRpcMessage` adds `appSync` (and the hint) to any tool result when a write happened during that call.
- `configure_viewport` writes state, so it is covered.

### 9. Screenshot round trip through the bridge
- **Server:** `capture_screenshot` POSTs `{ view, width, height, focusInstanceId }` to `/api/assembly/screenshot` and waits up to 12 s.
- **Bridge:**
  - if `sseClients.size === 0`, answer 409;
  - otherwise create a `requestId` and keep `{ res, timer }` in a pending map;
  - send `data: {"type":"screenshot-request", …}` to the most recently connected client;
  - `/api/assembly/screenshot-result` (POST `{ requestId, png }`) resolves it with 200 `{ png }`;
  - after 10 s without a result, answer 504.
- **App:**
  - `es.onmessage` routes `msg.type === 'screenshot-request'` to a capture callback that `Viewport3D` registers (`onRegisterScreenshot`), then POSTs the result;
  - those messages are not treated as state updates.
- **Viewport capture** (synchronous, one task, so nothing flickers):
  - hide the TransformControls helper, hole overlay, mate arrows and rotate gizmo, and clear the selection tint;
  - for `current`, use the main camera; otherwise use a temporary perspective camera framed on the box of all visible parts (or the focus part), like the Focus button, from a fixed direction per view;
  - `renderer.setSize(w, h, false)`, render, `canvas.toDataURL('image/png')`;
  - restore the size, overlays and tint, then render again.
- **Reply:** the MCP result is `content: [{ type: 'image', data, mimeType: 'image/png' }, { type: 'text', text: '{"ok":true,…}' }]`. `handleJsonRpcMessage` passes a tool's `content` through when it returns one.

### 10. Test seam
- `STATE_PATH` reads `process.env.VEXIQ_STATE_PATH` when set.
- `scripts/check-mcp-tools.mjs`:
  1. copies a fixture state to a temp file;
  2. starts a stub HTTP server on a free port that plays the bridge (counting fake browsers and answering screenshot requests with a tiny PNG);
  3. spawns the MCP server with both env vars;
  4. drives it over newline JSON-RPC, checking each spec scenario.

  The browser-side capture is checked in the running app, the same way the rotate-mode change was tested.

## Risks / Trade-offs

- [Audit results change for existing saved assemblies: some that passed now report half-seated or floating fasteners] → That's the point of the change; the reply names each one, and the release note says so.
- [Measuring 478 part types is slow on first use] → Measured lazily per part type and cached for the server's lifetime. Rays per part are about 10 per opening, and the BVH build already happens for collision.
- [Depth rays hit internal ribs or chamfers and under-report depth] → Median of five rays. Values within 0.5 mm of the length count as through. Verify on the motor, beams, plates and gears in the check script.
- [Sweep on the server is slower than in the browser] → Same 0.5 mm steps as the browser over at most about 160 mm, each a box-filtered BVH test. A batch of 30 inserts stays in the low seconds.
- [Screenshot from the wrong tab when several are open] → Use the most recently connected client and document it.
- [Image replies are large] → Default 1024 × 768 PNG; width and height are capped at 1920.

## Migration Plan

No data migration. Existing tools keep their names and arguments. `get_part_details` callers that need `cylinders` pass `verbose: true`. Rollback is reverting the change.
