## 1. Tight fits

- [x] 1.1 In `src/engine/core.js`, add the deeper (0.88 mm) collision mesh cache. Make `checkCandidateCollision` return `tightFits` beside `collidingWith`, testing the deeper mesh only for pairs that hit. Verify with a new `scripts/check-tight-fits.mjs`: a standoff 0.53 mm off a hole is a tight fit; a 2x12 Beam on top of another is an overlap.
- [x] 1.2 Pass `tightFits` through `place_part`, `place_parts` (`tightFits` per item; ignored by `rejectIntersecting`), `update_part`, `mate_parts` and Fix assembly replies. Verify by extending `scripts/check-mcp-tools.mjs`.
- [x] 1.3 Add tight fits to `audit_assembly` (own list and count, not unsound) and to the `place_parts` audit summary. Verify with `scripts/check-audit-issues.mjs`.

## 2. Flagged parts stay put

- [x] 2.1 In `src/App.jsx`, track the ids of the current placing session (library drop, drag, hole-pick insert, copy, clone) and make `resolveIntersectingInstances` act only on those. Verify in headless Chrome:
  - a part placed overlapping by `place_parts` survives clicking another part, with no "Cancel placement" step;
  - a library beam dropped onto another beam is still removed on the next click.
- [x] 2.2 Keep the Inspector's overlap warning for flagged MCP parts, and show tight fits as a separate note. Verify visually in the same run.

## 3. Connection points

- [x] 3.1 In `scripts/index-part-metadata.mjs`, keep each part's current port ids. After indexing, match new points to old ones by position and store the old id in `aliases`. Verify a check reports zero lost ids.
- [x] 3.2 Give every point a stable id `<kind>.<face>.<x>_<y>_<z>` (quarter pitches, `#n` on clashes), plus `shape` and `faces`. Verify that running `npm run index-metadata` twice gives identical ids.
- [x] 3.3 Turn unported pin-hole and square-hole cylinders into ports when a pin probe fits from their face. Verify the Bumper Switch gets its four top holes and no beam gains a false hole (diff the port counts per part).
- [x] 3.4 Add `shaft` ports (axis, both ends, cross-section, capped or stop-ring end) to every shaft. Verify the 4x Pitch Motor Shaft and 4x Pitch Capped Shaft entries.
- [x] 3.5 Derive attachment pegs from the tread link's `gripperHoles` and each attachment's `seatInLink`. Verify the Long Intake Flap's two pegs line up with the link's holes in a track built by `build_chain`.
- [x] 3.6 Type the Mini Standoff Connector's bore as `pin_hole`. Verify a pin in it is seated in the audit.
- [x] 3.7 Add `findPort(part, id)` in `src/engine/core.js` (stable id or alias) and use it everywhere a port id is read: `place_parts` insert, `mate_parts`, `align_part_to_hole`, `mesh_gear_train`, `build_chain`, the app's hole picking. On an unknown id, the error lists the stable ids. Verify an insert by `hole_14` and by stable id give the same pose.
- [x] 3.8 Update `get_part_details` (stable id, aliases, shape, faces, shaft ends, frame entry) and `audit_assembly` (shafts checked along their indexed axis). Verify with `scripts/check-mcp-tools.mjs` and the capped-shaft-through-gear scenario.
- [x] 3.9 Write `scripts/check-connection-points.mjs`, covering the connection-points spec scenarios, and verify it exits 0.

## 4. CAD frame table and import

- [x] 4.1 Add `public/cad-frames.json` with the Flop `pins` entries, and a shared converter (CAD pose to app pose) in `src/engine/cadFrames.js`. Verify against Flop's saved data:
  - the Smart Motor's mounting pins are seated in its holes;
  - its motor shaft is in its drive socket.
- [x] 4.2 Write `scripts/import-cad.mjs`:
  - take a project id, link or saved JSON;
  - walk the tree, skip non-library parts and drop duplicates;
  - give each part a unique label;
  - place in batches through the MCP server and group per subassembly;
  - print the report.
  
  Verify the Flop import has no lost parts after a click in the app, the expected left-out and duplicate lists, and every chain link present.
- [x] 4.3 Write `scripts/fit-cad-frames.mjs`: download and cache the project archive, decode the Draco meshes, try both rules and the 24 turns, refine, then write `mesh` entries (never over `pins`) or report poor matches. Verify that on Flop it reproduces every seeded `pins` entry within 0.5 mm.
- [x] 4.4 Write `scripts/check-cad-import.mjs` on a saved slice of the Flop data (motor, motor shaft, pins, a corner connector, two chains with the same link names). Verify it exits 0.

## 5. Wrap-up

- [x] 5.1 Add a short "Importing VEX CAD" section to `AGENTS.md`, and the new behaviour to `features.md`.
- [x] 5.2 Run every `node scripts/check-*.mjs` and `npm run build`. Verify all pass.
