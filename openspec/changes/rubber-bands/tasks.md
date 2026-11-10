## 1. Test data and band facts

- [ ] 1.1 Save Swish's six band meshes and their parts as a small fixture under `scripts/fixtures/` (band middle-line points plus the parts each touches, in mm). Verify with a node script that loads it and prints six bands.
- [ ] 1.2 Measure free length and thickness for every band and belt part from its model. Store them where `bandPath.js` reads them. Verify that #117B comes out at about 350 mm and the 2x30 belt at about 94 mm in `scripts/check-bands.mjs`.
- [ ] 1.3 Work out the Swish intake gap numbers in each sprocket's own frame (`gapPhaseDeg`, `boreAxis`) and store them in the fixture. In the 2x3 Right Angle Beam's frame, measure whether the latch belts wrap its rounded corner or a straight edge. Verify that the check prints, for each band end, the gaps in line with its standoffs, plus the latch belt's edge form.

## 2. Spots and path solver (pure)

- [ ] 2.1 Add `src/utils/bandPath.js` with spot finding from part metadata: posts (standoffs, pin shanks and heads, shaft ends), grooves, rims, gap pass, gap hook, edges, and `public/band-spots.json` for the anchor hook. Verify in `check-bands.mjs` that a 24 Tooth Sprocket lists 24 gaps plus a rim, a 0.5x Pitch Standoff lists one post, and a 1x6 Beam lists two end edges.
- [ ] 2.2 Add the path solver: circles and points, side, height limits, wraps and cross, using alternating one-dimensional minimising. Verify that two parallel posts give the flat-belt length within 0.01 mm, that a cross between two pulleys is longer by the inner-tangent amount, and that 2 wraps add one turn.
- [ ] 2.3 Add stretch, state (slack, snug, tight, too far), the suggested size, and pull from `src/sim/bandStrength.js` (assumed values). Verify that Swish's arm route reads snug at about 1.6× with #117B, and too far with the 2x30 mm Square Silicone Belt suggesting #117B.
- [ ] 2.4 Solve all six Swish routes from the fixture. Verify that each solved path is within 2 mm of VEX's band mesh (allowing 4 mm at the arm standoff end).

## 3. Band shape kind and engine

- [ ] 3.1 Register the `band` kind in `src/utils/shapedParts.js`: accepts, check, `shapeMesh` (sweep along `path.points`), box, mirror and describe. Verify that a saved band shape reloads to the same mesh box, and that a band part with no shape stays a flat ring.
- [ ] 3.2 Add `src/engine/bandRouting.js` and the `place_band` engine action: place or reroute from a route, list spots and candidate routes, and handle parts in the way (over/under question; gear web moves to the nearest gap). Verify with checks for Swish's intake route through the gaps, and for a run past a standoff that returns a needs-route answer.
- [ ] 3.3 Keep a map from each part to the bands touching it in `core.js`. Re-solve touching bands inside move, rotate, mirror, remove and hide actions, and drop lost spots (flat ring under two). Verify that turning a hinged arm 20° lengthens its band in one undo step, and that removing a pin flattens a two-spot band with a message.
- [ ] 3.4 Carry bands through duplicate, clone, copy-insert, library builds and mirror, including mirrored gap numbers. Verify that mirroring Swish's right intake half gives bands through the matching gaps, and that a band copied without its parts becomes a flat ring.
- [ ] 3.5 Skip a band against the parts on its route and against bands on the same spot in overlap checks and the audit. Verify that `audit_assembly` on the Swish bands reports no band overlaps.

## 4. Band builder UI

- [ ] 4.1 Add **Tools → Band builder**, **Band between these** and **Belt round these** with greyed hover reasons. Verify in the running app that each is enabled and disabled per the spec's selections.
- [ ] 4.2 Add band picking in `Viewport3D.jsx`: single-spot highlight with gap labels, wheel / R / Shift+R stepping, click to add at height, see-through band coloured by stretch, close on first spot / Enter / second of two, Backspace and Esc. Verify by building Swish's arm band by hand on an imported Swish, and stepping from gap 6 to 7 with R.
- [ ] 4.3 Add `BandBuilderPanel.jsx`: size list with Choose for me, route list with side / wraps / cross controls (also offered beside a hovered spot), stretch and pull readout, suggestion, and Show routes with R to step the preview and Enter to keep. Verify that the three-standoff inside-flip and the two-route scenarios behave as specified.
- [ ] 4.4 Add the ring close-up: SVG from `gearSpecs` with numbered notches, posts as dots and the route drawn, click to add or remove, and a part switcher. Verify that selecting Swish's upper intake band shows its route through the right notches, and that clicking a notch updates the 3D band.
- [ ] 4.5 Add editing: spot handles to drag to another spot, dragging a run onto a rim to add a gap that hops gap to gap (off the rim removes it), Inspector details with size / side / wraps / cross changes, Tools → Flatten, and Move and Rotate greyed out for routed bands. Verify the push-into-gap, change-size and flatten scenarios, each as one history step.
- [ ] 4.6 Check the builder at phone width and with touch only (every key action has a button). Verify by screenshot at 390 px wide.

## 5. MCP

- [ ] 5.1 Add `place_band` to `mcp/vexiq-mcp-server.mjs` and `src/utils/webMcpTools.js`, with `list: true` and needs-route answers, and report band route, stretch and pull in `get_assembly` and `get_part_details`. Verify by calling it from an MCP client to list a sprocket's spots and to place Swish's upper intake band.
- [ ] 5.2 Add a short band note to the part-usage section of `AGENTS.md`, which is sent to MCP clients. Verify that the MCP server's instructions include it.

## 6. Play mode

- [ ] 6.1 Record band spots against bodies in `bodyGraph.js`. Apply band tension at spot contacts each substep in `physics.js`. List bands under the kinematic pass. Verify that Swish's arm swings toward the chassis with nothing holding it, and that a band on one body moves nothing.
- [ ] 6.2 Redraw bands every frame in `playRunner.js`, staying in their gaps as sprockets turn, with the colour updating, and restore them on leaving. Verify by running Swish's intake motor and watching the bands turn with the sprockets.

## 7. CAD import

- [ ] 7.1 Stop skipping bent, visible bands in `scripts/import-cad.mjs`. Match them to spots (4 mm tolerance, gap crossings, order by angle, side by outline), place them with `place_band`, leave out hidden stand-ins, and report each band's spots and stretch. Verify that `node scripts/import-cad.mjs "<Swish link>" --clear` places six bands as in the cad-import scenario, and that Flop's band is placed or listed with a reason.
- [ ] 7.2 Compare the imported Swish bands with the instructions' finished view from the same angles. Verify with screenshots from three views and a note of any difference.

## 8. Docs and checks

- [ ] 8.1 Update `features.md` for bands (builder, editing, Play pull with assumed values, MCP, import). Verify that the section names every spec requirement.
- [ ] 8.2 Run `node scripts/check-bands.mjs` and every other `scripts/check-*.mjs` check, and `openspec validate rubber-bands --strict`. Verify that all exit 0.
