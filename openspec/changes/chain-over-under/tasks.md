## 1. Path with signed wraps (`src/utils/chainPath.js`)

- [ ] 1.1 Generalise the touching-line and arc code to signed sides (design 1): each loop node carries `s = ±1`; `loopGeometry`, `exactLinks`, `planChain` (arc steps `s·tau`) and `suggestMove` use signed radii. Verify `node scripts/check-chain-builder.mjs` still passes unchanged for all existing outer-loop cases.
- [ ] 1.2 Add standoff guide circles (design 4): detect `fastenerType === 'standoff'`, radius = largest Z-axis catalog cylinder + link half-height, body span from `shoulderNegZ`/`shoulderPosZ`; parallel and reaches-plane checks with named reasons; guides need no teeth (`alpha·r/pitch` in the length, one-chord pivot steps on the walk) and are never turned; at least two sprockets still required. Verify with new check cases: a 1x standoff on the outer loop gives links resting on it (no link segment inside the body by more than 0.2 mm), an angled standoff and one short of the plane are refused with their reasons, one sprocket + one standoff is refused.
- [ ] 1.3 Find enclosed parts and their top and return runs (design 2) and return them as `enclosed` from `checkSprocketsForChain`; for `kind: 'track'` put them in `leftOut` with reason `outside-only`; a ray hitting an arc first is refused with its reason. Verify with check cases: three sprockets in a row (middle small) report the middle as enclosed with the top/bottom runs; a flat layout uses world −Z as "above".
- [ ] 1.4 Apply `route` (`{ id: 'over' | 'under' }`): insert each enclosed part with `s = −1` into its top run (under) or return run (over), ordered along the run; a chain with an enclosed part missing from `route` returns `needsRoute`. Verify check cases: under and over for an 8T idler between two 24T sprockets give a closed loop whose pivots on the idler sit on its pitch circle (within 0.05 mm) and on the correct side, and the idler gets a sprocket turn.
- [ ] 1.5 Add the validation pass (design 3) with refusal messages naming the parts: too close to pass between, an outer part losing the chain, an enclosed part not reached, runs touching, passing through an unwrapped selected part, a self-crossing loop. Verify one check case per reason, each asserting the message text names the right part.
- [ ] 1.6 Choose the slack run only among runs between two outer parts, else the longest (design 5). Verify a check case with Under on the top run and a slack chain sags on the bottom run.
- [ ] 1.7 Update `chainMessage` and the result shape (`wrapped`, `leftOut` with reasons, standoff counts) per design 7 and 9. Verify check cases on the message text for a route build and for a track with an enclosed part ("tracks only go round the outside").

## 2. Fit and audit (`src/utils/chainFit.js`, `mcp/assembly-engine.mjs`)

- [ ] 2.1 Add `isLinkOnStandoff` and use it in `isChainFit` and `unsupportedBends` (design 8). Verify in `check-chain-builder.mjs`: links built over a standoff and under an enclosed sprocket count as chain fits, and none of their bends are reported unsupported.
- [ ] 2.2 Make sure the engine's audit and overlap checks pass standoffs to these rules. Verify with an engine-level check (build state with sprockets, a standoff and a routed chain, run `auditAssembly`): no collisions between the chain and its wrapped parts, no unpinned chain links.

## 3. Engine, action and MCP

- [ ] 3.1 `buildChain` in `mcp/assembly-engine.mjs` takes `route`, accepts standoffs among `instanceIds`, and returns `needsRoute`, `wrapped` and the new `leftOut`. Verify through the engine-level check in 2.2 (one history-step label, the group, the idler turned).
- [ ] 3.2 Forward `params.route` in the `build_chain` action in `vite.config.js` and pass `needsRoute` back on refusal. Verify by calling the action from the running app on port 5173 (route missing → refusal with the list; route given → built).
- [ ] 3.3 `build_chain` in `mcp/vexiq-mcp-server.mjs`: add `route` to the schema and description (over/under meaning, tracks outside only, standoffs accepted, `leftOut` shape), return `needsRoute`, `wrapped`, `leftOut`. Update `scripts/check-mcp-tools.mjs`. Verify `node scripts/check-mcp-tools.mjs` passes.

## 4. App: route dialog and highlight

- [ ] 4.1 `ChainRouteDialog` in `src/components/BuildMenu.jsx` (design 6): a row per enclosed part with Under / inner and Over / outer, no default, Build enabled only when all are chosen, Cancel builds nothing; reports the focused/hovered row. Verify in the app: three sprockets in a row → dialog lists the middle one, Build greyed until a choice.
- [ ] 4.2 In `src/App.jsx`: Build menu passes standoffs through `chainCheck`; Chain builder opens the dialog when `chainCheck.enclosed` is not empty; remember choices per part for the page; pass `route` to `build_chain`; Track builder unchanged apart from the left-out reason. Verify in the app that Under and Over each build the expected bend, and a second build offers the last answers.
- [ ] 4.3 `attentionIds` highlight in `src/components/Viewport3D.jsx`: a pulsing tint separate from the selection, on the asked-about part, first row on open, cleared on close; selection unchanged. Verify in the app with a screenshot while the dialog is open.

## 5. Docs and end-to-end check

- [ ] 5.1 Update `features.md` (Chain and track builder, `build_chain`) and the chain bullet in `AGENTS.md` between the MCP markers (over/under, standoffs, tracks outside only). Verify the MCP server's connect text includes the new sentence (`node scripts/check-mcp-tools.mjs`, or start the server and read the instructions).
- [ ] 5.2 Build a chain over MCP round two 24T sprockets with an 8T idler (Under) and a standoff (Over), then `audit_assembly` and `capture_screenshot` from two views; compare with the expected bends. Verify a clean audit and screenshots showing the top run under the idler and the bottom run over the standoff. Run all `node scripts/check-*.mjs` and confirm each exits 0.
