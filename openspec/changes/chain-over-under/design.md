## Context

See proposal.md for why. What exists today (from `openspec/specs/chain-track-builder` and the archived `2026-10-30-chain-track-builder` design):

- **`src/utils/chainPath.js`** is pure and shared by the app (Build menu check), the engine (`mcp/assembly-engine.mjs` `buildChain`) and `scripts/check-chain-builder.mjs`. It lays the sprockets' pitch circles out in 2D (`refAxes(n)` frame), finds the outer loop with `outerLoop(circles)` (every edge an outer touching line, counter-clockwise, the circles on the left), and walks the pivots link by link with `planChain` (whole teeth round each arc, whole links on each run, one closing run holding the slack and hanging toward the floor on a catenary; the other runs straight). `loopGeometry` / `exactLinks` give the true length; `suggestMove` the sprocket to move. Link poses put local −Z along the chain and +Y to the right of travel, which on a counter-clockwise loop is the outside.
- **Only sprockets** (`gearSpecs.gearType === 'sprocket'`, measured) are read; other selected parts are dropped before the check. Sprockets inside the loop end up in `leftOut`.
- **Standoffs** have `fastenerSpecs: { fastenerType: 'standoff', axis: [0,0,1], shoulderNegZ, shoulderPosZ, bodyLengthMm }` and catalog `cylinders`; the body cylinder is radius 3.175 mm on the part's Z axis (1x: body from z −12.7 to 0). No gear data.
- **Links:** Chain Link and Tank Tread Attachment Link both reach 2.2 mm each side of the pivot line on their Y axis (bbox y −2.2; the tread link's extra height is on +Y, the outer side). So a link resting on a round body has its pivots 2.2 mm out from the surface.
- **`src/utils/chainFit.js`** decides which chain contacts are by design (`isLinkOnSprocket`, with a `leaving` allowance) and finds unsupported bends; the engine's audit and the viewport overlap checks use it.
- **App flow:** `App.jsx` computes `chainCheck = checkSprocketsForChain(selected)` for the Build menu; Chain builder runs the `build_chain` action (`vite.config.js` → engine `buildChain`), one history step. Track builder first opens `TrackBuilderDialog`.

## Goals / Non-Goals

**Goals:**
- One generalised path in `chainPath.js` where each loop part is wrapped from inside (outer parts) or from outside (enclosed parts the chain bends round), so the app, MCP and checks agree.
- Standoffs work as smooth guides with the same code path as sprockets, minus teeth and turning.
- Every refusal names a part and a reason, from the same function.

**Non-Goals:**
- A live preview of the bent path inside the route dialog.
- Tracks bending round enclosed parts, or chains crossing themselves (figure-eight).
- Other guide parts (shafts, pins, rubber collars) as guides; only standoffs for now.
- Saving the route with the chain; a rebuild asks again (the page remembers the last answers).

## Decisions

### 1. Signed wraps: one tangent formula for both sides
Each part on the loop gets a side `s`: `+1` wrapped counter-clockwise from inside the loop (the outer parts, as today) or `−1` wrapped clockwise from outside (an enclosed part the chain bends round). The touching line from `a` to `b` uses signed radii `sa·ra`, `sb·rb` in the existing formula: `k = (sa·ra − sb·rb)/L`, `m = [k·ux + h·uy, k·uy − h·ux]`, touching points `a + sa·ra·m` and `b + sb·rb·m`. Same signs give the outer touching line (today's case), opposite signs the crossing line. It needs `|sa·ra − sb·rb| < L`; for opposite sides that is `ra + rb < L`, otherwise the parts are too close for the chain to pass between them (a refusal). Arcs: `alpha = mod2pi(s·(thOut − thIn))`, pivots stepping `s·tau`. Link poses don't change: +Y is still the right of travel, the loop's outside, so on an enclosed part the links' outer side faces it (fine for a chain, which is the same both sides; the reason tracks don't do this).
*Alternative:* treat a bent run as two separate chains joined at the enclosed part. Rejected: the walk, the closing run and the gap report all assume one loop.

### 2. Finding enclosed parts and the run each choice bends
1. Build the outer loop as today, with standoff guides added as circles (Decision 4).
2. **Enclosed** = selected circles not on the loop whose centre is inside the loop's outline (runs plus arcs, as a polygon of touching points and arc samples).
3. "Above" in the plane = world +Y projected onto it; when the plane's normal is within 17° of world Y (the projection is shorter than 0.3, as the sag rule already uses), world −Z projected instead.
4. From the enclosed part's centre, cast along +above and −above. The first straight run each ray crosses is that part's **top run** and **return run**. Under inserts the part (side −1) into the top run; Over into the return run. A ray that meets an arc before any run (the part sits right beside an outer sprocket) is a refusal: "X sits right next to Y; move it so the chain passes it on a straight run".
5. Several parts inserted into one run are ordered by their centres' position along the run's direction.

`checkSprocketsForChain` returns these as `enclosed: [{ instanceId, label, topRun, returnRun }]` so the app knows whether to ask before building. With `kind: 'track'`, enclosed parts go to `leftOut` with reason `outside-only`.

### 3. Validation after the route is applied
With the parts inserted, recompute every signed touching line and arc, then refuse (first failure wins, message names the parts) when:
- a touching line doesn't exist (`ra + rb ≥ L` for opposite sides): "too close for the chain to pass between X and Y";
- a part wraps the wrong way: at each loop part the turn from its incoming to its outgoing run direction must have the sign of `s` (or the arc would be more than a full turn). An outer part failing this "would no longer touch the chain with this route"; an enclosed part failing it "wouldn't be reached by the chain";
- a run comes within two link half-heights (4.4 mm) of another run or arc of the same loop, or crosses it: "the chain's runs would touch between X and Y";
- a run or arc passes within a link half-height of a selected part that isn't on the loop (its tip radius for a sprocket, body radius for a standoff): "the chain would pass through X";
- the total turning isn't one full turn (a loop that crosses itself).
These checks run on the 2D circles before the walk, so the Build menu's hover text can show the same reasons for routes already chosen.

### 4. Standoffs as guide circles
A part is a standoff guide when `fastenerSpecs.fastenerType === 'standoff'`. Radius: the largest catalog cylinder on the part's Z axis (3.175 mm) plus the link's half-height read from the link part (|bbox.min.y|, 2.2 mm), so pivots ride 5.375 mm from the axis. Its body span along Z is `[shoulderNegZ, shoulderPosZ]` (world: transformed by the pose); it reaches the chain when the chain's plane lies inside that span. Derived at run time from the catalog part already passed in, so no metadata rebuild. Guides have no teeth: `teethOf` is not used for them, arc length counts as `alpha·r/pitch` in `exactLinks`, and on the walk a guide arc places pivots one 6.35 mm chord apart starting at the touching point (`2·asin(6.35/2r)`, about 72°), so a shallow wrap (most standoff contacts) is a single pivot at the touching point. Guides are never in `sprocketTurns`. A guide doesn't count toward the two sprockets.
*Alternative:* store `guideSpecs` in `part-metadata.json` at index time. Rejected for now: the two numbers are already in the catalog, and a rebuild of the catalog in a worktree is error-prone (AGENTS.md).

### 5. Where the slack goes
The closing (sagging) run is chosen as today, but only among runs between two outer parts (`s = +1` at both ends). When there are none (every run touches an enclosed part), the longest run takes it. The spec's "sag on a run that doesn't bend round an enclosed part" holds whenever such a run exists.

### 6. Route dialog and highlight in the app
`BuildMenu.jsx` gains `ChainRouteDialog` (same `<dialog>` shell as `TrackBuilderDialog`): one row per enclosed part with two toggle buttons, Under / inner and Over / outer, no default; Build enabled when all rows have a choice. `App.jsx` keeps `chainRoute` (a `Map` instanceId → 'over' | 'under') for the page, opens the dialog from `onChain` when `chainCheck.enclosed.length > 0`, and passes `route` to the `build_chain` action. While the dialog is open, `App` sets `attentionIds` (the focused or hovered row's part, the first row on open) and `Viewport3D` draws those parts with a distinct highlight (a pulsing tint in the hole-highlight colour, separate from the selection tint so the selection isn't changed); cleared on close.
*Alternative:* select the asked-about part. Rejected: it would change the selection the chain is built from.

### 7. Engine, action and MCP
`buildChainPath(parts, { kind, grippers, route, metaByPartNumber })` takes `route` as a plain object. A chain with enclosed parts not in `route` returns `{ ok: false, error, needsRoute: [{ instanceId, label }] }`. The engine's `buildChain` passes `route` through and returns `needsRoute`; `vite.config.js` forwards `params.route`; `vexiq-mcp-server.mjs` adds `route` to the schema, passes it, and on a refusal includes `needsRoute`. The reply adds `wrapped: [{ instanceId, side: 'outer' | 'over' | 'under' }]` and `leftOut: [{ instanceId, reason }]` (**changed shape**: today `leftOut` is a list of ids; the app only uses it through `chainMessage`, and the MCP reply is read by clients, so the change is noted in the tool description).

### 8. Fit and audit
`chainFit.js` adds `isLinkOnStandoff(link, standoff)`: pivot axis parallel to the standoff's, the link inside the body span, and the link's pivot-to-pivot segment between 0.5 mm inside and 0.5 mm outside the guide circle (with the `leaving` allowance as for sprockets). `isChainFit` and `unsupportedBends` treat a standoff like a sprocket for "held at this bend". `isLinkOnSprocket` already measures distance to the pitch circle without regard to side, so links wrapping an enclosed sprocket from outside pass unchanged. The audit's "seated on a sprocket" (for unsecured) stays sprocket-only.

### 9. Messages
`chainMessage` names standoffs and routes: "Chain builder: 52 Chain Links round 3 sprockets and 1 standoff (under 8 Tooth Sprocket #3). Exact fit." Track left-outs: "Left out, tracks only go round the outside: 8 Tooth Sprocket #3." Refusals are the strings from Decision 3, used as `error` everywhere.

## Risks / Trade-offs

- [A deep dent makes a sharp bend on a small enclosed part, which the walk may not land on whole teeth well] → the walk already lands each run on the next part's touching point; add check cases with an 8T idler under and over, and verify pivots on its pitch circle.
- [Guide pivots placed one chord apart can cut a little into a standoff on a deep wrap] → check that no link segment comes inside the body radius by more than 0.2 mm in `check-chain-builder.mjs`; if it does, place the guide pivots symmetrically about the arc's middle.
- ["Above" is arbitrary when the parts lie flat] → defined once (world −Z) in the spec; the highlight shows which part is asked about, and the result can be undone in one step.
- [`leftOut` changes shape in the MCP reply] → noted in the tool description; `check-mcp-tools.mjs` updated.
- [Ray to find the top/return run is ambiguous for a part near a corner of the loop] → refused with a reason telling the user to move it, rather than guessing.

## Migration Plan

No saved data changes. Chains already in builds stay as they are; the audit rules only widen (standoff contacts by design). Rollback is reverting the change.
