## Context

See proposal.md for why. What exists today:

- **Parts.** The library has `Chain Link` (228-2500-230), `Tank Tread, Attachment Link` (228-2500-231), `Traction Link` (228-2500-239) and the 8, 16, 24, 32 and 40 Tooth Sprockets. The Chain Link's roller sits at local `z = 0` and its fork holes at `z = −6.35`, axis along X: links are 6.35 mm apart pivot to pivot, a link runs along its own −Z, its +Y is the outer side of the loop, and every link faces the same way (the next link's roller sits in this link's fork). The tread link has the same pivots plus two holes along +Y at `x = ±6.35`, tops at `y = 8.636`. The Traction Link's two split pegs (12.7 mm apart along its X, pointing −Y) plug into those holes: in the tread link's frame the gripper sits at `(−6.73, 4.086, −18.2)` with no turn (its model isn't centred). Checked with offline renders of the models. (Read from `public/catalog.json` `cylinders`; the link's catalog `gearSpecs` entry is a leftover from the name guess and must be dropped.)
- **Sprocket data is a guess.** `scripts/index-part-metadata.mjs` gives sprockets `gearType: 'sprocket'`, `pitchRadiusMm` = half the bounding box (that is the tooth tip, e.g. 9.245 mm for 8T) and `phaseOffsetDeg = 180/teeth`. Spur gears have real measurements from `scripts/measure-part-geometry.mjs` (`toothPhaseDeg`, `faceSpanMm`, Fourier phase over raycasts), which skips anything matching `/chain/`.
- **Meshing and axles.** `src/utils/gearMeshing.js` is pure (part metadata + poses in, turns out) so the app and `mcp/assembly-engine.mjs` share it. `src/utils/shaftGroups.js` `shaftGroups` / `turnGroup` turn an axle and everything seated on it together.
- **Groups and history.** `src/utils/partGroups.js` `groupParts` / `nextGroupName` / `applyPatches`; App edits go through `setInstances(fn, { label })`, one call per history step. The MCP server writes `public/assembly-state.json` and the app picks it up, with the same helpers.
- **Menus.** `SelectMenu.jsx` is a toolbar button over `PopoverMenu` / `MenuItem` (with `disabled` and `title`). The Build menu copies that shape.
- **Overlaps.** `src/utils/tireFit.js` `isTireOnHub` is the existing "this overlap is by design" rule, used in `assembly-engine.mjs` overlap checks and the viewport.

## Goals / Non-Goals

**Goals:**
- One pure module computes the whole chain (link and gripper poses, sprocket turns, gap report) so the app, the MCP tool and a Node check give the same answer.
- Links sit where a real chain sits: pivots on each sprocket's pitch polygon, straight runs on the outer touching lines.

**Non-Goals:**
- A live chain that re-wraps when a sprocket moves, or drives sprockets when one turns.
- Idlers inside the loop, chains that weave between sprockets (S-paths), or wrapping spur gears.
- Two-wide tracks with Track Tiebars; mixing chain and tread links in one loop.

## Decisions

### 1. Pitch radius from chain pitch, tooth angle from the mesh
A sprocket's pitch radius for a 6.35 mm chain is `r = 6.35 / (2·sin(180°/N))` (8T 8.30, 16T 16.27, 24T 24.32, 32T 32.40, 40T 40.51 mm). That is exact for a roller-type chain and needs no measuring; the measured tip radius is only a sanity check (tip must exceed r). The tooth (gap) angle does need measuring: extend `measure-part-geometry.mjs` with `measureSprocket` that reuses the spur-gear Fourier fit (k = teeth) to find the tooth phase and face span, and store `gearSpecs: { gearType: 'sprocket', teeth, chainPitchMm: 6.35, pitchRadiusMm, tipRadiusMm, toothPhaseDeg, gapPhaseDeg, faceSpanMm, measured: true }`. Gap phase = tooth phase + 180/N.
*Alternative:* measure the pitch radius from the mesh. Rejected: the roller seat is hard to find reliably by raycast and the formula is what the real part is designed to.

### 2. The path: outer hull of circles, then a pitch polygon
`src/utils/chainPath.js`:
1. **Plane.** Take the first sprocket's axle as the plane normal `n`; check every other axle within 2° and every centre within 1 mm along `n`; project centres to 2D in the frame of `refAxes(n)` (`src/utils/axisFrame.js`).
2. **Loop order.** Convex hull of circles (pitch radii) — the belt round the outside. Sprockets not on the hull are reported "not touched". Each hull sprocket gets the arc between its incoming and outgoing outer tangent points.
3. **Links.** Walk the loop starting at the first sprocket's first tangent point. On an arc, pivots step by the sprocket's tooth angle `360/N` (each link is a chord of exactly 6.35 mm on the pitch circle); on a straight run, pivots step 6.35 mm. Count the pivots the true path needs as a real number `L/6.35` using arc length counted in whole teeth plus straight lengths.
4. **Whole count, never too tight, walked link by link.** `n = ceil(exact − 0.5 mm / pitch)`: a chain can't stretch, so never more than its joints' play short of the path (links are all alike, so odd is fine). The walk starts where the chain leaves one sprocket: each run lands where the chain meets the next sprocket (its touching point from the last pivot) with the whole number of links that fits it best, eased by at most 0.2 mm a link, or bowing outward on an arc of equal links when it has links to spare; then one tooth per link round that sprocket. The last run closes the loop onto the first sprocket, a whole number of teeth before the start and near its touching point, with the links left of `n`; it holds the slack and sags outward. The closing (sagging) run is the one facing the floor (world −Y), or the longest when the sprockets lie flat; if closing there would need an extra link, another run closes instead. The gap `(exact − links)·6.35` mm and the suggested move (the sprocket and direction along one of its runs that changes the path length fastest, found numerically) go in the report; over half a link of slack → "it will sag" note.
   *Earlier tries:* the nearest whole count (could be up to half a link too tight: it happened in a real build, 1.7 mm short), and easing every run by one common factor (squeezing every run lands each one early, so its last link cuts the teeth).
5. **Link poses.** Each link sits between pivots `p_i` and `p_{i+1}`: position = `p_i` lifted into 3D on the plane, its local −Z along `p_{i+1} − p_i`, its local X (pivot axis) along `±n` (the sign that makes its +Y point out of the loop). No alternating: every link faces the same way.
6. **Sprocket turns.** For each hull sprocket, the turn about its axle that puts a gap (`gapPhaseDeg`) at the angle of the nearest pivot on its arc, the smallest such turn. Applied with `turnGroup` so its axle and the parts on it turn too.
7. **Track.** Same poses with the tread link's part id. With grippers, every tread link gets a Traction Link at the fixed offset above in the link's own frame, so it faces out wherever the link does. The link's +Y is set to the loop's outward side (on arcs away from the sprocket centre; on runs the side away from the hull's inside), which both chain and track need.

The function takes `(sprockets: [{ instanceId, meta, position, rotation }], { kind, grippers })` and returns `{ ok, error?, links: [{ partId, position, rotation }], grippers: [...], sprocketTurns: [{ instanceId, deg }], onLoop, leftOut, gapMm, moveHint, notes }`. No Three.js scene, no app state.

*Alternative:* sample the path at equal arc length and drop links on it. Rejected: on small sprockets the chord/arc difference puts pivots off the teeth, and the 8T sprocket would look wrong.

### 3. Build menu and track dialog
`src/components/BuildMenu.jsx` shaped like `SelectMenu.jsx`, placed in the Selection toolbar group. App computes `chainCheck = checkSprocketsForChain(selected)` (cheap: plane and hull only) on selection change to drive `disabled` and `title`. Track builder opens a small dialog with the "Add rubber grippers" checkbox (state in App, not saved) and Build / Cancel.

### 4. One history step through the server action
The sprocket turns need each part's world features (shaft groups), which the engine has on the server. So `handleBuildChain(kind, opts)` runs the `build_chain` action (`vite.config.js`), the same path as Mesh gear train: the engine's `buildChain` adds the link and gripper instances (labels "Chain Link #12" as other adds), applies the sprocket group turns, and groups the new parts with `nextChainName(kind)` ("Chain N" / "Track N"). The action records one history step labeled with the message's first sentence, and the app adopts the new state and selection. The MCP tool calls the same `buildChain`.
*Alternative:* compute in the app with `setInstances`. Rejected: the app would need the viewport's feature lookups to find shaft groups.

### 5. MCP engine and tool
`assembly-engine.mjs` gets `buildChain(state, args)` calling the same `chainPath` and the same grouping helpers, writing one history step as the other engine tools do. `vexiq-mcp-server.mjs` registers `build_chain` with the schema in the spec. `scripts/check-mcp-tools.mjs` gains the tool.

### 6. Audit and overlaps
New `src/utils/chainFit.js` (like `tireFit.js`): `isChainOnSprocket(a, ma, b, mb)`, `isChainNeighbour` (two Chain Links in the same group), `isGripperOnLink`. A link counts as seated on a sprocket when its pivot axis is parallel to the sprocket's axle, it's in the sprocket's tooth plane, and a pivot is within 0.5 mm of the pitch circle. Overlap checks skip these pairs, and also a link leaving or reaching a sprocket (a pivot between the pitch circle and a plate's height past the tooth tips), whose plates rub the next teeth as a real chain's do. A chain bending where no sprocket holds it is flagged only for a bend of one tooth's angle (360°/8, 16, 24, 32, 40) or sharper than 45°, so a slack run's gentle sag isn't. The audit's connectivity graph adds edges link↔link within a chain/track group and link↔sprocket where seated; unpinned check treats a chain/track link as held when its group is seated on at least one sprocket. Chain/track groups are recognised by holding only Chain Links, tread links and Traction Links, so renaming the group doesn't break it.

*Alternative:* store a `chainOf` field on instances. Rejected for now: a group of only chain parts is enough, and no new saved field means older builds and the history need no change.

## Risks / Trade-offs

- [A pose mistake in the link or gripper frame shows only when looked at] → task 2.1 renders the parts offline at the computed poses before the walk is written; the check script pins the pose of the first link and gripper.
- [A slack chain is drawn as one gentle sag, not where gravity would really put it] → the sagging run is the one facing the floor; the gap and the move for a snug fit are reported. Runs are eased at most 0.2 mm a link.
- [A 60+ link chain with grippers adds ~90 parts; viewport cost] → every link uses the same small model; check frame rate on a 3-sprocket track with grippers before calling it done, and share geometry between links if it drops.
- [Turning sprockets also turns meshed gears' axles, which may break an existing gear mesh] → the turn is the smallest that fits (under half a tooth), and the message names any part turned besides the sprockets.
- [Sprocket measurements change catalog data] → only sprocket and Chain Link entries change; `check-gear-meshing.mjs` still runs on spur gears.

## Migration Plan

No saved-data change. Regenerate `public/catalog.json` and `public/part-metadata.json` with `npm run index-metadata` after the sprocket measuring lands. Rollback: revert the commit and the regenerated catalog.
