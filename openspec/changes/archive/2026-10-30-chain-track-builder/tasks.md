## 1. Sprocket and link data

- [x] 1.1 Add `measureSprocket` to `scripts/measure-part-geometry.mjs` (reuse the spur-gear Fourier fit with k = teeth; pitch radius from `6.35 / (2·sin(180°/N))`; tooth phase, gap phase, tip radius, face span) and call it from `scripts/index-part-metadata.mjs` for every `/sprocket/i` part; verify `npm run index-metadata` writes `measured: true` sprocket `gearSpecs` with pitch radii 8.30 / 16.27 / 24.32 / 32.39 / 40.47 mm (±0.02) and a tip radius larger than each
- [x] 1.2 Stop the Chain Link getting a spur `gearSpecs` from the name guess, and record `chainSpecs` for Chain Link and Tank Tread Attachment Link (pivots, pitch 6.35, outward +Y) and Traction Link (seat offset in a tread link's frame) in their metadata; verify with a `node -e` read of `public/catalog.json` and that `node scripts/check-gear-meshing.mjs` still passes
- [x] 1.3 Report sprocket tooth data in `get_part_details`; verify the MCP reply for the 16 Tooth Sprocket shows 16 teeth and pitch radius ≈ 16.27

## 2. Chain path (pure module)

- [x] 2.1 Render (offline, from the real models) two Chain Links, two tread links and a Traction Link at the poses the design gives; verify the renders show the next link's roller in the previous link's fork and the gripper's pegs in the tread link's holes
- [x] 2.2 Write `src/utils/chainPath.js` `checkSprocketsForChain(sprockets)`: sprocket-only filter, gear refusal, parallel axles (2°), one plane (1 mm), no overlaps, hull of circles, left-out list, refusal messages; verify with new cases in `scripts/check-chain-builder.mjs` (two sprockets ok, one sprocket, two spur gears, 6 mm out of plane, middle sprocket inside the loop)
- [x] 2.3 Add `buildChainPath(sprockets, { kind, grippers })`: outer touching lines, arcs, pivot walk (tooth-angle steps on arcs, 6.35 mm on runs), nearest whole link count, easing on runs, gap and move hint; verify in the check script: two 16T sprockets 101.6 mm apart give exactly 48 links and 0 gap; every pivot on an arc lies on its pitch circle (±0.05 mm); consecutive pivots on arcs are 6.35 mm apart; the loop closes
- [x] 2.4 Add link and gripper poses and sprocket turns (gap at the nearest pivot, smallest turn); verify in the check script: link pivot axes parallel to the axles, every link in the plane, each link's +Y and each gripper's pad pointing away from the loop's inside, one gripper per tread link, each sprocket turn under half a tooth, an 8T + 24T pair and a three-sprocket triangle both close

## 3. Overlaps and audit

- [x] 3.1 Write `src/utils/chainFit.js` (link-on-sprocket, chain-neighbour and gripper-on-link rules by part role, and bends away from any sprocket) and use it in the overlap checks in `mcp/assembly-engine.mjs` and `src/components/Viewport3D.jsx`, as `isTireOnHub` is used; verify with check-script cases and that a freshly built chain shows no red overlap in the app
- [x] 3.2 Add chain edges to the audit's connectivity graph and treat seated chain/track links and their grippers as held in the unpinned check; report a chain no longer seated on any sprocket as unsecured; verify `audit_assembly` on a build with a chain round two held sprockets reports no unpinned links, no extra islands and no chain collisions, and after moving one sprocket 20 mm flags the chain

## 4. App: Build menu and builders

- [x] 4.1 Add `src/components/BuildMenu.jsx` (same shape as `SelectMenu.jsx`, items Chain builder and Track builder, greyed with hover text from `checkSprocketsForChain`) to the Selection toolbar group in `src/App.jsx`; verify on port 5173 that the items are greyed for one sprocket and for two spur gears with the right hover text, and enabled for two sprockets in one plane
- [x] 4.2 Add `handleBuildChain(kind, { grippers })` in `src/App.jsx`, running the `build_chain` server action (`vite.config.js`, the engine's `buildChain`) as one history step that adds the links and grippers, turns the sprocket shaft groups (`turnGroup`), and groups the new parts as "Chain N" / "Track N"; select the group; show the report as the action message; refuse while previewing history; verify in the app that a chain appears as one "Chain 1" folder, the sprockets stay outside it, and one undo removes it and turns the sprockets back
- [x] 4.3 Add the Track builder dialog with the "Add rubber grippers" checkbox (remembered while the page is open), Build and Cancel; verify that Cancel places nothing, ticked places a Traction Link in every tread link facing out, unticked places only tread links

## 5. MCP tool

- [x] 5.1 Add `buildChain(state, args)` to `mcp/assembly-engine.mjs` using `chainPath.js` and the group helpers, as one history step, and register `build_chain` in `mcp/vexiq-mcp-server.mjs` with the reply fields from the spec; add it to `scripts/check-mcp-tools.mjs`; verify `node scripts/check-mcp-tools.mjs` passes, and a `build_chain` call with `kind: "track"` on two sprockets shows a "Track N" group in the app and a reply with counts and gap, while two spur gear ids are refused

## 6. Check the result and write it up

- [x] 6.1 Build three cases over MCP and in the app: 8T + 24T chain, three-sprocket triangle chain, 24T + 24T track with grippers; for each run `audit_assembly` and `capture_screenshot` from at least two views, and compare against how a real VEX IQ chain and tank tread sit on sprockets (links on the teeth, grippers outward); check the viewport stays smooth with the track (done: all three built, audited and looked at from two views in a throwaway copy of the app and in offline renders; smoothness confirmed by the user building chains and tracks in their own build on 5173)
- [x] 6.2 Run every `node scripts/check-*.mjs` and verify they all exit 0
- [x] 6.3 Update `features.md` (Build menu, chain and track builders, `build_chain`, MCP tool count) and add chain and track notes to the "How pieces are used" section of `AGENTS.md` (chain and tread links on sprockets only, 6.35 mm pitch, whole link count, grippers plug into tread links facing out); verify the MCP server's connect-time notes include the new lines
